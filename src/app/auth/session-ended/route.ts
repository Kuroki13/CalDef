import { NextResponse, type NextRequest } from "next/server";

import { getAccountSetup } from "@/lib/profile";
import { accountIsDeleted } from "@/lib/account-status";
import { createClient, getUserId } from "@/lib/supabase/server";

/**
 * Where a session whose account no longer exists is sent to die.
 *
 * This exists because of where cookies can be written. A server component
 * cannot set them — `lib/supabase/server.ts` swallows the attempt, as the
 * Supabase template does — so signing out from a layout redirects the user
 * but leaves the dead token in the browser, to be presented again on every
 * request until it expires an hour later. A route handler can, so the
 * clearing happens here.
 *
 * It re-checks rather than trusting the caller, which makes it safe to reach
 * by a plain GET: someone who embeds this URL in an image tag to sign a user
 * out achieves nothing, because a live account is simply sent back to the
 * dashboard with its session intact.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId();
  const { profile } = await getAccountSetup();

  if (!accountIsDeleted({ userId, profile })) {
    // Either signed out already, or perfectly fine. Nothing to end.
    return NextResponse.redirect(
      new URL(userId ? "/dashboard" : "/login", request.url),
    );
  }

  const supabase = await createClient();
  // Local scope: there is no session upstream to revoke, because the refresh
  // token died with the account. What matters is the cookies.
  await supabase.auth.signOut({ scope: "local" });

  return NextResponse.redirect(new URL("/login", request.url));
}
