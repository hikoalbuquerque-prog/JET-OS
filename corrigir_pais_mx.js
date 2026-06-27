// Corrige estações do México que foram salvas com pais:'BR'
// Detecta pela coordenada geográfica
const admin = require('./node_modules/firebase-admin');
admin.initializeApp({ storageBucket: 'jet-os-7.firebasestorage.app' });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('estacoes').get();
  console.log('Total estações:', snap.size);

  let corrigidas = 0, jaCorretas = 0, outros = 0;

  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const lat = Number(d.lat || 0);
    const lng = Number(d.lng || 0);

    // México: lat 14-33, lng -118 a -86
    const isMX = lat > 14 && lat < 33 && lng > -118 && lng < -86;
    // Brasil: lat -35 a 5, lng -75 a -30
    const isBR = lat > -35 && lat < 5 && lng > -75 && lng < -30;

    if (isMX && d.pais !== 'MX') {
      batch.update(doc.ref, { pais: 'MX' });
      corrigidas++;
      batchCount++;
      if (batchCount >= 400) {
        await batch.commit();
        console.log('Batch commitado:', corrigidas, 'corrigidas até agora...');
        batchCount = 0;
      }
    } else if (isBR && d.pais !== 'BR') {
      batch.update(doc.ref, { pais: 'BR' });
      corrigidas++;
      batchCount++;
    } else {
      if (isMX || isBR) jaCorretas++; else outros++;
    }
  }

  if (batchCount > 0) await batch.commit();

  console.log('\nConcluído!');
  console.log('Corrigidas:', corrigidas);
  console.log('Já corretas:', jaCorretas);
  console.log('Fora de área (sem coordenada válida):', outros);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
