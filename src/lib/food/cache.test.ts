import { describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const { __searchTerms, cacheFood, refreshCachedFood, rowToFood } = await import(
  "@/lib/food/cache"
);

describe("searchTerms", () => {
  it("splits on whitespace", () => {
    expect(__searchTerms("chicken breast")).toEqual(["chicken", "breast"]);
  });

  it("splits on commas, which provider names are full of", () => {
    // USDA: "Chicken, breast, boneless, skinless, raw"
    expect(__searchTerms("boneless, skinless")).toEqual([
      "boneless",
      "skinless",
    ]);
  });

  it("collapses repeated separators", () => {
    expect(__searchTerms("chicken,,   breast")).toEqual(["chicken", "breast"]);
  });

  it("strips ilike wildcards so a typed % is not a pattern", () => {
    expect(__searchTerms("100% beef")).toEqual(["100", "beef"]);
    expect(__searchTerms("a_b")).toEqual(["ab"]);
  });

  it("drops a term that was only wildcards", () => {
    expect(__searchTerms("beef %")).toEqual(["beef"]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(__searchTerms("")).toEqual([]);
    expect(__searchTerms("   ,  ")).toEqual([]);
  });

  it("bounds the number of terms so one query cannot chain endlessly", () => {
    expect(__searchTerms("a b c d e f g h i j")).toHaveLength(6);
  });
});

describe("rowToFood", () => {
  const row = {
    id: 1,
    source: "usda",
    source_id: "171515",
    name: "Chicken breast",
    brand: null,
    description: null,
    barcode: null,
    is_verified: true,
    data_updated_at: null,
    food_nutrients: {
      kcal: 165,
      protein_g: 31,
      carbs_g: 0,
      fat_g: 3.6,
      fiber_g: null,
      sugar_g: null,
      sat_fat_g: null,
      sodium_mg: null,
    },
    food_servings: [{ label: "100 g", grams: 100, is_default: true }],
  };

  it("maps a row to the neutral shape with its database id", () => {
    const [food] = rowToFood(row);
    expect(food.id).toBe(1);
    expect(food.sourceId).toBe("171515");
    expect(food.servings[0].isDefault).toBe(true);
  });

  it("drops a food with no nutrient row rather than defaulting to zero", () => {
    // A zero-calorie entry that silently logs nothing is worse than absent.
    expect(rowToFood({ ...row, food_nutrients: null })).toEqual([]);
  });

  it("tolerates a food with no servings", () => {
    const [food] = rowToFood({ ...row, food_servings: [] });
    expect(food.servings).toEqual([]);
  });
});

describe("cacheFood and the ownership boundary", () => {
  /** Just enough client for the one lookup the custom branch makes. */
  function clientReturning(row: { id: number } | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          }),
        }),
      }),
    };
  }

  const customFood = {
    sourceId: "6f1c9d2e-0000-4000-8000-000000000000",
    source: "custom" as const,
    name: "Protein flapjack",
    brand: null,
    description: null,
    barcode: null,
    isVerified: false,
    nutrients: { kcal: 400, protein_g: 20, carbs_g: 45, fat_g: 12 },
    servings: [],
    dataUpdatedAt: null,
  };

  it("resolves one of the user's own custom foods to its row", async () => {
    createClient.mockResolvedValue(clientReturning({ id: 42 }));
    await expect(cacheFood(customFood)).resolves.toBe(42);
  });

  it("refuses to create a custom food, which would have no owner", async () => {
    // This function writes `user_id` nowhere. An insert from here would
    // either break `foods_custom_requires_owner` or — if the constraint
    // were ever relaxed — quietly make an ownerless copy of somebody's
    // private food. RLS also hides another user's row, so a payload naming
    // one arrives here as "not found" and stops.
    createClient.mockResolvedValue(clientReturning(null));

    await expect(cacheFood(customFood)).rejects.toThrow(
      /only be created by its owner/,
    );
  });
});

describe("refreshCachedFood", () => {
  /** Records every table written, so a test can assert one was not. */
  function recordingClient(rows: { id: number; label: string }[] = []) {
    const writes: { table: string; op: string; payload?: unknown }[] = [];
    const builder = (table: string, op: string, payload?: unknown) => {
      if (op !== "select") writes.push({ table, op, payload });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(onFulfilled),
      };
      return chain;
    };
    return {
      writes,
      client: {
        from: (table: string) => ({
          select: () => builder(table, "select"),
          update: (payload: unknown) => builder(table, "update", payload),
          insert: (payload: unknown) => builder(table, "insert", payload),
        }),
      },
    };
  }

  const fresh = {
    sourceId: "171515",
    source: "usda" as const,
    name: "Chicken breast",
    brand: null,
    description: null,
    barcode: null,
    isVerified: true,
    nutrients: { kcal: 172, protein_g: 32, carbs_g: 0, fat_g: 4 },
    servings: [{ label: "100 g", grams: 100, isDefault: true }],
    dataUpdatedAt: "2026-09-01",
  };

  it("never writes a logging table", async () => {
    // The guarantee the whole feature stands on: a corrected provider figure
    // changes what the next log of this food says and nothing that has
    // already been written. `food_logs` holds its own macros for exactly
    // this reason.
    const { client, writes } = recordingClient([{ id: 9, label: "100 g" }]);
    createClient.mockResolvedValue(client);

    await refreshCachedFood(7, fresh);

    expect(writes.map((w) => w.table)).not.toContain("food_logs");
    expect(new Set(writes.map((w) => w.table))).toEqual(
      new Set(["food_nutrients", "food_servings", "foods"]),
    );
  });

  it("updates a serving it already has rather than adding a second", async () => {
    const { client, writes } = recordingClient([{ id: 9, label: "100 g" }]);
    createClient.mockResolvedValue(client);

    await refreshCachedFood(7, fresh);

    const servingWrites = writes.filter((w) => w.table === "food_servings");
    expect(servingWrites.every((w) => w.op === "update")).toBe(true);
  });

  it("adds a serving the provider has grown, and deletes none", async () => {
    // Removing one would be `on delete set null` on an entry already
    // written, turning "1 slice" into a bare gram figure.
    const { client, writes } = recordingClient([{ id: 9, label: "1 slice" }]);
    createClient.mockResolvedValue(client);

    await refreshCachedFood(7, fresh);

    expect(writes.some((w) => w.table === "food_servings" && w.op === "insert")).toBe(true);
    expect(writes.some((w) => w.op === "delete")).toBe(false);
  });

  it("stamps the row last, so a half-done refresh does not look finished", async () => {
    // `refreshed_at` is what the policy reads. Writing it before the
    // nutrition would close the window on a refresh that had not happened.
    const { client, writes } = recordingClient([{ id: 9, label: "100 g" }]);
    createClient.mockResolvedValue(client);

    await refreshCachedFood(7, fresh);

    const last = writes.at(-1);
    expect(last?.table).toBe("foods");
    expect(last?.payload).toMatchObject({ refreshed_at: expect.any(String) });
  });
});
