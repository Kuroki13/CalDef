"use client";

/**
 * Sign out, and take this device's training leftovers with it.
 *
 * A live session keeps unsent sets and its rest timer in this browser's
 * storage, under the account's id. They are cleared here so that nothing
 * of one person's session stays on a shared phone after they sign out.
 * (Anything already saved is on the server and is untouched.)
 */

import { PendingButton } from "@/components/pending-button";
import { clearTrainingStorage } from "@/components/training/active-session";

export function SignOutButton() {
  return (
    <PendingButton
      type="submit"
      variant="outline"
      pendingLabel="Signing out…"
      onClick={() => clearTrainingStorage()}
    >
      Sign out
    </PendingButton>
  );
}
