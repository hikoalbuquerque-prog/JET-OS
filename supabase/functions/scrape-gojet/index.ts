// ============================================================================
// JET OS — Edge Function: scrape-gojet (porte do scraperGoJet)
// Busca parkings+bikes da API GoJet (paginado) e grava no Postgres como LINHAS:
//   • upsert em parkings (estado atual)  • upsert em bikes (estado atual)
//   • append em parking_history (bikes_disponiveis por bucket de 15min)
// Sem o "chunking" do Firestore — tabelas relacionais resolvem.
//
// Cidades: lidas de gojet_config (ativo=true). Filtro opcional por city_id no body.
// Secrets: GOJET_PROXY_URL (recomendado, contorna Cloudflare) — senão usa a API direta.
//   supabase secrets set GOJET_PROXY_URL=https://<seu-proxy>/api/gojet
// Agendar via pg_cron (a cada 15min) chamando esta função com service_role.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROXY = Deno.env.get("GOJET_PROXY_URL") ?? "";
const BASE = PROXY || "https://logistic.gojet.app/api/v0/urent";
const PAGE_LIMIT = 500, MAX_PAGES = 50;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : null);
const pt = (lat: any, lng: any) =>
  (num(lat) !== null && num(lng) !== null) ? `SRID=4326;POINT(${lng} ${lat})` : null;

// classificação de bike (espelha classifyBikeServer do scraper Firebase)
function statusBike(b: any): string {
  if (b.disabled || b.service_mode) return "maintenance";
  if (b.booked) return "reserved";
  if (b.ordered) return "renting";
  if (typeof b.battery_percent === "number" && b.battery_percent < 0.2) return "low_battery";
  return "available";
}

// bucket de 15 min em ISO (para parking_history)
function bucket15(nowMs: number): string {
  const q = 15 * 60 * 1000;
  return new Date(Math.floor(nowMs / q) * q).toISOString();
}

async function fetchAllPages(kind: "parkings" | "bikes", cityId: string): Promise<any[]> {
  const out: any[] = [];
  let cookie = "";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BASE}/${kind}?city_id=${encodeURIComponent(cityId)}&page=${page}&limit=${PAGE_LIMIT}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36",
        "Accept": "application/json",
        ...(cookie ? { "Cookie": cookie } : {}),
      },
    });
    if (!res.ok) throw new Error(`${kind} p${page} HTTP ${res.status}`);
    const sc = res.headers.get("set-cookie");
    if (sc && !cookie) { const m = sc.match(/AWSALB=[^;]+/); if (m) cookie = m[0]; }
    const data = await res.json();
    const items = data?.entries ?? data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
    out.push(...items);
    const totalPages = data?.total_pages ?? data?.totalPages ?? data?.meta?.total_pages ?? 1;
    if (page >= totalPages || items.length < PAGE_LIMIT) break;
  }
  return out;
}

async function coletarCidade(admin: any, cityId: string, cidade: string) {
  const [parkings, bikes] = await Promise.all([
    fetchAllPages("parkings", cityId),
    fetchAllPages("bikes", cityId),
  ]);
  const agora = new Date().toISOString();
  const bkt = bucket15(Date.parse(agora));

  // "disponíveis" não é campo cru do parking — calcula contando bikes com status
  // 'available' por parking_id (mesma definição do motor/analytics).
  const dispPorParking: Record<string, number> = {};
  for (const b of bikes) {
    if (b.parking_id && statusBike(b) === "available") {
      const k = String(b.parking_id);
      dispPorParking[k] = (dispPorParking[k] ?? 0) + 1;
    }
  }

  const pRows = parkings.map((p: any) => ({
    id: String(p.id), city_id: cityId, cidade,
    geo: pt(p.latitude, p.longitude), nome: p.name ?? null,
    bikes_total: num(p.bikes_count),
    bikes_disponiveis: dispPorParking[String(p.id)] ?? 0,
    dados: p, atualizado_em: agora,
  }));
  const bRows = bikes.map((b: any) => ({
    id: String(b.id), city_id: cityId, cidade,
    geo: pt(b.location_lat, b.location_lng), status: statusBike(b),
    bateria: typeof b.battery_percent === "number" ? Math.round(b.battery_percent * 100) : null,
    dados: b, atualizado_em: agora,
  }));
  const hRows = pRows
    .filter((r) => r.bikes_disponiveis !== null)
    .map((r) => ({ city_id: cityId, parking_id: r.id, bikes_disponiveis: r.bikes_disponiveis, bucket_ts: bkt }));

  const chunk = (a: any[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  for (const part of chunk(pRows)) { const { error } = await admin.from("parkings").upsert(part, { onConflict: "city_id,id" }); if (error) throw new Error("parkings: " + error.message); }
  for (const part of chunk(bRows)) { const { error } = await admin.from("bikes").upsert(part, { onConflict: "city_id,id" }); if (error) throw new Error("bikes: " + error.message); }
  for (const part of chunk(hRows)) { await admin.from("parking_history").upsert(part, { onConflict: "city_id,parking_id,bucket_ts", ignoreDuplicates: true }); }

  return { parkings: pRows.length, bikes: bRows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  let cidades: { cidade: string; city_id: string }[] = [];
  if (body?.city_id && body?.cidade) {
    cidades = [{ city_id: body.city_id, cidade: body.cidade }];
  } else {
    const { data, error } = await admin.from("gojet_config").select("cidade, city_id").eq("ativo", true);
    if (error) return json({ error: "gojet_config", detail: error.message }, 500);
    cidades = (data ?? []).filter((c: any) => c.city_id);
  }

  const resultado: Record<string, any> = {};
  for (const c of cidades) {
    try { resultado[c.cidade] = await coletarCidade(admin, c.city_id, c.cidade); }
    catch (e: any) { resultado[c.cidade] = { erro: String(e?.message ?? e) }; }
  }
  return json({ ok: true, cidades: cidades.length, resultado });
});
