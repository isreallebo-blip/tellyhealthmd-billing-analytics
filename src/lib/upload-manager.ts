// Module-level upload manager. Runs uploads in the background so they continue
// even when the user navigates away from the Upload page. Subscribers get
// notified of state changes via useSyncExternalStore.
//
// Heavy parsing libraries (xlsx, mammoth, pdfjs) are dynamically imported
// inside processOne so they don't ship with every page — this module is
// reachable from AppShell via the progress dock.

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";


export type UploadItemStatus = "queued" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: UploadItemStatus;
  error?: string;
  sourceFileId?: string | null;
  startedAt?: number;
  finishedAt?: number;
};

type State = {
  items: UploadItem[];
  active: number;
};

const EMBED_BYTES_MAX = 6 * 1024 * 1024;
const CONCURRENCY = 3;
const STRUCTURED_CHUNK_ROWS = 1000;

let state: State = { items: [], active: 0 };
const listeners = new Set<() => void>();
let running = 0;
let firstNewId: string | null = null;
let onFirstSourceFile: ((id: string) => void) | null = null;

function setState(patch: Partial<State> | ((s: State) => State)) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  listeners.forEach((l) => l());
}

function patchItem(id: string, patch: Partial<UploadItem>) {
  setState((s) => ({
    ...s,
    items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
  }));
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function sheetToRows(XLSX: typeof import("xlsx"), sheet: any): Record<string, any>[] {
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1, defval: null, blankrows: false, raw: true,
  });
  if (aoa.length === 0) return [];
  const cellText = (v: any) =>
    v == null ? "" : typeof v === "string" ? v.trim() : String(v).trim();
  const SCAN = Math.min(aoa.length, 25);
  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < SCAN; i++) {
    const row = aoa[i] ?? [];
    let strings = 0, nonEmpty = 0;
    for (const c of row) {
      const t = cellText(c);
      if (!t) continue;
      nonEmpty++;
      if (typeof c === "string" && isNaN(Number(t))) strings++;
    }
    const score = strings >= 2 ? strings * 10 + nonEmpty : 0;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }
  const headerRow = aoa[headerIdx] ?? [];
  const seen = new Map<string, number>();
  const headers: string[] = headerRow.map((c: any, i: number) => {
    let name = cellText(c);
    if (!name) name = `Column ${XLSX.utils.encode_col(i)}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });
  const out: Record<string, any>[] = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (row.every((c: any) => c == null || cellText(c) === "")) continue;
    const obj: Record<string, any> = {};
    let any = false;
    for (let i = 0; i < headers.length; i++) {
      const v = row[i];
      obj[headers[i]] = v == null || v === "" ? null : v;
      if (v != null && cellText(v) !== "") any = true;
    }
    if (any) out.push(obj);
  }
  return out;
}

async function processOne(item: UploadItem, file: File) {
  patchItem(item.id, { status: "uploading", startedAt: Date.now() });
  // Dynamically import heavy libs so the progress dock doesn't ship them
  // on every page load.
  const { detectKind } = await import("@/lib/file-kind");
  const { extractUnstructuredText } = await import("@/lib/file-extract");
  const kind = detectKind(file.name);
  const embedBytes = file.size <= EMBED_BYTES_MAX;
  const payload: Record<string, any> = {
    filename: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    kind,
  };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("You're not signed in.");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const postUpload = async (body: Record<string, any>) => {
    const response = await fetch(`${supabaseUrl}/functions/v1/process-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw new Error(data?.error ?? text ?? `Upload failed (${response.status})`);
    return data as { source_file_id?: string | null };
  };

  if (kind === "structured") {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = sheetToRows(XLSX, sheet);
    const headers = Array.from(rows.reduce((set, row) => {
      Object.keys(row ?? {}).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    let sourceFileId: string | null = null;
    for (let start = 0; start < rows.length || start === 0; start += STRUCTURED_CHUNK_ROWS) {
      const chunk = rows.slice(start, start + STRUCTURED_CHUNK_ROWS);
      const first = start === 0;
      const last = start + STRUCTURED_CHUNK_ROWS >= rows.length;
      const data = await postUpload({
        ...payload,
        upload_mode: first ? "start_structured" : "append_structured",
        source_file_id: sourceFileId,
        rows: chunk,
        headers,
        start_index: start,
        total_rows: rows.length,
        is_last_chunk: last,
        ...(first && embedBytes ? { file_b64: await fileToBase64(new Blob([buf])) } : {}),
      });
      sourceFileId = data.source_file_id ?? sourceFileId;
      if (!sourceFileId) throw new Error("Upload did not create a file record");
      patchItem(item.id, { sourceFileId });
      if (last) break;
    }
    return sourceFileId;
  } else {
    const [text, b64] = await Promise.all([
      extractUnstructuredText(file),
      embedBytes ? fileToBase64(file) : Promise.resolve<string | null>(null),
    ]);
    if (!text || text.trim().length < 20) {
      throw new Error("No extractable text found (scanned PDF? OCR is not supported yet).");
    }
    payload.text = text;
    if (b64) payload.file_b64 = b64;
  }
  const data = await postUpload(payload);
  return (data?.source_file_id ?? null) as string | null;
}

async function pump() {
  while (running < CONCURRENCY) {
    const next = state.items.find((it) => it.status === "queued");
    if (!next) break;
    running++;
    setState({ active: running });
    const fileRef = fileRefs.get(next.id);
    if (!fileRef) {
      patchItem(next.id, { status: "error", error: "File reference lost" });
      running--;
      setState({ active: running });
      continue;
    }
    (async () => {
      try {
        const sourceId = await processOne(next, fileRef);
        patchItem(next.id, {
          status: "done",
          sourceFileId: sourceId,
          finishedAt: Date.now(),
        });
        toast.success(`${next.name} queued for parsing`);
        if (sourceId && !firstNewId) {
          firstNewId = sourceId;
          onFirstSourceFile?.(sourceId);
        }
      } catch (e: any) {
        patchItem(next.id, {
          status: "error",
          error: e?.message ?? "Failed",
          finishedAt: Date.now(),
        });
        toast.error(`${next.name}: ${e?.message ?? "Failed"}`);
      } finally {
        fileRefs.delete(next.id);
        running--;
        setState({ active: running });
        pump();
      }
    })();
  }
}

// Files can't be serialized into state; keep raw refs separately.
const fileRefs = new Map<string, File>();

export const uploadManager = {
  enqueue(files: File[]): UploadItem[] {
    const items: UploadItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      status: "queued" as const,
    }));
    items.forEach((it, i) => fileRefs.set(it.id, files[i]));
    setState((s) => ({ ...s, items: [...s.items, ...items] }));
    pump();
    return items;
  },
  remove(id: string) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    if (it.status === "uploading") return; // can't cancel in-flight
    fileRefs.delete(id);
    setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
  },
  clearFinished() {
    setState((s) => ({
      ...s,
      items: s.items.filter((x) => x.status === "queued" || x.status === "uploading"),
    }));
  },
  resetFirstNew() { firstNewId = null; },
  onFirstSourceFile(cb: ((id: string) => void) | null) { onFirstSourceFile = cb; },
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  getState(): State { return state; },
};
