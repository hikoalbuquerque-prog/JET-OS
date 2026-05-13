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
// src/auth/index.ts
const admin = __importStar(require("firebase-admin"));
const utils_1 = require("../utils");
// ── LOGIN (valida usuário no Firestore) ──────────────────────────
async function getUsuario(uid) {
    const doc = await (0, utils_1.db)().collection('usuarios').doc(uid).get();
    if (!doc.exists)
        return (0, utils_1.erroResponse)('Usuário não encontrado.');
    const data = doc.data();
    if (!data.ativo)
        return (0, utils_1.erroResponse)('Usuário inativo.');
    // Atualiza último acesso
    await (0, utils_1.db)().collection('usuarios').doc(uid).update({
        ultimoAcesso: admin.firestore.FieldValue.serverTimestamp()
    });
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
async function solicitarAcesso(payload) {
    const { email, nome, paises, motivo } = payload;
    if (!email || !nome || !paises?.length) {
        return (0, utils_1.erroResponse)('Email, nome e países são obrigatórios.');
    }
    // Verifica se já tem solicitação pendente
    const existente = await (0, utils_1.db)().collection('solicitacoes')
        .where('email', '==', email)
        .where('status', '==', 'PENDENTE')
        .get();
    if (!existente.empty) {
        return (0, utils_1.erroResponse)('Já existe uma solicitação pendente para este email.');
    }
    await (0, utils_1.db)().collection('solicitacoes').add({
        email, nome, paises,
        motivo: motivo || '',
        status: 'PENDENTE',
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    return (0, utils_1.okResponse)({ mensagem: 'Solicitação enviada com sucesso.' });
}
// ── APROVAR SOLICITAÇÃO (gestor/admin) ───────────────────────────
async function aprovarSolicitacao(solicitacaoId, uid, email) {
    const ref = (0, utils_1.db)().collection('solicitacoes').doc(solicitacaoId);
    const doc = await ref.get();
    if (!doc.exists)
        return (0, utils_1.erroResponse)('Solicitação não encontrada.');
    const sol = doc.data();
    // Cria usuário no Auth (ou busca existente)
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
    // Cria perfil no Firestore
    await (0, utils_1.db)().collection('usuarios').doc(userRecord.uid).set({
        uid: userRecord.uid,
        email: sol.email,
        nome: sol.nome,
        role: 'campo',
        paises: sol.paises,
        ativo: true,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        ultimoAcesso: null
    });
    // Envia email de boas-vindas com link para definir senha
    try {
        const WEB_API_KEY = process.env.WEB_API_KEY || '';
        if (WEB_API_KEY) {
            const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
            await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${WEB_API_KEY}`, {
                requestType: 'PASSWORD_RESET',
                email: sol.email,
                continueUrl: 'https://jet-os-7.web.app'
            });
            console.log(`[aprovar] Email de reset enviado para ${sol.email}`);
        }
        else {
            // Fallback: gera o link e loga (admin pode enviar manualmente)
            const link = await admin.auth().generatePasswordResetLink(sol.email, {
                url: 'https://jet-os-7.web.app'
            });
            console.log(`[aprovar] Link de reset para ${sol.email}: ${link}`);
        }
    }
    catch (e) {
        console.error('[aprovar] Erro ao enviar email:', e);
        // Não falha a aprovação por causa do email
    }
    // Atualiza solicitação
    await ref.update({
        status: 'APROVADA',
        resolvidoEm: admin.firestore.FieldValue.serverTimestamp(),
        resolvidoPor: email
    });
    await (0, utils_1.logEvento)({
        tipo: 'STATUS_CHANGED',
        uid, email,
        descricao: `Solicitação aprovada: ${sol.email}`
    });
    return (0, utils_1.okResponse)({ uid: userRecord.uid, mensagem: 'Usuário criado com sucesso.' });
}
// ── LISTAR SOLICITAÇÕES PENDENTES ────────────────────────────────
async function listarSolicitacoesPendentes() {
    const snap = await (0, utils_1.db)().collection('solicitacoes')
        .where('status', '==', 'PENDENTE')
        .orderBy('criadoEm', 'desc')
        .get();
    return (0, utils_1.okResponse)({
        solicitacoes: snap.docs.map(d => ({ id: d.id, ...d.data() }))
    });
}
// ── LISTAR USUÁRIOS ──────────────────────────────────────────────
async function listarUsuarios() {
    const snap = await (0, utils_1.db)().collection('usuarios')
        .orderBy('criadoEm', 'desc')
        .get();
    return (0, utils_1.okResponse)({
        usuarios: snap.docs.map(d => d.data())
    });
}
//# sourceMappingURL=index.js.map