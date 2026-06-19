import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FileSpreadsheet, FileText, Upload, Eye, Loader2, CheckCircle2, AlertCircle, Clock, Sparkles, Trash2, Download, FileDown } from "lucide-react";
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
  const headers = Array.from(rows.reduce((s, r) => { Object.keys(r ?? {}).forEach(k => s.add(k)); return s; }, new Set<string>()));
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

function StatusBadge({ status }: { status: SourceFile["status"] }) {
  const map: Record<SourceFile["status"], { label: string; cls: string; icon: any }> = {
    queued:       { label: "Queued",       cls: "bg-muted text-muted-foreground", icon: Clock },
    parsing:      { label: "Parsing",      cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: Loader2 },
    needs_review: { label: "Needs Review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Eye },
    approved:     { label: "Approved",     cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
    failed:       { label: "Failed",       cls: "bg-destructive/15 text-destructive", icon: AlertCircle },
  };
  const { label, cls, icon: Icon } = map[status];
  return (
    <Badge variant="secondary" className={`${cls} gap-1 font-normal`}>
      <Icon className={`h-3 w-3 ${status === "parsing" ? "animate-spin" : ""}`} />
      {label}
    </Badge>
  );
}

function FilesPage() {
  const { profile } = useAuth();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function refresh() {
    const { data } = await supabase
      .from("source_files" as any)
      .select("id,filename,detected_company,status,row_count,size_bytes,uploaded_at,approved_at,error,kind")
      .order("uploaded_at", { ascending: false })
      .limit(200);
    setFiles((data ?? []) as unknown as SourceFile[]);
  }

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    (async () => { await refresh(); if (alive) setLoading(false); })();

    const ch = supabase
      .channel("source-files-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "source_files" }, () => {
        if (alive) refresh();
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [profile]);

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
      <div className="p-8">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : files.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  No uploads yet. <Link to="/upload" className="text-primary hover:underline">Upload your first file</Link>.
                </TableCell></TableRow>
              ) : files.map((f) => (
                <TableRow key={f.id} className="hover:bg-muted/40">
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