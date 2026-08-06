// Integration tests for the mobile enrolment surface (android/ios PoC agents).
//
// Covers:
//   POST /v1/agents/mobile-enrol       — lightweight enrolment, no CSR/mTLS
//   POST /v1/agents/mobile-enrol-token — console-side token minting
//
// Requires a real Postgres (DATABASE_URL) and Redis (REDIS_URL) — these tests
// exercise the actual route handlers end to end via supertest against the
// Express app, not mocks, matching how /v1/agent/events would be tested.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  db,
  tenantsTable,
  sitesTable,
  agentsTable,
  usersTable,
  activityEventsTable,
  detectionsTable,
} from "@workspace/db";
import { redis } from "../../lib/redis.js";
import { createSession } from "../../middleware/session.js";
import app from "../../app.js";

let tenantId: string;
let tenantSlug: string;
let siteId: string;
let sessionCookie: string;

async function mintEnrolToken(forTenantId: string, ttl = 3600): Promise<string> {
  const token = uuidv7().replace(/-/g, "");
  await redis.setex(
    `bheka:enrol_token:${token}`,
    ttl,
    JSON.stringify({ tenantId: forTenantId }),
  );
  return token;
}

beforeAll(async () => {
  tenantSlug = `mobile-enrol-test-${uuidv7()}`;
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ slug: tenantSlug, name: "Mobile Enrol Test Tenant" })
    .returning();
  tenantId = tenant!.id;

  const [site] = await db
    .insert(sitesTable)
    .values({ tenantId, name: "HQ" })
    .returning();
  siteId = site!.id;

  const sid = await createSession({
    userId: uuidv7(),
    tenantId,
    mfaSatisfied: true,
    stepUpSatisfiedAt: null,
  });
  sessionCookie = `bheka_sid=${sid}`;
});

afterAll(async () => {
  // Delete in FK-dependency order: detections -> activity_events -> agents -> ...
  await db.delete(detectionsTable).where(eq(detectionsTable.tenantId, tenantId));
  await db.delete(activityEventsTable).where(eq(activityEventsTable.tenantId, tenantId));
  await db.delete(agentsTable).where(eq(agentsTable.tenantId, tenantId));
  await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
  await db.delete(sitesTable).where(eq(sitesTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("POST /api/v1/agents/mobile-enrol", () => {
  it("enrols a new android device and returns 201 with an agentId", async () => {
    const token = await mintEnrolToken(tenantId);
    const deviceId = uuidv7();

    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token,
        deviceId,
        name: "Michael's Pixel 9",
        siteId,
        platform: "android",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(201);
    expect(res.body.agentId).toBeTruthy();
    expect(res.body.tenantSlug).toBe(tenantSlug);
    expect(res.body.siteId).toBe(siteId);
    expect(res.body.subjectUserId).toBeNull();

    const [row] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, res.body.agentId));
    expect(row).toBeTruthy();
    expect(row!.hostname).toBe(deviceId);
    expect(row!.name).toBe("Michael's Pixel 9");
    expect(row!.active).toBe(true);
    expect(row!.endpointId).toBeNull();
    expect(row!.certificateFingerprint).toBeNull();
  });

  it("returns the same agentId on duplicate deviceId (idempotent re-enrolment)", async () => {
    const deviceId = uuidv7();

    const token1 = await mintEnrolToken(tenantId);
    const first = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token1,
        deviceId,
        name: "Re-install Device",
        siteId,
        platform: "ios",
        appVersion: "1.0.0",
      });
    expect(first.status).toBe(201);

    const token2 = await mintEnrolToken(tenantId);
    const second = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token2,
        deviceId,
        name: "Re-install Device",
        siteId,
        platform: "ios",
        appVersion: "1.1.0",
      });
    expect(second.status).toBe(201);
    expect(second.body.agentId).toBe(first.body.agentId);

    const rows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.hostname, deviceId));
    expect(rows.length).toBe(1);
  });

  it("rejects a missing enrolment token with 401", async () => {
    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: "does-not-exist",
        deviceId: uuidv7(),
        name: "Bad Token Device",
        siteId,
        platform: "android",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(401);
  });

  it("rejects an enrolment token belonging to a different tenant with 401", async () => {
    const otherTenantId = uuidv7();
    const token = await mintEnrolToken(otherTenantId);

    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token,
        deviceId: uuidv7(),
        name: "Mismatched Tenant Device",
        siteId,
        platform: "android",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(401);
  });

  it("rejects an unknown siteId with 404", async () => {
    const token = await mintEnrolToken(tenantId);

    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token,
        deviceId: uuidv7(),
        name: "Unknown Site Device",
        siteId: uuidv7(),
        platform: "android",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(404);
  });

  it("rejects a validation failure (missing appVersion) with 400", async () => {
    const token = await mintEnrolToken(tenantId);

    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token,
        deviceId: uuidv7(),
        name: "Invalid Body Device",
        siteId,
        platform: "android",
      });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/agents/mobile-enrol-token", () => {
  it("requires a session (401 without cookie)", async () => {
    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol-token")
      .send({ tenantId, siteId });

    expect(res.status).toBe(401);
  });

  it("mints a token that mobile-enrol can consume", async () => {
    const mintRes = await request(app)
      .post("/api/v1/agents/mobile-enrol-token")
      .set("Cookie", sessionCookie)
      .send({ tenantId, siteId });

    expect(mintRes.status).toBe(201);
    expect(typeof mintRes.body.token).toBe("string");
    expect(mintRes.body.expiresInSeconds).toBe(3600);

    const enrolRes = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: mintRes.body.token,
        deviceId: uuidv7(),
        name: "Console-Minted Token Device",
        siteId,
        platform: "android",
        appVersion: "1.0.0",
      });

    expect(enrolRes.status).toBe(201);
  });

  it("honours a custom ttlSeconds", async () => {
    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol-token")
      .set("Cookie", sessionCookie)
      .send({ tenantId, siteId, ttlSeconds: 60 });

    expect(res.status).toBe(201);
    expect(res.body.expiresInSeconds).toBe(60);
  });

  it("rejects a tenantId that does not match the session tenant with 403", async () => {
    const res = await request(app)
      .post("/api/v1/agents/mobile-enrol-token")
      .set("Cookie", sessionCookie)
      .send({ tenantId: uuidv7(), siteId });

    expect(res.status).toBe(403);
  });
});

// Confirms the task's premise: the ingest endpoint needs no changes to accept
// events from a mobile-enrolled agent — it already works for any platform.
describe("POST /api/v1/agent/events with a mobile-enrolled agent", () => {
  it("accepts an ingest event from an android agent enrolled via mobile-enrol", async () => {
    if (!process.env.AGENT_INGEST_TOKEN) {
      // Ingest is closed by design when the shared token is unset; skip rather
      // than fail the whole suite over an unrelated env var.
      return;
    }

    const token = await mintEnrolToken(tenantId);
    const enrolRes = await request(app)
      .post("/api/v1/agents/mobile-enrol")
      .send({
        tenantId,
        enrolmentToken: token,
        deviceId: uuidv7(),
        name: "Ingest Interop Device",
        siteId,
        platform: "android",
        appVersion: "1.0.0",
      });
    expect(enrolRes.status).toBe(201);

    const [user] = await db
      .insert(usersTable)
      .values({ tenantId, email: `mobile-${uuidv7()}@example.com` })
      .returning();

    const ingestRes = await request(app)
      .post("/api/v1/agent/events")
      .set("X-Agent-Token", process.env.AGENT_INGEST_TOKEN!)
      .send({
        tenantSlug,
        siteId,
        subjectUserId: user!.id,
        sourceAgentId: enrolRes.body.agentId,
        eventType: "mobile.app_foregrounded",
        occurredAt: new Date().toISOString(),
        metadata: {},
      });

    expect(ingestRes.status).toBe(201);
    expect(ingestRes.body.eventId).toBeTruthy();
  });
});
