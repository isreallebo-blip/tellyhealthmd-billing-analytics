import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AiInsightsPanel } from "@/components/ai-insights-panel";

export const Route = createFileRoute("/ai-insights")({
  head: () => ({
    meta: [
      { title: "AI Insights — TellyHealthMD Billing Analytics" },
      { name: "description", content: "AI-powered analysis of unpaid claims and revenue patterns." },
    ],
  }),
  component: () => (
    <AppShell>
      <PageHeader
        title="AI Insights"
        description="Plain-English findings from your latest claims data."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "AI Insights" }]}
      />
      <div className="p-4 md:p-8">
        <AiInsightsPanel autoRunSignal={0} />
      </div>
    </AppShell>
  ),
});
