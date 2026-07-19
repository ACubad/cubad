-- Clean-stack prerequisite repair: make the existing owner-only profile RLS policies effective.
-- No INSERT/DELETE privilege is added, and the profiles_protect_role trigger still prevents role,
-- user_id, and created_at changes by students.
grant select, update on table public.profiles to authenticated;
