-- Phase 5 unit uploads always land as drafts. Phase 4's first-chosen-preview architecture is
-- authoritative: this function neither accepts nor mutates units.is_free.
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
    set content = excluded.content,
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
      'preview_model', 'first-chosen'
    )
  );

  return query select v_id, v_version;
end;
$$;

comment on function public.admin_upsert_unit(uuid, text, int, jsonb) is
  'Validates identity at the DB boundary, saves content as draft, preserves is_free metadata, and audits atomically.';

revoke all on function public.admin_upsert_unit(uuid, text, int, jsonb) from public, anon;
grant execute on function public.admin_upsert_unit(uuid, text, int, jsonb)
  to authenticated, service_role;
