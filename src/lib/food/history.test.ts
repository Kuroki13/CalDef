import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();

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

const { HISTORY_ROWS, loggedFoodCounts } = await import("@/lib/food/history");

beforeEach(() => vi.clearAllMocks());

describe("loggedFoodCounts", () => {
  it("counts how often each food appears", async () => {
    rows.mockResolvedValue({
      data: [
        { food_id: 2 },
        { food_id: 2 },
        { food_id: 7 },
        { food_id: 2 },
      ],
      error: null,
    });

    const counts = await loggedFoodCounts();

    expect(counts.get(2)).toBe(3);
    expect(counts.get(7)).toBe(1);
    expect(counts.get(99)).toBeUndefined();
  });

  it("ignores recipe entries, which have no food behind them", async () => {
    rows.mockResolvedValue({
      data: [{ food_id: null }, { food_id: 4 }],
      error: null,
    });

    const counts = await loggedFoodCounts();

    expect([...counts.keys()]).toEqual([4]);
  });

  it("returns nothing readable rather than failing the search", async () => {
    // Not knowing what someone has eaten before ranks a search slightly
    // worse. It is never a reason to give them no results at all.
    rows.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect((await loggedFoodCounts()).size).toBe(0);
  });

  it("looks at a bounded window of the diary", async () => {
    // One small query per search, not a scan of every meal ever logged.
    expect(HISTORY_ROWS).toBeLessThanOrEqual(1000);
  });
});
