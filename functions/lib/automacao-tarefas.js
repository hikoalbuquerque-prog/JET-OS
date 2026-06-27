"use strict";
// functions/src/automacao-tarefas.ts
// Cloud Functions para geração automática de tarefas de logística
//
// Funções exportadas:
//   gerarTarefasGoJetFn   — HTTP callable: gera tarefas a partir do snapshot GoJet
//   gerarTarefasAgendado  — Cloud Scheduler: roda a cada hora
//
// Lógica:
//   1. Lê gojet_snapshots/latest do Firestore
//   2. Filtra pontos abaixo do target (< 50%) e pontos zerados
//   3. Para cada ponto crítico: cria tarefa em tarefas_logistica (se não existir já)
//   4. Notifica via Telegram (bot configurado em functions/.env.guard)
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
exports.exportarHistoricoParking = exports.salvarHistoricoParking = exports.notificarTurnoCallable = exports.escalarSlotsSLA = exports.gerarSlotsManualFn = exports.gerarSlotsInteligenteFn = exports.notificarTarefaFn = exports.gerarTarefasAgendado = exports.gerarTarefasGoJetFn = void 0;
exports.notificarTurnoFn = notificarTurnoFn;
const admin = __importStar(require("firebase-admin"));
const v2_1 = require("firebase-functions/v2");
const https = __importStar(require("firebase-functions/v2/https"));
const scheduler = __importStar(require("firebase-functions/v2/scheduler"));
// firestore trigger removido — notificarTurnoFn agora é chamada diretamente
const config_supabase_1 = require("./config-supabase");
const supabase_rest_1 = require("./lib/supabase-rest");
const crypto_1 = require("crypto");
function classificarPonto(p) {
    const avail = p.availableCount ?? 0;
    const target = p.target_bikes_count ?? 0;
    if (avail === 0 && target > 0)
        return 'zerado';
    if (target === 0)
        return 'neutro';
    if (avail < target * 0.50)
        return 'baixo';
    if (avail < target * 0.85)
        return 'medio';
    if (avail >= target * 1.25)
        return 'excesso';
    return 'target';
}
function distKm(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// ─── Config Telegram ─────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
async function sendTelegram(token, chatId, msg) {
    if (!token)
        return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: msg,
                parse_mode: 'HTML',
            }),
        });
    }
    catch (e) {
        console.warn('Telegram send failed:', e);
    }
}
async function gerarTarefasDeSnapshot(opts = {}) {
    const { cidade = 'São Paulo', pais = 'BR', limiarPct = 0.5, somenteMonitor = true, evitarDuplicatas = true, } = opts;
    // 1. Ler snapshot mais recente — Supabase-first (Onda G: parkings table), fallback Firestore
    let parkings = [];
    let idadeMin = 999;
    const SB_URL = process.env.SUPABASE_URL ?? '';
    const SB_KEY = process.env.SUPABASE_SERVICE_ROLE ?? '';
    if (SB_URL && SB_KEY) {
        try {
            const hdr = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
            const cidadeFilter = cidade ? `&cidade=eq.${encodeURIComponent(cidade)}` : '';
            const resp = await fetch(`${SB_URL}/rest/v1/parkings?select=id,nome,bikes_total,bikes_disponiveis,dados,atualizado_em${cidadeFilter}&order=atualizado_em.desc&limit=500`, { headers: hdr });
            if (resp.ok) {
                const rows = await resp.json();
                if (rows.length > 0) {
                    parkings = rows.map(r => ({
                        id: r.id,
                        name: r.nome ?? r.id,
                        latitude: r.dados?.latitude ?? 0,
                        longitude: r.dados?.longitude ?? 0,
                        monitor: r.dados?.monitor ?? false,
                        monitorLevel: r.dados?.monitorLevel ?? null,
                        availableCount: r.bikes_disponiveis ?? 0,
                        bikes_count: r.bikes_total ?? 0,
                        target_bikes_count: r.dados?.target_bikes_count ?? 0,
                    }));
                    const newest = new Date(rows[0].atualizado_em).getTime();
                    idadeMin = (Date.now() - newest) / 60000;
                }
            }
        }
        catch (e) {
            v2_1.logger.warn('[gerarTarefas] Supabase parkings read failed:', e);
        }
    }
    if (parkings.length === 0) {
        return { criadas: 0, puladas: 0, erros: 0, detalhes: ['Snapshot não encontrado'] };
    }
    if (idadeMin > 30) {
        return {
            criadas: 0, puladas: 0, erros: 0,
            detalhes: [`Snapshot desatualizado (${Math.round(idadeMin)}min). Ignorando.`],
        };
    }
    // 2. Filtrar pontos críticos
    const criticos = parkings.filter(p => {
        if (somenteMonitor && !p.monitor)
            return false;
        if (p.target_bikes_count <= 0)
            return false;
        const ratio = p.availableCount / p.target_bikes_count;
        return ratio < limiarPct; // abaixo do limiar
    });
    if (criticos.length === 0) {
        return { criadas: 0, puladas: 0, erros: 0, detalhes: ['Nenhum ponto crítico encontrado'] };
    }
    // 3. Buscar tarefas pendentes já existentes para evitar duplicatas
    let tarefasExistentes = new Set();
    if (evitarDuplicatas) {
        const existRows = await (0, supabase_rest_1.supabaseGet)('tarefas_logistica', `select=parking_id&cidade=eq.${encodeURIComponent(cidade)}&status=in.(pendente,em_execucao)&gerado_por_gojet=eq.true`);
        tarefasExistentes = new Set((existRows ?? []).map((r) => r.parking_id));
    }
    // 4. Criar tarefas via Supabase
    let criadas = 0, puladas = 0, erros = 0;
    const detalhes = [];
    const tarefasParaInserir = [];
    for (const p of criticos) {
        if (evitarDuplicatas && tarefasExistentes.has(p.id)) {
            puladas++;
            continue;
        }
        const falta = Math.max(0, p.target_bikes_count - p.availableCount);
        const zerado = p.availableCount === 0;
        const prioridade = zerado ? 5 :
            (p.availableCount / p.target_bikes_count < 0.25 ? 4 : 3);
        tarefasParaInserir.push({
            kind: 'PONTO',
            titulo: `${zerado ? '🚨' : '⚠️'} ${p.name ?? p.id}`,
            descricao: zerado
                ? `Ponto zerado — levar ${falta} patinete${falta !== 1 ? 's' : ''} (target: ${p.target_bikes_count})`
                : `Abaixo do target — levar ${falta} patinete${falta !== 1 ? 's' : ''} (${p.availableCount}/${p.target_bikes_count})`,
            status: 'pendente',
            prioridade,
            parking_id: p.id,
            parking_nome: p.name,
            parking_lat: p.latitude,
            parking_lng: p.longitude,
            target_count: falta,
            delivered_count: 0,
            assignee_uid: null,
            assignee_nome: null,
            cidade, pais,
            criado_por: 'system',
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
            gerado_por_gojet: true,
            gerado_em: new Date().toISOString(),
            slot_id: null,
        });
        criadas++;
        detalhes.push(`✅ ${p.name}: -${falta} (${p.availableCount}/${p.target_bikes_count})`);
    }
    if (tarefasParaInserir.length > 0) {
        const ok = await (0, supabase_rest_1.supabaseInsert)('tarefas_logistica', tarefasParaInserir);
        if (!ok) {
            erros = tarefasParaInserir.length;
            criadas = 0;
        }
        // Notificar via Telegram
        const zerados = criticos.filter(p => p.availableCount === 0).length;
        const msg = [
            `🤖 <b>Tarefas automáticas geradas</b>`,
            `📍 Cidade: ${cidade}`,
            `📦 Tarefas criadas: ${criadas}`,
            zerados > 0 ? `🚨 Pontos zerados: ${zerados}` : '',
            `⏰ ${new Date().toLocaleString('pt-BR')}`,
        ].filter(Boolean).join('\n');
        // Onda G: usa getBotTokenLocal (Supabase-first), fallback env var
        const tgToken = await getBotTokenLocal() || TELEGRAM_BOT_TOKEN;
        await sendTelegram(tgToken, TELEGRAM_CHAT_ID, msg);
    }
    return { criadas, puladas, erros, detalhes };
}
// ─── Cloud Function callable (gestor pode acionar manualmente) ───────────────
exports.gerarTarefasGoJetFn = https.onCall({ region: 'southamerica-east1', maxInstances: 10 }, async (request) => {
    // Verificar autenticação
    if (!request.auth) {
        throw new https.HttpsError('unauthenticated', 'Não autenticado');
    }
    // Verificar role — Supabase-only
    let role = '';
    const sbUser = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=role&id=eq.${encodeURIComponent(request.auth.uid)}`);
    role = sbUser?.role ?? '';
    if (!['admin', 'gestor', 'gestor_log', 'supergestor'].includes(role)) {
        throw new https.HttpsError('permission-denied', 'Sem permissão');
    }
    const { cidade = 'São Paulo', pais = 'BR', limiarPct = 0.5 } = request.data ?? {};
    const result = await gerarTarefasDeSnapshot({ cidade, pais, limiarPct });
    return result;
});
// ─── Cloud Scheduler: roda a cada hora ───────────────────────────────────────
exports.gerarTarefasAgendado = scheduler.onSchedule({
    schedule: '0 * * * *', // toda hora em ponto
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    maxInstances: 10,
}, async () => {
    try {
        // Buscar cidades ativas — Supabase-first (Onda G), fallback Firestore
        let cidades = [];
        const SB_URL = process.env.SUPABASE_URL ?? '';
        const SB_KEY = process.env.SUPABASE_SERVICE_ROLE ?? '';
        if (SB_URL && SB_KEY) {
            try {
                const resp = await fetch(`${SB_URL}/rest/v1/gojet_config?ativo=eq.true&select=cidade,nome,pais`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
                if (resp.ok) {
                    const rows = await resp.json();
                    if (rows.length > 0) {
                        cidades = rows.map(r => ({ nome: r.nome ?? r.cidade, pais: r.pais ?? 'BR' }));
                    }
                }
            }
            catch { /* fallback */ }
        }
        // Default fallback if Supabase returns empty
        if (cidades.length === 0) {
            cidades = [{ nome: 'São Paulo', pais: 'BR' }];
        }
        for (const cidade of cidades) {
            const result = await gerarTarefasDeSnapshot({
                cidade: cidade.nome,
                pais: cidade.pais,
                limiarPct: 0.5,
                somenteMonitor: true,
                evitarDuplicatas: true,
            });
            v2_1.logger.info(`[gerarTarefas] ${cidade.nome}: criadas=${result.criadas} puladas=${result.puladas}`);
        }
    }
    catch (e) {
        v2_1.logger.error('[gerarTarefas] erro geral:', e);
    }
});
// ─── Cloud Function: notificar agente via Telegram ───────────────────────────
exports.notificarTarefaFn = https.onCall({ region: 'southamerica-east1', maxInstances: 10 }, async (request) => {
    if (!request.auth)
        throw new https.HttpsError('unauthenticated', 'Não autenticado');
    const { tarefaTitulo, assigneeUid, cidade, fcmToken } = request.data ?? {};
    if (!assigneeUid)
        return { ok: true };
    const resultados = [];
    try {
        const userRow = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=*&id=eq.${encodeURIComponent(assigneeUid)}`);
        const userData = userRow ?? {};
        // 1. FCM push nativo (Android/iOS)
        const tokenFCM = fcmToken ?? userData.fcmToken ?? null;
        if (tokenFCM) {
            try {
                const { getMessaging } = await Promise.resolve().then(() => __importStar(require('firebase-admin/messaging')));
                const msg = await getMessaging().send({
                    token: tokenFCM,
                    notification: {
                        title: '📦 Nova tarefa!',
                        body: tarefaTitulo ?? 'Você recebeu uma nova tarefa no JET OS.',
                    },
                    data: { cidade: cidade ?? '', tipo: 'nova_tarefa' },
                    android: {
                        priority: 'high',
                        notification: { channelId: 'tarefas', sound: 'default' },
                    },
                });
                resultados.push(`fcm:${msg}`);
            }
            catch (e) {
                v2_1.logger.warn('[notificarTarefa] FCM erro:', e.message);
                resultados.push(`fcm:erro:${e.message}`);
            }
        }
        // 2. Telegram (se tiver chat_id cadastrado)
        const telegramChatId = userData.telegramChatId ?? null;
        const tgTokenNotif = await getBotTokenLocal() || TELEGRAM_BOT_TOKEN;
        if (telegramChatId && tgTokenNotif) {
            await sendTelegram(tgTokenNotif, telegramChatId, `📦 <b>Nova tarefa atribuída!</b>\n\n${tarefaTitulo}\n📍 ${cidade}\n\nAbra o JET OS para ver os detalhes.`);
            resultados.push('telegram:ok');
        }
    }
    catch (e) {
        v2_1.logger.warn('[notificarTarefa] erro:', e);
    }
    return { ok: true, resultados };
});
function classifyBike(b) {
    if (b.disabled || b.service_mode)
        return 'maintenance';
    const sub = (b.business_sub_status ?? '').toLowerCase();
    if (sub.includes('workshop') || sub.includes('oficina'))
        return 'workshop';
    if (b.ordered || (b.business_sub_status ?? '').toLowerCase().includes('rent'))
        return 'renting';
    if (b.booked)
        return 'reserved';
    const pct = b.battery_percent ?? 1;
    if (pct < 0.10)
        return 'critico';
    if (pct < 0.20)
        return 'low_battery';
    return 'available';
}
function isBikeOperacional(b) {
    const s = classifyBike(b);
    return s !== 'maintenance' && s !== 'workshop' && s !== 'renting' && s !== 'reserved';
}
async function getBotTokenLocal() {
    try {
        const supa = await (0, config_supabase_1.getAppSetting)('telegram');
        return String(supa?.bot_token || supa?.botToken || '').trim();
    }
    catch {
        return '';
    }
}
async function sendTelegramLocal(token, chatId, text) {
    if (!token || !chatId)
        return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
    }
    catch { /* silencioso */ }
}
// Verifica se horário atual está dentro da janela ativa
function dentroDoHorario(inicio, fim, tzOffset = -3) {
    const now = new Date(Date.now() + tzOffset * 3600 * 1000);
    const hhmm = now.toISOString().slice(11, 16);
    return hhmm >= inicio && hhmm <= fim;
}
// Determina prioridade com base no horário
function prioridadeHorario(tzOffset = -3) {
    const now = new Date(Date.now() + tzOffset * 3600 * 1000);
    const hhmm = now.toISOString().slice(11, 16);
    const picoPeriodos = [['07:00', '09:00'], ['17:00', '20:00']];
    return picoPeriodos.some(([s, e]) => hhmm >= s && hhmm <= e) ? 'alta' : 'normal';
}
// Busca clima da cidade (OpenWeatherMap se token configurado)
async function getClimaStatus(cidade) {
    try {
        // Supabase-first
        const supa = await (0, config_supabase_1.getAppSetting)('clima');
        const apiKey = String(supa?.openweather_api_key || supa?.openweatherApiKey || '').trim();
        if (!apiKey)
            return 'ok';
        const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&appid=${apiKey}`);
        if (!resp.ok)
            return 'ok';
        const data = await resp.json();
        const weather = data.weather?.[0]?.main?.toLowerCase() ?? '';
        const wind = data.wind?.speed ?? 0;
        if (weather.includes('thunderstorm'))
            return 'chuva_forte';
        if (weather.includes('rain') && data.rain?.['1h'] > 5)
            return 'chuva_forte';
        if (weather.includes('rain'))
            return 'chuva_leve';
        if (wind > 11)
            return 'vento_forte'; // 11 m/s ≈ 40 km/h
        const temp = data.main?.temp ? data.main.temp - 273.15 : 20;
        if (temp > 30)
            return 'calor';
        return 'ok';
    }
    catch {
        return 'ok';
    }
}
// Ajusta qtd alvo por clima
function ajustarPorClima(qtdAlvo, climaStatus, sensibilidade) {
    if (sensibilidade === 'ignorar')
        return qtdAlvo;
    if (climaStatus === 'chuva_forte' || climaStatus === 'vento_forte')
        return null; // suspende
    if (climaStatus === 'chuva_leve')
        return Math.max(1, Math.round(qtdAlvo * 0.7));
    if (climaStatus === 'calor' && sensibilidade === 'alta')
        return Math.round(qtdAlvo * 1.2);
    return qtdAlvo;
}
// Busca os N workers mais próximos disponíveis
async function encontrarWorkersProximos(cidade, tipoSlot, lat, lng, qtd = 1) {
    try {
        // Supabase-first
        const cargos = tipoSlot === 'charger' ? 'charger' : 'scalt,scout';
        const sbWorkers = await (0, supabase_rest_1.supabaseGet)('usuarios', `select=id,nome,lat,lng,slot_atual_id&tipo_cadastro=eq.prestador&status_prestador=eq.ativo&cidade=eq.${encodeURIComponent(cidade)}&cargo_prestador=in.(${cargos})`);
        const disponiveis = (sbWorkers ?? [])
            .filter(u => !u.slot_atual_id)
            .map(u => ({ uid: u.id, nome: u.nome, lat: u.lat, lng: u.lng }));
        if (disponiveis.length === 0)
            return [];
        return disponiveis
            .map((u) => {
            const uLat = u.lat ?? 0, uLng = u.lng ?? 0;
            return { uid: u.uid ?? u.id, nome: u.nome ?? '—', dist: distKm(lat, lng, uLat, uLng) };
        })
            .sort((a, b) => a.dist - b.dist)
            .slice(0, qtd)
            .map((u) => ({ uid: u.uid, nome: u.nome }));
    }
    catch {
        return [];
    }
}
// Busca histórico da mesma hora do dia anterior para ajuste de alvo
async function getHistoricoHora(zona, cidade) {
    try {
        const ontemInicio = new Date(Date.now() - 24 * 3600 * 1000 - 3600 * 1000).toISOString();
        const ontemFim = new Date(Date.now() - 24 * 3600 * 1000 + 3600 * 1000).toISOString();
        const rows = await (0, supabase_rest_1.supabaseGet)('log_slots_auto', `select=bikes_alvo&zona=eq.${encodeURIComponent(zona)}&cidade=eq.${encodeURIComponent(cidade)}&tipo_slot=eq.scout&registrado_em=gte.${encodeURIComponent(ontemInicio)}&registrado_em=lte.${encodeURIComponent(ontemFim)}`);
        if (!rows || rows.length === 0)
            return 0;
        return rows.reduce((s, d) => s + (d.bikes_alvo ?? 0), 0) / rows.length;
    }
    catch {
        return 0;
    }
}
// Loga decisão — Supabase-only
async function logDecisao(dados) {
    try {
        await (0, supabase_rest_1.supabaseInsert)('log_slots_auto', {
            zona: dados.zona, cidade: dados.cidade, tipo_slot: dados.tipoSlot,
            bikes_encontradas: dados.bikesEncontradas ?? null,
            bikes_alvo: dados.bikesAlvo ?? null,
            clima_status: dados.climaStatus ?? null,
            regra_aplicada: dados.regraAplicada,
            slot_criado: dados.slotCriado,
            slot_id: dados.slotId ?? null,
            motivo: dados.motivo ?? null,
            registrado_em: new Date().toISOString(),
        });
    }
    catch { /* silencioso */ }
}
// Cria slot no Firestore
async function criarSlotAuto(dados) {
    const emoji = dados.tipoSlot === 'scout' ? '🛴' : '⚡';
    const label = dados.tipoSlot === 'scout' ? 'Scout' : 'Charger';
    const titulo = `${emoji} ${label} — ${dados.zona} (${dados.tarefas.length} ${dados.tarefas.length === 1 ? 'ponto' : 'pontos'})`;
    const agora = new Date();
    const turnoFim = new Date(agora.getTime() + 4 * 3600 * 1000);
    const slotId = (0, crypto_1.randomUUID)();
    const primeiroWorker = dados.workers?.[0] ?? null;
    await (0, supabase_rest_1.supabaseInsert)('slots', {
        id: slotId,
        titulo, tipo_slot: dados.tipoSlot, tipo_geracao: 'automatico',
        prioridade: dados.prioridade, zona: dados.zona, cargo: dados.tipoSlot,
        cidade: dados.cidade, pais: dados.pais,
        turno_inicio: agora.toISOString(), turno_fim: turnoFim.toISOString(),
        status: 'aberto', criado_por: 'system',
        aceito_por: primeiroWorker?.uid ?? null,
        aceito_por_nome: primeiroWorker?.nome ?? null,
        aceito_em: primeiroWorker ? new Date().toISOString() : null,
        workers_atribuidos: (dados.workers ?? []).map(w => ({ uid: w.uid, nome: w.nome })),
        tarefas_ids: [], tarefas_total: dados.tarefas.length, tarefas_concluidas: 0,
        sla_aceite_min: dados.slaAceiteMin,
        gerado_por_clima: !!dados.climaStatus, clima_status: dados.climaStatus ?? null,
        n8n_distribuido: false,
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
    });
    const tarefaIds = [];
    const tarefasData = [];
    for (let i = 0; i < dados.tarefas.length; i++) {
        const t = dados.tarefas[i];
        const tId = (0, crypto_1.randomUUID)();
        const wIdx = dados.workers?.length ? i % dados.workers.length : -1;
        const w = dados.workers?.[wIdx] ?? null;
        const pNum = (t.prioridade ?? dados.prioridade) === 'urgente' ? 5
            : (t.prioridade ?? dados.prioridade) === 'alta' ? 4 : 3;
        tarefasData.push({
            id: tId,
            tipo: dados.tipoSlot === 'scout' ? 'rebalanceamento' : 'troca_bateria',
            tipo_slot: dados.tipoSlot, status: 'pendente',
            prioridade: pNum,
            titulo: t.titulo,
            descricao: t.subtitulo ?? null,
            cargo: dados.tipoSlot,
            cidade: dados.cidade, pais: dados.pais, slot_id: slotId,
            assignee_uid: w?.uid ?? null,
            assignee_nome: w?.nome ?? null,
            qtd_alvo: t.qtdAlvo, qtd_concluida: 0, entregas: [],
            patinete_sugeridas: t.patineteSugeridas ?? [],
            estacao: { id: t.parkingId ?? tId, nome: t.parkingNome, lat: t.parkingLat, lng: t.parkingLng },
            rota_ordem: i,
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
        });
        tarefaIds.push(tId);
    }
    await (0, supabase_rest_1.supabaseInsert)('tarefas', tarefasData);
    await (0, supabase_rest_1.supabaseUpdate)('slots', { tarefas_ids: tarefaIds, atualizado_em: new Date().toISOString() }, `id=eq.${slotId}`);
    return slotId;
}
// Encontra a faixa de horário ativa para o momento atual
function getFaixaAtiva(faixas, tzOffset = -3) {
    if (!faixas?.length)
        return null;
    const now = new Date(Date.now() + tzOffset * 3600 * 1000);
    const hhmm = now.toISOString().slice(11, 16);
    const ativas = faixas.filter(f => {
        if (!f.ativo)
            return false;
        const { horaInicio, horaFim } = f;
        // Suporta faixas que cruzam a meia-noite (ex: 23:00–07:00)
        if (horaFim <= horaInicio)
            return hhmm >= horaInicio || hhmm < horaFim;
        return hhmm >= horaInicio && hhmm < horaFim;
    });
    if (ativas.length === 0)
        return null;
    // Prioridade mais alta vence quando há sobreposição
    const pOrder = { urgente: 3, alta: 2, normal: 1 };
    ativas.sort((a, b) => (pOrder[b.prioridade] ?? 1) - (pOrder[a.prioridade] ?? 1));
    return ativas[0];
}
// ─── Motor principal ─────────────────────────────────────────────────────────
async function executarMotorSlots() {
    v2_1.logger.info('[motor-slots] Iniciando execução');
    // 1. Buscar todas as configs de zona ativas — Supabase-first
    let configs = [];
    const sbAutoSlots = await (0, supabase_rest_1.supabaseGet)('config_auto_slots', 'select=*&ativo=eq.true');
    if (sbAutoSlots && sbAutoSlots.length > 0) {
        configs = sbAutoSlots.map((r) => ({
            ...r,
            zonaId: r.zona_id, zonaNome: r.zona_nome,
            scoutAtivo: r.scout_ativo, bikesMinimo: r.bikes_minimo, bikesAlvo: r.bikes_alvo, bikesMaximo: r.bikes_maximo,
            usarHistorico: r.usar_historico,
            chargerAtivo: r.charger_ativo, bateriaThreshold: r.bateria_threshold, chargerMinimo: r.charger_minimo,
            incluirForaPonto: r.incluir_fora_ponto,
            qtdWorkers: r.qtd_workers,
            faixasHorario: r.faixas_horario,
            horarioAtivoInicio: r.horario_ativo_inicio, horarioAtivoFim: r.horario_ativo_fim,
            intervaloChecagemMin: r.intervalo_checagem_min, slaAceiteMin: r.sla_aceite_min,
            autoAssign: r.auto_assign, sensibilidadeClima: r.sensibilidade_clima, notificarGestor: r.notificar_gestor,
        }));
    }
    if (configs.length === 0) {
        v2_1.logger.info('[motor-slots] Nenhuma zona configurada');
        return;
    }
    // Agrupar por cidade
    const porCidade = new Map();
    for (const cfg of configs) {
        const key = `${cfg.cidade}|${cfg.pais}`;
        if (!porCidade.has(key))
            porCidade.set(key, []);
        porCidade.get(key).push(cfg);
    }
    for (const [cidadeKey, cfgs] of porCidade) {
        const [cidade, pais] = cidadeKey.split('|');
        // 2. Buscar snapshot GoJet — Supabase-first (parkings/bikes), fallback Firestore
        let parkings = [];
        let bikes = [];
        let idadeMin = 999;
        const SB_URL2 = process.env.SUPABASE_URL ?? '';
        const SB_KEY2 = process.env.SUPABASE_SERVICE_ROLE ?? '';
        if (SB_URL2 && SB_KEY2) {
            try {
                const hdr = { apikey: SB_KEY2, Authorization: `Bearer ${SB_KEY2}` };
                const cidadeEnc = encodeURIComponent(cidade);
                const [pResp, bResp] = await Promise.all([
                    fetch(`${SB_URL2}/rest/v1/parkings?cidade=eq.${cidadeEnc}&select=*&order=atualizado_em.desc&limit=500`, { headers: hdr }),
                    fetch(`${SB_URL2}/rest/v1/bikes?cidade=eq.${cidadeEnc}&select=*&order=atualizado_em.desc&limit=2000`, { headers: hdr }),
                ]);
                if (pResp.ok) {
                    const pRows = await pResp.json();
                    if (pRows.length > 0) {
                        parkings = pRows.map(r => ({
                            id: r.id, name: r.nome ?? r.id,
                            latitude: r.dados?.latitude ?? 0, longitude: r.dados?.longitude ?? 0,
                            monitor: r.dados?.monitor ?? false, monitorLevel: r.dados?.monitorLevel ?? null,
                            availableCount: r.bikes_disponiveis ?? 0, bikes_count: r.bikes_total ?? 0,
                            target_bikes_count: r.dados?.target_bikes_count ?? 0,
                        }));
                        const newest = new Date(pRows[0].atualizado_em).getTime();
                        idadeMin = (Date.now() - newest) / 60000;
                    }
                }
                if (bResp.ok) {
                    const bRows = await bResp.json();
                    bikes = bRows.map(r => ({
                        id: r.id, identifier: r.dados?.identifier, name: r.dados?.name,
                        location_lat: r.dados?.location_lat ?? 0, location_lng: r.dados?.location_lng ?? 0,
                        parking_id: r.dados?.parking_id ?? null,
                        business_status: r.dados?.business_status,
                        business_sub_status: r.dados?.business_sub_status,
                        disabled: r.dados?.disabled, ordered: r.dados?.ordered,
                        booked: r.dados?.booked, service_mode: r.dados?.service_mode,
                        battery_percent: r.bateria != null ? r.bateria / 100 : r.dados?.battery_percent ?? null,
                    }));
                }
            }
            catch (e) {
                v2_1.logger.warn('[motor-slots] Supabase parkings/bikes failed:', e);
            }
        }
        if (parkings.length === 0)
            continue;
        if (idadeMin > 45) {
            v2_1.logger.warn(`[motor-slots] Snapshot desatualizado (${Math.round(idadeMin)}min)`);
            continue;
        }
        // 3. Buscar clima da cidade (uma vez por cidade)
        const climaStatus = await getClimaStatus(cidade);
        // 4. Buscar token Telegram — Supabase-first (Onda G)
        const botToken = await getBotTokenLocal();
        let diretoriaChatId = '';
        try {
            const { getTelegramConfigSupa } = await Promise.resolve().then(() => __importStar(require('./telegram-supabase')));
            const supaTgCfg = await getTelegramConfigSupa('global');
            if (supaTgCfg?.diretoria) {
                const dir = Array.isArray(supaTgCfg.diretoria) ? supaTgCfg.diretoria : [];
                diretoriaChatId = dir[0]?.chatId ?? '';
            }
        }
        catch { /* ignore */ }
        // 5. Processar cada zona configurada
        for (const cfg of cfgs) {
            try {
                // Verificar horário ativo
                if (!dentroDoHorario(cfg.horarioAtivoInicio, cfg.horarioAtivoFim)) {
                    await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'scout', regraAplicada: 'horario_inativo', slotCriado: false, motivo: `Fora do horário ${cfg.horarioAtivoInicio}–${cfg.horarioAtivoFim}` });
                    continue;
                }
                // Faixa de horário ativa para esta zona
                const faixaAtiva = getFaixaAtiva(cfg.faixasHorario ?? []);
                const prioridade = faixaAtiva?.prioridade ?? prioridadeHorario();
                // Verificar se já existe slot aberto para esta zona (evitar duplicatas)
                const slotExistenteRows = await (0, supabase_rest_1.supabaseGet)('slots', `select=id&zona=eq.${encodeURIComponent(cfg.zonaNome)}&cidade=eq.${encodeURIComponent(cidade)}&status=in.(aberto,aceito,a_caminho,em_andamento)&limit=1`);
                if (slotExistenteRows && slotExistenteRows.length > 0)
                    continue;
                // ── SCOUT
                if (cfg.scoutAtivo) {
                    // Valores efetivos para esta faixa
                    let alvoBase = faixaAtiva?.bikesAlvo ?? cfg.bikesAlvo;
                    const maximo = faixaAtiva?.bikesMaximo ?? cfg.bikesMaximo;
                    // Ajuste historico no alvo
                    if (cfg.usarHistorico) {
                        const mediaHist = await getHistoricoHora(cfg.zonaNome, cidade);
                        if (mediaHist > 0)
                            alvoBase = Math.round((alvoBase + mediaHist) / 2);
                    }
                    // Ajuste por clima
                    const alvoAjustado = ajustarPorClima(alvoBase, climaStatus, cfg.sensibilidadeClima);
                    if (alvoAjustado === null) {
                        await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'scout', bikesAlvo: alvoBase, climaStatus, regraAplicada: 'scout_clima', slotCriado: false, motivo: 'Suspensao por clima' });
                        if (cfg.notificarGestor && diretoriaChatId)
                            await sendTelegramLocal(botToken, diretoriaChatId, `⛈ <b>Scout suspenso — ${cfg.zonaNome}</b>\nClima: ${climaStatus}`);
                        continue;
                    }
                    const tarefasScout = [];
                    let centroLat = 0, centroLng = 0, somaPeso = 0;
                    // Verificar cada ponto monitor
                    const parkingsMonitor = parkings.filter(p => p.monitor && p.target_bikes_count > 0);
                    for (const p of parkingsMonitor) {
                        const avail = p.availableCount ?? p.bikes_count ?? 0;
                        const cls = classificarPonto(p);
                        if (cls === 'zerado') {
                            const qtd = alvoAjustado;
                            tarefasScout.push({ titulo: `🚨 Encher ${p.name}`, subtitulo: `Zerado — levar ${qtd} (target: ${p.target_bikes_count})`, qtdAlvo: qtd, parkingId: p.id, parkingNome: p.name, parkingLat: p.latitude, parkingLng: p.longitude, prioridade: 'urgente' });
                            centroLat += p.latitude * 3;
                            centroLng += p.longitude * 3;
                            somaPeso += 3;
                        }
                        else if (cls === 'baixo') {
                            const qtd = Math.max(1, alvoAjustado - avail);
                            tarefasScout.push({ titulo: `⚠️ Encher ${p.name}`, subtitulo: `Abaixo do target — levar ${qtd} (${avail}/${p.target_bikes_count})`, qtdAlvo: qtd, parkingId: p.id, parkingNome: p.name, parkingLat: p.latitude, parkingLng: p.longitude, prioridade: 'alta' });
                            centroLat += p.latitude * 2;
                            centroLng += p.longitude * 2;
                            somaPeso += 2;
                        }
                        else if (cls === 'excesso' && avail > maximo) {
                            const qtd = Math.max(1, avail - alvoAjustado);
                            tarefasScout.push({ titulo: `♻️ Redistribuir ${p.name}`, subtitulo: `Excesso — retirar ${qtd} (${avail}/${p.target_bikes_count})`, qtdAlvo: qtd, parkingId: p.id, parkingNome: p.name, parkingLat: p.latitude, parkingLng: p.longitude, prioridade: 'normal' });
                            centroLat += p.latitude;
                            centroLng += p.longitude;
                            somaPeso += 1;
                        }
                    }
                    // Bikes fora de ponto
                    if (cfg.incluirForaPonto !== false) {
                        const foraPonto = bikes.filter(b => !b.parking_id && isBikeOperacional(b));
                        if (foraPonto.length > 0) {
                            const clustersFora = {};
                            for (const b of foraPonto) {
                                let melhor = null, melhorDist = Infinity;
                                for (const p of parkingsMonitor) {
                                    const d = distKm(b.location_lat, b.location_lng, p.latitude, p.longitude);
                                    if (d < melhorDist) {
                                        melhorDist = d;
                                        melhor = p;
                                    }
                                }
                                if (melhor && melhorDist < 2.0) {
                                    if (!clustersFora[melhor.id])
                                        clustersFora[melhor.id] = { parking: melhor, bikes: [] };
                                    clustersFora[melhor.id].bikes.push(b);
                                }
                            }
                            for (const { parking: pp, bikes: bk } of Object.values(clustersFora)) {
                                tarefasScout.push({ titulo: `📍 Retornar para ${pp.name}`, subtitulo: `${bk.length} patinete${bk.length > 1 ? 's' : ''} fora de ponto proximos`, qtdAlvo: bk.length, parkingId: pp.id, parkingNome: pp.name, parkingLat: pp.latitude, parkingLng: pp.longitude, prioridade: 'normal' });
                            }
                        }
                    }
                    if (tarefasScout.length === 0) {
                        await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'scout', bikesAlvo: alvoAjustado, climaStatus, regraAplicada: 'scout_sem_necessidade', slotCriado: false, motivo: 'Todos os pontos dentro dos limites' });
                        continue;
                    }
                    const pOrd = { urgente: 0, alta: 1, normal: 2 };
                    tarefasScout.sort((a, b) => (pOrd[a.prioridade] ?? 2) - (pOrd[b.prioridade] ?? 2) || b.qtdAlvo - a.qtdAlvo);
                    const cLat = somaPeso > 0 ? centroLat / somaPeso : (parkingsMonitor[0]?.latitude ?? 0);
                    const cLng = somaPeso > 0 ? centroLng / somaPeso : (parkingsMonitor[0]?.longitude ?? 0);
                    const qtdW = cfg.qtdWorkers ?? 1;
                    const workers = cfg.autoAssign ? await encontrarWorkersProximos(cidade, 'scout', cLat, cLng, qtdW) : [];
                    const prioridadeSlot = tarefasScout[0].prioridade;
                    const slotId = await criarSlotAuto({
                        tipoSlot: 'scout', zona: cfg.zonaNome, cidade, pais,
                        prioridade: prioridadeSlot, slaAceiteMin: cfg.slaAceiteMin,
                        workers, climaStatus: climaStatus !== 'ok' ? climaStatus : undefined,
                        tarefas: tarefasScout,
                    });
                    await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'scout', bikesAlvo: alvoAjustado, climaStatus, regraAplicada: `scout_auto (${tarefasScout.length} pontos)`, slotCriado: true, slotId });
                    if (cfg.notificarGestor && diretoriaChatId) {
                        const wText = workers.length > 0 ? workers.map(w => w.nome).join(', ') : 'Aberto para aceite';
                        const resumo = tarefasScout.slice(0, 5).map(t => `  • ${t.titulo}`).join('\n');
                        await sendTelegramLocal(botToken, diretoriaChatId, `🤖 <b>Slot Scout — ${cfg.zonaNome}</b>\n📋 ${tarefasScout.length} pontos criticos\n${resumo}\n⚡ Prioridade: ${prioridadeSlot}\n👷 ${wText}${faixaAtiva ? `\n⏰ Faixa: ${faixaAtiva.nome}` : ''}`);
                    }
                }
                // ── CHARGER
                if (cfg.chargerAtivo) {
                    const batThresholdPct = faixaAtiva?.bateriaThreshold ?? cfg.bateriaThreshold;
                    const batThreshold = batThresholdPct / 100; // API usa 0-1
                    const chargerMinimo = faixaAtiva?.chargerMinimo ?? cfg.chargerMinimo;
                    // Filtrar bikes operacionais com bateria abaixo do threshold, ordenar por bateria ASC
                    const bikesCharger = bikes
                        .filter(b => isBikeOperacional(b) && b.battery_percent != null && b.battery_percent < batThreshold)
                        .sort((a, b) => (a.battery_percent ?? 0) - (b.battery_percent ?? 0));
                    if (bikesCharger.length < chargerMinimo) {
                        await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'charger', regraAplicada: 'charger_abaixo_minimo', slotCriado: false, motivo: `Apenas ${bikesCharger.length} (min: ${chargerMinimo})` });
                        continue;
                    }
                    const qtdTotal = ajustarPorClima(bikesCharger.length, climaStatus, cfg.sensibilidadeClima);
                    if (qtdTotal === null) {
                        await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'charger', climaStatus, regraAplicada: 'charger_clima', slotCriado: false, motivo: 'Suspensao por clima' });
                        continue;
                    }
                    const patinetesAlvo = bikesCharger.slice(0, qtdTotal);
                    // Agrupar por ponto de estacionamento atual (parking_id)
                    const clusters = {};
                    const semPonto = [];
                    for (const b of patinetesAlvo) {
                        if (b.parking_id) {
                            if (!clusters[b.parking_id])
                                clusters[b.parking_id] = [];
                            clusters[b.parking_id].push(b);
                        }
                        else
                            semPonto.push(b);
                    }
                    // Bikes sem parking_id: agrupar por proximidade (raio 0.5 km)
                    let grpIdx = 0;
                    for (const b of semPonto) {
                        let added = false;
                        for (const key of Object.keys(clusters).filter(k => k.startsWith('geo_'))) {
                            const rep = clusters[key][0];
                            if (distKm(b.location_lat, b.location_lng, rep.location_lat, rep.location_lng) < 0.5) {
                                clusters[key].push(b);
                                added = true;
                                break;
                            }
                        }
                        if (!added) {
                            clusters[`geo_${grpIdx++}`] = [b];
                        }
                    }
                    const tarefasCharger = [];
                    for (const [key, bks] of Object.entries(clusters)) {
                        const temCritico = bks.some(b => (b.battery_percent ?? 1) < 0.10);
                        const minBat = Math.min(...bks.map(b => b.battery_percent ?? 1));
                        const parking = parkings.find(p => p.id === key);
                        const cLat = parking?.latitude ?? bks.reduce((s, b) => s + b.location_lat, 0) / bks.length;
                        const cLng = parking?.longitude ?? bks.reduce((s, b) => s + b.location_lng, 0) / bks.length;
                        const nomePonto = parking?.name ?? (key.startsWith('geo_') ? `Area ${parseInt(key.replace('geo_', '')) + 1}` : key);
                        tarefasCharger.push({
                            titulo: `⚡ ${nomePonto}`,
                            subtitulo: `${bks.length} patinete${bks.length > 1 ? 's' : ''} — bat. min: ${Math.round(minBat * 100)}%`,
                            qtdAlvo: bks.length, parkingId: parking?.id,
                            parkingNome: nomePonto, parkingLat: cLat, parkingLng: cLng,
                            patineteSugeridas: bks.map(b => ({ id: b.id, identifier: b.identifier ?? b.id, lat: b.location_lat, lng: b.location_lng, bateria: Math.round((b.battery_percent ?? 0) * 100) })),
                            prioridade: temCritico ? 'urgente' : prioridade,
                        });
                    }
                    const pOrdC = { urgente: 0, alta: 1, normal: 2 };
                    tarefasCharger.sort((a, b) => (pOrdC[a.prioridade] ?? 2) - (pOrdC[b.prioridade] ?? 2));
                    const cLat = patinetesAlvo.reduce((s, b) => s + b.location_lat, 0) / patinetesAlvo.length;
                    const cLng = patinetesAlvo.reduce((s, b) => s + b.location_lng, 0) / patinetesAlvo.length;
                    const qtdW = cfg.qtdWorkers ?? 1;
                    const workers = cfg.autoAssign ? await encontrarWorkersProximos(cidade, 'charger', cLat, cLng, qtdW) : [];
                    const prioridadeSlot = tarefasCharger[0]?.prioridade ?? prioridade;
                    const slotId = await criarSlotAuto({
                        tipoSlot: 'charger', zona: cfg.zonaNome, cidade, pais,
                        prioridade: prioridadeSlot, slaAceiteMin: cfg.slaAceiteMin,
                        workers, climaStatus: climaStatus !== 'ok' ? climaStatus : undefined,
                        tarefas: tarefasCharger,
                    });
                    await logDecisao({ zona: cfg.zonaNome, cidade, tipoSlot: 'charger', bikesEncontradas: patinetesAlvo.length, bikesAlvo: batThresholdPct, climaStatus, regraAplicada: `charger_${batThresholdPct}pct (${tarefasCharger.length} clusters)`, slotCriado: true, slotId });
                    // Gravar alerta de bateria crítica no histórico + push FCM para gestores da cidade
                    const criticas = patinetesAlvo.filter(b => (b.battery_percent ?? 1) < 0.10);
                    if (criticas.length > 0) {
                        // Write to Supabase
                        (0, supabase_rest_1.supabaseInsert)('monitor_alertas', {
                            tipo: 'bateria_critica', cidade, zona: cfg.zonaNome,
                            qtd_bikes: criticas.length,
                            bat_min_pct: Math.round(Math.min(...criticas.map(b => b.battery_percent ?? 0)) * 100),
                            slot_id: slotId ?? null,
                            ts: new Date().toISOString(),
                        }).catch((e) => { v2_1.logger.warn('[monitor-alertas] Supabase insert failed:', e); });
                        // Push FCM para gestores logística da cidade
                        try {
                            const gestoresRows = await (0, supabase_rest_1.supabaseGet)('usuarios', `select=id,cidades_gerencia_log,cidades_permitidas&role=in.(admin,gestor,supergestor,gestor_log)`);
                            const uidsGestores = (gestoresRows ?? [])
                                .filter((d) => {
                                const cidades = d.cidades_gerencia_log || d.cidades_permitidas || [];
                                return cidades.length === 0 || cidades.includes(cidade);
                            })
                                .map((d) => d.id);
                            if (uidsGestores.length > 0) {
                                const tokenRows = await (0, supabase_rest_1.supabaseGet)('fcm_tokens', `select=uid,token&uid=in.(${uidsGestores.map((u) => encodeURIComponent(u)).join(',')})`);
                                const tokens = (tokenRows ?? [])
                                    .filter((s) => s.token)
                                    .map((s) => s.token);
                                if (tokens.length > 0) {
                                    const batMin = Math.round(Math.min(...criticas.map(b => b.battery_percent ?? 0)) * 100);
                                    await admin.messaging().sendEachForMulticast({
                                        tokens,
                                        notification: {
                                            title: `🔋 Bateria crítica — ${cfg.zonaNome}`,
                                            body: `${criticas.length} patinete(s) abaixo de 10% (mín ${batMin}%) em ${cidade}`,
                                        },
                                        data: { tipo: 'bateria_critica', cidade, zona: cfg.zonaNome },
                                        android: { priority: 'high' },
                                    });
                                }
                            }
                        }
                        catch (fcmErr) {
                            v2_1.logger.warn('[monitor-alertas] FCM push falhou:', fcmErr);
                        }
                    }
                    if (cfg.notificarGestor && diretoriaChatId) {
                        const wText = workers.length > 0 ? workers.map(w => w.nome).join(', ') : 'Aberto para aceite';
                        const resumo = tarefasCharger.slice(0, 4).map(t => `  • ${t.titulo} (${t.qtdAlvo})`).join('\n');
                        await sendTelegramLocal(botToken, diretoriaChatId, `🤖 <b>Slot Charger — ${cfg.zonaNome}</b>\n⚡ ${patinetesAlvo.length} patinetes abaixo de ${batThresholdPct}%\n${resumo}\n👷 ${wText}${faixaAtiva ? `\n⏰ Faixa: ${faixaAtiva.nome}` : ''}`);
                    }
                }
            }
            catch (err) {
                v2_1.logger.error(`[motor-slots] Erro na zona ${cfg.zonaNome}:`, err);
            }
        }
    }
}
// ─── Scheduler: roda a cada 15 minutos ───────────────────────────────────────
exports.gerarSlotsInteligenteFn = scheduler.onSchedule({ schedule: '*/15 * * * *', timeZone: 'America/Sao_Paulo', region: 'southamerica-east1', maxInstances: 10 }, async () => {
    try {
        await executarMotorSlots();
    }
    catch (e) {
        v2_1.logger.error('[gerarSlotsAgendado] erro:', e);
    }
});
// ─── Callable manual: gestor aciona pelo painel ───────────────────────────────
exports.gerarSlotsManualFn = https.onCall({ region: 'southamerica-east1', maxInstances: 10 }, async (request) => {
    if (!request.auth)
        throw new https.HttpsError('unauthenticated', 'Não autenticado');
    // Role check — Supabase-only
    let roleManual = '';
    const sbUserManual = await (0, supabase_rest_1.supabaseGetOne)('usuarios', `select=role&id=eq.${encodeURIComponent(request.auth.uid)}`);
    roleManual = sbUserManual?.role ?? '';
    if (!['admin', 'gestor', 'gestor_log', 'supergestor'].includes(roleManual))
        throw new https.HttpsError('permission-denied', 'Sem permissão');
    await executarMotorSlots();
    return { ok: true };
});
// ─── Escalamento SLA: roda a cada 5 minutos ──────────────────────────────────
exports.escalarSlotsSLA = scheduler.onSchedule({ schedule: '*/5 * * * *', timeZone: 'America/Sao_Paulo', region: 'southamerica-east1', maxInstances: 10 }, async () => {
    try {
        const agora = new Date().toISOString();
        const agoraMs = Date.now();
        const slotsRows = await (0, supabase_rest_1.supabaseGet)('slots', 'select=*&status=eq.aberto');
        const botToken = await getBotTokenLocal();
        let diretoriaChatId = '';
        try {
            const sbTgCfg = await (0, supabase_rest_1.supabaseGetOne)('telegram_config', 'select=*&id=eq.global');
            if (sbTgCfg?.diretoria) {
                const dir = Array.isArray(sbTgCfg.diretoria) ? sbTgCfg.diretoria : [];
                diretoriaChatId = dir[0]?.chatId ?? '';
            }
        }
        catch { /* ignore */ }
        let escalados = 0;
        for (const slot of (slotsRows ?? [])) {
            const slaMin = slot.sla_aceite_min ?? 10;
            const criadoMs = slot.criado_em ? new Date(slot.criado_em).getTime() : 0;
            const idadeMin = (agoraMs - criadoMs) / 60000;
            if (idadeMin >= slaMin && !slot.sla_escalado_em) {
                await (0, supabase_rest_1.supabaseUpdate)('slots', { sla_escalado_em: agora }, `id=eq.${slot.id}`);
                escalados++;
                if (diretoriaChatId && botToken) {
                    await sendTelegramLocal(botToken, diretoriaChatId, `⚠️ <b>Slot não aceito em ${slaMin}min</b>\n📦 ${slot.titulo}\n📍 ${slot.cidade}\n⏰ ${Math.round(idadeMin)}min sem aceite`);
                }
            }
            if (idadeMin >= slaMin * 3 && slot.sla_escalado_em && !slot.sla_escalado2_em) {
                await (0, supabase_rest_1.supabaseUpdate)('slots', { sla_escalado2_em: agora }, `id=eq.${slot.id}`);
                if (diretoriaChatId && botToken) {
                    await sendTelegramLocal(botToken, diretoriaChatId, `🚨 <b>URGENTE — Slot sem aceite há ${Math.round(idadeMin)}min</b>\n📦 ${slot.titulo}\n📍 ${slot.cidade}`);
                }
            }
        }
        if (escalados > 0)
            v2_1.logger.info(`[escalamento-sla] ${escalados} slots escalados`);
    }
    catch (e) {
        v2_1.logger.error('[escalarSlotsSLA] erro:', e);
    }
});
// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES DE TURNO — dispara quando worker registra entrada/saída
// ══════════════════════════════════════════════════════════════════════════════
exports.notificarTurnoCallable = https.onCall({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
    const { nome, acao, funcao, turno, cidade } = request.data ?? {};
    if (!nome || !acao)
        return { ok: false, error: 'missing_fields' };
    await notificarTurnoFn({ nome, acao, funcao: funcao ?? '', turno: turno ?? '', cidade: cidade ?? '' });
    return { ok: true };
});
async function notificarTurnoFn(turno) {
    const { nome, acao, funcao, turno: turnoId, cidade } = turno;
    const emoji = acao === 'entrada' ? '▶' : '⏹';
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const msg = `${emoji} <b>${nome}</b> — ${acao === 'entrada' ? 'Entrada' : 'Saída'}\n👷 ${funcao} · Turno ${turnoId}\n🏙 ${cidade} · ${hora}`;
    try {
        const botToken = await getBotTokenLocal();
        if (!botToken)
            return;
        // Notifica todos os gestores da cidade — Supabase-first
        const sbGestores = await (0, supabase_rest_1.supabaseGet)('usuarios', `select=id,telegram_chat_id&cidade=eq.${encodeURIComponent(cidade)}&role=in.(admin,gestor,gestor_log,supergestor)`);
        const chatIds = (sbGestores ?? [])
            .map(u => u.telegram_chat_id)
            .filter(Boolean);
        await Promise.allSettled(chatIds.map(chatId => sendTelegramLocal(botToken, chatId, msg)));
        v2_1.logger.info(`[notificarTurno] ${acao} de ${nome} (${cidade}) notificado para ${chatIds.length} gestores`);
    }
    catch (e) {
        v2_1.logger.error('[notificarTurno] erro:', e);
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// HISTÓRICO DE PARKINGS — salva snapshot diário para análise histórica
// Roda às 23:55 todo dia — salva estado final do dia em parking_history
// ══════════════════════════════════════════════════════════════════════════════
exports.salvarHistoricoParking = scheduler.onSchedule({ schedule: '55 23 * * *', timeZone: 'America/Sao_Paulo', region: 'southamerica-east1', maxInstances: 10 }, async () => {
    try {
        const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const agora = new Date().toISOString();
        // Busca todas as cidades ativas — Supabase-only
        const cidadesRows = await (0, supabase_rest_1.supabaseGet)('gojet_config', 'select=cidade,city_id&ativo=eq.true');
        if (!cidadesRows || cidadesRows.length === 0)
            return;
        let totalSalvo = 0;
        for (const row of cidadesRows) {
            const cidade = row.cidade ?? row.city_id;
            try {
                // Lê snapshot do Supabase
                const snap = await (0, supabase_rest_1.supabaseGetOne)('gojet_snapshots', `select=parkings,parkings_total,atualizado_em&id=eq.${encodeURIComponent(row.city_id)}`);
                if (!snap?.parkings)
                    continue;
                const parkings = snap.parkings;
                if (parkings.length === 0)
                    continue;
                // Agrega stats para o histórico
                const monitores = parkings.filter((p) => p.monitor);
                const zerados = monitores.filter((p) => (p.availableCount ?? 0) === 0);
                const totalBikes = parkings.reduce((s, p) => s + (p.bikes_count ?? 0), 0);
                const totalAvail = parkings.reduce((s, p) => s + (p.availableCount ?? 0), 0);
                const eficiencia = monitores.length > 0
                    ? Math.round(((monitores.length - zerados.length) / monitores.length) * 100) : 0;
                await (0, supabase_rest_1.supabaseInsert)('parking_history', {
                    cidade, data: hoje, saved_at: agora,
                    pontos_total: parkings.length,
                    monitores_total: monitores.length,
                    monitores_zerados: zerados.length,
                    bikes_total: totalBikes,
                    bikes_disponiveis: totalAvail,
                    eficiencia_pct: eficiencia,
                    snapshot_saved_at: snap.atualizado_em ?? null,
                });
                totalSalvo++;
            }
            catch (e) {
                v2_1.logger.warn(`[historicoParking] erro para cidade ${cidade}:`, e);
            }
        }
        v2_1.logger.info(`[historicoParking] ${totalSalvo} cidades salvas para ${hoje}`);
    }
    catch (e) {
        v2_1.logger.error('[historicoParking] erro geral:', e);
    }
});
// ══════════════════════════════════════════════════════════════════════════════
// CALLABLE: exportar histórico de parkings (últimos N dias)
// Retorna array de {data, cidade, eficienciaPct, zerados, bikesTotal}
// ══════════════════════════════════════════════════════════════════════════════
exports.exportarHistoricoParking = https.onCall({ region: 'southamerica-east1', maxInstances: 10 }, async (request) => {
    if (!request.auth)
        throw new https.HttpsError('unauthenticated', 'Não autenticado');
    const { cidade, dias = 30 } = request.data ?? {};
    if (!cidade)
        throw new https.HttpsError('invalid-argument', 'cidade obrigatório');
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const desdeStr = desde.toISOString().slice(0, 10);
    const rows = await (0, supabase_rest_1.supabaseGet)('parking_history', `select=*&cidade=eq.${encodeURIComponent(cidade)}&data=gte.${encodeURIComponent(desdeStr)}&order=data.asc`);
    return rows ?? [];
});
//# sourceMappingURL=automacao-tarefas.js.map