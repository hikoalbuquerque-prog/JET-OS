// ============================================================================
// JET OS — Backfill de campos faltantes em public.usuarios (Supabase)
//
// Lê do Firestore (usuarios/{uid}) e preenche no Supabase os campos que o
// preprovision-auth.mjs não copiou:
//   tipo_cadastro, status_prestador, cidades_gerencia_log, senha_temporaria, paises
//
// Idempotente: só atualiza campos que estão null/vazio no Supabase.
//
// Pré-requisitos (PowerShell):
//   $env:SUPABASE_URL="https://ducdbrupxpzqcblfreqn.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\serviceAccount.json"
//   node backfill-usuarios.mjs
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp();
const fbDb = getFirestore();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let atualiz = 0, pulados = 0, erros = 0;

(async () => {
  // Busca todos os usuarios do Supabase que têm firebase_uid
  const { data: supaUsers, error } = await sb
    .from('usuarios')
    .select('id, firebase_uid, tipo_cadastro, status_prestador, cidades_gerencia_log, senha_temporaria, paises')
    .not('firebase_uid', 'is', null);

  if (error) { console.error('Erro ao ler Supabase:', error.message); process.exit(1); }
  console.log(`Supabase: ${supaUsers.length} usuários com firebase_uid`);

  for (const su of supaUsers) {
    try {
      const doc = await fbDb.collection('usuarios').doc(su.firebase_uid).get();
      if (!doc.exists) { pulados++; continue; }
      const fb = doc.data();

      const patch = {};

      if (!su.tipo_cadastro && fb.tipoCadastro)
        patch.tipo_cadastro = fb.tipoCadastro;

      if (!su.status_prestador && fb.statusPrestador)
        patch.status_prestador = fb.statusPrestador;

      if ((!su.cidades_gerencia_log || su.cidades_gerencia_log.length === 0) && fb.cidadesGerenciaLog?.length)
        patch.cidades_gerencia_log = fb.cidadesGerenciaLog;

      if (su.senha_temporaria === null && fb.senhaTemporaria != null)
        patch.senha_temporaria = !!fb.senhaTemporaria;

      if ((!su.paises || su.paises.length === 0) && fb.paises?.length)
        patch.paises = fb.paises;

      if (Object.keys(patch).length === 0) { pulados++; continue; }

      const { error: upErr } = await sb.from('usuarios').update(patch).eq('id', su.id);
      if (upErr) { console.error(`  [${su.firebase_uid}] update:`, upErr.message); erros++; continue; }

      console.log(`  ✓ ${su.firebase_uid}: ${Object.keys(patch).join(', ')}`);
      atualiz++;
    } catch (e) {
      console.error(`  [${su.firebase_uid}] erro:`, e.message);
      erros++;
    }
  }

  console.log(`\n== Backfill concluído: ${atualiz} atualizados, ${pulados} pulados, ${erros} erros ==`);
})();
