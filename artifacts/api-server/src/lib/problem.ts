// RFC 9457 application/problem+json response helpers.
// API_STANDARD section 2: every error response uses this format.
// Every problem type slug must correspond to an entry in the error catalogue.

import type { Response } from "express";

const PROBLEM_BASE = "https://docs.bheka.io/errors";

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  tenant_id?: string;
  trace_id?: string;
  field_errors?: Array<{ field: string; code: string; message: string }>;
}

export function sendProblem(res: Response, problem: ProblemDetail): void {
  res
    .status(problem.status)
    .contentType("application/problem+json")
    .json(problem);
}

// Canonical error constructors — slugs match API_STANDARD section 2 catalogue.
export const Problems = {
  validationFailed(
    detail: string,
    fieldErrors?: ProblemDetail["field_errors"],
  ): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/validation-failed`,
      title: "Request validation failed",
      status: 400,
      detail,
      field_errors: fieldErrors,
    };
  },

  authRequired(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/authentication-required`,
      title: "Authentication required",
      status: 401,
    };
  },

  stepUpRequired(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/step-up-required`,
      title: "Step-up authentication required",
      status: 401,
      detail:
        "Complete a WebAuthn step-up ceremony and retry. Step-up is valid for 10 minutes.",
    };
  },

  forbidden(detail?: string): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/forbidden`,
      title: "Insufficient permissions",
      status: 403,
      detail,
    };
  },

  notFound(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/not-found`,
      title: "Resource not found",
      status: 404,
    };
  },

  idempotencyKeyRequired(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/idempotency-key-required`,
      title: "Idempotency-Key header required",
      status: 400,
    };
  },

  rateLimited(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/rate-limited`,
      title: "Rate limit exceeded",
      status: 429,
    };
  },

  tierEscalationDenied(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/tier-escalation-denied`,
      title: "Tier escalation requires dual approval",
      status: 403,
      detail:
        "Tier 3 activation requires two distinct approvers, one holding the Information Officer role.",
    };
  },

  internalError(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/internal-error`,
      title: "Internal server error",
      status: 500,
    };
  },
} as const;
