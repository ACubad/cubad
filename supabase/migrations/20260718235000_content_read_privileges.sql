-- Make the Phase 3 catalog read policies effective on a clean Supabase stack.
-- These are SELECT-only grants: RLS still filters every row and all writes remain
-- service-role-only unless a later phase adds a narrowly scoped policy.

grant usage on schema public to anon, authenticated;
grant select on table public.tracks, public.subjects, public.track_subjects, public.units
  to anon, authenticated;
