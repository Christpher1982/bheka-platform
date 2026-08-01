import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  hashKey,
} from "@tanstack/react-query";
import App from "./App";
import { ApiError } from "./api/client";
import { SESSION_QUERY_KEY } from "./lib/session";
import "./index.css";

// A 401 from any request means the session expired or was revoked. Re-checking
// the session query is what sends the user to the login page — every view is
// rendered underneath it.
function handleUnauthorized(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }
}

const SESSION_QUERY_HASH = hashKey(SESSION_QUERY_KEY);

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // The session query's own 401 IS the signed-out state, and useSessionQuery
      // already settles it there without retrying. Invalidating it from here
      // would refetch it straight into another 401 and re-enter this callback —
      // an endless loop that keeps the query pending, so App never gets past
      // its isPending skeleton to render the login page.
      if (query.queryHash === SESSION_QUERY_HASH) return;
      handleUnauthorized(error);
    },
  }),
  // Mutations carry no session query key to collide with: the only 401 a
  // mutation can raise means the session died mid-use, which is exactly the
  // case this should re-check. (dev-login answers 404/422 for a bad email, and
  // logout swallows its own errors before they reach this cache.)
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // A 4xx will not resolve itself: retrying only delays the error state.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status >= 400 && error.status < 500
          ? false
          : failureCount < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
