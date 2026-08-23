# CalDef — Implementation Status

Living record of what actually exists. Update this at the end of every
phase, before compacting context, and whenever a claim in it stops being
true.

A feature belongs under DONE only if it was **tested and verified**, not
merely written. "It compiles" is not done.

Last updated: 2026-08-23

---

## Phase plan

| # | Phase | Status |
|---|-------|--------|
| 0 | Scaffold, docs, env, git | DONE |
| 1 | Database schema and RLS | DONE |
| 2 | Auth and app shell | DONE |
| 3 | Nutrition and TDEE domain logic | DONE |
| 4 | Food providers (USDA, OFF, cache) | DONE |
| 5 | Food logging and diary | DONE |
| 6 | Weight tracking and adaptive TDEE | DONE |
| 7 | 2-Month Cut phase mode | DONE |
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

### Phase 4 — food providers

Verified end to end against the live APIs and the real database on
2026-08-23.

- `types.ts` — the neutral `Food` / `FoodServing` / `ProviderResult`
  shapes. No provider payload escapes `src/lib/food`.
- `provider.ts` — the `FoodProvider` port, a `fetch` wrapper with a 6 s
  timeout and the descriptive User-Agent Open Food Facts asks for, and
  `safeProviderCall`, which turns a failure into a value. Error text is
  sanitised in one place because a USDA request URL contains the API key.
- `usda.ts` — search only, restricted to Foundation and SR Legacy, which
  is what "generic whole food" means. Nutrients are matched on stable
  numeric ids rather than names. A row missing energy has it derived from
  its macros; a row with neither is dropped rather than logged as zero.
  Only Foundation and SR Legacy are marked verified.
- `off.ts` — v3 for barcode lookup as the spec directs, v2 for search
  because v3 has no search endpoint. Nothing from here is ever marked
  verified. Sodium is converted from g to mg. A product with no energy
  value, or a serving whose gram weight will not parse, is skipped rather
  than guessed.
- `cache.ts` — reads and writes `foods` / `food_servings` /
  `food_nutrients`. Cache search matches each whitespace/comma-separated
  term independently rather than the whole query as one substring:
  provider names are punctuated in ways nobody types ("Chicken, breast,
  boneless, skinless, raw"), so a single-substring match missed the cache
  on essentially every multi-word query and sent us back to the provider
  for a food we already held.
- `registry.ts` — concurrent fan-out across cache, USDA and OFF, with
  per-source success reported so the UI can say a result set is
  incomplete. Deduplicates within a source but deliberately not across
  sources, since the same food from two providers has two provenances.

### Phase 5 — food logging and diary

Verified end to end against the production build with a real signed-in
session on 2026-08-23.

- `rate-limit.ts` — fixed-window counter keyed on the user id. Honest
  limitation documented in the module: serverless instances do not share
  memory, so the effective limit is per-instance. That is enough to stop
  a runaway client burning the USDA quota, which is the actual risk; it
  is not a defence against a distributed attacker and is not described
  as one. A real limiter needs shared state, which needs a paid add-on.
- `api/foods/search` and `api/foods/barcode` — authenticate, then rate
  limit, then validate, in that order. Limiting before authenticating
  would let an anonymous caller spend another user's budget. The barcode
  route's input regex matches the `foods.barcode` check constraint
  exactly, so anything it accepts the database will accept too.
- `lib/diary.ts` — day reads, joined to the food that produced each
  entry. Queries rely on RLS for scoping rather than adding a `user_id`
  filter, so a forgotten filter returns nothing rather than another
  user's rows.
- `lib/targets.ts` — computes a daily target once and stores it. Past
  days are never back-filled: the target you were working to is part of
  the record, and recomputing it later would rewrite history and make
  adherence figures meaningless.
- `tdee/daily-target.ts` — the everyday target for a goal with no end
  date, floored the same way the phase engine is. Lands at ~2130 kcal and
  179 g protein for the spec's starting subject.
- `diary/actions.ts` — the convergence point from ARCHITECTURE §4. The
  client posts the chosen food, but its nutrient values are used only to
  seed the cache; the entry's own macros are then computed from the row
  the database actually holds, so a tampered payload cannot inflate an
  entry.
- Diary UI: day navigation, per-meal grouping, totals against target,
  inline amount editing and removal. Source badges distinguish USDA
  verified from community-contributed data, as the spec requires.

Not in this phase, by design: barcode scanning has no camera UI yet. The
route exists and is tested, but nothing calls it — that is Phase 8.

### Phase 6 — weight tracking and adaptive TDEE

Verified end to end on 2026-08-23 against a 28-day fixture.

- `lib/weight.ts` — weigh-in reads plus the smoothed series. Raw entries
  exist so the user can see and correct what they typed; every decision
  reads the trend.
- `lib/expenditure.ts` — gathers the inputs for `tdee/adaptive.ts`,
  applies it, and persists to `tdee_estimates`. The BMR baseline uses the
  **trend** weight, not the last reading, so one heavy morning cannot
  move the estimate. Recomputed at most once a day, enforced by the
  table's `(user_id, computed_for)` unique constraint rather than by a
  flag in application code.
- `lib/checkin.ts` — `isAdjustmentDue` plus the `weekly_checkins` record.
- `targets.ts` — now switches to the adaptive estimate once it is
  publishable, and **carries the current target forward on every day
  inside the week**. See the invariant note below.
- `components/trend-chart.tsx` — dependency-free inline SVG. Two series
  over a date axis does not need a chart engine, and server-rendered SVG
  works without JavaScript. The raw readings are drawn faintly and the
  trend boldly, so the chart shows which one decisions use.
- Weight page: trend, rate, weigh-in form, expenditure card and history.
  Weigh-ins upsert on `(user_id, entry_date)` — re-weighing corrects the
  day rather than adding a second reading that would weight it twice.

Two invariant violations were found by verifying rather than assuming,
and both are fixed:

- **The daily target was computed from a raw scale reading.** The deficit
  and the protein floor are bodyweight-derived, which makes them
  decisions, and ARCHITECTURE §6 says decisions never read raw values.
  They now use the smoothed trend, exactly as the expenditure baseline
  already did.
- **Targets adjusted daily, not weekly.** `getOrCreateDailyTarget`
  recomputed from the current expenditure whenever a new day had no
  stored row, so the number drifted with every weigh-in — the precise
  reactivity that the smoothing and the weekly cadence exist to prevent.
  It now carries the previous target forward untouched until seven days
  have passed, which is what makes the schema's claim that targets change
  only at a check-in actually true.

### Phase 7 — 2-Month Cut mode

Built as six commits, each tested and verified live before the next.

- **§8.1–8.3, 8.5 — planning** (`tdee/phase-plan.ts`, `lib/phase.ts`).
  `planPhase` reproduces the spec's figures as consequences rather than
  constants: a 102.9–105.1 kg recommended range and the roadmap
  111.8 / 110.7 / … / 103 fall out of the 0.75–1.0%/week band. The
  stretch target is the *ask* and never the prescription — the 99 kg line
  implies ~1597 kcal and never becomes the calorie figure.
  `phaseCoversDate` treats `end_date` as exclusive, so paging back to an
  earlier diary day cannot pull a phase target onto a day it did not
  govern.
- **Target precedence.** Exactly one target is in force. An active phase
  owns it; the everyday target resumes when no phase covers the day. The
  UI names which is which ("2-Month Cut target" / "Daily target").
  - The weekly cadence gate sits **above** the phase branch, so a phase
    cannot recompute daily. Verified: a phase target dated six days
    earlier held at 2222 kcal instead of recomputing.
  - A change of régime is an event, not drift, so it applies at once —
    starting a phase does not wait a week to matter, and an ended phase
    stops governing immediately. The diary states why the number moved
    rather than changing it silently.
- **§8.4, 8.6 — dashboard and start flow** (`lib/phase-dashboard.ts`,
  `/phase`). Keeps 8.1's four concepts visibly separate — recommended
  range, projection, stretch, final goal. The projection sentence states
  the gap factually and never characterises the user; when the trend is
  flat or rising it says so instead of projecting.
- **§8.7 — progress graph** (`components/phase-chart.tsx`,
  `tdee/phase-series.ts`). Four series plus a final-goal marker, inline
  SVG, no charting dependency. The visual hierarchy carries the meaning:
  trend heaviest, recommended lighter, stretch dashed, weigh-ins faint.
  Neither actual nor trend is drawn into the future — a projection in the
  same ink as a measurement is a lie about what is known. The goal marker
  is dropped when including it would stretch the axis far enough to
  squash the real data into a sliver.
- **§8.8 — adaptive calories inside a phase.** Each weekly adjustment
  re-runs the guardrail against today's trend weight and expenditure.
- **§8.9 — early-phase damping.** The rule existed in `adaptive.ts` from
  Phase 3 but was inert: `expenditure.ts` never passed `phaseDayIndex`.
  Now wired — day 1 of a phase moves the estimate to 3211 kcal where the
  undamped path gave 3109. `refreshMilestoneActuals` was dormant in the
  same way and is now called when a weigh-in is recorded.
- **§8.10 — checkpoints and reports** (`tdee/checkpoints.ts`). Days 1, 7,
  14, 28, 42, 56, with a report at the latest reached and a Phase 2
  proposal once a phase ends. The proposal takes an adaptive timeframe
  rather than another automatic eight weeks, and is offered only after a
  phase finishes — proposing it midway would invite abandoning a phase
  before its data means anything.

Two deliberate departures worth knowing about:

- The spec asks for an **AI-written** explanation in the halfway and
  final reports. The text is deterministic instead, because
  ARCHITECTURE invariant 3 requires the app to work with the AI off — a
  report that only exists when Gemini answers is not a report. Phase 9
  may enrich it; it may not become a precondition for having one.
- **Reports average intake over logged days; the expenditure model
  averages over elapsed days.** They answer different questions and now
  sit side by side with a note on why. Caught in verification: a report
  was telling someone who logged 20 days of a 56-day phase that they had
  averaged 715 kcal a day.

## TODO

Phases 8–11 above. Requirement detail lives in `docs/PRODUCT_SPEC.md`
and is not restated here.

## KNOWN ISSUES

- **Leaked-password protection is disabled** (Supabase security advisor,
  WARN). Supabase Auth can check new passwords against
  HaveIBeenPwned. Dashboard toggle, no cost. Not yet enabled.
- **There is now a real account in the database.**
  `orfalim260@gmail.com`, created 2026-08-23 14:49 UTC — the account
  owner signed up while Phase 7 was being built. It is *not* test data
  and must never be included in a teardown. Every automated cleanup from
  here on must target test accounts by their `caldef.<slug>.` email
  prefix rather than deleting broadly.
- **Browsing the diary forward used to persist a target for every future
  date visited.** Found because that real account had five
  `daily_targets` rows from a single weigh-in. Paging ahead froze a
  number computed from today's weight and expenditure onto a date weeks
  away, which then read back stale when it arrived. Fixed: only *today*
  is written; past and future dates are computed and shown, never
  stored. The five rows already written for that account remain — they
  are harmless, but any dated later than the day they were created will
  read as stale rather than recomputing.
- **A dev test user is still in the database**:
  `caldef.dev.tester@gmail.com`, created 2026-08-10, email confirmed. It
  has a `profiles` row but no `goals` or `weight_entries`, so it has
  never completed onboarding. Retained deliberately as a login fixture;
  delete it before any real use. The 2026-08-10 note claiming the
  database held "only the 4 seeded `meal_types` rows" was already stale
  when written — this user was created shortly afterwards.
- **The onboarding form does not work without JavaScript.** `timezone` is
  a hidden input populated on the client from
  `Intl.DateTimeFormat().resolvedOptions()`, so a no-JS submission sends
  it empty and fails validation. Noticed while driving the form through
  its progressive-enhancement path during end-to-end testing. Harmless
  for a PWA whose whole point is a JS runtime, but it means the
  no-JS fallback React renders for free is not actually functional here.
  Fix by defaulting to UTC server-side when the field is empty.
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
- **The food cache never expires.** Nothing re-fetches a cached food, and
  per the entry above nothing can update one either. Combined, a food
  cached today is the food the app uses forever. Acceptable for now;
  worth revisiting alongside the refresh question.

## DECISIONS

- **Email confirmation on signup: DISABLED.** Settled 2026-08-22 by the
  account owner, enacted in the dashboard and **confirmed live on
  2026-08-23**: a signup now returns a session immediately and the user
  arrives already confirmed. This is a single-user personal app; the
  free built-in mailer is rate-limited to a handful of messages per
  hour, and confirmation added friction with no real benefit at this
  scale.
  - No code change was needed. `signUp` branches on whether a session
    comes back, so it works under either setting, and `/auth/confirm`
    stays in place for password-reset links later.

## BLOCKED / NEEDS ACCOUNT OWNER

Nothing currently blocked.

- **Email confirmation** — **RESOLVED 2026-08-23.** Toggle flipped; the
  full signed-in path is now verified (see TEST RESULTS).
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
| 2026-08-23 | `npm run test` (Phase 5) | PASS — 242 tests, 18 files |
| 2026-08-23 | API routes, unauthenticated (dev server) | PASS — `/api/foods/search` and `/api/foods/barcode` return JSON 401; page routes still 307 to `/login` |
| 2026-08-23 | Route handlers with a stubbed session | PASS — 20 tests covering auth, validation, rate limiting, degradation and error sanitisation |
| 2026-08-23 | `npm run test` (Phase 5 complete) | PASS — 252 tests, 19 files |

### End-to-end run, 2026-08-23 (production build, real Supabase session)

Driven against `next start` with a genuine `@supabase/ssr` session
cookie, exercising the real server actions rather than mocks.

| Step | Result |
|------|--------|
| Signup returns a session | PASS — user auto-confirmed, confirmation is off |
| `handle_new_user` trigger | PASS — `profiles` row created automatically |
| Routing while signed in | PASS — `/`→`/dashboard`, `/login`→`/dashboard`, `/dashboard`→`/onboarding` while setup is incomplete |
| Onboarding server action | PASS — 303 to `/dashboard`; `profiles`, `goals` and `weight_entries` all written correctly under RLS |
| Dashboard render | PASS — 111.8 kg current, 90.0 kg goal, 21.8 kg to go, age 31 from birth date |
| Daily target created | PASS — 2063 kcal, 179 g protein, basis TDEE 3292.7 (BMR 2124.25 × 1.55 moderate, minus a 1.118 kg/week deficit) |
| Food search, authenticated | PASS — 200 with rate-limit headers; USDA returned 4 verified generic foods |
| Degradation, live | PASS — with OFF down the response set `degraded: true` and still returned USDA results |
| Log a food | PASS — 200 g of a 107.37 kcal/100 g food stored as 214.74 kcal, 45.00 P, 0 C, 3.86 F |
| Cache round trip | PASS — `foods`, `food_nutrients` and `food_servings` written; entry computed from the stored row, not the payload |
| Cache idempotency | PASS — logging the same food three times left exactly one `foods` row |
| Cache hit on re-search | PASS — cached food returned first with its database id |
| Edit amount | PASS — 200 g → 150 g recomputed to 161.06 kcal, 33.75 P, 2.90 F |
| Delete entry | PASS — entry removed, shared cached food correctly retained |
| RLS: cross-user read | PASS — only own profile visible; other user's profile and weigh-ins return `[]` |
| RLS: forged insert | PASS — writing a row owned by another user rejected with `42501` |
| RLS: anon access | PASS — `permission denied for table profiles` |
| Teardown | PASS — test account and cached food deleted; cascades removed goals, weigh-ins, logs and targets |

### Phase 6 end-to-end run, 2026-08-23 (production build, 28-day fixture)

A test account seeded with 28 days of weigh-ins (111.8 kg falling ~0.9
kg/week, with noise) and 28 days of food logs at 2100 kcal.

| Check | Result |
|-------|--------|
| Trend vs. raw | PASS — latest reading 108.5 kg, trend weight 109.3 kg; the trend lags, as smoothing should |
| Rate over 28 days | PASS — −0.72 kg/wk from the smoothed series |
| Observed expenditure | PASS — 2890 kcal, matching 2100 + (2.88 × 7700)/28 computed by hand |
| Blended estimate | PASS — 3109 kcal, matching prior 3254 + 0.4 × (2890 − 3254) exactly |
| Confidence | PASS — `high` at 28 days with full coverage |
| Estimate persisted | PASS — `tdee_estimates` row: 3109.8 kcal, adaptive, high, 28 days of data |
| Sufficiency gate | PASS — thinned to 4 weigh-ins, fell back to "Starting estimate… Needs 8 weigh-ins in the window; 4 so far" |
| Target uses adaptive figure | PASS — 1906 kcal / 175 g protein from the 3109 basis, not the 3254 formula seed |
| Target uses trend weight | PASS — protein moved 174 → 175 g once the raw reading was replaced by the trend |
| Weekly cadence, inside week | PASS — target dated 6 days earlier carried forward unchanged at 2500 kcal |
| Weekly cadence, at 7 days | PASS — recomputed to 1906 kcal with `source: weekly_adjustment` |
| Weekly check-in recorded | PASS — week of 2026-08-17: trend 110.09 → 109.33, −0.760 kg, 100% adherence, 7 logged days, 2500 → 1906 |
| Weigh-in upsert | PASS — re-weighing the same day corrected the row rather than adding a second |
| Teardown | PASS — account deleted; cascades cleared goals, weigh-ins, logs, targets, estimates and check-ins |

### Phase 7 end-to-end runs, 2026-08-23 (production build)

| Check | Result |
|-------|--------|
| Phase created through the real action | PASS — anchored at the 109.33 kg **trend**, not the 108.5 kg reading; 9 milestones written |
| Recommended range | PASS — 100.58–102.77 kg, the 0.75–1.0%/week band over 56 days |
| Precedence | PASS — diary rendered "2-Month Cut target · 1906 kcal", row stored with `source: phase` |
| Cadence inside a phase | PASS — a phase target dated 6 days earlier carried forward at 2222 kcal instead of recomputing |
| Cadence at seven days | PASS — recomputed with `source: weekly_adjustment` |
| Visible fallback | PASS — ending the phase switched to "Daily target", moved the number, and explained why |
| Early-phase damping | PASS — day 1 gave 3211 kcal where the undamped path gave 3109 |
| Progress graph | PASS — four series, goal marker at 90.0, no NaN coordinates, one dashed path (stretch) |
| Milestone backfill | PASS — weeks 0–3 of a 21-day-old phase stamped; weeks 4–8 left null |
| Mid-phase report | PASS — "Day 22 check-in" with rate, projection and the stretch gap stated neutrally |
| Final report | PASS — percentage bodyweight lost, average weekly, best logging run; no forward projection |
| Phase 2 proposal | PASS — "19.88 kg still separates you from 90 kg… the goal following in a later phase" |
| Intake attribution | PASS after fix — "Across the 20 days you logged, you averaged 2180 kcal" |
| Teardown | PASS — test accounts removed by email prefix; the real account and login fixture untouched, 0 orphaned foods/milestones/estimates |

Every test account has been torn down. The database holds the 4 seeded
`meal_types` rows and the retained login fixture (see KNOWN ISSUES) —
verified directly after the Phase 6 run: 0 foods, 0 logs, 0 weigh-ins,
0 targets, 0 estimates, 0 check-ins.
