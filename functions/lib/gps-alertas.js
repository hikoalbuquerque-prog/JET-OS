"use strict";
// functions/src/gps-alertas.ts
// Monitoramento GPS dos operadores de campo — JET OS V2
//
// Funções:
//   verificarChegadaPonto — trigger: novo GPS em gps_logistica
//   verificarAtrasos      — scheduler: a cada 5min
//
// Deploy: export * from './gps-alertas'; no index.ts
// Índices necessários (criar no Console Firestore):
//   gps_logistica: uid ASC + criadoEm DESC
//   tarefas_logistica: assigneeUid ASC + status ASC + criadoEm DESC
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
exports.alertarMockGPS = exports.verificarAtrasos = exports.verificarChegadaPonto = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const db = admin.firestore();
// Item 6 — defaults hard-coded (podem ser sobrescritos via Firestore: monitor_config/gps)
const DEFAULT_CFG = {
    raioChegadaMetros: 100, // chegou se < 100m do ponto
    minutosParaChegar: 20, // alerta se não chegar em 20min
    minutesSemGPS: 10, // alerta GPS parado durante turno
    minutosAtrasoTarefa: 30, // alerta tarefa em andamento > X min
    cooldownAlertaMin: 30, // não reenvia alerta antes de 30min
};
// Usado pelo trigger verificarChegadaPonto (não carrega Firestore para não atrasar trigger)
const CFG = DEFAULT_CFG;
// ─── Geo ──────────────────────────────────────────────────────────────────────
// Alias haversine (mesma lógica que distM, nomeado para clareza interna)
function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Point-in-polygon (ray casting) — equivalente a pontoNoPoli de app-utils.ts
function pontoNoPoli(lat, lng, pontos) {
    let inside = false;
    for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
        const xi = pontos[i].lat, yi = pontos[i].lng;
        const xj = pontos[j].lat, yj = pontos[j].lng;
        if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}
function distM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dL = (lat2 - lat1) * Math.PI / 180;
    const dG = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dL / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// ─── Telegram ─────────────────────────────────────────────────────────────────
// Item 3 — retry automático até maxTentativas com delay de 1s entre tentativas
async function sendTelegramWithRetry(botToken, chatId, text, maxTentativas = 3) {
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
        try {
            const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
            });
            if (resp.ok)
                return;
            const body = await resp.text().catch(() => '');
            functions.logger.warn(`[gps-alertas] telegram tentativa ${tentativa} falhou (${resp.status}):`, body);
        }
        catch (e) {
            functions.logger.warn(`[gps-alertas] telegram tentativa ${tentativa} erro:`, e);
        }
        if (tentativa < maxTentativas) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    functions.logger.error('[gps-alertas] telegram: esgotou tentativas para chatId', chatId);
}
// Alias para compatibilidade interna
async function telegram(token, chatId, texto) {
    return sendTelegramWithRetry(token, chatId, texto);
}
async function getTgConfig() {
    try {
        const snap = await db.collection('telegram_config').doc('global').get();
        if (!snap.exists)
            return null;
        const d = snap.data();
        return { token: d.botToken ?? '', chatIds: d.chatIds ?? d.cidades ?? {} };
    }
    catch {
        return null;
    }
}
// Busca chatId para a cidade — fallback para o chatId global
async function getChatId(cidade) {
    const cfg = await getTgConfig();
    if (!cfg?.token)
        return null;
    const cidades = cfg.chatIds;
    return cidades[cidade] ?? cidades['default'] ?? cidades[Object.keys(cidades)[0]] ?? null;
}
// ─── TRIGGER: novo GPS → verifica chegada ────────────────────────────────────
exports.verificarChegadaPonto = (0, firestore_1.onDocumentCreated)({ document: 'gps_logistica/{id}', region: 'southamerica-east1' }, async (event) => {
    const gps = event.data?.data();
    if (!gps?.uid || !gps?.lat || !gps?.lng)
        return;
    const { uid, lat, lng } = gps;
    // Busca tarefas ativas deste operador que ainda não fizeram check-in
    const tarefasSnap = await db.collection('tarefas_logistica')
        .where('assigneeUid', '==', uid)
        .where('status', '==', 'em_execucao')
        .get();
    const batch = db.batch();
    let atualizou = false;
    for (const tDoc of tarefasSnap.docs) {
        const t = tDoc.data();
        if (!t.parkingLat || !t.parkingLng)
            continue;
        if (t.checkInGPS)
            continue; // já chegou
        const dist = distM(lat, lng, t.parkingLat, t.parkingLng);
        if (dist <= CFG.raioChegadaMetros) {
            batch.update(tDoc.ref, {
                checkInGPS: true,
                checkInGPSEm: admin.firestore.FieldValue.serverTimestamp(),
                checkInDistM: Math.round(dist),
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
            atualizou = true;
            functions.logger.info(`[gps-alertas] ${uid} chegou ao ponto ${t.parkingNome} (${Math.round(dist)}m)`);
        }
    }
    if (atualizou)
        await batch.commit();
    // ── FEATURE 1: Detecção de teleporte ────────────────────────────────────
    try {
        const TELEPORTE_MAX_MS = 10 * 60 * 1000; // ignora gap > 10 min (offline)
        const TELEPORTE_VEL_MS = 150; // 150 m/s = 540 km/h
        const TELEPORTE_COOLDOWN_MS = 10 * 60 * 1000; // cooldown 10 min por uid
        const doisPontosSnap = await db.collection('gps_logistica')
            .where('uid', '==', uid)
            .orderBy('criadoEm', 'desc')
            .limit(2)
            .get();
        if (doisPontosSnap.docs.length >= 2) {
            const pontoNovo = doisPontosSnap.docs[0].data();
            const pontoAnt = doisPontosSnap.docs[1].data();
            const tsNovo = pontoNovo.criadoEm?.toMillis?.() ?? pontoNovo.criadoEm?.getTime?.() ?? Date.now();
            const tsAnt = pontoAnt.criadoEm?.toMillis?.() ?? pontoAnt.criadoEm?.getTime?.() ?? 0;
            const deltaMs = tsNovo - tsAnt;
            if (deltaMs > 0 && deltaMs <= TELEPORTE_MAX_MS) {
                const distancia = haversineM(pontoAnt.lat, pontoAnt.lng, pontoNovo.lat, pontoNovo.lng);
                const velocidadeMs = distancia / (deltaMs / 1000);
                if (velocidadeMs > TELEPORTE_VEL_MS) {
                    // Verifica cooldown no doc do usuário
                    const opRef = db.collection('usuarios').doc(uid);
                    const opSnap = await opRef.get();
                    const opData = opSnap.data() ?? {};
                    const ultimoAlerta = opData.alertaTeleporteEm?.toMillis?.() ?? 0;
                    const agora = Date.now();
                    if (agora - ultimoAlerta >= TELEPORTE_COOLDOWN_MS) {
                        const velocidadeKmh = Math.round(velocidadeMs * 3.6);
                        const distanciaM = Math.round(distancia);
                        const segundos = Math.round(deltaMs / 1000);
                        const nome = opData.nome ?? opData.email ?? uid;
                        const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
                        // Grava alerta
                        await db.collection('monitor_alertas').add({
                            tipo: 'teleporte',
                            uid,
                            nome,
                            lat,
                            lng,
                            velocidadeKmh,
                            distanciaM,
                            ts: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        // Marca o ponto GPS como teleporte
                        if (event.data?.ref) {
                            await event.data.ref.update({ isTeleporte: true });
                        }
                        // Envia Telegram
                        const tgCfg = await getTgConfig();
                        if (tgCfg?.token) {
                            const cidade = opData.cidade ?? '';
                            const chatId = await getChatId(cidade);
                            if (chatId) {
                                await sendTelegramWithRetry(tgCfg.token, chatId, [
                                    `⚡ <b>Teleporte detectado!</b>`,
                                    `👤 <b>${nome}</b>`,
                                    `📏 ${distanciaM}m em ${segundos}s (${velocidadeKmh} km/h)`,
                                    `📍 <a href="${mapsLink}">Ver no Google Maps</a>`,
                                ].join('\n'));
                            }
                        }
                        // Atualiza cooldown
                        await opRef.update({
                            alertaTeleporteEm: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        functions.logger.warn(`[gps-alertas] Teleporte detectado: ${nome} (${uid}) ${distanciaM}m em ${segundos}s`);
                    }
                }
            }
        }
    }
    catch (e) {
        functions.logger.error('[gps-alertas] Erro na detecção de teleporte:', e);
    }
    // ── FEATURE 2: Geofencing — alerta ao sair da zona ──────────────────────
    try {
        const GEOFENCE_COOLDOWN_MS = 15 * 60 * 1000; // cooldown 15 min por uid
        const opRef = db.collection('usuarios').doc(uid);
        const opSnap = await opRef.get();
        const opData = opSnap.data() ?? {};
        const nome = opData.nome ?? opData.email ?? uid;
        // Determina quais zonas estão atribuídas ao usuário
        // Suporta zonasPermitidas: string[] (array de IDs) ou zonaId: string (único ID)
        let zonaIds = [];
        if (Array.isArray(opData.zonasPermitidas) && opData.zonasPermitidas.length > 0) {
            zonaIds = opData.zonasPermitidas;
        }
        else if (typeof opData.zonaId === 'string' && opData.zonaId) {
            zonaIds = [opData.zonaId];
        }
        if (zonaIds.length === 0) {
            // Sem zona atribuída — não alertar
            return;
        }
        // Busca polígonos das zonas (coleção 'poligonos', campo 'poligono')
        const zonaSnaps = await Promise.all(zonaIds.map(id => db.collection('poligonos').doc(id).get()));
        const zonasComPoligono = zonaSnaps
            .filter(s => s.exists)
            .map(s => ({ id: s.id, ...(s.data()) }));
        if (zonasComPoligono.length === 0)
            return;
        // Verifica se o ponto está dentro de ao menos uma zona
        const dentroDeAlgumaZona = zonasComPoligono.some(z => z.poligono && z.poligono.length >= 3 && pontoNoPoli(lat, lng, z.poligono));
        if (!dentroDeAlgumaZona) {
            const agora = Date.now();
            const ultimoAlerta = opData.alertaGeofenceEm?.toMillis?.() ?? 0;
            if (agora - ultimoAlerta >= GEOFENCE_COOLDOWN_MS) {
                const nomesZonas = zonasComPoligono.map(z => z.nome ?? z.id);
                const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
                // Grava alerta
                await db.collection('monitor_alertas').add({
                    tipo: 'fora_zona',
                    uid,
                    nome,
                    lat,
                    lng,
                    zonas: nomesZonas,
                    ts: admin.firestore.FieldValue.serverTimestamp(),
                });
                // Envia Telegram
                const tgCfg = await getTgConfig();
                if (tgCfg?.token) {
                    const cidade = opData.cidade ?? '';
                    const chatId = await getChatId(cidade);
                    if (chatId) {
                        await sendTelegramWithRetry(tgCfg.token, chatId, [
                            `🚨 <b>Fora da zona!</b>`,
                            `👤 <b>${nome}</b> está fora da(s) zona(s) atribuída(s)`,
                            `📍 Posição: ${lat},${lng}`,
                            `🗺 Zonas: ${nomesZonas.join(', ')}`,
                            `<a href="${mapsLink}">Ver no Google Maps</a>`,
                        ].join('\n'));
                    }
                }
                // Atualiza cooldown
                await opRef.update({
                    alertaGeofenceEm: admin.firestore.FieldValue.serverTimestamp(),
                });
                functions.logger.warn(`[gps-alertas] Geofence: ${nome} (${uid}) fora das zonas [${nomesZonas.join(', ')}]`);
            }
        }
    }
    catch (e) {
        functions.logger.error('[gps-alertas] Erro no geofencing:', e);
    }
});
// ─── SCHEDULER: a cada 5min — verifica atrasos e GPS perdido ────────────────
exports.verificarAtrasos = (0, scheduler_1.onSchedule)({
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    memory: '256MiB',
}, async () => {
    const agora = Date.now();
    // Item 6 — carrega parâmetros configuráveis via Firestore, merge com defaults
    let CFG = DEFAULT_CFG;
    try {
        const cfgSnap = await db.collection('monitor_config').doc('gps').get();
        CFG = { ...DEFAULT_CFG, ...(cfgSnap.data() ?? {}) };
    }
    catch (e) {
        functions.logger.warn('[verificarAtrasos] Falha ao carregar monitor_config/gps, usando defaults:', e);
    }
    const tgCfg = await getTgConfig();
    if (!tgCfg?.token) {
        functions.logger.warn('[verificarAtrasos] Telegram não configurado');
        return;
    }
    // ── 1. Tarefas em execução sem check-in após X min ───────────────────────
    const limiteChegada = new Date(agora - CFG.minutosParaChegar * 60000);
    const semCheckIn = await db.collection('tarefas_logistica')
        .where('status', '==', 'em_execucao')
        .where('checkInGPS', '==', false)
        .get();
    for (const tDoc of semCheckIn.docs) {
        const t = tDoc.data();
        const iniciadoEm = t.iniciadoEm?.toDate?.();
        if (!iniciadoEm || iniciadoEm > limiteChegada)
            continue;
        if (t.alertaChegadaEnviadoEm) {
            const ultimo = t.alertaChegadaEnviadoEm.toDate?.().getTime?.() ?? 0;
            if (agora - ultimo < CFG.cooldownAlertaMin * 60000)
                continue;
        }
        const minutos = Math.round((agora - iniciadoEm.getTime()) / 60000);
        // Último GPS do operador
        const gpsSnap = await db.collection('gps_logistica')
            .where('uid', '==', t.assigneeUid)
            .orderBy('criadoEm', 'desc')
            .limit(1)
            .get();
        const ultGPS = gpsSnap.docs[0]?.data();
        const distancia = ultGPS && t.parkingLat
            ? Math.round(distM(ultGPS.lat, ultGPS.lng, t.parkingLat, t.parkingLng))
            : null;
        const chatId = await getChatId(t.cidade ?? '');
        if (!chatId)
            continue;
        await telegram(tgCfg.token, chatId, [
            `⏰ <b>Operador não chegou ao ponto</b>`,
            ``,
            `👤 ${t.assigneeNome ?? t.assigneeUid}`,
            `📍 ${t.parkingNome ?? t.titulo}`,
            `⏱ ${minutos} min em execução sem check-in`,
            distancia !== null
                ? `📡 Distância atual: ${distancia}m`
                : `📡 GPS não recebido recentemente`,
            ``,
            `🆔 Tarefa: ${tDoc.id.slice(-6)}`,
        ].join('\n'));
        await tDoc.ref.update({
            alertaChegadaEnviadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    // ── 2. Tarefas em execução há muito tempo sem concluir ───────────────────
    const limiteExecucao = new Date(agora - CFG.minutosAtrasoTarefa * 60000);
    const emExecucao = await db.collection('tarefas_logistica')
        .where('status', '==', 'em_execucao')
        .get();
    for (const tDoc of emExecucao.docs) {
        const t = tDoc.data();
        const iniciadoEm = t.iniciadoEm?.toDate?.();
        if (!iniciadoEm || iniciadoEm > limiteExecucao)
            continue;
        if (t.alertaAtrasoEnviadoEm) {
            const ultimo = t.alertaAtrasoEnviadoEm.toDate?.().getTime?.() ?? 0;
            if (agora - ultimo < CFG.cooldownAlertaMin * 60000)
                continue;
        }
        const minutos = Math.round((agora - iniciadoEm.getTime()) / 60000);
        const progress = t.targetCount > 0
            ? `${t.deliveredCount ?? 0}/${t.targetCount} entregues`
            : null;
        const chatId = await getChatId(t.cidade ?? '');
        if (!chatId)
            continue;
        await telegram(tgCfg.token, chatId, [
            `⚠️ <b>Tarefa demorando mais que o esperado</b>`,
            ``,
            `👤 ${t.assigneeNome ?? t.assigneeUid}`,
            `📍 ${t.parkingNome ?? t.titulo}`,
            `⏱ ${minutos} min em execução`,
            progress ? `📦 Progresso: ${progress}` : '',
            ``,
            `🆔 Tarefa: ${tDoc.id.slice(-6)}`,
        ].filter(Boolean).join('\n'));
        await tDoc.ref.update({
            alertaAtrasoEnviadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    // ── 3. Operadores com GPS parado durante turno ativo ────────────────────
    const limiteGPS = new Date(agora - CFG.minutesSemGPS * 60000);
    // Busca operadores que têm tarefas ativas
    const tarefasAtivasSnap = await db.collection('tarefas_logistica')
        .where('status', 'in', ['pendente', 'em_execucao'])
        .get();
    const operadoresAtivos = new Map();
    for (const tDoc of tarefasAtivasSnap.docs) {
        const t = tDoc.data();
        if (t.assigneeUid && !operadoresAtivos.has(t.assigneeUid)) {
            operadoresAtivos.set(t.assigneeUid, {
                nome: t.assigneeNome ?? t.assigneeUid,
                cidade: t.cidade ?? '',
            });
        }
    }
    for (const [uid, info] of operadoresAtivos) {
        const gpsSnap = await db.collection('gps_logistica')
            .where('uid', '==', uid)
            .orderBy('criadoEm', 'desc')
            .limit(1)
            .get();
        if (gpsSnap.empty)
            continue;
        const ultGPS = gpsSnap.docs[0].data();
        const ultEnvio = ultGPS.criadoEm?.toDate?.();
        if (!ultEnvio || ultEnvio > limiteGPS)
            continue;
        // Verifica cooldown no doc do operador
        const opRef = db.collection('usuarios').doc(uid);
        const opSnap = await opRef.get();
        const ultimoAlerta = opSnap.data()?.alertaGPSPerdidoEm?.toDate?.()?.getTime?.() ?? 0;
        if (agora - ultimoAlerta < CFG.cooldownAlertaMin * 60000)
            continue;
        const minSem = Math.round((agora - ultEnvio.getTime()) / 60000);
        const chatId = await getChatId(info.cidade);
        if (!chatId)
            continue;
        await telegram(tgCfg.token, chatId, [
            `📡 <b>GPS perdido durante turno ativo</b>`,
            ``,
            `👤 ${info.nome}`,
            `🏙 ${info.cidade}`,
            `⏱ Sem GPS há ${minSem} min`,
            `📱 Verifique se o app está aberto e com permissão de localização`,
        ].join('\n'));
        await opRef.update({
            alertaGPSPerdidoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    functions.logger.info(`[verificarAtrasos] concluído`);
});
// ─── Item 5 — callable: alerta de GPS falso (mock) ───────────────────────────
exports.alertarMockGPS = (0, https_1.onCall)({ region: 'southamerica-east1', cors: true }, async (request) => {
    const { uid, lat, lng, capturedAt } = (request.data ?? {});
    if (!uid || lat == null || lng == null) {
        throw new Error('alertarMockGPS: uid, lat e lng são obrigatórios');
    }
    // 1. Busca nome do prestador
    let nome = uid;
    try {
        const userSnap = await db.collection('usuarios').doc(uid).get();
        nome = userSnap.data()?.nome ?? userSnap.data()?.email ?? uid;
    }
    catch { /* best-effort */ }
    // 2. Busca config Telegram (botToken + chatIds)
    const tgCfg = await getTgConfig();
    // 3. Envia alerta para cada chatId configurado (ou ao menos o primeiro)
    if (tgCfg?.token) {
        const chatIds = Object.values(tgCfg.chatIds);
        const chatIdAlvo = chatIds[0];
        if (chatIdAlvo) {
            const dataHora = capturedAt
                ? new Date(capturedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                : new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            await sendTelegramWithRetry(tgCfg.token, chatIdAlvo, [
                `⚠️ <b>GPS FALSO detectado!</b>`,
                `👤 <b>${nome}</b>`,
                `📍 Lat: ${lat}, Lng: ${lng}`,
                `🕐 ${dataHora}`,
            ].join('\n'));
        }
    }
    // 4. Grava em monitor_alertas
    await db.collection('monitor_alertas').add({
        tipo: 'mock_gps',
        uid,
        nome,
        lat,
        lng,
        capturedAt: capturedAt ?? null,
        ts: admin.firestore.FieldValue.serverTimestamp(),
    });
    functions.logger.warn(`[alertarMockGPS] Mock GPS detectado para ${nome} (${uid}) em lat=${lat} lng=${lng}`);
    return { ok: true };
});
//# sourceMappingURL=gps-alertas.js.map