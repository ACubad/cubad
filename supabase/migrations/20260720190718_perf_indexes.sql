-- These tables are still small enough that the brief write lock from a regular
-- transactional CREATE INDEX is acceptable. Use CREATE INDEX CONCURRENTLY in
-- an autocommit SQL-editor session if they become large before this migration runs.

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists units_subject_status_idx
  on public.units (subject_id, status);

create index if not exists track_subjects_subject_idx
  on public.track_subjects (subject_id);

create index if not exists code_redemptions_user_idx
  on public.code_redemptions (user_id);
