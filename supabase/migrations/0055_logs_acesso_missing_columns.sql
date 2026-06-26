-- 0055 — Colunas faltantes em logs_acesso (tabela pré-existente sem todas as colunas)
alter table public.logs_acesso add column if not exists uid text;
alter table public.logs_acesso add column if not exists email text;
alter table public.logs_acesso add column if not exists nome text;
alter table public.logs_acesso add column if not exists role text;
alter table public.logs_acesso add column if not exists ts bigint;
alter table public.logs_acesso add column if not exists user_agent text;
alter table public.logs_acesso add column if not exists plataforma text;
alter table public.logs_acesso add column if not exists idioma text;
alter table public.logs_acesso add column if not exists online boolean;
alter table public.logs_acesso add column if not exists criado_em timestamptz default now();

-- RLS (pode já existir, usar IF NOT EXISTS via DO block)
alter table public.logs_acesso enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='logs_acesso' and policyname='logs_insert_auth') then
    create policy "logs_insert_auth" on public.logs_acesso for insert to authenticated with check (true);
  end if;
end $$;
