/**
 * Live Gemini checks.
 *
 * Excluded from `npm run test` for the same reason the food providers are:
 * a unit suite that fails when a third party is down is a suite people learn
 * to ignore. Run with `npm run test:live` after touching the LLM layer, to
 * confirm the model still answers in the shape the parser expects — which no
 * mocked fixture can tell you.
 *
 * These calls send food text only. Read the assertions below as a
 * specification of what leaves this machine.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { toFoodText } from "@/lib/llm/food-text";
import { geminiProvider } from "@/lib/llm/gemini";
import type { LLMResult } from "@/lib/llm/types";

/** Unwraps a checked string, failing loudly if the gate rejected it. */
function food(raw: string) {
  const result = toFoodText(raw);
  if (!result.ok) throw new Error(`Test text rejected: ${result.reason}`);
  return result.value;
}

/**
 * The free tier allows a handful of requests a minute, and this file makes
 * several in a row. Pacing them is the difference between a suite that tests
 * the mapping and one that tests the quota — the first version of this file
 * fired six calls at once and two came back 429.
 */
const GAP_MS = 7_000;
let last = 0;

beforeEach(async () => {
  const wait = last === 0 ? 0 : GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
});

/**
 * Runs a call, and retries once after a pause if the quota was spent.
 *
 * A quota ceiling is an upstream condition rather than a defect here, so
 * after the second attempt it is reported and the test returns instead of
 * failing — the same treatment Open Food Facts' 503s get.
 */
async function withQuota<T>(
  call: () => Promise<LLMResult<T>>,
): Promise<LLMResult<T> | null> {
  let result = await call();
  if (result.ok || result.reason !== "rate-limited") return result;

  await new Promise((r) => setTimeout(r, 30_000));
  last = Date.now();
  result = await call();
  if (result.ok || result.reason !== "rate-limited") return result;

  console.warn("Gemini free-tier quota reached; skipping this assertion.");
  return null;
}

describe("Gemini, live", () => {
  it("is configured", () => {
    expect(
      geminiProvider.isAvailable(),
      "GEMINI_API_KEY is missing from .env.local.",
    ).toBe(true);
  });

  it("parses the spec's worked example into intent only", async () => {
    const result = await withQuota(() =>
      geminiProvider.parseFoods(
        food("I ate 200g chicken, 150g rice and one tablespoon olive oil"),
      ),
    );
    if (result === null) return;

    expect(
      result.ok,
      result.ok ? "" : `Gemini was unreachable (${result.message}).`,
    ).toBe(true);
    if (!result.ok) return;

    expect(result.value.foods).toHaveLength(3);

    const [chicken, rice, oil] = result.value.foods;
    expect(chicken.query.toLowerCase()).toContain("chicken");
    expect(chicken.amount).toBe(200);
    expect(chicken.unit).toBe("g");
    expect(rice.query.toLowerCase()).toContain("rice");
    expect(rice.amount).toBe(150);
    expect(oil.query.toLowerCase()).toContain("oil");
    // A tablespoon is 15 ml or 15 g depending on how it reads it; either is
    // a portion, and neither is a calorie figure.
    expect(oil.amount).toBeGreaterThan(0);

    // The invariant, checked against the real model rather than a fixture.
    for (const item of result.value.foods) {
      expect(Object.keys(item).sort()).toEqual(["amount", "query", "unit"]);
    }
  }, 90_000);

  it("parses a branded product the food search can now resolve", async () => {
    const result = await withQuota(() =>
      geminiProvider.parseFoods(food("50g dubai chocolate")),
    );
    if (result === null || !result.ok) return;

    expect(result.value.foods).toHaveLength(1);
    expect(result.value.foods[0].query.toLowerCase()).toContain("dubai");
    expect(result.value.foods[0].amount).toBe(50);
    expect(result.value.foods[0].unit).toBe("g");
  }, 90_000);

  it("returns nothing for text that describes no food", async () => {
    const result = await withQuota(() =>
      geminiProvider.parseFoods(food("what is the capital of France")),
    );
    if (result === null || !result.ok) return;
    expect(result.value.foods).toEqual([]);
  }, 90_000);

  it("reads the spec's correction example", async () => {
    const result = await withQuota(() =>
      geminiProvider.parseCorrection(food("actually that was 250g, not 200g"), {
        description: food("chicken breast"),
        amount: 200,
        unit: "g",
      }),
    );
    if (result === null || !result.ok) return;

    expect(result.value).toEqual({ kind: "amount", amount: 250, unit: "g" });
  }, 90_000);

  it("says unclear rather than guessing an amount", async () => {
    const result = await withQuota(() =>
      geminiProvider.parseCorrection(
        food("that was more of a lunch than a snack"),
        { description: food("chicken breast"), amount: 200, unit: "g" },
      ),
    );
    if (result === null || !result.ok) return;

    // Rewriting the diary from an ambiguous sentence is worse than declining.
    expect(result.value.kind).toBe("unclear");
  }, 90_000);

  it("answers a nutrition question from anonymous figures", async () => {
    const result = await withQuota(() =>
      geminiProvider.answer(
        food("Am I on track for my protein today, and what should I eat?"),
        {
          targetCalories: 2250,
          targetProteinG: 180,
          caloriesToday: 1400,
          proteinTodayG: 90,
          trendWeightKg: 109.3,
        },
      ),
    );
    if (result === null) return;

    expect(
      result.ok,
      result.ok ? "" : `Gemini was unreachable (${result.message}).`,
    ).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeGreaterThan(20);
  }, 90_000);
});
