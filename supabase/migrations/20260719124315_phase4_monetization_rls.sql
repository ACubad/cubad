-- Phase 4: monetization table privileges and RLS. Client mutations remain denied except for
-- authenticated admins where an explicit admin policy exists. Redemption writes occur only in
-- SECURITY DEFINER functions.

alter table public.tiers               enable row level security;
alter table public.entitlements        enable row level security;
alter table public.access_codes        enable row level security;
alter table public.code_redemptions    enable row level security;
alter table public.redemption_attempts enable row level security;

grant select on table public.tiers, public.entitlements, public.access_codes,
  public.code_redemptions to authenticated;
grant insert, update, delete on table public.tiers, public.access_codes to authenticated;

drop policy if exists tiers_read_published on public.tiers;
create policy tiers_read_published on public.tiers
  for select to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists tiers_admin_all on public.tiers;
create policy tiers_admin_all on public.tiers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists entitlements_owner_select on public.entitlements;
create policy entitlements_owner_select on public.entitlements
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists access_codes_admin_all on public.access_codes;
create policy access_codes_admin_all on public.access_codes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists code_redemptions_owner_select on public.code_redemptions;
create policy code_redemptions_owner_select on public.code_redemptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- redemption_attempts intentionally has no policy and no client table privilege.
