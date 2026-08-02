// Response shapes for the bheka-gateway REST API.
//
// These are derived from the Drizzle row types in @workspace/db rather than
// restated by hand, so a schema change breaks compilation here instead of
// silently drifting. Two transformations are applied:
//   - `Jsonified` rewrites Date columns to the ISO strings JSON actually carries.
//   - `Pick` narrows each row to the subset the route handler serialises.
//
// Import is type-only: no @workspace/db runtime code (pg, drizzle) is bundled.
import type {
  ActivityEvent,
  ActivityEventMetadata,
  Approval,
  Case,
  CaseParticipant,
  Detection,
  Role,
  RoleAssignment,
  Site,
  User,
} from "@workspace/db/schema";

type Jsonified<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  pageInfo: PageInfo;
}

export type CaseDto = Pick<
  Jsonified<Case>,
  | "id"
  | "tenantId"
  | "subjectUserId"
  | "title"
  | "description"
  | "status"
  | "currentTier"
  | "openedByUserId"
  | "closedAt"
  | "createdAt"
  | "updatedAt"
>;

export type CaseDetailDto = CaseDto & Pick<Jsonified<Case>, "closedByUserId">;

export type CaseParticipantDto = Pick<
  Jsonified<CaseParticipant>,
  "id" | "caseId" | "userId" | "role" | "addedByUserId" | "createdAt"
>;

export type DetectionDto = Pick<
  Jsonified<Detection>,
  | "id"
  | "tenantId"
  | "policyRuleId"
  | "ruleName"
  | "severity"
  | "summary"
  | "subjectUserId"
  | "tier"
  | "status"
  | "sourceEventIds"
  | "occurredAt"
  | "triagedAt"
  | "triagedBy"
  | "resolvedAt"
  | "resolvedBy"
  | "notes"
  | "createdAt"
  | "updatedAt"
>;

// GET /v1/detections/:detectionId/evidence joins the activity_events row a
// v0 rule fired on with the parent detection's analyst-facing fields.
export type DetectionEvidenceDto = Pick<
  Jsonified<ActivityEvent>,
  "eventType" | "occurredAt" | "siteId" | "subjectUserId" | "sourceAgentId"
> & {
  eventId: ActivityEvent["id"];
  metadata: ActivityEventMetadata;
  detection: Pick<
    Jsonified<Detection>,
    "id" | "ruleName" | "severity" | "summary" | "status"
  >;
};

export type SiteDto = Pick<
  Jsonified<Site>,
  | "id"
  | "tenantId"
  | "name"
  | "description"
  | "timezone"
  | "lowBandwidthThresholdKbps"
  | "active"
  | "createdAt"
  | "updatedAt"
>;

export type UserDto = Pick<
  Jsonified<User>,
  | "id"
  | "tenantId"
  | "email"
  | "givenName"
  | "familyName"
  | "externalId"
  | "provisionedVia"
  | "webauthnEnrolled"
  | "active"
  | "createdAt"
  | "updatedAt"
>;

export type RoleDto = Pick<Jsonified<Role>, "id" | "name" | "displayName" | "description">;

// GET /v1/users/:userId/role-assignments joins roles, so the row carries the
// role's name and display name alongside the assignment columns.
export type RoleAssignmentDto = Pick<
  Jsonified<RoleAssignment>,
  "id" | "tenantId" | "userId" | "roleId" | "assignedBy" | "active" | "createdAt"
> & {
  roleName: Role["name"];
  roleDisplayName: string;
};

export type ApprovalDto = Pick<
  Jsonified<Approval>,
  | "id"
  | "tenantId"
  | "caseId"
  | "subjectType"
  | "approverUserId"
  | "requestedByUserId"
  | "status"
  | "isInformationOfficerApproval"
  | "expiresAt"
  | "decisionAt"
  | "decisionNotes"
  | "createdAt"
  | "updatedAt"
>;

export interface SessionDto {
  userId: string;
  tenantId: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
  roles: Role["name"][];
}

export type CaseStatus = Case["status"];
export type DetectionStatus = Detection["status"];
export type ApprovalStatus = Approval["status"];
