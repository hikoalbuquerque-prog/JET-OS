-- ============================================================================
-- JET OS — SlotsTeamsModule (escala por disponibilidade) — FUNDAÇÃO
-- Tabelas do modelo de escala/gamificação (módulo hoje vazio; sem backfill).
-- A fiação do componente (leitura/geração/escrita no Supabase) é passo seguinte.
-- NOTA: SlotsTeamsModule usa a coleção Firestore 'slots' com SHAPE DIFERENTE do
-- SlotsModule. Para evitar colisão no Postgres, a escala terá sua própria tabela
-- (slots_escala) quando wirarmos o componente — aqui só o modelo de apoio.
-- ============================================================================

create table if not exists public.disponibilidades (
  id uuid primary key default gen_random_uuid(),
  uid uuid references public.usuarios(id),
  nome text, cnpj text,
  dias_semana int[] default '{}', turnos_disponiveis text[] default '{}',
  zonas_disponiveis text[] default '{}', funcao text, cidade text, obs text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (uid, cidade)
);
create index if not exists idx_disp_cidade on public.disponibilidades(cidade);

create table if not exists public.feriados (
  id uuid primary key default gen_random_uuid(),
  data date not null, nome text, cidade text, nacional boolean default false,
  unique (data, cidade)
);

create table if not exists public.escala_config (
  cidade text primary key,
  dias_antecedencia int default 3,
  turnos_config jsonb default '{}', respeitar_preferencias boolean default true,
  respeitar_feriados boolean default true, nivel_minimo_urgente int default 0,
  bonus jsonb default '{}', penalidades jsonb default '{}'
);

create table if not exists public.slot_aceites (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid, uid uuid references public.usuarios(id),
  nome text, cnpj text, status text, pontuacao int, aceito_em timestamptz default now(),
  unique (slot_id, uid)
);

create table if not exists public.penalidades (
  id uuid primary key default gen_random_uuid(),
  uid uuid references public.usuarios(id), nome text, cnpj text,
  tipo text, descricao text, pontos_deducao int, slot_id uuid, cidade text,
  aplicado_por uuid, criado_em timestamptz not null default now()
);

alter table public.disponibilidades enable row level security;
alter table public.feriados         enable row level security;
alter table public.escala_config    enable row level security;
alter table public.slot_aceites     enable row level security;
alter table public.penalidades      enable row level security;

-- leitura autenticada; gestor gerencia; disponibilidade/aceite self-service
create policy disp_sel  on public.disponibilidades for select using (auth.uid() is not null);
create policy disp_self on public.disponibilidades for all using (uid = auth.uid()) with check (uid = auth.uid());
create policy disp_gest on public.disponibilidades for all using (public.is_gestor()) with check (public.is_gestor());
create policy fer_sel   on public.feriados for select using (auth.uid() is not null);
create policy fer_gest  on public.feriados for all using (public.is_gestor()) with check (public.is_gestor());
create policy ecfg_sel  on public.escala_config for select using (auth.uid() is not null);
create policy ecfg_gest on public.escala_config for all using (public.is_gestor()) with check (public.is_gestor());
create policy ace_sel   on public.slot_aceites for select using (uid = auth.uid() or public.is_gestor());
create policy ace_self  on public.slot_aceites for insert with check (uid = auth.uid());
create policy ace_gest  on public.slot_aceites for all using (public.is_gestor()) with check (public.is_gestor());
create policy pen_sel   on public.penalidades for select using (uid = auth.uid() or public.is_gestor());
create policy pen_gest  on public.penalidades for all using (public.is_gestor()) with check (public.is_gestor());
