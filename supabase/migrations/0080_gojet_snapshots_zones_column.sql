-- Adiciona coluna zones ao gojet_snapshots para armazenar geofences/zonas GoJet
alter table public.gojet_snapshots add column if not exists zones jsonb;
alter table public.gojet_snapshots add column if not exists total_zones int;
