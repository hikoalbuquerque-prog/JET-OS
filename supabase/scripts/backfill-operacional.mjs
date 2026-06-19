// ============================================================================
// JET OS — Fase 2 — Backfill operacional (uid-keyed): slots, turnos, ocorrencias
//
// Lê do Firestore e escreve no Supabase no SCHEMA IDEALIZADO:
//   • turnos_logistica (log de eventos inicio/fim) -> turnos (1 linha por turno,
//     pareando inicio+fim por uid em ordem cronológica).
//   • slots (scalt) -> slots idealizado; aceitoPor -> slot_confirmacoes.
//   • ocorrencias -> ocorrencias (tabela nova, geo geography).
//
// uid (Firebase) -> uuid (Supabase) via uid-map.json (gerado no preprovision).
// Idempotente: upsert por firebase_doc_id (slots/turnos/ocorrencias) e por
// (slot_id, uid) em slot_confirmacoes. Reexecutar não duplica.
//
// Pré-requisitos (cmd):
//   set SUPABASE_URL=https://ducdbrupxpzqcblfreqn.supabase.co
//   set SUPABASE_SERVICE_ROLE_KEY=<service_role NOVA>
//   set GOOGLE_APPLICATION_CREDENTIALS=C:\caminho\serviceAccount.json
//   node backfill-operacional.mjs
// Aplique a migration 0008 antes de rodar.
// ============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

initializeApp(); // GOOGLE_APPLICATION_CREDENTIALS / ADC
const fs = getFirestore();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Mapa firebase_uid -> uuid montado DIRETO da tabela usuarios (fonte autoritativa:
// cobre os 37 do preprovision + contas provisionadas à parte, ex.: hiko/admin).
const uidMap = {};
{
  let from = 0; const PAGE = 1000;
  for (;;) {
    const { data, error } = await sb.from('usuarios')
      .select('id, firebase_uid').not('firebase_uid', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) { console.error('Erro lendo usuarios:', error.message); process.exit(1); }
    for (const r of data) uidMap[r.firebase_uid] = r.id;
    if (data.length < PAGE) break;
    from += PAGE;
  }
}
console.log(`Mapa uid carregado: ${Object.keys(uidMap).length} usuários`);
const mapUid = (fb) => (fb && uidMap[fb]) ? uidMap[fb] : null;
let semMapa = new Set();
const mapUidLog = (fb) => { const u = mapUid(fb); if (fb && !u) semMapa.add(fb); return u; };

// Timestamp do Firestore (admin) -> ISO. Aceita Timestamp, Date, string.
const tsIso = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
};
// String "2026-06-06T10:00:00" (sem tz) -> trata como horário de São Paulo (-03:00).
const localToIso = (s) => {
  if (!s) return null;
  if (typeof s.toDate === 'function') return s.toDate().toISOString();
  const str = String(s);
  return /[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}-03:00`;
};
// dataManual: texto livre do operador (ISO "2026-06-14T14:10" OU "17/02/2026 08:21;27").
// Tolerante: o que não casar vira null (não quebra o lote).
const parseDataManual = (s) => {
  if (!s) return null;
  if (typeof s.toDate === 'function') return s.toDate().toISOString();
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str)) return localToIso(str.replace(' ', 'T'));
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2})[:;](\d{2})/); // DD/MM/AAAA HH:MM
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`;
  return null;
};
// Booleano tolerante: dado sujo (texto num campo bool) -> null em vez de quebrar.
const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return null;
};
const pt = (lat, lng) =>
  (typeof lat === 'number' && typeof lng === 'number') ? `SRID=4326;POINT(${lng} ${lat})` : null;

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function snap(col) { return (await fs.collection(col).get()).docs.map(d => ({ id: d.id, ...d.data() })); }
async function upsert(table, rows, onConflict) {
  if (!rows.length) { console.log(`  ${table}: 0`); return; }
  let ok = 0;
  for (const part of chunk(rows, 500)) {
    const { error } = await sb.from(table).upsert(part, { onConflict, ignoreDuplicates: false });
    if (error) { console.error(`  [${table}] erro:`, error.message); break; }
    ok += part.length;
  }
  console.log(`  ${table}: ${ok}/${rows.length} upsert`);
}

// ── TURNOS: pareia eventos inicio/fim do turnos_logistica ───────────────────
async function backfillTurnos() {
  const evs = await snap('turnos_logistica');
  const porUid = {};
  for (const e of evs) (porUid[e.uid] ??= []).push(e);
  const acoes = {}; for (const e of evs) acoes[e.acao] = (acoes[e.acao] || 0) + 1;
  console.log(`  [turnos] eventos=${evs.length} uids=${Object.keys(porUid).length} acoes=${JSON.stringify(acoes)}`);
  const rows = [];
  for (const [fbUid, lista] of Object.entries(porUid)) {
    const uuid = mapUidLog(fbUid);
    if (!uuid) continue; // uid não provisionado -> não dá p/ referenciar usuarios(id)
    lista.sort((a, b) => (tsIso(a.criadoEm) || '').localeCompare(tsIso(b.criadoEm) || ''));
    let aberto = null;
    const flush = () => { if (aberto) { rows.push(aberto); aberto = null; } };
    for (const e of lista) {
      if (e.acao === 'inicio') {
        flush(); // início sem fim anterior -> turno aberto (fim null)
        aberto = {
          firebase_doc_id: e.id, uid: uuid, tipo: 'logistica',
          inicio: tsIso(e.criadoEm), fim: null,
          foto_inicio_url: e.fotoUrl || null, foto_fim_url: null,
          cidade: e.cidade || null,
        };
      } else if (e.acao === 'fim') {
        if (aberto) { aberto.fim = tsIso(e.criadoEm); aberto.foto_fim_url = e.fotoUrl || null; flush(); }
        // 'fim' órfão (sem início) -> ignora
      }
    }
    flush();
  }
  await upsert('turnos', rows, 'firebase_doc_id');
}

// ── SLOTS (scalt) -> slots idealizado + slot_confirmacoes (aceitoPor) ───────
async function backfillSlots() {
  const slots = await snap('slots');
  const slotRows = slots.map(s => ({
    firebase_doc_id: s.id,
    cidade: s.cidade ?? null,
    tipo: s.cargo ?? null,
    inicio: localToIso(s.turnoInicio),
    fim: localToIso(s.turnoFim),
    vagas: 1,
    status: s.status ?? null,
    config: {
      titulo: s.titulo ?? null, zona_origem: s.zonaOrigem ?? null, pais: s.pais ?? null,
      gerado_automatico: !!s.geradoAutomatico, criado_por: s.criadoPor ?? null,
      sla_escalado_em: tsIso(s.slaEscaladoEm), sla_escalado2_em: tsIso(s.slaEscalado2Em),
      tarefas_ids: s.tarefasIds ?? [],
    },
    criado_em: tsIso(s.criadoEm) || new Date().toISOString(),   // not-null: sempre concreto
  }));
  await upsert('slots', slotRows, 'firebase_doc_id');

  // mapeia firebase_doc_id -> id (uuid) p/ ligar as confirmações
  const { data: ids } = await sb.from('slots').select('id, firebase_doc_id')
    .in('firebase_doc_id', slots.map(s => s.id));
  const byFb = Object.fromEntries((ids || []).map(r => [r.firebase_doc_id, r.id]));
  const confs = [];
  for (const s of slots) {
    const uuid = mapUidLog(s.aceitoPor);
    const slotId = byFb[s.id];
    if (uuid && slotId) confs.push({ slot_id: slotId, uid: uuid, status: 'aceito' });
  }
  await upsert('slot_confirmacoes', confs, 'slot_id,uid');
}

// ── OCORRENCIAS -> tabela nova ──────────────────────────────────────────────
async function backfillOcorrencias() {
  const ocs = await snap('ocorrencias');
  const rows = ocs.map(o => ({
    firebase_doc_id: o.id ?? null,           // doc id do Firestore (chave de upsert)
    codigo: typeof o.id === 'string' && o.id.startsWith('JET-') ? o.id : (o.codigo ?? null),
    tipo: o.tipo ?? null, prioridade: o.prioridade ?? null, status: o.status ?? 'aberto',
    ativo_tipo: o.ativo_tipo ?? null, asset_id: o.asset_id ?? null,
    descricao: o.descricao ?? null, observacao_fechamento: o.observacao_fechamento ?? null,
    geo: pt(o.lat_inicial, o.lng_inicial),
    cidade: o.cidade_inicial ?? null, bairro: o.bairro_inicial ?? null,
    endereco: o.endereco_inicial ?? null, estacao_id: o.estacaoId ?? null,
    bo_numero: o.bo_numero ?? null, bo_url: o.bo_url ?? null,
    foto1_url: o.foto1_url ?? null, foto2_url: o.foto2_url ?? null,
    cargo: o.cargo ?? null, origem_registro: o.origem_registro ?? null,
    turno: o.turno ?? null, procurando: toBool(o.procurando),
    registrado_por: mapUidLog(o.registradoPor),    // null se não provisionado (FK aceita null)
    registrado_por_nome: o.registradoPorNome ?? null,
    telegram_enviado: toBool(o.telegramEnviado),
    data_manual: parseDataManual(o.dataManual),
    criado_em: parseDataManual(o.criadoEm) || new Date().toISOString(),  // not-null
    atualizado_em: parseDataManual(o.atualizadoEm) || parseDataManual(o.updated_at),
  }));
  // ocorrencias usa firebase_doc_id; quando ausente, cai pro id humano (codigo) como doc
  for (const r of rows) if (!r.firebase_doc_id) r.firebase_doc_id = r.codigo;
  await upsert('ocorrencias', rows.filter(r => r.firebase_doc_id), 'firebase_doc_id');
}

(async () => {
  console.log('== Backfill operacional Firestore -> Supabase ==');
  await backfillTurnos();
  await backfillSlots();
  await backfillOcorrencias();
  if (semMapa.size) console.log(`\n  ⚠ ${semMapa.size} uid(s) sem mapeamento (não provisionados): registrado_por/aceitoPor ficaram null ou turno ignorado.`);
  console.log('== Concluído ==');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
