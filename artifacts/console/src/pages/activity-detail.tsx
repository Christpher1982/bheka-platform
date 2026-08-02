import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell";
import { QueryState } from "@/components/states";
import { SeverityBadge, StatusBadge } from "@/components/status-badge";
import { getActivityEvent } from "@/api/resources";
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

export function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();

  const eventQuery = useQuery({
    queryKey: ["activity-event", id],
    queryFn: () => getActivityEvent(id),
  });

  return (
    <>
      <PageHeader
        title="Activity event"
        description={`Event ${id}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/activity">
              <ChevronLeft className="size-4" />
              Back to activity
            </Link>
          </Button>
        }
      />
      <div className="space-y-6 px-6 pb-6">
        <Card>
          <QueryState
            isPending={eventQuery.isPending}
            error={eventQuery.error}
            data={eventQuery.data}
            emptyTitle="Event not found"
          >
            {(event) => (
              <>
                <CardContent className="pt-6">
                  <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Subject user">
                      <span className="font-mono text-xs">
                        {shortId(event.subjectUserId)}
                      </span>
                    </Field>
                    <Field label="Occurred at">
                      {formatDateTime(event.occurredAt)}
                    </Field>
                    <Field label="Event type">{event.eventType}</Field>
                    <Field label="Site">
                      <span className="font-mono text-xs">
                        {shortId(event.siteId)}
                      </span>
                    </Field>
                    <Field label="Source agent">
                      <span className="font-mono text-xs">
                        {shortId(event.sourceAgentId)}
                      </span>
                    </Field>
                  </dl>
                  {event.detection ? (
                    <div className="mt-6 space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Linked detection
                      </dt>
                      <dd className="flex items-center gap-2 text-sm">
                        <SeverityBadge severity={event.detection.severity} />
                        <StatusBadge status={event.detection.status} />
                        <Link
                          href={`/detections/${event.detection.id}`}
                          className="font-medium hover:underline"
                        >
                          {formatRuleName(event.detection.ruleName)}
                        </Link>
                      </dd>
                    </div>
                  ) : null}
                </CardContent>

                <CardHeader className="border-t">
                  <CardTitle className="text-base">Captured data</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {event.eventType === "screenshot_capture" ? (
                    <>
                      <dl className="grid gap-6 sm:grid-cols-2">
                        <Field label="Active window title">
                          {event.metadata.activeWindowTitle ?? "—"}
                        </Field>
                        <Field label="Screenshot dimensions">
                          {event.metadata.screenshotWidth &&
                          event.metadata.screenshotHeight
                            ? `${event.metadata.screenshotWidth} × ${event.metadata.screenshotHeight}`
                            : "—"}
                        </Field>
                      </dl>
                      {event.metadata.screenshotImageBase64 ? (
                        <div className="space-y-1">
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            Screenshot
                          </dt>
                          <dd>
                            <img
                              src={`data:image/jpeg;base64,${event.metadata.screenshotImageBase64}`}
                              alt="Captured screenshot"
                              className="max-w-2xl max-h-[32rem] rounded-md border object-contain"
                            />
                          </dd>
                        </div>
                      ) : null}
                      <div className="space-y-1">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          OCR Text
                        </dt>
                        <dd>
                          {event.metadata.ocrText ? (
                            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-4 font-mono text-xs">
                              {event.metadata.ocrText}
                            </pre>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              No text detected in this screenshot.
                            </p>
                          )}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <dl className="grid gap-6 sm:grid-cols-2">
                        <Field label="Active window title">
                          {event.metadata.activeWindowTitle ?? "—"}
                        </Field>
                        <Field label="Keystroke count">
                          {event.metadata.keystrokeCount ?? "—"}
                        </Field>
                      </dl>
                      <div className="space-y-1">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          Captured text
                        </dt>
                        <dd>
                          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-4 font-mono text-xs">
                            {event.metadata.capturedText ?? "—"}
                          </pre>
                        </dd>
                      </div>
                    </>
                  )}
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
