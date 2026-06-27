// functions/src/auth.ts — migrado para firebase-functions v2
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const db = admin.firestore();

// ── OPERAÇÕES ─────────────────────────────────────────────────────────────────

export const criarOperacao = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const { tipo, prioridade, estacaoId, quantidade, dataVencimento, notas } = request.data;
  const docRef = await db.collection('operacoes').add({
    uid:           request.auth.uid,
    tipo:          tipo          || 'coleta',
    status:        'pendente',
    prioridade:    prioridade    || 1,
    estacaoId:     estacaoId    || '',
    quantidade:    quantidade    || 0,
    dataCriacao:   admin.firestore.FieldValue.serverTimestamp(),
    dataVencimento:dataVencimento ? new Date(dataVencimento) : null,
    notas:         notas         || '',
  });
  return { id: docRef.id, message: 'Operação criada com sucesso' };
});

export const listarOperacoes = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const snap = await db.collection('operacoes')
    .where('uid', '==', request.auth.uid)
    .orderBy('dataCriacao', 'desc')
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

export const atualizarOperacao = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const { operacaoId, patch } = request.data;
  await db.collection('operacoes').doc(operacaoId).update(patch);
  return { message: 'Operação atualizada com sucesso' };
});

export const deletarOperacao = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const { operacaoId } = request.data;
  await db.collection('operacoes').doc(operacaoId).delete();
  return { message: 'Operação deletada com sucesso' };
});

// ── ROTAS ─────────────────────────────────────────────────────────────────────

export const gerarRota = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const { operacaoIds } = request.data;
  if (!operacaoIds?.length) throw new HttpsError('invalid-argument', 'Nenhuma operação selecionada');

  const operacoes: any[] = [];
  for (const id of operacaoIds) {
    const doc = await db.collection('operacoes').doc(id).get();
    if (doc.exists) operacoes.push({ id: doc.id, ...doc.data() });
  }

  const sequencia = operacoes.map((op, idx) => ({
    opId: op.id,
    sequencia: idx + 1,
    chegadaEstimada: new Date(Date.now() + idx * 15 * 60000).toLocaleTimeString(),
  }));

  const distanciaTotal = operacoes.length * 5;
  const tempoEstimado  = operacoes.length * 15;

  const rotaRef = await db.collection('rotas').add({
    uid:            request.auth.uid,
    tarefas:        operacaoIds,
    distanciaTotal,
    tempoEstimado,
    status:         'pendente',
    dataCriacao:    admin.firestore.FieldValue.serverTimestamp(),
    sequencia,
  });

  return { id: rotaRef.id, distanciaTotal, tempoEstimado, message: 'Rota gerada com sucesso' };
});

export const listarRotas = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const snap = await db.collection('rotas')
    .where('uid', '==', request.auth.uid)
    .orderBy('dataCriacao', 'desc')
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

export const atualizarRota = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const { rotaId, patch } = request.data;
  await db.collection('rotas').doc(rotaId).update(patch);
  return { message: 'Rota atualizada com sucesso' };
});

// ── SLOTS ─────────────────────────────────────────────────────────────────────

export const criarSlotAuth = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const { tipo, horario, repeticao } = request.data;
  const slotRef = await db.collection('slots').add({
    uid:             request.auth.uid,
    tipo:            tipo       || 'coleta',
    horario:         horario    || '08:00',
    repeticao:       repeticao  || 'diario',
    status:          'ativo',
    tarefas:         [],
    proximaExecucao: admin.firestore.FieldValue.serverTimestamp(),
    dataCriacao:     admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: slotRef.id, message: 'Slot criado com sucesso' };
});

export const listarSlotsAuth = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const snap = await db.collection('slots')
    .where('uid', '==', request.auth.uid)
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

// ── MONITOR ───────────────────────────────────────────────────────────────────

export const obterEstatisticasMonitorAuth = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const [totalSnap, conclSnap] = await Promise.all([
    db.collection('operacoes').where('uid', '==', request.auth.uid).get(),
    db.collection('operacoes').where('uid', '==', request.auth.uid).where('status', '==', 'concluido').get(),
  ]);
  const total     = totalSnap.size;
  const concluidas= conclSnap.size;
  const pct       = total > 0 ? Math.round((concluidas / total) * 100) : 0;
  const deficit   = 100 - pct;
  return {
    totalOperacoes:       total,
    operacoesConcluidas:  concluidas,
    percentualConclusao:  pct,
    deficit,
    statusAlerta: deficit > 20 ? 'vermelho' : deficit > 10 ? 'amarelo' : 'verde',
  };
});

// ── USUÁRIO ───────────────────────────────────────────────────────────────────

export const getUsuario = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado');
  const userDoc = await db.collection('usuarios').doc(request.auth.uid).get();
  if (!userDoc.exists) throw new HttpsError('not-found', 'Usuário não encontrado');
  const d = userDoc.data()!;
  return {
    uid:            request.auth.uid,
    email:          request.auth.token.email,
    role:           d.role           || 'user',
    cargoPrestador: d.cargoPrestador || null,
    tipoCadastro:   d.tipoCadastro   || null,
    statusPrestador:d.statusPrestador|| null,
    paises:         d.paises         || [],
  };
});
