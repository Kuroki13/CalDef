-- CalDef 0025 — a session knows which plan it carried out, and a food log
-- can be retried without being written twice.
--
-- Additive only. Existing rows are untouched:
--
--   * workout_sessions.schedule_id is null on every existing session. Those
--     sessions keep being matched to plans by the old rule (same workout,
--     same day, started after the plan was made — `lib/training/plans.ts`),
--     and the app says such a match is inferred. New sessions started from a
--     plan carry its id, so two plans and a free session of the same name on
--     the same day can no longer be confused.
--   * food_logs.client_token is null on every existing entry. A null token
--     is never compared, so nothing old can collide with anything new.
--
-- Deployment order: this migration first, then the code. The old code calls
-- the four-argument start_workout, which is left exactly as it was; the new
-- code calls the five-argument overload added here. Neither column is
-- required, so old code writing without them keeps working.

-- ------------------------------------------------------------ plan link

alter table public.workout_sessions
  add column schedule_id bigint
    references public.workout_schedule (id) on delete set null;

comment on column public.workout_sessions.schedule_id is
  'The planned occurrence this session carried out, when it was started from '
  'one. Null for free sessions and for sessions recorded before the link '
  'existed. Cancelling the plan later keeps the session and clears the link.';

-- A plan is carried out once: a second session cannot claim the same plan.
create unique index workout_sessions_schedule_id_key
  on public.workout_sessions (schedule_id) where schedule_id is not null;

-- A foreign key is checked without RLS, so knowing another user's plan id
-- must not be enough to attach a session to it (ARCHITECTURE invariant 22).
create policy workout_sessions_schedule_owned on public.workout_sessions
  as restrictive for all to authenticated
  using (true)
  with check (
    schedule_id is null or exists (
      select 1 from public.workout_schedule p
      where p.id = schedule_id and p.user_id = (select auth.uid())
    )
  );

-- The five-argument start. Same behaviour as the four-argument one, plus the
-- plan link. A plan that is not this user's, is for another workout, or has
-- already been carried out is not linked — the session still starts.
create function public.start_workout(
  p_token        uuid,
  p_name         text,
  p_template_id  bigint,
  p_from_session bigint,
  p_schedule_id  bigint
) returns table (session_id bigint, resumed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_id      bigint;
  v_resumed boolean;
  v_plan    bigint;
begin
  select s.session_id, s.resumed into v_id, v_resumed
    from public.start_workout(p_token, p_name, p_template_id, p_from_session) s;

  if p_schedule_id is not null and not v_resumed then
    -- RLS limits this to the user's own plans.
    select p.id into v_plan
      from public.workout_schedule p
     where p.id = p_schedule_id
       and p.template_id = p_template_id
       and not exists (
         select 1 from public.workout_sessions s
          where s.schedule_id = p.id and s.id <> v_id
       );
    if v_plan is not null then
      update public.workout_sessions
         set schedule_id = v_plan
       where id = v_id and user_id = v_uid and schedule_id is null;
    end if;
  end if;

  return query select v_id, v_resumed;
end;
$$;

revoke all on function public.start_workout(uuid, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.start_workout(uuid, text, bigint, bigint, bigint) to authenticated;

-- ------------------------------------------------------------- log token

alter table public.food_logs
  add column client_token uuid;

comment on column public.food_logs.client_token is
  'Made by the browser when an add-food form opens. A retried submission '
  'carries the same token and is refused by the unique index instead of '
  'writing a second entry.';

create unique index food_logs_client_token_key
  on public.food_logs (user_id, client_token) where client_token is not null;
