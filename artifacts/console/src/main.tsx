import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
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

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
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
