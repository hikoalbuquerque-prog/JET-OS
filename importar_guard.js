// importar_guard.js — Importar ocorrências do JET_Guard.xlsx para o Firestore
// Execução: node importar_guard.js
// Necessário: npm install firebase-admin xlsx
// Coloque serviceAccountKey.json na mesma pasta

const admin = require('firebase-admin');
const XLSX  = require('xlsx');
const path  = require('path');

// Inicializar Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const wb  = XLSX.readFile(path.join(__dirname, 'JET_Guard.xlsx'));
  const ws  = wb.Sheets['INCIDENTES'];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });

  console.log(`Total de linhas: ${raw.length}`);

  // ── PASSO 1: Excluir todas as ocorrências existentes ────────────
  console.log('\n[1/3] Excluindo ocorrências existentes...');
  const snap = await db.collection('ocorrencias').get();
  const batchDel = db.batch();
  let delCount = 0;
  snap.docs.forEach(doc => { batchDel.delete(doc.ref); delCount++; });
  if (delCount > 0) await batchDel.commit();
  console.log(`  Excluídas: ${delCount}`);

  // ── PASSO 2: Importar novas ocorrências ─────────────────────────
  console.log('\n[2/3] Importando ocorrências...');
  let ok = 0, skip = 0;

  const parseCoord = (v) => {
    if (!v) return 0;
    const s = String(v).replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const parseDate = (v) => {
    if (!v) return null;
    if (v instanceof Date) return admin.firestore.Timestamp.fromDate(v);
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
    }
    return null;
  };

  // Processar em lotes de 500
  const lotes = [];
  let lote = db.batch();
  let loteCount = 0;

  for (const row of raw) {
    const id = row['id'] || row['ID'];
    if (!id) { skip++; continue; }

    const docRef = db.collection('ocorrencias').doc(String(id));
    const doc = {
      id:                    String(id),
      tipo:                  row['tipo']           || 'Outro',
      ativo_tipo:            row['ativo_tipo']      || 'Patinete',
      status:                row['status']          || 'Aberto',
      prioridade:            row['prioridade']      || 'Média',
      asset_id:              row['asset_id'] ? String(row['asset_id']).split('.')[0] : '',
      descricao:             row['descricao']       || '',
      responsavel:           row['responsavel']     || '',
      registradoPorNome:     row['responsavel']     || '',
      origem_registro:       row['origem_registro'] || 'Importado',
      lat_inicial:           parseCoord(row['lat_inicial']),
      lng_inicial:           parseCoord(row['lng_inicial']),
      endereco_inicial:      row['endereco_inicial']   || '',
      bairro_inicial:        row['bairro_inicial']     || '',
      cidade_inicial:        row['cidade_inicial']     || '',
      lat_final:             parseCoord(row['lat_final']),
      lng_final:             parseCoord(row['lng_final']),
      endereco_final:        row['endereco_final']     || '',
      bairro_final:          row['bairro_final']       || '',
      cidade_final:          row['cidade_final']       || '',
      observacao_fechamento: row['observacao_fechamento'] || '',
      resultado:             row['resultado']           || '',
      bo_numero:             '',
      bo_url:                '',
      foto1_url:             row['foto1_url'] || '',
      foto2_url:             row['foto2_url'] || '',
      turno:                 'Manhã',
      procurando:            false,
      criadoEm:              parseDate(row['created_at']) || admin.firestore.FieldValue.serverTimestamp(),
      updated_at:            parseDate(row['updated_at'])  || admin.firestore.FieldValue.serverTimestamp(),
      data_fechamento:       parseDate(row['data_fechamento']),
      importadoEm:           admin.firestore.FieldValue.serverTimestamp(),
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

  console.log(`  Importadas: ${ok} | Puladas: ${skip}`);

  // ── PASSO 3: Salvar totais de roubos como documento especial ────
  console.log('\n[3/3] Salvando totais de roubos...');
  // Contagem real do arquivo (por fórmula os totais incluem +N histórico)
  // Salvar como documento separado para o Dashboard usar
  const totaisRoubos = {
    fonte: 'JET_Guard.xlsx - importado em ' + new Date().toISOString(),
    filiais: [
      { regiao: 'Norte', filial: 'Pará (Belém)',            patinetes: 1,  bicicletas: 0, baterias: 9  },
      { regiao: 'Norte', filial: 'Minas Gerais (BH)',       patinetes: 11, bicicletas: 0, baterias: 100 },
      { regiao: 'Norte', filial: 'Ceará (Fortaleza)',       patinetes: 3,  bicicletas: 0, baterias: 1  },
      { regiao: 'Norte', filial: 'Pernambuco (Recife)',     patinetes: 22, bicicletas: 0, baterias: 41 },
      { regiao: 'Norte', filial: 'Sergipe (Aracaju)',       patinetes: 0,  bicicletas: 2, baterias: 0  },
      { regiao: 'Norte', filial: 'Bahia (Salvador)',        patinetes: 3,  bicicletas: 0, baterias: 8  },
      { regiao: 'Norte', filial: 'Espírito Santo (ES)',     patinetes: 12, bicicletas: 0, baterias: 57 },
      { regiao: 'Norte', filial: 'RG Norte (Natal)',        patinetes: 5,  bicicletas: 0, baterias: 0  },
      { regiao: 'Centro', filial: 'SP Capital',             patinetes: 49, bicicletas: 0, baterias: 23 },
      { regiao: 'Centro', filial: 'SP Litoral',             patinetes: 21, bicicletas: 0, baterias: 5  },
      { regiao: 'Centro', filial: 'SP Estado (Campinas)',   patinetes: 0,  bicicletas: 0, baterias: 0  },
      { regiao: 'Sul',    filial: 'Distr. Fed. (Brasília)', patinetes: 1,  bicicletas: 1, baterias: 1  },
      { regiao: 'Sul',    filial: 'Santa Catarina',         patinetes: 8,  bicicletas: 2, baterias: 22 },
      { regiao: 'Sul',    filial: 'Paraná',                 patinetes: 0,  bicicletas: 0, baterias: 0  },
      { regiao: 'Sul',    filial: 'RG Sul (Porto Alegre)',  patinetes: 0,  bicicletas: 0, baterias: 2  },
    ],
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('config').doc('totais_roubos_historico').set(totaisRoubos);
  console.log('  Totais de roubos salvos em config/totais_roubos_historico');

  console.log('\n✅ Importação concluída!');
  process.exit(0);
}

main().catch(err => { console.error('ERRO:', err); process.exit(1); });
