-- ============================================================================
-- JET OS — SlotsTeamsModule Fase 0b: gamificação (prestadores_stats)
-- Perfil de gamificação por prestador (pontos/nível/streak/faltas). A coleção
-- Firestore 'prestadores' não existia; os prestadores estão em usuarios. Aqui
-- criamos o perfil e SEMEAMOS a partir dos prestadores (prestadores_fiscal).
-- ============================================================================
create table if not exists public.prestadores_stats (
  uid uuid primary key references public.usuarios(id) on delete cascade,
  nome text, cnpj text, funcao text, cidade text,
  pontos int default 0, nivel int default 1, streak int default 0, streak_max int default 0,
  total_slots int default 0, total_faltas int default 0, total_atrasos int default 0,
  avaliacao_media numeric default 0, status text default 'ativo',
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_pstats_cidade on public.prestadores_stats(cidade, pontos desc);

alter table public.prestadores_stats enable row level security;
create policy pstats_sel  on public.prestadores_stats for select using (auth.uid() is not null);
create policy pstats_gest on public.prestadores_stats for all using (public.is_gestor()) with check (public.is_gestor());

-- seed dos prestadores existentes (de prestadores_fiscal + usuarios)
insert into public.prestadores_stats (uid, nome, funcao, cidade)
select u.id, u.nome, u.cargo, u.cidade
from public.usuarios u
join public.prestadores_fiscal pf on pf.uid = u.id
on conflict (uid) do nothing;
