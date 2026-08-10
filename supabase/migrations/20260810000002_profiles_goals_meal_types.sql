-- CalDef 0002 — profiles, goals, daily_targets, meal_types.
--
-- Every user-owned table: PK, FKs with sensible on delete, indexes on
-- lookup columns, created_at/updated_at with trigger, RLS enabled and
-- explicit policies for select/insert/update/delete keyed on auth.uid().
--
-- auth.uid() is wrapped in a scalar subquery in every policy so Postgres
-- evaluates it once per statement instead of once per row.

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  sex           public.sex_type   not null default 'other',
  height_cm     numeric(5, 1)     check (height_cm > 0 and height_cm < 300),
  birth_date    date              check (birth_date > '1900-01-01' and birth_date < current_date),
  unit_system   public.unit_system not null default 'metric',
  timezone      text              not null default 'UTC',
  ai_enabled    boolean           not null default true,
  created_at    timestamptz       not null default now(),
  updated_at    timestamptz       not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. Row id IS auth.users.id.';
comment on column public.profiles.ai_enabled is
  'User switch for the AI layer. The app is fully functional when false.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete_own on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

-- A profile row must exist the moment a user exists, so the app never has
-- to cope with a signed-in user that has no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------- goals

create table public.goals (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users (id) on delete cascade,
  goal_type             public.goal_type      not null default 'lose',
  activity_level        public.activity_level not null default 'moderate',
  final_goal_weight_kg  numeric(5, 2) check (final_goal_weight_kg between 20 and 500),
  protein_g_per_kg      numeric(4, 2) not null default 1.6
                          check (protein_g_per_kg between 0.5 and 4.0),
  is_active             boolean       not null default true,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

comment on table public.goals is
  'Long-horizon goal. The 8-week phase target lives in cut_phases, not here.';

create index goals_user_id_idx on public.goals (user_id);
create unique index goals_one_active_per_user_idx
  on public.goals (user_id) where is_active;

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

alter table public.goals enable row level security;

create policy goals_select_own on public.goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy goals_insert_own on public.goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy goals_update_own on public.goals
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy goals_delete_own on public.goals
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------- daily_targets

create table public.daily_targets (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  target_date       date    not null,
  calories          integer not null check (calories between 800 and 10000),
  protein_g         numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g           numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g             numeric(6, 1) not null default 0 check (fat_g >= 0),
  basis_tdee_kcal   numeric(7, 1) check (basis_tdee_kcal > 0),
  source            public.target_source not null default 'initial',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint daily_targets_user_date_key unique (user_id, target_date)
);

comment on column public.daily_targets.calories is
  'Lower bound of 800 is a structural guard: the safety layer must never '
  'be able to write a starvation-level target, whatever the arithmetic says.';

create index daily_targets_user_date_idx
  on public.daily_targets (user_id, target_date desc);

create trigger daily_targets_set_updated_at
  before update on public.daily_targets
  for each row execute function public.set_updated_at();

alter table public.daily_targets enable row level security;

create policy daily_targets_select_own on public.daily_targets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_targets_insert_own on public.daily_targets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy daily_targets_update_own on public.daily_targets
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy daily_targets_delete_own on public.daily_targets
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -------------------------------------------------------------- meal_types

-- user_id null marks the four built-in meals, visible to everyone.
-- A non-null user_id is a user's own custom meal slot.
create table public.meal_types (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  slug        text    not null check (slug ~ '^[a-z0-9_]+$'),
  name        text    not null check (length(trim(name)) > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index meal_types_global_slug_idx
  on public.meal_types (slug) where user_id is null;
create unique index meal_types_user_slug_idx
  on public.meal_types (user_id, slug) where user_id is not null;
create index meal_types_user_id_idx on public.meal_types (user_id);

create trigger meal_types_set_updated_at
  before update on public.meal_types
  for each row execute function public.set_updated_at();

alter table public.meal_types enable row level security;

create policy meal_types_select_visible on public.meal_types
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy meal_types_insert_own on public.meal_types
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy meal_types_update_own on public.meal_types
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy meal_types_delete_own on public.meal_types
  for delete to authenticated using ((select auth.uid()) = user_id);

insert into public.meal_types (user_id, slug, name, sort_order) values
  (null, 'breakfast', 'Breakfast', 1),
  (null, 'lunch',     'Lunch',     2),
  (null, 'dinner',    'Dinner',    3),
  (null, 'snack',     'Snack',     4);
