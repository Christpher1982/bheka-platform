// TypeScript types for every Bheka event published by bheka-gateway.
// Each interface mirrors its JSON Schema counterpart in schemas/events/.
// Producer values match the JSON Schema `const` — bheka-gateway acts in
// bheka-case's role for CASE/EVIDENCE/NOTICE stream events until bheka-case
// is deployed as a standalone service (010_EVENT_BUS_AND_TOPICS section 2).

export type ApprovalSubjectType =
  | "tier_escalation"
  | "evidence_export"
  | "evidence_reidentification"
  | "legal_hold_override"
  | "tenant_key_shred";

export type NoticeType =
  | "deployment"
  | "tier_2_activation"
  | "tier_3_activation"
  | "conclusion_disclosure"
  | "policy_change"
  | "breach_notice"
  | "data_subject_request_response";

export type DeliveryChannel = "email" | "whatsapp" | "in_app";

// ── Base envelope ────────────────────────────────────────────────────────────

interface Envelope<S extends string, P extends string, D> {
  event_id: string;       // UUIDv7 — de-duplicate consumers on this field
  schema_version: S;      // Used as the NATS subject
  occurred_at: string;    // ISO 8601 UTC
  producer: P;
  data: D;
}

// ── CASE stream ──────────────────────────────────────────────────────────────

export type CaseOpenedEvent = Envelope<
  "bheka.case.opened.v1",
  "bheka-case",
  {
    case_id: string;
    tenant_id: string;
    subject_user_id: string;
    opened_by_user_id: string;
    initial_tier: 1;
    title?: string;
  }
>;

export type ApprovalRequestedEvent = Envelope<
  "bheka.approval.requested.v1",
  "bheka-case",
  {
    approval_id: string;
    case_id: string;
    tenant_id: string;
    subject_type: ApprovalSubjectType;
    approver_user_id: string;
    requested_by_user_id: string;
    is_information_officer_approval: boolean;
    expires_at: string;
  }
>;

export type ApprovalGrantedEvent = Envelope<
  "bheka.approval.granted.v1",
  "bheka-case",
  {
    approval_id: string;
    case_id: string;
    tenant_id: string;
    subject_type: ApprovalSubjectType;
    approver_user_id: string;
    is_information_officer_approval: boolean;
    decision_notes?: string;
  }
>;

// ── AGENT stream ─────────────────────────────────────────────────────────────

export type AgentEnrolledEvent = Envelope<
  "bheka.agent.enrolled.v1",
  "bheka-gateway",
  {
    agent_id: string;
    endpoint_id: string;
    tenant_id: string;
    site_id: string;
    platform: "windows" | "linux" | "macos";
    agent_version_id: string;
    certificate_fingerprint: string;
  }
>;

export type AgentHeartbeatEvent = Envelope<
  "bheka.agent.heartbeat.v1",
  "bheka-gateway",
  {
    agent_id: string;
    tenant_id: string;
    endpoint_id: string;
    current_tier?: "baseline" | "elevated" | "investigation";
    buffer_used_bytes?: number;
    agent_version?: string;
  }
>;

// ── EVIDENCE stream ──────────────────────────────────────────────────────────

export type EvidenceViewedEvent = Envelope<
  "bheka.evidence.viewed.v1",
  "bheka-case",
  {
    evidence_view_id: string;
    evidence_id: string;
    case_id: string;
    tenant_id: string;
    viewer_user_id: string;
    tier: 1 | 2 | 3;
  }
>;

export type EvidenceExportedEvent = Envelope<
  "bheka.evidence.exported.v1",
  "bheka-case",
  {
    export_id: string;
    evidence_id: string;
    case_id: string;
    tenant_id: string;
    requester_user_id: string;
    tier: 1 | 2 | 3;
    export_reason?: string;
  }
>;

// ── NOTICE stream ────────────────────────────────────────────────────────────

export type NoticeIssuedEvent = Envelope<
  "bheka.notice.issued.v1",
  "bheka-case",
  {
    notice_id: string;
    tenant_id: string;
    user_id: string;
    notice_type: NoticeType;
    language: string;
    issued_at: string;
    delivery_channels?: DeliveryChannel[];
  }
>;

// ── Union ────────────────────────────────────────────────────────────────────

export type BhekaEvent =
  | CaseOpenedEvent
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | AgentEnrolledEvent
  | AgentHeartbeatEvent
  | EvidenceViewedEvent
  | EvidenceExportedEvent
  | NoticeIssuedEvent;
