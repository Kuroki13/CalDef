# CalDef — Architecture

How the system is built. `docs/PRODUCT_SPEC.md` says *what* to build and
wins on product questions; `CLAUDE.md` holds binding operational
constraints and wins on cost, secrets and Supabase questions. This
document explains structure, layering and the invariants that keep the
other two documents true.

Keep this synchronized with the implementation.

---

## 1. Stack

| Layer      | Choice |
|------------|--------|
| Framework  | Next.js 16 (App Router), React 19 |
| Language   | TypeScript, `strict` |
| Styling    | Tailwind CSS v4 + shadcn/ui |
| Database   | Postgres 17 on Supabase (`CalDef` development, `CalDef-prod` production; Free, eu-west-1) |
| Auth       | Supabase Auth, email/password |
| Hosting    | Vercel Hobby |
| Food data  | USDA FoodData Central, Open Food Facts (v3 product, cgi search) |
| Barcodes   | `BarcodeDetector` where the browser has it, ZXing (`@zxing/browser`, MIT) loaded on demand where it does not — which is every browser on iOS |
| LLM        | Gemini Developer API, free tier (`gemini-3.5-flash-lite`), behind `LLMProvider` |
| Tests      | Vitest (unit/integration), SQL-level RLS tests |

Everything on a free tier. No resource with a recurring cost.

## 2. Layering

```
        ┌─────────────────────────────────────────────┐
 UI     │ Server Components · Client Components       │
        │ src/app/**  src/components/**               │
        └───────────────┬─────────────────────────────┘
                        │  server actions / fetch
        ┌───────────────▼─────────────────────────────┐
 EDGE   │ Route handlers · Server actions             │
        │ src/app/api/**                              │
        │ auth check · rate limit · input validation  │
        └───────────────┬─────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────┐
 DOMAIN │ Pure logic, no I/O, fully unit-tested       │
        │ src/lib/nutrition/**  src/lib/tdee/**       │
        └───────────────┬─────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────┐
 PORTS  │ FoodProvider · LLMProvider                  │
        │ src/lib/food/**  src/lib/llm/**             │
        └───────────────┬─────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────┐
 DATA   │ Supabase Postgres (RLS) · USDA · OFF · Gemini│
        └─────────────────────────────────────────────┘
```

Rules that follow from the diagram:

- **The domain layer performs no I/O.** Calorie math, unit conversion,
  trend smoothing, TDEE adaptation and feasibility all take plain
  values and return plain values. This is what makes the spec's worked
  examples directly testable.
- **UI never talks to an external provider.** USDA, Open Food Facts and
  Gemini are reachable only from our own route handlers, because their
  keys are server-only.
- **No provider-specific type escapes `src/lib/food`.** UI code sees our
  `Food`, `Serving`, `Nutrients` shapes, never a USDA or OFF payload.

## 3. Directory layout

```
src/
  app/
    (auth)/            login, signup — unauthenticated
    offline/           static shell the service worker falls back to
    manifest.ts        the web app manifest
    (app)/             authenticated shell
      dashboard/       home: countdown, today, phase card
      diary/           daily food log
      weight/          weigh-ins and trend
      phase/           2-Month Cut mode
      recipes/         recipes and saved meals
      assistant/       AI chat
      settings/        profile, goals, AI toggle
    api/
      foods/search/    provider-backed search
      foods/barcode/   Open Food Facts barcode lookup
      ai/parse/        natural language -> structured intent -> proposals
      ai/correct/      proposed amendment to a logged entry
      ai/chat/         nutrition assistant
  components/
    ui/                shadcn primitives
    service-worker.tsx registers /sw.js after load
    <feature>/         feature components
  lib/
    food-log.ts        the single-food logging convergence point
    meal-template.ts   a saved meal's per-log changes (left out, rescaled)
    repeat.ts          log again / copy a meal: re-logs through food-log.ts
                       and logRecipe, never copying an old row's figures
    ai/                resolve.ts · figures.ts · conversations.ts
    supabase/          client.ts · server.ts · proxy.ts
    barcode.ts         scanner capability; barcode-fallback.ts holds the
                       JS decoder and is reached only by dynamic import
    account-status.ts  a session whose account has been deleted
    signup-allowlist.ts who may create one in the first place
    food/              types.ts · provider.ts · usda.ts · off.ts
                       cache.ts · registry.ts
                       custom.ts · custom-input.ts (the user's own foods)
                       basis.ts (g or ml: how a food's amounts read)
                       cultural/ normalize.ts · dictionary.ts · recognise.ts
                       (dishes in any spelling or script — identity only,
                       never nutrition; local, no model call)
                       personal-rank.ts (search order: word coverage,
                       then phrase + the user's own history)
                       library.ts · library-rank.ts · library-types.ts
                       (My Foods: recent, frequent, favourites, yours,
                       scanned, recipes, meals — read, never stored)
                       staleness.ts · history.ts (when to refetch, and
                       whose diary breaks a ranking tie)
                       text-match.ts (shared by the server's ranking and
                       the search box's "is this any use?")
    llm/               types.ts · food-text.ts · gemini.ts
                       unavailable.ts · index.ts
    nutrition/         units.ts · macros.ts · totals.ts
                       typical-portion.ts (your usual amount, suggested only)
                       confidence.ts (exact / strong / estimated / rough —
                       where a figure came from, never a change to it)
    tdee/              constants.ts · bmr.ts · trend.ts · adaptive.ts
                       feasibility.ts · milestones.ts
    rate-limit.ts
  types/
    database.ts        generated from Supabase, do not hand-edit
public/
  sw.js                service worker · icons generated by scripts/
supabase/
  migrations/          the only way schema changes happen
docs/
```

## 4. Data flow: logging a food

```
user types "200g chicken breast"
   │
   ├─ manual path ──► /api/foods/search
   │                    ├─ local cache (foods/food_servings/food_nutrients)
   │                    ├─ USDA        (generic foods)
   │                    └─ Open Food Facts (branded, barcodes)
   │                         └─ resolved food is cached back to Postgres
   │
   └─ AI path ──────► /api/ai/parse
                        └─ Gemini returns INTENT ONLY
                             { query, amount, unit }[]
                                  │
                                  ▼
                           same search + cache path
                                  │
                                  ▼
              domain layer converts portions and computes
              calories and macros from real nutrient rows
                                  │
                                  ▼
                         insert into food_logs
```

The AI path and the manual path converge before any number is computed.
That convergence is the structural reason the model cannot influence
nutrition values.

`/api/ai/parse` and `/api/ai/correct` *propose*; they never write. The
user confirms, and the confirmation goes through the ordinary logging
and editing actions. A model that misreads a sentence therefore costs a
glance, not a wrong diary entry.

The convergence is a function, not a convention: `src/lib/food-log.ts`.
Every path that logs a single food — manual search, a favourite, a
scanned barcode, and the AI parser when it arrives — calls
`logCachedFood`, which re-reads the `food_nutrients` row from the
database and computes the macros there. A caller supplies a food id, an
amount and a unit; it cannot supply a calorie figure. Recipes and saved
meals do not pass through it, because they compose entries from
ingredients rather than log one food, but they compute from the same
stored nutrient rows.

## 5. Invariants

These are load-bearing. Breaking one is a defect even if tests pass.

1. **The LLM never produces a nutrition number.** It returns intent
   (`query`, `amount`, `unit`) and free text. Calories, protein, carbs
   and fat are always computed by the domain layer from `food_nutrients`
   rows. Any model output claiming a kcal value is discarded.
   - Enforced by shape, not by checking: `FoodIntent` in
     `lib/llm/types.ts` has no nutrition field, the response schema sent
     to Gemini has none either, and the parser reads exactly three keys.
     A `kcal` the model volunteers is dropped because there is nowhere
     for it to go.
   - Drafting a recipe asks a different question and returns the same
     shape: `DraftedRecipe` is an alias of `ParsedFoods`, read by the
     same three-key reader. A second type would be a second place for a
     nutrition field to be added later by someone who thought it would
     be convenient.
2. **Gemini receives food text and anonymous aggregates only.** One
   server-side call site, whose parameter type is food text — never a
   user object, row, session or id. No names, emails, addresses, weight
   history, profiles or user ids cross that boundary.
   - The type is `FoodText`, branded and produced only by `toFoodText`
     in `lib/llm/food-text.ts`, which refuses emails, URLs, UUIDs, JWTs
     and long digit runs. The aggregates are `AnonymousFigures`, whose
     every field is a `number` — a name is not assignable to it — and
     `lib/ai/figures.ts` is the whole of what is ever gathered.
   - `lib/llm/gemini.ts` holds the only `fetch` to Google and assembles
     the request body itself, so there is no parameter through which
     extra context could be passed in.
   - Assistant threads may be replayed, but only through the gate: the
     last few turns go back re-checked by `toFoodText`, capped, so a
     conversation cannot become an accumulating dossier. See invariant
     14, which this bullet used to contradict.
3. **The app works with the AI switched off.** Manual search, manual
   logging, weight entry, the TDEE engine and the whole phase mode are
   AI-independent. `LLMProvider` has an `unavailable` implementation
   that returns a typed "AI is off" result, and every AI entry point
   renders a working manual alternative.
   - Two things switch it off and they stay distinct: the user's
     `profiles.ai_enabled` toggle (`disabled`) and a missing key
     (`unconfigured`). Only the first is fixable in settings.
   - Checked by running the production build with `GEMINI_API_KEY`
     unset, not only by reasoning about it. See TEST RESULTS.
4. **Every user-owned table has RLS enabled and explicit policies** for
   select, insert, update and delete, keyed on `auth.uid()`.
5. **Secrets stay server-side.** Only `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public. The service_role
   key is not used by this application at all.
   - In practice the browser holds neither: nothing imports
     `lib/supabase/client.ts`, so the built client bundle contains no
     Supabase URL or key, and the CSP's `connect-src` is `'self'` alone.
     Adding a browser-side Supabase feature means widening that line.

8. **The service worker never caches a page or an API response.** Every
   page is personal and every API response is per-user or quota-metered.
   Only content-hashed `/_next/static` assets are cached, and a failed
   navigation falls back to a static `/offline` page that displays no
   data. A stale calorie total shown as today's would be worse than no
   total.

9. **Rate limits guard the upstream quota, not just the route.** Each
   route has its own bucket, and every route that reaches the same
   provider also shares one keyed to that provider. Per-route limits
   alone multiply: three AI routes at 10/min is 30 requests a minute
   against a 15/min model.
6. **Schema changes happen only through `supabase/migrations/`.** The
   database must be reproducible from migrations alone.
7. **A dead provider degrades, it never crashes.** Provider failures
   return an empty or partial result set with a source note; search
   still returns whatever the other sources found.
   - The same applies to a capability the *browser* withholds. The
     barcode scanner reports which of its failure modes it hit and keeps
     both manual paths — typing the number, or searching by name — in
     front of the user in every one of them, including when the fallback
     decoder fails to download.

10. **The barcode decoder is loaded on demand, never bundled.**
    `lib/barcode-fallback.ts` pulls in ZXing, which is around 480 KB
    before compression — an order of magnitude more than the rest of the
    client. It is reachable only through `await import()` from the
    scanner, and only in browsers with no `BarcodeDetector`. A static
    import of it anywhere would put that weight on the first load of
    every page, silently.

11. **Every control that reaches the server says so while it works.**
    Form submits, server actions, navigation and error-boundary retries
    all go through `components/pending-button.tsx` or
    `components/pending-nav.tsx` — one component each, not a variation
    per screen. A control that disables itself on pending is also the
    double-submission guard, so the two must not be separated: the
    plain server-action forms that had no pending state were the ones
    that fired twice on a double tap.

12. **A logged entry is history, and editing a food does not rewrite it.**
    `food_logs` stores the macros computed at log time instead of joining
    to `food_nutrients`, so correcting a label — or a provider revising
    its data — cannot change what a past day says it ate. Custom foods
    make this reachable by hand for the first time, so it is asserted
    rather than assumed: `lib/food/custom.ts` writes to no logging table,
    and the RLS suite logs an entry, edits the food and checks the entry
    is unchanged. The corollary is that removing a food that history
    points at archives it rather than deleting it.

17. **The cultural dictionary knows what a dish is, never what is in it.**
    `lib/food/cultural/dictionary.ts` carries names, aliases, variants and
    the phrase databases use, and a test fails if a nutrition word appears
    in it. Recognising "maqluba" decides what to search for and what to ask;
    the calories still come from a food, a recipe or a database row, exactly
    as invariant 1 requires.

16. **A Quick Add is the one typed calorie figure, and it says so.**
    `food_logs.is_estimate` rows carry the user's own numbers, attached to
    no food, labelled, with no weight. Everywhere they appear they read as
    "Your estimate", and nothing turns one into a food implicitly. Invariant
    1 is unaffected: the model still never produces a number, and every
    other row is still computed from stored nutrition.

15. **Nutrients are per 100 g, even for a drink.** `foods.basis_unit` says
    whether a label was per 100 g or per 100 ml. It changes only the words
    and the default unit, never the arithmetic. Millilitres convert at
    1 g/ml everywhere (`nutrition/units.ts`), so storing a per-100 ml label
    unchanged is what makes logging a drink in ml exact. Adding a real
    density per food would break that unless both conversions changed
    together. A custom food's `notes` are the owner's own and never reach
    the model.

13. **Signup is closed unless an address is named, in two places.**
    `SIGNUP_ALLOWLIST` gates the server action, and `disable_signup` on
    the Supabase project closes `/auth/v1/signup` to the publishable key
    that ships in the browser bundle. Either alone is insufficient: the
    action cannot see a request that never reaches it, and the project
    setting gives no message a user can read. Unset means nobody — the
    direction this must fail in.

14. **Anything replayed to the model goes back through the gate.**
    Thread memory carries earlier turns, and every one of them is
    re-checked by `toFoodText` on the way out, so what crosses the
    boundary is `FoodText` whether it was typed a second ago or last
    week. A message the gate refuses is dropped whole, never trimmed.

## 6. Adaptive TDEE model

Two signals, one estimate:

```
weight_entries ──► smoothed trend (EWMA)
                        │
food_logs ─────────► observed mean intake
                        │
                        ▼
     expenditure ≈ mean_intake + (trend_delta_kg × 7700) / days
                        │
                        ▼
              blended with prior estimate,
              gated on data sufficiency
```

- Raw scale values are never used for decisions; only the smoothed
  trend is. Single-day changes move nothing.
- The estimate is gated: below a minimum number of weigh-in and log
  days it is not published, and the formula-based starting estimate
  stands.
- Targets adjust at most weekly.
- Early phase days are damped — glycogen and water loss must not be
  read as expenditure (spec 8.9).

`7700 kcal/kg` is the energy-density constant used throughout; it lives
in one place, `src/lib/tdee/constants.ts`, alongside the rate bands and
calorie floors. Feasibility, the guardrail and the milestone generator
all read the same thresholds from there, so the app cannot classify a
rate one way on the phase screen and another way on the dashboard.

Two floors exist and they mean different things. `CALORIE_FLOOR.absolute`
(1200 kcal) is the lowest intake that is a diet at all, and it decides
whether a requested target is *possible*. `CALORIE_FLOOR.fractionOfTdee`
(60% of expenditure) is the lowest intake the app is willing to *suggest*.
The spec's 99 kg example clears the first and fails the second, which is
exactly why it is reported honestly as very aggressive and then overridden
by a gentler recommendation.

## 7. Safety logic

The feasibility engine computes what a target *requires*, and the
guardrail layer decides what the app *recommends*. They are separate
functions and separate outputs — the UI shows the requirement honestly
while the recommendation stays inside the safe band.

```
rate as % bodyweight/week
  < 0.50   Slow
  0.50–1.00  Typical effective range
  1.00–1.25  Aggressive
  > 1.25   Very aggressive / review target
```

An aggressive requirement never becomes an aggressive calorie target.
The app recommends the safe target, states the gap, and projects when
the goal would be reached at the safe rate. No shaming language.

## 8. Testing strategy

| Kind | Scope | Tool |
|------|-------|------|
| Unit | domain: units, macros, trend, TDEE, feasibility, milestones | Vitest |
| Contract | providers against recorded fixtures, plus failure modes | Vitest + mocked fetch |
| Integration | route handlers with a stubbed Supabase session | Vitest |
| RLS | cross-user access denied on every table | SQL against the dev project |
| Build | typecheck, lint, production build | `tsc`, `eslint`, `next build` |
| Delivery | served bytes: headers, manifest, icons, install tags | HTTP against `next start` |

The spec's worked examples (111.8 → 99 kg and 111.8 → 90 kg in 56 days)
are encoded as test cases so the safety behaviour cannot silently drift.

## 9. Environment variables

| Name | Scope | Purpose |
|------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | RLS-constrained browser key |
| `GEMINI_API_KEY` | server | Gemini Developer API, free tier |
| `GEMINI_MODEL` | server | Optional. Overrides the pinned model; the default is chosen for its free-tier allowance |
| `USDA_API_KEY` | server | FoodData Central |
| `SIGNUP_ALLOWLIST` | server | Comma-separated addresses permitted to create an account. **Unset means nobody** |

Names only are mirrored in `.env.example`. Real values live in
`.env.local`, which is gitignored. The service_role key is deliberately
absent.

Next inlines `process.env` into the server bundle at build time, so a
variable has to exist **before the build**, not merely before the process
starts. Setting one in Vercel therefore takes effect on the next
deployment, not on the running one.

## 10. Production isolation

Production is `CalDef-prod` (`ccllzuelnjikmdtpuyhj`); development remains
`CalDef` (`tcgtimmyakysjdgxugfp`). Production schema comes from committed
migrations over an authorized migration connection. Supabase MCP may only
connect to development. Never copy development auth users or diary history.
The migrations seed only the four built-in meal types.

Development receives a migration file through
`.vercel/caldef-ops/dev-migrate.mjs`, which records it under the file's own
version. The Supabase MCP `apply_migration` stamps its own timestamp instead,
and that is how the two histories drifted apart before 2026-10-07. A
migration that changes a function signature PostgREST calls adds an overload
rather than replacing the function. The deployed code keeps matching the old
signature until the new code ships, and a later migration drops the old one.

Migration `20260905000001` makes authenticated CRUD and sequence grants
explicit rather than relying on Supabase project defaults. API roles cannot
truncate tables or create schema objects. RLS continues to enforce row
ownership; trigger helpers are unavailable as client RPCs.

The SQL isolation audit runs as one transaction, uses known foreign parent
IDs, asserts failures, and rolls back its fixtures. Migration and audit
credentials are operational secrets and are never Vercel app variables.
