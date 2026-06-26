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

async function getBotToken(
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  const envToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (envToken) return envToken;

  const { data } = await supabase
    .from("telegram_config")
    .select("bot_token, config")
    .eq("id", "global")
    .single();

  if (data?.bot_token) return data.bot_token;
  if (data?.config?.bot_token) return data.config.bot_token;

  throw new Error("Bot token not found");
}

async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { solicitacaoId, nome, cargo, cidade, email } = await req.json();
    if (!nome || !cargo)
      return json({ error: "nome e cargo obrigatorios" }, 400);

    const supabase = createClient(URL, SERVICE);
    const token = await getBotToken(supabase);

    const { data: usuarios } = await supabase
      .from("usuarios")
      .select("telegram_chat_id, nome")
      .in("role", ["admin", "gestor", "supergestor", "gestor_log"])
      .not("telegram_chat_id", "is", null);

    const chatIds: string[] = [];

    // Collect chat_ids from telegram_config table
    const { data: tgConfig } = await supabase
      .from("telegram_config")
      .select("chat_ids, config")
      .eq("id", "global")
      .single();

    if (tgConfig?.chat_ids && Array.isArray(tgConfig.chat_ids)) {
      chatIds.push(...tgConfig.chat_ids);
    }
    if (tgConfig?.config?.chat_ids && Array.isArray(tgConfig.config.chat_ids)) {
      chatIds.push(...tgConfig.config.chat_ids);
    }

    // Collect from usuarios
    if (usuarios) {
      for (const u of usuarios) {
        if (u.telegram_chat_id && !chatIds.includes(u.telegram_chat_id)) {
          chatIds.push(u.telegram_chat_id);
        }
      }
    }

    const message = `📋 Nova solicitação de ${nome} (${cargo}) — ${cidade || "N/A"}\n📧 ${email || "N/A"}`;

    let sent = 0;
    for (const chatId of chatIds) {
      const ok = await sendTelegram(token, chatId, message);
      if (ok) sent++;
    }

    return json({ ok: true, sent });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
