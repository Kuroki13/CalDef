# CalDef — Implementation Status

Living record of what actually exists. Update this at the end of every
phase, before compacting context, and whenever a claim in it stops being
true.

A feature belongs under DONE only if it was **tested and verified**, not
merely written. "It compiles" is not done.

Last updated: 2026-09-05

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
| 8 | Recipes, saved meals, favorites, barcode | DONE |
| 9 | AI layer | DONE |
| 10 | PWA, rate limiting, security hardening | DONE |
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
- `off.ts` — v3 for barcode lookup as the spec directs, `/cgi/search.pl`
  for search. Nothing from here is ever marked verified. Sodium is
  converted from g to mg. A product with no energy value, or a serving
  whose gram weight will not parse, is skipped rather than guessed.
  - **Search endpoint corrected 2026-09-05.** It previously called
    `/api/v2/search`, which filters on tags and *ignores* a parameter it
    does not recognise instead of rejecting it. `search_terms` was
    therefore dropped on every query and the call returned page 1 of the
    unfiltered database — the same arbitrary products regardless of what
    was typed. Reported by the account owner: "dubai" returned Sidi Ali
    water and Jaouda yoghurt. `/cgi/search.pl` reads `search_terms` and
    returns the same response shape, so the mapping was unchanged.
  - The regression is covered twice, because neither test catches it
    alone: `off.test.ts` asserts the request URL is `/cgi/search.pl` and
    carries the term (a mocked fetch returns its fixture whatever URL it
    is given, so only the URL assertion has any force), and the live
    suite asserts that "dubai" returns products naming it, or none.
    Accent-folded — the matches are largely French and German and spell
    it "Dubaï", which the first version of the test wrongly rejected.
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

### Phase 8 — recipes, saved meals, favourites, barcode

Verified end to end on 2026-09-05 against the real database with a real
session, driving the library functions themselves so RLS applied exactly
as it does in the app.

- **Barcode** (`lib/barcode.ts`, `/api/foods/barcode`). Server path
  verified in Phase 5's session; the camera UI stays unverified until
  Phase 11, for the reason under KNOWN ISSUES.
- **Recipes** (`lib/recipes.ts`, `/recipes`). A composed dish that logs
  as **one** diary entry carrying `food_logs.recipe_id`, with nutrition
  summed from the ingredients' stored nutrient rows and divided by the
  serving count.
- **Saved meals** (`lib/saved-meals.ts`). A set of foods that logs as
  **several** entries, one per item. The `food_logs` XOR constraint
  between `food_id` and `recipe_id` makes the distinction structural
  rather than a naming convention.
- Both are built from entries already in the diary rather than from a
  fresh search, so every component is already a cached food with a
  nutrient row and nothing is re-resolved against a provider at log time.
- A recipe can be filled **after** it is created, not only at creation.
  Without that an empty recipe was a dead end: it said it could not be
  logged and offered no way to fix that.
- **Favourites** (`lib/favorites.ts`). A pointer to a cached food, not a
  copy, so favouriting something already logged costs nothing. Starred
  from a diary entry; a recipe-backed entry has no single food behind it
  and shows no star rather than a dead one. Favourites log straight to
  the diary in grams, against the kcal-per-100 g figure the row shows.
- **`lib/food-log.ts` — the single-food logging convergence point.**
  Manual search, favourites and (later) the AI parser all write their
  entry through `logCachedFood`, which re-reads `food_nutrients` from the
  database and computes the macros there. Previously this lived inline in
  the diary's server action, so each new caller was a fresh opportunity
  to trust a number from the client. Recipes and saved meals deliberately
  do not pass through it — they compose entries rather than log one food.

### Phase 9 — the AI layer

Verified on 2026-09-05 end to end against the production build with a
real session — twice, once with `GEMINI_API_KEY` present and once with
it unset.

- **`lib/llm/types.ts` — the port.** Both AI rules are types rather than
  discipline. `FoodIntent` is `{query, amount, unit}`, so a nutrition
  figure has nowhere to go; `FoodText` is branded and unforgeable outside
  `food-text.ts`; `AnonymousFigures` has only `number` fields, so a name
  or an id is not assignable to it.
- **`lib/llm/food-text.ts` — the data-minimization gate.** The only
  producer of `FoodText`. Refuses emails, URLs, UUIDs, JWTs and runs of
  nine or more digits, and refuses rather than strips — silently deleting
  part of what someone typed and sending the rest tells them nothing and
  hands the model a sentence with a hole in it. `trustedFoodText` is the
  separate, deliberately awkward door for text the app composed itself,
  such as a food's own name from a provider.
- **`lib/llm/gemini.ts` — the single call site.** Every request to Google
  leaves from one function, which assembles the body itself; there is no
  parameter through which extra context could be passed. The response
  schema has no nutrition fields, and the parser reads only the three
  keys — a response carrying `kcal` has it dropped rather than rejected.
  Failure text carries a status and nothing else, because the request URL
  contains the API key.
- **`lib/llm/unavailable.ts`** — "off" is a typed outcome, not an error.
  `disabled` (the user's switch) stays distinct from `unconfigured` (no
  key) because only one is fixable in settings, and `rate-limited` from
  both because waiting fixes it.
- **`/api/ai/parse` + `lib/ai/resolve.ts`** — natural-language logging.
  The model's queries go through the same `searchFoods` fan-out the
  search box uses and the macros through the same `scaleNutrients` the
  diary uses. The route proposes and does not write; the user confirms
  through `logParsedFoods`, which caches and writes via `logCachedFood`
  exactly as the manual path does, differing only by `source: "ai"`.
- **`/api/ai/correct`** — "actually that was 250g". Also proposes only.
  `unclear` is a first-class answer and offers no button, because
  rewriting a diary entry from an ambiguous sentence is worse than
  declining. Its preview is computed from the same nutrient row the
  update reads.
- **`lib/food-log.ts` gained `updateEntryPortion`**, the counterpart to
  `logCachedFood`. The manual Edit control now goes through it too, so
  the two paths cannot produce different numbers for the same change —
  and unlike the ratio-scaling it replaced it can express a change of
  unit, which a spoken correction can ask for.
- **`/api/ai/chat` + `/assistant`** — the nutrition assistant.
  `lib/ai/figures.ts` is the whole of what the app tells Gemini about the
  person asking: targets, today's totals, estimated expenditure, current
  trend weight, weekly rate. Absent figures are omitted rather than sent
  as zero. No name, email, user id, birth date, height, goal weight, or
  weight *history* — one current trend figure answers "am I on track"; a
  series would be a body-weight history leaving the machine.
- **The thread is never replayed to the model.** Stored for the user's
  screen only. A real limitation — a follow-up must restate its context,
  and the UI says so — but replaying would send back everything
  previously typed, which is the accumulation the rule exists to prevent.

Two findings from the live API, both recorded under KNOWN ISSUES: the
free-tier daily quota, and the search ordering that the AI path exposed.

### Phase 10 — PWA, rate limiting, security hardening

Verified 2026-09-05 against the production build, twice: with
`GEMINI_API_KEY` present and with it unset.

**Installable (spec §7).** Both iOS routes are provided because they are
not the same route. `app/manifest.ts` covers iOS 17.4+; the
`apple-touch-icon` link and the Apple meta tags cover everything older.
Next emits only the standardised `mobile-web-app-capable`, so the legacy
`apple-mobile-web-app-capable` is added by hand — without it an older
iPhone installs the icon and opens it in a browser tab with the address
bar showing, which is not an installed app. Found by reading the served
HTML. `start_url` is `/dashboard`, since `/` redirects and an installed
app that opens on a redirect shows a blank frame first.

- Icons come from one SVG via `scripts/generate-icons.mjs`: 192, 512, a
  maskable 512 with its mark inside the middle 80%, and a 180 apple-touch
  icon flattened to opaque RGB and left unrounded, because iOS applies
  its own mask and composites transparency onto black.

**The service worker never caches a page.** Every page here is personal,
so a cached one would leave someone's figures on disk and later show
stale numbers as today's. Navigations are network-only with a fallback
to a static `/offline` page that shows no data and says why. Only hashed
`/_next/static` assets are cache-first; `/api/*` is untouched; non-GET
is ignored.

**Rate limiting protects the quota, not the route.** The three AI routes
held three separate 10/min buckets — 30 requests a minute against a
model whose free tier allows 15, with our limiter reporting everything
fine while Gemini refused. They now also share a `gemini:` bucket, and
search and barcode share a `food-providers:` one since both reach Open
Food Facts. `rateLimitAll` consumes every bucket on every request,
including refused ones, and publishes headers for whichever bucket is
closest to refusing.

- A rate-limited response is distinguishable from a failure: 429 with
  `Retry-After` and `RateLimit-*`, plus `reason: "too-many-requests"` for
  our limiter versus `rate-limited` for the provider's own quota.

**Response headers** on every route: CSP, nosniff, referrer policy,
frame denial, a permissions policy allowing only the camera the scanner
needs, and HSTS. `connect-src` is `'self'` alone — see DECISIONS.

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
  stored. **Cleaned up 2026-09-05**: four of those five rows were deleted.
  The one that remains (`2026-08-23`) was created on the date it carries,
  so it is a real target for a real day, not a frozen future one — there
  is no stale row left in the table. Verified by querying `daily_targets`
  directly: the account now holds that row plus one for today, both
  written on the day they cover.
- **The barcode camera UI is unverified and must stay that way until
  Phase 11.** `getUserMedia` requires a secure context, so the scanner
  works at `http://localhost:3000` on desktop but cannot work from a
  phone over plain HTTP on the LAN — a browser constraint, not a defect.
  Desktop alone is not sufficient evidence that it works, because the
  device that matters is a phone with a rear camera. **Verify on-device
  after the Vercel deploy in Phase 11**, where HTTPS is available.
  - What *is* verified: the capability logic (15 unit tests), and the
    whole server path the scanner calls — a real barcode resolves through
    Open Food Facts, caches, and returns; an unknown one returns 404 with
    a body rather than an error.
  - The UI distinguishes four failure modes rather than showing one
    generic message, because three are fixable by the user and one is
    not: `insecure-context` (open over HTTPS — permissions cannot help),
    `unsupported` (no `BarcodeDetector`; Chrome and Edge have it, Safari
    and Firefox do not), `no-camera`, and `permission-denied`. Collapsing
    them would send someone to check permissions when the real problem is
    plain HTTP.
- **A dev test user is still in the database**:
  `caldef.dev.tester@gmail.com`, created 2026-08-10, email confirmed. It
  has a `profiles` row but no `goals` or `weight_entries`, so it has
  never completed onboarding. Retained deliberately as a login fixture;
  delete it before any real use. It is the **only** test account left:
  the Phase 8 account from 2026-08-23 and the three created by the
  2026-09-05 end-to-end run were deleted afterwards, along with the
  shared `foods` rows their fixtures wrote. The 2026-08-10 note claiming the
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
- **The CSP allows `'unsafe-inline'` for scripts.** Next's App Router
  inlines its bootstrap and the RSC payload in `<script>` tags, so
  removing the allowance needs a per-request nonce threaded through the
  proxy — the same function that refreshes the Supabase session, where
  the SDK is explicit that nothing may run between creating the client
  and reading the claims. Deferred deliberately rather than bolted on
  while adding headers. Everything else is `'self'`, and `connect-src` is
  `'self'` alone, so an injected script still cannot load a remote
  payload or send anything anywhere.
- **The CSP has not been observed in a browser.** It is asserted from the
  response headers and reasoned about; there is no browser in this
  environment to catch a violation the reasoning missed. Watch the
  console on the first real device visit in Phase 11.
- **The rate limiter is still per instance.** Unchanged from Phase 5 and
  restated here because Phase 10 is where it was reviewed: serverless
  instances share no memory, so on Vercel the effective limit is
  per-instance and resets on a cold start. Adequate against a runaway
  client loop, which is the actual risk for a single-user app; not a
  defence against a distributed attacker, and it should not be described
  as one.
- **The Gemini free tier is measured in requests, and the ceiling is
  low.** `gemini-3.8-flash` allows **20 requests per day** — the 429 body
  names `GenerateRequestsPerDayPerProjectPerModel-FreeTier` with
  quotaValue 20. That is a few meals and then nothing, and one run of the
  live suite spends six. The pinned model is therefore
  `gemini-3.5-flash-lite`, which took 16 requests in a single burst
  before refusing and refused on the **per-minute** quota (15/min) rather
  than a daily one. `GEMINI_MODEL` overrides the pin without a code
  change, because these allowances move. A spent quota surfaces as the
  `rate-limited` reason and a message saying to try again shortly — it is
  not reported as a fault, because it is not one. `npm run test:live`
  paces its Gemini calls 7 s apart for the same reason.
- **The assistant has no memory within a thread.** Each question is
  answered on its own; the stored history is for the user's screen and is
  never sent back. Deliberate, not missing: replaying a thread would mean
  sending back everything previously typed, which is exactly the
  accumulation of personal detail the data-minimization rule prevents. A
  follow-up has to restate its context and the UI says so. Revisiting
  this would need a way to carry forward the *nutrition* of a
  conversation without carrying forward its personal content.
- **A one-word query can match a poor food.** Search ranking scores how
  much of the query a food's name and brand account for, which settles
  "dubai chocolate" but cannot settle "chicken" — every chicken row
  scores the same, so the fan-out order decides and USDA's "Chicken
  spread" can lead. Observed during the Phase 9 end-to-end run, where the
  model faithfully returned the bare word the user typed. The
  alternatives list on each proposal exists for this, and the figure
  shown is always the matched food's own. A better tie-break would need a
  notion of how typical a food is, which no provider gives us.
- **A custom food cannot be created.** `foods` has a
  `foods_custom_requires_owner` check, so a row with `source = 'custom'`
  must carry a `user_id` — but `cacheFood` never sets one, because it
  writes shared provider rows. Every path into `foods` therefore goes
  through `cacheFood`, and none can produce a custom food. Found on
  2026-09-05 when a Phase 8 end-to-end fixture tried to cache one and the
  check rejected it. Spec §4 lists custom user foods as a search source,
  so this is a real gap rather than a design choice; it needs an
  owner-scoped insert path of its own. Not in any phase's scope yet.
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

- **`connect-src` is `'self'` alone.** Settled 2026-09-05 while verifying
  the headers. `lib/supabase/client.ts` is imported by nothing — every
  read and write goes through a server component, a server action or a
  route handler — so the browser reaches no external origin, and the
  built client bundle contains neither the project URL nor the
  publishable key. Naming the Supabase origin would have permitted a
  request the app does not make.
  - The consequence is deliberate and signposted: the first component to
    import the browser client gets a CSP violation rather than a network
    call. `lib/supabase/client.ts` carries the note saying so, and what
    one line fixes it, at the place someone would trip over it.

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

- **Enable leaked-password protection.** The only finding the Supabase
  security advisor has ever returned, and the one thing in Phase 10 that
  could not be done from here: it is a dashboard toggle with no
  Management API equivalent exposed through MCP, so it needs the account
  holder. Authentication → Policies → "Prevent use of leaked passwords".
  Free, no plan change. Checks new passwords against HaveIBeenPwned.

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
| 2026-09-05 | `npm run test` | PASS — 374 tests, 28 files |
| 2026-09-05 | `npm run test:live` | PASS — 6/6 on 4 consecutive runs, including the new search-relevance check |
| 2026-09-05 | `npm run typecheck` / `lint` / `build` | PASS — 14 routes, 0 lint problems |
| 2026-09-05 | Supabase security advisors | 1 WARN — `auth_leaked_password_protection` only. No RLS findings. |
| 2026-09-05 | `npm run test` (Phase 9) | PASS — 465 tests, 36 files |
| 2026-09-05 | `npm run test:live` — Gemini | PASS — 7/7 on the pinned lite model |
| 2026-09-05 | `npm run typecheck` / `lint` / `build` | PASS — 17 routes, 0 lint problems |
| 2026-09-05 | `npm run test` (Phase 10) | PASS — 473 tests, 37 files |
| 2026-09-05 | `npm run build` (Phase 10) | PASS — 19 routes incl. `/offline` and `/manifest.webmanifest` |

### Phase 10 install path, 2026-09-05

The tap on a real iPhone is the one thing not verified here — there is no
device in this environment, and it is scheduled for Phase 11 alongside the
barcode camera, which has been waiting for the same reason. Everything the
tap depends on **is** verified, against the served bytes rather than the
source.

| Check | Result |
|-------|--------|
| Manifest served as `application/manifest+json` | PASS |
| `display: standalone` | PASS |
| `start_url` is a real page, not a redirect | PASS — `/dashboard` |
| Maskable icon declared | PASS |
| Every icon is a real PNG at its stated size | PASS — 192², 512², maskable 512², apple-touch 180² |
| `<link rel="manifest">` in the served HTML | PASS |
| `<link rel="apple-touch-icon">` | PASS |
| `apple-mobile-web-app-capable` (iOS < 17.4) | PASS — added by hand; Next does not emit it |
| `mobile-web-app-capable` (iOS 17.4+) | PASS |
| `apple-mobile-web-app-title` | PASS — home-screen name is "CalDef" |
| `theme-color` and `viewport-fit=cover` | PASS |
| Service worker served signed out, as JavaScript | PASS — the redirect that broke this is fixed |
| Service worker not cached | PASS — `no-store` |
| `/offline` reachable signed out, no redirect | PASS |

### Phase 10 headers and rate limiting, 2026-09-05

| Check | Result |
|-------|--------|
| `Content-Security-Policy` | PASS — `default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'` |
| `X-Content-Type-Options` | PASS — nosniff |
| `Referrer-Policy` | PASS — strict-origin-when-cross-origin |
| `X-Frame-Options` | PASS — DENY |
| `Permissions-Policy` | PASS — `camera=(self)`, everything else denied |
| `Strict-Transport-Security` | PASS — one year, includeSubDomains |
| Headers apply to authenticated pages too | PASS |
| Rate-limit headers on a normal response | PASS — limit 30, remaining 29 |
| Search refuses past its limit | PASS — 429 |
| Refusal is distinguishable from a failure | PASS — `reason: "too-many-requests"`, `Retry-After: 43` |
| Refusal reports zero remaining | PASS |
| Shared Gemini bucket binds across routes | PASS — 6 parse + 6 chat, then the 13th refused though neither route hit its own 10 |
| Provider not called once refused | PASS |
| Buckets are per user | PASS |

### Phase 10 security re-verification, 2026-09-05

| Check | Result |
|-------|--------|
| Supabase security advisors | 1 WARN — leaked-password protection (see BLOCKED). No RLS findings. |
| Supabase performance advisors | 10 INFO `unused_index` only, expected with near-zero traffic |
| RLS structural check | PASS — 20/20 tables, RLS enabled, exactly 4 policies each (one per command) |
| RLS read isolation | PASS — all 20 tables; B sees only its own profile and the shared rows |
| RLS write isolation | PASS — every cross-user update/delete affected 0 rows; own profile 1 |
| RLS forged ownership | PASS — forged `weight_entries`, `goals`, `recipes`, `favorite_foods` all rejected |
| RLS forged parentage | PASS — ingredient, saved-meal item and AI message into another user's parent all rejected |
| Anon access | PASS — denied on all 20 tables |
| `GEMINI_API_KEY` / `USDA_API_KEY` in client JS | PASS — absent from `.next/static` |
| Gemini host, USDA host, system prompt in client JS | PASS — absent |
| `service_role` in the codebase | PASS — one mention, in a comment saying it is never used |
| Positive control | PASS — a client-component string *is* in `.next/static` |

### Phase 10 with `GEMINI_API_KEY` unset, 2026-09-05

| Check | Result |
|-------|--------|
| Dashboard, diary, weight, phase, recipes, assistant, settings | PASS — all 200 |
| Manual food search | PASS — 15 foods |
| `/api/ai/parse` | PASS — 503 `unconfigured`, message names the manual path |
| `/api/ai/chat` | PASS — 503 `unconfigured`, message names the manual path |

### Phase 9 end-to-end run, 2026-09-05 (production build, real session)

Driven over HTTP against `next start` with a genuine `@supabase/ssr`
session, so the routes, the proxy and RLS all applied. Throwaway account,
deleted afterwards with its fixtures.

| Check | Result |
|-------|--------|
| Spec worked example parses | PASS — "200g chicken, 150g rice, one tablespoon olive oil" → 3 proposals |
| Every proposal matched a real food | PASS — all three resolved through the search fan-out |
| Macros come from the food, not the model | PASS — each equals `match.nutrients.kcal × grams / 100` exactly |
| Intent carries no nutrition key | PASS — every intent is exactly `{amount, query, unit}` |
| "50g Dubai chocolate" is heard | PASS — query "Dubai chocolate", 50 g |
| …and matched to the real product | PASS — J.D. Gross "Dubai chocolate", 531 kcal/100 g → **265.50 kcal** |
| Correction reads the spec's example | PASS — "actually that was 250g, not 200g" → amount 250 g |
| Preview computed from the stored row | PASS — 1327.5 kcal, matching 531 × 2.5 |
| Correction writes nothing until confirmed | PASS — the entry still read 200 g afterwards |
| Ambiguous correction | PASS — "more of a lunch than a snack" → `unclear`, no guess |
| Assistant answers from the figures | PASS — quoted the 179 g protein remaining and the calories left |
| Assistant stores the thread | PASS — both turns in `ai_messages` |
| A question carrying a user id | PASS — 400 `identifier`, nothing left the machine |
| Teardown | PASS — 4 test accounts and 2 fixture `foods` rows deleted |

### Phase 9 with `GEMINI_API_KEY` unset, 2026-09-05

The same production build, started with the key removed from the
environment. This is the check that ARCHITECTURE invariant 3 is true.

| Check | Result |
|-------|--------|
| Diary renders | PASS |
| Diary still offers the manual search box | PASS |
| Dashboard / Recipes / Weight render | PASS |
| Manual food search | PASS — 29 foods returned |
| `/api/ai/parse` | PASS — 503 `unconfigured`, message names the manual path |
| Text carrying an email | PASS — 400 before any model call |
| Unauthenticated call | PASS — 401 JSON, not a redirect |

### Secret containment, 2026-09-05

| Check | Result |
|-------|--------|
| `GEMINI_API_KEY` in `.next/static` | PASS — absent (and absent from `.next` entirely) |
| `USDA_API_KEY` in `.next/static` | PASS — absent |
| Gemini host referenced in client JS | PASS — absent |
| System prompt in client JS | PASS — absent |
| Positive control | PASS — a string from the new client component *is* in `.next/static`, so the grep proves something |

### Open Food Facts search relevance, 2026-09-05

The defect and its cause are described under Phase 4.

| Check | Result |
|-------|--------|
| `/api/v2/search?search_terms=dubai` (the old call) | REPRODUCED — `count` 4,730,718, i.e. the whole database; page 1 was Moroccan water and yoghurt |
| `/cgi/search.pl?search_terms=dubai&json=1` | PASS — `count` 1,202, top hits "Dubai chocolate" (531 kcal/100 g) and Lindt "DUBAI Style CHOCOLATE PISTACHIO & KADAYIF" (563) |
| `fields=` and `nutriments` on the cgi endpoint | PASS — energy, macros and `serving_quantity` all present, so the mapping is unchanged |
| Endpoint flakiness | PASS — one probe in three answered 503, which `providerFetch` already retries |
| Unit: request URL carries the term | PASS |
| Live: "dubai" returns only matching products, or none | PASS — first version of the assertion correctly failed on "Dubaï"; now accent-folded |

### Phase 8 end-to-end run, 2026-09-05 (real database, real session)

A throwaway account, driving `lib/` directly with a genuine
`@supabase/ssr` session so every call went through RLS. Deleted
afterwards along with its fixtures.

| Check | Result |
|-------|--------|
| Cache a food, log 200 g | PASS — 330.00 kcal, 62.00 g protein, computed from the stored row |
| Star a food | PASS — idempotent; a second `addFavorite` is not an error |
| Favourite appears in the list and marks its diary entries | PASS |
| Log 50 g from favourites | PASS — 82.50 kcal, `source = 'favorite'` |
| Empty recipe refuses to log | PASS — "That recipe has no ingredients yet." |
| Add ingredients to an existing recipe | PASS — the path that did not exist before |
| Append a second ingredient later | PASS — 2 distinct rows, no `sort_order` collision |
| Recipe nutrition | PASS — 412.50 kcal total over 2 servings = 206.25 per serving |
| Log a recipe | PASS — **one** entry at 206.25 kcal, `food_id` null, no star offered |
| Remove an ingredient after appending | PASS — 2 → 1 |
| Save a meal from 2 entries | PASS — totals 412.50 kcal |
| Log a saved meal | PASS — **two** separate diary entries |
| RLS: add ingredients to another user's recipe | PASS — rejected by the database, not by application code |
| Teardown | PASS — 3 e2e accounts, the stale Phase 8 account and the fixture `foods` rows deleted; 2 users remain |

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
