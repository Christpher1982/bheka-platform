import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
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
import { listApprovals } from "@/api/resources";
import type { ApprovalStatus } from "@/api/types";
import { formatDateTime, shortId } from "@/lib/format";

const STATUSES: ApprovalStatus[] = ["pending", "granted", "denied", "expired"];
const ALL = "all";

export function ApprovalsPage() {
  const [status, setStatus] = useState<ApprovalStatus | typeof ALL>(ALL);
  const pager = useCursorPager();

  const query = useQuery({
    queryKey: ["approvals", status, pager.cursor],
    queryFn: () =>
      listApprovals({
        cursor: pager.cursor,
        status: status === ALL ? undefined : status,
      }),
  });

  function handleStatusChange(value: string) {
    setStatus(value as ApprovalStatus | typeof ALL);
    pager.reset();
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Dual-authorisation requests. Granting and denying require a WebAuthn step-up ceremony and are not yet available in the console."
        actions={
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
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
            emptyTitle="No approvals"
            emptyDescription="Nothing is awaiting authorisation. Approvals are created by tier-escalation requests."
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Case</TableHead>
                      <TableHead>Approver</TableHead>
                      <TableHead>Requested by</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Decided</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((approval) => (
                      <TableRow key={approval.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{approval.subjectType.replace(/_/g, " ")}</span>
                            {approval.isInformationOfficerApproval ? (
                              <Badge variant="outline">IO slot</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={approval.status} />
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/cases/${approval.caseId}`}
                            className="font-mono text-xs underline-offset-4 hover:underline"
                          >
                            {shortId(approval.caseId)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(approval.approverUserId)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(approval.requestedByUserId)}
                        </TableCell>
                        <TableCell>{formatDateTime(approval.expiresAt)}</TableCell>
                        <TableCell>{formatDateTime(approval.decisionAt)}</TableCell>
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
