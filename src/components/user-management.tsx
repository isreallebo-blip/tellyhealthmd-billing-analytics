import { useEffect, useMemo, useState } from "react";
import { Users as UsersIcon, Mail, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { EmptyState } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "viewer";
  is_active: boolean;
};
type Access = { id: string; user_id: string; company_name: string };

export function UserManagement({ showHeader = true }: { showHeader?: boolean }) {
  const { user: me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Profile[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: u }, { data: a }, { data: cl }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,role,is_active").order("email"),
      supabase.from("company_access").select("id,user_id,company_name"),
      supabase.from("claims_raw").select("company").limit(5000),
    ]);
    setUsers((u ?? []) as Profile[]);
    setAccess((a ?? []) as Access[]);
    const set = new Set<string>();
    (cl ?? []).forEach((r: any) => r.company && set.add(r.company));
    setCompanies(Array.from(set).sort());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(u: Profile) {
    if (u.id === me?.id) return toast.error("You can't deactivate yourself");
    const { error } = await supabase.from("profiles").update({ is_active: !u.is_active }).eq("id", u.id);
    if (error) return toast.error(error.message);
    toast.success(u.is_active ? "User deactivated" : "User reactivated");
    load();
  }

  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>User Management</CardTitle>
            <CardDescription>
              Invite team members and control which companies they can access.
            </CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)} size="sm">
            <UserPlus className="h-4 w-4 mr-2" />
            Invite User
          </Button>
        </CardHeader>
      )}
      <CardContent className={showHeader ? "p-0" : "p-0"}>
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No users yet"
            description="Invite the first teammate to get started."
            action={<Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4 mr-2" />Invite User</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Assigned Companies</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const userAccess = access.filter((a) => a.user_id === u.id);
                  const isSelf = u.id === me?.id;
                  return (
                    <TableRow key={u.id} className={!u.is_active ? "opacity-60" : ""}>
                      <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                      <TableCell className="text-sm">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize">
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.role === "admin" ? (
                          <span className="text-xs text-muted-foreground">All companies</span>
                        ) : userAccess.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[280px]">
                            {userAccess.slice(0, 3).map((a) => (
                              <Badge key={a.id} variant="outline" className="text-xs">{a.company_name}</Badge>
                            ))}
                            {userAccess.length > 3 && (
                              <Badge variant="outline" className="text-xs">+{userAccess.length - 3}</Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.is_active ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing(u)}>Edit</Button>
                          <Button
                            size="sm" variant="ghost"
                            disabled={isSelf}
                            title={isSelf ? "You can't deactivate yourself" : ""}
                            onClick={() => toggleActive(u)}
                          >
                            {u.is_active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} companies={companies} onDone={load} />
      <EditUserDialog
        user={editing}
        access={editing ? access.filter((a) => a.user_id === editing.id) : []}
        companies={companies}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </Card>
  );
}

function CompanyChecklist({
  companies, selected, setSelected,
}: { companies: string[]; selected: Set<string>; setSelected: (s: Set<string>) => void }) {
  return (
    <div className="mt-2 max-h-56 overflow-auto border rounded-md p-3 space-y-2">
      {companies.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No companies found yet — upload claims data first.
        </p>
      ) : companies.map((c) => (
        <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={selected.has(c)}
            onCheckedChange={(v) => {
              const next = new Set(selected);
              if (v) next.add(c); else next.delete(c);
              setSelected(next);
            }}
          />
          <span>{c}</span>
        </label>
      ))}
    </div>
  );
}

function InviteDialog({
  open, onOpenChange, companies, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: string[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail(""); setFullName(""); setRole("viewer"); setSelected(new Set());
    }
  }, [open]);

  async function invite() {
    if (!email.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth`,
          data: { role, full_name: fullName.trim() || undefined },
        },
      });
      if (error) throw error;

      // Pre-stage company access by email so it applies after the invite is accepted.
      // Best-effort: also try to apply to existing profile with same email.
      if (role === "viewer" && selected.size > 0) {
        const { data: existing } = await supabase
          .from("profiles").select("id").eq("email", email.trim()).maybeSingle();
        if (existing?.id) {
          await supabase
            .from("company_access")
            .insert(Array.from(selected).map((c) => ({ user_id: existing.id, company_name: c })));
        }
      }

      toast.success(`Invitation email sent to ${email}`);
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send invite");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a new user</DialogTitle>
          <DialogDescription>
            They'll receive an email with a sign-in link. The account is created on first sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <div className="relative">
              <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="invite-email" type="email" className="pl-9"
                placeholder="name@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="invite-name">Full Name</Label>
            <Input
              id="invite-name"
              placeholder="Jane Doe"
              value={fullName} onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "viewer")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "viewer" && (
            <div>
              <Label>Assigned Companies</Label>
              <CompanyChecklist companies={companies} selected={selected} setSelected={setSelected} />
              <p className="text-xs text-muted-foreground mt-1">
                Admins automatically see all companies.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={invite} disabled={sending || !email}>
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user, access, companies, onClose, onSaved,
}: {
  user: Profile | null;
  access: Access[];
  companies: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const { user: me } = useAuth();
  const isSelf = user?.id === me?.id;

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setName(user.full_name ?? "");
    setActive(user.is_active);
    setSelected(new Set(access.map((a) => a.company_name)));
  }, [user, access]);

  const original = useMemo(() => new Set(access.map((a) => a.company_name)), [access]);

  async function save() {
    if (!user) return;
    if (isSelf && role !== "admin") return toast.error("You can't demote yourself");
    setSaving(true);
    try {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          role: isSelf ? "admin" : role,
          full_name: name,
          is_active: isSelf ? true : active,
        })
        .eq("id", user.id);
      if (pErr) throw pErr;

      const toAdd = Array.from(selected).filter((c) => !original.has(c));
      const toRemove = access.filter((a) => !selected.has(a.company_name));

      if (toAdd.length) {
        const { error } = await supabase
          .from("company_access")
          .insert(toAdd.map((c) => ({ user_id: user.id, company_name: c })));
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from("company_access").delete().in("id", toRemove.map((a) => a.id));
        if (error) throw error;
      }
      toast.success("User updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Full Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as any)} disabled={isSelf}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && <p className="text-xs text-muted-foreground mt-1">You can't demote yourself.</p>}
          </div>

          {role !== "admin" && (
            <div>
              <Label>Assigned Companies</Label>
              <CompanyChecklist companies={companies} selected={selected} setSelected={setSelected} />
              <p className="text-xs text-muted-foreground mt-1">
                Admins automatically see all companies.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Account Status</Label>
              <p className="text-xs text-muted-foreground">
                {isSelf ? "You can't deactivate yourself." : "Deactivate to revoke access immediately."}
              </p>
            </div>
            <Switch
              checked={active}
              disabled={isSelf}
              onCheckedChange={setActive}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
