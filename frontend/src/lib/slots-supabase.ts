// frontend/src/lib/slots-supabase.ts
// Camada de slots no Supabase (cutover do SlotsModule). Leitura via polling com
// interface estilo onSnapshot (callback + unsubscribe) e mutações via RPC
// (aceitar/check-in/check-out/cancelar/reatribuir). Atrás do flag
// VITE_ANALYTICS_PROVIDER === 'supabase' (mesmo flag do restante da migração).

import { supabase } from './supabase';

export const slotsProviderSupabase = () =>
  (import.meta.env.VITE_ANALYTICS_PROVIDER as string) === 'supabase';

// linha do Postgres -> forma Slot que o SlotsModule consome
function mapRow(r: any): any {
  const c = r.config ?? {};
  return {
    id: r.id, status: r.status, cargo: r.tipo, cidade: r.cidade, pais: c.pais ?? null,
    titulo: c.titulo ?? null, zonaOrigem: c.zona_origem ?? null, turno: c.turno ?? null,
    turnoInicio: r.inicio, turnoFim: r.fim,
    aceitoPor: r.aceito_por ?? null, aceitoPorNome: r.aceito_por_nome ?? null, aceitoEm: r.aceito_em ?? null,
    checkInEm: r.check_in_em ?? null, checkInLat: r.check_in_lat ?? null, checkInLng: r.check_in_lng ?? null,
    checkOutEm: r.check_out_em ?? null,
    geradoAutomatico: c.gerado_automatico ?? true, tarefasIds: [], criadoEm: r.criado_em,
  };
}

export async function fetchSlots(opts: { cidade: string; isAdmin: boolean; cargo?: string }): Promise<any[]> {
  let q = supabase.from('slots').select('*').eq('cidade', opts.cidade);
  if (opts.isAdmin) {
    q = q.order('criado_em', { ascending: false });
  } else {
    const cargos = [opts.cargo ?? '', 'scout', 'charger'].filter(Boolean);
    q = q.in('tipo', cargos).order('inicio', { ascending: true });
  }
  const { data, error } = await q.limit(2000);
  if (error) throw new Error('fetchSlots: ' + error.message);
  return (data ?? []).map(mapRow);
}

// Interface estilo onSnapshot: chama cb com a lista e re-busca a cada intervalo.
export function subscribeSlots(
  opts: { cidade: string; isAdmin: boolean; cargo?: string; intervaloMs?: number },
  cb: (slots: any[]) => void,
): () => void {
  let vivo = true;
  const carregar = () => fetchSlots(opts).then(s => { if (vivo) cb(s); }).catch(e => console.warn('[slots-supa]', e?.message));
  carregar();
  const t = setInterval(carregar, opts.intervaloMs ?? 8000);
  return () => { vivo = false; clearInterval(t); };
}

const rpc = async (fn: string, args: any) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};

export const aceitarSlotSupa    = (slotId: string) => rpc('aceitar_slot', { p_slot_id: slotId });
export const checkInSlotSupa    = (slotId: string, lat?: number | null, lng?: number | null, accuracy?: number | null) =>
  rpc('check_in_slot', { p_slot_id: slotId, p_lat: lat ?? null, p_lng: lng ?? null, p_accuracy: accuracy ?? null });
export const checkOutSlotSupa   = (slotId: string) => rpc('check_out_slot', { p_slot_id: slotId });
export const cancelarSlotSupa   = (slotId: string) => rpc('cancelar_slot', { p_slot_id: slotId });
export const reatribuirSlotSupa = (slotId: string, novoUid: string) =>
  rpc('reatribuir_slot', { p_slot_id: slotId, p_novo_uid: novoUid });
