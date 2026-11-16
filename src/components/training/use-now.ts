"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The current time, re-read on an interval and whenever the app comes back
 * to the foreground.
 *
 * The interval only decides how often the screen repaints. Every duration
 * shown is `now` minus a stored timestamp (`lib/training/timer.ts`), so a
 * phone that was locked for ten minutes shows the right figure on the first
 * repaint after it wakes — nothing was being counted while it slept.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);

  return now;
}

const noop = () => () => {};

/** False on the server and during hydration, true in the browser after. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
