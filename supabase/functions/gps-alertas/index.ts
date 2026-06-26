import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function sendTelegram(chatId: string | number, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function alertaGestores(sb: ReturnType<typeof createClient>, mensagem: string) {
  const { data: gestores } = await sb
    .from("usuarios")
    .select("telegram_chat_id")
    .in("role", ["admin", "gestor", "supergestor"])
    .eq("ativo", true)
    .not("telegram_chat_id", "is", null);

  for (const g of gestores ?? []) {
    await sendTelegram(g.telegram_chat_id, mensagem);
  }
}

async function cooldownOk(
  sb: ReturnType<typeof createClient>,
  tipo: string,
  uid: string,
  minutos: number,
): Promise<boolean> {
  const since = new Date(Date.now() - minutos * 60_000).toISOString();
  const { count } = await sb
    .from("monitor_alertas")
    .select("id", { count: "exact", head: true })
    .eq("tipo", tipo)
    .eq("uid", uid)
    .gte("criado_em", since);
  return (count ?? 0) === 0;
}

async function insertAlerta(
  sb: ReturnType<typeof createClient>,
  tipo: string,
  uid: string,
  mensagem: string,
) {
  await sb.from("monitor_alertas").insert({
    tipo,
    uid,
    mensagem,
    criado_em: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function verificarAtrasos(sb: ReturnType<typeof createClient>) {
  const hoje = new Date().toISOString().slice(0, 10);
  let alertas = 0;

  // 1) Slots ativos sem GPS recente
  const { data: slots } = await sb
    .from("slots")
    .select("id, uid")
    .in("status", ["aceito", "em_andamento"])
    .eq("data_slot", hoje);

  const dezMinAtras = new Date(Date.now() - 10 * 60_000).toISOString();

  for (const slot of slots ?? []) {
    const { count } = await sb
      .from("gps_locations")
      .select("id", { count: "exact", head: true })
      .eq("uid", slot.uid)
      .gte("timestamp", dezMinAtras);

    if ((count ?? 0) === 0) {
      if (await cooldownOk(sb, "sem_gps_slot", slot.uid, 20)) {
        const msg = `[GPS Alert] Prestador ${slot.uid} sem sinal GPS ha mais de 10min (slot ${slot.id}).`;
        await alertaGestores(sb, msg);
        await insertAlerta(sb, "sem_gps_slot", slot.uid, msg);
        alertas++;
      }
    }
  }

  // 2) Tarefas logistica sem check-in ou muito tempo em execucao
  const { data: tarefas } = await sb
    .from("tarefas_logistica")
    .select("id, atribuido_a, status, criado_em, iniciado_em")
    .eq("status", "em_andamento");

  const now = Date.now();
  for (const t of tarefas ?? []) {
    const inicio = t.iniciado_em ? new Date(t.iniciado_em).getTime() : new Date(t.criado_em).getTime();
    const minutos = (now - inicio) / 60_000;

    if (minutos > 20 && !t.iniciado_em) {
      // >20min sem check-in
      if (await cooldownOk(sb, "tarefa_sem_checkin", t.atribuido_a, 30)) {
        const msg = `[Logistica] Tarefa ${t.id} atribuida a ${t.atribuido_a} ha ${Math.round(minutos)}min sem check-in.`;
        await alertaGestores(sb, msg);
        await insertAlerta(sb, "tarefa_sem_checkin", t.atribuido_a, msg);
        alertas++;
      }
    }
    if (minutos > 30 && t.iniciado_em) {
      // >30min em execucao
      if (await cooldownOk(sb, "tarefa_longa", t.atribuido_a, 30)) {
        const msg = `[Logistica] Tarefa ${t.id} em execucao ha ${Math.round(minutos)}min (atribuida a ${t.atribuido_a}).`;
        await alertaGestores(sb, msg);
        await insertAlerta(sb, "tarefa_longa", t.atribuido_a, msg);
        alertas++;
      }
    }
  }

  return json({ ok: true, alertas });
}

async function verificarChegada(
  sb: ReturnType<typeof createClient>,
  body: { uid: string; lat: number; lng: number; timestamp: string },
) {
  const { uid, lat, lng, timestamp } = body;
  let arrived = false;
  let teleporte = false;

  // 1) Check arrival at tarefa location
  const { data: tarefas } = await sb
    .from("tarefas_logistica")
    .select("id, lat, lng")
    .eq("atribuido_a", uid)
    .eq("status", "aceita");

  for (const t of tarefas ?? []) {
    if (t.lat != null && t.lng != null) {
      const dist = haversine(lat, lng, t.lat, t.lng);
      if (dist <= 100) {
        await sb
          .from("tarefas_logistica")
          .update({ check_in_gps: true, check_in_gps_em: new Date().toISOString() })
          .eq("id", t.id);
        arrived = true;
      }
    }
  }

  // 2) Teleportation detection
  const { data: lastPoints } = await sb
    .from("gps_locations")
    .select("lat, lng, timestamp")
    .eq("uid", uid)
    .order("timestamp", { ascending: false })
    .limit(1);

  if (lastPoints && lastPoints.length > 0) {
    const prev = lastPoints[0];
    const dist = haversine(lat, lng, prev.lat, prev.lng);
    const dt = (new Date(timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
    if (dt > 0 && dist / dt > 150) {
      teleporte = true;
      if (await cooldownOk(sb, "teleporte", uid, 10)) {
        const msg = `[GPS Mock] Teleporte detectado para ${uid}: ${Math.round(dist)}m em ${Math.round(dt)}s (${Math.round(dist / dt)} m/s).`;
        await alertaGestores(sb, msg);
        await insertAlerta(sb, "teleporte", uid, msg);
      }
    }
  }

  return json({ ok: true, arrived, teleporte });
}

async function alertarMock(
  sb: ReturnType<typeof createClient>,
  body: { uid: string; lat: number; lng: number },
) {
  const { uid, lat, lng } = body;
  const msg = `[GPS Mock] GPS falso detectado para prestador ${uid} em (${lat}, ${lng}).`;
  await alertaGestores(sb, msg);
  await insertAlerta(sb, "mock_gps", uid, msg);
  return json({ ok: true });
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
      case "verificar-atrasos":
        return await verificarAtrasos(sb);
      case "verificar-chegada":
        return await verificarChegada(sb, body);
      case "alertar-mock":
        return await alertarMock(sb, body);
      default:
        return json({ error: `Acao desconhecida: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("gps-alertas error:", err);
    return json({ error: err.message }, 500);
  }
});
