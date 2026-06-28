-- ============================================================================
-- 0074 — escala_config: novo schema unificado de geração de slots
-- Adiciona colunas para modelo unificado: faixas horárias, perfis de demanda
-- por zona×cargo, mapa de dias→perfil, overrides por data, GoJet ao vivo.
-- Backward-compatible: turnos_config legado continua funcionando.
-- ============================================================================

-- Novas colunas JSONB para o modelo unificado
alter table escala_config add column if not exists faixas jsonb default '[]'::jsonb;
alter table escala_config add column if not exists perfis jsonb default '{}'::jsonb;
alter table escala_config add column if not exists mapa_dias jsonb default '{}'::jsonb;
alter table escala_config add column if not exists overrides_data jsonb default '{}'::jsonb;
alter table escala_config add column if not exists zonas_ativas jsonb default '[]'::jsonb;
alter table escala_config add column if not exists gojet_city_id text;
alter table escala_config add column if not exists gojet_ajuste boolean default false;
alter table escala_config add column if not exists feriado_perfil text default 'baixa';
alter table escala_config add column if not exists teto_vagas_zona integer default 10;
alter table escala_config add column if not exists cargos jsonb default '["Charger","Scalt","Motorista","Promotor","Fiscal"]'::jsonb;
alter table escala_config add column if not exists atualizado_em timestamptz default now();

-- Unique constraint on cidade (for upsert)
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'escala_config_pkey' and table_name = 'escala_config'
  ) then
    alter table escala_config add primary key (cidade);
  end if;
end $$;

-- Seed SP config with the unified model (preserves existing turnos_config)
update escala_config set
  faixas = '[
    {"id":"manha","horaIni":"07:00","horaFim":"12:00"},
    {"id":"tarde","horaIni":"12:00","horaFim":"18:00"},
    {"id":"noite","horaIni":"18:00","horaFim":"23:00"},
    {"id":"madrugada","horaIni":"23:00","horaFim":"07:00"}
  ]'::jsonb,
  perfis = '{
    "alta": {
      "_default": {"Charger":2,"Scalt":3,"Motorista":1,"Promotor":0,"Fiscal":0},
      "Z1 - Vermelha": {"Charger":3,"Scalt":4},
      "Z2 - Preta": {"Charger":2,"Scalt":3}
    },
    "media": {
      "_default": {"Charger":1,"Scalt":2,"Motorista":1,"Promotor":0,"Fiscal":0}
    },
    "baixa": {
      "_default": {"Charger":1,"Scalt":1,"Motorista":0,"Promotor":0,"Fiscal":0}
    },
    "evento": {
      "_default": {"Charger":3,"Scalt":5,"Motorista":2,"Promotor":1,"Fiscal":1}
    }
  }'::jsonb,
  mapa_dias = '{"0":"baixa","1":"media","2":"media","3":"media","4":"media","5":"alta","6":"alta"}'::jsonb,
  overrides_data = '{}'::jsonb,
  zonas_ativas = '["Z1 - Vermelha","Z2 - Preta","Z3 - Laranja","Z4 - Azul","Z5 - Verde","Z6 - Amarela","Zona Interlagos"]'::jsonb,
  gojet_city_id = '669f89ebd06775867c31b984',
  gojet_ajuste = true,
  feriado_perfil = 'baixa',
  teto_vagas_zona = 10,
  atualizado_em = now()
where cidade = 'global';
