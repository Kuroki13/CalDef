-- CalDef 0001 — extensions, enum types, shared helper functions.
--
-- Additive only. The database must be reproducible from the files in
-- this directory alone; never create schema by hand in the dashboard.

create extension if not exists pg_trgm with schema extensions;

-- Keeps updated_at honest without the application having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Trigger function: stamps updated_at = now() on every UPDATE.';

create type public.sex_type          as enum ('male', 'female', 'other');
create type public.unit_system       as enum ('metric', 'imperial');
create type public.goal_type         as enum ('lose', 'maintain', 'gain', 'recomp');
create type public.activity_level    as enum ('sedentary', 'light', 'moderate', 'very', 'extra');
create type public.food_source       as enum ('usda', 'off', 'custom');
create type public.log_source        as enum ('manual', 'ai', 'barcode', 'saved_meal', 'recipe', 'favorite');
create type public.target_source     as enum ('initial', 'weekly_adjustment', 'phase', 'manual');
create type public.tdee_method       as enum ('formula', 'adaptive');
create type public.confidence_level  as enum ('low', 'medium', 'high');
create type public.cut_phase_status  as enum ('active', 'completed', 'abandoned');
create type public.ai_role           as enum ('user', 'assistant', 'system');
