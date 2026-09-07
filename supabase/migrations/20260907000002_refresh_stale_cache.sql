-- CalDef 0010 — letting a stale cached food be refreshed, and only then.
--
-- The cache has been insert-only since it was written. A provider food is
-- fetched once and reused for ever, so a nutrition figure corrected upstream
-- never arrives. KNOWN ISSUES recorded why: shared cache rows carry
-- `user_id IS NULL`, and `foods_update_own` reads `auth.uid() = user_id`,
-- which is never true for a null owner — so no authenticated user may update
-- one, and `cacheFood` reuses whatever it finds.
--
-- The obvious fix is to let authenticated users update shared rows. That is
-- rejected: it would let anyone rewrite the nutrition of a food everybody
-- else logs.
--
-- What is granted instead is narrower, and it is bounded by the thing that
-- makes a refresh legitimate in the first place: a shared row may be updated
-- only once it is **stale**. Inside the freshness window a provider food is
-- immutable to everyone.
--
-- Worth being clear about what this is and is not. Any authenticated user
-- could already *insert* a shared cache row with whatever nutrition they
-- liked — `foods_insert_cache_or_own` has always permitted `user_id is
-- null`. So this does not open a new class of thing; it closes an asymmetry,
-- under a condition. A genuinely multi-tenant deployment would want the
-- refresh to run as a trusted job instead, and the staleness window is what
-- keeps that change small when it is wanted.
--
-- None of this can reach a diary entry. `food_logs` stores the macros
-- computed at log time; refreshing a food changes what future logs will say
-- and nothing that has already been written. `supabase/tests/
-- cache_refresh_history.sql` asserts exactly that.

alter table public.foods
  add column refreshed_at timestamptz not null default now();

comment on column public.foods.refreshed_at is
  'When this row last agreed with its provider. Older than the freshness '
  'window means a search or a barcode lookup may rewrite it from a fresh '
  'provider response; inside the window the row is immutable.';

-- Existing rows are dated by when they were cached, which is the honest
-- answer for them: `created_at` is when the provider was last consulted.
update public.foods set refreshed_at = created_at;

create index foods_refreshed_at_idx
  on public.foods (refreshed_at) where user_id is null;

-- ------------------------------------------------------ the narrow grant

-- Thirty days. Long enough that ordinary use never rewrites a row, short
-- enough that a corrected figure arrives within a month of being corrected.
-- The application uses the same number (`lib/food/staleness.ts`); it lives
-- in both places because the policy must be enforceable without trusting
-- the client, and the client must not attempt writes the policy will refuse.
create policy foods_refresh_stale_cache on public.foods
  for update to authenticated
  using (user_id is null and refreshed_at < now() - interval '30 days')
  with check (user_id is null);

create policy food_nutrients_refresh_stale_cache on public.food_nutrients
  for update to authenticated
  using (exists (
    select 1 from public.foods f
    where f.id = food_id
      and f.user_id is null
      and f.refreshed_at < now() - interval '30 days'
  ))
  with check (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id is null
  ));

create policy food_servings_refresh_stale_cache on public.food_servings
  for update to authenticated
  using (exists (
    select 1 from public.foods f
    where f.id = food_id
      and f.user_id is null
      and f.refreshed_at < now() - interval '30 days'
  ))
  with check (exists (
    select 1 from public.foods f where f.id = food_id and f.user_id is null
  ));

-- No new insert policy is needed for a serving the refresh has to add:
-- `food_servings_insert_visible` has always permitted inserting one for a
-- shared food. And no delete is granted, deliberately — a serving a diary
-- entry points at must not vanish, because `on delete set null` would
-- quietly turn "1 slice" into a bare gram figure on a row already written.
