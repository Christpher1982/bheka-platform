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

  notFound(detail?: string): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/not-found`,
      title: "Resource not found",
      status: 404,
      detail,
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

  invalidEnrolmentToken(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/invalid-enrolment-token`,
      title: "Enrolment token invalid or expired",
      status: 401,
      detail:
        "The enrolment token is missing, expired, or has already been used. " +
        "Single-use tokens are consumed on first use. Obtain a new token via the console.",
    };
  },

  agentAuthRequired(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/agent-authentication-required`,
      title: "Agent mTLS authentication required",
      status: 401,
      detail:
        "This endpoint requires a valid agent mTLS certificate. " +
        "Ensure the X-Agent-Cert-Fingerprint header is set by the TLS-terminating proxy.",
    };
  },

  agentTokenRequired(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/agent-authentication-required`,
      title: "Agent token authentication required",
      status: 401,
      detail:
        "This endpoint requires a valid shared ingest token in the X-Agent-Token header.",
    };
  },

  vaultUnavailable(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/vault-unavailable`,
      title: "Vault service unavailable",
      status: 503,
      detail:
        "The Eride Vault service is not deployed or not reachable. " +
        "Agent enrolment requires Vault for certificate issuance.",
    };
  },

  ringAlreadyFinal(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/ring-already-final`,
      title: "Version already at final ring",
      status: 409,
      detail:
        "This agent version is already at ring_3 (fully rolled out). " +
        "There is no further ring to advance to.",
    };
  },

  cryptoShredded(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/crypto-shredded`,
      title: "Evidence permanently unrecoverable",
      status: 410,
      detail:
        "The encryption key covering this evidence has been destroyed (POPIA s14 retention " +
        "enforcement). The evidence payload is permanently unrecoverable. " +
        "Metadata and audit records remain intact.",
    };
  },

  evidenceAccessDenied(): ProblemDetail {
    return {
      type: `${PROBLEM_BASE}/evidence-access-denied`,
      title: "Evidence access not authorised",
      status: 403,
      detail:
        "You do not hold a valid access grant for this evidence item. " +
        "Tier 3 evidence requires an explicit time-bounded grant. " +
        "Request access via the case approval workflow.",
    };
  },
} as const;
