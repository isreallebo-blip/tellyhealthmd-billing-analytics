import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Loader2, Search, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/templates")({
  head: () => ({
    meta: [
      { title: "Mapping Templates — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Reusable column-mapping presets that auto-apply to matching uploads." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <TemplatesAdmin />
    </AppShell>
  ),
});

type Template = {
  id: string;
  name: string;
  match_company: string | null;
  match_filename_pattern: string | null;
  mapping: Record<string, string>;
  is_active: boolean;
  priority: number;
};

const blank: Omit<Template, "id"> = {
  name: "",
  match_company: "",
  match_filename_pattern: "",
  mapping: {},
  is_active: true,
  priority: 0,
};

function TemplatesAdmin() {
  const [items, setItems] = useState<Template[]>([]);
  const [fields, setFields] = useState<{ field_key: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<Omit<Template, "id">>(blank);
  const [mappingText, setMappingText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: t }, { data: f }] = await Promise.all([
      supabase.from("mapping_templates" as any).select("*").order("priority", { ascending: false }).order("name"),
      supabase.from("field_definitions" as any).select("field_key,label").eq("is_active", true).order("display_order"),
    ]);
    setItems((t ?? []) as unknown as Template[]);
    setFields((f ?? []) as unknown as { field_key: string; label: string }[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.match_company ?? "").toLowerCase().includes(q) ||
      (t.match_filename_pattern ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  function openNew() {
    setEditing(null);
    setForm(blank);
    setMappingText("");
    setOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setForm({
      name: t.name,
      match_company: t.match_company ?? "",
      match_filename_pattern: t.match_filename_pattern ?? "",
      mapping: t.mapping ?? {},
      is_active: t.is_active,
      priority: t.priority,
    });
    setMappingText(
      Object.entries(t.mapping ?? {}).map(([h, f]) => `${h} = ${f}`).join("\n"),
    );
    setOpen(true);
  }

  function parseMapping(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(.+?)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const mapping = parseMapping(mappingText);
    if (Object.keys(mapping).length === 0) { toast.error("Add at least one header → field mapping"); return; }
    const validKeys = new Set(fields.map((f) => f.field_key));
    const invalid = Object.values(mapping).filter((k) => !validKeys.has(k));
    if (invalid.length) { toast.error(`Unknown fields: ${invalid.join(", ")}`); return; }

    const payload = {
      name: form.name.trim(),
      match_company: form.match_company?.trim() || null,
      match_filename_pattern: form.match_filename_pattern?.trim() || null,
      mapping,
      is_active: form.is_active,
      priority: form.priority,
    };
    const { error } = editing
      ? await supabase.from("mapping_templates" as any).update(payload).eq("id", editing.id)
      : await supabase.from("mapping_templates" as any).insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Template updated" : "Template created");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this template?")) return;
    const { error } = await supabase.from("mapping_templates" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  }

  async function toggleActive(t: Template) {
    const { error } = await supabase.from("mapping_templates" as any).update({ is_active: !t.is_active }).eq("id", t.id);
    if (error) toast.error(error.message); else load();
  }

  return (
    <>
      <PageHeader
        title="Mapping Templates"
        description="Save column-to-field presets per source. Templates auto-apply when an upload matches by company or filename."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />New template</Button>}
      />
      <div className="p-8 space-y-4">
        <div className="relative max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" className="pl-9" />
        </div>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Matches</TableHead>
                <TableHead className="text-right">Mappings</TableHead>
                <TableHead className="text-right">Priority</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No templates yet.</TableCell></TableRow>
              )}
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-sm">
                    {t.match_company && <Badge variant="outline" className="mr-1">company = {t.match_company}</Badge>}
                    {t.match_filename_pattern && <Badge variant="outline">file ~ {t.match_filename_pattern}</Badge>}
                    {!t.match_company && !t.match_filename_pattern && <span className="text-muted-foreground">— manual —</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Object.keys(t.mapping ?? {}).length}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.priority}</TableCell>
                  <TableCell><Switch checked={t.is_active} onCheckedChange={() => toggleActive(t)} /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="text-xs text-muted-foreground">
          Available field keys: {fields.map((f) => f.field_key).join(", ")}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Priority</Label>
                <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Match company (exact, case-insensitive)</Label>
                <Input value={form.match_company ?? ""} onChange={(e) => setForm({ ...form, match_company: e.target.value })} />
              </div>
              <div>
                <Label>Match filename (regex)</Label>
                <Input value={form.match_filename_pattern ?? ""} onChange={(e) => setForm({ ...form, match_filename_pattern: e.target.value })} placeholder="e.g. ^Aetna_.*\.xlsx$" />
              </div>
            </div>
            <div>
              <Label>Mapping (one per line: <code>Source Header = field_key</code>)</Label>
              <textarea
                value={mappingText}
                onChange={(e) => setMappingText(e.target.value)}
                rows={10}
                className="w-full font-mono text-sm rounded-md border bg-background p-2 mt-1"
                placeholder={"Patient Name = patient\nDate of Service = dos\nProcedure = cpt"}
              />
            </div>
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
