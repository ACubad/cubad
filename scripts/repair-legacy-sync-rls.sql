-- Repair the legacy sprout `cubad_sync` capability policies.
--
-- The old policies were accidentally fixed to one stale row hash. The legacy
-- passcode itself is the capability, so the server route sends its SHA-256 row
-- id in `x-cubad-sync-id`; each anonymous request can then access only that
-- exact row, rather than list or alter the whole table.
--
-- Apply only to the existing sprout project (`rywcdqpnwwumbpubkofc`) until
-- Phase 3 retires this legacy transport. This is intentionally not a migration
-- for the Phase 2 `cubad` project.

drop policy if exists "cubad_sync anon select" on public.cubad_sync;
drop policy if exists "cubad_sync anon insert" on public.cubad_sync;
drop policy if exists "cubad_sync anon update" on public.cubad_sync;

create policy "cubad_sync anon select"
on public.cubad_sync
for select to anon
using (
  id = (coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-cubad-sync-id')
);

create policy "cubad_sync anon insert"
on public.cubad_sync
for insert to anon
with check (
  id = (coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-cubad-sync-id')
);

create policy "cubad_sync anon update"
on public.cubad_sync
for update to anon
using (
  id = (coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-cubad-sync-id')
)
with check (
  id = (coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-cubad-sync-id')
);
