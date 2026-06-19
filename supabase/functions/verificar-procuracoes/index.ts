// ============================================================================
// JET OS — Edge Function: verificar-procuracoes (NFS-e #2)
// Promove prestadores que CONCEDERAM a procuração (procuracao_status='concedida')
// para AUTORIZADOS (autorizado_em preenchido) — o que os habilita à emissão.
//
// LIMITE: a verificação real (gov.br / e-CNPJ Jet com procuração eletrônica) é
// específica e depende de credencial/serviço externo. Aqui marcamos como
// verificada/autorizada e deixamos o gancho de verificação real como TODO.
//
// Chamada por gestor (Authorization Bearer do usuário) OU por pg_cron/serviço.
// Usa service_role para escrever (RLS impede o prestador de mexer nesses campos).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // candidatos: concederam mas ainda não foram verificados/autorizados
  const { data: pend, error } = await admin
    .from("prestadores_fiscal")
    .select("uid, cnpj, nivel_govbr")
    .eq("procuracao_status", "ativa")
    .is("autorizado_em", null);
  if (error) return json({ error: "query_failed", detail: error.message }, 500);

  let autorizados = 0, semCnpj = 0;
  for (const p of pend ?? []) {
    // TODO(fiscal): verificar a procuração eletrônica real no gov.br para o e-CNPJ
    // da Jet (procuração concedida pelo prestador). Por ora exige ao menos CNPJ.
    if (!p.cnpj) { semCnpj++; continue; }
    const agora = new Date().toISOString();
    const { error: upErr } = await admin
      .from("prestadores_fiscal")
      .update({ procuracao_verificada_em: agora, autorizado_em: agora })
      .eq("uid", p.uid);
    if (!upErr) autorizados++;
  }

  return json({ ok: true, candidatos: pend?.length ?? 0, autorizados, sem_cnpj: semCnpj });
});
