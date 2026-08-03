const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormat.format(parsed);
}

// IDs are UUIDv7, far too long for a table cell. The leading segment is the
// timestamp prefix, which is enough to tell rows apart at a glance.
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

// Rule identifiers arrive snake_case on the wire ("sensitive_keyword").
export function formatRuleName(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// app_usage_session durations arrive as whole seconds. Renders "42s" for
// sub-minute durations, "3m 12s" once it crosses a minute, matching the
// agent's own status-line style (see bheka_keystroke_agent.py).
export function formatDurationSeconds(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function fullName(user: {
  givenName: string | null;
  familyName: string | null;
  email: string;
}): string {
  const name = [user.givenName, user.familyName].filter(Boolean).join(" ");
  return name || user.email;
}
