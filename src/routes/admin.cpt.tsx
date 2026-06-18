import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BillingTypeBadge, BILLING_TYPES, SERVICE_CATEGORIES } from "@/components/billing-badges";

export const Route = createFileRoute("/admin/cpt")({
  head: () => ({
    meta: [
      { title: "CPT Reference Manager — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Manage CPT codes and insurance-specific billing overrides." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    addCpt: typeof s.addCpt === "string" ? s.addCpt : undefined,
  }),
  component: () => (
    <AppShell adminOnly>
      <CptManager />
    </AppShell>
  ),
});

type Cpt = {
  cpt_code: string;
  description: string | null;
  service_category: string | null;
  billing_type: string | null;
};

type Override = {
  id: string;
  cpt_code: string;
  insurance_code: string;
  billing_type_override: string | null;
  note: string | null;
};

function CptManager() {
  const [codes, setCodes] = useState<Cpt[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [{ data: c }, { data: o }] = await Promise.all([
      supabase.from("cpt_reference").select("*").order("cpt_code"),
      supabase.from("cpt_insurance_overrides").select("*").order("cpt_code"),
    ]);
    setCodes((c ?? []) as Cpt[]);
    setOverrides((o ?? []) as Override[]);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return codes;
    return codes.filter(
      (c) =>
        c.cpt_code.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.service_category ?? "").toLowerCase().includes(q) ||
        (c.billing_type ?? "").toLowerCase().includes(q),
    );
  }, [codes, search]);

  async function updateCpt(code: string, patch: Partial<Cpt>) {
    setCodes((prev) => prev.map((c) => (c.cpt_code === code ? { ...c, ...patch } : c)));
    const { error } = await supabase.from("cpt_reference").update(patch).eq("cpt_code", code);
    if (error) {
      toast.error(error.message);
      loadAll();
    }
  }

  async function deleteCpt(code: string) {
    if (!confirm(`Delete CPT ${code}?`)) return;
    const { error } = await supabase.from("cpt_reference").delete().eq("cpt_code", code);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    loadAll();
  }

  return (
    <>
      <PageHeader
        title="CPT Reference"
        description="Maintain CPT codes, billing types, and insurance-specific overrides."
        actions={<AddCptDialog onCreated={loadAll} />}
      />


      <div className="p-8 space-y-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>CPT codes</CardTitle>
            <div className="relative w-72">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search code, description, type…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">CPT</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-44">Service category</TableHead>
                  <TableHead className="w-44">Billing type</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No CPT codes match.</TableCell></TableRow>
                ) : (
                  filtered.map((c) => (
                    <TableRow key={c.cpt_code}>
                      <TableCell><code className="text-xs font-semibold">{c.cpt_code}</code></TableCell>
                      <TableCell className="text-sm">{c.description}</TableCell>
                      <TableCell>
                        <Select
                          value={c.service_category ?? undefined}
                          onValueChange={(v) => updateCpt(c.cpt_code, { service_category: v })}
                        >
                          <SelectTrigger className="h-8 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            {SERVICE_CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={c.billing_type ?? undefined}
                          onValueChange={(v) => updateCpt(c.cpt_code, { billing_type: v })}
                        >
                          <SelectTrigger className="h-8 w-full">
                            <SelectValue placeholder="—">
                              <BillingTypeBadge type={c.billing_type} />
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => deleteCpt(c.cpt_code)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <OverridesSection
          overrides={overrides}
          codes={codes}
          onChange={loadAll}
        />
      </div>
    </>
  );
}

function AddCptDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState<string>("Visit");
  const [type, setType] = useState<string>("Primary");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!code.trim()) return toast.error("CPT code is required");
    setBusy(true);
    const { error } = await supabase.from("cpt_reference").insert({
      cpt_code: code.trim(),
      description: desc.trim() || null,
      service_category: cat,
      billing_type: type,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("CPT code added");
    setOpen(false);
    setCode(""); setDesc(""); setCat("Visit"); setType("Primary");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" /> Add CPT code</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add CPT code</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>CPT code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 99213" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Service category</Label>
              <Select value={cat} onValueChange={setCat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Billing type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OverridesSection({
  overrides,
  codes,
  onChange,
}: {
  overrides: Override[];
  codes: Cpt[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<Override | null>(null);
  const [open, setOpen] = useState(false);

  async function remove(id: string) {
    if (!confirm("Delete this override?")) return;
    const { error } = await supabase.from("cpt_insurance_overrides").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    onChange();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Insurance-Specific Overrides</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Override the billing type for a CPT when billed under a specific insurance.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Override
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">CPT Code</TableHead>
              <TableHead className="w-40">Insurance Code</TableHead>
              <TableHead className="w-44">Override Billing Type</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-36 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {overrides.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No overrides yet.</TableCell></TableRow>
            ) : overrides.map((o) => (
              <TableRow key={o.id}>
                <TableCell><code className="text-xs font-semibold">{o.cpt_code}</code></TableCell>
                <TableCell className="text-sm">{o.insurance_code}</TableCell>
                <TableCell><BillingTypeBadge type={o.billing_type_override} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{o.note}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(o); setOpen(true); }}>Edit</Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(o.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <OverrideDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        codes={codes}
        onSaved={onChange}
      />
    </Card>
  );
}

function OverrideDialog({
  open, onOpenChange, editing, codes, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Override | null;
  codes: Cpt[];
  onSaved: () => void;
}) {
  const [cpt, setCpt] = useState("");
  const [ins, setIns] = useState("");
  const [type, setType] = useState<string>("Primary");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      setCpt(editing.cpt_code);
      setIns(editing.insurance_code);
      setType(editing.billing_type_override ?? "Primary");
      setNote(editing.note ?? "");
    } else {
      setCpt(""); setIns(""); setType("Primary"); setNote("");
    }
  }, [editing, open]);

  async function save() {
    if (!cpt || !ins) return toast.error("CPT and insurance code are required");
    setBusy(true);
    const payload = { cpt_code: cpt, insurance_code: ins, billing_type_override: type, note: note || null };
    const { error } = editing
      ? await supabase.from("cpt_insurance_overrides").update(payload).eq("id", editing.id)
      : await supabase.from("cpt_insurance_overrides").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Override updated" : "Override added");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit override" : "Add insurance override"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>CPT code</Label>
            <Select value={cpt} onValueChange={setCpt}>
              <SelectTrigger><SelectValue placeholder="Select CPT" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {codes.map((c) => (
                  <SelectItem key={c.cpt_code} value={c.cpt_code}>
                    {c.cpt_code} — {c.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Insurance code</Label>
            <Input value={ins} onChange={(e) => setIns(e.target.value)} placeholder="e.g. MEDICARE" />
          </div>
          <div>
            <Label>Override billing type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
