// Limpa ocorrências manuais duplicadas — mantém apenas os 404 importados
// Execute: node limpar_ocorrencias_antigas.js
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// IDs que devem ser MANTIDOS (importados do XLSX com dados históricos corretos)
// Todos seguem o padrão JET-SEC-YYYYMMDD-HHMMSS-NNN
const IDS_VALIDOS = new Set(require('./incidentes_import.json').incidentes.map(d => d.id));

async function limpar() {
  const snap = await db.collection('ocorrencias').get();
  console.log(`Total na coleção: ${snap.size} documentos`);

  const paraRemover = [];
  snap.forEach(doc => {
    const id = doc.id;
    // Remover se NÃO está na lista de importados válidos
    if (!IDS_VALIDOS.has(id)) {
      paraRemover.push(doc.ref);
    }
  });

  console.log(`Documentos a remover: ${paraRemover.length}`);
  console.log(`Documentos a manter: ${snap.size - paraRemover.length}`);

  if (paraRemover.length === 0) {
    console.log('✓ Nenhum documento para remover.');
    process.exit(0);
  }

  // Deletar em batches de 400
  for (let i = 0; i < paraRemover.length; i += 400) {
    const batch = db.batch();
    paraRemover.slice(i, i + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
    console.log(`  Removidos ${Math.min(i + 400, paraRemover.length)}/${paraRemover.length}`);
  }

  console.log(`✓ Limpeza concluída. ${IDS_VALIDOS.size} registros válidos mantidos.`);
  process.exit(0);
}

limpar().catch(e => { console.error(e); process.exit(1); });
