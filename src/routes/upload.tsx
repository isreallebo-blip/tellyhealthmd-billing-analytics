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
import { Upload, FileSpreadsheet, AlertTriangle, Plus, X, Trash2 } from "lucide-react";
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

type CompanyStats = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  unknownCpt: number;
  skippedRows: SkippedRow[];
  unknownCpts: Record<string, number>;
};

type FileResult = {
  filename: string;
  perCompany: Record<string, CompanyStats>;
  errors: { row: number; message: string }[];
};

const COLUMN_KEYS = [
  "PT Name", "DOB", "Pri_Ins", "Prov", "Prov Name", "DOS", "CPT",
  "AvgDsToPmt", "DaysToPmt", "Visit Type", "Revenue", "paydate",
  "Denied Claim", "Company", "MRN", "Acct",
] as const;

function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const mm = String(d.m).padStart(2, "0");
    const dd = String(d.d).padStart(2, "0");
    return `${d.y}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

function parseBool(v: any): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "denied";
}

function emptyStats(): CompanyStats {
  return { processed: 0, inserted: 0, updated: 0, skipped: 0, unknownCpt: 0, skippedRows: [], unknownCpts: {} };
}

function UploadPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [queue, setQueue] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFileIdx, setCurrentFileIdx] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [skippedView, setSkippedView] = useState<{ title: string; rows: SkippedRow[] } | null>(null);
  const [unknownView, setUnknownView] = useState<{ title: string; counts: Record<string, number> } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wiping, setWiping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("upload_history")
      .select("id,filename,company,created_at,rows_processed,rows_inserted,rows_updated,rows_skipped,unknown_cpt_count,skipped_rows,unknown_cpts" as any)
      .order("created_at", { ascending: false })
      .limit(200);
    setHistory((data ?? []) as unknown as HistoryRow[]);
  }, []);

  useEffect(() => {
    if (profile) loadHistory();
  }, [profile, loadHistory]);

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    if (arr.length === 0) return;
    setQueue((q) => {
      const seen = new Set(q.map((f) => `${f.name}:${f.size}`));
      const next = [...q];
      for (const f of arr) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) {
          next.push(f);
          seen.add(key);
        }
      }
      return next;
    });
  }

  function removeFromQueue(idx: number) {
    setQueue((q) => q.filter((_, i) => i !== idx));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  async function processOneFile(file: File): Promise<FileResult> {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });

    const [{ data: cptRef }, { data: overrides }] = await Promise.all([
      supabase.from("cpt_reference").select("cpt_code,service_category,billing_type"),
      supabase.from("cpt_insurance_overrides").select("cpt_code,insurance_code,override_billing_type"),
    ]);
    const cptMap = new Map<string, { service_category: string | null; billing_type: string | null }>();
    cptRef?.forEach((r: any) =>
      cptMap.set(String(r.cpt_code).toUpperCase(), { service_category: r.service_category, billing_type: r.billing_type })
    );
    const overrideMap = new Map<string, string>();
    overrides?.forEach((r: any) =>
      overrideMap.set(`${String(r.cpt_code).toUpperCase()}|${String(r.insurance_code).toUpperCase()}`, r.override_billing_type)
    );

    const perCompany: Record<string, CompanyStats> = {};
    const companyUploadId: Record<string, string> = {};
    const errors: { row: number; message: string }[] = [];

    async function ensureUploadRow(company: string): Promise<string | null> {
      if (companyUploadId[company]) return companyUploadId[company];
      const { data, error } = await supabase
        .from("upload_history")
        .insert({
          filename: file.name,
          company,
          uploaded_by: profile!.id,
          rows_processed: 0,
          rows_inserted: 0,
          rows_updated: 0,
          rows_skipped: 0,
          unknown_cpt_count: 0,
        } as any)
        .select("id")
        .single();
      if (error || !data) return null;
      companyUploadId[company] = data.id;
      return data.id;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const company = String(r["Company"] ?? "").trim();
      if (!company) {
        errors.push({ row: i + 2, message: "Missing Company value" });
        setProgress(Math.round(((i + 1) / rows.length) * 100));
        continue;
      }
      if (!perCompany[company]) perCompany[company] = emptyStats();
      const stats = perCompany[company];
      stats.processed++;
      const uploadId = await ensureUploadRow(company);

      try {
        const cpt = String(r["CPT"] ?? "").trim().toUpperCase();
        const pri_ins = String(r["Pri_Ins"] ?? "").trim().toUpperCase();
        const acct = String(r["Acct"] ?? "").trim();
        const dos = parseDate(r["DOS"]);
        if (!acct || !dos || !cpt) {
          errors.push({ row: i + 2, message: "Missing required Acct / DOS / CPT" });
          continue;
        }

        const ref = cptMap.get(cpt);
        let billing_type = ref?.billing_type ?? null;
        const service_category = ref?.service_category ?? null;
        if (!ref) {
          stats.unknownCpt++;
          stats.unknownCpts[cpt] = (stats.unknownCpts[cpt] ?? 0) + 1;
        }

        const ov = overrideMap.get(`${cpt}|${pri_ins}`);
        if (ov) billing_type = ov;

        const is_primary_billable = ref ? billing_type === "Primary" : true;

        const revenue = parseNum(r["Revenue"]);
        const days_to_pmt = parseNum(r["DaysToPmt"]);
        const pay_date = parseDate(r["paydate"]);
        const denied_claim = parseBool(r["Denied Claim"]);

        const { data: existing } = await supabase
          .from("claims_raw")
          .select("id,revenue")
          .eq("acct", acct).eq("dos", dos).eq("cpt", cpt).eq("company", company)
          .maybeSingle();

        const payload: any = {
          company,
          pt_name: r["PT Name"] ?? null,
          dob: parseDate(r["DOB"]),
          pri_ins,
          prov_code: r["Prov"] ?? null,
          prov_name: r["Prov Name"] ?? null,
          dos,
          cpt,
          avg_days_to_pmt: parseNum(r["AvgDsToPmt"]),
          days_to_pmt,
          visit_type: r["Visit Type"] ?? null,
          revenue,
          pay_date,
          denied_claim,
          mrn: r["MRN"] ?? null,
          acct,
          service_category,
          is_primary_billable,
          upload_id: uploadId,
        };

        if (!existing) {
          const { error } = await supabase.from("claims_raw").insert(payload);
          if (error) throw error;
          stats.inserted++;
        } else {
          const oldRev = existing.revenue;
          const hasNewPmt = revenue != null && (oldRev == null || Number(oldRev) === 0);
          if (hasNewPmt) {
            const { error } = await supabase
              .from("claims_raw")
              .update({ revenue, pay_date, days_to_pmt, denied_claim, last_updated_upload_id: uploadId })
              .eq("id", existing.id);
            if (error) throw error;
            stats.updated++;
            stats.skippedRows.push({ acct, dos, cpt, company, reason: "Duplicate - updated" });
          } else {
            stats.skipped++;
            stats.skippedRows.push({ acct, dos, cpt, company, reason: "Duplicate - no new payment" });
          }
        }
      } catch (err: any) {
        errors.push({ row: i + 2, message: err?.message ?? "Unknown error" });
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    // Finalize each per-company upload_history row with final stats
    const errSlice = errors.length ? errors.slice(0, 100) : null;
    await Promise.all(
      Object.keys(perCompany).map(async (c) => {
        const id = companyUploadId[c];
        if (!id) return;
        const s = perCompany[c];
        await supabase
          .from("upload_history")
          .update({
            rows_processed: s.processed,
            rows_inserted: s.inserted,
            rows_updated: s.updated,
            rows_skipped: s.skipped,
            unknown_cpt_count: s.unknownCpt,
            errors: errSlice,
            skipped_rows: s.skippedRows.slice(0, 5000),
            unknown_cpts: s.unknownCpts,
          } as any)
          .eq("id", id);
      })
    );

    return { filename: file.name, perCompany, errors };
  }

  async function processAll() {
    if (queue.length === 0) return toast.error("Add at least one file first");
    if (!profile) return;
    setProcessing(true);
    setResults(null);
    const collected: FileResult[] = [];
    try {
      for (let i = 0; i < queue.length; i++) {
        setCurrentFileIdx(i);
        setCurrentFileName(queue[i].name);
        setProgress(0);
        try {
          const r = await processOneFile(queue[i]);
          collected.push(r);
        } catch (err: any) {
          toast.error(`${queue[i].name}: ${err?.message ?? "Failed"}`);
          collected.push({ filename: queue[i].name, perCompany: {}, errors: [{ row: 0, message: err?.message ?? "Failed" }] });
        }
      }
      const totalUnknown = collected.reduce(
        (sum, f) => sum + Object.values(f.perCompany).reduce((s, c) => s + c.unknownCpt, 0),
        0,
      );
      if (totalUnknown > 0) {
        toast.warning(`${totalUnknown} unknown CPT codes found — click the Unknown CPT count to review and classify them.`);
      }
      setResults(collected);
      setQueue([]);
      if (inputRef.current) inputRef.current.value = "";
      loadHistory();
      try { localStorage.setItem("tellyhealth:ai-autorun", String(Date.now())); } catch {}
    } finally {
      setProcessing(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Delete claims inserted by this upload that have not been later updated by a newer upload
      const { data: toDelete, error: selErr } = await supabase
        .from("claims_raw")
        .select("id")
        .eq("upload_id", deleteTarget.id)
        .is("last_updated_upload_id", null);
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
      setWipeOpen(false);
      setWipeConfirm("");
      loadHistory();
    } catch (err: any) {
      toast.error(err?.message ?? "Wipe failed");
    } finally {
      setWiping(false);
    }
  }

  const canUpload = useMemo(() => queue.length > 0 && !processing, [queue, processing]);

  return (
    <>
      <PageHeader title="Upload Claims" description="Drop one or more Excel exports to ingest and deduplicate billing rows." />
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
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  className="hidden"
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
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={processing}
                        onClick={() => removeFromQueue(i)}
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
                Company is detected automatically from the <span className="font-medium text-foreground">Company</span> column in each file. Rows are grouped per company.
              </div>

              {processing && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    Processing file {currentFileIdx + 1} of {queue.length || currentFileIdx + 1}: {currentFileName}… {progress}%
                  </div>
                  <Progress value={progress} />
                </div>
              )}

              <Button className="w-full" disabled={!canUpload} onClick={processAll}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {processing ? "Processing…" : `Upload & Process All${queue.length ? ` (${queue.length})` : ""}`}
              </Button>

              <p className="text-xs text-muted-foreground">
                Expected columns: {COLUMN_KEYS.join(", ")}
              </p>
            </div>
          </div>
        </Card>

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
                        >
                          {h.rows_skipped}
                        </button>
                      ) : (
                        h.rows_skipped
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hasUnknown ? (
                        <button
                          onClick={() => setUnknownView({ title: `${h.filename} — ${h.company}`, counts: h.unknown_cpts ?? {} })}
                        >
                          <Badge variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-50 cursor-pointer">
                            {h.unknown_cpt_count}
                          </Badge>
                        </button>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(h)}
                        aria-label="Delete upload"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Combined results modal */}
      <Dialog open={!!results} onOpenChange={(o) => { if (!o) { setResults(null); navigate({ to: "/" }); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Complete</DialogTitle>
            <DialogDescription>Results grouped by file and company.</DialogDescription>
          </DialogHeader>
          {results && results.length > 0 && (
            <div className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              {results.flatMap((f) => {
                const companies = Object.keys(f.perCompany).sort();
                if (companies.length === 0) return [<div key={f.filename}><span className="font-medium">{f.filename}</span> — no rows processed</div>];
                return companies.map((c) => {
                  const s = f.perCompany[c];
                  return (
                    <div key={`${f.filename}|${c}`}>
                      <span className="font-medium text-foreground">{f.filename} — {c}:</span>{" "}
                      {s.inserted} inserted, {s.updated} updated, {s.skipped} skipped
                    </div>
                  );
                });
              })}
            </div>
          )}
          {results && results.some((f) => Object.values(f.perCompany).some((c) => c.unknownCpt > 0)) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>Some rows had unknown CPT codes — click the Unknown CPT count in Upload History to review and classify them.</div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => { setResults(null); navigate({ to: "/" }); }}>View Dashboard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <TableHead>Acct</TableHead>
                  <TableHead>DOS</TableHead>
                  <TableHead>CPT</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Reason</TableHead>
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
                          size="sm"
                          variant="outline"
                          onClick={() => navigate({ to: "/admin/cpt", search: { addCpt: code } as any })}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add to CPT Reference
                        </Button>
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
              <div>
                Note: Some records from this upload were later updated by a newer upload — only the original inserted records will be removed, updated records will be preserved.
              </div>
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
          <Input
            placeholder="Type DELETE to confirm"
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
            disabled={wiping}
          />
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
