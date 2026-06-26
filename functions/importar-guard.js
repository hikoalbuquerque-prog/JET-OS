// importar-guard.js
// Executar: node importar-guard.js
// Colocar este arquivo em: C:\Users\hikoa\Downloads\Jet OS\functions\
// Colocar JET_Guard.xlsx em: C:\Users\hikoa\Downloads\Jet OS\JET_Guard.xlsx

const admin = require('firebase-admin');
const XLSX  = require('xlsx');
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

// ── Init ──────────────────────────────────────────────────────────────────────
admin.initializeApp({ projectId: 'jet-os-1' });
const db      = admin.firestore();
const storage = admin.storage().bucket('jet-os-1.firebasestorage.app');

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(v) {
  if (v === null || v === undefined || v === 'NaN' || v !== v) return '';
  return String(v).trim();
}

function normalizeStatus(s) {
  const m = {
    'recuperado':'Recuperado','recuperados':'Recuperado',
    'encerrado':'Encerrado','aberto':'Aberto',
    'em apuracao':'Em apuracao','em apuração':'Em apuracao',
  };
  return m[s.toLowerCase()] || s;
}

function normalizeTipo(s) {
  const m = {
    'roubo':'Roubo','furto':'Furto','vandalismo':'Vandalismo',
    'tentativa':'Tentativa','recuperacao':'Recuperacao','alarme':'Alarme',
  };
  return m[s.toLowerCase()] || s;
}

function normalizeAtivo(s) {
  const m = {'patinete':'Patinete','bateria':'Bateria','bicicleta':'Bicicleta'};
  return m[s.toLowerCase()] || s;
}

function parseLatLng(v) {
  if (!v || v === 0) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseDate(v) {
  if (!v || v === 'NaT' || v !== v) return null;
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
  } catch { return null; }
}

function driveToDirectUrl(url) {
  if (!url || url === 'NaN') return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  return url.startsWith('http') ? url : null;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function migrarFoto(url, ocorrenciaId, index) {
  const directUrl = driveToDirectUrl(url);
  if (!directUrl) return null;
  try {
    const { buffer, contentType } = await fetchBuffer(directUrl);
    if (!contentType.startsWith('image/')) {
      console.log(`    ⚠ Foto ${index} não é imagem (${contentType}) — mantendo URL original`);
      return url;
    }
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const destPath = `ocorrencias/${ocorrenciaId}/foto${index}.${ext}`;
    const file = storage.file(destPath);
    await file.save(buffer, { metadata: { contentType }, public: true });
    const publicUrl = `https://storage.googleapis.com/jet-os-1.firebasestorage.app/${destPath}`;
    console.log(`    ✅ Foto ${index} → Storage`);
    return publicUrl;
  } catch (e) {
    console.log(`    ⚠ Foto ${index} falhou (${e.message}) — mantendo URL Drive`);
    return url; // mantém URL original
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Procura o xlsx em vários lugares
  const candidatos = [
    path.join(__dirname, '..', 'JET_Guard.xlsx'),
    path.join(__dirname, 'JET_Guard.xlsx'),
    path.join('C:\\Users\\hikoa\\Downloads\\Jet OS', 'JET_Guard.xlsx'),
  ];
  let xlsxPath = null;
  for (const c of candidatos) {
    if (fs.existsSync(c)) { xlsxPath = c; break; }
  }
  if (!xlsxPath) {
    console.error('JET_Guard.xlsx não encontrado. Coloque na pasta:');
    console.error('  C:\\Users\\hikoa\\Downloads\\Jet OS\\JET_Guard.xlsx');
    process.exit(1);
  }
  console.log(`📂 Lendo: ${xlsxPath}`);

  const wb   = XLSX.readFile(xlsxPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['INCIDENTES']);
  console.log(`📋 ${rows.length} incidentes encontrados\n`);

  let criados = 0, pulados = 0, erros = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id  = norm(row['id']);
    if (!id) { pulados++; continue; }

    process.stdout.write(`[${i+1}/${rows.length}] ${id} ... `);

    // Verifica se já existe
    const existDoc = await db.collection('ocorrencias').doc(id).get();
    if (existDoc.exists) {
      console.log('⏭ já existe');
      pulados++;
      continue;
    }

    // Migra fotos
    let foto1 = norm(row['foto1_url']) || null;
    let foto2 = norm(row['foto2_url']) || null;
    if (foto1) { console.log(''); foto1 = await migrarFoto(foto1, id, 1) || foto1; }
    if (foto2) foto2 = await migrarFoto(foto2, id, 2) || foto2;

    try {
      await db.collection('ocorrencias').doc(id).set({
        id,
        tipo:            normalizeTipo(norm(row['tipo'])),
        ativo_tipo:      normalizeAtivo(norm(row['ativo_tipo'])),
        status:          normalizeStatus(norm(row['status'])),
        prioridade:      norm(row['prioridade']) || 'Média',
        asset_id:        norm(row['asset_id'])   || '',
        descricao:       norm(row['descricao'])  || '',
        responsavel:     norm(row['responsavel']) || '',
        origem_registro: 'importado_guard_xlsx',
        lat_inicial:     parseLatLng(row['lat_inicial']),
        lng_inicial:     parseLatLng(row['lng_inicial']),
        endereco_inicial: norm(row['endereco_inicial']),
        bairro_inicial:   norm(row['bairro_inicial']),
        cidade_inicial:   norm(row['cidade_inicial']),
        lat_final:     parseLatLng(row['lat_final']),
        lng_final:     parseLatLng(row['lng_final']),
        endereco_final: norm(row['endereco_final']),
        bairro_final:   norm(row['bairro_final']),
        cidade_final:   norm(row['cidade_final']),
        data_fechamento:      parseDate(row['data_fechamento']),
        resultado:            norm(row['resultado']),
        observacao_fechamento: norm(row['observacao_fechamento']),
        foto1_url: foto1,
        foto2_url: foto2,
        criadoEm:  parseDate(row['created_at']) || admin.firestore.Timestamp.now(),
        updated_at: parseDate(row['updated_at']) || admin.firestore.Timestamp.now(),
      });
      if (!foto1) console.log('✅');
      else process.stdout.write('    ✅ salvo\n');
      criados++;
    } catch(e) {
      console.log(`❌ ${e.message}`);
      erros++;
    }
  }

  // Importa tabela de roubos
  console.log('\n📊 Importando tabela de roubos...');
  const rows2 = XLSX.utils.sheet_to_json(wb.Sheets['Cópia de ROUBOS'], { header: 1 });
  const dados = rows2
    .slice(2)
    .filter(r => r[0] && r[0] !== 'Região' && r[0] !== 'TOTAL GERAL' && r[1])
    .map(r => ({
      regiao:             norm(r[0]),
      filial:             norm(r[1]),
      patineteFurtados:   parseInt(r[2])  || 0,
      bicicletasFurtadas: parseInt(r[3])  || 0,
      bateriasFurtadas:   parseInt(r[4])  || 0,
      total:              parseInt(r[5])  || 0,
      periodo:            norm(r[6])      || 'desde o início',
    }));

  await db.collection('config').doc('roubos_historico').set({
    dados,
    atualizadoEm: admin.firestore.Timestamp.now(),
    fonte: 'JET_Guard.xlsx',
  });
  console.log(`✅ ${dados.length} regiões salvas em config/roubos_historico`);

  console.log(`\n🎉 CONCLUÍDO — Criados: ${criados} | Pulados: ${pulados} | Erros: ${erros}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
