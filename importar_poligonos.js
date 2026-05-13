#!/usr/bin/env node
/**
 * importar_poligonos.js
 * Importa poligonos_export.json no Firestore coleção 'poligonos'
 *
 * USO:
 *   node importar_poligonos.js poligonos_export.json ./sa.json
 */

const admin = require('firebase-admin');
const fs    = require('fs');

const PROJECT_ID = 'jet-os-7';
const jsonFile   = process.argv[2];
const saFile     = process.argv[3] || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!jsonFile || !fs.existsSync(jsonFile)) {
  console.error('Uso: node importar_poligonos.js poligonos_export.json ./sa.json');
  process.exit(1);
}
if (!saFile || !fs.existsSync(saFile)) {
  console.error('Service Account nao encontrada:', saFile);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(saFile, 'utf8'))),
  projectId: PROJECT_ID
});

const db = admin.firestore();

async function importar() {
  const dados = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  console.log('Total de poligonos:', dados.length);

  let ok = 0, erros = 0;
  const BATCH = 500;

  for (let i = 0; i < dados.length; i += BATCH) {
    const lote  = dados.slice(i, i + BATCH);
    const batch = db.batch();

    lote.forEach(function(doc) {
      const ref = db.collection('poligonos').doc(doc.id);
      batch.set(ref, {
        ...doc,
        criadoEm:     admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    try {
      await batch.commit();
      ok += lote.length;
      console.log('OK ' + ok + '/' + dados.length);
    } catch(e) {
      erros += lote.length;
      console.error('Erro lote:', e.message);
    }
  }

  console.log('Importados:', ok, '| Erros:', erros);
  process.exit(erros > 0 ? 1 : 0);
}

importar().catch(function(e) {
  console.error(e);
  process.exit(1);
});
