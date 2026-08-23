import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetRateLimits,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

const OPTIONS = { limit: 3, windowMs: 60_000 };

beforeEach(() => __resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("user-1", OPTIONS, 1000).allowed).toBe(true);
    }
  });

  it("blocks the request past the limit", () => {
    for (let i = 0; i < 3; i++) rateLimit("user-1", OPTIONS, 1000);
    expect(rateLimit("user-1", OPTIONS, 1000).allowed).toBe(false);
  });

  it("counts down the remaining budget", () => {
    expect(rateLimit("user-1", OPTIONS, 1000).remaining).toBe(2);
    expect(rateLimit("user-1", OPTIONS, 1000).remaining).toBe(1);
    expect(rateLimit("user-1", OPTIONS, 1000).remaining).toBe(0);
  });

  it("never reports a negative remaining budget", () => {
    for (let i = 0; i < 6; i++) rateLimit("user-1", OPTIONS, 1000);
    expect(rateLimit("user-1", OPTIONS, 1000).remaining).toBe(0);
  });

  it("keeps callers separate", () => {
    for (let i = 0; i < 3; i++) rateLimit("user-1", OPTIONS, 1000);

    // One user exhausting their budget must not throttle another.
    expect(rateLimit("user-2", OPTIONS, 1000).allowed).toBe(true);
  });

  it("opens a fresh window once the old one expires", () => {
    for (let i = 0; i < 3; i++) rateLimit("user-1", OPTIONS, 1000);
    expect(rateLimit("user-1", OPTIONS, 1000).allowed).toBe(false);

    expect(rateLimit("user-1", OPTIONS, 61_001).allowed).toBe(true);
  });

  it("reports seconds until reset", () => {
    rateLimit("user-1", OPTIONS, 1000);
    const result = rateLimit("user-1", OPTIONS, 31_000);
    expect(result.retryAfterSeconds).toBe(30);
  });
});

describe("rateLimitHeaders", () => {
  it("describes the caller's standing", () => {
    const result = rateLimit("user-1", OPTIONS, 1000);
    const headers = rateLimitHeaders(result, OPTIONS.limit);

    expect(headers["RateLimit-Limit"]).toBe("3");
    expect(headers["RateLimit-Remaining"]).toBe("2");
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After only when blocked", () => {
    for (let i = 0; i < 3; i++) rateLimit("user-1", OPTIONS, 1000);
    const blocked = rateLimit("user-1", OPTIONS, 1000);

    expect(rateLimitHeaders(blocked, OPTIONS.limit)["Retry-After"]).toBe("60");
  });
});
