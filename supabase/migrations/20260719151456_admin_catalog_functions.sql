create or replace function public.admin_upsert_track(
  p_id uuid,
  p_country_code text,
  p_system text,
  p_level text,
  p_title jsonb,
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
  if p_country_code !~ '^[A-Z]{2}$'
     or nullif(btrim(p_system), '') is null
     or nullif(btrim(p_level), '') is null then
    raise exception 'invalid track identity' using errcode = '22023';
  end if;
  if jsonb_typeof(p_title) <> 'object'
     or nullif(btrim(p_title ->> 'tr'), '') is null
     or nullif(btrim(p_title ->> 'en'), '') is null then
    raise exception 'track title requires non-empty tr/en values' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.tracks (country_code, system, level, title, sort)
    values (p_country_code, p_system, p_level, p_title, p_sort)
    returning id into v_id;
  else
    update public.tracks
    set country_code = p_country_code,
        system = p_system,
        level = p_level,
        title = p_title,
        sort = p_sort
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'track not found' using errcode = 'P0002'; end if;
  end if;

  perform public.log_admin_action(
    case when p_id is null then 'track.create' else 'track.update' end,
    'tracks',
    v_id::text,
    jsonb_build_object('country_code', p_country_code, 'system', p_system, 'level', p_level)
  );
  return v_id;
end;
$$;

create or replace function public.admin_set_track_subjects(
  p_track_id uuid,
  p_subject_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tracks where tracks.id = p_track_id) then
    raise exception 'track not found' using errcode = 'P0002';
  end if;

  delete from public.track_subjects where track_id = p_track_id;
  insert into public.track_subjects (track_id, subject_id)
  select p_track_id, selected.subject_id
  from (
    select distinct subject_id
    from unnest(coalesce(p_subject_ids, '{}'::uuid[])) as ids(subject_id)
  ) as selected;
  get diagnostics v_count = row_count;

  perform public.log_admin_action(
    'track.set_subjects', 'tracks', p_track_id::text, jsonb_build_object('count', v_count)
  );
end;
$$;

revoke all on function public.admin_upsert_track(uuid, text, text, text, jsonb, int) from public, anon;
revoke all on function public.admin_set_track_subjects(uuid, uuid[]) from public, anon;
grant execute on function public.admin_upsert_track(uuid, text, text, text, jsonb, int) to authenticated, service_role;
grant execute on function public.admin_set_track_subjects(uuid, uuid[]) to authenticated, service_role;
