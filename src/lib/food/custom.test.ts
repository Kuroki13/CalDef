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
    rpc: async (name: string, args: unknown) => {
      const call: Call = { table: `rpc:${name}`, op: "insert", payload: args, filters: [] };
      calls.push(call);
      const result = reply(call);
      return { data: result.data ?? null, error: result.error ?? null };
    },
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
  restoreCustomFood,
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

/** The one call the client is supposed to make. */
const rpcCall = (calls: Call[]) =>
  calls.find((call) => call.table === "rpc:save_custom_food");

describe("createCustomFood", () => {
  it("saves through the transactional function, not table by table", async () => {
    // Atomicity is the database's job now (migration 0009). What this side
    // has to get right is calling it once and writing nothing itself — a
    // stray table write here would put a statement back outside the
    // transaction, which is the bug the function exists to close.
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "rpc:save_custom_food") return { data: 42 };
      if (call.table === "foods" && call.op === "select") {
        return { data: storedRow() };
      }
      return { data: [] };
    });
    createClient.mockResolvedValue(client);

    const result = await createCustomFood(input());
    if ("error" in result) throw new Error(result.error);

    const args = rpcCall(calls)?.payload as Record<string, unknown>;
    expect(args.p_food_id).toBeNull();
    expect(args.p_name).toBe("Protein flapjack");
    expect(args.p_nutrients).toMatchObject({ kcal: 400, protein_g: 20 });

    // Nothing but the function and the read-back.
    const writes = calls.filter(
      (call) => call.op !== "select" && !call.table.startsWith("rpc:"),
    );
    expect(writes).toEqual([]);
    expect(result.food.id).toBe(42);
  });

  it("passes a caller's own identity through for a catalogue import", async () => {
    const { client, calls } = fakeSupabase((call) =>
      call.table === "rpc:save_custom_food"
        ? { data: 42 }
        : call.table === "foods" && call.op === "select"
          ? { data: storedRow() }
          : { data: [] },
    );
    createClient.mockResolvedValue(client);

    await createCustomFood(input(), {
      sourceId: "restaurant:kfc:original-recipe",
      description: "Imported from the restaurant catalogue",
    });

    const args = rpcCall(calls)?.payload as Record<string, unknown>;
    expect(args.p_source_id).toBe("restaurant:kfc:original-recipe");
    expect(args.p_description).toBe("Imported from the restaurant catalogue");
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
  it("edits through the same function, naming the food", async () => {
    const { client, calls } = fakeSupabase((call) =>
      call.table === "rpc:save_custom_food"
        ? { data: 42 }
        : call.table === "foods" && call.op === "select"
          ? { data: storedRow() }
          : { data: [] },
    );
    createClient.mockResolvedValue(client);

    const result = await updateCustomFood(
      42,
      input({ kcal: 380, servingGrams: 45, servingLabel: "1 bar" }),
    );
    if ("error" in result) throw new Error(result.error);

    const args = rpcCall(calls)?.payload as Record<string, unknown>;
    expect(args.p_food_id).toBe(42);
    expect(args.p_servings).toEqual([
      { label: "1 bar", grams: 45, isDefault: true },
    ]);
  });

  it("never touches the diary", async () => {
    // The guarantee that matters most: correcting a label today cannot
    // rewrite what last week's totals said. Neither this module nor the
    // function it calls writes a logging table.
    const { client, calls } = fakeSupabase((call) =>
      call.table === "rpc:save_custom_food"
        ? { data: 42 }
        : call.table === "foods" && call.op === "select"
          ? { data: storedRow() }
          : { data: [] },
    );
    createClient.mockResolvedValue(client);

    await updateCustomFood(42, input());

    expect(calls.filter((call) => call.table === "food_logs")).toEqual([]);
  });

  it("reports a foreign food as not the user's, whichever way it was refused", async () => {
    // `security invoker` means RLS decides. The function raises when the
    // update matches nothing; a policy denial arrives as a different
    // message. Both mean the same thing to the person reading it.
    for (const message of [
      "That food is not one of yours",
      'new row violates row-level security policy for table "foods"',
      "permission denied for table foods",
    ]) {
      const { client } = fakeSupabase(() => ({ error: { message } }));
      createClient.mockResolvedValue(client);

      expect(await updateCustomFood(99, input())).toEqual({
        error: "That food is not one of yours.",
      });
    }
  });

  it("translates a constraint violation into something worth reading", async () => {
    const { client } = fakeSupabase(() => ({
      error: {
        message:
          'new row for relation "food_nutrients" violates check constraint "food_nutrients_kcal_check"',
      },
    }));
    createClient.mockResolvedValue(client);

    const result = await updateCustomFood(42, input());
    expect(result).toEqual({
      error:
        "Those figures are outside what a food can be. Check the panel you copied.",
    });
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

describe("restoreCustomFood", () => {
  it("clears the archive stamp and nothing else", async () => {
    // The exact inverse of the archive half of removing one. Its nutrition,
    // its servings and every entry that referenced it never went anywhere.
    const { client, calls } = fakeSupabase((call) =>
      call.table === "foods" && call.op === "select"
        ? { data: { id: 42 } }
        : { data: [] },
    );
    createClient.mockResolvedValue(client);

    expect(await restoreCustomFood(42)).toEqual({ restored: true });

    const update = calls.find(
      (call) => call.table === "foods" && call.op === "update",
    );
    expect(update?.payload).toEqual({ archived_at: null });
    expect(update?.filters).toContainEqual(["user_id", OWNER]);

    // Nothing else is touched — least of all a logging table.
    expect(
      new Set(calls.filter((c) => c.op !== "select").map((c) => c.table)),
    ).toEqual(new Set(["foods"]));
  });

  it("refuses a food that is not the user's", async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    createClient.mockResolvedValue(client);

    expect(await restoreCustomFood(99)).toEqual({
      error: "That food is not one of yours.",
    });
    expect(calls.some((call) => call.op === "update")).toBe(false);
  });
});
