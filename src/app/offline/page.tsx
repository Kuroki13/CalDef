import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · CalDef" };

/**
 * The offline shell.
 *
 * Static by construction — it reads nothing, so the service worker can
 * precache it without storing anyone's figures. It exists so an installed
 * app opens into something honest when the network is gone, instead of the
 * browser's own error page inside a frameless window.
 *
 * It deliberately shows no data. A cached diary would be a stale diary, and
 * a stale calorie total presented as today's is worse than no total.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">You are offline</h1>
      <p className="text-muted-foreground text-sm">
        CalDef needs a connection to read your diary and to look up foods. Your
        data is on the server, not on this device, so nothing has been lost.
      </p>
      <p className="text-muted-foreground text-sm">
        This page is shown instead of a cached one on purpose: yesterday&rsquo;s
        totals displayed as today&rsquo;s would be worse than none.
      </p>
      <a
        href="/dashboard"
        className="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium"
      >
        Try again
      </a>
    </main>
  );
}
