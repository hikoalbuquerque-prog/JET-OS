-- Fix push_subscriptions: add missing atualizado_em column
alter table push_subscriptions add column if not exists atualizado_em timestamptz default now();

-- Fix notificacoes_app: add ts alias column + mensagem alias
-- Frontend uses 'ts' but table has 'criado_em', and 'mensagem' but table has 'corpo'
alter table notificacoes_app add column if not exists ts timestamptz default now();
alter table notificacoes_app add column if not exists mensagem text;
alter table notificacoes_app add column if not exists meta jsonb default '{}'::jsonb;

-- Backfill ts from criado_em where null
update notificacoes_app set ts = criado_em where ts is null and criado_em is not null;

-- Realtime for notificacoes_app (idempotent — ignore if already added)
do $$ begin
  alter publication supabase_realtime add table notificacoes_app;
exception when duplicate_object then null;
end $$;
