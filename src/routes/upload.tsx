import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, FileText, X, ListChecks, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { detectKind, isSupported } from "@/lib/file-extract";
import { uploadManager } from "@/lib/upload-manager";

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

function UploadPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
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

  async function submitAll() {
    if (queue.length === 0) return toast.error("Add at least one file first");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      toast.error("You're not signed in. Please sign in again.");
      return;
    }
    const files = queue.slice();
    // Hand off to the background manager and clear local queue immediately —
    // uploads continue even if the user navigates away from this page.
    uploadManager.resetFirstNew();
    uploadManager.onFirstSourceFile((id) => {
      uploadManager.onFirstSourceFile(null);
      navigate({ to: "/files/$id", params: { id } }).catch(() => {});
    });
    uploadManager.enqueue(files);
    setQueue([]);
    if (inputRef.current) inputRef.current.value = "";
    toast.success(`${files.length} file${files.length === 1 ? "" : "s"} uploading in background`);
    navigate({ to: "/files" });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files);
  }

  return (
    <>
      <PageHeader
        title="Upload Claims"
        description="Drop one or more files. Uploads continue in the background — keep working on other pages while they process."
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
                          onClick={() => removeFromQueue(i)}
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
                <p className="mt-2 text-xs">
                  You can leave this page after clicking Upload — progress shows in the bottom-right and on the Files list.
                </p>
              </div>

              <Button className="w-full" disabled={queue.length === 0 || !profile} onClick={submitAll}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {`Upload ${queue.length ? `(${queue.length})` : ""}`}
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
