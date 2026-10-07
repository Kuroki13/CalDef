-- CalDef 0014 — Quick Add: an estimate that is not a food (spec §12G).
--
-- "750 kcal, 45 g protein" for a dinner out. Until now every diary row had
-- to point at exactly one food or recipe, because every calorie figure was
-- computed from stored nutrition. A quick add is the deliberate exception:
-- the user's own estimate, typed in, attached to nothing, and marked so it
-- can never be mistaken for verified nutrition.
--
-- The rules this sets:
--
-- * `is_estimate` marks the row. It defaults to false, and for every row
--   that is not an estimate the old rule is unchanged: exactly one of
--   food_id / recipe_id. The code already deployed never sets the flag, so
--   it keeps writing exactly the rows it always has.
-- * An estimate points at nothing and must say what it was (`notes`), so a
--   diary line is never a bare number.
-- * `grams` may be empty only on an estimate. Nobody weighed the
--   restaurant dinner; writing a weight would be inventing one.
-- * One estimate is capped at 5000 kcal. A larger single entry is a typo
--   far more often than a meal, and it would move the expenditure model.
--
-- No row is changed. The old check is replaced by one that admits exactly
-- what it did plus estimates.

alter table public.food_logs
  add column is_estimate boolean not null default false;

comment on column public.food_logs.is_estimate is
  'A Quick Add: the user''s own estimate, attached to no food. Never '
  'presented as verified nutrition, never turned into a food implicitly.';

alter table public.food_logs
  drop constraint food_logs_food_xor_recipe;

alter table public.food_logs
  add constraint food_logs_what_was_eaten check (
    (not is_estimate and num_nonnulls(food_id, recipe_id) = 1)
    or (
      is_estimate
      and food_id is null
      and recipe_id is null
      and serving_id is null
      and notes is not null
      and length(trim(notes)) > 0
    )
  );

alter table public.food_logs
  alter column grams drop not null;

alter table public.food_logs
  add constraint food_logs_grams_unless_estimate
    check (grams is not null or is_estimate);

alter table public.food_logs
  add constraint food_logs_estimate_kcal_cap
    check (not is_estimate or kcal <= 5000);

comment on table public.food_logs is
  'One logged entry: exactly one of food_id / recipe_id, or a user estimate '
  '(is_estimate) attached to neither.';
