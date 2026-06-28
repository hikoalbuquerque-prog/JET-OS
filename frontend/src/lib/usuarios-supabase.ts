// frontend/src/lib/usuarios-supabase.ts
// Leitura e escrita de usuarios no Supabase.

import { supabase } from './supabase';

export const usuariosReadSupabase = (): boolean => true;

// ── Conversão snake_case → camelCase (downstream espera camelCase) ──────────
function toFirestoreShape(row: any): any {
  if (!row) return row;
  return {
    ...row,
    uid: row.firebase_uid || row.id,           // componentes esperam .uid = Firebase UID
    cidadesPermitidas: row.cidades_permitidas,
    cidadesGerenciaLog: row.cidades_gerencia_log,
    cargoPrestador: row.cargo,                 // coluna "cargo" no Supabase = cargoPrestador no Firestore
    tipoCadastro: row.tipo_cadastro,
    statusPrestador: row.status_prestador,
    telegramChatId: row.telegram_chat_id,
    slotAtualId: row.slot_atual_id,
    senhaTemporaria: row.senha_temporaria,
    // campos originais snake_case mantidos para quem já use direto
  };
}

// ── Leituras ────────────────────────────────────────────────────────────────
export async function fetchUsuarios(filtros?: {
  role_in?: string[];
  cidade?: string;
  tipoCadastro?: string;
  statusPrestador?: string;
}): Promise<any[]> {
  let q = supabase.from('usuarios').select('*');
  if (filtros?.role_in?.length)   q = q.in('role', filtros.role_in);
  if (filtros?.cidade)            q = q.eq('cidade', filtros.cidade);
  if (filtros?.tipoCadastro)      q = q.eq('tipo_cadastro', filtros.tipoCadastro);
  if (filtros?.statusPrestador)   q = q.eq('status_prestador', filtros.statusPrestador);
  const { data, error } = await q;
  if (error) { console.warn('[usuarios-supabase] fetch', error); return []; }
  return (data ?? []).map(toFirestoreShape);
}

export async function fetchUsuario(uid: string): Promise<any | null> {
  // uid é Firebase UID
  const { data, error } = await supabase.from('usuarios').select('*')
    .eq('firebase_uid', uid).maybeSingle();
  if (error || !data) return null;
  return toFirestoreShape(data);
}

export async function fetchUsuariosByIds(uids: string[]): Promise<any[]> {
  if (!uids.length) return [];
  // uids são Firebase UIDs — busca em batches de 50 (limite IN do PostgREST)
  const results: any[] = [];
  for (let i = 0; i < uids.length; i += 50) {
    const batch = uids.slice(i, i + 50);
    const { data, error } = await supabase.from('usuarios').select('*')
      .in('firebase_uid', batch);
    if (error) { console.warn('[usuarios-supabase] fetchByIds', error); continue; }
    if (data) results.push(...data.map(toFirestoreShape));
  }
  return results;
}

export const usuariosWriteSupabase = (): boolean => true;

// Atualiza um usuário (por firebase uid) via Edge Function. `patch` em camelCase; a função
// só aplica colunas permitidas pelo papel do chamador (self: perfil; gestor: + role/cidades/ativo).
// Best-effort durante a transição: lança em erro p/ o chamador logar (não quebra o Firestore).
export async function escreverUsuarioSupabase(alvoFirebaseUid: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('usuarios-write', {
    body: { alvoFirebaseUid, patch },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
}
