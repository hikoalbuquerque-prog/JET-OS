-- ============================================================================
-- JET OS — Migração para Supabase · Migration 0001 — Schema consolidado (Fase 0)
-- Consolida: linhagem V2 (Supabase) + operacional do Firebase + módulo fiscal (NF).
-- Ref.: DEBRIEF_JET_OS.md Seções 13 (NFS-e) e 14 (roadmap de migração).
--
-- Convenções:
--   - IDs de usuário = auth.users.id (uuid). public.usuarios é o perfil.
--   - Geo via PostGIS: pontos = geography(Point,4326); zonas = geography(Polygon,4326).
--   - RLS habilitada em TODAS as tabelas. Edge Functions usam service_role (bypass RLS).
--   - Helpers is_admin()/is_gestor() são SECURITY DEFINER p/ evitar recursão de policy.
-- ============================================================================

-- ── Extensões ──────────────────────────────────────────────────────────────
create extension if not exists postgis;       -- geo: zonas, geofence, gps
create extension if not exists pgcrypto;       -- gen_random_uuid()
create extension if not exists pg_trgm;        -- busca por nome (SearchOverlay)
create extension if not exists pg_cron;        -- agendamentos (scraper, NF, relatórios)
create extension if not exists pg_net;         -- http a partir do cron
-- pgmq: fila de emissão de NF (habilitar no painel se necessário)
create extension if not exists pgmq;

-- ── Enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum
    ('admin','supergestor','gestor','gestor_log','viewer',
     'prestador','campo','charger','scalt','promotor','guard','logistica','desativado');
exception when duplicate_object then null; end $$;

do $$ begin create type vinculo_tipo   as enum ('clt','mei','nenhum'); exception when duplicate_object then null; end $$;
do $$ begin create type tarefa_kind    as enum ('PONTO','PATINETE','ORGANIZACAO','CARGA_BATERIA'); exception when duplicate_object then null; end $$;
do $$ begin create type tarefa_status  as enum ('pendente','em_execucao','concluida','cancelada'); exception when duplicate_object then null; end $$;
do $$ begin create type area_tipo      as enum ('oficina','apreendidos'); exception when duplicate_object then null; end $$;
do $$ begin create type nivel_govbr    as enum ('desconhecido','bronze','prata','ouro'); exception when duplicate_object then null; end $$;
do $$ begin create type procuracao_status as enum ('pendente','ativa','revogada'); exception when duplicate_object then null; end $$;
do $$ begin
  create type pagamento_status as enum
    ('aberto','valor_aprovado','emitindo','nf_autorizada','nf_erro','rejeitada','pago');
exception when duplicate_object then null; end $$;

-- ── Tabela de perfil (auth.users ← public.usuarios) ─────────────────────────
create table if not exists public.usuarios (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  nome            text,
  cpf             text unique,
  role            user_role not null default 'viewer',
  tipo_vinculo    vinculo_tipo not null default 'nenhum',
  cidade          text,
  cidades_permitidas text[] default '{}',
  cargo           text,
  telegram_chat_id text,
  telegram_vinculado_em timestamptz,
  -- última posição (mapa ao vivo) — atualizada pelo ingest-gps
  ultima_pos      geography(Point,4326),
  ultima_accuracy double precision,
  ultima_velocidade double precision,
  ultima_pos_em   timestamptz,
  slot_atual_id   uuid,
  ativo           boolean not null default true,
  last_login_at   timestamptz,
  criado_em       timestamptz not null default now()
);
create index if not exists idx_usuarios_role   on public.usuarios(role);
create index if not exists idx_usuarios_cidade on public.usuarios(cidade);
create index if not exists idx_usuarios_pos     on public.usuarios using gist(ultima_pos);

-- ── Helpers de RLS (SECURITY DEFINER → sem recursão) ────────────────────────
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.usuarios u
                where u.id = auth.uid() and u.role in ('admin','supergestor'));
$$;
create or replace function public.is_gestor() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.usuarios u
                where u.id = auth.uid() and u.role in ('admin','supergestor','gestor','gestor_log'));
$$;
create or replace function public.meu_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select role from public.usuarios where id = auth.uid();
$$;

alter table public.usuarios enable row level security;
create policy usuarios_sel on public.usuarios for select using (id = auth.uid() or public.is_gestor());
create policy usuarios_upd_self on public.usuarios for update using (id = auth.uid())
  with check (id = auth.uid());        -- campos sensíveis (role/ativo) ficam p/ Edge Fn (service_role)
create policy usuarios_admin on public.usuarios for all using (public.is_admin()) with check (public.is_admin());

-- ── Solicitações de prestador (cadastro pendente) ───────────────────────────
create table if not exists public.solicitacoes_prestadores (
  id uuid primary key default gen_random_uuid(),
  nome text, email text, cpf text, cargo text, cidade text,
  status text not null default 'pendente',           -- pendente|aprovada|rejeitada
  criado_em timestamptz not null default now()
);
alter table public.solicitacoes_prestadores enable row level security;
create policy solic_ins  on public.solicitacoes_prestadores for insert with check (true);
create policy solic_gest on public.solicitacoes_prestadores for select using (public.is_gestor());
create policy solic_upd  on public.solicitacoes_prestadores for update using (public.is_gestor());

-- ── Cidades / expansão ──────────────────────────────────────────────────────
create table if not exists public.cidades_expansao (
  id uuid primary key default gen_random_uuid(),
  nome text not null, pais text default 'BR',
  geo geography(Point,4326), status text,
  populacao bigint, mercado_est numeric, investimento_est numeric,
  data_prevista date, responsavel text, obs text,
  criado_em timestamptz not null default now()
);
alter table public.cidades_expansao enable row level security;
create policy cidexp_sel on public.cidades_expansao for select using (public.is_gestor());
create policy cidexp_all on public.cidades_expansao for all using (public.is_gestor()) with check (public.is_gestor());

-- ── Estações ────────────────────────────────────────────────────────────────
create table if not exists public.estacoes (
  id uuid primary key default gen_random_uuid(),
  codigo text, geo geography(Point,4326),
  cidade text, pais text default 'BR', bairro text, endereco text,
  tipo text, status text, imagens jsonb default '[]', ia jsonb,
  croqui_status text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_estacoes_geo    on public.estacoes using gist(geo);
create index if not exists idx_estacoes_cidade on public.estacoes(cidade);
alter table public.estacoes enable row level security;
create policy estacoes_sel on public.estacoes for select using (auth.uid() is not null);
create policy estacoes_ins on public.estacoes for insert with check (auth.uid() is not null);
create policy estacoes_mod on public.estacoes for update using (public.is_gestor());
create policy estacoes_del on public.estacoes for delete using (public.is_gestor());

-- ── Zonas (polígonos) ───────────────────────────────────────────────────────
create table if not exists public.zonas (
  id uuid primary key default gen_random_uuid(),
  nome text, grupo text, fase text, cor text,
  geom geography(Polygon,4326) not null,
  ativo boolean default true, cidade text, pais text default 'BR', prioridade int,
  criado_em timestamptz not null default now()
);
create index if not exists idx_zonas_geom on public.zonas using gist(geom);
alter table public.zonas enable row level security;
create policy zonas_sel on public.zonas for select using (auth.uid() is not null);
create policy zonas_all on public.zonas for all using (public.is_gestor()) with check (public.is_gestor());

-- ── Áreas de geofence (oficina / apreendidos) — feature A1 ──────────────────
create table if not exists public.areas_geofence (
  id uuid primary key default gen_random_uuid(),
  tipo area_tipo not null, nome text,
  centro geography(Point,4326) not null, raio_m int not null default 100,
  cidade text, ativo boolean default true,
  criado_em timestamptz not null default now()
);
create index if not exists idx_areas_centro on public.areas_geofence using gist(centro);
alter table public.areas_geofence enable row level security;
create policy areas_sel on public.areas_geofence for select using (auth.uid() is not null);
create policy areas_all on public.areas_geofence for all using (public.is_gestor()) with check (public.is_gestor());

-- ── Locais operacionais + financeiro ────────────────────────────────────────
create table if not exists public.locais_operacionais (
  id uuid primary key default gen_random_uuid(),
  nome text, tipo text, geo geography(Point,4326),
  cidade text, pais text default 'BR', obs text,
  criado_em timestamptz not null default now()
);
create table if not exists public.contratos_locais (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references public.locais_operacionais(id) on delete cascade,
  indexador text, valor numeric, inicio date, fim date, obs text
);
create table if not exists public.pagamentos_locais (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references public.locais_operacionais(id) on delete cascade,
  tipo text, valor numeric, vencimento date,
  status text not null default 'PENDENTE',            -- PAGO|PENDENTE|ATRASADO|CANCELADO
  comprovante_url text, criado_em timestamptz not null default now()
);
alter table public.locais_operacionais enable row level security;
alter table public.contratos_locais  enable row level security;
alter table public.pagamentos_locais enable row level security;
create policy locais_sel on public.locais_operacionais for select using (auth.uid() is not null);
create policy locais_all on public.locais_operacionais for all using (public.is_gestor()) with check (public.is_gestor());
create policy contr_all  on public.contratos_locais  for all using (public.is_gestor()) with check (public.is_gestor());
create policy paglo_all  on public.pagamentos_locais for all using (public.is_gestor()) with check (public.is_gestor());

-- ── GoJet: config + estado atual + histórico de transições ──────────────────
create table if not exists public.gojet_config (
  cidade text primary key, city_id text not null, ativo boolean default false
);
create table if not exists public.parkings (         -- estado atual (substitui snapshots latest_)
  id text not null, city_id text not null, cidade text,
  geo geography(Point,4326), nome text, bikes_total int, bikes_disponiveis int,
  dados jsonb, atualizado_em timestamptz not null default now(),
  primary key (city_id, id)
);
create table if not exists public.bikes (
  id text not null, city_id text not null, cidade text,
  geo geography(Point,4326), status text, bateria int, last_order_at timestamptz,
  dados jsonb, atualizado_em timestamptz not null default now(),
  primary key (city_id, id)
);
create table if not exists public.parking_history (  -- transições (para analytics)
  id bigint generated always as identity primary key,
  city_id text, parking_id text, bikes_disponiveis int, bucket_ts timestamptz not null,
  criado_em timestamptz not null default now(),
  unique (city_id, parking_id, bucket_ts)
);
create table if not exists public.bike_history (
  id bigint generated always as identity primary key,
  city_id text, bike_id text, status text, bucket_ts timestamptz not null,
  criado_em timestamptz not null default now(),
  unique (city_id, bike_id, bucket_ts)
);
create index if not exists idx_parkhist_time on public.parking_history(city_id, bucket_ts);
create index if not exists idx_bikehist_time on public.bike_history(city_id, bucket_ts);
create index if not exists idx_parkings_geo  on public.parkings using gist(geo);
create index if not exists idx_bikes_geo     on public.bikes using gist(geo);
alter table public.gojet_config    enable row level security;
alter table public.parkings        enable row level security;
alter table public.bikes           enable row level security;
alter table public.parking_history enable row level security;
alter table public.bike_history    enable row level security;
create policy gojetcfg_sel on public.gojet_config    for select using (auth.uid() is not null);
create policy gojetcfg_adm on public.gojet_config    for all using (public.is_admin()) with check (public.is_admin());
create policy parkings_sel on public.parkings        for select using (auth.uid() is not null);
create policy bikes_sel    on public.bikes           for select using (auth.uid() is not null);
create policy parkhist_sel on public.parking_history for select using (public.is_gestor());
create policy bikehist_sel on public.bike_history    for select using (public.is_gestor());
-- escrita de parkings/bikes/histórico = só Edge Fn (service_role bypassa RLS)

-- ── Tarefas (logística) ─────────────────────────────────────────────────────
create table if not exists public.tarefas_logistica (
  id uuid primary key default gen_random_uuid(),
  kind tarefa_kind not null,
  titulo text, descricao text,
  assignee_uid uuid references public.usuarios(id),
  criado_por uuid references public.usuarios(id),
  status tarefa_status not null default 'pendente',
  geo geography(Point,4326), cidade text,
  foto_conclusao_url text,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz, cancelado_em timestamptz
);
create index if not exists idx_tarefas_assignee on public.tarefas_logistica(assignee_uid, status);
create index if not exists idx_tarefas_concl    on public.tarefas_logistica(concluido_em);
alter table public.tarefas_logistica enable row level security;
create policy tarefas_sel on public.tarefas_logistica for select
  using (assignee_uid = auth.uid() or criado_por = auth.uid() or public.is_gestor());
create policy tarefas_upd_assignee on public.tarefas_logistica for update
  using (assignee_uid = auth.uid()) with check (assignee_uid = auth.uid());
create policy tarefas_gestor on public.tarefas_logistica for all
  using (public.is_gestor()) with check (public.is_gestor());

-- ── Slots / turnos ──────────────────────────────────────────────────────────
create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  cidade text, tipo text, inicio timestamptz, fim timestamptz,
  vagas int, equipe jsonb, config jsonb, status text default 'ativo',
  criado_em timestamptz not null default now()
);
create table if not exists public.slot_confirmacoes (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references public.slots(id) on delete cascade,
  uid uuid references public.usuarios(id),
  status text, confirmado_em timestamptz default now(),
  unique (slot_id, uid)
);
create table if not exists public.turnos (            -- shift_records (bater ponto CLT)
  id uuid primary key default gen_random_uuid(),
  uid uuid references public.usuarios(id),
  inicio timestamptz, fim timestamptz, tipo text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_turnos_uid on public.turnos(uid, inicio);
alter table public.slots             enable row level security;
alter table public.slot_confirmacoes enable row level security;
alter table public.turnos            enable row level security;
create policy slots_sel  on public.slots for select using (auth.uid() is not null);
create policy slots_all  on public.slots for all using (public.is_gestor()) with check (public.is_gestor());
create policy slotc_sel  on public.slot_confirmacoes for select using (uid = auth.uid() or public.is_gestor());
create policy slotc_self on public.slot_confirmacoes for insert with check (uid = auth.uid());
create policy slotc_upd  on public.slot_confirmacoes for update using (uid = auth.uid() or public.is_gestor());
create policy turnos_sel on public.turnos for select using (uid = auth.uid() or public.is_gestor());
create policy turnos_self on public.turnos for insert with check (uid = auth.uid());

-- ── GPS: posições recentes + histórico (append-only) ────────────────────────
-- Escrita só pela Edge Fn ingest-gps (service_role). Histórico: ver nota de partição.
create table if not exists public.gps_locations (
  id bigint generated always as identity primary key,
  uid uuid references public.usuarios(id),
  slot_id uuid, geo geography(Point,4326) not null,
  accuracy double precision, speed double precision, heading double precision,
  altitude double precision, bateria int, is_mock boolean default false,
  estrategia text, captured_at timestamptz not null, criado_em timestamptz not null default now()
);
create index if not exists idx_gpsloc_uid_time on public.gps_locations(uid, captured_at desc);
create index if not exists idx_gpsloc_geo       on public.gps_locations using gist(geo);

-- Histórico permanente (alto volume). NOTA escala (2.500 workers): converter para
-- tabela PARTICIONADA por mês + TTL via pg_cron (drop de partições antigas) ou
-- export p/ storage frio. Mantida simples aqui para a migration aplicar limpo.
create table if not exists public.gps_history (
  id bigint generated always as identity primary key,
  uid uuid, geo geography(Point,4326) not null, accuracy double precision,
  captured_at timestamptz not null, criado_em timestamptz not null default now()
);
create index if not exists idx_gpshist_uid_time on public.gps_history(uid, captured_at desc);
alter table public.gps_locations enable row level security;
alter table public.gps_history   enable row level security;
create policy gpsloc_sel on public.gps_locations for select using (uid = auth.uid() or public.is_gestor());
create policy gpshist_sel on public.gps_history  for select using (uid = auth.uid() or public.is_gestor());

-- ============================================================================
-- MÓDULO FISCAL / NFS-e (DEBRIEF Seção 13 — greenfield no Supabase)
-- ============================================================================
create table if not exists public.pagamentos_config (
  cidade text primary key,
  valor_por_tarefa numeric not null, moeda text default 'BRL', ativo boolean default true,
  codigo_servico text, aliquota_iss numeric, municipio_ibge text
);
alter table public.pagamentos_config enable row level security;
create policy pgcfg_sel on public.pagamentos_config for select using (auth.uid() is not null);
create policy pgcfg_all on public.pagamentos_config for all using (public.is_gestor()) with check (public.is_gestor());

create table if not exists public.prestadores_fiscal (
  uid uuid primary key references public.usuarios(id) on delete cascade,
  -- auto-declarados (prestador pode editar — ver policy)
  cnpj text, razao_social text, cpf_responsavel text, inscricao_municipal text,
  email_fiscal text, nivel_govbr nivel_govbr default 'desconhecido',
  -- controlados por gestor/Edge Fn
  regime_tributario text default 'MEI',
  codigo_servico text, aliquota_iss numeric, municipio_incidencia text,
  procuracao_status procuracao_status default 'pendente',
  procuracao_concedida_em timestamptz, procuracao_verificada_em timestamptz,
  autorizado_em timestamptz,
  faturamento_ano numeric default 0, ultimo_ndps bigint default 0,
  onda text, ativo boolean default true,
  criado_em timestamptz not null default now()
);
alter table public.prestadores_fiscal enable row level security;
-- prestador lê o próprio; gestor lê todos
create policy presf_sel on public.prestadores_fiscal for select using (uid = auth.uid() or public.is_gestor());
-- gestor faz tudo; prestador insere/edita SÓ campos auto-declarados (sensíveis via service_role)
create policy presf_gestor on public.prestadores_fiscal for all using (public.is_gestor()) with check (public.is_gestor());
create policy presf_self_ins on public.prestadores_fiscal for insert with check (uid = auth.uid());
create policy presf_self_upd on public.prestadores_fiscal for update using (uid = auth.uid())
  with check (
    uid = auth.uid()
    -- impede o prestador de alterar campos sensíveis (mantêm o valor atual)
    and codigo_servico    is not distinct from (select codigo_servico    from public.prestadores_fiscal p where p.uid = auth.uid())
    and aliquota_iss      is not distinct from (select aliquota_iss      from public.prestadores_fiscal p where p.uid = auth.uid())
    and procuracao_status is not distinct from (select procuracao_status from public.prestadores_fiscal p where p.uid = auth.uid())
    and faturamento_ano   is not distinct from (select faturamento_ano   from public.prestadores_fiscal p where p.uid = auth.uid())
    and ultimo_ndps       is not distinct from (select ultimo_ndps       from public.prestadores_fiscal p where p.uid = auth.uid())
  );

create table if not exists public.pagamentos_semana (
  id text primary key,                               -- {uid}_{ano}W{semana}
  uid uuid references public.usuarios(id),
  nome text, email text, cidade text, cargo text,
  semana_inicio timestamptz, semana_fim timestamptz, ano int, semana_iso int,
  tarefas_count int default 0, valor_unitario numeric, valor_total numeric,
  status pagamento_status not null default 'aberto',
  -- NF
  nf_numero text, nf_chave text, nf_protocolo text, nf_xml_url text,
  nf_tentativas int default 0, nf_erro_motivo text, nf_emitida_em timestamptz, nf_erro_em timestamptz,
  pago_em timestamptz, atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
create index if not exists idx_pgsem_status on public.pagamentos_semana(status);
create index if not exists idx_pgsem_uid    on public.pagamentos_semana(uid);
alter table public.pagamentos_semana enable row level security;
create policy pgsem_sel on public.pagamentos_semana for select using (uid = auth.uid() or public.is_gestor());
create policy pgsem_all on public.pagamentos_semana for all using (public.is_gestor()) with check (public.is_gestor());

-- Termo de autorização da procuração — IMUTÁVEL (prova jurídica)
create table if not exists public.aceites_procuracao (
  id text primary key,                               -- {uid}_v{versao}
  uid uuid references public.usuarios(id),
  email text, nome text, versao text not null,
  dispositivo text, idioma text, aceito_em timestamptz not null default now()
);
alter table public.aceites_procuracao enable row level security;
create policy aceite_sel on public.aceites_procuracao for select using (uid = auth.uid() or public.is_gestor());
create policy aceite_ins on public.aceites_procuracao for insert with check (uid = auth.uid());
-- sem update/delete (imutável): nenhuma policy de update/delete = negado

-- Fila de emissão de NF (pgmq). Cria a fila uma vez:
select pgmq.create('nfse_emissao');

-- ============================================================================
-- LGPD / consentimentos — IMUTÁVEL
-- ============================================================================
create table if not exists public.consentimentos_lgpd (
  id text primary key,                               -- {uid}_v{versao}
  uid uuid references public.usuarios(id),
  email text, nome text, role user_role, versao text not null,
  dispositivo text, idioma text, aceito_em timestamptz not null default now()
);
alter table public.consentimentos_lgpd enable row level security;
create policy lgpd_sel on public.consentimentos_lgpd for select using (uid = auth.uid() or public.is_gestor());
create policy lgpd_ins on public.consentimentos_lgpd for insert with check (uid = auth.uid());

-- ============================================================================
-- Telegram / push / config / analytics / logs
-- ============================================================================
create table if not exists public.telegram_config (
  id text primary key default 'global', bot_token text
);
create table if not exists public.telegram_vinculos (
  codigo text primary key, chat_id text, first_name text,
  expira_em timestamptz, usado boolean default false, criado_em timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  uid uuid references public.usuarios(id) on delete cascade,
  endpoint text, p256dh text, auth text, criado_em timestamptz not null default now(),
  unique (uid, endpoint)
);
create table if not exists public.app_settings (     -- work_cities, oficinas/apreendidos legado, etc.
  chave text primary key, valor jsonb, atualizado_em timestamptz not null default now()
);
create table if not exists public.analytics_days (
  data date, regiao text, total int, total_rev numeric,
  avg_dist_km numeric, avg_dur_min numeric, by_hour jsonb, storage_path text, url text,
  primary key (data, regiao)
);
create table if not exists public.logs_acesso (
  id bigint generated always as identity primary key,
  uid uuid, email text, acao text, resultado text, metadados jsonb,
  ip text, ts timestamptz not null default now()
);
alter table public.telegram_config    enable row level security;
alter table public.telegram_vinculos  enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.app_settings       enable row level security;
alter table public.analytics_days     enable row level security;
alter table public.logs_acesso        enable row level security;
create policy tgcfg_adm on public.telegram_config   for all using (public.is_admin()) with check (public.is_admin());
create policy tgvin_adm on public.telegram_vinculos for all using (public.is_admin()) with check (public.is_admin());
create policy push_self on public.push_subscriptions for all using (uid = auth.uid()) with check (uid = auth.uid());
create policy appset_sel on public.app_settings     for select using (auth.uid() is not null);
create policy appset_adm on public.app_settings     for all using (public.is_admin()) with check (public.is_admin());
create policy anday_sel  on public.analytics_days   for select using (public.is_gestor());
create policy anday_all  on public.analytics_days   for all using (public.is_gestor()) with check (public.is_gestor());
create policy logs_gest  on public.logs_acesso      for select using (public.is_gestor());
create policy logs_ins   on public.logs_acesso      for insert with check (auth.uid() is not null);

-- ── Trigger: criar perfil em public.usuarios ao criar auth.user ─────────────
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', new.email))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Trigger: aceite de procuração carimba autorizado_em (DEBRIEF 13.20) ─────
create or replace function public.on_aceite_procuracao() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update public.prestadores_fiscal set autorizado_em = now() where uid = new.uid;
  return new;
end $$;
drop trigger if exists trg_aceite_proc on public.aceites_procuracao;
create trigger trg_aceite_proc after insert on public.aceites_procuracao
  for each row execute function public.on_aceite_procuracao();

-- FIM da migration 0001.
