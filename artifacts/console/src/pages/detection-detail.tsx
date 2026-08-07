import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell";
import { QueryState } from "@/components/states";
import { SeverityBadge, StatusBadge } from "@/components/status-badge";
import { getDetectionEvidence } from "@/api/resources";
import { formatDateTime, formatRuleName, shortId } from "@/lib/format";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function DetectionDetailPage() {
  const { id } = useParams<{ id: string }>();

  const evidenceQuery = useQuery({
    queryKey: ["detection-evidence", id],
    queryFn: () => getDetectionEvidence(id),
  });

  return (
    <>
      <PageHeader
        title={
          evidenceQuery.data
            ? formatRuleName(evidenceQuery.data.detection.ruleName)
            : "Detection"
        }
        description={`Detection ${id}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/detections">
              <ChevronLeft className="size-4" />
              Back to detections
            </Link>
          </Button>
        }
      />
      <div className="space-y-6 px-6 pb-6">
        <Card>
          <QueryState
            isPending={evidenceQuery.isPending}
            error={evidenceQuery.error}
            data={evidenceQuery.data}
            emptyTitle="Evidence not found"
          >
            {(evidence) => (
              <>
                <CardContent className="pt-6">
                  <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Rule">
                      {formatRuleName(evidence.detection.ruleName)}
                    </Field>
                    <Field label="Severity">
                      <SeverityBadge severity={evidence.detection.severity} />
                    </Field>
                    <Field label="Status">
                      <StatusBadge status={evidence.detection.status} />
                    </Field>
                    <Field label="Subject user">
                      <span className="font-mono text-xs">
                        {shortId(evidence.subjectUserId)}
                      </span>
                    </Field>
                    <Field label="Occurred at">
                      {formatDateTime(evidence.occurredAt)}
                    </Field>
                    <Field label="Event type">{evidence.eventType}</Field>
                  </dl>
                  <div className="mt-6 space-y-1">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Summary
                    </dt>
                    <dd className="text-sm">{evidence.detection.summary ?? "—"}</dd>
                  </div>
                </CardContent>

                <CardHeader className="border-t">
                  <CardTitle className="text-base">Evidence</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid gap-6 sm:grid-cols-2">
                    <Field label="Active window title">
                      {evidence.metadata.activeWindowTitle ?? "—"}
                    </Field>
                    <Field label="Keystroke count">
                      {evidence.metadata.keystrokeCount ?? "—"}
                    </Field>
                  </dl>
                  <div className="space-y-1">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Captured text
                    </dt>
                    <dd>
                      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-4 font-mono text-xs">
                        {evidence.metadata.capturedText ?? "—"}
                      </pre>
                    </dd>
                  </div>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldAlert className="size-3.5" />
                    Viewing this evidence is logged for audit purposes.
                  </p>
                </CardContent>
              </>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}
