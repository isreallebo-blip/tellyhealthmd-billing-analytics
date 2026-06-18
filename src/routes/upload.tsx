import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, AlertTriangle, Plus, X, Trash2, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload Claims — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Upload Excel claim files for processing and deduplication." },
    ],
  }),
  component: () => (
    <AppShell>
      <UploadPage />
    </AppShell>
  ),
});

type SkippedRow = { acct: string; dos: string; cpt: string; company: string; reason: string };

type HistoryRow = {
  id: string;
  filename: string;
  company: string;
  created_at: string;
  rows_processed: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  unknown_cpt_count: number;
  skipped_rows: SkippedRow[] | null;
  unknown_cpts: Record<string, number> | null;
};

type UploadJob = {
  id: string;
  filename: string;
  status: "queued" | "processing" | "complete" | "error";
  total_rows: number;
  processed_rows: number;
  inserted: number;
  updated: number;
  skipped: number;
  unknown_cpt: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

const COLUMN_KEYS = [
  "PT Name", "DOB", "Pri_Ins", "Prov", "Prov Name", "DOS", "CPT",
  "AvgDsToPmt", "DaysToPmt", "Visit Type", "Revenue", "paydate",
  "Denied Claim", "Company", "MRN", "Acct",
] as const;

function UploadPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [queue, setQueue] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skippedView, setSkippedView] = useState<{ title: string; rows: SkippedRow[] } | null>(null);
  const [unknownView, setUnknownView] = useState<{ title: string; counts: Record<string, number> } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wiping, setWiping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const notifiedJobs = useRef<Set<string>>(new Set());

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("upload_history")
      .select("id,filename,company,created_at,rows_processed,rows_inserted,rows_updated,rows_skipped,unknown_cpt_count,skipped_rows,unknown_cpts" as any)
      .order("created_at", { ascending: false })
      .limit(200);
    setHistory((data ?? []) as unknown as HistoryRow[]);
  }, []);

  const loadJobs = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("upload_jobs" as any)
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setJobs((data ?? []) as unknown as UploadJob[]);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    loadHistory();
    loadJobs();

    const channel = supabase
      .channel("upload-jobs-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upload_jobs", filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as UploadJob;
          setJobs((prev) => {
            const map = new Map(prev.map((j) => [j.id, j]));
            if (payload.eventType === "DELETE") map.delete(row.id);
            else map.set(row.id, row);
            return Array.from(map.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          });
          // Notify on completion + refresh history
          if (payload.eventType === "UPDATE" && row.status === "complete" && !notifiedJobs.current.has(row.id)) {
            notifiedJobs.current.add(row.id);
            toast.success(`${row.filename} done — ${row.inserted} inserted, ${row.updated} updated, ${row.skipped} skipped`);
            if (row.unknown_cpt > 0) {
              toast.warning(`${row.unknown_cpt} unknown CPT codes — click the Unknown CPT count to review.`);
            }
            loadHistory();
          }
          if (payload.eventType === "UPDATE" && row.status === "error" && !notifiedJobs.current.has(row.id)) {
            notifiedJobs.current.add(row.id);
            toast.error(`${row.filename} failed: ${row.error_message ?? "unknown error"}`);
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile, loadHistory, loadJobs]);

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    if (arr.length === 0) return;
    setQueue((q) => {
      const seen = new Set(q.map((f) => `${f.name}:${f.size}`));
      const next = [...q];
      for (const f of arr) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) { next.push(f); seen.add(key); }
      }
      return next;
    });
  }
  function removeFromQueue(idx: number) { setQueue((q) => q.filter((_, i) => i !== idx)); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files);
  }

  async function submitFile(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });

    const { data, error } = await supabase.functions.invoke("process-upload", {
      body: { filename: file.name, rows },
    });
    if (error) throw new Error(error.message ?? "Failed to start upload");
    toast.success(`${file.name} queued — processing ${rows.length.toLocaleString()} rows in the background.`);
    if (data?.jobId) {
      // Optimistically add to jobs so the card shows immediately
      setJobs((prev) => {
        if (prev.some((j) => j.id === data.jobId)) return prev;
        return [{
          id: data.jobId, filename: file.name, status: "processing",
          total_rows: rows.length, processed_rows: 0,
          inserted: 0, updated: 0, skipped: 0, unknown_cpt: 0,
          error_message: null, created_at: new Date().toISOString(), completed_at: null,
        }, ...prev];
      });
    }
  }

  async function submitAll() {
    if (queue.length === 0) return toast.error("Add at least one file first");
    if (!profile) return;
    setSubmitting(true);
    try {
      for (const f of queue) {
        try { await submitFile(f); }
        catch (err: any) { toast.error(`${f.name}: ${err?.message ?? "Failed"}`); }
      }
      setQueue([]);
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data: toDelete, error: selErr } = await supabase
        .from("claims_raw").select("id")
        .eq("upload_id", deleteTarget.id).is("last_updated_upload_id", null);
      if (selErr) throw selErr;
      const ids = (toDelete ?? []).map((r: any) => r.id);
      if (ids.length > 0) {
        const { error: delErr } = await supabase.from("claims_raw").delete().in("id", ids);
        if (delErr) throw delErr;
      }
      const { error: histErr } = await supabase.from("upload_history").delete().eq("id", deleteTarget.id);
      if (histErr) throw histErr;
      toast.success(`Upload deleted — ${ids.length} records removed.`);
      setDeleteTarget(null);
      loadHistory();
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function wipeAll() {
    if (wipeConfirm !== "DELETE") return;
    setWiping(true);
    try {
      const { error: cErr } = await supabase.from("claims_raw").delete().not("id", "is", null);
      if (cErr) throw cErr;
      const { error: hErr } = await supabase.from("upload_history").delete().not("id", "is", null);
      if (hErr) throw hErr;
      toast.success("All claims data deleted.");
      setWipeOpen(false); setWipeConfirm(""); loadHistory();
    } catch (err: any) {
      toast.error(err?.message ?? "Wipe failed");
    } finally {
      setWiping(false);
    }
  }

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === "processing" || j.status === "queued"),
    [jobs],
  );
  const recentDoneJobs = useMemo(
    () => jobs.filter((j) => j.status === "complete" || j.status === "error").slice(0, 5),
    [jobs],
  );
  const canUpload = queue.length > 0 && !submitting;

  return (
    <>
      <PageHeader title="Upload Claims" description="Drop one or more Excel exports. Processing runs in the background — you can navigate away." />
      <div className="p-8 space-y-8">
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
                <div className="font-medium">Drag & drop one or more Excel files here</div>
                <div className="text-sm text-muted-foreground mt-1">or click to browse — .xlsx, .xls</div>
                <input
                  ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
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
                Company is detected automatically from the <span className="font-medium text-foreground">Company</span> column. Processing runs server-side — closing this tab won't stop it.
              </div>

              <Button className="w-full" disabled={!canUpload} onClick={submitAll}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {submitting ? "Submitting…" : `Upload & Process All${queue.length ? ` (${queue.length})` : ""}`}
              </Button>

              <p className="text-xs text-muted-foreground">
                Expected columns: {COLUMN_KEYS.join(", ")}
              </p>
            </div>
          </div>
        </Card>

        {(activeJobs.length > 0 || recentDoneJobs.length > 0) && (
          <Card>
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold">Background Processing</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                These jobs run server-side. You can leave this page and the work continues.
              </p>
            </div>
            <div className="divide-y">
              {activeJobs.map((j) => {
                const pct = j.total_rows > 0 ? Math.round((j.processed_rows / j.total_rows) * 100) : 0;
                return (
                  <div key={j.id} className="px-6 py-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="font-medium truncate">{j.filename}</span>
                      <span className="text-muted-foreground ml-auto tabular-nums">
                        {j.processed_rows.toLocaleString()} / {j.total_rows.toLocaleString()} rows ({pct}%)
                      </span>
                    </div>
                    <Progress value={pct} />
                  </div>
                );
              })}
              {recentDoneJobs.map((j) => (
                <div key={j.id} className="px-6 py-3 flex items-center gap-2 text-sm">
                  {j.status === "complete" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="font-medium truncate">{j.filename}</span>
                  <span className="text-muted-foreground ml-auto tabular-nums">
                    {j.status === "complete"
                      ? `${j.inserted} inserted · ${j.updated} updated · ${j.skipped} skipped${j.unknown_cpt ? ` · ${j.unknown_cpt} unknown CPT` : ""}`
                      : (j.error_message ?? "Failed")}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
            <h2 className="font-semibold">Upload History</h2>
            {isAdmin && (
              <Button variant="destructive" size="sm" onClick={() => { setWipeConfirm(""); setWipeOpen(true); }}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete All & Start Fresh
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Processed</TableHead>
                <TableHead className="text-right">Inserted</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="text-right">Unknown CPT</TableHead>
                <TableHead className="text-right w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No uploads yet.</TableCell></TableRow>
              ) : history.map((h) => {
                const hasSkipped = h.rows_skipped > 0 && Array.isArray(h.skipped_rows) && h.skipped_rows.length > 0;
                const hasUnknown = h.unknown_cpt_count > 0 && h.unknown_cpts && Object.keys(h.unknown_cpts).length > 0;
                return (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.filename}</TableCell>
                    <TableCell>{h.company}</TableCell>
                    <TableCell>{new Date(h.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.rows_processed}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.rows_inserted}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.rows_updated}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hasSkipped ? (
                        <button
                          className="text-primary hover:underline font-medium"
                          onClick={() => setSkippedView({ title: `${h.filename} — ${h.company}`, rows: h.skipped_rows ?? [] })}
                        >{h.rows_skipped}</button>
                      ) : h.rows_skipped}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hasUnknown ? (
                        <button onClick={() => setUnknownView({ title: `${h.filename} — ${h.company}`, counts: h.unknown_cpts ?? {} })}>
                          <Badge variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-50 cursor-pointer">
                            {h.unknown_cpt_count}
                          </Badge>
                        </button>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(h)} aria-label="Delete upload"
                      ><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Skipped rows detail */}
      <Dialog open={!!skippedView} onOpenChange={(o) => { if (!o) setSkippedView(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Skipped Rows</DialogTitle>
            <DialogDescription>{skippedView?.title}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Acct</TableHead><TableHead>DOS</TableHead><TableHead>CPT</TableHead>
                  <TableHead>Company</TableHead><TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(skippedView?.rows ?? []).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.acct}</TableCell>
                    <TableCell>{r.dos}</TableCell>
                    <TableCell className="font-mono text-xs">{r.cpt}</TableCell>
                    <TableCell>{r.company}</TableCell>
                    <TableCell><Badge variant="outline">{r.reason}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unknown CPTs detail */}
      <Dialog open={!!unknownView} onOpenChange={(o) => { if (!o) setUnknownView(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Unknown CPT Codes</DialogTitle>
            <DialogDescription>{unknownView?.title}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CPT Code</TableHead>
                  <TableHead className="text-right">Times Appeared in File</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(unknownView?.counts ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <TableRow key={code}>
                      <TableCell className="font-mono text-xs font-semibold">{code}</TableCell>
                      <TableCell className="text-right tabular-nums">{count}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm" variant="outline"
                          onClick={() => navigate({ to: "/admin/cpt", search: { addCpt: code } as any })}
                        ><Plus className="h-3 w-3 mr-1" /> Add to CPT Reference</Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete single upload confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this upload?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this upload? This will permanently remove all claim records inserted by this upload that have not been updated by a later upload. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && deleteTarget.rows_updated > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>Note: Some records from this upload were later updated by a newer upload — only the original inserted records will be removed, updated records will be preserved.</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wipe all confirmation */}
      <Dialog open={wipeOpen} onOpenChange={(o) => { if (!o && !wiping) { setWipeOpen(false); setWipeConfirm(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all claims data?</DialogTitle>
            <DialogDescription>
              This will delete ALL claims data from the database. This cannot be undone. Type <span className="font-mono font-semibold">DELETE</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Type DELETE to confirm" value={wipeConfirm} onChange={(e) => setWipeConfirm(e.target.value)} disabled={wiping} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setWipeOpen(false); setWipeConfirm(""); }} disabled={wiping}>Cancel</Button>
            <Button variant="destructive" onClick={wipeAll} disabled={wiping || wipeConfirm !== "DELETE"}>
              {wiping ? "Deleting…" : "Delete Everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
