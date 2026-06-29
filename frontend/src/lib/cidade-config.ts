// frontend/src/lib/cidade-config.ts
// CRUD para cidade_config (tabela nova que substitui gojet_config).
// Mantém interface compatível com gojet-config-supabase.ts para migração gradual.

import { supabase } from './supabase';

export interface CidadeConfig {
  id: string;          // GoJet city_id ou '_default'
  nome: string;
  timezone: string;
  ativo: boolean;
  gojet_removida: boolean;
  config: Record<string, any>;
  zonas_importadas: boolean;
  total_bikes: number | null;
  total_parkings: number | null;
  total_zones: number | null;
  ultima_sync: string | null;
}

export interface GoJetCidadeSupabase {
  id: string;
  cityId: string;
  nome: string;
  ativo: boolean;
}

const TABLE = 'cidade_config';

export async function carregarCidadeConfig(): Promise<CidadeConfig[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .neq('id', '_default')
    .order('ativo', { ascending: false })
    .order('nome');
  if (error) throw error;
  return (data ?? []) as CidadeConfig[];
}

export async function carregarConfigDefault(): Promise<Record<string, any>> {
  const { data } = await supabase
    .from(TABLE)
    .select('config')
    .eq('id', '_default')
    .single();
  return data?.config ?? {};
}

export async function carregarCidadesAtivas(): Promise<CidadeConfig[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  return (data ?? []) as CidadeConfig[];
}

export async function toggleCidadeAtiva(id: string, ativo: boolean): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ ativo })
    .eq('id', id);
  if (error) throw error;

  if (ativo) {
    try { await importZonas(id); } catch (e) {
      console.error('[cidade-config] auto-import zones failed:', e);
    }
  }
}

export async function atualizarConfigCidade(
  id: string,
  config: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ config })
    .eq('id', id);
  if (error) throw error;
}

export async function syncCidadesGoJet(): Promise<{
  total: number;
  novas: number;
  novasNomes: string[];
}> {
  // Browser-side fetch (Cloudflare blocks server-side)
  const res = await fetch('https://logistic.gojet.app/api/v0/urent/cities');
  if (!res.ok) throw new Error(`GoJet /cities: HTTP ${res.status}`);
  const cities = await res.json();
  if (!Array.isArray(cities) || cities.length === 0) throw new Error('GoJet /cities returned empty');

  const { data: existing } = await supabase
    .from(TABLE)
    .select('id, nome, ativo')
    .neq('id', '_default');
  const existingIds = new Set((existing ?? []).map(c => c.id));

  const novas: string[] = [];
  const now = new Date().toISOString();

  for (const c of cities) {
    const id = c._id || c.id;
    const nome = c.name;
    const tz = c.timezone || 'America/Sao_Paulo';

    if (existingIds.has(id)) {
      await supabase.from(TABLE)
        .update({ nome, timezone: tz, gojet_removida: false, ultima_sync: now })
        .eq('id', id);
      existingIds.delete(id);
    } else {
      await supabase.from(TABLE).upsert({
        id, nome, timezone: tz,
        ativo: false, gojet_removida: false, ultima_sync: now,
      });
      novas.push(nome);
    }
  }

  for (const orphanId of existingIds) {
    await supabase.from(TABLE)
      .update({ gojet_removida: true, ultima_sync: now })
      .eq('id', orphanId);
  }

  return { total: cities.length, novas: novas.length, novasNomes: novas };
}

export async function importZonas(cityId: string): Promise<{
  imported: number;
  total: number;
}> {
  const res = await fetch(`https://logistic.gojet.app/api/v0/urent/techzones?city_id=${cityId}`);
  if (!res.ok) throw new Error(`GoJet techzones: HTTP ${res.status}`);
  const zones = await res.json();

  if (!Array.isArray(zones) || zones.length === 0) {
    await supabase.from(TABLE)
      .update({ zonas_importadas: true, total_zones: 0 })
      .eq('id', cityId);
    return { imported: 0, total: 0 };
  }

  let imported = 0;
  for (const z of zones) {
    const zoneId = z._id || z.id;
    try {
      const dr = await fetch(`https://logistic.gojet.app/api/v0/urent/techzones/${zoneId}`);
      if (!dr.ok) continue;
      const detail = await dr.json();
      const coords = (detail.coordinates || []).map((p: any) => [
        p.lon ?? p.lng ?? p.longitude,
        p.lat ?? p.latitude,
      ]);
      if (coords.length < 3) continue;
      if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0]);
      }
      const geometry = { type: 'Polygon', coordinates: [coords] };

      const { error } = await supabase.from('zones').upsert(
        { name: detail.name || z.name, city: cityId, geometry, gojet_zone_id: zoneId },
        { onConflict: 'city,gojet_zone_id' },
      );
      if (!error) imported++;
    } catch {}
  }

  await supabase.from(TABLE)
    .update({ zonas_importadas: true, total_zones: imported })
    .eq('id', cityId);

  return { imported, total: zones.length };
}

export async function fetchActivity(
  cityId: string,
  date?: string
): Promise<{ inserted: number }> {
  // TODO: migrate to browser-side when needed
  const { data, error } = await supabase.functions.invoke('sync-gojet-cities', {
    body: { action: 'fetch-activity', city_id: cityId, date },
  });
  if (error) throw error;
  return data;
}

/** Busca o cityId GoJet para uma cidade pelo nome (cidade_config.id = GoJet city_id). */
export async function buscarCityId(cidade: string): Promise<string | null> {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/-/g, ' ').toLowerCase().trim();
  const { data: all } = await supabase
    .from(TABLE)
    .select('id, nome')
    .eq('ativo', true)
    .neq('id', '_default');
  if (!all?.length) return null;
  const key = norm(cidade);
  const exact = all.find(r => norm(r.nome) === key);
  if (exact) return exact.id;
  const partial = all.find(r => norm(r.nome).includes(key) || key.includes(norm(r.nome)));
  return partial?.id ?? null;
}

// Retrocompatibilidade com gojet-config-supabase.ts
export function cidadeConfigToLegacy(c: CidadeConfig): GoJetCidadeSupabase {
  return { id: c.nome, cityId: c.id, nome: c.nome, ativo: c.ativo };
}

export function onCidadeConfigChange(
  callback: (cidades: CidadeConfig[]) => void,
): () => void {
  carregarCidadeConfig().then(callback).catch(() => {});
  const channel = supabase
    .channel('cidade_config_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
      carregarCidadeConfig().then(callback).catch(() => {});
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
