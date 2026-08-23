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
| 3 | Nutrition and TDEE domain logic | DONE |
| 4 | Food providers (USDA, OFF, cache) | IN PROGRESS |
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

### Phase 3 — nutrition and TDEE domain logic

Pure functions, no I/O, 130 unit tests. This is the layer the spec's
worked examples are encoded against.

`src/lib/nutrition/`

- `units.ts` — portion units (g / ml / serving) to grams. A serving
  amount with no serving attached throws rather than guessing; inventing
  a weight here would put a fabricated number in the diary. `ml` falls
  back to 1 g/ml, and a food's own `food_servings` row always wins over
  that fallback.
- `macros.ts` — every calorie figure in the app is produced here, by
  scaling a per-100 g `food_nutrients` row to a gram weight. Also macro
  targets (protein fixed from bodyweight first, fat floored at 20% of
  calories, carbohydrate taking the remainder) and a plausibility check
  that flags rows whose stated calories contradict their macros, which
  community-contributed data frequently does.
- `totals.ts` — diary aggregation. Sums stored values and never
  recomputes them from a food, so a later provider revision cannot
  silently rewrite yesterday's diary. `meanDailyIntake` divides by
  elapsed days rather than logged days: dividing by logged days would
  inflate apparent intake and corrupt the expenditure estimate.

`src/lib/tdee/`

- `constants.ts` — `KCAL_PER_KG = 7700`, the rate bands, the recommended
  band (0.75–1.0% of bodyweight/week) and both calorie floors, in one
  place per ARCHITECTURE §6.
- `bmr.ts` — Mifflin-St Jeor plus activity multipliers. A seed only.
  `sex: other` takes the mean of the two constants rather than defaulting
  to either.
- `trend.ts` — EWMA smoothing, alpha 0.1 (~19-day centre of mass). Gaps
  hold the previous value rather than interpolating, because
  interpolation would invent readings. Verified to barely move for a
  single 2 kg anomalous weigh-in.
- `adaptive.ts` — the expenditure estimate,
  `intake + (trend_change × 7700) / days`. The arithmetic is trivial; the
  substance is the refusal to publish. Gated on 14 days, 8 weigh-ins and
  10 logged days; blended toward the prior at 0–40% by confidence;
  damped a further 70% inside a phase's first fortnight (spec 8.9); and
  rejected outright if the observation falls outside 800–10000 kcal.
  A low-confidence estimate is shown but cannot move a target.
- `feasibility.ts` — the two-function split ARCHITECTURE §7 requires.
  `assessTarget` reports what a target demands, however unflattering.
  `recommendPlan` decides what the app will actually recommend, and
  cannot return a rate above the band or a figure below the floor.
  Calorie targets round **up**, never down, so rounding can never push
  the resulting rate past the top of the band.
- `milestones.ts` — the weekly roadmap, generated from a bodyweight-
  relative rate rather than a flat subtraction, with the stretch path
  produced separately and never feeding a calorie target.

Both of spec 8.2's worked examples are pinned by tests:

| Target | Required | Classification | App recommends |
|--------|----------|----------------|----------------|
| 111.8 → 99 kg / 56 d | 1.6 kg/wk, ~1760 kcal deficit, ~1597 kcal intake | Very aggressive | ~2128 kcal, projecting ~103 kg |
| 111.8 → 90 kg / 56 d | 2.7 kg/wk, ~2998 kcal deficit, ~359 kcal intake | Not realistic for the timeframe | 90 kg stays the long-term goal |

The milestone generator reproduces the spec's illustrative roadmap
(111.8 · 110.7 · 109.6 · 108.5 · 107.4 · 106.3 · 105.2 · 104.1 · 103)
and the ~103–105 kg recommended end-of-phase range, both of which fall
out of the 0.75–1.0%/week band rather than being hardcoded.

## IN PROGRESS

### Phase 4 — food providers

Written and unit-tested (42 tests); **not yet verified end to end**,
because nothing calls the cache yet. The API routes that exercise it are
Phase 5.

- `types.ts` — the neutral `Food` / `FoodServing` / `ProviderResult`
  shapes. No provider payload escapes `src/lib/food`.
- `provider.ts` — the `FoodProvider` port, a `fetch` wrapper with a 6 s
  timeout and the descriptive User-Agent Open Food Facts asks for, and
  `safeProviderCall`, which turns a failure into a value. Error text is
  sanitised in one place because a USDA request URL contains the API key.
- `usda.ts` — search only, restricted to Foundation / SR Legacy /
  Survey, which is what "generic whole food" means. Nutrients are matched
  on stable numeric ids rather than names. A row missing energy has it
  derived from its macros; a row with neither is dropped rather than
  logged as zero. Only Foundation and SR Legacy are marked verified.
- `off.ts` — v3 for barcode lookup as the spec directs, v2 for search
  because v3 has no search endpoint. Nothing from here is ever marked
  verified. Sodium is converted from g to mg. A product with no energy
  value, or a serving whose gram weight will not parse, is skipped rather
  than guessed.
- `cache.ts` — reads and writes `foods` / `food_servings` /
  `food_nutrients`.
- `registry.ts` — concurrent fan-out across cache, USDA and OFF, with
  per-source success reported so the UI can say a result set is
  incomplete. Deduplicates within a source but deliberately not across
  sources, since the same food from two providers has two provenances.

Remaining before this phase is DONE:

- Exercise `cacheFood` / `searchCache` against the real database with an
  authenticated session. Nothing calls them yet, so the RLS interaction
  is reasoned about but unproven.
- Re-run `npm run test:live` when USDA and OFF search recover (see KNOWN
  ISSUES) to confirm the mappings against live payloads.

## TODO

Phases 5–11 above. Requirement detail lives in `docs/PRODUCT_SPEC.md`
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
- **The food cache cannot refresh a provider food.** Shared cache rows
  carry `user_id IS NULL`, and `foods_update_own` reads
  `auth.uid() = user_id`, which is never true for a null owner — so no
  authenticated user may update a shared row. `cacheFood` is therefore
  insert-only and reuses an existing food as-is. This was caught by
  reading the policies, not by a test: a plain `update` would have
  reported success having matched zero rows, and the `upsert` it replaced
  would have raised an RLS violation the first time a food was
  re-resolved. Refreshing stale provider data would need either a
  deliberate policy change (which grants every authenticated user write
  access to shared nutrition data — a real multi-tenant hole) or an
  owner-scoped copy of the row. Deferred as a product decision; provider
  nutrient data for a given `source_id` is stable enough that this is not
  urgent.
- **Both food providers are intermittently unreliable.** Resolved as far
  as this codebase can, on 2026-08-23; recorded because the flakiness is
  a permanent property of these APIs, not a one-off.
  - USDA answers 404 to a meaningful share of perfectly valid search
    requests — identical repeat calls were observed returning 200 and
    404 alternately, while rate-limit headers stayed healthy
    (3597/3600). It is a lying status from an unwell backend, so
    `usda.ts` treats 404 as retryable, which it would not normally be.
  - USDA answers **400** whenever `Survey (FNDDS)` is sent as a
    `dataType`; the parenthesised value does not survive the round trip.
    That dataset is dropped. Its values are modelled from Foundation and
    SR Legacy rather than measured, so nothing is lost.
  - Open Food Facts' search backend answers 503 under load while its v3
    product endpoint stays healthy. Both now retry.
  - After these fixes `npm run test:live` passes, though roughly one run
    in four still fails on an upstream blip. A failing live run is not by
    itself evidence of a defect here — check the reported status code.
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
| 2026-08-22 | `npm run test` (Phase 2) | PASS — 18 tests, 2 files (`units`, `dates`) |
| 2026-08-22 | `npm run test` (Phase 3) | PASS — 148 tests, 10 files |
| 2026-08-22 | Spec 8.2 worked examples | PASS — both encoded as tests; 99 kg classified very aggressive, 90 kg not realistic |
| 2026-08-22 | Spec 8.5 milestone roadmap | PASS — generated path matches 111.8 → ~103 kg to within 0.1 kg |
| 2026-08-22 | `npm run typecheck` | PASS |
| 2026-08-22 | `npm run lint` | PASS — 0 problems |
| 2026-08-22 | `npm run build` | PASS — 8 routes, proxy compiled |
| 2026-08-22 | Auth routing probe (dev server) | PASS — `/`, `/dashboard`, `/settings`, `/onboarding` all 307 to `/login` with `next` preserved; `/login` and `/signup` 200 |
| 2026-08-22 | Secret leakage probe on `/login` HTML | PASS — no `service_role` string in the served page |
| 2026-08-22 | Supabase security advisors | 1 WARN — `auth_leaked_password_protection` (see KNOWN ISSUES). No RLS findings. |
| 2026-08-22 | Live schema vs. migrations | PASS — 20 tables, RLS on 20/20, 80 policies (4 per table), 6 migrations applied |
| 2026-08-22 | `npm run test` (Phase 4) | PASS — 190 tests, 13 files |
| 2026-08-22 | `npm run test:live` — OFF barcode (v3) | PASS — real product resolved and mapped; unknown barcode returns null |
| 2026-08-22 | USDA + OFF payload shapes | PASS — both confirmed by hand against live responses |
| 2026-08-23 | `npm run test` | PASS — 200 tests, 14 files |
| 2026-08-23 | `npm run test:live` (after retry + Survey fix) | PASS — 5/5 on 3 of 4 consecutive runs; the fourth hit an upstream blip |
| 2026-08-23 | `npm run typecheck` / `lint` / `build` | PASS |
| 2026-08-23 | Supabase security advisors | 1 WARN — `auth_leaked_password_protection` only. No RLS findings. |
| 2026-08-23 | Email-confirmation setting | Verified still **ON** by signup probe; probe user deleted afterwards |
| 2026-08-23 | Food cache round trip | NOT RUN — nothing calls it until Phase 5 |

Phase 1 test data was torn down, but a later Phase 2 test user remains —
see KNOWN ISSUES. The database otherwise holds only the 4 seeded
`meal_types` rows.
