// Redis client singleton.
// CANON section 2: Redis 7 (Valkey acceptable) for cache, rate limits, short-lived tokens.
// Used by: session middleware (session:*), WebAuthn challenges (webauthn:*),
// OIDC transaction state (oidc:tx:*), idempotency keys (idempotency:*).

import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  enableReadyCheck: true,
});

redis.on("error", (err: Error) => {
  logger.error({ err }, "Redis connection error");
});

redis.on("ready", () => {
  logger.info("Redis connected");
});

redis.on("reconnecting", () => {
  logger.warn("Redis reconnecting");
});
