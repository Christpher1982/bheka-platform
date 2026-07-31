---
Document: ADR-001-EXPRESS-INSTEAD-OF-FASTIFY
Version: 1.0
Status: Locked
Owner: Engineering lead
Last reviewed: 2026-07-31
Depends on: none
---

> CONFIDENTIAL — Eride Technologies (Pty) Ltd. Not for distribution outside Eride
> Technologies or parties under written NDA. Contains proprietary architecture.

# ADR-001: Express 5 instead of Fastify 5 for bheka-gateway

## Status

Accepted

## Context

CANON section 2 specifies Fastify 5 as the HTTP framework for the backend. The Replit
monorepo scaffold used to initialise this repository provides an Express 5 server as the
`artifacts/api-server` package, with associated tooling (build pipeline, pino-http
integration, esbuild config) already wired for Express.

Migrating the scaffold to Fastify before any product code exists would cost one to two
days of infrastructure work — rewriting the plugin system, replacing pino-http with
Fastify's native logging, updating the esbuild config — with no user-visible outcome.
Express 5 is production-grade and meets all functional requirements for the `bheka-gateway`
surface in Phase 1 through Phase 5.

## Decision

Use Express 5 for `bheka-gateway` throughout v1. The Replit scaffold is retained as-is.

This decision applies only to `bheka-gateway`. `eride-vault` and `bheka-updater` remain
Rust. `bheka-console` remains Next.js 15. No other service is affected.

## Consequences

- All GUIDE-01 through GUIDE-N code examples written for Fastify plugins and hooks must
  be ported to Express middleware and Router. The functional behaviour (OIDC flow, session
  management, WebAuthn step-up, SCIM, rate limiting, RFC 9457 errors) is identical;
  only the framework surface changes.
- A future migration to Fastify 5 is possible without an ADR because it is a return to
  the CANON-specified stack; the ADR that would be needed is the one superseding this one.
- TypeScript types for Express request augmentation (`req.session`, `req.tenantId`) are
  declared in `artifacts/api-server/src/types/express.d.ts` and must be kept in sync if
  Fastify types are ever introduced.

## AI implementation constraints

- Do not introduce Fastify-specific packages (`fastify`, `@fastify/*`) into
  `artifacts/api-server`. If a future ADR supersedes this one and the migration occurs,
  that ADR governs the dependency change.
- All middleware in `artifacts/api-server/src/middleware/` must be Express-compatible
  (`RequestHandler` signature, `next()` pattern, not Fastify hooks).

## Required inputs

- None. This ADR records a decision already made at project initialisation.

## Expected outputs

- This ADR, committed before Phase 1 code is written.
- All `bheka-gateway` implementation guides ported from Fastify to Express.

## Dependencies

- CANON section 2 (the decision this ADR overrides for bheka-gateway).

## Acceptance criteria

- Given this ADR, when any engineer asks why the scaffold uses Express instead of the
  CANON-specified Fastify, then this document provides the complete answer.
- Given Phase 1 code review, when checking `artifacts/api-server/package.json`, then
  no `fastify` or `@fastify/*` packages appear.

## Test checklist

- [ ] `artifacts/api-server/package.json` contains no fastify dependency.
- [ ] All middleware files use Express `RequestHandler` types.
- [ ] All route files use Express `Router` from `express`.
