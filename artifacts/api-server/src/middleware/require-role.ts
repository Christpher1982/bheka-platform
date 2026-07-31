// RBAC role-check middleware factory.
// 007_RBAC_AND_IDENTITY section 2: permissions are enforced server-side.
// Returns a RequestHandler that verifies the authenticated user holds at least
// one of the required roles within their tenant before proceeding.
// A user must have a session (requireSession) before this middleware runs.

import type { RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  roleAssignmentsTable,
  rolesTable,
  type roleNameEnum,
} from "@workspace/db";
import { sendProblem, Problems } from "../lib/problem.js";
import { withTenantContext } from "../lib/tenant-context.js";
import { logger } from "../lib/logger.js";

type RoleName = (typeof roleNameEnum.enumValues)[number];

export function requireRole(...roles: RoleName[]): RequestHandler {
  return async (req, res, next) => {
    if (!req.session) {
      sendProblem(res, Problems.authRequired());
      return;
    }

    const { userId, tenantId } = req.session;

    try {
      const assignments = await withTenantContext(
        tenantId,
        async (tx) =>
          tx
            .select({ roleName: rolesTable.name })
            .from(roleAssignmentsTable)
            .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
            .where(
              and(
                eq(roleAssignmentsTable.userId, userId),
                eq(roleAssignmentsTable.tenantId, tenantId),
                eq(roleAssignmentsTable.active, true),
                inArray(rolesTable.name, roles),
              ),
            )
            .limit(1),
      );

      if (assignments.length === 0) {
        sendProblem(
          res,
          Problems.forbidden(
            `This action requires one of the following roles: ${roles.join(", ")}`,
          ),
        );
        return;
      }

      next();
    } catch (err) {
      logger.error({ err, userId, tenantId }, "Role check failed");
      sendProblem(res, Problems.internalError());
    }
  };
}
