-- Authenticated `/api/state` requests run with the caller's JWT, so the
-- account-state RLS policies need matching SQL privileges on a clean stack.
-- There is deliberately no DELETE grant and RLS still scopes every granted
-- operation to user_id = auth.uid().

grant select, insert, update on table public.user_state to authenticated;
