// requireAgentMTLS — validates that the request is authenticated by a known
// enrolled agent presenting its mTLS certificate fingerprint.
//
// In production the TLS-terminating proxy (bheka-ingest's Nginx/Envoy sidecar)
// performs the actual mTLS handshake and forwards the verified client certificate
// fingerprint via the X-Agent-Cert-Fingerprint header. This middleware trusts
// that header only; it never performs TLS parsing itself.
//
// Security note: this header MUST be stripped by the proxy from any inbound
// request before the proxy's own TLS termination occurs. If it is accepted from
// the internet without stripping, an attacker can forge any agent identity.
// This is a network-layer invariant, not something this middleware can enforce.
//
// On success: req.agent is populated and next() is called.
// On failure: 401 Problem response, no next() call.

import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { sendProblem, Problems } from "../lib/problem.js";
import { logger } from "../lib/logger.js";

const FINGERPRINT_HEADER = "x-agent-cert-fingerprint";

export const requireAgentMTLS: RequestHandler = async (req, res, next) => {
  const fingerprint = req.headers[FINGERPRINT_HEADER];

  if (!fingerprint || typeof fingerprint !== "string" || fingerprint.trim() === "") {
    sendProblem(res, Problems.agentAuthRequired());
    return;
  }

  const normalized = fingerprint.trim().toLowerCase();

  const [agent] = await db
    .select({
      id: agentsTable.id,
      tenantId: agentsTable.tenantId,
      endpointId: agentsTable.endpointId,
      certificateFingerprint: agentsTable.certificateFingerprint,
      active: agentsTable.active,
    })
    .from(agentsTable)
    .where(eq(agentsTable.certificateFingerprint, normalized))
    .limit(1);

  if (!agent || !agent.active) {
    logger.warn({ fingerprint: normalized }, "Agent mTLS fingerprint not found or inactive");
    sendProblem(res, Problems.agentAuthRequired());
    return;
  }

  req.agent = {
    id: agent.id,
    tenantId: agent.tenantId,
    endpointId: agent.endpointId,
    certificateFingerprint: agent.certificateFingerprint,
  };

  next();
};
