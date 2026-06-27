// functions/src/slot-confirmacao.ts
// Cloud Scheduler: confirmação automática de slots com 3 fases:
//   T-120min: lembrete de confirmação
//   T-90min:  reconfirmação (se não confirmou ainda)
//   T-60min:  reabertura da vaga + alerta urgente para equipe
//
// Coleção: slots/{slotId}
// Coleção: slot_aceites/{id} → status: Pendente | Confirmado | Iniciou | Faltou | Desistiu
// Coleção: telegram_config/cidades → {[cidade]: {grupos: {logistica: {chatId, topicos}}}}
// Coleção: config_logistica/{cidade} → confirmacaoMin, reaberturaSemConfMin

import * as functions from 'firebase-functions/v2';
import { supabaseGet, supabaseGetOne, supabaseUpdate, supabaseInsert } from './lib/supabase-rest';
import { getAppSetting } from './config-supabase';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Slot {
  id: string; turno: string; horaIni: string; horaFim: string;
  zona: string; tipo: string; qtdPessoas: number; dataSlot: string;
  cidade: string; confirmacaoMin?: number; reaberturaSemConfMin?: number;
  status?: string;
}

interface SlotAceite {
  id: string; slotId: string; nome: string; cnpj: string; status: string;
  telegramChatId?: string; aceitoEm?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHoraBR(dataSlot: string, horaIni: string): Date {
  // dataSlot: "05/06/2026" | horaIni: "15:00"
  const [d, m, y] = dataSlot.split('/').map(Number);
  const [h, min]  = horaIni.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

async function enviarTelegram(
  token: string, chatId: string, mensagem: string, threadId?: number
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: mensagem,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
  if (threadId) body.message_thread_id = threadId;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[Telegram] Erro:', err);
    }
  } catch (e) {
    console.warn('[Telegram] Falha de rede:', e);
  }
}

async function getTelegramConfig(cidade: string): Promise<{
  token: string; chatId: string; threadId?: number;
} | null> {
  // Supabase-first: telegram_config
  try {
    const sbGlobal = await supabaseGetOne<any>('telegram_config', 'select=*&id=eq.global');
    if (sbGlobal?.bot_token) {
      const token = String(sbGlobal.bot_token).trim();
      // Try city-specific config
      const cidades = sbGlobal.cidades ?? {};
      const cidadeCfg = cidades[cidade]?.grupos?.logistica;
      if (cidadeCfg?.chatId) {
        const threadId = cidadeCfg.topicos?.alertas || cidadeCfg.topicos?.charger;
        return { token, chatId: cidadeCfg.chatId, threadId: threadId ? Number(threadId) : undefined };
      }
      // Try config_logistica from app_settings
      const cfgLog = await getAppSetting<any>('config_logistica_' + cidade);
      if (cfgLog?.telegramChatId) {
        return { token, chatId: cfgLog.telegramChatId, threadId: cfgLog.telegramThreadId ? Number(cfgLog.telegramThreadId) : undefined };
      }
    }
  } catch { /* ignore */ }

  return null;
}

// ─── Função principal: roda a cada 5 minutos ──────────────────────────────────

export const verificarConfirmacoesSlots = functions.scheduler.onSchedule(
  { schedule: 'every 5 minutes', region: 'southamerica-east1', timeoutSeconds: 120, maxInstances: 10 },
  async () => {
    const agora = new Date();
    const hoje  = agora.toLocaleDateString('pt-BR');
    const amanha = new Date(agora.getTime() + 86400000).toLocaleDateString('pt-BR');

    // Supabase-first: slots
    let slots: Slot[] = [];
    try {
      const sbSlots = await supabaseGet<any>('slots', `select=*&data_slot=in.(${encodeURIComponent(hoje)},${encodeURIComponent(amanha)})`);
      if (sbSlots && sbSlots.length > 0) {
        slots = sbSlots.map(r => ({
          id: r.id,
          turno: r.turno, horaIni: r.hora_ini, horaFim: r.hora_fim,
          zona: r.zona, tipo: r.tipo, qtdPessoas: r.qtd_pessoas, dataSlot: r.data_slot,
          cidade: r.cidade, confirmacaoMin: r.confirmacao_min, reaberturaSemConfMin: r.reabertura_sem_conf_min,
          status: r.status,
        }));
      }
    } catch { /* fallback */ }

    if (slots.length === 0) return;

    for (const slot of slots) {
      try {
        await processarSlot(slot, agora);
      } catch (e) {
        console.error(`[slot-conf] Erro no slot ${slot.id}:`, e);
      }
    }
  }
);

async function processarSlot(slot: Slot, agora: Date): Promise<void> {
  const inicioSlot = parseHoraBR(slot.dataSlot, slot.horaIni);
  const msAteInicio = inicioSlot.getTime() - agora.getTime();
  const minAteInicio = Math.floor(msAteInicio / 60000);

  // Fora da janela de interesse (> 125min ou já passou)
  if (minAteInicio > 125 || minAteInicio < -5) return;

  const confMin    = slot.confirmacaoMin     ?? 120;
  const reabrMin   = slot.reaberturaSemConfMin ?? 90;
  const urgMin     = Math.floor(reabrMin / 1.5); // ~60min

  // Supabase-first: slot_aceites
  let aceites: SlotAceite[] = [];
  try {
    const sbAceites = await supabaseGet<any>('slot_aceites', `select=*&slot_id=eq.${encodeURIComponent(slot.id)}&status=in.(Pendente,Confirmado)`);
    if (sbAceites && sbAceites.length > 0) {
      aceites = sbAceites.map(r => ({
        id: r.id, slotId: r.slot_id, nome: r.nome, cnpj: r.cnpj, status: r.status,
        telegramChatId: r.telegram_chat_id, aceitoEm: r.aceito_em,
      }));
    }
  } catch { /* fallback */ }

  if (aceites.length === 0) return;
  const pendentes = aceites.filter(a => a.status === 'Pendente');
  const tgCfg = await getTelegramConfig(slot.cidade || 'SP');

  // ── FASE 1: T-120min — primeiro lembrete ────────────────────────────────────
  if (isInWindow(minAteInicio, confMin, 5)) {
    for (const aceite of pendentes) {
      await enviarLembrete(aceite, slot, minAteInicio, 'confirmacao', tgCfg);
      // Marcar que o primeiro lembrete foi enviado
      await supabaseUpdate('slot_aceites', {
        lembrete_enviado_em: new Date().toISOString(),
        fase: 1,
      }, `id=eq.${encodeURIComponent(aceite.id)}`);
    }
    console.log(`[slot-conf] Fase 1 — slot ${slot.id}: ${pendentes.length} lembretes`);
  }

  // ── FASE 2: T-90min — reconfirmação ────────────────────────────────────────
  if (isInWindow(minAteInicio, reabrMin, 5)) {
    const ainda_pendentes = pendentes.filter(a => (a as any).fase !== 2);
    for (const aceite of ainda_pendentes) {
      await enviarLembrete(aceite, slot, minAteInicio, 'reconfirmacao', tgCfg);
      await supabaseUpdate('slot_aceites', { fase: 2 }, `id=eq.${encodeURIComponent(aceite.id)}`);
    }
    console.log(`[slot-conf] Fase 2 — slot ${slot.id}: ${ainda_pendentes.length} reconfirmações`);
  }

  // ── FASE 3: T-60min — reabertura urgente ───────────────────────────────────
  if (isInWindow(minAteInicio, urgMin, 5)) {
    const nao_confirmaram = pendentes;
    if (nao_confirmaram.length > 0) {
      // Reabre as vagas (marca como disponível novamente)
      const agora = new Date().toISOString();
      for (const aceite of nao_confirmaram) {
        await supabaseUpdate('slot_aceites', {
          status: 'Desistiu',
          motivo_desistencia: 'Sem confirmação antes do turno',
          desistiu_em: agora,
        }, `id=eq.${encodeURIComponent(aceite.id)}`);
      }

      // Reagenda o slot como aberto novamente (incrementa vagas)
      const vagasReabertas = nao_confirmaram.length;
      // RPC increment not available via REST — read current value and set
      const currentSlot = await supabaseGetOne<any>('slots', `select=vagas_reabertas&id=eq.${encodeURIComponent(slot.id)}`);
      const currentVagas = (currentSlot?.vagas_reabertas ?? 0) + vagasReabertas;
      await supabaseUpdate('slots', {
        vagas_reabertas: currentVagas,
        ultima_reabertura: agora,
      }, `id=eq.${encodeURIComponent(slot.id)}`);

      // Alerta urgente para equipe do mesmo cargo na cidade
      if (tgCfg) {
        const msgUrgente = buildMsgUrgente(slot, nao_confirmaram, vagasReabertas);
        await enviarTelegram(tgCfg.token, tgCfg.chatId, msgUrgente, tgCfg.threadId);
      }

      // Log para auditoria — Supabase-only
      await supabaseInsert('slot_alertas', {
        slot_id: slot.id,
        cidade: slot.cidade,
        tipo: 'reabertura_sem_confirmacao',
        vagas_reabertas: vagasReabertas,
        aceite_ids: nao_confirmaram.map(a => a.id),
        criado_em: agora,
      });

      console.log(`[slot-conf] Fase 3 — slot ${slot.id}: ${vagasReabertas} vagas reabertas`);
    }
  }
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function isInWindow(minAteInicio: number, alvo: number, tolerancia: number): boolean {
  return minAteInicio >= (alvo - tolerancia) && minAteInicio <= (alvo + tolerancia);
}

async function enviarLembrete(
  aceite: SlotAceite,
  slot: Slot,
  minRestantes: number,
  fase: 'confirmacao' | 'reconfirmacao',
  tgCfg: { token: string; chatId: string; threadId?: number } | null,
): Promise<void> {
  const isReconf = fase === 'reconfirmacao';
  const emoji    = isReconf ? '⚠️' : '⏰';
  const titulo   = isReconf ? 'RECONFIRMAÇÃO NECESSÁRIA' : 'Confirmação de Slot';

  const msg = [
    `${emoji} *${titulo}*`,
    '',
    `Olá, *${aceite.nome}*!`,
    '',
    `Você tem um slot em *${minRestantes} minutos*:`,
    `📅 ${slot.dataSlot} às ${slot.horaIni}–${slot.horaFim}`,
    `📍 Zona: ${slot.zona}`,
    `💼 Cargo: ${slot.tipo}`,
    `🏙 Cidade: ${slot.cidade}`,
    '',
    isReconf
      ? `⚠️ Você *ainda não confirmou* presença. Se não confirmar em breve, a vaga será reaberta para outros.`
      : `✅ Responda esta mensagem para *confirmar* sua presença.`,
    `❌ Caso não possa comparecer, avise com antecedência.`,
    '',
    `_Caso já tenha confirmado, ignore esta mensagem._`,
  ].join('\n');

  // Enviar via Telegram do grupo da cidade
  if (tgCfg) {
    await enviarTelegram(tgCfg.token, tgCfg.chatId, msg, tgCfg.threadId);
  }

  // Salvar log do lembrete — Supabase-only
  await supabaseInsert('slot_lembretes', {
    slot_id: slot.id,
    aceite_id: aceite.id,
    nome: aceite.nome,
    cnpj: aceite.cnpj,
    fase: isReconf ? 2 : 1,
    min_restantes: minRestantes,
    enviado_em: new Date().toISOString(),
    cidade: slot.cidade,
  });
}

function buildMsgUrgente(slot: Slot, naoConfirmaram: SlotAceite[], vagas: number): string {
  const nomes = naoConfirmaram.map(a => `• ${a.nome}`).join('\n');
  return [
    `🚨 *VAGA ABERTA — URGENTE*`,
    ``,
    `Slot de *${slot.tipo}* — ${slot.horaIni} às ${slot.horaFim}`,
    `📍 Zona: ${slot.zona} · ${slot.cidade}`,
    `📅 Hoje — ${slot.dataSlot}`,
    ``,
    `*${vagas} vaga(s) liberada(s)* por falta de confirmação:`,
    nomes,
    ``,
    `👆 Responda esta mensagem para aceitar a vaga imediatamente!`,
    ``,
    `⚡ _Restam ~60 min para o início do turno_`,
  ].join('\n');
}

// ─── Callable para gestores enviarem confirmações manualmente ─────────────────

export const enviarConfirmacoesManual = functions.https.onCall(
  { region: 'southamerica-east1', maxInstances: 10 },
  async (request) => {
    const { slotId, cidade } = request.data as { slotId: string; cidade: string };

    // Supabase-first: slot + aceites
    let slot: Slot | null = null;
    let aceites: SlotAceite[] = [];

    try {
      const sbSlot = await supabaseGetOne<any>('slots', `select=*&id=eq.${encodeURIComponent(slotId)}`);
      if (sbSlot) {
        slot = {
          id: sbSlot.id, turno: sbSlot.turno, horaIni: sbSlot.hora_ini, horaFim: sbSlot.hora_fim,
          zona: sbSlot.zona, tipo: sbSlot.tipo, qtdPessoas: sbSlot.qtd_pessoas, dataSlot: sbSlot.data_slot,
          cidade: sbSlot.cidade, confirmacaoMin: sbSlot.confirmacao_min, reaberturaSemConfMin: sbSlot.reabertura_sem_conf_min,
          status: sbSlot.status,
        };
      }
      const sbAceites = await supabaseGet<any>('slot_aceites', `select=*&slot_id=eq.${encodeURIComponent(slotId)}&status=eq.Pendente`);
      if (sbAceites && sbAceites.length > 0) {
        aceites = sbAceites.map(r => ({
          id: r.id, slotId: r.slot_id, nome: r.nome, cnpj: r.cnpj, status: r.status,
          telegramChatId: r.telegram_chat_id, aceitoEm: r.aceito_em,
        }));
      }
    } catch { /* fallback */ }

    if (!slot) {
      return { ok: false, erro: 'Slot não encontrado' };
    }
    const tgCfg = await getTelegramConfig(cidade || slot.cidade || 'SP');

    let enviados = 0;
    for (const aceite of aceites) {
      await enviarLembrete(aceite, slot, 999, 'confirmacao', tgCfg);
      enviados++;
    }

    return { ok: true, enviados };
  }
);
