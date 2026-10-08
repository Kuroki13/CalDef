-- Family Foods and cooked weight at the database (migration 0015).
-- A shared provider row can never be someone's family food; a cooked
-- weight must be a weight; and another user cannot mark or read either.
-- One transaction, rolled back.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('88888888-8888-8888-8888-888888888888',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'family-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('99999999-9999-9999-9999-999999999999',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'family-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

do $$
declare v_raised boolean := false;
begin
  begin
    insert into public.foods (source, source_id, name, is_family)
    values ('usda', 'FAMILY-TEST-USDA', 'Shared rice', true);
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a provider row became a family food'; end if;
  raise notice 'PASS: family foods are custom-only';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';

do $$
declare
  v_recipe bigint;
  v_raised boolean := false;
begin
  insert into public.recipes (user_id, name, servings, is_family, cooked_weight_g)
  values ('88888888-8888-8888-8888-888888888888', 'Teta''s maqlouba', 6, true, 2400)
  returning id into v_recipe;
  perform set_config('caldef_test.recipe', v_recipe::text, true);

  begin
    update public.recipes set cooked_weight_g = 0 where id = v_recipe;
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a cooked weight of zero was accepted'; end if;
  raise notice 'PASS: a family recipe with a cooked weight is stored, and the weight is checked';
end $$;

set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

do $$
declare v_count int;
begin
  update public.recipes set is_family = false
   where id = current_setting('caldef_test.recipe')::bigint;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: user B changed user A''s family recipe'; end if;
  if exists (select 1 from public.recipes where id = current_setting('caldef_test.recipe')::bigint) then
    raise exception 'FAIL: user B can read user A''s family recipe';
  end if;
  raise notice 'PASS: another user can neither read nor mark it';
end $$;

select 'family foods hold at the database' as result;

rollback;
