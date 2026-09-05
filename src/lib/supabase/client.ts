import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Browser client. Constrained entirely by RLS — it holds only the
 * publishable key, which grants nothing on its own.
 *
 * **Nothing imports this today.** Every read and write goes through a server
 * component, a server action or a route handler, which is why the built
 * client bundle contains neither the project URL nor the publishable key,
 * and why the Content-Security-Policy in `next.config.ts` narrows
 * `connect-src` to `'self'` alone.
 *
 * So: the first component to import this will get a CSP violation rather
 * than a network call, and the fix is to add the Supabase origin — and its
 * `wss://` form for realtime — to that `connect-src`. Kept rather than
 * deleted because it is the correct implementation when that day comes; the
 * note is here so the failure is one sentence to diagnose instead of an
 * afternoon.
 */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
