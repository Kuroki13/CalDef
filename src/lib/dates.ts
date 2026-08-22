/**
 * Calendar-day helpers.
 *
 * A diary day is a local calendar day, not a UTC one. Logging dinner at
 * 21:00 in Paris must land on that date, not tomorrow's, so every "today"
 * in this app is resolved against the profile's stored timezone rather than
 * the server's clock.
 *
 * Dates are handled as plain `YYYY-MM-DD` strings, matching the Postgres
 * `date` columns, which avoids the usual Date-object timezone drift.
 */

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** The current calendar date in a given IANA timezone. Falls back to UTC. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): IsoDate {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Shifts an ISO date by whole days. Negative goes back. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const total = daysBetween(from, to);
  if (total < 0) return [];
  return Array.from({ length: total + 1 }, (_, i) => addDays(from, i));
}

/** The Monday on or before `date` — the week boundary used for check-ins. */
export function startOfIsoWeek(date: IsoDate): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: 0 = Sunday. Monday-based offset.
  const offset = (dt.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}
