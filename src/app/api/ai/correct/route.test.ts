import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";

const getUserId = vi.fn();
const parseCorrection = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
    }),
  }),
}));

vi.mock("@/lib/llm", () => ({
  llmForCurrentUser: async () => ({
    name: "stub",
    isAvailable: () => true,
    parseFoods: vi.fn(),
    parseCorrection: (...a: unknown[]) => parseCorrection(...a),
    answer: vi.fn(),
  }),
}));

const { POST } = await import("@/app/api/ai/correct/route");

/** A 200 g entry of a 165 kcal/100 g food: 330 kcal on the row. */
const entryRow = {
  id: 7,
  amount: 200,
  unit: "g",
  grams: 200,
  kcal: 330,
  food_id: 12,
  foods: {
    name: "Chicken breast",
    brand: null,
    food_nutrients: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  },
  food_servings: null,
};

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/ai/correct", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  maybeSingle.mockResolvedValue({ data: entryRow });
  parseCorrection.mockResolvedValue({
    ok: true,
    value: { kind: "amount", amount: 250, unit: "g" },
  });
});

describe("POST /api/ai/correct", () => {
  it("refuses an unauthenticated caller", async () => {
    getUserId.mockResolvedValue(null);
    const response = await call({ entryId: 7, text: "250g" });

    expect(response.status).toBe(401);
    expect(parseCorrection).not.toHaveBeenCalled();
  });

  it("previews the spec's example from the stored nutrient row", async () => {
    const json = await (
      await call({ entryId: 7, text: "actually that was 250g, not 200g" })
    ).json();

    expect(json.intent).toEqual({ kind: "amount", amount: 250, unit: "g" });
    // 165 kcal/100 g × 250 g. The preview is computed from the same source
    // the update will use, so what is confirmed is what is applied.
    expect(json.preview).toEqual({ grams: 250, kcal: 412.5 });
    expect(json.current.kcal).toBe(330);
  });

  it("describes the entry to the model as food, not as a row", async () => {
    await call({ entryId: 7, text: "250g" });

    expect(parseCorrection).toHaveBeenCalledWith("250g", {
      description: "Chicken breast",
      amount: 200,
      unit: "g",
    });
  });

  it("passes an unclear reading through without arithmetic", async () => {
    parseCorrection.mockResolvedValue({
      ok: true,
      value: { kind: "unclear" },
    });

    const json = await (
      await call({ entryId: 7, text: "more of a lunch really" })
    ).json();

    expect(json.intent).toEqual({ kind: "unclear" });
    expect(json.preview).toBeUndefined();
  });

  it("returns a removal for the client to confirm, not a deletion", async () => {
    parseCorrection.mockResolvedValue({ ok: true, value: { kind: "remove" } });

    const json = await (
      await call({ entryId: 7, text: "I did not eat that" })
    ).json();

    // The route never writes; the ordinary delete action does, once the user
    // has seen what is proposed.
    expect(json.intent).toEqual({ kind: "remove" });
  });

  it("refuses text carrying an identifier before the model is reached", async () => {
    const response = await call({ entryId: 7, text: "fix it, me@example.com" });

    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe("email");
    expect(parseCorrection).not.toHaveBeenCalled();
  });

  it("404s for an entry that is not the caller's", async () => {
    // RLS returns nothing rather than someone else's row, so "gone" and
    // "not yours" are the same answer and neither leaks which.
    maybeSingle.mockResolvedValue({ data: null });

    const response = await call({ entryId: 999, text: "250g" });

    expect(response.status).toBe(404);
    expect(parseCorrection).not.toHaveBeenCalled();
  });

  it("declines a recipe entry rather than half-editing it", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...entryRow, food_id: null, foods: null },
    });

    const response = await call({ entryId: 7, text: "250g" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("recipe");
  });

  it("degrades to 503 when the assistant is off", async () => {
    parseCorrection.mockResolvedValue({
      ok: false,
      reason: "disabled",
      message: "The assistant is off. Search for the food and log it manually.",
    });

    const response = await call({ entryId: 7, text: "250g" });

    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("disabled");
  });

  it("rate limits so corrections cannot drain the free quota", async () => {
    for (let i = 0; i < 10; i++) await call({ entryId: 7, text: "250g" });
    const response = await call({ entryId: 7, text: "250g" });
    expect(response.status).toBe(429);
  });
});
