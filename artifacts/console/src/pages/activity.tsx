import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app-shell";
import { PaginationControls, useCursorPager } from "@/components/pagination";
import { QueryState } from "@/components/states";
import { listActivityEvents } from "@/api/resources";
import { formatDateTime, formatDurationSeconds, shortId } from "@/lib/format";

export function ActivityPage() {
  const pager = useCursorPager();
  const [, navigate] = useLocation();

  const query = useQuery({
    queryKey: ["activity-events", pager.cursor],
    queryFn: () => listActivityEvents({ cursor: pager.cursor }),
  });

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every captured event, whether or not it triggered a rule. Everything typed is stored here regardless of rule matches."
      />
      <div className="px-6 pb-6">
        <Card className="overflow-hidden">
          <QueryState
            isPending={query.isPending}
            error={query.error}
            data={query.data}
            isEmpty={(data) => data.items.length === 0}
            emptyTitle="No activity captured yet"
            emptyDescription="No agent has reported any events for this tenant yet."
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Occurred</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Window Title</TableHead>
                      <TableHead>Keystrokes / Duration</TableHead>
                      <TableHead>Detection</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((event) => (
                      <TableRow
                        key={event.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/activity/${event.id}`)}
                      >
                        <TableCell>{formatDateTime(event.occurredAt)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(event.subjectUserId)}
                        </TableCell>
                        <TableCell className="max-w-md text-muted-foreground">
                          {event.activeWindowTitle ?? "—"}
                        </TableCell>
                        <TableCell>
                          {event.eventType === "screenshot_capture" ? (
                            <Badge variant="secondary">Screenshot</Badge>
                          ) : event.eventType === "app_usage_session" ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">
                                {event.isBrowser ? "Browser" : "App"}
                              </Badge>
                              <span className="text-muted-foreground">
                                {formatDurationSeconds(event.durationSeconds)}
                              </span>
                            </div>
                          ) : (
                            (event.keystrokeCount ?? "—")
                          )}
                        </TableCell>
                        <TableCell>
                          {event.hasDetection ? (
                            <Badge variant="destructive">Detection</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <PaginationControls pageInfo={data.pageInfo} pager={pager} />
              </>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}
