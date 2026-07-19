-- Phase 5 local database probes. Synthetic fixtures live in one transaction and are rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('a1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'phase5-student@example.invalid', '', now(), now(), now(), '{}', '{}'),
  ('a9999999-9999-9999-9999-999999999999', 'authenticated', 'authenticated',
   'phase5-admin@example.invalid', '', now(), now(), now(), '{}', '{}');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = 'admin'
where user_id = 'a9999999-9999-9999-9999-999999999999';
select set_config('request.jwt.claims', '{}', true);

do $$
declare
  v_signatures text[] := array[
    'public.log_admin_action(text,text,text,jsonb)',
    'public.admin_set_status(text,uuid,text)',
    'public.admin_revoke(text,uuid[])',
    'public.admin_upsert_subject(uuid,text,jsonb,jsonb,text,integer,uuid[])',
    'public.admin_upsert_unit(uuid,text,integer,jsonb)',
    'public.admin_upsert_track(uuid,text,text,text,jsonb,integer)',
    'public.admin_set_track_subjects(uuid,uuid[])',
    'public.admin_upsert_tier(uuid,text,jsonb,jsonb,text,uuid,integer,jsonb,integer)',
    'public.admin_grant_entitlement(uuid,text,uuid,uuid,integer)',
    'public.admin_generate_codes(uuid,text,uuid,integer,integer,timestamp with time zone,text,uuid,text[])',
    'public.admin_overview_stats()'
  ];
  v_signature text;
begin
  foreach v_signature in array v_signatures loop
    if to_regprocedure(v_signature) is null then
      raise exception 'FAIL missing function signature: %', v_signature;
    end if;
  end loop;
  if to_regprocedure('public.admin_set_unit_free(uuid,boolean)') is not null then
    raise exception 'FAIL obsolete free-unit mutation still exists';
  end if;
  if exists (select 1 from public.profiles where email = '') then
    raise exception 'FAIL blank profile email after trigger/backfill seam';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = 'a1111111-1111-1111-1111-111111111111'
      and email = 'phase5-student@example.invalid'
  ) then
    raise exception 'FAIL signup profile email synchronization';
  end if;
  raise notice 'PASS function signatures, Phase 4 preview reconciliation, and profile email seam';
end $$;

-- Every definer entry point must reject a genuine student before validating other arguments.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);

do $$
declare
  v_sql text;
  v_calls text[] := array[
    $q$select public.log_admin_action('probe','probe',null,'{}')$q$,
    $q$select public.admin_set_status('subjects','00000000-0000-0000-0000-000000000000','published')$q$,
    $q$select public.admin_revoke('entitlements',array['00000000-0000-0000-0000-000000000000']::uuid[])$q$,
    $q$select public.admin_upsert_subject(null,'probe','{"tr":"P","en":"P"}','{"tr":"P","en":"P"}','study',0,'{}')$q$,
    $q$select public.admin_upsert_unit('00000000-0000-0000-0000-000000000000','probe',1,'{"slug":"probe","unit":1}')$q$,
    $q$select public.admin_upsert_track(null,'TR','probe','probe','{"tr":"P","en":"P"}',0)$q$,
    $q$select public.admin_set_track_subjects('00000000-0000-0000-0000-000000000000','{}')$q$,
    $q$select public.admin_upsert_tier(null,'probe','{"tr":"P","en":"P"}','{"tr":"","en":""}','all',null,30,'[]',0)$q$,
    $q$select public.admin_grant_entitlement('a1111111-1111-1111-1111-111111111111','all',null,'00000000-0000-0000-0000-000000000000',30)$q$,
    $q$select public.admin_generate_codes('00000000-0000-0000-0000-000000000000','all',null,30,1,null,'probe','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',array[repeat('d',64)])$q$,
    $q$select public.admin_overview_stats()$q$
  ];
begin
  update public.profiles
  set full_name = 'Phase 5 owner update probe'
  where user_id = 'a1111111-1111-1111-1111-111111111111';
  if not found then
    raise exception 'FAIL authenticated owner profile update was blocked';
  end if;

  begin
    update public.profiles
    set email = 'forged@example.invalid'
    where user_id = 'a1111111-1111-1111-1111-111111111111';
    raise exception 'FAIL authenticated owner changed the auth-synced profile email';
  exception when insufficient_privilege then null;
  end;

  foreach v_sql in array v_calls loop
    begin
      execute v_sql;
      raise exception 'FAIL student admin call succeeded: %', v_sql;
    exception when sqlstate '42501' then
      if sqlerrm <> 'not authorized' then
        raise exception 'FAIL wrong denial reason for %: %', v_sql, sqlerrm;
      end if;
    end;
  end loop;

  begin
    insert into public.access_codes (code_hash, tier_id, scope_type, duration_days)
    values (repeat('e',64), '00000000-0000-0000-0000-000000000000', 'all', 30);
    raise exception 'FAIL student direct access-code insert succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.admin_audit_log (action, entity) values ('probe', 'probe');
    raise exception 'FAIL student direct audit insert succeeded';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS owner profile fields remain editable while email and privileged writes are denied';
end $$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a9999999-9999-9999-9999-999999999999","role":"authenticated"}',
  true
);

do $$
declare
  v_track uuid;
  v_subject uuid;
  v_unit uuid;
  v_new_draft uuid;
  v_unit_version int;
  v_tier uuid;
  v_entitlement_1 uuid;
  v_entitlement_2 uuid;
  v_batch uuid := 'abbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_hash_1 text := repeat('1', 64);
  v_hash_2 text := repeat('2', 64);
  v_count int;
  v_stats jsonb;
begin
  v_track := public.admin_upsert_track(
    null, 'TR', 'phase5-probe', 'undergraduate', '{"tr":"Deneme","en":"Probe"}', 10
  );
  v_subject := public.admin_upsert_subject(
    null, 'phase5-probe-subject', '{"tr":"Deneme","en":"Probe"}',
    '{"tr":"Yonetim","en":"Administration"}', 'study', 10, array[v_track]
  );
  perform public.admin_set_track_subjects(v_track, array[v_subject]);

  select id, version into v_unit, v_unit_version
  from public.admin_upsert_unit(
    v_subject,
    'phase5-probe-unit',
    1,
    '{"unit":1,"slug":"phase5-probe-unit","title":{"tr":"Birim","en":"Unit"},"tagline":{"tr":"Taslak","en":"Draft"}}'
  );
  if v_unit_version <> 1 or (select status from public.units where id = v_unit) <> 'draft' then
    raise exception 'FAIL unit upload did not create version 1 draft';
  end if;

  begin
    perform public.admin_upsert_unit(v_subject, 'phase5-probe-unit', 2, '{"unit":2,"slug":"wrong"}');
    raise exception 'FAIL invalid unit identity succeeded';
  exception when sqlstate '22023' then null;
  end;
  if (select version from public.units where id = v_unit) <> 1 then
    raise exception 'FAIL invalid upload mutated the existing unit';
  end if;

  begin
    perform public.admin_upsert_subject(
      null, 'phase5-atomic-rollback', '{"tr":"A","en":"A"}', '{"tr":"A","en":"A"}',
      'study', 0, array['00000000-0000-0000-0000-000000000000'::uuid]
    );
    raise exception 'FAIL invalid subject track succeeded';
  exception when foreign_key_violation then null;
  end;
  if exists (select 1 from public.subjects where slug = 'phase5-atomic-rollback')
     or exists (select 1 from public.admin_audit_log where entity_id = 'phase5-atomic-rollback') then
    raise exception 'FAIL mutation/audit subtransaction was not atomic';
  end if;

  v_tier := public.admin_upsert_tier(
    null, 'phase5-probe-tier', '{"tr":"Donem","en":"Term"}', '{"tr":"","en":""}',
    'subject', v_subject, 30, '[{"currency":"TRY","amount":100}]', 10
  );
  v_entitlement_1 := public.admin_grant_entitlement(
    'a1111111-1111-1111-1111-111111111111', 'subject', v_subject, v_tier, 30
  );
  v_entitlement_2 := public.admin_grant_entitlement(
    'a1111111-1111-1111-1111-111111111111', 'subject', v_subject, v_tier, 30
  );
  if v_entitlement_1 = v_entitlement_2 then raise exception 'FAIL grants were not append-only'; end if;
  if not exists (
    select 1 from public.entitlements
    where id = v_entitlement_2 and expires_at > now() + interval '55 days'
  ) then
    raise exception 'FAIL canonical entitlement stacking did not extend expiry';
  end if;

  select count(*) into v_count
  from public.admin_generate_codes(
    v_tier, 'subject', v_subject, 30, 1, now() + interval '30 days',
    'phase5 probe', v_batch, array[v_hash_1, v_hash_2]
  );
  if v_count <> 2 then raise exception 'FAIL code batch insert count: %', v_count; end if;
  if exists (
    select 1 from public.access_codes
    where batch_id = v_batch and code_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'FAIL code storage contains a non-hash value';
  end if;
  if exists (
    select 1 from public.admin_audit_log
    where action = 'code.generate'
      and (details::text like '%' || v_hash_1 || '%' or details::text like '%' || v_hash_2 || '%')
  ) then
    raise exception 'FAIL code hash leaked into audit metadata';
  end if;

  perform public.admin_set_status('subjects', v_subject, 'published');
  perform public.admin_set_status('units', v_unit, 'published');
  perform public.admin_set_status('tracks', v_track, 'published');
  perform public.admin_set_status('tiers', v_tier, 'published');

  select id into v_unit
  from public.admin_upsert_unit(
    v_subject,
    'phase5-probe-unit',
    1,
    '{"unit":1,"slug":"phase5-probe-unit","title":{"tr":"Birim","en":"Unit"},"tagline":{"tr":"Yeni taslak","en":"Next draft"}}'
  );
  if not exists (
    select 1 from public.units
    where id = v_unit and status = 'draft'
      and published_content->'tagline'->>'en' = 'Draft'
      and content->'tagline'->>'en' = 'Next draft'
  ) then
    raise exception 'FAIL published revision was not preserved during draft editing';
  end if;

  select id into v_new_draft
  from public.admin_upsert_unit(
    v_subject,
    'phase5-new-draft',
    2,
    '{"unit":2,"slug":"phase5-new-draft","title":{"tr":"Yeni","en":"New"},"tagline":{"tr":"Yeni","en":"New"}}'
  );
  if exists (select 1 from public.units where id = v_new_draft and published_content is not null) then
    raise exception 'FAIL never-published draft acquired a public snapshot';
  end if;
  if public.admin_revoke('entitlements', array[v_entitlement_1]) <> 1 then
    raise exception 'FAIL entitlement revoke count';
  end if;
  if public.admin_revoke(
    'access_codes', array[(select id from public.access_codes where code_hash = v_hash_1)]
  ) <> 1 then
    raise exception 'FAIL code revoke count';
  end if;

  v_stats := public.admin_overview_stats();
  if not (v_stats ?& array[
    'total_users','onboarded_users','active_entitlements','pending_claims','codes_redeemed_30d','dau_proxy'
  ]) then
    raise exception 'FAIL overview response keys: %', v_stats;
  end if;
  if (v_stats->>'total_users')::int < 2 or (v_stats->>'active_entitlements')::int < 1 then
    raise exception 'FAIL overview SQL aggregate values: %', v_stats;
  end if;
  if not exists (
    select 1 from public.admin_audit_log
    where actor = 'a9999999-9999-9999-9999-999999999999'
      and action = 'unit.publish' and entity_id = v_unit::text
  ) then
    raise exception 'FAIL audited status mutation';
  end if;
  raise notice 'PASS audited admin CRUD, validation rollback, code hashing, stacking/revoke, and overview aggregates';
end $$;

-- Raw draft rows remain hidden. Students receive the last published snapshot through the RPC,
-- while admins preview the current draft. A never-published draft remains fully hidden.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
do $$
begin
  if exists (select 1 from public.units where slug = 'phase5-probe-unit') then
    raise exception 'FAIL draft raw row leaked to student';
  end if;
  if public.get_unit_content('phase5-probe-subject', 'phase5-probe-unit')->'tagline'->>'en' <> 'Draft' then
    raise exception 'FAIL student did not receive the prior published revision';
  end if;
  if public.get_unit_content('phase5-probe-subject', 'phase5-new-draft') is not null then
    raise exception 'FAIL never-published draft leaked to student';
  end if;
  raise notice 'PASS raw draft hidden and prior published revision retained for student';
end $$;

select set_config(
  'request.jwt.claims',
  '{"sub":"a9999999-9999-9999-9999-999999999999","role":"authenticated"}',
  true
);
do $$
begin
  if not exists (select 1 from public.units where slug = 'phase5-probe-unit') then
    raise exception 'FAIL admin raw draft preview';
  end if;
  if public.get_unit_content('phase5-probe-subject', 'phase5-probe-unit')->'tagline'->>'en' <> 'Next draft' then
    raise exception 'FAIL admin gated draft preview';
  end if;
  raise notice 'PASS admin draft preview';
end $$;

select public.admin_set_status(
  'units',
  (select id from public.units where slug = 'phase5-probe-unit'),
  'published'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
do $$
begin
  if public.get_unit_content('phase5-probe-subject', 'phase5-probe-unit')->'tagline'->>'en' <> 'Next draft' then
    raise exception 'FAIL newly published revision was not immediately visible to student';
  end if;
  raise notice 'PASS publish promotes draft immediately without redeploy';
end $$;
reset role;

rollback;
\echo 'ALL PHASE-5 ADMIN PROBES PASSED'
