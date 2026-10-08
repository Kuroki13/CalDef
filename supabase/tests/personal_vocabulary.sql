-- Personal vocabulary at the database (migration 0016).
-- Choosing the same food for a phrase twice counts to two; one user's
-- vocabulary is invisible and untouchable to another; a mapping points at
-- exactly one thing; and the anon key cannot record anything.
-- One transaction, rolled back.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vocab-a@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vocab-b@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

do $$
declare v_food bigint;
begin
  insert into public.foods (source, source_id, name)
  values ('usda', 'VOCAB-TEST-1', 'Grape leaves, stuffed with meat')
  returning id into v_food;
  insert into public.food_nutrients (food_id, kcal) values (v_food, 180);
  perform set_config('caldef_test.food', v_food::text, true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare
  v_food bigint := current_setting('caldef_test.food')::bigint;
  v_count int;
  v_raised boolean := false;
begin
  perform public.record_food_choice('warak', 'warak', v_food, null);
  perform public.record_food_choice('warak', 'Warak', v_food, null);
  select choice_count into v_count from public.food_vocabulary
   where phrase_key = 'warak' and food_id = v_food;
  if v_count <> 2 then raise exception 'FAIL: two choices counted as %', v_count; end if;

  begin
    insert into public.food_vocabulary (user_id, phrase_key, phrase)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'nothing', 'nothing');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: a mapping to nothing was accepted'; end if;
  raise notice 'PASS: repeated choices count, and a mapping needs a target';
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare v_count int;
begin
  if exists (select 1 from public.food_vocabulary) then
    raise exception 'FAIL: user B can read user A''s vocabulary';
  end if;
  delete from public.food_vocabulary;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: user B deleted user A''s vocabulary'; end if;

  -- B's own choice for the same word is B's alone, and starts at one.
  perform public.record_food_choice('warak', 'warak', current_setting('caldef_test.food')::bigint, null);
  select choice_count into v_count from public.food_vocabulary where phrase_key = 'warak';
  if v_count <> 1 then raise exception 'FAIL: B''s count started at %', v_count; end if;
  raise notice 'PASS: a word is never redefined for anyone else';
end $$;

set local role anon;

do $$
declare v_raised boolean := false;
begin
  begin
    perform public.record_food_choice('x', 'x', current_setting('caldef_test.food')::bigint, null);
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL: anon recorded a choice'; end if;
  raise notice 'PASS: anon cannot record';
end $$;

select 'personal vocabulary holds at the database' as result;

rollback;
