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

import * as admin  from 'firebase-admin';
import * as functions from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule }        from 'firebase-functions/v2/scheduler';
import { onCall }            from 'firebase-functions/v2/https';

const db = admin.firestore();

// Item 6 — defaults hard-coded (podem ser sobrescritos via Firestore: monitor_config/gps)
const DEFAULT_CFG = {
  raioChegadaMetros:   100,   // chegou se < 100m do ponto
  minutosParaChegar:    20,   // alerta se não chegar em 20min
  minutesSemGPS:        10,   // alerta GPS parado durante turno
  minutosAtrasoTarefa:  30,   // alerta tarefa em andamento > X min
  cooldownAlertaMin:    30,   // não reenvia alerta antes de 30min
};

// Usado pelo trigger verificarChegadaPonto (não carrega Firestore para não atrasar trigger)
const CFG = DEFAULT_CFG;

// ─── Geo ──────────────────────────────────────────────────────────────────────

function distM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dG/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

// Item 3 — retry automático até maxTentativas com delay de 1s entre tentativas
async function sendTelegramWithRetry(
  botToken: string,
  chatId: string,
  text: string,
  maxTentativas = 3,
): Promise<void> {
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      if (resp.ok) return;
      const body = await resp.text().catch(() => '');
      functions.logger.warn(`[gps-alertas] telegram tentativa ${tentativa} falhou (${resp.status}):`, body);
    } catch (e) {
      functions.logger.warn(`[gps-alertas] telegram tentativa ${tentativa} erro:`, e);
    }
    if (tentativa < maxTentativas) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  functions.logger.error('[gps-alertas] telegram: esgotou tentativas para chatId', chatId);
}

// Alias para compatibilidade interna
async function telegram(token: string, chatId: string, texto: string): Promise<void> {
  return sendTelegramWithRetry(token, chatId, texto);
}

async function getTgConfig(): Promise<{ token: string; chatIds: Record<string, string> } | null> {
  try {
    const snap = await db.collection('telegram_config').doc('global').get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    return { token: d.botToken ?? '', chatIds: d.chatIds ?? d.cidades ?? {} };
  } catch { return null; }
}

// Busca chatId para a cidade — fallback para o chatId global
async function getChatId(cidade: string): Promise<string | null> {
  const cfg = await getTgConfig();
  if (!cfg?.token) return null;
  const cidades = cfg.chatIds;
  return cidades[cidade] ?? cidades['default'] ?? cidades[Object.keys(cidades)[0]] ?? null;
}

// ─── TRIGGER: novo GPS → verifica chegada ────────────────────────────────────

export const verificarChegadaPonto = onDocumentCreated(
  { document: 'gps_logistica/{id}', region: 'southamerica-east1' },
  async (event) => {
    const gps = event.data?.data();
    if (!gps?.uid || !gps?.lat || !gps?.lng) return;

    const { uid, lat, lng } = gps;

    // Busca tarefas ativas deste operador que ainda não fizeram check-in
    const tarefasSnap = await db.collection('tarefas_logistica')
      .where('assigneeUid', '==', uid)
      .where('status', '==', 'em_execucao')
      .get();

    if (tarefasSnap.empty) return;

    const batch = db.batch();
    let atualizou = false;

    for (const tDoc of tarefasSnap.docs) {
      const t = tDoc.data();
      if (!t.parkingLat || !t.parkingLng) continue;
      if (t.checkInGPS) continue; // já chegou

      const dist = distM(lat, lng, t.parkingLat, t.parkingLng);

      if (dist <= CFG.raioChegadaMetros) {
        batch.update(tDoc.ref, {
          checkInGPS:   true,
          checkInGPSEm: admin.firestore.FieldValue.serverTimestamp(),
          checkInDistM: Math.round(dist),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        atualizou = true;
        functions.logger.info(`[gps-alertas] ${uid} chegou ao ponto ${t.parkingNome} (${Math.round(dist)}m)`);
      }
    }

    if (atualizou) await batch.commit();
  }
);

// ─── SCHEDULER: a cada 5min — verifica atrasos e GPS perdido ────────────────

export const verificarAtrasos = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    memory: '256MiB',
  },
  async () => {
    const agora   = Date.now();

    // Item 6 — carrega parâmetros configuráveis via Firestore, merge com defaults
    let CFG = DEFAULT_CFG;
    try {
      const cfgSnap = await db.collection('monitor_config').doc('gps').get();
      CFG = { ...DEFAULT_CFG, ...(cfgSnap.data() ?? {}) } as typeof DEFAULT_CFG;
    } catch (e) {
      functions.logger.warn('[verificarAtrasos] Falha ao carregar monitor_config/gps, usando defaults:', e);
    }

    const tgCfg   = await getTgConfig();
    if (!tgCfg?.token) {
      functions.logger.warn('[verificarAtrasos] Telegram não configurado');
      return;
    }

    // ── 1. Tarefas em execução sem check-in após X min ───────────────────────
    const limiteChegada = new Date(agora - CFG.minutosParaChegar * 60_000);
    const semCheckIn = await db.collection('tarefas_logistica')
      .where('status', '==', 'em_execucao')
      .where('checkInGPS', '==', false)
      .get();

    for (const tDoc of semCheckIn.docs) {
      const t = tDoc.data();
      const iniciadoEm = t.iniciadoEm?.toDate?.();
      if (!iniciadoEm || iniciadoEm > limiteChegada) continue;
      if (t.alertaChegadaEnviadoEm) {
        const ultimo = t.alertaChegadaEnviadoEm.toDate?.().getTime?.() ?? 0;
        if (agora - ultimo < CFG.cooldownAlertaMin * 60_000) continue;
      }

      const minutos = Math.round((agora - iniciadoEm.getTime()) / 60_000);

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
      if (!chatId) continue;

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
    const limiteExecucao = new Date(agora - CFG.minutosAtrasoTarefa * 60_000);
    const emExecucao = await db.collection('tarefas_logistica')
      .where('status', '==', 'em_execucao')
      .get();

    for (const tDoc of emExecucao.docs) {
      const t = tDoc.data();
      const iniciadoEm = t.iniciadoEm?.toDate?.();
      if (!iniciadoEm || iniciadoEm > limiteExecucao) continue;
      if (t.alertaAtrasoEnviadoEm) {
        const ultimo = t.alertaAtrasoEnviadoEm.toDate?.().getTime?.() ?? 0;
        if (agora - ultimo < CFG.cooldownAlertaMin * 60_000) continue;
      }

      const minutos = Math.round((agora - iniciadoEm.getTime()) / 60_000);
      const progress = t.targetCount > 0
        ? `${t.deliveredCount ?? 0}/${t.targetCount} entregues`
        : null;

      const chatId = await getChatId(t.cidade ?? '');
      if (!chatId) continue;

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
    const limiteGPS = new Date(agora - CFG.minutesSemGPS * 60_000);

    // Busca operadores que têm tarefas ativas
    const tarefasAtivasSnap = await db.collection('tarefas_logistica')
      .where('status', 'in', ['pendente', 'em_execucao'])
      .get();

    const operadoresAtivos = new Map<string, { nome: string; cidade: string }>();
    for (const tDoc of tarefasAtivasSnap.docs) {
      const t = tDoc.data();
      if (t.assigneeUid && !operadoresAtivos.has(t.assigneeUid)) {
        operadoresAtivos.set(t.assigneeUid, {
          nome:   t.assigneeNome ?? t.assigneeUid,
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

      if (gpsSnap.empty) continue;

      const ultGPS = gpsSnap.docs[0].data();
      const ultEnvio = ultGPS.criadoEm?.toDate?.();
      if (!ultEnvio || ultEnvio > limiteGPS) continue;

      // Verifica cooldown no doc do operador
      const opRef  = db.collection('usuarios').doc(uid);
      const opSnap = await opRef.get();
      const ultimoAlerta = opSnap.data()?.alertaGPSPerdidoEm?.toDate?.()?.getTime?.() ?? 0;
      if (agora - ultimoAlerta < CFG.cooldownAlertaMin * 60_000) continue;

      const minSem = Math.round((agora - ultEnvio.getTime()) / 60_000);
      const chatId = await getChatId(info.cidade);
      if (!chatId) continue;

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
  }
);

// ─── Item 5 — callable: alerta de GPS falso (mock) ───────────────────────────

export const alertarMockGPS = onCall(
  { region: 'southamerica-east1', cors: true },
  async (request) => {
    const { uid, lat, lng, capturedAt } = (request.data ?? {}) as {
      uid: string; lat: number; lng: number; capturedAt: string;
    };

    if (!uid || lat == null || lng == null) {
      throw new Error('alertarMockGPS: uid, lat e lng são obrigatórios');
    }

    // 1. Busca nome do prestador
    let nome = uid;
    try {
      const userSnap = await db.collection('usuarios').doc(uid).get();
      nome = userSnap.data()?.nome ?? userSnap.data()?.email ?? uid;
    } catch { /* best-effort */ }

    // 2. Busca config Telegram (botToken + chatIds)
    const tgCfg = await getTgConfig();

    // 3. Envia alerta para cada chatId configurado (ou ao menos o primeiro)
    if (tgCfg?.token) {
      const chatIds = Object.values(tgCfg.chatIds);
      const chatIdAlvo = chatIds[0] as string | undefined;
      if (chatIdAlvo) {
        const dataHora = capturedAt
          ? new Date(capturedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          : new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        await sendTelegramWithRetry(
          tgCfg.token,
          chatIdAlvo,
          [
            `⚠️ <b>GPS FALSO detectado!</b>`,
            `👤 <b>${nome}</b>`,
            `📍 Lat: ${lat}, Lng: ${lng}`,
            `🕐 ${dataHora}`,
          ].join('\n'),
        );
      }
    }

    // 4. Grava em monitor_alertas
    await db.collection('monitor_alertas').add({
      tipo:       'mock_gps',
      uid,
      nome,
      lat,
      lng,
      capturedAt: capturedAt ?? null,
      ts:         admin.firestore.FieldValue.serverTimestamp(),
    });

    functions.logger.warn(`[alertarMockGPS] Mock GPS detectado para ${nome} (${uid}) em lat=${lat} lng=${lng}`);
    return { ok: true };
  }
);
