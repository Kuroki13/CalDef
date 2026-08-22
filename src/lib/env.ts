/**
 * Public environment. Safe to import from client components.
 *
 * Only the two Supabase values below may ever be public. They are read as
 * full `process.env.NEXT_PUBLIC_*` literals because Next.js inlines them at
 * build time by exact textual match — a dynamic lookup would silently
 * produce `undefined` in the browser.
 *
 * Server secrets live in `env.server.ts`, which cannot be imported from a
 * client component. See CLAUDE.md.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_PUBLISHABLE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
