import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/multi-select";
import { UserManagement } from "@/components/user-management";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Manage your account, alerts, and default filters." },
    ],
  }),
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

const FILTER_KEY = "tellyhealth:default-companies";

function SettingsPage() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [threshold, setThreshold] = useState(30);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [defaultCompanies, setDefaultCompanies] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !profile) return;
    setFullName(profile.full_name ?? "");
    (async () => {
      const [{ data: a }, { data: rows }] = await Promise.all([
        supabase.from("alert_settings").select("threshold_days").eq("user_id", user.id).maybeSingle(),
        supabase.from("claims_raw").select("company").limit(5000),
      ]);
      if (a?.threshold_days) setThreshold(a.threshold_days);
      const uniq = Array.from(new Set((rows ?? []).map((r: any) => r.company).filter(Boolean))).sort();
      setCompanies(uniq);
      try {
        const saved = localStorage.getItem(FILTER_KEY);
        if (saved) setDefaultCompanies(JSON.parse(saved));
      } catch {}
    })();
  }, [user, profile]);

  async function saveThreshold() {
    if (!user) return;
    setBusy("threshold");
    const { error } = await supabase
      .from("alert_settings")
      .upsert(
        { user_id: user.id, threshold_days: threshold, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Alert threshold saved");
  }

  async function saveProfile() {
    if (!user) return;
    setBusy("profile");
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Display name updated");
  }

  async function changePassword() {
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy("password");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(null);
    if (error) return toast.error(error.message);
    setPassword("");
    toast.success("Password updated");
  }

  function saveFilters() {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(defaultCompanies));
      toast.success("Default companies saved");
    } catch {
      toast.error("Could not save preferences");
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Account, alerts, and dashboard defaults."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Settings" }]}
      />
      <div className="p-4 md:p-8 space-y-6">
        {/* 1. Your Account */}
        <Card>
          <CardHeader>
            <CardTitle>Your Account</CardTitle>
            <CardDescription>Update your display name and password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile?.email ?? ""} disabled />
            </div>
            <div>
              <Label htmlFor="name">Display name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <Button onClick={saveProfile} disabled={busy === "profile"}>
              {busy === "profile" ? "Saving…" : "Save profile"}
            </Button>

            <div className="pt-4 border-t space-y-3">
              <Label htmlFor="pw">New password</Label>
              <Input
                id="pw" type="password" autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
              <Button onClick={changePassword} disabled={busy === "password" || !password}>
                {busy === "password" ? "Updating…" : "Change password"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 2. Payment Alert Threshold */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Alert Threshold</CardTitle>
            <CardDescription>
              Flag claims that take longer than this many days to be paid.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[30, 60, 90].map((d) => (
                <Button key={d} variant={threshold === d ? "default" : "outline"} onClick={() => setThreshold(d)}>
                  {d} days
                </Button>
              ))}
            </div>
            <div>
              <Label htmlFor="threshold">Custom (days)</Label>
              <Input
                id="threshold" type="number" min={1}
                value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
            <Button onClick={saveThreshold} disabled={busy === "threshold"}>
              {busy === "threshold" ? "Saving…" : "Save threshold"}
            </Button>
          </CardContent>
        </Card>

        {/* 3. User Management (admin only) */}
        {isAdmin && <UserManagement />}

        {/* 4. Default Company Filter */}
        <Card>
          <CardHeader>
            <CardTitle>Default Company Filter</CardTitle>
            <CardDescription>
              Companies pre-selected when you open the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MultiSelect
              label="Companies"
              options={companies}
              values={defaultCompanies}
              onChange={setDefaultCompanies}
              placeholder="No defaults (show all)"
            />
            <Button onClick={saveFilters}>Save defaults</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
