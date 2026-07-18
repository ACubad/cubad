-- Public delivery supports direct audio streaming. There are intentionally no client write
-- policies: only the service-role path in app/api/podcast/route.ts can mutate this bucket.
insert into storage.buckets (id, name, public)
values ('podcasts', 'podcasts', true)
on conflict (id) do nothing;

create policy podcasts_public_read on storage.objects
  for select to public
  using (bucket_id = 'podcasts');
