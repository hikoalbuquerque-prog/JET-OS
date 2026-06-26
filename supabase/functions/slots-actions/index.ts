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

// ── Telegram helper ──────────────────────────────────────────────

async function getTelegramToken(
  sb: ReturnType<typeof createClient>,
): Promise<string> {
  const env = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (env) return env;
  const { data } = await sb
    .from("telegram_config")
    .select("bot_token")
    .eq("id", "global")
    .single();
  if (!data?.bot_token) throw new Error("bot_token not configured");
  return data.bot_token;
}

async function sendTelegram(
  sb: ReturnType<typeof createClient>,
  chatId: string | number,
  text: string,
) {
  const token = await getTelegramToken(sb);
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    },
  );
  return res.json();
}

// ── Actions ──────────────────────────────────────────────────────

async function handleAceitar(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const slotId = body.slotId as string;
  const uid = body.uid as string;
  if (!slotId || !uid) return json({ error: "slotId and uid required" }, 400);

  // Read slot
  const { data: slot, error: slotErr } = await sb
    .from("slots")
    .select("*")
    .eq("id", slotId)
    .single();

  if (slotErr || !slot) return json({ error: "slot not found" }, 404);
  if (slot.status !== "aberto")
    return json({ error: `slot status is '${slot.status}', expected 'aberto'` }, 409);

  // Update slot
  const { data: updated, error: upErr } = await sb
    .from("slots")
    .update({
      status: "aceito",
      aceito_por: uid,
      aceito_em: new Date().toISOString(),
    })
    .eq("id", slotId)
    .select()
    .single();

  if (upErr) return json({ error: upErr.message }, 500);

  // Update user
  await sb
    .from("usuarios")
    .update({ slot_atual_id: slotId })
    .eq("firebase_uid", uid);

  return json({ ok: true, slot: updated });
}

async function handleNotificarOcorrencia(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const tipo = body.tipo as string;
  const local = body.local as string;
  const descricao = body.descricao as string;
  const urgencia = (body.urgencia as string) || "";

  // Read config for group chat IDs
  const { data: cfg } = await sb
    .from("telegram_config")
    .select("*")
    .eq("id", "global")
    .single();

  if (!cfg) return json({ error: "telegram_config not found" }, 500);

  const isAlerta = ["roubo", "tentativa", "procurando"].includes(urgencia);
  const chatIds: string[] = isAlerta
    ? (cfg.alertas_chat_ids ?? [])
    : (cfg.guard_chat_ids ?? []);

  if (chatIds.length === 0)
    return json({ error: "no chat_ids configured for this urgencia" }, 404);

  let text = `🚨 *Ocorrência: ${tipo}*\n📍 ${local}`;
  if (descricao) text += `\n${descricao}`;
  if (urgencia) text += `\nUrgência: *${urgencia}*`;

  let sent = 0;
  for (const cid of chatIds) {
    await sendTelegram(sb, cid, text);
    sent++;
  }

  return json({ ok: true, sent });
}

async function handleNotificarTarefa(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const titulo = body.titulo as string;
  const cargo = body.cargo as string;
  const cidade = body.cidade as string;
  if (!titulo || !cargo || !cidade)
    return json({ error: "titulo, cargo, cidade required" }, 400);

  // Find gestores for cidade with matching cargo
  const { data: gestores } = await sb
    .from("usuarios")
    .select("telegram_chat_id")
    .eq("cidade", cidade)
    .eq("role", cargo)
    .not("telegram_chat_id", "is", null);

  if (!gestores || gestores.length === 0)
    return json({ ok: true, sent: 0 });

  const text = `📋 *Nova tarefa*\n${titulo}\nCidade: ${cidade}`;

  let sent = 0;
  for (const g of gestores) {
    if (g.telegram_chat_id) {
      await sendTelegram(sb, g.telegram_chat_id, text);
      sent++;
    }
  }

  return json({ ok: true, sent });
}

async function handleTestarTelegram(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const chatId = body.chatId as string | number;
  const mensagem = (body.mensagem as string) || "🔔 Teste de notificação Jet OS";
  if (!chatId) return json({ error: "chatId required" }, 400);

  await sendTelegram(sb, chatId, mensagem);
  return json({ ok: true });
}

async function handleRegistrarChatId(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const uid = body.uid as string;
  const chatId = body.chatId as string;
  if (!uid || !chatId) return json({ error: "uid and chatId required" }, 400);

  const { error } = await sb
    .from("usuarios")
    .update({ telegram_chat_id: chatId })
    .eq("firebase_uid", uid);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

// ── Entrypoint ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const sb = createClient(URL, SERVICE);
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "aceitar":
        return await handleAceitar(sb, body);
      case "notificar-ocorrencia":
        return await handleNotificarOcorrencia(sb, body);
      case "notificar-tarefa":
        return await handleNotificarTarefa(sb, body);
      case "testar-telegram":
        return await handleTestarTelegram(sb, body);
      case "registrar-chat-id":
        return await handleRegistrarChatId(sb, body);
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
