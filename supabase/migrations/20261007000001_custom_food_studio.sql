-- CalDef 0012 — the rest of a custom food (spec §12A).
--
-- Two things a label can say that a custom food could not record:
--
-- 1. **Notes.** "Buy at the Thursday market", "the 0% one, not the 2%".
--    `foods.description` already exists, but it is not free: the restaurant
--    catalogue uses it as the marker that identifies a food it imported, and
--    refuses to re-import one whose description has been edited. Letting the
--    user type into it would break that. Notes are therefore their own
--    column, and only custom foods may carry them — a provider row is shared,
--    and a note on it would be one user's text shown to everyone.
--
-- 2. **Per 100 ml.** Drinks print their panel per 100 ml. `food_nutrients`
--    stays per 100 g, because every calculation in the app assumes it, and
--    the app already resolves ml at 1 g/ml (`nutrition/units.ts`). Storing a
--    per-100 ml label at that same factor makes logging the drink in ml
--    *exact* — 250 ml is 2.5 × the label, whatever the liquid's density —
--    because the conversion in and the conversion out cancel. `basis_unit`
--    records which one the label used, so the app can say "per 100 ml" and
--    offer ml first, rather than presenting milk as if it were weighed.
--
-- Both columns are additive with safe defaults, so the code already deployed
-- keeps working against this schema unchanged.

alter table public.foods
  add column notes text
    constraint foods_notes_length check (notes is null or length(notes) <= 500),
  add column basis_unit text not null default 'g'
    constraint foods_basis_unit_check check (basis_unit in ('g', 'ml'));

alter table public.foods
  add constraint foods_notes_custom_only
    check (notes is null or source = 'custom');

comment on column public.foods.notes is
  'The owner''s own note on a custom food. Never set on a shared provider row.';
comment on column public.foods.basis_unit is
  'Whether the food''s label is per 100 g or per 100 ml. Nutrients are still '
  'stored per 100 g; ml is resolved at 1 g/ml, so an ml label logged in ml '
  'is exact.';

-- The same function as 0009 with two more parameters.
--
-- It is a new overload rather than a replacement, deliberately. PostgREST
-- picks a function by the names of the arguments sent: the code running in
-- production sends eight and matches only the old signature; the new code
-- sends ten and matches only this one — neither has defaults, so neither
-- call is ambiguous. That lets this migration land before the deploy that
-- uses it without a window in which saving a food fails. The eight-argument
-- version is dropped by a later migration once nothing calls it.

create or replace function public.save_custom_food(
  p_food_id     bigint,
  p_name        text,
  p_brand       text,
  p_barcode     text,
  p_nutrients   jsonb,
  p_servings    jsonb,
  p_source_id   text,
  p_description text,
  p_notes       text,
  p_basis_unit  text
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
  v_basis    text := coalesce(p_basis_unit, 'g');
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_food_id is null then
    insert into public.foods
      (source, source_id, name, brand, barcode, is_verified, user_id,
       description, notes, basis_unit)
    values
      ('custom',
       coalesce(p_source_id, pg_catalog.gen_random_uuid()::text),
       p_name, p_brand, p_barcode, false, v_user,
       p_description, nullif(p_notes, ''), v_basis)
    returning id into v_food_id;
  else
    -- As in 0009: filtered on the owner, `source_id` never rewritten, and a
    -- null description leaves the stored one alone. Notes, unlike the
    -- description, *are* on the edit form, so a blank one clears them.
    update public.foods
       set name        = p_name,
           brand       = p_brand,
           barcode     = p_barcode,
           description = coalesce(p_description, description),
           notes       = nullif(p_notes, ''),
           basis_unit  = v_basis
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

  update public.food_servings set is_default = false where food_id = v_food_id;

  select coalesce(pg_catalog.array_agg(x->>'label'), '{}')
    into v_labels
    from pg_catalog.jsonb_array_elements(coalesce(p_servings, '[]'::jsonb)) x;

  for v_serving in
    select * from pg_catalog.jsonb_array_elements(coalesce(p_servings, '[]'::jsonb))
  loop
    insert into public.food_servings (food_id, label, grams, is_default)
    values (v_food_id,
            v_serving->>'label',
            (v_serving->>'grams')::numeric,
            coalesce((v_serving->>'isDefault')::boolean, false))
    on conflict (food_id, label) do update set
      grams      = excluded.grams,
      is_default = excluded.is_default;
  end loop;

  delete from public.food_servings s
   where s.food_id = v_food_id
     and not (s.label = any (v_labels))
     and not exists (select 1 from public.food_logs l where l.serving_id = s.id)
     and not exists (select 1 from public.recipe_ingredients r where r.serving_id = s.id)
     and not exists (select 1 from public.saved_meal_items m where m.serving_id = s.id);

  return v_food_id;
end;
$$;

comment on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text, text, text) is
  'Creates or edits one custom food in a single transaction, including its '
  'notes and label basis. Runs as the caller, so RLS decides what it may '
  'touch. Never writes food_logs: an entry keeps the numbers it was logged with.';

revoke all on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text, text, text) from public;
revoke all on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text, text, text) from anon;
grant execute on function public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text, text, text) to authenticated;
