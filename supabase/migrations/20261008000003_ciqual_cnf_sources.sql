-- CalDef 0017 — two more provenances: Ciqual (ANSES, France) and the
-- Canadian Nutrient File (Health Canada). Spec §13J/§13K; owner decision
-- 2026-10-08, recorded in docs/DATASET_EVALUATION.md.
--
-- A food from either is cached like a USDA or Open Food Facts food — a
-- shared row, written only when someone logs it — and must say where its
-- numbers came from. That is all this adds: two values to the enum.
-- Additive: no row changes, and nothing already deployed uses them.

alter type public.food_source add value if not exists 'ciqual';
alter type public.food_source add value if not exists 'cnf';

comment on type public.food_source is
  'Where a food''s figures come from: usda, off (Open Food Facts), custom '
  '(the user''s own), ciqual (ANSES Ciqual), cnf (Health Canada CNF).';
