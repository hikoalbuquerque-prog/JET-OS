-- ============================================================================
-- JET OS — SlotsTeamsModule: tabela slots_escala (shape próprio da escala).
-- Separada de public.slots (que é do SlotsModule zona/GoJet) p/ evitar colisão
-- de shape. Escala = turno/horaIni/horaFim/zona/tipo/qtdPessoas/dataSlot.
-- ============================================================================
create table if not exists public.slots_escala (
  id uuid primary key default gen_random_uuid(),
  turno text, turno_label text, hora_ini text, hora_fim text,
  zona text, tipo text, qtd_pessoas int default 1,
  status text default 'Aberto', data_slot date, cidade text,
  gerado_auto boolean default false, feriado boolean default false,
  confirmacao_min int, reabertura_sem_conf_min int, poligono_id text,
  criado_por_id uuid, criado_por_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_slotsesc_cidade_data on public.slots_escala(cidade, data_slot);
alter table public.slots_escala enable row level security;
create policy slotsesc_sel on public.slots_escala for select using (auth.uid() is not null);
create policy slotsesc_gest on public.slots_escala for all using (public.is_gestor()) with check (public.is_gestor());
