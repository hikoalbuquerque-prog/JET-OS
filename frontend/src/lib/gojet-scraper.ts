// frontend/src/lib/gojet-scraper.ts
// Scraping direto da API GoJet pelo browser (sem proxy).
// Funciona porque a API tem CORS aberto (access-control-allow-origin: *).
// Usado pelo botão "Atualizar agora" no GoJetOverlay.

import { supabase } from './supabase';

const GOJET_BASE = 'https://logistic.gojet.app/api/v0/urent';
const LIMIT = 1000;

async function fetchAllPages<T>(endpoint: string, cityId: string): Promise<T[]> {
  let page = 1;
  let all: T[] = [];
  let totalPages = 1;

  do {
    const url = `${GOJET_BASE}/${endpoint}?city_id=${cityId}&page=${page}&limit=${LIMIT}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`GoJet ${endpoint} p${page}: HTTP ${res.status}`);
    const data = await res.json();
    const items: T[] = data.entries ?? data.items ?? data.data ?? (Array.isArray(data) ? data : []);
    all = all.concat(items);
    totalPages = data.total_pages ?? 1;
    page++;
  } while (page <= totalPages && page <= 50);

  return all;
}

async function salvarNoSupabase(
  parkings: any[], bikes: any[], cityId: string, cidade: string
): Promise<void> {
  const now = new Date().toISOString();

  const { error: errP } = await supabase.from('gojet_snapshots').upsert({
    id: `latest_${cityId}`,
    parkings,
    city_id: cityId,
    cidade,
    total_parkings: parkings.length,
    saved_at: now,
  }, { onConflict: 'id' });
  if (errP) console.error('[gojet-scraper] erro ao salvar parkings:', errP);

  const { error: errB } = await supabase.from('gojet_snapshots').upsert({
    id: `bikes_latest_${cityId}`,
    bikes,
    city_id: cityId,
    cidade,
    total_bikes: bikes.length,
    saved_at: now,
  }, { onConflict: 'id' });
  if (errB) console.error('[gojet-scraper] erro ao salvar bikes:', errB);
}

export async function scraperGoJetBrowser(cityId: string, cidade: string): Promise<{
  totalParkings: number; totalBikes: number;
}> {
  const [parkings, bikes] = await Promise.all([
    fetchAllPages<any>('parkings', cityId),
    fetchAllPages<any>('bikes',    cityId),
  ]);

  await salvarNoSupabase(parkings, bikes, cityId, cidade);

  return { totalParkings: parkings.length, totalBikes: bikes.length };
}
