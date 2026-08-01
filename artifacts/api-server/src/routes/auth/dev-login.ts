// Development-only login shortcut.
// Creates a bheka_sid session directly from a user's email — no OIDC round-trip.
// GATED to NODE_ENV=development: returns 404 in every other environment so this
// route can never be reachable in staging or production, regardless of routing
// mistakes elsewhere.
//
// Usage:
//   POST /api/v1/auth/dev-login
//   Body: { "email": "admin@eride-technologies.test" }
//   -> sets the bheka_sid cookie exactly like GET /api/v1/auth/callback does.
//
// Intended to unblock local API testing (Postman/curl) before an OIDC
// identity provider is configured. See scripts/src/seed-dev.ts for the seeded
// admin user this is designed to be used with.

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "../../middleware/session.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { logger } from "../../lib/logger.js";

const DevLoginBody = z.object({ email: z.string().email() });

const router: IRouter = Router();

router.post("/v1/auth/dev-login", async (req, res): Promise<void> => {
  // Hard gate — evaluated per-request, not just at router registration time.
  if (process.env.NODE_ENV !== "development") {
    sendProblem(res, Problems.notFound());
    return;
  }

  const parsed = DevLoginBody.safeParse(req.body);
  if (!parsed.success) {
    sendProblem(
      res,
      Problems.validationFailed("Body must be { email: string }"),
    );
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email))
    .limit(1);

  if (!user) {
    sendProblem(res, Problems.notFound());
    return;
  }

  const sid = await createSession({
    userId: user.id,
    tenantId: user.tenantId,
    mfaSatisfied: true,
    stepUpSatisfiedAt: null,
  });

  await writeAuditLog({
    tenantId: user.tenantId,
    actorId: user.id,
    actorType: "user",
    action: "user.authenticated",
    targetType: "user",
    targetId: user.id,
    metadata: { method: "dev-login" },
  }).catch((err) => {
    // Non-fatal for this dev-only route: don't block local testing on the
    // audit hash-chain, but do surface the failure loudly.
    logger.warn({ err }, "dev-login: audit log write failed");
  });

  res.cookie(SESSION_COOKIE, sid, SESSION_COOKIE_OPTIONS);
  res.status(200).json({ userId: user.id, tenantId: user.tenantId });
});

export default router;
