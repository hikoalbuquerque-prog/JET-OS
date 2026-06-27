import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAPILLARY_TOKEN = Deno.env.get("MAPILLARY_TOKEN")!;
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
const sb = () => createClient(URL, SERVICE);

// Cost constants (USD estimates per request)
const CUSTO_POR_FONTE: Record<string, number> = {
  CACHE: 0,
  MAPILLARY: 0,
  GOOGLE_SV: 0.007,
  GOOGLE_SAT: 0.002,
};

// ---------------------------------------------------------------------------
// Upload image bytes to Supabase Storage and return public URL
// ---------------------------------------------------------------------------
async function uploadToStorage(
  supabase: ReturnType<typeof sb>,
  path: string,
  data: Uint8Array,
  contentType = "image/jpeg",
): Promise<string> {
  const { error } = await supabase.storage
    .from("uploads")
    .upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`Upload error: ${error.message}`);
  const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path);
  return urlData.publicUrl;
}

// ---------------------------------------------------------------------------
// Increment stats in config table
// ---------------------------------------------------------------------------
async function incrementStats(supabase: ReturnType<typeof sb>, fonte: string) {
  const { data: existing } = await supabase
    .from("config")
    .select("valor")
    .eq("id", "sv_stats")
    .maybeSingle();

  const stats = existing?.valor ?? {
    CACHE: { count: 0, custo: 0 },
    MAPILLARY: { count: 0, custo: 0 },
    GOOGLE_SV: { count: 0, custo: 0 },
    GOOGLE_SAT: { count: 0, custo: 0 },
  };

  if (!stats[fonte]) stats[fonte] = { count: 0, custo: 0 };
  stats[fonte].count += 1;
  stats[fonte].custo += CUSTO_POR_FONTE[fonte] ?? 0;

  await supabase
    .from("config")
    .upsert({ id: "sv_stats", valor: stats }, { onConflict: "id" });
}

// ---------------------------------------------------------------------------
// fetch: get street-level image with cascading sources
// ---------------------------------------------------------------------------
async function fetchStreetView(lat: number, lng: number, codigo?: string) {
  const supabase = sb();
  const cacheKey = `sv_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  const storagePath = `streetview/${cacheKey}.jpg`;

  // 1. Check cache in Storage
  const { data: cached } = await supabase.storage
    .from("uploads")
    .createSignedUrl(storagePath, 1); // just checking existence via signed URL
  if (cached?.signedUrl) {
    const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(storagePath);
    await incrementStats(supabase, "CACHE");
    return { url: urlData.publicUrl, fonte: "CACHE" };
  }

  // 2. Try Mapillary
  try {
    const bbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`;
    const mapRes = await fetch(
      `https://graph.mapillary.com/images?access_token=${MAPILLARY_TOKEN}&fields=id,thumb_256_url&bbox=${bbox}&limit=1`,
    );
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      if (mapData.data?.length > 0) {
        const thumbUrl = mapData.data[0].thumb_256_url;
        const imgRes = await fetch(thumbUrl);
        if (imgRes.ok) {
          const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
          const url = await uploadToStorage(supabase, storagePath, imgBytes);
          await incrementStats(supabase, "MAPILLARY");
          return { url, fonte: "MAPILLARY" };
        }
      }
    }
  } catch (_) { /* fall through */ }

  // 3. Try Google Street View
  try {
    const metaRes = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${GMAPS_KEY}`,
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.status === "OK") {
        const svRes = await fetch(
          `https://maps.googleapis.com/maps/api/streetview?size=320x240&location=${lat},${lng}&source=outdoor&key=${GMAPS_KEY}`,
        );
        if (svRes.ok) {
          const imgBytes = new Uint8Array(await svRes.arrayBuffer());
          const url = await uploadToStorage(supabase, storagePath, imgBytes);
          await incrementStats(supabase, "GOOGLE_SV");
          return { url, fonte: "GOOGLE_SV" };
        }
      }
    }
  } catch (_) { /* fall through */ }

  // 4. Fallback: Google Satellite
  try {
    const satRes = await fetch(
      `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=19&size=320x320&maptype=satellite&key=${GMAPS_KEY}`,
    );
    if (satRes.ok) {
      const imgBytes = new Uint8Array(await satRes.arrayBuffer());
      const url = await uploadToStorage(supabase, storagePath, imgBytes);
      await incrementStats(supabase, "GOOGLE_SAT");
      return { url, fonte: "GOOGLE_SAT" };
    }
  } catch (_) { /* fall through */ }

  return null;
}

// ---------------------------------------------------------------------------
// estatisticas: return aggregated stats
// ---------------------------------------------------------------------------
async function getEstatisticas() {
  const supabase = sb();
  const { data, error } = await supabase
    .from("config")
    .select("valor")
    .eq("id", "sv_stats")
    .maybeSingle();

  if (error) throw new Error(error.message);

  const stats = data?.valor ?? {
    CACHE: { count: 0, custo: 0 },
    MAPILLARY: { count: 0, custo: 0 },
    GOOGLE_SV: { count: 0, custo: 0 },
    GOOGLE_SAT: { count: 0, custo: 0 },
  };

  const custoTotal = Object.values(stats).reduce(
    (sum: number, s: any) => sum + (s.custo ?? 0),
    0,
  );

  return { ok: true, stats, custoTotal };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "fetch") {
      const { lat, lng, codigo } = body;
      if (lat == null || lng == null) return json({ error: "lat e lng obrigatórios" }, 400);
      const result = await fetchStreetView(Number(lat), Number(lng), codigo);
      return json(result !== null ? result : { url: null, fonte: null });
    }

    if (action === "estatisticas") {
      const result = await getEstatisticas();
      return json(result);
    }

    return json({ error: `action desconhecida: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
