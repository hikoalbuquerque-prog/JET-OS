// importar_estacoesSP.js — Importar estações de SP substituindo as atuais
// Execução: node importar_estacoesSP.js
// Necessário: npm install firebase-admin xlsx

const admin = require('firebase-admin');
const XLSX  = require('xlsx');
const path  = require('path');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function parseCoord(str) {
  if (!str) return null;
  const parts = String(str).split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]))
    return { lat: parts[0], lng: parts[1] };
  return null;
}

function generateId() {
  return 'SP-' + Date.now() + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
}

async function main() {
  const wb  = XLSX.readFile(path.join(__dirname, 'estacoesSP.xlsx'));
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });

  console.log(`Total de linhas: ${raw.length}`);

  // ── PASSO 1: Excluir todas as estações de SP ────────────────────
  console.log('\n[1/2] Excluindo estações de SP...');
  const snap = await db.collection('estacoes')
    .where('cidade', '==', 'São Paulo')
    .get();
  
  let delCount = 0;
  const batchesDel = [];
  let batchDel = db.batch();
  snap.docs.forEach((doc, i) => {
    batchDel.delete(doc.ref);
    delCount++;
    if ((i+1) % 490 === 0) { batchesDel.push(batchDel); batchDel = db.batch(); }
  });
  batchesDel.push(batchDel);
  for (const b of batchesDel) await b.commit();
  console.log(`  Excluídas: ${delCount} estações de SP`);

  // ── PASSO 2: Importar novas estações ────────────────────────────
  console.log('\n[2/2] Importando estações SP...');
  let ok = 0, skip = 0;
  const lotes = [];
  let lote = db.batch();
  let loteCount = 0;

  for (const row of raw) {
    const nome   = row['Наименование'];
    const coords = row['Координаты'];
    if (!nome || !coords) { skip++; continue; }

    const coord = parseCoord(coords);
    if (!coord) { skip++; continue; }

    // Verificar se inativa
    const inativa = row['Неактивна'];
    if (inativa === true || inativa === 'true') { skip++; continue; }

    const id     = generateId();
    const docRef = db.collection('estacoes').doc(id);

    // Inferir bairro do nome (geralmente "Endereço - Bairro")
    const partes = String(nome).split(' - ');
    const bairro = partes.length > 1 ? partes[partes.length - 1].trim() : '';

    const doc = {
      id,
      codigo:     id,
      nome:       nome,
      endereco:   nome,
      bairro,
      cidade:     'São Paulo',
      pais:       'BR',
      lat:        coord.lat,
      lng:        coord.lng,
      tipo:       'PUBLICA',
      status:     'INSTALADO',
      modality:   'scooter',
      capacidade: Number(row['Емкость. Самокат'] || 0),
      dentro:     Number(row['Внутри. Самокат']  || 0),
      larguraFaixa: 0,
      observacao:   '',
      criadoEm:   admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      importadoEm:  admin.firestore.FieldValue.serverTimestamp(),
      origem:     'estacoesSP.xlsx',
    };

    lote.set(docRef, doc);
    loteCount++;
    ok++;

    if (loteCount >= 490) {
      lotes.push(lote);
      lote = db.batch();
      loteCount = 0;
    }
  }
  if (loteCount > 0) lotes.push(lote);

  for (let i = 0; i < lotes.length; i++) {
    await lotes[i].commit();
    console.log(`  Lote ${i+1}/${lotes.length} committed`);
  }

  console.log(`  Importadas: ${ok} | Puladas: ${skip} (sem coord ou inativas)`);
  console.log('\n✅ Importação SP concluída!');
  process.exit(0);
}

main().catch(err => { console.error('ERRO:', err); process.exit(1); });
