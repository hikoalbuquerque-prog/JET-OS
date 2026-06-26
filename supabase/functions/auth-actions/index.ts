import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const ROLES_ADMIN = ["admin", "gestor", "supergestor"];

async function verificarCaller(sb: ReturnType<typeof createClient>, callerUid: string) {
  const { data } = await sb
    .from("usuarios")
    .select("role")
    .eq("firebase_uid", callerUid)
    .single();
  if (!data || !ROLES_ADMIN.includes(data.role)) {
    throw new Error("Permissao negada: caller nao e admin/gestor/supergestor.");
  }
  return data.role;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function aprovarSolicitacao(
  sb: ReturnType<typeof createClient>,
  body: { solicitacaoId: string; callerUid: string; roleOverride?: string },
) {
  await verificarCaller(sb, body.callerUid);

  const { data: sol, error: solErr } = await sb
    .from("solicitacoes_prestadores")
    .select("*")
    .eq("id", body.solicitacaoId)
    .single();

  if (solErr || !sol) return json({ error: "Solicitacao nao encontrada." }, 404);

  const now = new Date().toISOString();
  await sb
    .from("solicitacoes_prestadores")
    .update({ status: "aprovado", aprovado_por: body.callerUid, aprovado_em: now })
    .eq("id", body.solicitacaoId);

  const role = body.roleOverride || sol.role_desejado;

  // Upsert usuario
  const { data: existing } = await sb
    .from("usuarios")
    .select("id")
    .eq("firebase_uid", sol.uid)
    .maybeSingle();

  if (existing) {
    await sb
      .from("usuarios")
      .update({ role, ativo: true })
      .eq("firebase_uid", sol.uid);
  } else {
    await sb.from("usuarios").insert({
      firebase_uid: sol.uid,
      email: sol.email,
      nome: sol.nome,
      role,
      ativo: true,
    });
  }

  return json({ ok: true, uid: sol.uid });
}

async function revogarAcesso(
  sb: ReturnType<typeof createClient>,
  body: { uid: string; callerUid: string },
) {
  await verificarCaller(sb, body.callerUid);

  if (body.uid === body.callerUid) {
    return json({ error: "Nao e possivel revogar o proprio acesso." }, 400);
  }

  const now = new Date().toISOString();

  // Get supabase_user_id for auth ban
  const { data: usuario } = await sb
    .from("usuarios")
    .select("supabase_user_id")
    .eq("firebase_uid", body.uid)
    .single();

  await sb
    .from("usuarios")
    .update({
      ativo: false,
      role: "desativado",
      revogado_em: now,
      revogado_por: body.callerUid,
    })
    .eq("firebase_uid", body.uid);

  // Ban the Supabase auth user if we have their ID
  if (usuario?.supabase_user_id) {
    await sb.auth.admin.updateUserById(usuario.supabase_user_id, {
      ban_duration: "876600h",
    });
  }

  return json({ ok: true });
}

async function getUsuario(
  sb: ReturnType<typeof createClient>,
  body: { uid: string },
) {
  const { data, error } = await sb
    .from("usuarios")
    .select("firebase_uid, email, nome, role, cargo_prestador, tipo_cadastro, status_prestador")
    .eq("firebase_uid", body.uid)
    .single();

  if (error || !data) return json({ error: "Usuario nao encontrado." }, 404);

  return json({
    uid: data.firebase_uid,
    email: data.email,
    nome: data.nome,
    role: data.role,
    cargoPrestador: data.cargo_prestador,
    tipoCadastro: data.tipo_cadastro,
    statusPrestador: data.status_prestador,
  });
}

async function listarSolicitacoes(sb: ReturnType<typeof createClient>) {
  const { data } = await sb
    .from("solicitacoes_prestadores")
    .select("*")
    .eq("status", "pendente")
    .order("criado_em", { ascending: false });

  return json({ solicitacoes: data ?? [] });
}

async function listarUsuarios(sb: ReturnType<typeof createClient>) {
  const { data } = await sb
    .from("usuarios")
    .select("*")
    .order("nome", { ascending: true });

  return json({ usuarios: data ?? [] });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const sb = createClient(URL, SERVICE);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    switch (action) {
      case "aprovar-solicitacao":
        return await aprovarSolicitacao(sb, body);
      case "revogar-acesso":
        return await revogarAcesso(sb, body);
      case "get-usuario":
        return await getUsuario(sb, body);
      case "listar-solicitacoes":
        return await listarSolicitacoes(sb);
      case "listar-usuarios":
        return await listarUsuarios(sb);
      default:
        return json({ error: `Acao desconhecida: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("auth-actions error:", err);
    return json({ error: err.message }, 500);
  }
});
