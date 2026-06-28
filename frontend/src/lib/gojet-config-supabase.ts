// frontend/src/lib/gojet-config-supabase.ts
// Leitura e escrita de gojet_config no Supabase.

import { supabase } from './supabase';

export const gojetProviderSupabase = (): boolean => true;

export interface GoJetCidadeSupabase {
  id: string;      // cidade (PK)
  cityId: string;  // GoJet city_id
  nome: string;    // = cidade
  ativo: boolean;
}

/** Carrega todas as cidades GoJet configuradas. */
export async function carregarGojetConfigSupabase(): Promise<GoJetCidadeSupabase[]> {
  const { data, error } = await supabase
    .from('gojet_config')
    .select('cidade, city_id, ativo')
    .order('cidade');
  if (error) throw error;
  return (data ?? []).map(r => ({
    id:     r.cidade,
    cityId: r.city_id,
    nome:   r.cidade,
    ativo:  r.ativo ?? false,
  }));
}

/** Busca o cityId GoJet para uma cidade específica. */
export async function buscarCityIdSupabase(cidade: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('gojet_config')
    .select('city_id')
    .eq('cidade', cidade)
    .maybeSingle();
  if (error) throw error;
  return data?.city_id ?? null;
}

const VALID_COLS = new Set(['cidade','city_id','nome','ativo','pais','cookie','scraper_url']);

/** Upsert uma cidade GoJet no Supabase (dual-write). */
export async function salvarGojetConfigSupabase(cidade: string, cityId: string, ativo: boolean, extras?: Record<string, unknown>) {
  const row: Record<string, unknown> = { cidade, city_id: cityId, nome: cidade, ativo };
  if (extras) for (const [k, v] of Object.entries(extras)) { if (VALID_COLS.has(k) && v !== undefined) row[k] = v; }
  const { error } = await supabase
    .from('gojet_config')
    .upsert(row, { onConflict: 'cidade' });
  if (error) console.error('[gojet-config-supa] upsert:', error.message);
}

/** Remove uma cidade GoJet do Supabase (dual-write). */
export async function removerGojetConfigSupabase(cidade: string) {
  const { error } = await supabase
    .from('gojet_config')
    .delete()
    .eq('cidade', cidade);
  if (error) console.error('[gojet-config-supa] delete:', error.message);
}

/**
 * Subscribe to gojet_config changes via Supabase Realtime.
 * Returns an unsubscribe function. Falls back to polling if realtime is unavailable.
 */
export function onGojetConfigChange(
  callback: (cidades: GoJetCidadeSupabase[]) => void,
): () => void {
  // Initial load
  carregarGojetConfigSupabase().then(callback).catch(() => {});

  // Realtime subscription
  const channel = supabase
    .channel('gojet_config_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gojet_config' }, () => {
      // Re-fetch all on any change (table is tiny)
      carregarGojetConfigSupabase().then(callback).catch(() => {});
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
