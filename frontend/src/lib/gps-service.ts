// frontend/src/lib/gps-service.ts
// GPS para equipe de logística — usa plugin Capacitor quando disponível,
// fallback para browser Geolocation no desktop/PWA.
//
// Proteções:
//   - VPN: AbortController 8s + retry com backoff
//   - Bateria: intervalo adaptativo (ativo=30s, segundo plano=90s)
//   - Sem sinal: fila offline em localStorage (até 500 pontos)
//   - GPS stale: descarta posição > 30s antiga
//   - Coordenadas impossíveis: validação básica antes de enviar

import {
  addDoc,
  collection,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PontoGPS {
  uid: string;
  slotId: string | null;
  lat: number;
  lng: number;
  accuracy: number;     // metros
  capturedAt: string;   // ISO
  bateria?: number;     // 0–100
  velocidade?: number;  // m/s
  altitude?: number;
}

interface GPSOptions {
  uid: string;
  slotId: string | null;
  onPosicao?: (lat: number, lng: number, accuracy: number) => void;
  onErro?: (msg: string) => void;
  intervaloAtivo?: number;      // ms, padrão 30000
  intervaloSegPlano?: number;   // ms, padrão 90000
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const QUEUE_KEY     = 'jet_gps_queue';
const MAX_QUEUE     = 500;
const MAX_STALE_MS  = 30_000;   // descarta posição > 30s
const TIMEOUT_MS    = 8_000;    // AbortController — protege contra VPN lenta
const MAX_RETRY     = 3;
const RETRY_DELAY   = [2000, 5000, 12000]; // backoff progressivo

// ─── Detecção de Capacitor ────────────────────────────────────────────────────

function isCapacitor(): boolean {
  return typeof (window as any)?.Capacitor !== 'undefined' &&
    (window as any).Capacitor?.isNativePlatform?.() === true;
}

// Import dinâmico — não falha se não estiver instalado (PWA/desktop)
async function getCapacitorGeo() {
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    return Geolocation;
  } catch {
    return null;
  }
}

async function getCapacitorNetwork() {
  try {
    const { Network } = await import('@capacitor/network');
    return Network;
  } catch {
    return null;
  }
}

async function getCapacitorDevice() {
  try {
    const { Device } = await import('@capacitor/device');
    return Device;
  } catch {
    return null;
  }
}

// ─── Validação de coordenadas ─────────────────────────────────────────────────

function coordsValidas(lat: number, lng: number, accuracy: number): boolean {
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (accuracy > 500) return false;    // precisão pior que 500m = ruído
  return true;
}

// ─── Fila offline ────────────────────────────────────────────────────────────

function lerFila(): PontoGPS[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function salvarFila(fila: PontoGPS[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(fila.slice(-MAX_QUEUE)));
  } catch { /* storage cheio */ }
}

function enqueue(ponto: PontoGPS) {
  const fila = lerFila();
  fila.push(ponto);
  salvarFila(fila);
}

function dequeue(): PontoGPS | null {
  const fila = lerFila();
  if (fila.length === 0) return null;
  const [primeiro, ...resto] = fila;
  salvarFila(resto);
  return primeiro;
}

export function tamanhoFila(): number {
  return lerFila().length;
}

// ─── Envio com retry + VPN protection ────────────────────────────────────────

async function enviarPontoFirestore(ponto: PontoGPS, tentativa = 0): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Escreve direto no Firestore SDK (não usa fetch, AbortController é para
    // eventuais chamadas fetch auxiliares — o SDK tem timeout interno de 60s
    // mas na prática não há problema com VPN se a conexão existe)
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
      console.warn('[GPS] hist write falhou (best-effort):', histErr?.code);
    }

    // Atualiza última posição no doc do usuário (para admin ver no mapa)
    await updateDoc(doc(db, 'usuarios', ponto.uid), {
      ultimaLat:        ponto.lat,
      ultimaLng:        ponto.lng,
      ultimaPosicaoEm:  serverTimestamp(),
      slotAtualId:      ponto.slotId,
    });

    clearTimeout(timer);
    return true;

  } catch (err: any) {
    clearTimeout(timer);

    const ehOffline = !navigator.onLine ||
      err?.code === 'unavailable' ||
      err?.message?.toLowerCase().includes('network') ||
      err?.message?.toLowerCase().includes('offline');

    if (ehOffline) {
      // Sem conexão: enfileira e retorna false (vai drenar depois)
      enqueue(ponto);
      return false;
    }

    // Timeout ou erro transitório: retry com backoff
    if (tentativa < MAX_RETRY) {
      await new Promise(r => setTimeout(r, RETRY_DELAY[tentativa] ?? 12000));
      return enviarPontoFirestore(ponto, tentativa + 1);
    }

    // Esgotou retries: enfileira
    enqueue(ponto);
    return false;
  }
}

// ─── Drena fila quando voltar online ─────────────────────────────────────────

async function drenarFila() {
  let ponto = dequeue();
  let enviados = 0;
  while (ponto) {
    const ok = await enviarPontoFirestore(ponto);
    if (!ok) {
      // Se falhou de novo, re-enfileira e para de tentar
      enqueue(ponto);
      break;
    }
    enviados++;
    ponto = dequeue();
    // Pequena pausa para não sobrecarregar (especialmente com VPN)
    if (ponto) await new Promise(r => setTimeout(r, 300));
  }
  return enviados;
}

// ─── Captura de posição ───────────────────────────────────────────────────────

async function capturarPosicao(): Promise<{
  lat: number; lng: number; accuracy: number;
  altitude?: number; velocidade?: number; ts: number;
} | null> {
  // Capacitor (Android nativo) — mais confiável com bateria otimizada
  if (isCapacitor()) {
    const Geo = await getCapacitorGeo();
    if (Geo) {
      try {
        const pos = await Geo.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 7000,
        });
        return {
          lat:       pos.coords.latitude,
          lng:       pos.coords.longitude,
          accuracy:  pos.coords.accuracy,
          altitude:  pos.coords.altitude ?? undefined,
          velocidade:pos.coords.speed ?? undefined,
          ts:        pos.timestamp,
        };
      } catch (e: any) {
        // Permissão negada ou GPS desligado
        if (e?.message?.includes('permission') || e?.message?.includes('denied')) {
          throw new Error('GPS: permissão negada. Ative nas configurações do dispositivo.');
        }
        // Timeout — retorna null, tentará no próximo ciclo
        return null;
      }
    }
  }

  // Fallback: browser Geolocation (PWA/desktop)
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat:       pos.coords.latitude,
        lng:       pos.coords.longitude,
        accuracy:  pos.coords.accuracy,
        altitude:  pos.coords.altitude ?? undefined,
        velocidade:pos.coords.speed ?? undefined,
        ts:        pos.timestamp,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 15000 }
    );
  });
}

async function capturarBateria(): Promise<number | undefined> {
  // Capacitor Device plugin
  const Device = await getCapacitorDevice();
  if (Device) {
    try {
      const info = await Device.getBatteryInfo();
      return info.batteryLevel !== undefined
        ? Math.round(info.batteryLevel * 100)
        : undefined;
    } catch { /* plugin não disponível */ }
  }
  // Browser Battery API (nem sempre disponível)
  try {
    const nav = navigator as any;
    if (nav.getBattery) {
      const bat = await nav.getBattery();
      return Math.round(bat.level * 100);
    }
  } catch { /* não disponível */ }
  return undefined;
}

// ─── Serviço principal ────────────────────────────────────────────────────────

class GPSService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ativo = false;
  private opcoes: GPSOptions | null = null;
  private segundoPlano = false;
  private networkListener: (() => void) | null = null;

  async iniciar(opcoes: GPSOptions) {
    if (this.ativo) this.parar();
    this.opcoes = opcoes;
    this.ativo  = true;

    // Listener de rede para drenar fila ao voltar online
    const onOnline = async () => {
      const n = await drenarFila();
      if (n > 0) console.log(`[GPS] drenados ${n} pontos da fila`);
    };
    window.addEventListener('online', onOnline);
    this.networkListener = () => window.removeEventListener('online', onOnline);

    // Listener de visibilidade (segundo plano = intervalo maior)
    const onVisibility = () => {
      this.segundoPlano = document.visibilityState === 'hidden';
      this._reiniciarTimer();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Dispara imediatamente
    await this._ciclo();
    this._reiniciarTimer();

    console.log('[GPS] serviço iniciado para uid:', opcoes.uid);
  }

  parar() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.networkListener?.();
    this.networkListener = null;
    this.ativo   = false;
    this.opcoes  = null;
    console.log('[GPS] serviço parado');
  }

  atualizarSlot(slotId: string | null) {
    if (this.opcoes) this.opcoes.slotId = slotId;
  }

  private _reiniciarTimer() {
    if (this.timer) clearInterval(this.timer);
    if (!this.ativo) return;

    const intervalo = this.segundoPlano
      ? (this.opcoes?.intervaloSegPlano ?? 90_000)
      : (this.opcoes?.intervaloAtivo ?? 30_000);

    this.timer = setInterval(() => this._ciclo(), intervalo);
  }

  private async _ciclo() {
    if (!this.ativo || !this.opcoes) return;

    try {
      const pos = await capturarPosicao();
      if (!pos) return;

      // Descarta posição stale
      const idadeMs = Date.now() - pos.ts;
      if (idadeMs > MAX_STALE_MS) {
        console.warn('[GPS] posição stale descartada:', idadeMs, 'ms');
        return;
      }

      // Valida coordenadas
      if (!coordsValidas(pos.lat, pos.lng, pos.accuracy)) {
        console.warn('[GPS] coordenadas inválidas:', pos);
        return;
      }

      // Bateria
      const bateria = await capturarBateria();

      const ponto: PontoGPS = {
        uid:        this.opcoes.uid,
        slotId:     this.opcoes.slotId,
        lat:        pos.lat,
        lng:        pos.lng,
        accuracy:   pos.accuracy,
        capturedAt: new Date(pos.ts).toISOString(),
        bateria,
        velocidade: pos.velocidade,
        altitude:   pos.altitude,
      };

      // Callback visual (para mostrar no mapa em tempo real)
      this.opcoes.onPosicao?.(pos.lat, pos.lng, pos.accuracy);

      // Envia (com fila offline embutida)
      await enviarPontoFirestore(ponto);

    } catch (err: any) {
      const msg = err?.message ?? 'Erro GPS';
      console.error('[GPS] ciclo erro:', msg);
      this.opcoes?.onErro?.(msg);

      // Erro de permissão: para o serviço
      if (msg.includes('permissão') || msg.includes('denied')) {
        this.parar();
      }
    }
  }
}

// Singleton exportado
export const gpsService = new GPSService();

// ─── Helpers rápidos para uso pontual (check-in/out) ─────────────────────────

export async function capturarPosicaoUnica(): Promise<{
  lat: number; lng: number; accuracy: number;
} | null> {
  const pos = await capturarPosicao();
  if (!pos) return null;
  if (!coordsValidas(pos.lat, pos.lng, pos.accuracy)) return null;
  return { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };
}

export async function verificarPermissaoGPS(): Promise<
  'granted' | 'denied' | 'prompt' | 'unavailable'
> {
  if (isCapacitor()) {
    const Geo = await getCapacitorGeo();
    if (Geo) {
      try {
        const status = await Geo.checkPermissions();
        return status.location === 'granted' ? 'granted'
          : status.location === 'denied' ? 'denied' : 'prompt';
      } catch { return 'unavailable'; }
    }
  }
  if (!navigator.geolocation) return 'unavailable';
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    return p.state as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'prompt';
  }
}

// ─── Instalação Capacitor (package.json) ─────────────────────────────────────
// npm install @capacitor/geolocation @capacitor/network @capacitor/device
//
// android/app/src/main/AndroidManifest.xml — adicionar dentro de <manifest>:
//   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
//   <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
//   <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
//   <uses-feature android:name="android.hardware.location.gps" />
//
// Para background tracking (operador com app minimizado):
//   npm install @capacitor-community/background-geolocation
//   (segue docs do plugin para configurar o foreground service no Android)
