// functions/src/slots-telegram.ts
// Cloud Functions: resumo de slots via Telegram + cascata de confirmação
//
// Exports:
//   resumoSlotsTelegram    — onSchedule 08:00 e 20:00 BRT, gera resumo por cidade
//   confirmarSlotsCascata  — onSchedule a cada 15min, lembretes antes do slot
//   enviarResumoManual     — onCall, dispara resumo manual para uma cidade

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { supabaseGet, supabaseGetOne, supabaseUpdate } from './lib/supabase-rest';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SlotDoc {
  id: string;
  titulo?: string;
  turnoInicio?: string;   // ISO "2026-06-23T07:00:00"
  turnoFim?: string;      // ISO "2026-06-23T09:00:00"
  cidade?: string;
  cargo?: string;         // "charger" | "scout" | ...
  status?: string;
  vagas?: number;
  vagasOcupadas?: number;
  aceitoPor?: string;
  checkInEm?: string;
  motivoCancelamento?: string;
  confirmacoes?: {
    t120?: string;
    t90?: string;
    t60?: string;
    t0?: string;
  };
}

interface CidadeConfig {
  grupos?: {
    logistica?: {
      chatId?: string;
      topicos?: {
        resumo_slots?: number;
        alertas?: number;
        [key: string]: number | undefined;
      };
    };
  };
}

// ─── Helpers gerais ───────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  threadId?: number,
): Promise<void> {
  if (!botToken || !chatId) return;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (threadId) body.message_thread_id = threadId;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[slots-telegram] Telegram error:', err);
    }
  } catch (e) {
    console.warn('[slots-telegram] Telegram network failure:', e);
  }
}

async function getBotToken(): Promise<string> {
  const row = await supabaseGetOne<any>('telegram_config', 'select=bot_token&id=eq.global');
  return row?.bot_token ?? '';
}

function getBrtDate(offsetDays = 0): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - 180); // UTC-3 BRT
  now.setDate(now.getDate() + offsetDays);
  return now.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function slotDateStr(slot: SlotDoc): string {
  return (slot.turnoInicio ?? '').slice(0, 10);
}

function slotHoraInicio(slot: SlotDoc): string {
  return (slot.turnoInicio ?? '').slice(11, 16) || '00:00';
}

function slotHoraFim(slot: SlotDoc): string {
  return (slot.turnoFim ?? '').slice(11, 16) || '??:??';
}

function getBrtTimeStr(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - 180);
  return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Classificação de status ──────────────────────────────────────────────────

type StatusGroup = 'iniciou' | 'pendente' | 'faltou' | 'desistiu';

function classifyStatus(slot: SlotDoc): StatusGroup {
  const s = slot.status ?? '';
  if (s === 'em_andamento' || s === 'concluido') return 'iniciou';
  if (s === 'aberto' || s === 'aceito' || s === 'a_caminho') return 'pendente';
  if (s === 'cancelado') {
    const motivo = (slot.motivoCancelamento ?? '').toLowerCase();
    if (motivo.includes('falt') || motivo.includes('no_show')) return 'faltou';
    return 'desistiu';
  }
  return 'pendente';
}

// ─── Classificação de turno ───────────────────────────────────────────────────

type Turno = 'T1' | 'T2' | 'T0' | 'custom';

function classifyTurno(horaInicio: string): Turno {
  if (!horaInicio) return 'custom';
  const [h] = horaInicio.split(':').map(Number);
  if (h >= 10 && h <= 14) return 'T1';
  if (h >= 15 && h <= 22) return 'T2';
  if (h >= 23 || h <= 6) return 'T0';
  return 'custom';
}

function turnoEmoji(turno: Turno): string {
  const map = { T1: '☀️', T2: '🌆', T0: '🌙', custom: '⏰' };
  return map[turno];
}

function turnoLabel(turno: Turno): string {
  const map = { T1: 'T1', T2: 'T2', T0: 'T0', custom: 'Custom' };
  return map[turno];
}

// ─── Classificação de cargo ───────────────────────────────────────────────────

function isCharger(slot: SlotDoc): boolean {
  return (slot.cargo ?? '').toLowerCase() === 'charger';
}

// ─── Geração do texto de resumo ───────────────────────────────────────────────

interface DayStats {
  total: number;
  vagas: number;
  ocupadas: number;
  iniciou: number;
  pendente: number;
  faltou: number;
  desistiu: number;
  scoutTotal: number;
  scoutVagas: number;
  scoutOcupadas: number;
  scoutIniciou: number;
  chargerTotal: number;
  chargerVagas: number;
  chargerOcupadas: number;
  chargerIniciou: number;
  chargerPendente: number;
  turnoGroups: Map<string, { turno: Turno; hora: string; slots: SlotDoc[] }>;
}

function buildDayStats(slots: SlotDoc[]): DayStats {
  const st: DayStats = {
    total: slots.length,
    vagas: 0, ocupadas: 0,
    iniciou: 0, pendente: 0, faltou: 0, desistiu: 0,
    scoutTotal: 0, scoutVagas: 0, scoutOcupadas: 0, scoutIniciou: 0,
    chargerTotal: 0, chargerVagas: 0, chargerOcupadas: 0, chargerIniciou: 0, chargerPendente: 0,
    turnoGroups: new Map(),
  };

  for (const s of slots) {
    const vagas = s.vagas ?? 1;
    const ocupadas = s.vagasOcupadas ?? (s.aceitoPor ? 1 : 0);
    st.vagas += vagas;
    st.ocupadas += ocupadas;

    const grp = classifyStatus(s);
    st[grp]++;

    const charger = isCharger(s);
    if (charger) {
      st.chargerTotal++;
      st.chargerVagas += vagas;
      st.chargerOcupadas += ocupadas;
      if (grp === 'iniciou') st.chargerIniciou++;
      if (grp === 'pendente') st.chargerPendente++;
    } else {
      st.scoutTotal++;
      st.scoutVagas += vagas;
      st.scoutOcupadas += ocupadas;
      if (grp === 'iniciou') st.scoutIniciou++;
    }

    const hora = slotHoraInicio(s);
    const turno = classifyTurno(hora);
    const key = `${turno}_${hora}`;
    if (!st.turnoGroups.has(key)) {
      st.turnoGroups.set(key, { turno, hora, slots: [] });
    }
    st.turnoGroups.get(key)!.slots.push(s);
  }

  return st;
}

function fmtSlotLine(slots: SlotDoc[]): string {
  const total = slots.length;
  const vagas = slots.reduce((a, s) => a + (s.vagas ?? 1), 0);
  const ocp = slots.reduce((a, s) => a + (s.vagasOcupadas ?? (s.aceitoPor ? 1 : 0)), 0);
  const ini = slots.filter(s => classifyStatus(s) === 'iniciou').length;
  return `${total} s · ${vagas} v · ${ocp}/${vagas} · ✅${ini}`;
}

function fmtDateBR(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function buildDaySection(dateStr: string, dayEmoji: string, slots: SlotDoc[]): string {
  if (slots.length === 0) {
    return `${dayEmoji} ${dateStr} — sem slots`;
  }

  const st = buildDayStats(slots);
  const lines: string[] = [];

  // Header do dia
  lines.push(
    `📅 ${dayEmoji} — ${dateStr} · ${st.total} slots · ${st.vagas} vagas · ${st.ocupadas}/${st.vagas}`
  );
  lines.push(
    `   ✅${st.iniciou} · ⏳${st.pendente} · ❌${st.faltou} · ⛔${st.desistiu}`
  );

  // Linha Scout
  if (st.scoutTotal > 0) {
    lines.push(
      `   🛴 ${st.scoutTotal} s · ${st.scoutVagas} v · ${st.scoutOcupadas}/${st.scoutVagas} · ✅${st.scoutIniciou}`
    );
  }

  // Linha Charger
  if (st.chargerTotal > 0) {
    lines.push(
      `   🔋 ${st.chargerTotal} s · ${st.chargerVagas} v · ${st.chargerOcupadas}/${st.chargerVagas} · ✅${st.chargerIniciou} · ⏳${st.chargerPendente}`
    );
  }

  lines.push('_____________________');

  // Grupos por turno (ordenados por hora)
  const groups = Array.from(st.turnoGroups.values()).sort((a, b) => a.hora.localeCompare(b.hora));
  for (const grp of groups) {
    const tEmoji = turnoEmoji(grp.turno);
    const tLabel = turnoLabel(grp.turno);
    const gTotal = grp.slots.length;
    const gVagas = grp.slots.reduce((a, s) => a + (s.vagas ?? 1), 0);
    const gOcp = grp.slots.reduce((a, s) => a + (s.vagasOcupadas ?? (s.aceitoPor ? 1 : 0)), 0);
    const gIni = grp.slots.filter(s => classifyStatus(s) === 'iniciou').length;
    const fimHora = slotHoraFim(grp.slots[0]);

    lines.push(
      `${tEmoji} ${tLabel} · ${grp.hora} às ${fimHora} · ${gTotal} slots · ${gOcp}/${gVagas} · ✅${gIni}`
    );

    const scouts = grp.slots.filter(s => !isCharger(s));
    const chargers = grp.slots.filter(s => isCharger(s));

    if (scouts.length > 0) {
      lines.push(`   🛴 ${fmtSlotLine(scouts)}`);
    }
    if (chargers.length > 0) {
      lines.push(`   🔋 ${fmtSlotLine(chargers)}`);
    }
  }

  return lines.join('\n');
}

function buildResumoText(cidade: string, hoje: string, amanha: string, hojeSlots: SlotDoc[], amanhaSlots: SlotDoc[]): string {
  const hora = getBrtTimeStr();
  const lines: string[] = [];

  lines.push(`📋 <b>RESUMO DE SLOTS — ${escapeHtml(cidade)} · ${hora}</b>`);
  lines.push('━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  lines.push(buildDaySection(`HOJE — ${fmtDateBR(hoje)}`, '📅', hojeSlots));
  lines.push('');
  lines.push(buildDaySection(`AMANHÃ — ${fmtDateBR(amanha)}`, '📅', amanhaSlots));
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━');
  lines.push(
    '<i>Legenda:\n' +
    '✅ Iniciou · ⏳ Pendente · 🔴 Atrasado\n' +
    '❌ Faltou · ⛔ Desistiu · 🟢 Veio\n' +
    '☀️ T1 (manhã) · 🌆 T2 (tarde) · 🌙 T0 (noite) · ⏰ Custom\n' +
    '🛴 Scout · 🔋 Charger · s = Slot · v = Vaga</i>'
  );

  return lines.join('\n');
}

// ─── Lógica de busca de slots ─────────────────────────────────────────────────

async function getSlotsForDates(dates: string[]): Promise<SlotDoc[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const minDate = sorted[0] + 'T00:00:00';
  const maxDate = sorted[sorted.length - 1] + 'T23:59:59';
  const rows = await supabaseGet<any>('slots', `select=*&turno_inicio=gte.${encodeURIComponent(minDate)}&turno_inicio=lte.${encodeURIComponent(maxDate)}`);
  return (rows ?? []).map((r: any) => ({ ...r, turnoInicio: r.turno_inicio, turnoFim: r.turno_fim } as SlotDoc));
}

// ─── 1. resumoSlotsTelegram ───────────────────────────────────────────────────

export const resumoSlotsTelegram = onSchedule(
  {
    schedule: '0 8,20 * * *',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    memory: '256MiB',
    maxInstances: 10,
  },
  async () => {
    const botToken = await getBotToken();
    if (!botToken) {
      console.warn('[resumoSlotsTelegram] bot_token não configurado');
      return;
    }

    const cidadesRows = await supabaseGet<any>('telegram_config', 'select=*&id=neq.global');
    if (!cidadesRows || cidadesRows.length === 0) {
      console.warn('[resumoSlotsTelegram] telegram_config sem cidades');
      return;
    }

    const cidadesData: Record<string, CidadeConfig> = {};
    for (const r of cidadesRows) cidadesData[r.id ?? r.cidade ?? ''] = r;
    const hoje = getBrtDate(0);
    const amanha = getBrtDate(1);

    const allSlots = await getSlotsForDates([hoje, amanha]);
    const slotsPorCidade = new Map<string, { hoje: SlotDoc[]; amanha: SlotDoc[] }>();

    for (const slot of allSlots) {
      const cidade = slot.cidade ?? 'desconhecida';
      if (!slotsPorCidade.has(cidade)) {
        slotsPorCidade.set(cidade, { hoje: [], amanha: [] });
      }
      const entry = slotsPorCidade.get(cidade)!;
      if (slotDateStr(slot) === hoje) entry.hoje.push(slot);
      else entry.amanha.push(slot);
    }

    for (const [cidadeSlug, cidadeCfg] of Object.entries(cidadesData)) {
      const chatId = cidadeCfg?.grupos?.logistica?.chatId;
      if (!chatId) continue;

      const threadId = cidadeCfg?.grupos?.logistica?.topicos?.resumo_slots;
      const entry = slotsPorCidade.get(cidadeSlug) ?? { hoje: [], amanha: [] };

      const text = buildResumoText(cidadeSlug, hoje, amanha, entry.hoje, entry.amanha);

      await sendTelegram(botToken, chatId, text, threadId);
      console.log(`[resumoSlotsTelegram] Enviado para ${cidadeSlug} (${chatId})`);
    }
  }
);

// ─── 2. confirmarSlotsCascata ─────────────────────────────────────────────────

function parseIsoBRT(turnoInicio: string): Date {
  // turnoInicio: "2026-06-23T07:00:00" — interpreta como BRT (UTC-3), adiciona 3h → UTC
  const [datePart, timePart] = turnoInicio.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = (timePart ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h + 3, min, 0, 0));
}

async function getWorkerTelegramChatId(uid: string): Promise<string | null> {
  const row = await supabaseGetOne<any>('usuarios', `select=telegram_chat_id&id=eq.${encodeURIComponent(uid)}`);
  return row?.telegram_chat_id ?? null;
}

async function processarCascata(slot: SlotDoc, agora: Date, botToken: string): Promise<void> {
  if (!slot.turnoInicio) return;
  if (slot.status !== 'aceito' && slot.status !== 'a_caminho') return;

  const inicio = parseIsoBRT(slot.turnoInicio);
  const minAteInicio = Math.round((inicio.getTime() - agora.getTime()) / 60000);

  // Fora da janela (> 125min ou passou mais de 5min do início)
  if (minAteInicio > 125 || minAteInicio < -5) return;

  const confirmacoes = slot.confirmacoes ?? {};
  const slotFilter = `id=eq.${encodeURIComponent(slot.id)}`;
  const horaFmt = slotHoraInicio(slot);
  const titulo = escapeHtml(slot.titulo ?? `Slot ${horaFmt}`);

  // Buscar telegram_chat_id do worker
  const workerChatId = slot.aceitoPor ? await getWorkerTelegramChatId(slot.aceitoPor) : null;

  const sendDM = async (text: string) => {
    if (workerChatId) await sendTelegram(botToken, workerChatId, text);
    else console.warn(`[cascata] worker ${slot.aceitoPor} sem telegram_chat_id — slot ${slot.id}`);
  };

  // T-120min
  if (minAteInicio <= 122 && minAteInicio >= 118 && !confirmacoes.t120) {
    await sendDM(
      `⏰ Seu slot <b>${titulo}</b> começa em 2h (${horaFmt}). Confirme sua presença no app JET OS.`
    );
    await supabaseUpdate('slots', { 'confirmacoes': { ...confirmacoes, t120: new Date().toISOString() } }, slotFilter);
    console.log(`[cascata] T-120 enviado — slot ${slot.id}`);
    return;
  }

  // T-90min
  if (minAteInicio <= 92 && minAteInicio >= 88 && !confirmacoes.t90) {
    await sendDM(
      `⚠️ Faltam 90min para <b>${titulo}</b> (${horaFmt}). Confirme no app ou o slot será liberado.`
    );
    await supabaseUpdate('slots', { 'confirmacoes': { ...confirmacoes, t90: new Date().toISOString() } }, slotFilter);
    console.log(`[cascata] T-90 enviado — slot ${slot.id}`);
    return;
  }

  // T-60min — último aviso + liberação se não confirmou
  if (minAteInicio <= 62 && minAteInicio >= 58 && !confirmacoes.t60) {
    // Verifica se houve check-in (confirmação real)
    const semConfirmacao = !slot.checkInEm && slot.status === 'aceito';

    if (semConfirmacao) {
      // Libera o slot de volta para 'aberto'
      const now = new Date().toISOString();
      await supabaseUpdate('slots', {
        status: 'aberto',
        aceito_por: null,
        confirmacoes: { ...confirmacoes, t60: now },
        liberado_por_falta_confirmacao: now,
      }, slotFilter);
      await sendDM(
        `❌ Seu slot <b>${titulo}</b> foi liberado por falta de confirmação.`
      );
      console.log(`[cascata] T-60 slot liberado — slot ${slot.id}`);
    } else {
      await sendDM(
        `🔴 ÚLTIMO AVISO! Slot <b>${titulo}</b> começa em 1h (${horaFmt}). Sem confirmação, o slot será liberado para outro prestador.`
      );
      await supabaseUpdate('slots', { confirmacoes: { ...confirmacoes, t60: new Date().toISOString() } }, slotFilter);
      console.log(`[cascata] T-60 aviso enviado — slot ${slot.id}`);
    }
    return;
  }

  // T-0 (slot começando agora)
  if (minAteInicio <= 2 && minAteInicio >= -2 && !confirmacoes.t0) {
    await sendDM(
      `🚀 Hora de iniciar! <b>${titulo}</b> está começando AGORA. Abra o JET OS e faça check-in.`
    );
    await supabaseUpdate('slots', { confirmacoes: { ...confirmacoes, t0: new Date().toISOString() } }, slotFilter);
    console.log(`[cascata] T-0 enviado — slot ${slot.id}`);
  }
}

export const confirmarSlotsCascata = onSchedule(
  {
    schedule: '*/15 * * * *',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    memory: '256MiB',
    maxInstances: 10,
  },
  async () => {
    const botToken = await getBotToken();
    if (!botToken) {
      console.warn('[confirmarSlotsCascata] bot_token não configurado');
      return;
    }

    const agora = new Date();
    const hoje = getBrtDate(0);
    const amanha = getBrtDate(1);

    const slotsRows = await supabaseGet<any>('slots', `select=*&turno_inicio=gte.${encodeURIComponent(hoje+'T00:00:00')}&turno_inicio=lte.${encodeURIComponent(amanha+'T23:59:59')}`);
    const allDocs = (slotsRows ?? []).map((r: any) => ({ ...r, id: r.id, turnoInicio: r.turno_inicio, turnoFim: r.turno_fim } as SlotDoc));
    const filteredSlots = allDocs.filter(s => s.status === 'aceito' || s.status === 'a_caminho');

    if (filteredSlots.length === 0) return;

    console.log(`[confirmarSlotsCascata] Processando ${filteredSlots.length} slots`);

    for (const slot of filteredSlots) {
      try {
        await processarCascata(slot, agora, botToken);
      } catch (e) {
        console.error(`[confirmarSlotsCascata] Erro no slot ${slot.id}:`, e);
      }
    }
  }
);

// ─── 3. enviarResumoManual ────────────────────────────────────────────────────

export const enviarResumoManual = onCall(
  {
    region: 'southamerica-east1',
    memory: '256MiB',
    maxInstances: 10,
  },
  async (request) => {
    const { cidade } = request.data as { cidade: string };
    if (!cidade) throw new Error('cidade é obrigatório');

    const [botToken, cidadesRows] = await Promise.all([
      getBotToken(),
      supabaseGet<any>('telegram_config', 'select=*&id=neq.global'),
    ]);

    if (!botToken) return { ok: false, erro: 'bot_token não configurado' };
    if (!cidadesRows || cidadesRows.length === 0) return { ok: false, erro: 'telegram_config sem cidades' };

    const cidadesData: Record<string, CidadeConfig> = {};
    for (const r of cidadesRows) cidadesData[r.id ?? r.cidade ?? ''] = r;
    const cidadeCfg = cidadesData[cidade] as CidadeConfig | undefined;
    const chatId = cidadeCfg?.grupos?.logistica?.chatId;
    if (!chatId) return { ok: false, erro: `Cidade '${cidade}' sem chatId configurado` };

    const threadId = cidadeCfg?.grupos?.logistica?.topicos?.resumo_slots;
    const hoje = getBrtDate(0);
    const amanha = getBrtDate(1);

    const allSlots = await getSlotsForDates([hoje, amanha]);
    const hojeSlots = allSlots.filter(s => s.cidade === cidade && slotDateStr(s) === hoje);
    const amanhaSlots = allSlots.filter(s => s.cidade === cidade && slotDateStr(s) === amanha);

    const text = buildResumoText(cidade, hoje, amanha, hojeSlots, amanhaSlots);
    await sendTelegram(botToken, chatId, text, threadId);

    console.log(`[enviarResumoManual] Enviado para ${cidade} (${chatId})`);
    return { ok: true, cidade, hojeSlots: hojeSlots.length, amanhaSlots: amanhaSlots.length };
  }
);
