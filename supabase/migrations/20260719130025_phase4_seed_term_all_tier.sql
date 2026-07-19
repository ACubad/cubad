-- Phase 4 canonical all-access tier. This is catalog configuration only; payments remain Phase 6.
insert into public.tiers (
  slug, title, description, scope_type, duration_days, prices, status, sort
)
values (
  'term-all',
  '{"tr":"Dönemlik — Tümü","en":"Term — All access"}',
  '{"tr":"","en":""}',
  'all',
  120,
  '[{"currency":"TZS","amount":15000,"country":"TZ"},{"currency":"USD","amount":6,"country":"*"}]'::jsonb,
  'published',
  0
)
on conflict (slug) do nothing;
