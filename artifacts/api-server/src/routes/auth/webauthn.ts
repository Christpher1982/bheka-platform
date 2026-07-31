// WebAuthn step-up registration and verification.
// GUIDE-01 section 5: step-up is required before Tier 3 evidence viewing and approvals.
// CANON section 9: WebAuthn assertion is valid for 10 minutes maximum.
// 007_RBAC_AND_IDENTITY section 6: userVerification must be "required" — without it
// the ceremony is not a step-up factor, only a second possession factor.
// Uses @simplewebauthn/server v13 API (credential replaces authenticator, ids are strings).

import { Router, type IRouter } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { db, webauthnCredentialsTable, usersTable } from "@workspace/db";
import { redis } from "../../lib/redis.js";
import { config } from "../../lib/config.js";
import { requireSession } from "../../middleware/require-session.js";
import { stepUpKey } from "../../middleware/require-stepup.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { logger } from "../../lib/logger.js";

const STEP_UP_TTL_SECONDS = 600; // 10 minutes per CANON section 9

function regChallengeKey(userId: string): string {
  return `webauthn:reg:${userId}`;
}

function stepupChallengeKey(userId: string): string {
  return `webauthn:stepup:${userId}`;
}

const router: IRouter = Router();

// POST /api/v1/auth/webauthn/register/options
// Generates registration options for a new authenticator.
router.post(
  "/v1/auth/webauthn/register/options",
  requireSession,
  async (req, res): Promise<void> => {
    const userId = req.session!.userId;

    const existing = await db
      .select({ credentialId: webauthnCredentialsTable.credentialId })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, userId));

    const options = await generateRegistrationOptions({
      rpName: "Bheka",
      rpID: config.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(userId),
      userName: userId,
      attestationType: "none",
      // Pass existing credential ids as base64url strings (v13 API).
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        // Required: without this the ceremony is not a genuine step-up factor.
        userVerification: "required",
      },
    });

    await redis.set(regChallengeKey(userId), options.challenge, "EX", 300);
    res.json(options);
  },
);

// POST /api/v1/auth/webauthn/register/verify
// Verifies registration response and stores the new credential.
router.post(
  "/v1/auth/webauthn/register/verify",
  requireSession,
  async (req, res): Promise<void> => {
    const userId = req.session!.userId;

    const expectedChallenge = await redis.get(regChallengeKey(userId));
    if (!expectedChallenge) {
      sendProblem(
        res,
        Problems.validationFailed("Registration challenge expired or not found"),
      );
      return;
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: config.WEBAUTHN_RP_ORIGIN,
        expectedRPID: config.WEBAUTHN_RP_ID,
      });
    } catch (err) {
      logger.warn({ err, userId }, "WebAuthn registration verification failed");
      sendProblem(res, Problems.validationFailed("Authenticator verification failed"));
      return;
    }

    if (!verification.verified || !verification.registrationInfo) {
      sendProblem(res, Problems.validationFailed("Authenticator could not be verified"));
      return;
    }

    // v13: credential fields are nested under registrationInfo.credential
    const { id: credentialId, publicKey, counter } =
      verification.registrationInfo.credential;

    await db.insert(webauthnCredentialsTable).values({
      userId,
      // credentialId is already a base64url string in v13
      credentialId,
      publicKey: Buffer.from(publicKey).toString("base64url"),
      signCount: counter,
    });

    await db
      .update(usersTable)
      .set({ webauthnEnrolled: true })
      .where(eq(usersTable.id, userId));

    await redis.del(regChallengeKey(userId));
    res.json({ verified: true });
  },
);

// POST /api/v1/auth/webauthn/stepup/options
// Generates authentication options for a step-up ceremony.
router.post(
  "/v1/auth/webauthn/stepup/options",
  requireSession,
  async (req, res): Promise<void> => {
    const userId = req.session!.userId;

    const creds = await db
      .select({ credentialId: webauthnCredentialsTable.credentialId })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, userId));

    if (creds.length === 0) {
      sendProblem(
        res,
        Problems.forbidden(
          "No WebAuthn authenticator enrolled. Enrol a passkey or security key before attempting Tier 3 actions.",
        ),
      );
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID: config.WEBAUTHN_RP_ID,
      userVerification: "required",
      // v13: ids are base64url strings
      allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    });

    await redis.set(stepupChallengeKey(userId), options.challenge, "EX", 120);
    res.json(options);
  },
);

// POST /api/v1/auth/webauthn/stepup/verify
// Verifies the step-up assertion and writes a short-lived step-up token to Redis.
router.post(
  "/v1/auth/webauthn/stepup/verify",
  requireSession,
  async (req, res): Promise<void> => {
    const userId = req.session!.userId;

    const expectedChallenge = await redis.get(stepupChallengeKey(userId));
    if (!expectedChallenge) {
      sendProblem(res, Problems.validationFailed("Step-up challenge expired or not found"));
      return;
    }

    const credentialId = (req.body as { id?: string })?.id;
    if (!credentialId) {
      sendProblem(res, Problems.validationFailed("Missing credential id in request body"));
      return;
    }

    const [cred] = await db
      .select()
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.credentialId, credentialId))
      .limit(1);

    if (!cred) {
      sendProblem(res, Problems.validationFailed("Credential not recognised"));
      return;
    }

    // v13: verifyAuthenticationResponse takes credential: WebAuthnCredential
    // (not the old authenticator object).
    const webAuthnCredential: WebAuthnCredential = {
      id: cred.credentialId,
      publicKey: Buffer.from(cred.publicKey, "base64url"),
      counter: cred.signCount,
    };

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: config.WEBAUTHN_RP_ORIGIN,
        expectedRPID: config.WEBAUTHN_RP_ID,
        credential: webAuthnCredential,
      });
    } catch (err) {
      logger.warn({ err, userId }, "WebAuthn step-up verification failed");
      sendProblem(res, Problems.validationFailed("Step-up verification failed"));
      return;
    }

    if (!verification.verified) {
      sendProblem(res, Problems.validationFailed("Step-up assertion not verified"));
      return;
    }

    await db
      .update(webauthnCredentialsTable)
      .set({ signCount: verification.authenticationInfo.newCounter })
      .where(eq(webauthnCredentialsTable.id, cred.id));

    // Step-up is valid for 10 minutes, scoped to this session's user only.
    await redis.set(stepUpKey(userId), "1", "EX", STEP_UP_TTL_SECONDS);
    await redis.del(stepupChallengeKey(userId));

    res.json({ verified: true, expiresInSeconds: STEP_UP_TTL_SECONDS });
  },
);

export default router;
