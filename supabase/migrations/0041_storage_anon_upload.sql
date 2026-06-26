-- Permitir upload anônimo no bucket uploads.
-- As fotos são públicas (leitura já é pública). Durante a migração Firebase→Supabase
-- muitos clientes não têm sessão Supabase ativa (autenticam via Firebase).
-- Quando a migração completar, restringir de volta para authenticated.
drop policy if exists "upload_anon" on storage.objects;
create policy "upload_anon" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'uploads');

drop policy if exists "update_auth" on storage.objects;
create policy "update_auth" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'uploads')
  with check (bucket_id = 'uploads');
