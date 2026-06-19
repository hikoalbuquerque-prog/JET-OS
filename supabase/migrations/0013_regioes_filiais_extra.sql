-- ============================================================================
-- JET OS — Analytics: completa o mapa cidade->filial/região com as cidades que
-- apareciam como "Sem região" no analytics_ocorrencias (melhora PainelRoubos,
-- heatmap e analytics_perdas). norm_txt já cuida de caixa/acento; aqui são
-- cidades genuinamente ausentes do guard_config/regioes original.
-- ============================================================================
insert into public.regioes_filiais (cidade, filial, regiao) values
  ('Guarujá','SP Litoral','Região Centro'),
  ('Ilhabela','SP Litoral','Região Centro'),
  ('Bertioga','SP Litoral','Região Centro'),
  ('Mongaguá','SP Litoral','Região Centro'),
  ('Itanhaém','SP Litoral','Região Centro'),
  ('Sorocaba','SP Estado (Campinas)','Região Centro'),
  ('Osasco','SP Capital','Região Centro'),
  ('Gramado','RG Sul (Porto Alegre)','Região Sul'),
  ('Maceió','Alagoas (Maceió)','Região Norte'),
  ('Serra','Espírito Santo (Vila Velha)','Região Norte'),
  ('Guarapari','Espírito Santo (Vila Velha)','Região Norte'),
  ('Vespasiano','Minas Gerais (BH)','Região Norte'),
  ('Contagem','Minas Gerais (BH)','Região Norte'),
  ('Santa Luzia','Minas Gerais (BH)','Região Norte'),
  ('Ilhéus','Bahia (Salvador)','Região Norte'),
  ('Jaboatão dos Guararapes','Pernambuco (Recife)','Região Norte'),
  ('Itajaí','Santa Catarina','Região Sul'),
  ('Balneário Camboriú','Santa Catarina','Região Sul'),
  ('Palhoça','Santa Catarina','Região Sul'),
  ('Porto Belo','Santa Catarina','Região Sul'),
  ('Arniqueira','Distr. Fed. (Brasília)','Região Sul'),
  ('Gama','Distr. Fed. (Brasília)','Região Sul'),
  ('Guará','Distr. Fed. (Brasília)','Região Sul'),
  ('Taguatinga','Distr. Fed. (Brasília)','Região Sul')
on conflict (cidade) do update set filial = excluded.filial, regiao = excluded.regiao;
