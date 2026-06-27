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

async function getChatId(
  sb: ReturnType<typeof createClient>,
  uid: string,
): Promise<string | null> {
  const { data } = await sb
    .from("usuarios")
    .select("telegram_chat_id")
    .eq("firebase_uid", uid)
    .single();
  return data?.telegram_chat_id ?? null;
}

// ── Actions ──────────────────────────────────────────────────────

async function handleWebhook(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const message = body.message as Record<string, unknown> | undefined;
  if (!message?.text) return json({ ok: true });

  const text = message.text as string;
  const chatId = (message.chat as Record<string, unknown>).id as number;

  // /start [token]
  if (text.startsWith("/start")) {
    const token = text.split(" ")[1]?.trim();
    if (!token) {
      await sendTelegram(sb, chatId, "Envie /start com o token recebido no app.");
      return json({ ok: true });
    }

    const { data: vinculo } = await sb
      .from("telegram_vinculos")
      .select("*")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .eq("used", false)
      .single();

    if (!vinculo) {
      await sendTelegram(sb, chatId, "Token inválido ou expirado.");
      return json({ ok: true });
    }

    // Mark used and save chat_id on vinculo
    await sb
      .from("telegram_vinculos")
      .update({ used: true, chat_id: String(chatId) })
      .eq("id", vinculo.id);

    // Update user
    await sb
      .from("usuarios")
      .update({ telegram_chat_id: String(chatId) })
      .eq("firebase_uid", vinculo.uid);

    await sendTelegram(sb, chatId, "✅ Vinculado!");
    return json({ ok: true });
  }

  // /status
  if (text.startsWith("/status")) {
    const { data: user } = await sb
      .from("usuarios")
      .select("nome, role, email")
      .eq("telegram_chat_id", String(chatId))
      .single();

    if (!user) {
      await sendTelegram(sb, chatId, "Nenhuma conta vinculada. Use /start <token>.");
    } else {
      await sendTelegram(
        sb,
        chatId,
        `*Conta vinculada*\nNome: ${user.nome}\nCargo: ${user.role}\nEmail: ${user.email}`,
      );
    }
    return json({ ok: true });
  }

  // /desvincular
  if (text.startsWith("/desvincular")) {
    await sb
      .from("usuarios")
      .update({ telegram_chat_id: null })
      .eq("telegram_chat_id", String(chatId));

    await sendTelegram(sb, chatId, "Conta desvinculada.");
    return json({ ok: true });
  }

  return json({ ok: true });
}

async function handleIniciar(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const uid = body.uid as string;
  if (!uid) return json({ error: "uid required" }, 400);

  // Generate 32-char hex token
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const token = Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sb
    .from("telegram_vinculos")
    .insert({ uid, token, expires_at: expiresAt, used: false });

  // Get bot username
  const { data: cfg } = await sb
    .from("telegram_config")
    .select("bot_username")
    .eq("id", "global")
    .single();

  const botUsername = cfg?.bot_username ?? "JetOSBot";

  return json({ link: `https://t.me/${botUsername}?start=${token}` });
}

async function handleValidar(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const uid = body.uid as string;
  const codigo = body.codigo as string;
  if (!uid || !codigo) return json({ error: "uid and codigo required" }, 400);

  const { data: vinculo } = await sb
    .from("telegram_vinculos")
    .select("*")
    .eq("uid", uid)
    .eq("codigo", codigo)
    .gt("expires_at", new Date().toISOString())
    .eq("used", false)
    .single();

  if (!vinculo) return json({ error: "codigo_invalido" }, 404);

  await sb
    .from("telegram_vinculos")
    .update({ used: true })
    .eq("id", vinculo.id);

  await sb
    .from("usuarios")
    .update({ telegram_chat_id: vinculo.chat_id })
    .eq("firebase_uid", uid);

  return json({ ok: true, chatId: vinculo.chat_id });
}

async function handleNotificarAprovacao(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const uid = body.uid as string;
  const nome = body.nome as string;
  const role = body.role as string;
  if (!uid) return json({ error: "uid required" }, 400);

  const chatId = await getChatId(sb, uid);
  if (!chatId) return json({ error: "user has no telegram_chat_id" }, 404);

  await sendTelegram(
    sb,
    chatId,
    `✅ Sua solicitação foi aprovada! Cargo: *${role}*`,
  );
  return json({ ok: true });
}

async function handleNotificarStatusNf(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const uid = body.uid as string;
  const nfNumero = body.nfNumero as string;
  const status = body.status as string;
  const mensagem = (body.mensagem as string) || "";
  if (!uid) return json({ error: "uid required" }, 400);

  const chatId = await getChatId(sb, uid);
  if (!chatId) return json({ error: "user has no telegram_chat_id" }, 404);

  let text = `*NF-e ${nfNumero}*\nStatus: ${status}`;
  if (mensagem) text += `\n${mensagem}`;

  await sendTelegram(sb, chatId, text);
  return json({ ok: true });
}

async function handleNotificarTarefa(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const uid = body.uid as string;
  const titulo = body.titulo as string;
  const descricao = (body.descricao as string) || "";
  if (!uid) return json({ error: "uid required" }, 400);

  const chatId = await getChatId(sb, uid);
  if (!chatId) return json({ error: "user has no telegram_chat_id" }, 404);

  let text = `📋 Nova tarefa: *${titulo}*`;
  if (descricao) text += `\n${descricao}`;

  await sendTelegram(sb, chatId, text);
  return json({ ok: true });
}

// ── Entrypoint ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const sb = createClient(URL, SERVICE);
    const body = await req.json();
    const action = body.action as string;

    // Telegram webhook sends {update_id, message, ...} without action field
    if (!action && (body.update_id != null || body.message)) {
      return await handleWebhook(sb, body);
    }

    switch (action) {
      case "webhook":
        return await handleWebhook(sb, body);
      case "iniciar":
        return await handleIniciar(sb, body);
      case "validar":
        return await handleValidar(sb, body);
      case "notificar-aprovacao":
        return await handleNotificarAprovacao(sb, body);
      case "notificar-status-nf":
        return await handleNotificarStatusNf(sb, body);
      case "notificar-tarefa":
        return await handleNotificarTarefa(sb, body);
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
