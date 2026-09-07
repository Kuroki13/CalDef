-- Does `save_custom_food` write all of a food or none of it?
--
-- The function touches three tables in order: `foods`, then
-- `food_nutrients`, then `food_servings`. The failure this exists to rule
-- out is the one that actually happened before the function existed — a
-- later statement raising after an earlier one had already committed its
-- change, leaving a food with a new name and old nutrition.
--
-- The test makes the middle statement fail on purpose, by handing the
-- function a calorie figure `food_nutrients` will not accept, and then
-- checks that the name change which had already been applied inside the
-- function is gone. The application never sends a figure like that —
-- `custom-input.ts` refuses it first — which is the point: this asks what
-- the database does when something gets past the application, not what the
-- application does.
--
-- Everything runs in one transaction and rolls back, so it is safe against
-- a database with real data in it.

begin;

-- --------------------------------------------------------------- fixture

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('33333333-3333-3333-3333-333333333333',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'atomicity-test@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

do $$
declare
  a uuid := '33333333-3333-3333-3333-333333333333';
  v_food_id bigint;
begin
  insert into public.foods (source, source_id, name, brand, user_id)
  values ('custom', 'ATOMICITY-TEST', 'Original Name', 'Original Brand', a)
  returning id into v_food_id;

  insert into public.food_nutrients (food_id, kcal, protein_g, carbs_g, fat_g)
  values (v_food_id, 100, 10, 20, 5);

  insert into public.food_servings (food_id, label, grams, is_default)
  values (v_food_id, '1 bar', 45, true);

  perform set_config('caldef_test.food_id', v_food_id::text, true);
end $$;

-- ------------------------------------------------- 1. a failing edit writes nothing

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_food bigint := current_setting('caldef_test.food_id')::bigint;
  v_name text;
  v_brand text;
  v_kcal numeric;
  v_grams numeric;
  v_raised boolean := false;
begin
  begin
    -- 5000 kcal per 100 g is not a food, and `food_nutrients` says so. The
    -- name and brand are changed by an earlier statement in the same call.
    perform public.save_custom_food(
      v_food,
      'Renamed By A Doomed Edit',
      'Renamed Brand',
      null,
      '{"kcal":5000,"protein_g":10,"carbs_g":20,"fat_g":5}'::jsonb,
      '[{"label":"1 bar","grams":99,"isDefault":true}]'::jsonb);
  exception when check_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL: the database accepted 5000 kcal per 100 g';
  end if;

  select f.name, f.brand, n.kcal, s.grams
    into v_name, v_brand, v_kcal, v_grams
    from public.foods f
    join public.food_nutrients n on n.food_id = f.id
    join public.food_servings s on s.food_id = f.id
   where f.id = v_food;

  -- The whole point. Before the function existed, the name would be the new
  -- one here and the nutrition the old one.
  if v_name <> 'Original Name' then
    raise exception 'FAIL: the name survived a failed edit (%)', v_name;
  end if;
  if v_brand <> 'Original Brand' then
    raise exception 'FAIL: the brand survived a failed edit (%)', v_brand;
  end if;
  if v_kcal <> 100 then
    raise exception 'FAIL: the nutrition moved during a failed edit (%)', v_kcal;
  end if;
  if v_grams <> 45 then
    raise exception 'FAIL: the serving moved during a failed edit (%)', v_grams;
  end if;

  raise notice 'PASS: a failed edit wrote nothing at all';
end $$;

-- --------------------------------------------- 2. a good edit writes all of it

do $$
declare
  v_food bigint := current_setting('caldef_test.food_id')::bigint;
  v_name text; v_kcal numeric; v_grams numeric; v_servings int;
begin
  perform public.save_custom_food(
    v_food,
    'Corrected Name',
    'Corrected Brand',
    '3017624010701',
    '{"kcal":250,"protein_g":12,"carbs_g":30,"fat_g":8,"fiber_g":3}'::jsonb,
    '[{"label":"1 bar","grams":50,"isDefault":true}]'::jsonb);

  select f.name, n.kcal, s.grams
    into v_name, v_kcal, v_grams
    from public.foods f
    join public.food_nutrients n on n.food_id = f.id
    join public.food_servings s on s.food_id = f.id
   where f.id = v_food;

  if v_name <> 'Corrected Name' or v_kcal <> 250 or v_grams <> 50 then
    raise exception 'FAIL: a good edit did not land (%, %, %)', v_name, v_kcal, v_grams;
  end if;

  -- Matched by label, so the serving a diary entry could be pointing at
  -- keeps its id instead of being replaced.
  select count(*) into v_servings from public.food_servings where food_id = v_food;
  if v_servings <> 1 then
    raise exception 'FAIL: expected one serving, found %', v_servings;
  end if;

  raise notice 'PASS: a good edit lands in full';
end $$;

-- ------------------------------------- 3. it is still the caller's food only

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_food bigint := current_setting('caldef_test.food_id')::bigint;
  v_raised boolean := false;
begin
  begin
    perform public.save_custom_food(
      v_food, 'Stolen', null, null,
      '{"kcal":100,"protein_g":1,"carbs_g":1,"fat_g":1}'::jsonb, '[]'::jsonb);
  exception when insufficient_privilege then
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL: another user edited this food through the function';
  end if;

  raise notice 'PASS: the function is security invoker, so RLS still decides';
end $$;

-- ------------------------------------------------- 4. anon cannot call it

set local role anon;

do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.save_custom_food(
      null, 'Anon Food', null, null,
      '{"kcal":100,"protein_g":1,"carbs_g":1,"fat_g":1}'::jsonb, '[]'::jsonb);
  exception when insufficient_privilege then
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL: anon executed save_custom_food';
  end if;

  raise notice 'PASS: anon cannot execute the function';
end $$;

select 'custom food writes are all-or-nothing' as result;

rollback;
