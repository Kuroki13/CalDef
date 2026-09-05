"use client";

/**
 * Registers the service worker.
 *
 * A component rather than an inline script so it is subject to the same
 * lint, types and review as everything else. It renders nothing.
 *
 * Registration is deliberately late — after `load` — because the worker's
 * only job is the offline fallback, and competing with the first paint for
 * bandwidth to install it would make the common case worse to improve the
 * rare one.
 */

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    // Absent in older Safari and in any browser with storage blocked. The
    // app works identically without it; only the offline page is lost.
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration is not worth an error to the user: nothing
        // they can do, and nothing they lose but the offline page.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
