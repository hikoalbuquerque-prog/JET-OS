-- ============================================================================
-- JET OS — Migration 0007 — mapeamento de auth (Firebase -> Supabase)
-- O uid do Firebase NÃO é um uuid, então não dá para reaproveitá-lo como auth.users.id.
-- Guardamos o firebase_uid em usuarios para mapear os dados antigos -> novo uuid do Supabase.
-- ============================================================================

alter table public.usuarios add column if not exists firebase_uid text unique;
create index if not exists idx_usuarios_fbuid on public.usuarios(firebase_uid);
