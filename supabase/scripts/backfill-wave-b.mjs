// ============================================================================
// JET OS — Fase 2 / Onda B — backfill Firestore → Supabase (só coleções com dados)
//   solicitacoes_prestadores (35), turnos_logistica (41), pagamentos_config (1).
//   NÃO toca tabelas vivas (slots/escala/ocorrencias). Idempotente.
// Uso: set GOOGLE_APPLICATION_CREDENTIALS / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//      node backfill-wave-b.mjs
// ============================================================================
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp();
const fdb = getFirestore();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const iso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
  : (t && t._seconds ? new Date(t._seconds * 1000).toISOString() : null);

async function backfillSolic() {
  const snap = await fdb.collection('solicitacoes_prestadores').get();
  const rows = snap.docs.map(d => { const x = d.data(); return {
    firebase_id: d.id, uid: x.uid ?? null, nome: x.nome ?? null, email: x.email ?? null,
    cpf: x.cpf_cnpj ?? x.cpf ?? null, cargo: x.cargo ?? null, cidade: x.cidade ?? null,
    status: x.status ?? 'pendente', pix_chave: x.pix_chave ?? null, pix_tipo: x.pix_tipo ?? null,
    telegram: x.telegram ?? null, motivo_cadastro: x.motivo_cadastro ?? null,
    tipo_contrato: x.tipo_contrato ?? null, pais: (typeof x.pais === 'string' && /^[A-Z]{2}$/.test(x.pais)) ? x.pais : 'BR',
    respondido_por: (typeof x.respondido_por === 'string') ? x.respondido_por : null,
    data_resposta: iso(x.data_resposta), criado_em: iso(x.data_criacao) ?? new Date().toISOString(),
  }; });
  await sb.from('solicitacoes_prestadores').delete().not('firebase_id', 'is', null);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('solicitacoes_prestadores').insert(rows.slice(i, i + 500));
    if (error) throw new Error('solic insert: ' + error.message);
  }
  const { count } = await sb.from('solicitacoes_prestadores').select('*', { count: 'exact', head: true }).not('firebase_id', 'is', null);
  console.log(`solicitacoes_prestadores: ${snap.size} Firestore → ${count} Supabase`);
}

async function backfillTurnos() {
  const snap = await fdb.collection('turnos_logistica').get();
  const rows = snap.docs.map(d => { const x = d.data(); return {
    firebase_id: d.id, firebase_uid: x.uid ?? null, nome: x.nome ?? null,
    foto_url: x.fotoUrl ?? x.foto_url ?? null, acao: x.acao ?? null, cidade: x.cidade ?? null,
    criado_em: iso(x.criadoEm) ?? new Date().toISOString(),
  }; });
  await sb.from('turnos_logistica').delete().not('firebase_id', 'is', null);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('turnos_logistica').insert(rows.slice(i, i + 500));
    if (error) throw new Error('turnos insert: ' + error.message);
  }
  const { count } = await sb.from('turnos_logistica').select('*', { count: 'exact', head: true }).not('firebase_id', 'is', null);
  console.log(`turnos_logistica: ${snap.size} Firestore → ${count} Supabase`);
}

async function backfillPagCfg() {
  const snap = await fdb.collection('pagamentos_config').get();
  const rows = snap.docs.map(d => { const x = d.data(); return {
    cidade: d.id, valor_por_tarefa: Number(x.valor_por_tarefa ?? 0),
    moeda: x.moeda ?? 'BRL', ativo: x.ativo !== false,
  }; });
  if (rows.length) {
    const { error } = await sb.from('pagamentos_config').upsert(rows, { onConflict: 'cidade' });
    if (error) throw new Error('pagcfg upsert: ' + error.message);
  }
  console.log(`pagamentos_config: ${snap.size} Firestore → upsert ok (chave=cidade, doc.id=${rows.map(r=>r.cidade).join(',')})`);
}

(async () => {
  await backfillSolic();
  await backfillTurnos();
  await backfillPagCfg();
  console.log('== Onda B (dados) OK ==');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
