-- Review hardening: direct authenticated inserts remain RLS-mediated, but may contain only the
-- same safe initial shape accepted by the server action. Proof paths are service-written later.
drop policy if exists "claims_insert_own_pending" on public.payment_claims;

create policy "claims_insert_own_pending"
on public.payment_claims for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and proof_path is null
  and reviewed_by is null
  and reviewed_at is null
  and review_note is null
  and length(payer_ref) <= 200
  and (amount is null or (amount >= 0 and amount <= 1000000000000))
  and (currency is null or currency ~ '^[A-Z]{3,8}$')
  and exists (
    select 1
    from public.tiers
    where tiers.id = payment_claims.tier_id
      and tiers.status = 'published'
  )
);

