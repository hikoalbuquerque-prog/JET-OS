// frontend/src/lib/slots-supabase.ts
// Camada de slots no Supabase (cutover do SlotsModule). Leitura via polling com
// interface estilo onSnapshot (callback + unsubscribe) e mutações via RPC
// (aceitar/check-in/check-out/cancelar/reatribuir). Atrás do flag
// VITE_ANALYTICS_PROVIDER === 'supabase' (mesmo flag do restante da migração).

import { supabase } from './supabase';

export const slotsProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_slots_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_SLOTS_PROVIDER as string) === 'supabase';
};

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

// ── CRUD direto (sem RPC) ───────────────────────────────────────────────────

export async function criarSlotSupa(data: Record<string, any>): Promise<string> {
  const { data: row, error } = await supabase.from('slots').insert(data).select('id').single();
  if (error) throw new Error('criarSlotSupa: ' + error.message);
  return row.id;
}

export async function criarTarefaSupa(data: Record<string, any>): Promise<string> {
  const { data: row, error } = await supabase.from('tarefas').insert(data).select('id').single();
  if (error) throw new Error('criarTarefaSupa: ' + error.message);
  return row.id;
}

export async function atualizarSlotSupa(id: string, data: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('slots').update(data).eq('id', id);
  if (error) throw new Error('atualizarSlotSupa: ' + error.message);
}

export async function atualizarTarefaSupa(id: string, data: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('tarefas').update(data).eq('id', id);
  if (error) throw new Error('atualizarTarefaSupa: ' + error.message);
}

// Tarefas polling (mesmo padrão de subscribeSlots)
export async function fetchTarefas(opts: { cidade: string; pais?: string; isAdmin: boolean; uid?: string }): Promise<any[]> {
  let q = supabase.from('tarefas').select('*');
  if (opts.isAdmin) {
    q = q.eq('cidade', opts.cidade);
    if (opts.pais) q = q.eq('pais', opts.pais);
    q = q.order('criado_em', { ascending: false });
  } else {
    q = q.eq('assignee_uid', opts.uid ?? '').in('status', ['pendente', 'aceita', 'em_andamento']).order('rota_ordem', { ascending: true });
  }
  const { data, error } = await q.limit(2000);
  if (error) throw new Error('fetchTarefas: ' + error.message);
  return (data ?? []).map(mapTarefaRow);
}

function mapTarefaRow(r: any): any {
  return {
    id: r.id, tipo: r.tipo, tipoSlot: r.tipo_slot, status: r.status,
    prioridade: r.prioridade, titulo: r.titulo, cargo: r.cargo,
    cidade: r.cidade, pais: r.pais, slotId: r.slot_id,
    assigneeUid: r.assignee_uid, assigneeNome: r.assignee_nome,
    qtdAlvo: r.qtd_alvo, qtdConcluida: r.qtd_concluida,
    entregas: r.entregas ?? [], rotaOrdem: r.rota_ordem,
    criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
    fotoUrl: r.foto_url ?? null, fotoChegadaUrl: r.foto_chegada_url ?? null,
    aCaminhoEm: r.a_caminho_em ?? null, iniciadoEm: r.iniciado_em ?? null,
    chegadaEm: r.chegada_em ?? null, concluidoEm: r.concluido_em ?? null,
    canceladoEm: r.cancelado_em ?? null,
    patineteSugeridas: r.patinete_sugeridas ?? [],
    estacao: r.estacao ?? null, estacaoOrigem: r.estacao_origem ?? null,
  };
}

export function subscribeTarefas(
  opts: { cidade: string; pais?: string; isAdmin: boolean; uid?: string; intervaloMs?: number },
  cb: (tarefas: any[]) => void,
): () => void {
  let vivo = true;
  const carregar = () => fetchTarefas(opts).then(t => { if (vivo) cb(t); }).catch(e => console.warn('[tarefas-supa]', e?.message));
  carregar();
  const t = setInterval(carregar, opts.intervaloMs ?? 8000);
  return () => { vivo = false; clearInterval(t); };
}

export async function fetchLogSlotsAuto(cidade: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('log_slots_auto')
    .select('*')
    .eq('cidade', cidade)
    .order('registrado_em', { ascending: false })
    .limit(20);
  if (error) throw new Error('fetchLogSlotsAuto: ' + error.message);
  return (data ?? []).map(r => ({ id: r.id, ...r }));
}

export async function fetchPoligonos(cidade: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('poligonos')
    .select('nome')
    .eq('cidade', cidade);
  if (error) throw new Error('fetchPoligonos: ' + error.message);
  return (data ?? []).map(r => r.nome).filter(Boolean).sort();
}

export async function updateCheckInFoto(slotId: string, fotoUrl: string): Promise<void> {
  const { error } = await supabase.from('slots').update({
    check_in_foto_url: fotoUrl,
    atualizado_em: new Date().toISOString(),
  }).eq('id', slotId);
  if (error) throw new Error('updateCheckInFoto: ' + error.message);
}
