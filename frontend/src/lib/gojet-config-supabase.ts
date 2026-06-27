// frontend/src/lib/gojet-config-supabase.ts
// Fase 2 / Onda H — leitura de gojet_config do Supabase (dual-run, atrás de flag).
// Escrita ainda Firestore; mirror (espelharGojetConfigSupabase) popula.
// Requer sessão JS autenticada (RLS) — ver supabase.ts / supabase-auth.ts (sessão A).

import { supabase } from './supabase';

// Flag por browser SEM rebuild: `localStorage.setItem('jet_gojet_provider','supabase')`
// liga só pra você; `'firebase'` (ou remover) volta ao Firestore.
// (Ou build com VITE_GOJET_PROVIDER=supabase.)
export const gojetProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_gojet_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_GOJET_PROVIDER as string) !== 'firebase';
};

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
