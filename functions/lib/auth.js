"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsuario = exports.obterEstatisticasMonitorAuth = exports.listarSlotsAuth = exports.criarSlotAuth = exports.atualizarRota = exports.listarRotas = exports.gerarRota = exports.deletarOperacao = exports.atualizarOperacao = exports.listarOperacoes = exports.criarOperacao = void 0;
// functions/src/auth.ts — migrado para firebase-functions v2
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const db = admin.firestore();
// ── OPERAÇÕES ─────────────────────────────────────────────────────────────────
exports.criarOperacao = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const { tipo, prioridade, estacaoId, quantidade, dataVencimento, notas } = request.data;
    const docRef = await db.collection('operacoes').add({
        uid: request.auth.uid,
        tipo: tipo || 'coleta',
        status: 'pendente',
        prioridade: prioridade || 1,
        estacaoId: estacaoId || '',
        quantidade: quantidade || 0,
        dataCriacao: admin.firestore.FieldValue.serverTimestamp(),
        dataVencimento: dataVencimento ? new Date(dataVencimento) : null,
        notas: notas || '',
    });
    return { id: docRef.id, message: 'Operação criada com sucesso' };
});
exports.listarOperacoes = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const snap = await db.collection('operacoes')
        .where('uid', '==', request.auth.uid)
        .orderBy('dataCriacao', 'desc')
        .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});
exports.atualizarOperacao = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const { operacaoId, patch } = request.data;
    await db.collection('operacoes').doc(operacaoId).update(patch);
    return { message: 'Operação atualizada com sucesso' };
});
exports.deletarOperacao = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const { operacaoId } = request.data;
    await db.collection('operacoes').doc(operacaoId).delete();
    return { message: 'Operação deletada com sucesso' };
});
// ── ROTAS ─────────────────────────────────────────────────────────────────────
exports.gerarRota = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const { operacaoIds } = request.data;
    if (!operacaoIds?.length)
        throw new https_1.HttpsError('invalid-argument', 'Nenhuma operação selecionada');
    const operacoes = [];
    for (const id of operacaoIds) {
        const doc = await db.collection('operacoes').doc(id).get();
        if (doc.exists)
            operacoes.push({ id: doc.id, ...doc.data() });
    }
    const sequencia = operacoes.map((op, idx) => ({
        opId: op.id,
        sequencia: idx + 1,
        chegadaEstimada: new Date(Date.now() + idx * 15 * 60000).toLocaleTimeString(),
    }));
    const distanciaTotal = operacoes.length * 5;
    const tempoEstimado = operacoes.length * 15;
    const rotaRef = await db.collection('rotas').add({
        uid: request.auth.uid,
        tarefas: operacaoIds,
        distanciaTotal,
        tempoEstimado,
        status: 'pendente',
        dataCriacao: admin.firestore.FieldValue.serverTimestamp(),
        sequencia,
    });
    return { id: rotaRef.id, distanciaTotal, tempoEstimado, message: 'Rota gerada com sucesso' };
});
exports.listarRotas = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const snap = await db.collection('rotas')
        .where('uid', '==', request.auth.uid)
        .orderBy('dataCriacao', 'desc')
        .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});
exports.atualizarRota = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const { rotaId, patch } = request.data;
    await db.collection('rotas').doc(rotaId).update(patch);
    return { message: 'Rota atualizada com sucesso' };
});
// ── SLOTS ─────────────────────────────────────────────────────────────────────
exports.criarSlotAuth = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const { tipo, horario, repeticao } = request.data;
    const slotRef = await db.collection('slots').add({
        uid: request.auth.uid,
        tipo: tipo || 'coleta',
        horario: horario || '08:00',
        repeticao: repeticao || 'diario',
        status: 'ativo',
        tarefas: [],
        proximaExecucao: admin.firestore.FieldValue.serverTimestamp(),
        dataCriacao: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: slotRef.id, message: 'Slot criado com sucesso' };
});
exports.listarSlotsAuth = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const snap = await db.collection('slots')
        .where('uid', '==', request.auth.uid)
        .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});
// ── MONITOR ───────────────────────────────────────────────────────────────────
exports.obterEstatisticasMonitorAuth = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const [totalSnap, conclSnap] = await Promise.all([
        db.collection('operacoes').where('uid', '==', request.auth.uid).get(),
        db.collection('operacoes').where('uid', '==', request.auth.uid).where('status', '==', 'concluido').get(),
    ]);
    const total = totalSnap.size;
    const concluidas = conclSnap.size;
    const pct = total > 0 ? Math.round((concluidas / total) * 100) : 0;
    const deficit = 100 - pct;
    return {
        totalOperacoes: total,
        operacoesConcluidas: concluidas,
        percentualConclusao: pct,
        deficit,
        statusAlerta: deficit > 20 ? 'vermelho' : deficit > 10 ? 'amarelo' : 'verde',
    };
});
// ── USUÁRIO ───────────────────────────────────────────────────────────────────
exports.getUsuario = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Não autenticado');
    const userDoc = await db.collection('usuarios').doc(request.auth.uid).get();
    if (!userDoc.exists)
        throw new https_1.HttpsError('not-found', 'Usuário não encontrado');
    const d = userDoc.data();
    return {
        uid: request.auth.uid,
        email: request.auth.token.email,
        role: d.role || 'user',
        cargoPrestador: d.cargoPrestador || null,
        tipoCadastro: d.tipoCadastro || null,
        statusPrestador: d.statusPrestador || null,
        paises: d.paises || [],
    };
});
//# sourceMappingURL=auth.js.map