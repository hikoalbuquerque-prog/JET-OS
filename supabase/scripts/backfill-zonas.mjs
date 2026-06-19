// ============================================================================
// JET OS — Backfill de zonas (polígonos) Firestore -> Supabase
// poligonos[].pontos[{lat,lng}] -> public.zonas.geom (geography Polygon).
// Full refresh (reference data). Fecha o anel se necessário; pula polígonos
// inválidos (<3 pontos). Desbloqueia: stats de zona p/ multiplicadores de slots
// e zone-analytics do GoJet (ST_Contains).
//
// Uso (cmd):
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role>
//   set GOOGLE_APPLICATION_CREDENTIALS=C:\Users\hikoa\Downloads\Jet OS\serviceAccountKey-jet-os-1.json
//   node backfill-zonas.mjs
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp();
const fs = getFirestore();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// pontos -> EWKT POLYGON (fecha o anel). null se inválido.
function polyEwkt(pontos) {
  if (!Array.isArray(pontos) || pontos.length < 3) return null;
  const coords = pontos
    .filter(p => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    .map(p => [p.lng, p.lat]);
  if (coords.length < 3) return null;
  const [fx, fy] = coords[0], [lx, ly] = coords[coords.length - 1];
  if (fx !== lx || fy !== ly) coords.push([fx, fy]); // fecha
  if (coords.length < 4) return null;
  return `SRID=4326;POLYGON((${coords.map(([x, y]) => `${x} ${y}`).join(',')}))`;
}

const docs = (await fs.collection('poligonos').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const rows = [];
let pulados = 0;
for (const p of docs) {
  const geom = polyEwkt(p.pontos);
  if (!geom) { pulados++; continue; }
  rows.push({
    nome: p.nome ?? null, grupo: p.grupo ?? null, fase: p.fase ?? null, cor: p.cor ?? null,
    geom, ativo: p.ativo !== false, cidade: p.cidade ?? null, pais: 'BR',
    prioridade: typeof p.prioridade === 'number' ? p.prioridade : null,
  });
}

// full refresh
await sb.from('zonas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
let ok = 0;
for (let i = 0; i < rows.length; i += 500) {
  const part = rows.slice(i, i + 500);
  const { error } = await sb.from('zonas').insert(part);
  if (error) { console.error('zonas:', error.message); break; }
  ok += part.length;
}
console.log(`== zonas: ${ok}/${rows.length} inseridas (poligonos=${docs.length}, pulados=${pulados}) ==`);
process.exit(0);
