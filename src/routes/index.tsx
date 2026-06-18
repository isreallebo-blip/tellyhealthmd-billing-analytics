import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  FileText, DollarSign, AlertTriangle, Clock, CalendarIcon, Download,
  TrendingUp, CheckCircle2, XCircle, Percent, Layers,
} from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/multi-select";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Claims, revenue, and denial analytics across companies." },
    ],
  }),
  component: () => (
    <AppShell>
      <Dashboard />
    </AppShell>
  ),
});

type Claim = {
  id: string;
  company: string;
  pt_name: string | null;
  pri_ins: string | null;
  prov_name: string | null;
  dos: string | null;
  cpt: string | null;
  revenue: number | null;
  days_to_pmt: number | null;
  pay_date: string | null;
  denied_claim: boolean | null;
  acct: string | null;
  service_category: string | null;
  is_primary_billable: boolean | null;
};

type CptRef = { cpt_code: string; description: string | null; service_category: string | null; billing_type: string | null };

const fmtUSD = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const safe = (s: string | null | undefined) => (s ?? "—").toString();

function unpaidColor(pct: number) {
  if (pct < 30) return "text-emerald-600";
  if (pct < 60) return "text-amber-600";
  return "text-red-600";
}

function Dashboard() {
  const { profile } = useAuth();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [cptRef, setCptRef] = useState<Record<string, CptRef>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [companies, setCompanies] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [insurances, setInsurances] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // Threshold
  const [threshold, setThreshold] = useState<number>(30);
  const [customThreshold, setCustomThreshold] = useState<string>("");

  useEffect(() => {
    if (!profile) return;
    (async () => {
      setLoading(true);
      const [{ data: rows }, { data: refs }, { data: setting }] = await Promise.all([
        supabase.from("claims_raw").select(
          "id,company,pt_name,pri_ins,prov_name,dos,cpt,revenue,days_to_pmt,pay_date,denied_claim,acct,service_category,is_primary_billable"
        ).limit(50000),
        supabase.from("cpt_reference").select("cpt_code,description,service_category,billing_type"),
        supabase.from("alert_settings").select("threshold_days").eq("user_id", profile.id).maybeSingle(),
      ]);
      setClaims((rows ?? []) as Claim[]);
      const map: Record<string, CptRef> = {};
      (refs ?? []).forEach((r: any) => { map[String(r.cpt_code).toUpperCase()] = r; });
      setCptRef(map);
      if (setting?.threshold_days) setThreshold(setting.threshold_days);
      setLoading(false);
    })();
  }, [profile]);

  async function saveThreshold(days: number) {
    setThreshold(days);
    if (!profile) return;
    await supabase.from("alert_settings").upsert(
      { user_id: profile.id, threshold_days: days, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  }

  // Filter option lists
  const allCompanies = useMemo(() => uniq(claims.map((c) => c.company)), [claims]);
  const allProviders = useMemo(() => uniq(claims.map((c) => c.prov_name)), [claims]);
  const allInsurances = useMemo(() => uniq(claims.map((c) => c.pri_ins)), [claims]);
  const allCategories = useMemo(
    () => uniq([...claims.map((c) => c.service_category), "Visit", "RPM", "CCM", "CGM", "Home Visit"]),
    [claims]
  );

  // Apply filters
  const filtered = useMemo(() => {
    return claims.filter((c) => {
      if (companies.length && !companies.includes(c.company)) return false;
      if (providers.length && (!c.prov_name || !providers.includes(c.prov_name))) return false;
      if (insurances.length && (!c.pri_ins || !insurances.includes(c.pri_ins))) return false;
      if (categories.length && (!c.service_category || !categories.includes(c.service_category))) return false;
      if (dateFrom && (!c.dos || c.dos < format(dateFrom, "yyyy-MM-dd"))) return false;
      if (dateTo && (!c.dos || c.dos > format(dateTo, "yyyy-MM-dd"))) return false;
      return true;
    });
  }, [claims, companies, providers, insurances, categories, dateFrom, dateTo]);

  const kpis = useMemo(() => computeKpis(filtered, threshold), [filtered, threshold]);

  return (
    <>
      <PageHeader title="Analytics Dashboard" description="Filter, slice, and export billing performance." />
      <div className="p-6 lg:p-8 space-y-6">
        {/* Sticky Filters */}
        <Card className="sticky top-0 z-20 shadow-sm">
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <MultiSelect label="Company" options={allCompanies} values={companies} onChange={setCompanies} placeholder="All companies" />
            <MultiSelect label="Provider" options={allProviders} values={providers} onChange={setProviders} placeholder="All providers" />
            <MultiSelect label="Insurance" options={allInsurances} values={insurances} onChange={setInsurances} placeholder="All insurances" />
            <MultiSelect label="Service Category" options={allCategories} values={categories} onChange={setCategories} placeholder="All categories" />
            <DateRange label="DOS From" date={dateFrom} onChange={setDateFrom} />
            <DateRange label="DOS To" date={dateTo} onChange={setDateTo} />
            <div className="col-span-2 md:col-span-3 xl:col-span-6 flex flex-wrap items-center gap-3 pt-2 border-t">
              <Label className="text-xs font-medium text-muted-foreground">Alert Threshold</Label>
              {[30, 60, 90].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={threshold === d ? "default" : "outline"}
                  onClick={() => saveThreshold(d)}
                >
                  {d} days
                </Button>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Custom"
                  className="w-24 h-9"
                  value={customThreshold}
                  onChange={(e) => setCustomThreshold(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const n = parseInt(customThreshold);
                    if (n > 0) saveThreshold(n);
                  }}
                >
                  Apply
                </Button>
              </div>
              <div className="ml-auto text-xs text-muted-foreground">
                {loading ? "Loading…" : `${filtered.length.toLocaleString()} claim lines in view`}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi label="Total Claims" value={kpis.totalClaims.toLocaleString()} icon={Layers} />
          <Kpi label="Total Claim Lines" value={kpis.totalLines.toLocaleString()} icon={FileText} />
          <Kpi label="Paid Claims" value={kpis.paid.toLocaleString()} icon={CheckCircle2} tone="positive" />
          <Kpi label="Unpaid Claims" value={kpis.unpaid.toLocaleString()} icon={XCircle} tone="negative" />
          <Kpi
            label="Unpaid Rate"
            value={fmtPct(kpis.unpaidPct)}
            icon={Percent}
            valueClass={unpaidColor(kpis.unpaidPct)}
          />
          <Kpi label="Revenue Collected" value={fmtUSD(kpis.revenue)} icon={DollarSign} tone="positive" />
          <Kpi label="Avg Revenue / Paid" value={fmtUSD(kpis.avgRevPaid)} icon={TrendingUp} />
          <Kpi label="Avg Days to Payment" value={kpis.avgDays.toFixed(1)} icon={Clock} />
          <Kpi
            label={`Past ${threshold}d Threshold`}
            value={kpis.pastThreshold.toLocaleString()}
            icon={AlertTriangle}
            tone={kpis.pastThreshold > 0 ? "negative" : undefined}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="insights" className="w-full">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
            <TabsTrigger value="insurance">By Insurance</TabsTrigger>
            <TabsTrigger value="provider">By Provider</TabsTrigger>
            <TabsTrigger value="cpt">By CPT</TabsTrigger>
            <TabsTrigger value="month">By Month</TabsTrigger>
            <TabsTrigger value="category">By Service Category</TabsTrigger>
            <TabsTrigger value="cross">Cross Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="insights"><AiInsightsPanel autoRunSignal={useAutoRunSignal()} /></TabsContent>
          <TabsContent value="insurance"><GroupTab data={filtered} groupKey="pri_ins" groupLabel="Insurance" threshold={threshold} /></TabsContent>
          <TabsContent value="provider"><GroupTab data={filtered} groupKey="prov_name" groupLabel="Provider" threshold={threshold} /></TabsContent>
          <TabsContent value="cpt"><CptTab data={filtered} cptRef={cptRef} /></TabsContent>
          <TabsContent value="month"><MonthTab data={filtered} /></TabsContent>
          <TabsContent value="category"><GroupTab data={filtered} groupKey="service_category" groupLabel="Service Category" threshold={threshold} /></TabsContent>
          <TabsContent value="cross"><CrossTab data={filtered} /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* ────────────── helpers ────────────── */

function uniq(arr: (string | null | undefined)[]) {
  return Array.from(new Set(arr.filter((x): x is string => !!x && x.trim() !== ""))).sort();
}

function isPaid(c: Claim) { return c.revenue != null && Number(c.revenue) > 0; }
function isUnpaidPrimary(c: Claim) { return !!c.is_primary_billable && (c.revenue == null || Number(c.revenue) === 0); }
function daysSince(dos: string | null) {
  if (!dos) return 0;
  const d = new Date(dos).getTime();
  return Math.floor((Date.now() - d) / 86400000);
}

function computeKpis(data: Claim[], threshold: number) {
  const totalLines = data.length;
  const claimKeys = new Set(data.map((c) => `${c.acct}|${c.dos}|${c.service_category ?? ""}`));
  const totalClaims = claimKeys.size;
  const paid = data.filter(isPaid).length;
  const unpaid = data.filter(isUnpaidPrimary).length;
  const unpaidPct = (paid + unpaid) > 0 ? (unpaid / (paid + unpaid)) * 100 : 0;
  const revenue = data.reduce((s, c) => s + Number(c.revenue ?? 0), 0);
  const avgRevPaid = paid ? revenue / paid : 0;
  const days = data.filter(isPaid).map((c) => Number(c.days_to_pmt ?? 0)).filter((n) => n > 0);
  const avgDays = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
  const pastThreshold = data.filter((c) => isUnpaidPrimary(c) && daysSince(c.dos) > threshold).length;
  return { totalLines, totalClaims, paid, unpaid, unpaidPct, revenue, avgRevPaid, avgDays, pastThreshold };
}

function exportXlsx(rows: any[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  XLSX.writeFile(wb, filename);
}

/* ────────────── building blocks ────────────── */

function Kpi({
  label, value, icon: Icon, tone, valueClass,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; tone?: "positive" | "negative"; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className={cn("text-xl font-semibold mt-1.5 truncate", valueClass)}>{value}</div>
        </div>
        <div className={cn(
          "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
          tone === "positive" ? "bg-emerald-500/10 text-emerald-600" :
          tone === "negative" ? "bg-red-500/10 text-red-600" :
          "bg-primary/10 text-primary"
        )}>
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function DateRange({ label, date, onChange }: { label: string; date: Date | undefined; onChange: (d: Date | undefined) => void }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("w-full h-9 justify-start font-normal", !date && "text-muted-foreground")}>
            <CalendarIcon className="h-4 w-4 mr-2" />
            {date ? format(date, "PP") : "Any"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
          <Calendar mode="single" selected={date} onSelect={onChange} initialFocus className="p-3 pointer-events-auto" />
          {date && (
            <div className="p-2 border-t">
              <Button size="sm" variant="ghost" className="w-full" onClick={() => onChange(undefined)}>Clear</Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ────────────── group tab (insurance / provider / category) ────────────── */

type SortKey = "key" | "total" | "paid" | "unpaid" | "unpaidPct" | "revenue" | "avgDays" | "past";

function GroupTab({
  data, groupKey, groupLabel, threshold,
}: { data: Claim[]; groupKey: keyof Claim; groupLabel: string; threshold: number }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: "asc" | "desc" }>({ k: "unpaid", dir: "desc" });

  const grouped = useMemo(() => {
    const map = new Map<string, Claim[]>();
    for (const c of data) {
      const k = (c[groupKey] as string | null) || "—";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    const rows = Array.from(map.entries()).map(([key, list]) => {
      const total = list.length;
      const paid = list.filter(isPaid).length;
      const unpaid = list.filter(isUnpaidPrimary).length;
      const denom = paid + unpaid;
      const unpaidPct = denom ? (unpaid / denom) * 100 : 0;
      const revenue = list.reduce((s, c) => s + Number(c.revenue ?? 0), 0);
      const days = list.filter(isPaid).map((c) => Number(c.days_to_pmt ?? 0)).filter((n) => n > 0);
      const avgDays = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
      const past = list.filter((c) => isUnpaidPrimary(c) && daysSince(c.dos) > threshold).length;
      return { key, total, paid, unpaid, unpaidPct, revenue, avgDays, past };
    });
    rows.sort((a, b) => {
      const va = a[sort.k], vb = b[sort.k];
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, groupKey, threshold, sort]);

  const toggleSort = (k: SortKey) =>
    setSort((s) => (s.k === k ? { k, dir: s.dir === "asc" ? "desc" : "asc" } : { k, dir: "desc" }));

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">By {groupLabel}</h3>
        <Button size="sm" variant="outline" onClick={() => exportXlsx(grouped, `by-${groupLabel.toLowerCase()}.xlsx`)}>
          <Download className="h-4 w-4 mr-2" />Export
        </Button>
      </div>
      <div className="overflow-auto max-h-[600px]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <Th onClick={() => toggleSort("key")}>{groupLabel}</Th>
              <Th onClick={() => toggleSort("total")} className="text-right">Total</Th>
              <Th onClick={() => toggleSort("paid")} className="text-right">Paid</Th>
              <Th onClick={() => toggleSort("unpaid")} className="text-right">Unpaid</Th>
              <Th onClick={() => toggleSort("unpaidPct")} className="text-right">Unpaid %</Th>
              <Th onClick={() => toggleSort("revenue")} className="text-right">Revenue</Th>
              <Th onClick={() => toggleSort("avgDays")} className="text-right">Avg Days</Th>
              <Th onClick={() => toggleSort("past")} className="text-right">Past Threshold</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grouped.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
            ) : grouped.map((r) => (
              <TableRow key={r.key} className={r.unpaidPct >= 100 ? "bg-red-50" : ""}>
                <TableCell className="font-medium">{r.key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                <TableCell className="text-right tabular-nums">{r.paid}</TableCell>
                <TableCell className="text-right tabular-nums">{r.unpaid}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", unpaidColor(r.unpaidPct))}>{fmtPct(r.unpaidPct)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUSD(r.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.avgDays ? r.avgDays.toFixed(1) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.past > 0 ? <Badge variant="destructive">{r.past}</Badge> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function Th({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <TableHead className={cn("cursor-pointer select-none hover:text-foreground", className)} onClick={onClick}>
      {children}
    </TableHead>
  );
}

/* ────────────── CPT tab ────────────── */

function CptTab({ data, cptRef }: { data: Claim[]; cptRef: Record<string, CptRef> }) {
  const [primaryOnly, setPrimaryOnly] = useState(true);

  const rows = useMemo(() => {
    const map = new Map<string, Claim[]>();
    for (const c of data) {
      const k = (c.cpt || "—").toUpperCase();
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return Array.from(map.entries()).map(([cpt, list]) => {
      const ref = cptRef[cpt];
      const total = list.length;
      const paid = list.filter(isPaid).length;
      const unpaid = list.filter(isUnpaidPrimary).length;
      const denom = paid + unpaid;
      const unpaidPct = denom ? (unpaid / denom) * 100 : 0;
      const totalRev = list.reduce((s, c) => s + Number(c.revenue ?? 0), 0);
      const avgRev = paid ? totalRev / paid : 0;
      const lostRev = unpaid * avgRev;
      return {
        cpt,
        description: ref?.description ?? "—",
        service_category: ref?.service_category ?? list[0]?.service_category ?? "—",
        billing_type: ref?.billing_type ?? "Unknown",
        total, paid, unpaid, unpaidPct, avgRev, lostRev,
      };
    }).filter((r) => !primaryOnly || r.billing_type === "Primary")
      .sort((a, b) => b.lostRev - a.lostRev);
  }, [data, cptRef, primaryOnly]);

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold text-sm">By CPT Code</h3>
          <div className="flex items-center gap-2">
            <Switch id="primary-only" checked={primaryOnly} onCheckedChange={setPrimaryOnly} />
            <Label htmlFor="primary-only" className="text-xs">Primary billable only</Label>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => exportXlsx(rows, "by-cpt.xlsx")}>
          <Download className="h-4 w-4 mr-2" />Export
        </Button>
      </div>
      <div className="overflow-auto max-h-[600px]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>CPT</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Unpaid</TableHead>
              <TableHead className="text-right">Unpaid %</TableHead>
              <TableHead className="text-right">Avg Revenue</TableHead>
              <TableHead className="text-right">Est. Lost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.cpt}>
                <TableCell className="font-mono text-xs">{r.cpt}</TableCell>
                <TableCell className="max-w-[280px] truncate">{r.description}</TableCell>
                <TableCell>{safe(r.service_category)}</TableCell>
                <TableCell><Badge variant="outline">{r.billing_type}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                <TableCell className="text-right tabular-nums">{r.paid}</TableCell>
                <TableCell className="text-right tabular-nums">{r.unpaid}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", unpaidColor(r.unpaidPct))}>{fmtPct(r.unpaidPct)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUSD(r.avgRev)}</TableCell>
                <TableCell className="text-right tabular-nums text-red-600 font-medium">{fmtUSD(r.lostRev)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ────────────── Month tab ────────────── */

function MonthTab({ data }: { data: Claim[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, Claim[]>();
    for (const c of data) {
      if (!c.dos) continue;
      const m = c.dos.slice(0, 7);
      if (!map.has(m)) map.set(m, []);
      map.get(m)!.push(c);
    }
    return Array.from(map.entries()).map(([month, list]) => {
      const total = list.length;
      const paid = list.filter(isPaid).length;
      const unpaid = list.filter(isUnpaidPrimary).length;
      const denom = paid + unpaid;
      const unpaidPct = denom ? (unpaid / denom) * 100 : 0;
      const revenue = list.reduce((s, c) => s + Number(c.revenue ?? 0), 0);
      const avgPaidRev = paid ? revenue / paid : 0;
      const unpaidEst = unpaid * avgPaidRev;
      return { month, total, paid, unpaid, revenue, unpaidPct, unpaidEst };
    }).sort((a, b) => a.month.localeCompare(b.month));
  }, [data]);

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">By Month</h3>
        <Button size="sm" variant="outline" onClick={() => exportXlsx(rows, "by-month.xlsx")}>
          <Download className="h-4 w-4 mr-2" />Export
        </Button>
      </div>
      <div className="p-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: any) => fmtUSD(Number(v))} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue Collected" fill="hsl(142 71% 45%)" />
              <Bar dataKey="unpaidEst" name="Unpaid (Est.)" fill="hsl(0 84% 60%)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="overflow-auto max-h-[400px] border-t">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Unpaid</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Unpaid %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.month}>
                <TableCell className="font-medium">{r.month}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                <TableCell className="text-right tabular-nums">{r.paid}</TableCell>
                <TableCell className="text-right tabular-nums">{r.unpaid}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUSD(r.revenue)}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", unpaidColor(r.unpaidPct))}>{fmtPct(r.unpaidPct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ────────────── Cross Analysis tab ────────────── */

function CrossTab({ data }: { data: Claim[] }) {
  const [mode, setMode] = useState<"prov" | "cpt">("prov");

  const heatmap = useMemo(() => {
    const unpaidRows = data.filter(isUnpaidPrimary);
    const rowKey = (c: Claim) => (c.pri_ins || "—");
    const colKey = (c: Claim) => mode === "prov" ? (c.prov_name || "—") : (c.cpt || "—");

    // For CPT mode, restrict to top 15 insurers by unpaid
    const rowCounts = new Map<string, number>();
    unpaidRows.forEach((c) => rowCounts.set(rowKey(c), (rowCounts.get(rowKey(c)) ?? 0) + 1));
    const rowsAll = Array.from(rowCounts.entries()).sort((a, b) => b[1] - a[1]);

    if (mode === "cpt") {
      // rows = CPT, cols = top 15 insurers
      const topIns = rowsAll.slice(0, 15).map(([k]) => k);
      const cptCounts = new Map<string, Map<string, number>>();
      unpaidRows.forEach((c) => {
        const cpt = c.cpt || "—";
        const ins = c.pri_ins || "—";
        if (!topIns.includes(ins)) return;
        if (!cptCounts.has(cpt)) cptCounts.set(cpt, new Map());
        const m = cptCounts.get(cpt)!;
        m.set(ins, (m.get(ins) ?? 0) + 1);
      });
      const cptList = Array.from(cptCounts.keys())
        .sort((a, b) => {
          const sa = Array.from(cptCounts.get(a)!.values()).reduce((s, n) => s + n, 0);
          const sb = Array.from(cptCounts.get(b)!.values()).reduce((s, n) => s + n, 0);
          return sb - sa;
        }).slice(0, 50);
      const cells = cptList.map((r) => topIns.map((c) => cptCounts.get(r)?.get(c) ?? 0));
      const max = Math.max(1, ...cells.flat());
      return { rows: cptList, cols: topIns, cells, max, rowLabel: "CPT", colLabel: "Insurance" };
    }

    // prov mode: rows = insurers, cols = providers
    const insurers = rowsAll.slice(0, 30).map(([k]) => k);
    const provSet = new Set<string>();
    unpaidRows.forEach((c) => { if (insurers.includes(c.pri_ins || "—")) provSet.add(c.prov_name || "—"); });
    const provs = Array.from(provSet).sort();
    const cells = insurers.map((ins) =>
      provs.map((p) => unpaidRows.filter((c) => (c.pri_ins || "—") === ins && (c.prov_name || "—") === p).length)
    );
    const max = Math.max(1, ...cells.flat());
    return { rows: insurers, cols: provs, cells, max, rowLabel: "Insurance", colLabel: "Provider" };
  }, [data, mode]);

  function exportHeat() {
    const rows = heatmap.rows.map((r, i) => {
      const o: any = { [heatmap.rowLabel]: r };
      heatmap.cols.forEach((c, j) => { o[c] = heatmap.cells[i][j]; });
      return o;
    });
    exportXlsx(rows, `heatmap-${mode}.xlsx`);
  }

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm mr-2">Cross Analysis</h3>
          <Button size="sm" variant={mode === "prov" ? "default" : "outline"} onClick={() => setMode("prov")}>
            Provider × Insurance
          </Button>
          <Button size="sm" variant={mode === "cpt" ? "default" : "outline"} onClick={() => setMode("cpt")}>
            CPT × Insurance
          </Button>
        </div>
        <Button size="sm" variant="outline" onClick={exportHeat}>
          <Download className="h-4 w-4 mr-2" />Export
        </Button>
      </div>
      <div className="p-4 overflow-auto max-h-[640px]">
        {heatmap.rows.length === 0 ? (
          <div className="text-center text-muted-foreground py-10">No unpaid data to compare.</div>
        ) : (
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card text-left px-2 py-2 font-medium">{heatmap.rowLabel} \ {heatmap.colLabel}</th>
                {heatmap.cols.map((c) => (
                  <th key={c} className="px-2 py-2 font-medium text-left whitespace-nowrap">
                    <div className="rotate-[-30deg] origin-left max-w-[140px] truncate">{c}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmap.rows.map((r, i) => (
                <tr key={r}>
                  <td className="sticky left-0 bg-card font-medium px-2 py-1 whitespace-nowrap max-w-[200px] truncate">{r}</td>
                  {heatmap.cols.map((_, j) => {
                    const v = heatmap.cells[i][j];
                    const intensity = v / heatmap.max;
                    const bg = v === 0 ? "transparent" : `rgba(220, 38, 38, ${0.1 + intensity * 0.7})`;
                    return (
                      <td
                        key={j}
                        className="border border-border text-center tabular-nums px-2 py-1"
                        style={{ backgroundColor: bg, color: intensity > 0.5 ? "white" : undefined }}
                        title={`${v} unpaid`}
                      >
                        {v || ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
