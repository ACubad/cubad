-- Phase 4 local database probes. All fixtures are synthetic, transaction-scoped, and rolled back.
-- Run with psql, for example:
--   Get-Content -Raw supabase/tests/04-access.sql |
--     docker exec -i supabase_db_cubad psql -U postgres -d postgres

\set ON_ERROR_STOP on
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'phase4-probe-1@example.invalid', '', now(), now(), now(), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'phase4-probe-2@example.invalid', '', now(), now(), now(), '{}', '{}'),
  ('99999999-9999-9999-9999-999999999999', 'authenticated', 'authenticated',
   'phase4-probe-admin@example.invalid', '', now(), now(), now(), '{}', '{}');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = 'admin'
where user_id = '99999999-9999-9999-9999-999999999999';
select set_config('request.jwt.claims', '{}', true);

insert into public.subjects (id, slug, title, tagline, status)
values (
  '33333333-3333-3333-3333-333333333333',
  'phase4-probe-subject',
  '{"tr":"Deneme","en":"Probe"}',
  '{"tr":"","en":""}',
  'published'
);

insert into public.units (id, subject_id, unit_number, slug, is_free, status, content)
values
  (
    '44444444-4444-4444-4444-444444444441',
    '33333333-3333-3333-3333-333333333333',
    1,
    'preview-one',
    true,
    'published',
    '{"unit":1,"slug":"preview-one","title":{"tr":"Bir","en":"One"},"tagline":{"tr":"","en":""}}'
  ),
  (
    '44444444-4444-4444-4444-444444444442',
    '33333333-3333-3333-3333-333333333333',
    2,
    'preview-two',
    true,
    'published',
    '{"unit":2,"slug":"preview-two","title":{"tr":"Iki","en":"Two"},"tagline":{"tr":"","en":""}}'
  ),
  (
    '44444444-4444-4444-4444-444444444443',
    '33333333-3333-3333-3333-333333333333',
    3,
    'admin-draft',
    true,
    'draft',
    '{"unit":3,"slug":"admin-draft","title":{"tr":"Taslak","en":"Draft"},"tagline":{"tr":"","en":""}}'
  );

insert into public.tiers (
  id, slug, title, description, scope_type, scope_id, duration_days, prices, status
)
values (
  '55555555-5555-5555-5555-555555555555',
  'phase4-probe-tier',
  '{"tr":"Deneme","en":"Probe"}',
  '{}',
  'subject',
  '33333333-3333-3333-3333-333333333333',
  30,
  '[]',
  'hidden'
);

insert into public.access_codes (
  id, code_hash, tier_id, scope_type, scope_id, duration_days,
  max_redemptions, redeemed_count, valid_until, revoked_at
)
values
  ('66666666-6666-6666-6666-666666666661', encode(extensions.digest('CBDVALID001','sha256'),'hex'),
   '55555555-5555-5555-5555-555555555555', 'subject', '33333333-3333-3333-3333-333333333333',
   30, 5, 0, null, null),
  ('66666666-6666-6666-6666-666666666662', encode(extensions.digest('CBDEXPIRED0','sha256'),'hex'),
   '55555555-5555-5555-5555-555555555555', 'subject', '33333333-3333-3333-3333-333333333333',
   30, 5, 0, now() - interval '1 day', null),
  ('66666666-6666-6666-6666-666666666663', encode(extensions.digest('CBDEXHAUST0','sha256'),'hex'),
   '55555555-5555-5555-5555-555555555555', 'subject', '33333333-3333-3333-3333-333333333333',
   30, 1, 1, null, null),
  ('66666666-6666-6666-6666-666666666664', encode(extensions.digest('CBDREVOKED0','sha256'),'hex'),
   '55555555-5555-5555-5555-555555555555', 'subject', '33333333-3333-3333-3333-333333333333',
   30, 5, 0, null, now()),
  ('66666666-6666-6666-6666-666666666665', encode(extensions.digest('CBDSTACK001','sha256'),'hex'),
   '55555555-5555-5555-5555-555555555555', 'subject', '33333333-3333-3333-3333-333333333333',
   30, 5, 0, null, null);

insert into public.anonymous_preview_selections (browser_hash, unit_id, selected_at, expires_at)
values (
  repeat('e', 64),
  '44444444-4444-4444-4444-444444444441',
  now() - interval '2 days',
  now() - interval '1 day'
);

do $$
declare v_deleted bigint;
begin
  if has_function_privilege('anon', 'public.claim_unit_preview(uuid,text)', 'execute') then
    raise exception 'FAIL anon can directly execute claim_unit_preview';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_unit_preview(uuid,text)', 'execute') then
    raise exception 'FAIL authenticated claim_unit_preview privilege missing';
  end if;
  if not exists (
    select 1 from cron.job where jobname = 'cubad-purge-expired-anonymous-previews'
  ) then
    raise exception 'FAIL anonymous preview purge schedule missing';
  end if;
  v_deleted := public.purge_expired_anonymous_preview_selections();
  if v_deleted <> 1 or exists (
    select 1 from public.anonymous_preview_selections where browser_hash = repeat('e', 64)
  ) then
    raise exception 'FAIL expired anonymous preview purge: %', v_deleted;
  end if;
  raise notice 'PASS trusted preview claim privileges and scheduled expiry purge';
end $$;

do $$
declare
  v_result jsonb;
  v_unit uuid;
  v_hash text := repeat('a', 64);
  v_count int;
begin
  if encode(extensions.digest('CBD7K3M9PXQ','sha256'),'hex') <>
     '0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449' then
    raise exception 'FAIL hash parity';
  end if;
  raise notice 'PASS hash parity';

  perform set_config('request.jwt.claims', '{}', true);
  v_unit := public.claim_unit_preview(
    '44444444-4444-4444-4444-444444444441', v_hash
  );
  if v_unit <> '44444444-4444-4444-4444-444444444441' then
    raise exception 'FAIL anonymous preview claim';
  end if;
  v_unit := public.claim_unit_preview(
    '44444444-4444-4444-4444-444444444442', v_hash
  );
  if v_unit <> '44444444-4444-4444-4444-444444444441' then
    raise exception 'FAIL anonymous preview changed';
  end if;
  perform set_config(
    'request.headers',
    jsonb_build_object('x-cubad-preview-hash', v_hash)::text,
    true
  );
  if public.get_current_preview_unit() <> '44444444-4444-4444-4444-444444444441' then
    raise exception 'FAIL anonymous preview read';
  end if;
  if public.get_unit_content('phase4-probe-subject', 'preview-one') is null then
    raise exception 'FAIL selected anonymous preview content';
  end if;
  if public.get_unit_content('phase4-probe-subject', 'preview-two') is not null then
    raise exception 'FAIL unselected anonymous content leaked';
  end if;
  raise notice 'PASS anonymous first-choice immutability and one-unit content gate';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true
  );
  v_unit := public.claim_unit_preview(null, v_hash);
  if v_unit <> '44444444-4444-4444-4444-444444444441' then
    raise exception 'FAIL anonymous-to-account promotion';
  end if;
  v_unit := public.claim_unit_preview(
    '44444444-4444-4444-4444-444444444442', repeat('b', 64)
  );
  if v_unit <> '44444444-4444-4444-4444-444444444441' then
    raise exception 'FAIL durable account preview changed';
  end if;
  raise notice 'PASS preview promotion and durable cross-device choice';

  if public.has_subject_access('33333333-3333-3333-3333-333333333333') then
    raise exception 'FAIL unentitled subject access';
  end if;
  if public.get_unit_content('phase4-probe-subject', 'preview-two') is not null then
    raise exception 'FAIL unentitled second unit leaked';
  end if;
  raise notice 'PASS unentitled and second-unit negative paths';

  v_result := public.redeem_code('CBD-NOPE-NOPE');
  if v_result->>'error' <> 'invalid-code' then raise exception 'FAIL invalid-code: %', v_result; end if;
  v_result := public.redeem_code('CBD-REVO-KED0');
  if v_result->>'error' <> 'invalid-code' then raise exception 'FAIL revoked: %', v_result; end if;
  v_result := public.redeem_code('CBD-EXPI-RED0');
  if v_result->>'error' <> 'expired' then raise exception 'FAIL expired: %', v_result; end if;
  v_result := public.redeem_code('CBD-EXHA-UST0');
  if v_result->>'error' <> 'exhausted' then raise exception 'FAIL exhausted: %', v_result; end if;
  raise notice 'PASS invalid, revoked, expired, and exhausted code branches';

  delete from public.redemption_attempts
  where user_id = '11111111-1111-1111-1111-111111111111';
  v_result := public.redeem_code('CBD-VALI-D001');
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'FAIL valid redemption: %', v_result;
  end if;
  if not public.has_subject_access('33333333-3333-3333-3333-333333333333') then
    raise exception 'FAIL entitlement subject access';
  end if;
  if public.get_unit_content('phase4-probe-subject', 'preview-two') is null then
    raise exception 'FAIL entitled second-unit content';
  end if;
  raise notice 'PASS valid redemption, subject access, and locked-to-unlocked content';

  delete from public.redemption_attempts
  where user_id = '11111111-1111-1111-1111-111111111111';
  v_result := public.redeem_code('CBD-VALI-D001');
  if v_result->>'error' <> 'already-redeemed' then
    raise exception 'FAIL duplicate redemption: %', v_result;
  end if;
  raise notice 'PASS duplicate redemption';

  delete from public.redemption_attempts
  where user_id = '11111111-1111-1111-1111-111111111111';
  v_result := public.redeem_code('CBD-STAC-K001');
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'FAIL stacking redemption: %', v_result;
  end if;
  select count(*) into v_count
  from public.entitlements
  where user_id = '11111111-1111-1111-1111-111111111111'
    and scope_type = 'subject'
    and scope_id = '33333333-3333-3333-3333-333333333333';
  if v_count <> 2 then raise exception 'FAIL append-only stack count: %', v_count; end if;
  if not exists (
    select 1 from public.entitlements
    where user_id = '11111111-1111-1111-1111-111111111111'
      and expires_at > now() + interval '55 days'
  ) then
    raise exception 'FAIL stacked expiry did not extend';
  end if;
  raise notice 'PASS append-only entitlement stacking';
end $$;

-- Expired and revoked entitlements never grant access.
insert into public.entitlements (
  user_id, scope_type, scope_id, tier_id, starts_at, expires_at, source, revoked_at
)
values
  ('22222222-2222-2222-2222-222222222222', 'subject',
   '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
   now() - interval '2 days', now() - interval '1 day', 'admin', null),
  ('22222222-2222-2222-2222-222222222222', 'subject',
   '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
   now() - interval '1 day', now() + interval '1 day', 'admin', now());

do $$
declare v_result jsonb; i int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true
  );
  perform set_config('request.headers', '{}', true);
  if public.has_subject_access('33333333-3333-3333-3333-333333333333') then
    raise exception 'FAIL expired/revoked entitlement granted access';
  end if;
  raise notice 'PASS expired and revoked entitlement denial';

  delete from public.redemption_attempts
  where user_id = '22222222-2222-2222-2222-222222222222';
  for i in 1..5 loop
    v_result := public.redeem_code('RATE-LIMIT-' || i::text);
    if v_result->>'error' <> 'invalid-code' then
      raise exception 'FAIL rate attempt %: %', i, v_result;
    end if;
  end loop;
  v_result := public.redeem_code('RATE-LIMIT-6');
  if v_result->>'error' <> 'rate-limited' then
    raise exception 'FAIL sixth attempt rate limit: %', v_result;
  end if;
  raise notice 'PASS rate limit on sixth attempt';
end $$;

-- Admin sees draft content without an entitlement or preview.
do $$
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}',
    true
  );
  perform set_config('request.headers', '{}', true);
  if public.get_unit_content('phase4-probe-subject', 'admin-draft') is null then
    raise exception 'FAIL admin draft access';
  end if;
  raise notice 'PASS admin content access';
end $$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}',
  true
);
do $$
declare v_count int;
begin
  select count(*) into v_count from public.units where slug = 'admin-draft';
  if v_count <> 1 then raise exception 'FAIL admin raw-table draft access: %', v_count; end if;
  raise notice 'PASS admin raw-table draft access';
end $$;
reset role;

-- Student table access is filtered/denied by RLS and privileges.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true
);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.profiles;
  if v_count <> 1 then raise exception 'FAIL profile owner select: % rows', v_count; end if;

  update public.profiles set full_name = 'Phase 4 Probe' where user_id = auth.uid();
  if not found then raise exception 'FAIL profile owner update'; end if;

  begin
    update public.profiles set role = 'admin' where user_id = auth.uid();
    raise exception 'FAIL student changed protected profile role';
  exception
  when insufficient_privilege then
    null;
  when others then
    if sqlerrm <> 'profiles.role can only be changed by an administrator' then
      raise;
    end if;
  end;

  select count(*) into v_count from public.access_codes;
  if v_count <> 0 then raise exception 'FAIL access-code hashes leaked'; end if;

  select count(*) into v_count from public.user_preview_selections;
  if v_count <> 0 then raise exception 'FAIL another user preview leaked'; end if;

  begin
    insert into public.entitlements (user_id, scope_type, expires_at, source)
    values (auth.uid(), 'all', now() + interval '1 day', 'code');
    raise exception 'FAIL student entitlement insert succeeded';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS profile owner access/role protection, access-code secrecy, preview isolation, and entitlement write denial';
end $$;

reset role;
rollback;

\echo 'ALL PHASE-4 ACCESS PROBES PASSED'
