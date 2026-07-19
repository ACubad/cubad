-- Make Phase 6 privileges deterministic even when a hosted project has broader default grants.
-- RLS remains the row-level boundary; these grants are the coarse table-level boundary.
revoke all on table public.payment_claims from public, anon, authenticated;
grant select, insert, delete on table public.payment_claims to authenticated;
grant all on table public.payment_claims to service_role;

revoke all on table public.app_settings from public, anon, authenticated;
grant select on table public.app_settings to anon, authenticated;
grant all on table public.app_settings to service_role;
