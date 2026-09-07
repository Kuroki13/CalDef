"use client";

/**
 * Feedback for the other thing that hits the server: navigation.
 *
 * Every page in this app is server-rendered per request, so tapping a nav
 * item is a round trip, not a repaint. Without a signal it looks identical
 * to a tap that missed — the same complaint as a button that does not move,
 * and the same fix.
 *
 * `useLinkStatus` reports the enclosing `Link`'s own navigation, which is
 * why this is a separate component rather than a prop: it has to be rendered
 * *inside* the link it describes. Where a route is already prefetched the
 * pending window is close to zero and nothing flashes, which is right.
 */

import { useLinkStatus } from "next/link";

import { Spinner } from "@/components/pending-button";

export function LinkPending({
  children,
  spinnerClassName = "size-4",
}: {
  children: React.ReactNode;
  /** Sized to whatever it replaces, so nothing shifts when it appears. */
  spinnerClassName?: string;
}) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={spinnerClassName} /> : <>{children}</>;
}
