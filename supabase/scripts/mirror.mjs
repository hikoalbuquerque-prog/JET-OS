// ============================================================================
// JET OS — Fase 2 — Backfill/espelho Firestore -> Supabase (dados de referência)
//
// Copia as tabelas que NÃO dependem de auth (estações, locais, cidades, config GoJet,
// config de pagamento). Usuários/tarefas/slots dependem do mapeamento de uid do auth
// (Fase 2, módulo Usuários) — ficam para depois. Geometria de zonas (polígono) idem,
// pois o formato do polígono no Firestore precisa ser confirmado.
//
// Não toca no app em produção: só LÊ do Firestore e ESCREVE no Supabase.
//
// Pré-requisitos:
//   - Node 18+; rodar numa pasta com firebase-admin e @supabase/supabase-js
//     (ex.: copiar este arquivo para functions/ e `node mirror.mjs`, OU
//      `npm i firebase-admin @supabase/supabase-js` numa pasta e rodar aqui).
//   - GOOGLE_APPLICATION_CREDENTIALS apontando p/ a service account do Firebase
//     (ou rodar onde o firebase-admin ache as credenciais padrão).
//   - Variáveis: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (a service_role ROTACIONADA).
//
// Uso (PowerShell):
//   $env:SUPABASE_URL="https://ducdbrupxpzqcblfreqn.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role nova>"
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\serviceAccount.json"
//   node mirror.mjs
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp(); // usa GOOGLE_APPLICATION_CREDENTIALS / ADC
const fs = getFirestore();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ponto EWKT (Supabase resolve geography via search_path da role — migration 0006)
const pt = (lat, lng) =>
  (typeof lat === 'number' && typeof lng === 'number') ? `SRID=4326;POINT(${lng} ${lat})` : null;

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function snap(col) { return (await fs.collection(col).get()).docs.map(d => ({ id: d.id, ...d.data() })); }

async function refresh(table, rows) {                 // full refresh (delete-all + insert)
  await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  let total = 0;
  for (const part of chunk(rows, 500)) {
    const { error } = await sb.from(table).insert(part);
    if (error) { console.error(`  [${table}] erro:`, error.message); break; }
    total += part.length;
  }
  console.log(`  ${table}: ${total}/${rows.length} inseridos`);
}

async function upsert(table, rows, onConflict) {       // upsert por chave natural
  for (const part of chunk(rows, 500)) {
    const { error } = await sb.from(table).upsert(part, { onConflict });
    if (error) { console.error(`  [${table}] erro:`, error.message); break; }
  }
  console.log(`  ${table}: ${rows.length} upsert`);
}

(async () => {
  console.log('== Backfill Firestore -> Supabase ==');

  // ESTAÇÕES
  const est = await snap('estacoes');
  await refresh('estacoes', est.map(e => ({
    codigo: e.codigo ?? null, geo: pt(e.lat, e.lng),
    cidade: e.cidade ?? null, pais: e.pais ?? 'BR', bairro: e.bairro ?? null,
    endereco: e.endereco ?? null, tipo: e.tipo ?? null, status: e.status ?? null,
    imagens: e.imagens ?? [], ia: e.ia ?? null, croqui_status: e.croquiStatus ?? null,
  })));

  // CIDADES (expansão)
  const cid = await snap('cidades_expansao');
  await refresh('cidades_expansao', cid.map(c => ({
    nome: c.nome ?? null, pais: c.pais ?? 'BR', geo: pt(c.lat, c.lng), status: c.status ?? null,
    populacao: c.populacao ?? null, mercado_est: c.mercadoEst ?? null,
    investimento_est: c.investimentoEst ?? null, data_prevista: c.dataPrevista ?? null,
    responsavel: c.responsavel ?? null, obs: c.obs ?? null,
  })));

  // LOCAIS OPERACIONAIS
  const loc = await snap('locais_operacionais');
  await refresh('locais_operacionais', loc.map(l => ({
    nome: l.nome ?? null, tipo: l.tipo ?? null, geo: pt(l.lat, l.lng),
    cidade: l.cidade ?? null, pais: l.pais ?? 'BR', obs: l.obs ?? null,
  })));

  // CONFIG GoJet (chave = cidade)
  const gc = await snap('gojet_config');
  await upsert('gojet_config', gc.map(g => ({
    cidade: g.id, city_id: g.cityId ?? g.city_id, ativo: !!g.ativo,
  })), 'cidade');

  // CONFIG pagamentos (chave = cidade)
  const pc = await snap('pagamentos_config');
  await upsert('pagamentos_config', pc.map(p => ({
    cidade: p.id, valor_por_tarefa: p.valor_por_tarefa, moeda: p.moeda ?? 'BRL',
    ativo: p.ativo !== false, codigo_servico: p.codigo_servico ?? null,
    aliquota_iss: p.aliquota_iss ?? null, municipio_ibge: p.municipio_ibge ?? null,
  })), 'cidade');

  console.log('== Concluído ==');
  console.log('TODO próximos: zonas (confirmar formato do polígono), usuários/tarefas/slots (após auth).');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
