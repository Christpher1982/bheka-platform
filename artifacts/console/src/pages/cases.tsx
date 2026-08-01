import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { listCases } from "@/api/resources";
import type { CaseStatus } from "@/api/types";
import { formatDateTime, shortId } from "@/lib/format";

const STATUSES: CaseStatus[] = ["open", "closed", "archived"];
const ALL = "all";

export function CasesPage() {
  const [status, setStatus] = useState<CaseStatus | typeof ALL>(ALL);
  const pager = useCursorPager();

  const query = useQuery({
    queryKey: ["cases", status, pager.cursor],
    queryFn: () =>
      listCases({
        cursor: pager.cursor,
        status: status === ALL ? undefined : status,
      }),
  });

  function handleStatusChange(value: string) {
    setStatus(value as CaseStatus | typeof ALL);
    // Cursors are position-dependent: a new filter invalidates the page stack.
    pager.reset();
  }

  return (
    <>
      <PageHeader
        title="Cases"
        description="Investigations opened within this tenant."
        actions={
          <>
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
            <Button asChild>
              <Link href="/cases/new">
                <Plus className="size-4" />
                New case
              </Link>
            </Button>
          </>
        }
      />
      <div className="px-6 pb-6">
        <Card className="overflow-hidden">
          <QueryState
            isPending={query.isPending}
            error={query.error}
            data={query.data}
            isEmpty={(data) => data.items.length === 0}
            emptyTitle="No cases"
            emptyDescription={
              status === ALL
                ? "No cases have been opened for this tenant yet."
                : `No cases with status "${status}".`
            }
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Opened</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((kase) => (
                      <TableRow key={kase.id}>
                        <TableCell>
                          <Link
                            href={`/cases/${kase.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {kase.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={kase.status} />
                        </TableCell>
                        <TableCell>{kase.currentTier}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(kase.subjectUserId)}
                        </TableCell>
                        <TableCell>{formatDateTime(kase.createdAt)}</TableCell>
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
