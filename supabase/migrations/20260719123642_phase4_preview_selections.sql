-- Phase 4 approved extension: one first-chosen full-unit preview per browser/account.
-- Anonymous rows contain only an opaque random browser capability hash and expire after 180 days.
-- Authenticated rows are durable and immutable to the student.

create table public.user_preview_selections (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  unit_id     uuid not null references public.units(id) on delete restrict,
  selected_at timestamptz not null default now()
);

create index user_preview_selections_unit_id
  on public.user_preview_selections (unit_id);

alter table public.user_preview_selections enable row level security;

create policy user_preview_selections_select_own
  on public.user_preview_selections
  for select to authenticated
  using (user_id = auth.uid());

grant select on table public.user_preview_selections to authenticated;
revoke insert, update, delete on table public.user_preview_selections from anon, authenticated;

create table public.anonymous_preview_selections (
  browser_hash text primary key
    check (browser_hash ~ '^[0-9a-f]{64}$'),
  unit_id      uuid not null references public.units(id) on delete restrict,
  selected_at  timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '180 days'),
  constraint anonymous_preview_expiry_after_selection
    check (expires_at > selected_at)
);

create index anonymous_preview_selections_expiry
  on public.anonymous_preview_selections (expires_at);

alter table public.anonymous_preview_selections enable row level security;

-- Deliberately zero policies: anonymous selections are visible/mutable only through the narrow
-- SECURITY DEFINER functions below. No client receives direct table privileges.
revoke all on table public.anonymous_preview_selections from public, anon, authenticated;

comment on table public.user_preview_selections is
  'Durable one-row-per-user first-chosen unit preview. Students can read but never rewrite it.';
comment on table public.anonymous_preview_selections is
  'Temporary browser-bound first-chosen preview keyed only by sha256(random capability). No PII or progress.';

-- Read and validate the privacy-preserving browser capability digest forwarded by the server-side
-- Supabase client. Invalid/missing headers fail closed to NULL.
create or replace function public.request_preview_hash()
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_hash text;
begin
  if v_headers is null or v_headers = '' then
    return null;
  end if;

  begin
    v_hash := lower((v_headers::jsonb ->> 'x-cubad-preview-hash'));
  exception when others then
    return null;
  end;

  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  return v_hash;
end;
$$;

revoke all on function public.request_preview_hash() from public, anon, authenticated;
grant execute on function public.request_preview_hash() to service_role;

-- Current request's selected preview. Authenticated durable choice wins; otherwise use the
-- unexpired anonymous browser capability forwarded in x-cubad-preview-hash.
create or replace function public.get_current_preview_unit()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit uuid;
  v_hash text;
begin
  if auth.uid() is not null then
    select p.unit_id into v_unit
    from public.user_preview_selections p
    where p.user_id = auth.uid();

    if v_unit is not null then
      return v_unit;
    end if;
  end if;

  v_hash := public.request_preview_hash();
  if v_hash is null then
    return null;
  end if;

  select p.unit_id into v_unit
  from public.anonymous_preview_selections p
  where p.browser_hash = v_hash
    and p.expires_at > now();
  return v_unit;
end;
$$;

comment on function public.get_current_preview_unit() is
  'Returns the durable user preview or temporary browser preview for this request, never content.';

revoke all on function public.get_current_preview_unit() from public;
grant execute on function public.get_current_preview_unit() to anon, authenticated, service_role;

-- Atomically bind the first preview choice. For an authenticated caller with no durable choice,
-- a valid anonymous choice is promoted before considering p_unit_id. Existing durable choices
-- are returned unchanged, so another device can never replace them.
create or replace function public.claim_unit_preview(
  p_unit_id uuid default null,
  p_preview_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := lower(coalesce(p_preview_hash, ''));
  v_unit uuid;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    v_hash := null;
  end if;

  if v_uid is not null then
    select p.unit_id into v_unit
    from public.user_preview_selections p
    where p.user_id = v_uid;

    if v_unit is not null then
      return v_unit;
    end if;

    if v_hash is not null then
      select p.unit_id into v_unit
      from public.anonymous_preview_selections p
      where p.browser_hash = v_hash
        and p.expires_at > now();
    end if;

    v_unit := coalesce(v_unit, p_unit_id);
    if v_unit is null then
      return null;
    end if;

    if not exists (
      select 1
      from public.units u
      join public.subjects s on s.id = u.subject_id
      where u.id = v_unit
        and u.status = 'published'
        and s.status = 'published'
    ) then
      raise exception 'preview unit is not published';
    end if;

    insert into public.user_preview_selections (user_id, unit_id)
    values (v_uid, v_unit)
    on conflict (user_id) do nothing;

    select p.unit_id into v_unit
    from public.user_preview_selections p
    where p.user_id = v_uid;
    return v_unit;
  end if;

  if v_hash is null or p_unit_id is null then
    raise exception 'anonymous preview requires a browser capability and unit';
  end if;

  if not exists (
    select 1
    from public.units u
    join public.subjects s on s.id = u.subject_id
    where u.id = p_unit_id
      and u.status = 'published'
      and s.status = 'published'
  ) then
    raise exception 'preview unit is not published';
  end if;

  -- An expired capability may choose again; an active capability is immutable.
  delete from public.anonymous_preview_selections
  where browser_hash = v_hash
    and expires_at <= now();

  insert into public.anonymous_preview_selections (browser_hash, unit_id)
  values (v_hash, p_unit_id)
  on conflict (browser_hash) do nothing;

  select p.unit_id into v_unit
  from public.anonymous_preview_selections p
  where p.browser_hash = v_hash
    and p.expires_at > now();
  return v_unit;
end;
$$;

comment on function public.claim_unit_preview(uuid,text) is
  'Atomically preserves/promotes/binds exactly one first-chosen published unit preview per browser or user.';

revoke all on function public.claim_unit_preview(uuid,text) from public;
grant execute on function public.claim_unit_preview(uuid,text) to anon, authenticated, service_role;
