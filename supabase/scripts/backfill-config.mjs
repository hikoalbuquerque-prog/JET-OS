#!/usr/bin/env node
// supabase/scripts/backfill-config.mjs
// Onda F — copia config/telegram, guard_config/controle_perdas e app_config/clima
// do Firestore para Supabase app_settings.
//
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node supabase/scripts/backfill-config.mjs

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp();
const fdb = getFirestore();
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const DOCS = [
  { col: 'config',       doc: 'telegram',        chave: 'telegram' },
  { col: 'guard_config', doc: 'controle_perdas',  chave: 'controle_perdas' },
  { col: 'app_config',   doc: 'clima',            chave: 'clima' },
];

for (const { col, doc, chave } of DOCS) {
  const snap = await fdb.collection(col).doc(doc).get();
  if (!snap.exists) { console.log(`skip ${col}/${doc} (not found)`); continue; }
  const { error } = await sb.from('app_settings').upsert({ chave, valor: snap.data() });
  console.log(`${chave}: ${error ? 'ERROR ' + error.message : 'OK'}`);
}
