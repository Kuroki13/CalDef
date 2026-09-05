import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { offProvider } from "@/lib/food/off";

/** A product shaped like a real Open Food Facts record. */
const product = (over: Record<string, unknown> = {}) => ({
  code: "3017624010701",
  product_name: "Nutella",
  brands: "Ferrero,Nutella",
  quantity: "400 g",
  serving_size: "15 g",
  serving_quantity: 15,
  last_modified_t: 1_700_000_000,
  nutriments: {
    "energy-kcal_100g": 539,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    sugars_100g: 56.3,
    "saturated-fat_100g": 10.6,
    fiber_100g: 0,
    sodium_100g: 0.043,
  },
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

describe("offProvider.search", () => {
  it("maps a product to the neutral shape", async () => {
    mockFetch({ products: [product()] });

    const result = await offProvider.search({ text: "nutella" });
    expect(result.ok).toBe(true);

    const food = result.foods[0];
    expect(food.sourceId).toBe("3017624010701");
    expect(food.source).toBe("off");
    expect(food.name).toBe("Nutella");
    expect(food.nutrients.kcal).toBe(539);
    expect(food.nutrients.protein_g).toBe(6.3);
  });

  it("never marks community data as verified", async () => {
    mockFetch({ products: [product()] });
    const { foods } = await offProvider.search({ text: "x" });
    expect(foods[0].isVerified).toBe(false);
  });

  it("takes the first of a comma-separated brand list", async () => {
    mockFetch({ products: [product()] });
    const { foods } = await offProvider.search({ text: "x" });
    expect(foods[0].brand).toBe("Ferrero");
  });

  it("converts sodium from grams to milligrams", async () => {
    mockFetch({ products: [product()] });
    const { foods } = await offProvider.search({ text: "x" });
    expect(foods[0].nutrients.sodium_mg).toBe(43);
  });

  it("parses numbers that arrive as strings", async () => {
    mockFetch({
      products: [
        product({
          nutriments: { "energy-kcal_100g": "539", proteins_100g: "6.3" },
        }),
      ],
    });
    const { foods } = await offProvider.search({ text: "x" });
    expect(foods[0].nutrients.kcal).toBe(539);
    expect(foods[0].nutrients.protein_g).toBe(6.3);
  });

  it("skips a product with no energy value rather than inventing one", async () => {
    mockFetch({
      products: [product({ nutriments: { proteins_100g: 6.3 } })],
    });
    const { foods } = await offProvider.search({ text: "x" });
    expect(foods).toEqual([]);
  });

  it("skips a product with no name", async () => {
    mockFetch({ products: [product({ product_name: "  " })] });
    expect((await offProvider.search({ text: "x" })).foods).toEqual([]);
  });

  it("sends the search term to the endpoint that honours it", async () => {
    const fetchMock = mockFetch({ products: [] });
    await offProvider.search({ text: "dubai" });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    // `/api/v2/search` filters on tags and ignores `search_terms` instead of
    // rejecting it, so querying it returned page 1 of the whole database —
    // products unrelated to anything the user typed.
    expect(url.pathname).toBe("/cgi/search.pl");
    expect(url.searchParams.get("search_terms")).toBe("dubai");
    expect(url.searchParams.get("json")).toBe("1");
  });

  it("identifies the app in the User-Agent, as OFF asks", async () => {
    const fetchMock = mockFetch({ products: [] });
    await offProvider.search({ text: "x" });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toContain("CalDef");
  });
});

describe("offProvider — servings", () => {
  it("offers 100 g plus the package serving", async () => {
    mockFetch({ products: [product()] });
    const { foods } = await offProvider.search({ text: "x" });

    expect(foods[0].servings).toEqual([
      { label: "100 g", grams: 100, isDefault: true },
      { label: "15 g", grams: 15, isDefault: false },
    ]);
  });

  it("drops an unparseable serving rather than guessing its weight", async () => {
    mockFetch({
      products: [product({ serving_quantity: undefined, serving_size: "1 cup" })],
    });
    const { foods } = await offProvider.search({ text: "x" });

    expect(foods[0].servings).toHaveLength(1);
    expect(foods[0].servings[0].grams).toBe(100);
  });

  it("rejects an absurd serving weight", async () => {
    mockFetch({ products: [product({ serving_quantity: 999999 })] });
    const { foods } = await offProvider.search({ text: "x" });
    expect(foods[0].servings).toHaveLength(1);
  });
});

describe("offProvider.lookupBarcode", () => {
  it("resolves a barcode through the v3 product endpoint", async () => {
    const fetchMock = mockFetch({ status: "success", product: product() });

    const food = await offProvider.lookupBarcode!("3017624010701");
    expect(food?.name).toBe("Nutella");
    expect(food?.barcode).toBe("3017624010701");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v3/product/");
  });

  it("returns null for an unknown barcode instead of throwing", async () => {
    mockFetch({}, { ok: false, status: 404 });
    expect(await offProvider.lookupBarcode!("0000000000000")).toBeNull();
  });

  it("rejects a malformed barcode without making a request", async () => {
    const fetchMock = mockFetch({});
    expect(await offProvider.lookupBarcode!("not-a-barcode")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a server error so the caller can degrade", async () => {
    mockFetch({}, { ok: false, status: 500 });
    await expect(offProvider.lookupBarcode!("3017624010701")).rejects.toThrow();
  });
});

describe("offProvider — degradation", () => {
  it("returns a failed result rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    const result = await offProvider.search({ text: "x" });
    expect(result.ok).toBe(false);
    expect(result.foods).toEqual([]);
    expect(result.source).toBe("off");
  });

  it("is always considered configured, having no key", () => {
    expect(offProvider.isAvailable()).toBe(true);
  });
});
