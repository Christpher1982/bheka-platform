import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { listRoleAssignments, listRoles, listUsers } from "@/api/resources";
import type { UserDto } from "@/api/types";
import { formatDateTime, fullName } from "@/lib/format";

// GET /v1/users does not join role assignments, so each visible row needs its
// own GET /v1/users/:userId/role-assignments call. Bounded by the page size.
function RoleAssignmentCell({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ["role-assignments", userId],
    queryFn: () => listRoleAssignments(userId),
  });

  if (query.isPending) return <Skeleton className="h-5 w-24" />;
  if (query.error) {
    return <span className="text-xs text-destructive">Failed to load roles</span>;
  }
  if (query.data.items.length === 0) {
    return <span className="text-xs text-muted-foreground">No roles</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {query.data.items.map((assignment) => (
        <Badge key={assignment.id} variant="secondary">
          {assignment.roleDisplayName}
        </Badge>
      ))}
    </div>
  );
}

function UsersCard() {
  const pager = useCursorPager();

  const query = useQuery({
    queryKey: ["users", pager.cursor],
    queryFn: () => listUsers({ cursor: pager.cursor }),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">Users</CardTitle>
        <CardDescription>
          Everyone provisioned into this tenant, with the roles they currently hold.
        </CardDescription>
      </CardHeader>
      <QueryState
        isPending={query.isPending}
        error={query.error}
        data={query.data}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No users"
        emptyDescription="No users have been provisioned for this tenant yet."
      >
        {(data) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Provisioned via</TableHead>
                  <TableHead>WebAuthn</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((user: UserDto) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{fullName(user)}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <RoleAssignmentCell userId={user.id} />
                    </TableCell>
                    <TableCell>{user.provisionedVia}</TableCell>
                    <TableCell>
                      <Badge variant={user.webauthnEnrolled ? "default" : "outline"}>
                        {user.webauthnEnrolled ? "enrolled" : "not enrolled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(user.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls pageInfo={data.pageInfo} pager={pager} />
          </>
        )}
      </QueryState>
    </Card>
  );
}

function RolesCard() {
  const query = useQuery({ queryKey: ["roles"], queryFn: listRoles });

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">Roles</CardTitle>
        <CardDescription>
          The canonical system roles. Read-only: role definitions are seeded, not
          editable from the console.
        </CardDescription>
      </CardHeader>
      <QueryState
        isPending={query.isPending}
        error={query.error}
        data={query.data}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No roles"
        emptyDescription="The roles table has not been seeded."
      >
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">{role.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{role.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {role.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryState>
    </Card>
  );
}

export function UsersPage() {
  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Tenant roster and the canonical role catalogue."
      />
      <div className="space-y-6 px-6 pb-6">
        <UsersCard />
        <RolesCard />
      </div>
    </>
  );
}
