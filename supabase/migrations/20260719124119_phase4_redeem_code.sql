-- Phase 4: harden code invariants, define the one entitlement-stacking implementation, and
-- provide atomic, rate-limited access-code redemption.

alter table public.access_codes
  add constraint access_codes_scope_target
    check ((scope_type = 'all') = (scope_id is null)),
  add constraint access_codes_positive_duration
    check (duration_days > 0),
  add constraint access_codes_positive_redemption_limit
    check (max_redemptions > 0),
  add constraint access_codes_redemption_count_range
    check (redeemed_count between 0 and max_redemptions);

alter table public.entitlements
  add constraint entitlements_scope_target
    check ((scope_type = 'all') = (scope_id is null)),
  add constraint entitlements_positive_window
    check (expires_at > starts_at);

create or replace function public.grant_entitlement(
  p_user          uuid,
  p_scope_type    text,
  p_scope_id      uuid,
  p_tier_id       uuid,
  p_duration_days int,
  p_source        text,
  p_source_id     uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_expires timestamptz;
  v_expires     timestamptz;
  v_ent_id      uuid;
  v_scope_key   text;
begin
  if p_user is null then
    raise exception 'entitlement user is required';
  end if;
  if p_scope_type not in ('all', 'track', 'subject') then
    raise exception 'invalid entitlement scope';
  end if;
  if (p_scope_type = 'all') <> (p_scope_id is null) then
    raise exception 'entitlement scope target mismatch';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'entitlement duration must be positive';
  end if;
  if p_source not in ('code', 'admin', 'payment') then
    raise exception 'invalid entitlement source';
  end if;

  -- Different code rows can grant the same scope concurrently. Serialize on the logical
  -- user+scope key so both grants stack instead of calculating from the same stale maximum.
  v_scope_key := p_user::text || ':' || p_scope_type || ':' || coalesce(p_scope_id::text, 'all');
  perform pg_advisory_xact_lock(hashtextextended(v_scope_key, 0));

  select max(e.expires_at) into v_max_expires
  from public.entitlements e
  where e.user_id = p_user
    and e.revoked_at is null
    and e.starts_at <= now()
    and e.expires_at > now()
    and e.scope_type = p_scope_type
    and e.scope_id is not distinct from p_scope_id;

  v_expires := greatest(now(), coalesce(v_max_expires, now()))
             + make_interval(days => p_duration_days);

  insert into public.entitlements
    (user_id, scope_type, scope_id, tier_id, starts_at, expires_at, source, source_id)
  values
    (p_user, p_scope_type, p_scope_id, p_tier_id, now(), v_expires, p_source, p_source_id)
  returning id into v_ent_id;

  return v_ent_id;
end;
$$;

comment on function public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid) is
  'Only D8 stacking implementation. Serializes same user/scope grants, appends a new provenance row, and extends from the furthest active expiry.';

revoke execute on function public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid)
  from public, anon, authenticated;
grant execute on function public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid)
  to service_role;

create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_norm     text;
  v_hash     text;
  v_attempts int;
  v_code     public.access_codes%rowtype;
  v_expires  timestamptz;
  v_ent_id   uuid;
begin
  if v_uid is null then
    raise exception 'redeem_code requires an authenticated user';
  end if;

  -- Serialize each user's limiter window. Without this lock, concurrent brute-force attempts
  -- could each miss the other transactions' uncommitted attempt row.
  perform pg_advisory_xact_lock(hashtextextended('redeem-rate:' || v_uid::text, 0));

  insert into public.redemption_attempts (user_id) values (v_uid);

  select count(*) into v_attempts
  from public.redemption_attempts
  where user_id = v_uid
    and created_at > now() - interval '1 hour';

  if v_attempts > 5 then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;

  v_norm := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]+', '', 'g');
  v_hash := encode(extensions.digest(v_norm, 'sha256'), 'hex');

  select * into v_code
  from public.access_codes
  where code_hash = v_hash
  for update;

  if v_code.id is null or v_code.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid-code');
  end if;

  if v_code.valid_until is not null and now() > v_code.valid_until then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- Report a same-user replay consistently even when that replay also finds a globally exhausted
  -- single-use code. The code row lock makes this check race-free.
  if exists (
    select 1
    from public.code_redemptions r
    where r.code_id = v_code.id
      and r.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'error', 'already-redeemed');
  end if;

  if v_code.redeemed_count >= v_code.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'exhausted');
  end if;

  v_ent_id := public.grant_entitlement(
    v_uid,
    v_code.scope_type,
    v_code.scope_id,
    v_code.tier_id,
    v_code.duration_days,
    'code',
    v_code.id
  );

  select e.expires_at into v_expires
  from public.entitlements e
  where e.id = v_ent_id;

  insert into public.code_redemptions (code_id, user_id, entitlement_id)
  values (v_code.id, v_uid, v_ent_id);

  update public.access_codes
  set redeemed_count = redeemed_count + 1
  where id = v_code.id;

  return jsonb_build_object(
    'ok', true,
    'entitlement', jsonb_build_object(
      'id', v_ent_id,
      'scope_type', v_code.scope_type,
      'scope_id', v_code.scope_id,
      'expires_at', v_expires,
      'source', 'code'
    )
  );
end;
$$;

comment on function public.redeem_code(text) is
  'Atomic redemption: serialized rate limit, normalize+sha256, row lock, validation, stacked entitlement grant, redemption ledger, and count increment.';

revoke all on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated, service_role;
