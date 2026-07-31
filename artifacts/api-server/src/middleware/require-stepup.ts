// WebAuthn step-up enforcement middleware.
// CANON section 9, 007_RBAC_AND_IDENTITY section 6:
// WebAuthn step-up is required before any Tier 3 evidence view or approval action.
// A valid OIDC session is necessary but not sufficient — a fresh step-up assertion is
// also required. Step-up tokens are short-lived (10 minutes) and user-scoped.
// Attach to every route flagged x-bheka-webauthn-step-up: true in the API spec.

import type { RequestHandler } from "express";
import { redis } from "../lib/redis.js";
import { sendProblem, Problems } from "../lib/problem.js";
import { logger } from "../lib/logger.js";

export function stepUpKey(userId: string): string {
  return `session:stepup:${userId}`;
}

export const requireStepUp: RequestHandler = async (req, res, next) => {
  if (!req.session) {
    sendProblem(res, Problems.authRequired());
    return;
  }

  const satisfied = await redis
    .get(stepUpKey(req.session.userId))
    .catch((err: Error) => {
      logger.error({ err }, "Redis read failed in step-up check");
      return null;
    });

  if (!satisfied) {
    sendProblem(res, Problems.stepUpRequired());
    return;
  }

  next();
};
