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
| Database   | Postgres 17 on Supabase (project `CalDef`, free plan, eu-west-1) |
| Auth       | Supabase Auth, email/password |
| Hosting    | Vercel Hobby |
| Food data  | USDA FoodData Central, Open Food Facts v3 |
| LLM        | Gemini Developer API, free tier, behind `LLMProvider` |
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
      ai/parse/        natural language -> structured intent
      ai/correct/      correction of a logged entry
      ai/chat/         nutrition assistant
  components/
    ui/                shadcn primitives
    <feature>/         feature components
  lib/
    supabase/          client.ts · server.ts · middleware.ts
    food/              types.ts · provider.ts · usda.ts · off.ts
                       cache.ts · registry.ts
    llm/               types.ts · provider.ts · gemini.ts
                       unavailable.ts · index.ts
    nutrition/         units.ts · macros.ts · totals.ts
    tdee/              constants.ts · bmr.ts · trend.ts · adaptive.ts
                       feasibility.ts · milestones.ts
    rate-limit.ts
  types/
    database.ts        generated from Supabase, do not hand-edit
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

## 5. Invariants

These are load-bearing. Breaking one is a defect even if tests pass.

1. **The LLM never produces a nutrition number.** It returns intent
   (`query`, `amount`, `unit`) and free text. Calories, protein, carbs
   and fat are always computed by the domain layer from `food_nutrients`
   rows. Any model output claiming a kcal value is discarded.
2. **Gemini receives food text and anonymous aggregates only.** One
   server-side call site, whose parameter type is food text — never a
   user object, row, session or id. No names, emails, addresses, weight
   history, profiles or user ids cross that boundary.
3. **The app works with the AI switched off.** Manual search, manual
   logging, weight entry, the TDEE engine and the whole phase mode are
   AI-independent. `LLMProvider` has an `unavailable` implementation
   that returns a typed "AI is off" result, and every AI entry point
   renders a working manual alternative.
4. **Every user-owned table has RLS enabled and explicit policies** for
   select, insert, update and delete, keyed on `auth.uid()`.
5. **Secrets stay server-side.** Only `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public. The service_role
   key is not used by this application at all.
6. **Schema changes happen only through `supabase/migrations/`.** The
   database must be reproducible from migrations alone.
7. **A dead provider degrades, it never crashes.** Provider failures
   return an empty or partial result set with a source note; search
   still returns whatever the other sources found.

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

The spec's worked examples (111.8 → 99 kg and 111.8 → 90 kg in 56 days)
are encoded as test cases so the safety behaviour cannot silently drift.

## 9. Environment variables

| Name | Scope | Purpose |
|------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | RLS-constrained browser key |
| `GEMINI_API_KEY` | server | Gemini Developer API, free tier |
| `USDA_API_KEY` | server | FoodData Central |

Names only are mirrored in `.env.example`. Real values live in
`.env.local`, which is gitignored. The service_role key is deliberately
absent.
