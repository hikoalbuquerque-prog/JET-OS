-- ============================================================================
-- 0053 — Colunas faltantes em usuarios (necessárias para auth flip C.9)
-- O perfil carregado no useAuth precisa de campos que o mirror Firebase não
-- copiava: tipo_cadastro, status_prestador, cidades_gerencia_log, senha_temporaria.
-- ============================================================================

alter table public.usuarios add column if not exists tipo_cadastro text;
alter table public.usuarios add column if not exists status_prestador text;
alter table public.usuarios add column if not exists cidades_gerencia_log text[] default '{}';
alter table public.usuarios add column if not exists senha_temporaria boolean default false;
