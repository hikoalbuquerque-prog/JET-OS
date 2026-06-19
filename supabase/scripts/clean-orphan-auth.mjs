// ============================================================================
// JET OS — Limpa usuários ÓRFÃOS do Supabase Auth (sobras do jet-os-7):
// apaga do GoTrue todo usuário que NÃO tem linha correspondente em public.usuarios.
// Seguro: os 56 provisionados (jet-os-1) têm linha em usuarios e são preservados.
//
// Uso (cmd):
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role>
//   node clean-orphan-auth.mjs
// ============================================================================
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ids válidos (têm perfil em usuarios)
const validos = new Set();
{
  let from = 0; const N = 1000;
  for (;;) {
    const { data, error } = await sb.from('usuarios').select('id').range(from, from + N - 1);
    if (error) { console.error('usuarios:', error.message); process.exit(1); }
    for (const r of data) validos.add(r.id);
    if (data.length < N) break; from += N;
  }
}
console.log(`usuarios válidos: ${validos.size}`);

let apagados = 0, mantidos = 0, erros = 0;
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('listUsers:', error.message); process.exit(1); }
  const users = data?.users ?? [];
  if (!users.length) break;
  for (const u of users) {
    if (validos.has(u.id)) { mantidos++; continue; }
    const { error: delErr } = await sb.auth.admin.deleteUser(u.id);
    if (delErr) { console.error(`  del ${u.email}:`, delErr.message); erros++; }
    else apagados++;
  }
  if (users.length < 1000) break;
}
console.log(`== Limpeza == órfãos apagados=${apagados} mantidos=${mantidos} erros=${erros}`);
process.exit(erros ? 1 : 0);
