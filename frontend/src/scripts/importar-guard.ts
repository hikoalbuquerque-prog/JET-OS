// scripts/importar-guard.ts
// Importa 531 incidentes do JET_Guard.xlsx para Firestore (coleção: ocorrencias)
// e tenta migrar fotos do Google Drive para Firebase Storage
//
// Executar:
//   cd "C:\Users\hikoa\Downloads\Jet OS\functions"
//   npx ts-node scripts/importar-guard.ts
//
// Dependências extras:
//   npm install xlsx node-fetch@2 form-data

import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// ── Init Firebase Admin ────────────────────────────────────────────────────────
admin.initializeApp({ projectId: 'jet-os-1' });
const db      = admin.firestore();
const storage = admin.storage().bucket('jet-os-1.firebasestorage.app');

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeStr(s: any): string {
  if (!s || s === 'NaN' || s === 'nan') return '';
  return String(s).trim();
}

function normalizeStatus(s: string): string {
  const m: Record<string, string> = {
    'recuperado': 'Recuperado', 'recuperados': 'Recuperado',
    'encerrado': 'Encerrado',   'aberto': 'Aberto',
    'em apuracao': 'Em apuracao', 'em apuração': 'Em apuracao',
  };
  return m[s.toLowerCase()] ?? s;
}

function normalizeTipo(s: string): string {
  const m: Record<string, string> = {
    'roubo': 'Roubo', 'furto': 'Furto', 'vandalismo': 'Vandalismo',
    'tentativa': 'Tentativa', 'recuperacao': 'Recuperacao', 'alarme': 'Alarme',
  };
  return m[s.toLowerCase()] ?? s;
}

function normalizeAtivo(s: string): string {
  const m: Record<string, string> = { 'patinete': 'Patinete', 'bateria': 'Bateria', 'bicicleta': 'Bicicleta' };
  return m[s.toLowerCase()] ?? s;
}

function parseLatLng(v: any): number | null {
  if (!v || v === 'NaN' || v === 0) return null;
  const s = String(v).replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDate(v: any): admin.firestore.Timestamp | null {
  if (!v || v === 'NaT') return null;
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
  } catch { return null; }
}

// Converte URL do Drive para URL direta de download
function driveToDirectUrl(url: string): string | null {
  if (!url || url === 'NaN') return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  return url.startsWith('http') ? url : null;
}

// Download de foto e upload para Firebase Storage
async function migrarFoto(
  url: string,
  ocorrenciaId: string,
  index: 1 | 2
): Promise<string | null> {
  const directUrl = driveToDirectUrl(url);
  if (!directUrl) return null;

  try {
    // @ts-ignore
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(directUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      timeout: 15000,
    });

    if (!res.ok) {
      console.warn(`  ⚠ Foto ${index} HTTP ${res.status}: ${url}`);
      return url; // mantém URL original se não conseguir baixar
    }

    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      console.warn(`  ⚠ Foto ${index} não é imagem (${contentType}): ${url}`);
      return url;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext    = contentType.includes('png') ? 'png' : 'jpg';
    const destPath = `ocorrencias/${ocorrenciaId}/foto${index}.${ext}`;

    const file = storage.file(destPath);
    await file.save(buffer, {
      metadata: { contentType },
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/jet-os-1.firebasestorage.app/${destPath}`;
    console.log(`  ✅ Foto ${index} migrada: ${publicUrl}`);
    return publicUrl;
  } catch (e: any) {
    console.warn(`  ⚠ Erro ao migrar foto ${index}: ${e.message}`);
    return url; // mantém URL original
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const xlsxPath = path.join(__dirname, '..', '..', 'JET_Guard.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    console.error(`Arquivo não encontrado: ${xlsxPath}`);
    console.error('Colocar JET_Guard.xlsx na pasta raiz do projeto Jet OS');
    process.exit(1);
  }

  const wb  = XLSX.readFile(xlsxPath);
  const ws  = wb.Sheets['INCIDENTES'];
  const rows = XLSX.utils.sheet_to_json(ws) as any[];

  console.log(`\n📋 ${rows.length} incidentes para importar\n`);

  // Verifica quantos já existem
  const existSnap = await db.collection('ocorrencias')
    .where('origem_registro', '==', 'importado_guard_xlsx')
    .limit(1).get();

  if (!existSnap.empty) {
    console.log('⚠ Importação anterior detectada. Continuando (não duplica por ID).\n');
  }

  let criados  = 0;
  let pulados  = 0;
  let erros    = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Batch ${Math.floor(i/BATCH_SIZE)+1} (${i+1}-${Math.min(i+BATCH_SIZE, rows.length)}) ---`);

    for (const row of batch) {
      const id = normalizeStr(row['id']);
      if (!id) { pulados++; continue; }

      // Verifica se já existe
      const existDoc = await db.collection('ocorrencias').doc(id).get();
      if (existDoc.exists) {
        console.log(`  ⏭ Pulando ${id} (já existe)`);
        pulados++;
        continue;
      }

      const latInicial = parseLatLng(row['lat_inicial']);
      const lngInicial = parseLatLng(row['lng_inicial']);
      const latFinal   = parseLatLng(row['lat_final']);
      const lngFinal   = parseLatLng(row['lng_final']);

      // Migra fotos
      let foto1Url = normalizeStr(row['foto1_url']) || null;
      let foto2Url = normalizeStr(row['foto2_url']) || null;

      if (foto1Url) foto1Url = await migrarFoto(foto1Url, id, 1) ?? foto1Url;
      if (foto2Url) foto2Url = await migrarFoto(foto2Url, id, 2) ?? foto2Url;

      try {
        await db.collection('ocorrencias').doc(id).set({
          id,
          tipo:           normalizeTipo(normalizeStr(row['tipo'])),
          ativo_tipo:     normalizeAtivo(normalizeStr(row['ativo_tipo'])),
          status:         normalizeStatus(normalizeStr(row['status'])),
          prioridade:     normalizeStr(row['prioridade']) || 'Média',
          asset_id:       normalizeStr(row['asset_id'])  || '',
          descricao:      normalizeStr(row['descricao']) || '',
          responsavel:    normalizeStr(row['responsavel']) || '',
          origem_registro: 'importado_guard_xlsx',

          // Localização inicial
          lat_inicial:      latInicial,
          lng_inicial:      lngInicial,
          endereco_inicial: normalizeStr(row['endereco_inicial']),
          bairro_inicial:   normalizeStr(row['bairro_inicial']),
          cidade_inicial:   normalizeStr(row['cidade_inicial']),

          // Localização final
          lat_final:      latFinal,
          lng_final:      lngFinal,
          endereco_final: normalizeStr(row['endereco_final']),
          bairro_final:   normalizeStr(row['bairro_final']),
          cidade_final:   normalizeStr(row['cidade_final']),

          // Fechamento
          data_fechamento:      parseDate(row['data_fechamento']),
          resultado:            normalizeStr(row['resultado']),
          observacao_fechamento: normalizeStr(row['observacao_fechamento']),

          // Fotos
          foto1_url: foto1Url || null,
          foto2_url: foto2Url || null,

          // Timestamps
          criadoEm:   parseDate(row['created_at']) ?? admin.firestore.Timestamp.now(),
          updated_at: parseDate(row['updated_at'])  ?? admin.firestore.Timestamp.now(),
        });

        console.log(`  ✅ ${id} — ${normalizeTipo(row['tipo'])} em ${normalizeStr(row['cidade_inicial'])}`);
        criados++;
      } catch (e: any) {
        console.error(`  ❌ ${id}: ${e.message}`);
        erros++;
      }
    }
  }

  // Importar tabela de roubos
  console.log('\n\n📊 Importando tabela de roubos...');
  const ws2  = wb.Sheets['Cópia de ROUBOS'];
  const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1 }) as any[][];

  const rouboData = rows2
    .slice(2) // pula header duplo
    .filter(r => r[0] && r[0] !== 'Região' && r[0] !== 'TOTAL GERAL')
    .map(r => ({
      regiao:            normalizeStr(r[0]),
      filial:            normalizeStr(r[1]),
      patineteFurtados:  parseInt(r[2]) || 0,
      bicicletasFurtadas: parseInt(r[3]) || 0,
      bateriasFurtadas:  parseInt(r[4]) || 0,
      total:             parseInt(r[5]) || 0,
      periodo:           normalizeStr(r[6]) || 'desde o início',
    }));

  await db.collection('config').doc('roubos_historico').set({
    dados:       rouboData,
    atualizadoEm: admin.firestore.Timestamp.now(),
    fonte:       'JET_Guard.xlsx',
  });

  console.log(`✅ ${rouboData.length} registros de roubos salvos em config/roubos_historico`);

  console.log(`\n\n🎉 IMPORTAÇÃO CONCLUÍDA`);
  console.log(`   Criados:  ${criados}`);
  console.log(`   Pulados:  ${pulados}`);
  console.log(`   Erros:    ${erros}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
