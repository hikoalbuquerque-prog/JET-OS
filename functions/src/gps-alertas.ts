// functions/src/gps-alertas.ts
// Monitoramento GPS dos operadores de campo — JET OS V2
//
// Funções:
//   verificarChegadaPonto — trigger: novo GPS em gps_logistica
//   verificarAtrasos      — scheduler: a cada 5min
//
// Deploy: export * from './gps-alertas'; no index.ts

import * as functions from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule }        from 'firebase-functions/v2/scheduler';
import { onCall }            from 'firebase-functions/v2/https';
import { supabaseGet, supabaseGetOne, supabaseInsert, supabaseUpdate } from './lib/supabase-rest';

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

// Alias haversine (mesma lógica que distM, nomeado para clareza interna)
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Point-in-polygon (ray casting) — equivalente a pontoNoPoli de app-utils.ts
function pontoNoPoli(lat: number, lng: number, pontos: {lat: number; lng: number}[]): boolean {
  let inside = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const xi = pontos[i].lat, yi = pontos[i].lng;
    const xj = pontos[j].lat, yj = pontos[j].lng;
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

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
    // Supabase-first (Onda G)
    const { getTelegramConfigSupa, getTelegramChatIdsSupa } = await import('./telegram-supabase');
    const supa = await getTelegramConfigSupa('global');
    if (supa?.bot_token) {
      const chatIds = (supa.chat_ids && typeof supa.chat_ids === 'object')
        ? supa.chat_ids as Record<string, string>
        : await getTelegramChatIdsSupa();
      return { token: String(supa.bot_token), chatIds };
    }
  } catch { /* fallback */ }

  return null;
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
  { document: 'gps_logistica/{id}', region: 'southamerica-east1', maxInstances: 10 },
  async (event) => {
    const gps = event.data?.data();
    if (!gps?.uid || !gps?.lat || !gps?.lng) return;

    const { uid, lat, lng } = gps;

    // Busca tarefas ativas deste operador que ainda não fizeram check-in
    const tarefasRows = await supabaseGet<any>('tarefas_logistica', `select=*&assignee_uid=eq.${encodeURIComponent(uid)}&status=eq.em_execucao`);

    for (const t of (tarefasRows ?? [])) {
      if (!t.parking_lat || !t.parking_lng) continue;
      if (t.check_in_gps) continue; // já chegou

      const dist = distM(lat, lng, t.parking_lat, t.parking_lng);

      if (dist <= CFG.raioChegadaMetros) {
        await supabaseUpdate('tarefas_logistica', {
          check_in_gps:    true,
          check_in_gps_em: new Date().toISOString(),
          check_in_dist_m: Math.round(dist),
          atualizado_em:   new Date().toISOString(),
        }, `id=eq.${t.id}`);
        functions.logger.info(`[gps-alertas] ${uid} chegou ao ponto ${t.parking_nome} (${Math.round(dist)}m)`);
      }
    }

    // ── FEATURE 1: Detecção de teleporte ────────────────────────────────────
    try {
      const TELEPORTE_MAX_MS = 10 * 60 * 1000;       // ignora gap > 10 min (offline)
      const TELEPORTE_VEL_MS = 150;                   // 150 m/s = 540 km/h
      const TELEPORTE_COOLDOWN_MS = 10 * 60 * 1000;  // cooldown 10 min por uid

      const doisPontos = await supabaseGet<any>('gps_logistica', `select=*&uid=eq.${encodeURIComponent(uid)}&order=criado_em.desc&limit=2`);

      if (doisPontos && doisPontos.length >= 2) {
        const pontoNovo = doisPontos[0];
        const pontoAnt  = doisPontos[1];

        const tsNovo = pontoNovo.criado_em ? new Date(pontoNovo.criado_em).getTime() : Date.now();
        const tsAnt  = pontoAnt.criado_em ? new Date(pontoAnt.criado_em).getTime() : 0;
        const deltaMs = tsNovo - tsAnt;

        if (deltaMs > 0 && deltaMs <= TELEPORTE_MAX_MS) {
          const distancia = haversineM(pontoAnt.lat, pontoAnt.lng, pontoNovo.lat, pontoNovo.lng);
          const velocidadeMs = distancia / (deltaMs / 1000);

          if (velocidadeMs > TELEPORTE_VEL_MS) {
            // Verifica cooldown no doc do usuário
            let opData: any = {};
            try {
              const sbUser = await supabaseGetOne<any>('usuarios', `select=*&id=eq.${encodeURIComponent(uid)}`);
              opData = sbUser ?? {};
            } catch (e) {
              functions.logger.warn('[gps-alertas] Supabase usuarios falhou:', e);
            }
            const ultimoAlerta = opData.alerta_teleporte_em ? new Date(opData.alerta_teleporte_em).getTime() : 0;
            const agora = Date.now();

            if (agora - ultimoAlerta >= TELEPORTE_COOLDOWN_MS) {
              const velocidadeKmh = Math.round(velocidadeMs * 3.6);
              const distanciaM    = Math.round(distancia);
              const segundos      = Math.round(deltaMs / 1000);
              const nome = opData.nome ?? opData.email ?? uid;
              const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;

              // Grava alerta no Supabase
              supabaseInsert('monitor_alertas', {
                tipo: 'teleporte', uid, nome, lat, lng,
                velocidade_kmh: velocidadeKmh, distancia_m: distanciaM,
                ts: new Date().toISOString(),
              }).catch((e) => { functions.logger.warn('[gps-alertas] Supabase insert monitor_alertas falhou:', e); });

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
                  await sendTelegramWithRetry(
                    tgCfg.token,
                    chatId,
                    [
                      `⚡ <b>Teleporte detectado!</b>`,
                      `👤 <b>${nome}</b>`,
                      `📏 ${distanciaM}m em ${segundos}s (${velocidadeKmh} km/h)`,
                      `📍 <a href="${mapsLink}">Ver no Google Maps</a>`,
                    ].join('\n'),
                  );
                }
              }

              // Atualiza cooldown
              await supabaseUpdate('usuarios', {
                alerta_teleporte_em: new Date().toISOString(),
              }, `id=eq.${encodeURIComponent(uid)}`);

              functions.logger.warn(`[gps-alertas] Teleporte detectado: ${nome} (${uid}) ${distanciaM}m em ${segundos}s`);
            }
          }
        }
      }
    } catch (e) {
      functions.logger.error('[gps-alertas] Erro na detecção de teleporte:', e);
    }

    // ── FEATURE 2: Geofencing — alerta ao sair da zona ──────────────────────
    try {
      const GEOFENCE_COOLDOWN_MS = 15 * 60 * 1000; // cooldown 15 min por uid

      let opData: any = {};
      try {
        const sbUser = await supabaseGetOne<any>('usuarios', `select=*&id=eq.${encodeURIComponent(uid)}`);
        opData = sbUser ?? {};
      } catch (e) {
        functions.logger.warn('[gps-alertas] Supabase usuarios falhou:', e);
      }
      const nome   = opData.nome ?? opData.email ?? uid;

      // Determina quais zonas estão atribuídas ao usuário
      // Suporta zonasPermitidas: string[] (array de IDs) ou zonaId: string (único ID)
      let zonaIds: string[] = [];
      if (Array.isArray(opData.zonasPermitidas) && opData.zonasPermitidas.length > 0) {
        zonaIds = opData.zonasPermitidas;
      } else if (typeof opData.zonaId === 'string' && opData.zonaId) {
        zonaIds = [opData.zonaId];
      }

      if (zonaIds.length === 0) {
        // Sem zona atribuída — não alertar
        return;
      }

      // Supabase-first: try zonas table
      let zonasComPoligono: { id: string; nome?: string; poligono?: {lat: number; lng: number}[] }[] = [];
      try {
        const sbZonas = await supabaseGet<any>('zonas', `select=id,nome,poligono&id=in.(${zonaIds.map(id => encodeURIComponent(id)).join(',')})`);
        if (sbZonas && sbZonas.length > 0) {
          zonasComPoligono = sbZonas.filter((z: any) => z.poligono);
        }
      } catch (e) {
        functions.logger.error('[gps-alertas] Supabase zonas falhou:', e);
      }

      if (zonasComPoligono.length === 0) return;

      // Verifica se o ponto está dentro de ao menos uma zona
      const dentroDeAlgumaZona = zonasComPoligono.some(z =>
        z.poligono && z.poligono.length >= 3 && pontoNoPoli(lat, lng, z.poligono)
      );

      if (!dentroDeAlgumaZona) {
        const agora = Date.now();
        const ultimoAlerta = opData.alerta_geofence_em ? new Date(opData.alerta_geofence_em).getTime() : 0;

        if (agora - ultimoAlerta >= GEOFENCE_COOLDOWN_MS) {
          const nomesZonas = zonasComPoligono.map(z => z.nome ?? z.id);
          const mapsLink   = `https://www.google.com/maps?q=${lat},${lng}`;

          // Grava alerta no Supabase
          supabaseInsert('monitor_alertas', {
            tipo: 'fora_zona', uid, nome, lat, lng,
            zonas: nomesZonas, ts: new Date().toISOString(),
          }).catch((e) => { functions.logger.warn('[gps-alertas] Supabase insert monitor_alertas falhou:', e); });

          // Envia Telegram
          const tgCfg = await getTgConfig();
          if (tgCfg?.token) {
            const cidade = opData.cidade ?? '';
            const chatId = await getChatId(cidade);
            if (chatId) {
              await sendTelegramWithRetry(
                tgCfg.token,
                chatId,
                [
                  `🚨 <b>Fora da zona!</b>`,
                  `👤 <b>${nome}</b> está fora da(s) zona(s) atribuída(s)`,
                  `📍 Posição: ${lat},${lng}`,
                  `🗺 Zonas: ${nomesZonas.join(', ')}`,
                  `<a href="${mapsLink}">Ver no Google Maps</a>`,
                ].join('\n'),
              );
            }
          }

          // Atualiza cooldown
          await supabaseUpdate('usuarios', {
            alerta_geofence_em: new Date().toISOString(),
          }, `id=eq.${encodeURIComponent(uid)}`);

          functions.logger.warn(`[gps-alertas] Geofence: ${nome} (${uid}) fora das zonas [${nomesZonas.join(', ')}]`);
        }
      }
    } catch (e) {
      functions.logger.error('[gps-alertas] Erro no geofencing:', e);
    }
  }
);

// ─── SCHEDULER: a cada 5min — verifica atrasos e GPS perdido ────────────────

export const verificarAtrasos = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    memory: '256MiB',
    maxInstances: 10,
  },
  async () => {
    const agora   = Date.now();

    // Item 6 — carrega parâmetros configuráveis, Supabase-first com fallback Firestore
    let cfgData: any = {};
    try {
      const sbCfg = await supabaseGetOne<any>('app_settings', `select=valor&chave=eq.monitor_config_gps`);
      if (sbCfg?.valor) {
        cfgData = sbCfg.valor;
      }
    } catch (e) {
      functions.logger.warn('[verificarAtrasos] Falha ao carregar monitor_config/gps, usando defaults:', e);
    }
    let CFG = { ...DEFAULT_CFG, ...cfgData } as typeof DEFAULT_CFG;

    const tgCfg   = await getTgConfig();
    if (!tgCfg?.token) {
      functions.logger.warn('[verificarAtrasos] Telegram não configurado');
      return;
    }

    // ── 1. Tarefas em execução sem check-in após X min ───────────────────────
    const limiteChegada = new Date(agora - CFG.minutosParaChegar * 60_000);
    const semCheckInRows = await supabaseGet<any>('tarefas_logistica', 'select=*&status=eq.em_execucao&check_in_gps=eq.false');

    for (const t of (semCheckInRows ?? [])) {
      const iniciadoEm = t.iniciado_em ? new Date(t.iniciado_em) : null;
      if (!iniciadoEm || iniciadoEm > limiteChegada) continue;
      if (t.alerta_chegada_enviado_em) {
        const ultimo = new Date(t.alerta_chegada_enviado_em).getTime();
        if (agora - ultimo < CFG.cooldownAlertaMin * 60_000) continue;
      }

      const minutos = Math.round((agora - iniciadoEm.getTime()) / 60_000);

      // Último GPS do operador
      const gpsRows = await supabaseGet<any>('gps_logistica', `select=*&uid=eq.${encodeURIComponent(t.assignee_uid)}&order=criado_em.desc&limit=1`);
      const ultGPS = gpsRows?.[0];
      const distancia = ultGPS && t.parking_lat
        ? Math.round(distM(ultGPS.lat, ultGPS.lng, t.parking_lat, t.parking_lng))
        : null;

      const chatId = await getChatId(t.cidade ?? '');
      if (!chatId) continue;

      await telegram(tgCfg.token, chatId, [
        `⏰ <b>Operador não chegou ao ponto</b>`,
        ``,
        `👤 ${t.assignee_nome ?? t.assignee_uid}`,
        `📍 ${t.parking_nome ?? t.titulo}`,
        `⏱ ${minutos} min em execução sem check-in`,
        distancia !== null
          ? `📡 Distância atual: ${distancia}m`
          : `📡 GPS não recebido recentemente`,
        ``,
        `🆔 Tarefa: ${t.id.slice(-6)}`,
      ].join('\n'));

      await supabaseUpdate('tarefas_logistica', {
        alerta_chegada_enviado_em: new Date().toISOString(),
      }, `id=eq.${t.id}`);
    }

    // ── 2. Tarefas em execução há muito tempo sem concluir ───────────────────
    const limiteExecucao = new Date(agora - CFG.minutosAtrasoTarefa * 60_000);
    const emExecucaoRows = await supabaseGet<any>('tarefas_logistica', 'select=*&status=eq.em_execucao');

    for (const t of (emExecucaoRows ?? [])) {
      const iniciadoEm = t.iniciado_em ? new Date(t.iniciado_em) : null;
      if (!iniciadoEm || iniciadoEm > limiteExecucao) continue;
      if (t.alerta_atraso_enviado_em) {
        const ultimo = new Date(t.alerta_atraso_enviado_em).getTime();
        if (agora - ultimo < CFG.cooldownAlertaMin * 60_000) continue;
      }

      const minutos = Math.round((agora - iniciadoEm.getTime()) / 60_000);
      const progress = t.target_count > 0
        ? `${t.delivered_count ?? 0}/${t.target_count} entregues`
        : null;

      const chatId = await getChatId(t.cidade ?? '');
      if (!chatId) continue;

      await telegram(tgCfg.token, chatId, [
        `⚠️ <b>Tarefa demorando mais que o esperado</b>`,
        ``,
        `👤 ${t.assignee_nome ?? t.assignee_uid}`,
        `📍 ${t.parking_nome ?? t.titulo}`,
        `⏱ ${minutos} min em execução`,
        progress ? `📦 Progresso: ${progress}` : '',
        ``,
        `🆔 Tarefa: ${t.id.slice(-6)}`,
      ].filter(Boolean).join('\n'));

      await supabaseUpdate('tarefas_logistica', {
        alerta_atraso_enviado_em: new Date().toISOString(),
      }, `id=eq.${t.id}`);
    }

    // ── 3. Operadores com GPS parado durante turno ativo ────────────────────
    const limiteGPS = new Date(agora - CFG.minutesSemGPS * 60_000);

    // Busca operadores que têm tarefas ativas
    const tarefasAtivasRows = await supabaseGet<any>('tarefas_logistica', 'select=assignee_uid,assignee_nome,cidade&status=in.(pendente,em_execucao)');

    const operadoresAtivos = new Map<string, { nome: string; cidade: string }>();
    for (const t of (tarefasAtivasRows ?? [])) {
      if (t.assignee_uid && !operadoresAtivos.has(t.assignee_uid)) {
        operadoresAtivos.set(t.assignee_uid, {
          nome:   t.assignee_nome ?? t.assignee_uid,
          cidade: t.cidade ?? '',
        });
      }
    }

    for (const [uid, info] of operadoresAtivos) {
      const gpsRows = await supabaseGet<any>('gps_logistica', `select=*&uid=eq.${encodeURIComponent(uid)}&order=criado_em.desc&limit=1`);

      if (!gpsRows || gpsRows.length === 0) continue;

      const ultGPS = gpsRows[0];
      const ultEnvio = ultGPS.criado_em ? new Date(ultGPS.criado_em) : null;
      if (!ultEnvio || ultEnvio > limiteGPS) continue;

      // Verifica cooldown no doc do operador
      let opData: any = {};
      try {
        const sbUser = await supabaseGetOne<any>('usuarios', `select=*&id=eq.${encodeURIComponent(uid)}`);
        opData = sbUser ?? {};
      } catch { /* best-effort */ }
      const ultimoAlerta = opData.alerta_gps_perdido_em ? new Date(opData.alerta_gps_perdido_em).getTime() : 0;
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

      await supabaseUpdate('usuarios', {
        alerta_gps_perdido_em: new Date().toISOString(),
      }, `id=eq.${encodeURIComponent(uid)}`);
    }

    // ── 4. Operadores com SLOT ativo mas sem GPS por X min ───────────────────
    // Complementa seção 3 (tarefas) — cobre chargers/scalts sem tarefas atribuídas
    try {
      const COOLDOWN_SLOT_GPS_MS = 20 * 60_000; // 20 min cooldown por worker
      const slotsAtivosRows = await supabaseGet<any>('slots', 'select=id,aceito_por,aceito_por_nome,cidade&status=eq.em_andamento');

      const workersPorSlot = new Map<string, { nome: string; cidade: string; slotId: string }>();
      for (const s of (slotsAtivosRows ?? [])) {
        if (s.aceito_por && !workersPorSlot.has(s.aceito_por)) {
          workersPorSlot.set(s.aceito_por, {
            nome:   s.aceito_por_nome ?? s.aceito_por,
            cidade: s.cidade ?? '',
            slotId: s.id,
          });
        }
      }

      // Remove workers que já foram cobertos na seção 3 (têm tarefas ativas)
      for (const uid of operadoresAtivos.keys()) workersPorSlot.delete(uid);

      for (const [uid, info] of workersPorSlot) {
        const gpsRows = await supabaseGet<any>('gps_logistica', `select=*&uid=eq.${encodeURIComponent(uid)}&order=criado_em.desc&limit=1`);

        if (!gpsRows || gpsRows.length === 0) continue;
        const ultGPS    = gpsRows[0];
        const ultEnvio  = ultGPS.criado_em ? new Date(ultGPS.criado_em) : null;
        if (!ultEnvio || ultEnvio > limiteGPS) continue;

        let opData: any = {};
        try {
          const sbUser = await supabaseGetOne<any>('usuarios', `select=*&id=eq.${encodeURIComponent(uid)}`);
          opData = sbUser ?? {};
        } catch { /* best-effort */ }
        const ultimoAlerta = opData.alerta_gps_slot_em ? new Date(opData.alerta_gps_slot_em).getTime() : 0;
        if (agora - ultimoAlerta < COOLDOWN_SLOT_GPS_MS) continue;

        const minSem = Math.round((agora - ultEnvio.getTime()) / 60_000);
        const chatId = await getChatId(info.cidade);
        if (!chatId) continue;

        await telegram(tgCfg.token, chatId, [
          `📡 <b>GPS perdido — turno ativo</b>`,
          ``,
          `👤 ${info.nome}`,
          `🏙 ${info.cidade}`,
          `⏱ Sem GPS há ${minSem} min`,
          `🔑 Slot: ${info.slotId.slice(-6)}`,
          `📱 Verificar se o app está aberto e com localização ativada`,
        ].join('\n'));

        // Write to Supabase
        supabaseInsert('monitor_alertas', {
          tipo: 'gps_ausente_slot', uid, nome: info.nome,
          cidade: info.cidade, min_sem: minSem,
          ts: new Date().toISOString(),
        }).catch((e) => { functions.logger.warn('[gps-alertas] Supabase insert monitor_alertas falhou:', e); });

        await supabaseUpdate('usuarios', {
          alerta_gps_slot_em: new Date().toISOString(),
        }, `id=eq.${encodeURIComponent(uid)}`);
      }
    } catch (e) {
      functions.logger.error('[verificarAtrasos] Erro na seção 4 (slots GPS):', e);
    }

    functions.logger.info(`[verificarAtrasos] concluído`);
  }
);

// ─── Item 5 — callable: alerta de GPS falso (mock) ───────────────────────────

export const alertarMockGPS = onCall(
  { region: 'southamerica-east1', maxInstances: 10, cors: true },
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
      const userRow = await supabaseGetOne<any>('usuarios', `select=nome,email&id=eq.${encodeURIComponent(uid)}`);
      nome = userRow?.nome ?? userRow?.email ?? uid;
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

    // 4. Grava em monitor_alertas (Supabase)
    await supabaseInsert('monitor_alertas', {
      tipo: 'mock_gps', uid, nome, lat, lng,
      captured_at: capturedAt ?? null, ts: new Date().toISOString(),
    });

    functions.logger.warn(`[alertarMockGPS] Mock GPS detectado para ${nome} (${uid}) em lat=${lat} lng=${lng}`);
    return { ok: true };
  }
);
