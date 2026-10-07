import "server-only";

/**
 * What this user actually eats, as input to search ranking.
 *
 * Since §12C this is no longer only a tie-break: `personal-rank.ts` weighs
 * it inside the band of results that match the query equally well. The
 * history below is why it exists at all.
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

import { getFavoriteFoodIds } from "@/lib/favorites";
import type { PersonalSignals } from "@/lib/food/personal-rank";
import { createClient } from "@/lib/supabase/server";

/**
 * How far back the ranking looks.
 *
 * Recent enough to follow a change in diet, large enough that a food eaten
 * weekly is still in it. This is one small query per search, and the diary
 * of a single user is not large.
 */
export const HISTORY_ROWS = 500;

/**
 * What this user has done with each food: how often and how lately they
 * logged it, and which they starred.
 *
 * RLS scopes every read to the caller, so it is their own history and nobody
 * else's. Each half fails to empty rather than throwing: not knowing what
 * someone has eaten is a reason to rank a search slightly worse, never a
 * reason to fail it.
 */
export async function personalSignals(now = new Date()): Promise<PersonalSignals> {
  const [uses, favorites] = await Promise.all([
    foodUses(),
    getFavoriteFoodIds().catch(() => new Set<number>()),
  ]);
  return { uses, favorites, now };
}

async function foodUses(): Promise<PersonalSignals["uses"]> {
  const uses = new Map<number, { count: number; lastLoggedAt: string }>();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("food_logs")
      .select("food_id, created_at")
      .not("food_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(HISTORY_ROWS);
    if (error || !data) return uses;

    for (const row of data) {
      if (row.food_id === null) continue;
      const current = uses.get(row.food_id);
      if (!current) {
        uses.set(row.food_id, { count: 1, lastLoggedAt: row.created_at });
      } else {
        current.count += 1;
        if (row.created_at > current.lastLoggedAt) current.lastLoggedAt = row.created_at;
      }
    }
  } catch {
    // An empty history ranks by text alone, which is what it did before.
  }
  return uses;
}
