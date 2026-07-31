// Express application setup for bheka-gateway.
// ADR-001: Express 5 is used instead of the CANON-specified Fastify 5.
// CANON section 9: every privileged endpoint writes to audit_log before returning.
// API_STANDARD section 2: errors use RFC 9457 application/problem+json.

import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger.js";
import { sessionMiddleware } from "./middleware/session.js";
import { sendProblem, Problems } from "./lib/problem.js";
import router from "./routes/index.js";

const app: Express = express();

// Structured request logging. Serializers strip query strings and sensitive headers
// to prevent OIDC codes and session tokens from appearing in logs.
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") ?? false,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware attaches req.session and req.tenantId from the bheka_sid cookie.
// Runs on every request. Unauthenticated routes ignore the absence of req.session.
app.use(sessionMiddleware);

// All API routes are mounted under /api.
app.use("/api", router);

// RFC 9457 fallback error handler. Catches unhandled errors from route handlers.
// Never expose stack traces or internal paths in production responses.
app.use((_err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  logger.error({ err: _err }, "Unhandled route error");
  sendProblem(res, Problems.internalError());
});

export default app;
