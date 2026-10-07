/**
 * What the personal library shows, decided from the diary.
 *
 * Spec §12B: foods already eaten must be easier to find than obscure
 * provider results. The diary already knows which foods those are; this
 * turns its rows into the short lists the library offers — recent, frequent
 * and scanned — and nothing else.
 *
 * Pure, so the ordering rules are testable without a database, and so the
 * same rules can feed personal ranking (§12C) later.
 */

/** One diary row, reduced to what the library needs. */
export type LogSignal = {
  foodId: number;
  /** `food_logs.source`. `barcode` marks a food that was scanned. */
  source: string;
  /** `food_logs.created_at` — when it was logged, not the day it was for. */
  loggedAt: string;
};

export type FoodUse = {
  foodId: number;
  count: number;
  lastLoggedAt: string;
  scanned: boolean;
};

/** How many rows each list shows. A library is not an archive. */
export const LIBRARY_LIST_SIZE = 12;

/**
 * A food has to come back to count as frequent. Once is "recent"; it says
 * nothing about habit, and listing it twice would only be clutter.
 */
export const FREQUENT_MIN_COUNT = 2;

/** Per-food use, from diary rows in any order. */
export function summariseUse(logs: readonly LogSignal[]): Map<number, FoodUse> {
  const uses = new Map<number, FoodUse>();
  for (const log of logs) {
    const current = uses.get(log.foodId);
    if (!current) {
      uses.set(log.foodId, {
        foodId: log.foodId,
        count: 1,
        lastLoggedAt: log.loggedAt,
        scanned: log.source === "barcode",
      });
      continue;
    }
    current.count += 1;
    if (log.loggedAt > current.lastLoggedAt) current.lastLoggedAt = log.loggedAt;
    if (log.source === "barcode") current.scanned = true;
  }
  return uses;
}

const byRecency = (a: FoodUse, b: FoodUse) =>
  a.lastLoggedAt < b.lastLoggedAt ? 1 : a.lastLoggedAt > b.lastLoggedAt ? -1 : 0;

/** Most recently logged first. */
export function recentFoodIds(
  uses: ReadonlyMap<number, FoodUse>,
  limit = LIBRARY_LIST_SIZE,
): number[] {
  return [...uses.values()].sort(byRecency).slice(0, limit).map((u) => u.foodId);
}

/**
 * Most often logged first; a tie goes to whichever was eaten more recently,
 * because of two equally habitual foods the current one is the likelier.
 */
export function frequentFoodIds(
  uses: ReadonlyMap<number, FoodUse>,
  limit = LIBRARY_LIST_SIZE,
): number[] {
  return [...uses.values()]
    .filter((u) => u.count >= FREQUENT_MIN_COUNT)
    .sort((a, b) => b.count - a.count || byRecency(a, b))
    .slice(0, limit)
    .map((u) => u.foodId);
}

/** Foods that were ever logged from a scan, most recent first. */
export function scannedFoodIds(
  uses: ReadonlyMap<number, FoodUse>,
  limit = LIBRARY_LIST_SIZE,
): number[] {
  return [...uses.values()]
    .filter((u) => u.scanned)
    .sort(byRecency)
    .slice(0, limit)
    .map((u) => u.foodId);
}
