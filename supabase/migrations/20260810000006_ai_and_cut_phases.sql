-- CalDef 0006 — assistant threads and the bounded cut phase.

-- --------------------------------------------------------- ai_conversations

create table public.ai_conversations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index ai_conversations_user_id_idx
  on public.ai_conversations (user_id, updated_at desc);

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

alter table public.ai_conversations enable row level security;

create policy ai_conversations_select_own on public.ai_conversations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_conversations_insert_own on public.ai_conversations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ai_conversations_update_own on public.ai_conversations
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_conversations_delete_own on public.ai_conversations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -------------------------------------------------------------- ai_messages

create table public.ai_messages (
  id               bigint generated always as identity primary key,
  conversation_id  bigint not null references public.ai_conversations (id) on delete cascade,
  role             public.ai_role not null,
  content          text not null check (length(content) > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.ai_messages is
  'Assistant transcript. Stored here for the user only — what is SENT to '
  'the model is limited to food text and anonymous aggregate figures.';

create index ai_messages_conversation_id_idx
  on public.ai_messages (conversation_id, created_at);

create trigger ai_messages_set_updated_at
  before update on public.ai_messages
  for each row execute function public.set_updated_at();

alter table public.ai_messages enable row level security;

create policy ai_messages_select_own on public.ai_messages
  for select to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
create policy ai_messages_insert_own on public.ai_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
create policy ai_messages_update_own on public.ai_messages
  for update to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
create policy ai_messages_delete_own on public.ai_messages
  for delete to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));

-- -------------------------------------------------------------- cut_phases

-- The four goal concepts from the spec are four separate columns on
-- purpose, so nothing in the code can quietly collapse them into one
-- number: start_weight_kg, recommended_target_low/high_kg (the phase
-- target), stretch_target_kg, and final_goal_weight_kg.
create table public.cut_phases (
  id                         bigint generated always as identity primary key,
  user_id                    uuid not null references auth.users (id) on delete cascade,
  phase_number               integer not null default 1 check (phase_number > 0),
  name                       text not null default '2-Month Cut',
  start_date                 date not null,
  end_date                   date not null,
  duration_days              integer not null default 56 check (duration_days between 7 and 365),
  start_weight_kg            numeric(5, 2) not null check (start_weight_kg between 20 and 500),
  recommended_target_low_kg  numeric(5, 2) check (recommended_target_low_kg between 20 and 500),
  recommended_target_high_kg numeric(5, 2) check (recommended_target_high_kg between 20 and 500),
  stretch_target_kg          numeric(5, 2) check (stretch_target_kg between 20 and 500),
  final_goal_weight_kg       numeric(5, 2) check (final_goal_weight_kg between 20 and 500),
  initial_tdee_kcal          numeric(7, 1) check (initial_tdee_kcal between 800 and 10000),
  initial_target_kcal        integer check (initial_target_kcal between 800 and 10000),
  initial_protein_g          numeric(6, 1) check (initial_protein_g >= 0),
  status                     public.cut_phase_status not null default 'active',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint cut_phases_end_after_start check (end_date > start_date),
  constraint cut_phases_recommended_range
    check (recommended_target_low_kg is null
           or recommended_target_high_kg is null
           or recommended_target_low_kg <= recommended_target_high_kg)
);

comment on column public.cut_phases.stretch_target_kg is
  'Aspirational only. It is displayed and charted, but never used to '
  'derive a calorie target.';

create index cut_phases_user_id_idx on public.cut_phases (user_id, start_date desc);
create unique index cut_phases_one_active_per_user_idx
  on public.cut_phases (user_id) where status = 'active';

create trigger cut_phases_set_updated_at
  before update on public.cut_phases
  for each row execute function public.set_updated_at();

alter table public.cut_phases enable row level security;

create policy cut_phases_select_own on public.cut_phases
  for select to authenticated using ((select auth.uid()) = user_id);
create policy cut_phases_insert_own on public.cut_phases
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy cut_phases_update_own on public.cut_phases
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy cut_phases_delete_own on public.cut_phases
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------- cut_phase_milestones

-- Recomputed from the adaptive trend, not a flat subtraction per week.
create table public.cut_phase_milestones (
  id                      bigint generated always as identity primary key,
  cut_phase_id            bigint not null references public.cut_phases (id) on delete cascade,
  week_number             integer not null check (week_number between 0 and 52),
  milestone_date          date not null,
  recommended_weight_kg   numeric(5, 2) not null check (recommended_weight_kg between 20 and 500),
  stretch_weight_kg       numeric(5, 2) check (stretch_weight_kg between 20 and 500),
  actual_trend_weight_kg  numeric(5, 2) check (actual_trend_weight_kg between 20 and 500),
  recomputed_at           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint cut_phase_milestones_phase_week_key unique (cut_phase_id, week_number)
);

create index cut_phase_milestones_phase_id_idx
  on public.cut_phase_milestones (cut_phase_id, week_number);

create trigger cut_phase_milestones_set_updated_at
  before update on public.cut_phase_milestones
  for each row execute function public.set_updated_at();

alter table public.cut_phase_milestones enable row level security;

create policy cut_phase_milestones_select_own on public.cut_phase_milestones
  for select to authenticated
  using (exists (
    select 1 from public.cut_phases p
    where p.id = cut_phase_id and p.user_id = (select auth.uid())
  ));
create policy cut_phase_milestones_insert_own on public.cut_phase_milestones
  for insert to authenticated
  with check (exists (
    select 1 from public.cut_phases p
    where p.id = cut_phase_id and p.user_id = (select auth.uid())
  ));
create policy cut_phase_milestones_update_own on public.cut_phase_milestones
  for update to authenticated
  using (exists (
    select 1 from public.cut_phases p
    where p.id = cut_phase_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.cut_phases p
    where p.id = cut_phase_id and p.user_id = (select auth.uid())
  ));
create policy cut_phase_milestones_delete_own on public.cut_phase_milestones
  for delete to authenticated
  using (exists (
    select 1 from public.cut_phases p
    where p.id = cut_phase_id and p.user_id = (select auth.uid())
  ));

-- Nothing in this application is reachable without a session. anon holds
-- no privileges on user data; RLS policies are all scoped to
-- authenticated, and this makes that explicit at the grant level too.
revoke all on all tables in schema public from anon;
