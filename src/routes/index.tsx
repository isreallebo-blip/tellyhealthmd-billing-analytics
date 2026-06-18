import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, DollarSign, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Overview of claims, revenue, and denial metrics." },
    ],
  }),
  component: () => (
    <AppShell>
      <Dashboard />
    </AppShell>
  ),
});

type Stats = { claims: number; revenue: number; denied: number; avgDays: number };

function Dashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("claims_raw")
        .select("revenue,denied_claim,days_to_pmt");
      const rows = data ?? [];
      const revenue = rows.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
      const denied = rows.filter((r) => r.denied_claim).length;
      const days = rows.map((r) => Number(r.days_to_pmt ?? 0)).filter((n) => n > 0);
      const avgDays = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
      setStats({ claims: rows.length, revenue, denied, avgDays });
    })();
  }, []);

  return (
    <>
      <PageHeader
        title={`Welcome${profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`}
        description="Snapshot of claim activity across the companies you can access."
      />
      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total claims" value={stats?.claims.toLocaleString() ?? "—"} icon={FileText} />
          <StatCard
            label="Total revenue"
            value={
              stats
                ? stats.revenue.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                : "—"
            }
            icon={DollarSign}
          />
          <StatCard label="Denied claims" value={stats?.denied.toLocaleString() ?? "—"} icon={AlertTriangle} accent="destructive" />
          <StatCard label="Avg days to payment" value={stats ? stats.avgDays.toFixed(1) : "—"} icon={Clock} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Your workspace is ready. From here, you can:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Browse claims under <strong>Claims</strong>.</li>
              <li>Review CPT codes in <strong>CPT Reference</strong>.</li>
              {profile?.role === "admin" && (
                <li>Invite teammates and assign company access from <strong>Users</strong>.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "destructive";
}) {
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-5 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="text-2xl font-semibold mt-2">{value}</div>
        </div>
        <div
          className={[
            "h-10 w-10 rounded-md flex items-center justify-center",
            accent === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
          ].join(" ")}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
