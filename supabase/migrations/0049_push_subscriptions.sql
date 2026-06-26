-- ============================================================================
-- 0049 — push_subscriptions: adaptar tabela existente (uid→user_id compat)
-- Tabela já existe com (id uuid, uid, endpoint, p256dh, auth, criado_em).
-- Adiciona: user_agent, index, RLS, unique constraint.
-- Usa nomes existentes (uid, auth) em vez de renomear.
-- ============================================================================

alter table public.push_subscriptions add column if not exists user_agent text;

create index if not exists idx_pushsub_uid on public.push_subscriptions(uid);

-- Unique constraint para evitar duplicatas
do $$ begin
  if not exists (
    select 1 from pg_indexes where indexname = 'uq_pushsub_uid_endpoint'
  ) then
    create unique index uq_pushsub_uid_endpoint on public.push_subscriptions(uid, endpoint);
  end if;
end $$;

-- RLS
alter table public.push_subscriptions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='pushsub_sel_own') then
    create policy pushsub_sel_own on public.push_subscriptions for select to authenticated using (uid = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='pushsub_ins_own') then
    create policy pushsub_ins_own on public.push_subscriptions for insert to authenticated with check (uid = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='pushsub_del_own') then
    create policy pushsub_del_own on public.push_subscriptions for delete to authenticated using (uid = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='pushsub_sel_gestor') then
    create policy pushsub_sel_gestor on public.push_subscriptions for select to authenticated using (public.is_gestor());
  end if;
end $$;
