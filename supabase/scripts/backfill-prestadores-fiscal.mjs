// ============================================================================
// JET OS — NFS-e #1 — Backfill de prestadores_fiscal a partir do Firestore.
// Cria um registro fiscal (esqueleto, procuracao_status='pendente') para cada
// usuário com tipoCadastro='prestador'. Campos sensíveis (CNPJ, código serviço,
// alíquota) ficam pro prestador/gestor completar; aqui só semeamos o básico.
//
// uid (Firebase) -> uuid via tabela usuarios (firebase_uid). Idempotente (upsert por uid).
//
// Uso (cmd):
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role>
//   set GOOGLE_APPLICATION_CREDENTIALS=C:\Users\hikoa\Downloads\Jet OS\serviceAccountKey-jet-os-1.json
//   node backfill-prestadores-fiscal.mjs
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp();
const fs = getFirestore();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// mapa firebase_uid -> uuid (da tabela usuarios)
const uidMap = {};
{
  let from = 0; const PAGE = 1000;
  for (;;) {
    const { data, error } = await sb.from('usuarios').select('id, firebase_uid')
      .not('firebase_uid', 'is', null).range(from, from + PAGE - 1);
    if (error) { console.error('usuarios:', error.message); process.exit(1); }
    for (const r of data) uidMap[r.firebase_uid] = r.id;
    if (data.length < PAGE) break; from += PAGE;
  }
}

const soDigitos = (s) => (s || '').replace(/\D/g, '');
const ehCnpj = (s) => soDigitos(s).length === 14;

const docs = (await fs.collection('usuarios').where('tipoCadastro', '==', 'prestador').get()).docs;
const rows = [];
let semMapa = 0;
for (const d of docs) {
  const uuid = uidMap[d.id];
  if (!uuid) { semMapa++; continue; }
  const p = d.data();
  rows.push({
    uid: uuid,
    cnpj: ehCnpj(p.cpfCnpj) ? soDigitos(p.cpfCnpj) : null,
    cpf_responsavel: !ehCnpj(p.cpfCnpj) ? soDigitos(p.cpfCnpj) || null : null,
    razao_social: p.nome ?? null,
    email_fiscal: p.email ?? null,
    regime_tributario: (p.tipoContrato || '').includes('MEI') ? 'MEI' : 'MEI',
    ativo: p.statusPrestador ? p.statusPrestador === 'ativo' : true,
    // procuracao_status fica no default 'pendente'
  });
}

let ok = 0;
for (let i = 0; i < rows.length; i += 500) {
  const part = rows.slice(i, i + 500);
  const { error } = await sb.from('prestadores_fiscal').upsert(part, { onConflict: 'uid', ignoreDuplicates: false });
  if (error) { console.error('prestadores_fiscal:', error.message); break; }
  ok += part.length;
}
console.log(`== prestadores_fiscal: ${ok}/${rows.length} upsert (prestadores no Firestore=${docs.length}, sem mapa=${semMapa}) ==`);
process.exit(0);
