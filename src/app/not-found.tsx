import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found · CalDef" };

/**
 * Shown for a URL that matches no route.
 *
 * Static, and reachable signed out, so it does not depend on a session to
 * render — a 404 that redirects to the login page tells the user the wrong
 * thing about what went wrong.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground text-sm">
        That address does not exist in CalDef.
      </p>
      <Button asChild className="self-start">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </main>
  );
}
