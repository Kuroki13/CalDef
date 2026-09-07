import "server-only";

/**
 * Is the account behind this session still there?
 *
 * `getUserId` reads the JWT's claims and verifies the signature locally,
 * which is Supabase's own recommendation and the reason a page load does not
 * cost an auth round trip. The consequence is that a token stays valid for
 * its full hour after the account it names has been deleted — observed while
 * cleaning up a test account, when `/dashboard` went to `/onboarding`
 * instead of `/login`, as if the user had simply never finished setting up.
 *
 * Nothing dangerous follows from that: every table is behind RLS and every
 * user-owned row references `auth.users`, so a write fails on the foreign key
 * and a read returns nothing. What follows is *confusing*, which is its own
 * kind of wrong — the app tells someone whose account is gone to go and
 * finish setting it up.
 *
 * The signal is free. Every account has a `profiles` row: the
 * `on_auth_user_created` trigger writes one on signup, and
 * `profiles.id references auth.users on delete cascade` takes it away again
 * when the account goes. So a verified token with no profile behind it means
 * the account has been deleted, and the pages that already load the profile
 * can tell without asking anything extra.
 */

import { redirect } from "next/navigation";

import type { Profile } from "@/lib/profile";

/**
 * The rule, on its own so it can be stated and tested without a session.
 *
 * Deliberately narrow: only a *signed-in* request with no profile counts.
 * A signed-out request has no account to be missing, and a profile that
 * exists but is half-filled is someone in the middle of onboarding.
 */
export function accountIsDeleted({
  userId,
  profile,
}: {
  userId: string | null;
  profile: Profile | null;
}): boolean {
  return userId !== null && profile === null;
}

/**
 * Where a dead session is sent.
 *
 * Not signed out here, and that is not an oversight: a server component
 * cannot write cookies — `lib/supabase/server.ts` swallows the attempt, as
 * the Supabase template does — so clearing them from a layout would look
 * like it worked and leave the browser presenting the same dead token on
 * every subsequent request. `app/auth/session-ended/route.ts` is a route
 * handler, which can, and it re-checks before it acts.
 */
export const SESSION_ENDED_PATH = "/auth/session-ended";

export function endSessionOfDeletedAccount(): never {
  redirect(SESSION_ENDED_PATH);
}

/**
 * Both halves together, for the two places that guard a signed-in surface.
 *
 * Returns normally when the account is fine, so a caller reads as a
 * precondition rather than a branch.
 */
export function ensureAccountExists(args: {
  userId: string | null;
  profile: Profile | null;
}): void {
  if (accountIsDeleted(args)) endSessionOfDeletedAccount();
}
