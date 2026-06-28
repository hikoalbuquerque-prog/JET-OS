"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchStreetViewCascata = fetchStreetViewCascata;
exports.fetchFramesParaIA = fetchFramesParaIA;
exports.svGetEstatisticas = svGetEstatisticas;
// src/streetview/index.ts
const axios_1 = __importDefault(require("axios"));
const GMAPS_KEY = process.env.GMAPS_KEY || '';
const MAPILLARY_TOKEN = process.env.MAPILLARY_TOKEN || '';
const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE ?? '';
// ── CONTADORES ───────────────────────────────────────────────────
const CUSTOS = {
    CACHE: 0.000,
    MAPILLARY: 0.000,
    GOOGLE_SV: 0.007,
    GOOGLE_SAT: 0.002,
};
async function incrementarContador(fonte) {
    try {
        const { getAppSetting, setAppSetting } = await Promise.resolve().then(() => __importStar(require('../config-supabase')));
        const current = await getAppSetting('config_sv_stats') ?? {};
        const countKey = `count_${fonte}`;
        const custoKey = `custo_${fonte}`;
        await setAppSetting('config_sv_stats', {
            ...current,
            [countKey]: (current[countKey] || 0) + 1,
            [custoKey]: (current[custoKey] || 0) + (CUSTOS[fonte] || 0),
            atualizadoEm: new Date().toISOString(),
        });
    }
    catch (e) { /* silencioso */ }
}
// ── CACHE ────────────────────────────────────────────────────────
const CACHE_PRECISION = 4;
function cacheKey(lat, lng) {
    return `${lat.toFixed(CACHE_PRECISION)}_${lng.toFixed(CACHE_PRECISION)}`;
}
async function buscarCache(key) {
    try {
        const url = `${SB_URL()}/storage/v1/object/uploads/streetview/${key}.jpg`;
        const res = await fetch(url, { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } });
        if (!res.ok)
            return null;
        return Buffer.from(await res.arrayBuffer());
    }
    catch {
        return null;
    }
}
async function salvarCache(key, _codigo, buffer, _fonte) {
    const path = `streetview/${key}.jpg`;
    const url = `${SB_URL()}/storage/v1/object/uploads/${path}`;
    await fetch(url, {
        method: 'PUT',
        headers: {
            apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`,
            'Content-Type': 'image/jpeg',
            'x-upsert': 'true',
        },
        body: new Uint8Array(buffer),
    });
    return `${SB_URL()}/storage/v1/object/public/uploads/${path}`;
}
// ── MAPILLARY ────────────────────────────────────────────────────
async function fetchMapillary(lat, lng) {
    if (!MAPILLARY_TOKEN)
        return null;
    try {
        const delta = 0.0005;
        const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
        const resp = await axios_1.default.get('https://graph.mapillary.com/images', {
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
        if (!images.length)
            return null;
        const imgUrl = images[0].thumb_256_url;
        if (!imgUrl)
            return null;
        const imgResp = await axios_1.default.get(imgUrl, {
            responseType: 'arraybuffer',
            timeout: 8000
        });
        const buffer = Buffer.from(imgResp.data);
        return isJpeg(buffer) ? buffer : null;
    }
    catch {
        return null;
    }
}
async function fetchMapillaryFrame(lat, lng, heading) {
    if (!MAPILLARY_TOKEN)
        return null;
    try {
        const delta = 0.0005;
        const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
        const resp = await axios_1.default.get('https://graph.mapillary.com/images', {
            params: {
                access_token: MAPILLARY_TOKEN,
                fields: 'id,thumb_256_url,computed_compass_angle',
                bbox,
                limit: 10
            },
            headers: { Authorization: `OAuth ${MAPILLARY_TOKEN}` },
            timeout: 8000
        });
        const images = resp.data?.data || [];
        if (!images.length)
            return null;
        // Encontra imagem com heading mais próximo
        const melhor = images.reduce((best, img) => {
            const diff = Math.abs(((img.computed_compass_angle - heading + 540) % 360) - 180);
            const bestDiff = Math.abs(((best.computed_compass_angle - heading + 540) % 360) - 180);
            return diff < bestDiff ? img : best;
        });
        if (!melhor.thumb_256_url)
            return null;
        const imgResp = await axios_1.default.get(melhor.thumb_256_url, {
            responseType: 'arraybuffer', timeout: 8000
        });
        const buffer = Buffer.from(imgResp.data);
        return isJpeg(buffer) ? buffer : null;
    }
    catch {
        return null;
    }
}
// ── GOOGLE STREET VIEW ───────────────────────────────────────────
async function fetchGoogleSV(lat, lng, heading = 45, pitch = -8, fov = 90, size = '320x240') {
    if (!GMAPS_KEY)
        return null;
    try {
        // Verifica metadata primeiro (evita cobrar ponto sem cobertura)
        const meta = await axios_1.default.get('https://maps.googleapis.com/maps/api/streetview/metadata', { params: { location: `${lat},${lng}`, source: 'outdoor', key: GMAPS_KEY }, timeout: 5000 });
        if (meta.data?.status !== 'OK')
            return null;
        const resp = await axios_1.default.get('https://maps.googleapis.com/maps/api/streetview', {
            params: { size, location: `${lat},${lng}`, source: 'outdoor', heading, pitch, fov, key: GMAPS_KEY },
            responseType: 'arraybuffer',
            timeout: 10000
        });
        const buffer = Buffer.from(resp.data);
        return isJpeg(buffer) ? buffer : null;
    }
    catch {
        return null;
    }
}
async function fetchGoogleSatelite(lat, lng) {
    if (!GMAPS_KEY)
        return null;
    try {
        const resp = await axios_1.default.get('https://maps.googleapis.com/maps/api/staticmap', {
            params: {
                center: `${lat},${lng}`,
                zoom: 19, size: '320x320', scale: 1,
                maptype: 'satellite', key: GMAPS_KEY
            },
            responseType: 'arraybuffer',
            timeout: 10000
        });
        return Buffer.from(resp.data);
    }
    catch {
        return null;
    }
}
// ── HELPERS ──────────────────────────────────────────────────────
function isJpeg(buf) {
    return buf?.length > 500 && buf[0] === 0xFF && buf[1] === 0xD8;
}
// ── EXPORTS PÚBLICOS ─────────────────────────────────────────────
/**
 * fetchStreetViewCascata
 * Cache → Mapillary → Google SV → Google Satélite
 * Salva no Storage e retorna URL pública.
 */
async function fetchStreetViewCascata(lat, lng, codigo) {
    const key = cacheKey(lat, lng);
    // 0. Cache
    const cached = await buscarCache(key);
    if (cached) {
        await incrementarContador('CACHE');
        return { url: `${SB_URL()}/storage/v1/object/public/uploads/streetview/${key}.jpg`, fonte: 'CACHE' };
    }
    let buffer = null;
    let fonte = '';
    // 1. Mapillary
    buffer = await fetchMapillary(lat, lng);
    if (buffer)
        fonte = 'MAPILLARY';
    // 2. Google SV
    if (!buffer) {
        buffer = await fetchGoogleSV(lat, lng);
        if (buffer)
            fonte = 'GOOGLE_SV';
    }
    // 3. Google Satélite
    if (!buffer) {
        buffer = await fetchGoogleSatelite(lat, lng);
        if (buffer)
            fonte = 'GOOGLE_SAT';
    }
    if (!buffer)
        return null;
    await incrementarContador(fonte);
    const url = await salvarCache(key, codigo, buffer, fonte);
    return { url, fonte };
}
/**
 * fetchFramesParaIA
 * 3 frames para análise Gemini: Mapillary → Google SV → Google Satélite
 */
async function fetchFramesParaIA(lat, lng) {
    const frames = [
        { heading: 45, label: 'frente-45' },
        { heading: 180, label: 'fundo-180' },
        { heading: 315, label: 'lado-315' },
    ];
    // Verifica disponibilidade SV
    let temSV = false;
    try {
        const meta = await axios_1.default.get('https://maps.googleapis.com/maps/api/streetview/metadata', { params: { location: `${lat},${lng}`, source: 'outdoor', key: GMAPS_KEY }, timeout: 5000 });
        temSV = meta.data?.status === 'OK';
    }
    catch { /* continua sem SV */ }
    if (!temSV) {
        // Sem SV — usa satélite como fallback para análise
        const sat = await fetchGoogleSatelite(lat, lng);
        if (sat)
            return [{ label: 'satelite', heading: 0, buffer: sat }];
        return [];
    }
    const out = [];
    await Promise.all(frames.map(async (f) => {
        let buf = null;
        // Mapillary (grátis)
        buf = await fetchMapillaryFrame(lat, lng, f.heading);
        if (buf) {
            await incrementarContador('MAPILLARY');
        }
        // Google SV (pago)
        if (!buf) {
            buf = await fetchGoogleSV(lat, lng, f.heading, -8, 75, '320x240');
            if (buf) {
                await incrementarContador('GOOGLE_SV');
            }
        }
        if (buf)
            out.push({ label: f.label, heading: f.heading, buffer: buf });
    }));
    return out;
}
/**
 * svGetEstatisticas
 * Retorna contadores e custo estimado do Firestore.
 */
async function svGetEstatisticas() {
    const { getAppSetting } = await Promise.resolve().then(() => __importStar(require('../config-supabase')));
    const data = await getAppSetting('config_sv_stats') ?? {};
    const fontes = Object.keys(CUSTOS);
    const stats = {};
    let custoTotal = 0;
    for (const f of fontes) {
        const count = Number(data[`count_${f}`] || 0);
        const custo = count * CUSTOS[f];
        stats[f] = { count, custo };
        custoTotal += custo;
    }
    return { ok: true, stats, custoTotal };
}
//# sourceMappingURL=index.js.map