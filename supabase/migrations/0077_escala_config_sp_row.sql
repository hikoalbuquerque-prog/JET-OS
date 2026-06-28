-- Move SP-specific config from 'global' row to dedicated 'São Paulo' row.
-- Global keeps only defaults (empty faixas = manual mode for unconfigured cities).

-- 1. Insert SP row with the SP-specific config (copy from global)
insert into escala_config (cidade, faixas, perfis, mapa_dias, overrides_data, zonas_ativas,
  gojet_city_id, gojet_ajuste, feriado_perfil, teto_vagas_zona, cargos, atualizado_em)
select 'São Paulo', faixas, perfis, mapa_dias, overrides_data, zonas_ativas,
  gojet_city_id, gojet_ajuste, feriado_perfil, teto_vagas_zona, cargos, now()
from escala_config where cidade = 'global'
on conflict (cidade) do update set
  faixas = excluded.faixas,
  perfis = excluded.perfis,
  mapa_dias = excluded.mapa_dias,
  overrides_data = excluded.overrides_data,
  zonas_ativas = excluded.zonas_ativas,
  gojet_city_id = excluded.gojet_city_id,
  gojet_ajuste = excluded.gojet_ajuste,
  feriado_perfil = excluded.feriado_perfil,
  teto_vagas_zona = excluded.teto_vagas_zona,
  cargos = excluded.cargos,
  atualizado_em = now();

-- 2. Reset global to defaults (manual mode, no SP-specific data)
update escala_config set
  faixas = '[]'::jsonb,
  perfis = '{}'::jsonb,
  mapa_dias = '{}'::jsonb,
  overrides_data = '{}'::jsonb,
  zonas_ativas = '[]'::jsonb,
  gojet_city_id = null,
  gojet_ajuste = false,
  feriado_perfil = 'baixa',
  teto_vagas_zona = 10,
  atualizado_em = now()
where cidade = 'global';
