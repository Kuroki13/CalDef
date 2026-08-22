# CalDef — Implementation Status

Living record of what actually exists. Update this at the end of every
phase, before compacting context, and whenever a claim in it stops being
true.

A feature belongs under DONE only if it was **tested and verified**, not
merely written. "It compiles" is not done.

Last updated: 2026-08-22

---

## Phase plan

| # | Phase | Status |
|---|-------|--------|
| 0 | Scaffold, docs, env, git | DONE |
| 1 | Database schema and RLS | DONE |
| 2 | Auth and app shell | DONE |
| 3 | Nutrition and TDEE domain logic | IN PROGRESS |
| 4 | Food providers (USDA, OFF, cache) | TODO |
| 5 | Food logging and diary | TODO |
| 6 | Weight tracking and adaptive TDEE | TODO |
| 7 | 2-Month Cut phase mode | TODO |
| 8 | Recipes, saved meals, favorites, barcode | TODO |
| 9 | AI layer | TODO |
| 10 | PWA, rate limiting, security hardening | TODO |
| 11 | Acceptance pass and Vercel deploy | TODO |

---

## DONE

### Phase 0 — foundation

- Next.js 16.3.0 scaffold: TypeScript, Tailwind v4, ESLint, App Router,
  `src/` layout, `@/*` import alias. React 19.2.8.
- shadcn/ui initialised (radix base, nova preset) with 18 base
  components in `src/components/ui/`.
- Vitest 4 + Testing Library configured; `npm run test`,
  `npm run typecheck` scripts added.
- Supabase project confirmed: `CalDef` (`tcgtimmyakysjdgxugfp`), org
  `Melo Org`, **free plan**, Postgres 17.6, eu-west-1, ACTIVE_HEALTHY.
- `.env.local` written with the real Supabase URL and publishable key;
  `.env.example` carries names only. `.gitignore` ignores every `.env*`
  with a single `!.env.example` exception — both directions verified
  with `git check-ignore` before the first commit.
- Private GitHub repo `Kuroki13/CalDef`, pushed.
- `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, this file. CLAUDE.md
  extended with session-startup rules.

### Phase 1 — database

- 20 tables created through `supabase/migrations/` only (6 migrations,
  `20260810000001` … `20260810000006`). Nothing was created by hand in
  the dashboard.
- Every table has: primary key, foreign keys with deliberate
  `on delete` behaviour, indexes on all FK and lookup columns,
  `created_at`/`updated_at` with a `set_updated_at` trigger, and RLS
  enabled with exactly 4 policies (select/insert/update/delete).
- `auth.uid()` is wrapped in a scalar subquery in every policy, so it is
  evaluated once per statement rather than once per row.
- `handle_new_user` trigger creates a `profiles` row on signup —
  verified firing for both test users.
- 12 enum types; `pg_trgm` enabled with a GIN index on a generated
  `foods.search_text` column for local cache search.
- Structural safety guard: `daily_targets.calories` has a
  `check (calories between 800 and 10000)`, so no code path can persist
  a starvation-level target.
- `revoke all on all tables in schema public from anon`.

### Phase 2 — auth and app shell

Written in the session of 2026-08-10, verified and committed 2026-08-22.

- `@supabase/ssr` wiring: `src/lib/supabase/client.ts` (browser),
  `server.ts` (server components, actions, route handlers) and
  `proxy.ts` (session refresh). Only the publishable key is ever used —
  the service_role key appears nowhere in the codebase.
- Server-side identity comes from `getClaims()`, which verifies the JWT
  signature. `getSession()` is never trusted in server code.
- `src/proxy.ts` — Next.js 16 renamed `middleware` to `proxy`. Refreshes
  the session and performs the optimistic signed-out redirect. Treated
  as a convenience check, not the authorization boundary: `(app)/layout`
  re-verifies the user, and RLS is the real enforcement.
- Route groups: `(auth)` for login/signup, `(app)` for the authenticated
  shell. `/onboarding` sits outside both because it runs before setup is
  complete.
- Signup / login / logout as server actions with zod validation. The
  `next` redirect parameter is constrained to same-origin paths, so it
  cannot become an open redirect.
- `/auth/confirm` route handler exchanges the emailed OTP for a session.
- Onboarding collects profile, goal and first weigh-in in one form,
  writing `profiles`, `goals` and `weight_entries`. Settings edits the
  same data and carries the AI kill switch (`profiles.ai_enabled`).
- Dashboard renders real profile/goal/weight data — no placeholder
  figures. Responsive shell: sidebar from `md`, bottom tab bar below.
- `src/lib/env.ts` (public) and `src/lib/env.server.ts` (guarded by
  `server-only`, so a client import fails the build). Missing API keys
  disable their feature rather than crashing, per ARCHITECTURE
  invariant 3.
- Supporting domain helpers, both pure and unit-tested:
  `src/lib/units.ts` (kg/cm storage, lb/in display) and
  `src/lib/dates.ts` (calendar days resolved against the profile's
  timezone, `YYYY-MM-DD` strings to avoid Date drift).
- Navigation is grown one phase at a time — `src/lib/nav.ts` lists only
  routes that render something real, so there are no dead links.

## IN PROGRESS

- Phase 3: nutrition and TDEE domain logic. `src/lib/nutrition/**` and
  `src/lib/tdee/**` do not exist yet. The `units.ts` and `dates.ts`
  helpers above landed early as Phase 2 support; portion units
  (g / ml / serving) are a separate module still to be written.

## TODO

Phases 4–11 above. Requirement detail lives in `docs/PRODUCT_SPEC.md`
and is not restated here.

## KNOWN ISSUES

- **Leaked-password protection is disabled** (Supabase security advisor,
  WARN). Supabase Auth can check new passwords against
  HaveIBeenPwned. Dashboard toggle, no cost. Not yet enabled.
- **A dev test user is still in the database**:
  `caldef.dev.tester@gmail.com`, created 2026-08-10, email confirmed. It
  has a `profiles` row but no `goals` or `weight_entries`, so it has
  never completed onboarding. Retained deliberately as a login fixture;
  delete it before any real use. The 2026-08-10 note claiming the
  database held "only the 4 seeded `meal_types` rows" was already stale
  when written — this user was created shortly afterwards.
- **Signup-to-session has not been exercised end to end.** Signup,
  the confirmation email and `/auth/confirm` all demonstrably worked on
  2026-08-10 (that is how the test user got confirmed), but no
  password login has ever succeeded — `auth.users.last_sign_in_at` is
  still null. Verify once email confirmation is switched off.

## DECISIONS

- **Email confirmation on signup: DISABLED.** Settled 2026-08-22 by the
  account owner. This is a single-user personal app; the free built-in
  mailer is rate-limited to a handful of messages per hour, and
  confirmation adds friction with no real benefit at this scale.
  - Current state: still **ON** in the project. Verified from
    `auth.users` — the existing test user has a `confirmation_sent_at`
    and was confirmed 21 seconds later by a real email click.
  - Enacting it needs one dashboard toggle by the account owner:
    Authentication → Sign In / Providers → Email → **Confirm email**
    off. The Supabase MCP server exposes no auth-configuration tool, so
    this cannot be done from code.
  - No code change is required. `signUp` already branches on whether a
    session comes back, so it works under either setting, and
    `/auth/confirm` stays in place for password-reset links later.

## BLOCKED / NEEDS ACCOUNT OWNER

- **Disable email confirmation** — the dashboard toggle described above.
  Until it is flipped, a new signup lands on "check your email" instead
  of going straight to onboarding.
- `GEMINI_API_KEY` — **RESOLVED 2026-08-22.** Present in `.env.local`
  and verified against the live API (HTTP 200, 50 models listed).
- `USDA_API_KEY` — **RESOLVED 2026-08-22.** Present in `.env.local` and
  verified against the live API (HTTP 200, search returns results).

## TEST RESULTS

| Date | Command / suite | Result |
|------|-----------------|--------|
| 2026-08-10 | `npm run typecheck` | PASS |
| 2026-08-10 | `npm run build` (post-scaffold) | PASS — 2 static routes |
| 2026-08-10 | Supabase security advisors | PASS — 0 findings |
| 2026-08-10 | Supabase performance advisors | 30 INFO `unused_index` only; expected with no traffic yet |
| 2026-08-10 | `supabase/tests/rls_isolation.sql` §1 read isolation | PASS — all 20 tables matched expected visibility |
| 2026-08-10 | `supabase/tests/rls_isolation.sql` §2 write isolation | PASS — 0 cross-user rows updated or deleted; own profile update = 1 |
| 2026-08-10 | `supabase/tests/rls_isolation.sql` §3 forged ownership | PASS — inserts claiming another user rejected |
| 2026-08-10 | `supabase/tests/rls_isolation.sql` §4 anon access | PASS — anon denied on every probed table |
| 2026-08-10 | `handle_new_user` trigger | PASS — profile auto-created for both test users |
| 2026-08-22 | `npm run test` | PASS — 18 tests, 2 files (`units`, `dates`) |
| 2026-08-22 | `npm run typecheck` | PASS |
| 2026-08-22 | `npm run lint` | PASS — 0 problems |
| 2026-08-22 | `npm run build` | PASS — 8 routes, proxy compiled |
| 2026-08-22 | Auth routing probe (dev server) | PASS — `/`, `/dashboard`, `/settings`, `/onboarding` all 307 to `/login` with `next` preserved; `/login` and `/signup` 200 |
| 2026-08-22 | Secret leakage probe on `/login` HTML | PASS — no `service_role` string in the served page |
| 2026-08-22 | Supabase security advisors | 1 WARN — `auth_leaked_password_protection` (see KNOWN ISSUES). No RLS findings. |
| 2026-08-22 | Live schema vs. migrations | PASS — 20 tables, RLS on 20/20, 80 policies (4 per table), 6 migrations applied |

Phase 1 test data was torn down, but a later Phase 2 test user remains —
see KNOWN ISSUES. The database otherwise holds only the 4 seeded
`meal_types` rows.
