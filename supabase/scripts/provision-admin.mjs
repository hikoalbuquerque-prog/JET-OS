// ============================================================================
// JET OS — Provisiona UMA conta admin específica no Supabase (one-off).
// Usado quando a conta existe no Firebase mas não veio no listUsers() do
// preprovision (ex.: conta admin henrique.ai.dev). Cria no Supabase Auth
// (sem senha — senha vem na 1ª vez via auth-login) e preenche public.usuarios.
//
// Idempotente: se já existir no Auth, reusa e só atualiza o perfil.
//
// Uso (cmd):
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role NOVA>
//   node provision-admin.mjs
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// Parametrizável por env (cmd): set PV_EMAIL=... & set PV_FB_UID=... & set PV_ROLE=... & set PV_NOME=...
// Sem env, usa a conta admin (default histórico).
const EMAIL = process.env.PV_EMAIL || 'henrique.ai.dev@gmail.com';
const FIREBASE_UID = process.env.PV_FB_UID || 'uvMiotPnMdUsHa66kKBgq9SHhEk1';
const ROLE = process.env.PV_ROLE || 'admin';
const NOME = process.env.PV_NOME || 'Henrique';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

(async () => {
  // 1) cria no Supabase Auth (ou acha se já existir)
  let supaId;
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL, email_confirm: true, user_metadata: { nome: NOME },
  });
  if (error) {
    const { data: list } = await sb.auth.admin.listUsers();
    const found = list?.users?.find(x => x.email?.toLowerCase() === EMAIL.toLowerCase());
    if (!found) { console.error('createUser falhou:', error.message); process.exit(1); }
    supaId = found.id;
    console.log('Já existia no Auth, reusando:', supaId);
  } else {
    supaId = data.user.id;
    console.log('Criado no Auth:', supaId);
  }

  // 2) preenche public.usuarios
  const { error: upErr } = await sb.from('usuarios').update({
    firebase_uid: FIREBASE_UID, nome: NOME, email: EMAIL, role: ROLE, ativo: true,
  }).eq('id', supaId);
  if (upErr) { console.error('update usuarios falhou:', upErr.message); process.exit(1); }

  console.log('OK — perfil provisionado. firebase_uid =', FIREBASE_UID, '| supabase id =', supaId);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
