create or replace function public.admin_upsert_subject(
  p_id uuid,
  p_slug text,
  p_title jsonb,
  p_tagline jsonb,
  p_section_order text,
  p_sort int,
  p_track_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slug must be lowercase-kebab-case' using errcode = '22023';
  end if;
  if p_section_order not in ('walkthrough', 'study') then
    raise exception 'invalid section_order' using errcode = '22023';
  end if;
  if jsonb_typeof(p_title) <> 'object'
     or nullif(btrim(p_title ->> 'tr'), '') is null
     or nullif(btrim(p_title ->> 'en'), '') is null
     or jsonb_typeof(p_tagline) <> 'object'
     or nullif(btrim(p_tagline ->> 'tr'), '') is null
     or nullif(btrim(p_tagline ->> 'en'), '') is null then
    raise exception 'title and tagline require non-empty tr/en values' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.subjects (slug, title, tagline, section_order, sort)
    values (p_slug, p_title, p_tagline, p_section_order, p_sort)
    returning id, slug into v_id, v_slug;
  else
    update public.subjects
    set title = p_title,
        tagline = p_tagline,
        section_order = p_section_order,
        sort = p_sort,
        updated_at = now()
    where id = p_id and slug = p_slug
    returning id, slug into v_id, v_slug;
    if v_id is null then
      raise exception 'subject not found or slug mismatch' using errcode = 'P0002';
    end if;
  end if;

  delete from public.track_subjects where subject_id = v_id;
  insert into public.track_subjects (track_id, subject_id)
  select distinct track_id, v_id
  from unnest(coalesce(p_track_ids, '{}'::uuid[])) as selected(track_id);

  perform public.log_admin_action(
    case when p_id is null then 'subject.create' else 'subject.update' end,
    'subjects',
    v_id::text,
    jsonb_build_object(
      'slug', v_slug,
      'track_count', coalesce(array_length(p_track_ids, 1), 0)
    )
  );
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_subject(uuid, text, jsonb, jsonb, text, int, uuid[])
  from public, anon;
grant execute on function public.admin_upsert_subject(uuid, text, jsonb, jsonb, text, int, uuid[])
  to authenticated, service_role;
