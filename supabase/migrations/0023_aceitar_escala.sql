-- ============================================================================
-- JET OS — Escala: ACEITE do operador (fecha o loop). RPC atômica:
--   registra slot_aceites (idempotente) → conta aceites → marca 'Preenchido' se
--   atingiu a qtd → premia o prestador (bônus presencaConfirmada) só no 1º aceite.
-- ============================================================================
create or replace function public.aceitar_escala(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_nome text; v_cnpj text;
  v_qtd int; v_cidade text; v_aceitos int; v_bonus int;
begin
  if v_uid is null then raise exception 'nao_autenticado'; end if;
  select nome into v_nome from public.usuarios where id = v_uid;
  select cnpj into v_cnpj from public.prestadores_fiscal where uid = v_uid;

  select qtd_pessoas, cidade into v_qtd, v_cidade from public.slots_escala where id = p_slot_id for update;
  if not found then raise exception 'slot_nao_encontrado'; end if;

  insert into public.slot_aceites (slot_id, uid, nome, cnpj, status)
    values (p_slot_id, v_uid, v_nome, v_cnpj, 'Confirmado')
    on conflict (slot_id, uid) do nothing;
  if not found then  -- já havia aceitado: não premia de novo
    return jsonb_build_object('sucesso', true, 'jaAceito', true);
  end if;

  select count(*) into v_aceitos from public.slot_aceites
    where slot_id = p_slot_id and status <> 'Desistiu';
  if v_aceitos >= coalesce(v_qtd, 1) then
    update public.slots_escala set status = 'Preenchido' where id = p_slot_id;
  end if;

  -- gamificação: bônus por presença confirmada (só no aceite novo)
  select coalesce((bonus->>'presencaConfirmada')::int, 5) into v_bonus
    from public.escala_config where cidade = coalesce(v_cidade, 'global');
  v_bonus := coalesce(v_bonus, 5);
  insert into public.prestadores_stats (uid, nome, cidade, pontos, total_slots)
    values (v_uid, v_nome, v_cidade, v_bonus, 1)
    on conflict (uid) do update set
      pontos = public.prestadores_stats.pontos + v_bonus,
      total_slots = public.prestadores_stats.total_slots + 1,
      atualizado_em = now();

  return jsonb_build_object('sucesso', true, 'aceitos', v_aceitos,
    'preenchido', v_aceitos >= coalesce(v_qtd, 1), 'pontos', v_bonus);
end $$;
grant execute on function public.aceitar_escala(uuid) to authenticated;
