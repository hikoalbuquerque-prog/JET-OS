-- Permitir update anônimo em estações durante a migração.
-- Clientes não têm sessão Supabase ativa (auth via Firebase).
drop policy if exists "estacoes_upd_anon" on public.estacoes;
create policy "estacoes_upd_anon" on public.estacoes
  for update to anon, authenticated
  using (true)
  with check (true);
