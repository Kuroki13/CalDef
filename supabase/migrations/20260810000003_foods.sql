-- CalDef 0003 — canonical food records and their nutrition.
--
-- foods.user_id is null for rows cached from a provider (USDA, Open Food
-- Facts) and non-null for a user's own custom food. Cached rows are
-- readable by any authenticated user, but only the owner of a custom row
-- may modify or delete it — nobody can edit or remove a provider row.

create table public.foods (
  id               bigint generated always as identity primary key,
  source           public.food_source not null,
  source_id        text,
  name             text not null check (length(trim(name)) > 0),
  brand            text,
  description      text,
  barcode          text check (barcode is null or barcode ~ '^[0-9]{6,14}$'),
  is_verified      boolean not null default false,
  user_id          uuid references auth.users (id) on delete cascade,
  data_updated_at  timestamptz,
  search_text      text generated always as
                     (coalesce(name, '') || ' ' || coalesce(brand, '')) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint foods_custom_requires_owner
    check (source <> 'custom' or user_id is not null),
  constraint foods_provider_requires_source_id
    check (source = 'custom' or source_id is not null)
);

comment on table public.foods is
  'Canonical food records. Provider rows (user_id null) are a shared cache '
  'so logging the same food twice does not hit an external API twice.';
comment on column public.foods.is_verified is
  'Open Food Facts is community-contributed. Never present an unverified '
  'row as authoritative — the UI must show the source.';

create unique index foods_provider_key_idx
  on public.foods (source, source_id) where user_id is null;
create index foods_user_id_idx on public.foods (user_id);
create index foods_barcode_idx on public.foods (barcode) where barcode is not null;
create index foods_search_text_trgm_idx
  on public.foods using gin (search_text extensions.gin_trgm_ops);

create trigger foods_set_updated_at
  before update on public.foods
  for each row execute function public.set_updated_at();

alter table public.foods enable row level security;

create policy foods_select_visible on public.foods
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
-- Authenticated users may write cache rows (user_id null) and their own
-- custom foods, but nothing belonging to another user.
create policy foods_insert_cache_or_own on public.foods
  for insert to authenticated
  with check (user_id is null or user_id = (select auth.uid()));
create policy foods_update_own on public.foods
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy foods_delete_own on public.foods
  for delete to authenticated using ((select auth.uid()) = user_id);

-- --------------------------------------------------------- food_servings

create table public.food_servings (
  id          bigint generated always as identity primary key,
  food_id     bigint not null references public.foods (id) on delete cascade,
  label       text   not null check (length(trim(label)) > 0),
  grams       numeric(9, 3) not null check (grams > 0 and grams <= 100000),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint food_servings_food_label_key unique (food_id, label)
);

comment on table public.food_servings is
  'Named portions ("1 medium", "1 cup") and their gram equivalents. '
  'Everything is converted to grams before any nutrition is computed.';

create index food_servings_food_id_idx on public.food_servings (food_id);
create unique index food_servings_one_default_idx
  on public.food_servings (food_id) where is_default;

create trigger food_servings_set_updated_at
  before update on public.food_servings
  for each row execute function public.set_updated_at();

alter table public.food_servings enable row level security;

-- Servings inherit visibility from their food.
create policy food_servings_select_visible on public.food_servings
  for select to authenticated
  using (exists (
    select 1 from public.foods f
    where f.id = food_id
      and (f.user_id is null or f.user_id = (select auth.uid()))
  ));
create policy food_servings_insert_visible on public.food_servings
  for insert to authenticated
  with check (exists (
    select 1 from public.foods f
    where f.id = food_id
      and (f.user_id is null or f.user_id = (select auth.uid()))
  ));
create policy food_servings_update_own on public.food_servings
  for update to authenticated
  using (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())
  ));
create policy food_servings_delete_own on public.food_servings
  for delete to authenticated
  using (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())
  ));

-- -------------------------------------------------------- food_nutrients

-- One row per food, values per 100 g. Wide rather than tall: this app
-- reads all macros together on every single lookup.
create table public.food_nutrients (
  food_id     bigint primary key references public.foods (id) on delete cascade,
  kcal        numeric(8, 2) not null check (kcal >= 0 and kcal <= 1000),
  protein_g   numeric(8, 2) not null default 0 check (protein_g >= 0 and protein_g <= 100),
  carbs_g     numeric(8, 2) not null default 0 check (carbs_g >= 0 and carbs_g <= 100),
  fat_g       numeric(8, 2) not null default 0 check (fat_g >= 0 and fat_g <= 100),
  fiber_g     numeric(8, 2) check (fiber_g >= 0 and fiber_g <= 100),
  sugar_g     numeric(8, 2) check (sugar_g >= 0 and sugar_g <= 100),
  sat_fat_g   numeric(8, 2) check (sat_fat_g >= 0 and sat_fat_g <= 100),
  sodium_mg   numeric(9, 2) check (sodium_mg >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.food_nutrients is
  'Per-100 g nutrition. The single source of every calorie number in the '
  'app — the LLM never supplies these values.';

create trigger food_nutrients_set_updated_at
  before update on public.food_nutrients
  for each row execute function public.set_updated_at();

alter table public.food_nutrients enable row level security;

create policy food_nutrients_select_visible on public.food_nutrients
  for select to authenticated
  using (exists (
    select 1 from public.foods f
    where f.id = food_id
      and (f.user_id is null or f.user_id = (select auth.uid()))
  ));
create policy food_nutrients_insert_visible on public.food_nutrients
  for insert to authenticated
  with check (exists (
    select 1 from public.foods f
    where f.id = food_id
      and (f.user_id is null or f.user_id = (select auth.uid()))
  ));
create policy food_nutrients_update_own on public.food_nutrients
  for update to authenticated
  using (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())
  ));
create policy food_nutrients_delete_own on public.food_nutrients
  for delete to authenticated
  using (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())
  ));
