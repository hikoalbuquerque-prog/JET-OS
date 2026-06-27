// reimportar_auditoria.js — JET OS Guard
// ATENÇÃO: Remove TODOS os dados atuais de ocorrencias e reimporta os 450 auditados
// Execute: node reimportar_auditoria.js
// Coloque junto com serviceAccountKey.json e auditoria_incidentes.json

'use strict';
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const dados = require('./auditoria_incidentes.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

function toTimestamp(v) {
  if (!v) return null;
  try { const d = new Date(v); return isNaN(d) ? null : admin.firestore.Timestamp.fromDate(d); }
  catch { return null; }
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  REIMPORTAR AUDITORIA GUARD — JET OS             ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`⚠️  ATENÇÃO: Esta operação vai:`);
  console.log(`   1. REMOVER todos os documentos atuais de 'ocorrencias'`);
  console.log(`   2. REIMPORTAR os ${dados.total} registros auditados da planilha`);
  console.log(`\n   Registros auditados:`);

  // Stats rápidos
  const tipos = {};
  const status = {};
  dados.incidentes.forEach(i => {
    tipos[i.tipo]    = (tipos[i.tipo]    || 0) + 1;
    status[i.status] = (status[i.status] || 0) + 1;
  });
  Object.entries(tipos).forEach(([t,n]) => console.log(`   • ${t}: ${n}`));
  console.log(`\n   Status: ${JSON.stringify(status)}`);

  const ok = await ask('\nConfirmar? Digite "CONFIRMAR" para prosseguir: ');
  if (ok.trim() !== 'CONFIRMAR') {
    console.log('Cancelado.'); rl.close(); return;
  }

  // ── 1. Remover tudo ──────────────────────────────────────────────
  console.log('\n[1/2] Removendo registros atuais...');
  let removidos = 0;
  let snap;
  do {
    snap = await db.collection('ocorrencias').limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    removidos += snap.docs.length;
    process.stdout.write(`\r  Removidos: ${removidos}`);
  } while (!snap.empty);
  console.log(`\n  ✓ ${removidos} documentos removidos`);

  // ── 2. Importar auditados ─────────────────────────────────────────
  console.log('\n[2/2] Importando registros auditados...');
  let importados = 0;
  const incidentes = dados.incidentes;

  for (let i = 0; i < incidentes.length; i += 400) {
    const batch = db.batch();
    const lote  = incidentes.slice(i, i + 400);

    lote.forEach(inc => {
      const ref = db.collection('ocorrencias').doc(inc.id);
      const doc = {
        id:                    inc.id,
        created_at:            inc.created_at || null,
        updated_at:            inc.updated_at || null,
        ativo_tipo:            inc.ativo_tipo || '',
        tipo:                  inc.tipo || '',
        status:                inc.status || 'Aberto',
        prioridade:            inc.prioridade || 'Média',
        asset_id:              inc.asset_id || '',
        descricao:             inc.descricao || '',
        responsavel:           inc.responsavel || '',
        origem_registro:       inc.origem_registro || '',
        lat_inicial:           inc.lat_inicial || null,
        lng_inicial:           inc.lng_inicial || null,
        endereco_inicial:      inc.endereco_inicial || '',
        bairro_inicial:        inc.bairro_inicial || '',
        cidade_inicial:        inc.cidade_inicial || '',
        lat_final:             inc.lat_final || null,
        lng_final:             inc.lng_final || null,
        endereco_final:        inc.endereco_final || '',
        bairro_final:          inc.bairro_final || '',
        cidade_final:          inc.cidade_final || '',
        data_fechamento:       inc.data_fechamento || null,
        resultado:             inc.resultado || '',
        observacao_fechamento: inc.observacao_fechamento || '',
        foto1_url:             inc.foto1_url || '',
        foto2_url:             inc.foto2_url || '',
        auditado:              true,
        auditadoEm:            admin.firestore.Timestamp.now(),
      };
      batch.set(ref, doc);
    });

    await batch.commit();
    importados += lote.length;
    process.stdout.write(`\r  Importados: ${importados}/${incidentes.length}`);
  }

  console.log(`\n  ✓ ${importados} registros importados`);
  console.log('\n✅ Auditoria concluída com sucesso!');
  console.log('👉 Acesse https://jet-os-7.web.app → Guard para verificar\n');
  rl.close();
  process.exit(0);
}

run().catch(e => { console.error(e); rl.close(); process.exit(1); });
