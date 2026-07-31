// Express request type augmentations for bheka-gateway.
// ADR-001: this gateway uses Express 5 instead of the CANON-specified Fastify 5.
// All middleware attaches properties to req; declare them here to keep TypeScript strict.

import type { BhekaSession } from "../middleware/session.js";

declare global {
  namespace Express {
    interface Request {
      // Populated by sessionMiddleware when a valid bheka_sid cookie is present.
      session?: BhekaSession;
      // Tenant ID resolved from the session. Used to set the PostgreSQL RLS context.
      tenantId?: string;
      // Tenant ID resolved from a SCIM bearer token (GUIDE-01 section 6.1).
      scimTenantId?: string;
    }
  }
}

export {};
