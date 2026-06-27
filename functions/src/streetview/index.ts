// src/streetview/index.ts
import axios from 'axios';
import { storage } from '../utils';

const GMAPS_KEY       = process.env.GMAPS_KEY       || '';
const MAPILLARY_TOKEN = process.env.MAPILLARY_TOKEN || '';

// ── CONTADORES ───────────────────────────────────────────────────
const CUSTOS: Record<string, number> = {
  CACHE:       0.000,
  MAPILLARY:   0.000,
  GOOGLE_SV:   0.007,
  GOOGLE_SAT:  0.002,
};

async function incrementarContador(fonte: string) {
  try {
    const { getAppSetting, setAppSetting } = await import('../config-supabase');
    const current = await getAppSetting<Record<string, number>>('config_sv_stats') ?? {};
    const countKey = `count_${fonte}`;
    const custoKey = `custo_${fonte}`;
    await setAppSetting('config_sv_stats', {
      ...current,
      [countKey]: (current[countKey] || 0) + 1,
      [custoKey]: (current[custoKey] || 0) + (CUSTOS[fonte] || 0),
      atualizadoEm: new Date().toISOString(),
    });
  } catch (e) { /* silencioso */ }
}

// ── CACHE ────────────────────────────────────────────────────────
const CACHE_PRECISION = 4;

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(CACHE_PRECISION)}_${lng.toFixed(CACHE_PRECISION)}`;
}

async function buscarCache(key: string): Promise<Buffer | null> {
  try {
    const file = storage().bucket().file(`streetview/${key}.jpg`);
    const [existe] = await file.exists();
    if (!existe) return null;
    const [buffer] = await file.download();
    return buffer;
  } catch { return null; }
}

async function salvarCache(
  key: string, codigo: string, buffer: Buffer, fonte: string
): Promise<string> {
  const file = storage().bucket().file(`streetview/${key}.jpg`);
  await file.save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: { fonte, codigo, key }
    },
    public: true
  });
  return file.publicUrl();
}

// ── MAPILLARY ────────────────────────────────────────────────────
async function fetchMapillary(lat: number, lng: number): Promise<Buffer | null> {
  if (!MAPILLARY_TOKEN) return null;
  try {
    const delta = 0.0005;
    const bbox  = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
    const resp  = await axios.get('https://graph.mapillary.com/images', {
      params: {
        access_token: MAPILLARY_TOKEN,
        fields: 'id,thumb_256_url,computed_compass_angle',
        bbox,
        limit: 5
      },
      headers: { Authorization: `OAuth ${MAPILLARY_TOKEN}` },
      timeout: 8000
    });

    const images = resp.data?.data || [];
    if (!images.length) return null;

    const imgUrl = images[0].thumb_256_url;
    if (!imgUrl) return null;

    const imgResp = await axios.get(imgUrl, {
      responseType: 'arraybuffer',
      timeout: 8000
    });
    const buffer = Buffer.from(imgResp.data);
    return isJpeg(buffer) ? buffer : null;
  } catch { return null; }
}

async function fetchMapillaryFrame(
  lat: number, lng: number, heading: number
): Promise<Buffer | null> {
  if (!MAPILLARY_TOKEN) return null;
  try {
    const delta = 0.0005;
    const bbox  = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
    const resp  = await axios.get('https://graph.mapillary.com/images', {
      params: {
        access_token: MAPILLARY_TOKEN,
        fields: 'id,thumb_256_url,computed_compass_angle',
        bbox,
        limit: 10
      },
      headers: { Authorization: `OAuth ${MAPILLARY_TOKEN}` },
      timeout: 8000
    });

    const images: Array<{thumb_256_url: string; computed_compass_angle: number}>
      = resp.data?.data || [];
    if (!images.length) return null;

    // Encontra imagem com heading mais próximo
    const melhor = images.reduce((best, img) => {
      const diff     = Math.abs(((img.computed_compass_angle - heading + 540) % 360) - 180);
      const bestDiff = Math.abs(((best.computed_compass_angle - heading + 540) % 360) - 180);
      return diff < bestDiff ? img : best;
    });

    if (!melhor.thumb_256_url) return null;
    const imgResp = await axios.get(melhor.thumb_256_url, {
      responseType: 'arraybuffer', timeout: 8000
    });
    const buffer = Buffer.from(imgResp.data);
    return isJpeg(buffer) ? buffer : null;
  } catch { return null; }
}

// ── GOOGLE STREET VIEW ───────────────────────────────────────────
async function fetchGoogleSV(
  lat: number, lng: number,
  heading = 45, pitch = -8, fov = 90,
  size = '320x240'
): Promise<Buffer | null> {
  if (!GMAPS_KEY) return null;
  try {
    // Verifica metadata primeiro (evita cobrar ponto sem cobertura)
    const meta = await axios.get(
      'https://maps.googleapis.com/maps/api/streetview/metadata',
      { params: { location: `${lat},${lng}`, source: 'outdoor', key: GMAPS_KEY }, timeout: 5000 }
    );
    if (meta.data?.status !== 'OK') return null;

    const resp = await axios.get(
      'https://maps.googleapis.com/maps/api/streetview',
      {
        params: { size, location: `${lat},${lng}`, source: 'outdoor', heading, pitch, fov, key: GMAPS_KEY },
        responseType: 'arraybuffer',
        timeout: 10000
      }
    );
    const buffer = Buffer.from(resp.data);
    return isJpeg(buffer) ? buffer : null;
  } catch { return null; }
}

async function fetchGoogleSatelite(lat: number, lng: number): Promise<Buffer | null> {
  if (!GMAPS_KEY) return null;
  try {
    const resp = await axios.get(
      'https://maps.googleapis.com/maps/api/staticmap',
      {
        params: {
          center: `${lat},${lng}`,
          zoom: 19, size: '320x320', scale: 1,
          maptype: 'satellite', key: GMAPS_KEY
        },
        responseType: 'arraybuffer',
        timeout: 10000
      }
    );
    return Buffer.from(resp.data);
  } catch { return null; }
}

// ── HELPERS ──────────────────────────────────────────────────────
function isJpeg(buf: Buffer): boolean {
  return buf?.length > 500 && buf[0] === 0xFF && buf[1] === 0xD8;
}

// ── EXPORTS PÚBLICOS ─────────────────────────────────────────────

/**
 * fetchStreetViewCascata
 * Cache → Mapillary → Google SV → Google Satélite
 * Salva no Storage e retorna URL pública.
 */
export async function fetchStreetViewCascata(
  lat: number, lng: number, codigo: string
): Promise<{ url: string; fonte: string } | null> {
  const key = cacheKey(lat, lng);

  // 0. Cache
  const cached = await buscarCache(key);
  if (cached) {
    await incrementarContador('CACHE');
    const file = storage().bucket().file(`streetview/${key}.jpg`);
    return { url: file.publicUrl(), fonte: 'CACHE' };
  }

  let buffer: Buffer | null = null;
  let fonte = '';

  // 1. Mapillary
  buffer = await fetchMapillary(lat, lng);
  if (buffer) fonte = 'MAPILLARY';

  // 2. Google SV
  if (!buffer) {
    buffer = await fetchGoogleSV(lat, lng);
    if (buffer) fonte = 'GOOGLE_SV';
  }

  // 3. Google Satélite
  if (!buffer) {
    buffer = await fetchGoogleSatelite(lat, lng);
    if (buffer) fonte = 'GOOGLE_SAT';
  }

  if (!buffer) return null;

  await incrementarContador(fonte);
  const url = await salvarCache(key, codigo, buffer, fonte);
  return { url, fonte };
}

/**
 * fetchFramesParaIA
 * 3 frames para análise Gemini: Mapillary → Google SV → Google Satélite
 */
export async function fetchFramesParaIA(
  lat: number, lng: number
): Promise<Array<{ label: string; heading: number; buffer: Buffer }>> {
  const frames = [
    { heading: 45,  label: 'frente-45'  },
    { heading: 180, label: 'fundo-180'  },
    { heading: 315, label: 'lado-315'   },
  ];

  // Verifica disponibilidade SV
  let temSV = false;
  try {
    const meta = await axios.get(
      'https://maps.googleapis.com/maps/api/streetview/metadata',
      { params: { location: `${lat},${lng}`, source: 'outdoor', key: GMAPS_KEY }, timeout: 5000 }
    );
    temSV = meta.data?.status === 'OK';
  } catch { /* continua sem SV */ }

  if (!temSV) {
    // Sem SV — usa satélite como fallback para análise
    const sat = await fetchGoogleSatelite(lat, lng);
    if (sat) return [{ label: 'satelite', heading: 0, buffer: sat }];
    return [];
  }

  const out: Array<{ label: string; heading: number; buffer: Buffer }> = [];

  await Promise.all(frames.map(async (f) => {
    let buf: Buffer | null = null;

    // Mapillary (grátis)
    buf = await fetchMapillaryFrame(lat, lng, f.heading);
    if (buf) { await incrementarContador('MAPILLARY'); }

    // Google SV (pago)
    if (!buf) {
      buf = await fetchGoogleSV(lat, lng, f.heading, -8, 75, '320x240');
      if (buf) { await incrementarContador('GOOGLE_SV'); }
    }

    if (buf) out.push({ label: f.label, heading: f.heading, buffer: buf });
  }));

  return out;
}

/**
 * svGetEstatisticas
 * Retorna contadores e custo estimado do Firestore.
 */
export async function svGetEstatisticas() {
  const { getAppSetting } = await import('../config-supabase');
  const data = await getAppSetting<Record<string, number>>('config_sv_stats') ?? {};

  const fontes = Object.keys(CUSTOS);
  const stats: Record<string, { count: number; custo: number }> = {};
  let custoTotal = 0;

  for (const f of fontes) {
    const count = Number(data[`count_${f}`] || 0);
    const custo = count * CUSTOS[f];
    stats[f]    = { count, custo };
    custoTotal += custo;
  }

  return { ok: true, stats, custoTotal };
}
