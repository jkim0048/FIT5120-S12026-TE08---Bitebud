/** Local timezone used for calendar-day grouping across BiteBud. */
export const LOCAL_TIMEZONE = "Australia/Melbourne";

const LOCAL_CALENDAR_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: LOCAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Returns the YYYY-MM-DD calendar date of `date` evaluated in Melbourne time. */
export function localCalendarDateString(date: Date): string {
  return LOCAL_CALENDAR_FORMATTER.format(date);
}

/** PostgreSQL `date` values must not be serialized with `toISOString()` (timezone shift). */
export function pgDateColumnToYmd(value: Date | string): string {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match) return match[1];
  }
  return localCalendarDateString(new Date(value));
}

export function parseIsoDateOnly(isoDateString: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDateString.trim());
  if (!dateMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const dayOfMonth = Number(dateMatch[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(dayOfMonth)) return null;
  const parsedUtc = new Date(Date.UTC(year, month - 1, dayOfMonth, 0, 0, 0, 0));
  if (
    parsedUtc.getUTCFullYear() !== year ||
    parsedUtc.getUTCMonth() !== month - 1 ||
    parsedUtc.getUTCDate() !== dayOfMonth
  )
    return null;
  return parsedUtc;
}

export function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

export function todayMelbourneDate(): Date {
  const todayStr = localCalendarDateString(new Date());
  const parsed = parseIsoDateOnly(todayStr);
  if (!parsed) throw new Error("Failed to resolve Melbourne calendar date");
  return parsed;
}
