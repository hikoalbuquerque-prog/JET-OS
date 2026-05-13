// corrigir_cidade_bases.js
// Corrige o campo cidade de 'Sao Paulo' para 'São Paulo'
// nos documentos da coleção locais_operacionais
//
// Rodar em: C:\Users\hikoa\Downloads\Jet OS\functions
// Comando:  node corrigir_cidade_bases.js

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'jet-os-7';

async function main() {
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();

  const snap = await db.collection('locais_operacionais')
    .where('cidade', '==', 'Sao Paulo')
    .get();

  if (snap.empty) {
    console.log('Nenhum documento com cidade="Sao Paulo" encontrado.');
    console.log('Listando todos os locais_operacionais para diagnóstico...');
    const all = await db.collection('locais_operacionais').get();
    all.docs.forEach(d => console.log(' -', d.id, JSON.stringify({ cidade: d.data().cidade, nome: d.data().nome })));
    process.exit(0);
  }

  console.log(`Corrigindo ${snap.size} documentos: 'Sao Paulo' → 'São Paulo'`);
  const batch = db.batch();
  snap.docs.forEach(d => batch.update(d.ref, { cidade: 'São Paulo' }));
  await batch.commit();
  console.log(`✅ ${snap.size} documentos corrigidos!`);
  process.exit(0);
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
