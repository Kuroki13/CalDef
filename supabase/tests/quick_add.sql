-- Quick Add at the database (migration 0014).
--
-- An estimate may point at nothing, must say what it was, may omit a
-- weight, and is capped; every other row keeps the old exactly-one rule.
-- And an estimate is as private as any other entry.
--
-- One transaction, rolled back.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('66666666-6666-6666-6666-666666666666',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'quick-add-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('77777777-7777-7777-7777-777777777777',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'quick-add-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  a uuid := '66666666-6666-6666-6666-666666666666';
  v_meal bigint := (select id from public.meal_types where user_id is null order by sort_order limit 1);
  v_raised boolean;
begin
  -- 1. An estimate with a label and no weight is accepted.
  insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit,
                                grams, kcal, protein_g, source, notes, is_estimate)
  values (a, current_date, v_meal, 1, 'serving', null, 750, 45, 'manual',
          'Dinner out', true);
  raise notice 'PASS: an estimate attached to nothing is accepted';

  -- 2. Without a label it is refused.
  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit,
                                  kcal, source, is_estimate)
    values (a, current_date, v_meal, 1, 'serving', 500, 'manual', true);
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: an unlabelled estimate was accepted'; end if;

  -- 3. Above the cap it is refused.
  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit,
                                  kcal, source, notes, is_estimate)
    values (a, current_date, v_meal, 1, 'serving', 9000, 'manual', 'Typo', true);
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a 9000 kcal estimate was accepted'; end if;

  -- 4. A row that is not an estimate still needs a food or recipe, and a weight.
  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit,
                                  grams, kcal, source, notes)
    values (a, current_date, v_meal, 1, 'serving', 100, 500, 'manual', 'No food');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a non-estimate with no food was accepted'; end if;

  v_raised := false;
  begin
    insert into public.food_logs (user_id, log_date, meal_type_id, amount, unit,
                                  kcal, source, notes)
    values (a, current_date, v_meal, 1, 'serving', 500, 'manual', 'No weight');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a non-estimate with no weight was accepted'; end if;

  raise notice 'PASS: label, cap and the old exactly-one rule all hold';
end $$;

-- 5. User B cannot see A's estimate.
set local request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

do $$
begin
  if exists (select 1 from public.food_logs where notes = 'Dinner out') then
    raise exception 'FAIL: user B can read user A''s estimate';
  end if;
  raise notice 'PASS: an estimate is as private as any entry';
end $$;

select 'quick add holds at the database' as result;

rollback;
