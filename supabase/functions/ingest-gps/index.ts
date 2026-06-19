// ============================================================================
// JET OS — Edge Function: ingest-gps  (Supabase / Deno)
// Equivalente ao functions/src/gps-ingest.ts (Firebase), agora no Supabase.
//
// Fluxo:
//   1. Valida o JWT do usuário (uid vem SEMPRE do token verificado — anti-spoof).
//   2. Grava o lote via RPC ingest_gps() usando service_role (geo + histórico +
//      última posição). RLS é contornada pelo service_role (escrita controlada).
//
// O app Android nativo (GpsTrackerService) faz POST aqui com:
//   Headers: Authorization: Bearer <access_token Supabase>, apikey: <anon key>
//   Body:    { "points": [ { lat, lng, accuracy, speed, heading, altitude,
//                            bateria, isMock, estrategia, capturedAt, slotId } ] }
//
// Variáveis SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY são
// injetadas automaticamente pelo runtime das Edge Functions (não precisa setar).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_PONTOS = 500;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1) Autenticação — uid vem do token verificado
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "missing_token" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ error: "invalid_token" }, 401);

  // 2) Corpo
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const points = Array.isArray(body?.points) ? body.points : [];
  if (!points.length) return json({ error: "no_points" }, 400);
  if (points.length > MAX_PONTOS) return json({ error: "too_many_points", max: MAX_PONTOS }, 413);

  // 3) Grava via RPC com service_role (uid do token, nunca do corpo)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await admin.rpc("ingest_gps", { p_uid: user.id, p_points: points });
  if (error) return json({ error: "write_failed", detail: error.message }, 500);

  return json({ ok: true, written: data });
});
