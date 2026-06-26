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

import * as functions from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return (typeof n === 'number' && isFinite(n)) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim()) ? v : null;
const pais = (p: unknown): string => (typeof p === 'string' && /^[A-Z]{2}$/.test(p)) ? p : 'BR';

export const espelharEstacaoSupabase = onDocumentWritten(
  { document: 'estacoes/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return; // migração não cortada ainda
    const id = event.params.id;
    const hdr = { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` };
    const after = event.data?.after;

    // Deletado no Firestore → remove do Supabase
    if (!after?.exists) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/estacoes?firebase_id=eq.${encodeURIComponent(id)}`,
          { method: 'DELETE', headers: hdr });
      } catch (e) { functions.logger.error('[mirror-estacao] delete:', e); }
      return;
    }

    const d = after.data() as Record<string, unknown>;
    const lat = num(d.lat), lng = num(d.lng);
    const row: Record<string, unknown> = {
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
      if (!resp.ok) functions.logger.error(`[mirror-estacao] upsert ${resp.status}:`, await resp.text().catch(() => ''));
    } catch (e) { functions.logger.error('[mirror-estacao] upsert net:', e); }
  },
);

// ── Helpers comuns (zonas/locais) ────────────────────────────────────────────
const HDR = () => ({ apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` });
async function sbUpsert(tbl: string, row: Record<string, unknown>, tag: string) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?on_conflict=firebase_id`, {
      method: 'POST',
      headers: { ...HDR(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    if (!resp.ok) functions.logger.error(`[${tag}] upsert ${resp.status}:`, await resp.text().catch(() => ''));
  } catch (e) { functions.logger.error(`[${tag}] upsert net:`, e); }
}
async function sbDelete(tbl: string, fid: string, tag: string) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?firebase_id=eq.${encodeURIComponent(fid)}`, { method: 'DELETE', headers: HDR() }); }
  catch (e) { functions.logger.error(`[${tag}] delete:`, e); }
}

// ── Mirror ZONAS (poligonos Firestore → public.zonas) ────────────────────────
export const espelharZonaSupabase = onDocumentWritten(
  { document: 'poligonos/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('zonas', id, 'mirror-zona'); return; }
    const d = after.data() as Record<string, unknown>;
    // poligonos usam o campo `pontos` OU `poligono` (array de {lat,lng})
    const raw = Array.isArray(d.pontos) ? d.pontos : (Array.isArray(d.poligono) ? d.poligono : []);
    const pts = (raw as any[]).filter(p => num(p?.lat) !== null && num(p?.lng) !== null);
    let geom: string | null = null;
    if (pts.length >= 3) {
      const ring = [...pts];
      const a = ring[0], b = ring[ring.length - 1];
      if (a.lat !== b.lat || a.lng !== b.lng) ring.push(a); // fecha o anel
      geom = `SRID=4326;POLYGON((${ring.map(p => `${p.lng} ${p.lat}`).join(', ')}))`;
    }
    if (!geom) { functions.logger.warn(`[mirror-zona] ${id} sem anel válido — pulado`); return; }
    await sbUpsert('zonas', {
      firebase_id: id, nome: str(d.nome), grupo: str(d.grupo), fase: str(d.fase),
      cor: str(d.cor), ativo: d.ativo !== false, cidade: str(d.cidade), pais: pais(d.pais),
      prioridade: num(d.prioridade), geom,
    }, 'mirror-zona');
  },
);

// ── Mirror LOCAIS operacionais (Firestore → public.locais_operacionais) ──────
export const espelharLocalSupabase = onDocumentWritten(
  { document: 'locais_operacionais/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('locais_operacionais', id, 'mirror-local'); return; }
    const d = after.data() as Record<string, unknown>;
    const lat = num(d.lat), lng = num(d.lng);
    await sbUpsert('locais_operacionais', {
      firebase_id: id, nome: str(d.nome), tipo: str(d.tipo), cidade: str(d.cidade),
      pais: pais(d.pais), obs: str(d.observacoes) ?? str(d.obs),
      geo: (lat !== null && lng !== null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
    }, 'mirror-local');
  },
);
