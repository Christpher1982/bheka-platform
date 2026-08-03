// Regression test for the screenshot_capture HTTP 500 bug (fix on top of
// commit 8eb601c, feature/agent-ingest-rules / PR #5).
//
// ROOT CAUSE: app.ts registered `express.json()` with no `limit`, which
// defaults to 100kb. A real screenshot_capture event's body — a base64 JPEG
// plus ocrText plus JSON overhead — is comfortably larger than 100kb even for
// a small screenshot, so body-parser threw a PayloadTooLargeError before the
// request ever reached the Zod schema or the route handler. The catch-all
// error handler at the bottom of app.ts then collapsed that into a generic
// 500 "Internal server error" instead of surfacing the real 413. keystroke_batch
// events worked fine because typed/OCR'd keystroke payloads stay well under
// 100kb, so this only ever showed up for screenshot_capture.
//
// This suite requires a real Postgres (DATABASE_URL) and Redis (REDIS_URL)
// reachable, same as running the server locally — see repo setup docs. It
// seeds a minimal tenant/site/user/agent_version/endpoint/agent row set
// directly via SQL (mirroring scripts/smoke-test.sh's "point curl at a running
// server" style, but in-process via supertest against the exported `app`).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import app from "../../app.js";
import { db, pool } from "@workspace/db";

const TENANT_ID = "00000000-0000-7000-8000-00000000a001";
const SITE_ID = "00000000-0000-7000-8000-00000000a002";
const USER_ID = "00000000-0000-7000-8000-00000000a003";
const AGENT_VERSION_ID = "00000000-0000-7000-8000-00000000a004";
const ENDPOINT_ID = "00000000-0000-7000-8000-00000000a005";
const AGENT_ID = "00000000-0000-7000-8000-00000000a006";
const TENANT_SLUG = "test-screenshot-ingest";

const AGENT_TOKEN = process.env.AGENT_INGEST_TOKEN ?? "";

// A genuine small JPEG (1x1 pixel, real JFIF header) rather than a placeholder
// string, base64-encoded — long enough combined with a realistic ocrText to
// exceed the old 100kb express.json() default many times over once repeated,
// but this test cares about a normal-sized screenshot, so it pads with a
// realistic-length synthetic body rather than a multi-MB one (that boundary is
// exercised by the Zod max-length case below).
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMDAwMDAwUFBQUFBQcHBgcHBwoJCQoJCg0MDQ0NDQ0N" +
  "DQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N/8AAEQgAAQABAwEiAAIRAQMR" +
  "Af/EABQAAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAA" +
  "AAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgAAf/Z";

// Repeated OCR-ish text to build a realistic multi-KB body, similar in spirit
// to the 1967-character extraction from the bug report.
const REALISTIC_OCR_TEXT = (
  "Quarterly Financial Report - Confidential. Contains password reset " +
  "instructions and API key rotation notes for the finance team. "
).repeat(20).slice(0, 1967);

function ingestPayload(overrides: Record<string, unknown> = {}) {
  return {
    tenantSlug: TENANT_SLUG,
    siteId: SITE_ID,
    subjectUserId: USER_ID,
    sourceAgentId: AGENT_ID,
    eventType: "screenshot_capture",
    occurredAt: new Date().toISOString(),
    metadata: {
      activeWindowTitle: "Excel - Q3 Financials.xlsx",
      screenshotImageBase64: TINY_JPEG_BASE64,
      screenshotWidth: 1280,
      screenshotHeight: 720,
      ocrText: REALISTIC_OCR_TEXT,
    },
    ...overrides,
  };
}

const skipIfNoAgentToken = AGENT_TOKEN.length > 0 ? describe : describe.skip;

skipIfNoAgentToken(
  "POST /api/v1/agent/events — screenshot_capture (regression: HTTP 500)",
  () => {
    beforeAll(async () => {
      await db.execute(sql`
        INSERT INTO tenants (id, slug, name, display_name)
        VALUES (${TENANT_ID}, ${TENANT_SLUG}, 'Test Tenant', 'Test Tenant')
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO sites (id, tenant_id, name)
        VALUES (${SITE_ID}, ${TENANT_ID}, 'Test Site')
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO users (id, tenant_id, email, given_name, family_name)
        VALUES (${USER_ID}, ${TENANT_ID}, 'test-subject@example.test', 'Test', 'Subject')
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO agent_versions (id, version_string, platform, artifact_hash, released_at)
        VALUES (${AGENT_VERSION_ID}, 'test-1.0.0', 'windows', 'testhash', now())
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO endpoints (id, tenant_id, site_id, name, hostname)
        VALUES (${ENDPOINT_ID}, ${TENANT_ID}, ${SITE_ID}, 'TEST-PC', 'test-pc.local')
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO agents (id, tenant_id, endpoint_id, agent_version_id, certificate_fingerprint, active)
        VALUES (${AGENT_ID}, ${TENANT_ID}, ${ENDPOINT_ID}, ${AGENT_VERSION_ID}, ${"test-fp-" + AGENT_ID}, true)
        ON CONFLICT (id) DO NOTHING
      `);
    });

    afterAll(async () => {
      await db.execute(sql`DELETE FROM detections WHERE tenant_id = ${TENANT_ID}`);
      await db.execute(sql`DELETE FROM activity_events WHERE tenant_id = ${TENANT_ID}`);
      await db.execute(sql`DELETE FROM agents WHERE id = ${AGENT_ID}`);
      await db.execute(sql`DELETE FROM endpoints WHERE id = ${ENDPOINT_ID}`);
      await db.execute(sql`DELETE FROM agent_versions WHERE id = ${AGENT_VERSION_ID}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
      await db.execute(sql`DELETE FROM sites WHERE id = ${SITE_ID}`);
      await db.execute(sql`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
      await pool.end();
    });

    it("returns 201 (not 500) for a realistic screenshot_capture event with sensitive OCR text, and creates a detection", async () => {
      const res = await request(app)
        .post("/api/v1/agent/events")
        .set("X-Agent-Token", AGENT_TOKEN)
        .send(ingestPayload());

      expect(res.status).toBe(201);
      expect(res.body.detectionCreated).toBe(true);
      expect(res.body.detectionId).toBeTruthy();
    });

    it("returns 201 and creates no detection for screenshot_capture with non-sensitive OCR text", async () => {
      const res = await request(app)
        .post("/api/v1/agent/events")
        .set("X-Agent-Token", AGENT_TOKEN)
        .send(
          ingestPayload({
            metadata: {
              activeWindowTitle: "Excel - Q3 Financials.xlsx",
              screenshotImageBase64: TINY_JPEG_BASE64,
              screenshotWidth: 1280,
              screenshotHeight: 720,
              ocrText:
                "Just a regular chart of quarterly sales figures, nothing sensitive.",
            },
          }),
        );

      expect(res.status).toBe(201);
      expect(res.body.detectionCreated).toBe(false);
    });

    it("returns 201 and does not crash for screenshot_capture with ocrText: null (Tesseract not installed)", async () => {
      const res = await request(app)
        .post("/api/v1/agent/events")
        .set("X-Agent-Token", AGENT_TOKEN)
        .send(
          ingestPayload({
            metadata: {
              activeWindowTitle: "Excel - Q3 Financials.xlsx",
              screenshotImageBase64: TINY_JPEG_BASE64,
              screenshotWidth: 1280,
              screenshotHeight: 720,
              ocrText: null,
            },
          }),
        );

      expect(res.status).toBe(201);
      expect(res.body.detectionCreated).toBe(false);
    });

    it("still returns 201 for keystroke_batch events (unaffected control case)", async () => {
      const res = await request(app)
        .post("/api/v1/agent/events")
        .set("X-Agent-Token", AGENT_TOKEN)
        .send(
          ingestPayload({
            eventType: "keystroke_batch",
            metadata: {
              keystrokeCount: 10,
              activeWindowTitle: "Notepad",
              capturedText: "hello world, nothing sensitive",
            },
          }),
        );

      expect(res.status).toBe(201);
    });

    it("returns a clean 413 Problem+JSON (not a 500) when the request body exceeds the size limit", async () => {
      const res = await request(app)
        .post("/api/v1/agent/events")
        .set("X-Agent-Token", AGENT_TOKEN)
        .send(
          ingestPayload({
            metadata: {
              screenshotImageBase64: "A".repeat(11_000_000),
              ocrText: "test",
            },
          }),
        );

      expect(res.status).toBe(413);
      expect(res.body.status).toBe(413);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    });

    it("returns a clean 400 (not a 500) when screenshotImageBase64 exceeds the Zod max but stays under the body-size limit", async () => {
      const res = await request(app)
        .post("/api/v1/agent/events")
        .set("X-Agent-Token", AGENT_TOKEN)
        .send(
          ingestPayload({
            metadata: {
              screenshotImageBase64: "A".repeat(8_500_000),
              ocrText: "test",
            },
          }),
        );

      expect(res.status).toBe(400);
    });
  },
);
