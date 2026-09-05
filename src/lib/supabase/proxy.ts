import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Routes reachable without a session. Everything else redirects to /login.
 *
 * `/sw.js` and `/offline` are here for the PWA, and their absence was a real
 * bug rather than a nicety: a signed-out request for the worker script got a
 * 307 to an HTML page, so registration failed on its MIME type, and the
 * worker's install-time precache of `/offline` would have stored the login
 * page under that URL and served it later as the offline screen.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/auth",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refreshes the Supabase session cookie on every request and performs the
 * optimistic redirect for signed-out visitors.
 *
 * This is a convenience check, not the authorization boundary: Next.js docs
 * are explicit that proxy is the wrong place for real authorization, and
 * every page and route handler re-verifies the user itself. RLS is the
 * actual enforcement.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Created per request on purpose — never hoisted to a module-level
  // singleton, which would leak one visitor's session into another's.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          supabaseResponse.headers.set(key, value);
        }
      },
    },
  });

  // Nothing may run between createServerClient and getClaims(). Anything in
  // between can desynchronise the cookie refresh and log users out at random.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;

  const { pathname } = request.nextUrl;

  // Route handlers answer for themselves. Redirecting an unauthenticated
  // API request to /login would hand a `fetch` caller a 307 to an HTML page,
  // which it would follow and then fail to parse as JSON — turning "you are
  // signed out" into "the service is unreachable". Each handler re-verifies
  // the user and returns a proper 401.
  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  if (!userId && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (userId && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // supabaseResponse must be returned as-is. Building a fresh response here
  // without copying its cookies desynchronises browser and server and ends
  // the session early.
  return supabaseResponse;
}
