import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Users — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Manage users and company access." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <UsersPage />
    </AppShell>
  ),
});

type ProfileRow = { id: string; email: string; full_name: string | null; role: "admin" | "viewer" };
type AccessRow = { id: string; user_id: string; company_name: string };

function UsersPage() {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState("");

  async function loadAll() {
    const [{ data: u }, { data: a }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,role").order("email"),
      supabase.from("company_access").select("id,user_id,company_name"),
    ]);
    setUsers((u ?? []) as ProfileRow[]);
    setAccess((a ?? []) as AccessRow[]);
  }
  useEffect(() => { loadAll(); }, []);

  async function setRole(id: string, role: "admin" | "viewer") {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    loadAll();
  }

  async function addCompany() {
    if (!selected || !newCompany.trim()) return;
    const { error } = await supabase
      .from("company_access")
      .insert({ user_id: selected, company_name: newCompany.trim() });
    if (error) return toast.error(error.message);
    setNewCompany("");
    loadAll();
  }

  async function removeAccess(id: string) {
    const { error } = await supabase.from("company_access").delete().eq("id", id);
    if (error) return toast.error(error.message);
    loadAll();
  }

  const selectedUser = users.find((u) => u.id === selected) ?? null;
  const selectedAccess = access.filter((a) => a.user_id === selected);

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage roles and per-company access. New signups join as viewers."
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow
                    key={u.id}
                    className={selected === u.id ? "bg-accent/40" : "cursor-pointer"}
                    onClick={() => setSelected(u.id)}
                  >
                    <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Select value={u.role} onValueChange={(v) => setRole(u.id, v as "admin" | "viewer")}>
                        <SelectTrigger className="w-32" onClick={(e) => e.stopPropagation()}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">
                        {access.filter((a) => a.user_id === u.id).length} companies
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Company access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedUser ? (
              <p className="text-sm text-muted-foreground">Select a user to manage company access.</p>
            ) : (
              <>
                <div className="text-sm">
                  <div className="font-medium">{selectedUser.full_name || selectedUser.email}</div>
                  <div className="text-muted-foreground text-xs">{selectedUser.email}</div>
                </div>

                <div className="space-y-2">
                  {selectedAccess.length === 0 && (
                    <p className="text-xs text-muted-foreground">No company access assigned.</p>
                  )}
                  {selectedAccess.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span className="text-sm">{a.company_name}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeAccess(a.id)}>Remove</Button>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t">
                  <Label htmlFor="company" className="text-xs">Add company</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="company"
                      placeholder="e.g. Acme Health"
                      value={newCompany}
                      onChange={(e) => setNewCompany(e.target.value)}
                    />
                    <Button onClick={addCompany}>Add</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
