// ============================================================================
// JET OS — Edge Function: auth-login (migração preguiçosa de senha Firebase->Supabase)
//
// O hash de senha do Firebase (scrypt) não importa no Supabase. Então, na transição,
// o app chama ESTA função para logar. Fluxo:
//   1) tenta login no Supabase (quem já migrou cai aqui e pronto);
//   2) se falhar, verifica a senha no Firebase (identitytoolkit);
//   3) se válida, acha o usuário Supabase pelo firebase_uid, grava a senha e loga.
// Depois que todos migrarem, o app pode voltar a usar supabase.auth.signInWithPassword direto.
//
// Segredo necessário: FIREBASE_API_KEY (Web API key — já é pública no app).
//   supabase functions secrets set FIREBASE_API_KEY=AIza...
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FB_KEY = Deno.env.get("FIREBASE_API_KEY")!;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function sbLogin(email: string, password: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  return error ? null : data.session;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return json({ error: "missing_credentials" }, 400);

  // 1) já migrado?
  let session = await sbLogin(email, password);
  if (session) return json({ ok: true, session, migrated: false });

  // 2) verifica no Firebase
  const fb = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  if (!fb.ok) return json({ error: "invalid_credentials" }, 401);
  const fbUser = await fb.json();
  const fbUid = fbUser.localId as string;

  // 3) acha o usuário Supabase pré-provisionado (pelo firebase_uid) e grava a senha
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: prof } = await admin.from("usuarios").select("id").eq("firebase_uid", fbUid).maybeSingle();
  if (!prof) return json({ error: "user_not_provisioned" }, 403); // pré-provisionar antes (script)
  const { error: upErr } = await admin.auth.admin.updateUserById(prof.id, { password });
  if (upErr) return json({ error: "set_password_failed", detail: upErr.message }, 500);

  // 4) loga no Supabase e retorna a sessão
  session = await sbLogin(email, password);
  if (!session) return json({ error: "login_after_migration_failed" }, 500);
  return json({ ok: true, session, migrated: true });
});
