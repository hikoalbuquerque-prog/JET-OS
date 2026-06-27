// slots-schema.ts — JET OS — tipos e helpers Supabase para Slots / Tarefas / Logística

import { supabase } from './supabase';
import { guardWriteSupabase, criarOcorrenciaSupabase } from './ocorrencias-supabase';

// Timestamp genérico — aceita Firebase Timestamp, Date, ISO string, etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TimestampLike = any;

// ─────────────────────────────────────────────────────────────────
// CARGOS (legado — mantido para ocorrências / equipe / compatib.)
// ─────────────────────────────────────────────────────────────────

export type CargoTipo =
  | 'charger' | 'scalt' | 'scout'
  | 'promotor' | 'fiscal' | 'seguranca'
  | 'gestor' | 'campo' | string;

export type TipoContrato   = 'MEI' | 'CLT';
export type StatusPrestador = 'ativo' | 'inativo' | 'suspenso';

export interface UsuarioPrestador {
  uid: string; nome: string; email: string; role: string;
  cargoPrestador: CargoTipo; tipoCadastro: 'prestador';
  tipoContrato: TipoContrato; statusPrestador: StatusPrestador;
  cidade: string; pais: string; cpfCnpj: string;
  pixChave: string; pixTipo: string; telegram: string;
  slotAtualId?: string | null; ultimaAtividade?: TimestampLike | null;
  telegramChatId?: string | null; fcmToken?: string | null;
  lat?: number | null; lng?: number | null;
}

// ─────────────────────────────────────────────────────────────────
// SLOTS  (tabela: slots)
// ─────────────────────────────────────────────────────────────────

export type TipoSlot      = 'scout' | 'charger';
export type TipoGeracao   = 'manual' | 'automatico';
export type SlotStatus    = 'aberto' | 'aceito' | 'a_caminho' | 'em_andamento' | 'concluido' | 'cancelado';
export type SlotPrioridade = 'normal' | 'alta' | 'urgente';

export interface Slot {
  id?: string;
  // Identificação
  titulo: string;
  descricao?: string;
  tipoSlot: TipoSlot;          // 'scout' | 'charger'
  tipoGeracao: TipoGeracao;    // 'manual' | 'automatico'
  prioridade: SlotPrioridade;
  zona?: string | null;
  // Legado (compatibilidade)
  cargo: CargoTipo;
  // Localização / turno
  cidade: string;
  pais: string;
  turnoInicio: string;
  turnoFim: string;
  // Worker
  status: SlotStatus;
  criadoPor: string;
  aceitoPor?: string | null;
  aceitoPorNome?: string | null;
  aceitoEm?: TimestampLike | null;
  aCaminhoEm?: TimestampLike | null;
  checkInEm?: TimestampLike | null;
  checkInLat?: number | null;
  checkInLng?: number | null;
  checkInAccuracy?: number | null;
  checkOutEm?: TimestampLike | null;
  // Progresso
  tarefasIds?: string[];
  tarefasTotal?: number;
  tarefasConcluidas?: number;
  // SLA
  slaAceiteMin?: number;
  slaEscaladoEm?: TimestampLike | null;
  // Auto-geração
  geradoPorClima?: boolean;
  climaStatus?: string | null;
  // Cancelamento
  motivoCancelamento?: string | null;
  notasCancelamento?: string | null;
  canceladoPor?: string | null;
  // Confirmação cascata (Telegram reminders)
  confirmacoes?: {
    t120?: TimestampLike | null;
    t90?: TimestampLike | null;
    t60?: TimestampLike | null;
    t0?: TimestampLike | null;
  } | null;
  confirmadoEm?: TimestampLike | null;
  // Timestamps
  criadoEm?: TimestampLike;
  atualizadoEm?: TimestampLike;
  // Legado n8n
  n8nDistribuido?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// TAREFAS  (tabela: tarefas)
// ─────────────────────────────────────────────────────────────────

export type TarefaTipo =
  | 'rebalanceamento' | 'coleta' | 'entrega'
  | 'reparo' | 'manutencao' | 'organizacao'
  | 'troca_bateria'
  | 'fiscalizacao' | 'promo_abordagem' | 'ocorrencia_seguranca' | string;

export type TarefaStatus = 'pendente' | 'aceita' | 'em_andamento' | 'concluida' | 'rejeitada' | 'cancelada';
export type TarefaPrioridade = 1 | 2 | 3 | 4 | 5;

export interface TarefaEstacao {
  id: string; nome: string; endereco?: string;
  lat: number; lng: number;
}

export interface PatineteInfo {
  id: string;
  identifier: string;
  lat: number; lng: number;
  bateria?: number | null;        // % bateria (para charger)
  parkingNome?: string | null;    // ponto atual (scout)
}

export interface Entrega {
  id: string;
  qtd: 1 | 2;
  fotoUrl: string;
  lat?: number | null; lng?: number | null; accuracy?: number | null;
  gpsIndisponivel?: boolean;
  obs?: string | null;
  registradoEm: TimestampLike;
}

export interface Tarefa {
  id?: string;
  tipo: TarefaTipo;
  tipoSlot?: TipoSlot | null;     // 'scout' | 'charger' — herdado do slot
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  titulo: string;
  descricao?: string;
  cargo: CargoTipo;
  cidade: string; pais: string;
  slotId?: string | null;
  assigneeUid?: string | null; assigneeNome?: string | null;
  // Localização destino
  estacao?: TarefaEstacao | null;
  // Localização origem (scout: de onde vem as patinetes)
  estacaoOrigem?: TarefaEstacao | null;
  // Patinetes sugeridas
  patineteSugeridas?: PatineteInfo[];
  // Progresso entregas
  qtdAlvo?: number;
  qtdConcluida?: number;
  entregas?: Entrega[];
  // Foto chegada
  fotoChegadaUrl?: string | null;
  chegadaEm?: TimestampLike | null;
  aCaminhoEm?: TimestampLike | null;
  // Conclusão
  concluidoEm?: TimestampLike | null;
  fotoUrl?: string | null;
  lat?: number | null; lng?: number | null;
  obsConclsao?: string | null;
  // Cancelamento
  rejeitadoEm?: TimestampLike | null;
  motivoCancelamento?: string | null;
  notasCancelamento?: string | null;
  fotoCancelamentoUrl?: string | null;
  // Rota
  rotaOrdem?: number | null;
  distanciaKm?: number | null;
  quantidade?: number;
  // Timestamps
  criadoEm?: TimestampLike; atualizadoEm?: TimestampLike;
}

// ─────────────────────────────────────────────────────────────────
// CONFIG AUTO-SLOTS  (tabela: config_auto_slots)
// ─────────────────────────────────────────────────────────────────

export type SensibilidadeClima = 'ignorar' | 'moderada' | 'alta';

// Configuração de quantidade por faixa de horário / turno
export interface FaixaHorario {
  id: string;
  nome: string;              // "Pico manhã", "T1", "Noturno", etc.
  horaInicio: string;        // "07:00"
  horaFim: string;           // "09:00"
  ativo: boolean;
  // Scout — substitui os valores globais nessa janela
  bikesMinimo?: number;
  bikesAlvo?: number;
  bikesMaximo?: number;
  // Charger
  bateriaThreshold?: number;
  chargerMinimo?: number;
  // Prioridade desta janela
  prioridade?: SlotPrioridade;
  // Qtd máxima de slots simultâneos nessa faixa
  maxSlots?: number;
}

export interface ConfigZonaAuto {
  id?: string;
  zonaId: string;
  zonaNome: string;
  cidade: string; pais: string;
  ativo: boolean;
  // Scout (valores padrão — substituídos pela faixa ativa quando houver)
  scoutAtivo: boolean;
  bikesMinimo: number;
  bikesAlvo: number;
  bikesMaximo: number;
  usarHistorico: boolean;
  // Charger (valores padrão)
  chargerAtivo: boolean;
  bateriaThreshold: number;   // % (0-100) — bikes abaixo disso entram na lista
  chargerMinimo: number;       // mínimo de bikes para gerar slot
  // Scout avançado
  incluirForaPonto: boolean;   // incluir bikes sem parking_id como tarefas de retorno
  // Workers por slot
  qtdWorkers: number;          // quantos workers atribuir a cada slot auto-gerado
  // Faixas de horário configuráveis
  faixasHorario: FaixaHorario[];
  // Geral
  horarioAtivoInicio: string;
  horarioAtivoFim: string;
  intervaloChecagemMin: number;
  slaAceiteMin: number;
  autoAssign: boolean;
  sensibilidadeClima: SensibilidadeClima;
  notificarGestor: boolean;
  // Meta
  atualizadoPor?: string; atualizadoEm?: TimestampLike;
}

// ─────────────────────────────────────────────────────────────────
// LOG DECISÕES AUTO  (tabela: log_slots_auto)
// ─────────────────────────────────────────────────────────────────

export interface LogDecisaoAuto {
  id?: string;
  zona: string; cidade: string;
  tipoSlot: TipoSlot;
  bikesEncontradas?: number;
  bikesAlvo?: number;
  climaStatus?: string;
  regraAplicada: string;
  slotCriado: boolean;
  slotId?: string | null;
  motivo?: string;
  registradoEm: TimestampLike;
}

// ─────────────────────────────────────────────────────────────────
// OCORRÊNCIAS  (tabela: ocorrencias)
// ─────────────────────────────────────────────────────────────────

export type OcorrenciaTipo =
  | 'roubo' | 'vandalismo' | 'patinete_danificado'
  | 'ponto_bloqueado' | 'usuario_infrator' | 'outro';

export type OcorrenciaStatus = 'aberta' | 'em_tratamento' | 'resolvida' | 'arquivada';

export interface Ocorrencia {
  id?: string; tipo: OcorrenciaTipo; status: OcorrenciaStatus;
  descricao: string; registradoPor: string; registradoPorNome: string;
  cargo: CargoTipo; cidade: string; pais?: string;
  lat?: number | null; lng?: number | null; fotoUrl?: string | null;
  procurando?: boolean; patineteId?: string | null;
  telegramEnviado?: boolean; criadoEm?: TimestampLike; atualizadoEm?: TimestampLike;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS — CRUD (Supabase)
// ─────────────────────────────────────────────────────────────────

/** Helper: converte camelCase → snake_case */
function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/** Helper: converte objeto camelCase → snake_case keys */
function keysToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toSnake(k), v])
  );
}

/** Helper: converte snake_case row → camelCase keys */
function keysToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      v,
    ])
  );
}

export async function criarSlot(dados: Omit<Slot, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
  const now = new Date().toISOString();
  const row = {
    ...keysToSnake(dados as Record<string, unknown>),
    criado_em: now,
    atualizado_em: now,
  };
  const { data, error } = await supabase.from('slots').insert(row).select('id').single();
  if (error) throw new Error(`[slots] insert: ${error.message}`);
  return data.id;
}

export async function atualizarSlot(id: string, dados: Partial<Slot>): Promise<void> {
  const row = {
    ...keysToSnake(dados as Record<string, unknown>),
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await supabase.from('slots').update(row).eq('id', id);
  if (error) throw new Error(`[slots] update: ${error.message}`);
}

export async function criarTarefa(dados: Omit<Tarefa, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
  const now = new Date().toISOString();
  const row = {
    tipo: dados.tipo,
    tipo_slot: dados.tipoSlot ?? null,
    status: dados.status,
    prioridade: dados.prioridade,
    titulo: dados.titulo,
    cargo: dados.cargo,
    cidade: dados.cidade,
    pais: dados.pais,
    slot_id: dados.slotId ?? null,
    assignee_uid: dados.assigneeUid ?? null,
    assignee_nome: dados.assigneeNome ?? null,
    qtd_alvo: dados.qtdAlvo ?? null,
    qtd_concluida: dados.qtdConcluida ?? 0,
    rota_ordem: dados.rotaOrdem ?? null,
    criado_em: now,
    atualizado_em: now,
  };
  const { data, error } = await supabase.from('tarefas').insert(row).select('id').single();
  if (error) throw new Error(`[tarefas] insert: ${error.message}`);
  return data.id;
}

export async function atualizarTarefa(id: string, dados: Partial<Tarefa>): Promise<void> {
  const row = {
    ...keysToSnake(dados as Record<string, unknown>),
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await supabase.from('tarefas').update(row).eq('id', id);
  if (error) throw new Error(`[tarefas] update: ${error.message}`);
}

export async function buscarTarefasDoSlot(slotId: string): Promise<Tarefa[]> {
  const { data, error } = await supabase
    .from('tarefas')
    .select('*')
    .eq('slot_id', slotId)
    .order('rota_ordem', { ascending: true });
  if (error) { console.error('[tarefas] select:', error.message); return []; }
  return (data ?? []).map(r => ({ ...keysToCamel(r), id: r.id }) as unknown as Tarefa);
}

export function ouvirTarefasDoOperador(uid: string, cb: (t: Tarefa[]) => void): () => void {
  // Initial fetch
  supabase
    .from('tarefas')
    .select('*')
    .eq('assignee_uid', uid)
    .in('status', ['pendente', 'aceita', 'em_andamento'])
    .order('rota_ordem', { ascending: true })
    .then(({ data, error }) => {
      if (!error && data) cb(data.map(r => ({ ...keysToCamel(r), id: r.id }) as unknown as Tarefa));
    });

  // Realtime subscription
  const channel = supabase
    .channel(`tarefas-operador-${uid}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tarefas',
      filter: `assignee_uid=eq.${uid}`,
    }, () => {
      // Re-fetch on any change
      supabase
        .from('tarefas')
        .select('*')
        .eq('assignee_uid', uid)
        .in('status', ['pendente', 'aceita', 'em_andamento'])
        .order('rota_ordem', { ascending: true })
        .then(({ data, error }) => {
          if (!error && data) cb(data.map(r => ({ ...keysToCamel(r), id: r.id }) as unknown as Tarefa));
        });
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

export async function buscarConfigZonas(cidade: string): Promise<ConfigZonaAuto[]> {
  const { data, error } = await supabase
    .from('config_auto_slots')
    .select('*')
    .eq('cidade', cidade);
  if (error) { console.error('[config_auto_slots] select:', error.message); return []; }
  return (data ?? []).map(r => ({ ...keysToCamel(r), id: r.id }) as unknown as ConfigZonaAuto);
}

export async function salvarConfigZona(cfg: Omit<ConfigZonaAuto, 'id' | 'atualizadoEm'>): Promise<void> {
  const row = {
    zona_id: cfg.zonaId,
    zona_nome: cfg.zonaNome,
    cidade: cfg.cidade,
    pais: cfg.pais,
    ativo: cfg.ativo,
    scout_ativo: cfg.scoutAtivo,
    bikes_minimo: cfg.bikesMinimo,
    bikes_alvo: cfg.bikesAlvo,
    bikes_maximo: cfg.bikesMaximo,
    charger_ativo: cfg.chargerAtivo,
    bateria_threshold: cfg.bateriaThreshold,
    charger_minimo: cfg.chargerMinimo,
    horario_ativo_inicio: cfg.horarioAtivoInicio,
    horario_ativo_fim: cfg.horarioAtivoFim,
    intervalo_checagem_min: cfg.intervaloChecagemMin,
    sla_aceite_min: cfg.slaAceiteMin,
    auto_assign: cfg.autoAssign,
    sensibilidade_clima: cfg.sensibilidadeClima,
    notificar_gestor: cfg.notificarGestor,
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('config_auto_slots')
    .upsert(row, { onConflict: 'zona_id,cidade' });
  if (error) throw new Error(`[config_auto_slots] upsert: ${error.message}`);
}

export async function criarOcorrencia(dados: Omit<Ocorrencia, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('ocorrencias')
    .insert({
      ...keysToSnake(dados as Record<string, unknown>),
      criado_em: now,
      atualizado_em: now,
    })
    .select('id')
    .single();
  if (error) throw new Error(`[ocorrencias] insert: ${error.message}`);

  // Mirror via guard helper if enabled
  if (guardWriteSupabase()) {
    criarOcorrenciaSupabase(data.id, dados).catch(err => console.error('[guard-write] create Supabase:', err));
  }
  return data.id;
}

export function ouvirOcorrencias(cidade: string, cb: (ocs: Ocorrencia[]) => void): () => void {
  // Initial fetch
  supabase
    .from('ocorrencias')
    .select('*')
    .eq('cidade', cidade)
    .in('status', ['aberta', 'em_tratamento'])
    .order('criado_em', { ascending: false })
    .then(({ data, error }) => {
      if (!error && data) cb(data.map(r => ({ ...keysToCamel(r), id: r.id }) as unknown as Ocorrencia));
    });

  // Realtime subscription
  const channel = supabase
    .channel(`ocorrencias-${cidade}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'ocorrencias',
      filter: `cidade=eq.${cidade}`,
    }, () => {
      supabase
        .from('ocorrencias')
        .select('*')
        .eq('cidade', cidade)
        .in('status', ['aberta', 'em_tratamento'])
        .order('criado_em', { ascending: false })
        .then(({ data, error }) => {
          if (!error && data) cb(data.map(r => ({ ...keysToCamel(r), id: r.id }) as unknown as Ocorrencia));
        });
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
