import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { logPhiAccess } from "@/lib/phi-log";

export const Route = createFileRoute("/exports")({
  head: () => ({
    meta: [
      { title: "Exports — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Asynchronous claim exports — download CSV snapshots of filtered claim data." },
    ],
  }),
  component: () => (
    <AppShell>
      <ExportsPage />
    </AppShell>
  ),
});

type Job = {
  id: string;
  name: string | null;
  status: string;
  filters: any;
  row_count: number | null;
  filename: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

function ExportsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    company: "",
    insurance: "",
    provider: "",
    date_from: "",
    date_to: "",
  });

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("export_jobs" as any)
      .select("id,name,status,filters,row_count,filename,error,created_at,completed_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    setJobs((data ?? []) as unknown as Job[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("export-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "export_jobs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function createJob() {
    setCreating(true);
    try {
      const filters: any = {};
      if (form.company)   filters.companies  = [form.company];
      if (form.insurance) filters.insurances = [form.insurance];
      if (form.provider)  filters.providers  = [form.provider];
      if (form.date_from) filters.date_from  = form.date_from;
      if (form.date_to)   filters.date_to    = form.date_to;

      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const url = import.meta.env.VITE_SUPABASE_URL as string;
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const r = await fetch(`${url}/functions/v1/run-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey },
        body: JSON.stringify({ name: form.name || null, filters }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(text || `Failed (${r.status})`);
      toast.success("Export queued");
      setForm({ name: "", company: "", insurance: "", provider: "", date_from: "", date_to: "" });
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start export");
    } finally {
      setCreating(false);
    }
  }

  async function downloadJob(j: Job) {
    const { data, error } = await supabase
      .from("export_jobs" as any).select("file_bytes,filename").eq("id", j.id).maybeSingle();
    if (error || !data) { toast.error(error?.message ?? "Download failed"); return; }
    const raw: any = (data as any).file_bytes;
    // Supabase returns bytea as hex string (\x...) or base64 depending on client
    let bytes: Uint8Array;
    if (raw instanceof Uint8Array) bytes = raw;
    else if (typeof raw === "string" && raw.startsWith("\\x")) {
      const hex = raw.slice(2);
      bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    } else if (typeof raw === "string") {
      const bin = atob(raw);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      toast.error("Unsupported file payload");
      return;
    }
    const blob = new Blob([bytes as BlobPart], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (data as any).filename ?? `export-${j.id}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    logPhiAccess({ action: "export_download", target_table: "export_jobs", target_id: j.id });
  }

  async function removeJob(id: string) {
    if (!confirm("Delete this export?")) return;
    const { error } = await supabase.from("export_jobs" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  }

  return (
    <>
      <PageHeader
        title="Exports"
        description="Generate CSV snapshots of filtered claim data. Exports run in the background and are logged to the access audit."
        actions={<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>}
      />
      <div className="p-8 space-y-6">
        <Card className="p-5">
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Name (optional)"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q1 2026 - Aetna" /></Field>
            <Field label="Company"><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Insurance"><Input value={form.insurance} onChange={(e) => setForm({ ...form, insurance: e.target.value })} /></Field>
            <Field label="Provider"><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></Field>
            <Field label="DOS from"><Input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></Field>
            <Field label="DOS to"><Input type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={createJob} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Start export
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
              {!loading && jobs.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No exports yet.</TableCell></TableRow>
              )}
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="font-medium">{j.name ?? <span className="text-muted-foreground">Untitled</span>}</TableCell>
                  <TableCell>
                    {j.status === "done" && <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700">done</Badge>}
                    {j.status === "running" && <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />running</Badge>}
                    {j.status === "queued" && <Badge variant="outline">queued</Badge>}
                    {j.status === "failed" && <Badge variant="destructive" title={j.error ?? ""}>failed</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{j.row_count?.toLocaleString() ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{new Date(j.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {j.status === "done" && (
                      <Button size="sm" variant="outline" onClick={() => downloadJob(j)}>
                        <Download className="h-3.5 w-3.5 mr-1.5" />Download
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="ml-1 h-8 w-8" onClick={() => removeJob(j.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="text-xs text-muted-foreground">
          Tip: every download is recorded in the PHI access log. <Link to="/admin/users" className="underline">Admins</Link> can review the audit trail.
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
