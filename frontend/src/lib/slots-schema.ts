// slots-schema.ts — JET OS — tipos e helpers Firestore para Slots / Tarefas / Logística

import {
  collection, doc, addDoc, updateDoc, getDocs, query,
  where, orderBy, onSnapshot, serverTimestamp, Timestamp,
  type QuerySnapshot, type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { guardWriteSupabase, criarOcorrenciaSupabase } from './ocorrencias-supabase';

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
  slotAtualId?: string | null; ultimaAtividade?: Timestamp | null;
  telegramChatId?: string | null; fcmToken?: string | null;
  lat?: number | null; lng?: number | null;
}

// ─────────────────────────────────────────────────────────────────
// SLOTS  (coleção: slots/)
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
  aceitoEm?: Timestamp | null;
  aCaminhoEm?: Timestamp | null;
  checkInEm?: Timestamp | null;
  checkInLat?: number | null;
  checkInLng?: number | null;
  checkInAccuracy?: number | null;
  checkOutEm?: Timestamp | null;
  // Progresso
  tarefasIds?: string[];
  tarefasTotal?: number;
  tarefasConcluidas?: number;
  // SLA
  slaAceiteMin?: number;
  slaEscaladoEm?: Timestamp | null;
  // Auto-geração
  geradoPorClima?: boolean;
  climaStatus?: string | null;
  // Cancelamento
  motivoCancelamento?: string | null;
  notasCancelamento?: string | null;
  canceladoPor?: string | null;
  // Confirmação cascata (Telegram reminders)
  confirmacoes?: {
    t120?: Timestamp | null;
    t90?: Timestamp | null;
    t60?: Timestamp | null;
    t0?: Timestamp | null;
  } | null;
  confirmadoEm?: Timestamp | null;
  // Timestamps
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
  // Legado n8n
  n8nDistribuido?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// TAREFAS  (coleção: tarefas/)
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
  registradoEm: Timestamp;
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
  chegadaEm?: Timestamp | null;
  aCaminhoEm?: Timestamp | null;
  // Conclusão
  concluidoEm?: Timestamp | null;
  fotoUrl?: string | null;
  lat?: number | null; lng?: number | null;
  obsConclsao?: string | null;
  // Cancelamento
  rejeitadoEm?: Timestamp | null;
  motivoCancelamento?: string | null;
  notasCancelamento?: string | null;
  fotoCancelamentoUrl?: string | null;
  // Rota
  rotaOrdem?: number | null;
  distanciaKm?: number | null;
  quantidade?: number;
  // Timestamps
  criadoEm?: Timestamp; atualizadoEm?: Timestamp;
}

// ─────────────────────────────────────────────────────────────────
// CONFIG AUTO-SLOTS  (coleção: config_auto_slots/)
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
  atualizadoPor?: string; atualizadoEm?: Timestamp;
}

// ─────────────────────────────────────────────────────────────────
// LOG DECISÕES AUTO  (coleção: log_slots_auto/)
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
  registradoEm: Timestamp;
}

// ─────────────────────────────────────────────────────────────────
// OCORRÊNCIAS  (coleção: ocorrencias/)
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
  telegramEnviado?: boolean; criadoEm?: Timestamp; atualizadoEm?: Timestamp;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS — CRUD
// ─────────────────────────────────────────────────────────────────

export async function criarSlot(dados: Omit<Slot, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
  const ref = await addDoc(collection(db, 'slots'), {
    ...dados, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
  });
  return ref.id;
}

export async function atualizarSlot(id: string, dados: Partial<Slot>): Promise<void> {
  await updateDoc(doc(db, 'slots', id), { ...dados, atualizadoEm: serverTimestamp() });
}

export async function criarTarefa(dados: Omit<Tarefa, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
  const ref = await addDoc(collection(db, 'tarefas'), {
    ...dados, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
  });
  return ref.id;
}

export async function atualizarTarefa(id: string, dados: Partial<Tarefa>): Promise<void> {
  await updateDoc(doc(db, 'tarefas', id), { ...dados, atualizadoEm: serverTimestamp() });
}

export async function buscarTarefasDoSlot(slotId: string): Promise<Tarefa[]> {
  const q = query(collection(db, 'tarefas'), where('slotId', '==', slotId), orderBy('rotaOrdem', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Tarefa));
}

export function ouvirTarefasDoOperador(uid: string, cb: (t: Tarefa[]) => void): () => void {
  const q = query(
    collection(db, 'tarefas'),
    where('assigneeUid', '==', uid),
    where('status', 'in', ['pendente', 'aceita', 'em_andamento']),
    orderBy('rotaOrdem', 'asc')
  );
  return onSnapshot(q, (snap: QuerySnapshot<DocumentData>) =>
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Tarefa)))
  );
}

export async function buscarConfigZonas(cidade: string): Promise<ConfigZonaAuto[]> {
  const q = query(collection(db, 'config_auto_slots'), where('cidade', '==', cidade));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ConfigZonaAuto));
}

export async function salvarConfigZona(cfg: Omit<ConfigZonaAuto, 'id' | 'atualizadoEm'>): Promise<void> {
  const q = query(
    collection(db, 'config_auto_slots'),
    where('zonaId', '==', cfg.zonaId),
    where('cidade', '==', cfg.cidade)
  );
  const snap = await getDocs(q);
  const data = { ...cfg, atualizadoEm: serverTimestamp() };
  if (snap.empty) {
    await addDoc(collection(db, 'config_auto_slots'), data);
  } else {
    await updateDoc(doc(db, 'config_auto_slots', snap.docs[0].id), data);
  }
}

export async function criarOcorrencia(dados: Omit<Ocorrencia, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
  const ref = await addDoc(collection(db, 'ocorrencias'), {
    ...dados, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
  });
  if (guardWriteSupabase()) {
    criarOcorrenciaSupabase(ref.id, dados).catch(err => console.error('[guard-write] create Supabase:', err));
  }
  return ref.id;
}

export function ouvirOcorrencias(cidade: string, cb: (ocs: Ocorrencia[]) => void): () => void {
  const q = query(
    collection(db, 'ocorrencias'),
    where('cidade', '==', cidade),
    where('status', 'in', ['aberta', 'em_tratamento']),
    orderBy('criadoEm', 'desc')
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ocorrencia))));
}
