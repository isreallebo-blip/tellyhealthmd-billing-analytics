import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Play, Loader2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/alerts")({
  head: () => ({
    meta: [
      { title: "Alert Rules — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Configure automated alerts on claim activity." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <Page />
    </AppShell>
  ),
});

const RULE_TYPES = [
  { value: "unpaid_over_days", label: "Unpaid claims past N days (per insurance)" },
  { value: "denial_rate",       label: "High denial rate (per insurance)" },
  { value: "large_balance",     label: "Provider with stacked unpaid claims" },
  { value: "no_revenue_days",   label: "No payments recorded in N days" },
] as const;

type RuleType = typeof RULE_TYPES[number]["value"];
type Severity = "info" | "warning" | "critical";

type Rule = {
  id: string;
  name: string;
  description: string | null;
  rule_type: RuleType;
  severity: Severity;
  config: any;
  is_active: boolean;
  last_evaluated_at: string | null;
};

const blank: Omit<Rule, "id" | "last_evaluated_at"> = {
  name: "",
  description: "",
  rule_type: "unpaid_over_days",
  severity: "warning",
  config: { threshold_days: 30, min_count: 5 },
  is_active: true,
};

function defaultConfig(t: RuleType): any {
  switch (t) {
    case "unpaid_over_days": return { threshold_days: 30, min_count: 5 };
    case "denial_rate":      return { threshold_pct: 15, lookback_days: 30, min_count: 10 };
    case "large_balance":    return { min_claims: 10 };
    case "no_revenue_days":  return { days: 7 };
  }
}

function Page() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("alert_rules" as any)
      .select("id,name,description,rule_type,severity,config,is_active,last_evaluated_at")
      .order("name");
    if (error) toast.error(error.message);
    setRules((data ?? []) as unknown as Rule[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(blank);
    setOpen(true);
  }
  function openEdit(r: Rule) {
    setEditing(r);
    setForm({
      name: r.name, description: r.description ?? "", rule_type: r.rule_type,
      severity: r.severity, config: r.config ?? {}, is_active: r.is_active,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const payload = { ...form, name: form.name.trim(), description: form.description?.trim() || null };
    const { error } = editing
      ? await supabase.from("alert_rules" as any).update(payload).eq("id", editing.id)
      : await supabase.from("alert_rules" as any).insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Updated" : "Created");
    setOpen(false); load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this rule?")) return;
    const { error } = await supabase.from("alert_rules" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  async function toggle(r: Rule) {
    const { error } = await supabase.from("alert_rules" as any).update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) toast.error(error.message); else load();
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const url = import.meta.env.VITE_SUPABASE_URL as string;
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const r = await fetch(`${url}/functions/v1/evaluate-alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey },
        body: "{}",
      });
      const text = await r.text();
      let data: any = null; try { data = JSON.parse(text); } catch {}
      if (!r.ok) throw new Error(data?.error ?? text);
      toast.success(`Evaluated — ${data?.created ?? 0} new notification${data?.created === 1 ? "" : "s"}`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setRunning(false); }
  }

  return (
    <>
      <PageHeader
        title="Alert Rules"
        description="Each active rule is evaluated against current claim data and fans out notifications to admins and analysts."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={runNow} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run now
            </Button>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />New rule</Button>
          </div>
        }
      />
      <div className="p-8 space-y-4">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Config</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
              {!loading && rules.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No rules yet. Add one to start receiving alerts.</TableCell></TableRow>
              )}
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{RULE_TYPES.find((t) => t.value === r.rule_type)?.label ?? r.rule_type}</TableCell>
                  <TableCell><Badge variant="outline">{r.severity}</Badge></TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{JSON.stringify(r.config)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.last_evaluated_at ? new Date(r.last_evaluated_at).toLocaleString() : "—"}</TableCell>
                  <TableCell><Switch checked={r.is_active} onCheckedChange={() => toggle(r)} /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit rule" : "New rule"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.rule_type} onValueChange={(v: RuleType) => setForm({ ...form, rule_type: v, config: defaultConfig(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v: Severity) => setForm({ ...form, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="warning">warning</SelectItem>
                    <SelectItem value="critical">critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ConfigEditor type={form.rule_type} config={form.config} onChange={(c) => setForm({ ...form, config: c })} />

            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm">Active</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-2" />Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfigEditor({ type, config, onChange }: { type: RuleType; config: any; onChange: (c: any) => void }) {
  const set = (k: string, v: any) => onChange({ ...(config ?? {}), [k]: v });
  if (type === "unpaid_over_days") return (
    <div className="grid grid-cols-2 gap-3">
      <Num label="Threshold days" value={config?.threshold_days ?? 30} onChange={(v) => set("threshold_days", v)} />
      <Num label="Minimum claims" value={config?.min_count ?? 5} onChange={(v) => set("min_count", v)} />
    </div>
  );
  if (type === "denial_rate") return (
    <div className="grid grid-cols-3 gap-3">
      <Num label="Threshold %" value={config?.threshold_pct ?? 15} onChange={(v) => set("threshold_pct", v)} />
      <Num label="Lookback days" value={config?.lookback_days ?? 30} onChange={(v) => set("lookback_days", v)} />
      <Num label="Minimum claims" value={config?.min_count ?? 10} onChange={(v) => set("min_count", v)} />
    </div>
  );
  if (type === "large_balance") return (
    <Num label="Minimum unpaid claims per provider" value={config?.min_claims ?? 10} onChange={(v) => set("min_claims", v)} />
  );
  return <Num label="Quiet days before alert" value={config?.days ?? 7} onChange={(v) => set("days", v)} />;
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}
