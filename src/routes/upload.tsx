import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";
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
};

type CompanyStats = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  unknownCpt: number;
};

type Summary = {
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
  return { processed: 0, inserted: 0, updated: 0, skipped: 0, unknownCpt: 0 };
}

function UploadPage() {
  const { profile } = useAuth();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("upload_history")
      .select("id,filename,company,created_at,rows_processed,rows_inserted,rows_updated,rows_skipped,unknown_cpt_count")
      .order("created_at", { ascending: false })
      .limit(100);
    setHistory((data ?? []) as HistoryRow[]);
  }, []);

  useEffect(() => {
    if (profile) loadHistory();
  }, [profile, loadHistory]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  async function processFile() {
    if (!file) return toast.error("Choose a file first");
    if (!profile) return;

    setProcessing(true);
    setProgress(0);
    setSummary(null);

    try {
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
      const errors: { row: number; message: string }[] = [];

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
          if (!ref) stats.unknownCpt++;

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

          const payload = {
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
                .update({ revenue, pay_date, days_to_pmt, denied_claim })
                .eq("id", existing.id);
              if (error) throw error;
              stats.updated++;
            } else {
              stats.skipped++;
            }
          }
        } catch (err: any) {
          errors.push({ row: i + 2, message: err?.message ?? "Unknown error" });
        }
        setProgress(Math.round(((i + 1) / rows.length) * 100));
      }

      // One history row per company
      const companies = Object.keys(perCompany);
      if (companies.length > 0) {
        const errSlice = errors.length ? errors.slice(0, 100) : null;
        const historyRows = companies.map((c) => ({
          filename: file.name,
          company: c,
          uploaded_by: profile.id,
          rows_processed: perCompany[c].processed,
          rows_inserted: perCompany[c].inserted,
          rows_updated: perCompany[c].updated,
          rows_skipped: perCompany[c].skipped,
          unknown_cpt_count: perCompany[c].unknownCpt,
          errors: errSlice,
        }));
        await supabase.from("upload_history").insert(historyRows);
      }

      setSummary({ perCompany, errors });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      loadHistory();
      try { localStorage.setItem("tellyhealth:ai-autorun", String(Date.now())); } catch {}
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to process file");
    } finally {
      setProcessing(false);
    }
  }

  const canUpload = useMemo(() => !!file && !processing, [file, processing]);

  const summaryCompanies = summary ? Object.keys(summary.perCompany).sort() : [];
  const totalUnknownCpt = summary
    ? summaryCompanies.reduce((s, c) => s + summary.perCompany[c].unknownCpt, 0)
    : 0;

  return (
    <>
      <PageHeader title="Upload Claims" description="Drop an Excel export to ingest and deduplicate billing rows." />
      <div className="p-8 space-y-8">
        <Card className="p-6">
          <div className="grid md:grid-cols-[1fr_320px] gap-6">
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
              <div className="font-medium">
                {file ? file.name : "Drag & drop an Excel file here"}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : "or click to browse — .xlsx, .xls"}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Company is detected automatically from the <span className="font-medium text-foreground">Company</span> column in your file. Rows are grouped per company.
              </div>

              {processing && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Processing… {progress}%</div>
                  <Progress value={progress} />
                </div>
              )}

              <Button className="w-full" disabled={!canUpload} onClick={processFile}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {processing ? "Processing…" : "Upload & Process"}
              </Button>

              <p className="text-xs text-muted-foreground">
                Expected columns: {COLUMN_KEYS.join(", ")}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="px-6 py-4 border-b">
            <h2 className="font-semibold">Upload History</h2>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No uploads yet.</TableCell></TableRow>
              ) : history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.filename}</TableCell>
                  <TableCell>{h.company}</TableCell>
                  <TableCell>{new Date(h.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.rows_processed}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.rows_inserted}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.rows_updated}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.rows_skipped}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {h.unknown_cpt_count > 0 ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-700">{h.unknown_cpt_count}</Badge>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={!!summary} onOpenChange={(o) => !o && setSummary(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Complete</DialogTitle>
            <DialogDescription>
              Results grouped by company from the Company column.
            </DialogDescription>
          </DialogHeader>
          {summary && summaryCompanies.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              {summaryCompanies.map((c) => {
                const s = summary.perCompany[c];
                return (
                  <div key={c}>
                    <span className="font-medium text-foreground">{c}:</span>{" "}
                    {s.inserted} inserted, {s.updated} updated, {s.skipped} skipped
                  </div>
                );
              })}
            </div>
          )}
          {summary && totalUnknownCpt > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                {totalUnknownCpt} rows had unknown CPT codes — review in the CPT Reference Manager.
              </div>
            </div>
          )}
          {summary && summary.errors.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <div className="font-medium mb-1">{summary.errors.length} row error(s):</div>
              {summary.errors.slice(0, 50).map((e, idx) => (
                <div key={idx}>Row {e.row}: {e.message}</div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSummary(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
