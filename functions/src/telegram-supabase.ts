// functions/src/telegram-supabase.ts
// Onda G — helper para ler telegram_config do Supabase via PostgREST.
// Usado pelos Cloud Functions que precisam de bot_token, chat IDs, e roteamento
// por cidade. Retorna null se Supabase não estiver configurado (fallback p/ Firestore).

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

const HDR = () => ({
  apikey: SUPABASE_SERVICE_ROLE,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
});

/**
 * Lê uma row de telegram_config pelo id (default: 'global').
 * Retorna o objeto completo ou null se não encontrado / Supabase indisponível.
 */
export async function getTelegramConfigSupa(id = 'global'): Promise<Record<string, any> | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/telegram_config?id=eq.${encodeURIComponent(id)}&select=*`,
      { headers: HDR() },
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows?.[0] ?? null;
  } catch { return null; }
}

/**
 * Lê o bot_token da row 'global' de telegram_config.
 */
export async function getTelegramBotTokenSupa(): Promise<string> {
  const cfg = await getTelegramConfigSupa('global');
  return String(cfg?.bot_token || '').trim();
}

/**
 * Lê as cidades configuradas (campo cidades jsonb na row 'global').
 * Retorna um Record<string, CidadeConfig> ou {} se indisponível.
 */
export async function getTelegramCidadesSupa(): Promise<Record<string, any>> {
  const cfg = await getTelegramConfigSupa('global');
  if (!cfg) return {};
  // O campo cidades é jsonb armazenado diretamente na row global
  return (cfg.cidades && typeof cfg.cidades === 'object') ? cfg.cidades : {};
}

/**
 * Lê chat_ids (mapa cidade→chatId) da row 'global'.
 */
export async function getTelegramChatIdsSupa(): Promise<Record<string, string>> {
  const cfg = await getTelegramConfigSupa('global');
  if (!cfg) return {};
  return (cfg.chat_ids && typeof cfg.chat_ids === 'object') ? cfg.chat_ids : {};
}
