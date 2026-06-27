-- 0056 — Fix logs_acesso: dropar e recriar com schema correto
-- Tabela estava vazia e com colunas de tipo errado (uid=uuid, ts=timestamptz).
drop table if exists public.logs_acesso;

create table public.logs_acesso (
  id bigint generated always as identity primary key,
  uid text,
  email text,
  nome text,
  role text,
  ts bigint,
  user_agent text,
  plataforma text,
  idioma text,
  online boolean,
  criado_em timestamptz default now()
);

alter table public.logs_acesso enable row level security;
create policy "logs_insert_auth" on public.logs_acesso
  for insert to authenticated with check (true);
