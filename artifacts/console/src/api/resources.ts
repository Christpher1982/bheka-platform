// One thin function per API route the console uses.
// Paths and query parameters mirror artifacts/api-server/src/routes/v1.

import { apiFetch, newIdempotencyKey } from "./client";
import type {
  ActivityEventDetailDto,
  ActivityEventDto,
  ApprovalDto,
  CaseDetailDto,
  CaseDto,
  CaseParticipantDto,
  CaseStatus,
  DetectionDto,
  DetectionEvidenceDto,
  EvidenceImageDto,
  Paginated,
  RoleAssignmentDto,
  RoleDto,
  SessionDto,
  SiteDto,
  UserDto,
} from "./types";

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

// ── auth ────────────────────────────────────────────────────────────────────

export function getSession(): Promise<SessionDto> {
  return apiFetch<SessionDto>("/v1/auth/session");
}

export function devLogin(email: string): Promise<{ userId: string; tenantId: string }> {
  return apiFetch("/v1/auth/dev-login", { method: "POST", body: { email } });
}

export function logout(): Promise<void> {
  return apiFetch<void>("/v1/auth/logout", { method: "POST" });
}

// ── cases ───────────────────────────────────────────────────────────────────

export function listCases(
  query: PageQuery & { status?: CaseStatus },
): Promise<Paginated<CaseDto>> {
  return apiFetch("/v1/cases", { params: { ...query } });
}

export function getCase(caseId: string): Promise<CaseDetailDto> {
  return apiFetch(`/v1/cases/${caseId}`);
}

export function listCaseParticipants(
  caseId: string,
): Promise<{ items: CaseParticipantDto[] }> {
  return apiFetch(`/v1/cases/${caseId}/participants`);
}

export interface CreateCaseInput {
  subjectUserId: string;
  title: string;
  description?: string;
}

export function createCase(input: CreateCaseInput): Promise<CaseDetailDto> {
  return apiFetch("/v1/cases", {
    method: "POST",
    body: input,
    idempotencyKey: newIdempotencyKey(),
  });
}

// ── detections ──────────────────────────────────────────────────────────────

export function listDetections(
  query: PageQuery & { status?: string; tier?: number },
): Promise<Paginated<DetectionDto>> {
  return apiFetch("/v1/detections", { params: { ...query } });
}

export function getDetection(detectionId: string): Promise<DetectionDto> {
  return apiFetch(`/v1/detections/${detectionId}`);
}

// Full raw event behind a detection's short summary. Fetching this is logged
// to audit_log server-side (action "detection.evidence_viewed").
export function getDetectionEvidence(
  detectionId: string,
): Promise<DetectionEvidenceDto> {
  return apiFetch(`/v1/detections/${detectionId}/evidence`);
}

// ── activity events ────────────────────────────────────────────────────────

export function listActivityEvents(
  query: PageQuery & { subjectUserId?: string; siteId?: string },
): Promise<Paginated<ActivityEventDto>> {
  return apiFetch("/v1/activity-events", { params: { ...query } });
}

// Full raw event, including capturedText. Fetching this is logged to
// audit_log server-side (action "activity_event.viewed").
export function getActivityEvent(
  eventId: string,
): Promise<ActivityEventDetailDto> {
  return apiFetch(`/v1/activity-events/${eventId}`);
}

// ── evidence images ─────────────────────────────────────────────────────────

export function listEvidenceImages(
  query: PageQuery & { siteId?: string; subjectUserId?: string; sourceAgentId?: string },
): Promise<Paginated<EvidenceImageDto>> {
  return apiFetch("/v1/evidence-images", { params: { ...query } });
}

export function getEvidenceImage(id: string): Promise<EvidenceImageDto> {
  return apiFetch(`/v1/evidence-images/${id}`);
}

// Image bytes are not fetched through apiFetch (they are not JSON) — the
// console points <img src> directly at this same-origin URL, so the
// bheka_sid session cookie rides along automatically. See vite.config.ts's
// /api proxy: this resolves the same way every other /api request does.
export function evidenceImageUrl(id: string): string {
  return `/api/v1/evidence-images/${id}/image`;
}

// ── sites ───────────────────────────────────────────────────────────────────

export function listSites(query: PageQuery): Promise<Paginated<SiteDto>> {
  return apiFetch("/v1/sites", { params: { ...query } });
}

// ── users & roles ───────────────────────────────────────────────────────────

export function listUsers(query: PageQuery): Promise<Paginated<UserDto>> {
  return apiFetch("/v1/users", { params: { ...query } });
}

export function listRoles(): Promise<{ items: RoleDto[] }> {
  return apiFetch("/v1/roles");
}

export function listRoleAssignments(
  userId: string,
): Promise<{ items: RoleAssignmentDto[] }> {
  return apiFetch(`/v1/users/${userId}/role-assignments`);
}

// ── approvals ───────────────────────────────────────────────────────────────

export function listApprovals(
  query: PageQuery & { status?: string; caseId?: string },
): Promise<Paginated<ApprovalDto>> {
  return apiFetch("/v1/approvals", { params: { ...query } });
}
