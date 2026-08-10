# CalDef — Implementation Status

Living record of what actually exists. Update this at the end of every
phase, before compacting context, and whenever a claim in it stops being
true.

A feature belongs under DONE only if it was **tested and verified**, not
merely written. "It compiles" is not done.

Last updated: 2026-08-10

---

## Phase plan

| # | Phase | Status |
|---|-------|--------|
| 0 | Scaffold, docs, env, git | DONE |
| 1 | Database schema and RLS | DONE |
| 2 | Auth and app shell | IN PROGRESS |
| 3 | Nutrition and TDEE domain logic | TODO |
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

## IN PROGRESS

- Phase 2: Supabase Auth wiring (`@supabase/ssr` client/server/proxy),
  signup/login/logout, protected route group, profile onboarding, app
  shell.

## TODO

Phases 3–11 above. Requirement detail lives in `docs/PRODUCT_SPEC.md`
and is not restated here.

## KNOWN ISSUES

- None recorded.

## OPEN DECISIONS

- **Email confirmation on signup.** Supabase defaults to requiring it.
  For a single-user personal app it adds friction and the free built-in
  mailer is rate-limited. To be settled in Phase 2.

## BLOCKED / NEEDS ACCOUNT OWNER

- `GEMINI_API_KEY` — needed before Phase 9 (AI layer) can be verified
  against the live API. Phases 0–8 do not need it.
- `USDA_API_KEY` — needed before Phase 4 (food providers) can be
  verified against live USDA data. Open Food Facts needs no key.

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

No Vitest suite yet; unit tests begin in Phase 3. All Phase 1 test data
was torn down afterwards — the database holds only the 4 seeded
`meal_types` rows.
