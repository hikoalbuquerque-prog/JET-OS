// frontend/src/lib/gestor-logistica-supabase.ts
// Supabase CRUD para o GestorLogisticaPanel — substitui todos os reads/writes
// Firestore do painel. Padrão: polling com setInterval (igual slots-supabase.ts).

import { supabase } from './supabase';

// ── Helpers ──────────────────────────────────────────────────────────────────

type Unsub = () => void;

/** Polling genérico: chama fetcher a cada intervaloMs, retorna unsub. */
function poll<T>(fetcher: () => Promise<T>, cb: (v: T) => void, intervaloMs = 8000): Unsub {
  let vivo = true;
  const run = () => fetcher().then(v => { if (vivo) cb(v); }).catch(e => console.warn('[gestor-supa]', e?.message));
  run();
  const t = setInterval(run, intervaloMs);
  return () => { vivo = false; clearInterval(t); };
}

function cidadeFiltro(q: any, cidade: string, col = 'cidade') {
  return cidade ? q.eq(col, cidade) : q;
}

// ── Cidades (estacoes) ───────────────────────────────────────────────────────

export async function fetchCidadesEstacoes(): Promise<string[]> {
  const { data, error } = await supabase.from('estacoes').select('cidade');
  if (error) throw error;
  const set = new Set<string>();
  (data ?? []).forEach((r: any) => { if (r.cidade) set.add(r.cidade); });
  return Array.from(set).sort();
}

// ── Tarefas logistica ────────────────────────────────────────────────────────

function mapTarefa(r: any): any {
  return {
    id: String(r.id),
    tipo: r.kind ?? r.tipo ?? '',
    status: r.status ?? 'pendente',
    titulo: r.titulo ?? '',
    descricao: r.descricao ?? '',
    lat: r.lat ?? (r.geo ? undefined : undefined),
    lng: r.lng ?? undefined,
    endereco: r.endereco ?? r.descricao ?? '',
    responsavelId: r.assignee_uid ?? r.responsavel_id ?? '',
    responsavelNome: r.responsavel_nome ?? '',
    prioridade: r.prioridade ?? 0,
    cidade: r.cidade ?? '',
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
    fotoConclusaoUrl: r.foto_conclusao_url ?? '',
  };
}

export async function fetchTarefas(opts: { cidade: string; status?: string[]; limit?: number }): Promise<any[]> {
  let q = supabase.from('tarefas_logistica').select('*');
  q = cidadeFiltro(q, opts.cidade);
  if (opts.status?.length) q = q.in('status', opts.status);
  q = q.order('criado_em', { ascending: false }).limit(opts.limit ?? 400);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapTarefa);
}

export function subscribeTarefas(
  opts: { cidade: string; status?: string[]; limit?: number; intervaloMs?: number },
  cb: (t: any[]) => void,
): Unsub {
  // T1: Realtime + initial fetch
  fetchTarefas(opts).then(cb).catch(e => console.warn('[gestor-supa] tarefas initial:', e?.message));

  const channel = supabase
    .channel(`tarefas_${opts.cidade || 'all'}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tarefas_logistica',
      ...(opts.cidade ? { filter: `cidade=eq.${opts.cidade}` } : {}),
    }, () => {
      fetchTarefas(opts).then(cb).catch(e => console.warn('[gestor-supa] tarefas rt:', e?.message));
    })
    .subscribe();

  // Fallback poll at 60s (safety net)
  const fallback = setInterval(() => {
    fetchTarefas(opts).then(cb).catch(() => {});
  }, 60000);

  return () => {
    clearInterval(fallback);
    supabase.removeChannel(channel);
  };
}

export async function updateTarefa(id: string, patch: Record<string, unknown>): Promise<void> {
  // Map camelCase field names to snake_case columns
  const row: Record<string, unknown> = {};
  if (patch.status != null) row.status = patch.status;
  if (patch.responsavelId != null) row.assignee_uid = patch.responsavelId;
  if (patch.responsavelNome != null) row.responsavel_nome = patch.responsavelNome;
  if (patch.atualizadoEm !== undefined) row.atualizado_em = new Date().toISOString();
  else row.atualizado_em = new Date().toISOString();
  const { error } = await supabase.from('tarefas_logistica').update(row).eq('id', id);
  if (error) throw error;
}

// ── GPS (leitura via gps-supabase.ts — reexport helpers aqui) ────────────────

export async function fetchGpsLogistica(opts: { cidade: string; minutos?: number }): Promise<any[]> {
  const since = new Date(Date.now() - (opts.minutos ?? 60) * 60000).toISOString();
  let q = supabase.from('gps_logistica').select('*').gte('criado_em', since);
  q = cidadeFiltro(q, opts.cidade);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    uid: r.uid ?? r.id,
    nome: r.nome ?? '',
    lat: r.lat,
    lng: r.lng,
    atualizadoEm: r.criado_em ?? r.atualizado_em,
    cidade: r.cidade ?? '',
  }));
}

export function subscribeGpsLogistica(
  opts: { cidade: string; minutos?: number; intervaloMs?: number },
  cb: (w: any[]) => void,
): Unsub {
  // GPS table may be a view — keep polling (T1: upgrade when table exists)
  return poll(() => fetchGpsLogistica(opts), cb, opts.intervaloMs ?? 10000);
}

export async function fetchGpsHist(uid: string, horasAtras = 8): Promise<any[]> {
  const since = new Date(Date.now() - horasAtras * 3600000).toISOString();
  const { data, error } = await supabase
    .from('gps_logistica_hist')
    .select('*')
    .eq('uid', uid)
    .gte('criado_em', since)
    .order('criado_em', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

// ── Slots ────────────────────────────────────────────────────────────────────

function mapSlot(r: any): any {
  const c = r.config ?? {};
  return {
    id: String(r.id),
    turno: c.turno ?? r.turno ?? '',
    turnoLabel: c.turno_label ?? c.turnoLabel ?? '',
    horaIni: c.hora_ini ?? c.horaIni ?? '',
    horaFim: c.hora_fim ?? c.horaFim ?? '',
    zona: c.zona ?? '',
    qtdPessoas: r.vagas ?? c.qtd_pessoas ?? 0,
    tipo: r.tipo ?? '',
    status: r.status ?? 'Aberto',
    dataSlot: c.data_slot ?? c.dataSlot ?? (r.inicio ? new Date(r.inicio).toLocaleDateString('pt-BR') : ''),
    criadoEm: r.criado_em,
    cidade: r.cidade ?? '',
    confirmacaoMin: c.confirmacao_min ?? c.confirmacaoMin ?? 120,
    reaberturaSemConfMin: c.reabertura_sem_conf_min ?? c.reaberturaSemConfMin ?? 90,
  };
}

export async function fetchSlotsLogistica(opts: { cidade: string; limit?: number }): Promise<any[]> {
  let q = supabase.from('slots').select('*');
  q = cidadeFiltro(q, opts.cidade);
  q = q.order('criado_em', { ascending: false }).limit(opts.limit ?? 150);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapSlot);
}

export function subscribeSlots(
  opts: { cidade: string; limit?: number; intervaloMs?: number },
  cb: (s: any[]) => void,
): Unsub {
  // T1: Realtime slots
  fetchSlotsLogistica(opts).then(cb).catch(e => console.warn('[gestor-supa] slots initial:', e?.message));

  const channel = supabase
    .channel(`slots_${opts.cidade || 'all'}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'slots',
      ...(opts.cidade ? { filter: `cidade=eq.${opts.cidade}` } : {}),
    }, () => {
      fetchSlotsLogistica(opts).then(cb).catch(() => {});
    })
    .subscribe();

  const fallback = setInterval(() => {
    fetchSlotsLogistica(opts).then(cb).catch(() => {});
  }, 60000);

  return () => {
    clearInterval(fallback);
    supabase.removeChannel(channel);
  };
}

export async function criarSlot(slot: Record<string, unknown>): Promise<void> {
  const config: Record<string, unknown> = {
    turno: slot.turno,
    turno_label: slot.turnoLabel,
    hora_ini: slot.horaIni,
    hora_fim: slot.horaFim,
    zona: slot.zona,
    data_slot: slot.dataSlot,
    confirmacao_min: slot.confirmacaoMin ?? slot.confMin,
    reabertura_sem_conf_min: slot.reaberturaSemConfMin ?? slot.reabrMin,
    criado_por_id: slot.criadoPorId,
    criado_por_nome: slot.criadoPorNome,
  };
  const row: Record<string, unknown> = {
    tipo: slot.tipo,
    cidade: slot.cidade,
    vagas: slot.qtdPessoas ?? slot.vagas,
    status: slot.status ?? 'Aberto',
    config,
  };
  const { error } = await supabase.from('slots').insert(row);
  if (error) throw error;
}

export async function deleteSlot(id: string): Promise<void> {
  const { error } = await supabase.from('slots').delete().eq('id', id);
  if (error) throw error;
}

// ── Slot aceites (slot_confirmacoes) ─────────────────────────────────────────

function mapAceite(r: any): any {
  return {
    id: String(r.id),
    slotId: r.slot_id ?? '',
    nome: r.nome ?? '',
    cnpj: r.cnpj ?? '',
    status: r.status ?? 'Pendente',
    aceitoEm: r.confirmado_em ?? r.criado_em,
  };
}

export async function fetchAceites(): Promise<any[]> {
  const { data, error } = await supabase.from('slot_confirmacoes').select('*');
  if (error) throw error;
  return (data ?? []).map(mapAceite);
}

export function subscribeAceites(cb: (a: any[]) => void, intervaloMs = 8000): Unsub {
  return poll(fetchAceites, cb, intervaloMs);
}

export async function updateAceiteStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('slot_confirmacoes').update({ status }).eq('id', id);
  if (error) throw error;
}

// ── MEIs ─────────────────────────────────────────────────────────────────────

function mapMei(r: any): any {
  return {
    id: String(r.id),
    nome: r.nome ?? r.razao_social ?? '',
    cpf: r.cpf ?? '',
    cnpj: r.cnpj ?? '',
    status: r.status ?? (r.ativo ? 'ATIVO' : 'INATIVO'),
    cidade: r.cidade ?? '',
    suspensoInicio: r.suspenso_inicio ?? '',
    suspensoAte: r.suspenso_ate ?? '',
    motivoSuspensao: r.motivo_suspensao ?? '',
    criadoEm: r.criado_em,
  };
}

export async function fetchMeis(cidade: string): Promise<any[]> {
  let q = supabase.from('meis').select('*');
  q = cidadeFiltro(q, cidade);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapMei);
}

export function subscribeMeis(cidade: string, cb: (m: any[]) => void, intervaloMs = 10000): Unsub {
  return poll(() => fetchMeis(cidade), cb, intervaloMs);
}

export async function upsertMei(mei: Record<string, unknown>, id?: string): Promise<void> {
  const row: Record<string, unknown> = {
    nome: mei.nome,
    cpf: mei.cpf,
    cnpj: mei.cnpj,
    status: mei.status,
    cidade: mei.cidade,
    suspenso_inicio: mei.suspensoInicio || null,
    suspenso_ate: mei.suspensoAte || null,
    motivo_suspensao: mei.motivoSuspensao || null,
    atualizado_em: new Date().toISOString(),
  };
  if (id) {
    const { error } = await supabase.from('meis').update(row).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('meis').insert(row);
    if (error) throw error;
  }
}

export async function deleteMei(id: string): Promise<void> {
  const { error } = await supabase.from('meis').delete().eq('id', id);
  if (error) throw error;
}

// ── Eficiencias logistica ────────────────────────────────────────────────────

function mapEficiencia(r: any): any {
  return {
    id: String(r.id),
    uid: r.uid ?? '',
    nome: r.nome ?? '',
    data: r.data ?? '',
    cidade: r.cidade ?? '',
    movimentacoes: r.movimentacoes ?? r.tarefas_concluidas ?? 0,
    baterias: r.baterias ?? 0,
    obs: r.obs ?? '',
    criadoEm: r.criado_em,
  };
}

export async function fetchEficiencias(cidade: string): Promise<any[]> {
  let q = supabase.from('eficiencias_logistica').select('*');
  q = cidadeFiltro(q, cidade);
  q = q.order('criado_em', { ascending: false }).limit(300);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapEficiencia);
}

export function subscribeEficiencias(cidade: string, cb: (e: any[]) => void, intervaloMs = 10000): Unsub {
  return poll(() => fetchEficiencias(cidade), cb, intervaloMs);
}

export async function criarEficiencia(ef: Record<string, unknown>): Promise<void> {
  const row: Record<string, unknown> = {
    uid: ef.uid,
    nome: ef.nome,
    data: ef.data,
    cidade: ef.cidade,
    movimentacoes: ef.movimentacoes ?? 0,
    baterias: ef.baterias ?? 0,
    obs: ef.obs ?? null,
  };
  const { error } = await supabase.from('eficiencias_logistica').insert(row);
  if (error) throw error;
}

// ── Monitor alertas ──────────────────────────────────────────────────────────

function mapAlerta(r: any): any {
  return {
    id: String(r.id),
    tipo: r.tipo ?? '',
    cidade: r.cidade ?? '',
    zona: r.zona ?? '',
    qtdBikes: r.qtd_bikes ?? null,
    batMinPct: r.bat_min_pct ?? null,
    slotId: r.slot_id ?? null,
    ts: r.ts,
    resolvido: r.resolvido ?? false,
    msg: r.msg ?? '',
  };
}

export async function fetchAlertas(cidade: string): Promise<any[]> {
  let q = supabase.from('monitor_alertas').select('*');
  q = cidadeFiltro(q, cidade);
  q = q.order('ts', { ascending: false }).limit(100);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapAlerta);
}

export function subscribeAlertas(cidade: string, cb: (a: any[]) => void, intervaloMs = 15000): Unsub {
  return poll(() => fetchAlertas(cidade), cb, intervaloMs);
}

// ── Config logistica ─────────────────────────────────────────────────────────

export async function fetchConfigLogistica(cidadeKey: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('config_logistica')
    .select('*')
    .eq('cidade', cidadeKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    slaMinutos: data.sla_minutos ?? 120,
    raioSugestaoKm: data.raio_sugestao_km ?? 2,
    alertaZeroGoJet: data.alerta_zero_gojet ?? true,
    thresholdBatBaixa: data.threshold_bat_baixa ?? 30,
    confirmacaoMin: data.confirmacao_min ?? 120,
    reaberturaSemConfMin: data.reabertura_sem_conf_min ?? 90,
    prazoHoras: data.prazo_horas ?? {},
  };
}

export async function salvarConfigLogistica(cidadeKey: string, cfg: Record<string, unknown>): Promise<void> {
  const row: Record<string, unknown> = {
    cidade: cidadeKey,
    sla_minutos: cfg.slaMinutos,
    raio_sugestao_km: cfg.raioSugestaoKm,
    alerta_zero_gojet: cfg.alertaZeroGoJet,
    threshold_bat_baixa: cfg.thresholdBatBaixa,
    confirmacao_min: cfg.confirmacaoMin,
    reabertura_sem_conf_min: cfg.reaberturaSemConfMin,
    prazo_horas: cfg.prazoHoras ?? {},
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await supabase.from('config_logistica').upsert(row, { onConflict: 'cidade' });
  if (error) throw error;
}

// ── Telegram grupos ──────────────────────────────────────────────────────────

function mapTgGrupo(r: any): any {
  return {
    chatId: r.chat_id ?? '',
    nome: r.nome ?? '',
    cidade: r.cidade ?? '',
    topicos: r.topicos ?? {},
    tipos: [r.tipo],
  };
}

export async function fetchTelegramGrupos(cidadeKey: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('telegram_grupos')
    .select('*')
    .eq('cidade', cidadeKey);
  if (error) throw error;
  return (data ?? []).map(mapTgGrupo);
}

export async function salvarTelegramGrupo(cidadeKey: string, tipoKey: string, grupo: Record<string, unknown>): Promise<void> {
  const row: Record<string, unknown> = {
    cidade: cidadeKey,
    tipo: tipoKey,
    chat_id: grupo.chatId,
    nome: grupo.nome,
    topicos: grupo.topicos ?? {},
  };
  const { error } = await supabase
    .from('telegram_grupos')
    .upsert(row, { onConflict: 'cidade,tipo' });
  if (error) throw error;
}

// ── Inventario ───────────────────────────────────────────────────────────────

function mapInventario(r: any): any {
  return {
    id: String(r.id),
    tipo: r.tipo ?? 'armario',
    nome: r.nome ?? '',
    identificador: r.identificador ?? '',
    zona: r.zona ?? '',
    status: r.status ?? 'ATIVO',
    observacao: r.observacao ?? '',
    cidade: r.cidade ?? '',
  };
}

export async function fetchInventario(tipo: string, cidade: string): Promise<any[]> {
  let q = supabase.from('inventario').select('*').eq('tipo', tipo);
  q = cidadeFiltro(q, cidade);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapInventario);
}

export function subscribeInventario(tipo: string, cidade: string, cb: (i: any[]) => void, intervaloMs = 10000): Unsub {
  return poll(() => fetchInventario(tipo, cidade), cb, intervaloMs);
}

export async function upsertInventario(item: Record<string, unknown>, id?: string): Promise<void> {
  const row: Record<string, unknown> = {
    tipo: item.tipo,
    nome: item.nome,
    identificador: item.identificador || null,
    zona: item.zona || null,
    status: item.status,
    observacao: item.observacao || null,
    cidade: item.cidade,
    atualizado_em: new Date().toISOString(),
  };
  if (id) {
    const { error } = await supabase.from('inventario').update(row).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('inventario').insert(row);
    if (error) throw error;
  }
}

export async function deleteInventario(id: string): Promise<void> {
  const { error } = await supabase.from('inventario').delete().eq('id', id);
  if (error) throw error;
}

// ── GoJet config + snapshots ─────────────────────────────────────────────────

export async function fetchGojetConfig(cidade: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('gojet_config')
    .select('*')
    .eq('cidade', cidade)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchGojetSnapInfo(cidade: string): Promise<{ total: number; bikes: number; idade: number | null } | null> {
  const [pRes, bRes] = await Promise.all([
    supabase.from('gojet_snapshots').select('*').eq('cidade', cidade).order('saved_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('gojet_snapshots').select('*').eq('cidade', cidade).order('saved_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const pSnap = pRes.data;
  const bSnap = bRes.data;
  const total = pSnap ? (pSnap.total_parkings ?? (pSnap.parkings ?? []).length) : 0;
  const bikes = bSnap ? (bSnap.total_bikes ?? (bSnap.bikes ?? []).length) : 0;
  const ts = pSnap?.saved_at ? new Date(pSnap.saved_at).getTime() : (pSnap?.atualizado_em ? new Date(pSnap.atualizado_em).getTime() : null);
  const idade = ts ? Math.round((Date.now() - ts) / 60000) : null;
  return { total, bikes, idade };
}

export async function salvarGojetConfig(cidade: string, cfg: Record<string, unknown>): Promise<void> {
  const row: Record<string, unknown> = {
    cidade,
    city_id: cfg.cityId ?? '',
    ativo: cfg.ativo ?? true,
    config: cfg,
  };
  const { error } = await supabase.from('gojet_config').upsert(row, { onConflict: 'cidade' });
  if (error) throw error;
}

// ── Usuarios (CLT / operadores) — delegates to usuarios-supabase.ts ──────────

export async function upsertUsuario(patch: Record<string, unknown>, id?: string): Promise<void> {
  const row: Record<string, unknown> = { ...patch, atualizado_em: new Date().toISOString() };
  if (id) {
    const { error } = await supabase.from('usuarios').update(row).eq('uid', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('usuarios').insert(row);
    if (error) throw error;
  }
}

export async function deleteUsuario(id: string): Promise<void> {
  const { error } = await supabase.from('usuarios').delete().eq('uid', id);
  if (error) throw error;
}
