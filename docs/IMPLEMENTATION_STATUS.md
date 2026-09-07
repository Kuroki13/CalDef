# CalDef — Implementation Status

Living record of what actually exists. Update this at the end of every
phase, before compacting context, and whenever a claim in it stops being
true.

A feature belongs under DONE only if it was **tested and verified**, not
merely written. "It compiles" is not done.

Last updated: 2026-09-06

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
| 11 | Acceptance pass and Vercel deploy | IN PROGRESS — deployed and verified signed-in on production; **open until the owner's iPhone checks pass** |

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
    rather than changing it silently. **This was true of the policy
    function and false of the app until 2026-09-06**, when driving the
    deployed site showed a phase started today not reaching today's
    diary; see TEST RESULTS. It now holds end to end, on the day the
    phase starts and the day it ends, and is verified on production.
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

### Custom user foods (Phase 11 addition)

- `foods.archived_at` (migration 0008) and `lib/food/custom.ts`, the
  owner-scoped writer of `foods` that `cacheFood` deliberately is not.
- Create, edit, remove and log, from two places: the food library on
  `/recipes` and an "Add your own food" path in the diary that jumps
  straight to the portion fields, because someone adds a food while
  holding the packet.
- Figures are entered as the packet prints them, per 100 g or per serving,
  and converted server-side in `custom-input.ts`.
- Removing a food that history references archives it; one nothing
  references is deleted. The row says which before the tap.
- Verified on the deployment, including that two edits left an existing
  diary entry untouched. See TEST RESULTS.

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

Phase 11: everything that can be checked without a phone is done — the
migrations are applied to CalDef-prod, production permissions and RLS are
verified, the Vercel production variables are configured, the app is deployed
at `caldef-woad.vercel.app`, and authentication, food search, diary writes,
AI parsing and correction, the assistant, weight tracking, saved meals and the
cut phase were all exercised end to end against that deployment with a real
signed-in account (2026-09-06, see TEST RESULTS).

What is left, and **Phase 11 stays open until it is done**:

- The physical iPhone visit: the PWA install tap, the barcode camera —
  now with a decoder that WebKit can actually run — and a look at the
  Safari console for CSP violations. None of it can be checked from here,
  and desktop Chrome takes a different decoder path, so it is not
  evidence.

## KNOWN ISSUES

- ~~**Editing a custom food is three statements, not one transaction.**~~
  **RESOLVED 2026-09-07.** The whole write moved into
  `save_custom_food` (migration 0009), a `security invoker` function —
  so RLS still decides what it may touch, and a function body is one
  transaction. `supabase/tests/custom_food_atomicity.sql` fails the
  middle statement on purpose and asserts the earlier one rolled back.
- **A retired custom food cannot be brought back from the UI.**
  Archiving is reversible in the database — `archived_at` back to null —
  but nothing offers it, because there is nowhere sensible to list foods
  that are deliberately hidden. If the owner ever retires one by mistake,
  it is one `update` away.
- **Signup is closed, in two places, and both have to be undone to open
  it.** As of 2026-09-07 `SIGNUP_ALLOWLIST` is unset in production, which
  means nobody, and `disable_signup` is `true` on the Supabase project,
  which closes `/auth/v1/signup` to the publishable key as well. To let an
  address in: add it to the Vercel variable **and redeploy** — Next inlines
  `process.env` at build time, so the variable must exist before the build
  — and turn `disable_signup` off. Sign-in is unaffected by either.
  `mailer_autoconfirm` remains `true`, so a permitted signup is usable
  immediately; that mattered when anyone could sign up and matters much
  less now that nobody can.
- **Production is no longer empty, and it is not test data.** As of
  2026-09-06 it holds 4 accounts, 8 food logs, 4 weigh-ins and 15 shared
  `foods` cache rows. Those accounts arrived between deployments and
  belong to the owner, not to any harness — **every future cleanup must
  target fixtures by their exact `caldef.<slug>.` identity and nothing
  else.** The two fixture accounts this project has created since the
  deploy were both removed that way, each verified by counting before and
  after. The shared cache rows carry `user_id is null` and no personal
  data; they refill on demand and are left alone.
- ~~**A deleted account keeps a working session until its JWT expires.**~~
  **RESOLVED 2026-09-07.** A verified token with no `profiles` row behind
  it is a deleted account — the trigger writes that row on signup and the
  cascade removes it — so the two signed-in surfaces, which load the
  profile anyway, now recognise it and send the session to
  `/auth/session-ended`. It is a route handler because a server component
  cannot write cookies, which is what an earlier attempt got wrong.
- **Leaked-password protection is unavailable on Free.** The prior "no
  cost" guidance was wrong. [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
  specifies Pro and above. Leave disabled under the owner's zero-cost plan;
  an advisor warning for this is an accepted free-tier limitation.
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
- **The barcode camera UI is still unverified on a phone, and this is the
  one check that matters.** Two of the three things blocking it are now
  closed. HTTPS: satisfied on the deployed site, where the scanner no
  longer reports `insecure-context`. The decoder: `BarcodeDetector` is a
  Chrome and Edge feature, WebKit does not implement it, and on iOS every
  browser is WebKit — so the scanner as first built was dead on the only
  device it exists for. **Fixed 2026-09-06** by adding a ZXing fallback
  that is downloaded on the first scan when the native decoder is absent
  (`lib/barcode-fallback.ts`), which is what Safari will take.
  What remains cannot be checked from here and **cannot be checked from
  desktop Chrome either**: Chrome has the native decoder and would
  therefore exercise the path Safari never reaches. Someone has to open
  the deployed app on the iPhone, tap Scan, and point it at a packet.
  Until that happens, treat scanning as built and unverified.
  - Worth knowing before the attempt: the fallback decodes in JavaScript
    on the main thread, so it looks at five frames a second rather than
    sixty, and it needs the barcode reasonably square-on and lit. If it
    struggles, the number can be typed in — that path resolves through
    exactly the same lookup.
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
- ~~**The onboarding form does not work without JavaScript.**~~
  **RESOLVED 2026-09-05** in the acceptance audit — it defaults to UTC,
  and settings now re-syncs the timezone from the browser so a wrong
  default can be corrected. Original note kept for the reasoning: `timezone` is
  a hidden input populated on the client from
  `Intl.DateTimeFormat().resolvedOptions()`, so a no-JS submission sends
  it empty and fails validation. Noticed while driving the form through
  its progressive-enhancement path during end-to-end testing. Harmless
  for a PWA whose whole point is a JS runtime, but it means the
  no-JS fallback React renders for free is not actually functional here.
  Fix by defaulting to UTC server-side when the field is empty.
- ~~**The one spec item that is not implemented: custom user foods.**~~
  **RESOLVED 2026-09-06.** `lib/food/custom.ts` is the owner-scoped writer
  the note called for, the form reads figures off a packet in whichever
  panel the manufacturer printed, and the foods appear in search beside
  USDA and Open Food Facts. Verified on the deployment — see TEST RESULTS.
  Every item in §10's acceptance list is now implemented and verified.
- **The PWA install tap and the barcode camera are still unverified.**
  Both need a physical iPhone, which this environment does not have.
  Everything either depends on is verified against the served bytes and
  the server path respectively — and both were re-checked against the
  live deployment on 2026-09-06 (manifest served as
  `application/manifest+json`, `display: standalone`, every icon a real
  PNG at its declared size, the worker served `no-store`, `/offline`
  reachable) — so what remains is the on-device gesture. Do both on the
  first real-device visit.
- **The CSP allows `'unsafe-inline'` for scripts.** Next's App Router
  inlines its bootstrap and the RSC payload in `<script>` tags, so
  removing the allowance needs a per-request nonce threaded through the
  proxy — the same function that refreshes the Supabase session, where
  the SDK is explicit that nothing may run between creating the client
  and reading the claims. Deferred deliberately rather than bolted on
  while adding headers. Everything else is `'self'`, and `connect-src` is
  `'self'` alone, so an injected script still cannot load a remote
  payload or send anything anywhere.
- ~~**The CSP has not been observed in a browser.**~~ **Largely closed
  2026-09-06.** The deployed site was driven through a real Chrome:
  login, dashboard, diary (search, manual log, AI parse, AI correction,
  barcode dialog), weight, phase, recipes, assistant and settings all
  rendered with **zero console errors**, which is where a CSP violation
  would surface. Not yet seen in Safari, which is the browser the owner's
  phone will use — recheck on the device visit.
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
- ~~**The assistant has no memory within a thread.**~~ **RESOLVED
  2026-09-07**, and by exactly the route the old note asked for: a way to
  carry the nutrition of a conversation without its personal content.
  `recentTurns` re-checks every stored message with `toFoodText` — the
  same gate a new question passes — and drops the ones that fail, so what
  crosses the boundary is still `FoodText` and nothing else. Six messages,
  so a thread cannot accumulate into a dossier.
- ~~**A one-word query can match a poor food.**~~ **RESOLVED 2026-09-07.**
  The owner's own diary turned out to be a better notion than "typical":
  `loggedFoodCounts` breaks the tie, so a food they have logged before
  outranks one they never have. It is a tie-break and not a term in the
  score — a familiar food must not beat an exact match on what was typed,
  and a test holds that line.
- ~~**A custom food cannot be created.**~~ **Already resolved on
  2026-09-06** by `lib/food/custom.ts`, and this entry was simply left
  behind — there were two notes for the same gap and only the other one
  was struck through. Recorded rather than deleted because a stale KNOWN
  ISSUE is worse than none: it sends the next reader to build something
  that exists.
- ~~**The food cache cannot refresh a provider food.**~~ **RESOLVED
  2026-09-07** by migration 0010, and narrowly. A shared row may be
  updated only once it is more than thirty days old; inside that window it
  is immutable to everyone. The blanket policy change the old note
  rejected is still rejected. What made the narrow version defensible is
  that any authenticated user could already *insert* a shared cache row
  with arbitrary nutrition, so this closes an asymmetry under a condition
  rather than opening a new door. A genuinely multi-tenant deployment
  would want the refresh to run as a trusted job, and the staleness window
  is what keeps that change small when it is wanted.
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
- ~~**The food cache never expires.**~~ **Already resolved on 2026-09-07**
  by migration 0010 and `lib/food/staleness.ts` — this was a second entry
  for the same gap as "the food cache cannot refresh a provider food"
  above, and only that one was struck through at the time. Left visible
  rather than deleted, because a stale KNOWN ISSUE sends the next reader
  to build something that exists. That is twice this has happened now:
  **when resolving an issue, search this file for other entries describing
  the same thing.**

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

- No account authentication blocker remains: Supabase and Vercel CLI
  logins work, and GitHub authentication is valid. Production verification
  and deployment are still in progress, not yet passed.
- Physical iPhone verification requires the owner/device after deployment.
- Leaked-password protection is a paid feature, not an outstanding request
  to enable a free toggle (see KNOWN ISSUES).

- **Email confirmation** — **RESOLVED 2026-08-23.** Toggle flipped; the
  full signed-in path is now verified (see TEST RESULTS).
- `GEMINI_API_KEY` — **RESOLVED 2026-08-22.** Present in `.env.local`
  and verified against the live API (HTTP 200, 50 models listed).
- `USDA_API_KEY` — **RESOLVED 2026-08-22.** Present in `.env.local` and
  verified against the live API (HTTP 200, search returns results).

## TEST RESULTS

### AI-drafted recipes, 2026-09-07 (Claude Code)

Built for the case that started it: "chicken maqlouba", a home-cooked dish
no food database holds.

- **What the model contributes, and the shape that bounds it.**
  `draftRecipe` returns `{query, amount, unit}` — `DraftedRecipe` is an
  alias of `ParsedFoods`, not a new type, and the response schema sent to
  Gemini has the same three properties as the parser's. A unit test feeds
  the reader a response carrying `kcal`, `protein_g`, `calories_total`,
  `totalCalories` and a nested `nutrition` object, and asserts the result
  contains none of it — not because it was rejected, but because there is
  nowhere for it to go. The per-parse cap is now one shared constant
  (`MAX_INTENTS`), asserted from both sides.
- **Where it is offered, and a defect found by running it.** The trigger
  was built for an empty search, and "chicken maqlouba" does not return an
  empty search: it returns chicken spread, chicken fat, chicken
  frankfurters and five more. `hasStrongMatch` now asks whether any result
  accounts for every word typed, which is what "nothing useful" meant. The
  registry imports the same `fold` rather than keeping a second copy.
- **Verified end to end against a production build, with the real model.**
  Searched the dish, saw the offer appear, drafted it, and got seven
  ingredients — chicken, basmati rice, eggplant, cauliflower and three
  more — each resolved against real providers with real nutrition beside
  it. Saved it, and checked the result in the database:
  - 7 ingredients, 4 servings, `ai_drafted_at` set to today.
  - **The stored nutrition agrees from three independent directions**: the
    UI showed 4250 kcal for the batch; summing the payload's foods by hand
    (per-100 g × amount) gives 4250; recomputing in SQL from the stored
    `food_nutrients` rows gives 4249.6.
  - Nothing named "maqlouba" exists in `foods`: the recipe is a private
    recipe, and the only shared rows written are the provider foods
    themselves.
  - The recipe card carries "Ingredient list drafted by the assistant on
    2026-09-07 and confirmed by you. The nutrition above is computed from
    the matched foods, not from the assistant."
- **An unresolved ingredient**, in tests rather than live because the
  providers resolved everything the model proposed: the route returns it
  with `match: null` instead of dropping it, the review shows it as
  unmatched, the save button stays disabled while one is present, and the
  payload cannot carry it — every item requires a resolved food, so an
  unmatched one cannot reach the server at all.
- **Degradation checked, not assumed.** A production build with
  `GEMINI_API_KEY` blanked answers 503 `unconfigured` on the draft route,
  and the diary's message points at building the recipe by hand instead.
- **Live model check kept:** `draft-recipe.integration.test.ts` asks
  Gemini for the dish and asserts every intent has exactly three keys, a
  usable unit, and that chicken and rice are among them — a claim about a
  model, checked against one.
- **Suites:** 663 unit tests (up from 629), 15 live, typecheck, lint and
  build all pass. Migration 0011 applied to development and production.
  The development fixture was deleted afterwards; development is back to
  2 accounts and 0 recipes.

### Hardening pass, 2026-09-07 (Claude Code)

Six items, each committed, pushed and deployed on its own, and each tested
before the next was started.

**1. Signup closed.** `SIGNUP_ALLOWLIST` gates the signup action before
Supabase is reached; unset means nobody, which is the direction it has to
fail in. The allowlist alone would not have closed this: the publishable
key is in the client bundle by design, so Supabase's own `/auth/v1/signup`
is reachable without going near our code — verified by creating an account
that way against development, which the gate never saw. `disable_signup`
is therefore set on the production project, and that endpoint now answers
422 `signup_disabled` while the sign-in endpoint still answers 400 on bad
credentials. Verified against `npm run build` + `npm start`: a
non-allowlisted address is refused and creates no row; an allowlisted one
passes and the account appears in the database. Both fixtures deleted.
Live: `/signup` on the deployment renders the closed state, not a form.

**2. Custom food edits are atomic.** `save_custom_food` (migration 0009)
does the whole three-table write in one `security invoker` function, so
RLS still decides what it may touch and a function body is one
transaction. `supabase/tests/custom_food_atomicity.sql` hands it a calorie
figure the column will not accept and asserts the name and brand changed
by the earlier statement are back as they were; it also checks the good
path lands in full, that another user cannot edit through the function,
and that anon cannot execute it. Inverting one assertion makes the run
fail. Passes against development and production.

**3. A deleted account's session ends.** A verified token with no
`profiles` row behind it is a deleted account, and the signed-in surfaces
already load the profile, so nothing extra is asked of the database. The
sign-out happens in `/auth/session-ended` because a server component
cannot write cookies — the first attempt cleared them from the layout,
which looked like it worked and left the browser presenting the same dead
token. Verified against the production build: signed up, deleted the
account underneath the live session, and watched `/dashboard` go 307 to
`/auth/session-ended` to `/login`, with four Supabase cookies before and
zero after.

**4. The food cache expires.** `foods.refreshed_at` and a thirty-day
window (migration 0010). A search already fans out to the providers, so a
stale row whose provider answered in that same search is written back for
no extra request; a barcode lookup adds one request, because a scanned
packet is where a corrected figure matters most. The permission is
narrow — a shared row is writable only when stale, and a fresh one is
immutable to everyone. `supabase/tests/cache_refresh_history.sql` logs an
entry, refreshes the food underneath it, and asserts the entry still reads
200 kcal; then that the refresh closed the window behind it, that a
private food is never unlocked by staleness, and that anon can write
nothing. Inverting the history assertion makes it fail.

**5. The assistant remembers a thread.** `recentTurns` carries the last
six messages back through `toFoodText` — the same gate a new question
passes — and drops what fails, so the boundary is unchanged in kind.
Verified against the real model: asked for the calories in chicken breast,
then asked "and how much protein was that?", a sentence naming no food,
and got an answer about chicken breast's protein. That check is kept as a
live test.

**6. One-word searches rank by what the owner eats.** `loggedFoodCounts`
breaks a relevance tie with the user's own diary, so a food they have
logged before outranks one they never have. Strictly a tie-break: with
fifty logged entries behind "Chicken breast", a search for "dubai
chocolate" still returns Dubai chocolate first.

**Throughout:** 629 unit tests (up from 591), 14 live provider tests,
typecheck, lint and build all pass. Migrations 0009 and 0010 applied to
development and production, and the production RLS audit passes with them.
Production data untouched: 4 accounts, 8 food logs, 4 weigh-ins, 15 shared
cache rows, as before.

### Named restaurant meals and assistant intent, 2026-09-06 (Claude Code)

Finishing work the Codex session left uncommitted when it hit its usage
limit. That session reported "all 574 tests, type checking, lint and the
production build pass" and said it was still checking the real Gemini
parsing path before committing. The first claim did not hold; the second
check had not been done.

| Check | Result |
|-------|--------|
| `npm run test`, first run | **572/574** — 2 failed in `barcode-scanner.test.tsx` |
| Same file, run alone | PASS 6/6 in 394ms |
| `npm run test`, second run | **570/574** — 4 failed across 3 different files |
| `npm run test`, third run | 574/574 |
| After raising the timeout budget | PASS — three consecutive runs, 574/574 each |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 problems |
| `npm run build` | PASS |
| `npm run test:live` | **PASS 13/13** against the real providers |

**The suite was flaky, not broken.** Every failure was a timeout, none
was an assertion, and the files involved changed between runs. The same
barcode-scanner file took 394ms alone and over five seconds inside a
full run: fifty jsdom environments start across all 32 cores at once,
and its cases reset the module registry and re-import a component graph
per test. Vitest's 5s default budgets a test's own work, not its share
of a loaded machine. `testTimeout` and `hookTimeout` raised to 20s.

A run that passes on the third attempt is not a passing suite, and
reporting it as one is how a real regression gets waved through later.

**The Gemini path is verified.** `test:live` exercised it against the
real API on the pinned model, `gemini-3.5-flash-lite`: the spec's worked
example parsed to intent only, a branded product resolved, text
describing no food returned nothing, the correction example read
correctly, an unspecified amount came back as unclear rather than
guessed, and a nutrition question was answered from anonymous figures.
This closes the check the Codex session named but did not complete.

The model note in `gemini.ts` stands: `gemini-2.5-flash` is closed to
new keys and answers 404, so the pin matters and is not cosmetic.

**Not verified here.** Neither the restaurant import nor the proposal
review UI has been exercised in a browser or against production — only
their unit tests and the build. The owner's iPhone checks remain open,
and Phase 11 stays IN PROGRESS for that reason.

### Custom user foods, 2026-09-06 (Claude Code)

Built, tested locally, migrated, deployed and then exercised against the
live deployment with a fixture account, which was removed afterwards.

- **Schema:** one additive migration, `20260906000001_custom_food_archive`,
  adding `foods.archived_at`. Applied to development through the Supabase
  MCP server — which stays pointed at development only — and to production
  through the authorized migration connection over TLS. Production now
  reports 8 migrations applied.
- **Reading a label:** figures go in per 100 g or per serving, and the
  conversion happens server-side in `custom-input.ts`. The caps are
  checked after the conversion, where an impossible figure actually shows
  up: 20 g of protein in a 45 g bar is ordinary, the same figure against
  a 5 g serving is 400 g per 100 g and is refused by name rather than by
  constraint violation.
- **Search:** custom foods come back from the cache query, badged "Yours",
  and are visible to nobody else — RLS does that, and the query does not
  filter by user at all.
- **Ownership, proven from outside the app:** the RLS suite now has a
  custom-food section. As user B: A's food is invisible, and rename,
  archive and delete each match zero rows; an insert claiming A's
  ownership is rejected outright. The section was checked by inverting one
  of its assertions and watching the audit fail, so it is not passing
  vacuously.
- **History, proven at the database level:** the same section logs an
  entry against a custom food, corrects the food's calories and protein,
  and asserts the entry's own figures are unchanged; then archives the
  food and checks the entry still resolves; then confirms the database
  refuses to delete a food a diary entry references.
- **History, proven on the deployment:** a food entered as 200 kcal per
  45 g bar stored as 444 kcal/100 g and logged at 200 kcal. Editing it
  twice — to 500, then to 600 kcal/100 g with the bar re-weighed to 50 g —
  left that entry at exactly 45 g and 200 kcal, in the UI and in the
  database, while a fresh log of the same food came out at 50 g and
  300 kcal. Retiring it removed it from the library and from search and
  left both entries named and intact.
- **DEFECT FOUND AND FIXED during that pass:** the second edit of any food
  with a serving failed with `food_servings_food_label_key`. Servings were
  being replaced wholesale, but a serving pinned by a diary entry is
  deliberately kept, so the row being re-inserted was still there.
  Servings are now matched by label and the default flag is cleared before
  it is reclaimed. Two regression tests cover it. The failure also left
  nutrition already written while the page showed the old figures, so the
  writes are now ordered servings-first; the residual window is under
  KNOWN ISSUES.
- **Barcode changes confirmed deployed** at the same time: with no
  `BarcodeDetector` in the audit browser the scan button is enabled and
  carries no "this browser cannot read barcodes" alert, which is the whole
  point of the fallback. Pressing it fails with `no-camera` rather than
  `decoder-unavailable`, and since the decoder loads before the camera is
  requested, that is proof the ZXing chunk downloaded and instantiated
  from the deployment. Typing 3017624010701 into the new manual field
  resolved Nutella (Ferrero, 539 kcal/100 g) through Open Food Facts.
- **Tests:** 539 total, up from 512. New: 14 on reading a label, 11 on the
  CRUD decisions (including that the update path writes to no logging
  table, and that a rejected edit writes no nutrition), 2 on `cacheFood`
  refusing to create an ownerless custom food. `npm run typecheck`,
  `npm run lint` and `npm run build` all pass.
- **Production afterwards:** the RLS audit passes, and the fixture account
  was deleted by exact identity — 4 users, 4 profiles, 8 food logs,
  4 weigh-ins, 0 custom foods, and 15 shared cache rows (one more than
  before, from the barcode lookup). Those 4 accounts are the owner's; see
  KNOWN ISSUES.
- **Deployment:** `caldef-woad.vercel.app` serves the build containing all
  of this. **The project auto-deploys `main`** — confirmed by watching a
  production build start six seconds after a `git push` and take the
  production alias when it went ready. That is new since the CLI deploys
  earlier in the session, and it changes what a push means: pushing to
  `main` now ships to production. Nothing here relies on it — every
  deployment in this session was also made explicitly — but a future
  session should not treat a push as an internal act.

### Pending states on every server-bound control, 2026-09-06 (Claude Code)

- **The complaint:** tapping a control gave no sign it had registered, so
  the app read as broken and invited a second tap.
- **What was actually true**, established by a probe test rather than by
  eye: the `useActionState` forms — logging a food, saving settings,
  recording a weigh-in — did disable on pending and did *not* double-fire.
  The plain `<form action={serverAction}>` forms had no pending state at
  all and **did** fire twice on two clicks: Remove entry, the favourite
  star, delete weigh-in, delete recipe, delete saved meal, remove
  ingredient, end phase, sign out, delete conversation. On the star that
  is not harmless — twice means back where it started.
- **One component, everywhere:** `PendingButton` takes its pending state
  from `useFormStatus` when it sits in a form and from a `pending` prop
  otherwise, so a plain server-action form in a server component gets
  feedback without becoming a client component. It disables, sets
  `aria-busy`, swaps in a spinner, and takes an optional `pendingLabel`.
  It also refuses a second click within 600 ms — `disabled` arrives with
  a re-render, and a re-render is what a loaded phone defers, which is
  exactly when people tap twice.
- **Navigation too.** Every page here is server-rendered per request, so
  a nav tap is a round trip. `LinkPending` swaps a nav icon (or the
  diary's day arrows) for a spinner via `useLinkStatus` while the route
  loads. Error-boundary retries run through a transition and show the
  same state.
- **Reduced motion:** the spinner carries `motion-reduce:animate-none`.
  The label change, the dimming and `aria-busy` do not depend on motion,
  so nothing is lost when the animation is off.
- **Verified in a real browser**, against the production build running
  locally with a real signed-in account on the development database:
  Search read "Searching…" with `aria-busy="true"`, disabled, spinning;
  Add to diary read "Adding…" the same way; and Remove — the plain
  server-action form that previously showed nothing — came back
  `aria-busy="true"`, disabled, spinning. A nav spinner was observed
  during a real navigation by sampling the DOM across the transition.
  No console errors. The fixture account was deleted afterwards by exact
  identity; development is back to 2 accounts, 2 food logs, 1 weigh-in.
- **Tests:** 512 total, up from 501. Eleven new: the pending states, the
  double-submit guard (including that it clears itself, so a form the
  browser rejected cannot leave a button stuck), the reduced-motion
  class, and `LinkPending` in both states.
- **Still true afterwards:** `npm run typecheck`, `npm run lint`,
  `npm run build` all pass.

### Barcode decoding on iOS, 2026-09-06 (Claude Code)

- **The scanner could never have worked on the owner's phone.**
  `checkScannerSupport` returned `unsupported` and disabled the scan
  button whenever `BarcodeDetector` was absent, which is every browser on
  iOS. The app reported it accurately and the reporting was verified;
  what nobody had checked was that the honest report was the only thing
  an iPhone would ever see.
- **Fixed with a decoder fallback.** `BarcodeDetector` is used where the
  browser has it; where it does not, `@zxing/browser` (MIT, with
  `@zxing/library`, Apache-2.0 — both free, no service and no account) is
  loaded through `await import()` and wrapped in the same interface, so
  the scanning loop has one code path. Formats are restricted to EAN-13,
  EAN-8, UPC-A, UPC-E and CODE-128 — what food packaging carries — and
  the fallback looks at a frame every 200 ms rather than every animation
  frame, because it decodes on the main thread.
- **Bundle:** the decoder is 478 KB uncompressed and lands in its own
  chunk, absent from every page's initial JavaScript. Verified against
  the build output: exactly one chunk contains ZXing, it is not in
  `rootMainFiles`, and nothing on the server side references it.
- **Failure states are now five, not four**, with `decoder-unavailable`
  added for a fallback that fails to download — a network problem, so it
  offers "Try again" rather than sending the user to permissions.
- **Manual barcode entry added.** The number under the barcode can be
  typed at any time, not only after a failure, and resolves through the
  same `/api/foods/barcode` lookup the camera feeds. It is validated
  against the same rule as a scan, so a typo cannot reach a provider.
- **Tests:** 501 total, up from 493. Six new component tests cover the
  Safari-shaped browser (scan offered, not refused), the no-camera and
  insecure-context messages, and manual entry accepting, rejecting and
  clearing. `npm run typecheck`, `npm run lint` and `npm run build` pass.
- **Not verified, and not verifiable here or in desktop Chrome:** the
  fallback decoding an actual barcode through an actual camera. Chrome
  has the native decoder and takes the other branch. This needs the
  iPhone.

### Deployed production verification, 2026-09-06 (Claude Code)

Ran against the live deployment at `https://caldef-woad.vercel.app` with a
real signed-in account, not against a local build.

- **Signed-out surface (re-run after the redeploy):** `/dashboard`,
  `/diary`, `/weight` and `/settings` all 307 to `/login`;
  `/api/foods/search` and `/api/ai/parse` answer 401 as JSON; the login
  page carries CSP, nosniff, frame denial, permissions policy and HSTS;
  the manifest, all icons at their declared pixel sizes, the `no-store`
  service worker and `/offline` all serve correctly; neither
  `GEMINI_API_KEY` nor `USDA_API_KEY` appears in the login HTML or in any
  of the 12 deployed client scripts. PASS.
- **Authentication:** sign-in through the deployed server action returns
  303 to `/dashboard` and sets the session cookie; the no-JS form path
  works, so the progressive-enhancement fallback is real. Sign-out clears
  it and `/dashboard` goes back to `/login?next=%2Fdashboard`. PASS.
- **Food search:** "greek yogurt" returned live USDA and Open Food Facts
  results, correctly labelled "USDA verified" and "Community". PASS.
- **Diary write:** 170 g of USDA Greek yogurt logged from search; the
  stored row is 124.10 kcal against a cached 73.00 kcal/100 g. Every one
  of the seven rows in the account satisfied kcal = grams x per-100 g,
  so the "nutrition is recomputed from the cached row, never taken from
  the client" invariant held on production. PASS.
- **AI parse and log:** "2 large eggs and 40 g of cheddar cheese" was read
  by Gemini into two intents, resolved to real foods, and confirmed into
  the diary. PASS.
- **AI correction:** "it was only 100 grams" on that entry proposed
  "Change to 100 g — 55 kcal instead of 110" and applied it. PASS.
- **Assistant:** answered a nutrition question against the account's own
  targets. PASS.
- **Weight:** a second weigh-in for the same day corrected the existing
  one rather than adding a row — 1 weigh-in, 110.20 kg. PASS.
- **Saved meals, favourites, recipes, phase:** a two-item meal saved and
  listed; a cut phase started, planned to a 101.4–103.6 kg recommended
  band, and ended early. PASS.
- **Barcode:** on HTTPS the scanner reports `unsupported` rather than
  `insecure-context`, which closes the secure-context half of that known
  issue. The camera itself still needs a phone.
- **Browser console:** zero errors across every page visited.
- **DEFECT FOUND AND FIXED — a phase did not govern the day it started.**
  Starting a phase left the diary reading "Daily target · 2015 kcal"
  instead of the phase target, and ending one left the phase target in
  place, until the next day. Cause: today's `daily_targets` row is
  written the first time the diary is opened, and a row for the date
  returned straight out of `getOrCreateDailyTarget` before the régime was
  considered — so rule 1 of `shouldRecomputeTarget`, "a change of régime
  is an event and takes effect immediately", was true in that function
  and nowhere else. Its four unit tests passed throughout, because they
  test the policy and not the read-through. Fixed by reconsidering
  today's stored row when the governor under it has changed, writing with
  an upsert (an insert would have bounced off the row as a duplicate and
  left the superseded number), and never touching a past day. Four new
  tests cover it; two of them fail against the previous code. Redeployed
  and re-verified live: starting a phase now flips the diary to
  "2-Month Cut target · 2008 kcal" the same day, and ending it falls back
  the same day with the "your cut phase has ended" notice.
- **Production database, before and after:** the corrected RLS audit
  passed in a single rolled-back transaction both with the smoke
  account's data present and after cleanup — 20 RLS tables, 80 policies,
  `authenticated` can SELECT, cannot TRUNCATE, `anon` denied. The smoke
  account was then deleted by exact identity, leaving 0 users, 0
  profiles, 0 goals, 0 food logs, 0 weigh-ins, 0 daily targets, 0 private
  foods, 4 reference meal types and the 7 shared cache rows noted under
  KNOWN ISSUES.
- **Production auth configuration verified live:** site URL and redirect
  allow-list are the production origin, minimum password length 8,
  signups enabled, `mailer_autoconfirm` true (see KNOWN ISSUES).
- **Production advisors:** security — 1 WARN,
  `auth_leaked_password_protection`, the accepted free-tier limitation,
  and nothing else; performance — 13 INFO `unused_index` only, expected
  with no traffic.
- **Local suites after the fix:** `npm run test` 493 tests / 40 files
  PASS, `npm run typecheck` PASS, `npm run lint` PASS, `npm run build`
  PASS, `npm run test:live` 13/13 PASS against real USDA, Open Food Facts
  and Gemini.
- Not verified, and not verifiable here: the iPhone install tap and the
  barcode camera.

### Codex takeover and deployment preparation, 2026-09-05–06

- Started from clean `main` at `c431b7c`, tracking `origin/main`; inspected
  the recent acceptance-audit commits and all five handoff documents.
- Vercel connector works; `kuroki13s-projects` reports **Hobby**. Listed
  projects before creating `caldef` (`prj_tlLt15kOBInTkBXMTlQwit3zkwzR`).
  CLI login works and this checkout is linked. Linking appended an OIDC
  token to ignored `.env.local`; all four existing app values remain present.
- No Supabase connector is exposed in this Codex session. CLI login now
  works. Management API verified Melo Org `yvervpwghnrnmguopkdu` is **Free**
  and listed only development `CalDef` before production creation.
- Created `CalDef-prod` (`ccllzuelnjikmdtpuyhj`), eu-west-1,
  `ACTIVE_HEALTHY`, in the second free slot. No branching, paid instance
  size, billing, or paid feature enabled. Generated database password is
  stored privately under ignored `.vercel/`; never printed or committed.
- **Reproduced baseline:** 489 tests / 40 files, TypeScript and lint pass;
  live USDA/OFF/Gemini suite 13/13, with no reported skips. `npm run build`
  passes with 20 routes. Initial sandbox Turbopack port error was cached;
  moving the failed build cache aside and retrying with approved execution
  resolved it. Application source was unchanged.
- **Audit defect fixed:** committed SQL previously selected foreign parent
  IDs after assuming the role that could not see them, and displayed read
  counts without asserting them. Now saves real IDs before the role switch,
  raises on failed reads/writes, tests update/delete isolation on all 20
  tables, and rolls back the whole test instead of leaving seed/teardown
  batches to the operator. Fixed-identity conflicts abort safely.
- **Migration reproducibility defect confirmed:** replaying the six original
  migrations in fresh temporary Postgres (PGlite with a minimal Supabase
  auth schema) creates 20 RLS tables but grants no authenticated reads.
  Added `20260905000001_explicit_api_permissions.sql` to specify CRUD and
  sequence access explicitly and deny API `TRUNCATE`/schema creation.
  Seven-migration local replay and corrected RLS audit pass; rollback leaves
  0 users, 0 foods, 0 logs and exactly 4 reference meal types. This local
  result does not substitute for a production Supabase check.
- **Development verified live:** corrected RLS audit passed in a single
  rollback transaction. 20 RLS tables / 80 policies. Before/after user and
  profile fingerprints match; 2 accounts, 2 food logs, 1 weight entry remain.
  Existing authenticated role has `TRUNCATE`, confirming the new migration
  removes an unnecessary permission. The new migration plus stricter grant/role assertions passed in a second
  development rollback transaction; no persistent dev change was made.
- Development CLI dry-run found historical remote migration timestamps
  `20260810035422` … `20260810035940` differ from committed filenames.
  No migration repair/reset was performed; development history is preserved.
  Production is empty and will be built from committed files directly.
- **Production migration/RLS verification passed:** the initial database
  had 0 users / 0 public tables over a TLS connection validating Supabase's
  root CA. CLI dry-run listed exactly seven committed migrations, then all
  seven applied successfully using the authorized migration connection.
  Live SQL audit passed and rolled back: 20 RLS tables, 80 policies,
  authenticated CRUD, no API truncate, anon denied. Afterwards 0 users,
  foods, food logs and weigh-ins; 4 reference meal types only.
- Vercel production variables configured: public Supabase URL/publishable
  key, sensitive Gemini/USDA keys, pinned Gemini model. No production values
  assigned to preview/development. Canonical domain: `caldef-woad.vercel.app`.
  `.vercelignore` explicitly excludes local env files and operational secrets.
- Chrome login-page render and browser error check passed locally using
  temporary Linux libraries; no system package installation was needed.
- Deployed flows and physical iPhone checks are **not yet verified**.


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

### Acceptance criteria, verified 2026-09-05

Every item in `PRODUCT_SPEC.md` §10, with how it was checked. "HTTP"
means driven over the wire against `next start` with a real Supabase
session cookie; "lib" means the real modules called with a real session
so RLS applies; "unit" means the committed suite.

| Criterion | How | Result |
|-----------|-----|--------|
| Signup / login / logout | HTTP | PASS — session returned immediately, profile auto-created, sign-out returns to `/login` |
| Authorization | HTTP | PASS — signed-out pages 307 to login, API routes 401 JSON, unknown path 404s in-app |
| RLS on every table | SQL | PASS — 20/20 tables, RLS on, 80 policies; read, write, forged-ownership and forged-parentage all denied; anon denied on all 20 |
| Food search | HTTP | PASS — 36 results merged from cache, USDA and OFF |
| USDA provider | HTTP | PASS — verified generic foods returned |
| Open Food Facts provider | HTTP | PASS — branded results, never marked verified |
| Food caching | HTTP | PASS — a cached food ranks first for a query naming it |
| Servings | lib | PASS — 2 × "1 fillet (172 g)" resolved to 344 g |
| Unit conversion | lib | PASS — and a serving amount with no serving is refused, not guessed |
| Diary | HTTP + lib | PASS |
| Daily totals | lib | PASS — 2100 kcal, 160 g protein from stored rows |
| Macros | HTTP | PASS — and the split never exceeds the target |
| Editing / deleting food | lib | PASS — 200 g → 250 g recomputed to 412.5 kcal from the nutrient row; serving amend to 100 g; delete removes the entry |
| Saved meals | lib | PASS — logs as two separate entries |
| Recipes | lib | PASS — logs as one entry, nutrition divided by servings |
| Favourites | lib | PASS — star, list, unstar |
| Barcode lookup | HTTP | PASS — real product resolves; unknown code 404s with a body; malformed code 400s |
| Weight entry | lib | PASS |
| Weight trend | lib | PASS — 104.49 kg latest, 105.86 kg trend; the trend lags, as smoothing should |
| Adaptive TDEE | lib | PASS — 3123.7 kcal, adaptive, high confidence on 56 days |
| Weekly check-in | lib | PASS |
| Goal projection | lib | PASS — "At this pace 90 kg is about 18 weeks away" |
| 2-Month Cut: feasibility engine | unit + lib | PASS — both spec 8.2 worked examples |
| 2-Month Cut: rate guardrails | unit | PASS — swept across every weight and expenditure |
| 2-Month Cut: milestones | lib | PASS — START + W1..W8, and future rows rebase onto the trend |
| 2-Month Cut: four-line graph | lib | PASS — 56 points; actual and trend stop at today, recommended and stretch span the phase |
| 2-Month Cut: checkpoints | lib | PASS — days 1, 7, 14, 28, 42, 56 |
| 2-Month Cut: day-56 report | lib | PASS — 5.31% bodyweight lost, 0.756 kg/week average, 56-day streak, Phase 2 proposed |
| AI food parsing | HTTP | PASS — three proposals, macros from the matched food, no nutrition on the intent |
| AI correction | HTTP | PASS — "actually that was 250g" previews without writing |
| AI assistant | HTTP | PASS |
| With `GEMINI_API_KEY` unset | HTTP | PASS — 19/19; every page renders, search and barcode work, AI controls are absent rather than broken, routes 503 `unconfigured` |
| Error handling | HTTP | PASS — 404 renders in-app; four boundaries added this pass |
| Mobile layout | HTTP | PASS — sidebar hidden below `md`, bottom tab bar shown, content padded clear of it, `viewport-fit=cover` |
| PWA install | HTTP | PASS on everything the tap depends on; **the tap itself is unverified** — see KNOWN ISSUES |
| Rate limiting | HTTP + unit | PASS — 429 with `Retry-After`, `reason: "too-many-requests"`, and the shared upstream bucket binds across routes |
| Privacy / data minimization | unit | PASS — every request body asserted against a battery of real personal data, by value and by shape |
| API-secret security | build | PASS — neither key, neither provider host, nor the system prompts appear in `.next/static`; a client string does |
| TypeScript | `tsc --noEmit` | PASS |
| Lint | `eslint` | PASS — 0 problems |
| Tests | `vitest run` | PASS — 489 tests, 40 files |
| Production build | `next build` | PASS — 20 routes |
| No TODO/FIXME/placeholder/mock/fake/hardcoded data | grep | PASS — none in shipped paths |
| No unimplemented buttons | grep + audit | PASS — two found and fixed this pass |

**Starvation-level targets.** No path can produce one.
`safety.property.test.ts` sweeps `dailyTargetFor` and `recommendPlan`
across 8 weights × 8 expenditures × 4 goal types × 6 protein settings ×
5 targets × 6 windows and asserts every result sits at or above
`max(1200, 60% of expenditure)`. `daily_targets.calories` carries a
`check (calories between 800 and 10000)` as a structural backstop that
should never be what stops a bad number.

**The 90 kg goal is never an 8-week prescription.** `assessTarget`
reports it honestly as unachievable (implied intake ~359 kcal);
`recommendPlan` caps the rate at the top of the recommended band and
floors the calories regardless of the ask; the phase stores the four
concepts separately; and the dashboard states the goal as a date at the
current pace.

**Gemini receives only food text.** `privacy.test.ts` captures every
request body the provider produces across all three call paths and
asserts that an email, a user id, a display name, a birth date, an
address, a phone number, a JWT and the Supabase key prefixes appear in
none of them — and that nothing email-, UUID- or JWT-shaped survives
whatever its value. The correction prompt is asserted as an exact
string; the figures render from a fixed label list, so a field added to
`AnonymousFigures` cannot start being sent without someone writing its
label.

### Acceptance audit, 2026-09-05

A hostile pass over every requirement in `PRODUCT_SPEC.md` §10, run as
though another team had built this. Findings were fixed, not merely
listed; each fix is its own commit.

**Eleven defects found and fixed.**

Safety, from an adversarial grid over every weight, expenditure, goal
type, protein setting, target and window:

1. `recommendPlan` skipped the calorie floor on its maintenance branch,
   so an expenditure estimate below 1200 kcal printed a sub-floor
   target — while `dailyTargetFor` floored that identical situation.
   Two paths disagreeing about the same day, and the disagreeing one was
   the path used inside a cut phase.
2. `macroTargets` could allocate more energy than the target contained.
   `protein_g_per_kg` accepts up to 4.0 and bodyweight-derived protein
   grows at roughly the rate the floor does, so a heavy user at a high
   setting could ask for more protein energy than the whole target held.
   It answered by zeroing carbohydrate and pushing fat below the 20%
   floor its own doc promised. Fat now keeps its floor; protein is
   capped at what remains.
3. `RecommendedPlan.projectedGoalDate` was declared, documented and
   `null` on every path, read by nothing.

Correctness and completeness:

4. The phase graph plotted 57 points for a 56-day phase, and the stretch
   line therefore reached its goalpost one day after the phase ended.
5. The milestone table rendered week 0 as a bare "0" in a Week column.
6. **Nothing recomputed the milestones.** Spec 8.5 says they are
   estimates recomputed as real data arrives and `milestones.ts`
   documents them as bending with the trend; the ladder stayed frozen at
   the rate set on day one. `rebaseFutureMilestones` now runs on each
   weigh-in, rebasing future rows onto the current trend and leaving past
   rows as the record of what was projected at the time.
7. **There were no error boundaries at all.** Every `src/lib` module
   throws on a Supabase failure, and this runs on a free plan that pauses
   after a quiet week. Added `(app)/error.tsx`, `error.tsx`,
   `global-error.tsx` and `not-found.tsx`.
8. The diary offered a "Describe a meal" box and an Amend control gated
   on the user's AI switch but not on whether a model key exists — so a
   deployment without one showed controls that could only ever answer
   "not configured". The acceptance criteria forbid unimplemented
   buttons and these were two.
9. **An open-redirect bypass on the post-login hop.** `?next=` was
   guarded with "starts with `/`, not `//`", which misses `/\evil.example`
   — browsers normalise the backslash and navigate off-site. Replaced
   with a whole-value path match in `lib/safe-redirect.ts`.
10. Onboarding did not work without JavaScript (a known issue carried
    across four phases with its own fix written down and never applied),
    and the timezone it defaulted could not be corrected afterwards
    because settings never exposed the field. Settings now re-syncs it
    from the browser on every save. Settings was also missing
    onboarding's 13–120 age range, so an out-of-range date reached the
    column check and showed a raw Postgres message as guidance.
11. `deleteConversation` was written, documented as letting the owner
    delete what they had asked, and never wired up. Also removed two
    genuinely dead exports (`recomputeMilestones`, `resolveToCachedId`).

**Two things fixed that were about the suite rather than the app.** The
live provider suite failed when Open Food Facts was merely overloaded —
confirmed by hand as a 503 — which is the shape of a test people learn to
ignore. It now reports and skips that specific condition, as the Gemini
quota case already did. The retry backoff behind it was also too short to
help: 150 ms retried straight back into the same overload, now 0.4 s and
0.8 s, which helps real users too.

**Three things checked and found correct**, recorded because "I looked"
is worth as much as "I fixed": the recommended range is derived from the
safe rate band independently of the stretch ask, so the two may
legitimately overlap and `describeProjection` already handles it; the
nine milestone rows are START plus W1..W8, which is spec 8.5's own
roadmap; and the final goal is always given as a date at the current pace
("At this pace 90 kg is about 18 weeks away"), never as an eight-week
prescription.

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

Historical Phase 6 teardown result: its test accounts were removed and
fixture tables were empty then. This is not the current development data
state; the owner's real account and history now exist and are preserved.
