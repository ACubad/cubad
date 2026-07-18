-- Extend Phase 1's role guard (same function + trigger names — master §14).
-- End users may never change their own role, reparent their row, or rewrite created_at.
-- Service role (admin scripts / definer functions) may change anything.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((auth.jwt() ->> 'role'), '') = 'service_role' then
    return new;  -- admin / definer path: unrestricted
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role can only be changed by an administrator';
  end if;

  -- Defensive: never allow these to move via an owner update.
  new.user_id    := old.user_id;
  new.role       := old.role;
  new.created_at := old.created_at;
  return new;
end;
$$;

-- Reassert the (single) trigger under its Phase 1 name — idempotent.
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();
