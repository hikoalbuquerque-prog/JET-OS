import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const sb = () => createClient(URL, SERVICE);

// ── Timezone helper ─────────────────────────────────────────────
function spNow(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  );
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function tomorrow(): string {
  const d = spNow();
  d.setDate(d.getDate() + 1);
  return fmtDate(d);
}

// ── Telegram helpers ────────────────────────────────────────────
async function getTelegramToken(): Promise<string> {
  const env = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (env) return env;
  const { data } = await sb()
    .from("telegram_config")
    .select("bot_token")
    .eq("id", "global")
    .single();
  if (!data?.bot_token) throw new Error("bot_token not configured");
  return data.bot_token;
}

async function sendTelegramText(
  chatId: string | number,
  text: string,
  threadId?: string | number,
) {
  const token = await getTelegramToken();
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (threadId) body.message_thread_id = Number(threadId);
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return res.json();
}

// ── Slot types ──────────────────────────────────────────────────
interface Slot {
  id: string;
  cidade?: string;
  cargo?: string;
  turno?: string;
  hora_inicio?: string;
  hora_fim?: string;
  status?: string;
  aceito_por?: string;
  data?: string;
  confirmacao_1?: string;
  confirmacao_2?: string;
  liberado_em?: string;
  liberado_por_falta_confirmacao?: boolean;
  telegram_chat_id?: string;
  [k: string]: unknown;
}

interface CidadeConfig {
  id: string;
  cidade?: string;
  chat_id?: string;
  thread_id?: string;
}

// ── Shift classification ────────────────────────────────────────
function classifyShift(horaInicio?: string): string {
  if (!horaInicio) return "T0";
  const h = parseInt(horaInicio.split(":")[0], 10);
  if (h >= 6 && h < 14) return "T0";
  if (h >= 14 && h < 22) return "T1";
  return "T2";
}

// ── Actions ─────────────────────────────────────────────────────

async function resumo(opts?: { cidade?: string; data?: string }) {
  const today = fmtDate(spNow());
  const tmrw = tomorrow();
  const targetDate = opts?.data ?? today;
  const nextDate = opts?.data
    ? (() => {
        const d = new Date(opts.data);
        d.setDate(d.getDate() + 1);
        return fmtDate(d);
      })()
    : tmrw;

  // Fetch today's + tomorrow's slots
  let q = sb()
    .from("slots")
    .select("*")
    .in("data", [targetDate, nextDate]);
  if (opts?.cidade) q = q.eq("cidade", opts.cidade);
  const { data: slots, error } = await q;
  if (error) throw error;
  const allSlots = (slots ?? []) as Slot[];

  // Fetch city Telegram configs
  const { data: cityConfigs } = await sb()
    .from("telegram_config")
    .select("id, cidade, chat_id, thread_id")
    .not("cidade", "is", null);
  const configs = (cityConfigs ?? []) as CidadeConfig[];

  // Group by cidade
  const byCidade: Record<string, { today: Slot[]; tomorrow: Slot[] }> = {};
  for (const s of allSlots) {
    const c = s.cidade ?? "desconhecida";
    if (!byCidade[c]) byCidade[c] = { today: [], tomorrow: [] };
    if (s.data === targetDate) byCidade[c].today.push(s);
    else byCidade[c].tomorrow.push(s);
  }

  let sent = 0;

  for (const [cidade, { today: todaySlots, tomorrow: tmrwSlots }] of Object.entries(byCidade)) {
    // Group by cargo
    const byCargo: Record<string, Record<string, { total: number; aceitos: number }>> = {};
    for (const s of todaySlots) {
      const cargo = s.cargo ?? "outro";
      const shift = classifyShift(s.hora_inicio);
      if (!byCargo[cargo]) byCargo[cargo] = {};
      if (!byCargo[cargo][shift]) byCargo[cargo][shift] = { total: 0, aceitos: 0 };
      byCargo[cargo][shift].total++;
      if (s.status === "aceito" || s.status === "em_andamento") {
        byCargo[cargo][shift].aceitos++;
      }
    }

    const cargoIcons: Record<string, string> = {
      scalt: "🛴",
      charger: "🔋",
    };

    let md = `📊 *Slots ${cidade} — ${targetDate}*\n`;
    for (const [cargo, shifts] of Object.entries(byCargo)) {
      const icon = cargoIcons[cargo] ?? "📋";
      const t0 = shifts["T0"] ?? { total: 0, aceitos: 0 };
      const t1 = shifts["T1"] ?? { total: 0, aceitos: 0 };
      const t2 = shifts["T2"] ?? { total: 0, aceitos: 0 };
      const totalCargo = t0.total + t1.total + t2.total;
      const aceitosCargo = t0.aceitos + t1.aceitos + t2.aceitos;
      md += `${icon} ${cargo}: T0=${t0.total} T1=${t1.total} T2=${t2.total} (aceitos: ${aceitosCargo}/${totalCargo})\n`;
    }

    const openTmrw = tmrwSlots.filter(
      (s) => s.status === "aberto" || s.status === "pendente",
    ).length;
    md += `Amanhã: ${openTmrw} slots abertos\n`;

    // Find the city config
    const cfg = configs.find(
      (c) => c.cidade?.toLowerCase() === cidade.toLowerCase(),
    );
    if (cfg?.chat_id) {
      await sendTelegramText(cfg.chat_id, md, cfg.thread_id);
      sent++;
    }
  }

  return { ok: true, sent };
}

async function confirmarCascata() {
  const now = spNow();
  const today = fmtDate(now);
  const nowMs = now.getTime();

  // Fetch today's accepted slots that haven't been released
  const { data: slots, error } = await sb()
    .from("slots")
    .select("*")
    .eq("data", today)
    .eq("status", "aceito")
    .is("liberado_por_falta_confirmacao", null);
  if (error) throw error;
  const accepted = (slots ?? []) as Slot[];

  let reminded = 0;
  let released = 0;

  for (const slot of accepted) {
    if (!slot.hora_inicio) continue;

    // Parse slot start time
    const [h, m] = slot.hora_inicio.split(":").map(Number);
    const slotStart = new Date(now);
    slotStart.setHours(h, m, 0, 0);
    const slotMs = slotStart.getTime();
    const diffMin = (slotMs - nowMs) / 60000;

    // Worker's Telegram chat (assume telegram_chat_id on slot or lookup)
    const workerChatId = slot.telegram_chat_id;
    if (!workerChatId) continue;

    const cargoLabel = slot.cargo ?? "slot";
    const horaLabel = slot.hora_inicio;

    // T-120min: first reminder
    if (diffMin <= 120 && diffMin > 90 && !slot.confirmacao_1) {
      await sendTelegramText(
        workerChatId,
        `⏰ Confirme presença para ${cargoLabel} às ${horaLabel}. Responda /confirmar`,
      );
      await sb()
        .from("slots")
        .update({ confirmacao_1: new Date().toISOString() })
        .eq("id", slot.id);
      reminded++;
    }

    // T-90min: second reminder
    if (diffMin <= 90 && diffMin > 60 && !slot.confirmacao_2) {
      await sendTelegramText(
        workerChatId,
        `⏰ Segundo aviso: confirme presença para ${cargoLabel} às ${horaLabel}. Sem confirmação, o slot será liberado.`,
      );
      await sb()
        .from("slots")
        .update({ confirmacao_2: new Date().toISOString() })
        .eq("id", slot.id);
      reminded++;
    }

    // T-60min: release if no check-in
    if (diffMin <= 60 && diffMin > 0) {
      // Check if worker has checked in (status would change to em_andamento)
      // Since we filtered status=aceito, they haven't checked in yet
      const hasConfirmation = slot.confirmacao_1 || slot.confirmacao_2;
      if (hasConfirmation && !slot.liberado_em) {
        // Release the slot
        await sb()
          .from("slots")
          .update({
            status: "aberto",
            aceito_por: null,
            liberado_por_falta_confirmacao: true,
            liberado_em: new Date().toISOString(),
          })
          .eq("id", slot.id);

        await sendTelegramText(
          workerChatId,
          `❌ Slot de ${cargoLabel} às ${horaLabel} foi liberado por falta de confirmação.`,
        );
        released++;
      }
    }

    // T-0: deadline message
    if (diffMin <= 0 && diffMin > -5 && !slot.liberado_em) {
      await sendTelegramText(
        workerChatId,
        `🕐 Prazo de confirmação encerrado para ${cargoLabel} às ${horaLabel}.`,
      );
    }
  }

  return { ok: true, reminded, released };
}

async function enviarResumoManual(body: { cidade?: string; data?: string }) {
  return resumo({ cidade: body.cidade, data: body.data });
}

// ── Serve ───────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { action, ...rest } = await req.json();

    switch (action) {
      case "resumo":
        return json(await resumo());
      case "confirmar-cascata":
        return json(await confirmarCascata());
      case "enviar-resumo-manual":
        return json(await enviarResumoManual(rest));
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
