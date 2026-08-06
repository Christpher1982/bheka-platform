// Configuration module: validates all required environment variables at startup.
// Fails at import time if required vars are missing — no silent runtime failures.
// Add new required env vars here and document them in replit.md.

import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  WEBAUTHN_RP_ID: z
    .string()
    .min(1, "WEBAUTHN_RP_ID is required (e.g. app.bheka.eride.tech)"),
  WEBAUTHN_RP_ORIGIN: z
    .string()
    .url("WEBAUTHN_RP_ORIGIN must be a valid HTTPS URL"),
  // Optional — when absent NATS publishing is a no-op (dev-friendly).
  // Set to a nats:// or tls:// URL to enable the event bus.
  NATS_URL: z.string().optional(),
  // Shared secret agents present in X-Agent-Token on POST /api/v1/agent/events.
  // Optional so the gateway still boots without it; the ingest endpoint rejects
  // every request while it is unset (see middleware/require-agent-token.ts).
  AGENT_INGEST_TOKEN: z
    .string()
    .min(32, "AGENT_INGEST_TOKEN must be at least 32 characters")
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`bheka-gateway configuration error:\n${messages}`);
  }
  return result.data;
}

// Singleton validated once at import time.
export const config = loadConfig();
