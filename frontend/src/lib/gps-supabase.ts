// frontend/src/lib/gps-supabase.ts
// Fase 2 / Onda D — leitura GPS do Supabase (dual-run, atrás de flag).
// Lê as views gps_locations_v e gps_history_v (migration 0057) que expõem
// lat/lng numéricos + firebase_uid (join c/ usuarios).
// ESCRITA já vai para Supabase via Edge Fn ingest-gps desde a Fase 1.

import { supabase } from './supabase';

// ─── Flag ────────────────────────────────────────────────────────────────────
// localStorage: `jet_gps_read_provider` = 'supabase' | 'firebase'
// Env build-time: VITE_GPS_PROVIDER (default = supabase)
export const gpsProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_gps_read_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_GPS_PROVIDER as string) !== 'firebase';
};

// ─── Tipos ───────────────────────────────────────────────────────────────────
// Shape compatível com o que os componentes esperam (Worker / GPS / Ponto)
// criadoEm imita o Firestore Timestamp (com .seconds e .toDate())

export interface GpsPonto {
  uid: string;          // firebase_uid (string, não uuid)
  lat: number;
  lng: number;
  criadoEm: { seconds: number; toDate: () => Date };
  velocidade?: number | null;
  bateria?: number | null;
  accuracy?: number | null;
  cidade?: string;
  nome?: string;
  slotId?: string;
  isMock?: boolean;
  role?: string;
}

function fakeTs(iso: string): { seconds: number; toDate: () => Date } {
  const d = new Date(iso);
  return { seconds: Math.floor(d.getTime() / 1000), toDate: () => d };
}

// ─── fetchGpsAtual ───────────────────────────────────────────────────────────
// Para LiveTrackingMap + LiveWorkersPanel: último ponto por worker
export async function fetchGpsAtual(janelaMin = 60): Promise<GpsPonto[]> {
  const desde = new Date(Date.now() - janelaMin * 60_000).toISOString();
  const { data, error } = await supabase
    .from('gps_locations_v')
    .select('*')
    .gte('captured_at', desde)
    .order('captured_at', { ascending: false })
    .limit(300);
  if (error) { console.warn('[gps-supabase] fetchGpsAtual', error); return []; }
  return (data ?? [])
    .filter((r: any) => r.firebase_uid)   // sem firebase_uid → usuário não mapeado
    .map((r: any) => ({
      uid: r.firebase_uid,
      lat: r.lat,
      lng: r.lng,
      criadoEm: fakeTs(r.captured_at),
      velocidade: r.speed ?? null,
      bateria: r.bateria ?? null,
      accuracy: r.accuracy ?? null,
      cidade: '',       // view não tem cidade — filtro feito pelo caller
      nome: r.nome ?? '',
      slotId: r.slot_id ?? undefined,
      isMock: r.is_mock ?? false,
    }));
}

// ─── fetchGpsRota ────────────────────────────────────────────────────────────
// Para GpsRotaPanel: rota histórica de um prestador num dia
// Recebe firebase_uid (o que o frontend tem). Precisa resolver p/ uuid Supabase.
export async function fetchGpsRota(firebaseUid: string, dataStr: string): Promise<GpsPonto[]> {
  const ini = dataStr + 'T00:00:00';
  const fim = dataStr + 'T23:59:59';
  const { data, error } = await supabase
    .from('gps_history_v')
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .gte('captured_at', ini)
    .lte('captured_at', fim)
    .order('captured_at', { ascending: true })
    .limit(500);
  if (error) { console.warn('[gps-supabase] fetchGpsRota', error); return []; }
  return (data ?? []).map((r: any) => ({
    uid: r.firebase_uid,
    lat: r.lat,
    lng: r.lng,
    criadoEm: fakeTs(r.captured_at),
    velocidade: null,
    accuracy: r.accuracy ?? null,
  }));
}

// ─── fetchGpsHist ────────────────────────────────────────────────────────────
// Para GestorLogisticaPanel: histórico de worker nas últimas N horas
export async function fetchGpsHist(firebaseUid: string, horasAtras = 8): Promise<GpsPonto[]> {
  const desde = new Date(Date.now() - horasAtras * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from('gps_history_v')
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .gte('captured_at', desde)
    .order('captured_at', { ascending: true })
    .limit(200);
  if (error) { console.warn('[gps-supabase] fetchGpsHist', error); return []; }
  return (data ?? []).map((r: any) => ({
    uid: r.firebase_uid,
    lat: r.lat,
    lng: r.lng,
    criadoEm: fakeTs(r.captured_at),
    velocidade: null,
    accuracy: r.accuracy ?? null,
  }));
}

// ─── fetchWorkerPos ──────────────────────────────────────────────────────────
// Para SlotsModule: última posição de um worker (por firebase_uid)
export async function fetchWorkerPos(
  firebaseUid: string,
): Promise<{ lat: number; lng: number; idadeS: number; bateria: number | null } | null> {
  const desde = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data, error } = await supabase
    .from('gps_locations_v')
    .select('lat,lng,bateria,captured_at')
    .eq('firebase_uid', firebaseUid)
    .gte('captured_at', desde)
    .order('captured_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const r = data[0] as any;
  return {
    lat: r.lat,
    lng: r.lng,
    idadeS: Math.floor((Date.now() - new Date(r.captured_at).getTime()) / 1000),
    bateria: r.bateria ?? null,
  };
}
