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

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // Chunked to avoid stack overflow on large files
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
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
    const buf = await file.arrayBuffer();
    const file_b64 = arrayBufferToBase64(buf);

    let payload: Record<string, any> = {
      filename: file.name,
      mime: file.type || null,
      size_bytes: file.size,
      file_b64,
      kind,
    };

    if (kind === "structured") {
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
      payload.rows = rows;
    } else {
      const text = await extractUnstructuredText(file);
      if (!text || text.trim().length < 20) {
        throw new Error("No extractable text found (scanned PDF? OCR is not supported yet).");
      }
      payload.text = text;
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
    let firstId: string | null = null;
    try {
      for (let i = 0; i < queue.length; i++) {
        const f = queue[i];
        setProgress(`Uploading ${i + 1} of ${queue.length}: ${f.name}`);
        try {
          const id = await submitFile(f);
          if (!firstId) firstId = id;
          toast.success(`${f.name} queued for parsing`);
        } catch (err: any) {
          toast.error(`${f.name}: ${err?.message ?? "Failed"}`);
        }
      }
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
                <div className="text-sm text-muted-foreground mt-1">or click to browse — .xlsx, .xls, .csv</div>
                <input
                  ref={inputRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>

              {queue.length > 0 && (
                <div className="rounded-md border divide-y">
                  <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/40">
                    Queue ({queue.length} file{queue.length === 1 ? "" : "s"})
                  </div>
                  {queue.map((f, i) => (
                    <div key={`${f.name}:${f.size}:${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 truncate">{f.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(1)} KB</div>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        disabled={submitting} onClick={() => removeFromQueue(i)}
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Originals are stored immutably. Parsing runs in the background and lands on the Files list as <span className="font-medium text-foreground">Needs Review</span>. You can re-parse without re-uploading.
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
