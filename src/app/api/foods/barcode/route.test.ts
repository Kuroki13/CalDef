import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";
import type { Food } from "@/lib/food/types";

const getUserId = vi.fn();
const lookupBarcode = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/food/registry", () => ({
  lookupBarcode: (...a: unknown[]) => lookupBarcode(...a),
}));

const { GET } = await import("@/app/api/foods/barcode/route");

const food: Food = {
  sourceId: "3017624010701",
  source: "off",
  name: "Nutella",
  brand: "Ferrero",
  description: null,
  barcode: "3017624010701",
  isVerified: false,
  nutrients: { kcal: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9 },
  servings: [{ label: "100 g", grams: 100, isDefault: true }],
  dataUpdatedAt: null,
};

const call = (query: string) =>
  GET(new NextRequest(`http://localhost/api/foods/barcode${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  lookupBarcode.mockResolvedValue(food);
});

describe("GET /api/foods/barcode", () => {
  it("refuses an unauthenticated caller", async () => {
    getUserId.mockResolvedValue(null);

    const response = await call("?code=3017624010701");

    expect(response.status).toBe(401);
    expect(lookupBarcode).not.toHaveBeenCalled();
  });

  it("resolves a known barcode", async () => {
    const response = await call("?code=3017624010701");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.food.name).toBe("Nutella");
  });

  it("rejects a malformed barcode without calling the provider", async () => {
    const response = await call("?code=abc");

    expect(response.status).toBe(400);
    expect(lookupBarcode).not.toHaveBeenCalled();
  });

  it("accepts only the digit lengths the database column allows", async () => {
    // foods.barcode is checked against ^[0-9]{6,14}$.
    expect((await call("?code=12345")).status).toBe(400);
    expect((await call("?code=123456")).status).toBe(200);
    expect((await call("?code=123456789012345")).status).toBe(400);
  });

  it("answers 404 with a body when the product is unknown", async () => {
    lookupBarcode.mockResolvedValue(null);

    const response = await call("?code=0000000000000");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.food).toBeNull();
    expect(body.error).toContain("not in the database");
  });

  it("degrades to 503 rather than leaking a provider failure", async () => {
    lookupBarcode.mockRejectedValue(
      new Error("ECONNRESET at https://x/?key=s3cret"),
    );

    const response = await call("?code=3017624010701");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("Search by name instead");
    // The upstream message must not reach the client.
    expect(JSON.stringify(body)).not.toContain("s3cret");
  });

  it("rate limits per user", async () => {
    for (let i = 0; i < 60; i++) await call("?code=3017624010701");

    const blocked = await call("?code=3017624010701");
    expect(blocked.status).toBe(429);

    getUserId.mockResolvedValue("user-2");
    expect((await call("?code=3017624010701")).status).toBe(200);
  });
});
