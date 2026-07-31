// Redis-backed session middleware.
// GUIDE-01 section 3.4: sessions are opaque tokens stored in Redis — not signed JWTs.
// Revocation (offboarding, incident response) takes effect immediately because every
// request re-reads the session from Redis.
// GUIDE-01 section 3.3: 8-hour absolute lifetime, 30-minute sliding idle timeout.

import { randomBytes } from "node:crypto";
import type { RequestHandler, CookieOptions } from "express";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

export interface BhekaSession {
  userId: string;
  tenantId: string;
  mfaSatisfied: boolean;
  stepUpSatisfiedAt: string | null;
  createdAt: string;
}

const SESSION_COOKIE = "bheka_sid";
const SESSION_ABSOLUTE_TTL_S = 8 * 60 * 60; // 8 hours absolute ceiling
const SESSION_IDLE_TTL_S = 30 * 60;          // 30 min sliding idle timeout

function sessionKey(sid: string): string {
  return `session:${sid}`;
}

const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_IDLE_TTL_S * 1000,
};

export const sessionMiddleware: RequestHandler = async (req, _res, next) => {
  const cookies = req.cookies as Record<string, string | undefined>;
  const sid = cookies[SESSION_COOKIE];
  if (!sid) {
    next();
    return;
  }

  const raw = await redis.get(sessionKey(sid)).catch((err: Error) => {
    logger.error({ err }, "Redis read failed in session middleware");
    return null;
  });

  if (!raw) {
    next();
    return;
  }

  const session = JSON.parse(raw) as BhekaSession;

  // Enforce absolute lifetime regardless of Redis TTL extension.
  const ageSeconds = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
  if (ageSeconds >= SESSION_ABSOLUTE_TTL_S) {
    await redis.del(sessionKey(sid)).catch(() => undefined);
    next();
    return;
  }

  // Sliding idle timeout: extend TTL on each authenticated request,
  // but never beyond the absolute lifetime ceiling.
  const remainingAbsolute = Math.floor(SESSION_ABSOLUTE_TTL_S - ageSeconds);
  const newTtl = Math.min(SESSION_IDLE_TTL_S, remainingAbsolute);
  await redis.expire(sessionKey(sid), newTtl).catch((err: Error) => {
    logger.warn({ err }, "Failed to extend session TTL");
  });

  req.session = session;
  req.tenantId = session.tenantId;
  next();
};

export async function createSession(
  session: Omit<BhekaSession, "createdAt">,
): Promise<string> {
  const sid = randomBytes(32).toString("base64url");
  const data: BhekaSession = {
    ...session,
    createdAt: new Date().toISOString(),
  };
  await redis.set(
    sessionKey(sid),
    JSON.stringify(data),
    "EX",
    SESSION_IDLE_TTL_S,
  );
  return sid;
}

export async function destroySession(sid: string): Promise<void> {
  await redis.del(sessionKey(sid));
}

export { SESSION_COOKIE, SESSION_COOKIE_OPTIONS };
