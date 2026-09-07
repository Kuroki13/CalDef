import { describe, expect, it } from "vitest";

import { CACHE_FRESH_DAYS, isStale } from "@/lib/food/staleness";

const now = new Date("2026-09-07T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("isStale", () => {
  it("keeps a food fetched today", () => {
    expect(isStale(daysAgo(0), now)).toBe(false);
  });

  it("keeps a food fetched inside the window", () => {
    expect(isStale(daysAgo(CACHE_FRESH_DAYS - 1), now)).toBe(false);
  });

  it("expires one older than the window", () => {
    expect(isStale(daysAgo(CACHE_FRESH_DAYS + 1), now)).toBe(true);
  });

  it("expires one exactly at the window, matching the policy's `<`", () => {
    // The RLS policy permits the write when `refreshed_at < now() - 30 days`.
    // The client must not attempt a write the database will refuse, nor sit
    // on a row the database would let it refresh, so the boundary is shared.
    expect(isStale(daysAgo(CACHE_FRESH_DAYS), now)).toBe(true);
  });

  it("expires a row that predates the column", () => {
    // Nothing is known about when it last agreed with its provider, and
    // "unknown" is not a reason to trust it for ever.
    expect(isStale(null, now)).toBe(true);
  });

  it("expires a row whose timestamp is nonsense", () => {
    expect(isStale("not a date", now)).toBe(true);
  });

  it("takes the window as an argument, so a caller can be explicit", () => {
    expect(isStale(daysAgo(10), now, 7)).toBe(true);
    expect(isStale(daysAgo(10), now, 14)).toBe(false);
  });
});
