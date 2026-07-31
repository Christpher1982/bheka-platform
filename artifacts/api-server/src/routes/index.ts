// Root API router. Mounts all sub-routers under the /api prefix (set in app.ts).
// New route modules go here. Each module is responsible for its own path segments.

import { Router, type IRouter } from "express";
import healthRouter from "./v1/health.js";
import oidcRouter from "./auth/oidc.js";
import webauthnRouter from "./auth/webauthn.js";
import scimRouter from "./auth/scim.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oidcRouter);
router.use(webauthnRouter);
router.use(scimRouter);

export default router;
