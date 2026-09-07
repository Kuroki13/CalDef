-- CalDef 0008 — retiring a custom food without erasing what it fed.
--
-- `food_logs.food_id`, `recipe_ingredients.food_id` and
-- `saved_meal_items.food_id` are all `on delete restrict`, deliberately: a
-- meal eaten in March keeps its name and its numbers, and no delete
-- anywhere can quietly hollow out a diary. That leaves a real question for
-- a user's own foods, which they are entitled to remove — a plain delete
-- of one they have eaten would simply fail on a foreign key.
--
-- So a custom food that has been used is archived instead of deleted: the
-- row stays exactly where the history points at it, and disappears from
-- search. One that has never been used is deleted outright, because there
-- is nothing to preserve.
--
-- Nullable with no default, so every existing row is active and nothing
-- needs backfilling.

alter table public.foods
  add column archived_at timestamptz;

comment on column public.foods.archived_at is
  'Set when a custom food is retired. Archived foods are hidden from search '
  'but still resolve for the diary entries, recipes and saved meals that '
  'already reference them — history is never rewritten by a deletion.';
