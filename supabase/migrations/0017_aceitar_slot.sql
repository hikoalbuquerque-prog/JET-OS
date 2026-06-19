-- ============================================================================
-- JET OS — Slots cutover #1: aceite do operador (porte de aceitarSlot)
-- Colunas de aceite no slots (modelo Firestore: 1 slot = 1 aceitante) + RPC
-- atômica. SECURITY DEFINER pois o prestador não tem RLS de escrita em slots.
-- Telegram fica como TODO (era setImmediate, não bloqueava a resposta).
-- ============================================================================

alter table public.slots add column if not exists aceito_por uuid references public.usuarios(id);
alter table public.slots add column if not exists aceito_por_nome text;
alter table public.slots add column if not exists aceito_em timestamptz;
alter table public.usuarios add column if not exists slot_atual_id uuid;
alter table public.usuarios add column if not exists ultima_atividade timestamptz;

create or replace function public.aceitar_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_nome text; v_cargo text; v_ativo boolean;
  v_status text; v_tipo text;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;

  select nome, cargo, ativo into v_nome, v_cargo, v_ativo
    from public.usuarios where id = v_uid;
  if not found then raise exception 'usuario_nao_encontrado'; end if;
  if v_ativo is not true then raise exception 'prestador_inativo'; end if;

  -- trava a linha do slot (atomicidade)
  select status, tipo into v_status, v_tipo from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_nao_encontrado'; end if;
  if v_status <> 'aberto' then
    raise exception '%', case when v_status = 'aceito' then 'slot_ja_aceito' else 'slot_indisponivel' end;
  end if;
  if v_tipo is distinct from v_cargo then raise exception 'cargo_incompativel'; end if;

  update public.slots
     set status = 'aceito', aceito_por = v_uid, aceito_por_nome = v_nome, aceito_em = now()
   where id = p_slot_id;
  update public.usuarios
     set slot_atual_id = p_slot_id, ultima_atividade = now()
   where id = v_uid;

  -- TODO(telegram): notificar tópico do cargo + líderes da cidade.
  return jsonb_build_object('sucesso', true, 'slot_id', p_slot_id);
end $$;
grant execute on function public.aceitar_slot(uuid) to authenticated;
