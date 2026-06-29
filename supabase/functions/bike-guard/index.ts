// ============================================================================
// JET OS — Edge Function: bike-guard
// Cron watcher (5min): monitors bikes in transit for rental/loss/GPS issues.
// Also monitors battery 0%/5% for all bikes in active cities.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOJET_BASE = "https://logistic.gojet.app/api/v0";
const TELEGRAM_BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_ADMIN_CHAT = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const sb = () => createClient(SUPABASE_URL, SERVICE);

async function gojetGet(path: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${GOJET_BASE}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "JetOS/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GoJet ${path}: HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error(`GoJet ${path}: invalid JSON`); }
  } finally {
    clearTimeout(timeout);
  }
}

// T2: Try GoJet API, fall back to cached bikes table data
async function gojetGetWithFallback(
  path: string,
  bikeIdentifier: string,
  admin: ReturnType<typeof sb>,
): Promise<{ data: any; source: "api" | "cache" }> {
  try {
    const data = await gojetGet(path);
    return { data, source: "api" };
  } catch (e) {
    console.warn(`GoJet API failed, falling back to cache for ${bikeIdentifier}:`, (e as Error).message);
    const { data: cached } = await admin
      .from("bikes")
      .select("dados")
      .eq("dados->>identifier", bikeIdentifier)
      .limit(1)
      .maybeSingle();
    if (cached?.dados) {
      return { data: [cached.dados], source: "cache" };
    }
    throw e;
  }
}

// T2: Update gojet_api_status on cidade_config
async function updateApiStatus(admin: ReturnType<typeof sb>, status: "ok" | "degraded" | "down") {
  const update: any = { gojet_api_status: status };
  if (status === "ok") update.gojet_api_last_ok = new Date().toISOString();
  await admin.from("cidade_config").update(update).eq("ativo", true);
}

async function telegramAlert(msg: string) {
  if (!TELEGRAM_BOT || !TELEGRAM_ADMIN_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text: msg, parse_mode: "HTML" }),
  }).catch(() => {});
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Check bikes in transit (tarefas em andamento)
// ---------------------------------------------------------------------------
async function checkBikesInTransit(admin: ReturnType<typeof sb>): Promise<any[]> {
  const alerts: any[] = [];

  const { data: tarefas } = await admin
    .from("tarefas_logistica")
    .select("id, bike_id_atual, assignee_uid, tipo, created_at")
    .eq("status", "em_andamento")
    .not("bike_id_atual", "is", null);

  if (!tarefas || tarefas.length === 0) return alerts;

  let apiOkCount = 0, apiFailCount = 0;

  for (const t of tarefas) {
    try {
      const { data: bikes, source } = await gojetGetWithFallback(
        `/urent/bikes?identifier=${t.bike_id_atual}`,
        t.bike_id_atual,
        admin,
      );
      if (source === "api") apiOkCount++; else apiFailCount++;
      if (!Array.isArray(bikes) || bikes.length === 0) {
        alerts.push({ tarefa_id: t.id, bike_id: t.bike_id_atual, tipo: "fantasma" });
        await admin.from("bike_validation_log").insert({
          tarefa_id: t.id,
          uid_scout: t.assignee_uid,
          bike_id: t.bike_id_atual,
          tipo: "fantasma",
          detalhes: { source: "bike-guard", msg: "Bike not found during transit check" },
        });
        continue;
      }

      const bike = bikes[0];
      const status = bike.status || "";

      if (status === "renting" || status === "reserved") {
        alerts.push({ tarefa_id: t.id, bike_id: t.bike_id_atual, tipo: "alugada", status });
        await admin.from("bike_validation_log").insert({
          tarefa_id: t.id,
          uid_scout: t.assignee_uid,
          bike_id: t.bike_id_atual,
          tipo: "alugada",
          detalhes: { source: "bike-guard", status },
        });

        // Telegram alert
        await telegramAlert(
          `⚠️ <b>Bike Guard:</b> Bike <code>${t.bike_id_atual}</code> foi alugada durante transporte!\nTarefa: ${t.id}\nStatus GoJet: ${status}`
        );
      }

      // GPS divergence check
      if (t.assignee_uid) {
        const { data: scout } = await admin
          .from("usuarios")
          .select("ultima_pos")
          .eq("id", t.assignee_uid)
          .single();

        if (scout?.ultima_pos && bike.lat && bike.lon) {
          const scoutPos = scout.ultima_pos;
          const dist = haversineM(
            scoutPos.lat ?? scoutPos.latitude,
            scoutPos.lon ?? scoutPos.lng ?? scoutPos.longitude,
            bike.lat, bike.lon
          );
          const taskAgeMin = (Date.now() - new Date(t.created_at).getTime()) / 60000;

          if (dist > 500 && taskAgeMin > 10) {
            alerts.push({ tarefa_id: t.id, bike_id: t.bike_id_atual, tipo: "gps_diverge", distancia_m: Math.round(dist) });
            await admin.from("bike_validation_log").insert({
              tarefa_id: t.id,
              uid_scout: t.assignee_uid,
              bike_id: t.bike_id_atual,
              tipo: "gps_diverge",
              detalhes: { source: "bike-guard", distancia_m: Math.round(dist), gps_scout: scoutPos, gps_bike: { lat: bike.lat, lon: bike.lon } },
            });
          }
        }
      }
    } catch (e: any) {
      apiFailCount++;
      console.error(`bike-guard transit check failed for ${t.bike_id_atual}:`, e.message);
    }
  }

  // T2: Update API health status
  const total = apiOkCount + apiFailCount;
  if (total > 0) {
    const status = apiFailCount === 0 ? "ok" : apiOkCount === 0 ? "down" : "degraded";
    await updateApiStatus(admin, status).catch(() => {});
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Check battery critical (0% and 5%) across active cities
// ---------------------------------------------------------------------------
async function checkBatteryCritical(admin: ReturnType<typeof sb>): Promise<any[]> {
  const alerts: any[] = [];

  // Get latest GoJet snapshots with low battery
  const { data: snapshots } = await admin
    .from("gojet_snapshots")
    .select("parking_id, cidade, bike_identifier, battery_level, lat, lon")
    .lte("battery_level", 5)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!snapshots || snapshots.length === 0) return alerts;

  // Dedup: check if alert already exists for this bike in last 24h
  const bikeIds = [...new Set(snapshots.map(s => s.bike_identifier))];
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await admin
    .from("bike_validation_log")
    .select("bike_id")
    .in("bike_id", bikeIds)
    .in("tipo", ["battery_0", "battery_5"])
    .gte("criado_em", oneDayAgo);
  const alreadyAlerted = new Set((existing ?? []).map(e => e.bike_id));

  for (const s of snapshots) {
    if (!s.bike_identifier || alreadyAlerted.has(s.bike_identifier)) continue;
    alreadyAlerted.add(s.bike_identifier);

    const tipo = s.battery_level === 0 ? "battery_0" : "battery_5";
    alerts.push({
      bike_id: s.bike_identifier,
      tipo,
      battery: s.battery_level,
      cidade: s.cidade,
      parking_id: s.parking_id,
    });

    await admin.from("bike_validation_log").insert({
      bike_id: s.bike_identifier,
      tipo,
      detalhes: {
        source: "bike-guard",
        battery: s.battery_level,
        cidade: s.cidade,
        parking_id: s.parking_id,
        lat: s.lat,
        lon: s.lon,
      },
    });

    // Telegram for battery_0
    if (tipo === "battery_0") {
      await telegramAlert(
        `🔴 <b>Bateria 0%:</b> Bike <code>${s.bike_identifier}</code>\nCidade: ${s.cidade}\nPonto: ${s.parking_id}\n⚠️ Risco de perda de equipamento`
      );
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
// B5.1: Check bikes without movement >72h
async function checkBikesStale(admin: ReturnType<typeof sb>): Promise<any[]> {
  const alerts: any[] = [];
  try {
    const { data: stale } = await admin
      .from("v_bikes_stale")
      .select("bike_id, identifier, parking_id, battery_percent, city_id, horas_parado")
      .order("horas_parado", { ascending: false })
      .limit(20);

    if (!stale?.length) return [];

    // Dedup: only alert once per 24h per bike (check audit_log)
    const oneDayAgo = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: recentAlerts } = await admin
      .from("audit_log")
      .select("entidade_id")
      .eq("entidade", "bike_stale")
      .gte("criado_em", oneDayAgo);
    const alreadyAlerted = new Set((recentAlerts ?? []).map((a: any) => a.entidade_id));

    for (const b of stale) {
      if (alreadyAlerted.has(b.bike_id)) continue;

      const msg = `⚠️ Bike ${b.identifier || b.bike_id} sem movimento há ${Math.round(b.horas_parado)}h\nParking: ${b.parking_id}\nBateria: ${b.battery_percent ?? '?'}%`;

      if (TELEGRAM_BOT && TELEGRAM_ADMIN_CHAT) {
        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text: msg }),
          });
        } catch {}
      }

      await admin.from("audit_log").insert({
        entidade: "bike_stale",
        entidade_id: b.bike_id,
        acao: "alerta_72h",
        dados: { horas_parado: b.horas_parado, parking_id: b.parking_id, battery: b.battery_percent },
      });

      alerts.push({ bike_id: b.bike_id, horas: Math.round(b.horas_parado) });
    }
  } catch (e) {
    console.error("checkBikesStale error:", e);
  }
  return alerts;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = sb();
    const transitAlerts = await checkBikesInTransit(admin);
    const batteryAlerts = await checkBatteryCritical(admin);
    const staleAlerts = await checkBikesStale(admin);

    // Audit log
    if (transitAlerts.length > 0 || batteryAlerts.length > 0 || staleAlerts.length > 0) {
      await admin.from("audit_log").insert({
        entidade: "sistema",
        entidade_id: "bike-guard",
        acao: "alertar",
        dados: {
          transit: transitAlerts.length,
          battery: batteryAlerts.length,
          stale: staleAlerts.length,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return json({
      ok: true,
      transit_alerts: transitAlerts.length,
      battery_alerts: batteryAlerts.length,
      stale_alerts: staleAlerts.length,
      details: { transit: transitAlerts, battery: batteryAlerts, stale: staleAlerts },
    });
  } catch (e: any) {
    console.error("bike-guard error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
