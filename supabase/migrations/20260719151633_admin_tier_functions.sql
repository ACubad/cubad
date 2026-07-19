create or replace function public.admin_upsert_tier(
  p_id uuid,
  p_slug text,
  p_title jsonb,
  p_description jsonb,
  p_scope_type text,
  p_scope_id uuid,
  p_duration_days int,
  p_prices jsonb,
  p_sort int
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
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slug must be lowercase-kebab-case' using errcode = '22023';
  end if;
  if p_scope_type not in ('all', 'track', 'subject')
     or (p_scope_type = 'all') <> (p_scope_id is null) then
    raise exception 'scope_id must be set for track/subject tiers and null for all' using errcode = '22023';
  end if;
  if p_scope_type = 'track' and not exists (select 1 from public.tracks where id = p_scope_id) then
    raise exception 'target track not found' using errcode = 'P0002';
  end if;
  if p_scope_type = 'subject' and not exists (select 1 from public.subjects where id = p_scope_id) then
    raise exception 'target subject not found' using errcode = 'P0002';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'duration_days must be positive' using errcode = '22023';
  end if;
  if jsonb_typeof(p_title) <> 'object'
     or nullif(btrim(p_title ->> 'tr'), '') is null
     or nullif(btrim(p_title ->> 'en'), '') is null
     or jsonb_typeof(p_description) <> 'object'
     or p_description ->> 'tr' is null
     or p_description ->> 'en' is null
     or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'invalid tier bilingual fields or prices' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.tiers (
      slug, title, description, scope_type, scope_id, duration_days, prices, sort
    )
    values (
      p_slug, p_title, p_description, p_scope_type, p_scope_id, p_duration_days, p_prices, p_sort
    )
    returning id into v_id;
  else
    update public.tiers
    set title = p_title,
        description = p_description,
        scope_type = p_scope_type,
        scope_id = p_scope_id,
        duration_days = p_duration_days,
        prices = p_prices,
        sort = p_sort
    where id = p_id and slug = p_slug
    returning id into v_id;
    if v_id is null then raise exception 'tier not found or slug mismatch' using errcode = 'P0002'; end if;
  end if;

  perform public.log_admin_action(
    case when p_id is null then 'tier.create' else 'tier.update' end,
    'tiers',
    v_id::text,
    jsonb_build_object(
      'slug', p_slug,
      'scope_type', p_scope_type,
      'scope_id', p_scope_id,
      'duration_days', p_duration_days
    )
  );
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_tier(uuid, text, jsonb, jsonb, text, uuid, int, jsonb, int)
  from public, anon;
grant execute on function public.admin_upsert_tier(uuid, text, jsonb, jsonb, text, uuid, int, jsonb, int)
  to authenticated, service_role;
