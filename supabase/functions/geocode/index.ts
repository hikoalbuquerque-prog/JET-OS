import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAPS_KEY = Deno.env.get("GMAPS_KEY")!;

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

// ── Forward geocode ─────────────────────────────────────────────────────
async function handleForward(body: Record<string, unknown>) {
  const { endereco, pais } = body as { endereco: string; pais?: string };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(endereco)}&key=${GMAPS_KEY}&language=pt${pais ? "&components=country:" + pais : ""}`;
  const r = await fetch(url);
  const data = await r.json();
  return json({ ok: true, results: data.results });
}

// ── Reverse geocode ─────────────────────────────────────────────────────
async function handleReverse(body: Record<string, unknown>) {
  const { lat, lng } = body as { lat: number; lng: number };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GMAPS_KEY}&language=pt`;
  const r = await fetch(url);
  const data = await r.json();
  return json({ ok: true, results: data.results });
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "forward":
        return await handleForward(body);
      case "reverse":
        return await handleReverse(body);
      default:
        return json({ ok: false, error: `Acao desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
