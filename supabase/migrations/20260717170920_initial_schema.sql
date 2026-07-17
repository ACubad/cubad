-- ============ catalog ============
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  system text not null,
  level text not null,
  title jsonb not null,
  status text not null default 'hidden' check (status in ('published', 'hidden')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title jsonb not null,
  tagline jsonb not null,
  section_order text not null default 'study' check (section_order in ('walkthrough', 'study')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.track_subjects (
  track_id uuid not null references public.tracks(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  sort int not null default 0,
  primary key (track_id, subject_id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  unit_number int not null,
  slug text not null,
  is_free boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published')),
  content jsonb not null,
  version int not null default 1,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, slug),
  unique (subject_id, unit_number)
);

-- ============ people ============
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  country_code text not null default '',
  phone text not null default '',
  preferred_lang text not null default 'tr' check (preferred_lang in ('tr', 'en')),
  track_id uuid references public.tracks(id) on delete set null,
  role text not null default 'student' check (role in ('student', 'admin')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.legacy_sync (
  id text primary key,
  state jsonb,
  updated_at timestamptz,
  claimed_by uuid references auth.users(id)
);

-- ============ monetization ============
create table public.tiers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title jsonb not null,
  description jsonb not null default '{}'::jsonb,
  scope_type text not null default 'all' check (scope_type in ('all', 'track', 'subject')),
  scope_id uuid,
  duration_days int not null default 30,
  prices jsonb not null default '[]'::jsonb,
  status text not null default 'hidden' check (status in ('published', 'hidden')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  constraint tiers_scope_target check ((scope_type = 'all') = (scope_id is null))
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('all', 'track', 'subject')),
  scope_id uuid,
  tier_id uuid references public.tiers(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null check (source in ('code', 'admin', 'payment')),
  source_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index entitlements_user_active on public.entitlements (user_id, expires_at)
  where revoked_at is null;

create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  tier_id uuid not null references public.tiers(id),
  scope_type text not null check (scope_type in ('all', 'track', 'subject')),
  scope_id uuid,
  duration_days int not null,
  max_redemptions int not null default 1,
  redeemed_count int not null default 0,
  valid_until timestamptz,
  batch_id uuid,
  note text,
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.access_codes(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_id uuid references public.entitlements(id),
  created_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create table public.redemption_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index redemption_attempts_user_time on public.redemption_attempts (user_id, created_at);

create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier_id uuid not null references public.tiers(id),
  amount numeric,
  currency text,
  method text not null check (method in ('mpesa', 'tigopesa', 'airtelmoney', 'bank', 'other')),
  payer_ref text not null default '',
  proof_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index payment_claims_queue on public.payment_claims (status, created_at);

-- ============ ops ============
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Phase 1 additions permitted by the master schema contract.
create unique index tracks_country_system_level_key
  on public.tracks (country_code, system, level);

-- RLS is enabled on every application table. Tables without a policy default-deny.
alter table public.tracks enable row level security;
alter table public.subjects enable row level security;
alter table public.track_subjects enable row level security;
alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.user_state enable row level security;
alter table public.legacy_sync enable row level security;
alter table public.tiers enable row level security;
alter table public.entitlements enable row level security;
alter table public.access_codes enable row level security;
alter table public.code_redemptions enable row level security;
alter table public.redemption_attempts enable row level security;
alter table public.payment_claims enable row level security;
alter table public.admin_audit_log enable row level security;

-- SECURITY DEFINER avoids recursive RLS when admin policies query profiles.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- Only service-role actions may change a profile role. Phase 2 must extend
-- this function rather than installing a second role-guard trigger.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.role() <> 'service_role' then
    raise exception 'profiles.role can only be changed by a service-role action (master D11)';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- Exactly the Phase 1 baseline policies. legacy_sync deliberately has none.
create policy "profiles_select_own" on public.profiles
  for select using (user_id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

create policy "user_state_select_own" on public.user_state
  for select using (user_id = auth.uid());
create policy "user_state_insert_own" on public.user_state
  for insert with check (user_id = auth.uid());
create policy "user_state_update_own" on public.user_state
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "admin_audit_log_select_admin" on public.admin_audit_log
  for select using (public.is_admin());
