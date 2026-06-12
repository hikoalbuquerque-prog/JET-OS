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
exports.verificarAtrasos = exports.verificarChegadaPonto = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const db = admin.firestore();
const CFG = {
    raioChegadaMetros: 100, // chegou se < 100m do ponto
    minutosParaChegar: 20, // alerta se não chegar em 20min
    minutesSemGPS: 10, // alerta GPS parado durante turno
    minutosAtrasoTarefa: 30, // alerta tarefa em andamento > X min
    cooldownAlertaMin: 30, // não reanvia alerta antes de 30min
};
// ─── Geo ──────────────────────────────────────────────────────────────────────
function distM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dL = (lat2 - lat1) * Math.PI / 180;
    const dG = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dL / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// ─── Telegram ─────────────────────────────────────────────────────────────────
async function telegram(token, chatId, texto) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
        });
    }
    catch (e) {
        functions.logger.warn('[gps-alertas] telegram erro:', e);
    }
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
    if (tarefasSnap.empty)
        return;
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
});
// ─── SCHEDULER: a cada 5min — verifica atrasos e GPS perdido ────────────────
exports.verificarAtrasos = (0, scheduler_1.onSchedule)({
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    memory: '256MiB',
}, async () => {
    const agora = Date.now();
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
//# sourceMappingURL=gps-alertas.js.map