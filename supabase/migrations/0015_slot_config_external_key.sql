-- ============================================================================
-- 0015 — slot_config (jsonb) + slots.external_key único
-- Capturada do banco em 17/06/2026 (information_schema / gerar-slots usage).
-- Idempotente. Versiona objetos aplicados originalmente via SQL editor.
-- ============================================================================

-- ── slot_config: config do gerador de slots (modelo zona) ───────────────────
-- id='global'    -> { cidade, pais, cityIdGoJet, zonas:[{ativo,cargo,turno,vagasBase,zona}],
--                     multiplicadores:{limiarOciosidade,ociosidadeAlta,limiarDeficit,
--                                      deficitAlto,bateriasBaixa} }
-- id='overrides' -> { "<zona>_<turno>": { ativo, vagasBase } }
create table if not exists public.slot_config (
  id            text primary key,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz default now()
);

alter table public.slot_config enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='slot_config' and policyname='slot_config_sel') then
    create policy slot_config_sel on public.slot_config for select using (auth.role() = 'authenticated');
  end if;
  -- escrita só service_role/gestor; o gerador (Edge Fn) usa service_role (ignora RLS).
end $$;

-- ── slots.external_key: idempotência do gerador (1 linha/vaga) ───────────────
-- chave = gen_<cidade>_<zona>_<turno>_<data>_<i>  (upsert ignoreDuplicates)
alter table public.slots add column if not exists external_key text;
create unique index if not exists uq_slots_external_key on public.slots(external_key);
