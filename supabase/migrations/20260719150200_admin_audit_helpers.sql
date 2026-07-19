-- Phase 5 shared audited mutation primitives. Each caller remains inside one PostgreSQL
-- function invocation, so its mutation and audit event commit or roll back together.
create or replace function public.log_admin_action(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if nullif(btrim(p_action), '') is null or nullif(btrim(p_entity), '') is null then
    raise exception 'audit action and entity are required' using errcode = '22023';
  end if;

  insert into public.admin_audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.admin_set_status(
  p_table text,
  p_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text;
  v_verb text;
  v_changed int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'entity id is required' using errcode = '22023';
  end if;

  if p_table = 'subjects' then
    if p_status not in ('draft', 'published', 'archived') then
      raise exception 'invalid subject status' using errcode = '22023';
    end if;
    update public.subjects set status = p_status, updated_at = now() where id = p_id;
    v_entity := 'subject';
  elsif p_table = 'units' then
    if p_status not in ('draft', 'published') then
      raise exception 'invalid unit status' using errcode = '22023';
    end if;
    update public.units set status = p_status, updated_at = now() where id = p_id;
    v_entity := 'unit';
  elsif p_table = 'tracks' then
    if p_status not in ('published', 'hidden') then
      raise exception 'invalid track status' using errcode = '22023';
    end if;
    update public.tracks set status = p_status where id = p_id;
    v_entity := 'track';
  elsif p_table = 'tiers' then
    if p_status not in ('published', 'hidden') then
      raise exception 'invalid tier status' using errcode = '22023';
    end if;
    update public.tiers set status = p_status where id = p_id;
    v_entity := 'tier';
  else
    raise exception 'admin_set_status: unsupported table %', p_table using errcode = '22023';
  end if;

  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception '% row not found: %', v_entity, p_id using errcode = 'P0002';
  end if;

  v_verb := case p_status
    when 'published' then 'publish'
    when 'draft' then 'unpublish'
    when 'archived' then 'archive'
    when 'hidden' then 'hide'
    else p_status
  end;

  perform public.log_admin_action(
    v_entity || '.' || v_verb,
    p_table,
    p_id::text,
    jsonb_build_object('status', p_status)
  );
end;
$$;

create or replace function public.admin_revoke(
  p_table text,
  p_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text;
  v_changed int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_position(p_ids, null) is not null then
    raise exception 'at least one non-null id is required' using errcode = '22023';
  end if;

  if p_table = 'entitlements' then
    update public.entitlements
    set revoked_at = now()
    where id = any(p_ids) and revoked_at is null;
    v_entity := 'entitlement';
  elsif p_table = 'access_codes' then
    update public.access_codes
    set revoked_at = now()
    where id = any(p_ids) and revoked_at is null;
    v_entity := 'code';
  else
    raise exception 'admin_revoke: unsupported table %', p_table using errcode = '22023';
  end if;

  get diagnostics v_changed = row_count;
  perform public.log_admin_action(
    v_entity || '.revoke',
    p_table,
    array_to_string(p_ids, ','),
    jsonb_build_object(
      'requested_count', array_length(p_ids, 1),
      'revoked_count', v_changed
    )
  );
  return v_changed;
end;
$$;

revoke all on function public.log_admin_action(text, text, text, jsonb) from public, anon;
revoke all on function public.admin_set_status(text, uuid, text) from public, anon;
revoke all on function public.admin_revoke(text, uuid[]) from public, anon;
grant execute on function public.log_admin_action(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.admin_set_status(text, uuid, text) to authenticated, service_role;
grant execute on function public.admin_revoke(text, uuid[]) to authenticated, service_role;
