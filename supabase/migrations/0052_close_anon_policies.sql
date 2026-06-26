-- ============================================================================
-- 0052 — Fecha políticas anon temporárias (segurança)
-- As migrations 0041-0043 criaram políticas anon para contornar a falta de
-- sessão Supabase durante a migração. Agora que estabelecerSessaoSupabase
-- persiste e renova a sessão automaticamente, restringir a authenticated.
-- Usuários sem sessão Supabase precisarão fazer logout/login para re-estabelecer.
-- ============================================================================

-- Storage uploads: anon → authenticated only
drop policy if exists "upload_anon" on storage.objects;
drop policy if exists "update_auth" on storage.objects;
create policy "upload_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads');
create policy "update_authenticated" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads');

-- Ocorrencias: anon → authenticated only
drop policy if exists "ocor_ins_anon" on public.ocorrencias;
drop policy if exists "ocor_upd_anon" on public.ocorrencias;
create policy "ocor_ins_auth" on public.ocorrencias
  for insert to authenticated
  with check (true);
create policy "ocor_upd_auth" on public.ocorrencias
  for update to authenticated
  using (true);

-- Estações: anon → authenticated only
drop policy if exists "estacoes_upd_anon" on public.estacoes;
create policy "estacoes_upd_auth" on public.estacoes
  for update to authenticated
  using (true);
