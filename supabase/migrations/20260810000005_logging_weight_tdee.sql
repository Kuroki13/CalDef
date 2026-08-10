-- CalDef 0005 — the diary, weigh-ins, and the adaptive expenditure record.

-- --------------------------------------------------------------- food_logs

-- Macro columns are a SNAPSHOT taken at log time, deliberately not a join.
-- Providers revise their data; a meal eaten in March must not silently
-- change its calorie count in May because Open Food Facts was edited.
create table public.food_logs (
  id            bigint generated always as identity primary key,
  user_id       uuid   not null references auth.users (id) on delete cascade,
  log_date      date   not null,
  meal_type_id  bigint not null references public.meal_types (id) on delete restrict,
  food_id       bigint references public.foods (id) on delete restrict,
  recipe_id     bigint references public.recipes (id) on delete restrict,
  serving_id    bigint references public.food_servings (id) on delete set null,
  amount        numeric(9, 3) not null check (amount > 0),
  unit          public.portion_unit not null default 'g',
  grams         numeric(9, 3) not null check (grams > 0 and grams <= 100000),
  kcal          numeric(9, 2) not null check (kcal >= 0),
  protein_g     numeric(8, 2) not null default 0 check (protein_g >= 0),
  carbs_g       numeric(8, 2) not null default 0 check (carbs_g >= 0),
  fat_g         numeric(8, 2) not null default 0 check (fat_g >= 0),
  source        public.log_source not null default 'manual',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint food_logs_food_xor_recipe
    check (num_nonnulls(food_id, recipe_id) = 1)
);

comment on table public.food_logs is
  'One logged entry. Exactly one of food_id / recipe_id is set.';
comment on column public.food_logs.kcal is
  'Computed by the domain layer from food_nutrients at log time and frozen '
  'here. Never written from model output.';

create index food_logs_user_date_idx on public.food_logs (user_id, log_date desc);
create index food_logs_meal_type_id_idx on public.food_logs (meal_type_id);
create index food_logs_food_id_idx on public.food_logs (food_id);
create index food_logs_recipe_id_idx on public.food_logs (recipe_id);
create index food_logs_serving_id_idx on public.food_logs (serving_id);

create trigger food_logs_set_updated_at
  before update on public.food_logs
  for each row execute function public.set_updated_at();

alter table public.food_logs enable row level security;

create policy food_logs_select_own on public.food_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy food_logs_insert_own on public.food_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy food_logs_update_own on public.food_logs
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy food_logs_delete_own on public.food_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------- weight_entries

create table public.weight_entries (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  entry_date  date not null,
  weight_kg   numeric(5, 2) not null check (weight_kg between 20 and 500),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint weight_entries_user_date_key unique (user_id, entry_date)
);

comment on table public.weight_entries is
  'Raw scale readings. Decisions are made from the smoothed trend, never '
  'from a single row here.';

create index weight_entries_user_date_idx
  on public.weight_entries (user_id, entry_date desc);

create trigger weight_entries_set_updated_at
  before update on public.weight_entries
  for each row execute function public.set_updated_at();

alter table public.weight_entries enable row level security;

create policy weight_entries_select_own on public.weight_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy weight_entries_insert_own on public.weight_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy weight_entries_update_own on public.weight_entries
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy weight_entries_delete_own on public.weight_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------- tdee_estimates

create table public.tdee_estimates (
  id                        bigint generated always as identity primary key,
  user_id                   uuid not null references auth.users (id) on delete cascade,
  computed_for              date not null,
  estimated_tdee_kcal       numeric(7, 1) not null check (estimated_tdee_kcal between 800 and 10000),
  method                    public.tdee_method not null,
  confidence                public.confidence_level not null default 'low',
  trend_weight_kg           numeric(6, 2) check (trend_weight_kg between 20 and 500),
  trend_change_kg_per_week  numeric(5, 3),
  mean_intake_kcal          numeric(7, 1) check (mean_intake_kcal >= 0),
  days_of_data              integer not null default 0 check (days_of_data >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint tdee_estimates_user_date_key unique (user_id, computed_for)
);

comment on table public.tdee_estimates is
  'Rolling expenditure estimate. method=formula is the starting guess; '
  'method=adaptive is derived from observed intake versus trend change.';
comment on column public.tdee_estimates.confidence is
  'Gate on data sufficiency. A low-confidence adaptive estimate is shown '
  'but does not drive a target adjustment.';

create index tdee_estimates_user_date_idx
  on public.tdee_estimates (user_id, computed_for desc);

create trigger tdee_estimates_set_updated_at
  before update on public.tdee_estimates
  for each row execute function public.set_updated_at();

alter table public.tdee_estimates enable row level security;

create policy tdee_estimates_select_own on public.tdee_estimates
  for select to authenticated using ((select auth.uid()) = user_id);
create policy tdee_estimates_insert_own on public.tdee_estimates
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy tdee_estimates_update_own on public.tdee_estimates
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tdee_estimates_delete_own on public.tdee_estimates
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------- weekly_checkins

create table public.weekly_checkins (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users (id) on delete cascade,
  week_start_date       date not null,
  mean_intake_kcal      numeric(7, 1) check (mean_intake_kcal >= 0),
  mean_protein_g        numeric(6, 1) check (mean_protein_g >= 0),
  start_trend_kg        numeric(6, 2) check (start_trend_kg between 20 and 500),
  end_trend_kg          numeric(6, 2) check (end_trend_kg between 20 and 500),
  change_kg             numeric(5, 3),
  adherence_pct         numeric(5, 2) check (adherence_pct between 0 and 100),
  logged_days           integer not null default 0 check (logged_days between 0 and 7),
  previous_target_kcal  integer check (previous_target_kcal between 800 and 10000),
  new_target_kcal       integer check (new_target_kcal between 800 and 10000),
  adjustment_reason     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint weekly_checkins_user_week_key unique (user_id, week_start_date)
);

comment on table public.weekly_checkins is
  'One row per ISO week. Targets change here and nowhere else, which is '
  'what enforces "adjust at most weekly".';

create index weekly_checkins_user_week_idx
  on public.weekly_checkins (user_id, week_start_date desc);

create trigger weekly_checkins_set_updated_at
  before update on public.weekly_checkins
  for each row execute function public.set_updated_at();

alter table public.weekly_checkins enable row level security;

create policy weekly_checkins_select_own on public.weekly_checkins
  for select to authenticated using ((select auth.uid()) = user_id);
create policy weekly_checkins_insert_own on public.weekly_checkins
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy weekly_checkins_update_own on public.weekly_checkins
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy weekly_checkins_delete_own on public.weekly_checkins
  for delete to authenticated using ((select auth.uid()) = user_id);
