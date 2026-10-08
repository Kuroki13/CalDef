-- CalDef — RLS isolation test.
--
-- Proves that a signed-in user cannot read or write another user's rows,
-- on every table, and that anon reaches nothing.
--
-- HOW TO RUN
--   Run this ENTIRE file on one authorized Postgres connection, with
--   ON_ERROR_STOP enabled (psql -X -v ON_ERROR_STOP=1 -f ...).
--   Use development first; production verification uses a migration
--   connection, never Supabase MCP. All fixtures roll back. Identity
--   sequences may advance, which does not create food or user history.
--   Any failed assertion aborts the transaction; disconnect to roll back.
--   Fixed test identities must not already exist: seed conflicts abort.
--
-- PASS means every assertion completes and the final ROLLBACK succeeds.

begin;

-- Table grants and role attributes are independent of row policies.
do $$
declare t record; operation text; policy_count int; table_count int;
begin
  if exists (select 1 from pg_roles where rolname in ('anon', 'authenticated')
             and (rolsuper or rolbypassrls)) then
    raise exception 'FAIL: API role bypasses RLS';
  end if;
  select count(*) into table_count from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r';
  if table_count <> 21 then raise exception 'FAIL: expected 21 tables'; end if;
  for t in select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
  loop
    if not t.relrowsecurity then raise exception 'FAIL: RLS disabled on %', t.relname; end if;
    select count(distinct cmd) into policy_count from pg_policies
      where schemaname = 'public' and tablename = t.relname
      and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
    if policy_count <> 4 then raise exception 'FAIL: missing policies on %', t.relname; end if;
    foreach operation in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('authenticated', 'public.' || t.relname, operation) then
        raise exception 'FAIL: authenticated lacks % on %', operation, t.relname;
      end if;
      if has_table_privilege('anon', 'public.' || t.relname, operation) then
        raise exception 'FAIL: anon has % on %', operation, t.relname;
      end if;
    end loop;
    if has_table_privilege('authenticated', 'public.' || t.relname, 'TRUNCATE')
      or has_table_privilege('anon', 'public.' || t.relname, 'TRUNCATE') then
      raise exception 'FAIL: API role can truncate %', t.relname;
    end if;
  end loop;
  raise notice 'PASS: grants, API roles, RLS and four policies on all 21 tables';
end $$;

-- =====================================================================
-- 0. SEED — two users, one row per table owned by user A
-- =====================================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-test-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-test-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- profiles are expected to appear here on their own, via handle_new_user.

do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  v_food_id bigint; v_custom_food_id bigint; v_serving_id bigint;
  v_custom_log_id bigint;
  v_meal_id bigint; v_recipe_id bigint; v_saved_id bigint;
  v_conv_id bigint; v_phase_id bigint;
begin
  insert into public.foods (source, source_id, name, is_verified)
  values ('usda', 'TEST-1', 'Test Chicken Breast', true) returning id into v_food_id;
  insert into public.food_nutrients (food_id, kcal, protein_g, carbs_g, fat_g)
  values (v_food_id, 165, 31, 0, 3.6);
  insert into public.food_servings (food_id, label, grams, is_default)
  values (v_food_id, '100 g', 100, true) returning id into v_serving_id;

  insert into public.foods (source, name, user_id)
  values ('custom', 'A Private Food', a) returning id into v_custom_food_id;
  insert into public.food_nutrients (food_id, kcal) values (v_custom_food_id, 100);
  insert into public.food_servings (food_id, label, grams)
    values (v_custom_food_id, 'private portion', 100);

  select id into v_meal_id from public.meal_types where user_id is null and slug = 'lunch';

  insert into public.goals (user_id, final_goal_weight_kg) values (a, 90);
  insert into public.daily_targets (user_id, target_date, calories, protein_g)
    values (a, current_date, 2250, 180);
  insert into public.weight_entries (user_id, entry_date, weight_kg)
    values (a, current_date, 111.8);
  insert into public.tdee_estimates (user_id, computed_for, estimated_tdee_kcal, method)
    values (a, current_date, 3357, 'formula');
  insert into public.weekly_checkins (user_id, week_start_date) values (a, current_date);

  insert into public.recipes (user_id, name, servings) values (a, 'A Recipe', 2)
    returning id into v_recipe_id;
  insert into public.recipe_ingredients (recipe_id, food_id, amount, unit, grams)
    values (v_recipe_id, v_food_id, 200, 'g', 200);

  insert into public.saved_meals (user_id, name) values (a, 'A Saved Meal')
    returning id into v_saved_id;
  insert into public.saved_meal_items (saved_meal_id, food_id, amount, unit, grams)
    values (v_saved_id, v_food_id, 150, 'g', 150);

  insert into public.favorite_foods (user_id, food_id) values (a, v_food_id);

  insert into public.food_logs
    (user_id, log_date, meal_type_id, food_id, serving_id, amount, unit, grams,
     kcal, protein_g, carbs_g, fat_g)
    values (a, current_date, v_meal_id, v_food_id, v_serving_id, 200, 'g', 200,
            330, 62, 0, 7.2);

  insert into public.ai_conversations (user_id, title) values (a, 'A Thread')
    returning id into v_conv_id;
  insert into public.ai_messages (conversation_id, role, content)
    values (v_conv_id, 'user', 'test message');

  insert into public.cut_phases
    (user_id, start_date, end_date, start_weight_kg, stretch_target_kg,
     final_goal_weight_kg)
    values (a, current_date, current_date + 56, 111.8, 99, 90)
    returning id into v_phase_id;
  insert into public.cut_phase_milestones
    (cut_phase_id, week_number, milestone_date, recommended_weight_kg, stretch_weight_kg)
    values (v_phase_id, 1, current_date + 7, 110.7, 110.2);

  insert into public.meal_types (user_id, slug, name) values (a, 'pre_workout', 'Pre-workout');
  perform set_config('caldef_test.recipe_id', v_recipe_id::text, true);
  perform set_config('caldef_test.saved_meal_id', v_saved_id::text, true);
  perform set_config('caldef_test.conversation_id', v_conv_id::text, true);
  perform set_config('caldef_test.food_id', v_food_id::text, true);
  perform set_config('caldef_test.private_food_id', v_custom_food_id::text, true);

  -- A diary entry against A's own custom food, so section 5 can prove that
  -- editing the food leaves what was already eaten alone.
  insert into public.food_logs
    (user_id, log_date, meal_type_id, food_id, amount, unit, grams,
     kcal, protein_g, carbs_g, fat_g)
    values (a, current_date, v_meal_id, v_custom_food_id, 50, 'g', 50,
            50, 5, 5, 1)
    returning id into v_custom_log_id;
  perform set_config('caldef_test.custom_log_id', v_custom_log_id::text, true);
end $$;

-- =====================================================================
-- 1. READ ISOLATION — as user B, every `seen` must equal `expected`
-- =====================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare result record;
begin
for result in (
select 'profiles' as t, count(*) as seen, 1 as expected from public.profiles
union all select 'goals', count(*), 0 from public.goals
union all select 'daily_targets', count(*), 0 from public.daily_targets
union all select 'weight_entries', count(*), 0 from public.weight_entries
union all select 'tdee_estimates', count(*), 0 from public.tdee_estimates
union all select 'weekly_checkins', count(*), 0 from public.weekly_checkins
union all select 'food_logs', count(*), 0 from public.food_logs
union all select 'recipes', count(*), 0 from public.recipes
union all select 'recipe_ingredients', count(*), 0 from public.recipe_ingredients
union all select 'saved_meals', count(*), 0 from public.saved_meals
union all select 'saved_meal_items', count(*), 0 from public.saved_meal_items
union all select 'favorite_foods', count(*), 0 from public.favorite_foods
union all select 'ai_conversations', count(*), 0 from public.ai_conversations
union all select 'ai_messages', count(*), 0 from public.ai_messages
union all select 'cut_phases', count(*), 0 from public.cut_phases
union all select 'cut_phase_milestones', count(*), 0 from public.cut_phase_milestones
-- Shared rows are visible to everyone by design, so these assert the
-- boundary instead: A's private food and A's custom meal type stay hidden,
-- and the row seeded as global is still reachable.
union all select 'foods: A private food hidden', count(*), 0
  from public.foods where name = 'A Private Food'
union all select 'food_nutrients: A private food hidden', count(*), 0
  from public.food_nutrients where food_id = current_setting('caldef_test.private_food_id')::bigint
union all select 'food_servings: A private food hidden', count(*), 0
  from public.food_servings where food_id = current_setting('caldef_test.private_food_id')::bigint
union all select 'foods: shared row reachable', count(*), 1
  from public.foods where source_id = 'TEST-1'
union all select 'meal_types: A custom hidden', count(*), 0
  from public.meal_types where slug = 'pre_workout'
union all select 'meal_types: builtins reachable', count(*), 4
  from public.meal_types where user_id is null
order by 1
) loop
  if result.seen <> result.expected then
    raise exception 'FAIL: read isolation on %: saw %, expected %',
      result.t, result.seen, result.expected;
  end if;
end loop;
raise notice 'PASS: read isolation';
end $$;

-- =====================================================================
-- 2. WRITE ISOLATION — B mutates everything it can reach.
--    All counts must be 0 except own_profile_updated = 1, which proves
--    the policies are scoped rather than simply denying everything.
-- =====================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare t text; affected bigint; predicate text;
begin
  foreach t in array array[
    'profiles','goals','daily_targets','weight_entries','tdee_estimates',
    'weekly_checkins','food_logs','recipes','recipe_ingredients','saved_meals',
    'saved_meal_items','favorite_foods','ai_conversations','ai_messages',
    'cut_phases','cut_phase_milestones','foods','food_nutrients',
    'food_servings','meal_types','food_vocabulary']
  loop
    -- Shared cache rows past the freshness window are *meant* to be
    -- writable by any signed-in user (migration 0010: a stale provider row
    -- may be refreshed). Without excluding them this assertion is a clock:
    -- it passes until the database's cache is thirty days old, then fails
    -- forever. The fixture's own shared row is fresh, so it is still here
    -- and still refused.
    predicate := case
      when t = 'profiles' then ' where id <> auth.uid()'
      when t = 'foods' then
        ' where not (user_id is null and refreshed_at < now() - interval ''30 days'')'
      when t in ('food_nutrients', 'food_servings') then
        ' where food_id not in (select id from public.foods where user_id is null'
        || ' and refreshed_at < now() - interval ''30 days'')'
      else '' end;
    execute format('update public.%I set updated_at = updated_at%s', t, predicate);
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL: foreign update on % affected % rows', t, affected;
    end if;
    execute format('delete from public.%I%s', t, predicate);
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL: foreign delete on % affected % rows', t, affected;
    end if;
  end loop;
  update public.profiles set display_name = 'RLS positive control'
    where id = auth.uid();
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'FAIL: own profile update affected % rows', affected;
  end if;
  raise notice 'PASS: update/delete isolation on all 21 tables; own update allowed';
end $$;

-- =====================================================================
-- 3. FORGED OWNERSHIP — B may not insert a row it claims A owns
-- =====================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Two shapes of forgery are covered. A row that names A as its owner, and
-- a child row hung off a parent A owns — recipe ingredients, saved-meal
-- items and AI messages have no `user_id` of their own, so their policies
-- reach through to the parent, and that is the reach being tested here.
do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  v_recipe bigint; v_meal bigint; v_conv bigint; v_food bigint;
begin
  -- Capture known foreign IDs before switching roles, not via a SELECT
  -- that RLS would hide. A null ID would not test forged parentage.
  v_recipe := current_setting('caldef_test.recipe_id')::bigint;
  v_meal := current_setting('caldef_test.saved_meal_id')::bigint;
  v_conv := current_setting('caldef_test.conversation_id')::bigint;
  v_food := current_setting('caldef_test.food_id')::bigint;
  if v_recipe is null or v_meal is null or v_conv is null or v_food is null then
    raise exception 'FAIL: missing forged-parent fixture IDs';
  end if;

  begin
    insert into public.weight_entries (user_id, entry_date, weight_kg)
      values (a, current_date - 1, 100);
    raise exception 'FAIL: forged weight_entry accepted';
  exception when insufficient_privilege then
    raise notice 'PASS: forged weight_entry rejected';
  end;

  begin
    insert into public.goals (user_id, final_goal_weight_kg) values (a, 70);
    raise exception 'FAIL: forged goal accepted';
  exception when insufficient_privilege then
    raise notice 'PASS: forged goal rejected';
  end;

  begin
    insert into public.recipes (user_id, name, servings) values (a, 'forged', 1);
    raise exception 'FAIL: forged recipe accepted';
  exception when insufficient_privilege then
    raise notice 'PASS: forged recipe rejected';
  end;

  begin
    insert into public.recipe_ingredients (recipe_id, food_id, amount, unit, grams)
      values (v_recipe, v_food, 100, 'g', 100);
    raise exception 'FAIL: ingredient added to another user''s recipe';
  exception when insufficient_privilege then
    raise notice 'PASS: ingredient into foreign recipe rejected';
  end;

  begin
    insert into public.saved_meal_items (saved_meal_id, food_id, amount, unit, grams)
      values (v_meal, v_food, 100, 'g', 100);
    raise exception 'FAIL: item added to another user''s saved meal';
  exception when insufficient_privilege then
    raise notice 'PASS: item into foreign saved meal rejected';
  end;

  begin
    insert into public.ai_messages (conversation_id, role, content)
      values (v_conv, 'user', 'forged');
    raise exception 'FAIL: message added to another user''s thread';
  exception when insufficient_privilege then
    raise notice 'PASS: message into foreign thread rejected';
  end;

  begin
    insert into public.favorite_foods (user_id, food_id) values (a, v_food);
    raise exception 'FAIL: forged favorite accepted';
  exception when insufficient_privilege then
    raise notice 'PASS: forged favorite rejected';
  end;
end $$;

select 'every forged write rejected' as result;

-- =====================================================================
-- 4. ANON — the publishable key role reaches no user data
-- =====================================================================

set local role anon;

-- Every table, not a sample. `revoke all ... from anon` is what denies
-- these, and a table added later without that revoke is exactly the kind of
-- omission a three-table spot check would miss.
do $$
declare n int; t text;
begin
  foreach t in array array[
    'profiles','goals','daily_targets','weight_entries','tdee_estimates',
    'weekly_checkins','food_logs','recipes','recipe_ingredients','saved_meals',
    'saved_meal_items','favorite_foods','ai_conversations','ai_messages',
    'cut_phases','cut_phase_milestones','foods','food_nutrients',
    'food_servings','meal_types','food_vocabulary']
  loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise exception 'FAIL: anon read % (% rows)', t, n;
    exception when insufficient_privilege then
      null; -- expected
    end;
  end loop;
  raise notice 'PASS: anon denied on all 21 tables';
end $$;

select 'anon denied on all 21 tables' as result;

-- =====================================================================
-- 5. CUSTOM FOODS — owned by one user, and never rewriting history
-- =====================================================================
--
-- Two separate guarantees, both of which the feature depends on and neither
-- of which is visible from the application code alone.

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_food bigint := current_setting('caldef_test.private_food_id')::bigint;
  affected int;
begin
  -- B cannot see A's food...
  if exists (select 1 from public.foods where id = v_food) then
    raise exception 'FAIL: another user''s custom food is visible';
  end if;

  -- ...nor edit it, retire it, or delete it. RLS makes each of these match
  -- zero rows rather than raise, which is the correct shape: the row is not
  -- refused, it is not there.
  update public.foods set name = 'Stolen' where id = v_food;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: foreign custom food renamed'; end if;

  update public.foods set archived_at = now() where id = v_food;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: foreign custom food archived'; end if;

  delete from public.foods where id = v_food;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: foreign custom food deleted'; end if;

  -- Nor may B claim a food as their own by writing A's id into it.
  begin
    insert into public.foods (source, name, user_id)
      values ('custom', 'Forged Ownership', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: custom food forged onto another user';
  exception when insufficient_privilege then
    raise notice 'PASS: forged custom food ownership rejected';
  end;

  raise notice 'PASS: custom foods are invisible and untouchable to other users';
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_food bigint := current_setting('caldef_test.private_food_id')::bigint;
  v_log  bigint := current_setting('caldef_test.custom_log_id')::bigint;
  before_kcal numeric; after_kcal numeric;
  before_protein numeric; after_protein numeric;
  visible int;
begin
  select kcal, protein_g into before_kcal, before_protein
    from public.food_logs where id = v_log;
  if before_kcal is null then
    raise exception 'FAIL: the fixture diary entry is missing';
  end if;

  -- The owner corrects the label: the packet said 250 kcal, not 100.
  update public.food_nutrients set kcal = 250, protein_g = 30 where food_id = v_food;
  update public.foods set name = 'A Private Food (corrected)' where id = v_food;

  select kcal, protein_g into after_kcal, after_protein
    from public.food_logs where id = v_log;

  -- The entry was computed at log time and frozen. Nothing about editing the
  -- food may reach back into a day that has already been counted.
  if after_kcal <> before_kcal or after_protein <> before_protein then
    raise exception 'FAIL: editing a food changed a logged entry: % -> % kcal',
      before_kcal, after_kcal;
  end if;
  raise notice 'PASS: editing a custom food leaves logged entries untouched';

  -- Retiring it hides it from search without breaking the entry that used it.
  update public.foods set archived_at = now() where id = v_food;

  select count(*) into visible
    from public.foods where id = v_food and archived_at is null;
  if visible <> 0 then raise exception 'FAIL: archived food still active'; end if;

  select count(*) into visible
    from public.food_logs l join public.foods f on f.id = l.food_id
    where l.id = v_log;
  if visible <> 1 then
    raise exception 'FAIL: archived food no longer resolves for its diary entry';
  end if;
  raise notice 'PASS: a retired food still names the entries it fed';

  -- And a food history depends on cannot be deleted out from under it.
  begin
    delete from public.foods where id = v_food;
    raise exception 'FAIL: deleted a food a diary entry references';
  exception when foreign_key_violation then
    raise notice 'PASS: delete refused while a diary entry references the food';
  end;
end $$;

select 'custom food ownership and history preserved' as result;

-- =====================================================================
-- 6. TEARDOWN — rollback, including on a production migration connection.
-- =====================================================================

rollback;
