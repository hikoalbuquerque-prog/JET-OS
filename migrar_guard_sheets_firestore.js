#!/usr/bin/env node
// migrar_guard_sheets_firestore.js
// Importa ocorrências do Google Sheets (JET Guard) para o Firestore
// Uso: node migrar_guard_sheets_firestore.js
//
// Pré-requisitos:
//   npm install googleapis firebase-admin
//   Coloque o serviceAccountKey.json na mesma pasta
//   Defina SPREADSHEET_ID e SHEET_NAME abaixo

'use strict';

const { google }      = require('googleapis');
const admin           = require('firebase-admin');
const path            = require('path');
const fs              = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────
const SPREADSHEET_ID  = '1XmcABotxnJfXX1cFs7dJYnfE-x4msOL_Ig_0WjGbmEY';   // ID da planilha do JET Guard
const SHEET_NAME      = 'INCIDENTES';                 // nome da aba
const SERVICE_ACCOUNT = path.join(__dirname, 'serviceAccountKey.json');
const DRY_RUN         = false;  // true = só loga, não salva

// ── MAPEAMENTO DE COLUNAS (igual ao GAS) ─────────────────────────
// Ajuste se a planilha tiver colunas em ordem diferente
const COL = {
  id:                    0,
  created_at:            1,
  updated_at:            2,
  ativo_tipo:            3,
  tipo:                  4,
  status:                5,
  prioridade:            6,
  asset_id:              7,
  descricao:             8,
  responsavel:           9,
  origem_registro:       10,
  endereco_inicial:      11,
  bairro_inicial:        12,
  cidade_inicial:        13,
  lat_inicial:           14,
  lng_inicial:           15,
  lat_final:             16,
  lng_final:             17,
  endereco_final:        18,
  bairro_final:          19,
  cidade_final:          20,
  data_fechamento:       21,
  resultado:             22,
  observacao_fechamento: 23,
  foto1_url:             24,
  foto2_url:             25,
};

// ── STATUS MAP ────────────────────────────────────────────────────
const STATUS_MAP = {
  'Aberto':       'Aberto',
  'Em apuracao':  'Em apuração',
  'Em apuração':  'Em apuração',
  'Recuperado':   'Recuperado',
  'Recuperacao':  'Recuperado',
  'Encerrado':    'Encerrado',
  'Fechado':      'Encerrado',
};

function norm(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function toNum(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function rowToDoc(row) {
  const id = norm(row[COL.id]);
  if (!id) return null;

  const lat = toNum(row[COL.lat_inicial]);
  const lng = toNum(row[COL.lng_inicial]);

  const status = STATUS_MAP[norm(row[COL.status])] || norm(row[COL.status]) || 'Encerrado';
  const tipo   = norm(row[COL.tipo]);

  const doc = {
    id,
    tipo,
    ativo_tipo:            norm(row[COL.ativo_tipo]) || 'Patinete',
    status,
    prioridade:            norm(row[COL.prioridade]) || 'Media',
    asset_id:              norm(row[COL.asset_id]),
    descricao:             norm(row[COL.descricao]),
    responsavel:           norm(row[COL.responsavel]),
    origem_registro:       norm(row[COL.origem_registro]) || 'Guard',
    endereco_inicial:      norm(row[COL.endereco_inicial]),
    bairro_inicial:        norm(row[COL.bairro_inicial]),
    cidade_inicial:        norm(row[COL.cidade_inicial]),
    lat_inicial:           lat,
    lng_inicial:           lng,
    lat_final:             toNum(row[COL.lat_final]),
    lng_final:             toNum(row[COL.lng_final]),
    endereco_final:        norm(row[COL.endereco_final]),
    bairro_final:          norm(row[COL.bairro_final]),
    cidade_final:          norm(row[COL.cidade_final]),
    resultado:             norm(row[COL.resultado]),
    observacao_fechamento: norm(row[COL.observacao_fechamento]),
    foto1_url:             norm(row[COL.foto1_url]),
    foto2_url:             norm(row[COL.foto2_url]),
    // Guard: sem uid real, usar email como referência
    registradoPor:         norm(row[COL.responsavel]) || 'importado',
    registradoPorNome:     norm(row[COL.responsavel]) || 'Importado',
    turno:                 'Importado do Sheets',
    _importado:            true,
  };

  // Datas
  const criadoEm    = toDate(row[COL.created_at]);
  const updatedAt   = toDate(row[COL.updated_at]);
  const fechamento  = toDate(row[COL.data_fechamento]);

  if (criadoEm)   doc.criadoEm       = admin.firestore.Timestamp.fromDate(criadoEm);
  if (updatedAt)  doc.updated_at     = admin.firestore.Timestamp.fromDate(updatedAt);
  if (fechamento) doc.data_fechamento = admin.firestore.Timestamp.fromDate(fechamento);

  // Remove campos nulos para não poluir o Firestore
  Object.keys(doc).forEach(k => {
    if (doc[k] === null || doc[k] === '') delete doc[k];
  });

  return doc;
}

async function main() {
  console.log('🛡 Migração JET Guard: Sheets → Firestore');
  console.log('━'.repeat(50));

  // Firebase Admin
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  const db = admin.firestore();

  // Google Sheets API
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`📊 Lendo planilha ${SPREADSHEET_ID} aba "${SHEET_NAME}"...`);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) {
    console.log('⚠️  Nenhum dado encontrado.');
    process.exit(0);
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  console.log(`📋 ${dataRows.length} linhas encontradas (excluindo cabeçalho)`);
  console.log(`   Colunas: ${headers.slice(0, 10).join(', ')}...`);
  console.log('');

  let ok = 0, skip = 0, erro = 0;
  const BATCH_SIZE = 400; // Firestore limita 500 por batch
  const collection = db.collection('ocorrencias');

  // Processa em batches
  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = dataRows.slice(i, i + BATCH_SIZE);
    let batchCount = 0;

    for (const row of chunk) {
      try {
        const docData = rowToDoc(row);
        if (!docData) { skip++; continue; }

        // Usa o ID do Sheets como ID do documento no Firestore
        const docRef = collection.doc(docData.id);

        // Verifica se já existe para não duplicar
        const existing = await docRef.get();
        if (existing.exists) {
          console.log(`  ⏭  Pulando (já existe): ${docData.id}`);
          skip++;
          continue;
        }

        if (!DRY_RUN) {
          batch.set(docRef, docData);
          batchCount++;
        }

        ok++;
        if (ok % 50 === 0) {
          process.stdout.write(`  ✓ ${ok} processados...\r`);
        }
      } catch (e) {
        console.error(`  ✗ Erro na linha ${i}: ${e.message}`);
        erro++;
      }
    }

    if (!DRY_RUN && batchCount > 0) {
      await batch.commit();
    }
  }

  console.log('');
  console.log('━'.repeat(50));
  console.log(`✅ Migração concluída!`);
  console.log(`   ✓ Importados:   ${ok}`);
  console.log(`   ⏭  Pulados:     ${skip}`);
  console.log(`   ✗ Erros:        ${erro}`);
  if (DRY_RUN) console.log('   ⚠️  DRY_RUN=true — nada foi salvo');
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
