-- Phase 4: unit content is available only to admin, a covering entitlement, or the request's
-- one selected preview unit. `is_free` remains metadata and is not a global access bypass.
create or replace function public.get_unit_content(p_subject_slug text, p_unit_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subject_id     uuid;
  v_subject_status text;
  v_unit_id        uuid;
  v_content        jsonb;
  v_unit_status    text;
begin
  select s.id, s.status
    into v_subject_id, v_subject_status
  from public.subjects s
  where s.slug = p_subject_slug;

  if v_subject_id is null then
    return null;
  end if;

  select u.id, u.content, u.status
    into v_unit_id, v_content, v_unit_status
  from public.units u
  where u.subject_id = v_subject_id
    and u.slug = p_unit_slug;

  if v_unit_id is null then
    return null;
  end if;

  if public.is_admin() then
    return v_content;
  end if;

  if v_unit_status <> 'published' or v_subject_status <> 'published' then
    return null;
  end if;

  if public.has_subject_access(v_subject_id)
     or public.get_current_preview_unit() = v_unit_id then
    return v_content;
  end if;

  return null;
end;
$$;

comment on function public.get_unit_content(text,text) is
  'Returns content for admin, an active subject-covering entitlement, or the current request''s one selected preview unit; otherwise NULL.';

-- Phase 3 granted this stable RPC to anon/authenticated. Reassert the intended grants explicitly
-- because anonymous visitors now use it for their browser-bound preview.
revoke all on function public.get_unit_content(text,text) from public;
grant execute on function public.get_unit_content(text,text) to anon, authenticated, service_role;

-- Raw-table defense in depth mirrors the RPC gate. The narrow metadata RPC remains available for
-- catalog browsing; a full units row (including content) is visible only when it is studyable.
-- Anonymous callers need EXECUTE for the policy expression; auth.uid() is NULL so the helper
-- still deterministically returns false for them.
grant execute on function public.has_subject_access(uuid) to anon;

drop policy if exists units_select_authorized on public.units;
create policy units_select_authorized on public.units
  for select to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.subjects s
      where s.id = units.subject_id
        and s.status = 'published'
    )
    and (
      public.has_subject_access(subject_id)
      or public.get_current_preview_unit() = id
    )
  );
