import "server-only";

/**
 * In-process rate limiting.
 *
 * The spec requires the AI and external-provider routes to be rate limited
 * (§9). This is a fixed-window counter held in module memory.
 *
 * The honest limitation: serverless instances do not share memory, so on
 * Vercel the effective limit is per-instance rather than global, and it
 * resets on a cold start. For a single-user personal app that is adequate —
 * it stops a runaway client loop from burning the USDA quota, which is the
 * actual risk here. It is *not* a defence against a distributed attacker,
 * and it should not be described as one. A real limiter needs shared state,
 * which needs a paid add-on, which CLAUDE.md forbids.
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

/** Sensible defaults per route class. */
export const RATE_LIMITS = {
  /** Search hits USDA and OFF, whose quotas we are a guest of. */
  foodSearch: { limit: 30, windowMs: 60_000 },
  /** Barcode scanning is bursty by nature — a camera fires repeatedly. */
  barcode: { limit: 60, windowMs: 60_000 },
  /** Gemini's free tier is the tightest budget in the system. */
  ai: { limit: 10, windowMs: 60_000 },
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
