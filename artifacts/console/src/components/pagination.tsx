import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageInfo } from "@/api/types";

// The API only offers forward cursors, so going back means remembering the
// cursor that produced each page and popping the stack.
export function useCursorPager() {
  const [history, setHistory] = useState<Array<string | undefined>>([undefined]);

  const cursor = history[history.length - 1];

  const next = useCallback((nextCursor: string) => {
    setHistory((prev) => [...prev, nextCursor]);
  }, []);

  const previous = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const reset = useCallback(() => setHistory([undefined]), []);

  return {
    cursor,
    next,
    previous,
    reset,
    pageNumber: history.length,
    canGoBack: history.length > 1,
  };
}

export function PaginationControls({
  pageInfo,
  pager,
}: {
  pageInfo: PageInfo;
  pager: ReturnType<typeof useCursorPager>;
}) {
  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <span className="text-sm text-muted-foreground">Page {pager.pageNumber}</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={pager.previous}
          disabled={!pager.canGoBack}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => pageInfo.nextCursor && pager.next(pageInfo.nextCursor)}
          disabled={!pageInfo.hasMore || !pageInfo.nextCursor}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
