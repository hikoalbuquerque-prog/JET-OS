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
    // Auto-import zones on activation
    try {
      await supabase.functions.invoke('sync-gojet-cities', {
        body: { action: 'import-zones', city_id: id },
      });
    } catch (e) {
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
  const { data, error } = await supabase.functions.invoke('sync-gojet-cities', {
    body: { action: 'sync' },
  });
  if (error) throw error;
  return data;
}

export async function importZonas(cityId: string): Promise<{
  imported: number;
  total: number;
}> {
  const { data, error } = await supabase.functions.invoke('sync-gojet-cities', {
    body: { action: 'import-zones', city_id: cityId },
  });
  if (error) throw error;
  return data;
}

export async function fetchActivity(
  cityId: string,
  date?: string
): Promise<{ inserted: number }> {
  const { data, error } = await supabase.functions.invoke('sync-gojet-cities', {
    body: { action: 'fetch-activity', city_id: cityId, date },
  });
  if (error) throw error;
  return data;
}

/** Busca o cityId GoJet para uma cidade pelo nome. */
export async function buscarCityId(cidade: string): Promise<string | null> {
  const { data } = await supabase
    .from('gojet_config')
    .select('city_id')
    .eq('cidade', cidade)
    .maybeSingle();
  if (data?.city_id) return data.city_id;
  // Fallback: busca todas e compara sem acentos
  const { data: all } = await supabase
    .from('gojet_config')
    .select('city_id, cidade');
  if (!all?.length) return null;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/-/g, ' ').toLowerCase().trim();
  const key = norm(cidade);
  const match = all.find(r => norm(r.cidade) === key)
    || all.find(r => norm(r.cidade).includes(key) || key.includes(norm(r.cidade)));
  return match?.city_id ?? null;
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
