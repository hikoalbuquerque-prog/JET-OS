#!/usr/bin/env node
// migrate-storage.mjs — copia todos os arquivos do Firebase Storage → Supabase Storage (bucket "uploads").
// Usa: firebase-admin (listFiles) + @supabase/supabase-js (upload).
//
// Uso:
//   DRY_RUN=1 node supabase/scripts/migrate-storage.mjs   # lista sem copiar
//   node supabase/scripts/migrate-storage.mjs              # copia tudo
//
// Pré-req: GOOGLE_APPLICATION_CREDENTIALS apontando pro service account do Firebase,
//          SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no env.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { createClient } from '@supabase/supabase-js';

const DRY = process.env.DRY_RUN === '1';

// Firebase
if (!getApps().length) {
  initializeApp({ storageBucket: 'jet-os-1.firebasestorage.app' });
}
const bucket = getStorage().bucket();

// Supabase
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
function bucketFor(name) {
  if (name.startsWith('ocorrencias/')) return 'ocorrencias';
  return 'uploads';
}

async function main() {
  console.log(DRY ? '=== DRY RUN ===' : '=== MIGRATING ===');

  const [files] = await bucket.getFiles();
  console.log(`Firebase Storage: ${files.length} arquivos`);

  let ok = 0, skip = 0, err = 0;

  for (const file of files) {
    const name = file.name;
    if (!name || name.endsWith('/')) { skip++; continue; }

    // Verifica se já existe no Supabase
    const targetBucket = bucketFor(name);
    const { data: existing } = await supa.storage.from(targetBucket).list(
      name.substring(0, name.lastIndexOf('/')),
      { search: name.substring(name.lastIndexOf('/') + 1), limit: 1 }
    );
    if (existing && existing.length > 0) {
      skip++;
      continue;
    }

    if (DRY) {
      console.log(`  [dry] ${name}`);
      ok++;
      continue;
    }

    try {
      const [buf] = await file.download();
      const contentType = file.metadata?.contentType || 'application/octet-stream';
      const { error } = await supa.storage.from(targetBucket).upload(name, buf, {
        contentType,
        upsert: false,
      });
      if (error) {
        if (error.message?.includes('already exists')) { skip++; continue; }
        throw error;
      }
      ok++;
      if (ok % 50 === 0) console.log(`  ... ${ok} copiados`);
    } catch (e) {
      console.error(`  ERRO ${name}:`, e.message || e);
      err++;
    }
  }

  console.log(`\nResultado: ${ok} copiados, ${skip} pulados, ${err} erros`);
}

main().catch(e => { console.error(e); process.exit(1); });
