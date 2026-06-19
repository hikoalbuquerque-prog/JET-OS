// ============================================================================
// JET OS — Edge Function: processar-fila-nfse (NFS-e #2)
// Consome a fila pgmq 'nfse_emissao' (via wrappers public.nfse_fila_*) e emite a
// NFS-e de cada pagamento. Fluxo por mensagem { pagamento_id }:
//   1) carrega pagamento + prestador fiscal (com procuração autorizada);
//   2) montarDPS() -> XML da DPS (esqueleto Padrão Nacional);
//   3) [TODO fiscal] assinar com o certificado e-CNPJ da Jet (Vault) e enviar ao
//      sistema NFS-e; obter número/chave/protocolo;
//   4) grava o resultado em pagamentos_semana e remove da fila (sucesso) ou
//      incrementa tentativas + grava erro (falha) — a msg reaparece após o VT.
//
// Projetado p/ rodar em lote (pg_cron a cada minuto) escalando p/ ~2.500/semana.
// Processa no máximo BATCH por invocação. Idempotente por pagamento (status).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = Number(Deno.env.get("NFSE_BATCH") ?? "25");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const xmlEsc = (v: unknown) =>
  String(v ?? "").replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

// Monta o XML da DPS (Declaração de Prestação de Serviços) — ESQUELETO.
// Ajustar ao layout exato (Padrão Nacional NFSe / ABRASF do município) quando
// o alvo de emissão estiver definido.
function montarDPS(pg: any, pf: any): string {
  const comp = (pg.semana_fim ?? pg.criado_em ?? "").slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infDPS Id="DPS${xmlEsc(pg.id)}">
    <dhEmi>${xmlEsc(new Date().toISOString())}</dhEmi>
    <dCompet>${xmlEsc(comp)}</dCompet>
    <prest>
      <CNPJ>${xmlEsc(pf.cnpj)}</CNPJ>
      <xNome>${xmlEsc(pf.razao_social ?? pg.nome)}</xNome>
      <IM>${xmlEsc(pf.inscricao_municipal ?? "")}</IM>
    </prest>
    <toma>
      <!-- TOMADOR = JET (preencher CNPJ/dados da Jet) -->
      <CNPJ>TODO_CNPJ_JET</CNPJ>
    </toma>
    <serv>
      <cTribNac>${xmlEsc(pf.codigo_servico ?? "")}</cTribNac>
      <xDescServ>Servicos de logistica/operacao - semana ${xmlEsc(pg.semana_iso)}/${xmlEsc(pg.ano)}</xDescServ>
    </serv>
    <valores>
      <vServ>${xmlEsc(Number(pg.valor_total ?? 0).toFixed(2))}</vServ>
      <pAliqISS>${xmlEsc(pf.aliquota_iss ?? "")}</pAliqISS>
    </valores>
  </infDPS>
</DPS>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: msgs, error: rErr } = await admin.rpc("nfse_fila_ler", { p_qtd: BATCH, p_vt: 120 });
  if (rErr) return json({ error: "fila_ler_failed", detail: rErr.message }, 500);

  let emitidas = 0, falhas = 0;
  for (const m of msgs ?? []) {
    const pagamentoId = (m.message as any)?.pagamento_id;
    try {
      const { data: pg } = await admin.from("pagamentos_semana").select("*").eq("id", pagamentoId).maybeSingle();
      if (!pg) { await admin.rpc("nfse_fila_apagar", { p_msg_id: m.msg_id }); continue; } // pagamento sumiu
      const { data: pf } = await admin.from("prestadores_fiscal").select("*").eq("uid", pg.uid).maybeSingle();
      if (!pf || !pf.autorizado_em) throw new Error("prestador sem procuração autorizada");
      if (!pf.cnpj) throw new Error("prestador sem CNPJ");

      const dps = montarDPS(pg, pf);

      // ───────────────────────────────────────────────────────────────────
      // TODO(fiscal): assinar `dps` com o certificado A1 (e-CNPJ Jet) guardado
      // no Supabase Vault e enviar ao sistema NFS-e (Padrão Nacional/município).
      // Obter: numero, chave de acesso, protocolo, url do XML autorizado.
      // Enquanto o alvo/cert não estiver definido, NÃO emitimos de verdade:
      throw new Error("EMISSAO_NAO_CONFIGURADA: definir sistema NFS-e + certificado");
      // Exemplo do caminho de sucesso (quando configurado):
      // const r = await enviarNfse(dpsAssinado);
      // await admin.from("pagamentos_semana").update({
      //   status: "nf_autorizada", nf_numero: r.numero, nf_chave: r.chave,
      //   nf_protocolo: r.protocolo, nf_xml_url: r.xmlUrl, nf_emitida_em: new Date().toISOString(),
      //   atualizado_em: new Date().toISOString(),
      // }).eq("id", pagamentoId);
      // await admin.rpc("nfse_fila_apagar", { p_msg_id: m.msg_id });
      // emitidas++;
    } catch (e: any) {
      falhas++;
      // marca erro e devolve pra fila tentar de novo (até um teto de tentativas)
      const { data: cur } = await admin.from("pagamentos_semana").select("nf_tentativas").eq("id", pagamentoId).maybeSingle();
      const tent = (cur?.nf_tentativas ?? 0) + 1;
      await admin.from("pagamentos_semana").update({
        status: tent >= 5 ? "nf_erro" : "emitindo",
        nf_tentativas: tent, nf_erro_motivo: String(e?.message ?? e), nf_erro_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }).eq("id", pagamentoId);
      if (tent >= 5) await admin.rpc("nfse_fila_apagar", { p_msg_id: m.msg_id }); // desiste: tira da fila
    }
  }

  return json({ ok: true, lidas: msgs?.length ?? 0, emitidas, falhas });
});
