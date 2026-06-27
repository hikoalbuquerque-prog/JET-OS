// functions/src/buscar-pois-osm.ts
// Cloud Function que move a query Overpass server-side para resolver CORS + 429
// Callable: buscarPOIsOSMFn({ lat, lng, raio, useGrid? })
//
// Patch frontend: ver comentário ao final do arquivo

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface POIInput { lat: number; lng: number; raio: number; useGrid?: boolean; }
interface POIResult {
  id: string; tipo: string; nome: string; lat: number; lng: number;
  distancia: number; tags: Record<string, string>;
}

// ─── Query Overpass (mesma lógica do App.tsx buildOverpassQuery) ──────────────

function buildOverpassQuery(lat: number, lng: number, raio: number): string {
  const c = `${lat},${lng}`;
  const r = String(Math.round(raio * 1000)); // km → metros
  return `[out:json][timeout:30];(`
    + `node["railway"~"subway_entrance|station|tram_stop"](around:${r},${c});`
    + `node["highway"~"bus_stop|crossing|traffic_signals"](around:${r},${c});`
    + `node["amenity"~"bus_station|ferry_terminal|taxi"](around:${r},${c});`
    + `node["amenity"~"restaurant|cafe|fast_food|bar|pub|nightclub|food_court|ice_cream|bakery"](around:${r},${c});`
    + `node["amenity"~"pharmacy|hospital|clinic|dentist|veterinary|doctors"](around:${r},${c});`
    + `node["amenity"~"school|university|college|kindergarten|library"](around:${r},${c});`
    + `node["amenity"~"bank|atm|money_transfer"](around:${r},${c});`
    + `node["amenity"~"police|fire_station|post_office|townhall|courthouse|embassy"](around:${r},${c});`
    + `node["leisure"~"park|fitness_centre|sports_centre|stadium|swimming_pool|playground"](around:${r},${c});`
    + `node["amenity"~"cinema|theatre|arts_centre|casino"](around:${r},${c});`
    + `node["shop"~"mall|supermarket|convenience|clothes|electronics|hairdresser|beauty|hardware"](around:${r},${c});`
    + `node["tourism"~"hotel|hostel|motel|museum|attraction|viewpoint|information"](around:${r},${c});`
    + `node["amenity"~"parking|fuel|charging_station|bicycle_parking|car_wash"](around:${r},${c});`
    + `node["amenity"~"recycling|drinking_water|toilets"](around:${r},${c});`
    + `node["amenity"~"place_of_worship"](around:${r},${c});`
    + `way["amenity"~"hospital|university|school|park|cinema|stadium"](around:${r},${c});`
    + `);out center qt 600;`;
}

// ─── Parser (mesma lógica do App.tsx parseOverpassElements) ──────────────────

const TIPO_MAP: Record<string, string> = {
  subway_entrance:'subway_entrance', station:'station', tram_stop:'station',
  bus_stop:'bus_stop', bus_station:'bus_station', ferry_terminal:'station', taxi:'taxi',
  crossing:'faixa_pedestre', traffic_signals:'semaforo',
  restaurant:'restaurant', cafe:'cafe', fast_food:'fast_food', bar:'bar', pub:'bar',
  nightclub:'balada', food_court:'restaurant', ice_cream:'cafe', bakery:'bakery',
  pharmacy:'pharmacy', hospital:'hospital', clinic:'clinic', dentist:'clinic',
  veterinary:'veterinary', doctors:'clinic',
  school:'school', university:'university', college:'university',
  kindergarten:'school', library:'library',
  bank:'bank', atm:'bank', money_transfer:'bank',
  police:'police', fire_station:'police', post_office:'post_office',
  townhall:'governo', courthouse:'governo', embassy:'governo',
  park:'park', fitness_centre:'fitness_centre', sports_centre:'fitness_centre',
  stadium:'stadium', swimming_pool:'fitness_centre', playground:'park',
  cinema:'cinema', theatre:'theatre', arts_centre:'theatre', casino:'entretenimento',
  mall:'mall', supermarket:'supermarket', convenience:'convenience',
  clothes:'shopping', electronics:'shopping', hairdresser:'servicos',
  beauty:'servicos', hardware:'shopping',
  hotel:'hotel', hostel:'hotel', motel:'hotel', museum:'museum',
  attraction:'attraction', viewpoint:'viewpoint', information:'attraction',
  parking:'parking', fuel:'fuel', charging_station:'charging_station',
  bicycle_parking:'parking', car_wash:'servicos',
  recycling:'servicos', drinking_water:'servicos', toilets:'servicos',
  place_of_worship:'religioso',
};

function distMetros(la1: number, ln1: number, la2: number, ln2: number): number {
  const R = 6371000;
  const dL = (la2 - la1) * Math.PI / 180;
  const dN = (ln2 - ln1) * Math.PI / 180;
  const a = Math.sin(dL/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dN/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function parseOverpassElements(elements: any[], refLat: number, refLng: number): POIResult[] {
  const seen = new Set<string>();
  const result: POIResult[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;
    const tags = el.tags || {};
    const nome = tags.name || tags['name:pt'] || '';
    if (!nome) continue;
    const key = `${nome}_${Math.round(lat * 1000)}_${Math.round(lng * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Determinar tipo
    const allVals = [
      ...Object.values(tags).flatMap((v: any) => String(v).split(';').map((s: string) => s.trim())),
    ];
    const tipo = allVals.reduce<string>((t, v) => t || TIPO_MAP[v] || '', '') || 'outro';
    result.push({
      id: `${el.type}-${el.id}`,
      tipo,
      nome,
      lat,
      lng,
      distancia: distMetros(refLat, refLng, lat, lng),
      tags: Object.fromEntries(Object.entries(tags).slice(0, 10).map(([k,v]) => [k, String(v)])) as Record<string, string>,
    });
  }
  return result.sort((a, b) => a.distancia - b.distancia);
}

// ─── Servidor Overpass com retry e fallback ───────────────────────────────────

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function queryOverpass(query: string): Promise<any[]> {
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) {
        console.warn(`[OSM] 429 em ${url} — tentando próximo mirror`);
        continue;
      }
      if (!res.ok) continue;
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      console.warn(`[OSM] Falha em ${url}:`, e);
      continue;
    }
  }
  throw new Error('Todos os mirrors Overpass falharam');
}

// ─── Callable principal ───────────────────────────────────────────────────────

export const buscarPOIsOSMFn = functions.https.onCall(
  {
    region: 'southamerica-east1',
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 10,
  },
  async (request) => {
    const { lat, lng, raio = 2, useGrid = false } = request.data as POIInput;

    if (!lat || !lng) return { ok: false, erro: 'lat/lng obrigatórios', pois: [] };

    let allPois: POIResult[] = [];

    if (useGrid && raio > 3) {
      // Grid de pontos para cobrir área maior sem timeout
      const offsets = [
        [0, 0],
        [raio * 0.5 / 111, 0], [-raio * 0.5 / 111, 0],
        [0, raio * 0.5 / (111 * Math.cos(lat * Math.PI / 180))],
        [0, -raio * 0.5 / (111 * Math.cos(lat * Math.PI / 180))],
      ];
      const raioGrid = raio * 0.65;
      for (const [dlat, dlng] of offsets) {
        try {
          const q = buildOverpassQuery(lat + dlat, lng + dlng, raioGrid);
          const elements = await queryOverpass(q);
          const pois = parseOverpassElements(elements, lat, lng);
          allPois.push(...pois);
        } catch (e) {
          console.warn('[OSM] Grid point falhou:', e);
        }
      }
      // Deduplicar por nome+posição
      const seen = new Set<string>();
      allPois = allPois.filter(p => {
        const k = `${p.nome}_${Math.round(p.lat * 1000)}_${Math.round(p.lng * 1000)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } else {
      const query = buildOverpassQuery(lat, lng, raio);
      const elements = await queryOverpass(query);
      allPois = parseOverpassElements(elements, lat, lng);
    }

    return {
      ok: true,
      pois: allPois.slice(0, 600),
      total: allPois.length,
    };
  }
);

/*
──────────────────────────────────────────────────────────────────────────────
PATCH App.tsx — substituir chamada cliente pelo fnBuscarPOIsOSMFn

No arquivo lib/firebase.ts, adicionar:
  export const fnBuscarPOIsOSM = () => httpsCallable(fns, 'buscarPOIsOSMFn');

No App.tsx, na função buscarOSM (dentro do FAB 📍 OSM), substituir:
  // ANTES:
  const res = await fetch('https://overpass-api.de/api/interpreter', { ... })
  // DEPOIS:
  const { fnBuscarPOIsOSM } = await import('./lib/firebase');
  const res = await fnBuscarPOIsOSM()({ lat: c.lat, lng: c.lng, raio: raioKm, useGrid: zoom < 13 }) as any;
  const resultado = res.data?.pois || [];
  if (!resultado.length) showToast('Nenhum POI OSM encontrado', 'info');
  else { setPoiLayerData(resultado); showToast(`${resultado.length} POIs`, 'success'); }

Para o botão POI Google (linha ~2870), também substituir:
  const res = await fnBuscarPOIsOSM()({ lat: c.lat, lng: c.lng, raio: raioKm, useGrid: zoom < 13 }) as any;
  const resultado = res.data?.pois || [];
  setPoiGoogleDados(resultado);
──────────────────────────────────────────────────────────────────────────────
*/
