// ============================================================================
// JET OS — Fase 2 / Onda C (groundwork) — backfill de `paises`
//
// Copia Firestore usuarios/{uid}.paises -> Supabase public.usuarios.paises,
// casando por firebase_uid. Necessário antes de ligar a flag jet_auth_provider
// em produção (até lá o useAuth cai no fallback Firestore p/ paises).
//
// Idempotente: re-rodar só sobrescreve `paises` (e nada mais). Só atualiza linhas
// que JÁ existem no Supabase (pré-provisionadas) — não cria usuário nem mexe em role.
//
// Pré-requisitos / variáveis (PowerShell):
//   $env:SUPABASE_URL="https://ducdbrupxpzqcblfreqn.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role NOVA>"
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\serviceAccount.json"   # Firebase Admin
//   $env:DRY_RUN="true"   # opcional: só mostra o que faria, sem escrever
//   node backfill-paises.mjs
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp(); // usa GOOGLE_APPLICATION_CREDENTIALS (ADC)
const fdb = getFirestore();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DRY_RUN = process.env.DRY_RUN === 'true';

// Normaliza para text[] de strings não-vazias (aceita array, string única, ou
// array serializado como string tipo "[]" / '["BR"]' — dado sujo do Firestore).
const limpo = (p) => typeof p === 'string' && p.trim() && p.trim() !== '[]' && p.trim() !== '{}';
function normPaises(v) {
  if (Array.isArray(v)) return v.filter(limpo).map(p => p.trim());
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s[0] === '[') { // string serializada de array
      try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.filter(limpo).map(p => p.trim()) : []; }
      catch { return []; }
    }
    return limpo(s) ? [s] : [];
  }
  return [];
}

let lidos = 0, atualizados = 0, semPaises = 0, semLinhaSupabase = 0, erros = 0;

const snap = await fdb.collection('usuarios').get();
console.log(`Firestore usuarios: ${snap.size} docs${DRY_RUN ? ' (DRY_RUN)' : ''}`);

for (const d of snap.docs) {
  lidos++;
  const uid = d.id;
  const paises = normPaises(d.data().paises);
  if (!paises.length) { semPaises++; continue; }

  try {
    // só atualiza quem já existe no Supabase (pré-provisionado), casando por firebase_uid
    const { data: row, error: selErr } = await sb
      .from('usuarios').select('id').eq('firebase_uid', uid).maybeSingle();
    if (selErr) throw selErr;
    if (!row) { semLinhaSupabase++; continue; }

    if (DRY_RUN) { console.log(`  [dry] ${uid} -> paises=${JSON.stringify(paises)}`); atualizados++; continue; }

    const { error: updErr } = await sb.from('usuarios').update({ paises }).eq('id', row.id);
    if (updErr) throw updErr;
    atualizados++;
  } catch (e) {
    erros++;
    console.error(`  [${uid}] ERRO: ${e.message}`);
  }
}

console.log(`\n== backfill paises ${DRY_RUN ? '(DRY_RUN) ' : ''}==`);
console.log(`lidos=${lidos} atualizados=${atualizados} semPaises=${semPaises} semLinhaSupabase=${semLinhaSupabase} erros=${erros}`);
process.exit(erros ? 1 : 0);
