import { Badge } from "@/components/ui/badge";

export function BillingTypeBadge({ type }: { type: string | null | undefined }) {
  const t = (type ?? "").toLowerCase();
  if (t === "primary") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
        Primary
      </Badge>
    );
  }
  if (t === "add-on" || t === "addon") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
        Add-On
      </Badge>
    );
  }
  if (t === "non-billable" || t === "nonbillable") {
    return (
      <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
        Non-Billable
      </Badge>
    );
  }
  return <Badge variant="outline">{type || "—"}</Badge>;
}

export const BILLING_TYPES = ["Primary", "Add-On", "Non-Billable"] as const;
export const SERVICE_CATEGORIES = ["Visit", "Home Visit", "RPM", "CCM", "CGM"] as const;
