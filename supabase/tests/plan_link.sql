-- A session knows which plan it carried out; a food log survives a retry
-- (migration 20261118000003). One transaction, rolled back.
--
--   * two workouts named "Push A", both planned today: starting one plan
--     links that plan only;
--   * a retried start (same token) links once and opens the same session;
--   * a plan already carried out is not claimed by a second session;
--   * a free session called "Push A" links nothing;
--   * another user cannot attach a session to this user's plan, through
--     the start function or by a direct update;
--   * the same client token cannot write a food log twice, and two
--     different tokens can.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'plan-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'plan-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

create temporary table plan_ids (k text primary key, v bigint) on commit drop;
grant all on plan_ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare
  a        constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_bench  bigint;
  v_tpl1   bigint;
  v_tpl2   bigint;
  v_plan1  bigint;
  v_plan2  bigint;
  v_sess   bigint;
  v_sess2  bigint;
  v_free   bigint;
  v_resumed boolean;
  v_link   bigint;
  v_count  int;
  v_meal   bigint;
  v_raised boolean;
begin
  select id into v_bench from public.exercises where slug = 'barbell-bench-press';
  v_tpl1 := public.save_workout_template(null, 'Push A', null, jsonb_build_array(
    jsonb_build_object('exercise_id', v_bench, 'target_sets', 1, 'target_weight_kg', 80, 'rest_seconds', 90)));
  v_tpl2 := public.save_workout_template(null, 'Push A', null, jsonb_build_array(
    jsonb_build_object('exercise_id', v_bench, 'target_sets', 1, 'target_weight_kg', 60, 'rest_seconds', 90)));

  insert into public.workout_schedule (user_id, template_id, scheduled_on)
  values (a, v_tpl1, current_date) returning id into v_plan1;
  insert into public.workout_schedule (user_id, template_id, scheduled_on)
  values (a, v_tpl2, current_date) returning id into v_plan2;
  insert into plan_ids values ('plan1', v_plan1);

  -- 1. Starting the first plan links that plan and not the other.
  select s.session_id, s.resumed into v_sess, v_resumed
    from public.start_workout('10000000-0000-0000-0000-000000000001', null, v_tpl1, null, v_plan1) s;
  select schedule_id into v_link from public.workout_sessions where id = v_sess;
  if v_link is distinct from v_plan1 then raise exception 'FAIL: the started plan was not linked (%)', v_link; end if;
  if exists (select 1 from public.workout_sessions where schedule_id = v_plan2) then
    raise exception 'FAIL: the other plan of the same name was linked';
  end if;
  raise notice 'PASS: two plans of the same name, one carried out';

  -- 2. A retry with the same token is the same session, linked once.
  select s.session_id, s.resumed into v_sess2, v_resumed
    from public.start_workout('10000000-0000-0000-0000-000000000001', null, v_tpl1, null, v_plan1) s;
  if v_sess2 <> v_sess or v_resumed then raise exception 'FAIL: a retried start was not idempotent'; end if;
  select count(*) into v_count from public.workout_sessions where schedule_id = v_plan1;
  if v_count <> 1 then raise exception 'FAIL: a retry linked % sessions', v_count; end if;
  raise notice 'PASS: a retried start links once';

  -- Finish it, so another session may start.
  update public.workout_sets ws set reps = 8, completed_at = now()
    from public.workout_session_exercises se
   where se.id = ws.session_exercise_id and se.session_id = v_sess;
  if public.finish_workout(v_sess) <> 'completed' then raise exception 'FAIL: could not finish'; end if;

  -- 3. The same plan cannot be carried out twice.
  select s.session_id into v_sess2
    from public.start_workout('10000000-0000-0000-0000-000000000002', null, v_tpl1, null, v_plan1) s;
  if v_sess2 = v_sess then raise exception 'FAIL: a new token reopened a finished session'; end if;
  select schedule_id into v_link from public.workout_sessions where id = v_sess2;
  if v_link is not null then raise exception 'FAIL: a plan already carried out was claimed again'; end if;
  raise notice 'PASS: a plan is carried out once';
  delete from public.workout_sessions where id = v_sess2;

  -- 4. The wrong workout for a plan links nothing.
  select s.session_id into v_sess2
    from public.start_workout('10000000-0000-0000-0000-000000000003', null, v_tpl1, null, v_plan2) s;
  select schedule_id into v_link from public.workout_sessions where id = v_sess2;
  if v_link is not null then raise exception 'FAIL: a plan was linked to another workout'; end if;
  delete from public.workout_sessions where id = v_sess2;

  -- 5. A free session with the same name links nothing.
  select s.session_id into v_free
    from public.start_workout('10000000-0000-0000-0000-000000000004', 'Push A', null, null, null) s;
  select schedule_id into v_link from public.workout_sessions where id = v_free;
  if v_link is not null then raise exception 'FAIL: a free session was linked to a plan'; end if;
  delete from public.workout_sessions where id = v_free;
  raise notice 'PASS: wrong workout and free session link nothing';

  -- 6. A food log retried with the same token is written once.
  select id into v_meal from public.meal_types where user_id is null order by sort_order limit 1;
  insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                source, notes, is_estimate, client_token)
  values (a, current_date, v_meal, 1, 'serving', 500, 20, 'manual', 'Lunch out', true,
          '20000000-0000-0000-0000-000000000001');
  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                  source, notes, is_estimate, client_token)
    values (a, current_date, v_meal, 1, 'serving', 500, 20, 'manual', 'Lunch out', true,
            '20000000-0000-0000-0000-000000000001');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: the same token wrote a second food log'; end if;
  insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                source, notes, is_estimate, client_token)
  values (a, current_date, v_meal, 1, 'serving', 500, 20, 'manual', 'Lunch out', true,
          '20000000-0000-0000-0000-000000000002');
  raise notice 'PASS: a retried food log is written once';
end $$;

-- ------------------------------------------------------------------ user B
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare
  v_bench bigint;
  v_tpl   bigint;
  v_sess  bigint;
  v_link  bigint;
  v_plan  bigint := (select v from plan_ids where k = 'plan1');
  v_raised boolean;
begin
  select id into v_bench from public.exercises where slug = 'barbell-bench-press';
  v_tpl := public.save_workout_template(null, 'Push A', null, jsonb_build_array(
    jsonb_build_object('exercise_id', v_bench, 'target_sets', 1, 'rest_seconds', 90)));

  select s.session_id into v_sess
    from public.start_workout('30000000-0000-0000-0000-000000000001', null, v_tpl, null, v_plan) s;
  select schedule_id into v_link from public.workout_sessions where id = v_sess;
  if v_link is not null then raise exception 'FAIL: B linked a session to A''s plan'; end if;

  v_raised := false;
  begin
    update public.workout_sessions set schedule_id = v_plan where id = v_sess;
  exception when insufficient_privilege or foreign_key_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B attached a session to A''s plan by update'; end if;
  raise notice 'PASS: another user''s plan attaches nothing';
end $$;

select 'plan link and log token hold at the database' as result;

rollback;
