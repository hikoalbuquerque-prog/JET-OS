#!/usr/bin/env node
/**
 * importar_firestore.js
 * ─────────────────────────────────────────────────────────────────
 * Importa o JSON exportado pelo GAS direto no Firestore.
 * Roda localmente — sem limite de chamadas, sem timeout.
 *
 * PRÉ-REQUISITOS:
 *   npm install firebase-admin
 *
 * USO:
 *   node importar_firestore.js estacoes_export.json
 *
 * VARIÁVEL DE AMBIENTE:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sua-service-account.json
 *   ou passe o caminho como segundo argumento:
 *   node importar_firestore.js estacoes_export.json ./sa.json
 * ─────────────────────────────────────────────────────────────────
 */

const admin  = require('firebase-admin');
const fs     = require('fs');
const path   = require('path');

// ── CONFIG ───────────────────────────────────────────────────────
const PROJECT_ID   = 'jet-os-7';
const BATCH_SIZE   = 500; // máximo do Firestore por batch
const COLECAO      = 'estacoes';
// ─────────────────────────────────────────────────────────────────

const jsonFile = process.argv[2];
const saFile   = process.argv[3] || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!jsonFile) {
  console.error('Uso: node importar_firestore.js estacoes_export.json [service-account.json]');
  process.exit(1);
}

if (!saFile || !fs.existsSync(saFile)) {
  console.error('Service Account não encontrada.');
  console.error('Passe como argumento: node importar_firestore.js dados.json ./sa.json');
  console.error('Ou defina: export GOOGLE_APPLICATION_CREDENTIALS=./sa.json');
  process.exit(1);
}

// Inicializa Firebase Admin
const serviceAccount = JSON.parse(fs.readFileSync(saFile, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId:  PROJECT_ID
});

const db = admin.firestore();

// ── IMPORTAÇÃO ───────────────────────────────────────────────────

async function importar() {
  console.log('=== IMPORTAÇÃO FIRESTORE ===');
  console.log('Arquivo:', jsonFile);
  console.log('Projeto:', PROJECT_ID);
  console.log('');

  const dados = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  console.log('Total de documentos:', dados.length);

  let importados = 0;
  let erros      = 0;
  const inicio   = Date.now();

  // Processa em batches de 500 (limite do Firestore)
  for (let i = 0; i < dados.length; i += BATCH_SIZE) {
    const lote  = dados.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    lote.forEach(function(doc) {
      const ref = db.collection(COLECAO).doc(doc.id || doc.codigo);
      batch.set(ref, {
        ...doc,
        criadoEm:     admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }); // merge: não apaga campos existentes
    });

    try {
      await batch.commit();
      importados += lote.length;
      const pct = Math.round((importados / dados.length) * 100);
      console.log(`✓ ${importados}/${dados.length} (${pct}%) — lote ${Math.floor(i/BATCH_SIZE)+1}`);
    } catch(e) {
      erros += lote.length;
      console.error(`✗ Erro no lote ${Math.floor(i/BATCH_SIZE)+1}:`, e.message);
    }
  }

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('');
  console.log('=== CONCLUÍDO ===');
  console.log(`✓ Importados: ${importados}`);
  console.log(`✗ Erros:      ${erros}`);
  console.log(`⏱ Tempo:      ${segundos}s`);

  process.exit(erros > 0 ? 1 : 0);
}

importar().catch(function(e) {
  console.error('Erro fatal:', e);
  process.exit(1);
});
