-- Phase 6.2 — private evidence bucket for payment proofs.
-- Private (public=false); 10 MB cap; only image/jpeg,png,webp and application/pdf.
-- Enforced at two layers: bucket config here and the server-side submit action.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Direct authenticated uploads are confined to the caller's top-level folder. The application
-- still performs uploads through its privileged server action so it can guarantee claim binding.
create policy "payment_proofs_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Owners and admins may create signed URLs through Storage's authenticated API. Objects remain
-- private, and the admin application derives names only from the server-written claim row.
create policy "payment_proofs_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

-- Evidence is immutable to students; only admins can delete through an authenticated client.
-- Orphan/cancel cleanup uses the service-role client and bypasses RLS.
create policy "payment_proofs_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.is_admin()
);

-- Deliberately no UPDATE policy: proof objects cannot be mutated in place.
