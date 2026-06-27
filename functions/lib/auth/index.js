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
exports.getUsuario = getUsuario;
exports.solicitarAcesso = solicitarAcesso;
exports.aprovarSolicitacao = aprovarSolicitacao;
exports.listarSolicitacoesPendentes = listarSolicitacoesPendentes;
exports.listarUsuarios = listarUsuarios;
// functions/src/auth/index.ts
const admin = __importStar(require("firebase-admin"));
const utils_1 = require("../utils");
const supabase_rest_1 = require("../lib/supabase-rest");
const notificacoes_prestador_1 = require("../notificacoes-prestador");
// ── GET USUÁRIO ──────────────────────────────────────────────────
async function getUsuario(uid) {
    const data = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=*&uid=eq.${encodeURIComponent(uid)}`);
    if (!data)
        return (0, utils_1.erroResponse)('Usuário não encontrado.');
    if (!data.ativo)
        return (0, utils_1.erroResponse)('Usuário inativo.');
    await (0, supabase_rest_1.supabaseUpdate)('usuarios', {
        ultimo_acesso: new Date().toISOString()
    }, `uid=eq.${encodeURIComponent(uid)}`);
    return (0, utils_1.okResponse)({
        usuario: {
            uid: data.uid,
            email: data.email,
            nome: data.nome,
            role: data.role,
            paises: data.paises || ['BR']
        }
    });
}
// ── SOLICITAR ACESSO ─────────────────────────────────────────────
// roleDesejado: 'campo' | 'guard' — default 'campo'
async function solicitarAcesso(payload) {
    const { email, nome, paises, motivo, roleDesejado } = payload;
    if (!email || !nome || !paises?.length) {
        return (0, utils_1.erroResponse)('Email, nome e países são obrigatórios.');
    }
    const existente = await (0, supabase_rest_1.supabaseGet)('solicitacoes_prestadores', `select=id&email=eq.${encodeURIComponent(email)}&status=eq.PENDENTE`);
    if (existente && existente.length > 0) {
        return (0, utils_1.erroResponse)('Já existe uma solicitação pendente para este email.');
    }
    const rolesValidos = ['campo', 'guard'];
    const roleValido = rolesValidos.includes(roleDesejado || '') ? roleDesejado : 'campo';
    await (0, supabase_rest_1.supabaseInsert)('solicitacoes_prestadores', {
        email,
        nome,
        paises,
        motivo: motivo || '',
        role_desejado: roleValido,
        status: 'PENDENTE',
        criado_em: new Date().toISOString()
    });
    (0, notificacoes_prestador_1.notificarGestorNovaSolicitacao)({ nome, cargo: roleValido, cidade: paises?.[0] ?? '', email }).catch(() => { });
    return (0, utils_1.okResponse)({ mensagem: 'Solicitação enviada com sucesso.' });
}
// ── APROVAR SOLICITAÇÃO ──────────────────────────────────────────
// roleOverride: gestor pode forçar o role na hora de aprovar
//   'campo' → acessa TelaMapa (estações)
//   'guard' → acessa TelaGuard (ocorrências)
async function aprovarSolicitacao(solicitacaoId, uid, email, roleOverride) {
    const sol = await (0, supabase_rest_1.supabaseGetOne)('solicitacoes_prestadores', `select=*&id=eq.${encodeURIComponent(solicitacaoId)}`);
    if (!sol)
        return (0, utils_1.erroResponse)('Solicitação não encontrada.');
    // Determina role final: override > roleDesejado da solicitação > fallback 'campo'
    const rolesPermitidos = ['campo', 'guard'];
    let roleFinal = 'campo';
    if (roleOverride && rolesPermitidos.includes(roleOverride)) {
        roleFinal = roleOverride;
    }
    else if (sol.role_desejado && rolesPermitidos.includes(sol.role_desejado)) {
        roleFinal = sol.role_desejado;
    }
    // Cria ou busca usuário no Firebase Auth
    let userRecord;
    try {
        userRecord = await admin.auth().getUserByEmail(sol.email);
    }
    catch {
        userRecord = await admin.auth().createUser({
            email: sol.email,
            password: Math.random().toString(36).slice(-10) + 'A1!',
            displayName: sol.nome
        });
    }
    // Cria / sobrescreve perfil no Supabase com role correto
    await (0, supabase_rest_1.supabaseUpsert)('usuarios', {
        uid: userRecord.uid,
        email: sol.email,
        nome: sol.nome,
        role: roleFinal,
        paises: sol.paises,
        ativo: true,
        criado_em: new Date().toISOString(),
        ultimo_acesso: null
    });
    // Envia email de reset de senha para o novo usuário definir a senha
    try {
        const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';
        if (FIREBASE_WEB_API_KEY) {
            const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
            await axios.post('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + FIREBASE_WEB_API_KEY, {
                requestType: 'PASSWORD_RESET',
                email: sol.email,
                continueUrl: 'https://jet-os-7.web.app'
            });
            console.log('[aprovar] Email de reset enviado para ' + sol.email);
        }
        else {
            const link = await admin.auth().generatePasswordResetLink(sol.email, {
                url: 'https://jet-os-7.web.app'
            });
            console.log('[aprovar] Link de reset para ' + sol.email + ': ' + link);
        }
    }
    catch (e) {
        console.error('[aprovar] Erro ao enviar email:', e);
        // Não falha a aprovação por causa do email
    }
    // Atualiza solicitação
    await (0, supabase_rest_1.supabaseUpdate)('solicitacoes_prestadores', {
        status: 'APROVADA',
        resolvido_em: new Date().toISOString(),
        resolvido_por: email,
        role_atribuido: roleFinal
    }, `id=eq.${encodeURIComponent(solicitacaoId)}`);
    await (0, utils_1.logEvento)({
        tipo: 'STATUS_CHANGED',
        uid,
        email,
        descricao: 'Solicitação aprovada como [' + roleFinal + ']: ' + sol.email
    });
    return (0, utils_1.okResponse)({
        uid: userRecord.uid,
        role: roleFinal,
        mensagem: 'Usuário criado como ' + roleFinal + '.'
    });
}
// ── LISTAR SOLICITAÇÕES PENDENTES ────────────────────────────────
async function listarSolicitacoesPendentes() {
    const rows = await (0, supabase_rest_1.supabaseGet)('solicitacoes_prestadores', 'select=*&status=eq.PENDENTE&order=criado_em.desc');
    return (0, utils_1.okResponse)({
        solicitacoes: rows ?? []
    });
}
// ── LISTAR USUÁRIOS ──────────────────────────────────────────────
async function listarUsuarios() {
    const rows = await (0, supabase_rest_1.supabaseGet)('usuarios', 'select=*&order=criado_em.desc');
    return (0, utils_1.okResponse)({
        usuarios: rows ?? []
    });
}
//# sourceMappingURL=index.js.map