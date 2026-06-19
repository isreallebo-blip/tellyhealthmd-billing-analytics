import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/fields")({
  head: () => ({
    meta: [
      { title: "Field Registry — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Manage parsed-field definitions, synonyms, and validation rules." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <FieldsAdmin />
    </AppShell>
  ),
});

const DATA_TYPES = ["text", "number", "date", "bool", "cpt", "icd10"] as const;
type DataType = typeof DATA_TYPES[number];

type FieldDef = {
  id: string;
  field_key: string;
  label: string;
  data_type: DataType;
  validation_regex: string | null;
  synonyms: string[];
  is_active: boolean;
  display_order: number;
};

const blank: Omit<FieldDef, "id"> = {
  field_key: "",
  label: "",
  data_type: "text",
  validation_regex: null,
  synonyms: [],
  is_active: true,
  display_order: 100,
};

function FieldsAdmin() {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<FieldDef | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("field_definitions" as any)
      .select("*")
      .order("display_order");
    if (error) toast.error(error.message);
    setDefs(((data ?? []) as unknown) as FieldDef[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return defs;
    return defs.filter((d) =>
      d.field_key.toLowerCase().includes(needle) ||
      d.label.toLowerCase().includes(needle) ||
      d.synonyms.some((s) => s.toLowerCase().includes(needle))
    );
  }, [defs, q]);

  async function toggleActive(d: FieldDef, next: boolean) {
    setDefs((prev) => prev.map((x) => x.id === d.id ? { ...x, is_active: next } : x));
    const { error } = await supabase
      .from("field_definitions" as any).update({ is_active: next }).eq("id", d.id);
    if (error) { toast.error(error.message); load(); }
  }

  async function remove(d: FieldDef) {
    if (!confirm(`Delete field "${d.field_key}"? Already-parsed rows keep their values, but new parses will ignore it.`)) return;
    const { error } = await supabase.from("field_definitions" as any).delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success("Field deleted");
    load();
  }

  return (
    <>
      <PageHeader
        title="Field Registry"
        description="Fields the parser recognises. Add synonyms so spreadsheet headers map automatically — then re-parse files that had unmapped columns."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Field Registry" }]}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add field
          </Button>
        }
      />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search key, label, synonym…"
              className="pl-8"
            />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} of {defs.length} fields
          </div>
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Synonyms</TableHead>
                <TableHead className="w-20">Active</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  No fields match.
                </TableCell></TableRow>
              ) : filtered.map((d) => (
                <TableRow key={d.id} className={!d.is_active ? "opacity-50" : ""}>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{d.display_order}</TableCell>
                  <TableCell className="font-mono text-xs">{d.field_key}</TableCell>
                  <TableCell className="font-medium">{d.label}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{d.data_type}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {d.synonyms.length === 0
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : d.synonyms.slice(0, 6).map((s) => (
                            <Badge key={s} variant="secondary" className="font-mono text-[10px]">{s}</Badge>
                          ))}
                      {d.synonyms.length > 6 && (
                        <span className="text-xs text-muted-foreground">+{d.synonyms.length - 6}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch checked={d.is_active} onCheckedChange={(v) => toggleActive(d, v)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(d)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {(editing || creating) && (
        <FieldEditor
          initial={editing ?? { id: "", ...blank, display_order: Math.max(...defs.map((d) => d.display_order), 0) + 10 }}
          isNew={creating}
          existingKeys={new Set(defs.map((d) => d.field_key))}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </>
  );
}

function FieldEditor({
  initial, isNew, existingKeys, onClose, onSaved,
}: {
  initial: FieldDef;
  isNew: boolean;
  existingKeys: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FieldDef>(initial);
  const [synInput, setSynInput] = useState("");
  const [saving, setSaving] = useState(false);

  function addSynonyms(raw: string) {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setForm((f) => {
      const set = new Set(f.synonyms);
      for (const p of parts) set.add(p);
      return { ...f, synonyms: Array.from(set) };
    });
    setSynInput("");
  }

  async function save() {
    const key = form.field_key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!key) return toast.error("Field key is required");
    if (!form.label.trim()) return toast.error("Label is required");
    if (isNew && existingKeys.has(key)) return toast.error(`Field key "${key}" already exists`);
    if (form.validation_regex) {
      try { new RegExp(form.validation_regex); }
      catch { return toast.error("Validation regex is invalid"); }
    }

    setSaving(true);
    const payload = {
      field_key: key,
      label: form.label.trim(),
      data_type: form.data_type,
      validation_regex: form.validation_regex?.trim() || null,
      synonyms: form.synonyms,
      is_active: form.is_active,
      display_order: form.display_order,
    };
    const q = isNew
      ? supabase.from("field_definitions" as any).insert(payload)
      : supabase.from("field_definitions" as any).update(payload).eq("id", form.id);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(isNew ? "Field added" : "Field updated");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add field" : `Edit "${initial.field_key}"`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Field key</Label>
              <Input
                value={form.field_key} disabled={!isNew}
                onChange={(e) => setForm({ ...form, field_key: e.target.value })}
                placeholder="cpt_modifier"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">Lowercase, snake_case. Immutable.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Display order</Label>
              <Input
                type="number" value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="CPT Modifier"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data type</Label>
              <Select value={form.data_type} onValueChange={(v: DataType) => setForm({ ...form, data_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Active</Label>
              <div className="h-9 flex items-center">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <span className="ml-2 text-sm text-muted-foreground">{form.is_active ? "Used by parser" : "Ignored"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Validation regex <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={form.validation_regex ?? ""}
              onChange={(e) => setForm({ ...form, validation_regex: e.target.value })}
              placeholder="^[0-9]{5}$"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Header synonyms</Label>
            <div className="flex gap-2">
              <Input
                value={synInput}
                onChange={(e) => setSynInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addSynonyms(synInput);
                  }
                }}
                placeholder="e.g. Procedure Code, proc_code"
              />
              <Button type="button" variant="outline" onClick={() => addSynonyms(synInput)}>Add</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Enter, comma, or newline to add. Case-insensitive — punctuation and whitespace are normalised at match time.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1 min-h-[2rem]">
              {form.synonyms.length === 0 && <span className="text-xs text-muted-foreground">No synonyms yet.</span>}
              {form.synonyms.map((s) => (
                <Badge key={s} variant="secondary" className="font-mono text-[11px] gap-1">
                  {s}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, synonyms: f.synonyms.filter((x) => x !== s) }))}
                    className="hover:text-destructive"
                    aria-label={`Remove ${s}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isNew ? "Add field" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
