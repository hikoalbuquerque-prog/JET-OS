-- Permite que usuários autenticados façam upsert no gojet_snapshots
-- (necessário para o auto-scraper do browser que salva parkings/bikes/zones)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='gojet_snapshots' and policyname='gojet_snap_ins') then
    create policy gojet_snap_ins on public.gojet_snapshots for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='gojet_snapshots' and policyname='gojet_snap_upd') then
    create policy gojet_snap_upd on public.gojet_snapshots for update to authenticated using (true) with check (true);
  end if;
end $$;
