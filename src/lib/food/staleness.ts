/**
 * When a cached provider food stops being trustworthy.
 *
 * The cache exists so that logging the same chicken breast twice does not
 * cost two API calls, and it has been insert-only from the start: a food
 * fetched once was reused for ever. That is right for a week and wrong for a
 * year — Open Food Facts entries are community-edited and get corrected, and
 * USDA revises its releases, so a figure fixed upstream never arrived.
 *
 * Thirty days. Long enough that ordinary use never rewrites a row and the
 * cache goes on doing its job; short enough that a correction reaches the
 * diary within a month of being made. The same number is written into the
 * RLS policy that permits the refresh (migration 0010), because a rule the
 * database cannot enforce is a rule the client is merely asked to follow —
 * and one the client does not know would have it attempting writes that get
 * refused.
 *
 * Pure and client-safe, so the window can be reasoned about and tested
 * without a database or a clock.
 */

export const CACHE_FRESH_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a cached row is old enough to be worth replacing.
 *
 * A row with no date is treated as stale: it predates the column, so nothing
 * is known about when it last agreed with its provider, and "unknown" is not
 * a reason to trust it for ever.
 */
export function isStale(
  refreshedAt: string | null,
  now: Date = new Date(),
  windowDays: number = CACHE_FRESH_DAYS,
): boolean {
  if (!refreshedAt) return true;

  const at = Date.parse(refreshedAt);
  // An unparseable timestamp is a broken row, not a fresh one.
  if (Number.isNaN(at)) return true;

  return now.getTime() - at >= windowDays * DAY_MS;
}
