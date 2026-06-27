// frontend/src/lib/gps-native.ts
//
// Ponte para o GpsTrackerService nativo (Android APK). O serviço nativo coleta o GPS,
// enfileira em SQLite e faz POST direto para o backend — sem depender do JavaScript do
// WebView, que o Android congela quando o app é minimizado/fechado. É o que permite
// rastrear AO VIVO com o app fechado.
//
// MIGRAÇÃO (Seção 14.5): o serviço é PLUGÁVEL por provedor:
//   - 'firebase'  → Cloud Function ingestGps (token via securetoken.googleapis.com)
//   - 'supabase'  → Edge Function ingest-gps (token via <url>/auth/v1/token)
// Define-se o provedor por env: VITE_GPS_PROVIDER=supabase (default = firebase).
// Para o teste do PORTÃO, gere um APK com VITE_GPS_PROVIDER=supabase e valide em campo.

import { registerPlugin } from '@capacitor/core';

interface GpsTrackerPlugin {
  start(opts: {
    provider: 'firebase' | 'supabase';
    functionUrl: string;
    tokenUrl: string;
    apiKey: string;
    refreshToken: string;
    uid: string;
    slotId?: string | null;
    intervalMs?: number;
    deviceId?: string;
    deviceModel?: string;
  }): Promise<void>;
  updateSlot(opts: { slotId: string | null }): Promise<void>;
  stop(): Promise<void>;
}

const GpsTracker = registerPlugin<GpsTrackerPlugin>('GpsTracker');

// ── Firebase (atual) ──────────────────────────────────────────────────────
const FB_FUNCTION_URL = 'https://southamerica-east1-jet-os-1.cloudfunctions.net/ingestGps';
const FB_API_KEY = 'AIzaSyAPBQfV2wq4GD6AZxqmzTZ_rvFHjbWepMk';

// ── Supabase (migração) ───────────────────────────────────────────────────
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

const GPS_PROVIDER: 'firebase' | 'supabase' =
  (import.meta.env.VITE_GPS_PROVIDER as string) === 'firebase' ? 'firebase' : 'supabase';

export function isAndroidNative(): boolean {
  const cap = (window as any)?.Capacitor;
  return cap?.isNativePlatform?.() === true && cap?.getPlatform?.() === 'android';
}

// Obtém o refresh token Supabase para semear o serviço nativo. Ordem:
//   1) localStorage (gravado no login — durável, sobrevive a remount/reload). É o caminho
//      de produção: o client usa persistSession:false, então getSession() costuma vir null.
//   2) getSession() em memória (caso raro em que a sessão ainda está viva).
//   3) credenciais de teste no env (VITE_SUPABASE_TEST_*) — só nos builds de validação.
async function obterRefreshTokenSupabase(supabase: any): Promise<string | null> {
  try {
    const ls = localStorage.getItem('jet_supa_refresh');
    if (ls) return ls;
  } catch { /* sem localStorage */ }
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.refresh_token) return session.refresh_token;
  const email = import.meta.env.VITE_SUPABASE_TEST_EMAIL as string | undefined;
  const password = import.meta.env.VITE_SUPABASE_TEST_PASSWORD as string | undefined;
  if (email && password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Auto-login Supabase de teste falhou: ' + error.message);
    return data.session?.refresh_token ?? null;
  }
  return null;
}

// Identificador estável do aparelho (anti-compartilhamento). No Android é o ANDROID_ID.
async function getDeviceInfo(): Promise<{ deviceId: string; deviceModel: string }> {
  try {
    const { Device } = await import('@capacitor/device');
    const id = (await Device.getId()).identifier;
    const info = await Device.getInfo();
    return { deviceId: id, deviceModel: `${info.manufacturer ?? ''} ${info.model ?? ''}`.trim() };
  } catch {
    return { deviceId: '', deviceModel: '' };
  }
}

export async function iniciarGpsNativo(uid: string, slotId: string | null): Promise<void> {
  const dev = await getDeviceInfo();
  if (GPS_PROVIDER === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('VITE_SUPABASE_URL/ANON_KEY não configurados');
    }
    // import dinâmico: o caminho firebase não carrega o SDK do Supabase
    const { supabase } = await import('./supabase');
    const refreshToken = await obterRefreshTokenSupabase(supabase);
    if (!refreshToken) {
      throw new Error('Sem refresh token Supabase — faça login novamente (a sessão não foi estabelecida)');
    }
    await GpsTracker.start({
      provider: 'supabase',
      functionUrl: `${SUPABASE_URL}/functions/v1/ingest-gps`,
      tokenUrl: `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      apiKey: SUPABASE_ANON_KEY,
      refreshToken,
      uid,
      slotId,
      deviceId: dev.deviceId,
      deviceModel: dev.deviceModel,
    });
    return;
  }

  // Firebase (fallback)
  const { auth } = await import('./firebase');
  const user = auth.currentUser;
  const refreshToken = (user as any)?.refreshToken as string | undefined;
  if (!refreshToken) throw new Error('Sem refresh token — usuário não autenticado');
  await GpsTracker.start({
    provider: 'firebase',
    functionUrl: FB_FUNCTION_URL,
    tokenUrl: `https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`,
    apiKey: FB_API_KEY,
    refreshToken,
    uid,
    slotId,
    deviceId: dev.deviceId,
    deviceModel: dev.deviceModel,
  });
}

export async function atualizarSlotNativo(slotId: string | null): Promise<void> {
  await GpsTracker.updateSlot({ slotId });
}

export async function pararGpsNativo(): Promise<void> {
  await GpsTracker.stop();
}
