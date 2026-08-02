import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell";
import { PaginationControls, useCursorPager } from "@/components/pagination";
import { QueryState } from "@/components/states";
import { SeverityBadge, StatusBadge } from "@/components/status-badge";
import { listDetections } from "@/api/resources";
import type { DetectionStatus } from "@/api/types";
import { formatDateTime, formatRuleName, shortId } from "@/lib/format";

const STATUSES: DetectionStatus[] = [
  "new",
  "triaged",
  "resolved",
  "false_positive",
];
const ALL = "all";

export function DetectionsPage() {
  const [status, setStatus] = useState<DetectionStatus | typeof ALL>(ALL);
  const pager = useCursorPager();
  const [, navigate] = useLocation();

  const query = useQuery({
    queryKey: ["detections", status, pager.cursor],
    queryFn: () =>
      listDetections({
        cursor: pager.cursor,
        status: status === ALL ? undefined : status,
      }),
  });

  function handleStatusChange(value: string) {
    setStatus(value as DetectionStatus | typeof ALL);
    pager.reset();
  }

  return (
    <>
      <PageHeader
        title="Detections"
        description="Raised by the rule engine from agent telemetry. Detections are never created through the API."
        actions={
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="px-6 pb-6">
        <Card className="overflow-hidden">
          <QueryState
            isPending={query.isPending}
            error={query.error}
            data={query.data}
            isEmpty={(data) => data.items.length === 0}
            emptyTitle="No detections yet"
            emptyDescription={
              status === ALL
                ? "No rule has fired for this tenant yet."
                : `No detections with status "${status.replace(/_/g, " ")}".`
            }
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Occurred</TableHead>
                      <TableHead>Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((detection) => (
                      <TableRow
                        key={detection.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/detections/${detection.id}`)}
                      >
                        <TableCell>
                          <SeverityBadge severity={detection.severity} />
                        </TableCell>
                        <TableCell className="font-medium hover:underline">
                          {formatRuleName(detection.ruleName)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={detection.status} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(detection.subjectUserId)}
                        </TableCell>
                        <TableCell>
                          {formatDateTime(detection.occurredAt ?? detection.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-md text-muted-foreground">
                          {detection.summary ?? "—"}
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
