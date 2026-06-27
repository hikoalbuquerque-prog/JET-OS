-- 0058_seed_config.sql
-- Onda F: seed app_settings com chaves de config (valores reais via backfill)
INSERT INTO public.app_settings (chave, valor) VALUES
  ('telegram',        '{"bot_token":"","chat_id":"","relatorios_chat_id":""}'::jsonb),
  ('controle_perdas', '{"filiais":[]}'::jsonb),
  ('clima',           '{"openweather_api_key":""}'::jsonb)
ON CONFLICT (chave) DO NOTHING;
