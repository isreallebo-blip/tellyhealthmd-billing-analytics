import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw, CheckCircle2, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { SourceFilePreview } from "@/components/source-file-preview";
import { logPhiAccess } from "@/lib/phi-log";


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
  is_duplicate: boolean;
  duplicate_of_source_file_id: string | null;
};

function ReviewPage() {
  const { id } = Route.useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [sf, setSf] = useState<SourceFile | null>(null);
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsLoaded, setRowsLoaded] = useState(0);
  const [rowsTotal, setRowsTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState<"reparse" | "approve" | null>(null);

  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const ROW_SELECT = "id,row_index,source_row,data,confidence,validation_errors,edited,is_duplicate,duplicate_of_source_file_id";
  const SF_SELECT = "id,filename,status,row_count,detected_company,column_mapping,unmapped_columns,error";

  useEffect(() => {
    logPhiAccess({ action: "view_source_file", target_table: "source_files", target_id: id, source_file_id: id });
  }, [id]);

  useEffect(() => {
    let alive = true;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let rowsFetchInFlight = false;

    // 1) Load metadata first so the page paints immediately
    (async () => {
      try {
        const [{ data: file, error: fErr }, { data: fd }] = await Promise.all([
          supabase.from("source_files" as any).select(SF_SELECT).eq("id", id).maybeSingle(),
          supabase.from("field_definitions" as any).select("field_key,label,data_type,display_order").eq("is_active", true).order("display_order"),
        ]);
        if (!alive) return;
        if (fErr) throw fErr;
        setSf((file ?? null) as unknown as SourceFile);
        setDefs((fd ?? []) as unknown as FieldDef[]);
      } catch (e: any) {
        if (alive) toast.error(e?.message ?? "Failed to load file");
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();

    // 2) Stream rows in parallel pages, appending as they arrive
    async function loadRows() {
      if (rowsFetchInFlight) return;
      rowsFetchInFlight = true;
      setRowsLoading(true);
      setRowsLoaded(0);
      const PAGE = 1000;
      try {
        const { data: head, error: hErr, count } = await supabase
          .from("parsed_rows" as any)
          .select(ROW_SELECT, { count: "exact" })
          .eq("source_file_id", id)
          .order("row_index")
          .range(0, PAGE - 1);
        if (hErr) throw hErr;
        if (!alive) return;
        const headRows = (head ?? []) as unknown as ParsedRow[];
        const total = count ?? headRows.length;
        setRowsTotal(total);
        const acc: ParsedRow[] = new Array(total);
        headRows.forEach((r, i) => { acc[i] = r; });
        setRows(headRows.slice());
        setRowsLoaded(headRows.length);

        if (total <= PAGE) { setRowsLoading(false); return; }

        const ranges: Array<[number, number]> = [];
        for (let from = PAGE; from < total; from += PAGE) {
          ranges.push([from, Math.min(from + PAGE - 1, total - 1)]);
        }
        let cursor = 0;
        async function worker() {
          while (alive && cursor < ranges.length) {
            const my = cursor++;
            const [from, to] = ranges[my];
            const { data, error } = await supabase
              .from("parsed_rows" as any)
              .select(ROW_SELECT)
              .eq("source_file_id", id)
              .order("row_index")
              .range(from, to);
            if (error) throw error;
            if (!alive) return;
            const page = (data ?? []) as unknown as ParsedRow[];
            page.forEach((r, i) => { acc[from + i] = r; });
            setRowsLoaded((n) => n + page.length);
          }
        }
        await Promise.all(Array.from({ length: Math.min(4, ranges.length) }, worker));
        if (!alive) return;
        setRows(acc.filter(Boolean));
      } catch (e: any) {
        if (alive) toast.error(e?.message ?? "Failed to load parsed rows");
      } finally {
        rowsFetchInFlight = false;
        if (alive) setRowsLoading(false);
      }
    }
    loadRows();

    function scheduleRowsRefetch() {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => { refetchTimer = null; loadRows(); }, 800);
    }

    pollTimer = setInterval(() => {
      supabase.from("source_files" as any).select(SF_SELECT).eq("id", id).maybeSingle()
        .then(({ data }) => {
          if (!alive) return;
          const next = (data ?? null) as unknown as SourceFile | null;
          setSf(next);
          if (next && (next.status === "parsing" || next.status === "needs_review")) {
            scheduleRowsRefetch();
          }
        });
    }, 2500);

    const ch = supabase
      .channel(`review-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "source_files", filter: `id=eq.${id}` }, () => {
        supabase.from("source_files" as any).select(SF_SELECT).eq("id", id).maybeSingle()
          .then(({ data }) => { if (alive) setSf((data ?? null) as unknown as SourceFile); });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "parsed_rows", filter: `source_file_id=eq.${id}` }, scheduleRowsRefetch)
      .subscribe();
    return () => {
      alive = false;
      if (refetchTimer) clearTimeout(refetchTimer);
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(ch);
    };
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
      const dup = data?.duplicates_skipped ?? 0;
      toast.success(`Approved — ${data?.inserted ?? 0} rows added${dup ? `, ${dup} duplicate${dup === 1 ? "" : "s"} skipped` : ""}${data?.skipped ? `, ${data.skipped} invalid skipped` : ""}`);
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

  if (loadingMeta) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!sf) return <div className="p-8 text-muted-foreground">File not found.</div>;

  const lowConfRows = rows.filter((r) => Object.values(r.confidence).some((c) => c < 0.7) || Object.keys(r.validation_errors).length > 0).length;
  const dupRows = rows.filter((r) => r.is_duplicate).length;
  const displayRows = hideDuplicates ? rows.filter((r) => !r.is_duplicate) : rows;

  return (
    <>
      <PageHeader
        title={sf.filename}
        description={`${sf.row_count.toLocaleString()} rows · ${sf.detected_company ?? "no company detected"} · ${lowConfRows} need attention${dupRows ? ` · ${dupRows} duplicate${dupRows === 1 ? "" : "s"}` : ""}`}
        breadcrumbs={[{ label: "Files", to: "/files" }, { label: sf.filename }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/files"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link></Button>
            <Button variant="outline" onClick={reparse} disabled={busy !== null}>
              {busy === "reparse" || sf.status === "parsing" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Re-analyze
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
              <div className="text-sm flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">Unmapped columns ({sf.unmapped_columns.length})</div>
                  {profile?.role === "admin" && (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/admin/fields">Open Field Registry</Link>
                    </Button>
                  )}
                </div>
                <div className="text-muted-foreground mt-1">
                  These source columns don't match any registered field — their values are dropped. Add the header as a synonym to an existing field (or create a new field), then click <span className="font-medium text-foreground">Re-analyze</span>.
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

        <div className={`grid grid-cols-1 ${showOriginal ? "xl:grid-cols-2" : ""} gap-6`}>
          {showOriginal ? (
            <Card className="overflow-hidden flex flex-col" style={{ height: "70vh" }}>
              <div className="px-4 py-3 border-b text-xs text-muted-foreground flex items-center justify-between">
                <span className="font-medium text-foreground">Original file</span>
                <div className="flex items-center gap-2">
                  <span>read-only</span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowOriginal(false)}>
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Hide
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <SourceFilePreview sourceFileId={sf.id} filename={sf.filename} />
              </div>
            </Card>
          ) : (
            <div className="-mb-2 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowOriginal(true)}>
                <ChevronRight className="h-3.5 w-3.5 mr-1" /> Show original file
              </Button>
            </div>
          )}

          {rows.length > 0 ? (
            <Card className="overflow-hidden flex flex-col" style={{ height: "70vh" }}>
              <div className="px-4 py-3 border-b text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-medium text-foreground">Parsed rows</span>
                <span>
                  · showing {displayRows.length.toLocaleString()} of {sf.row_count.toLocaleString()} total
                  {rowsLoading && rowsTotal !== null && (
                    <span className="ml-1 inline-flex items-center gap-1 text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      loaded {rowsLoaded.toLocaleString()} / {rowsTotal.toLocaleString()}
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-400" /> low confidence</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-destructive" /> error</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-muted-foreground" /> duplicate</span>
                {dupRows > 0 && (
                  <Button
                    variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto"
                    onClick={() => setHideDuplicates((v) => !v)}
                  >
                    {hideDuplicates ? "Show" : "Hide"} duplicates ({dupRows})
                  </Button>
                )}
              </div>
              <VirtualizedParsedRows
                rows={displayRows}
                fields={visibleFields}
                onSaveCell={saveCell}
              />
            </Card>
          ) : (
            <Card className="p-8 text-sm text-muted-foreground flex items-center justify-center gap-2" style={{ height: "70vh" }}>
              {rowsLoading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Loading parsed rows…</>)
                : sf.status === "parsing" ? "Parsing…"
                : "No parsed rows yet."}
            </Card>
          )}
        </div>


      </div>
    </>
  );
}

// Virtualized parsed-rows grid — renders only the ~30 rows visible in the
// scroll viewport regardless of dataset size, so 10k+ rows stay snappy.
function VirtualizedParsedRows({
  rows, fields, onSaveCell,
}: {
  rows: ParsedRow[];
  fields: FieldDef[];
  onSaveCell: (rowId: string, field: string, value: any) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const colTemplate = `48px 36px ${fields.map(() => "minmax(140px, 1fr)").join(" ")}`;

  return (
    <div ref={parentRef} className="overflow-auto flex-1 min-h-0">
      <div style={{ minWidth: `${48 + 36 + fields.length * 140}px` }}>
        <div
          className="sticky top-0 z-10 bg-background border-b grid items-center text-xs text-muted-foreground font-medium"
          style={{ gridTemplateColumns: colTemplate }}
        >
          <div className="px-2 py-2 text-right">#</div>
          <div />
          {fields.map((d) => (
            <div key={d.field_key} className="px-2 py-2 whitespace-nowrap">{d.label}</div>
          ))}
        </div>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            return (
              <div
                key={r.id}
                className={[
                  "grid items-center border-b",
                  r.edited ? "bg-primary/5" : "",
                  r.is_duplicate ? "opacity-60 bg-muted/30" : "",
                ].join(" ")}
                style={{
                  gridTemplateColumns: colTemplate,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  height: `${vi.size}px`,
                }}
              >
                <div className="px-2 text-right text-xs text-muted-foreground tabular-nums">
                  {r.source_row ?? r.row_index + 2}
                </div>
                <div className="px-1">
                  {r.is_duplicate && (
                    <Badge
                      variant="outline"
                      className="text-[9px] font-medium px-1.5 py-0 h-5"
                      title={
                        r.duplicate_of_source_file_id
                          ? "Already exists in a previously approved file — will be skipped on Approve."
                          : "Duplicate of an earlier row in this same file — will be skipped on Approve."
                      }
                    >
                      DUP
                    </Badge>
                  )}
                </div>
                {fields.map((d) => {
                  const value = r.data?.[d.field_key] ?? "";
                  const conf = r.confidence?.[d.field_key] ?? 1;
                  const err = r.validation_errors?.[d.field_key];
                  const cls = err
                    ? "bg-destructive/10 border-destructive/40"
                    : conf < 0.7
                      ? "bg-amber-500/10 border-amber-500/40"
                      : "border-transparent";
                  return (
                    <div key={d.field_key} className="px-1">
                      <Input
                        // key includes the value so external refetches (during parsing) reset the input
                        key={`${r.id}-${d.field_key}-${String(value)}`}
                        defaultValue={value === null ? "" : String(value)}
                        onBlur={(e) => onSaveCell(r.id, d.field_key, e.target.value === "" ? null : e.target.value)}
                        className={`h-8 text-sm border ${cls}`}
                        title={err ?? (conf < 0.7 ? `Confidence ${(conf * 100).toFixed(0)}%` : undefined)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

