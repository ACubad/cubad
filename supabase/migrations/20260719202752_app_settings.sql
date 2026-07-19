-- Phase 6.4 — generic public-safe application settings. Phase 7 can reuse this table.
create table public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

grant select on table public.app_settings to anon, authenticated;

create policy "app_settings_public_read"
on public.app_settings for select
using (true);

create policy "app_settings_write_admin"
on public.app_settings for all to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.app_settings (key, value)
values (
  'payment_instructions',
  jsonb_build_object(
    'mpesa', jsonb_build_object(
      'tr', 'M-Pesa Lipa Namba: **123456** (CUBAD). Ödedikten sonra işlem numarasını (ör. SFC8KL29XY) forma girin.',
      'en', 'M-Pesa Lipa Namba: **123456** (CUBAD). After paying, enter the transaction ID (e.g. SFC8KL29XY) in the form.'
    ),
    'bank', jsonb_build_object(
      'tr', 'Banka: CRDB Bank · Hesap adı: CUBAD · Hesap no: **0150XXXXXXXXX**',
      'en', 'Bank: CRDB Bank · Account name: CUBAD · Account no: **0150XXXXXXXXX**'
    ),
    'whatsapp', jsonb_build_object(
      'tr', 'Sorular için WhatsApp: **+255 7XX XXX XXX**',
      'en', 'Questions? WhatsApp: **+255 7XX XXX XXX**'
    )
  )
);

create or replace function public.set_app_setting(
  p_key text,
  p_value jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_key), '') is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'invalid setting' using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values (p_key, p_value, p_actor, now())
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.admin_audit_log (actor, action, entity, entity_id, details)
  values (
    p_actor,
    'settings.update',
    'app_settings',
    p_key,
    jsonb_build_object('key', p_key)
  );
end;
$$;

revoke all on function public.set_app_setting(text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.set_app_setting(text, jsonb, uuid) to service_role;
