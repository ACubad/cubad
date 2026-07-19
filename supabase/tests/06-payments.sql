\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('61000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'phase6-admin@example.invalid', '', now(), now(), now(), '{}', '{}'),
  ('61000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'phase6-student-a@example.invalid', '', now(), now(), now(), '{}', '{}'),
  ('61000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'phase6-student-b@example.invalid', '', now(), now(), now(), '{}', '{}');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = 'admin', full_name = 'Phase 6 Reviewer', preferred_lang = 'en'
where user_id = '61000000-0000-4000-8000-000000000001';
update public.profiles
set full_name = 'Phase 6 Student', preferred_lang = 'en'
where user_id = '61000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{}', true);

do $$
declare
  v_policy_count int;
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'payment-proofs'
      and public = false
      and file_size_limit = 10485760
      and allowed_mime_types @> array['image/jpeg','image/png','image/webp','application/pdf']
  ) then raise exception 'payment-proofs bucket constraints missing'; end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in (
      'payment_proofs_insert_own',
      'payment_proofs_select_own_or_admin',
      'payment_proofs_delete_admin'
    );
  if v_policy_count <> 3 then raise exception 'expected 3 payment proof policies, got %', v_policy_count; end if;

  if not has_function_privilege('service_role', 'public.approve_claim(uuid,text,int,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.reject_claim(uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.set_app_setting(text,jsonb,uuid)', 'execute') then
    raise exception 'service_role execute grant missing';
  end if;
  if has_function_privilege('authenticated', 'public.approve_claim(uuid,text,int,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.reject_claim(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_app_setting(text,jsonb,uuid)', 'execute') then
    raise exception 'authenticated role can execute a protected Phase 6 function';
  end if;
  if has_function_privilege('anon', 'public.approve_claim(uuid,text,int,uuid)', 'execute') then
    raise exception 'anon can execute approve_claim';
  end if;
  raise notice 'PASS bucket configuration, policies, and minimal function grants';
end $$;

insert into public.app_settings (key, value)
values ('phase6_private_probe', '{"must_not_leak":true}');

set local role anon;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.app_settings where key = 'payment_instructions';
  if v_count <> 1 then raise exception 'anon cannot read public payment instructions'; end if;
  select count(*) into v_count from public.app_settings where key = 'phase6_private_probe';
  if v_count <> 0 then raise exception 'anon can read a non-public app setting'; end if;
  raise notice 'PASS anonymous payment-instruction read';
end $$;
reset role;

select public.set_app_setting(
  'payment_instructions',
  '{"mpesa":{"tr":"TR","en":"EN"},"bank":{"tr":"TR","en":"EN"},"whatsapp":{"tr":"TR","en":"EN"}}',
  '61000000-0000-4000-8000-000000000001'
);

do $$
begin
  if not exists (
    select 1 from public.admin_audit_log
    where action = 'settings.update'
      and entity_id = 'payment_instructions'
      and actor = '61000000-0000-4000-8000-000000000001'
  ) then raise exception 'settings audit missing'; end if;

  begin
    perform public.set_app_setting(
      'payment_instructions', '{}', '61000000-0000-4000-8000-000000000003'
    );
    raise exception 'non-admin setting write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS atomic audited settings update and non-admin guard';
end $$;

insert into public.payment_claims (
  id, user_id, tier_id, amount, currency, method, payer_ref, proof_path
)
select
  '62000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002',
  id,
  15000,
  'TZS',
  'mpesa',
  'PHASE6-APPROVE-1',
  '61000000-0000-4000-8000-000000000002/62000000-0000-4000-8000-000000000001/proof.jpg'
from public.tiers where slug = 'term-all';

select public.approve_claim(
  '62000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  120,
  '61000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_code uuid;
  v_ent uuid;
begin
  select id into v_code from public.access_codes
  where note = 'payment-claim:62000000-0000-4000-8000-000000000001';
  if v_code is null then raise exception 'approval did not mint a code'; end if;
  if (select count(*) from public.access_codes where id = v_code and code_hash = repeat('a',64)
      and redeemed_count = 1 and max_redemptions = 1) <> 1 then
    raise exception 'minted code invariants failed';
  end if;
  select entitlement_id into v_ent from public.code_redemptions where code_id = v_code;
  if v_ent is null then raise exception 'redemption ledger missing'; end if;
  if (select count(*) from public.entitlements where id = v_ent and source = 'code'
      and source_id = v_code and revoked_at is null) <> 1 then
    raise exception 'entitlement provenance failed';
  end if;
  if (select status from public.payment_claims where id = '62000000-0000-4000-8000-000000000001') <> 'approved' then
    raise exception 'claim not approved';
  end if;
  if not exists (
    select 1 from public.admin_audit_log
    where action = 'claim.approve'
      and entity_id = '62000000-0000-4000-8000-000000000001'
      and not (details ? 'code')
  ) then raise exception 'hash-safe approval audit missing'; end if;
  raise notice 'PASS atomic approval: hash-only code, one redemption, entitlement, claim, audit';
end $$;

do $$
begin
  begin
    perform public.approve_claim(
      '62000000-0000-4000-8000-000000000001', repeat('b',64), 120,
      '61000000-0000-4000-8000-000000000001'
    );
    raise exception 'double approval unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm <> 'not-pending' then raise; end if;
  end;
  if (select count(*) from public.access_codes
      where note = 'payment-claim:62000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'double approval changed code count';
  end if;
  raise notice 'PASS double-approval idempotency guard';
end $$;

insert into public.payment_claims (id,user_id,tier_id,method,payer_ref,proof_path)
select '62000000-0000-4000-8000-000000000002',
       '61000000-0000-4000-8000-000000000002', id, 'bank', 'PHASE6-APPROVE-2',
       '61000000-0000-4000-8000-000000000002/62000000-0000-4000-8000-000000000002/proof.pdf'
from public.tiers where slug = 'term-all';

select public.approve_claim(
  '62000000-0000-4000-8000-000000000002', repeat('b',64), 120,
  '61000000-0000-4000-8000-000000000001'
);

do $$
declare v_min timestamptz; v_max timestamptz;
begin
  select min(expires_at), max(expires_at) into v_min, v_max
  from public.entitlements
  where user_id = '61000000-0000-4000-8000-000000000002'
    and scope_type = 'all';
  if (select count(*) from public.entitlements
      where user_id = '61000000-0000-4000-8000-000000000002' and scope_type = 'all') <> 2 then
    raise exception 'stacking did not append exactly two entitlement rows';
  end if;
  if v_max < v_min + interval '119 days 23 hours' then
    raise exception 'second payment did not stack from the prior expiry';
  end if;
  raise notice 'PASS canonical append-only entitlement stacking';
end $$;

insert into public.payment_claims (id,user_id,tier_id,method,payer_ref,proof_path)
select '62000000-0000-4000-8000-000000000003',
       '61000000-0000-4000-8000-000000000002', id, 'other', 'PHASE6-REJECT',
       '61000000-0000-4000-8000-000000000002/62000000-0000-4000-8000-000000000003/proof.png'
from public.tiers where slug = 'term-all';

select public.reject_claim(
  '62000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000001',
  'No matching transaction.'
);

do $$
begin
  if not exists (
    select 1 from public.payment_claims
    where id = '62000000-0000-4000-8000-000000000003'
      and status = 'rejected'
      and review_note = 'No matching transaction.'
  ) then raise exception 'rejection result missing'; end if;
  if not exists (
    select 1 from public.admin_audit_log
    where action = 'claim.reject' and entity_id = '62000000-0000-4000-8000-000000000003'
  ) then raise exception 'rejection audit missing'; end if;
  raise notice 'PASS atomic rejection with required reason and audit';
end $$;

insert into public.payment_claims (id,user_id,tier_id,method,payer_ref,proof_path)
select '62000000-0000-4000-8000-000000000004',
       '61000000-0000-4000-8000-000000000002', id, 'bank', 'PHASE6-GUARDS',
       '61000000-0000-4000-8000-000000000002/62000000-0000-4000-8000-000000000004/proof.jpg'
from public.tiers where slug = 'term-all';

insert into public.payment_claims (id,user_id,tier_id,method,payer_ref)
select '62000000-0000-4000-8000-000000000005',
       '61000000-0000-4000-8000-000000000002', id, 'bank', 'PHASE6-NO-PROOF'
from public.tiers where slug = 'term-all';

do $$
begin
  begin
    perform public.approve_claim(
      '62000000-0000-4000-8000-000000000004', repeat('c',64), 120,
      '61000000-0000-4000-8000-000000000003'
    );
    raise exception 'non-admin reviewer unexpectedly approved';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.approve_claim(
      '62000000-0000-4000-8000-000000000005', repeat('d',64), 120,
      '61000000-0000-4000-8000-000000000001'
    );
    raise exception 'proof-less claim unexpectedly approved';
  exception when check_violation then
    if sqlerrm <> 'proof-required' then raise; end if;
  end;
  begin
    perform public.reject_claim(
      '62000000-0000-4000-8000-000000000004',
      '61000000-0000-4000-8000-000000000001', '   '
    );
    raise exception 'blank rejection reason unexpectedly accepted';
  exception when check_violation then
    if sqlerrm <> 'note-required' then raise; end if;
  end;
  raise notice 'PASS reviewer role, proof, and rejection-reason guards';
end $$;

rollback;
\echo 'ALL PHASE-6 PAYMENT FUNCTION PROBES PASSED'
