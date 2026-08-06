-- Add android/ios to agent_platform enum, and relax agents table constraints so
-- mobile agents (enrolled via POST /v1/agents/mobile-enrol) can skip the
-- CSR/mTLS/endpoint flow used by desktop agents (windows/linux/macos).
--
-- Context: endpoints.is_corporate_owned is permanently true (no BYOD, CANON
-- section 5 refusal 4), so mobile devices never get an endpoints row. Instead,
-- agents rows for mobile platforms carry site_id/name/hostname directly, with
-- hostname repurposed to store the device-generated deviceId.

ALTER TYPE "agent_platform" ADD VALUE IF NOT EXISTS 'android';
--> statement-breakpoint
ALTER TYPE "agent_platform" ADD VALUE IF NOT EXISTS 'ios';
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "endpoint_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "certificate_fingerprint" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "site_id" uuid REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "hostname" text;
--> statement-breakpoint
-- One agent row per (tenant, deviceId) for idempotent mobile re-enrolment.
-- Partial index: desktop agent rows have hostname = NULL and are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS "agents_tenant_hostname_uidx"
  ON "agents" ("tenant_id", "hostname")
  WHERE "hostname" IS NOT NULL;
