-- Make API permissions reproducible without relying on project defaults.
-- RLS controls rows only after the role has the corresponding table grant.
-- TRUNCATE bypasses RLS, so API roles receive only ordinary row operations.

revoke all on all tables in schema public from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema public
  to authenticated;

revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to authenticated;

-- Trigger invocation does not require the caller to execute these as RPCs.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
