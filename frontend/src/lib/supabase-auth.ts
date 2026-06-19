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

// Chave durável do refresh token Supabase. O client usa persistSession:false (o serviço
// GPS nativo é o ÚNICO que renova — ver supabase.ts), então a sessão vive só em memória e
// se perde em qualquer remount/reload. Guardamos o refresh token aqui para o handoff do GPS
// nativo sobreviver até o início do turno, SEM ligar autoRefreshToken (não há conflito de
// rotação: o JS nunca renova; só entrega o seed ao serviço nativo).
export const SUPA_REFRESH_KEY = 'jet_supa_refresh';

// Estabelece a sessão Supabase a partir do mesmo e-mail/senha do login Firebase.
export async function estabelecerSessaoSupabase(email: string, senha: string): Promise<void> {
  if (!import.meta.env.VITE_SUPABASE_URL) return; // Supabase não configurado neste build
  try {
    const { data, error } = await supabase.functions.invoke('auth-login', {
      body: { email, password: senha },
    });
    if (error) { console.warn('[supa-auth] auth-login falhou:', error.message); return; }
    const session = (data as any)?.session;
    if (!session?.access_token || !session?.refresh_token) {
      console.warn('[supa-auth] auth-login sem sessão:', data); return;
    }
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    // Durável: o GPS nativo lê este refresh token como seed (sobrevive a remount/reload).
    try { localStorage.setItem(SUPA_REFRESH_KEY, session.refresh_token); } catch { /* sem localStorage */ }
    console.log('[supa-auth] sessão Supabase estabelecida', (data as any)?.migrated ? '(migrada)' : '');
  } catch (e: any) {
    console.warn('[supa-auth] erro ao estabelecer sessão:', e?.message || e);
  }
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
