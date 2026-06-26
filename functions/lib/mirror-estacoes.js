"use strict";
// functions/src/mirror-estacoes.ts
// Dual-write server-side (strangler) das ESTAÇÕES Firestore → Supabase, para manter a
// tabela public.estacoes sincronizada enquanto o ESCRITOR ainda grava no Firebase
// (Fase 2 / Onda A). Cobre todos os escritores (TelaMapa, Cloud Functions) sem tocar
// nos call sites, sem sessão Supabase no cliente e sem rotacionar o token do GPS.
//
// onDocumentWritten (create+update+delete):
//   • após-existe  → upsert por firebase_id (PostgREST on_conflict)
//   • deletado     → delete por firebase_id
// NÃO escreve de volta no Firestore (evita loop de trigger).
// Segredos (functions/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE. No-op se ausentes.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.espelharLocalSupabase = exports.espelharZonaSupabase = exports.espelharEstacaoSupabase = void 0;
const functions = __importStar(require("firebase-functions"));
const firestore_1 = require("firebase-functions/v2/firestore");
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';
const num = (v) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return (typeof n === 'number' && isFinite(n)) ? n : null;
};
const str = (v) => (typeof v === 'string' && v.trim()) ? v : null;
const pais = (p) => (typeof p === 'string' && /^[A-Z]{2}$/.test(p)) ? p : 'BR';
exports.espelharEstacaoSupabase = (0, firestore_1.onDocumentWritten)({ document: 'estacoes/{id}', region: 'southamerica-east1' }, async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
        return; // migração não cortada ainda
    const id = event.params.id;
    const hdr = { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` };
    const after = event.data?.after;
    // Deletado no Firestore → remove do Supabase
    if (!after?.exists) {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/estacoes?firebase_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: hdr });
        }
        catch (e) {
            functions.logger.error('[mirror-estacao] delete:', e);
        }
        return;
    }
    const d = after.data();
    const lat = num(d.lat), lng = num(d.lng);
    const row = {
        firebase_id: id,
        codigo: str(d.codigo), cidade: str(d.cidade), pais: pais(d.pais),
        bairro: str(d.bairro), endereco: str(d.endereco),
        tipo: str(d.tipo), status: str(d.status),
        imagens: (d.imagens ?? (str(d.fotoUrl) ? [d.fotoUrl] : [])),
        croqui_status: str(d.croquiStatus) ?? str(d.croqui_status),
        geo: (lat !== null && lng !== null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
    };
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/estacoes?on_conflict=firebase_id`, {
            method: 'POST',
            headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(row),
        });
        if (!resp.ok)
            functions.logger.error(`[mirror-estacao] upsert ${resp.status}:`, await resp.text().catch(() => ''));
    }
    catch (e) {
        functions.logger.error('[mirror-estacao] upsert net:', e);
    }
});
// ── Helpers comuns (zonas/locais) ────────────────────────────────────────────
const HDR = () => ({ apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` });
async function sbUpsert(tbl, row, tag) {
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?on_conflict=firebase_id`, {
            method: 'POST',
            headers: { ...HDR(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(row),
        });
        if (!resp.ok)
            functions.logger.error(`[${tag}] upsert ${resp.status}:`, await resp.text().catch(() => ''));
    }
    catch (e) {
        functions.logger.error(`[${tag}] upsert net:`, e);
    }
}
async function sbDelete(tbl, fid, tag) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?firebase_id=eq.${encodeURIComponent(fid)}`, { method: 'DELETE', headers: HDR() });
    }
    catch (e) {
        functions.logger.error(`[${tag}] delete:`, e);
    }
}
// ── Mirror ZONAS (poligonos Firestore → public.zonas) ────────────────────────
exports.espelharZonaSupabase = (0, firestore_1.onDocumentWritten)({ document: 'poligonos/{id}', region: 'southamerica-east1' }, async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
        return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) {
        await sbDelete('zonas', id, 'mirror-zona');
        return;
    }
    const d = after.data();
    // poligonos usam o campo `pontos` OU `poligono` (array de {lat,lng})
    const raw = Array.isArray(d.pontos) ? d.pontos : (Array.isArray(d.poligono) ? d.poligono : []);
    const pts = raw.filter(p => num(p?.lat) !== null && num(p?.lng) !== null);
    let geom = null;
    if (pts.length >= 3) {
        const ring = [...pts];
        const a = ring[0], b = ring[ring.length - 1];
        if (a.lat !== b.lat || a.lng !== b.lng)
            ring.push(a); // fecha o anel
        geom = `SRID=4326;POLYGON((${ring.map(p => `${p.lng} ${p.lat}`).join(', ')}))`;
    }
    if (!geom) {
        functions.logger.warn(`[mirror-zona] ${id} sem anel válido — pulado`);
        return;
    }
    await sbUpsert('zonas', {
        firebase_id: id, nome: str(d.nome), grupo: str(d.grupo), fase: str(d.fase),
        cor: str(d.cor), ativo: d.ativo !== false, cidade: str(d.cidade), pais: pais(d.pais),
        prioridade: num(d.prioridade), geom,
    }, 'mirror-zona');
});
// ── Mirror LOCAIS operacionais (Firestore → public.locais_operacionais) ──────
exports.espelharLocalSupabase = (0, firestore_1.onDocumentWritten)({ document: 'locais_operacionais/{id}', region: 'southamerica-east1' }, async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
        return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) {
        await sbDelete('locais_operacionais', id, 'mirror-local');
        return;
    }
    const d = after.data();
    const lat = num(d.lat), lng = num(d.lng);
    await sbUpsert('locais_operacionais', {
        firebase_id: id, nome: str(d.nome), tipo: str(d.tipo), cidade: str(d.cidade),
        pais: pais(d.pais), obs: str(d.observacoes) ?? str(d.obs),
        geo: (lat !== null && lng !== null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
    }, 'mirror-local');
});
//# sourceMappingURL=mirror-estacoes.js.map