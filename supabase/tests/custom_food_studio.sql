-- §12A: notes, per-100 ml labels and several named portions, at the database.
--
-- Asserts what `custom-input.ts` cannot: that the ten-argument
-- `save_custom_food` (migration 0012) stores notes and the label basis,
-- clears notes on a blank, keeps several portions, still refuses another
-- user's food, and that the schema will not let a note onto a shared
-- provider row — one user's text shown to everyone.
--
-- One transaction, rolled back, so it is safe against a database with real
-- data in it.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('44444444-4444-4444-4444-444444444444',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'studio-test-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('55555555-5555-5555-5555-555555555555',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'studio-test-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- ----------------------------------- 1. a note cannot go on a provider row

do $$
declare
  v_raised boolean := false;
begin
  begin
    insert into public.foods (source, source_id, name, notes)
    values ('usda', 'STUDIO-TEST-USDA', 'Shared food', 'a private note');
  exception when check_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: a shared provider row accepted a note';
  end if;
  raise notice 'PASS: notes are custom-only';
end $$;

-- --------------------------------- 2. create a drink with notes and portions

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_food bigint;
  v_notes text; v_basis text; v_kcal numeric; v_servings int; v_default text;
begin
  v_food := public.save_custom_food(
    null, 'Oat drink', 'Studio Test', null,
    '{"kcal":46,"protein_g":1,"carbs_g":6.7,"fat_g":1.5}'::jsonb,
    '[{"label":"1 glass","grams":250,"isDefault":true},
      {"label":"1 splash","grams":30,"isDefault":false}]'::jsonb,
    null, null, 'barista edition', 'ml');

  select f.notes, f.basis_unit, n.kcal
    into v_notes, v_basis, v_kcal
    from public.foods f join public.food_nutrients n on n.food_id = f.id
   where f.id = v_food;

  if v_notes is distinct from 'barista edition' then
    raise exception 'FAIL: notes not stored (%)', v_notes;
  end if;
  if v_basis <> 'ml' then
    raise exception 'FAIL: basis not stored (%)', v_basis;
  end if;
  if v_kcal <> 46 then
    raise exception 'FAIL: nutrition not stored (%)', v_kcal;
  end if;

  select count(*), max(label) filter (where is_default)
    into v_servings, v_default
    from public.food_servings where food_id = v_food;
  if v_servings <> 2 or v_default <> '1 glass' then
    raise exception 'FAIL: expected two portions with 1 glass default, got % / %', v_servings, v_default;
  end if;

  perform set_config('caldef_test.food_id', v_food::text, true);
  raise notice 'PASS: a drink is created with its note and both portions';
end $$;

-- ------------------------------------------- 3. a blank note clears it

do $$
declare
  v_food bigint := current_setting('caldef_test.food_id')::bigint;
  v_notes text; v_basis text;
begin
  perform public.save_custom_food(
    v_food, 'Oat drink', 'Studio Test', null,
    '{"kcal":46,"protein_g":1,"carbs_g":6.7,"fat_g":1.5}'::jsonb,
    '[{"label":"1 glass","grams":250,"isDefault":true}]'::jsonb,
    null, null, '', 'g');

  select notes, basis_unit into v_notes, v_basis from public.foods where id = v_food;
  if v_notes is not null then
    raise exception 'FAIL: a blank note did not clear it (%)', v_notes;
  end if;
  if v_basis <> 'g' then
    raise exception 'FAIL: basis did not change on edit (%)', v_basis;
  end if;
  raise notice 'PASS: an edit clears a blank note and updates the basis';
end $$;

-- --------------------------------------- 4. user B sees nothing, edits nothing

set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
declare
  v_food bigint := current_setting('caldef_test.food_id')::bigint;
  v_seen int;
  v_raised boolean := false;
begin
  select count(*) into v_seen from public.foods where id = v_food;
  if v_seen <> 0 then
    raise exception 'FAIL: user B can read user A''s food';
  end if;

  begin
    perform public.save_custom_food(
      v_food, 'Stolen', null, null,
      '{"kcal":1,"protein_g":0,"carbs_g":0,"fat_g":0}'::jsonb, '[]'::jsonb,
      null, null, 'mine now', 'g');
  exception when insufficient_privilege then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: user B edited user A''s food';
  end if;
  raise notice 'PASS: another user can neither read nor edit it';
end $$;

-- ----------------------------------------------------- 5. anon cannot call it

set local role anon;

do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.save_custom_food(
      null, 'Anon', null, null,
      '{"kcal":1,"protein_g":0,"carbs_g":0,"fat_g":0}'::jsonb, '[]'::jsonb,
      null, null, null, 'g');
  exception when insufficient_privilege then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'FAIL: anon executed the ten-argument save_custom_food';
  end if;
  raise notice 'PASS: anon cannot execute it';
end $$;

select 'custom food studio holds at the database' as result;

rollback;
