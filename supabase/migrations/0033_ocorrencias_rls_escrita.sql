-- ============================================================================
-- JET OS — Fase 2 / Onda B→C — RLS de ESCRITA em ocorrencias (cutover de writes)
-- Hoje só gestor escreve (policy ocor_gestor for all). Guards/campo CRIAM ocorrências,
-- então sem isto o write no Supabase falharia sob RLS. Adiciona:
--   • INSERT: autenticado pode inserir registrando a SI (registrado_por = auth.uid())
--             — gestor já cobre tudo via ocor_gestor.
--   • UPDATE: o próprio dono pode atualizar a sua (status/BO/fotos) — gestor já cobre tudo.
-- DELETE segue só gestor (ocor_gestor). Inofensivo enquanto ninguém escreve no Supabase
-- (cliente só escreve com a flag jet_guard_write ligada).
-- ============================================================================

drop policy if exists ocor_ins_self on public.ocorrencias;
create policy ocor_ins_self on public.ocorrencias for insert
  with check (registrado_por = auth.uid() or public.is_gestor());

drop policy if exists ocor_upd_self on public.ocorrencias;
create policy ocor_upd_self on public.ocorrencias for update
  using (registrado_por = auth.uid() or public.is_gestor())
  with check (registrado_por = auth.uid() or public.is_gestor());
