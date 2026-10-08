import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { searchFoods } from "@/lib/food/registry";
import { describeDegradation } from "@/lib/food/registry";
import { RATE_LIMITS, rateLimitAll, rateLimitHeaders } from "@/lib/rate-limit";
import { getUserId } from "@/lib/supabase/server";

/**
 * Provider-backed food search.
 *
 * This route exists so the browser never talks to USDA or Open Food Facts
 * directly — their keys are server-only, and ARCHITECTURE §2 makes that a
 * structural rule rather than a preference.
 *
 * Order matters: authenticate, then rate limit, then validate. Rate limiting
 * before authentication would let an unauthenticated caller consume another
 * user's budget, and validating before rate limiting would let malformed
 * requests pass through the limiter for free.
 */

const querySchema = z.object({
  q: z.string().trim().min(2, "Search for at least two characters.").max(100),
  limit: z.coerce.number().int().min(1).max(25).default(15),
});

export async function GET(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // This route's own bucket, plus the one every outbound provider call
  // shares. Search and barcode both reach Open Food Facts, which is
  // community-run and has no paid tier to fall back on.
  const limit = rateLimitAll([
    { key: `food-search:${userId}`, options: RATE_LIMITS.foodSearch },
    { key: `food-providers:${userId}`, options: RATE_LIMITS.foodProviders },
  ]);
  const headers = rateLimitHeaders(limit.result, limit.limit);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many searches. Try again shortly.",
        reason: "too-many-requests",
      },
      { status: 429, headers },
    );
  }

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400, headers },
    );
  }

  const outcome = await searchFoods({
    text: parsed.data.q,
    limit: parsed.data.limit,
  });

  return NextResponse.json(
    {
      foods: outcome.foods,
      degraded: outcome.degraded,
      recognised: outcome.recognised ?? null,
      strongMatch: outcome.strongMatch ?? null,
      recipes: outcome.recipes ?? [],
      learned: outcome.learned ?? [],
      notice: describeDegradation(outcome.results),
    },
    { headers },
  );
}
