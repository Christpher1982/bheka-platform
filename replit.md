# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

### Agent telemetry ingest env

- `AGENT_INGEST_TOKEN` — shared secret agents send in `X-Agent-Token` on `POST /api/v1/agent/events`. Min 32 chars. Optional, but the endpoint rejects every request while it is unset.

v0 rule engine tuning (`artifacts/api-server/src/rules/evaluate.ts`), all optional:

- `RULE_SENSITIVE_KEYWORDS` — comma-separated, case-insensitive. Default: `password,confidential,resign,resignation,leak,ssn,social security,credit card,api key,secret key`
- `RULE_OFF_HOURS_START_HOUR` / `RULE_OFF_HOURS_END_HOUR` — working window. Defaults `7` / `19`
- `RULE_OFF_HOURS_TIMEZONE` — IANA zone the window is expressed in. Default `Africa/Johannesburg`
- `RULE_KEYSTROKE_THRESHOLD` — fires above this count. Default `500`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
