-- Review hardening: anonymous preview capabilities may be minted only by the trusted Next.js
-- server path. Authenticated users keep direct execution so auth.uid() binds their durable row.
revoke execute on function public.claim_unit_preview(uuid,text) from anon;
grant execute on function public.claim_unit_preview(uuid,text) to authenticated, service_role;

-- Raw-table defense in depth must have the same admin draft bypass as get_unit_content().
drop policy if exists units_select_authorized on public.units;
create policy units_select_authorized on public.units
  for select to anon, authenticated
  using (
    public.is_admin()
    or (
      status = 'published'
      and exists (
        select 1
        from public.subjects s
        where s.id = units.subject_id
          and s.status = 'published'
      )
      and (
        public.has_subject_access(subject_id)
        or public.get_current_preview_unit() = id
      )
    )
  );

-- Expiry is an authorization boundary, but old unlinkable capability rows also need bounded
-- retention. Keep the purge narrow and indexed, and expose it only to trusted infrastructure.
create or replace function public.purge_expired_anonymous_preview_selections()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.anonymous_preview_selections
  where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_anonymous_preview_selections() from public, anon, authenticated;
grant execute on function public.purge_expired_anonymous_preview_selections() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'cubad-purge-expired-anonymous-previews';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'cubad-purge-expired-anonymous-previews',
    '17 3 * * *',
    'select public.purge_expired_anonymous_preview_selections()'
  );
end;
$$;
