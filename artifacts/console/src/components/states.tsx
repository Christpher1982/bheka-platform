import type { ReactNode } from "react";
import { AlertCircle, Inbox, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/api/client";

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <Inbox className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

// Renders an RFC 9457 problem document as readable prose. Anything that is not
// an ApiError (a render-time bug, say) still gets its message shown rather than
// collapsing the page to blank.
export function ErrorState({ error }: { error: unknown }) {
  const problem = error instanceof ApiError ? error.problem : null;
  const forbidden = problem?.status === 403;

  return (
    <div className="p-4">
      <Alert variant="destructive">
        {forbidden ? (
          <ShieldAlert className="size-4" />
        ) : (
          <AlertCircle className="size-4" />
        )}
        <AlertTitle>
          {problem
            ? `${problem.status ? `${problem.status} — ` : ""}${problem.title}`
            : "Something went wrong"}
        </AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            {problem?.detail ??
              (error instanceof Error ? error.message : String(error))}
          </p>
          {problem?.field_errors?.length ? (
            <ul className="list-disc pl-4">
              {problem.field_errors.map((fe) => (
                <li key={`${fe.field}-${fe.code}`}>
                  <span className="font-mono">{fe.field}</span>: {fe.message}
                </li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}

// Single place that decides between the loading, error, empty and data states so
// every list and detail view behaves identically.
export function QueryState<T>({
  isPending,
  error,
  data,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  isPending: boolean;
  error: unknown;
  data: T | undefined;
  isEmpty?: (data: T) => boolean;
  emptyTitle: string;
  emptyDescription?: string;
  children: (data: T) => ReactNode;
}) {
  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} />;
  if (data === undefined) return <ErrorState error={new Error("No data returned")} />;
  if (isEmpty?.(data)) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return <>{children(data)}</>;
}
