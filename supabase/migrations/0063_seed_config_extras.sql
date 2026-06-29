-- 0063_seed_config_extras.sql
-- Seed controle_perdas defaults (used by relatorio.ts for loss control thresholds)
-- and clima config. Uses ON CONFLICT DO NOTHING so existing rows are preserved.
--
-- controle_perdas.filiais[] shape per relatorio.ts:
--   { filial, regiao, resp, patins, bikes, baterias, brpd,
--     vand_patins, vand_bikes, vand_total, nao_enc_patins, nao_enc_bikes, nao_enc_bat,
--     status1_24h, status2_7d }
-- controle_perdas.regioes: future per-region thresholds

INSERT INTO public.app_settings (chave, valor)
VALUES
  ('controle_perdas', '{"regioes": {}, "filiais": []}'::jsonb),
  ('clima', '{"openweather_api_key": ""}'::jsonb)
ON CONFLICT (chave) DO NOTHING;
