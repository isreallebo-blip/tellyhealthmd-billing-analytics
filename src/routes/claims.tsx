import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/claims")({
  head: () => ({
    meta: [
      { title: "Claims — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Browse claims across your assigned companies." },
    ],
  }),
  component: () => (
    <AppShell>
      <ClaimsPage />
    </AppShell>
  ),
});

function ClaimsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("claims_raw")
        .select("id,company,pt_name,dos,cpt,pri_ins,revenue,days_to_pmt,denied_claim")
        .order("dos", { ascending: false })
        .limit(200);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <PageHeader title="Claims" description="Most recent 200 claims you can access." />
      <div className="p-8">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>DOS</TableHead>
                <TableHead>CPT</TableHead>
                <TableHead>Insurance</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No claims yet.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.company}</TableCell>
                    <TableCell>{r.pt_name}</TableCell>
                    <TableCell>{r.dos}</TableCell>
                    <TableCell><code className="text-xs">{r.cpt}</code></TableCell>
                    <TableCell>{r.pri_ins}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.revenue != null ? Number(r.revenue).toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.days_to_pmt ?? "—"}</TableCell>
                    <TableCell>
                      {r.denied_claim ? <Badge variant="destructive">Denied</Badge> : <Badge variant="secondary">OK</Badge>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
