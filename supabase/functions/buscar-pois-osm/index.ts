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

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const OSM_TYPE_MAP: Record<string, string> = {
  subway_entrance: "Metro",
  bus_stop: "Ponto de onibus",
  hospital: "Hospital",
  clinic: "Clinica",
  pharmacy: "Farmacia",
  restaurant: "Restaurante",
  fast_food: "Fast Food",
  cafe: "Cafe",
  school: "Escola",
  university: "Universidade",
  park: "Parque",
  bank: "Banco",
  supermarket: "Supermercado",
  convenience: "Conveniencia",
  parking: "Estacionamento",
  fuel: "Posto de combustivel",
  police: "Policia",
  fire_station: "Bombeiros",
  place_of_worship: "Templo religioso",
  library: "Biblioteca",
  cinema: "Cinema",
  theatre: "Teatro",
  hotel: "Hotel",
  hostel: "Hostel",
  museum: "Museu",
  marketplace: "Feira/Mercado",
  dentist: "Dentista",
  veterinary: "Veterinario",
  kindergarten: "Creche",
  swimming_pool: "Piscina",
  sports_centre: "Centro esportivo",
  gym: "Academia",
  playground: "Playground",
  post_office: "Correios",
  atm: "Caixa eletronico",
};

function classifyOsmElement(tags: Record<string, string>): string {
  const amenity = tags.amenity;
  const leisure = tags.leisure;
  const shop = tags.shop;
  const tourism = tags.tourism;
  const railway = tags.railway;
  const highway = tags.highway;
  const public_transport = tags.public_transport;

  if (railway === "subway_entrance" || public_transport === "station")
    return OSM_TYPE_MAP.subway_entrance;
  if (highway === "bus_stop" || public_transport === "platform")
    return OSM_TYPE_MAP.bus_stop;

  if (amenity && OSM_TYPE_MAP[amenity]) return OSM_TYPE_MAP[amenity];
  if (leisure && OSM_TYPE_MAP[leisure]) return OSM_TYPE_MAP[leisure];
  if (shop && OSM_TYPE_MAP[shop]) return OSM_TYPE_MAP[shop];
  if (tourism && OSM_TYPE_MAP[tourism]) return OSM_TYPE_MAP[tourism];

  if (amenity) return amenity;
  if (leisure) return leisure;
  if (shop) return `Loja (${shop})`;
  if (tourism) return tourism;

  return "POI";
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildOverpassQuery(lat: number, lng: number, raio: number): string {
  return `[out:json][timeout:25];
(
  node["amenity"](around:${raio},${lat},${lng});
  node["leisure"](around:${raio},${lat},${lng});
  node["shop"](around:${raio},${lat},${lng});
  node["tourism"](around:${raio},${lat},${lng});
  node["railway"="subway_entrance"](around:${raio},${lat},${lng});
  node["highway"="bus_stop"](around:${raio},${lat},${lng});
  node["public_transport"](around:${raio},${lat},${lng});
);
out body;`;
}

function gridPoints(
  lat: number,
  lng: number,
  raio: number,
): Array<{ lat: number; lng: number; r: number }> {
  const offset = raio / 111320 / 2;
  return [
    { lat, lng, r: raio / 2 },
    { lat: lat + offset, lng, r: raio / 2 },
    { lat: lat - offset, lng, r: raio / 2 },
    { lat, lng: lng + offset, r: raio / 2 },
    { lat, lng: lng - offset, r: raio / 2 },
  ];
}

async function queryOverpass(query: string): Promise<any> {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return await res.json();
    } catch {
      continue;
    }
  }
  throw new Error("All Overpass mirrors failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { lat, lng, raio = 2000, tipos } = await req.json();
    if (!lat || !lng) return json({ error: "lat e lng obrigatorios" }, 400);

    const useGrid = raio > 3000;
    const points = useGrid
      ? gridPoints(lat, lng, raio)
      : [{ lat, lng, r: raio }];

    const allElements: any[] = [];
    for (const p of points) {
      const query = buildOverpassQuery(p.lat, p.lng, p.r);
      const data = await queryOverpass(query);
      if (data.elements) allElements.push(...data.elements);
    }

    const seen = new Set<string>();
    const pois: Array<{
      name: string;
      type: string;
      lat: number;
      lon: number;
      distance: number;
    }> = [];

    for (const el of allElements) {
      if (!el.tags || !el.lat || !el.lon) continue;
      const name = el.tags.name || el.tags["name:pt"] || "";
      if (!name) continue;

      const type = classifyOsmElement(el.tags);
      if (tipos && tipos.length > 0) {
        const lower = type.toLowerCase();
        if (!tipos.some((t: string) => lower.includes(t.toLowerCase())))
          continue;
      }

      const key = `${name.toLowerCase()}|${type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const distance = Math.round(haversineMeters(lat, lng, el.lat, el.lon));
      pois.push({ name, type, lat: el.lat, lon: el.lon, distance });
    }

    pois.sort((a, b) => a.distance - b.distance);
    return json({ pois: pois.slice(0, 600) });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
