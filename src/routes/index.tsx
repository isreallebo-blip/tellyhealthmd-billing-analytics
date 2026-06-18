import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  FileText, DollarSign, AlertTriangle, Clock, CalendarIcon, Download,
  TrendingUp, CheckCircle2, XCircle, Percent, Layers, X,
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

type CptRef = { cpt_code: string; description: string | null; service_category: string | null; billing_type: string | null };

type GroupRow = {
  key: string;
  total: number;
  paid: number;
  unpaid: number;
  unpaid_pct: number;
  revenue: number;
  avg_days: number;
  past_threshold: number;
};

type Stats = {
  kpi: {
    total_lines: number;
    total_claims: number;
    paid: number;
    unpaid: number;
    revenue: number;
    avg_days: number;
    past_threshold: number;
  };
  by_insurance: GroupRow[];
  by_provider: GroupRow[];
  by_cpt: GroupRow[];
  by_month: GroupRow[];
  by_service_category: GroupRow[];
};

type UnpaidRow = { company: string; pri_ins: string | null; prov_name: string | null; cpt: string | null };

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
  const [stats, setStats] = useState<Stats | null>(null);
  const [unpaidRows, setUnpaidRows] = useState<UnpaidRow[] | null>(null);
  const [cptRef, setCptRef] = useState<Record<string, CptRef>>({});
  const [filterOptions, setFilterOptions] = useState<{
    companies: string[]; providers: string[]; insurances: string[]; categories: string[];
  }>({ companies: [], providers: [], insurances: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);

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

  const [tab, setTab] = useState("insights");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const navigate = useNavigate();

  // Initial load: distinct filter options, cpt reference, alert settings
  useEffect(() => {
    if (!profile) return;
    (async () => {
      setLoading(true);
      const [{ data: distinctRows }, { data: refs }, { data: setting }] = await Promise.all([
        supabase
          .from("claims_raw")
          .select("company,prov_name,pri_ins,service_category")
          .limit(100000),
        supabase.from("cpt_reference").select("cpt_code,description,service_category,billing_type"),
        supabase.from("alert_settings").select("threshold_days").eq("user_id", profile.id).maybeSingle(),
      ]);
      const setC = new Set<string>(), setP = new Set<string>(), setI = new Set<string>(), setCat = new Set<string>();
      (distinctRows ?? []).forEach((r: any) => {
        if (r.company) setC.add(r.company);
        if (r.prov_name) setP.add(r.prov_name);
        if (r.pri_ins) setI.add(r.pri_ins);
        if (r.service_category) setCat.add(r.service_category);
      });
      ["Visit", "RPM", "CCM", "CGM", "Home Visit"].forEach((x) => setCat.add(x));
      setFilterOptions({
        companies: Array.from(setC).sort(),
        providers: Array.from(setP).sort(),
        insurances: Array.from(setI).sort(),
        categories: Array.from(setCat).sort(),
      });

      const map: Record<string, CptRef> = {};
      (refs ?? []).forEach((r: any) => { map[String(r.cpt_code).toUpperCase()] = r; });
      setCptRef(map);
      if (setting?.threshold_days) setThreshold(setting.threshold_days);
      setLoading(false);
    })();
  }, [profile]);

  // Apply default company filter from settings (once)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tellyhealth:default-companies");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (Array.isArray(parsed) && parsed.length) setCompanies(parsed);
      }
    } catch { /* noop */ }
  }, []);

  // Debounced stats fetch when filters/threshold change
  const filterDeps = useMemo(() => ({
    companies, providers, insurances, categories,
    date_from: dateFrom ? format(dateFrom, "yyyy-MM-dd") : null,
    date_to: dateTo ? format(dateTo, "yyyy-MM-dd") : null,
    threshold,
  }), [companies, providers, insurances, categories, dateFrom, dateTo, threshold]);

  useEffect(() => {
    if (!profile) return;
    const handle = setTimeout(async () => {
      setStatsLoading(true);
      const { data, error } = await supabase.rpc("get_dashboard_stats", {
        _companies: filterDeps.companies.length ? filterDeps.companies : undefined,
        _providers: filterDeps.providers.length ? filterDeps.providers : undefined,
        _insurances: filterDeps.insurances.length ? filterDeps.insurances : undefined,
        _categories: filterDeps.categories.length ? filterDeps.categories : undefined,
        _date_from: filterDeps.date_from ?? undefined,
        _date_to: filterDeps.date_to ?? undefined,
        _threshold: filterDeps.threshold,
      } as any);
      if (!error && data) setStats(data as unknown as Stats);
      setStatsLoading(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [profile, filterDeps]);

  // Fetch unpaid rows for cross-analysis tab (debounced, only when tab is active)
  useEffect(() => {
    if (!profile || tab !== "cross") return;
    const handle = setTimeout(async () => {
      let q = supabase
        .from("claims_raw")
        .select("company,pri_ins,prov_name,cpt")
        .eq("is_primary_billable", true)
        .or("revenue.is.null,revenue.eq.0")
        .limit(100000);
      if (filterDeps.companies.length) q = q.in("company", filterDeps.companies);
      if (filterDeps.providers.length) q = q.in("prov_name", filterDeps.providers);
      if (filterDeps.insurances.length) q = q.in("pri_ins", filterDeps.insurances);
      if (filterDeps.categories.length) q = q.in("service_category", filterDeps.categories);
      if (filterDeps.date_from) q = q.gte("dos", filterDeps.date_from);
      if (filterDeps.date_to) q = q.lte("dos", filterDeps.date_to);
      const { data } = await q;
      setUnpaidRows((data ?? []) as UnpaidRow[]);
    }, 300);
    return () => clearTimeout(handle);
  }, [profile, tab, filterDeps]);

  async function saveThreshold(days: number) {
    setThreshold(days);
    if (!profile) return;
    await supabase.from("alert_settings").upsert(
      { user_id: profile.id, threshold_days: days, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  }

  const k = stats?.kpi;
  const totalLines = k?.total_lines ?? 0;
  const paid = k?.paid ?? 0;
  const unpaid = k?.unpaid ?? 0;
  const unpaidPct = (paid + unpaid) > 0 ? (unpaid / (paid + unpaid)) * 100 : 0;
  const revenue = Number(k?.revenue ?? 0);
  const avgRevPaid = paid ? revenue / paid : 0;
  const pastThreshold = k?.past_threshold ?? 0;
  const totalClaims = k?.total_claims ?? 0;
  const avgDays = Number(k?.avg_days ?? 0);

  return (
    <>
      <PageHeader
        title="Analytics Dashboard"
        description="Filter, slice, and export billing performance."
        breadcrumbs={[{ label: "Home" }]}
      />
      <div className="p-4 md:p-6 lg:p-8 space-y-6">
        {!bannerDismissed && pastThreshold > 0 && (
          <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
            <button
              type="button"
              onClick={() => navigate({ to: "/ai-insights" })}
              className="text-left text-sm flex-1 hover:underline"
            >
              ⚠ <span className="font-medium">{pastThreshold.toLocaleString()} claims</span>{" "}
              are past {threshold} days unpaid — review in AI Insights →
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setBannerDismissed(true)}
              className="text-amber-900/70 hover:text-amber-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Sticky Filters */}
        <Card className="sticky top-0 z-20 shadow-sm">
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <MultiSelect label="Company" options={filterOptions.companies} values={companies} onChange={setCompanies} placeholder="All companies" />
            <MultiSelect label="Provider" options={filterOptions.providers} values={providers} onChange={setProviders} placeholder="All providers" />
            <MultiSelect label="Insurance" options={filterOptions.insurances} values={insurances} onChange={setInsurances} placeholder="All insurances" />
            <MultiSelect label="Service Category" options={filterOptions.categories} values={categories} onChange={setCategories} placeholder="All categories" />
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
                {loading || statsLoading ? "Loading…" : `${totalLines.toLocaleString()} claim lines in view`}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi label="Total Claims" value={totalClaims.toLocaleString()} icon={Layers} />
          <Kpi label="Total Claim Lines" value={totalLines.toLocaleString()} icon={FileText} />
          <Kpi label="Paid Claims" value={paid.toLocaleString()} icon={CheckCircle2} tone="positive" />
          <Kpi label="Unpaid Claims" value={unpaid.toLocaleString()} icon={XCircle} tone="negative" />
          <Kpi
            label="Unpaid Rate"
            value={fmtPct(unpaidPct)}
            icon={Percent}
            valueClass={unpaidColor(unpaidPct)}
          />
          <Kpi label="Revenue Collected" value={fmtUSD(revenue)} icon={DollarSign} tone="positive" />
          <Kpi label="Avg Revenue / Paid" value={fmtUSD(avgRevPaid)} icon={TrendingUp} />
          <Kpi label="Avg Days to Payment" value={avgDays.toFixed(1)} icon={Clock} />
          <Kpi
            label={`Past ${threshold}d Threshold`}
            value={pastThreshold.toLocaleString()}
            icon={AlertTriangle}
            tone={pastThreshold > 0 ? "negative" : undefined}
          />
        </div>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="insights">AI Analysis</TabsTrigger>
            <TabsTrigger value="insurance">By Insurance</TabsTrigger>
            <TabsTrigger value="provider">By Provider</TabsTrigger>
            <TabsTrigger value="cpt">By CPT</TabsTrigger>
            <TabsTrigger value="month">By Month</TabsTrigger>
            <TabsTrigger value="category">By Service Category</TabsTrigger>
            <TabsTrigger value="cross">Cross Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="insights"><AiInsightsPanel autoRunSignal={useAutoRunSignal()} /></TabsContent>
          <TabsContent value="insurance"><GroupTab rows={stats?.by_insurance ?? []} groupLabel="Insurance" /></TabsContent>
          <TabsContent value="provider"><GroupTab rows={stats?.by_provider ?? []} groupLabel="Provider" /></TabsContent>
          <TabsContent value="cpt"><CptTab rows={stats?.by_cpt ?? []} cptRef={cptRef} /></TabsContent>
          <TabsContent value="month"><MonthTab rows={stats?.by_month ?? []} /></TabsContent>
          <TabsContent value="category"><GroupTab rows={stats?.by_service_category ?? []} groupLabel="Service Category" /></TabsContent>
          <TabsContent value="cross"><CrossTab rows={unpaidRows} /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/* ────────────── building blocks ────────────── */

function exportXlsx(rows: any[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  XLSX.writeFile(wb, filename);
}

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

type SortKey = "key" | "total" | "paid" | "unpaid" | "unpaid_pct" | "revenue" | "avg_days" | "past_threshold";

function GroupTab({ rows, groupLabel }: { rows: GroupRow[]; groupLabel: string }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: "asc" | "desc" }>({ k: "unpaid", dir: "desc" });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[sort.k] as any, vb = b[sort.k] as any;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const toggleSort = (k: SortKey) =>
    setSort((s) => (s.k === k ? { k, dir: s.dir === "asc" ? "desc" : "asc" } : { k, dir: "desc" }));

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">By {groupLabel}</h3>
        <Button size="sm" variant="outline" onClick={() => exportXlsx(sorted, `by-${groupLabel.toLowerCase()}.xlsx`)}>
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
              <Th onClick={() => toggleSort("unpaid_pct")} className="text-right">Unpaid %</Th>
              <Th onClick={() => toggleSort("revenue")} className="text-right">Revenue</Th>
              <Th onClick={() => toggleSort("avg_days")} className="text-right">Avg Days</Th>
              <Th onClick={() => toggleSort("past_threshold")} className="text-right">Past Threshold</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
            ) : sorted.map((r) => (
              <TableRow key={r.key} className={r.unpaid_pct >= 100 ? "bg-red-50" : ""}>
                <TableCell className="font-medium">{r.key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                <TableCell className="text-right tabular-nums">{r.paid}</TableCell>
                <TableCell className="text-right tabular-nums">{r.unpaid}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", unpaidColor(r.unpaid_pct))}>{fmtPct(r.unpaid_pct)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUSD(Number(r.revenue))}</TableCell>
                <TableCell className="text-right tabular-nums">{r.avg_days ? Number(r.avg_days).toFixed(1) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.past_threshold > 0 ? <Badge variant="destructive">{r.past_threshold}</Badge> : "—"}
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

function CptTab({ rows, cptRef }: { rows: GroupRow[]; cptRef: Record<string, CptRef> }) {
  const [primaryOnly, setPrimaryOnly] = useState(true);

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const cpt = r.key.toUpperCase();
      const ref = cptRef[cpt];
      const totalRev = Number(r.revenue);
      const avgRev = r.paid ? totalRev / r.paid : 0;
      const lostRev = r.unpaid * avgRev;
      return {
        cpt,
        description: ref?.description ?? "—",
        service_category: ref?.service_category ?? "—",
        billing_type: ref?.billing_type ?? "Unknown",
        total: r.total, paid: r.paid, unpaid: r.unpaid,
        unpaidPct: r.unpaid_pct,
        avgRev, lostRev,
      };
    })
      .filter((r) => !primaryOnly || r.billing_type === "Primary")
      .sort((a, b) => b.lostRev - a.lostRev);
  }, [rows, cptRef, primaryOnly]);

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
        <Button size="sm" variant="outline" onClick={() => exportXlsx(enriched, "by-cpt.xlsx")}>
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
            {enriched.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
            ) : enriched.map((r) => (
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

function MonthTab({ rows }: { rows: GroupRow[] }) {
  const data = useMemo(() => {
    return [...rows]
      .map((r) => {
        const revenue = Number(r.revenue);
        const avgPaidRev = r.paid ? revenue / r.paid : 0;
        const unpaidEst = r.unpaid * avgPaidRev;
        return { month: r.key, total: r.total, paid: r.paid, unpaid: r.unpaid, revenue, unpaidPct: r.unpaid_pct, unpaidEst };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [rows]);

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">By Month</h3>
        <Button size="sm" variant="outline" onClick={() => exportXlsx(data, "by-month.xlsx")}>
          <Download className="h-4 w-4 mr-2" />Export
        </Button>
      </div>
      <div className="p-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
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
            {data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No data.</TableCell></TableRow>
            ) : data.map((r) => (
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

function CrossTab({ rows }: { rows: UnpaidRow[] | null }) {
  const [mode, setMode] = useState<"prov" | "cpt">("prov");

  const heatmap = useMemo(() => {
    const unpaidRows = rows ?? [];
    const rowKey = (c: UnpaidRow) => (c.pri_ins || "—");
    const colKey = (c: UnpaidRow) => mode === "prov" ? (c.prov_name || "—") : (c.cpt || "—");

    const rowCounts = new Map<string, number>();
    unpaidRows.forEach((c) => rowCounts.set(rowKey(c), (rowCounts.get(rowKey(c)) ?? 0) + 1));
    const rowsAll = Array.from(rowCounts.entries()).sort((a, b) => b[1] - a[1]);

    if (mode === "cpt") {
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

    const insurers = rowsAll.slice(0, 30).map(([k]) => k);
    const provSet = new Set<string>();
    unpaidRows.forEach((c) => { if (insurers.includes(c.pri_ins || "—")) provSet.add(c.prov_name || "—"); });
    const provs = Array.from(provSet).sort();
    const cells = insurers.map((ins) =>
      provs.map((p) => unpaidRows.filter((c) => (c.pri_ins || "—") === ins && (c.prov_name || "—") === p).length)
    );
    const max = Math.max(1, ...cells.flat());
    return { rows: insurers, cols: provs, cells, max, rowLabel: "Insurance", colLabel: "Provider" };
  }, [rows, mode]);

  function exportHeat() {
    const out = heatmap.rows.map((r, i) => {
      const o: any = { [heatmap.rowLabel]: r };
      heatmap.cols.forEach((c, j) => { o[c] = heatmap.cells[i][j]; });
      return o;
    });
    exportXlsx(out, `heatmap-${mode}.xlsx`);
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
        {rows === null ? (
          <div className="text-center text-muted-foreground py-10">Loading…</div>
        ) : heatmap.rows.length === 0 ? (
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

/* ────────────── auto-run signal ────────────── */

const AUTO_RUN_KEY = "tellyhealth:ai-autorun";

function useAutoRunSignal() {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    const consume = () => {
      const v = localStorage.getItem(AUTO_RUN_KEY);
      if (v) {
        localStorage.removeItem(AUTO_RUN_KEY);
        setSignal((s) => s + 1);
      }
    };
    consume();
    const onStorage = (e: StorageEvent) => { if (e.key === AUTO_RUN_KEY && e.newValue) consume(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return signal;
}

export function triggerAiAutoRun() {
  try { localStorage.setItem(AUTO_RUN_KEY, String(Date.now())); } catch { /* noop */ }
}
