-- ============================================================================
-- 0054 — Tabelas aceites_termos + logs_acesso (migrar do Firestore)
-- Com auth flip C.9, Firebase Auth pode não estar ativo → escritas Firestore
-- falham com "Missing or insufficient permissions". Mover para Supabase.
-- ============================================================================

create table if not exists public.aceites_termos (
  id text primary key,
  uid text not null,
  email text,
  nome text,
  role text,
  tipo_cadastro text,
  versao text not null,
  aceitou_termos boolean default true,
  aceitou_privacidade boolean default true,
  user_agent text,
  plataforma text,
  idioma text,
  criado_em timestamptz default now()
);

alter table public.aceites_termos enable row level security;
create policy "aceites_insert_auth" on public.aceites_termos
  for insert to authenticated with check (true);
create policy "aceites_select_auth" on public.aceites_termos
  for select to authenticated using (true);

create table if not exists public.logs_acesso (
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
