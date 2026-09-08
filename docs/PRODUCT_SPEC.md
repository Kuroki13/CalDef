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
  aggregate numbers passed as anonymous figures, never identity. A
  follow-up may refer back to the last few turns of its own thread; every
  one of them is re-checked as food text on the way out.
- **AI-drafted recipes**, for a home-cooked dish no food database holds —
  "chicken maqlouba". Offered when a search returns nothing that accounts
  for what was typed.

### AI-drafted recipes are not AI-generated nutrition

The same rule as everywhere else, stated here because this is the feature
where it would be most tempting to break: given a dish name, the model
returns **ingredients and amounts only**, in the same
`{query, amount, unit}` shape the parser returns. It is asked what goes
into the dish, never what the dish contains.

    chicken maqlouba
      -> [ { "query": "chicken thigh",  "amount": 800, "unit": "g"  },
           { "query": "basmati rice",   "amount": 500, "unit": "g"  },
           { "query": "aubergine",      "amount": 400, "unit": "g"  } ]

Each ingredient is then resolved against USDA, Open Food Facts and the
cache exactly as manual logging resolves a search, and the recipe's
nutrition is computed from the matched foods' own nutrient rows.

Requirements:

- The draft is shown for review before anything is saved. Every amount is
  editable, ingredients can be removed or added, and the serving count is
  set by the user.
- An ingredient the providers cannot resolve is **shown as unresolved**
  and must be replaced or removed. It is never guessed at, and never
  silently dropped — dropping it would make the total quietly too low.
- The result is an ordinary private recipe (`recipes` /
  `recipe_ingredients`), marked with the date it was drafted. Nothing is
  written to the shared food cache except the provider foods themselves.
- The UI states which half was estimated and which was computed.
- Only the dish name reaches the model. With the AI unavailable, the same
  recipe is built by hand.

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

---

## 11. Product direction: food understanding

Everything in sections 1–10 stands. This section extends the
specification; it does not replace any existing requirement.

CalDef should not merely count calories. It should understand what the
user eats, determine how reliable that information is, learn how the
body responds to the actual diet, and gradually adapt the plan.

The user must be able to say any of these and be understood:

    I ate 400 g maqlouba, some laban and a Harvey's Angus burger.
    اكلت مقلوبة دجاج و 8 ورق عنب
    À midi j'ai mangé 8 warak enab viande et un peu de labneh.
    akalet ma2loubeh djej w warak 3enab

**Understanding the name of a dish is not knowing its nutrition.** For
culturally variable foods — maqluba, warak enab, shawarma, couscous,
molokhia — the system must: identify the likely dish; identify important
variants; search personal recipes and custom foods first where
appropriate; search reliable nutrition sources; ask the minimum
clarification needed when ambiguity materially changes nutrition; label
estimates clearly; and never silently pick an arbitrary calorie value.

### 11.1 The rule that does not bend

§5's rule is unchanged and governs everything below. The AI understands
**food and intent only**. It must never supply kcal, protein,
carbohydrate or fat values, arbitrary restaurant nutrition, or gram
conversions without a documented basis. Nutrition is always resolved
deterministically against stored food, recipe or provider data, or is
explicitly labelled an estimate.

Two concepts stay separate:

- **Food semantics** — "what is maqluba?"
- **Nutrition data** — "what nutrition applies to *this* maqluba?"

An ontology may know maqluba commonly contains rice, meat or chicken and
vegetables. That does not establish the calories of the user's portion,
and generic semantic ingredients must never be stored as if they were
the user's actual recipe.

### 11.2 Resolution priority

Conceptual, not a rigid global sort — text relevance and context still
matter. Searching "Harvey's burger" must not return a favourite chicken
breast merely because it is eaten often.

1. Exact personal custom food
2. Exact personal or family recipe
3. Previously used exact food
4. Official restaurant menu item
5. Exact branded or barcoded product
6. Appropriate official generic-food database
7. Open Food Facts branded or community result
8. Generic cultural recipe estimate
9. Rough user estimate

### 11.3 Confidence

Uncertainty must exist explicitly rather than be disguised as precise
data. **False precision is worse than honest uncertainty.**

| Level | Example |
|-------|---------|
| Exact / High | Custom food from a packaging label; personal recipe with known amounts; exact official restaurant item; reliable branded product |
| Strong | Clear generic match from an official database |
| Estimated | Generic cultural dish; restaurant meal with partial information; approximated portion |
| Rough | Ambiguous free text; incomplete restaurant estimate |

Do not over-engineer the labels initially. Daily summaries may
eventually say: "Approximately 2,250 kcal. 27% of today's intake comes
from estimated foods." Food confidence feeds daily data confidence,
which later feeds adaptive TDEE confidence.

---

## 12. Phase 12 — Personal Food Intelligence

Teach CalDef the foods the user personally eats, so logging becomes
faster and more accurate over time. The app progressively becomes a
personal food database.

**12A — Custom Food Studio.** Complete custom user foods if anything is
missing. Identity: name, optional brand, barcode, notes/category.
Nutrition basis: per 100 g, per 100 ml where supported, per serving
where a reliable serving weight is supplied. Core: calories, protein,
carbohydrates, fat. Optional: fiber, sugar, saturated fat, sodium.
Optional serving definitions — "Protein yogurt, 72 kcal/100 g, 160 g per
pot" so the user can later log "1 pot".

Create, edit, delete. Owner-only visibility and modification. Search and
diary integration. Historical nutrition preserved on edit. A clear
user-entered source badge. No provider or AI required. Logging goes
through the normal authoritative calculation path.

**12B — My Foods.** A personal library: recent, frequent, favourites,
custom, recipes, saved meals, scanned. Foods already used must be easier
to find than obscure provider results. Avoid clutter; adapt to the
existing UI.

**12C — Personal ranking.** Signals: text relevance, favourite,
previously logged, frequency, recency, custom food, personal recipe,
source quality, provider relevance. A chicken breast logged 28 times
should outrank an obscure match for "chicken" — but personalization must
not override an obviously stronger textual match.

**12D — Typical portions.** Learn usual amounts from the user's own logs
(178, 192, 185, 181 → "your usual amount: about 185 g"). Always a
suggestion; never silently change an amount.

**12E — Log again / repeat.** Log this food again, repeat breakfast or
lunch, copy yesterday's meal or foods, reuse a saved meal. Portions
adjustable before submission. Duplicate submissions prevented.

**12F — Flexible meal templates.** Saved meals become templates whose
individual amounts can change at log time, not immutable prescriptions.

**12G — Quick Add.** Approximate kcal/macros without creating a
permanent food — "750 kcal, 45 g protein". Clearly labelled a user
estimate. Never masquerades as verified nutrition, and does not become a
reusable food unless explicitly saved.

**12H — Confidence foundation.** Introduce the levels in §11.3.

---

## 13. Phase 13 — Universal / multilingual / cultural food intelligence

A food-resolution system, not an AI calorie estimator.

**13A — Multilingual input.** English, French, Arabic, Arabic dialect,
Arabic transliterated into Latin script, Arabizi with numerals, mixed
sentences, spelling variation and common mistakes. `مقلوبة`, `maqlouba`,
`maqluba`, `makloubeh`, `maqlooba`, `ma2loubeh` all reach the same
concept — without pretending every maqluba recipe has the same
nutrition.

**13B — Cultural alias layer.** Store identity and semantics first, not
one calorie number per dish: canonical name, Arabic name, aliases,
possible variants (chicken, lamb/beef, eggplant, cauliflower, potato,
mixed vegetable), region, food family. Identification first; nutrition
resolution afterwards.

**13C — Arabic coverage.** A focused high-value set before breadth,
prioritising Palestinian, Lebanese, Syrian, Jordanian, Egyptian, Gulf,
and useful Maghrebi foods: maqluba, musakhan, maftoul, warak enab, warak
dawali, yalanji, yabrak, kibbeh, shish tawook, shawarma, falafel,
hummus, moutabal, baba ghanoush, labneh, fattoush, tabbouleh, manakish
(zaatar and cheese), fatayer, molokhia, kofta, kabsa, mansaf, koshari,
foul, msabbaha, couscous, merguez. Not exhaustive — aliases and regional
difference matter more than dish count.

**13D — Variants.** Never collapse nutritionally different foods. "Warak
enab" may be vegetarian rice-filled, rice and meat, yalanji, or a family
preparation. Shawarma varies by chicken/beef, sandwich/plate, pita/saj,
fries inside, sauces, restaurant versus homemade. Ask only the most
useful question.

**13E — Minimal clarification.** Ask only when uncertainty materially
changes the result. Good: "Chicken or meat maqlouba?" then "grams, small
plate, normal plate or large plate?". Bad: interrogating for every
ingredient. Where history gives a strong estimate, propose it — "your
usual maqlouba plate is about 430 g, use that?" — and let the user
confirm.

**13F — Mixed-language input.** "اكلت اليوم 400g maqlouba و شوي لبن وبعدين
Harvey's Big Angus" resolves to three foods with different resolution
paths and an unclear quantity on the laban. French grammar with Arabic
food terms must work: "À midi j'ai mangé 8 warak enab viande et un peu
de labneh."

**13G — Personal cultural recipes.** A family dish saved as an exact
recipe ("Mom's Chicken Maqlouba") becomes the preferred resolution for
that owner. "I ate 450 g maqlouba" should resolve to it first, with
another interpretation always choosable.

**13H — Family foods.** A category for household-specific foods — Mom's
Maqlouba, Our Warak Enab, Dad's Shawarma. Reusable and private. Build on
existing recipes and custom foods; **do not add a table merely because
the product uses the term "Family Foods."**

**13I — Personal vocabulary.** If the user types "warak" and repeatedly
chooses meat-filled grape leaves, rank that first *for that user*. Same
for "my yogurt", "the usual", "mom's maqlouba". These are personal
preferences, never universal truths — the system must not redefine a
word globally, and every learned mapping must be editable and
reversible.

**13J — French foods.** croissant, pain au chocolat, baguette, jambon
beurre, croque monsieur, quiche lorraine, tarte flambée, gratin
dauphinois, tartiflette, raclette, cordon bleu, steak haché 5%, merguez,
couscous royal, fromage blanc, petit suisse, lardons, galette complète.
Portion language: un pot, une tranche, une demi-baguette, une barquette,
une part, une cuillère, un bol — never converted to grams without a
reliable basis or confirmation. Evaluate ANSES Ciqual *only if* its
current terms, access and licensing fit the zero-cost constraint. Do not
integrate it merely because it exists.

**13K — Canadian foods.** Evaluate the Canadian Nutrient File / Health
Canada data on the same terms. Preserve bilingual naming where useful.
Do not duplicate foods blindly across USDA, French and Canadian sources.
Provenance stays visible.

**13L — Restaurants.** First-class food concepts, starting with
restaurants actually used rather than indexing everything: Harvey's,
McDonald's Canada, Tim Hortons, A&W Canada, Subway, Burger King, Five
Guys. Imperfect naming must work — "Harvey big Angus", "big angus
harveys", "Big Harv". Show candidates when several are plausible.
Nutrition priority: official restaurant data; stored exact official
result; reliable secondary data where explicitly allowed and identified;
clearly labelled estimate only when necessary. **Verify current menu
names and nutrition rather than hardcoding assumptions from this
document.** Gemini must never invent restaurant nutrition.

**13M — Restaurant modifiers.** Bacon, cheese, extra sauce, no cheese.
Use official modifier nutrition where it exists. Where it does not, mark
the modifier as an estimate and never label an official base plus an
estimated addition as exact.

**13N — Confidence-aware resolution.** Every resolved food carries a
confidence state per §11.3, resolved by the priority in §11.2.

### 13.1 What the AI may and may not do here

Gemini's role is semantic understanding: language, food names, aliases,
quantities, units, restaurant, likely variants, likely intended personal
item, and whether clarification is needed. It outputs structured intent,
extended to preserve what the user actually typed:

```json
{"foods": [
  {"query": "chicken maqluba", "amount": 400, "unit": "g",
   "original_text": "ma2loubeh djej"},
  {"query": "meat stuffed grape leaves", "amount": 8, "unit": "piece",
   "original_text": "warak 3enab lahme"}
]}
```

The backend resolves candidates. If "8 pieces" cannot be reliably
converted to grams, ask or use a saved serving conversion.

### 13.2 Privacy

§5's data minimization is unchanged. Never attach profile, email, user
id, weight history or diary history. Resolve personal terminology
server-side where possible; where an utterance like "mom's maqlouba"
must be understood, send only that utterance. **Never attach the
personal recipe database to a model request.** Resolve personal
candidates after semantic parsing where practical.

---

## 14. Later roadmap — documented, not yet permitted

Phases 14–19 are product direction. Do not implement them before 12 and
13 are stable.

- **14 — Adaptive Coaching 2.0.** A weekly decision of KEEP, SMALL
  REDUCTION, SMALL INCREASE, WAIT or INVESTIGATE, explaining trend,
  intake, protein, logging coverage, data confidence and estimated
  expenditure. Calories do not change merely because a week passed.
- **15 — Adherence & behaviour.** Separate calorie, protein, logging,
  weight-coverage and plan adherence; optional hunger, difficulty and
  weekday/weekend signals. Understand *why* progress changed.
- **16 — Smart planning.** Tomorrow planning, meal planning,
  protein-gap awareness, flexible calorie budget — suggested from foods
  actually eaten.
- **17 — Body & performance context.** Waist and body measurements,
  photos, steps, workouts, strength, sleep, resting heart rate. Not
  before the core nutrition experience is excellent.
- **18 — Prediction engine.** Scenario ranges at current behaviour and
  at ±100 kcal. Always ranges with confidence; never a deterministic
  future weight.
- **19 — CalDef OS.** PLAN → EAT → MEASURE → UNDERSTAND → ADAPT → PLAN.

### 14.1 Confidence feeding adaptation

Adaptive TDEE becomes more conservative when nutrition data quality is
poor. Missing logs continue to mean **unknown** intake, never zero. A
weekly recommendation is allowed to say: "We don't have enough reliable
intake data this week to justify changing your target." That is better
than a confident wrong adjustment.

---

## 15. Implementation discipline for 12–13

**Inspect before building.** Prefer extending `foods`, `recipes`, saved
meals, favourites, food search and LLM intent parsing over duplicating
concepts. Family Foods may be a UX category over existing tables;
personal vocabulary may not need a large subsystem initially. Implement
the smallest robust model that stays extensible. Use committed
migrations. Preserve RLS and cross-user isolation.

**Increment, don't land it all at once.** Order: finish custom foods →
My Foods → recent/frequent ranking → repeat workflows → typical portions
→ Quick Add and confidence → multilingual normalization → alias
resolution → cultural dictionary → personal/family recipe resolution →
evaluate French and Canadian datasets → restaurant resolution → connect
confidence to data quality.

### 15.1 Required regression coverage

- **Custom foods.** User A creates one; User B cannot read, modify or
  delete it; User A can edit it; old diary logs keep their historical
  nutrition; it appears in A's search; it logs through the authoritative
  path.
- **Language.** `maqlouba`, `maqluba`, `ma2loubeh`, `مقلوبة` resolve to
  the same concept.
- **Mixed language.** "À midi 8 warak enab viande" identifies
  meat-stuffed grape leaves rather than failing on French grammar.
- **Restaurant.** "Harvey's Big Angus" returns relevant candidates or an
  honest no-match — never arbitrary popular products.
- **Ambiguity.** "warak enab" does not silently assume vegetarian or
  meat while the distinction matters.
- **Personal recipe.** "Mom's Maqlouba" is preferred for its owner and
  never exposed to another user.
- **Confidence.** An estimated cultural dish is never labelled exact.
- **AI privacy.** Capture Gemini request bodies in tests and assert no
  prohibited personal context is attached.

### 15.2 Definition of done

Recognising "maqlouba" is not Universal Food Intelligence. The complete
path is: natural language → semantic understanding → candidate
resolution → necessary clarification → reliable nutrition source →
deterministic calculation → confirmation → diary → historical
preservation. Likewise, recognising a restaurant brand without obtaining
a reliable menu item is not a restaurant integration.

The goal is not to eliminate confirmation. It is to eliminate
unnecessary work: tolerate spelling variation, transliteration and mixed
languages; preserve what the user typed; make a strong best effort
before asking; ask one useful question at a time; offer choices rather
than demanding retyping; remember confirmed choices; allow them to be
corrected; mark estimates clearly; and keep manual search available at
all times.
