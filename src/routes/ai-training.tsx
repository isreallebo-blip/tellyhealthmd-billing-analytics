import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/ai-training")({
  head: () => ({
    meta: [
      { title: "AI Training — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Customize how the AI analyzes your billing data." },
    ],
  }),
  component: () => (
    <AppShell>
      <AiTrainingPage />
    </AppShell>
  ),
});

type Instruction = {
  id: string;
  instruction_text: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
};

const EXAMPLES = [
  "For PAMCD insurance, treat CPT 99203 as non-billable — we have no agreement with them for new patient visits.",
  "Flag any insurance where unpaid rate exceeds 80% as Critical regardless of claim count.",
  "Keystone (KEY) typically pays slowly — only alert if past 60 days, not 30.",
];


function AiTrainingPage() {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Instruction[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("ai_training_instructions")
      .select("id,instruction_text,is_active,created_at,created_by")
      .order("created_at", { ascending: false });
    setItems((data ?? []) as Instruction[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!user || !text.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("ai_training_instructions")
      .insert({ instruction_text: text.trim(), created_by: user.id, is_active: true });
    setSaving(false);
    if (error) return toast.error(error.message);
    setText("");
    toast.success("Instruction added");
    load();
  }

  async function toggle(i: Instruction) {
    const { error } = await supabase
      .from("ai_training_instructions")
      .update({ is_active: !i.is_active })
      .eq("id", i.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("ai_training_instructions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <>
      <PageHeader
        title="AI Training Instructions"
        description="Write plain-English instructions to customize how the AI analyzes your data. These are sent to the AI on every analysis run."
      />
      <div className="p-8 max-w-3xl space-y-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="rounded-md border bg-muted/40 p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Examples
              </div>
              <ul className="text-sm space-y-1.5 list-disc pl-5 text-muted-foreground">
                {EXAMPLES.map((ex, i) => <li key={i}>{ex}</li>)}
              </ul>
            </div>
            <div>
              <label htmlFor="instruction" className="text-sm font-medium block mb-1.5">
                New instruction
              </label>
              <Textarea
                id="instruction"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type your custom instruction here…"
                rows={6}
                className="resize-y"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={add} disabled={saving || !text.trim()}>
                <Sparkles className="h-4 w-4 mr-2" />
                {saving ? "Adding…" : "Add Instruction"}
              </Button>
            </div>
          </CardContent>
        </Card>


        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Saved Instructions ({items.length})
          </h2>
          {items.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
              No instructions yet. Add your first one above.
            </CardContent></Card>
          ) : (
            items.map((i) => (
              <Card
                key={i.id}
                className={i.is_active ? "border-emerald-200 bg-emerald-50/40" : "bg-muted/30"}
              >
                <CardContent className="p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {i.is_active ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(i.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className={i.is_active ? "text-sm" : "text-sm text-muted-foreground"}>
                      {i.instruction_text}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={i.is_active} onCheckedChange={() => toggle(i)} />
                    <Button size="icon" variant="ghost" onClick={() => remove(i.id)} title="Delete">
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center pt-2">
          Active instructions are included in every AI analysis run.
        </p>
      </div>
    </>
  );
}
