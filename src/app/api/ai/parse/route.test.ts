import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";
import type { Food } from "@/lib/food/types";

const getUserId = vi.fn();
const parseFoods = vi.fn();
const resolveIntents = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  llmForCurrentUser: async () => ({
    name: "stub",
    isAvailable: () => true,
    parseFoods: (...a: unknown[]) => parseFoods(...a),
    parseCorrection: vi.fn(),
    answer: vi.fn(),
  }),
}));

vi.mock("@/lib/ai/resolve", () => ({
  resolveIntents: (...a: unknown[]) => resolveIntents(...a),
}));

const { POST } = await import("@/app/api/ai/parse/route");

const food: Food = {
  sourceId: "1",
  source: "off",
  name: "Dubai chocolate",
  brand: "J.D. Gross",
  description: null,
  barcode: "4335619201859",
  isVerified: false,
  nutrients: { kcal: 531, protein_g: 11.6, carbs_g: 45, fat_g: 34 },
  servings: [{ label: "100 g", grams: 100, isDefault: true }],
  dataUpdatedAt: null,
};

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/ai/parse", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  parseFoods.mockResolvedValue({
    ok: true,
    value: { foods: [{ query: "dubai chocolate", amount: 50, unit: "g" }] },
  });
  resolveIntents.mockResolvedValue({
    proposals: [
      {
        intent: { query: "dubai chocolate", amount: 50, unit: "g" },
        match: food,
        alternatives: [],
        grams: 50,
        macros: { kcal: 265.5, protein_g: 5.8, carbs_g: 22.5, fat_g: 17 },
      },
    ],
    degraded: false,
  });
});

describe("POST /api/ai/parse — authentication and limits", () => {
  it("refuses an unauthenticated caller before reaching the model", async () => {
    getUserId.mockResolvedValue(null);

    const response = await call({ text: "50g dubai chocolate" });

    expect(response.status).toBe(401);
    expect(parseFoods).not.toHaveBeenCalled();
  });

  it("rate limits, so a runaway client cannot spend the free quota", async () => {
    for (let i = 0; i < 10; i++) await call({ text: "rice" });

    const response = await call({ text: "rice" });

    expect(response.status).toBe(429);
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
  });
});

describe("POST /api/ai/parse — the data boundary", () => {
  it("refuses text carrying an identifier, before any model call", async () => {
    const response = await call({ text: "log 200g rice for me@example.com" });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.reason).toBe("email");
    // The point of the check is that nothing left the machine.
    expect(parseFoods).not.toHaveBeenCalled();
  });

  it("tells the user what to remove", async () => {
    const response = await call({
      text: "user 6eb72e72-72b4-480c-a3b6-368e9c9e9ddb had rice",
    });
    const json = await response.json();

    expect(json.error).toContain("identifier");
    expect(parseFoods).not.toHaveBeenCalled();
  });

  it("sends the normalised text and nothing else", async () => {
    await call({ text: "  50g   dubai chocolate  " });

    expect(parseFoods).toHaveBeenCalledTimes(1);
    expect(parseFoods).toHaveBeenCalledWith("50g dubai chocolate");
  });
});

describe("POST /api/ai/parse — proposals", () => {
  it("returns proposals with macros from the matched food", async () => {
    const response = await call({ text: "50g dubai chocolate" });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.proposals).toHaveLength(1);
    expect(json.proposals[0].match.name).toBe("Dubai chocolate");
    expect(json.proposals[0].macros.kcal).toBeCloseTo(265.5, 4);
  });

  it("writes nothing — the user confirms before anything is logged", async () => {
    // The route has no path to the database at all; this asserts the shape
    // the client depends on for that, namely proposals rather than entries.
    const json = await (await call({ text: "50g dubai chocolate" })).json();
    expect(json).not.toHaveProperty("logged");
    expect(json.proposals[0]).toHaveProperty("intent");
  });

  it("says so plainly when the text described no food", async () => {
    parseFoods.mockResolvedValue({ ok: true, value: { foods: [] } });

    const json = await (await call({ text: "how are you" })).json();

    expect(json.proposals).toEqual([]);
    expect(json.notice).toContain("No food");
    expect(resolveIntents).not.toHaveBeenCalled();
  });

  it("passes provider degradation through", async () => {
    resolveIntents.mockResolvedValue({ proposals: [], degraded: true });
    const json = await (await call({ text: "rice" })).json();
    expect(json.degraded).toBe(true);
  });
});

describe("POST /api/ai/parse — when the AI is not there", () => {
  it("answers 503 with the manual path named, not 500", async () => {
    parseFoods.mockResolvedValue({
      ok: false,
      reason: "disabled",
      message: "The assistant is off. Search for the food and log it manually.",
    });

    const response = await call({ text: "rice" });
    const json = await response.json();

    // The app is working; one optional part of it is not.
    expect(response.status).toBe(503);
    expect(json.reason).toBe("disabled");
    expect(json.error).toContain("manually");
  });

  it("answers 429 when the free quota is spent, so the client can say wait", async () => {
    parseFoods.mockResolvedValue({
      ok: false,
      reason: "rate-limited",
      message: "The assistant has used its free allowance for the moment.",
    });

    const response = await call({ text: "rice" });

    expect(response.status).toBe(429);
    expect((await response.json()).reason).toBe("rate-limited");
  });

  it("does not resolve intents when the model failed", async () => {
    parseFoods.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "The assistant returned 500.",
    });

    await call({ text: "rice" });

    expect(resolveIntents).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/parse — malformed input", () => {
  it("rejects a body that is not JSON", async () => {
    const response = await call("not json");
    expect(response.status).toBe(400);
  });

  it("rejects empty text", async () => {
    const response = await call({ text: "   " });
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe("empty");
  });
});
