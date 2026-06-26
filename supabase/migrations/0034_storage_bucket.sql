-- 0034 — Cria bucket "uploads" no Supabase Storage.
-- Todos os arquivos do app (fotos de ocorrência, tarefas, estações, etc.)
-- vão neste bucket. Acesso público de leitura (URLs diretas) e upload
-- autenticado (RLS insert exige auth.uid()).

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

-- Qualquer autenticado pode fazer upload
create policy "upload_auth" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads');

-- Leitura pública (fotos são exibidas no app sem auth header)
create policy "read_public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'uploads');

-- Dono pode deletar (owner = auth.uid())
create policy "delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
