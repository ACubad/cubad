-- service_role bypasses RLS but still needs SQL privileges when accessed via
-- PostgREST in a local Supabase stack. Keep this explicit so seed/admin jobs
-- behave the same locally and in the hosted project.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
