// Requires a valid, active session on the request.
// Attach as a preHandler to every authenticated route in bheka-gateway.
// Returns 401 application/problem+json if no session is present.

import type { RequestHandler } from "express";
import { sendProblem, Problems } from "../lib/problem.js";

export const requireSession: RequestHandler = (req, res, next) => {
  if (!req.session) {
    sendProblem(res, Problems.authRequired());
    return;
  }
  next();
};
