import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const VARIANTS: Record<string, Variant> = {
  open: "default",
  closed: "secondary",
  archived: "outline",
  new: "default",
  triaged: "secondary",
  resolved: "outline",
  false_positive: "outline",
  pending: "default",
  granted: "secondary",
  denied: "destructive",
  expired: "outline",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANTS[status] ?? "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

// No Badge variant covers the amber middle step, so medium layers palette
// classes over the outline variant instead of adding a variant.
const SEVERITY_VARIANTS: Record<string, Variant> = {
  critical: "destructive",
  high: "destructive",
  medium: "outline",
  low: "secondary",
};

const SEVERITY_CLASSES: Record<string, string> = {
  medium: "border-amber-500/50 text-amber-700 dark:text-amber-400",
};

export function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant={SEVERITY_VARIANTS[severity] ?? "outline"}
      className={SEVERITY_CLASSES[severity]}
    >
      {severity}
    </Badge>
  );
}
