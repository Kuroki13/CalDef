# CalDef — Product Specification

Permanent source of truth for this project. Keep synchronized with the
implementation. If a requirement here conflicts with something said in
conversation, this document wins until it is explicitly amended.

`CLAUDE.md` holds the binding operational constraints (zero cost,
secrets, Supabase setup). This document holds the product.

---

## 1. What this is

A personal nutrition and body-recomposition tracker for a single primary
user, delivered as an installable PWA. It combines food logging (typed,
natural-language, or barcode), a real nutrition database, and an
adaptive expenditure model that learns actual TDEE from observed intake
and weight trend rather than trusting a formula forever.

The differentiator versus a MyFitnessPal clone is the **adaptive TDEE
engine** plus the **2-Month Cut phase mode** (section 8).

Not a medical device. The UI must state that it provides estimates for
personal tracking, not medical or dietary advice.

## 2. Users and auth

- Supabase Auth, email/password to start.
- Every row of user data is owned by `auth.uid()` and protected by RLS.
- Single-user in practice, but the schema must be correctly multi-tenant.

## 3. Data model

Tables (Postgres, created only via `supabase/migrations/`):

    profiles              user profile, sex, height, birth date, units
    goals                 final goal weight, goal type, activity level
    daily_targets         per-day calorie and macro targets
    foods                 canonical food records (cached from providers)
    food_servings         serving sizes and gram equivalents per food
    food_nutrients        per-100g nutrient values per food
    food_logs             a logged food entry, with amount and meal
    meal_types            breakfast / lunch / dinner / snack
    weight_entries        daily weigh-ins
    tdee_estimates        rolling adaptive expenditure estimates
    weekly_checkins       weekly summary + adjustment decisions
    recipes               user-defined recipes
    recipe_ingredients    components of a recipe
    saved_meals           reusable meal groupings
    saved_meal_items      components of a saved meal
    favorite_foods        quick access list
    ai_conversations      assistant threads
    ai_messages           messages within a thread
    cut_phases            a bounded phase (see section 8)
    cut_phase_milestones  weekly milestone targets for a phase

Every table requires: primary key, correct foreign keys with sensible
`on delete` behavior, indexes on lookup columns, `created_at` /
`updated_at` with an `updated_at` trigger, a `user_id` ownership column
where applicable, and RLS policies for select/insert/update/delete.

The database must be reproducible from migrations alone. Never create a
table by clicking in the Supabase dashboard.

## 4. Food data providers

    Food search ──┬── USDA FoodData Central   (generic foods)
                  ├── Open Food Facts         (packaged goods, barcodes)
                  ├── Local cache (Postgres)  (previously seen foods)
                  ├── Custom user foods
                  └── Recipes / saved meals

Rules:

- Implement behind a `FoodProvider` interface so providers are swappable
  and testable. No provider-specific types leaking into UI code.
- USDA for generic whole foods (chicken breast, rice, eggs, banana).
- Open Food Facts for branded and barcoded products, including French
  supermarket items. Use API v3 for new integrations. Send a
  descriptive User-Agent identifying this app.
- Cache every resolved food into `foods` / `food_servings` /
  `food_nutrients`. Logging the same chicken breast repeatedly must not
  repeatedly hit an external API.
- Open Food Facts data is community-contributed. Retain and display the
  source of each food. Do not present every entry as verified.
- Handle provider outages gracefully: a dead provider degrades search,
  it does not break the app.

## 5. The AI layer

### The LLM must never calculate calories

This is the central architectural rule of the AI feature. Given:

    I ate 200g chicken, 150g rice and one tablespoon olive oil

Gemini's only job is to return structured intent:

```json
{
  "foods": [
    { "query": "chicken breast cooked", "amount": 200, "unit": "g" },
    { "query": "white rice cooked",     "amount": 150, "unit": "g" },
    { "query": "olive oil",             "amount": 1,   "unit": "tbsp" }
  ]
}
```

The backend then matches foods, converts portions, computes calories and
macros from real nutrient data, and writes the diary entry. Never let
the model invent nutrition numbers.

### Provider abstraction

All model calls go behind an `LLMProvider` interface. Gemini free tier
is the default implementation. **The app must remain fully functional
with the AI disabled or unavailable** — manual search and logging is the
fallback path, not an afterthought.

### Data minimization

Gemini calls carry food text only. Never names, emails, addresses,
weight history, account profile, or user IDs. Enforce this structurally:
one server-side call site whose input type is food text, not a user
object. See `CLAUDE.md`.

### Features

- Natural-language food logging (above).
- AI correction: "actually that was 250g, not 200g".
- Assistant chat scoped to nutrition questions, with the user's
  aggregate numbers passed as anonymous figures, never identity.

## 6. Adaptive TDEE engine

Formula estimates are a starting point, not the truth.

    START 111.8 kg
      ↓ initial estimated TDEE ≈ 3357 kcal
      ↓ initial calorie target ≈ 2250 kcal, protein ≈ 180 g
      ↓ daily food logs + daily weigh-ins
      ↓ smoothed weight trend (moving average, not raw scale values)
      ↓ estimated REAL expenditure
      ↓ weekly target adjustment

Requirements:

- Smooth the weight signal. Never react to a single day's scale change.
- Derive actual expenditure from observed intake versus trend change.
- Adjust targets weekly at most, and only with sufficient data.
- Surface the estimate to the user: "your actual expenditure looks
  closer to 3180 kcal than the 3357 we assumed."

## 7. Core features

Authentication · food search · food logging · meals · calories and
macros · weight entry · charts · adaptive TDEE · recipes · saved meals ·
barcode scanning · AI parsing · AI assistant · responsive mobile UI ·
RLS security · PWA installability.

PWA: installable via Safari → Share → Add to Home Screen. No App Store,
no Apple Developer account.

---

## 8. 2-Month Cut / transformation mode

A dedicated goal mode called **"2-Month Cut"**, fixed duration 8 weeks
(~56 days), starting the date the plan is activated.

### 8.1 Goal hierarchy

The app must distinguish four separate concepts and never collapse them:

    FINAL GOAL       90 kg
    CURRENT PHASE    8-week cut
    PHASE TARGET     adaptive, ~103-105 kg recommended
    STRETCH TARGET   99 kg

Starting weight for the initial configuration: **111.8 kg**.

90 kg remains the overall goal, but the app must **not** attempt to
drive 111.8 → 90 kg in 8 weeks, because that requires an unreasonable
deficit. The user may visually aim at the stretch target, but safety
logic overrides calorie recommendations.

### 8.2 Target feasibility engine

Given current weight, target weight and target date, compute: weight to
lose, days and weeks remaining, required kg/week, required % bodyweight
per week, approximate required deficit, and implied intake.

Worked example (111.8 → 99 kg in 56 days):

    difference           12.8 kg
    required rate        ~1.6 kg/week
    theoretical deficit  (12.8 x 7700) / 56  ≈ 1760 kcal/day
    at TDEE 3357         implied intake ≈ 1600 kcal/day
    classification       "Very aggressive"

**Do not recommend 1600 kcal merely because the arithmetic produces it.**
Compute a safer adaptive target from real expenditure, weight trend and
bodyweight-relative rate instead.

Worked example (111.8 → 90 kg in 56 days):

    difference           21.8 kg
    required rate        ~2.7 kg/week
    theoretical deficit  ~3000 kcal/day
    classification       "Not a realistic fat-loss target for this timeframe"

In that case explain that 90 kg stays the long-term goal and the 8-week
phase uses an intermediate target.

### 8.3 Rate guardrails

Evaluate rate as percentage of bodyweight per week:

    < 0.5%/week        Slow
    0.5% - 1.0%/week   Typical effective fat-loss range
    1.0% - 1.25%/week  Aggressive
    > 1.25%/week       Very aggressive / review target

Guidance labels, not medical diagnosis. If a requested target requires a
rate above the safety threshold, **do not generate an extreme calorie
target**. Show:

> Your target date is more aggressive than the recommended rate
> supported by your current data.

then present the recommended projected end weight, the stretch target,
and an estimated date for the final goal.

### 8.4 Phase dashboard

A dedicated card showing: day N of 56, starting weight, current weight,
recommended end-of-phase range, stretch target, final goal, weight lost,
days remaining, current trend, projected 8-week weight, and a progress
bar. Also: days completed, percent of phase complete, average calorie
intake, average protein, adherence percentage, average weekly change.

### 8.5 Weekly milestones

Dynamic, from the adaptive trend engine — **not** a flat 1 kg subtracted
per week. Initial illustrative roadmap:

    START 111.8 · W1 ~110.7 · W2 ~109.6 · W3 ~108.5 · W4 ~107.4
    W5 ~106.3 · W6 ~105.2 · W7 ~104.1 · W8 ~103

These are estimates, not mandatory numbers. Recompute as real data
arrives. Display the stretch path to 99 kg clearly separated from the
recommended trajectory.

### 8.6 Countdown and projection

Home screen shows days left, current weight, 8-week projection, stretch
and final goals. Recalculate daily:

> At your current rate, you are projected to reach approximately
> 103.4 kg by the end of this phase. 99 kg would require a
> significantly faster loss rate.

with current rate, required rate, and the difference. **Never shame the
user for missing the stretch target.**

### 8.7 Phase progress graph

X axis day 1 → 56, Y axis body weight. Four lines: actual daily weight,
smoothed trend, recommended trajectory, stretch trajectory to 99 kg.
Marker at 90 kg final goal — without generating an extreme 8-week
prescription to reach it.

### 8.8 Adaptive calories within the phase

Calorie targets are **not** fixed for 8 weeks. Start ~2250 kcal and
~180 g protein, then update from intake, weigh-ins, smoothed trend and
activity. Example: by week 3 adaptive TDEE reads 3200 with a
-0.9 kg/week trend → recommend ~2150-2250 kcal.

### 8.9 Initial water weight

The first 1-2 weeks may drop faster due to glycogen, water, sodium and
food volume. Do not treat early loss as pure fat loss, and do not make
large TDEE revisions from the first few days.

### 8.10 Checkpoints

Day 1 baseline · Day 7 · Day 14 · Day 28 halfway · Day 42 · Day 56 final.

Halfway and final reports show starting/current weight, total lost,
trend, average calories and protein, estimated TDEE, projected day-56
weight, stretch and final goals — with an AI-written explanation of
progress. The day-56 report also covers percentage bodyweight lost,
average weekly loss, best adherence streak, and weight/calorie/macro
graphs, then proposes **Phase 2** toward 90 kg with a new adaptive
timeframe and target.

The mode must prioritize muscle retention, adequate protein, resistance
training and sustainable intake. It must never produce starvation-level
targets to hit an arbitrary date.

---

## 9. Security

Per `CLAUDE.md`, and additionally:

- RLS on every user-owned table, with policies actually tested.
- Run Supabase security advisors and act on findings.
- Server secrets never reach client JavaScript.
- Rate limit the AI and external-provider routes.
- Development/test data only while MCP has write access.

## 10. Acceptance criteria

A feature is done when it is implemented, tested, and verified — not
when it compiles. Before any production claim, all of the following must
pass: signup/login/logout, authorization, RLS, every table, food search,
USDA provider, Open Food Facts provider, caching, servings, unit
conversion, diary, daily totals, macros, edit/delete food, saved meals,
recipes, barcode lookup, weight entry, weight trend, adaptive TDEE,
weekly check-in, goal projection, the full 2-Month Cut mode, AI parsing,
AI correction, AI assistant, error handling, mobile layout, PWA
behavior, privacy, API-secret security, rate limiting, TypeScript, lint,
tests, and a clean production build.

No `TODO`, `FIXME`, placeholder, mock, fake, or hardcoded test data in
shipped paths. No unimplemented buttons.
