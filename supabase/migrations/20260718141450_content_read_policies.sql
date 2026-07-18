-- Phase 3: read-side RLS for catalog metadata and security-definer content RPCs.
-- RLS is row-grained, so locked-unit metadata is exposed through a narrow RPC rather than
-- granting direct access to `units.content`.

do $$
begin
  perform public.is_admin();
exception when undefined_function then
  raise exception 'public.is_admin() is missing — apply Phase 1''s schema migration first';
end $$;

create policy tracks_select_published on public.tracks
  for select to anon, authenticated
  using (status = 'published');

create policy tracks_select_admin on public.tracks
  for select to authenticated
  using (public.is_admin());

create policy subjects_select_published on public.subjects
  for select to anon, authenticated
  using (status = 'published');

create policy subjects_select_admin on public.subjects
  for select to authenticated
  using (public.is_admin());

create policy track_subjects_select_published on public.track_subjects
  for select to anon, authenticated
  using (
    exists (select 1 from public.tracks t where t.id = track_subjects.track_id and t.status = 'published')
    and exists (select 1 from public.subjects s where s.id = track_subjects.subject_id and s.status = 'published')
  );

create policy track_subjects_select_admin on public.track_subjects
  for select to authenticated
  using (public.is_admin());

-- Base `units` access is admin-only. Other callers use the constrained RPCs below.
create policy units_select_admin on public.units
  for select to authenticated
  using (public.is_admin());

create or replace function public.list_units_meta(p_subject_slug text)
returns table (
  unit_number int,
  slug        text,
  is_free     boolean,
  title       jsonb,
  tagline     jsonb,
  version     int,
  updated_at  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    u.unit_number,
    u.slug,
    u.is_free,
    u.content -> 'title' as title,
    u.content -> 'tagline' as tagline,
    u.version,
    u.updated_at
  from public.units u
  join public.subjects s on s.id = u.subject_id
  where s.slug = p_subject_slug
    and u.status = 'published'
    and s.status = 'published'
  order by u.unit_number;
$$;

revoke all on function public.list_units_meta(text) from public;
grant execute on function public.list_units_meta(text) to anon, authenticated;

create or replace function public.get_unit_content(p_subject_slug text, p_unit_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content jsonb;
  v_is_free boolean;
begin
  select u.content, u.is_free
    into v_content, v_is_free
  from public.units u
  join public.subjects s on s.id = u.subject_id
  where s.slug = p_subject_slug
    and u.slug = p_unit_slug
    and u.status = 'published'
    and s.status = 'published';

  if v_content is null then
    return null;
  end if;

  -- Phase 4 extends this guard in place with OR public.has_subject_access(<subject_id>).
  if v_is_free or public.is_admin() then
    return v_content;
  end if;

  return null;
end;
$$;

revoke all on function public.get_unit_content(text, text) from public;
grant execute on function public.get_unit_content(text, text) to anon, authenticated;
