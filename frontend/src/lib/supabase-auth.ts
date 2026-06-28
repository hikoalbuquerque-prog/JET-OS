// frontend/src/lib/supabase-auth.ts
//
// Helpers de auth Supabase: constantes (SUPA_REFRESH_KEY para sessão GPS),
// carregamento de perfil (fallback por firebase_uid), e encerramento de sessão.
// A lógica de LOGIN está centralizada em useAuth.ts (auth flip C.9).
// A senha é verificada pela Edge Function auth-login (migração preguiçosa: confere no
// Firebase no 1o login e grava no Supabase).

import { supabase } from './supabase';

// Chave durável do refresh token da SESSÃO B — dedicada ao serviço GPS nativo. Família de
// refresh token INDEPENDENTE da sessão A (cliente JS). O cliente JS agora persiste e renova
// a SUA sessão (sessão A — persistSession:true/autoRefreshToken:true em supabase.ts) no
// storageKey 'jet-os-supabase-auth'; esta chave guarda só o seed da sessão B, que o GPS
// nativo lê (sobrevive a remount/reload). Como as famílias são distintas, renovar A não
// invalida o token do GPS.
export const SUPA_REFRESH_KEY = 'jet_supa_refresh';

// NOTA: estabelecerSessaoSupabase foi removida — a lógica de login agora está
// centralizada em useAuth.ts (auth flip C.9). O login chama a Edge Function
// auth-login diretamente e usa setSession() para estabelecer as sessões A e B.

export const authProviderSupabase = (): boolean => true;

// Perfil do app a partir de public.usuarios (Supabase), buscando por firebase_uid.
// IMPORTANTE: mantém `uid` = firebase_uid (as escritas seguem no Firestore e filtram por
// uid Firebase). `paises` cai no fallback Firestore enquanto a coluna não for backfillada.
// Retorna null se não achar (o chamador faz fallback ao Firestore — segurança).
export async function carregarPerfilSupabase(
  firebaseUid: string,
  paisesFallback?: string[],
): Promise<{ uid: string; email: string; nome: string; role: string; paises: string[] } | null> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('email, nome, role, paises, ativo, firebase_uid')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();
  if (error) { console.warn('[supa-auth] carregarPerfil falhou:', error.message); return null; }
  if (!data) return null;
  if (data.ativo === false) return null; // desativado — trata como sem perfil
  const paises = (Array.isArray(data.paises) && data.paises.length)
    ? data.paises
    : (paisesFallback ?? []);
  return {
    uid: firebaseUid,
    email: data.email || '',
    nome: data.nome || '',
    role: data.role || 'viewer',
    paises,
  };
}

// Encerra a sessão Supabase e PARA o GPS nativo. Parar o GPS no logout é essencial:
// sem isso o serviço nativo segue postando com o refresh token persistido do usuário
// anterior (atrapalha troca de conta no mesmo aparelho e fura o anti-compartilhamento).
export async function encerrarSessaoSupabase(): Promise<void> {
  try {
    const { isAndroidNative, pararGpsNativo } = await import('./gps-native');
    if (isAndroidNative()) await pararGpsNativo();
  } catch { /* web ou já parado */ }
  try { localStorage.removeItem(SUPA_REFRESH_KEY); } catch { /* sem localStorage */ }
  try { await supabase.auth.signOut(); } catch { /* não-fatal durante migração */ }
}
