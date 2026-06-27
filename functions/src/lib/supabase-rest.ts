// functions/src/lib/supabase-rest.ts
// Onda G — helpers PostgREST genéricos para migrar reads de Firestore → Supabase.
// Usado por Cloud Functions que precisam ler tabelas Supabase com fallback.

const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE ?? '';

function headers() {
  const key = SB_KEY();
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * GET genérico PostgREST. Retorna array de rows ou null se falhar.
 * @param table   Nome da tabela (ex: 'ocorrencias')
 * @param query   Query string PostgREST sem '?' (ex: 'select=*&tipo=eq.Roubo')
 * @param extraHeaders  Headers extras (ex: Range para paginação)
 */
export async function supabaseGet<T = any>(
  table: string,
  query = 'select=*',
  extraHeaders: Record<string, string> = {},
): Promise<T[] | null> {
  const url = SB_URL();
  const key = SB_KEY();
  if (!url || !key) return null;
  try {
    const resp = await fetch(
      `${url}/rest/v1/${table}?${query}`,
      { headers: { ...headers(), ...extraHeaders } },
    );
    if (!resp.ok) return null;
    return (await resp.json()) as T[];
  } catch {
    return null;
  }
}

/**
 * GET que retorna um único objeto (primeira row) ou null.
 */
export async function supabaseGetOne<T = any>(
  table: string,
  query = 'select=*&limit=1',
): Promise<T | null> {
  const rows = await supabaseGet<T>(table, query);
  return rows?.[0] ?? null;
}

/**
 * POST (upsert) genérico. Retorna true se OK, false se falhar.
 */
export async function supabaseUpsert(
  table: string,
  data: Record<string, any>,
  onConflict = '',
): Promise<boolean> {
  const url = SB_URL();
  const key = SB_KEY();
  if (!url || !key) return false;
  try {
    const conflict = onConflict ? `?on_conflict=${onConflict}` : '';
    const resp = await fetch(`${url}/rest/v1/${table}${conflict}`, {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(data),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * POST insert (sem upsert). Retorna true se OK.
 */
export async function supabaseInsert(
  table: string,
  data: Record<string, any> | Record<string, any>[],
): Promise<boolean> {
  const url = SB_URL();
  const key = SB_KEY();
  if (!url || !key) return false;
  try {
    const resp = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Verifica se Supabase está configurado (env vars presentes).
 */
export function supabaseConfigured(): boolean {
  return !!(SB_URL() && SB_KEY());
}
