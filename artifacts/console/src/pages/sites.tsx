import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import { listSites } from "@/api/resources";
import { formatDateTime } from "@/lib/format";

export function SitesPage() {
  const pager = useCursorPager();

  const query = useQuery({
    queryKey: ["sites", pager.cursor],
    queryFn: () => listSites({ cursor: pager.cursor }),
  });

  return (
    <>
      <PageHeader
        title="Sites"
        description="Physical or logical locations. The bandwidth threshold is the point below which agents at a site switch to low-bandwidth mode."
      />
      <div className="px-6 pb-6">
        <Card className="overflow-hidden">
          <QueryState
            isPending={query.isPending}
            error={query.error}
            data={query.data}
            isEmpty={(data) => data.items.length === 0}
            emptyTitle="No sites"
            emptyDescription="No sites have been created for this tenant yet."
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Timezone</TableHead>
                      <TableHead>Low-bandwidth threshold</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((site) => (
                      <TableRow key={site.id}>
                        <TableCell>
                          <div className="font-medium">{site.name}</div>
                          {site.description ? (
                            <div className="text-xs text-muted-foreground">
                              {site.description}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>{site.timezone}</TableCell>
                        <TableCell>{site.lowBandwidthThresholdKbps} kbps</TableCell>
                        <TableCell>
                          <Badge variant={site.active ? "default" : "outline"}>
                            {site.active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDateTime(site.createdAt)}</TableCell>
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
