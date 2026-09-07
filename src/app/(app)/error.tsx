"use client";

/**
 * Error boundary for the signed-in app.
 *
 * Renders inside `(app)/layout`, so the sidebar and the bottom tab bar
 * survive: one failing screen leaves the rest of the app navigable instead
 * of dropping the user onto a bare page with no way anywhere. The root
 * boundary stays as the backstop for anything above this.
 */

import { useEffect, useTransition } from "react";

import { PendingButton } from "@/components/pending-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function AppSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Retrying re-runs the server render that failed, which takes as long as
  // any other round trip — and on a sleeping free-tier database, longer.
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    console.error("Screen failed", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertTitle>This screen could not load</AlertTitle>
        <AlertDescription>
          Usually the database being briefly unreachable. Nothing you have
          logged is affected, and the rest of the app still works.
        </AlertDescription>
      </Alert>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-xs">
          Reference: {error.digest}
        </p>
      ) : null}
      <PendingButton
        onClick={() => startRetry(reset)}
        pending={retrying}
        pendingLabel="Trying again…"
      >
        Try again
      </PendingButton>
    </div>
  );
}
