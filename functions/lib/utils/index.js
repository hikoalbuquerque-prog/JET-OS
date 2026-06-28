"use strict";
// src/utils/index.ts
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
exports.validarLatLng = validarLatLng;
exports.limparNulos = limparNulos;
exports.normalizarLargura = normalizarLargura;
exports.gerarCodigo = gerarCodigo;
exports.erroResponse = erroResponse;
exports.okResponse = okResponse;
exports.logEvento = logEvento;
// ── VALIDAÇÕES ───────────────────────────────────────────────────
function validarLatLng(lat, lng) {
    const la = Number(lat), lo = Number(lng);
    return isFinite(la) && isFinite(lo)
        && la >= -90 && la <= 90
        && lo >= -180 && lo <= 180;
}
function limparNulos(obj) {
    const limpo = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === null || v === undefined || v === '')
            continue;
        if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
            const sub = limparNulos(v);
            if (Object.keys(sub).length > 0)
                limpo[k] = sub;
        }
        else {
            limpo[k] = v;
        }
    }
    return limpo;
}
// ── NORMALIZAÇÃO ─────────────────────────────────────────────────
function normalizarLargura(valor) {
    if (!valor)
        return null;
    const str = String(valor).replace(',', '.');
    const match = str.match(/(\d+(\.\d+)?)/);
    if (!match)
        return null;
    const num = parseFloat(match[1]);
    return num > 0 ? num : null;
}
function gerarCodigo(cidade, tipo) {
    const ts = Date.now().toString(36).toUpperCase();
    const cid = cidade.substring(0, 3).toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tip = tipo === 'PUBLICA' ? 'PUB' : tipo === 'PRIVADA' ? 'PRI' : 'CON';
    return `${cid}-${tip}-${ts}`;
}
// ── ERRO PADRÃO ──────────────────────────────────────────────────
function erroResponse(msg, code = 'ERRO') {
    return { ok: false, error: msg, code };
}
function okResponse(data) {
    return { ok: true, ...data };
}
// ── LOG DE EVENTO ────────────────────────────────────────────────
async function logEvento(params) {
    try {
        const { supabaseInsert } = await Promise.resolve().then(() => __importStar(require('../lib/supabase-rest')));
        await supabaseInsert('eventos', {
            tipo: 'audit',
            titulo: params.descricao,
            dados: { uid: params.uid, email: params.email, estacaoId: params.estacaoId, meta: params.meta },
            criado_em: new Date().toISOString(),
        });
    }
    catch (e) {
        console.error('[logEvento] erro:', e);
    }
}
//# sourceMappingURL=index.js.map