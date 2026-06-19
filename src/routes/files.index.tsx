import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FileSpreadsheet, FileText, Upload, Eye, Loader2, CheckCircle2, AlertCircle, Clock, Sparkles, Trash2, Download, FileDown, X, RotateCw } from "lucide-react";
import { toast } from "sonner";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return "";
  const headers: string[] = Array.from(rows.reduce((s: Set<string>, r) => { Object.keys(r ?? {}).forEach(k => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

export const Route = createFileRoute("/files/")({
  head: () => ({
    meta: [
      { title: "Files — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Uploaded source files with parsing status and review." },
    ],
  }),
  component: () => (
    <AppShell>
      <FilesPage />
    </AppShell>
  ),
});

type SourceFile = {
  id: string;
  filename: string;
  detected_company: string | null;
  status: "queued" | "parsing" | "needs_review" | "approved" | "failed";
  row_count: number;
  size_bytes: number;
  uploaded_at: string;
  approved_at: string | null;
  error: string | null;
  kind: "structured" | "unstructured";
};

function StatusBadge({ status, percent }: { status: SourceFile["status"]; percent?: number | null }) {
  const map: Record<SourceFile["status"], { label: string; cls: string; icon: any }> = {
    queued:       { label: "Queued",       cls: "bg-muted text-muted-foreground", icon: Clock },
    parsing:      { label: "Parsing",      cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: Loader2 },
    needs_review: { label: "Needs Review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Eye },
    approved:     { label: "Approved",     cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
    failed:       { label: "Failed",       cls: "bg-destructive/15 text-destructive", icon: AlertCircle },
  };
  const { label, cls, icon: Icon } = map[status];
  const showPct = status === "parsing" && typeof percent === "number" && isFinite(percent);
  return (
    <Badge variant="secondary" className={`${cls} gap-1 font-normal tabular-nums`}>
      <Icon className={`h-3 w-3 ${status === "parsing" ? "animate-spin" : ""}`} />
      {label}{showPct ? ` ${Math.min(99, Math.max(0, Math.round(percent!)))}%` : ""}
    </Badge>
  );
}

function FilesPage() {
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | "delete" | "export" | "download">(null);

  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && !allSelected;
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)));
  const clearSelection = () => setSelected(new Set());

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkBusy("delete");
    const { error } = await supabase.from("source_files" as any).delete().in("id", ids);
    setBulkBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length} file${ids.length === 1 ? "" : "s"}`);
    setFiles((prev) => prev.filter((x) => !selected.has(x.id)));
    clearSelection();
  }

  async function bulkExport() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkBusy("export");
    let exported = 0;
    for (const id of ids) {
      const f = files.find((x) => x.id === id);
      if (!f || f.row_count === 0) continue;
      const { data, error } = await supabase
        .from("parsed_rows" as any)
        .select("row_index,data,is_duplicate,validation_errors,edited")
        .eq("source_file_id", id)
        .order("row_index", { ascending: true });
      if (error || !data?.length) continue;
      const rows = (data as any[]).map((r) => ({ ...(r.data ?? {}), _row: r.row_index, _duplicate: r.is_duplicate, _edited: r.edited }));
      const csv = toCSV(rows);
      const base = f.filename.replace(/\.[^.]+$/, "");
      triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${base}-reviewed.csv`);
      exported++;
    }
    setBulkBusy(null);
    toast.success(`Exported ${exported} file${exported === 1 ? "" : "s"}`);
  }

  async function bulkDownloadOriginals() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkBusy("download");
    let n = 0;
    for (const id of ids) {
      const f = files.find((x) => x.id === id);
      if (!f) continue;
      const { data, error } = await (supabase as any).rpc("download_source_file", { _id: id });
      if (error || !data || !data.length) continue;
      const row = data[0];
      const raw = row.file_bytes as string | null;
      if (!raw) continue;
      const bytes = typeof raw === "string" && raw.startsWith("\\x") ? hexToBytes(raw) : hexToBytes(raw as string);
      triggerDownload(new Blob([bytes.buffer as ArrayBuffer], { type: row.mime || "application/octet-stream" }), f.filename);
      n++;
    }
    setBulkBusy(null);
    toast.success(`Downloaded ${n} original${n === 1 ? "" : "s"}`);
  }

  async function downloadOriginal(f: SourceFile) {
    setBusy(f.id + ":dl");
    const { data, error } = await (supabase as any).rpc("download_source_file", { _id: f.id });
    setBusy(null);
    if (error || !data || !data.length) return toast.error(error?.message ?? "Could not load file");
    const row = data[0];
    const raw = row.file_bytes as string | null;
    if (!raw) return toast.error("Original file bytes not stored");
    const bytes = hexToBytes(raw);
    triggerDownload(new Blob([bytes.buffer as ArrayBuffer], { type: row.mime || "application/octet-stream" }), f.filename);
  }

  async function retryParse(f: SourceFile) {
    setBusy(f.id + ":rp");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      // Optimistically flip status so UI shows it immediately
      await supabase.from("source_files" as any)
        .update({ status: "parsing", error: null })
        .eq("id", f.id);
      const r = await fetch(`${url}/functions/v1/reparse-source-file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: key,
        },
        body: JSON.stringify({ source_file_id: f.id }),
      });
      const text = await r.text();
      if (!r.ok) {
        let msg = text;
        try { msg = JSON.parse(text)?.error ?? text; } catch {}
        throw new Error(msg || `Retry failed (${r.status})`);
      }
      toast.success("Re-analyzing started");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function exportReviewed(f: SourceFile) {
    setBusy(f.id + ":ex");
    const { data, error } = await supabase
      .from("parsed_rows" as any)
      .select("row_index,data,is_duplicate,validation_errors,edited")
      .eq("source_file_id", f.id)
      .order("row_index", { ascending: true });
    setBusy(null);
    if (error) return toast.error(error.message);
    const rows = (data ?? []).map((r: any) => ({ ...(r.data ?? {}), _row: r.row_index, _duplicate: r.is_duplicate, _edited: r.edited }));
    if (!rows.length) return toast.error("No reviewed rows to export");
    const csv = toCSV(rows);
    const base = f.filename.replace(/\.[^.]+$/, "");
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${base}-reviewed.csv`);
    toast.success(`Exported ${rows.length} rows`);
  }

  async function refresh() {
    const { data, error } = await supabase
      .from("source_files" as any)
      .select("id,filename,detected_company,status,row_count,size_bytes,uploaded_at,approved_at,error,kind")
      .order("uploaded_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error(`Failed to load files: ${error.message}`);
      return;
    }
    setFiles((data ?? []) as unknown as SourceFile[]);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    let alive = true;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; if (alive) refresh(); }, 800);
    };
    (async () => {
      try { await refresh(); } finally { if (alive) setLoading(false); }
    })();

    const ch = supabase
      .channel("source-files-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "source_files" }, () => {
        scheduleRefresh();
      })
      .subscribe();
    return () => { alive = false; if (pending) clearTimeout(pending); supabase.removeChannel(ch); };
  }, [authLoading, user?.id]);



  async function deleteFile(f: SourceFile) {
    setDeleting(f.id);
    const { error } = await supabase.from("source_files" as any).delete().eq("id", f.id);
    setDeleting(null);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${f.filename}`);
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  }

  return (
    <>
      <PageHeader
        title="Files"
        description="Every upload, with parsing status. Click a file to review and approve its data."
        actions={
          <Button asChild>
            <Link to="/upload"><Upload className="h-4 w-4 mr-2" />Upload Files</Link>
          </Button>
        }
      />
      <div className="p-8 space-y-4">
        {selected.size > 0 && (
          <Card className="px-4 py-3 flex items-center justify-between gap-3 bg-muted/40">
            <div className="text-sm">
              <span className="font-medium">{selected.size}</span> file{selected.size === 1 ? "" : "s"} selected
              <Button variant="ghost" size="sm" className="ml-2 h-7" onClick={clearSelection}>
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!!bulkBusy} onClick={bulkDownloadOriginals}>
                {bulkBusy === "download" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
                Download originals
              </Button>
              <Button variant="outline" size="sm" disabled={!!bulkBusy} onClick={bulkExport}>
                {bulkBusy === "export" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />}
                Export CSVs
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={!!bulkBusy}>
                    {bulkBusy === "delete" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                    Delete selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selected.size} file{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The selected files and all of their parsed rows will be permanently removed. Approved files will also have their claims deleted from the dashboard.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete {selected.size}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Card>
        )}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all files"
                  />
                </TableHead>
                <TableHead>Filename</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="w-64 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : files.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No uploads yet. <Link to="/upload" className="text-primary hover:underline">Upload your first file</Link>.
                </TableCell></TableRow>
              ) : files.map((f) => (
                <TableRow key={f.id} className="hover:bg-muted/40" data-state={selected.has(f.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(f.id)}
                      onCheckedChange={() => toggleOne(f.id)}
                      aria-label={`Select ${f.filename}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link to="/files/$id" params={{ id: f.id }} className="flex items-center gap-2 font-medium hover:text-primary">
                      {f.kind === "unstructured"
                        ? <FileText className="h-4 w-4 text-violet-500" />
                        : <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}
                      <span className="truncate max-w-[280px]">{f.filename}</span>
                      {f.kind === "unstructured" && (
                        <Badge variant="secondary" className="text-[10px] gap-1 ml-1">
                          <Sparkles className="h-3 w-3" /> AI
                        </Badge>
                      )}
                    </Link>
                    {f.error && <div className="text-xs text-destructive mt-0.5">{f.error}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{f.detected_company ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><StatusBadge status={f.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{f.row_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{(f.size_bytes / 1024).toFixed(1)} KB</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(f.uploaded_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/files/$id" params={{ id: f.id }}>Review</Link>
                      </Button>
                      {(f.status === "failed" || f.status === "parsing" || f.status === "queued") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Retry parsing"
                          disabled={busy === f.id + ":rp"}
                          onClick={() => retryParse(f)}
                        >
                          {busy === f.id + ":rp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Download original file"
                        disabled={busy === f.id + ":dl"}
                        onClick={() => downloadOriginal(f)}
                      >
                        {busy === f.id + ":dl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={f.status === "approved" ? "Export reviewed data (CSV)" : "Export current parsed data (CSV)"}
                        disabled={busy === f.id + ":ex" || f.row_count === 0}
                        onClick={() => exportReviewed(f)}
                      >
                        {busy === f.id + ":ex" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={deleting === f.id}
                          >
                            {deleting === f.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                            <AlertDialogDescription>
                              <span className="font-medium text-foreground">{f.filename}</span> and all of its parsed rows will be permanently removed.
                              {f.status === "approved" && (
                                <span className="block mt-2 text-destructive">
                                  This file is approved — its claims will also be deleted from the dashboard.
                                </span>
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteFile(f)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );


}