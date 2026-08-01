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

export function fullName(user: {
  givenName: string | null;
  familyName: string | null;
  email: string;
}): string {
  const name = [user.givenName, user.familyName].filter(Boolean).join(" ");
  return name || user.email;
}
