-- Phase 5: expose an RLS-protected email copy for admin user search without
-- making auth.users or the service-role client part of normal admin reads.
alter table public.profiles
  add column if not exists email text not null default '';

-- Merge the email copy into the existing Phase 2 signup trigger function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do update
    set email = excluded.email;
  return new;
end;
$$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = coalesce(new.email, '')
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

update public.profiles p
set email = coalesce(u.email, '')
from auth.users u
where p.user_id = u.id
  and p.email = '';

comment on column public.profiles.email is
  'RLS-protected auth email copy maintained by auth.users insert/update triggers.';
