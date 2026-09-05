-- CalDef — RLS isolation test.
--
-- Proves that a signed-in user cannot read or write another user's rows,
-- on every table, and that anon reaches nothing.
--
-- HOW TO RUN
--   Each numbered section is a separate statement batch. `set local` only
--   survives one batch, so run them as separate calls (Supabase MCP
--   execute_sql, or psql with an explicit transaction per section).
--   Section 0 seeds, sections 1-4 assert, section 5 tears everything down.
--   Run against the development project only.
--
-- WHAT "PASS" LOOKS LIKE
--   1: every `seen` equals its `expected`
--   2: every count is 0 except own_profile_updated, which is 1
--   3 and 4: return their result row without raising
--
-- Section 1 asserts what B must NOT see, and asserts the shared tables by
-- what is hidden rather than by a row count. An earlier version expected
-- exactly one global food, which was true only while the database was empty
-- and started failing as soon as real foods were cached — a test that goes
-- red for a reason that is not a defect is a test people stop running.

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
   '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

-- profiles are expected to appear here on their own, via handle_new_user.

do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  v_food_id bigint; v_custom_food_id bigint; v_serving_id bigint;
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
end $$;

-- =====================================================================
-- 1. READ ISOLATION — as user B, every `seen` must equal `expected`
-- =====================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

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
union all select 'foods: shared row reachable', count(*), 1
  from public.foods where source_id = 'TEST-1'
union all select 'meal_types: A custom hidden', count(*), 0
  from public.meal_types where slug = 'pre_workout'
union all select 'meal_types: builtins reachable', count(*), 4
  from public.meal_types where user_id is null
order by 1;

-- =====================================================================
-- 2. WRITE ISOLATION — B mutates everything it can reach.
--    All counts must be 0 except own_profile_updated = 1, which proves
--    the policies are scoped rather than simply denying everything.
-- =====================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

with
  u_weight  as (update public.weight_entries set weight_kg = 1 returning 1),
  d_logs    as (delete from public.food_logs returning 1),
  u_phase   as (update public.cut_phases set start_weight_kg = 1 returning 1),
  d_miles   as (delete from public.cut_phase_milestones returning 1),
  u_msg     as (update public.ai_messages set content = 'hacked' returning 1),
  d_conv    as (delete from public.ai_conversations returning 1),
  d_recipe  as (delete from public.recipe_ingredients returning 1),
  u_recipe  as (update public.recipes set name = 'hacked' returning 1),
  d_smitem  as (delete from public.saved_meal_items returning 1),
  u_smeal   as (update public.saved_meals set name = 'hacked' returning 1),
  d_fav     as (delete from public.favorite_foods returning 1),
  u_food    as (update public.foods set name = 'hacked' returning 1),
  d_serv    as (delete from public.food_servings returning 1),
  d_nutr    as (delete from public.food_nutrients returning 1),
  u_prof    as (update public.profiles set display_name = 'hacked' returning 1)
select
  (select count(*) from u_weight) as weight_updated,
  (select count(*) from d_logs)   as logs_deleted,
  (select count(*) from u_phase)  as phases_updated,
  (select count(*) from d_miles)  as milestones_deleted,
  (select count(*) from u_msg)    as ai_messages_updated,
  (select count(*) from d_conv)   as ai_conversations_deleted,
  (select count(*) from d_recipe) as recipe_ingredients_deleted,
  (select count(*) from u_recipe) as recipes_updated,
  (select count(*) from d_smitem) as saved_meal_items_deleted,
  (select count(*) from u_smeal)  as saved_meals_updated,
  (select count(*) from d_fav)    as favorites_deleted,
  (select count(*) from u_food)   as foods_updated,
  (select count(*) from d_serv)   as servings_deleted,
  (select count(*) from d_nutr)   as nutrients_deleted,
  (select count(*) from u_prof)   as own_profile_updated;

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
  -- Read as the definer, since B cannot see these. Knowing an id must not
  -- be enough, which is precisely the assumption under test.
  select id into v_recipe from public.recipes where user_id = a limit 1;
  select id into v_meal from public.saved_meals where user_id = a limit 1;
  select id into v_conv from public.ai_conversations where user_id = a limit 1;
  select id into v_food from public.foods where source_id = 'TEST-1' limit 1;

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
    'food_servings','meal_types']
  loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise exception 'FAIL: anon read % (% rows)', t, n;
    exception when insufficient_privilege then
      null; -- expected
    end;
  end loop;
  raise notice 'PASS: anon denied on all 20 tables';
end $$;

select 'anon denied on all 20 tables' as result;

-- =====================================================================
-- 5. TEARDOWN — removes only what section 0 created
-- =====================================================================

delete from auth.users
 where id in ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222');

delete from public.foods where source = 'usda' and source_id = 'TEST-1';
