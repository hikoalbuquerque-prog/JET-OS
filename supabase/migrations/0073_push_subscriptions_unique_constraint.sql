-- Fix push_subscriptions upsert: PostgREST on_conflict requires a UNIQUE CONSTRAINT, not just a unique index.
-- Migration 0049 created uq_pushsub_uid_endpoint as a unique INDEX; promote it to a proper constraint.

-- Drop the old unique index if it exists
drop index if exists uq_pushsub_uid_endpoint;

-- Add proper unique constraint (creates an index internally)
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'push_subscriptions_uid_endpoint_key'
      and table_name = 'push_subscriptions'
  ) then
    alter table push_subscriptions add constraint push_subscriptions_uid_endpoint_key unique (uid, endpoint);
  end if;
end $$;

-- Also need UPDATE policy for upsert to work
do $$ begin
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='pushsub_upd_own') then
    create policy pushsub_upd_own on push_subscriptions for update to authenticated using (uid::text = auth.uid()::text) with check (uid::text = auth.uid()::text);
  end if;
end $$;
