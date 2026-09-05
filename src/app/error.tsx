"use client";

/**
 * The error boundary for everything under the root layout.
 *
 * Without this, any throw in a server component — and every module in
 * `src/lib` throws on a Supabase failure — renders Next's default error
 * page: unstyled, outside the app, with no way back. That is not a rare
 * path here. This project runs on Supabase's free plan, which pauses a
 * project after about a week of inactivity, so "the database did not
 * answer" is a normal Monday rather than an exceptional event.
 *
 * The message is deliberately generic. In production Next replaces a server
 * error's message with an opaque digest before it reaches the browser, so
 * there is nothing specific to show — and inventing a specific-sounding
 * explanation from a digest would be worse than admitting we do not know.
 */

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the server logs in production, where the digest is the only
    // way to tie a user's report to the actual stack.
    console.error("Unhandled error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-muted-foreground text-sm">
        This is usually the database being briefly unreachable — on the free
        plan it goes to sleep after a quiet week and takes a moment to wake.
        Nothing you have logged is affected.
      </p>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-xs">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" asChild>
          <a href="/dashboard">Go to dashboard</a>
        </Button>
      </div>
    </main>
  );
}
