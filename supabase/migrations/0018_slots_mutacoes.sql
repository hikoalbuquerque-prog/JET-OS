-- ============================================================================
-- JET OS — Slots cutover #2: demais mutações (check-in/out, cancelar, reatribuir)
-- Porta o restante do SlotsModule (hoje updateDoc no Firestore) para RPCs.
-- O módulo NÃO está em produção → cutover completo seguro.
-- ============================================================================

alter table public.slots add column if not exists check_in_em timestamptz;
alter table public.slots add column if not exists check_in_lat double precision;
alter table public.slots add column if not exists check_in_lng double precision;
alter table public.slots add column if not exists check_in_accuracy double precision;
alter table public.slots add column if not exists check_out_em timestamptz;
alter table public.slots add column if not exists cancelado_por uuid;
alter table public.slots add column if not exists cancelado_em timestamptz;

-- check-in (quem aceitou): status -> em_andamento + posição
create or replace function public.check_in_slot(
  p_slot_id uuid, p_lat double precision default null,
  p_lng double precision default null, p_accuracy double precision default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_aceito uuid; v_status text;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select aceito_por, status into v_aceito, v_status from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_nao_encontrado'; end if;
  if v_aceito is distinct from v_uid then raise exception 'nao_e_o_aceitante'; end if;
  if v_status <> 'aceito' then raise exception 'slot_nao_esta_aceito'; end if;
  update public.slots set status='em_andamento', check_in_em=now(),
    check_in_lat=p_lat, check_in_lng=p_lng, check_in_accuracy=p_accuracy where id=p_slot_id;
  return jsonb_build_object('sucesso', true);
end $$;

-- check-out (quem aceitou): status -> concluido
create or replace function public.check_out_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_aceito uuid;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select aceito_por into v_aceito from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_nao_encontrado'; end if;
  if v_aceito is distinct from v_uid then raise exception 'nao_e_o_aceitante'; end if;
  update public.slots set status='concluido', check_out_em=now() where id=p_slot_id;
  update public.usuarios set slot_atual_id=null, ultima_atividade=now() where id=v_uid;
  return jsonb_build_object('sucesso', true);
end $$;

-- cancelar (aceitante ou gestor)
create or replace function public.cancelar_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_aceito uuid;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select aceito_por into v_aceito from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_nao_encontrado'; end if;
  if v_aceito is distinct from v_uid and not public.is_gestor() then raise exception 'sem_permissao'; end if;
  update public.slots set status='cancelado', cancelado_por=v_uid, cancelado_em=now() where id=p_slot_id;
  return jsonb_build_object('sucesso', true);
end $$;

-- reatribuir (gestor): troca o aceitante
create or replace function public.reatribuir_slot(p_slot_id uuid, p_novo_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if not public.is_gestor() then raise exception 'sem_permissao'; end if;
  select nome into v_nome from public.usuarios where id = p_novo_uid;
  if not found then raise exception 'usuario_destino_nao_encontrado'; end if;
  update public.slots set aceito_por=p_novo_uid, aceito_por_nome=v_nome,
    status='aceito', aceito_em=now() where id=p_slot_id;
  if not found then raise exception 'slot_nao_encontrado'; end if;
  return jsonb_build_object('sucesso', true);
end $$;

grant execute on function public.check_in_slot(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.check_out_slot(uuid) to authenticated;
grant execute on function public.cancelar_slot(uuid) to authenticated;
grant execute on function public.reatribuir_slot(uuid, uuid) to authenticated;
