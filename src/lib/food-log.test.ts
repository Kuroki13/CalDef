import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where a diary entry's numbers come from.
 *
 * This is the other half of the cache-refresh guarantee. The SQL test shows
 * that refreshing a food leaves rows already written alone; these show that
 * a *new* log reads the nutrient row as it stands at that moment — so a
 * corrected upstream figure reaches the next meal and not the last one.
 *
 * It is also the first direct test of `logCachedFood`, which is the
 * convergence point every logging path goes through, so the invariant it
 * exists for is asserted here too: the macros written are computed from the
 * database, never taken from the caller.
 */

const nutrients = vi.fn();
const servings = vi.fn();
const inserted: Record<string, unknown>[] = [];
/** Tokens already written, as the unique index would hold them. */
const tokens = new Map<string, number>();

vi.mock("@/lib/supabase/server", () => ({
  requireUserId: async () => "user-1",
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () =>
            column === "client_token"
              ? { data: { id: tokens.get(String(value)) }, error: null }
              : { data: nutrients(), error: null },
          // `food_servings` is read as a list rather than a single row.
          then: (onFulfilled: (value: unknown) => unknown) =>
            Promise.resolve({ data: servings(), error: null }).then(onFulfilled),
        }),
      }),
      insert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const token = payload.client_token as string | null;
            if (token && tokens.has(token)) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            inserted.push({ table, ...payload });
            const id = 100 + inserted.length;
            if (token) tokens.set(token, id);
            return { data: { id }, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { logCachedFood } = await import("@/lib/food-log");

const log = (over: Record<string, unknown> = {}) =>
  logCachedFood({
    foodId: 7,
    logDate: "2026-09-07",
    mealTypeId: 1,
    amount: 200,
    unit: "g" as const,
    source: "manual" as const,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  tokens.clear();
  servings.mockReturnValue([]);
});

describe("logCachedFood — a new entry reads the nutrients as they stand", () => {
  it("computes from the stored row at the moment of logging", async () => {
    // The food as first cached: 100 kcal and 10 g protein per 100 g.
    nutrients.mockReturnValue({
      kcal: 100,
      protein_g: 10,
      carbs_g: 5,
      fat_g: 2,
    });

    expect(await log()).toMatchObject({ ok: true });
    expect(inserted[0]).toMatchObject({ grams: 200, kcal: 200, protein_g: 20 });
  });

  it("uses the new values once the cache has been refreshed", async () => {
    // The same food after a refresh corrected it upstream to 250 kcal. The
    // entry logged now is the one that moves; the one logged above has
    // already been written and is not read again.
    nutrients.mockReturnValue({
      kcal: 250,
      protein_g: 30,
      carbs_g: 5,
      fat_g: 2,
    });

    expect(await log()).toMatchObject({ ok: true });
    expect(inserted[0]).toMatchObject({ grams: 200, kcal: 500, protein_g: 60 });
  });

  it("refuses to log a food with no nutrition rather than logging a zero", async () => {
    // A zero-calorie entry that silently logs nothing is worse than none.
    nutrients.mockReturnValue(null);

    expect(await log()).toEqual({
      error: "That food has no nutrition data recorded.",
    });
    expect(inserted).toHaveLength(0);
  });

  it("takes no calorie figure from its caller, because there is none to take", async () => {
    nutrients.mockReturnValue({ kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 2 });

    // `LogCachedFoodInput` has no nutrition field; passing one is not a
    // thing the type allows, and it would be ignored if it were.
    await log({ kcal: 9999, macros: { kcal: 9999 } } as never);

    expect(inserted[0]).toMatchObject({ kcal: 200 });
    expect(JSON.stringify(inserted[0])).not.toContain("9999");
  });

  it("weighs a serving from the food's own servings, not from the caller", async () => {
    nutrients.mockReturnValue({ kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 2 });
    servings.mockReturnValue([{ id: 3, label: "1 bar", grams: 45 }]);

    await log({ amount: 2, unit: "serving", servingLabel: "1 bar" });

    // Two 45 g bars at 100 kcal per 100 g.
    expect(inserted[0]).toMatchObject({ grams: 90, kcal: 90, serving_id: 3 });
  });

  it("refuses a serving the food no longer has", async () => {
    // A refresh can retire a serving. Inventing a gram weight for it would
    // be the one thing `toGrams` exists to refuse.
    nutrients.mockReturnValue({ kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 2 });
    servings.mockReturnValue([{ id: 3, label: "1 slice", grams: 30 }]);

    expect(await log({ amount: 1, unit: "serving", servingLabel: "1 bar" })).toEqual(
      { error: "That serving is no longer available. Pick another." },
    );
    expect(inserted).toHaveLength(0);
  });
});

describe("logCachedFood — a retried submission is written once", () => {
  it("answers a second submission of the same form with the first entry", async () => {
    nutrients.mockReturnValue({ kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 1 });
    const token = "6d1f1c5e-3d0b-4c62-9a3f-2b7f2f0a9e11";
    const first = await log({ clientToken: token });
    const retry = await log({ clientToken: token });
    expect(first).toEqual({ ok: true, entryId: 101 });
    expect(retry).toEqual({ ok: true, entryId: 101 });
    expect(inserted).toHaveLength(1);
  });

  it("writes two entries for two separate forms", async () => {
    nutrients.mockReturnValue({ kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 1 });
    await log({ clientToken: "6d1f1c5e-3d0b-4c62-9a3f-2b7f2f0a9e11" });
    await log({ clientToken: "7e2a2d6f-4e1c-4d73-8b4a-3c8a3a1b0f22" });
    expect(inserted).toHaveLength(2);
  });
});
