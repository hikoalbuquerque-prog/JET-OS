import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { uid, email, acao, resultado, metadados } = await req.json();
    if (!acao) return json({ error: "acao obrigatoria" }, 400);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "desconhecido";

    const supabase = createClient(URL, SERVICE);

    const { data, error } = await supabase
      .from("logs_acesso")
      .insert({
        uid: uid || null,
        email: email || null,
        acao,
        resultado: resultado || null,
        metadados: metadados || null,
        timestamp: new Date().toISOString(),
        ip,
      })
      .select("id")
      .single();

    if (error) return json({ error: error.message }, 500);

    return json({ id: data.id });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
