-- A multi-entry food log is written whole and once (ARCHITECTURE invariant
-- 27, extended 2026-11-19). One transaction, rolled back.
--
-- The app writes the rows of one operation — a saved meal, a reviewed AI
-- meal, a repeat, a parts order — in one INSERT, each row under a token
-- derived from the form's operation key (lib/food-log.ts writeLogsOnce).
-- What the database must guarantee for that to hold:
--
--   * a batch whose tokens are all new is written in full;
--   * the same batch again violates (user_id, client_token) and writes
--     nothing — not even the rows that would not have clashed;
--   * a batch where only ONE token clashes writes nothing at all;
--   * another user's rows with the same tokens are a separate operation,
--     and neither user can read the other's;
--   * the rows written keep the figures they were written with.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ops-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ops-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;

-- ------------------------------------------------------------------ user A
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

do $$
declare
  a      constant uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_meal bigint;
  v_n    int;
  v_raised boolean;
begin
  select id into v_meal from public.meal_types order by sort_order limit 1;

  -- A meal of three estimates under three derived tokens: written in full.
  insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                source, notes, is_estimate, client_token)
  values (a, current_date, v_meal, 1, 'serving', 225, 43, 'manual', 'Chicken', true, '30000000-0000-0000-0000-000000000001'),
         (a, current_date, v_meal, 1, 'serving', 260, 6,  'manual', 'Rice',    true, '30000000-0000-0000-0000-000000000002'),
         (a, current_date, v_meal, 1, 'serving', 88,  0,  'manual', 'Oil',     true, '30000000-0000-0000-0000-000000000003');
  select count(*) into v_n from public.food_logs where user_id = a;
  if v_n <> 3 then raise exception 'FAIL: the meal was not written in full (% rows)', v_n; end if;

  -- The same meal again: nothing is written.
  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                  source, notes, is_estimate, client_token)
    values (a, current_date, v_meal, 1, 'serving', 225, 43, 'manual', 'Chicken', true, '30000000-0000-0000-0000-000000000001'),
           (a, current_date, v_meal, 1, 'serving', 260, 6,  'manual', 'Rice',    true, '30000000-0000-0000-0000-000000000002'),
           (a, current_date, v_meal, 1, 'serving', 88,  0,  'manual', 'Oil',     true, '30000000-0000-0000-0000-000000000003');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a retried meal was written again'; end if;

  -- One clashing token among new ones: the whole statement fails, so the
  -- two new rows are not written either. A meal is never half in.
  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                  source, notes, is_estimate, client_token)
    values (a, current_date, v_meal, 1, 'serving', 100, 1, 'manual', 'New one', true, '30000000-0000-0000-0000-000000000009'),
           (a, current_date, v_meal, 1, 'serving', 260, 6, 'manual', 'Rice',    true, '30000000-0000-0000-0000-000000000002'),
           (a, current_date, v_meal, 1, 'serving', 100, 1, 'manual', 'New two', true, '30000000-0000-0000-0000-00000000000a');
  exception when unique_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a partly clashing batch was accepted'; end if;
  select count(*) into v_n from public.food_logs where user_id = a;
  if v_n <> 3 then raise exception 'FAIL: a partly clashing batch left % rows, not 3', v_n; end if;

  -- The figures written are the figures kept.
  if (select kcal from public.food_logs where client_token = '30000000-0000-0000-0000-000000000003') <> 88 then
    raise exception 'FAIL: a written row changed';
  end if;
  raise notice 'PASS: a meal is written whole, once, and never half';
end $$;

-- ------------------------------------------------------------------ user B
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

do $$
declare
  b      constant uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_meal bigint;
  v_n    int;
begin
  select id into v_meal from public.meal_types order by sort_order limit 1;

  -- A's rows are invisible, even by token.
  select count(*) into v_n from public.food_logs
   where client_token in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  if v_n <> 0 then raise exception 'FAIL: user B can read user A''s operation'; end if;

  -- The same tokens are B's own, separate operation.
  insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit, kcal, protein_g,
                                source, notes, is_estimate, client_token)
  values (b, current_date, v_meal, 1, 'serving', 225, 43, 'manual', 'Chicken', true, '30000000-0000-0000-0000-000000000001'),
         (b, current_date, v_meal, 1, 'serving', 260, 6,  'manual', 'Rice',    true, '30000000-0000-0000-0000-000000000002');
  select count(*) into v_n from public.food_logs where user_id = b;
  if v_n <> 2 then raise exception 'FAIL: user B''s operation was blocked by user A''s tokens'; end if;
  raise notice 'PASS: operations are per user';
end $$;

rollback;
