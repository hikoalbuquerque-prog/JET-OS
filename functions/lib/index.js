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
exports.buscarPOIsFn = exports.reverseGeocodeFn = exports.normalizarEstacoesFn = exports.gerarCroquisLoteFn = exports.gerarCroquiFn = exports.listarUsuariosFn = exports.listarSolicitacoesFn = exports.aprovarSolicitacaoFn = exports.solicitarAcessoFn = exports.getUsuarioFn = exports.analisarCalcadaFn = exports.svEstatisticasFn = exports.gerarStreetViewFn = exports.getEstacoesFn = exports.excluirEstacaoFn = exports.editarEstacaoFn = exports.addEstacaoFn = void 0;
// src/index.ts — entrada de todas as Cloud Functions
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
// Inicializa Firebase Admin uma vez
admin.initializeApp();
// Região São Paulo para todas as funções
(0, v2_1.setGlobalOptions)({ region: 'southamerica-east1' });
// Imports das funções de negócio
const estacoes_1 = require("./estacoes");
const croquis_1 = require("./croquis");
const auth_1 = require("./auth");
const streetview_1 = require("./streetview");
// ── HELPER: extrai uid e email do contexto auth ──────────────────
function getAuth(context) {
    if (!context.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login necessário.');
    return { uid: context.auth.uid, email: context.auth.token.email || '' };
}
async function checkRole(uid, roles) {
    const doc = await admin.firestore().collection('usuarios').doc(uid).get();
    if (!doc.exists || !roles.includes(doc.data().role)) {
        throw new https_1.HttpsError('permission-denied', 'Permissão negada.');
    }
}
// ── ESTAÇÕES ─────────────────────────────────────────────────────
exports.addEstacaoFn = (0, https_1.onCall)(async (request) => {
    const { uid, email } = getAuth(request);
    return (0, estacoes_1.addEstacao)(request.data, uid, email);
});
exports.editarEstacaoFn = (0, https_1.onCall)(async (request) => {
    const { uid, email } = getAuth(request);
    return (0, estacoes_1.editarEstacao)(request.data.codigo, request.data.campos, uid, email);
});
exports.excluirEstacaoFn = (0, https_1.onCall)(async (request) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    return (0, estacoes_1.excluirEstacao)(request.data.codigo, uid, email);
});
exports.getEstacoesFn = (0, https_1.onCall)(async (request) => {
    getAuth(request);
    return (0, estacoes_1.getEstacoes)(request.data?.cidade, request.data?.pais);
});
// ── STREET VIEW ──────────────────────────────────────────────────
exports.gerarStreetViewFn = (0, https_1.onCall)({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    const { uid, email } = getAuth(request);
    return (0, estacoes_1.gerarStreetView)(request.data.codigo, Number(request.data.lat), Number(request.data.lng), uid, email);
});
exports.svEstatisticasFn = (0, https_1.onCall)(async (request) => {
    getAuth(request);
    return (0, streetview_1.svGetEstatisticas)();
});
// ── IA ───────────────────────────────────────────────────────────
// // DESATIVADO — Gemini desligado para controle de custos
exports.analisarCalcadaFn = (0, https_1.onCall)(async () => ({ ok: false, desativado: true, msg: 'Análise IA desativada' }));
// ── AUTH ─────────────────────────────────────────────────────────
exports.getUsuarioFn = (0, https_1.onCall)(async (request) => {
    const { uid } = getAuth(request);
    return (0, auth_1.getUsuario)(uid);
});
exports.solicitarAcessoFn = (0, https_1.onCall)(async (request) => {
    return (0, auth_1.solicitarAcesso)(request.data);
});
exports.aprovarSolicitacaoFn = (0, https_1.onCall)(async (request) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    return (0, auth_1.aprovarSolicitacao)(request.data.solicitacaoId, uid, email);
});
exports.listarSolicitacoesFn = (0, https_1.onCall)(async (request) => {
    const { uid } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    return (0, auth_1.listarSolicitacoesPendentes)();
});
exports.listarUsuariosFn = (0, https_1.onCall)(async (request) => {
    const { uid } = getAuth(request);
    await checkRole(uid, ['admin']);
    return (0, auth_1.listarUsuarios)();
});
// ── CROQUIS ──────────────────────────────────────────────────────
exports.gerarCroquiFn = (0, https_1.onCall)({ timeoutSeconds: 300, memory: '512MiB', cors: ['https://jet-os-7.web.app', 'http://localhost:5173'] }, async (request) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    if (!process.env.OAUTH_REFRESH_TOKEN) {
        throw new https_1.HttpsError('failed-precondition', 'OAUTH_REFRESH_TOKEN não configurado. Configure via firebase functions:secrets:set OAUTH_REFRESH_TOKEN');
    }
    return (0, croquis_1.gerarCroqui)(request.data.estacaoId, uid, email);
});
// ── CROQUIS EM LOTE ──────────────────────────────────────────────
exports.gerarCroquisLoteFn = (0, https_1.onCall)({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    const { cidade, pais, loteSize = 20 } = request.data;
    return (0, croquis_1.gerarCroquisLote)(cidade, pais, loteSize, uid, email);
});
// ── NORMALIZAÇÃO ─────────────────────────────────────────────────
exports.normalizarEstacoesFn = (0, https_1.onCall)({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    const { cidade, pais, loteSize = 20 } = request.data;
    return (0, estacoes_1.normalizarEstacoes)(cidade, pais, uid, email, loteSize);
});
// ── GEOCODE REVERSO ──────────────────────────────────────────────
exports.reverseGeocodeFn = (0, https_1.onCall)(async (request) => {
    getAuth(request);
    const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
    const GMAPS_KEY = process.env.GMAPS_KEY || '';
    const { lat, lng } = request.data;
    const resp = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { latlng: `${lat},${lng}`, key: GMAPS_KEY } });
    const results = resp.data?.results || [];
    if (!results.length)
        return { ok: false, error: 'Sem resultados.' };
    const comps = results[0].address_components || [];
    const get = (type) => comps.find((c) => c.types.includes(type))?.long_name || '';
    const pais = get('country') === 'MX' ? 'MX' : 'BR';
    return {
        ok: true,
        geo: {
            endereco: results[0].formatted_address || '',
            bairro: get('sublocality_level_1') || get('neighborhood') || '',
            cidade: get('locality') || get('administrative_area_level_2') || '',
            estado: get('administrative_area_level_1') || '',
            pais,
            alcaldia: pais === 'MX' ? get('administrative_area_level_2') : ''
        }
    };
});
// ── POIs ────────────────────────────────────────────────────────
exports.buscarPOIsFn = (0, https_1.onCall)(async (request) => {
    getAuth(request); // valida autenticação
    const { lat, lng, raio, tipos } = request.data;
    return (0, estacoes_1.buscarPOIs)(Number(lat), Number(lng), Number(raio) || 300, tipos);
});
//# sourceMappingURL=index.js.map