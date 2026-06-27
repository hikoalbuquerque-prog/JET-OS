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
  threadId?: string | number | null,
) {
  const token = await getTelegramToken(sb);
  const payload: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "Markdown",
  };
  if (threadId) payload.message_thread_id = Number(threadId);
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return res.json();
}

async function sendTelegramPhoto(
  sb: ReturnType<typeof createClient>,
  chatId: string | number,
  photoUrl: string,
  caption: string,
  threadId?: string | number | null,
) {
  const token = await getTelegramToken(sb);
  const payload: Record<string, unknown> = {
    chat_id: chatId, photo: photoUrl, caption,
    parse_mode: "Markdown",
  };
  if (threadId) payload.message_thread_id = Number(threadId);
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendPhoto`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  const ocorrenciaId = (body.ocorrenciaId || body.id) as string;
  const statusAtualizado = body.statusAtualizado as string | undefined;

  if (!ocorrenciaId) return json({ error: "ocorrenciaId required" }, 400);

  const { data: oc, error: ocErr } = await sb
    .from("ocorrencias")
    .select("*")
    .eq("id", ocorrenciaId)
    .single();

  if (ocErr || !oc) return json({ error: "ocorrencia not found" }, 404);

  const { data: cfg } = await sb
    .from("telegram_config")
    .select("bot_token, guard_chat_id, guard_thread_id")
    .eq("id", "global")
    .single();

  if (!cfg?.guard_chat_id) return json({ error: "guard_chat_id not configured" }, 500);

  const tipoLabel: Record<string, string> = {
    Roubo: "🚨 ROUBO", Tentativa: "🟠 Tentativa de roubo",
    Vandalismo: "🟡 Vandalismo", Recuperacao: "🟢 Recuperação",
    Perda: "🟣 Perda", Outro: "📝 Ocorrência",
  };

  const statusFinal = statusAtualizado || oc.status;
  const isRecuperado = statusFinal === "Recuperado" && !!statusAtualizado;
  const urgente = ["Roubo", "Tentativa"].includes(oc.tipo) || !!oc.procurando || isRecuperado;
  const tipoEmoji = tipoLabel[oc.tipo] ?? "📝 Ocorrência";
  const assetInfo = [oc.asset_id, oc.ativo_tipo].filter(Boolean).join(" · ");

  const turnoLabel: Record<string, string> = {
    T0: "Madrugada (00–06h)", T1: "Manhã (06–14h)", T2: "Tarde (14–22h)", T3: "Noite (22–00h)",
  };

  const localParts = [oc.cidade || "—"];
  if (oc.bairro) localParts[0] += ` / ${oc.bairro}`;
  if (oc.endereco) localParts.push(`📍 ${oc.endereco}`);

  const texto = [
    isRecuperado ? "✅ *RECUPERADO*" : urgente ? "🚨 *ALERTA URGENTE*" : "",
    tipoEmoji,
    "",
    `👤 *${oc.registrado_por_nome || "Guard"}*${oc.turno ? " · " + (turnoLabel[oc.turno] || oc.turno) : ""}`,
    `🏙 ${localParts[0]}`,
    localParts[1] || "",
    assetInfo ? `🛴 ${assetInfo}` : "",
    oc.procurando && oc.procurando !== "false"
      ? `\n🔍 *PROCURANDO:* ${typeof oc.procurando === "string" ? oc.procurando : "Em aberto"}`
      : "",
    oc.bo_numero ? `📋 BO: ${oc.bo_numero}` : "",
    "",
    oc.descricao ? `_${String(oc.descricao).slice(0, 300)}_` : "",
    "",
    `🕐 ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    `🆔 ${ocorrenciaId}`,
  ].filter((l) => l !== "").join("\n");

  const threadId = cfg.guard_thread_id;

  if (oc.foto1_url) {
    await sendTelegramPhoto(sb, cfg.guard_chat_id, oc.foto1_url, texto, threadId);
  } else {
    await sendTelegram(sb, cfg.guard_chat_id, texto, threadId);
  }

  await sb.from("ocorrencias").update({ telegram_enviado: true }).eq("id", ocorrenciaId);

  return json({ ok: true, sent: 1, urgente });
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
