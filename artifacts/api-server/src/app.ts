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
// limit: the agent telemetry ingest endpoint (routes/v1/agent-events.ts) accepts
// a base64-encoded screenshot JPEG capped at MAX_SCREENSHOT_BASE64_LENGTH
// (8,000,000 chars) plus ocrText/other JSON fields and object-key overhead. The
// express.json() default of 100kb is far below that, so every real screenshot
// event was rejected by body-parser with a PayloadTooLargeError before Zod ever
// saw the request body. 10mb comfortably covers the 8MB cap plus overhead while
// still bounding pathological payloads.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Session middleware attaches req.session and req.tenantId from the bheka_sid cookie.
// Runs on every request. Unauthenticated routes ignore the absence of req.session.
app.use(sessionMiddleware);

// All API routes are mounted under /api.
app.use("/api", router);

// RFC 9457 fallback error handler. Catches unhandled errors from route handlers
// AND from body-parsing middleware above (e.g. body-parser's PayloadTooLargeError
// when a request exceeds the express.json()/urlencoded() limit).
// Never expose stack traces or internal paths in production responses.
//
// Well-formed client errors that already carry a real HTTP status (4xx) — such
// as body-parser's PayloadTooLargeError (status 413) — are surfaced as that
// status rather than collapsed into a generic 500. Collapsing them was itself a
// bug: an oversized-but-otherwise-valid request (e.g. a screenshot_capture event
// whose base64 payload exceeded the body size limit before Zod even saw it) came
// back as an opaque "Internal server error" instead of a clean, actionable 4xx.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  const errWithMeta = err as Error & {
    status?: number;
    statusCode?: number;
    type?: string;
  };
  const status = errWithMeta.status ?? errWithMeta.statusCode;

  if (errWithMeta.type === "entity.too.large" || status === 413) {
    logger.warn({ err }, "Request payload too large");
    sendProblem(
      res,
      Problems.payloadTooLarge(
        "The request body exceeds the maximum accepted size.",
      ),
    );
    return;
  }

  if (typeof status === "number" && status >= 400 && status < 500) {
    logger.warn({ err }, "Client error");
    sendProblem(res, {
      type: "https://docs.bheka.io/errors/bad-request",
      title: "Bad request",
      status,
    });
    return;
  }

  logger.error({ err }, "Unhandled route error");
  sendProblem(res, Problems.internalError());
});

export default app;
