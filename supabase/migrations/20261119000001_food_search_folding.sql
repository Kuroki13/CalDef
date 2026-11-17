-- CalDef 0026 — the food cache is searched without accents or ligatures.
--
-- `foods.search_text` is the raw name and brand, matched with `ilike`, which
-- ignores case but not accents: "cafe" missed "Café", and "oeuf" missed
-- "Œufs frais" (and "œuf", as French keyboards type it, missed "oeuf dur").
-- This adds a second generated column, folded the way the app folds a query
-- (lib/food/cache.ts `termConditions`): `unaccent`, which also writes out
-- ligatures (œ → oe, æ → ae, ß → ss), then `lower`.
--
-- Additive only: search_text, its index and every row are unchanged. Arabic
-- terms keep matching search_text, because Arabic is normalised differently.
--
-- Deployment order: this migration first, then the code that reads
-- search_folded. The old code never mentions the new column.

create extension if not exists unaccent with schema extensions;

-- `unaccent` is STABLE (its dictionary could in principle be changed), so a
-- generated column cannot call it directly. This wrapper names the
-- dictionary explicitly and pins the search path, which is the documented
-- way to use it in an index or generated column. It lives in `extensions`,
-- not `public`, so it is not exposed as an API function.
create or replace function extensions.caldef_search_fold(value text)
  returns text
  language sql
  immutable
  parallel safe
  strict
  set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, value))
$$;

comment on function extensions.caldef_search_fold(text) is
  'CalDef: accent- and ligature-folded lower case, for foods.search_folded.';

alter table public.foods
  add column search_folded text
    generated always as (
      extensions.caldef_search_fold(coalesce(name, '') || ' ' || coalesce(brand, ''))
    ) stored;

comment on column public.foods.search_folded is
  'Name and brand, lower-cased with accents removed and ligatures written '
  'out. Matched by the cache search for Latin-script terms.';

create index foods_search_folded_trgm_idx
  on public.foods using gin (search_folded extensions.gin_trgm_ops);
