import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BillingTypeBadge } from "@/components/billing-badges";

export const Route = createFileRoute("/cpt-reference")({
  head: () => ({
    meta: [
      { title: "CPT Reference — TellyHealthMD Billing Analytics" },
      { name: "description", content: "CPT codes, categories, and billing types." },
    ],
  }),
  component: () => (
    <AppShell>
      <CptPage />
    </AppShell>
  ),
});

function CptPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("cpt_reference").select("*").order("cpt_code").then(({ data }) => setRows(data ?? []));
  }, []);

  return (
    <>
      <PageHeader title="CPT Reference" description="Service category and billing type for each CPT code." />
      <div className="p-8">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CPT</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Billing type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No CPT codes yet.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.cpt_code}>
                  <TableCell><code className="text-xs">{r.cpt_code}</code></TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.service_category}</TableCell>
                  <TableCell><BillingTypeBadge type={r.billing_type} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
