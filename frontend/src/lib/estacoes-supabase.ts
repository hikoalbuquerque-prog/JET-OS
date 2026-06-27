// frontend/src/lib/estacoes-supabase.ts
// Fase 2 — leitura de estações do Supabase (dual-run, atrás de flag).
// Lê a view estacoes_geo (lat/lng numéricos da coluna geography, ver migration 0027).
// Requer sessão JS autenticada (ver supabase.ts / supabase-auth.ts — sessão A gerenciada).

import { supabase } from './supabase';

// Flag de teste SEM rebuild: no browser, `localStorage.setItem('jet_mapa_provider','supabase')`
// liga só pra você; remover/`'firebase'` volta ao Firestore. (Ou build com VITE_MAPA_PROVIDER=supabase.)
export const mapaProviderSupabase = (): boolean => {
  try { const v = localStorage.getItem('jet_mapa_provider'); if (v === 'supabase') return true; if (v === 'firebase') return false; } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_MAPA_PROVIDER as string) !== 'firebase';
};

// Carrega as estações de uma cidade do Supabase, no MESMO formato que o app usa
// (id = firebase_id, p/ compatibilidade com os writes que ainda vão pro Firestore).
export async function carregarEstacoesSupabase(cidade: string): Promise<any[]> {
  const PAGE = 1000;
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('estacoes_geo').select('*').eq('cidade', cidade).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all.map((r: any) => ({
    id: r.firebase_id ?? r.id,
    codigo: r.codigo, cidade: r.cidade, pais: r.pais, bairro: r.bairro, endereco: r.endereco,
    tipo: r.tipo, status: r.status, imagens: r.imagens ?? {}, croquiStatus: r.croqui_status,
    lat: r.lat, lng: r.lng,
  }));
}

// ── Zonas (polígonos) — lê zonas_geo (GeoJSON) e reconstrói os vértices [{lat,lng}] ──
export async function carregarZonasSupabase(cidades: string[]): Promise<any[]> {
  let q = supabase.from('zonas_geo').select('*');
  const cs = (cidades || []).map(c => c.trim()).filter(Boolean);
  if (cs.length) q = q.in('cidade', cs.slice(0, 10));
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => {
    let pontos: { lat: number; lng: number }[] = [];
    try {
      const gj = typeof r.geojson === 'string' ? JSON.parse(r.geojson) : r.geojson;
      const ring = gj?.coordinates?.[0] || [];   // anel externo: [[lng,lat],...]
      pontos = ring.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    } catch { /* geojson inválido */ }
    return {
      id: r.firebase_id ?? r.id, nome: r.nome, grupo: r.grupo, fase: r.fase, cor: r.cor,
      ativo: r.ativo, cidade: r.cidade, pais: r.pais, prioridade: r.prioridade,
      pontos, poligono: pontos,   // ambos os nomes de campo que o app usa
    };
  });
}

// ── Locais operacionais — lê locais_geo (lat/lng) ──
export async function carregarLocaisSupabase(): Promise<any[]> {
  const { data, error } = await supabase.from('locais_geo').select('*');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.firebase_id ?? r.id, nome: r.nome, tipo: r.tipo, cidade: r.cidade,
    pais: r.pais, obs: r.obs, observacoes: r.obs, lat: r.lat, lng: r.lng,
  }));
}
