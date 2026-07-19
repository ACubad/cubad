-- Keep the last live revision available while editors work on the next draft. The raw
-- `content` column always holds the editor-visible revision; students receive this snapshot
-- only through get_unit_content, never through a raw-table RLS bypass.
alter table public.units add column published_content jsonb;

comment on column public.units.published_content is
  'Last published unit JSON retained only while content contains a newer draft.';

create or replace function public.admin_upsert_unit(
  p_subject_id uuid,
  p_slug text,
  p_unit_number int,
  p_content jsonb
)
returns table(id uuid, version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_subject_id is null or not exists (select 1 from public.subjects where subjects.id = p_subject_id) then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or p_unit_number <= 0 then
    raise exception 'invalid unit identity' using errcode = '22023';
  end if;
  if jsonb_typeof(p_content) <> 'object'
     or p_content ->> 'slug' is distinct from p_slug
     or p_content ->> 'unit' is distinct from p_unit_number::text then
    raise exception 'unit content identity does not match RPC arguments' using errcode = '22023';
  end if;

  insert into public.units (
    subject_id, unit_number, slug, status, content, version, updated_by
  )
  values (
    p_subject_id, p_unit_number, p_slug, 'draft', p_content, 1, auth.uid()
  )
  on conflict (subject_id, slug) do update
    set published_content = case
          when public.units.status = 'published' then public.units.content
          else public.units.published_content
        end,
        content = excluded.content,
        unit_number = excluded.unit_number,
        status = 'draft',
        version = public.units.version + 1,
        updated_by = auth.uid(),
        updated_at = now()
  returning units.id, units.version into v_id, v_version;

  perform public.log_admin_action(
    'unit.upsert',
    'units',
    v_id::text,
    jsonb_build_object(
      'subject_id', p_subject_id,
      'slug', p_slug,
      'version', v_version,
      'status', 'draft',
      'preserves_live_revision', true,
      'preview_model', 'first-chosen'
    )
  );
  return query select v_id, v_version;
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
  if p_id is null then raise exception 'entity id is required' using errcode = '22023'; end if;

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
    if p_status = 'published' then
      update public.units
      set status = 'published', published_content = null, updated_at = now()
      where id = p_id;
    else
      -- Explicit Unpublish hides every revision; only admin_upsert_unit creates a live snapshot.
      update public.units
      set status = 'draft', published_content = null, updated_at = now()
      where id = p_id;
    end if;
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

create or replace function public.get_unit_content(p_subject_slug text, p_unit_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_subject_status text;
  v_unit_id uuid;
  v_content jsonb;
  v_public_content jsonb;
  v_unit_status text;
begin
  select s.id, s.status into v_subject_id, v_subject_status
  from public.subjects s
  where s.slug = p_subject_slug;
  if v_subject_id is null then return null; end if;

  select u.id, u.content,
         case when u.status = 'draft' then u.published_content else u.content end,
         u.status
    into v_unit_id, v_content, v_public_content, v_unit_status
  from public.units u
  where u.subject_id = v_subject_id and u.slug = p_unit_slug;
  if v_unit_id is null then return null; end if;

  if public.is_admin() then return v_content; end if;
  if v_subject_status <> 'published'
     or (v_unit_status <> 'published' and v_public_content is null) then
    return null;
  end if;
  if public.has_subject_access(v_subject_id)
     or public.get_current_preview_unit() = v_unit_id then
    return v_public_content;
  end if;
  return null;
end;
$$;

comment on function public.get_unit_content(text,text) is
  'Returns the editor revision to admins and the last published revision to authorized students while a newer draft exists.';

create or replace function public.claim_unit_preview(
  p_unit_id uuid default null,
  p_preview_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := lower(coalesce(p_preview_hash, ''));
  v_unit uuid;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then v_hash := null; end if;

  if v_uid is not null then
    select p.unit_id into v_unit from public.user_preview_selections p where p.user_id = v_uid;
    if v_unit is not null then return v_unit; end if;

    if v_hash is not null then
      select p.unit_id into v_unit
      from public.anonymous_preview_selections p
      where p.browser_hash = v_hash and p.expires_at > now();
    end if;
    v_unit := coalesce(v_unit, p_unit_id);
    if v_unit is null then return null; end if;

    if not exists (
      select 1 from public.units u join public.subjects s on s.id = u.subject_id
      where u.id = v_unit
        and (u.status = 'published' or u.published_content is not null)
        and s.status = 'published'
    ) then raise exception 'preview unit is not published'; end if;

    insert into public.user_preview_selections (user_id, unit_id)
    values (v_uid, v_unit) on conflict (user_id) do nothing;
    select p.unit_id into v_unit from public.user_preview_selections p where p.user_id = v_uid;
    return v_unit;
  end if;

  if v_hash is null or p_unit_id is null then
    raise exception 'anonymous preview requires a browser capability and unit';
  end if;
  if not exists (
    select 1 from public.units u join public.subjects s on s.id = u.subject_id
    where u.id = p_unit_id
      and (u.status = 'published' or u.published_content is not null)
      and s.status = 'published'
  ) then raise exception 'preview unit is not published'; end if;

  delete from public.anonymous_preview_selections
  where browser_hash = v_hash and expires_at <= now();
  insert into public.anonymous_preview_selections (browser_hash, unit_id)
  values (v_hash, p_unit_id) on conflict (browser_hash) do nothing;
  select p.unit_id into v_unit
  from public.anonymous_preview_selections p
  where p.browser_hash = v_hash and p.expires_at > now();
  return v_unit;
end;
$$;

revoke all on function public.admin_upsert_unit(uuid, text, int, jsonb) from public, anon;
grant execute on function public.admin_upsert_unit(uuid, text, int, jsonb) to authenticated, service_role;
revoke all on function public.admin_set_status(text, uuid, text) from public, anon;
grant execute on function public.admin_set_status(text, uuid, text) to authenticated, service_role;
revoke all on function public.get_unit_content(text,text) from public;
grant execute on function public.get_unit_content(text,text) to anon, authenticated, service_role;
revoke all on function public.claim_unit_preview(uuid,text) from public, anon;
grant execute on function public.claim_unit_preview(uuid,text) to authenticated, service_role;
