-- Permitir escrita anônima em ocorrências durante a migração.
-- Clientes Firebase Auth não têm sessão Supabase ativa, auth.uid() = null.
-- Quando migração completar e todos usarem sessão Supabase, restringir.
drop policy if exists "ocor_ins_anon" on public.ocorrencias;
create policy "ocor_ins_anon" on public.ocorrencias
  for insert to anon, authenticated
  with check (true);

drop policy if exists "ocor_upd_anon" on public.ocorrencias;
create policy "ocor_upd_anon" on public.ocorrencias
  for update to anon, authenticated
  using (true)
  with check (true);
