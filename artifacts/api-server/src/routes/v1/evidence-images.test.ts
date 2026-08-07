// Integration tests for the evidence_images read/write path:
//   1. POST /api/v1/agent/events with a screenshot_capture event persists the
//      decoded image bytes via evidence-storage.ts, inserts an evidence_images
//      row, and stores only a pointer (metadata.evidenceImageId) in
//      activity_events.metadata — never the raw base64.
//   2. GET /v1/evidence-images lists that row (filterable by siteId /
//      subjectUserId / sourceAgentId) with a requireSession-authenticated
//      request.
//   3. GET /v1/evidence-images/:id/image decrypts and returns the original
//      bytes, and writes an audit_log row for the view.
//
// Requires a real Postgres (DATABASE_URL) and Redis (REDIS_URL), same as
// agent-events.test.ts, and the same AGENT_INGEST_TOKEN-gated skip pattern.
// Session-authenticated routes are exercised via the dev-login route (see
// auth/dev-login.ts), gated to NODE_ENV=development, matching how the console
// itself authenticates in local dev.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import app from "../../app.js";
import { db, pool } from "@workspace/db";

const TENANT_ID = "00000000-0000-7000-8000-00000000e001";
const SITE_ID = "00000000-0000-7000-8000-00000000e002";
const USER_ID = "00000000-0000-7000-8000-00000000e003";
const AGENT_VERSION_ID = "00000000-0000-7000-8000-00000000e004";
const ENDPOINT_ID = "00000000-0000-7000-8000-00000000e005";
const AGENT_ID = "00000000-0000-7000-8000-00000000e006";
const ADMIN_USER_ID = "00000000-0000-7000-8000-00000000e007";
const TENANT_SLUG = "test-evidence-images";
const ADMIN_EMAIL = "test-evidence-admin@example.test";

const AGENT_TOKEN = process.env.AGENT_INGEST_TOKEN ?? "";

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMDAwMDAwUFBQUFBQcHBgcHBwoJCQoJCg0MDQ0NDQ0N" +
  "DQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N/8AAEQgAAQABAwEiAAIRAQMR" +
  "Af/EABQAAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAA" +
  "AAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgAAf/Z";

const skipIfNoAgentToken = AGENT_TOKEN.length > 0 ? describe : describe.skip;

skipIfNoAgentToken("evidence_images read/write path", () => {
  let sessionCookie = "";

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
      VALUES (${USER_ID}, ${TENANT_ID}, 'test-evidence-subject@example.test', 'Test', 'Subject')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, tenant_id, email, given_name, family_name)
      VALUES (${ADMIN_USER_ID}, ${TENANT_ID}, ${ADMIN_EMAIL}, 'Test', 'Admin')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO agent_versions (id, version_string, platform, artifact_hash, released_at)
      VALUES (${AGENT_VERSION_ID}, 'test-1.0.0', 'ios', 'testhash-evidence', now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO endpoints (id, tenant_id, site_id, name, hostname)
      VALUES (${ENDPOINT_ID}, ${TENANT_ID}, ${SITE_ID}, 'TEST-IPHONE', 'test-iphone.local')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO agents (id, tenant_id, endpoint_id, agent_version_id, certificate_fingerprint, active)
      VALUES (${AGENT_ID}, ${TENANT_ID}, ${ENDPOINT_ID}, ${AGENT_VERSION_ID}, ${"test-fp-" + AGENT_ID}, true)
      ON CONFLICT (id) DO NOTHING
    `);

    // dev-login mints a real session cookie for an existing user in this
    // tenant, exactly like the console does locally (see auth/dev-login.ts).
    // Gated to NODE_ENV=development, same as the route itself.
    const loginRes = await request(app)
      .post("/api/v1/auth/dev-login")
      .send({ email: ADMIN_EMAIL });
    const setCookie = loginRes.headers["set-cookie"];
    if (setCookie) {
      sessionCookie = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
    }
  });

  afterAll(async () => {
    // audit_log is append-only (a trigger rejects UPDATE/DELETE to protect the
    // hash chain — see the audit-writer.ts design notes), so rows written by
    // this suite are intentionally left in place, same as real usage.
    await db.execute(sql`DELETE FROM evidence_images WHERE tenant_id = ${TENANT_ID}`);
    await db.execute(sql`DELETE FROM detections WHERE tenant_id = ${TENANT_ID}`);
    await db.execute(sql`DELETE FROM activity_events WHERE tenant_id = ${TENANT_ID}`);
    await db.execute(sql`DELETE FROM agents WHERE id = ${AGENT_ID}`);
    await db.execute(sql`DELETE FROM endpoints WHERE id = ${ENDPOINT_ID}`);
    await db.execute(sql`DELETE FROM agent_versions WHERE id = ${AGENT_VERSION_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id IN (${USER_ID}, ${ADMIN_USER_ID})`);
    await db.execute(sql`DELETE FROM sites WHERE id = ${SITE_ID}`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
    await pool.end();
  });

  it("ingests a screenshot_capture event, stores the image via evidence-storage, and strips the base64 from activity_events.metadata", async () => {
    const ingestRes = await request(app)
      .post("/api/v1/agent/events")
      .set("X-Agent-Token", AGENT_TOKEN)
      .send({
        tenantSlug: TENANT_SLUG,
        siteId: SITE_ID,
        subjectUserId: USER_ID,
        sourceAgentId: AGENT_ID,
        eventType: "screenshot_capture",
        occurredAt: new Date().toISOString(),
        metadata: {
          activeWindowTitle: "Mail - Inbox",
          screenshotImageBase64: TINY_JPEG_BASE64,
          screenshotWidth: 1170,
          screenshotHeight: 2532,
          ocrText: "Nothing sensitive here, just a test.",
          sessionId: "test-broadcast-session-1",
        },
      });

    expect(ingestRes.status).toBe(201);
    const eventId = ingestRes.body.eventId as string;
    expect(eventId).toBeTruthy();

    const storedResult = await db.execute(
      sql`SELECT metadata FROM activity_events WHERE id = ${eventId}`,
    );
    const stored = storedResult.rows[0] as { metadata: Record<string, unknown> };
    expect(stored.metadata.screenshotImageBase64).toBeUndefined();
    expect(stored.metadata.sessionId).toBeUndefined();
    expect(typeof stored.metadata.evidenceImageId).toBe("string");
    expect(stored.metadata.ocrText).toBe("Nothing sensitive here, just a test.");

    const evidenceImageId = stored.metadata.evidenceImageId as string;

    const rowResult = await db.execute(
      sql`SELECT * FROM evidence_images WHERE id = ${evidenceImageId}`,
    );
    expect(rowResult.rows.length).toBe(1);
    const row = rowResult.rows[0] as Record<string, unknown>;
    expect(row.tenant_id).toBe(TENANT_ID);
    expect(row.site_id).toBe(SITE_ID);
    expect(row.subject_user_id).toBe(USER_ID);
    expect(row.source_agent_id).toBe(AGENT_ID);
    expect(row.source_event_id).toBe(eventId);
    expect(row.session_id).toBe("test-broadcast-session-1");
    expect(row.byte_size).toBeGreaterThan(0);
    expect(row.storage_key).toBeTruthy();
  });

  it("lists the stored image via GET /v1/evidence-images filtered by subjectUserId", async () => {
    const res = await request(app)
      .get("/api/v1/evidence-images")
      .query({ subjectUserId: USER_ID })
      .set("Cookie", sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(
      res.body.items.every((item: { subjectUserId: string }) => item.subjectUserId === USER_ID),
    ).toBe(true);
    // Storage-layer fields must never reach the client.
    expect(res.body.items[0].storageKey).toBeUndefined();
    expect(res.body.items[0].ivBase64).toBeUndefined();
  });

  it("decrypts and returns the original image bytes via GET /v1/evidence-images/:id/image, and audits the view", async () => {
    const listRes = await request(app)
      .get("/api/v1/evidence-images")
      .query({ subjectUserId: USER_ID })
      .set("Cookie", sessionCookie);
    const imageId = listRes.body.items[0].id as string;

    const imageRes = await request(app)
      .get(`/api/v1/evidence-images/${imageId}/image`)
      .set("Cookie", sessionCookie);

    expect(imageRes.status).toBe(200);
    expect(imageRes.headers["content-type"]).toContain("image/jpeg");
    const expectedBytes = Buffer.from(TINY_JPEG_BASE64, "base64");
    expect(Buffer.compare(imageRes.body as Buffer, expectedBytes)).toBe(0);

    const auditResult = await db.execute(
      sql`SELECT action, target_id FROM audit_log WHERE tenant_id = ${TENANT_ID} AND action = 'evidence_image.viewed' AND target_id = ${imageId}`,
    );
    expect(auditResult.rows.length).toBeGreaterThan(0);
  });

  it("returns 404 for an evidence image id that does not belong to the caller's tenant", async () => {
    const res = await request(app)
      .get("/api/v1/evidence-images/00000000-0000-7000-8000-0000000000ff/image")
      .set("Cookie", sessionCookie);

    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated requests to list evidence images", async () => {
    const res = await request(app).get("/api/v1/evidence-images");
    expect(res.status).toBe(401);
  });
});
