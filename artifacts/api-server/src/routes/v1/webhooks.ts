// Webhooks routes — 009_API_SURFACE section 12.
//
// Routes:
//   GET    /v1/webhooks                  — list (security_administrator)
//   POST   /v1/webhooks                  — create; returns signing secret ONCE
//   GET    /v1/webhooks/:webhookId        — single (secret_hash NEVER returned)
//   PATCH  /v1/webhooks/:webhookId        — update; optionally rotate secret
//   DELETE /v1/webhooks/:webhookId        — deactivate
//
// The webhook signing secret is write-only (009_API_SURFACE section 12):
//   • POST returns signingSecret in the 201 body — the ONLY time the raw value is visible.
//   • PATCH with a new secret returns signingSecret once; subsequent GETs do not.
//   • GET and PATCH (without secret rotation) NEVER include secretHash or signingSecret.
//
// The secret is hashed with Argon2id before storage (same library as password hashing).
// URL must be https:// only — enforced by DB CHECK and API validation.
//
// KEY stream events (bheka.key.rotated.v1, bheka.key.shredded.v1) are never eligible
// for webhook delivery (010_EVENT_BUS_AND_TOPICS section 1). The gateway does not
// enforce this at subscription-time (bheka-deliver owns the filter), but a list of
// prohibited events is noted here for documentation.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";
import { webhooksTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";

const router: IRouter = Router();

// Topics forbidden from webhook delivery (KEY stream per 010_EVENT_BUS_AND_TOPICS §1).
const KEY_STREAM_TOPICS = new Set([
  "bheka.key.rotated.v1",
  "bheka.key.shredded.v1",
]);

// ── GET /v1/webhooks ─────────────────────────────────────────────────────────

router.get(
  "/v1/webhooks",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: webhooksTable.id,
          url: webhooksTable.url,
          events: webhooksTable.events,
          active: webhooksTable.active,
          createdAt: webhooksTable.createdAt,
          updatedAt: webhooksTable.updatedAt,
          // secretHash intentionally excluded from select.
        })
        .from(webhooksTable)
        .where(eq(webhooksTable.tenantId, tenantId))
        .orderBy(webhooksTable.id),
    );

    res.json({ items: rows });
  },
);

// ── POST /v1/webhooks ────────────────────────────────────────────────────────
// The signing secret is generated server-side and returned ONCE in the response.
// Clients must store it; subsequent GETs do not include it.

const CreateWebhookBody = z.object({
  url: z.string().url().startsWith("https://", "URL must be https://"),
  events: z.array(z.string()).min(1),
});

router.post(
  "/v1/webhooks",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateWebhookBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    // Reject any attempt to subscribe to KEY stream events.
    const forbidden = parsed.data.events.filter((e) => KEY_STREAM_TOPICS.has(e));
    if (forbidden.length > 0) {
      sendProblem(res, Problems.validationFailed(
        `KEY stream events are not eligible for webhook delivery: ${forbidden.join(", ")}`,
      ));
      return;
    }

    // Generate a cryptographically random signing secret (32 bytes → 64 hex chars).
    const signingSecret = randomBytes(32).toString("hex");
    const secretHash = await argon2Hash(signingSecret);

    const [webhook] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(webhooksTable)
        .values({ tenantId, ...parsed.data, secretHash })
        .returning({
          id: webhooksTable.id,
          url: webhooksTable.url,
          events: webhooksTable.events,
          active: webhooksTable.active,
          createdAt: webhooksTable.createdAt,
          updatedAt: webhooksTable.updatedAt,
        }),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "webhook.created",
      targetType: "webhook",
      targetId: webhook!.id,
      requestId: String(idempotencyKey),
      metadata: { url: parsed.data.url, eventCount: parsed.data.events.length },
    });

    res.status(201).json({
      id: webhook!.id,
      tenantId,
      url: webhook!.url,
      events: webhook!.events,
      active: webhook!.active,
      // signingSecret: returned ONCE at creation. Store it — this is the only time it is visible.
      signingSecret,
      createdAt: webhook!.createdAt,
      updatedAt: webhook!.updatedAt,
    });
  },
);

// ── GET /v1/webhooks/:webhookId ──────────────────────────────────────────────

router.get(
  "/v1/webhooks/:webhookId",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const webhookId = req.params.webhookId as string;

    const [webhook] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: webhooksTable.id,
          url: webhooksTable.url,
          events: webhooksTable.events,
          active: webhooksTable.active,
          createdAt: webhooksTable.createdAt,
          updatedAt: webhooksTable.updatedAt,
          // secretHash excluded.
        })
        .from(webhooksTable)
        .where(
          and(
            eq(webhooksTable.id, webhookId),
            eq(webhooksTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!webhook) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: webhook.id,
      tenantId,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    });
  },
);

// ── PATCH /v1/webhooks/:webhookId ────────────────────────────────────────────
// If rotateSecret is true, a new signing secret is generated and returned.

const PatchWebhookBody = z.object({
  url: z.string().url().startsWith("https://", "URL must be https://").optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

router.patch(
  "/v1/webhooks/:webhookId",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;
    const webhookId = req.params.webhookId as string;

    const parsed = PatchWebhookBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    if (Object.keys(parsed.data).length === 0) {
      sendProblem(res, Problems.validationFailed("Request body must contain at least one field to update"));
      return;
    }

    const { rotateSecret, ...fieldsToUpdate } = parsed.data;

    if (fieldsToUpdate.events) {
      const forbidden = fieldsToUpdate.events.filter((e) => KEY_STREAM_TOPICS.has(e));
      if (forbidden.length > 0) {
        sendProblem(res, Problems.validationFailed(
          `KEY stream events are not eligible for webhook delivery: ${forbidden.join(", ")}`,
        ));
        return;
      }
    }

    let newSigningSecret: string | undefined;
    let secretHashUpdate: Record<string, string> = {};

    if (rotateSecret) {
      newSigningSecret = randomBytes(32).toString("hex");
      secretHashUpdate = { secretHash: await argon2Hash(newSigningSecret) };
    }

    const now = new Date();
    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(webhooksTable)
        .set({ ...fieldsToUpdate, ...secretHashUpdate, updatedAt: now })
        .where(
          and(
            eq(webhooksTable.id, webhookId),
            eq(webhooksTable.tenantId, tenantId),
          ),
        )
        .returning({
          id: webhooksTable.id,
          url: webhooksTable.url,
          events: webhooksTable.events,
          active: webhooksTable.active,
          updatedAt: webhooksTable.updatedAt,
        }),
    );

    if (!updated) {
      sendProblem(res, Problems.notFound());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "webhook.updated",
      targetType: "webhook",
      targetId: webhookId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { fields: Object.keys(fieldsToUpdate), secretRotated: !!rotateSecret },
    });

    res.json({
      id: updated.id,
      url: updated.url,
      events: updated.events,
      active: updated.active,
      updatedAt: updated.updatedAt,
      // signingSecret is included only if the secret was rotated in this request.
      ...(newSigningSecret ? { signingSecret: newSigningSecret } : {}),
    });
  },
);

// ── DELETE /v1/webhooks/:webhookId ───────────────────────────────────────────
// Deactivates rather than hard-deletes; webhooks are referenced by delivery history.

router.delete(
  "/v1/webhooks/:webhookId",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;
    const webhookId = req.params.webhookId as string;

    const now = new Date();
    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(webhooksTable)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            eq(webhooksTable.id, webhookId),
            eq(webhooksTable.tenantId, tenantId),
          ),
        )
        .returning({ id: webhooksTable.id }),
    );

    if (!updated) {
      sendProblem(res, Problems.notFound());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "webhook.deactivated",
      targetType: "webhook",
      targetId: webhookId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: {},
    });

    res.status(204).end();
  },
);

export default router;
