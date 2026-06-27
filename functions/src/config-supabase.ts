// functions/src/config-supabase.ts
// Onda F — helper para ler/gravar app_settings no Supabase via REST
// Usado como camada Supabase-first nos Cloud Functions de config.

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

export async function getAppSetting<T = any>(chave: string): Promise<T | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?chave=eq.${encodeURIComponent(chave)}&select=valor`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` } }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows?.[0]?.valor ?? null;
  } catch { return null; }
}

export async function setAppSetting(chave: string, valor: any): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return false;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?on_conflict=chave`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ chave, valor, atualizado_em: new Date().toISOString() }),
      }
    );
    return resp.ok;
  } catch { return false; }
}
