import "server-only";

/**
 * What this user actually eats, as a tie-break for search.
 *
 * Relevance settles a phrase — "dubai chocolate" beats "chocolate syrup"
 * because it matches both words. It cannot settle a single word: every
 * chicken row matches "chicken" exactly as well as every other, so the
 * fan-out order decided, and USDA's "Chicken spread" could lead. KNOWN
 * ISSUES said a better tie-break would need a notion of how typical a food
 * is, which no provider gives us.
 *
 * The user's own diary is that notion, and it is a better one than typical:
 * it is not what people generally eat but what this person has actually
 * eaten. A food logged before is nearly always the one meant.
 *
 * Keyed by `foods.id`, which is enough. Only a cached food can have been
 * logged, cached hits come back from `searchCache` carrying their id, and
 * the merge already prefers the cached copy of a food a provider also
 * returned — so the row that gets the boost is the row that would have been
 * shown anyway.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * How far back the tie-break looks.
 *
 * Recent enough to follow a change in diet, large enough that a food eaten
 * weekly is still in it. This is one small query per search, and the diary
 * of a single user is not large.
 */
export const HISTORY_ROWS = 500;

/**
 * How many times each food appears in the user's recent diary.
 *
 * RLS scopes this to the caller, so it is their own history and nobody
 * else's. A failure returns an empty map rather than throwing: not knowing
 * what someone has eaten before is a reason to rank a search slightly worse,
 * never a reason to fail it.
 */
export async function loggedFoodCounts(): Promise<Map<number, number>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("food_logs")
    .select("food_id")
    .not("food_id", "is", null)
    .order("log_date", { ascending: false })
    .limit(HISTORY_ROWS);

  const counts = new Map<number, number>();
  if (error || !data) return counts;

  for (const row of data) {
    if (row.food_id === null) continue;
    counts.set(row.food_id, (counts.get(row.food_id) ?? 0) + 1);
  }

  return counts;
}
