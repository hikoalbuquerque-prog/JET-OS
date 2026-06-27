// frontend/src/lib/gps-background.ts
//
// GPS para operadores de campo — estratégia dupla:
//
//   Android APK (Capacitor):
//     @capacitor-community/background-geolocation → Foreground Service
//     Foreground Service tem notificação persistente e o Android NÃO pode
//     encerrá-lo via otimização de bateria — é garantia do sistema.
//     GPS continua com tela bloqueada, app minimizado, qualquer VPN.
//
//   iOS / PWA browser:
//     navigator.geolocation + Wake Lock API (mantém tela acesa)
//     GPS funciona enquanto tela ligada — suficiente para logística
//     Com PWA/browser fechado: impossível no browser, use APK.
//
// Resistência a VPN / rede instável:
//   Firestore usa persistentLocalCache (IndexedDB) — addDoc nunca rejeita
//   por problema de rede. Escreve localmente e sincroniza ao reconectar.
//   Nenhuma fila manual é necessária para esse caso.
//
// Detecção de localização falsa (mock GPS):
//   - Campo isMock do plugin Android (Android 6+)
//   - Velocidade fisicamente impossível (> 60 m/s ≈ 216 km/h)
//   - Precisão perfeita demais (< 2m — GPS real raramente chega a isso)
//   Pontos suspeitos são marcados com isMock:true e ainda enviados
//   (decisão de negócio fica no backend/admin, não descartamos silenciosamente).

import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  addDoc, collection, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './firebase';
import { isAndroidNative, iniciarGpsNativo, atualizarSlotNativo, pararGpsNativo } from './gps-native';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PontoGPS {
  uid: string;
  slotId: string | null;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  bateria: number | null;
  capturedAt: string;
  estrategia: 'background_android' | 'foreground_pwa' | 'wakelock_ios';
  isMock: boolean;
}

export interface TrackingStats {
  ativo: boolean;
  estrategia: string;
  pontoEnviados: number;
  pontosFalha: number;
  filaOffline: number;
  ultimaLat: number | null;
  ultimaLng: number | null;
  ultimoEnvioEm: Date | null;
  ultimoErro: string | null;
}

interface TrackingOpcoes {
  uid: string;
  slotId: string | null;
  onPosicao?: (lat: number, lng: number, accuracy: number) => void;
  onStats?: (stats: TrackingStats) => void;
  onErro?: (msg: string) => void;
  intervaloAtivoMs?: number;    // default 30s
  intervaloSegPlanoMs?: number; // default 90s
}

// ─── Plugin background geolocation (Capacitor) ───────────────────────────────

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  bearing: number | null;
  altitude: number | null;
  time: number;
  isMock?: boolean; // Android 6+ — true se localização for simulada por app
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage: string;
      backgroundTitle: string;
      requestPermissions: boolean;
      stale: boolean;
      distanceFilter: number;
    },
    callback: (loc: BgLocation | undefined, err: Error | undefined) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  'BackgroundGeolocation'
);

// ─── Detecção de ambiente ─────────────────────────────────────────────────────

function isAndroidCapacitor(): boolean {
  const cap = (window as any)?.Capacitor;
  return cap?.isNativePlatform?.() === true &&
    cap?.getPlatform?.() === 'android';
}

function isIOS(): boolean {
  const cap = (window as any)?.Capacitor;
  if (cap?.isNativePlatform?.() === true && cap?.getPlatform?.() === 'ios') return true;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

// ─── Detecção de mock GPS ─────────────────────────────────────────────────────
// Velocidade máxima real esperada para um operador de campo: ~40 km/h (patinete)
// Acima de 60 m/s (216 km/h) é fisicamente impossível → mock.
// Precisão < 2m em GPS de celular é irreal → provável mock.

const MAX_SPEED_MS = 60;    // m/s
const MIN_REAL_ACCURACY = 2; // metros

function detectarMock(
  speed: number | null,
  accuracy: number,
  pluginIsMock?: boolean
): boolean {
  if (pluginIsMock === true) return true;
  if (speed !== null && speed > MAX_SPEED_MS) return true;
  if (accuracy < MIN_REAL_ACCURACY) return true;
  return false;
}

// ─── Fila offline (apenas para erros não-rede, ex: permission denied) ─────────
// O Firestore já usa persistentLocalCache (IndexedDB) — problemas de VPN/rede
// são tratados internamente pelo SDK sem precisar de fila manual.
// Esta fila cobre apenas casos onde o próprio SDK rejeita (ex: regras de segurança).

const QUEUE_KEY = 'jet:gps-bg-queue-v2';
const MAX_QUEUE = 200;

async function lerFila(): Promise<PontoGPS[]> {
  try {
    if (isAndroidCapacitor()) {
      const { value } = await Preferences.get({ key: QUEUE_KEY });
      return value ? JSON.parse(value) : [];
    }
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch { return []; }
}

async function salvarFila(fila: PontoGPS[]) {
  const trimmed = fila.slice(-MAX_QUEUE);
  try {
    if (isAndroidCapacitor()) {
      await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(trimmed) });
    } else {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
    }
  } catch { /* storage cheio */ }
}

async function enqueue(ponto: PontoGPS) {
  const fila = await lerFila();
  fila.push(ponto);
  await salvarFila(fila);
}

export async function tamanhoFila(): Promise<number> {
  return (await lerFila()).length;
}

// ─── Upload para Firestore ────────────────────────────────────────────────────
//
// addDoc(gps_logistica): Firestore offline persistence garante que este write
// nunca é perdido mesmo com VPN ou sem rede — o SDK bufferiza no IndexedDB
// e sincroniza ao reconectar. Não há necessidade de retry manual aqui.
//
// updateDoc(usuarios): atualização de posição para o mapa em tempo real.
// É best-effort (UI only) — nunca afeta o registro do ponto GPS.

async function uploadPonto(ponto: PontoGPS): Promise<boolean> {
  try {
    await addDoc(collection(db, 'gps_logistica'), {
      ...ponto,
      criadoEm: serverTimestamp(),
    });

    // Item 1 — grava também no histórico permanente (best-effort, evita cold start da CF)
    try {
      await addDoc(collection(db, 'gps_logistica_hist', ponto.uid, 'pontos'), {
        uid:        ponto.uid,
        lat:        ponto.lat,
        lng:        ponto.lng,
        accuracy:   ponto.accuracy,
        capturedAt: ponto.capturedAt,
        criadoEm:   serverTimestamp(),
      });
    } catch (histErr: any) {
      console.warn('[GPS-BG] hist write falhou (best-effort):', histErr?.code);
    }

    // Item 2 — alerta backend quando mock GPS detectado (best-effort)
    if (ponto.isMock) {
      try {
        const fns = getFunctions(undefined, 'southamerica-east1');
        const alertarMock = httpsCallable(fns, 'alertarMockGPS');
        alertarMock({
          uid:        ponto.uid,
          lat:        ponto.lat,
          lng:        ponto.lng,
          capturedAt: ponto.capturedAt,
        }).catch(() => { /* best-effort */ });
      } catch (mockErr: any) {
        console.warn('[GPS-BG] alertarMockGPS falhou (best-effort):', mockErr?.code);
      }
    }

    // Fire-and-forget: falha não compromete o registro do ponto
    updateDoc(doc(db, 'usuarios', ponto.uid), {
      ultimaLat:        ponto.lat,
      ultimaLng:        ponto.lng,
      ultimaAccuracy:   ponto.accuracy,
      ultimaVelocidade: ponto.speed,
      ultimaPosicaoEm:  serverTimestamp(),
      slotAtualId:      ponto.slotId,
      ultimoIsMock:     ponto.isMock,
    }).catch(() => { /* best-effort */ });

    return true;
  } catch (err: any) {
    // addDoc só rejeita por erros não-rede (permission denied, schema inválido).
    // Rede/VPN são tratados internamente pelo SDK — não chegam aqui.
    console.error('[GPS-BG] uploadPonto erro:', err?.code, err?.message);
    await enqueue(ponto);
    return false;
  }
}

async function drenarFila(): Promise<number> {
  const fila = await lerFila();
  if (!fila.length) return 0;
  let enviados = 0;
  const restante: PontoGPS[] = [];
  for (const p of fila) {
    try {
      await addDoc(collection(db, 'gps_logistica'), { ...p, criadoEm: serverTimestamp() });
      enviados++;
      await new Promise(r => setTimeout(r, 200));
    } catch { restante.push(p); }
  }
  await salvarFila(restante);
  return enviados;
}

// ─── Leitura de bateria ───────────────────────────────────────────────────────

async function lerBateria(): Promise<number | null> {
  // Capacitor Device — funciona no APK Android (WebView não tem Battery API)
  if (isAndroidCapacitor()) {
    try {
      const { Device } = await import('@capacitor/device');
      const info = await Device.getBatteryInfo();
      if (info.batteryLevel !== undefined) return Math.round(info.batteryLevel * 100);
    } catch { /* plugin não disponível */ }
  }
  // Fallback browser Battery API (PWA/desktop)
  try {
    const nav = navigator as any;
    if (nav.getBattery) {
      const bat = await nav.getBattery();
      return Math.round(bat.level * 100);
    }
  } catch { /* não disponível */ }
  return null;
}

// ─── Wake Lock (iOS / PWA com tela aberta) ────────────────────────────────────

let wakeLock: any = null;

async function ativarWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await (navigator as any).wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && wakeLock?.released) {
        wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    });
  } catch { /* iOS < 16.4 não suporta */ }
}

async function desativarWakeLock() {
  if (wakeLock && !wakeLock.released) {
    await wakeLock.release();
    wakeLock = null;
  }
}

// ─── SERVIÇO PRINCIPAL ────────────────────────────────────────────────────────

const WATCHDOG_MS = 3 * 60_000; // 3 min sem posição → alerta
const HEARTBEAT_MS = 45_000;   // forçar upload a cada 45s mesmo parado
const STALE_REVIVE_MS = 3 * 60_000; // auto-revive watcher se 3min sem upload

class GPSBackgroundService {
  private ativo = false;
  private opcoes: TrackingOpcoes | null = null;
  private estrategia: string = '';

  private watcherId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private ultimaPosicao: { lat: number; lng: number; accuracy: number; time: number } | null = null;
  private ultimoUploadMs = 0;
  private segundoPlano = false;
  private netListener: (() => void) | null = null;

  private stats: TrackingStats = {
    ativo:         false,
    estrategia:    '',
    pontoEnviados: 0,
    pontosFalha:   0,
    filaOffline:   0,
    ultimaLat:     null,
    ultimaLng:     null,
    ultimoEnvioEm: null,
    ultimoErro:    null,
  };

  async iniciar(opcoes: TrackingOpcoes) {
    if (this.ativo) await this.parar();
    this.opcoes = opcoes;
    this.ativo = true;

    // Android APK: usa o serviço NATIVO (upload direto p/ Cloud Function). Ele coleta e
    // envia mesmo com o app fechado, sem depender do JS. Aqui só disparamos e marcamos
    // ativo — não há watchdog/timer/equimaps no JS (o upload não passa mais por aqui).
    if (isAndroidNative()) {
      try {
        await iniciarGpsNativo(opcoes.uid, opcoes.slotId);
        this.estrategia = 'background_android_native';
        this.stats.estrategia = 'Android (serviço nativo)';
        this.stats.ativo = true;
        this.stats.ultimoErro = null;
        this._emitirStats();
        console.log('[GPS-BG] iniciado — serviço nativo (upload em segundo plano)');
        return;
      } catch (e: any) {
        // Plugin nativo indisponível (ex.: build antigo): cai para o caminho legado.
        console.warn('[GPS-BG] serviço nativo indisponível, fallback:', e?.message);
        // Surface o motivo no banner do app (sem o serviço nativo, o GPS em background é instável).
        try { opcoes.onErro?.('GPS nativo falhou: ' + (e?.message || String(e))); } catch { /* noop */ }
      }
    }

    // Drena fila de erros não-rede ao reconectar
    const onOnline = async () => {
      const n = await drenarFila();
      if (n > 0) this._log(`Drenados ${n} pontos da fila`);
      this._atualizarFila();
    };
    window.addEventListener('online', onOnline);
    this.netListener = () => window.removeEventListener('online', onOnline);

    if (isAndroidCapacitor()) {
      await this._iniciarAndroid();
    } else {
      await this._iniciarPWA();
    }

    this._reiniciarWatchdog();
    this._iniciarHeartbeat();
    this._iniciarStaleDetection();
    this._emitirStats();
    console.log(`[GPS-BG] iniciado — estratégia: ${this.estrategia}`);
  }

  // ── Android: Foreground Service via Background Geolocation Plugin ──────────
  // O Foreground Service tem notificação persistente — Android não pode
  // encerrá-lo via otimização de bateria. Funciona com tela bloqueada e VPN.

  private async _iniciarAndroid() {
    this.estrategia = 'background_android';
    this.stats.estrategia = 'Android (Foreground Service)';

    try {
      const id = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: 'JET OS está rastreando sua localização durante o turno.',
          backgroundTitle:   'JET OS — turno ativo',
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        async (loc, err) => {
          if (err) { this._erro(err.message ?? 'Erro GPS Android'); return; }
          if (!loc) return;

          // Tolerância de idade alta de propósito: quando o app está minimizado o JS
          // é suspenso e o plugin entrega vários fixes em lote ao retomar. Com o limite
          // antigo de 30s, todos os pontos do período em segundo plano eram descartados
          // (parecia que o GPS "parou"). 3 min alinha com o watchdog e preserva esses
          // pontos. Mantém o corte só para rejeitar fix de cold-start realmente antigo.
          const ageMsLoc = Date.now() - (loc.time ?? 0);
          if (ageMsLoc > 180_000) return;
          if (loc.accuracy > 500) return;

          const isMock = detectarMock(loc.speed, loc.accuracy, loc.isMock);
          const bateria = await lerBateria();
          const ponto: PontoGPS = {
            uid:        this.opcoes!.uid,
            slotId:     this.opcoes!.slotId,
            lat:        loc.latitude,
            lng:        loc.longitude,
            accuracy:   loc.accuracy,
            speed:      loc.speed,
            heading:    loc.bearing,
            altitude:   loc.altitude,
            bateria,
            capturedAt: new Date(loc.time ?? Date.now()).toISOString(),
            estrategia: 'background_android',
            isMock,
          };

          if (isMock) console.warn('[GPS-BG] MOCK detectado:', loc);

          this.opcoes?.onPosicao?.(loc.latitude, loc.longitude, loc.accuracy);
          const ok = await uploadPonto(ponto);
          this._atualizarStats(ponto, ok);
        }
      );

      this.watcherId = id;
    } catch (e: any) {
      console.warn('[GPS-BG] Plugin background indisponível, fallback PWA:', e.message);
      await this._iniciarPWA();
    }
  }

  // ── PWA / iOS: Foreground + Wake Lock ────────────────────────────────────
  // Funciona com browser aberto e tela ligada.
  // Com browser/PWA fechado: GPS para — use APK para cobertura total.

  private async _iniciarPWA() {
    this.estrategia = isIOS() ? 'wakelock_ios' : 'foreground_pwa';
    this.stats.estrategia = isIOS() ? 'iOS PWA (Wake Lock)' : 'PWA (foreground)';

    await ativarWakeLock();

    const onVisibility = () => {
      this.segundoPlano = document.visibilityState === 'hidden';
      this._reiniciarTimer();
    };
    document.addEventListener('visibilitychange', onVisibility);

    await this._cicloPWA();
    this._reiniciarTimer();
  }

  private _reiniciarTimer() {
    if (this.timer) clearInterval(this.timer);
    if (!this.ativo) return;
    const ms = this.segundoPlano
      ? (this.opcoes?.intervaloSegPlanoMs ?? 90_000)
      : (this.opcoes?.intervaloAtivoMs   ?? 30_000);
    this.timer = setInterval(() => this._cicloPWA(), ms);
  }

  private async _cicloPWA() {
    if (!this.ativo || !this.opcoes) return;

    return new Promise<void>((resolve) => {
      if (!navigator.geolocation) { resolve(); return; }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (Date.now() - pos.timestamp > 30_000) { resolve(); return; }
          if (pos.coords.accuracy > 500) { resolve(); return; }

          const isMock = detectarMock(pos.coords.speed, pos.coords.accuracy);
          if (isMock) console.warn('[GPS-BG] MOCK detectado (PWA):', pos.coords);

          const bateria = await lerBateria();
          const ponto: PontoGPS = {
            uid:        this.opcoes!.uid,
            slotId:     this.opcoes!.slotId,
            lat:        pos.coords.latitude,
            lng:        pos.coords.longitude,
            accuracy:   pos.coords.accuracy,
            speed:      pos.coords.speed,
            heading:    pos.coords.heading,
            altitude:   pos.coords.altitude,
            bateria,
            capturedAt: new Date(pos.timestamp).toISOString(),
            estrategia: isIOS() ? 'wakelock_ios' : 'foreground_pwa',
            isMock,
          };

          this.opcoes?.onPosicao?.(
            pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy
          );
          const ok = await uploadPonto(ponto);
          this._atualizarStats(ponto, ok);
          resolve();
        },
        (err) => { this._erro(err.message); resolve(); },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 10000 }
      );
    });
  }

  private _reiniciarWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (!this.ativo) return;
    this.watchdog = setTimeout(() => {
      this._erro('GPS sem sinal — verifique se a localização está ativada');
    }, WATCHDOG_MS);
  }

  private _iniciarHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (!this.ativo || !this.opcoes) return;
      const agora = Date.now();
      if (agora - this.ultimoUploadMs < HEARTBEAT_MS) return;
      if (!this.ultimaPosicao) return;

      const bateria = await lerBateria();
      const ponto: PontoGPS = {
        uid:        this.opcoes.uid,
        slotId:     this.opcoes.slotId,
        lat:        this.ultimaPosicao.lat,
        lng:        this.ultimaPosicao.lng,
        accuracy:   this.ultimaPosicao.accuracy,
        speed:      0,
        heading:    null,
        altitude:   null,
        bateria,
        capturedAt: new Date().toISOString(),
        estrategia: this.estrategia as any,
        isMock:     false,
      };
      const ok = await uploadPonto(ponto);
      this._atualizarStats(ponto, ok);
      this._log('heartbeat enviado');
    }, HEARTBEAT_MS);
  }

  private _iniciarStaleDetection() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(async () => {
      if (!this.ativo) return;
      const agora = Date.now();
      if (agora - this.ultimoUploadMs > STALE_REVIVE_MS) {
        this._log('stale detection — revivendo watcher GPS');
        if (this.watcherId && isAndroidCapacitor()) {
          try { await BackgroundGeolocation.removeWatcher({ id: this.watcherId }); } catch {}
          this.watcherId = null;
          await this._iniciarAndroid();
        } else if (!isAndroidCapacitor() && !isAndroidNative()) {
          await this._cicloPWA();
        }
      }
      this._iniciarStaleDetection();
    }, STALE_REVIVE_MS);
  }

  async parar() {
    this.ativo = false;

    // Android nativo: encerra o serviço nativo (idempotente).
    if (isAndroidNative()) {
      try { await pararGpsNativo(); } catch { /* serviço já parado */ }
    }

    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.staleTimer) { clearTimeout(this.staleTimer); this.staleTimer = null; }

    if (this.watcherId) {
      try { await BackgroundGeolocation.removeWatcher({ id: this.watcherId }); }
      catch { /* ignorar */ }
      this.watcherId = null;
    }

    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await desativarWakeLock();

    this.netListener?.();
    this.netListener = null;

    this.stats.ativo = false;
    this._emitirStats();
    console.log('[GPS-BG] parado');
  }

  atualizarSlot(slotId: string | null) {
    if (this.opcoes) this.opcoes.slotId = slotId;
    if (isAndroidNative()) {
      atualizarSlotNativo(slotId).catch(e => console.warn('[GPS-BG] updateSlot nativo:', e?.message));
    }
  }

  private _atualizarStats(ponto: PontoGPS, ok: boolean) {
    if (ok) {
      this.stats.pontoEnviados++;
      this.stats.ultimaLat     = ponto.lat;
      this.stats.ultimaLng     = ponto.lng;
      this.stats.ultimoEnvioEm = new Date();
      this.stats.ultimoErro    = null;
      this.ultimaPosicao = { lat: ponto.lat, lng: ponto.lng, accuracy: ponto.accuracy, time: Date.now() };
      this.ultimoUploadMs = Date.now();
      this._reiniciarWatchdog();
    } else {
      this.stats.pontosFalha++;
    }
    this._atualizarFila();
    this._emitirStats();
  }

  private async _atualizarFila() {
    this.stats.filaOffline = await tamanhoFila();
    this._emitirStats();
  }

  private _erro(msg: string) {
    this.stats.ultimoErro = msg;
    this.opcoes?.onErro?.(msg);
    this._emitirStats();
    console.error('[GPS-BG]', msg);
  }

  private _log(msg: string) {
    console.log('[GPS-BG]', msg);
  }

  private _emitirStats() {
    this.stats.ativo = this.ativo;
    this.stats.estrategia = this.estrategia;
    this.opcoes?.onStats?.({ ...this.stats });
  }

  obterStats(): TrackingStats {
    return { ...this.stats };
  }
}

export const gpsBackground = new GPSBackgroundService();

// ─── Captura única (check-in) ─────────────────────────────────────────────────

export async function capturarPosicaoUnica(): Promise<{
  lat: number; lng: number; accuracy: number;
} | null> {
  if (isAndroidCapacitor()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 7000,
      });
      return {
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    } catch { /* fallback abaixo */ }
  }

  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 10000 }
    );
  });
}

// ─── Verificação de permissão GPS ────────────────────────────────────────────

export async function verificarPermissaoGPS(): Promise<
  'granted' | 'denied' | 'prompt' | 'unavailable'
> {
  if (isAndroidCapacitor()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const status = await Geolocation.checkPermissions();
      return status.location === 'granted' ? 'granted'
        : status.location === 'denied' ? 'denied' : 'prompt';
    } catch { return 'unavailable'; }
  }
  if (!navigator.geolocation) return 'unavailable';
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'prompt';
  }
}

// ─── Helpers de distância ─────────────────────────────────────────────────────

export function distanciaMetros(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function operadorNoPonto(
  latOperador: number, lngOperador: number,
  latPonto: number, lngPonto: number,
  raioMetros = 100
): boolean {
  return distanciaMetros(latOperador, lngOperador, latPonto, lngPonto) <= raioMetros;
}
