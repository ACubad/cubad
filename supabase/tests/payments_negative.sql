\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,aud,role,email,encrypted_password,created_at,updated_at,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
)
values
  ('63000000-0000-4000-8000-000000000001','authenticated','authenticated','phase6-rls-a@example.invalid','',now(),now(),now(),'{}','{}'),
  ('63000000-0000-4000-8000-000000000002','authenticated','authenticated','phase6-rls-b@example.invalid','',now(),now(),now(),'{}','{}');

insert into public.payment_claims (id,user_id,tier_id,method,payer_ref,proof_path)
select '64000000-0000-4000-8000-000000000001',
       '63000000-0000-4000-8000-000000000001', id, 'mpesa', 'OWNER-A',
       '63000000-0000-4000-8000-000000000001/64000000-0000-4000-8000-000000000001/proof.jpg'
from public.tiers where slug = 'term-all';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','63000000-0000-4000-8000-000000000002','role','authenticated')::text,
  true
);

do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.payment_claims where id = '64000000-0000-4000-8000-000000000001';
  if v_count <> 0 then raise exception 'cross-user claim read leaked'; end if;

  begin
    insert into public.payment_claims (user_id,tier_id,method,status)
    select '63000000-0000-4000-8000-000000000002', id, 'mpesa', 'approved'
    from public.tiers where slug = 'term-all';
    raise exception 'self-approved insert unexpectedly succeeded';
  exception when insufficient_privilege or check_violation then null;
  end;

  begin
    insert into public.payment_claims (user_id,tier_id,method,status)
    select '63000000-0000-4000-8000-000000000001', id, 'mpesa', 'pending'
    from public.tiers where slug = 'term-all';
    raise exception 'other-user insert unexpectedly succeeded';
  exception when insufficient_privilege or check_violation then null;
  end;

  if has_table_privilege('authenticated', 'public.payment_claims', 'update') then
    raise exception 'authenticated has direct payment_claims UPDATE privilege';
  end if;
  begin
    update public.payment_claims set status = 'approved'
    where id = '64000000-0000-4000-8000-000000000001';
    raise exception 'student status update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  delete from public.payment_claims
  where id = '64000000-0000-4000-8000-000000000001';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'cross-user delete unexpectedly succeeded'; end if;
  raise notice 'PASS cross-user isolation, insert constraints, and status immutability';
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','63000000-0000-4000-8000-000000000001','role','authenticated')::text,
  true
);

do $$
declare v_count int;
begin
  delete from public.payment_claims
  where id = '64000000-0000-4000-8000-000000000001' and status = 'pending';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'owner pending cancellation failed'; end if;
  raise notice 'PASS owner pending cancellation';
end $$;

reset role;

-- Seed three pending rows directly, then verify the authoritative trigger blocks the fourth.
insert into public.payment_claims (id,user_id,tier_id,method,payer_ref)
select ids.id, '63000000-0000-4000-8000-000000000001', tier.id, 'other', 'LIMIT'
from public.tiers tier
cross join (
  values
    ('64000000-0000-4000-8000-000000000002'::uuid),
    ('64000000-0000-4000-8000-000000000003'::uuid),
    ('64000000-0000-4000-8000-000000000004'::uuid)
) ids(id)
where tier.slug = 'term-all';

do $$
begin
  begin
    insert into public.payment_claims (id,user_id,tier_id,method,payer_ref)
    select '64000000-0000-4000-8000-000000000005',
           '63000000-0000-4000-8000-000000000001', id, 'other', 'FOURTH'
    from public.tiers where slug = 'term-all';
    raise exception 'fourth pending claim unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm <> 'open-claim-limit' then raise; end if;
  end;
  if (select count(*) from public.payment_claims
      where user_id = '63000000-0000-4000-8000-000000000001' and status = 'pending') <> 3 then
    raise exception 'open claim count changed after rejected fourth insert';
  end if;
  raise notice 'PASS serialized three-open-claim limit';
end $$;

rollback;
\echo 'ALL PHASE-6 PAYMENT NEGATIVE PROBES PASSED'
