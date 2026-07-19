-- The profile email is an auth.users projection maintained only by trusted database triggers.
-- Keep owner profile editing available for onboarding fields without granting email/role writes.
revoke update on table public.profiles from authenticated;

grant update (
  full_name,
  country_code,
  phone,
  preferred_lang,
  track_id,
  onboarded_at,
  updated_at
) on table public.profiles to authenticated;

comment on column public.profiles.email is
  'RLS-protected auth email copy maintained by auth.users triggers; authenticated clients cannot update it.';
