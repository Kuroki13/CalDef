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
/** The food_logs table, as far as these tests need it. */
const inserted: Record<string, unknown>[] = [];
/** Insert statements issued, to tell one statement from several. */
let statements = 0;
let currentUser = "user-1";

vi.mock("@/lib/supabase/server", () => ({
  requireUserId: async () => currentUser,
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: nutrients(), error: null }),
          // `food_servings` is read as a list rather than a single row.
          then: (onFulfilled: (value: unknown) => unknown) =>
            Promise.resolve({ data: servings(), error: null }).then(onFulfilled),
        }),
        // Read-back by token: RLS shows a user only their own rows.
        in: async (_column: string, values: string[]) => ({
          data: inserted.filter((row) => row.user_id === currentUser && values.includes(row.client_token as string)),
          error: null,
        }),
      }),
      // One statement: every row goes in, or — on a unique violation of
      // (user_id, client_token) anywhere in the batch — none does.
      insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: async () => {
          statements += 1;
          const rows = Array.isArray(payload) ? payload : [payload];
          const taken = new Set(
            inserted.filter((row) => row.client_token).map((row) => `${row.user_id}:${row.client_token}`),
          );
          for (const row of rows) {
            if (!row.client_token) continue;
            const key = `${row.user_id}:${row.client_token}`;
            if (taken.has(key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
            taken.add(key);
          }
          const out = rows.map((row) => {
            const stored = { table, id: 100 + inserted.length + 1, ...row };
            inserted.push(stored);
            return { id: stored.id, client_token: row.client_token ?? null };
          });
          return { data: out, error: null };
        },
      }),
    }),
  }),
}));

const { ALREADY_RECORDED_DIFFERENTLY, logCachedFood, operationTokens, writeLogsOnce } = await import("@/lib/food-log");

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
  statements = 0;
  currentUser = "user-1";
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

describe("writeLogsOnce — an operation is written whole, once", () => {
  const KEY = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  const row = (over: Record<string, unknown> = {}) => ({
    log_date: "2026-11-17",
    meal_type_id: 3,
    food_id: 7,
    amount: 150,
    unit: "g" as const,
    grams: 150,
    kcal: 225,
    protein_g: 43,
    carbs_g: 0,
    fat_g: 5,
    source: "saved_meal" as const,
    ...over,
  });
  const meal = () => [row(), row({ food_id: 8, amount: 200, grams: 200, kcal: 260 }), row({ food_id: 9, amount: 10, grams: 10, kcal: 88 })];

  it("writes a meal of three rows in one statement, each under its own derived token", async () => {
    const result = await writeLogsOnce(meal(), KEY);
    expect(result).toEqual({ ids: [101, 102, 103], replayed: false });
    expect(statements).toBe(1);
    expect(new Set(inserted.map((r) => r.client_token)).size).toBe(3);
    expect(inserted.every((r) => r.user_id === "user-1")).toBe(true);
  });

  it("answers a double tap or a retried request with the rows already written", async () => {
    const first = await writeLogsOnce(meal(), KEY);
    const second = await writeLogsOnce(meal(), KEY);
    const third = await writeLogsOnce(meal(), KEY);
    expect(second).toEqual({ ids: (first as { ids: number[] }).ids, replayed: true });
    expect(third).toEqual(second);
    expect(inserted).toHaveLength(3);
  });

  it("refuses a reused key whose contents differ, and writes nothing", async () => {
    await writeLogsOnce(meal(), KEY);
    const changed = meal();
    changed[1] = row({ food_id: 8, amount: 250, grams: 250, kcal: 325 });
    expect(await writeLogsOnce(changed, KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(inserted).toHaveLength(3);
    // A different day or meal under the same key is refused the same way.
    expect(await writeLogsOnce(meal().map((r) => ({ ...r, log_date: "2026-11-18" })), KEY)).toEqual({
      error: ALREADY_RECORDED_DIFFERENTLY,
    });
  });

  it("refuses a reused key with fewer or more rows, and writes nothing", async () => {
    await writeLogsOnce(meal(), KEY);
    expect(await writeLogsOnce(meal().slice(0, 2), KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(await writeLogsOnce(meal().slice(0, 1), KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(await writeLogsOnce([...meal(), row({ food_id: 10 })], KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(inserted).toHaveLength(3);
  });

  it("refuses a meal sent under the key of a single entry already written", async () => {
    await writeLogsOnce([row()], KEY);
    expect(await writeLogsOnce(meal(), KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(inserted).toHaveLength(1);
  });

  it("never half-writes: a clash on any row leaves the whole batch out", async () => {
    // One of the three tokens is somehow taken already: the statement fails
    // as a whole, so none of the other two appear.
    const [, middle] = operationTokens(KEY, 3);
    inserted.push({ id: 1, user_id: "user-1", client_token: middle, log_date: "2026-11-17", meal_type_id: 3, food_id: 99, recipe_id: null, amount: 1, unit: "g", is_estimate: false, kcal: 1 });
    expect(await writeLogsOnce(meal(), KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(inserted).toHaveLength(1);
  });

  it("keeps users apart: the same key from another user is another operation", async () => {
    await writeLogsOnce(meal(), KEY);
    currentUser = "user-2";
    const theirs = await writeLogsOnce(meal(), KEY);
    expect(theirs).toEqual({ ids: [104, 105, 106], replayed: false });
    expect(inserted.filter((r) => r.user_id === "user-2")).toHaveLength(3);
  });

  it("treats a Quick Add's own figures as its content", async () => {
    const estimate = (kcal: number) => [row({ food_id: null, amount: 1, unit: "serving", grams: null, kcal, is_estimate: true, source: "manual" })];
    await writeLogsOnce(estimate(750), KEY);
    expect(await writeLogsOnce(estimate(750), KEY)).toMatchObject({ replayed: true });
    expect(await writeLogsOnce(estimate(800), KEY)).toEqual({ error: ALREADY_RECORDED_DIFFERENTLY });
    expect(inserted).toHaveLength(1);
  });

  it("without a key, behaves as a plain insert", async () => {
    await writeLogsOnce(meal(), null);
    await writeLogsOnce(meal(), null);
    expect(inserted).toHaveLength(6);
    expect(inserted.every((r) => r.client_token === null)).toBe(true);
  });
});

describe("operationTokens", () => {
  it("gives a single row position 0 of the same family", () => {
    const [only] = operationTokens("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", 1);
    expect(only).toBe(operationTokens("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", 3)[0]);
  });
  it("derives distinct, repeatable UUID-shaped tokens for several rows", () => {
    const a = operationTokens("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", 4);
    const b = operationTokens("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", 4);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(4);
    for (const token of a) expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(operationTokens("2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", 4)).not.toEqual(a);
  });
});
