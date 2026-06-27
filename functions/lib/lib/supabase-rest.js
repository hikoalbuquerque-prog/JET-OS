"use strict";
// functions/src/lib/supabase-rest.ts
// Onda G — helpers PostgREST genéricos para migrar reads de Firestore → Supabase.
// Usado por Cloud Functions que precisam ler tabelas Supabase com fallback.
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseGet = supabaseGet;
exports.supabaseGetOne = supabaseGetOne;
exports.supabaseUpsert = supabaseUpsert;
exports.supabaseInsert = supabaseInsert;
exports.supabaseConfigured = supabaseConfigured;
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
async function supabaseGet(table, query = 'select=*', extraHeaders = {}) {
    const url = SB_URL();
    const key = SB_KEY();
    if (!url || !key)
        return null;
    try {
        const resp = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { ...headers(), ...extraHeaders } });
        if (!resp.ok)
            return null;
        return (await resp.json());
    }
    catch {
        return null;
    }
}
/**
 * GET que retorna um único objeto (primeira row) ou null.
 */
async function supabaseGetOne(table, query = 'select=*&limit=1') {
    const rows = await supabaseGet(table, query);
    return rows?.[0] ?? null;
}
/**
 * POST (upsert) genérico. Retorna true se OK, false se falhar.
 */
async function supabaseUpsert(table, data, onConflict = '') {
    const url = SB_URL();
    const key = SB_KEY();
    if (!url || !key)
        return false;
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
    }
    catch {
        return false;
    }
}
/**
 * POST insert (sem upsert). Retorna true se OK.
 */
async function supabaseInsert(table, data) {
    const url = SB_URL();
    const key = SB_KEY();
    if (!url || !key)
        return false;
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
    }
    catch {
        return false;
    }
}
/**
 * Verifica se Supabase está configurado (env vars presentes).
 */
function supabaseConfigured() {
    return !!(SB_URL() && SB_KEY());
}
//# sourceMappingURL=supabase-rest.js.map