alter table public.entitlements
  add column if not exists reminded_at timestamptz,
  add column if not exists reminder_claimed_at timestamptz;

create index if not exists entitlements_expiry_reminder_idx
  on public.entitlements (expires_at)
  where revoked_at is null and reminded_at is null;
