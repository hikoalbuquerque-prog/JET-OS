-- ============================================================================
-- JET OS — Fase 2 / Onda C (groundwork) — usuarios.paises
-- O app usa `paises` (escopo de país) p/ autorização; o Supabase usuarios só tinha
-- cidade/cidades_permitidas. Adiciona a coluna p/ o perfil poder vir 100% do Supabase.
-- Backfill (Firestore usuarios.paises → aqui por firebase_uid) é passo SEPARADO antes
-- de ligar a flag jet_auth_provider em produção. Até lá, o loader cai no Firestore p/ paises.
-- ============================================================================

alter table public.usuarios add column if not exists paises text[] default '{}';
