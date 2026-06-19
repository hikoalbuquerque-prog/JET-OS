// ============================================================================
// JET OS — Fase 2 — Backfill/espelho Firestore -> Supabase (dados de referência)
//
// Copia as tabelas que NÃO dependem de auth (estações, locais, cidades, config GoJet,
// config de pagamento) + as OCORRÊNCIAS do Guard (roubos/perdas/vandalismo) — estas
// resolvem registrado_por via mapa uid Firebase->Supabase (usuarios.firebase_uid, só
// leitura). Tarefas/slots dependem do backfill de usuários (Fase 2) — ficam para depois.
// Geometria de zonas (polígono) idem, pois o formato no Firestore precisa ser confirmado.
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

// Normalização (espelha num()/str() de functions/src/mirror-ocorrencias.ts).
const s = (...vals) => { for (const v of vals) if (typeof v === 'string' && v.trim()) return v; return null; };
const n = (...vals) => { for (const v of vals) { const x = typeof v === 'string' ? parseFloat(v) : v; if (typeof x === 'number' && isFinite(x)) return x; } return null; };
// Timestamp Firestore (ou string ISO) -> ISO string p/ timestamptz.
const ts = (...vals) => { for (const v of vals) { if (v?.toDate) return v.toDate().toISOString(); if (typeof v === 'string' && v.trim()) return v; } return null; };

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function snap(col) { return (await fs.collection(col).get()).docs.map(d => ({ id: d.id, ...d.data() })); }

// Mapa uid Firebase -> uuid Supabase (usuarios.firebase_uid), paginado.
async function carregarMapaUid() {
  const map = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('usuarios').select('id, firebase_uid').range(from, from + PAGE - 1);
    if (error) { console.error('  [usuarios] erro ao mapear uid:', error.message); break; }
    for (const u of data) if (u.firebase_uid) map.set(u.firebase_uid, u.id);
    if (!data || data.length < PAGE) break;
  }
  return map;
}

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

  // OCORRÊNCIAS (Guard: roubos, perdas, vandalismo, tentativas, recuperações).
  // Backfill do HISTÓRICO Firestore -> Supabase; o trigger espelharOcorrenciaSupabase
  // (mirror-ocorrencias.ts) cuida das NOVAS. Idempotente por firebase_doc_id, então
  // pode rodar quantas vezes quiser sem duplicar. Mapeamento idêntico ao do trigger.
  const uidMap = await carregarMapaUid();
  console.log(`  (uid map: ${uidMap.size} usuários com firebase_uid)`);
  const ocorDocs = (await fs.collection('ocorrencias').get()).docs;
  const ocorRows = ocorDocs.map(doc => {
    const d = doc.data();
    const lat = n(d.lat_inicial, d.lat, d.latInicial);
    const lng = n(d.lng_inicial, d.lng, d.lngInicial);
    const ruid = s(d.registradoPor, d.registrado_por);
    return {
      firebase_doc_id:       doc.id,
      codigo:                s(d.id, d.codigo),
      tipo:                  s(d.tipo),
      prioridade:            s(d.prioridade),
      status:                (s(d.status) ?? 'aberto').toLowerCase(),
      ativo_tipo:            s(d.ativo_tipo, d.ativoTipo),
      asset_id:              s(d.asset_id, d.assetId),
      descricao:             s(d.descricao),
      observacao_fechamento: s(d.observacao_fechamento, d.observacaoFechamento),
      geo:                   pt(lat, lng),
      cidade:                s(d.cidade_inicial, d.cidade),
      bairro:                s(d.bairro_inicial, d.bairro),
      endereco:              s(d.endereco_inicial, d.endereco),
      estacao_id:            s(d.estacaoId, d.estacao_id),
      bo_numero:             s(d.bo_numero, d.boNumero),
      bo_url:                s(d.bo_url, d.boUrl),
      foto1_url:             s(d.foto1_url, d.foto1Url),
      foto2_url:             s(d.foto2_url, d.foto2Url),
      cargo:                 s(d.cargo),
      origem_registro:       s(d.origem_registro, d.origemRegistro),
      turno:                 s(d.turno),
      procurando:            d.procurando === true,
      registrado_por:        ruid ? (uidMap.get(ruid) ?? null) : null,
      registrado_por_nome:   s(d.registradoPorNome, d.registrado_por_nome),
      telegram_enviado:      d.telegramEnviado === true || d.telegram_enviado === true,
      data_manual:           ts(d.dataManual, d.data_manual),
      // preserva a data real do histórico (senão o default now() mascararia a competência)
      ...(ts(d.criadoEm, d.criado_em) ? { criado_em: ts(d.criadoEm, d.criado_em) } : {}),
    };
  });
  await upsert('ocorrencias', ocorRows, 'firebase_doc_id');
  console.log(`  (ocorrencias: ${ocorRows.length} lidas do Firestore)`);

  console.log('== Concluído ==');
  console.log('TODO próximos: zonas (confirmar formato do polígono), tarefas/slots (após auth).');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
