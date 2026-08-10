-- CalDef 0004 — recipes, saved meals, favorites.
--
-- Child tables inherit ownership from their parent, so their policies test
-- the parent's user_id rather than duplicating a user_id column that could
-- drift out of sync with it.

create type public.portion_unit as enum ('g', 'ml', 'serving');

comment on type public.portion_unit is
  'How an amount was entered. Everything is resolved to grams before any '
  'nutrition is computed; ml is treated as 1 g/ml unless a serving says '
  'otherwise.';

-- ----------------------------------------------------------------- recipes

create table public.recipes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  servings    numeric(6, 2) not null default 1 check (servings > 0 and servings <= 1000),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index recipes_user_id_idx on public.recipes (user_id);

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

alter table public.recipes enable row level security;

create policy recipes_select_own on public.recipes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy recipes_insert_own on public.recipes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recipes_update_own on public.recipes
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recipes_delete_own on public.recipes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ------------------------------------------------------- recipe_ingredients

create table public.recipe_ingredients (
  id          bigint generated always as identity primary key,
  recipe_id   bigint not null references public.recipes (id) on delete cascade,
  food_id     bigint not null references public.foods (id) on delete restrict,
  serving_id  bigint references public.food_servings (id) on delete set null,
  amount      numeric(9, 3) not null check (amount > 0),
  unit        public.portion_unit not null default 'g',
  grams       numeric(9, 3) not null check (grams > 0 and grams <= 100000),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_food_id_idx on public.recipe_ingredients (food_id);
create index recipe_ingredients_serving_id_idx on public.recipe_ingredients (serving_id);

create trigger recipe_ingredients_set_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

alter table public.recipe_ingredients enable row level security;

create policy recipe_ingredients_select_own on public.recipe_ingredients
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
create policy recipe_ingredients_insert_own on public.recipe_ingredients
  for insert to authenticated
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
create policy recipe_ingredients_update_own on public.recipe_ingredients
  for update to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
create policy recipe_ingredients_delete_own on public.recipe_ingredients
  for delete to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));

-- ------------------------------------------------------------- saved_meals

create table public.saved_meals (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references auth.users (id) on delete cascade,
  name                 text not null check (length(trim(name)) > 0),
  default_meal_type_id bigint references public.meal_types (id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index saved_meals_user_id_idx on public.saved_meals (user_id);
create index saved_meals_default_meal_type_id_idx
  on public.saved_meals (default_meal_type_id);

create trigger saved_meals_set_updated_at
  before update on public.saved_meals
  for each row execute function public.set_updated_at();

alter table public.saved_meals enable row level security;

create policy saved_meals_select_own on public.saved_meals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy saved_meals_insert_own on public.saved_meals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy saved_meals_update_own on public.saved_meals
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy saved_meals_delete_own on public.saved_meals
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -------------------------------------------------------- saved_meal_items

create table public.saved_meal_items (
  id             bigint generated always as identity primary key,
  saved_meal_id  bigint not null references public.saved_meals (id) on delete cascade,
  food_id        bigint not null references public.foods (id) on delete restrict,
  serving_id     bigint references public.food_servings (id) on delete set null,
  amount         numeric(9, 3) not null check (amount > 0),
  unit           public.portion_unit not null default 'g',
  grams          numeric(9, 3) not null check (grams > 0 and grams <= 100000),
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index saved_meal_items_saved_meal_id_idx
  on public.saved_meal_items (saved_meal_id);
create index saved_meal_items_food_id_idx on public.saved_meal_items (food_id);
create index saved_meal_items_serving_id_idx on public.saved_meal_items (serving_id);

create trigger saved_meal_items_set_updated_at
  before update on public.saved_meal_items
  for each row execute function public.set_updated_at();

alter table public.saved_meal_items enable row level security;

create policy saved_meal_items_select_own on public.saved_meal_items
  for select to authenticated
  using (exists (
    select 1 from public.saved_meals m
    where m.id = saved_meal_id and m.user_id = (select auth.uid())
  ));
create policy saved_meal_items_insert_own on public.saved_meal_items
  for insert to authenticated
  with check (exists (
    select 1 from public.saved_meals m
    where m.id = saved_meal_id and m.user_id = (select auth.uid())
  ));
create policy saved_meal_items_update_own on public.saved_meal_items
  for update to authenticated
  using (exists (
    select 1 from public.saved_meals m
    where m.id = saved_meal_id and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.saved_meals m
    where m.id = saved_meal_id and m.user_id = (select auth.uid())
  ));
create policy saved_meal_items_delete_own on public.saved_meal_items
  for delete to authenticated
  using (exists (
    select 1 from public.saved_meals m
    where m.id = saved_meal_id and m.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------- favorite_foods

create table public.favorite_foods (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  food_id     bigint not null references public.foods (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint favorite_foods_user_food_key unique (user_id, food_id)
);

create index favorite_foods_user_id_idx on public.favorite_foods (user_id);
create index favorite_foods_food_id_idx on public.favorite_foods (food_id);

create trigger favorite_foods_set_updated_at
  before update on public.favorite_foods
  for each row execute function public.set_updated_at();

alter table public.favorite_foods enable row level security;

create policy favorite_foods_select_own on public.favorite_foods
  for select to authenticated using ((select auth.uid()) = user_id);
create policy favorite_foods_insert_own on public.favorite_foods
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy favorite_foods_update_own on public.favorite_foods
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy favorite_foods_delete_own on public.favorite_foods
  for delete to authenticated using ((select auth.uid()) = user_id);
