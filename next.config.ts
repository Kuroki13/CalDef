import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * The threat this app actually has is a compromised dependency or an
 * injected script exfiltrating a diary or a session, so the policy is built
 * around *where bytes may go* rather than around framing tricks: `connect-src`
 * is the load-bearing line.
 *
 * `script-src` carries `'unsafe-inline'`, which is an honest weakness. Next's
 * App Router inlines its bootstrap and the RSC payload in `<script>` tags,
 * and removing the allowance needs a per-request nonce threaded through the
 * proxy — which is the same function that refreshes the Supabase session,
 * where the SDK is explicit that nothing may run between creating the client
 * and reading the claims. That is a change worth making deliberately, not as
 * a side effect of adding headers. Everything else is locked to `'self'`, so
 * an injected script still cannot load a remote payload or send anything to
 * another origin.
 */

const supabaseOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // `data:` for the inlined fonts Next emits; `blob:` for the barcode
  // scanner's camera frames.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The only place the browser is allowed to send data. Supabase is named
  // because the browser client talks to it directly; Gemini and USDA are
  // absent on purpose, since those are server-only and a browser request to
  // them would mean a key had leaked.
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}`.trim(),
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Redundant with `frame-ancestors` for modern browsers, kept for old ones.
  { key: "X-Frame-Options", value: "DENY" },
  {
    // The barcode scanner needs the camera; nothing here needs anything else.
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    // Only meaningful over HTTPS, which is what Vercel serves. Harmless on
    // plain HTTP, where browsers ignore it.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Must not be cached by the CDN or the browser, or a stale worker
        // outlives its deploy and keeps serving an old shell.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
