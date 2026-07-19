-- Phase 6.3 — payment claim ownership policies and a concurrency-safe open-claim cap.
alter table public.payment_claims enable row level security;

grant select, insert, delete on table public.payment_claims to authenticated;

create policy "claims_insert_own_pending"
on public.payment_claims for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
);

create policy "claims_select_own"
on public.payment_claims for select to authenticated
using (user_id = auth.uid());

create policy "claims_delete_own_pending"
on public.payment_claims for delete to authenticated
using (user_id = auth.uid() and status = 'pending');

create policy "claims_select_admin"
on public.payment_claims for select to authenticated
using (public.is_admin());

create policy "claims_update_admin"
on public.payment_claims for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- There is intentionally no owner UPDATE policy. Admin review uses guarded functions; the admin
-- UPDATE policy is break-glass defense in depth and no authenticated UPDATE privilege is granted.

create or replace function public.enforce_open_claim_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_open int;
begin
  -- Serialize inserts for one user so two concurrent requests cannot both pass the count check.
  perform pg_advisory_xact_lock(hashtextextended('claim:' || new.user_id::text, 0));

  select count(*) into v_open
  from public.payment_claims
  where user_id = new.user_id
    and status = 'pending';

  if v_open >= 3 then
    raise exception 'open-claim-limit'
      using errcode = '23514',
            hint = 'A user may hold at most 3 pending payment claims.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_open_claim_limit() from public, anon, authenticated;

drop trigger if exists trg_enforce_open_claim_limit on public.payment_claims;
create trigger trg_enforce_open_claim_limit
before insert on public.payment_claims
for each row execute function public.enforce_open_claim_limit();
