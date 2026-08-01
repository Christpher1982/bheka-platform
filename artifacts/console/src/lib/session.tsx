import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { getSession } from "@/api/resources";
import type { SessionDto } from "@/api/types";

const SessionContext = createContext<SessionDto | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionDto;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionDto {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return session;
}

export const SESSION_QUERY_KEY = ["session"] as const;

export function useSessionQuery() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: getSession,
    // 401 here is the normal signed-out state, not an error worth surfacing.
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status === 401 ? false : failureCount < 1,
  });
}

// Clears every cached response, not just the session: the next signed-in user
// may be a different tenant and must never see the previous one's rows.
export function useResetSessionCache() {
  const queryClient = useQueryClient();
  return () => queryClient.clear();
}
