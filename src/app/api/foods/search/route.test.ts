import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";
import type { Food, SearchOutcome } from "@/lib/food/types";

const getUserId = vi.fn();
const searchFoods = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/food/registry", () => ({
  searchFoods: (...a: unknown[]) => searchFoods(...a),
  describeDegradation: (results: { ok: boolean }[]) =>
    results.some((r) => !r.ok) ? "USDA did not respond." : null,
}));

const { GET } = await import("@/app/api/foods/search/route");

const food: Food = {
  sourceId: "1",
  source: "usda",
  name: "Chicken breast",
  brand: null,
  description: null,
  barcode: null,
  isVerified: true,
  nutrients: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  servings: [{ label: "100 g", grams: 100, isDefault: true }],
  dataUpdatedAt: null,
};

const outcome = (over: Partial<SearchOutcome> = {}): SearchOutcome => ({
  foods: [food],
  results: [{ source: "usda", ok: true, foods: [food] }],
  degraded: false,
  ...over,
});

// A real NextRequest: the handler reads `nextUrl`, which a plain Request
// does not have.
const call = (query: string) =>
  GET(new NextRequest(`http://localhost/api/foods/search${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  searchFoods.mockResolvedValue(outcome());
});

describe("GET /api/foods/search — authentication", () => {
  it("refuses an unauthenticated caller", async () => {
    getUserId.mockResolvedValue(null);

    const response = await call("?q=chicken");

    expect(response.status).toBe(401);
    expect(searchFoods).not.toHaveBeenCalled();
  });

  it("answers JSON rather than redirecting, so fetch can read the error", async () => {
    getUserId.mockResolvedValue(null);

    const response = await call("?q=chicken");

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Not authenticated." });
  });
});

describe("GET /api/foods/search — validation", () => {
  it("rejects a query that is too short", async () => {
    const response = await call("?q=a");

    expect(response.status).toBe(400);
    expect(searchFoods).not.toHaveBeenCalled();
  });

  it("rejects a missing query", async () => {
    expect((await call("")).status).toBe(400);
  });

  it("clamps an oversized limit rather than passing it through", async () => {
    expect((await call("?q=chicken&limit=500")).status).toBe(400);
  });

  it("defaults the limit when none is given", async () => {
    await call("?q=chicken");
    expect(searchFoods).toHaveBeenCalledWith({ text: "chicken", limit: 15 });
  });
});

describe("GET /api/foods/search — results", () => {
  it("returns the merged foods", async () => {
    const response = await call("?q=chicken");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.foods).toHaveLength(1);
    expect(body.foods[0].name).toBe("Chicken breast");
    expect(body.degraded).toBe(false);
    expect(body.notice).toBeNull();
  });

  it("flags a degraded result set so the UI can say so", async () => {
    searchFoods.mockResolvedValue(
      outcome({
        degraded: true,
        results: [{ source: "usda", ok: false, foods: [], error: "down" }],
      }),
    );

    const body = await (await call("?q=chicken")).json();

    expect(body.degraded).toBe(true);
    expect(body.notice).toContain("USDA");
  });
});

describe("GET /api/foods/search — rate limiting", () => {
  it("allows requests up to the limit", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await call("?q=chicken")).status).toBe(200);
    }
  });

  it("blocks past the limit with a Retry-After", async () => {
    for (let i = 0; i < 30; i++) await call("?q=chicken");

    const response = await call("?q=chicken");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("reports the caller's standing on a successful request", async () => {
    const response = await call("?q=chicken");

    expect(response.headers.get("RateLimit-Limit")).toBe("30");
    expect(response.headers.get("RateLimit-Remaining")).toBe("29");
  });

  it("budgets per user rather than globally", async () => {
    for (let i = 0; i < 30; i++) await call("?q=chicken");
    expect((await call("?q=chicken")).status).toBe(429);

    getUserId.mockResolvedValue("user-2");
    expect((await call("?q=chicken")).status).toBe(200);
  });

  it("does not spend budget on an unauthenticated request", async () => {
    getUserId.mockResolvedValue(null);
    for (let i = 0; i < 50; i++) await call("?q=chicken");

    getUserId.mockResolvedValue("user-1");
    expect((await call("?q=chicken")).status).toBe(200);
  });
});
