import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trustedFoodText } from "@/lib/llm/food-text";

vi.mock("@/lib/env.server", () => ({
  GEMINI_API_KEY: "test-key-do-not-log",
  USDA_API_KEY: null,
  hasGeminiKey: () => true,
  hasUsdaKey: () => false,
}));

const { geminiProvider } = await import("@/lib/llm/gemini");

/** A Gemini response whose single part carries `text`. */
function reply(text: string, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const text = (s: string) => trustedFoodText(s);

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

describe("parseFoods", () => {
  it("returns intent for the spec's worked example", async () => {
    reply(
      JSON.stringify({
        foods: [
          { query: "chicken breast cooked", amount: 200, unit: "g" },
          { query: "white rice cooked", amount: 150, unit: "g" },
          { query: "olive oil", amount: 15, unit: "ml" },
        ],
      }),
    );

    const result = await geminiProvider.parseFoods(
      text("I ate 200g chicken, 150g rice and one tablespoon olive oil"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.foods).toEqual([
      { query: "chicken breast cooked", amount: 200, unit: "g" },
      { query: "white rice cooked", amount: 150, unit: "g" },
      { query: "olive oil", amount: 15, unit: "ml" },
    ]);
  });

  it("discards a nutrition figure the model volunteers", async () => {
    reply(
      JSON.stringify({
        foods: [
          {
            query: "Dubai chocolate",
            amount: 50,
            unit: "g",
            kcal: 265,
            protein_g: 5,
            calories: 265,
          },
        ],
      }),
    );

    const result = await geminiProvider.parseFoods(text("50g dubai chocolate"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The invariant: nothing the model said about nutrition survives.
    expect(result.value.foods).toEqual([
      { query: "Dubai chocolate", amount: 50, unit: "g" },
    ]);
    expect(Object.keys(result.value.foods[0])).toEqual([
      "query",
      "amount",
      "unit",
    ]);
  });

  it("drops an item with an unusable amount rather than guessing one", async () => {
    reply(
      JSON.stringify({
        foods: [
          { query: "rice", amount: 0, unit: "g" },
          { query: "eggs", amount: -2, unit: "serving" },
          { query: "oil", amount: 15, unit: "ml" },
        ],
      }),
    );

    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok && result.value.foods).toEqual([
      { query: "oil", amount: 15, unit: "ml" },
    ]);
  });

  it("drops an item whose unit is not one of ours", async () => {
    reply(
      JSON.stringify({
        foods: [{ query: "milk", amount: 1, unit: "cup" }],
      }),
    );
    const result = await geminiProvider.parseFoods(text("a cup of milk"));
    expect(result.ok && result.value.foods).toEqual([]);
  });

  it("returns an empty list when the text describes no food", async () => {
    reply(JSON.stringify({ foods: [] }));
    const result = await geminiProvider.parseFoods(text("how are you"));
    expect(result.ok && result.value.foods).toEqual([]);
  });

  it("reports unusable output rather than throwing", async () => {
    reply("not json at all");
    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unusable");
  });

  it("ignores a thinking model's thought parts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: "let me think about the rice", thought: true },
                  { text: JSON.stringify({ foods: [] }) },
                ],
              },
            },
          ],
        }),
      }),
    );

    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok).toBe(true);
  });
});

describe("parseCorrection", () => {
  const entry = { description: text("chicken breast"), amount: 200, unit: "g" as const };

  it("reads a restated amount", async () => {
    reply(JSON.stringify({ kind: "amount", amount: 250, unit: "g" }));
    const result = await geminiProvider.parseCorrection(
      text("actually that was 250g, not 200g"),
      entry,
    );
    expect(result.ok && result.value).toEqual({
      kind: "amount",
      amount: 250,
      unit: "g",
    });
  });

  it("reads a removal", async () => {
    reply(JSON.stringify({ kind: "remove" }));
    const result = await geminiProvider.parseCorrection(
      text("I did not actually eat that"),
      entry,
    );
    expect(result.ok && result.value).toEqual({ kind: "remove" });
  });

  it("falls back to unclear when an amount correction carries no amount", async () => {
    reply(JSON.stringify({ kind: "amount" }));
    const result = await geminiProvider.parseCorrection(text("a bit more"), entry);
    // Leaving the entry alone beats rewriting it with a guess.
    expect(result.ok && result.value).toEqual({ kind: "unclear" });
  });

  it("passes the entry as a sentence, never as a row", async () => {
    const fetchMock = reply(JSON.stringify({ kind: "unclear" }));
    await geminiProvider.parseCorrection(text("more"), entry);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const sent = body.contents[0].parts[0].text as string;

    // Asserted exactly, because "the row is not sent" is only convincing if
    // what *is* sent is enumerated. There is no entry id, no user id and no
    // stored macro figure here — only food, a portion, and what was typed.
    expect(sent).toBe(
      "Logged entry: chicken breast, 200 g.\nThe user says: more",
    );
  });
});

describe("answer", () => {
  it("returns prose and sends only the figures it has labels for", async () => {
    const fetchMock = reply("Aim for roughly 180 g of protein a day.");

    const result = await geminiProvider.answer(text("how much protein?"), {
      targetCalories: 2250,
      trendWeightKg: 109.3,
    });

    expect(result.ok && result.value).toContain("180 g");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const sent = body.contents[0].parts[0].text as string;
    expect(sent).toContain("2250 kcal");
    expect(sent).toContain("109.3 kg");
    // Absent figures produce no line at all, rather than "undefined".
    expect(sent).not.toContain("undefined");
    expect(sent).not.toContain("Protein target");
  });

  it("asks for prose, not JSON", async () => {
    const fetchMock = reply("ok");
    await geminiProvider.answer(text("hi"), {});

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });
});

describe("failure handling", () => {
  it("retries a 503 and succeeds on a later attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"foods":[]}' }] } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 429, and names the quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await geminiProvider.parseFoods(text("x"));

    // Retrying an over-quota call spends more of the quota. One request in,
    // one request out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rate-limited");
      expect(result.message).toContain("Try again in a minute");
    }
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the API key in a failure message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new Error(
          "fetch failed for https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=test-key-do-not-log",
        ),
      ),
    );

    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("test-key-do-not-log");
      expect(result.message).not.toContain("key=");
      expect(result.reason).toBe("unavailable");
    }
  });

  it("reports the status without the upstream body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "key=test-key-do-not-log bad" } }),
      }),
    );

    const result = await geminiProvider.parseFoods(text("x"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("The assistant returned 403.");
      expect(result.message).not.toContain("test-key-do-not-log");
    }
  });
});
