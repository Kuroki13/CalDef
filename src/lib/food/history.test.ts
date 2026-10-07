import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();
const favoriteIds = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        not: () => chain,
        order: () => chain,
        limit: async () => rows(),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/favorites", () => ({
  getFavoriteFoodIds: () => favoriteIds(),
}));

const { HISTORY_ROWS, personalSignals } = await import("@/lib/food/history");

beforeEach(() => {
  vi.clearAllMocks();
  favoriteIds.mockResolvedValue(new Set());
});

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T08:00:00Z`;

describe("personalSignals", () => {
  it("counts each food and keeps when it was last logged", async () => {
    rows.mockResolvedValue({
      data: [
        { food_id: 2, created_at: at(7) },
        { food_id: 2, created_at: at(3) },
        { food_id: 7, created_at: at(5) },
        { food_id: 2, created_at: at(1) },
      ],
      error: null,
    });

    const { uses } = await personalSignals();

    expect(uses.get(2)).toEqual({ count: 3, lastLoggedAt: at(7) });
    expect(uses.get(7)).toEqual({ count: 1, lastLoggedAt: at(5) });
    expect(uses.get(99)).toBeUndefined();
  });

  it("ignores recipe entries, which have no food behind them", async () => {
    rows.mockResolvedValue({
      data: [{ food_id: null, created_at: at(1) }, { food_id: 4, created_at: at(2) }],
      error: null,
    });

    expect([...(await personalSignals()).uses.keys()]).toEqual([4]);
  });

  it("carries the user's favourites", async () => {
    rows.mockResolvedValue({ data: [], error: null });
    favoriteIds.mockResolvedValue(new Set([3]));

    expect((await personalSignals()).favorites.has(3)).toBe(true);
  });

  it("returns nothing readable rather than failing the search", async () => {
    // Not knowing what someone has eaten before ranks a search slightly
    // worse. It is never a reason to give them no results at all.
    rows.mockResolvedValue({ data: null, error: { message: "boom" } });
    favoriteIds.mockRejectedValue(new Error("boom"));

    const signals = await personalSignals();
    expect(signals.uses.size).toBe(0);
    expect(signals.favorites.size).toBe(0);
  });

  it("looks at a bounded window of the diary", async () => {
    // One small query per search, not a scan of every meal ever logged.
    expect(HISTORY_ROWS).toBeLessThanOrEqual(1000);
  });
});
