-- Phase 4: single source of truth for entitlement-based subject access.
-- Preview access is deliberately unit-specific and is handled separately.
create or replace function public.has_subject_access(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = auth.uid()
      and e.revoked_at is null
      and now() between e.starts_at and e.expires_at
      and (
            e.scope_type = 'all'
        or (e.scope_type = 'subject' and e.scope_id = p_subject_id)
        or (e.scope_type = 'track' and exists (
              select 1
              from public.track_subjects ts
              where ts.track_id = e.scope_id
                and ts.subject_id = p_subject_id
            ))
      )
  );
$$;

comment on function public.has_subject_access(uuid) is
  'True iff auth.uid() holds an active unrevoked entitlement covering the subject via all, subject, or track scope.';

revoke all on function public.has_subject_access(uuid) from public;
grant execute on function public.has_subject_access(uuid) to authenticated, service_role;
