// Root API router. Mounts all sub-routers under the /api prefix (set in app.ts).
// New route modules go here. Each module owns its own path segments.

import { Router, type IRouter } from "express";
import healthRouter from "./v1/health.js";
import oidcRouter from "./auth/oidc.js";
import webauthnRouter from "./auth/webauthn.js";
import scimRouter from "./auth/scim.js";
import tenantsRouter from "./v1/tenants.js";
import sitesRouter from "./v1/sites.js";
import usersRouter from "./v1/users.js";
import endpointsRouter from "./v1/endpoints.js";
import policiesRouter from "./v1/policies.js";
import detectionsRouter from "./v1/detections.js";
import casesRouter from "./v1/cases.js";
import approvalsRouter from "./v1/approvals.js";
import evidenceRouter from "./v1/evidence.js";
import transparencyRouter from "./v1/transparency.js";
import integrationsRouter from "./v1/integrations.js";
import webhooksRouter from "./v1/webhooks.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oidcRouter);
router.use(webauthnRouter);
router.use(scimRouter);
router.use(tenantsRouter);
router.use(sitesRouter);
router.use(usersRouter);
router.use(endpointsRouter);
router.use(policiesRouter);
router.use(detectionsRouter);
router.use(casesRouter);
router.use(approvalsRouter);
router.use(evidenceRouter);
router.use(transparencyRouter);
router.use(integrationsRouter);
router.use(webhooksRouter);

export default router;
