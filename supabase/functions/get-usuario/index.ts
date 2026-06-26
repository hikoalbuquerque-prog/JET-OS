import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    let uid: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      uid = url.searchParams.get("uid");
    } else {
      const body = await req.json().catch(() => ({}));
      uid = body.uid ?? null;
    }

    if (!uid) return json({ error: "uid obrigatorio." }, 400);

    const sb = createClient(URL, SERVICE);
    const { data, error } = await sb
      .from("usuarios")
      .select("firebase_uid, email, nome, role, cargo_prestador, tipo_cadastro, status_prestador")
      .eq("firebase_uid", uid)
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
  } catch (err: any) {
    console.error("get-usuario error:", err);
    return json({ error: err.message }, 500);
  }
});
