"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsuario = getUsuario;
exports.solicitarAcesso = solicitarAcesso;
exports.aprovarSolicitacao = aprovarSolicitacao;
exports.listarSolicitacoesPendentes = listarSolicitacoesPendentes;
exports.listarUsuarios = listarUsuarios;
// functions/src/auth/index.ts
const utils_1 = require("../utils");
const supabase_rest_1 = require("../lib/supabase-rest");
const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE ?? '';
async function sbAdminRequest(method, path, body) {
    const res = await fetch(`${SB_URL()}/auth/v1/admin/${path}`, {
        method,
        headers: {
            apikey: SB_KEY(),
            Authorization: `Bearer ${SB_KEY()}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Supabase Auth ${method} ${path}: ${res.status} ${txt}`);
    }
    return res.json();
}
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
    // Cria ou busca usuário no Supabase Auth
    let userId;
    try {
        const existing = await sbAdminRequest('GET', `users?filter=${encodeURIComponent(sol.email)}`);
        const found = existing?.users?.find((u) => u.email === sol.email);
        if (found) {
            userId = found.id;
        }
        else {
            const created = await sbAdminRequest('POST', 'users', {
                email: sol.email,
                password: Math.random().toString(36).slice(-10) + 'A1!',
                email_confirm: true,
                user_metadata: { nome: sol.nome },
            });
            userId = created.id;
        }
    }
    catch (e) {
        console.error('[aprovar] Erro ao criar usuário Supabase Auth:', e);
        return (0, utils_1.erroResponse)('Erro ao criar usuário no Auth.');
    }
    await (0, supabase_rest_1.supabaseUpsert)('usuarios', {
        uid: userId,
        email: sol.email,
        nome: sol.nome,
        role: roleFinal,
        paises: sol.paises,
        ativo: true,
        criado_em: new Date().toISOString(),
        ultimo_acesso: null
    });
    // Envia link de recovery (reset de senha) via Supabase Auth
    try {
        const linkData = await sbAdminRequest('POST', 'generate_link', {
            type: 'recovery',
            email: sol.email,
            options: { redirect_to: 'https://jet-os-1.web.app' },
        });
        console.log('[aprovar] Link de recovery gerado para ' + sol.email + ': ' + (linkData?.action_link || 'ok'));
    }
    catch (e) {
        console.error('[aprovar] Erro ao gerar link de recovery:', e);
    }
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
        uid: userId,
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