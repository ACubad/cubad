-- Authenticated account-state RLS negative-path probe. All temporary data is rolled back.
-- Run with: npx supabase db query --linked --file supabase/tests/probe-user-state-access.sql

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
begin
  -- A transaction-scoped auth user makes this probe independent of existing
  -- accounts. The Phase 2 signup trigger also creates its profile; rollback
  -- below removes both records and the account-state fixture.
  insert into auth.users (id) values (v_owner);
  perform set_config('app.probe_user_state_owner', v_owner::text, true);

  insert into public.user_state (user_id, state, updated_at)
  values (v_owner, '{"probe":"owner-only"}'::jsonb, now())
  on conflict (user_id) do update
    set state = excluded.state, updated_at = excluded.updated_at;
end $$;

-- A different authenticated subject must not read or update the owner's row.
do $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text)::text,
    true
  );
end $$;
set local role authenticated;

do $$
declare
  v_visible integer;
  v_updated integer;
begin
  select count(*) into v_visible from public.user_state;
  if v_visible <> 0 then
    raise exception 'PROBE 1 FAILED: unrelated authenticated user read % user_state rows', v_visible;
  end if;

  update public.user_state set state = '{"probe":"forbidden"}'::jsonb;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'PROBE 2 FAILED: unrelated authenticated user updated % user_state rows', v_updated;
  end if;
end $$;
reset role;

-- The owner may read the same row, which proves the restrictive policy is usable.
do $$
declare
  v_owner uuid := current_setting('app.probe_user_state_owner')::uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text)::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_state jsonb;
begin
  select state into v_state from public.user_state;
  if v_state is distinct from '{"probe":"owner-only"}'::jsonb then
    raise exception 'PROBE 3 FAILED: owner could not read its user_state row';
  end if;
end $$;
reset role;

select 'ALL USER_STATE PROBES PASSED' as result;

rollback;
