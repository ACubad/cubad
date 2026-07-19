drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
create policy admin_audit_log_select_admin on public.admin_audit_log
  for select to authenticated
  using (public.is_admin());

grant select on table public.admin_audit_log to authenticated;

-- There is intentionally no client insert, update, or delete privilege or policy.
