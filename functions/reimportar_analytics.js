// reimportar_analytics.js
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'jet-os-7';
const BUCKET     = 'jet-os-7.firebasestorage.app';
const FILES      = ['2026-05-01', '2026-05-02', '2026-05-03'];

async function main() {
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
  const db      = getFirestore();
  const storage = getStorage().bucket();

  for (const dateKey of FILES) {
    const jsonFile = path.join(__dirname, `analytics_${dateKey}.json`);
    if (!fs.existsSync(jsonFile)) { console.log('Nao encontrado: ' + jsonFile); continue; }

    console.log('\nProcessando ' + dateKey + '...');
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    console.log('  ' + data.rides.length + ' corridas, R$' + data.meta.total_rev);

    const storagePath = 'analytics/' + dateKey + '.json';
    await storage.file(storagePath).save(JSON.stringify(data), {
      contentType: 'application/json',
    });
    console.log('  Storage OK: ' + storagePath);

    // URL publica sem signed URL
    const url = 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/' + encodeURIComponent(storagePath) + '?alt=media';

    await db.collection('analytics_days').doc(dateKey).set({
      ...data.meta,
      storage_path: storagePath,
      url: url,
    });
    console.log('  Firestore OK: analytics_days/' + dateKey);
    console.log('  ' + data.meta.total + ' corridas, R$' + data.meta.total_rev);
  }

  console.log('\nConcluido! Abra o app e clique nos dias no calendario.');
  process.exit(0);
}

main().catch(function(e) { console.error('Erro: ' + e.message); process.exit(1); });
