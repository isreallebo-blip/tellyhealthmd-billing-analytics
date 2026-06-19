import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({
    meta: [
      { title: "Access Audit — TellyHealthMD Billing Analytics" },
      { name: "description", content: "PHI access audit log for HIPAA accountability." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <AuditPage />
    </AppShell>
  ),
});

type Entry = {
  id: string;
  user_id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  source_file_id: string | null;
  row_count: number | null;
  details: any;
  created_at: string;
};
type Prof = { id: string; email: string; full_name: string | null };

function AuditPage() {
  const [items, setItems] = useState<Entry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Prof>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("phi_access_log" as any)
        .select("id,user_id,action,target_table,target_id,source_file_id,row_count,details,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      const rows = (data ?? []) as unknown as Entry[];
      setItems(rows);
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      if (userIds.length) {
        const { data: pr } = await supabase
          .from("profiles" as any)
          .select("id,email,full_name")
          .in("id", userIds);
        const map: Record<string, Prof> = {};
        for (const p of (pr ?? []) as unknown as Prof[]) map[p.id] = p;
        setProfiles(map);
      }
      setLoading(false);
    }
    load();
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((e) => {
        const p = profiles[e.user_id];
        return [e.action, e.target_table, e.target_id, p?.email, p?.full_name].some((v) => (v ?? "").toLowerCase().includes(q));
      })
    : items;

  return (
    <>
      <PageHeader
        title="Access Audit"
        description="Every view of PHI (file previews, exports) is recorded here. Retain per your HIPAA policy."
      />
      <div className="p-8 space-y-4">
        <div className="relative max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by user, action, table…" className="pl-9" />
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No entries.</TableCell></TableRow>
              )}
              {filtered.map((e) => {
                const p = profiles[e.user_id];
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{p?.full_name ?? p?.email ?? <span className="font-mono text-xs text-muted-foreground">{e.user_id.slice(0, 8)}…</span>}</TableCell>
                    <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {e.target_table && <span className="font-mono">{e.target_table}</span>}
                      {e.target_id && <span className="text-muted-foreground"> · {e.target_id.slice(0, 8)}…</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.row_count ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
