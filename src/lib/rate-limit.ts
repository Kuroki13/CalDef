import "server-only";

/**
 * In-process rate limiting.
 *
 * The spec requires the AI and external-provider routes to be rate limited
 * (§9). This is a fixed-window counter held in module memory.
 *
 * The honest limitation: serverless instances do not share memory, so on
 * Vercel the effective limit is per-instance rather than global, and it
 * resets on a cold start. It stops a runaway client loop, which is the
 * actual risk here. It is *not* a defence against a distributed attacker,
 * and it should not be described as one.
 *
 * This file used to claim that a shared limiter "needs a paid add-on, which
 * CLAUDE.md forbids". That was wrong, and worth correcting rather than
 * quietly deleting: there is a Postgres database already paid for at zero,
 * and a counter table with an atomic increment would work. The reason not
 * to build it is cost against benefit, not impossibility — see DECISIONS in
 * IMPLEMENTATION_STATUS.md. The short version: signup is closed, every
 * limited route requires a session, and none of the quotas this protects
 * can produce a bill — they refuse. A loose limit therefore buys a worse
 * error message, and the price would be a database write on the hot path of
 * every search.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Trimmed opportunistically so an abandoned key cannot leak memory. */
const MAX_TRACKED_KEYS = 5000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Unix ms when the current window ends. */
  resetAt: number;
  /** Seconds until reset, for a Retry-After header. */
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
};

/**
 * Sensible defaults per route class.
 *
 * These sit *below* the quota each one is protecting, not at it, because the
 * limiter is per instance (see the note at the top of this file) and because
 * a user who has hit our limit should see our message rather than the
 * provider's.
 */
export const RATE_LIMITS = {
  /** Search hits USDA and OFF, whose quotas we are a guest of. */
  foodSearch: { limit: 30, windowMs: 60_000 },
  /** Barcode scanning is bursty by nature — a camera fires repeatedly. */
  barcode: { limit: 60, windowMs: 60_000 },
  /** Per AI route, so one runaway screen cannot starve the others. */
  ai: { limit: 10, windowMs: 60_000 },
  /**
   * Every Gemini call, whichever route made it.
   *
   * Without this the three AI routes held three separate 10/min buckets, so
   * a client looping across all of them could make 30 requests a minute
   * against a model whose free tier allows 15 — our limiter would have
   * reported everything fine while the provider refused. The number is what
   * the upstream quota actually is, minus headroom for a retry.
   */
  gemini: { limit: 12, windowMs: 60_000 },
  /**
   * Every outbound call to a food provider, whichever route made it.
   *
   * Search and barcode both reach Open Food Facts, a community-run service
   * with no paid tier to fall back on. 30 + 60 per minute from one user is
   * not a reasonable thing to ask of it.
   */
  foodProviders: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

/**
 * Consumes one unit against `key`.
 *
 * `key` must identify the caller — use the authenticated user id, never an
 * IP address alone, since every request behind one home connection shares
 * an IP and would throttle each other.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number = Date.now(),
): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    if (windows.size >= MAX_TRACKED_KEYS) evictExpired(now);
    const resetAt = now + windowMs;
    windows.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;

  return {
    allowed,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(Math.ceil((existing.resetAt - now) / 1000), 1),
  };
}

/** Headers describing the caller's current standing. */
export function rateLimitHeaders(
  result: RateLimitResult,
  limit: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }
  return headers;
}

/**
 * Consumes from several buckets at once and reports the tightest.
 *
 * A route is usually limited twice: once for itself, and once for the
 * upstream quota it shares with other routes. Both counters must move on
 * every request — including a refused one, since a fixed window that only
 * counts successes is a window a caller can walk straight through.
 *
 * The headers describe whichever bucket has least left, because that is the
 * one the caller will hit next and the only honest number to publish.
 */
export function rateLimitAll(
  checks: ReadonlyArray<{ key: string; options: RateLimitOptions }>,
  now: number = Date.now(),
): { allowed: boolean; result: RateLimitResult; limit: number } {
  const consumed = checks.map((check) => ({
    result: rateLimit(check.key, check.options, now),
    limit: check.options.limit,
  }));

  const tightest = consumed.reduce((worst, current) =>
    // A refusal always wins; otherwise the one closest to refusing.
    current.result.allowed === worst.result.allowed
      ? current.result.remaining < worst.result.remaining
        ? current
        : worst
      : current.result.allowed
        ? worst
        : current,
  );

  return {
    allowed: consumed.every((c) => c.result.allowed),
    result: tightest.result,
    limit: tightest.limit,
  };
}

function evictExpired(now: number): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
  // Still full of live windows: drop the oldest rather than grow without
  // bound. Losing a live counter fails open, which is the right direction
  // for a convenience limiter guarding a personal app.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const oldest = [...windows.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt,
    );
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED_KEYS / 10))) {
      windows.delete(key);
    }
  }
}

/** Test seam. Never called by application code. */
export function __resetRateLimits(): void {
  windows.clear();
}
