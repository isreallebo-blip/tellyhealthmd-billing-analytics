import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runAiInsights, getLatestInsights } from "@/lib/ai-insights.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

export type Insight = {
  severity: "Critical" | "Warning" | "Positive" | "Info";
  title: string;
  explanation: string;
  affected_segment: string;
};

const SEVERITY = {
  Critical: { badge: "bg-red-600 hover:bg-red-600", border: "border-l-red-500", icon: AlertCircle, iconColor: "text-red-600" },
  Warning: { badge: "bg-amber-500 hover:bg-amber-500", border: "border-l-amber-500", icon: AlertTriangle, iconColor: "text-amber-600" },
  Positive: { badge: "bg-emerald-600 hover:bg-emerald-600", border: "border-l-emerald-500", icon: CheckCircle2, iconColor: "text-emerald-600" },
  Info: { badge: "bg-blue-600 hover:bg-blue-600", border: "border-l-blue-500", icon: Info, iconColor: "text-blue-600" },
} as const;

export function AiInsightsPanel({ autoRunSignal }: { autoRunSignal?: number }) {
  const runFn = useServerFn(runAiInsights);
  const getFn = useServerFn(getLatestInsights);
  const { user, loading: authLoading } = useAuth();
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getFn();
      if (data) {
        setInsights(data.insights as Insight[]);
        setGeneratedAt(data.generated_at);
      }
    } catch {
      // ignore — likely no session yet
    } finally {
      setInitial(false);
    }
  }, [getFn]);

  useEffect(() => {
    if (authLoading || !user) return;
    load();
  }, [authLoading, user?.id, load]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await runFn();
      setInsights(res.insights as Insight[]);
      setGeneratedAt(res.generated_at);
      toast.success("Insights generated");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to run analysis");
    } finally {
      setLoading(false);
    }
  }, [runFn]);

  // Auto-run when signal changes (e.g. after upload)
  useEffect(() => {
    if (autoRunSignal && autoRunSignal > 0) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunSignal]);

  const sortedInsights = insights
    ? [...insights].sort((a, b) => {
        const order = { Critical: 0, Warning: 1, Info: 2, Positive: 3 };
        return order[a.severity] - order[b.severity];
      })
    : null;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">Billing Analyst</div>
              <div className="text-xs text-muted-foreground">
                {generatedAt
                  ? `Last run: ${new Date(generatedAt).toLocaleString()}`
                  : "No analysis yet — click Run Analysis to generate insights."}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={run} disabled={loading} size="lg">
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing…</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> {insights ? "Re-run Analysis" : "Run Analysis"}</>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!collapsed && (
        <>
          {loading && !insights && (
            <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
              Aggregating claims data and consulting the model…
            </CardContent></Card>
          )}

          {!loading && !insights && !initial && (
            <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
              Click <strong>Run Analysis</strong> to have the system review your billing patterns.
            </CardContent></Card>
          )}

          {sortedInsights && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {sortedInsights.map((ins, idx) => {
                const cfg = SEVERITY[ins.severity] ?? SEVERITY.Info;
                const Icon = cfg.icon;
                return (
                  <Card key={idx} className={cn("border-l-4", cfg.border)}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start gap-2">
                        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.iconColor)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge className={cfg.badge}>{ins.severity}</Badge>
                            <h4 className="font-semibold text-sm leading-tight">{ins.title}</h4>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">{ins.explanation}</p>
                          <div className="mt-2 text-xs font-medium text-foreground/80 bg-muted/50 inline-block px-2 py-1 rounded">
                            {ins.affected_segment}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
