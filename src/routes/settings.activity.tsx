import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Eye, CheckCircle2, AlertCircle, Loader2, Trash2, RefreshCw, FileText } from "lucide-react";

export const Route = createFileRoute("/settings/activity")({
  head: () => ({
    meta: [
      { title: "File Activity Log — TellyHealthMD" },
      { name: "description", content: "Audit trail of every file upload, parse, approval, and deletion." },
    ],
  }),
  component: () => (
    <AppShell>
      <ActivityLogPage />
    </AppShell>
  ),
});

type Entry = {
  id: string;
  source_file_id: string | null;
  filename: string;
  action: string;
  actor_email: string | null;
  detected_company: string | null;
  row_count: number | null;
  details: any;
  created_at: string;
};

const ICONS: Record<string, { icon: any; cls: string; label: string }> = {
  uploaded:     { icon: Upload,        cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300",         label: "Uploaded" },
  parsing:      { icon: Loader2,       cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300",            label: "Parsing" },
  needs_review: { icon: Eye,           cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",      label: "Needs Review" },
  approved:     { icon: CheckCircle2,  cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Approved" },
  failed:       { icon: AlertCircle,   cls: "bg-destructive/15 text-destructive",                       label: "Failed" },
  reparsed:     { icon: RefreshCw,     cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300",   label: "Re-parsed" },
  deleted:      { icon: Trash2,        cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300",         label: "Deleted" },
  queued:       { icon: FileText,      cls: "bg-muted text-muted-foreground",                          label: "Queued" },
};

function ActionBadge({ action }: { action: string }) {
  const meta = ICONS[action] ?? { icon: FileText, cls: "bg-muted text-muted-foreground", label: action };
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={`${meta.cls} gap-1 font-normal`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function ActivityLogPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    async function load() {
      const { data } = await supabase
        .from("file_activity_log" as any)
        .select("id,source_file_id,filename,action,actor_email,detected_company,row_count,details,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!alive) return;
      setRows((data ?? []) as unknown as Entry[]);
      setLoading(false);
    }
    load();
    const ch = supabase
      .channel("file-activity-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "file_activity_log" }, (payload) => {
        if (!alive) return;
        setRows((prev) => [payload.new as unknown as Entry, ...prev].slice(0, 500));
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [profile]);

  return (
    <>
      <PageHeader
        title="File Activity Log"
        description="Every upload, parse, approval, and deletion across all source files."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Settings", to: "/settings" }, { label: "Activity" }]}
      />
      <div className="p-4 md:p-8">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-40">Event</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  No activity yet. Upload a file to start the log.
                </TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/40">
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell><ActionBadge action={r.action} /></TableCell>
                  <TableCell className="font-medium">
                    {r.source_file_id && r.action !== "deleted" ? (
                      <Link to="/files/$id" params={{ id: r.source_file_id }} className="hover:text-primary truncate inline-block max-w-[320px] align-bottom">
                        {r.filename}
                      </Link>
                    ) : (
                      <span className="truncate inline-block max-w-[320px] align-bottom text-muted-foreground">{r.filename}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.detected_company ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.actor_email ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.row_count != null ? r.row_count.toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
