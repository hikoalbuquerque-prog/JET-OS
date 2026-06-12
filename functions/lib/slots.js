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
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
// functions/src/slots.ts
// Cloud Functions para módulo Slots + Logística + Telegram
// Adicionar ao index.ts: export * from './slots';
//
// Requer no Firebase Functions config (ou Secret Manager):
//   firebase functions:config:set telegram.bot_token="SEU_TOKEN"
// OU via Secret Manager (recomendado prod):
//   defineSecret('TELEGRAM_BOT_TOKEN') no index.ts
const db = admin.firestore();
// ─── CORS helper (mesmo padrão do index.ts existente) ────────────────────────
function addCORS(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
}
async function getBotToken() {
    try {
        const snap = await db.collection('telegram_config').doc('global').get();
        return snap.data()?.botToken ?? '';
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
    const [gSnap, cSnap, legSnap] = await Promise.all([
        db.collection('telegram_config').doc('global').get(),
        db.collection('telegram_config').doc('cidades').get(),
        db.collection('config').doc('telegram').get(), // onde DashboardManager salva
    ]);
    // Monta config global unificando as duas fontes
    const gData = gSnap.data() ?? {};
    const legData = legSnap.data() ?? {};
    // Prioridade: telegram_config/global → config/telegram
    const botToken = (gData.botToken || gData.bot_token ||
        legData.botToken || legData.bot_token || '');
    // Chat ID do grupo Guard Reports (usado como fallback para alertas)
    const guardChatId = (gData.relatoriosChatId || gData.chat_id ||
        legData.relatoriosChatId || legData.chat_id || '');
    const globalCfg = {
        ...{ botToken: '', diretoria: [], regionais: [] },
        ...gData,
        botToken,
        guardChatId, // campo extra para fallback
    };
    return {
        global: globalCfg,
        cidades: (cSnap.data() ?? {}),
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
        // Tenta enviar DM via chat_id guardado no doc do usuário
        const userDoc = await db.collection('usuarios').doc(g.uid).get();
        const telegramChatId = userDoc.data()?.telegramChatId;
        if (telegramChatId) {
            await sendTelegram(token, { chatId: telegramChatId }, texto);
        }
    }
}
// Envia para diretoria e regionais (alertas críticos)
async function notificarDiretoria(token, globalCfg, texto) {
    const todos = [...globalCfg.diretoria, ...globalCfg.regionais];
    for (const g of todos) {
        const userDoc = await db.collection('usuarios').doc(g.uid).get();
        const telegramChatId = userDoc.data()?.telegramChatId;
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
    const slotRef = db.collection('slots').doc(slotId);
    const userRef = db.collection('usuarios').doc(uid);
    // Busca dados do operador
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Usuário não encontrado');
    }
    const userData = userSnap.data();
    // Verifica se é prestador ativo
    if (userData.statusPrestador !== 'ativo') {
        throw new https_1.HttpsError('permission-denied', 'Prestador inativo');
    }
    // Transação atômica — garante que só um operador aceita
    let slotData;
    try {
        await db.runTransaction(async (tx) => {
            const slotSnap = await tx.get(slotRef);
            if (!slotSnap.exists) {
                throw new https_1.HttpsError('not-found', 'Slot não encontrado');
            }
            slotData = slotSnap.data();
            if (slotData.status !== 'aberto') {
                throw new https_1.HttpsError('failed-precondition', slotData.status === 'aceito'
                    ? 'Este slot já foi aceito por outro operador'
                    : `Slot não está disponível (status: ${slotData.status})`);
            }
            // Verifica se o cargo bate
            if (slotData.cargo !== userData.cargoPrestador) {
                throw new https_1.HttpsError('permission-denied', `Este slot é para ${slotData.cargo}, seu cargo é ${userData.cargoPrestador}`);
            }
            // Escreve atomicamente
            tx.update(slotRef, {
                status: 'aceito',
                aceitoPor: uid,
                aceitoPorNome: userData.nome,
                aceitoEm: admin.firestore.FieldValue.serverTimestamp(),
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
            tx.update(userRef, {
                slotAtualId: slotId,
                ultimaAtividade: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
    }
    catch (e) {
        // Re-throw HttpsError direto
        if (e instanceof https_1.HttpsError)
            throw e;
        console.error('[aceitarSlot] transaction error:', e);
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
    const ocSnap = await db.collection('ocorrencias').doc(ocorrenciaId).get();
    if (!ocSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Ocorrência não encontrada');
    }
    const oc = ocSnap.data();
    const { global: globalCfg, cidades } = await getConfig();
    if (!globalCfg.botToken)
        return { enviado: false, motivo: 'bot_token_ausente' };
    const cidadeRaw = oc.cidade || oc.cidade_inicial || '';
    const cidadeKey = cidadeParaChave(cidadeRaw);
    const cidadeCfg = cidades[cidadeKey];
    const tipoLabel = {
        // Keys módulo Slots (lowercase)
        roubo: '🚨 ROUBO',
        vandalismo: '🔨 Vandalismo',
        patinete_danificado: '🛴 Patinete danificado',
        ponto_bloqueado: '🚧 Ponto bloqueado',
        usuario_infrator: '⚠️ Usuário infrator',
        outro: '📝 Ocorrência',
        // Keys Guard (capitalizadas)
        Roubo: '🚨 ROUBO',
        Tentativa: '🟠 Tentativa de roubo',
        Vandalismo: '🟡 Vandalismo',
        Recuperacao: '🟢 Recuperação',
        Outro: '📝 Ocorrência',
    };
    // Urgente: roubos/tentativas, procurados, OU quando status muda para Recuperado
    const statusFinal = statusAtualizado || oc.status;
    const isRecuperado = statusFinal === 'Recuperado' && statusAtualizado;
    const urgente = ['Roubo', 'roubo', 'Tentativa', 'tentativa'].includes(oc.tipo)
        || !!oc.procurando || isRecuperado;
    const tipoEmoji = tipoLabel[oc.tipo] ?? '📝 Ocorrência';
    const assetInfo = [oc.asset_id, oc.ativo_tipo, oc.patineteId]
        .filter(Boolean).join(' · ');
    const texto = [
        isRecuperado ? '✅ *RECUPERADO*' : (urgente ? '🚨 *ALERTA URGENTE*' : ''),
        '',
        `${tipoEmoji}`,
        '',
        `👤 *${oc.registradoPorNome || 'Guard'}*${oc.turno ? ' · ' + oc.turno : ''}`,
        `🏙 ${cidadeRaw}${oc.bairro_inicial ? ' / ' + oc.bairro_inicial : ''}`,
        assetInfo ? `🛴 ${assetInfo}` : '',
        oc.procurando && oc.procurando !== 'false'
            ? `\n🔍 *PROCURANDO:* ${typeof oc.procurando === 'string' ? oc.procurando : 'Em aberto'}`
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
    // Marca como enviado
    await db.collection('ocorrencias').doc(ocorrenciaId).update({
        telegramEnviado: true,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
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
    const tSnap = await db.collection('tarefas').doc(tarefaId).get();
    if (!tSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Tarefa não encontrada');
    }
    const t = tSnap.data();
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
        + `👤 ${t.assigneeNome ?? 'Sem operador'}\n`
        + `🏙 ${t.cidade}\n`
        + (t.motivoRejeicao ? `💬 Motivo: ${t.motivoRejeicao}\n` : '')
        + (t.estacao ? `📍 ${t.estacao.nome}\n` : '');
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
            const decoded = await admin.auth().verifyIdToken(token);
            // Verifica se é admin
            const userDoc = await db.collection('usuarios').doc(decoded.uid).get();
            if (!['admin', 'gestor'].includes(userDoc.data()?.role)) {
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
    await db.collection('usuarios').doc(request.auth.uid).update({
        telegramChatId: String(telegramChatId),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { sucesso: true };
});
//# sourceMappingURL=slots.js.map