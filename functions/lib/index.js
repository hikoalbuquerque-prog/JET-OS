"use strict";
// functions/src/index.ts — JET OS V2 — versão consolidada
// Firebase Functions v2 — região: southamerica-east1
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revogarAcesso = exports.aprovarSolicitacaoFn = exports.relatorioGuardManualFn = exports.relatorioGuardDiarioFn = exports.gerarStreetViewFn = exports.gerarCroquisLoteFn = exports.gerarCroquiFn = exports.healthCheck = exports.registrarLogAcesso = exports.getUsuarioFn = exports.obterEstatisticasMonitor = exports.listarSlots = exports.criarSlot = exports.atualizarRota = exports.listarRotas = exports.gerarRota = exports.deletarOperacao = exports.atualizarOperacao = exports.listarOperacoes = exports.criarOperacao = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
admin.initializeApp();
(0, v2_1.setGlobalOptions)({ region: 'southamerica-east1' });
const db = admin.firestore();
// ─── CORS helper ──────────────────────────────────────────────────
function addCORS(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
}
// ══════════════════════════════════════════════════════════════════
// OPERAÇÕES (legado onRequest — mantidas por compatibilidade)
// ══════════════════════════════════════════════════════════════════
exports.criarOperacao = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { tipo, prioridade, estacaoId, quantidade, notas } = req.body;
        const operacao = { tipo, prioridade, estacaoId, quantidade, notas,
            status: 'pendente', dataCriacao: admin.firestore.Timestamp.now() };
        const docRef = await db.collection('operacoes').add(operacao);
        res.json({ id: docRef.id, ...operacao });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao criar operação' });
    }
});
exports.listarOperacoes = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const snap = await db.collection('operacoes').get();
        res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao listar operações' });
    }
});
exports.atualizarOperacao = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { id, status, notas } = req.body;
        await db.collection('operacoes').doc(id).update({ status, notas });
        res.json({ sucesso: true });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar operação' });
    }
});
exports.deletarOperacao = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { id } = req.body;
        await db.collection('operacoes').doc(id).delete();
        res.json({ sucesso: true });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao deletar operação' });
    }
});
// ══════════════════════════════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════════════════════════════
exports.gerarRota = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { tarefas, uid } = req.body;
        const rota = { uid, tarefas, distanciaTotal: 0, tempoEstimado: 0,
            status: 'pendente', dataCriacao: admin.firestore.Timestamp.now(), sequencia: [] };
        const docRef = await db.collection('rotas').add(rota);
        res.json({ id: docRef.id, ...rota });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao gerar rota' });
    }
});
exports.listarRotas = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const snap = await db.collection('rotas').get();
        res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao listar rotas' });
    }
});
exports.atualizarRota = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { id, status, distanciaTotal, tempoEstimado } = req.body;
        await db.collection('rotas').doc(id).update({ status, distanciaTotal, tempoEstimado });
        res.json({ sucesso: true });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar rota' });
    }
});
// ══════════════════════════════════════════════════════════════════
// SLOTS (legado — mantido para compatibilidade com SlotsModule antigo)
// ══════════════════════════════════════════════════════════════════
exports.criarSlot = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { uid, tipo, horario, repeticao } = req.body;
        const slot = { uid, tipo, horario, repeticao, status: 'ativo', tarefas: [],
            proximaExecucao: admin.firestore.Timestamp.now() };
        const docRef = await db.collection('slots').add(slot);
        res.json({ id: docRef.id, ...slot });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao criar slot' });
    }
});
exports.listarSlots = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const snap = await db.collection('slots').get();
        res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao listar slots' });
    }
});
// ══════════════════════════════════════════════════════════════════
// ESTATÍSTICAS
// ══════════════════════════════════════════════════════════════════
exports.obterEstatisticasMonitor = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const [operacoes, slots, rotas] = await Promise.all([
            db.collection('operacoes').get(),
            db.collection('slots').get(),
            db.collection('rotas').get(),
        ]);
        res.json({
            totalOperacoes: operacoes.size,
            operacoesAtivas: operacoes.docs.filter(d => d.data().status === 'pendente').length,
            totalSlots: slots.size,
            totalRotas: rotas.size,
            timestamp: admin.firestore.Timestamp.now(),
        });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao obter estatísticas' });
    }
});
// ══════════════════════════════════════════════════════════════════
// USUÁRIO
// ══════════════════════════════════════════════════════════════════
exports.getUsuarioFn = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const uid = req.query.uid || req.body.uid;
        if (!uid) {
            res.status(400).json({ erro: 'UID requerido' });
            return;
        }
        const userDoc = await db.collection('usuarios').doc(uid).get();
        if (!userDoc.exists) {
            res.status(404).json({ erro: 'Usuário não encontrado' });
            return;
        }
        const d = userDoc.data();
        res.json({ uid, email: d.email, nome: d.nome, role: d.role,
            cargoPrestador: d.cargoPrestador, tipoCadastro: d.tipoCadastro,
            statusPrestador: d.statusPrestador });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao obter usuário' });
    }
});
// ══════════════════════════════════════════════════════════════════
// LOGS + HEALTH
// ══════════════════════════════════════════════════════════════════
exports.registrarLogAcesso = (0, https_1.onRequest)(async (req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const { uid, email, acao, resultado, metadados } = req.body;
        const docRef = await db.collection('logs_acesso').add({
            uid, email, acao, resultado, metadados,
            timestamp: admin.firestore.Timestamp.now(),
            ip: req.ip || 'desconhecido',
        });
        res.json({ id: docRef.id });
    }
    catch (err) {
        res.status(500).json({ erro: 'Erro ao registrar log' });
    }
});
exports.healthCheck = (0, https_1.onRequest)((req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ══════════════════════════════════════════════════════════════════
// CROQUIS — wrapper onCall para gerarCroquiFn e gerarCroquisLoteFn
// (código real em src/croquis/index.ts)
// ══════════════════════════════════════════════════════════════════
const croquis_1 = require("./croquis");
exports.gerarCroquiFn = (0, https_1.onCall)({ timeoutSeconds: 300, memory: '512MiB', region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new Error('Não autenticado');
    const { estacaoId } = request.data;
    return (0, croquis_1.gerarCroqui)(estacaoId, request.auth.uid, request.auth.token.email || '');
});
exports.gerarCroquisLoteFn = (0, https_1.onCall)({ timeoutSeconds: 540, memory: '512MiB', region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new Error('Não autenticado');
    const { cidade, pais = 'BR', loteSize = 10 } = request.data;
    return (0, croquis_1.gerarCroquisLote)(cidade, pais, loteSize, request.auth.uid, request.auth.token.email || '');
});
// ══════════════════════════════════════════════════════════════════
// STREET VIEW — wrapper onCall para gerarStreetViewFn
// (código real em src/streetview/index.ts)
// ══════════════════════════════════════════════════════════════════
const streetview_1 = require("./streetview");
exports.gerarStreetViewFn = (0, https_1.onCall)({ timeoutSeconds: 120, memory: '256MiB', region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new Error('Não autenticado');
    const { lat, lng, codigo } = request.data;
    const result = await (0, streetview_1.fetchStreetViewCascata)(lat, lng, codigo);
    if (!result)
        throw new Error('Nenhuma imagem encontrada');
    return result;
});
// ══════════════════════════════════════════════════════════════════
// RELATÓRIOS GUARD — diário + manual + semanal
// relatorioGuardDiarioFn: scheduler diário 10h (seg-sáb)
// relatorioGuardManualFn: callable para botão no DashboardManager
// relatorioGuardSemanal: scheduler toda segunda 10h (já em relatorios.ts)
// ══════════════════════════════════════════════════════════════════
const relatorio_1 = require("./relatorio");
// Diário — seg a sáb às 10h (Brasília)
// Diário — 7h, terça a domingo (reporta o dia anterior)
// Segunda-feira envia o semanal no lugar
exports.relatorioGuardDiarioFn = (0, scheduler_1.onSchedule)({ schedule: '0 7 * * 2-7', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 120 }, async () => {
    // Reporta o dia anterior
    const ontem = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    ontem.setDate(ontem.getDate() - 1);
    const dataStr = ontem.toISOString().slice(0, 10);
    const relatorio = await (0, relatorio_1.gerarRelatorioGuard)(dataStr);
    await (0, relatorio_1.enviarRelatorioTelegram)(relatorio);
    console.log('[guard-diario] Enviado para', dataStr, '—', relatorio.totalOcorrencias, 'ocorrências');
});
// Manual — callable para o botão "Enviar relatório agora" no DashboardManager
exports.relatorioGuardManualFn = (0, https_1.onCall)({ timeoutSeconds: 180, memory: '256MiB', region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new Error('Não autenticado');
    const { dataStr, tipo, periodo, lang } = (request.data || {});
    const relatorio = await (0, relatorio_1.gerarRelatorioGuard)(dataStr);
    await (0, relatorio_1.enviarRelatorioTelegram)(relatorio, lang || 'pt');
    return {
        ok: true,
        totalOcorrencias: relatorio.totalOcorrencias,
        total: relatorio.totalOcorrencias,
        data: relatorio.data,
        tipo: tipo || 'guard',
        periodo: periodo || (dataStr ? dataStr : 'ontem'),
    };
});
// ══════════════════════════════════════════════════════════════════
// APROVAÇÃO DE SOLICITAÇÃO — callable para DashboardManager:3096
// (código real em src/auth/index.ts)
// ══════════════════════════════════════════════════════════════════
const index_1 = require("./auth/index");
exports.aprovarSolicitacaoFn = (0, https_1.onCall)({ timeoutSeconds: 60, memory: '256MiB', region: 'southamerica-east1', cors: true }, async (request) => {
    if (!request.auth)
        throw new Error('Não autenticado');
    const { solicitacaoId, roleOverride } = request.data;
    return (0, index_1.aprovarSolicitacao)(solicitacaoId, request.auth.uid, request.auth.token.email || '', roleOverride);
});
// ══════════════════════════════════════════════════════════════════
// MÓDULOS — exportações de outros arquivos
// ══════════════════════════════════════════════════════════════════
__exportStar(require("./slots"), exports);
__exportStar(require("./telegram-vinculo"), exports);
__exportStar(require("./auth"), exports); // getUsuario, criarSlotAuth, listarSlotsAuth, etc.
__exportStar(require("./automacao"), exports); // limpezaSnapshots, notificarOcorrencia, notificarTarefa, etc.
__exportStar(require("./automacao-gojet-scraper"), exports); // scraperGoJet (paginação completa, multi-cidade), scraperGoJetManual
__exportStar(require("./gps-alertas"), exports); // verificarAtrasos, verificarChegadaPonto
__exportStar(require("./automacao-tarefas"), exports); // gerarTarefasGoJetFn, gerarTarefasAgendado, gerarSlotsAgendado, etc.
__exportStar(require("./relatorios"), exports); // enviarRelatorioManual, relatorioGuardSemanal, relatorioPerdasDiario, relatorioPerdasSemanal
__exportStar(require("./notificacoes-prestador"), exports); // notificarGestorNovaSolicitacao
// ══════════════════════════════════════════════════════════════════
// REVOGAR ACESSO — desativa usuário no Auth + Firestore
// ══════════════════════════════════════════════════════════════════
exports.revogarAcesso = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid)
        throw new Error('Não autenticado');
    const callerDoc = await db.collection('usuarios').doc(callerUid).get();
    const callerRole = callerDoc.data()?.role;
    if (!['admin', 'gestor', 'supergestor'].includes(callerRole)) {
        throw new Error('Sem permissão');
    }
    const { uid } = request.data;
    if (!uid)
        throw new Error('uid obrigatório');
    if (uid === callerUid)
        throw new Error('Não pode revogar o próprio acesso');
    await admin.auth().updateUser(uid, { disabled: true });
    await db.collection('usuarios').doc(uid).update({
        ativo: false,
        role: 'desativado',
        revogarEm: admin.firestore.FieldValue.serverTimestamp(),
        revogarPor: callerUid,
    });
    return { ok: true };
});
//# sourceMappingURL=index.js.map