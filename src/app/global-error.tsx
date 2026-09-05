"use client";

/**
 * The last resort: an error thrown by the root layout itself.
 *
 * `error.tsx` renders inside the layout, so it cannot catch a failure in the
 * layout. This one replaces the whole document, which is why it carries its
 * own `<html>` and `<body>` and why it uses inline styles — the stylesheet
 * is loaded by the layout that just failed.
 *
 * The realistic trigger is a missing `NEXT_PUBLIC_SUPABASE_*` variable,
 * which `lib/env.ts` throws on by design rather than limping along with an
 * undefined key.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#18181b",
          color: "#fafafa",
        }}
      >
        <main style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>
            CalDef could not start
          </h1>
          <p style={{ opacity: 0.8, lineHeight: 1.6, margin: "0 0 1rem" }}>
            Something failed before the app could render. Reloading is worth a
            try; if it persists, the deployment is misconfigured rather than
            your data being lost.
          </p>
          {error.digest ? (
            <p style={{ opacity: 0.6, fontSize: "0.8rem", fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #52525b",
              background: "#fafafa",
              color: "#18181b",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
