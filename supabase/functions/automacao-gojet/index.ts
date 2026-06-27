// ============================================================================
// JET OS — Edge Function: automacao-gojet
// Accoes: scraper | scraper-manual
// Fetches GoJet parkings+bikes, upserts into gojet_snapshots, checks monitor_config
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROXY = Deno.env.get("GOJET_PROXY_URL") ?? "";
const GOJET_BASE = PROXY || "https://logistic.gojet.app/api/v0/urent";
const PAGE_SIZE = 500;
const MAX_PAGES = 50;
const CHUNK_SIZE = 3000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const sb = () => createClient(SUPABASE_URL, SERVICE);

// ---------------------------------------------------------------------------
// GoJet paginated fetcher with AWSALB cookie stickiness
// ---------------------------------------------------------------------------
async function fetchAllPages(kind: "parkings" | "bikes"): Promise<any[]> {
  const all: any[] = [];
  let cookie = "";

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${GOJET_BASE}/${kind}?page_number=${page}&page_size=${PAGE_SIZE}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (cookie) headers["Cookie"] = cookie;

    const res = await fetch(url, { headers });

    // Capture AWSALB sticky cookie
    const sc = res.headers.get("set-cookie");
    if (sc) {
      const m = sc.match(/AWSALB[^;]*/);
      if (m) cookie = m[0];
    }

    if (!res.ok) {
      console.error(`GoJet ${kind} page ${page} returned ${res.status}`);
      break;
    }

    const body = await res.json();
    const items = Array.isArray(body) ? body : body?.data ?? body?.items ?? [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Scraper core
// ---------------------------------------------------------------------------
async function runScraper(): Promise<Response> {
  const admin = sb();
  const now = new Date().toISOString();

  // Fetch parkings
  const parkings = await fetchAllPages("parkings");
  console.log(`Fetched ${parkings.length} parkings`);

  // Fetch bikes
  const bikes = await fetchAllPages("bikes");
  console.log(`Fetched ${bikes.length} bikes`);

  // Upsert parkings snapshot
  if (parkings.length <= CHUNK_SIZE) {
    await admin.from("gojet_snapshots").upsert({
      id: "latest_parkings",
      data: parkings,
      criado_em: now,
    });
  } else {
    // Chunk large datasets
    const chunks = Math.ceil(parkings.length / CHUNK_SIZE);
    // Delete old chunks first
    await admin
      .from("gojet_snapshots")
      .delete()
      .like("id", "latest_parkings%");

    for (let i = 0; i < chunks; i++) {
      const slice = parkings.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await admin.from("gojet_snapshots").upsert({
        id: i === 0 ? "latest_parkings" : `latest_parkings_${i}`,
        data: slice,
        criado_em: now,
      });
    }
  }

  // Upsert bikes snapshot
  if (bikes.length <= CHUNK_SIZE) {
    await admin.from("gojet_snapshots").upsert({
      id: "latest_bikes",
      data: bikes,
      criado_em: now,
    });
  } else {
    const chunks = Math.ceil(bikes.length / CHUNK_SIZE);
    await admin
      .from("gojet_snapshots")
      .delete()
      .like("id", "latest_bikes%");

    for (let i = 0; i < chunks; i++) {
      const slice = bikes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await admin.from("gojet_snapshots").upsert({
        id: i === 0 ? "latest_bikes" : `latest_bikes_${i}`,
        data: slice,
        criado_em: now,
      });
    }
  }

  // Check monitor_config for auto-task generation per city
  const { data: monitorConfigs } = await admin
    .from("monitor_config")
    .select("*")
    .eq("auto_tarefas", true);

  if (monitorConfigs && monitorConfigs.length > 0) {
    for (const cfg of monitorConfigs) {
      const cityId = cfg.cidade ?? cfg.city_id;
      if (!cityId) continue;

      // Filter parkings for this city
      const cityParkings = parkings.filter(
        (p: any) => String(p.city_id ?? p.cidade) === String(cityId)
      );

      // Find anomalies: zero bikes
      const zeroBike = cityParkings.filter(
        (p: any) => Number(p.available_bikes_count ?? 0) === 0
      );

      if (zeroBike.length > 0) {
        // Check for existing open tasks to dedup
        const { data: openTasks } = await admin
          .from("tarefas_logistica")
          .select("parking_id")
          .in("status", ["aberto", "em_andamento"])
          .eq("tipo", "zero_fill")
          .in(
            "parking_id",
            zeroBike.map((p: any) => String(p.id ?? p.parking_id))
          );

        const openIds = new Set((openTasks ?? []).map((t: any) => String(t.parking_id)));
        const newTasks = zeroBike
          .filter((p: any) => !openIds.has(String(p.id ?? p.parking_id)))
          .map((p: any) => ({
            parking_id: String(p.id ?? p.parking_id),
            nome_parking: p.name ?? p.nome ?? "",
            tipo: "zero_fill",
            prioridade: "alta",
            cidade: cityId,
            status: "aberto",
            descricao: `Auto: ${p.name ?? p.nome} com 0 bikes`,
            criado_em: now,
          }));

        if (newTasks.length > 0) {
          await admin.from("tarefas_logistica").insert(newTasks);
          console.log(`Auto-created ${newTasks.length} tasks for city ${cityId}`);
        }
      }
    }
  }

  return json({ ok: true, parkings: parkings.length, bikes: bikes.length });
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
      case "scraper":
      case "scraper-manual":
        return await runScraper();
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("automacao-gojet error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
