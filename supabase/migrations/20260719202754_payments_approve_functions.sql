-- Phase 6.5 — atomic payment review. Phase 4's grant_entitlement remains the only stacking
-- implementation and is called here without being redefined.

create or replace function public.approve_claim(
  p_claim_id      uuid,
  p_code_hash     text,
  p_duration_days int,
  p_reviewer      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim   public.payment_claims%rowtype;
  v_tier    public.tiers%rowtype;
  v_code_id uuid;
  v_ent_id  uuid;
  v_expires timestamptz;
begin
  if p_reviewer is null or not exists (
    select 1 from public.profiles where user_id = p_reviewer and role = 'admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid-code-hash' using errcode = '22023';
  end if;

  -- First operation: lock the claim. Competing approvals/rejections serialize on this row.
  select * into v_claim
  from public.payment_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception 'claim-not-found' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'not-pending' using errcode = '23514';
  end if;
  if v_claim.proof_path is null then
    raise exception 'proof-required' using errcode = '23514';
  end if;

  select * into v_tier
  from public.tiers
  where id = v_claim.tier_id;

  if not found then
    raise exception 'tier-not-found' using errcode = 'P0002';
  end if;
  if p_duration_days is distinct from v_tier.duration_days then
    raise exception 'duration-mismatch' using errcode = '22023';
  end if;

  insert into public.access_codes (
    code_hash,
    tier_id,
    scope_type,
    scope_id,
    duration_days,
    max_redemptions,
    redeemed_count,
    note,
    created_by
  )
  values (
    p_code_hash,
    v_tier.id,
    v_tier.scope_type,
    v_tier.scope_id,
    v_tier.duration_days,
    1,
    1,
    'payment-claim:' || p_claim_id::text,
    p_reviewer
  )
  returning id into v_code_id;

  v_ent_id := public.grant_entitlement(
    v_claim.user_id,
    v_tier.scope_type,
    v_tier.scope_id,
    v_tier.id,
    v_tier.duration_days,
    'code',
    v_code_id
  );

  select expires_at into v_expires
  from public.entitlements
  where id = v_ent_id;

  insert into public.code_redemptions (code_id, user_id, entitlement_id)
  values (v_code_id, v_claim.user_id, v_ent_id);

  update public.payment_claims
  set status = 'approved',
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      review_note = null
  where id = p_claim_id;

  insert into public.admin_audit_log (actor, action, entity, entity_id, details)
  values (
    p_reviewer,
    'claim.approve',
    'payment_claim',
    p_claim_id::text,
    jsonb_build_object(
      'code_id', v_code_id,
      'entitlement_id', v_ent_id,
      'tier_id', v_tier.id,
      'expires_at', v_expires
    )
  );

  return jsonb_build_object(
    'ok', true,
    'entitlement_id', v_ent_id,
    'code_id', v_code_id,
    'expires_at', v_expires,
    'scope_type', v_tier.scope_type,
    'tier_slug', v_tier.slug
  );
end;
$$;

revoke all on function public.approve_claim(uuid, text, int, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_claim(uuid, text, int, uuid) to service_role;

create or replace function public.reject_claim(
  p_claim_id uuid,
  p_reviewer uuid,
  p_note     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.payment_claims%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if p_reviewer is null or not exists (
    select 1 from public.profiles where user_id = p_reviewer and role = 'admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_note = '' then
    raise exception 'note-required' using errcode = '23514';
  end if;
  if length(v_note) > 2000 then
    raise exception 'note-too-long' using errcode = '22023';
  end if;

  select * into v_claim
  from public.payment_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception 'claim-not-found' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'not-pending' using errcode = '23514';
  end if;

  update public.payment_claims
  set status = 'rejected',
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      review_note = v_note
  where id = p_claim_id;

  insert into public.admin_audit_log (actor, action, entity, entity_id, details)
  values (
    p_reviewer,
    'claim.reject',
    'payment_claim',
    p_claim_id::text,
    jsonb_build_object('note', v_note)
  );

  return jsonb_build_object('ok', true, 'user_id', v_claim.user_id);
end;
$$;

revoke all on function public.reject_claim(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_claim(uuid, uuid, text) to service_role;
