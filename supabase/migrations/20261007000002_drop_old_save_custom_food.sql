-- CalDef 0013 — retire the eight-argument save_custom_food.
--
-- Migration 0012 added a ten-argument overload beside it so the schema could
-- change before the deploy that uses it. That deploy is live, nothing calls
-- the old signature any more, and two overloads of one function are a trap:
-- a call that happens to fit both is refused by PostgREST as ambiguous.
--
-- Dropping a function removes no data.

drop function if exists public.save_custom_food(bigint, text, text, text, jsonb, jsonb, text, text);
