// Agent telemetry ingest — machine-to-machine, no user session.
//
// Routes:
//   POST /v1/agent/events    — ingest one activity event (X-Agent-Token)
//
// The agent posts a single activity event. We persist it, run the v0 rule engine
// (src/rules/evaluate.ts) synchronously, and persist a detection if a rule fires.
//
// Synchronous evaluation is a v0 choice: it keeps the agent's feedback loop
// simple and avoids standing up a queue. It also means ingest latency is bounded
// by rule cost, so rules must stay cheap and side-effect free. When rules need
// history or correlation this moves behind NATS and bheka-policy.
//
// Tenant is taken from the request body rather than from the caller's identity
// because the shared ingest token is not tenant-scoped. Every referenced entity
// is therefore re-checked against the resolved tenant below — without that, a
// token holder could stitch one tenant's site onto another tenant's user.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  activityEventsTable,
  agentsTable,
  detectionsTable,
  sitesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireAgentToken } from "../../middleware/require-agent-token.js";
import { evaluateEvent } from "../../rules/evaluate.js";

const router: IRouter = Router();

const EventMetadata = z
  .object({
    keystrokeCount: z.number().int().nonnegative().optional(),
    activeWindowTitle: z.string().max(2000).optional(),
    capturedText: z.string().max(100_000).optional(),
  })
  .passthrough();

const IngestEventBody = z.object({
  tenantSlug: z.string().min(1),
  siteId: z.string().uuid(),
  subjectUserId: z.string().uuid(),
  sourceAgentId: z.string().uuid(),
  eventType: z.string().min(1).max(200),
  occurredAt: z.coerce.date(),
  metadata: EventMetadata,
});

router.post(
  "/v1/agent/events",
  requireAgentToken,
  async (req, res): Promise<void> => {
    const parsed = IngestEventBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(
        res,
        Problems.validationFailed(
          parsed.error.message,
          parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            code: i.code,
            message: i.message,
          })),
        ),
      );
      return;
    }

    const {
      tenantSlug,
      siteId,
      subjectUserId,
      sourceAgentId,
      eventType,
      occurredAt,
      metadata,
    } = parsed.data;

    // Resolved outside withTenantContext: we do not have a tenant id yet, and
    // the tenants lookup is by unique slug.
    const [tenant] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, tenantSlug))
      .limit(1);

    if (!tenant) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const tenantId = tenant.id;

    const result = await withTenantContext(tenantId, async (tx) => {
      // All three must belong to the resolved tenant. A mismatch means the
      // caller supplied an id from another tenant, so it is a 404, not a 500.
      // Sequential, not Promise.all: these share one transaction connection.
      const [site] = await tx
        .select({ id: sitesTable.id })
        .from(sitesTable)
        .where(and(eq(sitesTable.id, siteId), eq(sitesTable.tenantId, tenantId)))
        .limit(1);

      const [subject] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, subjectUserId),
            eq(usersTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      const [agent] = await tx
        .select({ id: agentsTable.id, active: agentsTable.active })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.id, sourceAgentId),
            eq(agentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!site || !subject || !agent?.active) return null;

      const [event] = await tx
        .insert(activityEventsTable)
        .values({
          tenantId,
          siteId,
          subjectUserId,
          sourceAgentId,
          eventType,
          occurredAt,
          metadata,
        })
        .returning({ id: activityEventsTable.id });

      const match = evaluateEvent({ eventType, occurredAt, metadata });
      if (!match) return { eventId: event!.id, detectionId: null };

      const [detection] = await tx
        .insert(detectionsTable)
        .values({
          tenantId,
          siteId,
          subjectUserId,
          ruleName: match.ruleName,
          severity: match.severity,
          summary: match.summary,
          tier: match.tier,
          sourceEventId: event!.id,
          occurredAt,
        })
        .returning({ id: detectionsTable.id });

      return { eventId: event!.id, detectionId: detection!.id };
    });

    if (!result) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.status(201).json({
      eventId: result.eventId,
      detectionCreated: result.detectionId !== null,
      ...(result.detectionId ? { detectionId: result.detectionId } : {}),
    });
  },
);

export default router;
