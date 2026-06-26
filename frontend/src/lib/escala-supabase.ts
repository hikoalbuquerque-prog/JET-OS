// frontend/src/lib/escala-supabase.ts
// Data layer do SlotsTeamsModule (escala por disponibilidade) no Supabase.
// Atrás do flag VITE_ANALYTICS_PROVIDER === 'supabase'. Tabela própria
// slots_escala (shape distinto do public.slots). Mapeia linhas->formas do
// componente e converte datas (date yyyy-mm-dd <-> dd/mm/yyyy).

import { supabase } from './supabase';

export const escalaProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_escala_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_ESCALA_PROVIDER as string) !== 'firebase';
};

const isoToBr = (d?: string | null) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return (y && m && dd) ? `${dd}/${m}/${y}` : '';
};
const brToIso = (s?: string | null) => {
  if (!s) return null;
  const [dd, m, y] = String(s).split('/');
  return (y && m && dd) ? `${y}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}` : null;
};

const mapSlot = (r: any) => ({
  id: r.id, turno: r.turno, horaIni: r.hora_ini, horaFim: r.hora_fim,
  zona: r.zona, tipo: r.tipo, qtdPessoas: r.qtd_pessoas, dataSlot: isoToBr(r.data_slot),
  cidade: r.cidade, status: r.status, geradoAuto: r.gerado_auto, feriado: r.feriado,
  confirmacaoMin: r.confirmacao_min, reaberturaSemConfMin: r.reabertura_sem_conf_min,
  poligonoId: r.poligono_id,
});
const mapDisp = (r: any) => ({
  id: r.id, uid: r.uid, nome: r.nome, cnpj: r.cnpj,
  diasSemana: r.dias_semana ?? [], turnosDisponiveis: r.turnos_disponiveis ?? [],
  zonasDisponiveis: r.zonas_disponiveis ?? [], funcao: r.funcao, cidade: r.cidade, obs: r.obs,
});
const mapFeriado = (r: any) => ({ id: r.id, data: isoToBr(r.data), nome: r.nome, cidade: r.cidade, nacional: r.nacional });
const mapAceite = (r: any) => ({ id: r.id, slotId: r.slot_id, nome: r.nome, cnpj: r.cnpj, uid: r.uid, status: r.status, pontuacao: r.pontuacao, aceitoEm: r.aceito_em });
const mapCfg = (r: any) => r && ({
  cidade: r.cidade, diasAntecedencia: r.dias_antecedencia, turnosConfig: r.turnos_config ?? {},
  respeitarPreferencias: r.respeitar_preferencias, respeitarFeriados: r.respeitar_feriados,
  nivelMinimoUrgente: r.nivel_minimo_urgente, bonus: r.bonus ?? {}, penalidades: r.penalidades ?? {},
  tetoVagas: r.teto_vagas ?? 10,
});

// Lê tudo que a AbaEscala precisa.
export async function fetchEscala(cidade?: string) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const lim = new Date(hoje.getTime() + 7 * 86400000);
  const hojeIso = hoje.toISOString().slice(0, 10);
  const limIso = lim.toISOString().slice(0, 10);

  let sq = supabase.from('slots_escala').select('*').gte('data_slot', hojeIso).lte('data_slot', limIso);
  if (cidade) sq = sq.eq('cidade', cidade);
  const [slotsR, aceitesR, dispR, ferR, cfgR] = await Promise.all([
    sq.order('data_slot', { ascending: true }),
    supabase.from('slot_aceites').select('*'),
    cidade ? supabase.from('disponibilidades').select('*').eq('cidade', cidade) : supabase.from('disponibilidades').select('*'),
    supabase.from('feriados').select('*'),
    supabase.from('escala_config').select('*').eq('cidade', cidade || 'global').maybeSingle(),
  ]);
  return {
    slots: (slotsR.data ?? []).map(mapSlot),
    aceites: (aceitesR.data ?? []).map(mapAceite),
    disponibilidades: (dispR.data ?? []).map(mapDisp),
    feriados: (ferR.data ?? []).map(mapFeriado),
    cfg: cfgR.data ? mapCfg(cfgR.data) : null,
  };
}

export function subscribeEscala(cidade: string | undefined, cb: (d: Awaited<ReturnType<typeof fetchEscala>>) => void, intervaloMs = 10000): () => void {
  let vivo = true;
  const run = () => fetchEscala(cidade).then(d => { if (vivo) cb(d); }).catch(e => console.warn('[escala-supa]', e?.message));
  run();
  const t = setInterval(run, intervaloMs);
  return () => { vivo = false; clearInterval(t); };
}

// Lista de disponibilidades (aba Disponibilidade).
export async function fetchDisponibilidades(cidade?: string) {
  let q = supabase.from('disponibilidades').select('*');
  if (cidade) q = q.eq('cidade', cidade);
  const { data, error } = await q;
  if (error) throw new Error('fetchDisponibilidades: ' + error.message);
  return (data ?? []).map(mapDisp);
}

// ── Convergência (Fase 1): demanda GoJet como insumo da escala ──────────────
// Lê zonas críticas (déficit>20 ou ociosidade>25%) do analytics_gojet e devolve
// um bônus de vagas (0–2) para as funções de campo. Transparente e conservador
// (a precisão por-zona/histórico fica para a Fase 3 — inteligência).
export async function fetchDemandaGojet(cidade?: string): Promise<{ bonus: number; zonasCriticas: string[] }> {
  if (!cidade) return { bonus: 0, zonasCriticas: [] };
  const { data: cfg } = await supabase.from('gojet_config').select('city_id').eq('cidade', cidade).maybeSingle();
  const cityId = (cfg as any)?.city_id;
  if (!cityId) return { bonus: 0, zonasCriticas: [] };
  const { data, error } = await supabase.rpc('analytics_gojet', { p_city_id: cityId });
  if (error || !data) return { bonus: 0, zonasCriticas: [] };
  const zonas = ((data as any).zonas ?? []) as any[];
  const criticas = zonas.filter(z => (z.deficit ?? 0) > 20 || (z.ociosidade ?? 0) > 25).map(z => z.zona);
  return { bonus: Math.min(2, criticas.length), zonasCriticas: criticas };
}

// ── Gamificação (Ranking + Penalidades) ────────────────────────────────────
const mapPrest = (r: any) => ({
  id: r.uid, uid: r.uid, nome: r.nome, cnpj: r.cnpj, funcao: r.funcao, cidade: r.cidade,
  pontos: r.pontos ?? 0, nivel: r.nivel ?? 1, streak: r.streak ?? 0, streakMax: r.streak_max ?? 0,
  totalSlots: r.total_slots ?? 0, totalFaltas: r.total_faltas ?? 0, totalAtrasos: r.total_atrasos ?? 0,
  avaliacaoMedia: r.avaliacao_media ?? 0, status: r.status ?? 'ativo',
});
export async function fetchPrestadores(cidade?: string) {
  let q = supabase.from('prestadores_stats').select('*').order('pontos', { ascending: false });
  if (cidade) q = q.eq('cidade', cidade);
  const { data, error } = await q.limit(200);
  if (error) throw new Error('fetchPrestadores: ' + error.message);
  return (data ?? []).map(mapPrest);
}

const mapPen = (r: any) => ({
  id: r.id, uid: r.uid, nome: r.nome, cnpj: r.cnpj, tipo: r.tipo, descricao: r.descricao,
  pontosDeducao: r.pontos_deducao, slotId: r.slot_id, cidade: r.cidade, aplicadoPor: r.aplicado_por, criadoEm: r.criado_em,
});
export async function fetchPenalidadesList(cidade?: string) {
  let q = supabase.from('penalidades').select('*').order('criado_em', { ascending: false });
  if (cidade) q = q.eq('cidade', cidade);
  const { data, error } = await q.limit(200);
  if (error) throw new Error('fetchPenalidadesList: ' + error.message);
  return (data ?? []).map(mapPen);
}

// Aplica penalidade: grava o registro + deduz pontos/contadores do prestador.
export async function salvarPenalidade(form: any, aplicadoPor: string, cidade?: string) {
  const row = {
    uid: form.uid, nome: form.nome ?? null, cnpj: form.cnpj ?? null, tipo: form.tipo,
    descricao: form.descricao, pontos_deducao: form.pontosDeducao ?? 0, slot_id: form.slotId ?? null,
    cidade: cidade || 'SP', aplicado_por: aplicadoPor,
  };
  const { error } = await supabase.from('penalidades').insert(row);
  if (error) throw new Error('salvarPenalidade: ' + error.message);

  // deduz no perfil (cria a linha se não existir)
  const { data: cur } = await supabase.from('prestadores_stats').select('*').eq('uid', form.uid).maybeSingle();
  const base = cur ?? { uid: form.uid, nome: form.nome, funcao: form.funcao ?? null, cidade: cidade || 'SP', pontos: 0, total_faltas: 0, total_atrasos: 0 };
  const upd = {
    uid: base.uid, nome: base.nome ?? form.nome, funcao: base.funcao ?? null, cidade: base.cidade ?? (cidade || 'SP'),
    pontos: Math.max(0, (base.pontos ?? 0) - (form.pontosDeducao ?? 0)),
    total_faltas: (base.total_faltas ?? 0) + (form.tipo === 'falta' ? 1 : 0),
    total_atrasos: (base.total_atrasos ?? 0) + (form.tipo === 'atraso' ? 1 : 0),
    atualizado_em: new Date().toISOString(),
  };
  const { error: e2 } = await supabase.from('prestadores_stats').upsert(upd, { onConflict: 'uid' });
  if (e2) throw new Error('prestadores_stats: ' + e2.message);
}

// Cria os slots da prévia (insert em lote).
export async function criarSlotsEscala(previa: any[], usuario: { uid: string; nome: string }, cfg: any) {
  const rows = previa.map(p => ({
    turno: p.turno, turno_label: `${p.turno} — ${p.horaIni} às ${p.horaFim}`,
    hora_ini: p.horaIni, hora_fim: p.horaFim, zona: p.zona ?? 'Auto', tipo: p.tipo,
    qtd_pessoas: p.qtdPessoas, status: 'Aberto', data_slot: brToIso(p.dataSlot), cidade: p.cidade,
    gerado_auto: true, feriado: !!p.isFeriado,
    confirmacao_min: cfg?.turnosConfig?.[p.turno]?.qtdPadrao || 120, reabertura_sem_conf_min: 90,
    sugeridos: p.sugeridos ?? null,
    criado_por_id: usuario.uid, criado_por_nome: usuario.nome,
  }));
  // idempotente: upsert por (cidade,data,turno,tipo) — não duplica re-gerando.
  const { error } = await supabase.from('slots_escala').upsert(rows, { onConflict: 'cidade,data_slot,turno,tipo' });
  if (error) throw new Error('criarSlotsEscala: ' + error.message);
  return rows.length;
}

// Aceite do operador (fecha o loop) + métricas de previsibilidade.
export async function aceitarEscala(slotId: string) {
  const { data, error } = await supabase.rpc('aceitar_escala', { p_slot_id: slotId });
  if (error) throw new Error('aceitarEscala: ' + error.message);
  return data;
}
export async function fetchMetricasEscala(cidade?: string) {
  const { data, error } = await supabase.rpc('analytics_escala', { p_cidade: cidade ?? null });
  if (error) throw new Error('analytics_escala: ' + error.message);
  return data as any;
}

// Auditoria de geração/override (guardrail).
export async function logEscalaAudit(evento: string, detalhe: any, por: string, cidade?: string) {
  try { await supabase.from('escala_audit').insert({ evento, detalhe, por, cidade: cidade ?? null }); }
  catch (e) { console.warn('[escala-audit]', (e as any)?.message); }
}

const dispRow = (d: any) => ({
  uid: d.uid ?? null, nome: d.nome, cnpj: d.cnpj ?? null,
  dias_semana: d.diasSemana ?? [], turnos_disponiveis: d.turnosDisponiveis ?? [],
  zonas_disponiveis: d.zonasDisponiveis ?? [], funcao: d.funcao, cidade: d.cidade, obs: d.obs ?? null,
  atualizado_em: new Date().toISOString(),
});

// Self-service — upsert por (uid, cidade).
export async function salvarDisponibilidade(d: any) {
  const { error } = await supabase.from('disponibilidades').upsert(dispRow(d), { onConflict: 'uid,cidade' });
  if (error) throw new Error('salvarDisponibilidade: ' + error.message);
}

// Admin — edita por id (se houver) ou insere.
export async function salvarDisponibilidadeForm(d: any) {
  if (d.id) {
    const { error } = await supabase.from('disponibilidades').update(dispRow(d)).eq('id', d.id);
    if (error) throw new Error('salvarDisponibilidadeForm: ' + error.message);
  } else {
    const { error } = await supabase.from('disponibilidades').insert(dispRow(d));
    if (error) throw new Error('salvarDisponibilidadeForm: ' + error.message);
  }
}
export async function delDisponibilidade(id: string) {
  const { error } = await supabase.from('disponibilidades').delete().eq('id', id);
  if (error) throw new Error('delDisponibilidade: ' + error.message);
}

// escala_config (parâmetros da geração) — upsert por cidade.
export async function salvarEscalaConfig(cfg: any, cidade?: string) {
  const row = {
    cidade: cidade || 'global', dias_antecedencia: cfg.diasAntecedencia ?? 3,
    turnos_config: cfg.turnosConfig ?? {}, respeitar_preferencias: cfg.respeitarPreferencias ?? true,
    respeitar_feriados: cfg.respeitarFeriados ?? true, nivel_minimo_urgente: cfg.nivelMinimoUrgente ?? 0,
    bonus: cfg.bonus ?? {}, penalidades: cfg.penalidades ?? {}, teto_vagas: cfg.tetoVagas ?? 10,
  };
  const { error } = await supabase.from('escala_config').upsert(row, { onConflict: 'cidade' });
  if (error) throw new Error('salvarEscalaConfig: ' + error.message);
}

// feriados
export async function addFeriado(f: any, cidade?: string) {
  const brToIsoLocal = (s?: string | null) => {
    if (!s) return null; const [dd, m, y] = String(s).split('/');
    return (y && m && dd) ? `${y}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}` : s;
  };
  const row = { data: brToIsoLocal(f.data), nome: f.nome ?? null, nacional: !!f.nacional, cidade: f.nacional ? null : (cidade ?? null) };
  const { error } = await supabase.from('feriados').upsert(row, { onConflict: 'data,cidade' });
  if (error) throw new Error('addFeriado: ' + error.message);
}
export async function delFeriado(id: string) {
  const { error } = await supabase.from('feriados').delete().eq('id', id);
  if (error) throw new Error('delFeriado: ' + error.message);
}
