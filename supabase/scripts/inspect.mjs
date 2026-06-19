// Inspeção rápida do Firestore: conta e mostra amostra de cada coleção,
// para mapear os campos no backfill (e diagnosticar coleções vazias).
// Usa GOOGLE_APPLICATION_CREDENTIALS (mesma service account).
//   node inspect.mjs

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

const COLS = ['tarefas_logistica', 'slots', 'pagamentos_semana', 'gojet_config', 'pagamentos_config'];

for (const col of COLS) {
  try {
    const cnt = await db.collection(col).count().get();
    const snap = await db.collection(col).limit(2).get();
    console.log(`\n===== ${col} ===== (total: ${cnt.data().count})`);
    if (snap.empty) { console.log('  (vazia)'); continue; }
    snap.docs.forEach(d => console.log(JSON.stringify({ _id: d.id, ...d.data() }, null, 2)));
  } catch (e) {
    console.log(`\n===== ${col} ===== ERRO: ${e.message}`);
  }
}
process.exit(0);
