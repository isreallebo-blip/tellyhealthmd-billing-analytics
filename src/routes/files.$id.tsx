import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { SourceFilePreview } from "@/components/source-file-preview";

export const Route = createFileRoute("/files/$id")({
  component: () => (
    <AppShell>
      <ReviewPage />
    </AppShell>
  ),
});

type FieldDef = { field_key: string; label: string; data_type: string; display_order: number };
type SourceFile = {
  id: string; filename: string; status: string; row_count: number; detected_company: string | null;
  column_mapping: Record<string, { field: string | null; confidence: number }> | null;
  unmapped_columns: string[] | null;
  error: string | null;
};
type ParsedRow = {
  id: string; row_index: number; source_row: number | null;
  data: Record<string, any>;
  confidence: Record<string, number>;
  validation_errors: Record<string, string>;
  edited: boolean;
};

function ReviewPage() {
  const { id } = Route.useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [sf, setSf] = useState<SourceFile | null>(null);
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"reparse" | "approve" | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [{ data: file }, { data: defs }, { data: prs }] = await Promise.all([
        supabase.from("source_files" as any).select("*").eq("id", id).maybeSingle(),
        supabase.from("field_definitions" as any).select("field_key,label,data_type,display_order").eq("is_active", true).order("display_order"),
        supabase.from("parsed_rows" as any).select("id,row_index,source_row,data,confidence,validation_errors,edited").eq("source_file_id", id).order("row_index").limit(500),
      ]);
      if (!alive) return;
      setSf((file ?? null) as unknown as SourceFile);
      setDefs((defs ?? []) as unknown as FieldDef[]);
      setRows((prs ?? []) as unknown as ParsedRow[]);
      setLoading(false);
    }
    load();

    const ch = supabase
      .channel(`review-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "source_files", filter: `id=eq.${id}` }, (p) => {
        const r = (p.new ?? p.old) as SourceFile;
        setSf(r);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "parsed_rows", filter: `source_file_id=eq.${id}` }, () => {
        // Refresh page of rows on bulk changes
        supabase.from("parsed_rows" as any)
          .select("id,row_index,source_row,data,confidence,validation_errors,edited")
          .eq("source_file_id", id).order("row_index").limit(500)
          .then(({ data }) => { if (alive) setRows((data ?? []) as unknown as ParsedRow[]); });
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [id]);

  const visibleFields = useMemo(() => {
    if (!sf?.column_mapping) return defs;
    const mapped = new Set(Object.values(sf.column_mapping).map((m) => m.field).filter(Boolean) as string[]);
    return defs.filter((d) => mapped.has(d.field_key));
  }, [defs, sf]);

  async function reparse() {
    if (!sf) return;
    setBusy("reparse");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const r = await fetch(`${url}/functions/v1/reparse-source-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: key },
        body: JSON.stringify({ source_file_id: id }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(text || `Re-parse failed (${r.status})`);
      toast.success("Re-parsing in the background…");
    } catch (e: any) {
      toast.error(e?.message ?? "Re-parse failed");
    } finally { setBusy(null); }
  }

  async function approve() {
    if (!sf) return;
    setBusy("approve");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const r = await fetch(`${url}/functions/v1/approve-source-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: key },
        body: JSON.stringify({ source_file_id: id }),
      });
      const text = await r.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) throw new Error(data?.error ?? text ?? `Approve failed (${r.status})`);
      toast.success(`Approved — ${data?.inserted ?? 0} rows added to claims (${data?.skipped ?? 0} skipped)`);
      navigate({ to: "/files" });
    } catch (e: any) {
      toast.error(e?.message ?? "Approve failed");
    } finally { setBusy(null); }
  }

  async function saveCell(rowId: string, field: string, value: any) {
    const target = rows.find((r) => r.id === rowId);
    if (!target) return;
    const oldValue = target.data?.[field] ?? null;
    if (oldValue === value) return;

    const newData = { ...target.data, [field]: value };
    const newConfidence = { ...target.confidence, [field]: 1.0 }; // manual edit = confident
    const newErrors = { ...target.validation_errors }; delete newErrors[field];

    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, data: newData, confidence: newConfidence, validation_errors: newErrors, edited: true } : r));

    const { error } = await supabase.from("parsed_rows" as any).update({
      data: newData, confidence: newConfidence, validation_errors: newErrors,
      edited: true, edited_by: profile?.id, edited_at: new Date().toISOString(),
    }).eq("id", rowId);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }

    await supabase.from("parsed_row_edits" as any).insert({
      parsed_row_id: rowId, source_file_id: id, field_key: field,
      old_value: oldValue, new_value: value, edited_by: profile?.id,
    });
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!sf) return <div className="p-8 text-muted-foreground">File not found.</div>;

  const lowConfRows = rows.filter((r) => Object.values(r.confidence).some((c) => c < 0.7) || Object.keys(r.validation_errors).length > 0).length;

  return (
    <>
      <PageHeader
        title={sf.filename}
        description={`${sf.row_count.toLocaleString()} rows · ${sf.detected_company ?? "no company detected"} · ${lowConfRows} row${lowConfRows === 1 ? "" : "s"} need attention`}
        breadcrumbs={[{ label: "Files", to: "/files" }, { label: sf.filename }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/files"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link></Button>
            <Button variant="outline" onClick={reparse} disabled={busy !== null || sf.status === "parsing"}>
              {busy === "reparse" || sf.status === "parsing" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Re-parse
            </Button>
            <Button onClick={approve} disabled={busy !== null || sf.status !== "needs_review"}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Approve &amp; Publish
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        {sf.unmapped_columns && sf.unmapped_columns.length > 0 && (
          <Card className="p-4 border-amber-500/40 bg-amber-500/5">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="text-sm">
                <div className="font-medium">Unmapped columns ({sf.unmapped_columns.length})</div>
                <div className="text-muted-foreground mt-1">
                  These source columns don't match any field in the registry — values are not being captured. Add a synonym to <span className="font-mono">field_definitions</span> and re-parse:
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sf.unmapped_columns.map((c) => <Badge key={c} variant="outline" className="font-mono text-xs">{c}</Badge>)}
                </div>
              </div>
            </div>
          </Card>
        )}

        {sf.status === "parsing" && (
          <Card className="p-4 flex items-center gap-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Parsing in progress — this view will update automatically.
          </Card>
        )}

        {rows.length > 0 && (
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b text-xs text-muted-foreground flex items-center gap-3">
              <span>Showing first {rows.length.toLocaleString()} of {sf.row_count.toLocaleString()} rows</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-400" /> low confidence</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-destructive" /> validation error</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 text-right text-xs">#</TableHead>
                    {visibleFields.map((d) => <TableHead key={d.field_key} className="whitespace-nowrap">{d.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={r.edited ? "bg-primary/5" : ""}>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{(r.source_row ?? r.row_index + 2)}</TableCell>
                      {visibleFields.map((d) => {
                        const value = r.data?.[d.field_key] ?? "";
                        const conf = r.confidence?.[d.field_key] ?? 1;
                        const err = r.validation_errors?.[d.field_key];
                        const cls = err
                          ? "bg-destructive/10 border-destructive/40"
                          : conf < 0.7
                            ? "bg-amber-500/10 border-amber-500/40"
                            : "border-transparent";
                        return (
                          <TableCell key={d.field_key} className="p-1">
                            <Input
                              defaultValue={value === null ? "" : String(value)}
                              onBlur={(e) => saveCell(r.id, d.field_key, e.target.value === "" ? null : e.target.value)}
                              className={`h-8 text-sm border ${cls}`}
                              title={err ?? (conf < 0.7 ? `Confidence ${(conf * 100).toFixed(0)}%` : undefined)}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
