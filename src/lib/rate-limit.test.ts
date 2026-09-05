import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetRateLimits,
  rateLimit,
  rateLimitAll,
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

describe("rateLimitAll", () => {
  const own = { limit: 10, windowMs: 60_000 };
  const shared = { limit: 12, windowMs: 60_000 };

  it("consumes every bucket on one request", () => {
    rateLimitAll(
      [
        { key: "route:u1", options: own },
        { key: "upstream:u1", options: shared },
      ],
      1000,
    );

    expect(rateLimit("route:u1", own, 1000).remaining).toBe(8);
    expect(rateLimit("upstream:u1", shared, 1000).remaining).toBe(10);
  });

  it("refuses when the shared bucket is spent, though the route's is not", () => {
    // The case this exists for: three AI routes at 10/min each could make 30
    // requests a minute against a model whose free tier allows 15.
    for (let i = 0; i < 12; i++) {
      rateLimitAll([{ key: "upstream:u1", options: shared }], 1000);
    }

    const result = rateLimitAll(
      [
        { key: "route:u1", options: own },
        { key: "upstream:u1", options: shared },
      ],
      1000,
    );

    expect(result.allowed).toBe(false);
    expect(result.result.remaining).toBe(0);
  });

  it("reports the bucket closest to refusing", () => {
    for (let i = 0; i < 7; i++) {
      rateLimit("route:u1", own, 1000);
    }

    const result = rateLimitAll(
      [
        { key: "route:u1", options: own },
        { key: "upstream:u1", options: shared },
      ],
      1000,
    );

    // The route bucket has 2 left and the shared one 11; publishing 11 would
    // tell the caller they have headroom they do not have.
    expect(result.allowed).toBe(true);
    expect(result.result.remaining).toBe(2);
    expect(result.limit).toBe(own.limit);
  });

  it("counts a refused request too", () => {
    for (let i = 0; i < 11; i++) {
      rateLimitAll([{ key: "route:u1", options: own }], 1000);
    }

    // A fixed window that only counted successes would be one a caller could
    // walk straight through by ignoring the 429s.
    const after = rateLimit("route:u1", own, 1000);
    expect(after.allowed).toBe(false);
  });
});
