// Tenant management routes — 009_API_SURFACE section 3.
// Covers: GET /v1/tenants/:tenantId, PATCH /v1/tenants/:tenantId,
//         GET /v1/tenants/:tenantId/key-custody-config,
//         POST /v1/tenants/:tenantId/keys/:keyId/shred
//
// All operations require oidcBearer auth (requireSession).
// PATCH and POST /shred write to audit_log before returning (CANON section 9).
// POST /shred additionally requires WebAuthn step-up (009_API_SURFACE section 13).

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  keyCustodyConfigTable,
  tenantKeysTable,
} from "@workspace/db";
import {
  vaultClient,
  VaultNotDeployedError,
  VaultUnavailableError,
  VaultKeyNotFoundError,
  VaultAlreadyShreddedError,
} from "@workspace/vault-client";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireStepUp } from "../../middleware/require-stepup.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

// ── GET /v1/tenants/:tenantId ───────────────────────────────────────────────

router.get(
  "/v1/tenants/:tenantId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.params.tenantId as string;

    // A user may only read their own tenant's profile. RLS enforces this at
    // the DB layer; we also gate at the session level for defence in depth.
    if (req.session!.tenantId !== tenantId) {
      sendProblem(res, Problems.forbidden("Tenant ID does not match authenticated session"));
      return;
    }

    const [tenant] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1),
    );

    if (!tenant || tenant.deletedAt) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      displayName: tenant.displayName,
      dataResidencyRegion: tenant.dataResidencyRegion,
      keyCustodyTier: tenant.keyCustodyTier,
      active: tenant.active,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    });
  },
);

// ── PATCH /v1/tenants/:tenantId ─────────────────────────────────────────────

const PatchTenantBody = z.object({
  name: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200).nullable().optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/v1/tenants/:tenantId",
  requireSession,
  requireRole("tenant_owner", "eride_support_engineer"),
  async (req, res): Promise<void> => {
    const tenantId = req.params.tenantId as string;

    if (req.session!.tenantId !== tenantId) {
      sendProblem(res, Problems.forbidden("Tenant ID does not match authenticated session"));
      return;
    }

    const parsed = PatchTenantBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(
        res,
        Problems.validationFailed(parsed.error.message, parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          code: i.code,
          message: i.message,
        }))),
      );
      return;
    }

    if (Object.keys(parsed.data).length === 0) {
      sendProblem(res, Problems.validationFailed("Request body must contain at least one field to update"));
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "tenant.updated",
      targetType: "tenant",
      targetId: tenantId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { fields: Object.keys(parsed.data) },
    });

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(tenantsTable)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(tenantsTable.id, tenantId)))
        .returning(),
    );

    if (!updated) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      displayName: updated.displayName,
      dataResidencyRegion: updated.dataResidencyRegion,
      keyCustodyTier: updated.keyCustodyTier,
      active: updated.active,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  },
);

// ── GET /v1/tenants/:tenantId/key-custody-config ────────────────────────────

router.get(
  "/v1/tenants/:tenantId/key-custody-config",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.params.tenantId as string;

    if (req.session!.tenantId !== tenantId) {
      sendProblem(res, Problems.forbidden("Tenant ID does not match authenticated session"));
      return;
    }

    const [cfg] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(keyCustodyConfigTable)
        .where(eq(keyCustodyConfigTable.tenantId, tenantId))
        .limit(1),
    );

    if (!cfg) {
      sendProblem(res, Problems.notFound());
      return;
    }

    // Never return the actual key material references in GET — only the tier
    // and whether each field is populated. Actual ARNs / endpoints are write-only.
    res.json({
      id: cfg.id,
      tenantId: cfg.tenantId,
      tier: cfg.tier,
      kmsKeyArnConfigured: cfg.kmsKeyArn !== null,
      customerKmsEndpointConfigured: cfg.customerKmsEndpoint !== null,
      vaultEndpointConfigured: cfg.vaultEndpoint !== null,
      createdAt: cfg.createdAt,
      updatedAt: cfg.updatedAt,
    });
  },
);

// ── POST /v1/tenants/:tenantId/keys/:keyId/shred ────────────────────────────
// Irreversible crypto-shred of a tenant key version.
// Requirements per 009_API_SURFACE section 13:
//   - Audited (writeAuditLog before returning)
//   - WebAuthn step-up required
// Dual-authorisation is enforced upstream via the approvals flow; by the time
// this endpoint is called the required approvals are already in place.

router.post(
  "/v1/tenants/:tenantId/keys/:keyId/shred",
  requireSession,
  requireRole("tenant_owner"),
  requireStepUp,
  async (req, res): Promise<void> => {
    const tenantId = req.params.tenantId as string;
    const keyId = req.params.keyId as string;

    if (req.session!.tenantId !== tenantId) {
      sendProblem(res, Problems.forbidden("Tenant ID does not match authenticated session"));
      return;
    }

    // Idempotency-Key required on all resource-creating/mutating POSTs (CANON §9).
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    // Look up the tenant_keys row to get the key_version and validate state.
    const [keyRow] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(tenantKeysTable)
        .where(
          and(
            eq(tenantKeysTable.id, keyId),
            eq(tenantKeysTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!keyRow) {
      sendProblem(res, Problems.notFound());
      return;
    }

    if (keyRow.shredAt !== null) {
      sendProblem(
        res,
        Problems.validationFailed(
          `Key version "${keyRow.keyVersion}" was already shredded at ${keyRow.shredAt.toISOString()}`,
        ),
      );
      return;
    }

    // Audit the shred intent BEFORE the irreversible Vault call (CANON section 9).
    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "key.shred_requested",
      targetType: "tenant_key",
      targetId: keyId,
      requestId: String(idempotencyKey),
      metadata: {
        keyVersion: keyRow.keyVersion,
        irreversible: true,
      },
    });

    try {
      await vaultClient.shredTenantKey({
        tenantId,
        keyVersion: keyRow.keyVersion,
      });
    } catch (err) {
      if (err instanceof VaultNotDeployedError) {
        sendProblem(res, {
          type: "https://docs.bheka.io/errors/vault-not-deployed",
          title: "Eride Vault is not deployed",
          status: 503,
          detail: (err as Error).message,
        });
        return;
      }
      if (err instanceof VaultAlreadyShreddedError) {
        sendProblem(
          res,
          Problems.validationFailed(`Key version already shredded in Vault: ${(err as Error).message}`),
        );
        return;
      }
      if (err instanceof VaultKeyNotFoundError) {
        sendProblem(res, Problems.notFound());
        return;
      }
      if (err instanceof VaultUnavailableError) {
        logger.error({ err, tenantId, keyId }, "Vault unavailable during shred");
        sendProblem(res, {
          type: "https://docs.bheka.io/errors/vault-unavailable",
          title: "Eride Vault is unavailable",
          status: 503,
          detail: "Retry after a short delay. If the issue persists contact Eride support.",
        });
        return;
      }
      logger.error({ err, tenantId, keyId }, "Unexpected error during key shred");
      sendProblem(res, Problems.internalError());
      return;
    }

    // Record successful shred in tenant_keys.
    await withTenantContext(tenantId, (tx) =>
      tx
        .update(tenantKeysTable)
        .set({ shredAt: new Date(), active: false })
        .where(eq(tenantKeysTable.id, keyId)),
    );

    // Audit the completion.
    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "key.shredded",
      targetType: "tenant_key",
      targetId: keyId,
      requestId: String(idempotencyKey),
      metadata: { keyVersion: keyRow.keyVersion },
    });

    res.status(204).send();
  },
);

export default router;
