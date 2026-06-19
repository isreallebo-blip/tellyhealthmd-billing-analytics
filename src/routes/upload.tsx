import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, FileText, X, Loader2, ListChecks, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { detectKind, extractUnstructuredText, isSupported } from "@/lib/file-extract";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload Claims — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Upload Excel claim files for parsing, review, and approval." },
    ],
  }),
  component: () => (
    <AppShell>
      <UploadPage />
    </AppShell>
  ),
});

// Native, off-main-thread base64 via FileReader — much faster than a JS loop
// for large files. Strips the "data:...;base64," prefix.
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

// Files larger than this skip embedded-bytes storage to keep uploads fast.
// Original-file preview/download is only available below this threshold.
const EMBED_BYTES_MAX = 6 * 1024 * 1024;

// Parse a worksheet into row objects, auto-detecting the real header row.
// Spreadsheets often have title / blank / merged rows above the column
// titles; using sheet_to_json directly turns those into garbage keys like
// "__EMPTY", "__EMPTY_1". Instead, read as array-of-arrays and pick the
// header row by looking for the widest run of non-empty text cells.
function sheetToRows(sheet: XLSX.WorkSheet): Record<string, any>[] {
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  if (aoa.length === 0) return [];

  const cellText = (v: any) =>
    v == null ? "" : typeof v === "string" ? v.trim() : String(v).trim();

  const SCAN = Math.min(aoa.length, 25);
  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < SCAN; i++) {
    const row = aoa[i] ?? [];
    let strings = 0;
    let nonEmpty = 0;
    for (const c of row) {
      const t = cellText(c);
      if (!t) continue;
      nonEmpty++;
      if (typeof c === "string" && isNaN(Number(t))) strings++;
    }
    const score = strings >= 2 ? strings * 10 + nonEmpty : 0;
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  const headerRow = aoa[headerIdx] ?? [];
  const seen = new Map<string, number>();
  const headers: string[] = headerRow.map((c, i) => {
    let name = cellText(c);
    if (!name) name = `Column ${XLSX.utils.encode_col(i)}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });

  const out: Record<string, any>[] = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (row.every((c) => c == null || cellText(c) === "")) continue;
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

function UploadPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => isSupported(f.name));
    if (arr.length === 0) {
      toast.error("Supported formats: .xlsx, .xls, .csv, .pdf, .docx, .txt");
      return;
    }
    setQueue((q) => {
      const seen = new Set(q.map((f) => `${f.name}:${f.size}`));
      const next = [...q];
      for (const f of arr) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) { next.push(f); seen.add(key); }
      }
      return next;
    });
  }, []);

  function removeFromQueue(idx: number) { setQueue((q) => q.filter((_, i) => i !== idx)); }

  async function submitFile(file: File): Promise<string | null> {
    const kind = detectKind(file.name);
    const embedBytes = file.size <= EMBED_BYTES_MAX;

    let payload: Record<string, any> = {
      filename: file.name,
      mime: file.type || null,
      size_bytes: file.size,
      kind,
    };

    if (kind === "structured") {
      // Parse the spreadsheet first (rows are required server-side). Only
      // base64-encode the raw bytes when the file is small enough to embed —
      // the parser already has everything it needs to process the rows.
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      payload.rows = sheetToRows(sheet);
      if (embedBytes) payload.file_b64 = await fileToBase64(new Blob([buf]));
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

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("You're not signed in.");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/process-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      throw new Error(data?.error ?? text ?? `Upload failed (${response.status})`);
    }
    return data?.source_file_id ?? null;
  }

  async function submitAll() {
    if (queue.length === 0) return toast.error("Add at least one file first");
    if (!profile) return;
    setSubmitting(true);

    const files = queue.slice();
    const CONCURRENCY = Math.min(8, Math.max(3, files.length));
    let nextIndex = 0;
    let done = 0;
    let firstId: string | null = null;
    const ids: (string | null)[] = new Array(files.length).fill(null);
    const t0 = performance.now();
    setProgress(`Uploading 0 of ${files.length} (parallel x${CONCURRENCY})…`);

    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= files.length) return;
        const f = files[i];
        try {
          const id = await submitFile(f);
          ids[i] = id;
          if (id && !firstId) firstId = id;
          toast.success(`${f.name} queued`);
        } catch (err: any) {
          toast.error(`${f.name}: ${err?.message ?? "Failed"}`);
        } finally {
          done++;
          setProgress(`Uploaded ${done} of ${files.length} (parallel x${CONCURRENCY})…`);
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      toast.success(`Sent ${done} file${done === 1 ? "" : "s"} in ${secs}s`);
      setQueue([]);
      if (inputRef.current) inputRef.current.value = "";
      if (firstId) navigate({ to: "/files/$id", params: { id: firstId } });
      else navigate({ to: "/files" });
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files);
  }

  return (
    <>
      <PageHeader
        title="Upload Claims"
        description="Drop one or more files. Each upload is archived and queued for parsing — review and approve from the Files list."
        actions={
          <Button variant="outline" asChild>
            <Link to="/files"><ListChecks className="h-4 w-4 mr-2" />View Files</Link>
          </Button>
        }
      />
      <div className="p-8 space-y-6">
        <Card className="p-6">
          <div className="grid md:grid-cols-[1fr_320px] gap-6">
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={[
                  "border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center px-6 py-12 cursor-pointer transition-colors",
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40",
                ].join(" ")}
              >
                <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                <div className="font-medium">Drag &amp; drop one or more files</div>
                <div className="text-sm text-muted-foreground mt-1">or click to browse — .xlsx, .xls, .csv, .pdf, .docx, .txt</div>
                <input
                  ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,.txt" multiple className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>

              {queue.length > 0 && (
                <div className="rounded-md border divide-y">
                  <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/40">
                    Queue ({queue.length} file{queue.length === 1 ? "" : "s"})
                  </div>
                  {queue.map((f, i) => {
                    const kind = detectKind(f.name);
                    const Icon = kind === "unstructured" ? FileText : FileSpreadsheet;
                    return (
                      <div key={`${f.name}:${f.size}:${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Icon className={`h-4 w-4 shrink-0 ${kind === "unstructured" ? "text-violet-500" : "text-muted-foreground"}`} />
                        <div className="flex-1 truncate">{f.name}</div>
                        {kind === "unstructured" && (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <Sparkles className="h-3 w-3" /> AI extract
                          </Badge>
                        )}
                        <div className="text-xs text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(1)} KB</div>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          disabled={submitting} onClick={() => removeFromQueue(i)}
                          aria-label={`Remove ${f.name}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p>Originals are stored immutably. Parsing runs in the background and lands on the Files list as <span className="font-medium text-foreground">Needs Review</span>.</p>
                <p className="mt-2">
                  <span className="font-medium text-foreground">Spreadsheets</span> map columns to the field registry directly.
                  <span className="font-medium text-foreground"> PDFs, Word docs and plain text</span> are run through AI to pull out claim rows — review every row before approving.
                </p>
              </div>

              <Button className="w-full" disabled={queue.length === 0 || submitting} onClick={submitAll}>
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
                {submitting ? (progress ?? "Uploading…") : `Upload ${queue.length ? `(${queue.length})` : ""}`}
              </Button>

              <p className="text-xs text-muted-foreground">
                Recognized fields: Patient, MRN, Acct, DOB, DOS, CPT, Insurance, Provider, Visit Type, Revenue, Pay Date, ICD-10, Referrer, Facility, Company. Field synonyms are configurable.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
