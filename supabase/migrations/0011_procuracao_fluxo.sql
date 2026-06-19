-- ============================================================================
-- JET OS — Módulo NFS-e #1 — Fluxo de procuração + resumo (gestor)
-- O schema fiscal já existe (0001: prestadores_fiscal, aceites_procuracao,
-- pagamentos_semana, fila pgmq nfse_emissao). Aqui adicionamos:
--   • registrar_aceite_procuracao(): app do prestador concede a procuração —
--     grava o aceite IMUTÁVEL e marca procuracao_status='ativa'. SECURITY
--     DEFINER porque a RLS impede o prestador de alterar procuracao_status.
--   • v_procuracoes: visão p/ o gestor (quem concedeu / pendentes).
-- Idempotente.
-- ============================================================================

-- Garante a fila de emissão (caso o select pgmq.create do 0001 não tenha rodado).
do $$ begin
  perform pgmq.create('nfse_emissao');
exception when others then null; end $$;

-- ── App do prestador concede a procuração ───────────────────────────────────
create or replace function public.registrar_aceite_procuracao(
  p_versao text, p_dispositivo text default null, p_idioma text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text; v_nome text;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  select email, nome into v_email, v_nome from public.usuarios where id = v_uid;

  -- aceite IMUTÁVEL (prova jurídica) — id = {uid}_v{versao}
  insert into public.aceites_procuracao (id, uid, email, nome, versao, dispositivo, idioma)
  values (v_uid || '_v' || p_versao, v_uid, v_email, v_nome, p_versao, p_dispositivo, p_idioma)
  on conflict (id) do nothing;

  -- cria/atualiza o registro fiscal marcando a procuração como concedida
  insert into public.prestadores_fiscal (uid, procuracao_status, procuracao_concedida_em)
  values (v_uid, 'ativa', now())
  on conflict (uid) do update
    set procuracao_status = 'ativa',
        procuracao_concedida_em = coalesce(public.prestadores_fiscal.procuracao_concedida_em, now());
end $$;
grant execute on function public.registrar_aceite_procuracao(text, text, text) to authenticated;

-- ── Resumo para o gestor (quem concedeu / pendentes) ────────────────────────
-- security_invoker => respeita a RLS de prestadores_fiscal (gestor vê todos;
-- prestador vê o próprio).
create or replace view public.v_procuracoes with (security_invoker = on) as
  select pf.uid, u.nome, u.email, u.cidade, u.cargo,
         pf.procuracao_status, pf.procuracao_concedida_em,
         pf.procuracao_verificada_em, pf.autorizado_em,
         pf.cnpj, pf.razao_social, pf.nivel_govbr, pf.ativo
  from public.prestadores_fiscal pf
  join public.usuarios u on u.id = pf.uid;
