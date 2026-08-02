// ─────────────────────────────────────────────────────────────────────────────
// v0 RULE ENGINE — deliberately simple, meant to be extended.
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the first-cut detection engine. It runs synchronously inside the
// agent ingest request (routes/v1/agent-events.ts) against a single
// activity_event at a time. That is the defining limitation of v0: a rule can
// only see the event in front of it. Anything needing history, cross-user
// correlation, baselining, or windowed aggregation does NOT belong here yet —
// that is bheka-policy's job, and detections it raises carry a policy_rule_id.
//
// Rules here are code-defined and carry a stable `name` instead. Thresholds and
// wordlists are env-configurable so an operator can tune them without a deploy;
// the defaults below are the shipped behaviour.
//
// To add a rule: write a function of type Rule and append it to RULES. Return
// null to mean "did not fire". The first matching rule wins — see evaluateEvent.
//
// Deliberately NOT handled in v0, in rough priority order for whoever picks
// this up next:
//   - multiple simultaneous matches (only the highest-severity match is kept)
//   - per-tenant rule configuration (env vars are process-global today)
//   - allowlisting (e.g. the security team's own machines matching keywords)
//
// Rate limiting / dedupe is now partially handled: agent-events.ts applies a
// per-(tenant, ruleName, subject) cooldown window (ruleConfig.dedupeCooldownMinutes
// below) before inserting a new detection, so a noisy endpoint firing the same
// rule on the same subject repeatedly does not flood the detections table. This
// is still a simple, single-window cooldown — it does not do any smarter
// aggregation (e.g. merging cooldown-suppressed events into the original
// detection's evidence), and it is scoped to v0 rules only.

import type { ActivityEventMetadata } from "@workspace/db";

// ── Configuration ───────────────────────────────────────────────────────────
// Env-overridable. Defaults are the shipped v0 behaviour.

const DEFAULT_SENSITIVE_KEYWORDS = [
  "password",
  "confidential",
  "resign",
  "resignation",
  "leak",
  "ssn",
  "social security",
  "credit card",
  "api key",
  "secret key",
];

const DEFAULT_OFF_HOURS_START = 7; // 07:00
const DEFAULT_OFF_HOURS_END = 19; // 19:00
const DEFAULT_OFF_HOURS_TIMEZONE = "Africa/Johannesburg";
const DEFAULT_KEYSTROKE_THRESHOLD = 500;
const DEFAULT_DEDUPE_COOLDOWN_MINUTES = 30;

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const ruleConfig = {
  // RULE_SENSITIVE_KEYWORDS: comma-separated, matched case-insensitively.
  sensitiveKeywords: envList(
    "RULE_SENSITIVE_KEYWORDS",
    DEFAULT_SENSITIVE_KEYWORDS,
  ),
  // Activity outside [start, end) local time is off-hours.
  offHoursStartHour: envInt("RULE_OFF_HOURS_START_HOUR", DEFAULT_OFF_HOURS_START),
  offHoursEndHour: envInt("RULE_OFF_HOURS_END_HOUR", DEFAULT_OFF_HOURS_END),
  // IANA zone the off-hours window is expressed in.
  offHoursTimezone:
    process.env.RULE_OFF_HOURS_TIMEZONE || DEFAULT_OFF_HOURS_TIMEZONE,
  // Strictly greater than this many keystrokes in one event fires the rule.
  keystrokeThreshold: envInt(
    "RULE_KEYSTROKE_THRESHOLD",
    DEFAULT_KEYSTROKE_THRESHOLD,
  ),
  // Minutes a rule stays "cooled down" for a given subject after it last
  // raised a detection. Applies generically to every rule: if the same
  // ruleName already produced a detection for the same subject within this
  // many minutes of the current event, agent-events.ts skips raising a new
  // one so a noisy endpoint cannot flood the detections table.
  dedupeCooldownMinutes: envInt(
    "RULE_DEDUPE_COOLDOWN_MINUTES",
    DEFAULT_DEDUPE_COOLDOWN_MINUTES,
  ),
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export type Severity = "low" | "medium" | "high" | "critical";

export interface RuleInput {
  eventType: string;
  occurredAt: Date;
  metadata: ActivityEventMetadata;
}

export interface RuleMatch {
  ruleName: string;
  severity: Severity;
  summary: string;
  // Visibility tier of the telemetry the rule had to read to fire
  // (008_DATA_MODEL section 4). Content-reading rules are Tier 3.
  tier: number;
}

type Rule = (input: RuleInput) => RuleMatch | null;

// ── Rule (a): sensitive_keyword ─────────────────────────────────────────────
// Reads captured content, so it is Tier 3. Checks both keystroke-captured
// text (metadata.capturedText, from keystroke_batch events) and local-OCR
// text pulled off a screenshot (metadata.ocrText, from screenshot_capture
// events) — whichever field is present and non-empty on the given event.
// A single event only ever populates one of the two in practice, but this
// rule makes no assumption about eventType so it stays generic.

const KEYWORD_CONTEXT_CHARS = 40;

function findKeywordMatch(
  text: string,
): { keyword: string; context: string } | null {
  const haystack = text.toLowerCase();
  const keyword = ruleConfig.sensitiveKeywords.find((k) =>
    haystack.includes(k),
  );
  if (!keyword) return null;

  const at = haystack.indexOf(keyword);
  const from = Math.max(0, at - KEYWORD_CONTEXT_CHARS);
  const to = Math.min(text.length, at + keyword.length + KEYWORD_CONTEXT_CHARS);
  const context =
    (from > 0 ? "…" : "") + text.slice(from, to) + (to < text.length ? "…" : "");
  return { keyword, context };
}

const sensitiveKeyword: Rule = ({ metadata }) => {
  const candidates: Array<{ field: string; text: string }> = [];
  if (typeof metadata.capturedText === "string" && metadata.capturedText.length > 0) {
    candidates.push({ field: "Captured text", text: metadata.capturedText });
  }
  if (typeof metadata.ocrText === "string" && metadata.ocrText.length > 0) {
    candidates.push({ field: "Screenshot OCR text", text: metadata.ocrText });
  }

  for (const { field, text } of candidates) {
    const match = findKeywordMatch(text);
    if (!match) continue;
    return {
      ruleName: "sensitive_keyword",
      severity: "high",
      summary: `${field} contains the sensitive keyword "${match.keyword}": ${match.context}`,
      tier: 3,
    };
  }
  return null;
};

// ── Rule (b): off_hours_activity ────────────────────────────────────────────
// Reads only a timestamp, so it is Tier 1.

// Intl is used rather than manual UTC offset arithmetic because South Africa
// has no DST today but the rule must stay correct for other configured zones.
function hourInTimezone(when: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(when);
  // "24" is how en-GB renders midnight with hour12:false.
  return Number(formatted) % 24;
}

const offHoursActivity: Rule = ({ occurredAt }) => {
  const { offHoursStartHour, offHoursEndHour, offHoursTimezone } = ruleConfig;
  const hour = hourInTimezone(occurredAt, offHoursTimezone);
  if (hour >= offHoursStartHour && hour < offHoursEndHour) return null;

  const pad = (h: number) => String(h).padStart(2, "0");
  return {
    ruleName: "off_hours_activity",
    severity: "medium",
    summary:
      `Activity at ${pad(hour)}:00 ${offHoursTimezone} falls outside the ` +
      `${pad(offHoursStartHour)}:00–${pad(offHoursEndHour)}:00 working window.`,
    tier: 1,
  };
};

// ── Rule (c): high_volume_keystrokes ────────────────────────────────────────
// Reads a content-derived counter but no content itself, so it is Tier 2.

const highVolumeKeystrokes: Rule = ({ metadata }) => {
  const count = metadata.keystrokeCount;
  if (typeof count !== "number" || count <= ruleConfig.keystrokeThreshold) {
    return null;
  }

  return {
    ruleName: "high_volume_keystrokes",
    severity: "low",
    summary:
      `${count} keystrokes in a single event exceeds the threshold of ` +
      `${ruleConfig.keystrokeThreshold}.`,
    tier: 2,
  };
};

// Evaluation order is significant: see evaluateEvent.
const RULES: Rule[] = [sensitiveKeyword, offHoursActivity, highVolumeKeystrokes];

/**
 * Runs every v0 rule against one activity event and returns the single most
 * severe match, or null if nothing fired.
 *
 * v0 raises at most one detection per event so a single noisy event cannot
 * produce three rows an analyst has to triage separately. Ties break in RULES
 * order, which is why the list is ordered most-severe-first.
 */
export function evaluateEvent(input: RuleInput): RuleMatch | null {
  const SEVERITY_RANK: Record<Severity, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  let best: RuleMatch | null = null;
  for (const rule of RULES) {
    const match = rule(input);
    if (!match) continue;
    if (!best || SEVERITY_RANK[match.severity] > SEVERITY_RANK[best.severity]) {
      best = match;
    }
  }
  return best;
}
