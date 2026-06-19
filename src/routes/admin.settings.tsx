import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Configure alerts and training instructions." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <SettingsPage />
    </AppShell>
  ),
});

function SettingsPage() {
  const { user } = useAuth();
  const [threshold, setThreshold] = useState(30);
  const [instruction, setInstruction] = useState("");
  const [savingThresh, setSavingThresh] = useState(false);
  const [savingInstr, setSavingInstr] = useState(false);
  const [instructions, setInstructions] = useState<any[]>([]);

  async function load() {
    if (!user) return;
    const [{ data: a }, { data: i }] = await Promise.all([
      supabase.from("alert_settings").select("threshold_days").eq("user_id", user.id).maybeSingle(),
      supabase.from("ai_training_instructions").select("*").order("created_at", { ascending: false }),
    ]);
    if (a?.threshold_days) setThreshold(a.threshold_days);
    setInstructions(i ?? []);
  }
  useEffect(() => { load(); }, [user]);

  async function saveThreshold() {
    if (!user) return;
    setSavingThresh(true);
    const { error } = await supabase
      .from("alert_settings")
      .upsert({ user_id: user.id, threshold_days: threshold, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSavingThresh(false);
    if (error) return toast.error(error.message);
    toast.success("Alert threshold saved");
  }

  async function addInstruction() {
    if (!user || !instruction.trim()) return;
    setSavingInstr(true);
    const { error } = await supabase
      .from("ai_training_instructions")
      .insert({ instruction_text: instruction.trim(), created_by: user.id });
    setSavingInstr(false);
    if (error) return toast.error(error.message);
    setInstruction("");
    load();
  }

  async function toggleActive(id: string, is_active: boolean) {
    await supabase.from("ai_training_instructions").update({ is_active: !is_active }).eq("id", id);
    load();
  }

  return (
    <>
      <PageHeader title="Settings" description="Alert thresholds and training instructions." />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Payment alert threshold</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Flag claims that take longer than this many days to be paid.
            </p>
            <div>
              <Label htmlFor="threshold">Threshold (days)</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
            <Button onClick={saveThreshold} disabled={savingThresh}>
              {savingThresh ? "Saving…" : "Save"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Training instructions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Add guidance for system-assisted analysis of claims…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
            />
            <Button onClick={addInstruction} disabled={savingInstr || !instruction.trim()}>
              {savingInstr ? "Adding…" : "Add instruction"}
            </Button>

            <div className="space-y-2 pt-2 border-t">
              {instructions.length === 0 && (
                <p className="text-sm text-muted-foreground">No instructions yet.</p>
              )}
              {instructions.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="text-sm flex-1">
                    <p className={i.is_active ? "" : "line-through text-muted-foreground"}>
                      {i.instruction_text}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(i.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(i.id, i.is_active)}>
                    {i.is_active ? "Disable" : "Enable"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
