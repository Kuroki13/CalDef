import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Server client for server components, server actions and route handlers.
 * Scoped to the caller's session, so RLS applies exactly as it does in the
 * browser. This app never uses the service_role key.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. Safe to ignore: the proxy
          // refreshes the session on every request.
        }
      },
    },
  });
}

/**
 * The authenticated user's id, or null.
 *
 * Uses `getClaims()`, which verifies the JWT signature against the project's
 * published keys. `getSession()` is never trusted in server code — it reads
 * the cookie without revalidating, and cookies can be spoofed.
 */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

/**
 * Same, but throws. For code paths that are unreachable without a session
 * and should fail loudly rather than silently reading nothing.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}
