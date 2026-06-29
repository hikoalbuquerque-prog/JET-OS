// ============================================================================
// JET OS — Edge Function: sync-gojet-cities
// Actions: sync | import-zones | fetch-activity
// Syncs GoJet cities list → cidade_config, imports zones, fetches rental activity
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

// ---------------------------------------------------------------------------
// GoJet API helpers
// ---------------------------------------------------------------------------
async function gojetGet(path: string): Promise<any> {
  const res = await fetch(`${GOJET_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "JetOS/1.0",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GoJet ${path}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GoJet ${path}: invalid JSON — ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Action: sync — sync cities list from GoJet
// ---------------------------------------------------------------------------
async function syncCities(): Promise<Response> {
  const admin = sb();

  const cities = await gojetGet("/urent/cities");
  if (!Array.isArray(cities) || cities.length === 0) {
    return json({ error: "GoJet /cities returned empty" }, 502);
  }

  const { data: existing } = await admin
    .from("cidade_config")
    .select("id, nome, ativo")
    .neq("id", "_default");
  const existingIds = new Set((existing ?? []).map((c: any) => c.id));

  const novas: string[] = [];
  const now = new Date().toISOString();

  for (const c of cities) {
    const id = c._id || c.id;
    const nome = c.name;
    const tz = c.timezone || "America/Sao_Paulo";

    if (existingIds.has(id)) {
      await admin
        .from("cidade_config")
        .update({ nome, timezone: tz, gojet_removida: false, ultima_sync: now })
        .eq("id", id);
      existingIds.delete(id);
    } else {
      await admin.from("cidade_config").upsert({
        id,
        nome,
        timezone: tz,
        ativo: false,
        gojet_removida: false,
        ultima_sync: now,
      });
      novas.push(nome);
    }
  }

  // Mark cities no longer in GoJet
  for (const orphanId of existingIds) {
    await admin
      .from("cidade_config")
      .update({ gojet_removida: true, ultima_sync: now })
      .eq("id", orphanId);
  }

  // Notify admin via Telegram if new cities found
  if (novas.length > 0 && TELEGRAM_BOT && TELEGRAM_ADMIN_CHAT) {
    const msg = `🆕 ${novas.length} nova(s) cidade(s) no GoJet:\n${novas.join(", ")}\n\nAbra Configurações → Cidades para ativar.`;
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_CHAT,
          text: msg,
          parse_mode: "HTML",
        }),
      }
    ).catch(() => {});
  }

  // Count zones for each active city
  const { data: activeCities } = await admin
    .from("cidade_config")
    .select("id, nome")
    .eq("ativo", true);

  for (const ac of activeCities ?? []) {
    try {
      const zones = await gojetGet(`/urent/techzones?city_id=${ac.id}`);
      const zoneCount = Array.isArray(zones) ? zones.length : 0;
      await admin
        .from("cidade_config")
        .update({ total_zones: zoneCount })
        .eq("id", ac.id);
    } catch {}
  }

  return json({
    ok: true,
    total: cities.length,
    novas: novas.length,
    novasNomes: novas,
    removidas: existingIds.size,
  });
}

// ---------------------------------------------------------------------------
// Action: import-zones — import GoJet techzones for a city
// ---------------------------------------------------------------------------
async function importZones(cityId: string): Promise<Response> {
  if (!cityId) return json({ error: "city_id required" }, 400);

  const admin = sb();
  const zones = await gojetGet(`/urent/techzones?city_id=${cityId}`);

  if (!Array.isArray(zones) || zones.length === 0) {
    // No zones — create _default zone
    const { data: city } = await admin
      .from("cidade_config")
      .select("nome")
      .eq("id", cityId)
      .single();

    const defaultZone = {
      name: `${city?.nome ?? cityId} (toda a cidade)`,
      city: cityId,
      geometry: { type: "Polygon", coordinates: [[]] },
      gojet_zone_id: null,
      notes: "Zona padrão — cidade sem zonas no GoJet",
    };

    await admin.from("zones").upsert(defaultZone, {
      onConflict: "city,name",
    });

    await admin
      .from("cidade_config")
      .update({ zonas_importadas: true, total_zones: 0 })
      .eq("id", cityId);

    return json({ ok: true, imported: 0, defaultCreated: true });
  }

  let imported = 0;
  const errors: any[] = [];
  for (const z of zones) {
    const zoneId = z._id || z.id;
    try {
      const detail = await gojetGet(`/urent/techzones/${zoneId}`);
      const coords = (detail.coordinates || []).map((p: any) => [
        p.lon ?? p.lng ?? p.longitude,
        p.lat ?? p.latitude,
      ]);
      // Close the polygon ring
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
        coords.push(coords[0]);
      }

      const geometry = {
        type: "Polygon",
        coordinates: [coords],
      };

      const { error } = await admin.from("zones").upsert(
        {
          name: detail.name || z.name,
          city: cityId,
          geometry,
          gojet_zone_id: zoneId,
        },
        { onConflict: "city,gojet_zone_id" }
      );
      if (error) {
        console.error(`Upsert zone ${zoneId} error:`, error);
        errors.push({ zoneId, type: "upsert", msg: error.message });
      } else {
        imported++;
      }
    } catch (e: any) {
      console.error(`Failed to import zone ${zoneId}:`, e);
      errors.push({ zoneId, type: "fetch", msg: e.message ?? String(e) });
    }
  }

  await admin
    .from("cidade_config")
    .update({ zonas_importadas: true, total_zones: imported })
    .eq("id", cityId);

  return json({ ok: true, imported, total: zones.length, errors: errors.length > 0 ? errors : undefined });
}

// ---------------------------------------------------------------------------
// Action: fetch-activity — fetch rental activity from GoJet ML API
// ---------------------------------------------------------------------------
async function fetchActivity(
  cityId: string,
  date?: string
): Promise<Response> {
  if (!cityId) return json({ error: "city_id required" }, 400);

  const admin = sb();
  const targetDate = date || new Date().toISOString().slice(0, 10);

  // Get zones for this city
  const { data: zones } = await admin
    .from("zones")
    .select("id, gojet_zone_id")
    .eq("city", cityId)
    .not("gojet_zone_id", "is", null);

  if (!zones || zones.length === 0) {
    return json({ error: "No zones with gojet_zone_id for this city" }, 400);
  }

  // Optimize: only fetch last N hours (default 4) to avoid resource limits
  // For SP with 10 zones: 10×4=40 requests instead of 10×24=240
  const hoursBack = Math.min(parseInt(String(date ? 24 : 4)), 24);
  const currentHour = new Date().getUTCHours();
  let totalInserted = 0;
  let errors = 0;

  for (const zone of zones) {
    const isToday = targetDate === new Date().toISOString().slice(0, 10);
    const endHour = isToday ? currentHour + 1 : 24;
    const startHour = Math.max(0, endHour - hoursBack);

    for (let h = startHour; h < endHour; h++) {
      const start = `${targetDate}T${String(h).padStart(2, "0")}:00:00`;
      const end = `${targetDate}T${String(h).padStart(2, "0")}:59:59`;

      try {
        const data = await gojetGet(
          `/ml/techzones/${zone.gojet_zone_id}/activity?start=${start}&end=${end}`
        );

        if (!Array.isArray(data)) continue;

        const hora = new Date(`${start}Z`).toISOString();
        const rows = data
          .filter((d: any) => d.starts > 0 || d.finishes > 0)
          .map((d: any) => ({
            parking_id: d.parking_id,
            cidade_id: cityId,
            zona_id: zone.gojet_zone_id,
            starts: d.starts || 0,
            finishes: d.finishes || 0,
            hora,
            fonte: "gojet_ml",
          }));

        if (rows.length > 0) {
          const { error } = await admin
            .from("parking_history")
            .upsert(rows, { onConflict: "parking_id,hora,fonte" });
          if (!error) totalInserted += rows.length;
        }

        // Rate limit protection: 200ms delay between requests
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        errors++;
        console.error(`Activity fetch failed zone=${zone.gojet_zone_id} h=${h}:`, e);
        if (errors > 10) break; // bail out if too many errors (Cloudflare block)
      }
    }
    if (errors > 10) break;
  }

  return json({ ok: true, date: targetDate, hours: hoursBack, inserted: totalInserted, errors });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "";

    switch (action) {
      case "sync":
        return await syncCities();
      case "import-zones":
        return await importZones(body.city_id);
      case "fetch-activity":
        return await fetchActivity(body.city_id, body.date);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("sync-gojet-cities error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
