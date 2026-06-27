// ============================================================================
// JET OS — Edge Function: usuarios-write
//
// Escrita de public.usuarios sob autorização (Onda C — cutover de escrita do domínio
// usuarios, pré-req do flip de Auth). A RLS de usuarios só deixa o PRÓPRIO (id=auth.uid())
// atualizar a si; gestor/admin precisam escrever OUTROS usuários (aprovar prestador,
// editar permissões). Esta função valida o chamador pelo JWT e aplica o update via
// service_role (após autorizar), permitindo:
//   • qualquer autenticado → atualizar A SI MESMO (campos não-sensíveis)
//   • gestor/admin → atualizar QUALQUER usuário (inclui role/cidades/ativo)
//
// Body: { alvoFirebaseUid: string, patch: { ...camelCase } }
// Auth: header Authorization: Bearer <access_token da sessão A>.
// Segredos: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (já no projeto).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const GESTOR_ROLES = new Set(["admin", "supergestor", "gestor", "gestor_log"]);

// Colunas que QUALQUER um pode mudar em si mesmo (perfil/contato).
const CAMPOS_SELF: Record<string, string> = {
  nome: "nome", email: "email", cpf: "cpf", cpf_cnpj: "cpf",
  cidade: "cidade", cargo: "cargo", cargoPrestador: "cargo",
  telegram_chat_id: "telegram_chat_id",
  senhaTemporaria: "senha_temporaria",
};
// Colunas adicionais que SÓ gestor/admin pode mudar (autorização/escopo).
const CAMPOS_GESTOR: Record<string, string> = {
  role: "role", ativo: "ativo",
  cidadesPermitidas: "cidades_permitidas", cidades_permitidas: "cidades_permitidas",
  cidadesGerenciaLog: "cidades_gerencia_log", cidades_gerencia_log: "cidades_gerencia_log",
  paises: "paises",
  tipoCadastro: "tipo_cadastro", tipo_cadastro: "tipo_cadastro",
  statusPrestador: "status_prestador", status_prestador: "status_prestador",
};

function mapPatch(patch: Record<string, unknown>, isGestor: boolean) {
  const row: Record<string, unknown> = {};
  const allow = isGestor ? { ...CAMPOS_SELF, ...CAMPOS_GESTOR } : CAMPOS_SELF;
  for (const [k, col] of Object.entries(allow)) {
    if (patch[k] !== undefined && row[col] === undefined) row[col] = patch[k];
  }
  return row;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "no_token" }, 401);

  const { alvoFirebaseUid, patch } = await req.json().catch(() => ({}));
  if (!alvoFirebaseUid || !patch || typeof patch !== "object") return json({ error: "bad_request" }, 400);

  // 1) identifica o CHAMADOR pelo JWT
  const asCaller = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "invalid_token" }, 401);
  const callerId = userData.user.id;

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: caller } = await admin.from("usuarios").select("id, role").eq("id", callerId).maybeSingle();
  if (!caller) return json({ error: "caller_not_found" }, 403);
  const isGestor = GESTOR_ROLES.has(String(caller.role));

  // 2) resolve o ALVO pelo firebase_uid
  const { data: alvo } = await admin.from("usuarios").select("id").eq("firebase_uid", alvoFirebaseUid).maybeSingle();
  if (!alvo) return json({ error: "target_not_found" }, 404);

  // 3) autoriza: self OU gestor
  const ehSelf = alvo.id === callerId;
  if (!ehSelf && !isGestor) return json({ error: "forbidden" }, 403);

  // 4) monta o update permitido pelo papel e aplica via service_role
  const row = mapPatch(patch as Record<string, unknown>, isGestor);
  if (!Object.keys(row).length) return json({ error: "no_allowed_fields" }, 400);
  const { error: updErr } = await admin.from("usuarios").update(row).eq("id", alvo.id);
  if (updErr) return json({ error: "update_failed", detail: updErr.message }, 500);

  return json({ ok: true, alvo: alvo.id, campos: Object.keys(row) });
});
