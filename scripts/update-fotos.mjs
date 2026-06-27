#!/usr/bin/env node
// Extrai hyperlinks de Foto e Croqui do xlsx e atualiza estacoes no Supabase

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const SUPABASE_URL = 'https://ducdbrupxpzqcblfreqn.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4';

function extractUrl(cell) {
  if (!cell?.f) return null;
  const m = cell.f.match(/HYPERLINK\("([^"]+)"/);
  return m ? m[1] : null;
}

const wb = XLSX.readFile('scripts/Estacionamentos de Curitiba.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(ws['!ref']);

const updates = []; // {codigo, foto, croqui}
let noLink = 0;

for (let r = range.s.r + 1; r <= range.e.r; r++) {
  const codigoCell = ws[XLSX.utils.encode_cell({ r, c: 1 })]; // col B = Código
  const fotoCell   = ws[XLSX.utils.encode_cell({ r, c: 6 })]; // col G = Foto
  const croquiCell = ws[XLSX.utils.encode_cell({ r, c: 7 })]; // col H = Croqui

  const codigo = codigoCell?.v?.toString().trim();
  if (!codigo) continue;

  const foto = extractUrl(fotoCell);
  const croqui = extractUrl(croquiCell);

  if (foto || croqui) {
    updates.push({ codigo, foto, croqui });
  } else {
    noLink++;
  }
}

console.log(`Extracted ${updates.length} stations with links (${noLink} without links)`);
console.log(`Sample:`, updates.slice(0, 3));

// Update in batches via Supabase REST API
const BATCH = 50;
let updated = 0;
let errors = 0;

for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH);
  const promises = batch.map(async (u) => {
    const imagens = {};
    if (u.foto) imagens.foto = u.foto;
    if (u.croqui) imagens.croqui = u.croqui;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/estacoes?codigo=eq.${encodeURIComponent(u.codigo)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ imagens }),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      console.error(`  FAIL ${u.codigo}: ${res.status} ${t}`);
      errors++;
    } else {
      updated++;
    }
  });
  await Promise.all(promises);
  process.stdout.write(`\rUpdated ${updated}/${updates.length}...`);
}

console.log(`\nDone! Updated ${updated} stations, ${errors} errors.`);
