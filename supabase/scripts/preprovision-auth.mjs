// ============================================================================
// JET OS — Fase 2 (Auth) — Pré-provisionamento de usuários Firebase -> Supabase
//
// Para cada usuário do Firebase Auth:
//   1) cria (ou reusa) o usuário no Supabase Auth (email, email_confirm, SEM senha);
//   2) preenche public.usuarios: firebase_uid, nome, email, cpf, role, cidade, etc.
//      (lendo de Firestore usuarios/{uid});
//   3) acumula o mapa firebase_uid -> supabase_uuid e salva em uid-map.json
//      (usado depois para migrar tarefas/slots/pagamentos/gps_history).
//
// A SENHA não é migrada aqui — vem na 1ª vez via a Edge Function auth-login
// (migração preguiçosa). O usuário só consegue logar após esse 1º login.
//
// Idempotente: re-rodar não duplica (pula quem já tem firebase_uid em usuarios).
//
// Pré-requisitos / variáveis (PowerShell):
//   $env:SUPABASE_URL="https://ducdbrupxpzqcblfreqn.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role NOVA>"
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\serviceAccount.json"   # Firebase Admin
//   $env:ONLY_ACTIVE="true"   # true = só ativos (recomendado); false = todos
//   node preprovision-auth.mjs
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

initializeApp(); // usa GOOGLE_APPLICATION_CREDENTIALS (ADC)
const fbAuth = getAuth();
const fbDb = getFirestore();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ONLY_ACTIVE = process.env.ONLY_ACTIVE !== 'false';   // default: só ativos

// roles válidos no enum user_role (Supabase). Fora disso -> viewer.
const ROLES = new Set(['admin','supergestor','gestor','gestor_log','viewer',
  'prestador','campo','charger','scalt','promotor','guard','logistica','desativado']);
const normRole = (r) => ROLES.has(r) ? r : 'viewer';

const map = {};   // firebase_uid -> supabase_uuid
let criados = 0, reusados = 0, pulados = 0, erros = 0;

async function listarTodosFirebase() {
  const out = [];
  let pageToken;
  do {
    const res = await fbAuth.listUsers(1000, pageToken);
    out.push(...res.users);
    pageToken = res.pageToken;
  } while (pageToken);
  return out;
}

async function perfilFirestore(uid) {
  const d = await fbDb.collection('usuarios').doc(uid).get();
  return d.exists ? d.data() : {};
}

(async () => {
  console.log(`== Pré-provisionamento Auth (ONLY_ACTIVE=${ONLY_ACTIVE}) ==`);
  const users = await listarTodosFirebase();
  console.log(`Firebase: ${users.length} usuários`);

  for (const u of users) {
    try {
      const prof = await perfilFirestore(u.uid);
      const ativo = prof.ativo !== false && prof.role !== 'desativado' && !u.disabled;
      if (ONLY_ACTIVE && !ativo) { pulados++; continue; }
      if (!u.email) { pulados++; continue; }       // sem email não dá p/ criar no GoTrue

      // já provisionado? (idempotência)
      const { data: existente } = await sb.from('usuarios').select('id').eq('firebase_uid', u.uid).maybeSingle();
      let supaId = existente?.id;

      if (!supaId) {
        // cria no Supabase Auth (GoTrue gera o uuid)
        const { data, error } = await sb.auth.admin.createUser({
          email: u.email, email_confirm: true,
          user_metadata: { nome: prof.nome ?? u.displayName ?? u.email },
        });
        if (error) {
          // e-mail já existe no Supabase? tenta achar por e-mail
          const { data: list } = await sb.auth.admin.listUsers();
          const found = list?.users?.find(x => x.email?.toLowerCase() === u.email.toLowerCase());
          if (!found) { console.error(`  [${u.email}] createUser:`, error.message); erros++; continue; }
          supaId = found.id; reusados++;
        } else { supaId = data.user.id; criados++; }
      } else { reusados++; }

      // preenche o perfil em public.usuarios
      await sb.from('usuarios').update({
        firebase_uid: u.uid,
        nome: prof.nome ?? u.displayName ?? null,
        email: u.email,
        cpf: prof.cpf ?? null,
        role: normRole(prof.role),
        cidade: prof.cidade ?? null,
        cidades_permitidas: prof.cidades ?? prof.cidadesPermitidas ?? [],
        cargo: prof.cargoPrestador ?? prof.cargo ?? null,
        ativo,
      }).eq('id', supaId);

      map[u.uid] = supaId;
    } catch (e) {
      console.error(`  [${u.email || u.uid}]`, e.message); erros++;
    }
  }

  writeFileSync('uid-map.json', JSON.stringify(map, null, 2));
  console.log(`== Fim == criados=${criados} reusados=${reusados} pulados=${pulados} erros=${erros}`);
  console.log(`Mapa de uid salvo em uid-map.json (${Object.keys(map).length} entradas) — usar no backfill.`);
  process.exit(erros ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
