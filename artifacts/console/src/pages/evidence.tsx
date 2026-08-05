import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/app-shell";
import { PaginationControls, useCursorPager } from "@/components/pagination";
import { QueryState } from "@/components/states";
import { evidenceImageUrl, listEvidenceImages, listSites } from "@/api/resources";
import type { EvidenceImageDto } from "@/api/types";
import { formatDateTime, shortId } from "@/lib/format";

const ALL = "all";

// Thumbnail + full image both point at the same GET /v1/evidence-images/:id/image
// route. There is no separate thumbnail asset (see evidence-storage.ts on the
// api-server) — the browser downscales for the grid via object-contain sizing.
// Every render of an <img> here therefore triggers a decrypt + audit_log write
// server-side, same as opening an activity event or evidence file elsewhere in
// the console; this is expected, not a bug, for a Tier 1/2 surface like this.
function Thumbnail({ image }: { image: EvidenceImageDto }) {
  return (
    <img
      src={evidenceImageUrl(image.id)}
      alt={`Screenshot captured ${formatDateTime(image.occurredAt)}`}
      loading="lazy"
      className="aspect-video w-full rounded-t-md border-b object-cover bg-muted"
    />
  );
}

function EvidenceLightbox({
  image,
  onClose,
}: {
  image: EvidenceImageDto | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        {image ? (
          <>
            <DialogHeader>
              <DialogTitle>Captured {formatDateTime(image.occurredAt)}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:col-span-2 sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Site
                  </dt>
                  <dd className="font-mono text-xs">{shortId(image.siteId)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Subject
                  </dt>
                  <dd className="font-mono text-xs">{shortId(image.subjectUserId)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Agent
                  </dt>
                  <dd className="font-mono text-xs">{shortId(image.sourceAgentId)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Dimensions
                  </dt>
                  <dd>
                    {image.width && image.height
                      ? `${image.width} × ${image.height}`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <img
                src={evidenceImageUrl(image.id)}
                alt={`Screenshot captured ${formatDateTime(image.occurredAt)}`}
                className="max-h-[28rem] w-full rounded-md border object-contain sm:col-span-2"
              />
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  OCR text
                </dt>
                <dd>
                  {image.ocrText ? (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-4 font-mono text-xs">
                      {image.ocrText}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No text detected in this screenshot.
                    </p>
                  )}
                </dd>
              </div>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="size-3.5" />
              Viewing this evidence is logged for audit purposes.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function EvidencePage() {
  const [siteId, setSiteId] = useState<string>(ALL);
  const [subjectUserId, setSubjectUserId] = useState("");
  const [sourceAgentId, setSourceAgentId] = useState("");
  const [selected, setSelected] = useState<EvidenceImageDto | null>(null);
  const pager = useCursorPager();

  const sitesQuery = useQuery({
    queryKey: ["sites", "for-evidence-filter"],
    queryFn: () => listSites({ limit: 200 }),
  });

  const query = useQuery({
    queryKey: ["evidence-images", siteId, subjectUserId, sourceAgentId, pager.cursor],
    queryFn: () =>
      listEvidenceImages({
        cursor: pager.cursor,
        siteId: siteId === ALL ? undefined : siteId,
        subjectUserId: subjectUserId.trim() || undefined,
        sourceAgentId: sourceAgentId.trim() || undefined,
      }),
  });

  function handleSiteChange(value: string) {
    setSiteId(value);
    pager.reset();
  }

  return (
    <>
      <PageHeader
        title="Evidence"
        description="Screenshots captured by enrolled agents, decrypted on view and logged to the audit trail."
        actions={
          <div className="flex items-center gap-2">
            <Select value={siteId} onValueChange={handleSiteChange}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sites</SelectItem>
                {sitesQuery.data?.items.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Subject user ID"
              value={subjectUserId}
              onChange={(e) => {
                setSubjectUserId(e.target.value);
                pager.reset();
              }}
              className="w-44 font-mono text-xs"
            />
            <Input
              placeholder="Agent ID"
              value={sourceAgentId}
              onChange={(e) => {
                setSourceAgentId(e.target.value);
                pager.reset();
              }}
              className="w-44 font-mono text-xs"
            />
          </div>
        }
      />
      <div className="px-6 pb-6">
        <Card className="overflow-hidden">
          <QueryState
            isPending={query.isPending}
            error={query.error}
            data={query.data}
            isEmpty={(data) => data.items.length === 0}
            emptyTitle="No evidence captured yet"
            emptyDescription="No agent has uploaded a screenshot for this tenant yet, or none match the current filters."
          >
            {(data) => (
              <>
                <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {data.items.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setSelected(image)}
                      className="group flex flex-col overflow-hidden rounded-md border text-left hover-elevate"
                    >
                      {image.byteSize > 0 ? (
                        <Thumbnail image={image} />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center border-b bg-muted">
                          <ImageOff className="size-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="space-y-1 p-2">
                        <p className="text-xs font-medium">
                          {formatDateTime(image.occurredAt)}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          Subject {shortId(image.subjectUserId)} · Agent{" "}
                          {shortId(image.sourceAgentId)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                <PaginationControls pageInfo={data.pageInfo} pager={pager} />
              </>
            )}
          </QueryState>
        </Card>
      </div>
      <EvidenceLightbox image={selected} onClose={() => setSelected(null)} />
    </>
  );
}
