import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { lookupBarcode } from "@/lib/food/registry";
import { RATE_LIMITS, rateLimitAll, rateLimitHeaders } from "@/lib/rate-limit";
import { getUserId } from "@/lib/supabase/server";

/**
 * Barcode lookup, cache first and Open Food Facts second.
 *
 * A miss is a 404 with a body rather than an error: "we do not have that
 * product" is a normal outcome of scanning, and the client shows the manual
 * search path instead.
 */

const paramsSchema = z.object({
  // Matches the `foods.barcode` column constraint exactly, so anything this
  // route accepts is something the database will also accept.
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6,14}$/, "That is not a barcode."),
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
    { key: `barcode:${userId}`, options: RATE_LIMITS.barcode },
    { key: `food-providers:${userId}`, options: RATE_LIMITS.foodProviders },
  ]);
  const headers = rateLimitHeaders(limit.result, limit.limit);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many lookups. Try again shortly.",
        reason: "too-many-requests",
      },
      { status: 429, headers },
    );
  }

  const parsed = paramsSchema.safeParse({
    code: request.nextUrl.searchParams.get("code") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400, headers },
    );
  }

  try {
    const food = await lookupBarcode(parsed.data.code);
    if (!food) {
      return NextResponse.json(
        { error: "That product is not in the database yet.", food: null },
        { status: 404, headers },
      );
    }
    return NextResponse.json({ food }, { headers });
  } catch {
    // A provider outage degrades to the manual path rather than surfacing a
    // stack trace, per ARCHITECTURE invariant 7.
    return NextResponse.json(
      {
        error: "Could not reach the product database. Search by name instead.",
        food: null,
      },
      { status: 503, headers },
    );
  }
}
