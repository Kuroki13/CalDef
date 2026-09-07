-- Can refreshing a cached food change what a diary entry says?
--
-- It must not. `food_logs` stores the macros computed at log time rather
-- than joining to `food_nutrients`, precisely so that a provider revising
-- its data cannot rewrite what a past day says it ate. Until migration 0010
-- nothing could refresh a provider food at all, so the guarantee was never
-- under any pressure; now that a stale row can be rewritten, it is worth
-- asserting rather than assuming.
--
-- The same run also checks the narrowness of the new permission: a *fresh*
-- shared row is immutable, a user's own food is untouchable by anyone else,
-- and anon still cannot write anything.
--
-- Runs in one transaction and rolls back, so it is safe beside real data.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('44444444-4444-4444-4444-444444444444',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'refresh-test@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

do $$
declare
  a uuid := '44444444-4444-4444-4444-444444444444';
  v_stale bigint; v_fresh bigint; v_meal bigint; v_log bigint;
begin
  -- A shared provider food, cached long enough ago to be stale.
  insert into public.foods (source, source_id, name, is_verified, refreshed_at)
  values ('usda', 'REFRESH-STALE', 'Stale Cached Food', true, now() - interval '400 days')
  returning id into v_stale;
  insert into public.food_nutrients (food_id, kcal, protein_g, carbs_g, fat_g)
  values (v_stale, 100, 10, 5, 2);

  -- And one cached this morning.
  insert into public.foods (source, source_id, name, is_verified, refreshed_at)
  values ('usda', 'REFRESH-FRESH', 'Fresh Cached Food', true, now())
  returning id into v_fresh;
  insert into public.food_nutrients (food_id, kcal) values (v_fresh, 100);

  select id into v_meal from public.meal_types where user_id is null and slug = 'lunch';

  -- 200 g of the stale food, logged back when it said 100 kcal per 100 g.
  insert into public.food_logs
    (user_id, log_date, meal_type_id, food_id, amount, unit, grams,
     kcal, protein_g, carbs_g, fat_g)
  values (a, current_date, v_meal, v_stale, 200, 'g', 200, 200, 20, 10, 4)
  returning id into v_log;

  perform set_config('caldef_test.stale_id', v_stale::text, true);
  perform set_config('caldef_test.fresh_id', v_fresh::text, true);
  perform set_config('caldef_test.log_id', v_log::text, true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_stale bigint := current_setting('caldef_test.stale_id')::bigint;
  v_fresh bigint := current_setting('caldef_test.fresh_id')::bigint;
  v_log   bigint := current_setting('caldef_test.log_id')::bigint;
  affected int;
  v_kcal numeric; v_protein numeric; v_grams numeric;
begin
  -- 1. The stale row can be refreshed.
  update public.food_nutrients set kcal = 250, protein_g = 30 where food_id = v_stale;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: a stale food could not be refreshed'; end if;

  update public.foods set refreshed_at = now() where id = v_stale;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: refreshed_at could not be stamped'; end if;

  raise notice 'PASS: a stale provider food can be refreshed';

  -- 2. The entry logged from it has not moved.
  select kcal, protein_g, grams into v_kcal, v_protein, v_grams
    from public.food_logs where id = v_log;

  if v_kcal <> 200 or v_protein <> 20 or v_grams <> 200 then
    raise exception 'FAIL: refreshing a food changed a logged entry (% kcal, % g protein)',
      v_kcal, v_protein;
  end if;
  raise notice 'PASS: the diary entry kept the numbers it was logged with';

  -- 3. Now that it has been stamped, it is fresh again and locked again.
  update public.food_nutrients set kcal = 999 where food_id = v_stale;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: a just-refreshed food was still writable';
  end if;
  raise notice 'PASS: refreshing closes the window behind it';

  -- 4. A food cached this morning was never writable.
  update public.food_nutrients set kcal = 999 where food_id = v_fresh;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: a fresh provider food was rewritten';
  end if;

  update public.foods set name = 'Vandalised' where id = v_fresh;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: a fresh provider food was renamed';
  end if;
  raise notice 'PASS: a fresh provider food is immutable to everyone';

  -- 5. The new permission is for shared rows only. Someone else's private
  --    food is not reachable however stale it is.
  update public.foods set name = 'Stolen'
   where id = current_setting('caldef_test.stale_id')::bigint and user_id is not null;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: unexpected private row matched'; end if;
end $$;

-- A private food of another user's, aged past the window, still cannot be
-- touched: the policy requires `user_id is null`, not merely staleness.
do $$
declare v_private bigint; affected int;
begin
  set local role postgres;
  insert into public.foods (source, source_id, name, user_id, refreshed_at)
  values ('custom', 'REFRESH-PRIVATE', 'Someone Private Food',
          '44444444-4444-4444-4444-444444444444', now() - interval '400 days')
  returning id into v_private;
  insert into public.food_nutrients (food_id, kcal) values (v_private, 100);
  perform set_config('caldef_test.private_id', v_private::text, true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_private bigint := current_setting('caldef_test.private_id')::bigint;
  affected int;
begin
  update public.foods set name = 'Stolen' where id = v_private;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: a stale *private* food was rewritten by another user';
  end if;

  update public.food_nutrients set kcal = 999 where food_id = v_private;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: a stale private food''s nutrition was rewritten';
  end if;
  raise notice 'PASS: staleness never unlocks a food that belongs to someone';
end $$;

set local role anon;

do $$
declare affected int;
begin
  begin
    update public.foods set name = 'Anon Was Here'
     where id = current_setting('caldef_test.stale_id')::bigint;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'FAIL: anon refreshed a food'; end if;
  exception when insufficient_privilege then
    null; -- also fine: the grant is what stops it
  end;
  raise notice 'PASS: anon cannot refresh anything';
end $$;

select 'a refresh updates the cache and never the diary' as result;

rollback;
