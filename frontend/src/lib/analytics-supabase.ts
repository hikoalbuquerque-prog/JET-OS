// frontend/src/lib/analytics-supabase.ts
//
// Camada de analytics lendo do Postgres (Supabase) via RPC, em vez de agregar no
// cliente sobre o Firestore. Migração #3 (DEBRIEF 14.6): "o SQL paga o investimento".
// Dual-run: use atrás do flag VITE_ANALYTICS_PROVIDER === 'supabase'; senão mantém
// o cálculo client-side atual (Firestore).

import { supabase } from './supabase';

export const analyticsProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_analytics_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_ANALYTICS_PROVIDER as string) !== 'firebase';
};

export type Periodo = '7d' | '30d' | '90d' | 'todos';

export interface RegionalRow {
  regiao: string; filial: string;
  patinetes: number; bicicletas: number; baterias: number; outros: number;
  total: number; recuperados: number;
}

// 'todos' => sem corte de data; demais => agora - N dias (ISO).
function desdeDe(p: Periodo): string | null {
  if (p === 'todos') return null;
  const dias = p === '7d' ? 7 : p === '30d' ? 30 : 90;
  return new Date(Date.now() - dias * 864e5).toISOString();
}

// Ocorrências agregadas por região/filial (RegionalRow[]) — espelha o PainelRoubos.
export async function fetchOcorrenciasRegional(opts: {
  periodo?: Periodo; tipo?: string | null; status?: string | null; cidade?: string | null;
} = {}): Promise<RegionalRow[]> {
  const { data, error } = await supabase.rpc('analytics_ocorrencias', {
    p_desde: desdeDe(opts.periodo ?? 'todos'),
    p_tipo: opts.tipo ?? null,
    p_status: opts.status ?? null,
    p_cidade: opts.cidade ?? null,
  });
  if (error) throw new Error('analytics_ocorrencias: ' + error.message);
  return (data ?? []).map((r: any) => ({
    regiao: r.regiao, filial: r.filial,
    patinetes: Number(r.patinetes), bicicletas: Number(r.bicicletas),
    baterias: Number(r.baterias), outros: Number(r.outros),
    total: Number(r.total), recuperados: Number(r.recuperados),
  }));
}

// Heatmap GPS: pontos binados [lat, lng, weight] — para o GpsHeatmapPanel.
export async function fetchGpsHeatmap(opts: {
  periodo?: Periodo; desde?: string | null; cidade?: string | null; limit?: number;
} = {}): Promise<[number, number, number][]> {
  const p_desde = opts.desde !== undefined ? opts.desde : desdeDe(opts.periodo ?? 'todos');
  const { data, error } = await supabase.rpc('analytics_gps_heatmap', {
    p_desde,
    p_cidade: opts.cidade ?? null,
    p_limit: opts.limit ?? 2000,
  });
  if (error) throw new Error('analytics_gps_heatmap: ' + error.message);
  return (data ?? []).map((r: any) => [Number(r.lat), Number(r.lng), Number(r.weight)]);
}

export interface PerdasRow {
  regiao: string; filial: string;
  vandalismo: number; roubo: number; furto: number; nao_encontrado: number;
  outros: number; recuperados: number; total: number;
}

// Perdas por região/filial (PainelControlePerdasSeg). Para janelas 24h/BRPD,
// chame com o p_desde apropriado (ex.: início do dia) e some os buckets.
export async function fetchPerdas(opts: {
  periodo?: Periodo; desde?: string | null; cidade?: string | null;
} = {}): Promise<PerdasRow[]> {
  const p_desde = opts.desde !== undefined ? opts.desde : desdeDe(opts.periodo ?? 'todos');
  const { data, error } = await supabase.rpc('analytics_perdas', {
    p_desde, p_cidade: opts.cidade ?? null,
  });
  if (error) throw new Error('analytics_perdas: ' + error.message);
  return (data ?? []).map((r: any) => ({
    regiao: r.regiao, filial: r.filial,
    vandalismo: Number(r.vandalismo), roubo: Number(r.roubo), furto: Number(r.furto),
    nao_encontrado: Number(r.nao_encontrado), outros: Number(r.outros),
    recuperados: Number(r.recuperados), total: Number(r.total),
  }));
}

// GoJet: carrega os arrays de parkings/bikes do Postgres (coluna `dados` = objeto
// cru do GoJet). Substitui o snapshot chunked do Firestore; a lógica do painel
// (classifyBike/KPIs/zonas) consome os mesmos objetos. parking ganha availableCount
// (= bikes_disponiveis, calculado no scrape).
export async function fetchGojetSnapshot(cidade: string): Promise<{
  parkings: any[]; bikes: any[]; savedAtMs: number | null;
}> {
  const { data: cfg } = await supabase.from('gojet_config').select('city_id').eq('cidade', cidade).maybeSingle();
  const cityId = (cfg as any)?.city_id;
  if (!cityId) return { parkings: [], bikes: [], savedAtMs: null };

  const pageAll = async (tbl: string, cols: string): Promise<any[]> => {
    const out: any[] = []; let from = 0; const N = 1000;
    for (;;) {
      const { data, error } = await supabase.from(tbl).select(cols).eq('city_id', cityId).range(from, from + N - 1);
      if (error) throw new Error(`${tbl}: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < N) break;
      from += N;
    }
    return out;
  };

  const pr = await pageAll('parkings', 'dados, bikes_disponiveis, atualizado_em');
  const br = await pageAll('bikes', 'dados');
  const parkings = pr.map((r) => ({ ...(r.dados ?? {}), availableCount: r.bikes_disponiveis }));
  const bikes = br.map((r) => r.dados ?? {});
  const savedAtMs = pr.reduce((m: number | null, r: any) => {
    const t = Date.parse(r.atualizado_em); return (!m || t > m) ? t : m;
  }, null as number | null);
  return { parkings, bikes, savedAtMs };
}

// GoJet: pontos atualmente vazios com HÁ QUANTO TEMPO estão vazios (duração em minutos),
// via RPC parkings_empty_summary (migration 0044). O snapshot só diz QUE está vazio; isto
// usa parking_history (série temporal) para dizer DESDE QUANDO. Já vem ordenado por duração
// (mais urgente primeiro). Resolve cidade→city_id pelo mesmo gojet_config do snapshot.
export interface PontoVazio {
  parking_id: string;
  nome: string;
  is_monitor: boolean;
  empty_since: string | null;
  empty_minutes: number;
}
export async function fetchPontosVazios(cidade: string): Promise<PontoVazio[]> {
  const { data: cfg } = await supabase.from('gojet_config').select('city_id').eq('cidade', cidade).maybeSingle();
  const cityId = (cfg as any)?.city_id;
  if (!cityId) return [];
  const { data, error } = await supabase.rpc('parkings_empty_summary', { p_city_id: cityId });
  if (error) { console.warn('[analytics] parkings_empty_summary:', error.message); return []; }
  return (data ?? []) as PontoVazio[];
}

// KPIs globais do período (soma das linhas) — para os cards do topo.
export async function fetchOcorrenciasKpis(opts: {
  periodo?: Periodo; tipo?: string | null; status?: string | null; cidade?: string | null;
} = {}) {
  const rows = await fetchOcorrenciasRegional(opts);
  return rows.reduce((a, r) => ({
    patinetes: a.patinetes + r.patinetes, bicicletas: a.bicicletas + r.bicicletas,
    baterias: a.baterias + r.baterias, outros: a.outros + r.outros,
    total: a.total + r.total, recuperados: a.recuperados + r.recuperados,
  }), { patinetes: 0, bicicletas: 0, baterias: 0, outros: 0, total: 0, recuperados: 0 });
}
