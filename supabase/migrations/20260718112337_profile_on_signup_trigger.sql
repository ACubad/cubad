-- Create a public.profiles row whenever an auth user is created.
-- SECURITY DEFINER so it runs with the function owner's rights (bypasses RLS);
-- search_path='' + fully-qualified names prevent search_path hijacking.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: any users that already exist (e.g. the bootstrap admin from Phase 1)
-- get a profile too. Idempotent.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
