-- Fix: Storage upload policy — garante que qualquer autenticado pode fazer upload
drop policy if exists "upload_auth" on storage.objects;
create policy "upload_auth" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads');

-- Também permitir update (upsert precisa de update)
drop policy if exists "update_auth" on storage.objects;
create policy "update_auth" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads')
  with check (bucket_id = 'uploads');
