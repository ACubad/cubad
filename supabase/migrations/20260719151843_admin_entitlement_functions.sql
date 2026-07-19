create or replace function public.admin_grant_entitlement(
  p_user_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_tier_id uuid,
  p_duration_days int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.tiers where id = p_tier_id) then
    raise exception 'tier not found' using errcode = 'P0002';
  end if;
  if p_scope_type not in ('all', 'track', 'subject')
     or (p_scope_type = 'all') <> (p_scope_id is null) then
    raise exception 'invalid entitlement scope' using errcode = '22023';
  end if;
  if p_scope_type = 'track' and not exists (select 1 from public.tracks where id = p_scope_id) then
    raise exception 'scope track not found' using errcode = 'P0002';
  end if;
  if p_scope_type = 'subject' and not exists (select 1 from public.subjects where id = p_scope_id) then
    raise exception 'scope subject not found' using errcode = 'P0002';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'duration must be positive' using errcode = '22023';
  end if;

  -- Phase 4's function remains the only implementation of append-only stacking arithmetic.
  v_id := public.grant_entitlement(
    p_user_id, p_scope_type, p_scope_id, p_tier_id, p_duration_days, 'admin', null
  );
  perform public.log_admin_action(
    'entitlement.grant',
    'entitlements',
    v_id::text,
    jsonb_build_object(
      'user_id', p_user_id,
      'scope_type', p_scope_type,
      'scope_id', p_scope_id,
      'tier_id', p_tier_id,
      'duration_days', p_duration_days
    )
  );
  return v_id;
end;
$$;

revoke all on function public.admin_grant_entitlement(uuid, text, uuid, uuid, int) from public, anon;
grant execute on function public.admin_grant_entitlement(uuid, text, uuid, uuid, int)
  to authenticated, service_role;
