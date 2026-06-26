-- 0035: disponibilidades/slot_aceites/penalidades.uid era uuid references usuarios(id),
-- mas o frontend envia firebase_uid (string). Alterar para text.

-- disponibilidades: dropar policies que referenciam uid
drop policy if exists disp_self on public.disponibilidades;

alter table public.disponibilidades drop constraint if exists disponibilidades_uid_fkey;
alter table public.disponibilidades alter column uid type text using uid::text;

create policy disp_self on public.disponibilidades for all
  using (uid = auth.uid()::text) with check (uid = auth.uid()::text);

-- slot_aceites
drop policy if exists ace_sel on public.slot_aceites;
drop policy if exists ace_self on public.slot_aceites;

alter table public.slot_aceites drop constraint if exists slot_aceites_uid_fkey;
alter table public.slot_aceites alter column uid type text using uid::text;

create policy ace_sel on public.slot_aceites for select
  using (uid = auth.uid()::text or public.is_gestor());
create policy ace_self on public.slot_aceites for insert
  with check (uid = auth.uid()::text);

-- penalidades
drop policy if exists pen_sel on public.penalidades;

alter table public.penalidades drop constraint if exists penalidades_uid_fkey;
alter table public.penalidades drop constraint if exists penalidades_aplicado_por_fkey;
alter table public.penalidades alter column uid type text using uid::text;
alter table public.penalidades alter column aplicado_por type text using aplicado_por::text;

create policy pen_sel on public.penalidades for select
  using (uid = auth.uid()::text or public.is_gestor());
