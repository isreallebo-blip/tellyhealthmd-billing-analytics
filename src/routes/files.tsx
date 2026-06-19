import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, FileText, Upload, Eye, Loader2, CheckCircle2, AlertCircle, Clock, Sparkles } from "lucide-react";

export const Route = createFileRoute("/files")({
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

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    async function load() {
      const { data } = await supabase
        .from("source_files" as any)
        .select("id,filename,detected_company,status,row_count,size_bytes,uploaded_at,approved_at,error,kind")
        .order("uploaded_at", { ascending: false })
        .limit(200);
      if (!alive) return;
      setFiles((data ?? []) as unknown as SourceFile[]);
      setLoading(false);
    }
    load();

    const ch = supabase
      .channel("source-files-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "source_files" }, (payload) => {
        const row = (payload.new ?? payload.old) as SourceFile;
        setFiles((prev) => {
          const map = new Map(prev.map((f) => [f.id, f]));
          if (payload.eventType === "DELETE") map.delete(row.id);
          else map.set(row.id, row);
          return Array.from(map.values()).sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
        });
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [profile]);

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
                <TableHead className="w-24"></TableHead>
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
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate max-w-[280px]">{f.filename}</span>
                    </Link>
                    {f.error && <div className="text-xs text-destructive mt-0.5">{f.error}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{f.detected_company ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><StatusBadge status={f.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{f.row_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{(f.size_bytes / 1024).toFixed(1)} KB</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(f.uploaded_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/files/$id" params={{ id: f.id }}>Review</Link>
                    </Button>
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
