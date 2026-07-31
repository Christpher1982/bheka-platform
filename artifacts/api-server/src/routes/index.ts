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

const router: IRouter = Router();

router.use(healthRouter);
router.use(oidcRouter);
router.use(webauthnRouter);
router.use(scimRouter);
router.use(tenantsRouter);
router.use(sitesRouter);
router.use(usersRouter);
router.use(endpointsRouter);

export default router;
