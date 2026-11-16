-- CalDef 0018 — strength training (spec §16).
--
-- Five tables, and one distinction that everything else follows from:
--
--   a TEMPLATE is a plan that can be reused and edited ("Push A");
--   a SESSION is what was actually done on a date, with its results.
--
-- A session copies what it needs from the template and from each exercise
-- at the moment it starts (its name, how it is measured, the targets), so
-- editing or deleting a template later — or renaming a custom exercise —
-- cannot change what a past session says happened. This is the same rule
-- as `food_logs` (ARCHITECTURE invariant 12), applied to training.
--
--   exercises                   the shared catalogue (user_id null) and each
--                               user's own exercises
--   workout_templates           a reusable plan
--   workout_template_exercises  its exercises, in order, with targets
--   workout_sessions            a session performed, or in progress
--   workout_session_exercises   the exercises of a session, snapshotted
--   workout_sets                one set: weight, reps, time, distance
--
-- Weights are kilograms and distances metres, always; the unit system is a
-- display preference, exactly as for body weight.
--
-- Nothing here is ever sent to a model, and nothing here changes a calorie
-- target: no burned-calorie estimate is stored or derived.
--
-- Additive only. No existing table is touched.

-- ---------------------------------------------------------------- exercises

create table public.exercises (
  id                 bigint generated always as identity primary key,
  -- null = the shared catalogue, readable by everyone, writable by no API role.
  user_id            uuid references auth.users (id) on delete cascade,
  -- The catalogue's permanent identity; sessions and seeds refer to it.
  slug               text check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name               text not null check (length(trim(name)) between 1 and 120),
  aliases            text[] not null default '{}'
                       check (cardinality(aliases) <= 20),
  muscle_group       text not null check (muscle_group in (
                       'chest', 'back', 'shoulders', 'biceps', 'triceps',
                       'forearms', 'core', 'quads', 'hamstrings', 'glutes',
                       'hips', 'calves', 'full_body', 'cardio')),
  secondary_muscles  text[] not null default '{}'
                       check (secondary_muscles <@ array[
                       'chest', 'back', 'shoulders', 'biceps', 'triceps',
                       'forearms', 'core', 'quads', 'hamstrings', 'glutes',
                       'hips', 'calves']::text[]),
  equipment          text not null check (equipment in (
                       'bodyweight', 'dumbbell', 'barbell', 'kettlebell',
                       'machine', 'cable', 'band', 'other')),
  -- What a set of this exercise records.
  measure            text not null check (measure in (
                       'weight_reps', 'reps', 'duration', 'distance_duration')),
  instructions       text check (instructions is null or length(instructions) <= 1000),
  -- A custom exercise that history points at is retired, not deleted.
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint exercises_catalogue_has_slug
    check ((user_id is null) = (slug is not null))
);

comment on table public.exercises is
  'Exercises: the shared catalogue (user_id null, identified by slug) and '
  'each user''s private ones. Never sent to a model.';

create unique index exercises_slug_key on public.exercises (slug) where slug is not null;
create index exercises_user_id_idx on public.exercises (user_id);

create trigger exercises_set_updated_at
  before update on public.exercises
  for each row execute function public.set_updated_at();

alter table public.exercises enable row level security;

-- Everyone signed in reads the catalogue; only the owner reads their own.
create policy exercises_select_visible on public.exercises
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);
-- A row can only be written as one's own. `user_id is null` fails every
-- one of these, so no API role can add to, change or remove the catalogue.
create policy exercises_insert_own on public.exercises
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy exercises_update_own on public.exercises
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy exercises_delete_own on public.exercises
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- templates

create table public.workout_templates (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  notes       text check (notes is null or length(notes) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.workout_templates is
  'A reusable training plan. Sessions copy from it and never depend on it.';

create index workout_templates_user_id_idx on public.workout_templates (user_id);

create trigger workout_templates_set_updated_at
  before update on public.workout_templates
  for each row execute function public.set_updated_at();

alter table public.workout_templates enable row level security;

create policy workout_templates_select_own on public.workout_templates
  for select to authenticated using ((select auth.uid()) = user_id);
create policy workout_templates_insert_own on public.workout_templates
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy workout_templates_update_own on public.workout_templates
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy workout_templates_delete_own on public.workout_templates
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.workout_template_exercises (
  id                 bigint generated always as identity primary key,
  template_id        bigint not null references public.workout_templates (id) on delete cascade,
  exercise_id        bigint not null references public.exercises (id) on delete restrict,
  position           integer not null check (position between 0 and 99),
  target_sets        integer not null default 3 check (target_sets between 1 and 20),
  rep_min            integer check (rep_min between 1 and 1000),
  rep_max            integer check (rep_max between 1 and 1000),
  target_weight_kg   numeric(8,3) check (target_weight_kg between 0 and 2000),
  target_duration_s  integer check (target_duration_s between 1 and 86400),
  rest_seconds       integer not null default 90 check (rest_seconds between 0 and 3600),
  notes              text check (notes is null or length(notes) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint workout_template_exercises_rep_range
    check (rep_min is null or rep_max is null or rep_min <= rep_max),
  constraint workout_template_exercises_position_key
    unique (template_id, position)
);

create index workout_template_exercises_exercise_id_idx
  on public.workout_template_exercises (exercise_id);

create trigger workout_template_exercises_set_updated_at
  before update on public.workout_template_exercises
  for each row execute function public.set_updated_at();

alter table public.workout_template_exercises enable row level security;

-- Ownership comes from the template. A foreign key is checked without RLS,
-- so the policy also requires the exercise to be one this user can see:
-- knowing another user's exercise id must not be enough to attach it.
create policy workout_template_exercises_select_own on public.workout_template_exercises
  for select to authenticated
  using (exists (
    select 1 from public.workout_templates t
    where t.id = template_id and t.user_id = (select auth.uid())
  ));
create policy workout_template_exercises_insert_own on public.workout_template_exercises
  for insert to authenticated
  with check (
    exists (
      select 1 from public.workout_templates t
      where t.id = template_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id
        and (e.user_id is null or e.user_id = (select auth.uid()))
    )
  );
create policy workout_template_exercises_update_own on public.workout_template_exercises
  for update to authenticated
  using (exists (
    select 1 from public.workout_templates t
    where t.id = template_id and t.user_id = (select auth.uid())
  ))
  with check (
    exists (
      select 1 from public.workout_templates t
      where t.id = template_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id
        and (e.user_id is null or e.user_id = (select auth.uid()))
    )
  );
create policy workout_template_exercises_delete_own on public.workout_template_exercises
  for delete to authenticated
  using (exists (
    select 1 from public.workout_templates t
    where t.id = template_id and t.user_id = (select auth.uid())
  ));

-- ----------------------------------------------------------------- sessions

create table public.workout_sessions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Where it came from, for "start this again". History does not need it.
  template_id  bigint references public.workout_templates (id) on delete set null,
  -- The template's name when the session started, kept as history.
  name         text not null check (length(trim(name)) between 1 and 80),
  status       text not null default 'in_progress'
                 check (status in ('in_progress', 'completed')),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  notes        text check (notes is null or length(notes) <= 2000),
  -- Chosen by the client when "Start" is tapped. A retry or a double tap
  -- sends the same token and gets the same session back.
  start_token  uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint workout_sessions_completed_has_end
    check ((status = 'completed') = (ended_at is not null)),
  constraint workout_sessions_end_after_start
    check (ended_at is null or ended_at >= started_at),
  constraint workout_sessions_start_token_key unique (user_id, start_token)
);

comment on table public.workout_sessions is
  'A training session performed (or in progress). Self-contained history: '
  'it does not change when its template or exercises do.';

-- One session in progress per user. Starting a second is refused by the
-- database itself, whatever the client does.
create unique index workout_sessions_one_in_progress
  on public.workout_sessions (user_id) where status = 'in_progress';
create index workout_sessions_user_started_idx
  on public.workout_sessions (user_id, started_at desc);
create index workout_sessions_template_id_idx
  on public.workout_sessions (template_id);

create trigger workout_sessions_set_updated_at
  before update on public.workout_sessions
  for each row execute function public.set_updated_at();

alter table public.workout_sessions enable row level security;

create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy workout_sessions_insert_own on public.workout_sessions
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (template_id is null or exists (
      select 1 from public.workout_templates t
      where t.id = template_id and t.user_id = (select auth.uid())
    ))
  );
create policy workout_sessions_update_own on public.workout_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (template_id is null or exists (
      select 1 from public.workout_templates t
      where t.id = template_id and t.user_id = (select auth.uid())
    ))
  );
create policy workout_sessions_delete_own on public.workout_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.workout_session_exercises (
  id                bigint generated always as identity primary key,
  session_id        bigint not null references public.workout_sessions (id) on delete cascade,
  -- Identity for "previous performance" and progress. Restrict: an exercise
  -- with history is archived, never deleted out from under it.
  exercise_id       bigint not null references public.exercises (id) on delete restrict,
  -- Snapshots, so history reads the same after the exercise is edited.
  exercise_name     text not null check (length(trim(exercise_name)) between 1 and 120),
  measure           text not null check (measure in (
                      'weight_reps', 'reps', 'duration', 'distance_duration')),
  muscle_group      text not null,
  equipment         text not null,
  position          integer not null check (position between 0 and 99),
  rest_seconds      integer not null default 90 check (rest_seconds between 0 and 3600),
  rep_min           integer check (rep_min between 1 and 1000),
  rep_max           integer check (rep_max between 1 and 1000),
  target_weight_kg  numeric(8,3) check (target_weight_kg between 0 and 2000),
  notes             text check (notes is null or length(notes) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index workout_session_exercises_session_idx
  on public.workout_session_exercises (session_id, position);
create index workout_session_exercises_exercise_idx
  on public.workout_session_exercises (exercise_id);

create trigger workout_session_exercises_set_updated_at
  before update on public.workout_session_exercises
  for each row execute function public.set_updated_at();

alter table public.workout_session_exercises enable row level security;

create policy workout_session_exercises_select_own on public.workout_session_exercises
  for select to authenticated
  using (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())
  ));
create policy workout_session_exercises_insert_own on public.workout_session_exercises
  for insert to authenticated
  with check (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id
        and (e.user_id is null or e.user_id = (select auth.uid()))
    )
  );
create policy workout_session_exercises_update_own on public.workout_session_exercises
  for update to authenticated
  using (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())
  ))
  with check (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id
        and (e.user_id is null or e.user_id = (select auth.uid()))
    )
  );
create policy workout_session_exercises_delete_own on public.workout_session_exercises
  for delete to authenticated
  using (exists (
    select 1 from public.workout_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())
  ));

create table public.workout_sets (
  id                   bigint generated always as identity primary key,
  session_exercise_id  bigint not null references public.workout_session_exercises (id) on delete cascade,
  position             integer not null check (position between 0 and 49),
  weight_kg            numeric(8,3) check (weight_kg between 0 and 2000),
  reps                 integer check (reps between 0 and 1000),
  duration_s           integer check (duration_s between 0 and 86400),
  distance_m           numeric(9,1) check (distance_m between 0 and 1000000),
  -- null = planned but not done. Only completed sets count as history.
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Adding "set 4" twice — a double tap, a retry — adds it once.
  constraint workout_sets_position_key unique (session_exercise_id, position)
);

create trigger workout_sets_set_updated_at
  before update on public.workout_sets
  for each row execute function public.set_updated_at();

alter table public.workout_sets enable row level security;

create policy workout_sets_select_own on public.workout_sets
  for select to authenticated
  using (exists (
    select 1 from public.workout_session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = (select auth.uid())
  ));
create policy workout_sets_insert_own on public.workout_sets
  for insert to authenticated
  with check (exists (
    select 1 from public.workout_session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = (select auth.uid())
  ));
create policy workout_sets_update_own on public.workout_sets
  for update to authenticated
  using (exists (
    select 1 from public.workout_session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.workout_session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = (select auth.uid())
  ));
create policy workout_sets_delete_own on public.workout_sets
  for delete to authenticated
  using (exists (
    select 1 from public.workout_session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = (select auth.uid())
  ));

-- ------------------------------------------------------------------- grants

-- Explicit, as migration 20260905000001 made every table's grants.
revoke all on public.exercises, public.workout_templates,
              public.workout_template_exercises, public.workout_sessions,
              public.workout_session_exercises, public.workout_sets
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.exercises, public.workout_templates,
     public.workout_template_exercises, public.workout_sessions,
     public.workout_session_exercises, public.workout_sets
  to authenticated;

-- ---------------------------------------------------------------- functions
--
-- Each of these is several statements that must happen together or not at
-- all. All are `security invoker`: RLS decides every row exactly as it
-- would for the same statements sent one by one.

-- Saves a template whole: its name, notes and its exercises in order.
-- p_items: [{exercise_id, target_sets, rep_min, rep_max, target_weight_kg,
--            target_duration_s, rest_seconds, notes}], in display order.
create function public.save_workout_template(
  p_id     bigint,
  p_name   text,
  p_notes  text,
  p_items  jsonb
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'too many exercises' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.workout_templates (user_id, name, notes)
    values ((select auth.uid()), p_name, p_notes)
    returning id into v_id;
  else
    update public.workout_templates
       set name = p_name, notes = p_notes
     where id = p_id
    returning id into v_id;
    -- Not found, or not ours: RLS hides it and the update touches nothing.
    if v_id is null then
      raise exception 'template not found' using errcode = 'P0002';
    end if;
    delete from public.workout_template_exercises where template_id = v_id;
  end if;

  insert into public.workout_template_exercises
    (template_id, exercise_id, position, target_sets, rep_min, rep_max,
     target_weight_kg, target_duration_s, rest_seconds, notes)
  select v_id, i.exercise_id, (o.ord - 1)::int, coalesce(i.target_sets, 3),
         i.rep_min, i.rep_max, i.target_weight_kg, i.target_duration_s,
         coalesce(i.rest_seconds, 90), i.notes
    from jsonb_array_elements(p_items) with ordinality as o(item, ord),
         jsonb_to_record(o.item) as i(
           exercise_id bigint, target_sets int, rep_min int, rep_max int,
           target_weight_kg numeric, target_duration_s int, rest_seconds int,
           notes text);

  return v_id;
end;
$$;

-- Starts a session: from a template, from a past session ("do it again"),
-- or empty. Returns the session to open, which is not always a new one:
--   * the same start token again (double tap, retry) returns the session
--     that token already made;
--   * a session already in progress is returned instead of starting a
--     second — the caller sees `resumed` and says so.
create function public.start_workout(
  p_token        uuid,
  p_name         text,
  p_template_id  bigint,
  p_from_session bigint
) returns table (session_id bigint, resumed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_id   bigint;
  v_name text := p_name;
begin
  select s.id into v_id from public.workout_sessions s
   where s.user_id = v_uid and s.start_token = p_token;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  select s.id into v_id from public.workout_sessions s
   where s.user_id = v_uid and s.status = 'in_progress';
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  if p_template_id is not null then
    select t.name into v_name from public.workout_templates t where t.id = p_template_id;
    if v_name is null then
      raise exception 'template not found' using errcode = 'P0002';
    end if;
  elsif p_from_session is not null then
    select s.name into v_name from public.workout_sessions s
     where s.id = p_from_session and s.status = 'completed';
    if v_name is null then
      raise exception 'session not found' using errcode = 'P0002';
    end if;
  end if;

  begin
    insert into public.workout_sessions (user_id, template_id, name, start_token)
    values (
      v_uid,
      coalesce(p_template_id, (
        -- Repeating a session keeps its link to a template that still exists.
        select s.template_id from public.workout_sessions s where s.id = p_from_session
      )),
      coalesce(nullif(trim(v_name), ''), 'Workout'),
      p_token
    )
    returning id into v_id;
  exception when unique_violation then
    -- Two starts raced; the other one won. Open that one.
    select s.id into v_id from public.workout_sessions s
     where s.user_id = v_uid and s.status = 'in_progress';
    return query select v_id, true;
    return;
  end;

  -- Two statements each, not one with a CTE: the policy on workout_sets
  -- looks the session exercise up, and rows inserted by a CTE are not
  -- visible to the rest of their own statement.
  if p_template_id is not null then
    insert into public.workout_session_exercises
      (session_id, exercise_id, exercise_name, measure, muscle_group,
       equipment, position, rest_seconds, rep_min, rep_max,
       target_weight_kg, notes)
    select v_id, e.id, e.name, e.measure, e.muscle_group, e.equipment,
           te.position, te.rest_seconds, te.rep_min, te.rep_max,
           te.target_weight_kg, te.notes
      from public.workout_template_exercises te
      join public.exercises e on e.id = te.exercise_id
     where te.template_id = p_template_id;

    insert into public.workout_sets (session_exercise_id, position, weight_kg, duration_s)
    select se.id, n.i - 1, te.target_weight_kg, te.target_duration_s
      from public.workout_session_exercises se
      join public.workout_template_exercises te
        on te.template_id = p_template_id and te.position = se.position
      cross join lateral generate_series(1, te.target_sets) as n(i)
     where se.session_id = v_id;
  elsif p_from_session is not null then
    insert into public.workout_session_exercises
      (session_id, exercise_id, exercise_name, measure, muscle_group,
       equipment, position, rest_seconds, rep_min, rep_max,
       target_weight_kg, notes)
    -- The exercise as it is now, where it still exists for this user.
    select v_id, e.id, e.name, e.measure, e.muscle_group, e.equipment,
           src.position, src.rest_seconds, src.rep_min, src.rep_max,
           src.target_weight_kg, null
      from public.workout_session_exercises src
      join public.exercises e on e.id = src.exercise_id
     where src.session_id = p_from_session;

    -- As many planned sets as were done last time, and at least one.
    insert into public.workout_sets (session_exercise_id, position)
    select se.id, n.i - 1
      from public.workout_session_exercises se
      join public.workout_session_exercises src
        on src.session_id = p_from_session and src.position = se.position
      cross join lateral generate_series(1, greatest(1, (
        select count(*)::int from public.workout_sets ws
         where ws.session_exercise_id = src.id
      ))) as n(i)
     where se.session_id = v_id;
  end if;

  return query select v_id, false;
end;
$$;

-- Finishes a session. What was planned but not done is dropped, so history
-- holds only what happened. Refuses a session with nothing completed: that
-- is a session to discard, not to record. Finishing twice is harmless.
create function public.finish_workout(p_session_id bigint)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_done   int;
begin
  select s.status into v_status from public.workout_sessions s
   where s.id = p_session_id for update;
  if v_status is null then return 'not_found'; end if;
  if v_status = 'completed' then return 'completed'; end if;

  select count(*)::int into v_done
    from public.workout_sets ws
    join public.workout_session_exercises se on se.id = ws.session_exercise_id
   where se.session_id = p_session_id and ws.completed_at is not null;
  if v_done = 0 then return 'empty'; end if;

  delete from public.workout_sets ws
   using public.workout_session_exercises se
   where se.id = ws.session_exercise_id
     and se.session_id = p_session_id
     and ws.completed_at is null;

  delete from public.workout_session_exercises se
   where se.session_id = p_session_id
     and not exists (
       select 1 from public.workout_sets ws where ws.session_exercise_id = se.id
     );

  update public.workout_sessions
     set status = 'completed', ended_at = greatest(now(), started_at)
   where id = p_session_id;

  return 'completed';
end;
$$;

revoke all on function public.save_workout_template(bigint, text, text, jsonb) from public, anon;
revoke all on function public.start_workout(uuid, text, bigint, bigint) from public, anon;
revoke all on function public.finish_workout(bigint) from public, anon;
grant execute on function public.save_workout_template(bigint, text, text, jsonb) to authenticated;
grant execute on function public.start_workout(uuid, text, bigint, bigint) to authenticated;
grant execute on function public.finish_workout(bigint) to authenticated;
