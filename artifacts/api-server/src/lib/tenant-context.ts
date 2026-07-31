// Tenant context: sets the PostgreSQL session GUC for Row Level Security.
// CANON section 8 and 008_DATA_MODEL section 10: all tenant-scoped tables enforce RLS
// via current_tenant_id() which reads set_config('app.current_tenant_id', ..., true).
// Every DB operation within a request must run inside withTenantContext().
// set_config with is_local=true scopes the GUC to the current transaction only,
// preventing tenant context from leaking across pooled connections.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Db = typeof db;

export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    return fn(tx as unknown as Db);
  });
}
