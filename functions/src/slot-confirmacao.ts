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
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Slot {
  id: string; turno: string; horaIni: string; horaFim: string;
  zona: string; tipo: string; qtdPessoas: number; dataSlot: string;
  cidade: string; confirmacaoMin?: number; reaberturaSemConfMin?: number;
  status?: string;
}

interface SlotAceite {
  id: string; slotId: string; nome: string; cnpj: string; status: string;
  telegramChatId?: string; aceitoEm?: admin.firestore.Timestamp;
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
  const globalDoc = await db.doc('telegram_config/global').get();
  const token: string = globalDoc.exists ? globalDoc.data()?.botToken || '' : '';
  if (!token) return null;

  // Tenta config por cidade primeiro, depois global
  const cidadesDoc = await db.doc('telegram_config/cidades').get();
  if (cidadesDoc.exists) {
    const data = cidadesDoc.data() || {};
    const cfg = data[cidade]?.grupos?.logistica;
    if (cfg?.chatId) {
      const threadId = cfg.topicos?.alertas || cfg.topicos?.charger;
      return { token, chatId: cfg.chatId, threadId: threadId ? Number(threadId) : undefined };
    }
  }

  // Fallback: config_logistica/{cidade}
  const cfgDoc = await db.doc(`config_logistica/${cidade}`).get();
  if (cfgDoc.exists) {
    const cfg = cfgDoc.data();
    if (cfg?.telegramChatId) {
      return {
        token,
        chatId: cfg.telegramChatId,
        threadId: cfg.telegramThreadId ? Number(cfg.telegramThreadId) : undefined,
      };
    }
  }

  return null;
}

// ─── Função principal: roda a cada 5 minutos ──────────────────────────────────

export const verificarConfirmacoesSlots = functions.scheduler.onSchedule(
  { schedule: 'every 5 minutes', region: 'southamerica-east1', timeoutSeconds: 120, maxInstances: 10 },
  async () => {
    const agora = new Date();
    const hoje  = agora.toLocaleDateString('pt-BR');
    const amanha = new Date(agora.getTime() + 86400000).toLocaleDateString('pt-BR');

    // Buscar slots de hoje e amanhã que estão abertos
    const slotsSnap = await db.collection('slots')
      .where('dataSlot', 'in', [hoje, amanha])
      .get();

    if (slotsSnap.empty) return;

    const slots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Slot));

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

  // Buscar aceites pendentes deste slot
  const aceitesSnap = await db.collection('slot_aceites')
    .where('slotId', '==', slot.id)
    .where('status', 'in', ['Pendente', 'Confirmado'])
    .get();

  if (aceitesSnap.empty) return;

  const aceites = aceitesSnap.docs.map(d => ({ id: d.id, ...d.data() } as SlotAceite));
  const pendentes = aceites.filter(a => a.status === 'Pendente');
  const tgCfg = await getTelegramConfig(slot.cidade || 'SP');

  // ── FASE 1: T-120min — primeiro lembrete ────────────────────────────────────
  if (isInWindow(minAteInicio, confMin, 5)) {
    for (const aceite of pendentes) {
      await enviarLembrete(aceite, slot, minAteInicio, 'confirmacao', tgCfg);
      // Marcar que o primeiro lembrete foi enviado
      await db.doc(`slot_aceites/${aceite.id}`).update({
        lembreteEnviadoEm: admin.firestore.FieldValue.serverTimestamp(),
        fase: 1,
      });
    }
    console.log(`[slot-conf] Fase 1 — slot ${slot.id}: ${pendentes.length} lembretes`);
  }

  // ── FASE 2: T-90min — reconfirmação ────────────────────────────────────────
  if (isInWindow(minAteInicio, reabrMin, 5)) {
    const ainda_pendentes = pendentes.filter(a => (a as any).fase !== 2);
    for (const aceite of ainda_pendentes) {
      await enviarLembrete(aceite, slot, minAteInicio, 'reconfirmacao', tgCfg);
      await db.doc(`slot_aceites/${aceite.id}`).update({ fase: 2 });
    }
    console.log(`[slot-conf] Fase 2 — slot ${slot.id}: ${ainda_pendentes.length} reconfirmações`);
  }

  // ── FASE 3: T-60min — reabertura urgente ───────────────────────────────────
  if (isInWindow(minAteInicio, urgMin, 5)) {
    const nao_confirmaram = pendentes;
    if (nao_confirmaram.length > 0) {
      // Reabre as vagas (marca como disponível novamente)
      for (const aceite of nao_confirmaram) {
        await db.doc(`slot_aceites/${aceite.id}`).update({
          status: 'Desistiu',
          motivoDesistencia: 'Sem confirmação antes do turno',
          desistiuEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Reagenda o slot como aberto novamente (incrementa vagas)
      const vagasReabertas = nao_confirmaram.length;
      await db.doc(`slots/${slot.id}`).update({
        vagasReabertas: admin.firestore.FieldValue.increment(vagasReabertas),
        ultimaReabertura: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Alerta urgente para equipe do mesmo cargo na cidade
      if (tgCfg) {
        const msgUrgente = buildMsgUrgente(slot, nao_confirmaram, vagasReabertas);
        await enviarTelegram(tgCfg.token, tgCfg.chatId, msgUrgente, tgCfg.threadId);
      }

      // Log no Firestore para auditoria
      await db.collection('slot_alertas').add({
        slotId: slot.id,
        cidade: slot.cidade,
        tipo: 'reabertura_sem_confirmacao',
        vagasReabertas,
        aceiteIds: nao_confirmaram.map(a => a.id),
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
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

  // Salvar log do lembrete
  await db.collection('slot_lembretes').add({
    slotId: slot.id,
    aceiteId: aceite.id,
    nome: aceite.nome,
    cnpj: aceite.cnpj,
    fase: isReconf ? 2 : 1,
    minRestantes,
    enviadoEm: admin.firestore.FieldValue.serverTimestamp(),
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

    const [slotDoc, aceitesSnap] = await Promise.all([
      db.doc(`slots/${slotId}`).get(),
      db.collection('slot_aceites').where('slotId', '==', slotId).where('status', '==', 'Pendente').get(),
    ]);

    if (!slotDoc.exists) return { ok: false, erro: 'Slot não encontrado' };

    const slot = { id: slotId, ...slotDoc.data() } as Slot;
    const aceites = aceitesSnap.docs.map(d => ({ id: d.id, ...d.data() } as SlotAceite));
    const tgCfg = await getTelegramConfig(cidade || slot.cidade || 'SP');

    let enviados = 0;
    for (const aceite of aceites) {
      await enviarLembrete(aceite, slot, 999, 'confirmacao', tgCfg);
      enviados++;
    }

    return { ok: true, enviados };
  }
);
