// functions/src/index.ts — JET OS V2 — versão consolidada
// Firebase Functions v2 — região: southamerica-east1

import * as admin from 'firebase-admin';
import { onRequest, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1' });

const db = admin.firestore();

// ─── CORS helper ──────────────────────────────────────────────────
function addCORS(res: any) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

// ══════════════════════════════════════════════════════════════════
// OPERAÇÕES (legado onRequest — mantidas por compatibilidade)
// ══════════════════════════════════════════════════════════════════

export const criarOperacao = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { tipo, prioridade, estacaoId, quantidade, notas } = req.body;
    const operacao = { tipo, prioridade, estacaoId, quantidade, notas,
      status: 'pendente', dataCriacao: admin.firestore.Timestamp.now() };
    const docRef = await db.collection('operacoes').add(operacao);
    res.json({ id: docRef.id, ...operacao });
  } catch (err) { res.status(500).json({ erro: 'Erro ao criar operação' }); }
});

export const listarOperacoes = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const snap = await db.collection('operacoes').get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) { res.status(500).json({ erro: 'Erro ao listar operações' }); }
});

export const atualizarOperacao = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { id, status, notas } = req.body;
    await db.collection('operacoes').doc(id).update({ status, notas });
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: 'Erro ao atualizar operação' }); }
});

export const deletarOperacao = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { id } = req.body;
    await db.collection('operacoes').doc(id).delete();
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: 'Erro ao deletar operação' }); }
});

// ══════════════════════════════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════════════════════════════

export const gerarRota = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { tarefas, uid } = req.body;
    const rota = { uid, tarefas, distanciaTotal: 0, tempoEstimado: 0,
      status: 'pendente', dataCriacao: admin.firestore.Timestamp.now(), sequencia: [] };
    const docRef = await db.collection('rotas').add(rota);
    res.json({ id: docRef.id, ...rota });
  } catch (err) { res.status(500).json({ erro: 'Erro ao gerar rota' }); }
});

export const listarRotas = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const snap = await db.collection('rotas').get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) { res.status(500).json({ erro: 'Erro ao listar rotas' }); }
});

export const atualizarRota = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { id, status, distanciaTotal, tempoEstimado } = req.body;
    await db.collection('rotas').doc(id).update({ status, distanciaTotal, tempoEstimado });
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: 'Erro ao atualizar rota' }); }
});

// ══════════════════════════════════════════════════════════════════
// SLOTS (legado — mantido para compatibilidade com SlotsModule antigo)
// ══════════════════════════════════════════════════════════════════

export const criarSlot = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { uid, tipo, horario, repeticao } = req.body;
    const slot = { uid, tipo, horario, repeticao, status: 'ativo', tarefas: [],
      proximaExecucao: admin.firestore.Timestamp.now() };
    const docRef = await db.collection('slots').add(slot);
    res.json({ id: docRef.id, ...slot });
  } catch (err) { res.status(500).json({ erro: 'Erro ao criar slot' }); }
});

export const listarSlots = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const snap = await db.collection('slots').get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) { res.status(500).json({ erro: 'Erro ao listar slots' }); }
});

// ══════════════════════════════════════════════════════════════════
// ESTATÍSTICAS
// ══════════════════════════════════════════════════════════════════

export const obterEstatisticasMonitor = onRequest(async (req, res) => {
  addCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const [operacoes, slots, rotas] = await Promise.all([
      db.collection('operacoes').get(),
      db.collection('slots').get(),
      db.collection('rotas').get(),
    ]);
    res.json({
      totalOperacoes:   operacoes.size,
      operacoesAtivas:  operacoes.docs.filter(d => d.data().status === 'pendente').length,
      totalSlots:       slots.size,
      totalRotas:       rotas.size,
      timestamp:        admin.firestore.Timestamp.now(),
    });
  } catch (err) { res.status(500).json({ erro: 'Erro ao obter estatísticas' }); }
});

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
  { timeoutSeconds: 300, memory: '512MiB', region: 'southamerica-east1', cors: true },
  async (request) => {
    if (!request.auth) throw new Error('Não autenticado');
    const { estacaoId } = request.data as { estacaoId: string };
    return gerarCroqui(estacaoId, request.auth.uid, request.auth.token.email || '');
  }
);

export const gerarCroquisLoteFn = onCall(
  { timeoutSeconds: 540, memory: '512MiB', region: 'southamerica-east1', cors: true },
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
  { timeoutSeconds: 120, memory: '256MiB', region: 'southamerica-east1', cors: true },
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
// relatorioGuardDiarioFn: scheduler diário 10h (seg-sáb)
// relatorioGuardManualFn: callable para botão no DashboardManager
// relatorioGuardSemanal: scheduler toda segunda 10h (já em relatorios.ts)
// ══════════════════════════════════════════════════════════════════

import { gerarRelatorioGuard, enviarRelatorioTelegram } from './relatorio';

// Diário — seg a sáb às 10h (Brasília)
// Diário — 7h, terça a domingo (reporta o dia anterior)
// Segunda-feira envia o semanal no lugar
export const relatorioGuardDiarioFn = onSchedule(
  { schedule: '0 7 * * 2-7', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 120 },
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
  { timeoutSeconds: 180, memory: '256MiB', region: 'southamerica-east1', cors: true },
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
  { timeoutSeconds: 60, memory: '256MiB', region: 'southamerica-east1', cors: true },
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
export * from './automacao-tarefas'; // gerarTarefasGoJetFn, gerarTarefasAgendado, gerarSlotsAgendado, etc.
export * from './relatorios';     // enviarRelatorioManual, relatorioGuardSemanal, relatorioPerdasDiario, relatorioPerdasSemanal
export * from './notificacoes-prestador'; // notificarGestorNovaSolicitacao
export * from './mirror-ocorrencias'; // espelharOcorrenciaSupabase — dual-write Guard -> Supabase (DEBRIEF §16)

// ══════════════════════════════════════════════════════════════════
// REVOGAR ACESSO — desativa usuário no Auth + Firestore
// ══════════════════════════════════════════════════════════════════

export const revogarAcesso = onCall(
  { region: 'southamerica-east1', cors: true },
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
