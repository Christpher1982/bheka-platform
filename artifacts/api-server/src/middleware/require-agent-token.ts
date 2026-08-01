// requireAgentToken — machine-to-machine auth for the telemetry ingest endpoint.
//
// The agent presents a shared secret in X-Agent-Token, compared against the
// AGENT_INGEST_TOKEN env var. There is no user session and no cookie.
//
// This is weaker than requireAgentMTLS (which binds to a per-agent certificate
// and identifies which agent is calling). It exists because the ingest path must
// work before per-agent certificate issuance is wired up end to end. A single
// shared secret cannot distinguish or individually revoke agents, so mTLS should
// replace it once Vault-issued agent certs are available on every platform.
//
// If AGENT_INGEST_TOKEN is unset the endpoint is closed rather than open: every
// request is rejected. Failing open here would make the ingest path an
// unauthenticated write into tenant data.

import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../lib/config.js";
import { sendProblem, Problems } from "../lib/problem.js";
import { logger } from "../lib/logger.js";

const TOKEN_HEADER = "x-agent-token";

function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const requireAgentToken: RequestHandler = (req, res, next) => {
  const expected = config.AGENT_INGEST_TOKEN;
  if (!expected) {
    logger.error(
      "AGENT_INGEST_TOKEN is not configured; rejecting agent ingest request",
    );
    sendProblem(res, Problems.agentTokenRequired());
    return;
  }

  const presented = req.headers[TOKEN_HEADER];
  if (typeof presented !== "string" || !secureEquals(presented, expected)) {
    sendProblem(res, Problems.agentTokenRequired());
    return;
  }

  next();
};
