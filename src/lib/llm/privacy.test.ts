import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toFoodText, trustedFoodText } from "@/lib/llm/food-text";

vi.mock("@/lib/env.server", () => ({
  GEMINI_API_KEY: "test-key",
  USDA_API_KEY: null,
  hasGeminiKey: () => true,
  hasUsdaKey: () => false,
}));

const { geminiProvider } = await import("@/lib/llm/gemini");

/**
 * What actually leaves the machine.
 *
 * The other tests check that each function behaves. This one inspects the
 * bytes: it captures every request body the provider produces and asserts
 * that a battery of realistic personal data appears in none of them.
 *
 * It is written against the request rather than against the call sites,
 * because the promise in CLAUDE.md is about what Google receives — not about
 * which arguments a function was given.
 */

/** Things a user of this app has, none of which Gemini may see. */
const NEVER_SEND = [
  "orfalim260@gmail.com",
  "6eb72e72-72b4-480c-a3b6-368e9c9e9ddb",
  "Melo",
  "1995-01-01",
  "12 Rue de Rivoli",
  "+33612345678",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk",
  "sb_publishable_",
  "service_role",
];

let bodies: string[] = [];

function captureFetch(reply: string) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: reply }] } }] }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  bodies = [];
  vi.unstubAllGlobals();
});
afterEach(() => vi.restoreAllMocks());

function food(raw: string) {
  const r = toFoodText(raw);
  if (!r.ok) throw new Error(`gate rejected: ${r.reason}`);
  return r.value;
}

describe("every request body Gemini receives", () => {
  it("carries no identity, across all three call paths", async () => {
    captureFetch('{"foods":[]}');

    await geminiProvider.parseFoods(food("200g chicken breast and 150g rice"));
    await geminiProvider.parseCorrection(food("actually that was 250g"), {
      description: trustedFoodText("Chicken breast"),
      amount: 200,
      unit: "g",
    });
    await geminiProvider.answer(food("am I on track for protein?"), {
      targetCalories: 2250,
      targetProteinG: 180,
      caloriesToday: 1400,
      proteinTodayG: 90,
      estimatedExpenditureKcal: 3123,
      trendWeightKg: 105.9,
      weeklyChangeKg: -0.89,
    });

    expect(bodies).toHaveLength(3);

    for (const body of bodies) {
      for (const secret of NEVER_SEND) {
        expect(body, `"${secret}" reached the request body`).not.toContain(secret);
      }
      // Nothing shaped like an email, a UUID, or a JWT, whatever its value.
      expect(body).not.toMatch(/[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i);
      expect(body).not.toMatch(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
      );
      expect(body).not.toMatch(/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./);
    }
  });

  it("sends the figures as bare numbers, with no field the app did not label", async () => {
    captureFetch("ok");

    await geminiProvider.answer(food("what should I eat?"), {
      targetCalories: 2250,
      trendWeightKg: 105.9,
    });

    const sent = JSON.parse(bodies[0]).contents[0].parts[0].text as string;

    // Present, because they were asked for.
    expect(sent).toContain("2250 kcal");
    expect(sent).toContain("105.9 kg");
    // Absent, because `describeFigures` renders from a fixed label list — a
    // field added to the type later cannot start being sent silently.
    expect(sent).not.toContain("undefined");
    expect(sent).not.toContain("Protein target");
    expect(sent).not.toContain("Eaten so far");
  });

  it("sends the correction prompt as food and a portion, nothing else", async () => {
    captureFetch('{"kind":"unclear"}');

    await geminiProvider.parseCorrection(food("make it 250g"), {
      description: trustedFoodText("Dubai chocolate (J.D. Gross)"),
      amount: 50,
      unit: "g",
    });

    const sent = JSON.parse(bodies[0]).contents[0].parts[0].text as string;
    expect(sent).toBe(
      "Logged entry: Dubai chocolate (J.D. Gross), 50 g.\nThe user says: make it 250g",
    );
  });

  it("strips an identifier that reached a food's name through the cache", async () => {
    captureFetch('{"kind":"unclear"}');

    // `foods` is written from a browser payload, so a name is
    // user-influenced. `trustedFoodText` is the door it comes through.
    await geminiProvider.parseCorrection(food("more"), {
      description: trustedFoodText("Bar orfalim260@gmail.com"),
      amount: 1,
      unit: "serving",
    });

    const sent = JSON.parse(bodies[0]).contents[0].parts[0].text as string;
    expect(sent).not.toContain("orfalim260");
    expect(sent).toContain("Bar");
  });

  it("refuses to build food text from anything identifying in the first place", () => {
    // The gate before the gate: these never reach a provider method at all.
    for (const raw of [
      "log this for orfalim260@gmail.com",
      "user 6eb72e72-72b4-480c-a3b6-368e9c9e9ddb ate rice",
      "see https://example.com/my-profile",
      "call 0612345678",
    ]) {
      expect(toFoodText(raw).ok, raw).toBe(false);
    }
  });
});
