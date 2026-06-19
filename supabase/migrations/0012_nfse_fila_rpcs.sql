-- ============================================================================
-- JET OS — NFS-e #2 — Wrappers de fila (pgmq) + enfileirar pagamentos prontos
-- As Edge Functions não acessam o schema pgmq direto; expomos wrappers em public.
-- Fila: nfse_emissao. Payload da mensagem: { "pagamento_id": "<id>" }.
-- ============================================================================

-- Enfileira um pagamento para emissão (idempotência leve: só se status permite).
create or replace function public.nfse_enfileirar(p_pagamento_id text)
returns bigint language plpgsql security definer set search_path = public, pgmq as $$
declare v_msg bigint;
begin
  update public.pagamentos_semana
     set status = 'emitindo', atualizado_em = now()
   where id = p_pagamento_id and status in ('aberto','nf_erro');
  if not found then return null; end if;
  select pgmq.send('nfse_emissao', jsonb_build_object('pagamento_id', p_pagamento_id)) into v_msg;
  return v_msg;
end $$;

-- Enfileira TODOS os pagamentos prontos (status 'aberto') cujo prestador tem
-- procuração autorizada. Retorna quantos foram enfileirados.
create or replace function public.nfse_enfileirar_prontos()
returns int language plpgsql security definer set search_path = public, pgmq as $$
declare v_id text; n int := 0;
begin
  for v_id in
    select pg.id from public.pagamentos_semana pg
    join public.prestadores_fiscal pf on pf.uid = pg.uid
    where pg.status = 'aberto' and pf.autorizado_em is not null and pf.ativo
  loop
    perform public.nfse_enfileirar(v_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lê (com visibility timeout) e apaga — usados pela Edge Function consumidora.
create or replace function public.nfse_fila_ler(p_qtd int default 10, p_vt int default 60)
returns table (msg_id bigint, message jsonb)
language sql security definer set search_path = public, pgmq as $$
  select msg_id, message from pgmq.read('nfse_emissao', p_vt, p_qtd);
$$;

create or replace function public.nfse_fila_apagar(p_msg_id bigint)
returns boolean language sql security definer set search_path = public, pgmq as $$
  select pgmq.delete('nfse_emissao', p_msg_id);
$$;

grant execute on function public.nfse_enfileirar(text)        to authenticated;
grant execute on function public.nfse_enfileirar_prontos()    to authenticated;
-- ler/apagar a fila: só service_role (Edge Function). Não concede a authenticated.
