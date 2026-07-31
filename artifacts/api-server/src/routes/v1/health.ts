// Health check endpoint. Not authenticated — monitoring and load balancers call this.
// Not written to audit_log — it is not a privileged action (API_STANDARD section 14).

import { Router, type IRouter } from "express";
import { redis } from "../../lib/redis.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

router.get("/v1/healthz", async (_req, res): Promise<void> => {
  let pgOk = false;
  let redisOk = false;

  try {
    await db.execute(sql`SELECT 1`);
    pgOk = true;
  } catch (err) {
    logger.error({ err }, "Health check: PostgreSQL unavailable");
  }

  try {
    await redis.ping();
    redisOk = true;
  } catch (err) {
    logger.error({ err }, "Health check: Redis unavailable");
  }

  const status = pgOk && redisOk ? "ok" : "degraded";
  const httpStatus = status === "ok" ? 200 : 503;

  res.status(httpStatus).json({
    status,
    components: {
      postgres: pgOk ? "ok" : "unavailable",
      redis: redisOk ? "ok" : "unavailable",
    },
  });
});

export default router;
