// frontend/src/lib/supabase-auth.ts
//
// Migração (strangler) — dual-auth. Helpers para estabelecer/encerrar a sessão
// Supabase em paralelo ao Firebase. O Firebase segue como auth primário (autoriza
// as leituras do Firestore enquanto os dados não migraram); o Supabase passa a ter
// uma sessão REAL em produção, necessária para o GPS nativo (Edge Function ingest-gps)
// e para os módulos já migrados — sem depender das credenciais de teste.
//
// A senha é verificada pela Edge Function auth-login (migração preguiçosa: confere no
// Firebase no 1º login e grava no Supabase). Tudo aqui é NÃO-FATAL: se falhar, o login
// Firebase segue normal (o GPS Supabase pode ficar sem sessão, mas não derruba o usuário).

import { supabase } from './supabase';

// Chave durável do refresh token da SESSÃO B — dedicada ao serviço GPS nativo. Família de
// refresh token INDEPENDENTE da sessão A (cliente JS). O cliente JS agora persiste e renova
// a SUA sessão (sessão A — persistSession:true/autoRefreshToken:true em supabase.ts) no
// storageKey 'jet-os-supabase-auth'; esta chave guarda só o seed da sessão B, que o GPS
// nativo lê (sobrevive a remount/reload). Como as famílias são distintas, renovar A não
// invalida o token do GPS.
export const SUPA_REFRESH_KEY = 'jet_supa_refresh';

// Estabelece a sessão Supabase a partir do mesmo e-mail/senha do login Firebase.
export async function estabelecerSessaoSupabase(email: string, senha: string): Promise<void> {
  if (!import.meta.env.VITE_SUPABASE_URL) return; // Supabase não configurado neste build
  try {
    // ── Sessão B — dedicada ao serviço GPS nativo (família de refresh token INDEPENDENTE
    //    da do JS, p/ a renovação do JS não invalidar o token do GPS). Vai pro localStorage
    //    durável, que o GPS nativo lê como seed (sobrevive a remount/reload).
    try {
      const { data: dataB } = await supabase.functions.invoke('auth-login', { body: { email, password: senha } });
      const sessB = (dataB as any)?.session;
      if (sessB?.refresh_token) { try { localStorage.setItem(SUPA_REFRESH_KEY, sessB.refresh_token); } catch { /* sem localStorage */ } }
      else console.warn('[supa-auth] sessão GPS (B) não obtida');
    } catch (e: any) { console.warn('[supa-auth] auth-login (B/GPS) falhou:', e?.message || e); }

    // ── Sessão A — do cliente JS (leitura de dados sob RLS; persist + autoRefresh próprios,
    //    ver supabase.ts). É o que mantém as leituras Supabase estáveis no app.
    const { data, error } = await supabase.functions.invoke('auth-login', {
      body: { email, password: senha },
    });
    if (error) { console.warn('[supa-auth] auth-login (A/JS) falhou:', error.message); return; }
    const session = (data as any)?.session;
    if (!session?.access_token || !session?.refresh_token) {
      console.warn('[supa-auth] auth-login (A) sem sessão:', data); return;
    }
    const { data: setData, error: setErr } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (setErr) {
      // Falha silenciosa aqui = sessão A nunca persiste → getSession() volta null →
      // toda leitura/escrita sob RLS cai nas policies anon. Logar p/ diagnosticar.
      console.error('[supa-auth] setSession (A/JS) FALHOU:', setErr.message);
      return;
    }
    // Confirma que a sessão A foi de fato gravada (persistSession grava no localStorage).
    const { data: chk } = await supabase.auth.getSession();
    if (!chk?.session?.access_token) {
      console.error('[supa-auth] setSession resolveu mas getSession() = null (sessão A não persistiu)');
    } else {
      console.log('[supa-auth] sessões Supabase estabelecidas (A=JS leitura, B=GPS)', (data as any)?.migrated ? '(migrada)' : '');
    }
  } catch (e: any) {
    console.warn('[supa-auth] erro ao estabelecer sessão:', e?.message || e);
  }
}

// ── Onda C (groundwork, REVERSÍVEL) ──────────────────────────────────────────
// Flag de provedor de AUTH/AUTORIZAÇÃO. Liga SÓ a fonte do perfil (role/paises/nome):
// quando 'supabase', o useAuth carrega o perfil de public.usuarios em vez de Firestore.
// O Firebase Auth segue PRIMÁRIO (sessão + escritas + GPS intactos) — isto NÃO é o flip
// de login (C.8) nem aposenta o Firebase (C.9). Reversível: basta 'firebase'/remover.
//   localStorage.setItem('jet_auth_provider','supabase')  // liga só pra você
export const authProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_auth_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_AUTH_PROVIDER as string) !== 'firebase';
};

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
