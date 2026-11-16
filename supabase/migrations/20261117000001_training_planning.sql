-- CalDef 0020 — programmes, a calendar, and what "an alternative" needs
-- (spec §16.3, §16.4, §16.9).
--
-- Additive only. Three things:
--
--   1. exercises gains `force` (push / pull / static), `mechanic`
--      (compound / isolation) and `source` (where a catalogue row came
--      from). All nullable: unknown stays unknown, never guessed.
--   2. workout_programs — a named group of workouts ("Push / Pull / Legs").
--      A workout belongs to at most one; deleting a programme releases its
--      workouts, it does not delete them.
--   3. workout_schedule — a workout planned for a date. An occurrence can
--      be moved or cancelled without touching the workout; deleting the
--      workout removes its future plans with it. No recurrence engine: one
--      row is one date.
--
-- Nothing here is sent to a model or changes a calorie target.

alter table public.exercises
  add column force    text check (force in ('push', 'pull', 'static')),
  add column mechanic text check (mechanic in ('compound', 'isolation')),
  add column source   text check (source is null or length(source) <= 60);

comment on column public.exercises.source is
  'Provenance of a catalogue row: null = written for CalDef, otherwise the '
  'dataset it was imported from.';

-- --------------------------------------------------------------- programmes

create table public.workout_programs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.workout_programs is
  'A named group of workouts. Organisation only: it carries no schedule.';

create index workout_programs_user_id_idx on public.workout_programs (user_id);

create trigger workout_programs_set_updated_at
  before update on public.workout_programs
  for each row execute function public.set_updated_at();

alter table public.workout_programs enable row level security;

create policy workout_programs_select_own on public.workout_programs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy workout_programs_insert_own on public.workout_programs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy workout_programs_update_own on public.workout_programs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy workout_programs_delete_own on public.workout_programs
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.workout_templates
  add column program_id bigint references public.workout_programs (id) on delete set null;

create index workout_templates_program_id_idx on public.workout_templates (program_id);

-- A foreign key is checked without RLS, so knowing another user's programme
-- id must not be enough to file a workout under it. Restrictive: it is
-- ANDed with the existing ownership policies, which stay as they are.
create policy workout_templates_program_owned on public.workout_templates
  as restrictive for all to authenticated
  using (true)
  with check (
    program_id is null or exists (
      select 1 from public.workout_programs p
      where p.id = program_id and p.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------- schedule

create table public.workout_schedule (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  template_id   bigint not null references public.workout_templates (id) on delete cascade,
  scheduled_on  date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Planning the same workout on the same day twice plans it once.
  constraint workout_schedule_once_a_day unique (user_id, template_id, scheduled_on)
);

comment on table public.workout_schedule is
  'A workout planned for a date. One row, one date; moving or cancelling an '
  'occurrence never changes the workout.';

create index workout_schedule_user_date_idx
  on public.workout_schedule (user_id, scheduled_on);
create index workout_schedule_template_id_idx
  on public.workout_schedule (template_id);

create trigger workout_schedule_set_updated_at
  before update on public.workout_schedule
  for each row execute function public.set_updated_at();

alter table public.workout_schedule enable row level security;

create policy workout_schedule_select_own on public.workout_schedule
  for select to authenticated using ((select auth.uid()) = user_id);
create policy workout_schedule_insert_own on public.workout_schedule
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.workout_templates t
      where t.id = template_id and t.user_id = (select auth.uid())
    )
  );
create policy workout_schedule_update_own on public.workout_schedule
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.workout_templates t
      where t.id = template_id and t.user_id = (select auth.uid())
    )
  );
create policy workout_schedule_delete_own on public.workout_schedule
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.workout_programs, public.workout_schedule
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.workout_programs, public.workout_schedule
  to authenticated;
