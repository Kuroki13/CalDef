-- CalDef 0011 — recording that a recipe's ingredient list was drafted by AI.
--
-- A recipe built from "chicken maqlouba" is not the same object as one the
-- owner typed out, and the difference matters months later when they are
-- looking at a number and wondering where it came from. The ingredient list
-- was estimated by a model; the nutrition was computed from the matched
-- foods' own nutrient rows, exactly as every other calorie figure in this
-- app is. Both halves of that sentence need to survive, so the row carries
-- when the draft happened rather than a boolean that loses the date.
--
-- Null means what it says: nobody drafted it, a person wrote it.
--
-- This changes nothing about how a recipe is computed or logged. It is
-- provenance, not behaviour.

alter table public.recipes
  add column ai_drafted_at timestamptz;

comment on column public.recipes.ai_drafted_at is
  'When a model proposed this recipe''s ingredient list, if one did. The '
  'amounts were then reviewed by the owner and every nutrition figure comes '
  'from the matched foods, never from the model.';
