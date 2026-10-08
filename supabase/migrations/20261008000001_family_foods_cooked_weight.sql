-- CalDef 0015 — Family Foods and a recipe's cooked weight (spec §13H, §13G).
--
-- Family Foods are household dishes: Mom's Maqlouba, Our Warak Enab, Dad's
-- Shawarma. The spec is explicit that this must not become a table merely
-- because the product uses the term, and it does not: it is one flag on the
-- two things a family dish already is — a recipe, or a custom food.
--
-- `recipes.cooked_weight_g` is what the finished dish weighed. A recipe
-- knows its ingredients' raw weights, and a pot of maqlouba weighs
-- something else once the rice has drunk its water, so "450 g maqlouba"
-- could not be logged without inventing a number. With the cooked weight
-- recorded, a gram of the dish is a known fraction of the pot. It is
-- optional, and nothing is assumed when it is absent.
--
-- Additive, with defaults: the code already deployed never reads these.

alter table public.recipes
  add column is_family boolean not null default false,
  add column cooked_weight_g numeric(9, 1)
    constraint recipes_cooked_weight_check
      check (cooked_weight_g is null or (cooked_weight_g > 0 and cooked_weight_g <= 100000));

comment on column public.recipes.is_family is
  'A household dish (Family Foods). Private like every recipe.';
comment on column public.recipes.cooked_weight_g is
  'What the finished dish weighed. Lets a portion be logged in grams; '
  'null means only servings can be logged.';

alter table public.foods
  add column is_family boolean not null default false;

-- Only the user's own foods can be family foods: a shared provider row
-- marked as someone's family dish would be one user's label on everyone's
-- data.
alter table public.foods
  add constraint foods_family_custom_only
    check (not is_family or source = 'custom');

comment on column public.foods.is_family is
  'A household food (Family Foods). Custom foods only.';
