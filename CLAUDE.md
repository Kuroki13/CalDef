# CalDef

Personal nutrition tracking app. Next.js + Supabase + Gemini.

## Start every session here

Before writing any code, in this order:

1. Read `docs/PRODUCT_SPEC.md` — the permanent source of truth for what
   this product is. If a requirement there conflicts with something said
   in conversation, the spec wins until it is explicitly amended.
2. Read `docs/IMPLEMENTATION_STATUS.md` — what is actually built,
   what is in progress, what is broken, and the last test results.
3. Read `docs/ARCHITECTURE.md` — layering, directory layout, and the
   invariants that must not be broken.

Then:

4. **Continue from the existing implementation. Do not rebuild.**
   This project is built incrementally across many sessions. Extend what
   is there, fix what is broken, and finish what is half-done. Never
   regenerate the codebase from scratch, never recreate files that
   already exist, and never replace working code because a fresh design
   seems cleaner.
5. **Run the tests before declaring anything complete.** A feature is
   done when it is implemented, tested and verified — not when it
   compiles. Run `npm run test`, `npm run typecheck`, `npm run lint`
   and, for anything user-facing, `npm run build`. Do not claim a
   feature works unless you observed it working.
6. **Keep the documentation synchronized with the implementation.**
   At the end of every phase — and before compacting context — update
   `docs/IMPLEMENTATION_STATUS.md` (DONE / IN PROGRESS / TODO / KNOWN
   ISSUES / TEST RESULTS). Update `docs/ARCHITECTURE.md` when structure
   or an invariant changes. Amend `docs/PRODUCT_SPEC.md` only on an
   explicit product decision by the account owner. Stale documentation
   is treated as a defect.
7. **Push to GitHub immediately after every commit.** Not in batches at
   the end of a session, not "once the phase is done" — every single
   commit, as soon as it is made. A commit that has not been pushed is
   not backed up, and a session can end without warning. `git push`
   is part of committing, not a separate chore.

Also true every session: this file's hard constraints below are binding
and are never relaxed to make a task easier. Extend this file; do not
overwrite or remove existing rules.

### Stop and ask before irreversible actions

There are no database backups on the Supabase free plan. Ask the account
owner first before: `DROP`, `TRUNCATE` or destructive `ALTER` on a table
containing data; deleting or force-pushing a branch; `git reset --hard`
over uncommitted work; deleting the Supabase project or a Vercel
project. Additive migrations need no confirmation.

Ask the owner only for things that genuinely require the account holder
— an OAuth authorization, or an external API secret. Everything else,
including normal development errors, is handled autonomously: read the
error, investigate, fix, rerun.

## Hard constraints

### Zero additional cost
Every service must stay on its free tier. Do not take an action that
requires a paid plan, and do not enable billing anywhere. If a task
cannot be done on a free tier, stop and say so instead of upgrading.

- **Supabase**: Free plan. 2 active projects per org, 500 MB Postgres
  per project, 1 GB file storage. Free projects pause after ~1 week of
  inactivity — this is expected, not a bug to fix by upgrading.
- **Vercel**: Hobby plan only. Personal, non-commercial use.
- **Gemini**: Free-tier Developer API key. No billing account attached.
- **USDA FoodData Central** and **Open Food Facts**: free.

### Supabase setup
There is ONE project: `CalDef` (org: Melo Org, free plan). All work
happens there for now.

**Do not use Supabase branching.** Preview/persistent branches are a
paid feature. The `PRODUCTION` label shown next to the `main` branch in
the dashboard is just how Supabase labels the default branch — it does
not mean branching is enabled, and it must not be treated as a reason
to create branches.

A second project, `CalDef-prod`, gets created only when the app is
ready for real users — it would occupy the second free project slot.
Until that exists, `CalDef` is the working database and there is no
production data to protect.

Once `CalDef-prod` does exist:
- Never point the Supabase MCP server at it (per Supabase's own
  guidance about production data).
- It receives only tested migrations.
- Never run destructive SQL against it without explicit confirmation.

Create schema via migrations, not by hand-editing tables in the
dashboard.

### Gemini data minimization
Free-tier Gemini content may be used by Google to improve its products.
Therefore only send food descriptions to Gemini. For example:

    250g grilled chicken breast
    150g cooked basmati rice
    1 tablespoon olive oil

Never send: names, email addresses, physical addresses, weight history,
account profiles, user IDs, or any other personal or identifying data.
Strip identifiers before any Gemini call, and keep that boundary
enforced in code (a single call site that accepts only food text).

### Secrets
Two external secrets initially:

    GEMINI_API_KEY
    USDA_API_KEY

Plus the Supabase keys. Keep them in `.env.local`. Ensure `.env*` is
gitignored before the first commit. Never commit a key, never print one
in logs, and never paste one into a file that gets pushed. The Supabase
service_role key must never reach client-side code.

**Never prefix a secret with `NEXT_PUBLIC_`.** In Next.js that prefix
inlines the value into the JavaScript bundle sent to every visitor's
browser, where it is trivially readable. `GEMINI_API_KEY`,
`USDA_API_KEY`, and the Supabase service_role key are server-only: read
them in route handlers, server actions, or server components, never in
client components. Gemini and USDA must be called from our own API
routes, never directly from the browser.

Two Supabase values are the deliberate exception, because they are
designed to be public and the browser client cannot work without them:

    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

Use the exact variable names shown in this project's Supabase "Connect"
dialog. This project uses the current key naming — a publishable key of
the form `sb_publishable_...` — not the older `anon` JWT key. Do not
rename these to match older tutorials.

The publishable key is safe to ship to the browser ONLY because
Row Level Security constrains it. Therefore RLS must be enabled on every
table, with explicit policies — an unprotected table plus a public anon
key means anyone can read or write it. Never use the service_role key
in the browser; it bypasses RLS entirely.

## Division of labor
Claude Code is the main developer for this project.

## Codex takeover — approved production plan (2026-09-06)

Codex continues the existing implementation through deployment. The owner's
approved separate production project is now `CalDef-prod`
(`ccllzuelnjikmdtpuyhj`); `CalDef` (`tcgtimmyakysjdgxugfp`) remains development
with the owner's account and history preserved. This supersedes the earlier
"ONE project / for now" state above. Both remain in Melo Org on Free.
Production receives committed, tested migrations through an authorized
migration connection, never Supabase MCP. Any future Supabase MCP connection
must be explicitly scoped to development. Production starts with reference
data only; audit fixtures must roll back or be removed by exact test identity.
Vercel remains Hobby; Gemini billing must not be enabled.
