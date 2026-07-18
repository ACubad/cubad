-- Manual Phase 3 RLS/RPC negative-path probe. All fixture changes are rolled back.
-- Run with psql "$DATABASE_URL" -f supabase/tests/probe-content-access.sql, or paste this
-- entire file into the Supabase SQL editor.

begin;

-- The shipped content uses slug `giris` for unit-1.json and `yagis` for unit-2.json.
do $$
declare
  v_subject_id uuid;
  v_locked_unit_id uuid;
begin
  select id into v_subject_id from public.subjects where slug = 'hidroloji';
  if v_subject_id is null then
    raise exception 'probe fixture missing: no subject "hidroloji" - run scripts/seed-content.mjs first';
  end if;

  select id into v_locked_unit_id
  from public.units
  where subject_id = v_subject_id and slug = 'giris';
  if v_locked_unit_id is null then
    raise exception 'probe fixture missing: no unit "hidroloji/giris"';
  end if;

  update public.units set is_free = false where id = v_locked_unit_id;
  update public.units set is_free = true where subject_id = v_subject_id and slug = 'yagis';
end $$;

set local role anon;
do $$
declare v_content jsonb;
begin
  v_content := public.get_unit_content('hidroloji', 'giris');
  if v_content is not null then
    raise exception 'PROBE 1 FAILED: anon read locked unit content';
  end if;
  raise notice 'PROBE 1 passed: anon cannot read locked unit content';
end $$;
reset role;

set local role anon;
do $$
declare v_content jsonb;
begin
  v_content := public.get_unit_content('hidroloji', 'yagis');
  if v_content is null then
    raise exception 'PROBE 2 FAILED: anon could not read free unit content';
  end if;
  raise notice 'PROBE 2 passed: anon can read free unit content';
end $$;
reset role;

set local role anon;
do $$
declare v_row record;
begin
  select * into v_row from public.list_units_meta('hidroloji') where slug = 'giris';
  if v_row.slug is null then
    raise exception 'PROBE 3 FAILED: anon cannot see locked-unit metadata';
  end if;
  if v_row.is_free is distinct from false then
    raise exception 'PROBE 3 FAILED: expected is_free=false in metadata, got %', v_row.is_free;
  end if;
  raise notice 'PROBE 3 passed: anon sees locked-unit metadata (is_free=%)', v_row.is_free;
end $$;
reset role;

set local role anon;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.units;
  if v_count <> 0 then
    raise exception 'PROBE 4 FAILED: anon selected % base units rows (expected 0)', v_count;
  end if;
  raise notice 'PROBE 4 passed: anon gets 0 rows from public.units';
end $$;
reset role;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
end $$;
do $$
declare v_content jsonb;
begin
  v_content := public.get_unit_content('hidroloji', 'giris');
  if v_content is not null then
    raise exception 'PROBE 5 FAILED: a non-admin authenticated user read locked unit content';
  end if;
  raise notice 'PROBE 5 passed: non-admin authenticated user cannot read locked unit content';
end $$;
reset role;

do $$
declare
  v_admin_id uuid;
  v_content jsonb;
begin
  select p.user_id into v_admin_id from public.profiles p where p.role = 'admin' limit 1;
  if v_admin_id is null then
    raise notice 'PROBE 6 skipped: no admin profile exists yet';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
    set local role authenticated;
    v_content := public.get_unit_content('hidroloji', 'giris');
    if v_content is null then
      raise exception 'PROBE 6 FAILED: admin could not read locked unit content';
    end if;
    raise notice 'PROBE 6 passed: admin can read locked unit content';
    reset role;
  end if;
end $$;

do $$
begin
  raise notice 'ALL PROBES PASSED';
end $$;

-- Supabase CLI's Management API suppresses NOTICE output; preserve an explicit success marker.
select 'ALL PROBES PASSED' as result;

rollback;
