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
exports.revogarAcesso = exports.aprovarSolicitacaoFn = exports.relatorioGuardManualFn = exports.relatorioGuardDiarioFn = exports.gerarStreetViewFn = exports.gerarCroquisLoteFn = exports.gerarCroquiFn = exports.healthCheck = exports.registrarLogAcesso = exports.getUsuarioFn = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const supabase_rest_1 = require("./lib/supabase-rest");
admin.initializeApp();
// maxInstances global: limita a CPU reservada por função no Cloud Run. Sem isso
// cada função pode escalar muito e o total estoura a cota regional de CPU em
// southamerica-east1 (erro "Quota exceeded for total allowable CPU") em deploys
// que recriam muitas funções de uma vez. Também controla custo (ver migração Supabase).
// Funções que precisarem de mais escala podem sobrescrever no próprio options.
(0, v2_1.setGlobalOptions)({ region: 'southamerica-east1', maxInstances: 3 });
// ─── CORS helper ──────────────────────────────────────────────────
function addCORS(res) {
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
        const d = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=*&uid=eq.${encodeURIComponent(uid)}`);
        if (!d) {
            res.status(404).json({ erro: 'Usuário não encontrado' });
            return;
        }
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
        const ok = await (0, supabase_rest_1.supabaseInsert)('logs_acesso', {
            uid, email, acao, resultado, metadados,
            timestamp: new Date().toISOString(),
            ip: req.ip || 'desconhecido',
        });
        res.json({ id: ok ? 'ok' : 'failed' });
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
exports.gerarCroquiFn = (0, https_1.onCall)({ timeoutSeconds: 300, memory: '512MiB', region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
    if (!request.auth)
        throw new Error('Não autenticado');
    const { estacaoId } = request.data;
    return (0, croquis_1.gerarCroqui)(estacaoId, request.auth.uid, request.auth.token.email || '');
});
exports.gerarCroquisLoteFn = (0, https_1.onCall)({ timeoutSeconds: 540, memory: '512MiB', region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
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
exports.gerarStreetViewFn = (0, https_1.onCall)({ timeoutSeconds: 120, memory: '256MiB', region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
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
// relatorioGuardDiarioFn: scheduler diário 7h (ter-dom, reporta o dia anterior)
// relatorioGuardManualFn: callable para botão no DashboardManager
// relatorioGuardSemanal: scheduler toda segunda 7h (já em relatorios.ts)
// ══════════════════════════════════════════════════════════════════
const relatorio_1 = require("./relatorio");
// Diário — 7h, terça a domingo (reporta o dia anterior)
// Segunda-feira envia o semanal no lugar
exports.relatorioGuardDiarioFn = (0, scheduler_1.onSchedule)({ schedule: '0 7 * * 2-7', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 120, maxInstances: 10 }, async () => {
    // Reporta o dia anterior
    const ontem = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    ontem.setDate(ontem.getDate() - 1);
    const dataStr = ontem.toISOString().slice(0, 10);
    const relatorio = await (0, relatorio_1.gerarRelatorioGuard)(dataStr);
    await (0, relatorio_1.enviarRelatorioTelegram)(relatorio);
    console.log('[guard-diario] Enviado para', dataStr, '—', relatorio.totalOcorrencias, 'ocorrências');
});
// Manual — callable para o botão "Enviar relatório agora" no DashboardManager
exports.relatorioGuardManualFn = (0, https_1.onCall)({ timeoutSeconds: 180, memory: '256MiB', region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
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
exports.aprovarSolicitacaoFn = (0, https_1.onCall)({ timeoutSeconds: 60, memory: '256MiB', region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
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
// gps-ingest REMOVIDO — GPS nativo agora usa Edge Function Supabase (ingest-gps)
__exportStar(require("./automacao-tarefas"), exports); // gerarTarefasGoJetFn, gerarTarefasAgendado, etc.
__exportStar(require("./relatorios"), exports); // enviarRelatorioManual, relatorioGuardSemanal, relatorioPerdasDiario, relatorioPerdasSemanal
__exportStar(require("./notificacoes-prestador"), exports); // notificarGestorNovaSolicitacao
// ── Mirror functions removidos (Firestore→Supabase dual-write aposentado) ──
__exportStar(require("./buscar-pois-osm"), exports); // buscarPOIsOSMFn — Overpass/OSM server-side (gratuito; resolve CORS/429)
__exportStar(require("./slots-telegram"), exports); // resumoSlotsTelegram, confirmarSlotsCascata, enviarResumoManual
__exportStar(require("./web-push"), exports); // registrarPushSubscription, enviarPushParaUsuario/Role
// ══════════════════════════════════════════════════════════════════
// REVOGAR ACESSO — desativa usuário no Auth + Firestore
// ══════════════════════════════════════════════════════════════════
exports.revogarAcesso = (0, https_1.onCall)({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid)
        throw new Error('Não autenticado');
    const callerRow = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=role&uid=eq.${encodeURIComponent(callerUid)}`);
    const callerRole = callerRow?.role;
    if (!['admin', 'gestor', 'supergestor'].includes(callerRole)) {
        throw new Error('Sem permissão');
    }
    const { uid } = request.data;
    if (!uid)
        throw new Error('uid obrigatório');
    if (uid === callerUid)
        throw new Error('Não pode revogar o próprio acesso');
    await admin.auth().updateUser(uid, { disabled: true });
    await (0, supabase_rest_1.supabaseUpdate)('usuarios', {
        ativo: false,
        role: 'desativado',
        revogar_em: new Date().toISOString(),
        revogar_por: callerUid,
    }, `uid=eq.${encodeURIComponent(uid)}`);
    return { ok: true };
});
//# sourceMappingURL=index.js.map