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
exports.registrarTelegramChatId = exports.testarTelegram = exports.notificarTarefa = exports.notificarOcorrencia = exports.aceitarSlot = void 0;
const https_1 = require("firebase-functions/v2/https");
const config_supabase_1 = require("./config-supabase");
const supabase_rest_1 = require("./lib/supabase-rest");
// functions/src/slots.ts
// Cloud Functions para módulo Slots + Logística + Telegram
// Adicionar ao index.ts: export * from './slots';
//
// Requer no Firebase Functions config (ou Secret Manager):
//   firebase functions:config:set telegram.bot_token="SEU_TOKEN"
// OU via Secret Manager (recomendado prod):
//   defineSecret('TELEGRAM_BOT_TOKEN') no index.ts
// ─── CORS helper (mesmo padrão do index.ts existente) ────────────────────────
function addCORS(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
}
async function getBotToken() {
    try {
        // Supabase config_telegram (where DashboardManager saves)
        const supaCfg = await (0, config_supabase_1.getAppSetting)('config_telegram');
        const cfgToken = String(supaCfg?.bot_token || supaCfg?.botToken || '').trim();
        if (cfgToken)
            return cfgToken;
        // Supabase app_settings/telegram (legacy key)
        const supa = await (0, config_supabase_1.getAppSetting)('telegram');
        const supaToken = String(supa?.bot_token || supa?.botToken || '').trim();
        if (supaToken)
            return supaToken;
        // Supabase telegram_config table
        const { getTelegramConfigSupa } = await Promise.resolve().then(() => __importStar(require('./telegram-supabase')));
        const tgCfg = await getTelegramConfigSupa('global');
        return String(tgCfg?.bot_token || '').trim();
    }
    catch {
        return '';
    }
}
async function sendTelegram(token, target, text, parseMode = 'HTML') {
    if (!token || !target.chatId)
        return false;
    try {
        const body = {
            chat_id: target.chatId,
            text,
            parse_mode: parseMode,
            disable_web_page_preview: true,
        };
        if (target.threadId) {
            body.message_thread_id = target.threadId;
        }
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = await resp.json();
        if (!json.ok) {
            console.error('[telegram] sendMessage error:', json.description);
            return false;
        }
        return true;
    }
    catch (e) {
        console.error('[telegram] fetch error:', e);
        return false;
    }
}
// Mapeia cargo para grupo e tópico
const CARGO_PARA_GRUPO = {
    charger: { grupo: 'logistica', topico: 'charger' },
    scalt: { grupo: 'logistica', topico: 'scalt' },
    promotor: { grupo: 'promo', topico: 'promotor' },
    fiscal: { grupo: 'promo', topico: 'fiscal' },
    seguranca: { grupo: 'seguranca', topico: 'seguranca' },
};
async function getConfig() {
    // Supabase telegram_config table
    let supaTgCfg = null;
    try {
        const { getTelegramConfigSupa } = await Promise.resolve().then(() => __importStar(require('./telegram-supabase')));
        supaTgCfg = await getTelegramConfigSupa('global');
    }
    catch { /* fallback */ }
    const [supaCfgTelegram, supaTelegram] = await Promise.all([
        (0, config_supabase_1.getAppSetting)('config_telegram'),
        (0, config_supabase_1.getAppSetting)('telegram'),
    ]);
    // Prioridade: Supabase telegram_config → app_settings/config_telegram → app_settings/telegram
    const botToken = (supaTgCfg?.bot_token ||
        supaCfgTelegram?.bot_token || supaCfgTelegram?.botToken ||
        supaTelegram?.bot_token || supaTelegram?.botToken || '');
    const guardChatId = (supaTgCfg?.guard_chat_id || supaTgCfg?.relatorios_chat_id ||
        supaCfgTelegram?.chat_id || supaCfgTelegram?.relatoriosChatId ||
        supaTelegram?.relatorios_chat_id || supaTelegram?.relatoriosChatId || supaTelegram?.chat_id || '');
    const globalCfg = {
        botToken,
        diretoria: supaTgCfg?.diretoria ?? [],
        regionais: supaTgCfg?.regionais ?? [],
        guardChatId,
    };
    // Cidades from Supabase telegram_config
    const cidadesSupa = (supaTgCfg?.cidades && typeof supaTgCfg.cidades === 'object')
        ? supaTgCfg.cidades
        : {};
    return {
        global: globalCfg,
        cidades: cidadesSupa,
    };
}
function cidadeParaChave(cidade) {
    return cidade
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .toLowerCase();
}
// Envia para um cargo específico na cidade (tópico do cargo)
async function notificarCargo(token, cidadeConfig, cargo, texto) {
    const mapeamento = CARGO_PARA_GRUPO[cargo];
    if (!mapeamento)
        return;
    const grupo = cidadeConfig.grupos[mapeamento.grupo];
    if (!grupo?.chatId)
        return;
    const threadId = grupo.topicos[mapeamento.topico] ?? null;
    await sendTelegram(token, { chatId: grupo.chatId, threadId }, texto);
}
// Envia para o tópico de alertas da cidade
async function notificarAlertas(token, cidadeConfig, texto) {
    for (const grupo of Object.values(cidadeConfig.grupos)) {
        if (!grupo.chatId)
            continue;
        const threadId = grupo.topicos['alertas'] ?? null;
        await sendTelegram(token, { chatId: grupo.chatId, threadId }, texto);
        break; // só envia no primeiro grupo que tiver alertas
    }
}
// Envia para líderes e gerentes da cidade
async function notificarGestoresCidade(token, cidadeConfig, texto, nivel) {
    const gestores = nivel
        ? cidadeConfig.gestores.filter(g => g.nivel === nivel)
        : cidadeConfig.gestores;
    for (const g of gestores) {
        const user = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=telegram_chat_id&firebase_uid=eq.${encodeURIComponent(g.uid)}`);
        const telegramChatId = user?.telegram_chat_id;
        if (telegramChatId) {
            await sendTelegram(token, { chatId: telegramChatId }, texto);
        }
    }
}
async function notificarDiretoria(token, globalCfg, texto) {
    const todos = [...globalCfg.diretoria, ...globalCfg.regionais];
    for (const g of todos) {
        const user = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=telegram_chat_id&firebase_uid=eq.${encodeURIComponent(g.uid)}`);
        const telegramChatId = user?.telegram_chat_id;
        if (telegramChatId) {
            await sendTelegram(token, { chatId: telegramChatId }, texto);
        }
    }
}
// ─── FUNCTION: aceitarSlot (onCall — autenticado) ────────────────────────────
exports.aceitarSlot = (0, https_1.onCall)(async (request) => {
    // Verificação de autenticação
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Autenticação necessária');
    }
    const { slotId } = request.data;
    if (!slotId || typeof slotId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'slotId é obrigatório');
    }
    const uid = request.auth.uid;
    const userData = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=*&id=eq.${encodeURIComponent(uid)}`);
    if (!userData) {
        throw new https_1.HttpsError('not-found', 'Usuário não encontrado');
    }
    if (userData.status_prestador !== 'ativo') {
        throw new https_1.HttpsError('permission-denied', 'Prestador inativo');
    }
    let slotData;
    try {
        slotData = await (0, supabase_rest_1.supabaseGetOne)('slots', `select=*&id=eq.${encodeURIComponent(slotId)}`);
        if (!slotData) {
            throw new https_1.HttpsError('not-found', 'Slot não encontrado');
        }
        if (slotData.status !== 'aberto') {
            throw new https_1.HttpsError('failed-precondition', slotData.status === 'aceito'
                ? 'Este slot já foi aceito por outro operador'
                : `Slot não está disponível (status: ${slotData.status})`);
        }
        if (slotData.cargo !== userData.cargo_prestador) {
            throw new https_1.HttpsError('permission-denied', `Este slot é para ${slotData.cargo}, seu cargo é ${userData.cargo_prestador}`);
        }
        const agora = new Date().toISOString();
        await (0, supabase_rest_1.supabaseUpdate)('slots', {
            status: 'aceito',
            aceito_por: uid,
            aceito_por_nome: userData.nome,
            aceito_em: agora,
            atualizado_em: agora,
        }, `id=eq.${encodeURIComponent(slotId)}&status=eq.aberto`);
        await (0, supabase_rest_1.supabaseUpdate)('usuarios', {
            slot_atual_id: slotId,
        }, `id=eq.${encodeURIComponent(uid)}`);
    }
    catch (e) {
        if (e instanceof https_1.HttpsError)
            throw e;
        console.error('[aceitarSlot] error:', e);
        throw new https_1.HttpsError('internal', 'Erro ao aceitar slot');
    }
    // Telegram — não bloqueia a resposta
    setImmediate(async () => {
        try {
            const { global: globalCfg, cidades } = await getConfig();
            if (!globalCfg.botToken)
                return;
            const cidadeKey = cidadeParaChave(slotData.cidade);
            const cidadeCfg = cidades[cidadeKey];
            if (!cidadeCfg)
                return;
            const emoji = slotData.cargo === 'charger' ? '⚡'
                : slotData.cargo === 'scalt' ? '📦'
                    : slotData.cargo === 'promotor' ? '📢'
                        : slotData.cargo === 'fiscal' ? '🔍'
                            : slotData.cargo === 'seguranca' ? '🛡' : '👤';
            const texto = `${emoji} <b>Slot aceito</b>\n\n`
                + `👤 ${userData.nome}\n`
                + `📋 ${slotData.titulo}\n`
                + `🏙 ${slotData.cidade}\n`
                + `⏰ ${new Date(slotData.turnoInicio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
                + ` → ${new Date(slotData.turnoFim).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
            // 1. Tópico do cargo
            await notificarCargo(globalCfg.botToken, cidadeCfg, slotData.cargo, texto);
            // 2. Líderes da cidade (DM)
            await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto, 'lider');
        }
        catch (e) {
            console.error('[aceitarSlot] telegram error:', e);
        }
    });
    return { sucesso: true, slotId };
});
// ─── FUNCTION: notificarOcorrencia (onCall) ───────────────────────────────────
exports.notificarOcorrencia = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Autenticação necessária');
    }
    const { ocorrenciaId, statusAtualizado } = request.data;
    if (!ocorrenciaId) {
        throw new https_1.HttpsError('invalid-argument', 'ocorrenciaId obrigatório');
    }
    const oc = await (0, supabase_rest_1.supabaseGetOne)('ocorrencias', `select=*&id=eq.${encodeURIComponent(ocorrenciaId)}`);
    if (!oc) {
        throw new https_1.HttpsError('not-found', 'Ocorrência não encontrada');
    }
    const { global: globalCfg, cidades } = await getConfig();
    if (!globalCfg.botToken)
        return { enviado: false, motivo: 'bot_token_ausente' };
    const cidadeRaw = oc.cidade || '';
    const cidadeKey = cidadeParaChave(cidadeRaw);
    const cidadeCfg = cidades[cidadeKey];
    const tipoLabel = {
        roubo: '🚨 ROUBO',
        vandalismo: '🔨 Vandalismo',
        patinete_danificado: '🛴 Patinete danificado',
        ponto_bloqueado: '🚧 Ponto bloqueado',
        usuario_infrator: '⚠️ Usuário infrator',
        outro: '📝 Ocorrência',
        Roubo: '🚨 ROUBO',
        Tentativa: '🟠 Tentativa de roubo',
        Vandalismo: '🟡 Vandalismo',
        Recuperacao: '🟢 Recuperação',
        Outro: '📝 Ocorrência',
    };
    const statusFinal = statusAtualizado || oc.status;
    const isRecuperado = statusFinal === 'Recuperado' && statusAtualizado;
    const urgente = ['Roubo', 'roubo', 'Tentativa', 'tentativa'].includes(oc.tipo)
        || !!oc.procurando || isRecuperado;
    const tipoEmoji = tipoLabel[oc.tipo] ?? '📝 Ocorrência';
    const assetInfo = [oc.asset_id, oc.ativo_tipo]
        .filter(Boolean).join(' · ');
    const texto = [
        isRecuperado ? '✅ *RECUPERADO*' : (urgente ? '🚨 *ALERTA URGENTE*' : ''),
        '',
        `${tipoEmoji}`,
        '',
        `👤 *${oc.registrado_por_nome || 'Guard'}*${oc.turno ? ' · ' + oc.turno : ''}`,
        `🏙 ${cidadeRaw}${oc.bairro ? ' / ' + oc.bairro : ''}`,
        assetInfo ? `🛴 ${assetInfo}` : '',
        oc.procurando
            ? `\n🔍 *PROCURANDO*`
            : '',
        oc.bo_numero ? `📋 BO: ${oc.bo_numero}` : '',
        '',
        oc.descricao ? `_${String(oc.descricao).slice(0, 300)}_` : '',
        '',
        `🕐 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        `🆔 ${ocorrenciaId}`,
    ].filter(l => l !== '').join('\n');
    let enviouAlgum = false;
    // 1. Envia para cidade configurada (sistema hierárquico)
    if (cidadeCfg) {
        if (urgente) {
            await notificarAlertas(globalCfg.botToken, cidadeCfg, texto);
            await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto);
            await notificarDiretoria(globalCfg.botToken, globalCfg, texto);
        }
        else {
            const cargoOcorrencia = oc.cargo || 'seguranca';
            await notificarCargo(globalCfg.botToken, cidadeCfg, cargoOcorrencia, texto);
        }
        enviouAlgum = true;
    }
    // 2. Fallback: sempre envia Roubo/Tentativa/Procurado para grupo Guard Reports
    // (config/telegram chat_id) independente de cidade configurada
    const guardChatId = globalCfg.guardChatId;
    if (urgente && guardChatId && globalCfg.botToken) {
        try {
            await sendTelegram(globalCfg.botToken, { chatId: guardChatId, threadId: null }, texto);
            enviouAlgum = true;
            console.log('[notificar] Alerta enviado para Guard Reports:', guardChatId);
        }
        catch (e) {
            console.error('[notificar] Erro Guard Reports:', e.message);
        }
    }
    if (!enviouAlgum) {
        console.warn('[notificar] Sem destino configurado para', cidadeRaw);
    }
    await (0, supabase_rest_1.supabaseUpdate)('ocorrencias', {
        telegram_enviado: true,
        atualizado_em: new Date().toISOString(),
    }, `id=eq.${encodeURIComponent(ocorrenciaId)}`);
    return { enviado: true, urgente };
});
// ─── FUNCTION: notificarTarefa (onCall) ──────────────────────────────────────
exports.notificarTarefa = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Autenticação necessária');
    }
    const { tarefaId, evento } = request.data;
    // evento: 'concluida' | 'rejeitada' | 'iniciada'
    if (!tarefaId || !evento) {
        throw new https_1.HttpsError('invalid-argument', 'tarefaId e evento obrigatórios');
    }
    const t = await (0, supabase_rest_1.supabaseGetOne)('tarefas', `select=*&id=eq.${encodeURIComponent(tarefaId)}`);
    if (!t) {
        throw new https_1.HttpsError('not-found', 'Tarefa não encontrada');
    }
    const { global: globalCfg, cidades } = await getConfig();
    if (!globalCfg.botToken)
        return { enviado: false };
    const cidadeKey = cidadeParaChave(t.cidade);
    const cidadeCfg = cidades[cidadeKey];
    if (!cidadeCfg)
        return { enviado: false, motivo: 'cidade_sem_config' };
    const eventoLabel = {
        concluida: '✅ Tarefa concluída',
        rejeitada: '❌ Tarefa rejeitada',
        iniciada: '▶️ Tarefa iniciada',
    };
    const texto = `${eventoLabel[evento] ?? '📋 Tarefa atualizada'}\n\n`
        + `📋 ${t.titulo}\n`
        + `👤 ${t.assignee_nome ?? 'Sem operador'}\n`
        + `🏙 ${t.cidade}\n`
        + (t.motivo_rejeicao ? `💬 Motivo: ${t.motivo_rejeicao}\n` : '')
        + (t.estacao?.nome ? `📍 ${t.estacao.nome}\n` : '');
    // Conclui/rejeita: notifica líder e gerente
    if (evento === 'concluida' || evento === 'rejeitada') {
        await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto);
    }
    else {
        // Iniciada: só líder
        await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto, 'lider');
    }
    return { enviado: true };
});
// ─── FUNCTION: testarTelegram (onRequest — admin only) ────────────────────────
exports.testarTelegram = (0, https_1.onRequest)((req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    (async () => {
        try {
            // Verifica token Firebase do caller
            const auth = req.headers.authorization;
            if (!auth?.startsWith('Bearer ')) {
                res.status(401).json({ erro: 'Não autorizado' });
                return;
            }
            const token = auth.split(' ')[1];
            const decoded = await (0, supabase_rest_1.verifySupabaseToken)(token);
            const userRow = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=role&id=eq.${encodeURIComponent(decoded.uid)}`);
            if (!['admin', 'gestor'].includes(userRow?.role ?? '')) {
                res.status(403).json({ erro: 'Permissão negada' });
                return;
            }
            const { chatId, topicId } = req.body;
            const botToken = await getBotToken();
            if (!botToken) {
                res.status(400).json({ erro: 'Bot token não configurado' });
                return;
            }
            const ok = await sendTelegram(botToken, { chatId, threadId: topicId ?? null }, '✅ <b>JET OS</b> — Teste de notificação\n\nConfiguração funcionando corretamente.');
            res.json({ enviado: ok });
        }
        catch (e) {
            console.error('[testarTelegram]', e);
            res.status(500).json({ erro: e.message });
        }
    })();
});
// ─── FUNCTION: registrarTelegramChatId (onCall) ──────────────────────────────
// Operador chama essa função após iniciar conversa com o bot
// O bot envia /start e o app salva o chatId do operador para DMs
exports.registrarTelegramChatId = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Autenticação necessária');
    }
    const { telegramChatId } = request.data;
    if (!telegramChatId) {
        throw new https_1.HttpsError('invalid-argument', 'telegramChatId obrigatório');
    }
    await (0, supabase_rest_1.supabaseUpdate)('usuarios', {
        telegram_chat_id: String(telegramChatId),
    }, `id=eq.${encodeURIComponent(request.auth.uid)}`);
    return { sucesso: true };
});
//# sourceMappingURL=slots.js.map