import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell";
import { QueryState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { getCase, listCaseParticipants } from "@/api/resources";
import { formatDateTime } from "@/lib/format";

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

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();

  const caseQuery = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => getCase(caseId),
  });

  const participantsQuery = useQuery({
    queryKey: ["case-participants", caseId],
    queryFn: () => listCaseParticipants(caseId),
  });

  return (
    <>
      <PageHeader
        title={caseQuery.data?.title ?? "Case"}
        description={`Case ${caseId}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/cases">
              <ChevronLeft className="size-4" />
              Back to cases
            </Link>
          </Button>
        }
      />
      <div className="space-y-6 px-6 pb-6">
        <Card>
          <QueryState
            isPending={caseQuery.isPending}
            error={caseQuery.error}
            data={caseQuery.data}
            emptyTitle="Case not found"
          >
            {(kase) => (
              <CardContent className="pt-6">
                <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Status">
                    <StatusBadge status={kase.status} />
                  </Field>
                  <Field label="Current tier">{kase.currentTier}</Field>
                  <Field label="Subject user">
                    <span className="font-mono text-xs">{kase.subjectUserId}</span>
                  </Field>
                  <Field label="Opened by">
                    <span className="font-mono text-xs">{kase.openedByUserId}</span>
                  </Field>
                  <Field label="Opened at">{formatDateTime(kase.createdAt)}</Field>
                  <Field label="Last updated">
                    {formatDateTime(kase.updatedAt)}
                  </Field>
                  <Field label="Closed at">{formatDateTime(kase.closedAt)}</Field>
                  <Field label="Closed by">
                    <span className="font-mono text-xs">
                      {kase.closedByUserId ?? "—"}
                    </span>
                  </Field>
                </dl>
                <div className="mt-6 space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Description
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm">
                    {kase.description ?? "—"}
                  </dd>
                </div>
              </CardContent>
            )}
          </QueryState>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Participants</CardTitle>
          </CardHeader>
          <QueryState
            isPending={participantsQuery.isPending}
            error={participantsQuery.error}
            data={participantsQuery.data}
            isEmpty={(data) => data.items.length === 0}
            emptyTitle="No participants"
            emptyDescription="Nobody has been added to this case yet."
          >
            {(data) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Added by</TableHead>
                    <TableHead>Added at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((participant) => (
                    <TableRow key={participant.id}>
                      <TableCell className="font-mono text-xs">
                        {participant.userId}
                      </TableCell>
                      <TableCell>{participant.role}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {participant.addedByUserId ?? "—"}
                      </TableCell>
                      <TableCell>{formatDateTime(participant.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}
