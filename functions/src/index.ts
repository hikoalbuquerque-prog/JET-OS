// functions/src/index.ts — JET OS V2 — versão consolidada
// Firebase Functions v2 — região: southamerica-east1

import * as admin from 'firebase-admin';
import { onRequest, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';

admin.initializeApp();
// maxInstances global: limita a CPU reservada por função no Cloud Run. Sem isso
// cada função pode escalar muito e o total estoura a cota regional de CPU em
// southamerica-east1 (erro "Quota exceeded for total allowable CPU") em deploys
// que recriam muitas funções de uma vez. Também controla custo (ver migração Supabase).
// Funções que precisarem de mais escala podem sobrescrever no próprio options.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const db = admin.firestore();

// ─── CORS helper ──────────────────────────────────────────────────
function addCORS(res: any) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

// ══════════════════════════════════════════════════════════════════
// LEGADO APOSENTADO (21/06/2026): operações, rotas, slots (CRUD HTTP),
// obterEstatisticasMonitor — nenhum cliente chama; removidos na migração
// Supabase Fase 2. Ver DEBRIEF §17.17.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// USUÁRIO
// ══════════════════════════════════════════════════════════════════

export const getUsuarioFn = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const uid = (req.query.uid as string) || req.body.uid;
    if (!uid) { res.status(400).json({ erro: 'UID requerido' }); return; }
    const userDoc = await db.collection('usuarios').doc(uid).get();
    if (!userDoc.exists) { res.status(404).json({ erro: 'Usuário não encontrado' }); return; }
    const d = userDoc.data()!;
    res.json({ uid, email: d.email, nome: d.nome, role: d.role,
      cargoPrestador: d.cargoPrestador, tipoCadastro: d.tipoCadastro,
      statusPrestador: d.statusPrestador });
  } catch (err) { res.status(500).json({ erro: 'Erro ao obter usuário' }); }
});

// ══════════════════════════════════════════════════════════════════
// LOGS + HEALTH
// ══════════════════════════════════════════════════════════════════

export const registrarLogAcesso = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { uid, email, acao, resultado, metadados } = req.body;
    const docRef = await db.collection('logs_acesso').add({
      uid, email, acao, resultado, metadados,
      timestamp: admin.firestore.Timestamp.now(),
      ip: req.ip || 'desconhecido',
    });
    res.json({ id: docRef.id });
  } catch (err) { res.status(500).json({ erro: 'Erro ao registrar log' }); }
});

export const healthCheck = onRequest((req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════════════
// CROQUIS — wrapper onCall para gerarCroquiFn e gerarCroquisLoteFn
// (código real em src/croquis/index.ts)
// ══════════════════════════════════════════════════════════════════

import { gerarCroqui, gerarCroquisLote } from './croquis';

export const gerarCroquiFn = onCall(
  { timeoutSeconds: 300, memory: '512MiB', region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    if (!request.auth) throw new Error('Não autenticado');
    const { estacaoId } = request.data as { estacaoId: string };
    return gerarCroqui(estacaoId, request.auth.uid, request.auth.token.email || '');
  }
);

export const gerarCroquisLoteFn = onCall(
  { timeoutSeconds: 540, memory: '512MiB', region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    if (!request.auth) throw new Error('Não autenticado');
    const { cidade, pais = 'BR', loteSize = 10 } = request.data as { cidade: string; pais?: string; loteSize?: number };
    return gerarCroquisLote(cidade, pais, loteSize, request.auth.uid, request.auth.token.email || '');
  }
);

// ══════════════════════════════════════════════════════════════════
// STREET VIEW — wrapper onCall para gerarStreetViewFn
// (código real em src/streetview/index.ts)
// ══════════════════════════════════════════════════════════════════

import { fetchStreetViewCascata } from './streetview';

export const gerarStreetViewFn = onCall(
  { timeoutSeconds: 120, memory: '256MiB', region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    if (!request.auth) throw new Error('Não autenticado');
    const { lat, lng, codigo } = request.data as { lat: number; lng: number; codigo: string };
    const result = await fetchStreetViewCascata(lat, lng, codigo);
    if (!result) throw new Error('Nenhuma imagem encontrada');
    return result;
  }
);

// ══════════════════════════════════════════════════════════════════
// RELATÓRIOS GUARD — diário + manual + semanal
// relatorioGuardDiarioFn: scheduler diário 7h (ter-dom, reporta o dia anterior)
// relatorioGuardManualFn: callable para botão no DashboardManager
// relatorioGuardSemanal: scheduler toda segunda 7h (já em relatorios.ts)
// ══════════════════════════════════════════════════════════════════

import { gerarRelatorioGuard, enviarRelatorioTelegram } from './relatorio';

// Diário — 7h, terça a domingo (reporta o dia anterior)
// Segunda-feira envia o semanal no lugar
export const relatorioGuardDiarioFn = onSchedule(
  { schedule: '0 7 * * 2-7', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 120, maxInstances: 10 },
  async () => {
    // Reporta o dia anterior
    const ontem = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    ontem.setDate(ontem.getDate() - 1);
    const dataStr = ontem.toISOString().slice(0, 10);
    const relatorio = await gerarRelatorioGuard(dataStr);
    await enviarRelatorioTelegram(relatorio);
    console.log('[guard-diario] Enviado para', dataStr, '—', relatorio.totalOcorrencias, 'ocorrências');
  }
);

// Manual — callable para o botão "Enviar relatório agora" no DashboardManager
export const relatorioGuardManualFn = onCall(
  { timeoutSeconds: 180, memory: '256MiB', region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    if (!request.auth) throw new Error('Não autenticado');
    const { dataStr, tipo, periodo, lang } = (request.data || {}) as {
      dataStr?: string; tipo?: string; periodo?: string; lang?: string;
    };
    const relatorio = await gerarRelatorioGuard(dataStr);
    await enviarRelatorioTelegram(relatorio, lang || 'pt');
    return {
      ok:              true,
      totalOcorrencias: relatorio.totalOcorrencias,
      total:            relatorio.totalOcorrencias,
      data:             relatorio.data,
      tipo:             tipo || 'guard',
      periodo:          periodo || (dataStr ? dataStr : 'ontem'),
    };
  }
);

// ══════════════════════════════════════════════════════════════════
// APROVAÇÃO DE SOLICITAÇÃO — callable para DashboardManager:3096
// (código real em src/auth/index.ts)
// ══════════════════════════════════════════════════════════════════

import { aprovarSolicitacao } from './auth/index';

export const aprovarSolicitacaoFn = onCall(
  { timeoutSeconds: 60, memory: '256MiB', region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    if (!request.auth) throw new Error('Não autenticado');
    const { solicitacaoId, roleOverride } = request.data as { solicitacaoId: string; roleOverride?: string };
    return aprovarSolicitacao(
      solicitacaoId,
      request.auth.uid,
      request.auth.token.email || '',
      roleOverride,
    );
  }
);

// ══════════════════════════════════════════════════════════════════
// MÓDULOS — exportações de outros arquivos
// ══════════════════════════════════════════════════════════════════

export * from './slots';
export * from './telegram-vinculo';
export * from './auth';           // getUsuario, criarSlotAuth, listarSlotsAuth, etc.
export * from './automacao';      // limpezaSnapshots, notificarOcorrencia, notificarTarefa, etc.
export * from './automacao-gojet-scraper'; // scraperGoJet (paginação completa, multi-cidade), scraperGoJetManual
export * from './gps-alertas';    // verificarAtrasos, verificarChegadaPonto
export * from './gps-ingest';     // ingestGps — upload nativo de GPS (app fechado)
export * from './automacao-tarefas'; // gerarTarefasGoJetFn, gerarTarefasAgendado, etc.
export * from './relatorios';     // enviarRelatorioManual, relatorioGuardSemanal, relatorioPerdasDiario, relatorioPerdasSemanal
export * from './notificacoes-prestador'; // notificarGestorNovaSolicitacao
export * from './mirror-ocorrencias'; // espelharOcorrenciaSupabase — dual-write Guard -> Supabase (DEBRIEF §16)
export * from './mirror-estacoes';    // espelharEstacaoSupabase — dual-write estações -> Supabase (Fase 2 Onda A)
export * from './mirror-onda-b-menores'; // espelhar Solicitacao/TurnoLogistica -> Supabase (Fase 2 Onda B menores)
export * from './mirror-tarefas';        // espelharTarefaSupabase, espelharTarefaLogisticaSupabase (Onda H)
export * from './mirror-solicitacoes';   // espelharSolicitacaoSupabase — user access requests (Onda H)
export * from './mirror-gojet-config';  // espelharGojetConfigSupabase — gojet_config dual-write (Onda H)
export * from './buscar-pois-osm';    // buscarPOIsOSMFn — Overpass/OSM server-side (gratuito; resolve CORS/429)
export * from './slots-telegram';     // resumoSlotsTelegram, confirmarSlotsCascata, enviarResumoManual

// ══════════════════════════════════════════════════════════════════
// REVOGAR ACESSO — desativa usuário no Auth + Firestore
// ══════════════════════════════════════════════════════════════════

export const revogarAcesso = onCall(
  { region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new Error('Não autenticado');

    const callerDoc = await db.collection('usuarios').doc(callerUid).get();
    const callerRole = callerDoc.data()?.role;
    if (!['admin', 'gestor', 'supergestor'].includes(callerRole)) {
      throw new Error('Sem permissão');
    }

    const { uid } = request.data as { uid: string };
    if (!uid) throw new Error('uid obrigatório');
    if (uid === callerUid) throw new Error('Não pode revogar o próprio acesso');

    await admin.auth().updateUser(uid, { disabled: true });
    await db.collection('usuarios').doc(uid).update({
      ativo: false,
      role: 'desativado',
      revogarEm: admin.firestore.FieldValue.serverTimestamp(),
      revogarPor: callerUid,
    });

    return { ok: true };
  }
);
