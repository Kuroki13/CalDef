import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({
  USDA_API_KEY: "test-key",
  GEMINI_API_KEY: null,
  hasUsdaKey: () => true,
  hasGeminiKey: () => false,
}));

const { usdaProvider } = await import("@/lib/food/usda");

/** One row shaped like a real FoodData Central search hit. */
const row = (over: Record<string, unknown> = {}) => ({
  fdcId: 171515,
  description: "Chicken breast, cooked",
  dataType: "SR Legacy",
  publishedDate: "2019-04-01",
  foodNutrients: [
    { nutrientId: 1008, unitName: "KCAL", value: 165 },
    { nutrientId: 1003, unitName: "G", value: 31 },
    { nutrientId: 1004, unitName: "G", value: 3.6 },
    { nutrientId: 1005, unitName: "G", value: 0 },
    { nutrientId: 1079, unitName: "G", value: 0 },
    { nutrientId: 1093, unitName: "MG", value: 74 },
  ],
  ...over,
});

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

describe("usdaProvider.search", () => {
  it("maps a row to the neutral shape", async () => {
    mockFetch({ foods: [row()] });

    const result = await usdaProvider.search({ text: "chicken breast" });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("usda");
    expect(result.foods).toHaveLength(1);

    const food = result.foods[0];
    expect(food.sourceId).toBe("171515");
    expect(food.source).toBe("usda");
    expect(food.nutrients).toMatchObject({
      kcal: 165,
      protein_g: 31,
      fat_g: 3.6,
      carbs_g: 0,
    });
    expect(food.nutrients.sodium_mg).toBe(74);
  });

  it("asks only for the laboratory-analysed datasets", async () => {
    const fetchMock = mockFetch({ foods: [] });
    await usdaProvider.search({ text: "rice" });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("Foundation");
    expect(url).toContain("SR+Legacy");
    // Branded is Open Food Facts' job.
    expect(url).not.toContain("Branded");
    // Sending the parenthesised Survey value makes the API answer 400.
    expect(url).not.toContain("FNDDS");
  });

  it("marks Foundation and SR Legacy verified, Survey not", async () => {
    mockFetch({
      foods: [
        row({ fdcId: 1, dataType: "Foundation" }),
        row({ fdcId: 2, dataType: "SR Legacy" }),
        row({ fdcId: 3, dataType: "Survey (FNDDS)" }),
      ],
    });

    const { foods } = await usdaProvider.search({ text: "x" });
    expect(foods.map((f) => f.isVerified)).toEqual([true, true, false]);
  });

  it("derives energy from macros when the row omits it", async () => {
    mockFetch({
      foods: [
        row({
          foodNutrients: [
            { nutrientId: 1003, value: 31 },
            { nutrientId: 1004, value: 3.6 },
            { nutrientId: 1005, value: 0 },
          ],
        }),
      ],
    });

    const { foods } = await usdaProvider.search({ text: "x" });
    // 31×4 + 0×4 + 3.6×9 = 156.4
    expect(foods[0].nutrients.kcal).toBeCloseTo(156.4, 1);
  });

  it("drops a row with neither energy nor macros rather than logging zero", async () => {
    mockFetch({ foods: [row({ foodNutrients: [] })] });
    const { foods } = await usdaProvider.search({ text: "x" });
    expect(foods).toEqual([]);
  });

  it("tidies shouted descriptions", async () => {
    mockFetch({ foods: [row({ description: "CHICKEN BREAST, RAW" })] });
    const { foods } = await usdaProvider.search({ text: "x" });
    expect(foods[0].name).toBe("Chicken Breast, Raw");
  });

  it("leaves normally-cased descriptions alone", async () => {
    mockFetch({ foods: [row({ description: "Chicken breast, cooked" })] });
    const { foods } = await usdaProvider.search({ text: "x" });
    expect(foods[0].name).toBe("Chicken breast, cooked");
  });

  it("offers a 100 g reference serving", async () => {
    mockFetch({ foods: [row()] });
    const { foods } = await usdaProvider.search({ text: "x" });
    expect(foods[0].servings).toEqual([
      { label: "100 g", grams: 100, isDefault: true },
    ]);
  });
});

describe("usdaProvider — degradation (ARCHITECTURE invariant 7)", () => {
  it("returns a failed result rather than throwing on an HTTP error", async () => {
    mockFetch({}, { ok: false, status: 503 });

    const result = await usdaProvider.search({ text: "x" });
    expect(result.ok).toBe(false);
    expect(result.foods).toEqual([]);
    expect(result.error).toContain("503");
  });

  it("returns a failed result when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await usdaProvider.search({ text: "x" });
    expect(result.ok).toBe(false);
    expect(result.foods).toEqual([]);
  });

  it("never leaks the API key in an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error("failed to fetch https://api.nal.usda.gov/?api_key=test-key"),
        ),
    );

    const result = await usdaProvider.search({ text: "x" });
    expect(result.error).not.toContain("test-key");
    expect(result.error).not.toContain("api_key");
  });

  it("reports a timeout distinctly", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    const result = await usdaProvider.search({ text: "x" });
    expect(result.error).toContain("did not respond in time");
  });
});
