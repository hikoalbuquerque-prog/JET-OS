#!/usr/bin/env node
// backfill-storage-fotos.mjs — Baixa fotos de ocorrências do Firebase Storage,
// faz upload para Supabase Storage (bucket "ocorrencias") e atualiza as URLs
// na tabela ocorrencias.
//
// Uso:
//   DRY_RUN=1 node supabase/scripts/backfill-storage-fotos.mjs   # lista sem copiar
//   node supabase/scripts/backfill-storage-fotos.mjs              # migra tudo
//
// Env vars:
//   SUPABASE_URL             — URL do projeto Supabase
//   SUPABASE_SERVICE_ROLE    — Service role key (ignora RLS)
//
// Firebase Storage URLs são públicas (contêm token de download), então
// NÃO é necessário firebase-admin para baixar — um fetch simples basta.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE;
const DRY           = process.env.DRY_RUN === '1';
const BUCKET        = 'ocorrencias';
const BATCH_SIZE    = 100;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE no env.');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

// Detecta se a URL é do Firebase Storage
function isFirebaseUrl(url) {
  if (!url) return false;
  return url.includes('firebasestorage.googleapis.com') ||
         url.includes('firebasestorage.app');
}

// Extrai um nome de arquivo da URL do Firebase para usar como key no Supabase
function extractKey(url, docId, slot) {
  // Tenta extrair extensão da URL
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const ext = path.match(/\.(jpe?g|png|webp|gif|heic|pdf)$/i)?.[0] || '.jpg';
    return `${docId}_${slot}${ext}`;
  } catch {
    return `${docId}_${slot}.jpg`;
  }
}

async function downloadFile(url) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
  const ct = resp.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buf, contentType: ct };
}

async function uploadToSupabase(key, buf, contentType) {
  const { error } = await supa.storage.from(BUCKET).upload(key, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supa.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

async function updateUrl(id, field, newUrl) {
  const { error } = await supa
    .from('ocorrencias')
    .update({ [field]: newUrl })
    .eq('id', id);
  if (error) throw error;
}

async function main() {
  console.log(DRY ? '=== DRY RUN ===' : '=== MIGRANDO FOTOS ===');

  let offset = 0;
  let total = 0, migrated = 0, skipped = 0, errors = 0;
  const failures = [];

  while (true) {
    const { data: rows, error } = await supa
      .from('ocorrencias')
      .select('id, firebase_doc_id, foto1_url, foto2_url')
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) { console.error('Erro ao consultar:', error); break; }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const slots = [
        { field: 'foto1_url', url: row.foto1_url, slot: 'foto1' },
        { field: 'foto2_url', url: row.foto2_url, slot: 'foto2' },
      ];

      for (const { field, url, slot } of slots) {
        if (!isFirebaseUrl(url)) { continue; }
        total++;

        const docId = row.firebase_doc_id || row.id;
        const key = extractKey(url, docId, slot);

        if (DRY) {
          console.log(`  [dry] ${docId}/${slot}: ${url.slice(0, 80)}...`);
          skipped++;
          continue;
        }

        try {
          const { buf, contentType } = await downloadFile(url);
          const newUrl = await uploadToSupabase(key, buf, contentType);
          await updateUrl(row.id, field, newUrl);
          migrated++;
          if (migrated % 25 === 0) console.log(`  ... ${migrated} migradas`);
        } catch (e) {
          errors++;
          const msg = `${docId}/${slot}: ${e.message || e}`;
          console.error(`  ERRO ${msg}`);
          failures.push(msg);
        }
      }
    }

    offset += BATCH_SIZE;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log('\n=== RESULTADO ===');
  console.log(`Total URLs Firebase encontradas: ${total}`);
  console.log(`Migradas com sucesso: ${migrated}`);
  console.log(`Puladas (dry run): ${skipped}`);
  console.log(`Erros: ${errors}`);
  if (failures.length > 0) {
    console.log('\nFalhas:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
