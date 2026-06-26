// importar_estacionamentos.js — JET OS
// Importa 84 estacionamentos (JET + PCR + WHOOSH) para Firestore
// Execute: node importar_estacionamentos.js
//
// NOTA: Os CSVs do Google Earth NÃO contêm informação de cor (verde/roxo).
// A cor dos pins era apenas estilo visual do Google Earth.
// Recomendação: importe tudo como INSTALADO e corrija manualmente os que
// ainda não foram instalados no app (Dash → editar estação → status).

const admin    = require('firebase-admin');
const readline = require('readline');
const serviceAccount = require('./serviceAccountKey.json');
const dados    = require('./estacionamentos_import.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

function slugify(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function importar() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Importar Estacionamentos — JET OS       ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Total: ${dados.total} estacionamentos`);
  console.log(`  JET:    ${dados.estacoes.filter(e=>e.fonte==='JET').length} pontos`);
  console.log(`  PCR:    ${dados.estacoes.filter(e=>e.fonte==='PCR').length} pontos`);
  console.log(`  WHOOSH: ${dados.estacoes.filter(e=>e.fonte==='WHOOSH').length} pontos`);
  console.log('\n⚠️  Nota: os CSVs não têm informação de cor/status do Google Earth.');
  console.log('   Importe como INSTALADO e ajuste os não-instalados manualmente no app.\n');

  // Tipo
  console.log('Tipo das estações:');
  console.log('  1 = PUBLICA     (azul no mapa)');
  console.log('  2 = PRIVADA     (amarelo no mapa)');
  console.log('  3 = CONCORRENTE (vermelho no mapa)');
  const tipoR  = await ask('Escolha [1/2/3, padrão=1]: ');
  const tipo   = ({ '2':'PRIVADA', '3':'CONCORRENTE' })[tipoR.trim()] || 'PUBLICA';

  // Status
  console.log('\nStatus das estações:');
  console.log('  1 = INSTALADO  ✓ (recomendado — corrija os pendentes manualmente)');
  console.log('  2 = APROVADO     (aprovado mas não instalado)');
  console.log('  3 = SOLICITADO   (em análise)');
  const statusR = await ask('Escolha [1/2/3, padrão=1]: ');
  const status  = ({ '2':'APROVADO', '3':'SOLICITADO' })[statusR.trim()] || 'INSTALADO';

  console.log(`\nConfiguração: tipo=${tipo} | status=${status}`);
  const ok = await ask('Confirmar importação? [s/N]: ');
  if (!ok.trim().toLowerCase().startsWith('s')) {
    console.log('Cancelado.'); rl.close(); return;
  }

  console.log('\nImportando...\n');
  let importados = 0, erros = 0;

  for (let i = 0; i < dados.estacoes.length; i += 400) {
    const batch = db.batch();
    const lote  = dados.estacoes.slice(i, i + 400);

    lote.forEach(e => {
      const id  = (e.fonte.toLowerCase() + '-' + slugify(e.codigo)).slice(0, 64);
batch.set(db.collection('estacoes').doc(id), {
  id,
  codigo:      e.codigo      || '',
  nome:        e.nome        || e.codigo || '',
  fonte:       e.fonte       || '',

  tipo:        e.tipo        || tipo,
  status:      e.status      || status,

  lat:         e.lat         || 0,
  lng:         e.lng         || 0,

  endereco:    e.endereco    || '',
  bairro:      e.bairro      || '',
  cidade:      e.cidade      || 'Ciudad de México',
  estado:      e.estado      || 'CDMX',
  pais:        e.pais        || 'MX',

fotoUrl: e.fotoUrl && e.fotoUrl !== 'nan'
  ? e.fotoUrl
  : '',

imagens: {
  foto: e.fotoUrl && e.fotoUrl !== 'nan'
    ? e.fotoUrl
    : ''
},

  capacidade:  e.capacidade  || 0,

  criadoEm:    admin.firestore.Timestamp.now(),
  criadoPor:   'importacao_csv',
}, { merge: true });

}); 
    try {
      await batch.commit();
      importados += lote.length;
      process.stdout.write(`\r  ✓ ${importados}/${dados.estacoes.length}`);
    } catch (err) {
      erros += lote.length;
      console.error('\n  ✗ Erro:', err.message);
    }
  }

  console.log(`\n\n✅ Concluído: ${importados} importados, ${erros} erros`);
  console.log(`👉 Para ajustar status individuais: https://jet-os-7.web.app`);
  console.log('   Dash → selecione a estação → editar → status\n');
  rl.close();
  process.exit(0);
}

importar().catch(e => { console.error(e); rl.close(); process.exit(1); });
