import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { StatusBadge } from "@/components/status-badge";
import { listDetections } from "@/api/resources";
import type { DetectionStatus } from "@/api/types";
import { formatDateTime, shortId } from "@/lib/format";

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
        description="Written by bheka-policy from telemetry. Detections are never created through the API."
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
            emptyTitle="No detections"
            emptyDescription="No policy rule has fired for this tenant yet."
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Detection</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Source events</TableHead>
                      <TableHead>Raised</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((detection) => (
                      <TableRow key={detection.id}>
                        <TableCell className="font-mono text-xs">
                          {shortId(detection.id)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={detection.status} />
                        </TableCell>
                        <TableCell>{detection.tier}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(detection.subjectUserId)}
                        </TableCell>
                        <TableCell>{detection.sourceEventIds.length}</TableCell>
                        <TableCell>{formatDateTime(detection.createdAt)}</TableCell>
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
