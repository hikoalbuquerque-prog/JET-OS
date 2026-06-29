// ============================================================================
// JET OS — Edge Function: validar-bike
// Validates a bike the scout is about to pick up.
// Checks: exists in GoJet? status? GPS proximity? battery?
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOJET_BASE = "https://logistic.gojet.app/api/v0";

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

// T3: In-memory rate limiter (10 req/min per uid)
const rateBuckets = new Map<string, number[]>();
function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const window = 60_000;
  const max = 10;
  let timestamps = rateBuckets.get(uid) ?? [];
  timestamps = timestamps.filter(t => now - t < window);
  if (timestamps.length >= max) return false;
  timestamps.push(now);
  rateBuckets.set(uid, timestamps);
  return true;
}

async function gojetGet(path: string): Promise<any> {
  const res = await fetch(`${GOJET_BASE}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "JetOS/1.0" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GoJet ${path}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`GoJet ${path}: invalid JSON — ${text.slice(0, 200)}`); }
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const { tarefa_id, bike_id, gps_scout, uid } = body;

    if (!bike_id) return json({ error: "bike_id required" }, 400);

    // T3: Rate limiting
    const callerUid = uid || tarefa_id || req.headers.get("x-forwarded-for") || "anon";
    if (!checkRateLimit(callerUid)) {
      return json({ error: "Rate limit exceeded (10 req/min)", valido: false, motivo: "rate_limit" }, 429);
    }

    const admin = sb();
    let bikeData: any = null;
    let bikeFound = false;
    let bikeStatus = "";
    let bikeBattery: number | null = null;
    let bikeGps: { lat: number; lon: number } | null = null;

    // Fetch bike from GoJet
    try {
      const bikes = await gojetGet(`/urent/bikes?identifier=${bike_id}`);
      if (Array.isArray(bikes) && bikes.length > 0) {
        bikeData = bikes[0];
        bikeFound = true;
        bikeStatus = bikeData.status || "";
        bikeBattery = bikeData.battery_level ?? bikeData.battery ?? null;
        if (bikeData.lat && bikeData.lon) {
          bikeGps = { lat: bikeData.lat, lon: bikeData.lon };
        } else if (bikeData.location) {
          bikeGps = {
            lat: bikeData.location.lat ?? bikeData.location.latitude,
            lon: bikeData.location.lon ?? bikeData.location.lng ?? bikeData.location.longitude,
          };
        }
      }
    } catch (e: any) {
      console.error("GoJet bike lookup failed, trying cache:", e.message);
      // T3: Fallback to cached bikes table
      try {
        const { data: cached } = await admin
          .from("bikes")
          .select("dados")
          .eq("dados->>identifier", bike_id)
          .limit(1)
          .maybeSingle();
        if (cached?.dados) {
          bikeData = cached.dados;
          bikeFound = true;
          bikeStatus = bikeData.status || "";
          bikeBattery = bikeData.battery_percent ?? bikeData.battery_level ?? null;
          if (bikeData.latitude && bikeData.longitude) {
            bikeGps = { lat: bikeData.latitude, lon: bikeData.longitude };
          }
        }
      } catch { /* cache also failed */ }
    }

    // Validate
    let valido = true;
    let motivo = "ok";
    let detalhes: Record<string, any> = {};

    if (!bikeFound) {
      valido = false;
      motivo = "fantasma";
      detalhes = { bike_id, msg: "Bike não encontrada na API GoJet" };
    } else if (bikeStatus === "renting" || bikeStatus === "reserved") {
      valido = false;
      motivo = "alugada";
      detalhes = { bike_id, status: bikeStatus, msg: "Bike está alugada/reservada" };
    } else if (bikeBattery !== null && bikeBattery === 0) {
      valido = false;
      motivo = "battery_0";
      detalhes = { bike_id, battery: bikeBattery, msg: "Bateria 0% — risco de perda" };
    } else {
      // GPS proximity check
      if (gps_scout && bikeGps) {
        const dist = haversineM(gps_scout.lat, gps_scout.lon, bikeGps.lat, bikeGps.lon);
        detalhes.distancia_m = Math.round(dist);
        detalhes.gps_scout = gps_scout;
        detalhes.gps_bike = bikeGps;
        if (dist > 500) {
          valido = false;
          motivo = "gps_diverge";
          detalhes.msg = `Scout está a ${Math.round(dist)}m da bike (máx 500m)`;
        }
      }

      // Battery warning (not blocking, just flag)
      if (bikeBattery !== null && bikeBattery <= 5) {
        detalhes.battery_warning = true;
        detalhes.battery = bikeBattery;
      }
    }

    if (valido) {
      detalhes.battery = bikeBattery;
      detalhes.status_gojet = bikeStatus;
    }

    // Log validation
    await admin.from("bike_validation_log").insert({
      tarefa_id: tarefa_id || null,
      uid_scout: null, // set by caller if needed
      bike_id,
      tipo: motivo,
      detalhes,
    });

    // If valid and tarefa_id provided, update bike_id_atual
    if (valido && tarefa_id) {
      await admin.from("tarefas_logistica").update({
        bike_id_atual: bike_id,
      }).eq("id", tarefa_id);
    }

    // Audit log
    await admin.from("audit_log").insert({
      entidade: "bike",
      entidade_id: bike_id,
      acao: "validar",
      dados: { tarefa_id, motivo, valido, detalhes },
    });

    return json({ valido, motivo, detalhes });
  } catch (e: any) {
    console.error("validar-bike error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
