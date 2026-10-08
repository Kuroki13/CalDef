-- CalDef 0016 — personal vocabulary (spec §13I).
--
-- "warak", "my yogurt", "the usual", "mom's maqlouba": words that mean one
-- particular food *to this user*. When they search a phrase and log the
-- same food or recipe for it more than once, that choice comes first the
-- next time they type it.
--
-- These are personal preferences, never universal truths. Every row belongs
-- to one user, is visible to that user alone, and can be deleted by them
-- — the spec requires every learned mapping to be editable and reversible.
-- Nothing here is ever sent to a model.
--
-- `phrase_key` is the phrase normalised the way the app compares food
-- words (`lib/food/cultural/normalize.ts`), so "Warak", "warak" and
-- "wara2" are one phrase; `phrase` keeps what was typed, for showing back.
--
-- A mapping points at exactly one food or one recipe, and goes with it if
-- it is deleted. A retired (archived) food is not deleted, so its mapping
-- survives until the user removes it.

create table public.food_vocabulary (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  phrase_key      text not null check (length(phrase_key) between 1 and 200),
  phrase          text not null check (length(trim(phrase)) between 1 and 200),
  food_id         bigint references public.foods (id) on delete cascade,
  recipe_id       bigint references public.recipes (id) on delete cascade,
  choice_count    integer not null default 1 check (choice_count >= 1),
  last_chosen_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint food_vocabulary_one_target
    check (num_nonnulls(food_id, recipe_id) = 1),
  constraint food_vocabulary_unique_choice
    unique nulls not distinct (user_id, phrase_key, food_id, recipe_id)
);

comment on table public.food_vocabulary is
  'What a phrase means to one user: the food or recipe they keep choosing '
  'for it. Private, editable, deletable; never sent to a model.';

create index food_vocabulary_user_phrase_idx
  on public.food_vocabulary (user_id, phrase_key);
create index food_vocabulary_food_id_idx on public.food_vocabulary (food_id);
create index food_vocabulary_recipe_id_idx on public.food_vocabulary (recipe_id);

create trigger food_vocabulary_set_updated_at
  before update on public.food_vocabulary
  for each row execute function public.set_updated_at();

alter table public.food_vocabulary enable row level security;

create policy food_vocabulary_select_own on public.food_vocabulary
  for select to authenticated using ((select auth.uid()) = user_id);
create policy food_vocabulary_insert_own on public.food_vocabulary
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy food_vocabulary_update_own on public.food_vocabulary
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy food_vocabulary_delete_own on public.food_vocabulary
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Explicit, as migration 20260905000001 made every table's grants: the
-- project's default privileges would otherwise hand anon this table too.
revoke all on public.food_vocabulary from public, anon, authenticated;
grant select, insert, update, delete on public.food_vocabulary to authenticated;

-- Recording a choice is an upsert that must count, not overwrite, and must
-- not race with itself on a double tap. A function body does it in one
-- statement. `security invoker`: RLS decides, exactly as for a plain insert.
create or replace function public.record_food_choice(
  p_phrase_key text,
  p_phrase     text,
  p_food_id    bigint,
  p_recipe_id  bigint
) returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.food_vocabulary (user_id, phrase_key, phrase, food_id, recipe_id)
  values ((select auth.uid()), p_phrase_key, p_phrase, p_food_id, p_recipe_id)
  on conflict (user_id, phrase_key, food_id, recipe_id) do update
    set choice_count   = public.food_vocabulary.choice_count + 1,
        last_chosen_at = now(),
        phrase         = excluded.phrase;
$$;

revoke all on function public.record_food_choice(text, text, bigint, bigint) from public, anon;
grant execute on function public.record_food_choice(text, text, bigint, bigint) to authenticated;
