create or replace function public.admin_overview_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'onboarded_users', (select count(*) from public.profiles where onboarded_at is not null),
    'active_entitlements', (
      select count(*)
      from public.entitlements
      where revoked_at is null and now() between starts_at and expires_at
    ),
    'pending_claims', (
      select count(*) from public.payment_claims where status = 'pending'
    ),
    'codes_redeemed_30d', (
      select count(*)
      from public.code_redemptions
      where created_at > now() - interval '30 days'
    ),
    'dau_proxy', (
      select count(*)
      from public.user_state
      where updated_at > now() - interval '24 hours'
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_overview_stats() from public, anon;
grant execute on function public.admin_overview_stats() to authenticated, service_role;
