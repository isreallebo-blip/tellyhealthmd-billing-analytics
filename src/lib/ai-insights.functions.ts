import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const InsightSchema = z.object({
  insights: z
    .array(
      z.object({
        severity: z.enum(["Critical", "Warning", "Positive", "Info"]),
        title: z.string(),
        explanation: z.string(),
        affected_segment: z.string(),
      })
    )
    .min(1)
    .max(20),
});

type Claim = {
  company: string;
  pri_ins: string | null;
  prov_name: string | null;
  dos: string | null;
  cpt: string | null;
  revenue: number | null;
  days_to_pmt: number | null;
  denied_claim: boolean | null;
  acct: string | null;
  service_category: string | null;
  is_primary_billable: boolean | null;
};

function isPaid(c: Claim) { return c.revenue != null && Number(c.revenue) > 0; }
function isUnpaidPrimary(c: Claim) {
  return !!c.is_primary_billable && (c.revenue == null || Number(c.revenue) === 0);
}
function daysSince(dos: string | null) {
  if (!dos) return 0;
  return Math.floor((Date.now() - new Date(dos).getTime()) / 86400000);
}

function groupStats<K extends keyof Claim>(data: Claim[], key: K) {
  const map = new Map<string, { total: number; paid: number; unpaid: number; revenue: number }>();
  for (const c of data) {
    const k = ((c[key] as unknown as string) || "—").toString();
    const e = map.get(k) ?? { total: 0, paid: 0, unpaid: 0, revenue: 0 };
    e.total++;
    if (isPaid(c)) { e.paid++; e.revenue += Number(c.revenue ?? 0); }
    if (isUnpaidPrimary(c)) e.unpaid++;
    map.set(k, e);
  }
  return Array.from(map.entries())
    .map(([k, v]) => ({
      key: k, ...v,
      unpaid_pct: v.paid + v.unpaid > 0 ? Math.round((v.unpaid / (v.paid + v.unpaid)) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.unpaid - a.unpaid);
}

function buildStats(data: Claim[], threshold: number) {
  const totalLines = data.length;
  const paid = data.filter(isPaid).length;
  const unpaid = data.filter(isUnpaidPrimary).length;
  const revenue = data.reduce((s, c) => s + Number(c.revenue ?? 0), 0);
  const unpaidPct = paid + unpaid > 0 ? (unpaid / (paid + unpaid)) * 100 : 0;

  const byInsurance = groupStats(data, "pri_ins").slice(0, 20);
  const byProvider = groupStats(data, "prov_name").slice(0, 20);
  const byCpt = groupStats(data, "cpt").slice(0, 20);
  const byCategory = groupStats(data, "service_category");

  const monthly = new Map<string, { total: number; paid: number; unpaid: number; revenue: number }>();
  for (const c of data) {
    if (!c.dos) continue;
    const m = c.dos.slice(0, 7);
    const e = monthly.get(m) ?? { total: 0, paid: 0, unpaid: 0, revenue: 0 };
    e.total++;
    if (isPaid(c)) { e.paid++; e.revenue += Number(c.revenue ?? 0); }
    if (isUnpaidPrimary(c)) e.unpaid++;
    monthly.set(m, e);
  }
  const byMonth = Array.from(monthly.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const fullyUnpaid = byInsurance.filter((g) => g.paid === 0 && g.unpaid >= 3);
  const pastThreshold = data
    .filter((c) => isUnpaidPrimary(c) && daysSince(c.dos) > threshold)
    .slice(0, 50)
    .map((c) => ({
      insurance: c.pri_ins, provider: c.prov_name, cpt: c.cpt,
      dos: c.dos, days_old: daysSince(c.dos), company: c.company,
    }));

  return {
    totals: {
      total_claim_lines: totalLines, paid, unpaid,
      unpaid_rate_pct: Math.round(unpaidPct * 10) / 10,
      total_revenue: Math.round(revenue),
      threshold_days: threshold,
      past_threshold_count: data.filter((c) => isUnpaidPrimary(c) && daysSince(c.dos) > threshold).length,
    },
    by_insurance: byInsurance,
    by_provider: byProvider,
    by_cpt: byCpt,
    by_category: byCategory,
    by_month: byMonth,
    fully_unpaid_insurers: fullyUnpaid,
    past_threshold_sample: pastThreshold,
  };
}

export const runAiInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY is not configured");

    const { supabase, userId } = context;

    // Threshold
    const { data: alertRow } = await supabase
      .from("alert_settings")
      .select("threshold_days")
      .eq("user_id", userId)
      .maybeSingle();
    const threshold = alertRow?.threshold_days ?? 30;

    // Claims (RLS scoped to accessible companies)
    const { data: claims, error: claimErr } = await supabase
      .from("claims_raw")
      .select(
        "company,pri_ins,prov_name,dos,cpt,revenue,days_to_pmt,denied_claim,acct,service_category,is_primary_billable"
      )
      .limit(50000);
    if (claimErr) throw new Error(claimErr.message);

    const stats = buildStats((claims ?? []) as Claim[], threshold);

    // Active instructions
    const { data: instructions } = await supabase
      .from("ai_training_instructions")
      .select("instruction_text")
      .eq("is_active", true);
    const instructionList = (instructions ?? []).map((r) => `- ${r.instruction_text}`).join("\n") || "(none)";

    const system =
      "You are a medical billing analyst. Analyze billing patterns. Flag anything alarming, identify trends, note any insurers or providers with unusual patterns. Consider the user's custom instructions when interpreting data. Categorize each insight as Critical, Warning, Positive, or Info. Each insight must include a concrete affected segment (e.g. 'PAMCD Insurance — 258 unpaid claims' or 'Dr. Smith — 12 claims past 60 days'). Return 6–12 high-signal insights, sorted by severity. Be specific and actionable. Do not invent numbers.";

    const prompt = `User's custom training instructions:
${instructionList}

Aggregated billing stats (JSON):
${JSON.stringify(stats, null, 2)}

Analyze and return insights.`;

    const gateway = createLovableAiGatewayProvider(key);

    try {
      const { experimental_output } = await generateText({
        model: gateway("openai/gpt-5"),
        system,
        prompt,
        experimental_output: Output.object({ schema: InsightSchema }),
      });

      const result = experimental_output as z.infer<typeof InsightSchema>;

      await supabase.from("ai_insights_runs").upsert(
        {
          user_id: userId,
          insights: result.insights,
          stats_summary: stats.totals,
          model: "openai/gpt-5",
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      return { insights: result.insights, stats: stats.totals, generated_at: new Date().toISOString() };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes("429")) throw new Error("AI rate limit reached. Please try again shortly.");
      if (msg.includes("402")) throw new Error("AI credits exhausted. Add credits in Settings → Plans & credits.");
      throw new Error(`AI analysis failed: ${msg}`);
    }
  });

export const getLatestInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("ai_insights_runs")
      .select("insights,stats_summary,generated_at,model")
      .eq("user_id", userId)
      .maybeSingle();
    return data ?? null;
  });
