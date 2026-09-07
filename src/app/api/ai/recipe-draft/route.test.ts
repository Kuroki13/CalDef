import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";

const getUserId = vi.fn();
const draftRecipe = vi.fn();
const resolveIntents = vi.fn();
const isAvailable = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  llmForCurrentUser: async () => ({
    name: "stub",
    isAvailable: () => isAvailable(),
    parseFoods: vi.fn(),
    draftRecipe: (...a: unknown[]) => draftRecipe(...a),
    parseCorrection: vi.fn(),
    answer: vi.fn(),
  }),
}));

vi.mock("@/lib/ai/resolve", () => ({
  resolveIntents: (...a: unknown[]) => resolveIntents(...a),
}));

const { POST } = await import("@/app/api/ai/recipe-draft/route");

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/ai/recipe-draft", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const proposal = (query: string, match: unknown) => ({
  intent: { query, amount: 100, unit: "g" },
  match,
  alternatives: [],
  grams: match ? 100 : null,
  macros: match ? { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 } : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  isAvailable.mockReturnValue(true);
  draftRecipe.mockResolvedValue({
    ok: true,
    value: {
      foods: [
        { query: "chicken thigh", amount: 800, unit: "g" },
        { query: "basmati rice", amount: 500, unit: "g" },
      ],
    },
  });
  resolveIntents.mockResolvedValue({
    proposals: [
      proposal("chicken thigh", { name: "Chicken thigh" }),
      proposal("basmati rice", { name: "Rice, white, long-grain" }),
    ],
    degraded: false,
  });
});

describe("POST /api/ai/recipe-draft", () => {
  it("drafts a dish and resolves every ingredient against the providers", async () => {
    const body = await (await call({ dish: "chicken maqlouba" })).json();

    expect(draftRecipe).toHaveBeenCalledWith("chicken maqlouba");
    // The model's list goes straight to the resolver: what it named is a
    // search term, and everything numeric comes from what that finds.
    expect(resolveIntents).toHaveBeenCalledWith([
      { query: "chicken thigh", amount: 800, unit: "g" },
      { query: "basmati rice", amount: 500, unit: "g" },
    ]);
    expect(body.proposals).toHaveLength(2);
    expect(body.dish).toBe("chicken maqlouba");
  });

  it("surfaces an ingredient the providers could not resolve", async () => {
    // The requirement this route exists to keep: an unmatched ingredient is
    // returned as unmatched, never quietly dropped. Dropping it would make
    // the recipe's total silently too low, which is worse than a gap the
    // owner can see and fix.
    resolveIntents.mockResolvedValue({
      proposals: [
        proposal("chicken thigh", { name: "Chicken thigh" }),
        proposal("maqlouba spice mix", null),
      ],
      degraded: false,
    });

    const body = await (await call({ dish: "chicken maqlouba" })).json();

    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[1].match).toBeNull();
    expect(body.proposals[1].intent.query).toBe("maqlouba spice mix");
  });

  it("writes nothing — it proposes", async () => {
    const response = await call({ dish: "chicken maqlouba" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recipeId).toBeUndefined();
    expect(body.saved).toBeUndefined();
  });

  it("sends only the dish name across the boundary", async () => {
    await call({ dish: "chicken maqlouba" });

    expect(draftRecipe).toHaveBeenCalledOnce();
    expect(draftRecipe.mock.calls[0]).toHaveLength(1);
    expect(draftRecipe.mock.calls[0][0]).toBe("chicken maqlouba");
  });

  it("refuses a dish name carrying an identifier before the model", async () => {
    const response = await call({ dish: "dinner for me@example.com" });

    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe("email");
    expect(draftRecipe).not.toHaveBeenCalled();
  });

  it("degrades to building by hand when the assistant is off", async () => {
    // `GEMINI_API_KEY` unset, or the owner's switch off: the provider
    // refuses and the client offers the manual path.
    isAvailable.mockReturnValue(false);
    draftRecipe.mockResolvedValue({
      ok: false,
      reason: "unconfigured",
      message: "The assistant is not configured.",
    });

    const response = await call({ dish: "chicken maqlouba" });

    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("unconfigured");
    expect(resolveIntents).not.toHaveBeenCalled();
  });

  it("passes a spent quota through as 429, with what still works", async () => {
    // The free tier is measured in requests and the ceiling is low, so this
    // is an ordinary state rather than a fault. The client shows the
    // message; it must name the way round it, not read as a generic error.
    draftRecipe.mockResolvedValue({
      ok: false,
      reason: "rate-limited",
      message:
        "The assistant has used its free allowance for today. It comes back " +
        "tomorrow. Everything else works meanwhile: search for the food and " +
        "log it, or build the recipe by hand.",
    });

    const response = await call({ dish: "chicken maqlouba" });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.reason).toBe("rate-limited");
    expect(body.error).toMatch(/tomorrow/i);
    expect(body.error).toMatch(/by hand/i);
    expect(resolveIntents).not.toHaveBeenCalled();
  });

  it("keeps a spent quota distinct from a failure to reach the model", async () => {
    // Same 503 family in HTTP terms, entirely different things to the
    // person reading it: one waits, the other is over for the day.
    draftRecipe.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "The assistant did not respond. Search for the food and log it by hand.",
    });

    const response = await call({ dish: "chicken maqlouba" });

    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("unavailable");
  });

  it("says it does not know a dish rather than inventing one", async () => {
    draftRecipe.mockResolvedValue({ ok: true, value: { foods: [] } });

    const response = await call({ dish: "qqqq zzzz" });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.reason).toBe("unknown-dish");
    expect(body.error).toMatch(/by hand/i);
    expect(resolveIntents).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    getUserId.mockResolvedValue(null);

    const response = await call({ dish: "chicken maqlouba" });

    expect(response.status).toBe(401);
    expect(draftRecipe).not.toHaveBeenCalled();
  });

  it("meters the model and the provider fan-out it causes", async () => {
    // The most expensive AI action here: one model call plus up to eight
    // searches. Both buckets are checked before any of it starts.
    for (let i = 0; i < 12; i++) await call({ dish: "chicken maqlouba" });

    const response = await call({ dish: "chicken maqlouba" });
    expect(response.status).toBe(429);
  });
});
