# CalDef — Implementation Status

Living record of what actually exists. Update this at the end of every
phase, before compacting context, and whenever a claim in it stops being
true.

A feature belongs under DONE only if it was **tested and verified**, not
merely written. "It compiles" is not done.

Last updated: 2026-08-09

---

## Phase plan

| # | Phase | Status |
|---|-------|--------|
| 0 | Scaffold, docs, env, git | IN PROGRESS |
| 1 | Database schema and RLS | TODO |
| 2 | Auth and app shell | TODO |
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

- Next.js 16.3.0 scaffold: TypeScript, Tailwind v4, ESLint, App Router,
  `src/` layout, `@/*` import alias. Verified `npm run build` after
  scaffold.
- Supabase project confirmed: `CalDef` (`tcgtimmyakysjdgxugfp`), org
  `Melo Org`, **free plan**, Postgres 17.6, eu-west-1, ACTIVE_HEALTHY,
  zero tables at start.
- `.env*` gitignored; verified with `git check-ignore -v .env.local`
  before the first commit.
- `docs/PRODUCT_SPEC.md` (source of truth), `docs/ARCHITECTURE.md`,
  this file.

## IN PROGRESS

- Phase 0: shadcn/ui init, Vitest setup, `.env.local` / `.env.example`,
  private GitHub repository, first commit.

## TODO

Everything in phases 1–11 above. Detail lives in
`docs/PRODUCT_SPEC.md`; do not restate requirements here.

## KNOWN ISSUES

- None recorded yet.

## BLOCKED / NEEDS ACCOUNT OWNER

- `GEMINI_API_KEY` — needed before Phase 9 (AI layer) can be verified
  against the live API. Phases 0–8 do not need it.
- `USDA_API_KEY` — needed before Phase 4 (food providers) can be
  verified against live USDA data. Open Food Facts needs no key.

## TEST RESULTS

No test suite yet. Recorded results start in Phase 3.

| Date | Command | Result |
|------|---------|--------|
| 2026-08-09 | `npm run build` (post-scaffold) | pending |
