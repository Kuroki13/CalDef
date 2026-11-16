-- Training at the database (migrations 20261116000001/2, spec §16).
--
-- What this holds:
--   * the catalogue is readable by a signed-in user and writable by none;
--   * templates, sessions, sets and custom exercises are invisible and
--     untouchable to another user, including through a known id;
--   * a foreign id cannot be used to attach rows to someone else's
--     template or session, nor someone else's exercise to one's own;
--   * starting is idempotent on its token and never opens a second session;
--   * finishing keeps only what was done, refuses an empty session, and a
--     past session survives its template being edited and deleted.
-- One transaction, rolled back.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'training-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'training-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- ------------------------------------------------------------------ user A
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare
  v_bench   bigint;
  v_custom  bigint;
  v_tpl     bigint;
  v_sess    bigint;
  v_sess2   bigint;
  v_resumed boolean;
  v_count   int;
  v_text    text;
  v_raised  boolean;
  v_se      bigint;
begin
  -- The catalogue is there and readable.
  select id into v_bench from public.exercises where slug = 'barbell-bench-press';
  if v_bench is null then raise exception 'FAIL: catalogue not seeded or not readable'; end if;
  select count(*) into v_count from public.exercises where user_id is null;
  if v_count < 150 then raise exception 'FAIL: catalogue has only % exercises', v_count; end if;

  -- ...and cannot be written, by insert, update or delete.
  v_raised := false;
  begin
    insert into public.exercises (user_id, slug, name, muscle_group, equipment, measure)
    values (null, 'injected', 'Injected', 'chest', 'barbell', 'weight_reps');
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a user added to the shared catalogue'; end if;

  update public.exercises set name = 'Hacked' where id = v_bench;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: a user edited the shared catalogue'; end if;
  delete from public.exercises where id = v_bench;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: a user deleted from the shared catalogue'; end if;
  raise notice 'PASS: the catalogue is read-only to users';

  -- A custom exercise, and a template using both.
  insert into public.exercises (user_id, name, muscle_group, equipment, measure)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Garage Sled Drag', 'full_body', 'other', 'distance_duration')
  returning id into v_custom;

  v_tpl := public.save_workout_template(null, 'Push A', null, jsonb_build_array(
    jsonb_build_object('exercise_id', v_bench, 'target_sets', 3, 'rep_min', 8, 'rep_max', 10,
                       'target_weight_kg', 80, 'rest_seconds', 120),
    jsonb_build_object('exercise_id', v_custom, 'target_sets', 2, 'rest_seconds', 60)));
  select count(*) into v_count from public.workout_template_exercises where template_id = v_tpl;
  if v_count <> 2 then raise exception 'FAIL: template saved % exercises', v_count; end if;

  -- Start: three planned bench sets at the target weight, two sled sets.
  select s.session_id, s.resumed into v_sess, v_resumed
    from public.start_workout('11111111-1111-1111-1111-111111111111', null, v_tpl, null) s;
  if v_resumed then raise exception 'FAIL: a first start reported a resume'; end if;
  select count(*) into v_count from public.workout_sets ws
    join public.workout_session_exercises se on se.id = ws.session_exercise_id
   where se.session_id = v_sess;
  if v_count <> 5 then raise exception 'FAIL: session started with % sets', v_count; end if;
  select count(*) into v_count from public.workout_sets ws
    join public.workout_session_exercises se on se.id = ws.session_exercise_id
   where se.session_id = v_sess and ws.weight_kg = 80;
  if v_count <> 3 then raise exception 'FAIL: target weight not carried to the sets'; end if;

  -- The same token again is the same session; a different token while one
  -- is in progress is also that session, reported as a resume.
  select s.session_id, s.resumed into v_sess2, v_resumed
    from public.start_workout('11111111-1111-1111-1111-111111111111', null, v_tpl, null) s;
  if v_sess2 <> v_sess or v_resumed then raise exception 'FAIL: a repeated start was not idempotent'; end if;
  select s.session_id, s.resumed into v_sess2, v_resumed
    from public.start_workout('22222222-2222-2222-2222-222222222222', null, v_tpl, null) s;
  if v_sess2 <> v_sess or not v_resumed then raise exception 'FAIL: a second session was started'; end if;
  select count(*) into v_count from public.workout_sessions;
  if v_count <> 1 then raise exception 'FAIL: % sessions exist after three starts', v_count; end if;

  v_raised := false;
  begin
    insert into public.workout_sessions (user_id, name, start_token)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second', '33333333-3333-3333-3333-333333333333');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: two sessions in progress were allowed'; end if;
  raise notice 'PASS: starting is idempotent and one session runs at a time';

  -- Adding the same set position twice adds it once.
  select id into v_se from public.workout_session_exercises
   where session_id = v_sess and exercise_id = v_bench;
  insert into public.workout_sets (session_exercise_id, position) values (v_se, 3)
    on conflict (session_exercise_id, position) do nothing;
  insert into public.workout_sets (session_exercise_id, position) values (v_se, 3)
    on conflict (session_exercise_id, position) do nothing;
  select count(*) into v_count from public.workout_sets where session_exercise_id = v_se;
  if v_count <> 4 then raise exception 'FAIL: a repeated add-set left % sets', v_count; end if;

  -- Nothing done yet: finishing is refused.
  if public.finish_workout(v_sess) <> 'empty' then
    raise exception 'FAIL: a session with nothing completed was finished';
  end if;

  -- Do two bench sets, then finish.
  update public.workout_sets set reps = 8, completed_at = now()
   where session_exercise_id = v_se and position in (0, 1);
  if public.finish_workout(v_sess) <> 'completed' then raise exception 'FAIL: finish did not complete'; end if;
  if public.finish_workout(v_sess) <> 'completed' then raise exception 'FAIL: finishing twice was not harmless'; end if;

  select count(*) into v_count from public.workout_sets ws
    join public.workout_session_exercises se on se.id = ws.session_exercise_id
   where se.session_id = v_sess;
  if v_count <> 2 then raise exception 'FAIL: history kept % sets, expected the 2 done', v_count; end if;
  select count(*) into v_count from public.workout_session_exercises where session_id = v_sess;
  if v_count <> 1 then raise exception 'FAIL: an exercise with nothing done stayed in history'; end if;
  select status into v_text from public.workout_sessions where id = v_sess;
  if v_text <> 'completed' then raise exception 'FAIL: status is %', v_text; end if;
  raise notice 'PASS: finishing keeps what was done and only that';

  -- Edit the template, then delete it. History does not move.
  perform public.save_workout_template(v_tpl, 'Push A v2', null, jsonb_build_array(
    jsonb_build_object('exercise_id', v_custom, 'target_sets', 5)));
  delete from public.workout_templates where id = v_tpl;
  select name into v_text from public.workout_sessions where id = v_sess;
  if v_text <> 'Push A' then raise exception 'FAIL: history was renamed to %', v_text; end if;
  select exercise_name into v_text from public.workout_session_exercises where session_id = v_sess;
  if v_text <> 'Barbell Bench Press' then raise exception 'FAIL: history lost its exercise'; end if;
  if (select template_id from public.workout_sessions where id = v_sess) is not null then
    raise exception 'FAIL: session still points at a deleted template';
  end if;
  raise notice 'PASS: a past session survives its template being edited and deleted';

  -- Repeat the past session; the custom exercise gets history, and can
  -- then not be deleted from under it.
  select s.session_id into v_sess2
    from public.start_workout('44444444-4444-4444-4444-444444444444', null, null, v_sess) s;
  select count(*) into v_count from public.workout_sets ws
    join public.workout_session_exercises se on se.id = ws.session_exercise_id
   where se.session_id = v_sess2;
  if v_count <> 2 then raise exception 'FAIL: repeating a session planned % sets', v_count; end if;
  insert into public.workout_session_exercises
    (session_id, exercise_id, exercise_name, measure, muscle_group, equipment, position)
  values (v_sess2, v_custom, 'Garage Sled Drag', 'distance_duration', 'full_body', 'other', 1);
  v_raised := false;
  begin
    delete from public.exercises where id = v_custom;
  exception when foreign_key_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: an exercise with history was deleted'; end if;
  raise notice 'PASS: repeat works, and an exercise with history cannot be deleted';

  perform set_config('caldef_test.bench', v_bench::text, true);
  perform set_config('caldef_test.custom', v_custom::text, true);
  perform set_config('caldef_test.sess', v_sess::text, true);
  perform set_config('caldef_test.sess2', v_sess2::text, true);
  perform set_config('caldef_test.se', v_se::text, true);
end $$;

-- A template for B to aim at.
do $$
declare v_tpl bigint;
begin
  v_tpl := public.save_workout_template(null, 'A private plan', null, jsonb_build_array(
    jsonb_build_object('exercise_id', current_setting('caldef_test.bench')::bigint)));
  perform set_config('caldef_test.tpl', v_tpl::text, true);
end $$;

-- ------------------------------------------------------------------ user B
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare
  v_tpl    bigint := current_setting('caldef_test.tpl')::bigint;
  v_sess   bigint := current_setting('caldef_test.sess')::bigint;
  v_sess2  bigint := current_setting('caldef_test.sess2')::bigint;
  v_se     bigint := current_setting('caldef_test.se')::bigint;
  v_custom bigint := current_setting('caldef_test.custom')::bigint;
  v_bench  bigint := current_setting('caldef_test.bench')::bigint;
  v_count  int;
  v_raised boolean;
  v_own    bigint;
begin
  -- Reads: the catalogue yes, anything of A's no.
  if not exists (select 1 from public.exercises where id = v_bench) then
    raise exception 'FAIL: B cannot read the catalogue';
  end if;
  if exists (select 1 from public.exercises where id = v_custom) then
    raise exception 'FAIL: B can read A''s custom exercise';
  end if;
  if exists (select 1 from public.workout_templates)
     or exists (select 1 from public.workout_template_exercises)
     or exists (select 1 from public.workout_sessions)
     or exists (select 1 from public.workout_session_exercises)
     or exists (select 1 from public.workout_sets) then
    raise exception 'FAIL: B can read A''s training data';
  end if;

  -- Writes by known id touch nothing.
  update public.workout_templates set name = 'x' where id = v_tpl;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B renamed A''s template'; end if;
  delete from public.workout_templates where id = v_tpl;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B deleted A''s template'; end if;
  update public.workout_sessions set notes = 'x' where id = v_sess;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B edited A''s session'; end if;
  delete from public.workout_sessions where id = v_sess;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B deleted A''s session'; end if;
  update public.workout_sets set reps = 999 where session_exercise_id = v_se;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B edited A''s sets'; end if;
  delete from public.workout_sets where session_exercise_id = v_se;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B deleted A''s sets'; end if;
  update public.exercises set name = 'x' where id = v_custom;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: B edited A''s exercise'; end if;
  raise notice 'PASS: A''s training data is invisible and untouchable to B';

  -- A known id is not enough to attach rows to A's things.
  v_raised := false;
  begin
    insert into public.workout_template_exercises (template_id, exercise_id, position)
    values (v_tpl, v_bench, 5);
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B added an exercise to A''s template'; end if;

  v_raised := false;
  begin
    insert into public.workout_session_exercises
      (session_id, exercise_id, exercise_name, measure, muscle_group, equipment, position)
    values (v_sess2, v_bench, 'x', 'weight_reps', 'chest', 'barbell', 9);
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B added an exercise to A''s session'; end if;

  v_raised := false;
  begin
    insert into public.workout_sets (session_exercise_id, position) values (v_se, 9);
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B added a set to A''s session'; end if;

  -- Nor to pull A's private exercise or template into B's own data.
  v_raised := false;
  begin
    perform public.save_workout_template(null, 'B plan', null, jsonb_build_array(
      jsonb_build_object('exercise_id', v_custom)));
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B used A''s private exercise in a template'; end if;

  v_raised := false;
  begin
    insert into public.workout_sessions (user_id, template_id, name, start_token)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', v_tpl, 'x', '55555555-5555-5555-5555-555555555555');
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B linked a session to A''s template'; end if;

  v_raised := false;
  begin
    insert into public.workout_sessions (user_id, name, start_token)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '66666666-6666-6666-6666-666666666666');
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B created a session as A'; end if;

  -- The functions answer "not found" for A's ids, exactly as for none.
  v_raised := false;
  begin
    perform public.save_workout_template(v_tpl, 'taken', null, '[]'::jsonb);
  exception when no_data_found then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B overwrote A''s template through the function'; end if;

  v_raised := false;
  begin
    perform * from public.start_workout('77777777-7777-7777-7777-777777777777', null, v_tpl, null);
  exception when no_data_found then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B started A''s template'; end if;

  v_raised := false;
  begin
    perform * from public.start_workout('88888888-8888-8888-8888-888888888888', null, null, v_sess);
  exception when no_data_found then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: B repeated A''s session'; end if;

  if public.finish_workout(v_sess2) <> 'not_found' then
    raise exception 'FAIL: B finished A''s session';
  end if;
  raise notice 'PASS: a foreign id attaches nothing and starts nothing';

  -- B's own start works, and B's session in progress is B's alone — A
  -- having one in progress does not block it.
  select s.session_id into v_own
    from public.start_workout('99999999-9999-9999-9999-999999999999', 'B empty', null, null) s;
  if v_own is null or v_own = v_sess2 then raise exception 'FAIL: B could not start their own session'; end if;
  select count(*) into v_count from public.workout_sessions;
  if v_count <> 1 then raise exception 'FAIL: B sees % sessions', v_count; end if;
  raise notice 'PASS: each user has their own session in progress';
end $$;

-- -------------------------------------------------------------------- anon
set local role anon;

do $$
declare v_raised boolean := false;
begin
  begin
    perform 1 from public.exercises limit 1;
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: anon can read exercises'; end if;

  v_raised := false;
  begin
    perform * from public.start_workout('99999999-0000-0000-0000-000000000000', 'x', null, null);
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: anon can start a workout'; end if;
  raise notice 'PASS: anon reaches nothing';
end $$;

select 'training holds at the database' as result;

rollback;
