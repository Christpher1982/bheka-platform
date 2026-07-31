// Writes immutable rows to audit_log before the calling operation returns.
// CANON section 9: every privileged endpoint writes to audit_log before returning.
// API_STANDARD section 7: if the audit write fails the request must fail — never
// return success to the caller without a corresponding audit record.
// Hash-chain: each row's prev_hash links to the previous row in the tenant's chain.

import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, auditLogTable, type InsertAuditLog } from "@workspace/db";
import { logger } from "./logger.js";

type AuditEntry = Omit<
  InsertAuditLog,
  "id" | "createdAt" | "prevHash" | "rowHash"
>;

function computeRowHash(
  row: Omit<InsertAuditLog, "rowHash">,
): string {
  const stable = JSON.stringify({
    id: row.id,
    tenantId: row.tenantId ?? null,
    actorId: row.actorId ?? null,
    actorType: row.actorType,
    action: row.action,
    targetType: row.targetType ?? null,
    targetId: row.targetId ?? null,
    requestId: row.requestId ?? null,
    metadata: row.metadata ?? null,
    prevHash: row.prevHash ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  });
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const prevRows = await db
    .select({ rowHash: auditLogTable.rowHash })
    .from(auditLogTable)
    .where(
      entry.tenantId
        ? eq(auditLogTable.tenantId, entry.tenantId)
        : undefined,
    )
    .orderBy(desc(auditLogTable.createdAt))
    .limit(1);

  const prevHash = prevRows[0]?.rowHash ?? null;
  const createdAt = new Date();

  const rowWithoutHash = {
    ...entry,
    prevHash,
    createdAt,
  } as InsertAuditLog;

  const rowHash = computeRowHash(rowWithoutHash);

  try {
    await db.insert(auditLogTable).values({
      ...entry,
      prevHash,
      rowHash,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "audit_log write failed");
    // Propagate: a privileged action with no audit record is a correctness bug.
    throw new Error(
      `audit_log write failed for action "${entry.action}": ${String(err)}`,
    );
  }
}
