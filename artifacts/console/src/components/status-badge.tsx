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
