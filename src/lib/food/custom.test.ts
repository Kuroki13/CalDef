import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The parts of custom foods that are decisions rather than arithmetic:
 * who may touch a food, whether removing one deletes or retires it, and —
 * the one that matters most — that editing a food does not go anywhere near
 * the diary entries already written from it.
 *
 * The fake below is a PostgREST-shaped recorder. It is not a database: it
 * answers whatever the test says to answer and remembers every statement,
 * which is what lets a test assert that a table was *not* written.
 */

type Call = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
};

type Reply = { data?: unknown; error?: { message: string } | null };

function fakeSupabase(reply: (call: Call) => Reply) {
  const calls: Call[] = [];

  const build = (table: string, op: Call["op"], payload?: unknown) => {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);

    const settle = () => {
      const result = reply(call);
      return { data: result.data ?? null, error: result.error ?? null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      is: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      not: () => chain,
      in: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => settle(),
      single: async () => settle(),
      // Awaiting the builder itself is how an update or delete with no
      // `select` resolves.
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve(settle()).then(onFulfilled),
    };
    return chain;
  };

  const client = {
    from: (table: string) => ({
      select: () => build(table, "select"),
      insert: (payload: unknown) => build(table, "insert", payload),
      update: (payload: unknown) => build(table, "update", payload),
      upsert: (payload: unknown) => build(table, "upsert", payload),
      delete: () => build(table, "delete"),
    }),
  };

  return { client, calls };
}

const OWNER = "11111111-1111-4111-8111-111111111111";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  requireUserId: async () => OWNER,
}));

const {
  createCustomFood,
  updateCustomFood,
  deleteCustomFood,
} = await import("@/lib/food/custom");

/** A stored row shaped the way the select in `custom.ts` asks for it. */
const storedRow = (over: Record<string, unknown> = {}) => ({
  id: 42,
  source: "custom",
  source_id: "6f1c9d2e-0000-4000-8000-000000000000",
  name: "Protein flapjack",
  brand: null,
  description: null,
  barcode: null,
  is_verified: false,
  data_updated_at: null,
  food_nutrients: {
    kcal: 400,
    protein_g: 20,
    carbs_g: 45,
    fat_g: 12,
    fiber_g: null,
    sugar_g: null,
    sat_fat_g: null,
    sodium_mg: null,
  },
  food_servings: [],
  ...over,
});

const input = (over: Record<string, unknown> = {}) =>
  ({
    name: "Protein flapjack",
    brand: null,
    barcode: null,
    basis: "per_100g" as const,
    servingGrams: null,
    servingLabel: null,
    kcal: 400,
    protein_g: 20,
    carbs_g: 45,
    fat_g: 12,
    fiber_g: null,
    sugar_g: null,
    sat_fat_g: null,
    sodium_mg: null,
    ...over,
  }) as Parameters<typeof createCustomFood>[0];

beforeEach(() => vi.clearAllMocks());

describe("createCustomFood", () => {
  it("writes an owned row and hands the food back ready to log", async () => {
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "foods" && call.op === "insert") {
        return { data: { id: 42 } };
      }
      if (call.table === "foods" && call.op === "select") {
        return { data: storedRow() };
      }
      return { data: [] };
    });
    createClient.mockResolvedValue(client);

    const result = await createCustomFood(input());
    if ("error" in result) throw new Error(result.error);

    const insert = calls.find(
      (call) => call.table === "foods" && call.op === "insert",
    );
    const payload = insert?.payload as Record<string, unknown>;

    expect(payload.source).toBe("custom");
    // The ownership column is what every policy keys on, and it comes from
    // the session rather than from anything the caller sent.
    expect(payload.user_id).toBe(OWNER);
    // A stable identifier, so a custom food is a food like any other to the
    // rest of the app rather than a special case.
    expect(String(payload.source_id)).toMatch(/^[0-9a-f-]{36}$/);

    expect(result.food.id).toBe(42);
    expect(result.food.source).toBe("custom");
  });

  it("refuses an impossible label before writing anything", async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [] }));
    createClient.mockResolvedValue(client);

    const result = await createCustomFood(
      input({ basis: "per_serving", servingGrams: 5, protein_g: 20, kcal: 40 }),
    );

    expect("error" in result).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("updateCustomFood", () => {
  it("never touches the diary", async () => {
    // The whole reason `food_logs` stores its macros instead of joining:
    // correcting a label today cannot rewrite what last week's totals said.
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "foods" && call.op === "select") {
        return { data: storedRow({ name: "Protein flapjack v2" }) };
      }
      return { data: [] };
    });
    createClient.mockResolvedValue(client);

    // Given a serving as well, so the nutrition and the serving rows are
    // both rewritten and the assertion below covers every table touched.
    const result = await updateCustomFood(
      42,
      input({ kcal: 380, servingGrams: 45, servingLabel: "1 bar" }),
    );
    if ("error" in result) throw new Error(result.error);

    const wroteToLogs = calls.filter(
      (call) => call.table === "food_logs" && call.op !== "select",
    );
    expect(wroteToLogs).toEqual([]);

    // What it does write: the food, its nutrition, its servings. Nothing else.
    expect(
      new Set(
        calls.filter((call) => call.op !== "select").map((call) => call.table),
      ),
    ).toEqual(new Set(["foods", "food_nutrients", "food_servings"]));
  });

  it("scopes every statement to the owner", async () => {
    const { client, calls } = fakeSupabase((call) =>
      call.table === "foods" && call.op === "select"
        ? { data: storedRow() }
        : { data: [] },
    );
    createClient.mockResolvedValue(client);

    await updateCustomFood(42, input());

    const update = calls.find(
      (call) => call.table === "foods" && call.op === "update",
    );
    // RLS would refuse a foreign row anyway; the filter is what turns that
    // into "no such food" instead of a database error.
    expect(update?.filters).toContainEqual(["user_id", OWNER]);
  });

  it("refuses a food that is not the user's, without reading it", async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    createClient.mockResolvedValue(client);

    const result = await updateCustomFood(99, input());

    expect(result).toEqual({ error: "That food is not one of yours." });
    expect(calls.some((call) => call.op === "update")).toBe(false);
  });
});

describe("deleteCustomFood", () => {
  it("deletes a food nothing points at", async () => {
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "foods" && call.op === "select") {
        return { data: { id: 42 } };
      }
      return { data: [] };
    });
    createClient.mockResolvedValue(client);

    expect(await deleteCustomFood(42)).toEqual({ deleted: true });
    expect(
      calls.some((call) => call.table === "foods" && call.op === "delete"),
    ).toBe(true);
  });

  it("retires a food the diary depends on, and says how much depends on it", async () => {
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "foods" && call.op === "select") {
        return { data: { id: 42 } };
      }
      if (call.table === "food_logs") {
        return { data: [{ food_id: 42 }, { food_id: 42 }] };
      }
      return { data: [] };
    });
    createClient.mockResolvedValue(client);

    const result = await deleteCustomFood(42);

    expect(result).toEqual({ archived: true, useCount: 2 });
    // Deleting would have failed on the foreign key; deleting the entries
    // too would have changed what those days say they ate.
    expect(calls.some((call) => call.op === "delete")).toBe(false);

    const archive = calls.find(
      (call) => call.table === "foods" && call.op === "update",
    );
    expect(archive?.payload).toMatchObject({
      archived_at: expect.any(String),
    });
  });

  it("counts recipes and saved meals too, not only the diary", async () => {
    const { client } = fakeSupabase((call) => {
      if (call.table === "foods" && call.op === "select") {
        return { data: { id: 42 } };
      }
      if (call.table === "recipe_ingredients") return { data: [{ food_id: 42 }] };
      if (call.table === "saved_meal_items") return { data: [{ food_id: 42 }] };
      return { data: [] };
    });
    createClient.mockResolvedValue(client);

    expect(await deleteCustomFood(42)).toEqual({ archived: true, useCount: 2 });
  });

  it("refuses a food that is not the user's", async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    createClient.mockResolvedValue(client);

    expect(await deleteCustomFood(7)).toEqual({
      error: "That food is not one of yours.",
    });
  });
});
