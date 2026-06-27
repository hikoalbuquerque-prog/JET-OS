-- Push subscriptions (Web Push API nativo, substitui FCM)
-- Tabela já criada manualmente; esta migration adiciona a policy RLS.
-- uid é text (mesmo formato que outros tables: Firebase UID string).

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'push_subs_service' and tablename = 'push_subscriptions') then
    create policy "push_subs_service" on push_subscriptions for all using (true) with check (true);
  end if;
end $$;
