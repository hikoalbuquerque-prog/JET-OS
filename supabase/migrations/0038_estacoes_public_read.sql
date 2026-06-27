-- Estações são dados públicos (localização de bicicletários).
-- Permitir leitura anônima para que o mapa carregue sem sessão Supabase.
create policy estacoes_anon_sel on public.estacoes
  for select using (true);
