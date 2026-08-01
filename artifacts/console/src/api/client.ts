// Hand-written fetch wrapper for the bheka-gateway REST API.
//
// The OpenAPI spec at lib/api-spec only describes /healthz, so the generated
// hooks in lib/api-client-react cannot express these routes. Until the spec is
// authored properly, requests are made directly against the Express routes.

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  trace_id?: string;
  field_errors?: Array<{ field: string; code: string; message: string }>;
}

// RFC 9457 error from the API, or a transport failure normalised into the same shape.
export class ApiError extends Error {
  readonly problem: ProblemDetail;

  constructor(problem: ProblemDetail) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }
}

// Default matches the api-server's own default PORT (see src/lib/config.ts).
// Set VITE_API_BASE_URL="" to talk to a same-origin /api mount instead.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

export type QueryParams = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, params?: QueryParams): string {
  const url = `${API_BASE_URL}/api${path}`;
  if (!params) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toProblem(res: Response): Promise<ProblemDetail> {
  try {
    const body: unknown = await res.json();
    if (
      body !== null &&
      typeof body === "object" &&
      "title" in body &&
      "status" in body
    ) {
      return body as ProblemDetail;
    }
  } catch {
    // Non-JSON body (proxy error page, empty response) — fall through.
  }
  return {
    type: "about:blank",
    title: res.statusText || "Request failed",
    status: res.status,
  };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: QueryParams;
  // Mutating routes require Idempotency-Key; the caller supplies one per attempt.
  idempotencyKey?: string;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, params, idempotencyKey } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      // Sends and accepts the bheka_sid session cookie cross-origin. Requires
      // the API server's ALLOWED_ORIGINS to include this app's origin.
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError({
      type: "about:blank",
      title: "Cannot reach the API server",
      status: 0,
      detail:
        `Network request to ${API_BASE_URL} failed. Check that the API server ` +
        `is running and that ALLOWED_ORIGINS includes ${window.location.origin}.`,
    });
  }

  if (!res.ok) throw new ApiError(await toProblem(res));

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
