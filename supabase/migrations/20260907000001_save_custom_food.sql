-- CalDef 0009 — one custom food, written in one transaction.
--
-- Creating or editing a custom food touches three tables: `foods`,
-- `food_nutrients` and `food_servings`. Through PostgREST that is three
-- round trips with no transaction around them, so a failure part-way
-- through leaves a food half-edited — which is not theoretical: it happened
-- during the 2026-09-06 deployment verification, when a serving collided
-- with its own unique constraint after the nutrition had already been
-- rewritten, and the page went on showing the stale figures.
--
-- A function body is a single transaction, so this closes it: either every
-- statement lands or none does.
--
-- `security invoker` is the important word. The function runs as the caller,
-- so every RLS policy still applies to every statement inside it — the
-- ownership rules are not being bypassed for convenience, they are being
-- enforced in one transaction instead of three. A `security definer`
-- function would have been the easy way to write this and would have handed
-- every authenticated caller the ability to edit anyone's food.
--
-- `search_path = ''` is set for the usual reason: an unqualified name in a
-- function body resolves against the caller's search path, so every
-- reference here is schema-qualified.

create or replace function public.save_custom_food(
  p_food_id     bigint,
  p_name        text,
  p_brand       text,
  p_barcode     text,
  p_nutrients   jsonb,
  p_servings    jsonb,
  p_source_id   text default null,
  p_description text default null
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_food_id  bigint;
  v_serving  jsonb;
  v_labels   text[];
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_food_id is null then
    insert into public.foods
      (source, source_id, name, brand, barcode, is_verified, user_id, description)
    values
      ('custom',
       -- A caller may supply the identity, which is how the restaurant
       -- catalogue recognises a row it imported before. Otherwise the row
       -- gets one of its own, so a custom food is a food like any other to
       -- the rest of the app rather than a special case.
       coalesce(p_source_id, pg_catalog.gen_random_uuid()::text),
       p_name, p_brand, p_barcode, false, v_user, p_description)
    returning id into v_food_id;
  else
    -- Filtered on the owner as well as the id. RLS would refuse a foreign
    -- row anyway; the filter is what turns that into "no such food", which
    -- is the right answer about a row that is none of the caller's business.
    -- `source_id` is never rewritten by an edit: it is the row's identity,
    -- and the catalogue importer looks foods up by it. A null description
    -- leaves the stored one alone rather than clearing it, because the edit
    -- form has no description field and must not erase what it cannot show.
    update public.foods
       set name        = p_name,
           brand       = p_brand,
           barcode     = p_barcode,
           description = coalesce(p_description, description)
     where id = p_food_id and user_id = v_user
    returning id into v_food_id;

    if v_food_id is null then
      raise exception 'That food is not one of yours' using errcode = '42501';
    end if;
  end if;

  insert into public.food_nutrients
    (food_id, kcal, protein_g, carbs_g, fat_g,
     fiber_g, sugar_g, sat_fat_g, sodium_mg)
  values
    (v_food_id,
     (p_nutrients->>'kcal')::numeric,
     (p_nutrients->>'protein_g')::numeric,
     (p_nutrients->>'carbs_g')::numeric,
     (p_nutrients->>'fat_g')::numeric,
     (p_nutrients->>'fiber_g')::numeric,
     (p_nutrients->>'sugar_g')::numeric,
     (p_nutrients->>'sat_fat_g')::numeric,
     (p_nutrients->>'sodium_mg')::numeric)
  on conflict (food_id) do update set
    kcal      = excluded.kcal,
    protein_g = excluded.protein_g,
    carbs_g   = excluded.carbs_g,
    fat_g     = excluded.fat_g,
    fiber_g   = excluded.fiber_g,
    sugar_g   = excluded.sugar_g,
    sat_fat_g = excluded.sat_fat_g,
    sodium_mg = excluded.sodium_mg;

  -- Cleared before any row claims it again, because
  -- `food_servings_one_default_idx` allows exactly one default per food and
  -- is checked per statement.
  update public.food_servings set is_default = false where food_id = v_food_id;

  select coalesce(pg_catalog.array_agg(x->>'label'), '{}')
    into v_labels
    from pg_catalog.jsonb_array_elements(coalesce(p_servings, '[]'::jsonb)) x;

  for v_serving in
    select * from pg_catalog.jsonb_array_elements(coalesce(p_servings, '[]'::jsonb))
  loop
    -- Matched by label rather than replaced: a serving a diary entry points
    -- at must keep its id, or `on delete set null` would turn "1 bar" into
    -- a bare gram figure on a row already written.
    insert into public.food_servings (food_id, label, grams, is_default)
    values (v_food_id,
            v_serving->>'label',
            (v_serving->>'grams')::numeric,
            coalesce((v_serving->>'isDefault')::boolean, false))
    on conflict (food_id, label) do update set
      grams      = excluded.grams,
      is_default = excluded.is_default;
  end loop;

  -- Servings the label no longer mentions go, unless something already
  -- written points at them.
  delete from public.food_servings s
   where s.food_id = v_food_id
     and not (s.label = any (v_labels))
     and not exists (select 1 from public.food_logs l where l.serving_id = s.id)
     and not exists (select 1 from public.recipe_ingredients r where r.serving_id = s.id)
     and not exists (select 1 from public.saved_meal_items m where m.serving_id = s.id);

  return v_food_id;
end;
$$;

comment on function public.save_custom_food is
  'Creates or edits one custom food in a single transaction. Runs as the '
  'caller, so RLS decides what it may touch. Never writes food_logs: an '
  'entry keeps the numbers it was logged with.';

-- The API roles are explicit here for the same reason migration 0007 made
-- table privileges explicit: a function is executable by PUBLIC by default,
-- and "everyone including anon" is not a decision anyone made.
revoke all on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text) from public;
revoke all on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text) from anon;
grant execute on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text) to authenticated;
