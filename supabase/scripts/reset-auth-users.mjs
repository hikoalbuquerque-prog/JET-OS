// ============================================================================
// JET OS — Reset dos usuários do Supabase Auth (limpeza da migração do projeto
// ERRADO jet-os-7). Apaga TODOS os usuários do GoTrue (e, por cascata da FK,
// as linhas de public.usuarios). Use ANTES de re-rodar preprovision contra o
// jet-os-1. NÃO toca no Firebase.
//
// Uso (cmd):
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role>
//   node reset-auth-users.mjs
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let apagados = 0, erros = 0;
for (;;) {
  // sempre lê a página 1 — a lista encolhe conforme apagamos
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) { console.error('listUsers:', error.message); process.exit(1); }
  const users = data?.users ?? [];
  if (!users.length) break;
  for (const u of users) {
    const { error: delErr } = await sb.auth.admin.deleteUser(u.id);
    if (delErr) { console.error(`  del ${u.email}:`, delErr.message); erros++; }
    else apagados++;
  }
  if (erros) break; // evita loop infinito se algum não apaga
}
console.log(`== Reset Auth == apagados=${apagados} erros=${erros}`);
process.exit(erros ? 1 : 0);
