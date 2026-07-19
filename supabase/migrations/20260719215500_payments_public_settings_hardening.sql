-- Only explicitly public settings may be read by anonymous/authenticated clients. Future settings
-- remain private by default even though app_settings is reusable.
drop policy if exists "app_settings_public_read" on public.app_settings;

create policy "app_settings_public_read"
on public.app_settings for select
using (key in ('payment_instructions'));

