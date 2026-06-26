// ============================================================================
// JET OS — Fase 2 / Onda A — backfill Firestore → Supabase
//   domínios: estacoes | zonas | locais
//   Idempotente: apaga as linhas com firebase_id e reinsere (tabelas ainda não
//   são lidas pelo app live → seguro). Geo via EWKT (SRID=4326;...).
// Uso (cmd): set GOOGLE_APPLICATION_CREDENTIALS=...jet-os-1.json
//            set SUPABASE_URL=...  set SUPABASE_SERVICE_ROLE_KEY=...
//            node backfill-wave-a.mjs estacoes [limit]
// ============================================================================
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

const DOMINIO = process.argv[2];
const LIMIT = process.argv[3] ? Number(process.argv[3]) : 0;
if (!['estacoes', 'zonas', 'locais'].includes(DOMINIO)) {
  console.error('Uso: node backfill-wave-a.mjs estacoes|zonas|locais [limit]'); process.exit(1);
}
initializeApp();
const fdb = getFirestore();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const pais = (p) => (typeof p === 'string' && /^[A-Z]{2}$/.test(p)) ? p : 'BR';
const ptBR = (lat, lng) => (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng))
  ? `SRID=4326;POINT(${lng} ${lat})` : null;

const CFG = {
  estacoes: {
    col: 'estacoes', tbl: 'estacoes',
    map: (id, x) => ({
      firebase_id: id, codigo: x.codigo ?? null, cidade: x.cidade ?? null, pais: pais(x.pais),
      bairro: x.bairro ?? null, endereco: x.endereco ?? null, tipo: x.tipo ?? null, status: x.status ?? null,
      imagens: Array.isArray(x.imagens) ? x.imagens : (x.fotoUrl ? [x.fotoUrl] : []),
      croqui_status: x.croquiStatus ?? x.croqui_status ?? null,
      geo: ptBR(x.lat, x.lng),
    }),
  },
  zonas: {
    col: 'poligonos', tbl: 'zonas',
    map: (id, x) => {
      const raw = Array.isArray(x.pontos) ? x.pontos : (Array.isArray(x.poligono) ? x.poligono : []);
      const pts = raw.filter(p => typeof p?.lat === 'number' && typeof p?.lng === 'number');
      let geom = null;
      if (pts.length >= 3) {
        const ring = [...pts];
        const a = ring[0], b = ring[ring.length - 1];
        if (a.lat !== b.lat || a.lng !== b.lng) ring.push(a);   // fecha o anel
        geom = `SRID=4326;POLYGON((${ring.map(p => `${p.lng} ${p.lat}`).join(', ')}))`;
      }
      return { firebase_id: id, nome: x.nome ?? null, grupo: x.grupo ?? null, fase: x.fase ?? null,
        cor: x.cor ?? null, ativo: x.ativo !== false, cidade: x.cidade ?? null, pais: pais(x.pais),
        prioridade: typeof x.prioridade === 'number' ? x.prioridade : null, geom };
    },
    skip: (row) => !row.geom,   // polígono inválido (sem anel) → pula
  },
  locais: {
    col: 'locais_operacionais', tbl: 'locais_operacionais',
    map: (id, x) => ({ firebase_id: id, nome: x.nome ?? null, tipo: x.tipo ?? null,
      cidade: x.cidade ?? null, pais: pais(x.pais), obs: x.observacoes ?? x.obs ?? null,
      geo: ptBR(x.lat, x.lng) }),
  },
};

(async () => {
  const cfg = CFG[DOMINIO];
  console.log(`== backfill ${cfg.col} → ${cfg.tbl} ${LIMIT ? '(LIMIT ' + LIMIT + ')' : ''} ==`);

  // 1) lê Firestore
  let q = fdb.collection(cfg.col);
  if (LIMIT) q = q.limit(LIMIT);
  const snap = await q.get();
  const rows = [];
  let pulados = 0;
  snap.forEach(d => {
    const row = cfg.map(d.id, d.data());
    if (cfg.skip && cfg.skip(row)) { pulados++; return; }
    rows.push(row);
  });
  console.log(`Firestore: ${snap.size} docs → ${rows.length} válidos (${pulados} pulados)`);

  // 2) limpa backfill anterior (só linhas com firebase_id) — a não ser em modo LIMIT (teste)
  if (!LIMIT) {
    const { error: delErr } = await sb.from(cfg.tbl).delete().not('firebase_id', 'is', null);
    if (delErr) { console.error('delete:', delErr.message); process.exit(1); }
  }

  // 3) insere em lotes de 500
  let inseridos = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const lote = rows.slice(i, i + 500);
    const { error } = await sb.from(cfg.tbl).insert(lote);
    if (error) { console.error(`insert lote ${i}:`, error.message); process.exit(1); }
    inseridos += lote.length;
    console.log(`  inseridos ${inseridos}/${rows.length}`);
  }

  // 4) confere contagem
  const { count } = await sb.from(cfg.tbl).select('*', { count: 'exact', head: true }).not('firebase_id', 'is', null);
  console.log(`== OK == ${cfg.tbl}: ${count} linhas com firebase_id no Supabase`);
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
