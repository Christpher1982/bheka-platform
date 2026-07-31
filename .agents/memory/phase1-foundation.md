---
name: Phase 1 Foundation — Implementation Notes
description: Durable lessons from building the auth/RBAC/schema foundation for bheka-gateway.
---

## Drizzle schema — no PostgreSQL-level UUID defaults
`$defaultFn(() => uuidv7())` is a Drizzle-layer default only. It does NOT produce a `DEFAULT` clause
in PostgreSQL. Raw SQL seeds (e.g. rls-policies.sql) must use `gen_random_uuid()` explicitly.
**Why:** Drizzle calls the function when building insert values; PostgreSQL never sees it.
**How to apply:** Any seed INSERT that uses the `id` column must pass `gen_random_uuid()` explicitly,
or the role must be seeded via `db.insert(...)` through Drizzle ORM.

## Drizzle composite project — must build before typecheck of dependents
`lib/db` has `composite: true` and `emitDeclarationOnly: true`. Run `tsc --build lib/db/tsconfig.json`
before running typecheck on `@workspace/api-server`, or incremental builds will fail on missing `.d.ts`.
**Why:** api-server references lib/db via TypeScript project references; it resolves from `dist/*.d.ts`.
**How to apply:** On fresh checkout or after schema changes, run `tsc --build lib/db/tsconfig.json` first.

## @node-rs/argon2 — externalize in esbuild, NOT just *.node
The build.mjs already has `"*.node"` in externals but esbuild still traverses the `require()` chain
inside `@node-rs/argon2-linux-x64-gnu`. Must explicitly add `"@node-rs/argon2"` and
`"@node-rs/argon2-linux-x64-gnu"` to the externals array.
**Why:** esbuild follows dynamic `require()` calls into sub-packages even when `*.node` is external.

## @simplewebauthn/server v13 API breaking changes
- `excludeCredentials[].id` and `allowCredentials[].id` are `string` (base64url), not `Buffer`.
- `registrationInfo.credentialID/credentialPublicKey/counter` moved to `registrationInfo.credential.{id,publicKey,counter}`.
- `verifyAuthenticationResponse` takes `credential: WebAuthnCredential` (not `authenticator`).
- `WebAuthnCredential` is exported from `"@simplewebauthn/server"` directly (not `"@simplewebauthn/server/types"`).

## RLS policies location
RLS is applied via `lib/db/src/rls-policies.sql` (not inline in Drizzle schema).
Apply once per environment with: `psql $DATABASE_URL -f lib/db/src/rls-policies.sql`
Idempotent: uses `DROP POLICY IF EXISTS` and `ON CONFLICT DO NOTHING`.

## Required env vars added in Phase 1
New required env vars (beyond pre-existing DATABASE_URL and SESSION_SECRET):
- `REDIS_URL` — Redis connection string (required for session management)
- `WEBAUTHN_RP_ID` — WebAuthn RP ID (domain, e.g. `app.bheka.eride.tech`)
- `WEBAUTHN_RP_ORIGIN` — WebAuthn RP Origin (full HTTPS URL)
These must be set before the Phase 1 server can start.
