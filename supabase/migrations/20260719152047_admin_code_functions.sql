create or replace function public.admin_generate_codes(
  p_tier_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_duration_days int,
  p_max_redemptions int,
  p_valid_until timestamptz,
  p_note text,
  p_batch_id uuid,
  p_code_hashes text[]
)
returns table(code_hash text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tiers where id = p_tier_id) then
    raise exception 'tier not found' using errcode = 'P0002';
  end if;
  if p_scope_type not in ('all', 'track', 'subject')
     or (p_scope_type = 'all') <> (p_scope_id is null) then
    raise exception 'invalid code scope' using errcode = '22023';
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
  if p_max_redemptions <> 1 then
    raise exception 'Phase 5 access codes are one-time only' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until <= now() then
    raise exception 'valid_until must be in the future' using errcode = '22023';
  end if;
  if p_batch_id is null
     or coalesce(array_length(p_code_hashes, 1), 0) not between 1 and 500
     or exists (select 1 from unnest(p_code_hashes) as hashes(hash) where hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid code batch' using errcode = '22023';
  end if;

  return query
    insert into public.access_codes (
      code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions,
      valid_until, batch_id, note, created_by
    )
    select distinct
      hash, p_tier_id, p_scope_type, p_scope_id, p_duration_days, 1,
      p_valid_until, p_batch_id, nullif(btrim(p_note), ''), auth.uid()
    from unnest(p_code_hashes) as hashes(hash)
    on conflict on constraint access_codes_code_hash_key do nothing
    returning access_codes.code_hash;
  get diagnostics v_inserted = row_count;

  perform public.log_admin_action(
    'code.generate',
    'access_codes',
    p_batch_id::text,
    jsonb_build_object(
      'count', v_inserted,
      'tier_id', p_tier_id,
      'scope_type', p_scope_type,
      'scope_id', p_scope_id,
      'duration_days', p_duration_days,
      'valid_until', p_valid_until
    )
  );
end;
$$;

revoke all on function public.admin_generate_codes(uuid, text, uuid, int, int, timestamptz, text, uuid, text[])
  from public, anon;
grant execute on function public.admin_generate_codes(uuid, text, uuid, int, int, timestamptz, text, uuid, text[])
  to authenticated, service_role;
