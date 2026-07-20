-- Fixed-window rate limiter shared by every server-side code path. No client
-- role (anon/authenticated) ever touches this table directly: all access
-- goes through the SECURITY DEFINER functions below.

create table if not exists public.rate_limit_events (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_key_time_idx
  on public.rate_limit_events (key, created_at);

alter table public.rate_limit_events enable row level security;
-- Zero policies is intentional: RLS with no policies denies all client
-- access outright. Do not add policies here.
revoke all on public.rate_limit_events from anon, authenticated;

create or replace function public.check_rate_limit(
  p_key text, p_max int, p_window interval
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'check_rate_limit: p_key is required';
  end if;
  if p_max <= 0 then
    raise exception 'check_rate_limit: p_max must be positive';
  end if;

  -- Serialize concurrent calls for the same key so a simultaneous burst
  -- cannot all read the same count before any of them inserts. Different
  -- keys never block each other.
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  delete from public.rate_limit_events
   where key = p_key and created_at < now() - p_window;

  select count(*) into v_count from public.rate_limit_events
   where key = p_key and created_at >= now() - p_window;

  if v_count >= p_max then
    return false;
  end if;

  insert into public.rate_limit_events (key, created_at) values (p_key, now());
  return true;
end;
$$;

-- Never expose an arbitrary-key limiter RPC to clients: a malicious user
-- could otherwise fill another user's bucket and deny them service.
revoke all on function public.check_rate_limit(text, int, interval)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, interval) to service_role;

create or replace function public.cleanup_rate_limit_events()
returns void language sql security definer set search_path = ''
as $$
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
$$;

revoke all on function public.cleanup_rate_limit_events()
  from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_events() to service_role;

create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-rate-limit-events',
  '17 3 * * *',
  $$select public.cleanup_rate_limit_events();$$
);
