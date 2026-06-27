// frontend/src/components/TarefasLogisticaModule.tsx
// Módulo completo de Tarefas de Logística — JET OS V2
// Features: Kanban fullscreen · Entregas parciais · Dashboard produtividade
//           Histórico CSV · Worker Home · Mudar destino · Realtime onSnapshot

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { fetchUsuarios } from '../lib/usuarios-supabase';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem, capturarFotoNativa } from '../lib/imageUtils';
import { isAndroidNative } from '../lib/gps-native';

// GPS background — importado dinamicamente para não quebrar se Capacitor não disponível
let _gpsStarted = false;
let _gpsErroSetter: ((msg: string | null) => void) | null = null;

async function startGPSTracking(
  uid: string,
  onErroSet?: (msg: string | null) => void,
): Promise<void> {
  _gpsErroSetter = onErroSet ?? null;
  if (_gpsStarted) return;
  try {
    const { gpsBackground } = await import('../lib/gps-background');
    await gpsBackground.iniciar({
      uid,
      slotId: null,
      onErro:   (msg) => { _gpsErroSetter?.(msg); console.warn('[GPS]', msg); },
      onPosicao: ()  => { _gpsErroSetter?.(null); },
    });
    _gpsStarted = true;
  } catch { /* gps-background não disponível */ }
}

async function stopGPSTracking() {
  if (!_gpsStarted) return;
  try {
    const { gpsBackground } = await import('../lib/gps-background');
    await gpsBackground.parar();
    _gpsStarted = false;
  } catch {}
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TarefaKind      = 'PONTO' | 'PATINETE' | 'ORGANIZACAO' | 'CARGA_BATERIA';
export type TarefaStatus    = 'pendente' | 'em_execucao' | 'concluida' | 'cancelada';
export type TarefaPrioridade = 1 | 2 | 3 | 4 | 5;

export interface Entrega {
  id?: string;
  qtd: number;
  fotoUrl: string;
  lat?: number | null;
  lng?: number | null;
  entregueEm: any;
  agentUid: string;
  agentNome?: string;
}

export interface TarefaLogistica {
  id?: string;
  kind: TarefaKind;
  titulo: string;
  descricao?: string;
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  parkingId?: string | null;
  parkingNome?: string | null;
  parkingLat?: number | null;
  parkingLng?: number | null;
  bikeIdentifier?: string | null;
  bikeLat?: number | null;
  bikeLng?: number | null;
  targetCount?: number | null;
  deliveredCount?: number;
  entregas?: Entrega[];
  assigneeUid?: string | null;
  assigneeNome?: string | null;
  cidade: string;
  pais: string;
  criadoPor: string;
  criadoEm?: any;
  atualizadoEm?: any;
  iniciadoEm?: any;
  concluidoEm?: any;
  fotoChegadaUrl?: string | null;
  fotoConclusaoUrl?: string | null;
  geradoPorGoJet?: boolean;
  slotId?: string | null;
  bateriaPercent?: number | null;
  due_at?: any; // Timestamp | null — prazo da tarefa
  // Para "mudar destino"
  destinoAlteradoEm?: any;
}

interface Props {
  usuario: { uid: string; nome?: string; email?: string; role: string };
  cidade: string;
  pais: string;
  onFechar: () => void;
  parkingInicial?: { id: string; nome: string; lat: number; lng: number; target?: number; disponivel?: number } | null;
  tarefaAbertaId?: string | null; // deep link — abre tarefa diretamente
  onSelecionarDestino?: (tarefaId: string, onParkingSelected: (p: any) => void) => void;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const KIND: Record<TarefaKind, { icon: string; label: string; cor: string }> = {
  PONTO:        { icon: '📍', label: 'Encher ponto',   cor: '#3b82f6' },
  PATINETE:     { icon: '🛴', label: 'Mover patinete', cor: '#10b981' },
  ORGANIZACAO:  { icon: '🧹', label: 'Organizar',      cor: '#f97316' },
  CARGA_BATERIA:{ icon: '🔋', label: 'Bateria baixa',  cor: '#f59e0b' },
};

const STATUS: Record<TarefaStatus, { label: string; cor: string }> = {
  pendente:    { label: 'Pendente',     cor: '#6b7280' },
  em_execucao: { label: 'Em execução',  cor: '#3b82f6' },
  concluida:   { label: 'Concluída',    cor: '#10b981' },
  cancelada:   { label: 'Cancelada',    cor: '#ef4444' },
};

const PRIO: Record<number, { label: string; cor: string }> = {
  1: { label: 'Baixa',      cor: '#6b7280' },
  2: { label: 'Normal',     cor: '#3b82f6' },
  3: { label: 'Alta',       cor: '#f97316' },
  4: { label: 'Urgente',    cor: '#ef4444' },
  5: { label: '🚨 CRÍTICA', cor: '#dc2626' },
};

const isAdminRole = (r: string) => ['admin','gestor','supergestor','gestor_seg'].includes(r);
const isFieldRole = (r: string) => ['admin','gestor','supergestor','logistica','campo'].includes(r);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTs(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtIdade(ts: any): string {
  if (!ts) return '';
  const ms = Date.now() - (ts?.toDate?.() ?? new Date(ts)).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h/24)}d`;
}

function fmtDuration(start: any, end: any): string {
  if (!start || !end) return '—';
  const s = (end?.toDate?.() ?? new Date(end)).getTime() - (start?.toDate?.() ?? new Date(start)).getTime();
  const m = Math.floor(s / 60000);
  return m < 60 ? `${m}min` : `${Math.floor(m/60)}h${m%60>0?` ${m%60}min`:''}`;
}

async function uploadFoto(file: File, tarefaId: string, tipo: string): Promise<string> {
  const p = `tarefas_logistica/${tarefaId}/${tipo}_${Date.now()}.jpg`;
  return uploadComRetry(file, p);
}

function navegar(lat: number, lng: number, app: 'maps' | 'waze') {
  app === 'waze'
    ? window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank')
    : window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
}

// Compressão HEIC-safe (ver lib/imageUtils). Converte HEIC→JPEG antes de comprimir,
// evitando o bug de foto "quebrada" (HEIC enviado como .jpg que o WebView não renderiza).
async function comprimir(file: File, maxW = 1280, q = 0.82): Promise<File> {
  try {
    return await comprimirImagem(file, maxW, q);
  } catch (e) {
    console.warn('[comprimir] falha ao processar imagem, enviando original', e);
    return file;
  }
}

function exportCSV(tarefas: TarefaLogistica[], agentes: Map<string, string>) {
  const h = ['ID','Tipo','Título','Status','Prioridade','Agente','Ponto','Target',
             'Entregue','Criado em','Iniciado em','Concluído em','Duração'];
  const rows = tarefas.map(t => [
    t.id ?? '',
    KIND[t.kind]?.label ?? t.kind,
    t.titulo,
    STATUS[t.status]?.label ?? t.status,
    PRIO[t.prioridade ?? 3]?.label ?? '',
    t.assigneeNome ?? (t.assigneeUid ? agentes.get(t.assigneeUid) ?? t.assigneeUid : '—'),
    t.parkingNome ?? '',
    t.targetCount ?? '',
    t.deliveredCount ?? '',
    fmtTs(t.criadoEm),
    fmtTs(t.iniciadoEm),
    fmtTs(t.concluidoEm),
    fmtDuration(t.iniciadoEm, t.concluidoEm),
  ].map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(','));
  const csv = '\uFEFF' + [h.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `tarefas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const S = {
  painel: (full = false) => ({
    position: 'fixed' as const, top: 0, right: 0, bottom: 0, zIndex: 2600,
    width: '100%', maxWidth: full ? '100vw' : 580,
    background: '#0d1521', borderLeft: '1px solid rgba(255,255,255,.08)',
    display: 'flex', flexDirection: 'column' as const, fontFamily: 'Inter,sans-serif',
  }),
  header: {
    padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  body: { flex: 1, overflowY: 'auto' as const, scrollbarWidth: 'thin' as const },
  btn: (cor = '#3b82f6', small = false) => ({
    padding: small ? '6px 10px' : '9px 14px',
    borderRadius: 8, border: 'none', background: cor, color: '#fff',
    fontSize: small ? 11 : 12, fontWeight: 600, cursor: 'pointer',
  }),
  ghost: {
    padding: '7px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'transparent', color: 'rgba(255,255,255,.5)',
    fontSize: 12, cursor: 'pointer',
  },
  inp: {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const,
  },
  lbl: {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.35)',
    letterSpacing: 1, display: 'block' as const, marginBottom: 4,
    textTransform: 'uppercase' as const,
  },
};

// ─── i18n (pt/en/es/ru) ───────────────────────────────────────────────────────
// Padrão sem JSON: objeto T no escopo do módulo + helper pick() por subcomponente.

type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const T = {
  // KIND labels
  kindPonto:        { pt: 'Encher ponto',   en: 'Fill point',      es: 'Llenar punto',     ru: 'Заполнить точку' },
  kindPatinete:     { pt: 'Mover patinete', en: 'Move scooter',    es: 'Mover patinete',   ru: 'Переместить самокат' },
  kindOrganizacao:  { pt: 'Organizar',      en: 'Organize',        es: 'Organizar',        ru: 'Организовать' },
  kindCargaBateria: { pt: 'Bateria baixa',  en: 'Low battery',     es: 'Batería baja',     ru: 'Низкий заряд' },
  // STATUS labels
  stPendente:    { pt: 'Pendente',    en: 'Pending',      es: 'Pendiente',    ru: 'Ожидает' },
  stEmExecucao:  { pt: 'Em execução', en: 'In progress',  es: 'En ejecución', ru: 'Выполняется' },
  stConcluida:   { pt: 'Concluída',   en: 'Completed',    es: 'Completada',   ru: 'Завершено' },
  stCancelada:   { pt: 'Cancelada',   en: 'Cancelled',    es: 'Cancelada',    ru: 'Отменено' },
  // PRIO labels
  prioBaixa:    { pt: 'Baixa',      en: 'Low',       es: 'Baja',      ru: 'Низкий' },
  prioNormal:   { pt: 'Normal',     en: 'Normal',    es: 'Normal',    ru: 'Обычный' },
  prioAlta:     { pt: 'Alta',       en: 'High',      es: 'Alta',      ru: 'Высокий' },
  prioUrgente:  { pt: 'Urgente',    en: 'Urgent',    es: 'Urgente',   ru: 'Срочно' },
  prioCritica:  { pt: '🚨 CRÍTICA', en: '🚨 CRITICAL', es: '🚨 CRÍTICA', ru: '🚨 КРИТИЧНО' },
  // Header / tabs
  tituloModulo: { pt: '📦 Tarefas Logística', en: '📦 Logistics Tasks', es: '📦 Tareas Logística', ru: '📦 Задачи логистики' },
  telaCheia:    { pt: 'Tela cheia', en: 'Fullscreen', es: 'Pantalla completa', ru: 'Полный экран' },
  abaInicio:    { pt: '🏠 Início',    en: '🏠 Home',      es: '🏠 Inicio',     ru: '🏠 Главная' },
  abaMinhas:    { pt: '📋 Minhas',    en: '📋 Mine',      es: '📋 Mías',       ru: '📋 Мои' },
  abaKanban:    { pt: '📊 Kanban',    en: '📊 Kanban',    es: '📊 Kanban',     ru: '📊 Канбан' },
  abaCriar:     { pt: '➕ Criar',     en: '➕ Create',    es: '➕ Crear',      ru: '➕ Создать' },
  abaStats:     { pt: '📈 Stats',     en: '📈 Stats',     es: '📈 Stats',      ru: '📈 Статистика' },
  abaHistorico: { pt: '📂 Histórico', en: '📂 History',   es: '📂 Historial',  ru: '📂 История' },
  // WorkerHome
  gpsSemSinal:    { pt: 'GPS sem sinal', en: 'No GPS signal', es: 'Sin señal GPS', ru: 'Нет GPS-сигнала' },
  gpsAtive:       { pt: 'Ative a localização nas configurações do celular', en: 'Enable location in your phone settings', es: 'Activa la ubicación en los ajustes del teléfono', ru: 'Включите геолокацию в настройках телефона' },
  ola:            { pt: 'Olá', en: 'Hi', es: 'Hola', ru: 'Привет' },
  trabalhando:    { pt: 'TRABALHANDO', en: 'WORKING', es: 'TRABAJANDO', ru: 'В РАБОТЕ' },
  parado:         { pt: 'PARADO', en: 'STOPPED', es: 'PARADO', ru: 'ОСТАНОВЛЕНО' },
  ha:             { pt: 'Há', en: 'For', es: 'Hace', ru: 'Уже' },
  enviandoFoto:   { pt: '📸 Enviando foto...', en: '📸 Uploading photo...', es: '📸 Enviando foto...', ru: '📸 Отправка фото...' },
  pararTrabalho:  { pt: '⏸ Parar trabalho', en: '⏸ Stop work', es: '⏸ Parar trabajo', ru: '⏸ Остановить работу' },
  iniciarTrabalho:{ pt: '▶ Iniciar trabalho + Foto', en: '▶ Start work + Photo', es: '▶ Iniciar trabajo + Foto', ru: '▶ Начать работу + Фото' },
  fotoTurnoAlt:   { pt: 'Foto turno', en: 'Shift photo', es: 'Foto turno', ru: 'Фото смены' },
  fotoTurnoReg:   { pt: '📸 Foto de início de turno registrada', en: '📸 Shift start photo recorded', es: '📸 Foto de inicio de turno registrada', ru: '📸 Фото начала смены сохранено' },
  localCompart:   { pt: '📍 Sua localização está sendo compartilhada', en: '📍 Your location is being shared', es: '📍 Tu ubicación está siendo compartida', ru: '📍 Ваше местоположение передаётся' },
  tarefasAtivas:  { pt: 'TAREFAS ATIVAS', en: 'ACTIVE TASKS', es: 'TAREAS ACTIVAS', ru: 'АКТИВНЫЕ ЗАДАЧИ' },
  nenhumaPendente:{ pt: '✅ Nenhuma tarefa pendente no momento', en: '✅ No pending tasks at the moment', es: '✅ Ninguna tarea pendiente por ahora', ru: '✅ Нет ожидающих задач' },
  // MinhasTarefas / filtros
  filtTodas:      { pt: 'Todas', en: 'All', es: 'Todas', ru: 'Все' },
  semTarefaFiltro:{ pt: 'Nenhuma tarefa neste filtro', en: 'No tasks in this filter', es: 'Ninguna tarea en este filtro', ru: 'Нет задач по этому фильтру' },
  // Kanban
  vencidas:       { pt: '⏰ Vencidas', en: '⏰ Overdue', es: '⏰ Vencidas', ru: '⏰ Просрочено' },
  buscarTarefa:   { pt: '🔍 Buscar tarefa, ponto ou agente...', en: '🔍 Search task, point or agent...', es: '🔍 Buscar tarea, punto o agente...', ru: '🔍 Поиск задачи, точки или агента...' },
  filtTodos:      { pt: 'Todos', en: 'All', es: 'Todos', ru: 'Все' },
  todosAgentes:   { pt: '👤 Todos os agentes', en: '👤 All agents', es: '👤 Todos los agentes', ru: '👤 Все агенты' },
  semAgente:      { pt: 'Sem agente', en: 'No agent', es: 'Sin agente', ru: 'Без агента' },
  prazoVencido:   { pt: '⏰ Prazo vencido', en: '⏰ Overdue', es: '⏰ Plazo vencido', ru: '⏰ Срок истёк' },
  limpar:         { pt: '✕ Limpar', en: '✕ Clear', es: '✕ Limpiar', ru: '✕ Очистить' },
  nenhumaEncontrada:{ pt: 'Nenhuma tarefa encontrada', en: 'No tasks found', es: 'Ninguna tarea encontrada', ru: 'Задачи не найдены' },
  // TarefaCard
  verNoMapa:      { pt: 'Ver no mapa', en: 'View on map', es: 'Ver en el mapa', ru: 'Показать на карте' },
  patAbrev:       { pt: 'pat.', en: 'sct.', es: 'pat.', ru: 'сам.' },
  vencidaBadge:   { pt: '⏰ Vencida', en: '⏰ Overdue', es: '⏰ Vencida', ru: '⏰ Просрочено' },
  // TarefaDetalhe
  voltar:         { pt: '← Voltar', en: '← Back', es: '← Volver', ru: '← Назад' },
  atualizado:     { pt: 'Atualizado!', en: 'Updated!', es: '¡Actualizado!', ru: 'Обновлено!' },
  progresso:      { pt: 'Progresso', en: 'Progress', es: 'Progreso', ru: 'Прогресс' },
  ver:            { pt: '📸 ver', en: '📸 view', es: '📸 ver', ru: '📸 смотреть' },
  googleMaps:     { pt: '🗺 Google Maps', en: '🗺 Google Maps', es: '🗺 Google Maps', ru: '🗺 Google Maps' },
  waze:           { pt: '🚗 Waze', en: '🚗 Waze', es: '🚗 Waze', ru: '🚗 Waze' },
  mudarDestinoTip:{ pt: 'Mudar destino clicando num ponto do mapa GoJet', en: 'Change destination by clicking a point on the GoJet map', es: 'Cambiar destino haciendo clic en un punto del mapa GoJet', ru: 'Изменить пункт назначения, кликнув по точке на карте GoJet' },
  fotos:          { pt: 'FOTOS', en: 'PHOTOS', es: 'FOTOS', ru: 'ФОТО' },
  fotoChegada:    { pt: '📸 Chegada', en: '📸 Arrival', es: '📸 Llegada', ru: '📸 Прибытие' },
  fotoConclusao:  { pt: '✅ Conclusão', en: '✅ Completion', es: '✅ Conclusión', ru: '✅ Завершение' },
  aguarde:        { pt: 'Aguarde...', en: 'Please wait...', es: 'Espera...', ru: 'Подождите...' },
  tirarFotoChegada:{ pt: 'Tirar foto de chegada (Iniciar)', en: 'Take arrival photo (Start)', es: 'Tomar foto de llegada (Iniciar)', ru: 'Сделать фото прибытия (Начать)' },
  iniciarSemFoto: { pt: '▶ Iniciar sem foto', en: '▶ Start without photo', es: '▶ Iniciar sin foto', ru: '▶ Начать без фото' },
  registrarEntregaParcial:{ pt: 'REGISTRAR ENTREGA PARCIAL', en: 'RECORD PARTIAL DELIVERY', es: 'REGISTRAR ENTREGA PARCIAL', ru: 'ЗАПИСАТЬ ЧАСТИЧНУЮ ДОСТАВКУ' },
  patinetesEntregues:{ pt: 'Patinetes entregues:', en: 'Scooters delivered:', es: 'Patinetes entregados:', ru: 'Доставлено самокатов:' },
  enviando:       { pt: 'Enviando...', en: 'Uploading...', es: 'Enviando...', ru: 'Отправка...' },
  registrarEntregaFoto:{ pt: 'Registrar', en: 'Record', es: 'Registrar', ru: 'Записать' },
  entregaComFoto: { pt: 'entrega(s) com foto', en: 'delivery(ies) with photo', es: 'entrega(s) con foto', ru: 'доставку(и) с фото' },
  fotoConclusaoBtn:{ pt: 'Foto de conclusão (Concluir)', en: 'Completion photo (Finish)', es: 'Foto de conclusión (Finalizar)', ru: 'Фото завершения (Завершить)' },
  concluirSemFoto:{ pt: '✓ Concluir sem foto', en: '✓ Finish without photo', es: '✓ Finalizar sin foto', ru: '✓ Завершить без фото' },
  cancelarTarefa: { pt: '🗑 Cancelar tarefa', en: '🗑 Cancel task', es: '🗑 Cancelar tarea', ru: '🗑 Отменить задачу' },
  confirmCancelar:{ pt: 'Cancelar tarefa?', en: 'Cancel task?', es: '¿Cancelar tarea?', ru: 'Отменить задачу?' },
  reatribuirTarefa:{ pt: '🔄 Reatribuir tarefa', en: '🔄 Reassign task', es: '🔄 Reasignar tarea', ru: '🔄 Переназначить задачу' },
  reatribuirPara: { pt: 'REATRIBUIR PARA', en: 'REASSIGN TO', es: 'REASIGNAR A', ru: 'ПЕРЕНАЗНАЧИТЬ НА' },
  agenteAtual:    { pt: 'Agente atual:', en: 'Current agent:', es: 'Agente actual:', ru: 'Текущий агент:' },
  selecionarAgente:{ pt: '— Selecionar agente —', en: '— Select agent —', es: '— Seleccionar agente —', ru: '— Выбрать агента —' },
  cancelar:       { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  salvando:       { pt: '⏳ Salvando...', en: '⏳ Saving...', es: '⏳ Guardando...', ru: '⏳ Сохранение...' },
  confirmar:      { pt: '✓ Confirmar', en: '✓ Confirm', es: '✓ Confirmar', ru: '✓ Подтвердить' },
  historico:      { pt: 'HISTÓRICO', en: 'HISTORY', es: 'HISTORIAL', ru: 'ИСТОРИЯ' },
  detalhes:       { pt: 'DETALHES', en: 'DETAILS', es: 'DETALLES', ru: 'ДЕТАЛИ' },
  dCriado:        { pt: 'Criado', en: 'Created', es: 'Creado', ru: 'Создано' },
  dPrazo:         { pt: 'Prazo', en: 'Due date', es: 'Plazo', ru: 'Срок' },
  dIniciado:      { pt: 'Iniciado', en: 'Started', es: 'Iniciado', ru: 'Начато' },
  dConcluido:     { pt: 'Concluído', en: 'Completed', es: 'Concluido', ru: 'Завершено' },
  dDuracao:       { pt: 'Duração', en: 'Duration', es: 'Duración', ru: 'Длительность' },
  dAgente:        { pt: 'Agente', en: 'Agent', es: 'Agente', ru: 'Агент' },
  dReatribuido:   { pt: 'Reatribuído em', en: 'Reassigned on', es: 'Reasignado en', ru: 'Переназначено' },
  dGeradoPor:     { pt: 'Gerado por', en: 'Generated by', es: 'Generado por', ru: 'Создано' },
  geradoAuto:     { pt: 'GoJet automático', en: 'GoJet automatic', es: 'GoJet automático', ru: 'GoJet автоматически' },
  geradoManual:   { pt: 'Manual', en: 'Manual', es: 'Manual', ru: 'Вручную' },
  // Audit log labels
  alCriada:       { pt: 'Criada', en: 'Created', es: 'Creada', ru: 'Создано' },
  alReatribuida:  { pt: 'Reatribuída', en: 'Reassigned', es: 'Reasignada', ru: 'Переназначено' },
  alEntregaParcial:{ pt: 'Entrega parcial', en: 'Partial delivery', es: 'Entrega parcial', ru: 'Частичная доставка' },
  alDestino:      { pt: 'Destino', en: 'Destination', es: 'Destino', ru: 'Назначение' },
  // TarefaDetalhe ok messages
  okChegada:      { pt: 'Chegada registrada! Tarefa iniciada.', en: 'Arrival recorded! Task started.', es: '¡Llegada registrada! Tarea iniciada.', ru: 'Прибытие записано! Задача начата.' },
  okConcluida:    { pt: 'Tarefa concluída!', en: 'Task completed!', es: '¡Tarea completada!', ru: 'Задача завершена!' },
  okMeta:         { pt: '✅ Meta atingida! Tarefa concluída.', en: '✅ Target reached! Task completed.', es: '✅ ¡Meta alcanzada! Tarea completada.', ru: '✅ Цель достигнута! Задача завершена.' },
  entregues:      { pt: 'entregue(s). Total:', en: 'delivered. Total:', es: 'entregado(s). Total:', ru: 'доставлено. Всего:' },
  okReatribuido:  { pt: 'Reatribuído para', en: 'Reassigned to', es: 'Reasignado a', ru: 'Переназначено на' },
  okDestino:      { pt: 'Destino atualizado!', en: 'Destination updated!', es: '¡Destino actualizado!', ru: 'Назначение обновлено!' },
  // CriarTarefa
  tituloObrig:    { pt: 'Título obrigatório', en: 'Title required', es: 'Título obligatorio', ru: 'Требуется название' },
  pontoGoJet:     { pt: '🛴 Ponto GoJet', en: '🛴 GoJet point', es: '🛴 Punto GoJet', ru: '🛴 Точка GoJet' },
  modoManual:     { pt: '✏️ Manual', en: '✏️ Manual', es: '✏️ Manual', ru: '✏️ Вручную' },
  lblTipo:        { pt: 'TIPO', en: 'TYPE', es: 'TIPO', ru: 'ТИП' },
  disponiveis:    { pt: 'disponíveis', en: 'available', es: 'disponibles', ru: 'доступно' },
  zeradoBadge:    { pt: ' — ZERADO 🚨', en: ' — EMPTY 🚨', es: ' — VACÍO 🚨', ru: ' — ПУСТО 🚨' },
  trocar:         { pt: '✕ Trocar', en: '✕ Change', es: '✕ Cambiar', ru: '✕ Сменить' },
  buscarPontoGoJet:{ pt: '🔍 Buscar ponto GoJet...', en: '🔍 Search GoJet point...', es: '🔍 Buscar punto GoJet...', ru: '🔍 Поиск точки GoJet...' },
  soCriticos:     { pt: '🔴 Só críticos', en: '🔴 Critical only', es: '🔴 Solo críticos', ru: '🔴 Только критичные' },
  todosPontos:    { pt: '📍 Todos', en: '📍 All', es: '📍 Todos', ru: '📍 Все' },
  carregandoPontos:{ pt: 'Carregando pontos...', en: 'Loading points...', es: 'Cargando puntos...', ru: 'Загрузка точек...' },
  snapshotIndisp: { pt: 'Snapshot GoJet não disponível.', en: 'GoJet snapshot not available.', es: 'Snapshot GoJet no disponible.', ru: 'Снимок GoJet недоступен.' },
  ativeOverlay:   { pt: 'Ative o overlay GoJet no mapa para atualizar.', en: 'Enable the GoJet overlay on the map to refresh.', es: 'Activa la capa GoJet en el mapa para actualizar.', ru: 'Включите слой GoJet на карте для обновления.' },
  dispAbrev:      { pt: 'disp.', en: 'avail.', es: 'disp.', ru: 'дост.' },
  faltam:         { pt: 'faltam', en: 'missing', es: 'faltan', ru: 'не хватает' },
  zerado:         { pt: 'ZERADO', en: 'EMPTY', es: 'VACÍO', ru: 'ПУСТО' },
  pontosUseBusca: { pt: 'pontos. Use a busca para filtrar.', en: 'points. Use search to filter.', es: 'puntos. Usa la búsqueda para filtrar.', ru: 'точек. Используйте поиск для фильтрации.' },
  maisPontos:     { pt: 'pontos', en: 'points', es: 'puntos', ru: 'точек' },
  lblPontoEndereco:{ pt: 'PONTO / ENDEREÇO', en: 'POINT / ADDRESS', es: 'PUNTO / DIRECCIÓN', ru: 'ТОЧКА / АДРЕС' },
  phPontoEndereco:{ pt: 'Ex: Ibirapuera Portão 6', en: 'Ex: Ibirapuera Gate 6', es: 'Ej: Ibirapuera Portón 6', ru: 'Напр.: Ibirapuera ворота 6' },
  lblPatLevar:    { pt: 'PATINETES A LEVAR', en: 'SCOOTERS TO BRING', es: 'PATINETES A LLEVAR', ru: 'САМОКАТЫ К ДОСТАВКЕ' },
  deficitAuto:    { pt: 'Déficit automático:', en: 'Auto deficit:', es: 'Déficit automático:', ru: 'Авто-дефицит:' },
  phEx5:          { pt: 'Ex: 5', en: 'Ex: 5', es: 'Ej: 5', ru: 'Напр.: 5' },
  lblIdentifier:  { pt: 'IDENTIFIER DA PATINETE', en: 'SCOOTER IDENTIFIER', es: 'IDENTIFICADOR DEL PATINETE', ru: 'ИДЕНТИФИКАТОР САМОКАТА' },
  lblTitulo:      { pt: 'TÍTULO', en: 'TITLE', es: 'TÍTULO', ru: 'НАЗВАНИЕ' },
  phTitulo:       { pt: 'Título da tarefa', en: 'Task title', es: 'Título de la tarea', ru: 'Название задачи' },
  lblDescricao:   { pt: 'DESCRIÇÃO (opcional)', en: 'DESCRIPTION (optional)', es: 'DESCRIPCIÓN (opcional)', ru: 'ОПИСАНИЕ (необязательно)' },
  lblPrioridade:  { pt: 'PRIORIDADE', en: 'PRIORITY', es: 'PRIORIDAD', ru: 'ПРИОРИТЕТ' },
  lblAtribuir:    { pt: 'ATRIBUIR A', en: 'ASSIGN TO', es: 'ASIGNAR A', ru: 'НАЗНАЧИТЬ НА' },
  semAtribuicao:  { pt: '— Sem atribuição —', en: '— Unassigned —', es: '— Sin asignar —', ru: '— Без назначения —' },
  lblPrazo:       { pt: 'PRAZO', en: 'DUE DATE', es: 'PLAZO', ru: 'СРОК' },
  prazoAutoTxt:   { pt: 'auto', en: 'auto', es: 'auto', ru: 'авто' },
  prazoOpcional:  { pt: 'opcional', en: 'optional', es: 'opcional', ru: 'необязательно' },
  criando:        { pt: '⏳ Criando...', en: '⏳ Creating...', es: '⏳ Creando...', ru: '⏳ Создание...' },
  criarTarefaBtn: { pt: '✅ Criar tarefa', en: '✅ Create task', es: '✅ Crear tarea', ru: '✅ Создать задачу' },
  // Dashboard
  per7d:          { pt: '7 dias', en: '7 days', es: '7 días', ru: '7 дней' },
  per30d:         { pt: '30 dias', en: '30 days', es: '30 días', ru: '30 дней' },
  perTudo:        { pt: 'Tudo', en: 'All', es: 'Todo', ru: 'Всё' },
  kpiTotal:       { pt: 'Total tarefas', en: 'Total tasks', es: 'Total tareas', ru: 'Всего задач' },
  kpiConcluidas:  { pt: 'Concluídas', en: 'Completed', es: 'Completadas', ru: 'Завершено' },
  kpiTaxa:        { pt: 'Taxa conclusão', en: 'Completion rate', es: 'Tasa de conclusión', ru: 'Доля завершения' },
  kpiDuracao:     { pt: 'Duração média', en: 'Avg. duration', es: 'Duración media', ru: 'Ср. длительность' },
  porTipo:        { pt: 'POR TIPO', en: 'BY TYPE', es: 'POR TIPO', ru: 'ПО ТИПУ' },
  rankingAgentes: { pt: 'RANKING AGENTES', en: 'AGENT RANKING', es: 'RANKING AGENTES', ru: 'РЕЙТИНГ АГЕНТОВ' },
  porTarefa:      { pt: 'min/tarefa', en: 'min/task', es: 'min/tarea', ru: 'мин/задача' },
  semDados:       { pt: 'Sem dados', en: 'No data', es: 'Sin datos', ru: 'Нет данных' },
  topPontos:      { pt: 'TOP PONTOS', en: 'TOP POINTS', es: 'TOP PUNTOS', ru: 'ТОП ТОЧЕК' },
  // Historico
  todosStatus:    { pt: 'Todos status', en: 'All statuses', es: 'Todos los estados', ru: 'Все статусы' },
  todosTipos:     { pt: 'Todos tipos', en: 'All types', es: 'Todos los tipos', ru: 'Все типы' },
  histTodosAgentes:{ pt: 'Todos agentes', en: 'All agents', es: 'Todos los agentes', ru: 'Все агенты' },
  buscar:         { pt: '🔍 Buscar...', en: '🔍 Search...', es: '🔍 Buscar...', ru: '🔍 Поиск...' },
  tarefasPag:     { pt: 'tarefas · pág', en: 'tasks · page', es: 'tareas · pág', ru: 'задач · стр.' },
  anterior:       { pt: '‹ Anterior', en: '‹ Previous', es: '‹ Anterior', ru: '‹ Назад' },
  proxima:        { pt: 'Próxima ›', en: 'Next ›', es: 'Siguiente ›', ru: 'Далее ›' },
  // Micro
  carregando:     { pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  // Extras adicionados na conclusão da tradução
  nenhumaPendenteMomento:{ pt: '✅ Nenhuma tarefa pendente no momento', en: '✅ No pending tasks at the moment', es: '✅ Ninguna tarea pendiente por ahora', ru: '✅ Нет ожидающих задач' },
  lblLat:         { pt: 'LAT', en: 'LAT', es: 'LAT', ru: 'ШИР' },
  lblLng:         { pt: 'LNG', en: 'LNG', es: 'LNG', ru: 'ДОЛ' },
  prazoAutoLabel: { pt: 'auto', en: 'auto', es: 'auto', ru: 'авто' },
  exportCsv:      { pt: '⬇ CSV', en: '⬇ CSV', es: '⬇ CSV', ru: '⬇ CSV' },
  // Audit log com interpolação
  alCriadaTxt:    { pt: 'Criada', en: 'Created', es: 'Creada', ru: 'Создано' },
  alReatribuidaTxt:{ pt: 'Reatribuída', en: 'Reassigned', es: 'Reasignada', ru: 'Переназначено' },
  alEntregaParcialTxt:{ pt: 'Entrega parcial', en: 'Partial delivery', es: 'Entrega parcial', ru: 'Частичная доставка' },
  alDestinoTxt:   { pt: 'Destino', en: 'Destination', es: 'Destino', ru: 'Назначение' },
  tituloLevar:    { pt: '→ levar', en: '→ bring', es: '→ llevar', ru: '→ доставить' },
} satisfies Record<string, Tr>;

// Labels traduzíveis dos enums (não altera os enums/cores em KIND/STATUS/PRIO).
const KIND_TR: Record<TarefaKind, Tr> = {
  PONTO:         T.kindPonto,
  PATINETE:      T.kindPatinete,
  ORGANIZACAO:   T.kindOrganizacao,
  CARGA_BATERIA: T.kindCargaBateria,
};
const STATUS_TR: Record<TarefaStatus, Tr> = {
  pendente:    T.stPendente,
  em_execucao: T.stEmExecucao,
  concluida:   T.stConcluida,
  cancelada:   T.stCancelada,
};
const PRIO_TR: Record<number, Tr> = {
  1: T.prioBaixa,
  2: T.prioNormal,
  3: T.prioAlta,
  4: T.prioUrgente,
  5: T.prioCritica,
};
const useLang = (): Lang => {
  const { i18n } = useTranslation();
  return (((i18n.language || 'pt').slice(0, 2)) as Lang);
};
const pickL = (o: Tr, lang: Lang) => o[lang] ?? o.pt;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function TarefasLogisticaModule({
  usuario, cidade, pais, onFechar, parkingInicial, tarefaAbertaId, onSelecionarDestino,
}: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  type Aba = 'home' | 'minhas' | 'kanban' | 'criar' | 'dashboard' | 'historico';
  const [aba, setAba]               = useState<Aba>(isAdminRole(usuario.role) ? 'kanban' : 'home');
  const [tarefas, setTarefas]       = useState<TarefaLogistica[]>([]);
  const [tarefaSel, setTarefaSel]   = useState<TarefaLogistica | null>(null);
  const [loading, setLoading]       = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [agentes, setAgentes]       = useState<{ uid: string; nome: string; email: string }[]>([]);

  useEffect(() => { if (parkingInicial && isAdminRole(usuario.role)) setAba('criar'); }, [parkingInicial]);

  // Deep link: abre tarefa específica assim que a lista carregar
  useEffect(() => {
    if (!tarefaAbertaId || loading) return;
    const t = tarefas.find(x => x.id === tarefaAbertaId);
    if (t) setTarefaSel(t);
  }, [tarefaAbertaId, tarefas, loading]);

  // Supabase polling — carrega tarefas periodicamente
  useEffect(() => {
    const isAdmin = isAdminRole(usuario.role);
    let cancelled = false;
    const load = async () => {
      try {
        let q = supabase
          .from('tarefas_logistica')
          .select('*')
          .eq('cidade', cidade)
          .order('criado_em', { ascending: false })
          .limit(isAdmin ? 300 : 100);
        if (!isAdmin) q = q.eq('assignee_uid', usuario.uid);
        const { data, error } = await q;
        if (error) throw error;
        if (!cancelled) {
          const mapped = (data ?? []).map((r: any) => ({
            id: String(r.id),
            kind: r.kind ?? 'PONTO',
            titulo: r.titulo ?? '',
            descricao: r.descricao ?? '',
            status: r.status ?? 'pendente',
            prioridade: r.prioridade ?? 3,
            parkingId: r.parking_id,
            parkingNome: r.parking_nome,
            parkingLat: r.parking_lat,
            parkingLng: r.parking_lng,
            bikeIdentifier: r.bike_identifier,
            bikeLat: r.bike_lat,
            bikeLng: r.bike_lng,
            targetCount: r.target_count,
            deliveredCount: r.delivered_count ?? 0,
            entregas: r.entregas ?? [],
            assigneeUid: r.assignee_uid,
            assigneeNome: r.responsavel_nome ?? r.assignee_nome,
            cidade: r.cidade ?? '',
            pais: r.pais ?? 'BR',
            criadoPor: r.criado_por ?? '',
            criadoEm: r.criado_em,
            atualizadoEm: r.atualizado_em,
            iniciadoEm: r.iniciado_em,
            concluidoEm: r.concluido_em,
            fotoChegadaUrl: r.foto_chegada_url,
            fotoConclusaoUrl: r.foto_conclusao_url,
            geradoPorGoJet: r.gerado_por_gojet,
            slotId: r.slot_id,
            bateriaPercent: r.bateria_percent,
            due_at: r.due_at,
            destinoAlteradoEm: r.destino_alterado_em,
          })) as TarefaLogistica[];
          setTarefas(mapped);
          setLoading(false);
        }
      } catch (err) {
        console.error('[tarefas] load error:', err);
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [cidade, usuario.uid, usuario.role]);

  useEffect(() => {
    if (!isAdminRole(usuario.role)) return;
    fetchUsuarios({ role_in: ['logistica','campo','charger','scalt'] })
      .then(users => setAgentes(users.map((u: any) => ({ uid: u.uid, nome: u.nome||u.email, email: u.email }))))
      .catch(() => {});
  }, [usuario.role]);

  if (tarefaSel) return (
    <TarefaDetalhe
      tarefa={tarefaSel} usuario={usuario} agentes={agentes}
      onVoltar={() => setTarefaSel(null)}
      onAtualizar={(t) => { if (t) setTarefaSel(t); else setTarefaSel(null); }}
      onSelecionarDestino={onSelecionarDestino}
    />
  );

  const abas: { k: Aba; l: string; roles: string[] }[] = [
    { k: 'home',       l: pick(T.abaInicio),    roles: ['logistica','campo','charger'] },
    { k: 'minhas',     l: pick(T.abaMinhas),    roles: ['logistica','campo','charger','admin','gestor','supergestor'] },
    { k: 'kanban',     l: pick(T.abaKanban),    roles: ['admin','gestor','supergestor'] },
    { k: 'criar',      l: pick(T.abaCriar),     roles: ['admin','gestor','supergestor'] },
    { k: 'dashboard',  l: pick(T.abaStats),     roles: ['admin','gestor','supergestor'] },
    { k: 'historico',  l: pick(T.abaHistorico), roles: ['admin','gestor','supergestor'] },
  ];
  const abasFiltradas = abas.filter(a => a.roles.some(r => usuario.role.includes(r) || a.roles.includes(usuario.role)));

  const pendentes = tarefas.filter(t => t.status==='pendente'||t.status==='em_execucao').length;

  return (
    <div style={S.painel(fullscreen)}>
      {/* Header */}
      <div style={S.header}>
        <button onClick={onFechar} style={S.ghost}>✕</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#dce8ff' }}>{pick(T.tituloModulo)}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{cidade}</div>
        </div>
        {pendentes > 0 && (
          <div style={{ background: '#ef4444', color: '#fff', borderRadius: 10,
            padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{pendentes}</div>
        )}
        {isAdminRole(usuario.role) && (
          <button onClick={() => setFullscreen(v => !v)} style={S.ghost} title={pick(T.telaCheia)}>
            {fullscreen ? '⊡' : '⊞'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.06)',
        overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }}>
        {abasFiltradas.map(a => (
          <button key={a.k} onClick={() => setAba(a.k)} style={{
            flexShrink: 0, padding: '10px 12px', border: 'none', cursor: 'pointer',
            background: 'transparent', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            color: aba === a.k ? '#3b82f6' : 'rgba(255,255,255,.4)',
            borderBottom: aba === a.k ? '2px solid #3b82f6' : '2px solid transparent',
          }}>{a.l}</button>
        ))}
      </div>

      {/* Content */}
      <div style={S.body}>
        {aba === 'home'      && <WorkerHome tarefas={tarefas} usuario={usuario} onAbrirTarefa={setTarefaSel} />}
        {aba === 'minhas'    && <MinhasTarefas tarefas={tarefas} loading={loading} usuario={usuario} onAbrirTarefa={setTarefaSel} />}
        {aba === 'kanban'    && <KanbanBoard tarefas={tarefas} loading={loading} fullscreen={fullscreen} onAbrirTarefa={setTarefaSel} agentes={agentes} />}
        {aba === 'criar'     && <CriarTarefa usuario={usuario} cidade={cidade} pais={pais} agentes={agentes} parkingInicial={parkingInicial} onCriada={() => setAba('kanban')} />}
        {aba === 'dashboard' && <Dashboard tarefas={tarefas} agentes={agentes} />}
        {aba === 'historico' && <Historico tarefas={tarefas} agentes={agentes} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER HOME — tela inicial do agente de campo
// ═══════════════════════════════════════════════════════════════════════════════

function WorkerHome({ tarefas, usuario, onAbrirTarefa }: {
  tarefas: TarefaLogistica[]; usuario: Props['usuario'];
  onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [trabalhando, setTrabalhando] = useState(
    () => localStorage.getItem('jet:worker-status') === 'working'
  );
  const [startedAt] = useState(() => {
    const v = localStorage.getItem('jet:worker-started-at');
    return v ? new Date(v) : null;
  });
  const [elapsed, setElapsed] = useState('');
  const [gpsErro, setGpsErro] = useState<string | null>(null);

  useEffect(() => {
    if (trabalhando) void startGPSTracking(usuario.uid, setGpsErro);
    return () => { /* não para GPS ao desmontar — continua em background */ };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!trabalhando || !startedAt) return;
    const t = setInterval(() => {
      const ms = Date.now() - startedAt.getTime();
      const m  = Math.floor(ms / 60000);
      setElapsed(m < 60 ? `${m}min` : `${Math.floor(m/60)}h ${m%60}min`);
    }, 30000);
    return () => clearInterval(t);
  }, [trabalhando, startedAt]);

  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fotoTurno, setFotoTurno] = useState<string | null>(
    () => localStorage.getItem('jet:worker-foto-turno')
  );
  const [uploadingFoto, setUploadingFoto] = useState(false);

  const toggle = () => {
    const agora = new Date();
    if (trabalhando) {
      localStorage.setItem('jet:worker-status', 'stopped');
      localStorage.removeItem('jet:worker-started-at');
      localStorage.removeItem('jet:worker-foto-turno');
      setTrabalhando(false);
      setFotoTurno(null);
      void stopGPSTracking();
    } else {
      // Solicita foto antes de iniciar
      void iniciarCaptura();
    }
  };

  // Captura a foto de início. No app nativo usa a CÂMERA do Capacitor (devolve JPEG —
  // evita o HEIC que o WebView não renderiza, ver lib/imageUtils). Na web, usa o <input>.
  const iniciarCaptura = async () => {
    if (isAndroidNative()) {
      let f: File | null = null;
      try {
        f = await capturarFotoNativa();
      } catch (e) {
        console.warn('[turno] câmera nativa indisponível, fallback p/ input', e);
        fileRef.current?.click();
        return;
      }
      if (f) await iniciarComFoto(f); // usuário cancelou a câmera → f null → não inicia
    } else {
      fileRef.current?.click();
    }
  };

  const iniciarComFoto = async (file: File) => {
    const agora = new Date();
    setUploadingFoto(true);
    try {
      const comp = await comprimir(file);
      const path = `turnos/${usuario.uid}/${agora.getTime()}.jpg`;
      const url  = await uploadComRetry(comp, path);
      // Salva no Supabase (best-effort)
      try {
        const turnoDoc = {
          uid: usuario.uid, nome: usuario.nome ?? usuario.email,
          foto_url: url, acao: 'inicio',
          criado_em: new Date().toISOString(),
          cidade: '',
        };
        await supabase.from('turnos_logistica').insert(turnoDoc);
      } catch { /* best-effort */ }
      localStorage.setItem('jet:worker-status', 'working');
      localStorage.setItem('jet:worker-started-at', agora.toISOString());
      localStorage.setItem('jet:worker-foto-turno', url);
      setFotoTurno(url);
      setTrabalhando(true);
      void startGPSTracking(usuario.uid, setGpsErro);
    } catch (e: any) {
      localStorage.setItem('jet:worker-status', 'working');
      localStorage.setItem('jet:worker-started-at', agora.toISOString());
      setTrabalhando(true);
      void startGPSTracking(usuario.uid, setGpsErro);
    } finally {
      setUploadingFoto(false);
    }
  };

  const ativas = tarefas.filter(t => t.assigneeUid === usuario.uid &&
    (t.status === 'pendente' || t.status === 'em_execucao'));

  return (
    <div style={{ padding: 16 }}>

      {/* Banner GPS sem sinal */}
      {trabalhando && gpsErro && (
        <div style={{
          background: 'rgba(239,68,68,.18)', border: '1px solid rgba(239,68,68,.35)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>📵</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, color: '#fca5a5' }}>{pick(T.gpsSemSinal)}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
              {pick(T.gpsAtive)}
            </div>
          </div>
        </div>
      )}

      {/* Status card */}
      <div style={{ background: '#111827', borderRadius: 12, padding: 20,
        border: `1px solid ${trabalhando ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.08)'}`,
        marginBottom: 16, textAlign: 'center' as const }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
          {pick(T.ola)}, {(usuario.nome ?? usuario.email ?? '').split(' ')[0]}! 👋
        </div>
        <div style={{ fontSize: 28, marginBottom: 4 }}>
          {trabalhando ? '🟢' : '⚪'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: trabalhando ? '#10b981' : '#6b7280',
          marginBottom: trabalhando ? 4 : 12 }}>
          {trabalhando ? pick(T.trabalhando) : pick(T.parado)}
        </div>
        {trabalhando && elapsed && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 12 }}>
            {pick(T.ha)} {elapsed}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          style={{ display: 'none' }}
          onChange={async e => {
            const f = e.target.files?.[0];
            if (f) await iniciarComFoto(f);
            if (e.target) e.target.value = '';
          }} />
        <button onClick={toggle} disabled={uploadingFoto} style={{
          ...S.btn(trabalhando ? '#ef4444' : '#10b981'),
          width: '100%', fontSize: 14, padding: '12px',
          opacity: uploadingFoto ? 0.6 : 1,
        }}>
          {uploadingFoto ? pick(T.enviandoFoto) : trabalhando ? pick(T.pararTrabalho) : pick(T.iniciarTrabalho)}
        </button>
        {fotoTurno && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <img src={fotoTurno} alt={pick(T.fotoTurnoAlt)} style={{ width: 48, height: 48,
              objectFit: 'cover', borderRadius: 8 }} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>
              {pick(T.fotoTurnoReg)}
            </span>
          </div>
        )}
        {trabalhando && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 8 }}>
            {pick(T.localCompart)}
          </div>
        )}
      </div>

      {/* Tarefas ativas */}
      {ativas.length > 0 && (
        <>
          <div style={{ ...S.lbl, marginBottom: 10 }}>
            {pick(T.tarefasAtivas)} ({ativas.length})
          </div>
          {ativas.sort((a,b) => (b.prioridade??3)-(a.prioridade??3)).map(t => (
            <TarefaCard key={t.id} tarefa={t} onClick={() => onAbrirTarefa(t)} />
          ))}
        </>
      )}

      {ativas.length === 0 && trabalhando && (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.3)', padding: '20px 0', fontSize: 12 }}>
          {pick(T.nenhumaPendenteMomento)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINHAS TAREFAS
// ═══════════════════════════════════════════════════════════════════════════════

function MinhasTarefas({ tarefas, loading, usuario, onAbrirTarefa }: {
  tarefas: TarefaLogistica[]; loading: boolean;
  usuario: Props['usuario']; onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [filtro, setFiltro] = useState<TarefaStatus | 'todas'>('todas');
  const minhas = tarefas.filter(t => t.assigneeUid === usuario.uid || isAdminRole(usuario.role));
  const filtradas = filtro === 'todas' ? minhas : minhas.filter(t => t.status === filtro);

  if (loading) return <Loading />;
  return (
    <div style={{ padding: 12 }}>
      {/* Filtro status */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' as const }}>
        {(['todas','pendente','em_execucao','concluida'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            padding: '5px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600,
            background: filtro === f ? '#3b82f6' : 'rgba(255,255,255,.06)',
            color: filtro === f ? '#fff' : 'rgba(255,255,255,.4)',
          }}>
            {f === 'todas' ? `${pick(T.filtTodas)} (${minhas.length})`
              : `${pick(STATUS_TR[f])} (${minhas.filter(t=>t.status===f).length})`}
          </button>
        ))}
      </div>

      {filtradas.length === 0
        ? <Empty msg={pick(T.semTarefaFiltro)} />
        : filtradas.sort((a,b)=>(b.prioridade??3)-(a.prioridade??3)).map(t => (
            <TarefaCard key={t.id} tarefa={t} onClick={() => onAbrirTarefa(t)} showAssignee={isAdminRole(usuario.role)} />
          ))
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// KANBAN
// ═══════════════════════════════════════════════════════════════════════════════

function KanbanBoard({ tarefas, loading, fullscreen, onAbrirTarefa, agentes }: {
  tarefas: TarefaLogistica[]; loading: boolean; agentes: { uid: string; nome: string }[];
  fullscreen: boolean; onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [busca,        setBusca       ] = useState('');
  const [filtroKind,   setFiltroKind  ] = useState<TarefaKind | 'todas'>('todas');
  const [filtroAgente, setFiltroAgente] = useState('');
  const [soPrazoVenc,  setSoPrazoVenc ] = useState(false);

  if (loading) return <Loading />;

  const agora = Date.now();
  const filtradas = tarefas.filter(t => {
    if (filtroKind !== 'todas' && t.kind !== filtroKind) return false;
    if (filtroAgente === '__sem__' && t.assigneeUid) return false;
    if (filtroAgente && filtroAgente !== '__sem__' && t.assigneeUid !== filtroAgente) return false;
    if (soPrazoVenc) {
      const due = t.due_at?.toDate?.()?.getTime() ?? (t.due_at ? new Date(t.due_at).getTime() : null);
      if (!due || due >= agora || t.status === 'concluida' || t.status === 'cancelada') return false;
    }
    if (busca) {
      const q = busca.toLowerCase();
      if (!t.titulo.toLowerCase().includes(q)
        && !(t.parkingNome ?? '').toLowerCase().includes(q)
        && !(t.assigneeNome ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cols: TarefaStatus[] = ['pendente','em_execucao','concluida'];

  return (
    <div style={{ padding: 12 }}>
      {/* Stats header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {cols.map(s => {
          const n = tarefas.filter(t => t.status === s).length;
          return (
            <div key={s} style={{ flex: 1, background: '#111827', borderRadius: 8,
              padding: '8px 10px', border: `1px solid ${STATUS[s].cor}25` }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: STATUS[s].cor }}>{n}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)' }}>{pick(STATUS_TR[s])}</div>
            </div>
          );
        })}
        {/* Vencidas badge */}
        {(() => { const v = tarefas.filter(t => { const d = t.due_at?.toDate?.()?.getTime() ?? null; return d && d < agora && t.status !== 'concluida' && t.status !== 'cancelada'; }).length; return v > 0 ? (
          <div style={{ flex: 1, background: '#1a0a0a', borderRadius: 8,
            padding: '8px 10px', border: '1px solid #ef444430', cursor: 'pointer' }}
            onClick={() => setSoPrazoVenc(v => !v)}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{v}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)' }}>{pick(T.vencidas)}</div>
          </div>
        ) : null; })()}
      </div>

      {/* Filtros */}
      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder={pick(T.buscarTarefa)}
        style={{ ...S.inp, marginBottom: 8 }} />

      {/* Linha 1: tipo */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, overflowX: 'auto', paddingBottom: 2 }}>
        <button onClick={() => setFiltroKind('todas')} style={{
          padding: '4px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 600, flexShrink: 0,
          background: filtroKind === 'todas' ? '#3b82f6' : 'rgba(255,255,255,.06)',
          color: filtroKind === 'todas' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>{pick(T.filtTodos)}</button>
        {(Object.keys(KIND) as TarefaKind[]).map(k => (
          <button key={k} onClick={() => setFiltroKind(k)} style={{
            padding: '4px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600, flexShrink: 0,
            background: filtroKind === k ? KIND[k].cor : 'rgba(255,255,255,.06)',
            color: filtroKind === k ? '#fff' : 'rgba(255,255,255,.4)',
          }}>{KIND[k].icon} {pick(KIND_TR[k])}</button>
        ))}
      </div>

      {/* Linha 2: agente + prazo vencido */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={filtroAgente} onChange={e => setFiltroAgente(e.target.value)}
          style={{ ...S.inp, width: 'auto', flex: 1, minWidth: 140, marginBottom: 0, colorScheme: 'dark', appearance: 'none' as const }}>
          <option value="">{pick(T.todosAgentes)}</option>
          <option value="__sem__">{pick(T.semAgente)}</option>
          {agentes.map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
        </select>
        <button onClick={() => setSoPrazoVenc(v => !v)} style={{
          padding: '4px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 600, flexShrink: 0,
          background: soPrazoVenc ? '#ef4444' : 'rgba(255,255,255,.06)',
          color: soPrazoVenc ? '#fff' : 'rgba(255,255,255,.4)',
        }}>{pick(T.prazoVencido)}</button>
        {(busca || filtroKind !== 'todas' || filtroAgente || soPrazoVenc) && (
          <button onClick={() => { setBusca(''); setFiltroKind('todas'); setFiltroAgente(''); setSoPrazoVenc(false); }} style={{
            padding: '4px 10px', borderRadius: 16, border: '1px solid rgba(255,255,255,.15)',
            background: 'transparent', color: 'rgba(255,255,255,.4)', fontSize: 10, cursor: 'pointer',
          }}>{pick(T.limpar)}</button>
        )}
      </div>

      {/* Colunas */}
      {fullscreen ? (
        // Desktop fullscreen: colunas lado a lado
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {cols.map(status => (
            <KanbanCol key={status} status={status}
              items={filtradas.filter(t => t.status === status)}
              onAbrirTarefa={onAbrirTarefa} />
          ))}
        </div>
      ) : (
        // Mobile: colunas em lista
        <>
          {cols.map(status => {
            const items = filtradas.filter(t => t.status === status);
            if (items.length === 0) return null;
            return <KanbanCol key={status} status={status} items={items} onAbrirTarefa={onAbrirTarefa} />;
          })}
        </>
      )}

      {filtradas.length === 0 && <Empty msg={pick(T.nenhumaEncontrada)} />}
    </div>
  );
}

function KanbanCol({ status, items, onAbrirTarefa }: {
  status: TarefaStatus; items: TarefaLogistica[];
  onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const m = STATUS[status];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: m.cor,
        marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.cor, display: 'inline-block' }} />
        {pick(STATUS_TR[status])} ({items.length})
      </div>
      {items.sort((a,b) => (b.prioridade??3)-(a.prioridade??3)).map(t => (
        <TarefaCard key={t.id} tarefa={t} onClick={() => onAbrirTarefa(t)} showAssignee compact />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAREFA CARD
// ═══════════════════════════════════════════════════════════════════════════════

function TarefaCard({ tarefa, onClick, compact, showAssignee }: {
  tarefa: TarefaLogistica; onClick: () => void;
  compact?: boolean; showAssignee?: boolean;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const k = KIND[tarefa.kind]; const s = STATUS[tarefa.status]; const p = PRIO[tarefa.prioridade??3];
  const progresso = tarefa.targetCount && tarefa.targetCount > 0
    ? Math.min(100, Math.round(((tarefa.deliveredCount??0)/tarefa.targetCount)*100)) : null;

  const cardLat = tarefa.parkingLat ?? tarefa.bikeLat;
  const cardLng = tarefa.parkingLng ?? tarefa.bikeLng;
  const hasCoords = cardLat != null && cardLng != null;

  return (
    <div onClick={onClick} style={{ background: '#111827', borderRadius: 10, padding: compact?10:14,
      marginBottom: 8, border: `1px solid ${k.cor}20`, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 13 }}>{k.icon}</span>
        {tarefa.geradoPorGoJet && (
          <span style={{ fontSize: 8, background: 'rgba(59,130,246,.2)', color: '#60a5fa',
            padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>AUTO</span>
        )}
        <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#dce8ff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tarefa.titulo}
        </div>
        {hasCoords && (
          <button
            title={pick(T.verNoMapa)}
            onClick={e => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('jetMapFocus', {
                detail: { lat: cardLat, lng: cardLng, label: tarefa.parkingNome ?? tarefa.titulo },
              }));
            }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#60a5fa', fontSize: 14, padding: '2px 4px', flexShrink: 0,
              lineHeight: 1,
            }}
          >📍</button>
        )}
        <span style={{ fontSize: 9, background: `${p.cor}20`, color: p.cor,
          padding: '1px 5px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>
          {pick(PRIO_TR[tarefa.prioridade??3])}
        </span>
      </div>

      {!compact && tarefa.parkingNome && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>
          📍 {tarefa.parkingNome}
          {tarefa.targetCount != null && (
            <span style={{ color: '#3b82f6' }}>
              {' '}— {tarefa.deliveredCount??0}/{tarefa.targetCount} {pick(T.patAbrev)}
            </span>
          )}
        </div>
      )}

      {/* Barra de progresso */}
      {progresso !== null && (
        <div style={{ height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, marginBottom: 6 }}>
          <div style={{ height: 3, width: `${progresso}%`,
            background: progresso >= 100 ? '#10b981' : '#3b82f6', borderRadius: 2 }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, background: `${s.cor}20`, color: s.cor,
          padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>{pick(STATUS_TR[tarefa.status])}</span>
        {showAssignee && tarefa.assigneeNome && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
            👤 {tarefa.assigneeNome.split(' ')[0]}
          </span>
        )}
        {tarefa.due_at && (() => {
          const ms = tarefa.due_at.toMillis ? tarefa.due_at.toMillis() : new Date(tarefa.due_at).getTime();
          const diff = ms - Date.now();
          const vencida = diff < 0 && !['concluida','cancelada'].includes(tarefa.status);
          const urgente = diff > 0 && diff < 2 * 3_600_000;
          const label = vencida ? pick(T.vencidaBadge)
            : urgente ? `⚠️ ${Math.ceil(diff/60000)}min`
            : `📅 ${fmtTs(tarefa.due_at)}`;
          return (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
              background: vencida ? 'rgba(239,68,68,.2)' : urgente ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.07)',
              color: vencida ? '#ef4444' : urgente ? '#fbbf24' : 'rgba(255,255,255,.35)',
            }}>{label}</span>
          );
        })()}
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.2)', marginLeft: 'auto' }}>
          {fmtIdade(tarefa.criadoEm)}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETALHE + EXECUÇÃO DA TAREFA
// ═══════════════════════════════════════════════════════════════════════════════

function TarefaDetalhe({ tarefa: tarefaInicial, usuario, agentes, onVoltar, onAtualizar, onSelecionarDestino }: {
  tarefa: TarefaLogistica; usuario: Props['usuario'];
  agentes: { uid: string; nome: string; email: string }[];
  onVoltar: () => void; onAtualizar: (t?: TarefaLogistica) => void;
  onSelecionarDestino?: Props['onSelecionarDestino'];
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [tarefa, setTarefa] = useState(tarefaInicial);
  const [busy, setBusy]     = useState(false);
  const [erro, setErro]     = useState('');
  const [ok, setOk]         = useState('');
  const [qtdEntrega, setQtdEntrega] = useState(1);
  const fileRef  = useRef<HTMLInputElement>(null);
  const [fotoTipo, setFotoTipo] = useState<'chegada' | 'conclusao' | 'entrega'>('chegada');
  const [showReatrib, setShowReatrib] = useState(false);
  const [novoAgente, setNovoAgente]   = useState('');
  const [auditLog, setAuditLog]       = useState<any[]>([]);

  // Polling: escuta mudanças nessa tarefa específica
  useEffect(() => {
    if (!tarefa.id) return;
    let cancelled = false;
    const poll = async () => {
      const { data } = await supabase.from('tarefas_logistica').select('*').eq('id', tarefa.id).maybeSingle();
      if (data && !cancelled) {
        setTarefa({
          id: String(data.id),
          kind: data.kind ?? 'PONTO', titulo: data.titulo ?? '', descricao: data.descricao ?? '',
          status: data.status ?? 'pendente', prioridade: data.prioridade ?? 3,
          parkingId: data.parking_id, parkingNome: data.parking_nome,
          parkingLat: data.parking_lat, parkingLng: data.parking_lng,
          bikeIdentifier: data.bike_identifier, bikeLat: data.bike_lat, bikeLng: data.bike_lng,
          targetCount: data.target_count, deliveredCount: data.delivered_count ?? 0,
          entregas: data.entregas ?? [], assigneeUid: data.assignee_uid,
          assigneeNome: data.responsavel_nome ?? data.assignee_nome,
          cidade: data.cidade ?? '', pais: data.pais ?? 'BR', criadoPor: data.criado_por ?? '',
          criadoEm: data.criado_em, atualizadoEm: data.atualizado_em,
          iniciadoEm: data.iniciado_em, concluidoEm: data.concluido_em,
          fotoChegadaUrl: data.foto_chegada_url, fotoConclusaoUrl: data.foto_conclusao_url,
          geradoPorGoJet: data.gerado_por_gojet, slotId: data.slot_id,
          bateriaPercent: data.bateria_percent, due_at: data.due_at,
          destinoAlteradoEm: data.destino_alterado_em,
        } as TarefaLogistica);
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [tarefa.id]);

  // Polling: audit log da tarefa
  useEffect(() => {
    if (!tarefa.id) return;
    let cancelled = false;
    const loadLog = async () => {
      const { data } = await supabase.from('tarefas_audit_log').select('*').eq('tarefa_id', tarefa.id).order('ts', { ascending: true });
      if (data && !cancelled) setAuditLog(data);
    };
    loadLog();
    const logTimer = setInterval(loadLog, 10000);
    return () => { cancelled = true; clearInterval(logTimer); };
  }, [tarefa.id]);

  const mine    = tarefa.assigneeUid === usuario.uid || isAdminRole(usuario.role);
  const podInic = tarefa.status === 'pendente' && mine;
  const podExec = tarefa.status === 'em_execucao' && mine;
  const podCanc = isAdminRole(usuario.role) && tarefa.status !== 'concluida';

  const atualizar = async (campos: Partial<TarefaLogistica> & Record<string, any>) => {
    if (!tarefa.id) return;
    setBusy(true); setErro('');
    try {
      const snakeCase: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      for (const [k, v] of Object.entries(campos)) {
        const sk = k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
        snakeCase[sk] = v;
      }
      const { error } = await supabase.from('tarefas_logistica').update(snakeCase).eq('id', tarefa.id);
      if (error) throw error;
      // Audit log: registra transições de status e entrega parcial
      const evento = campos.status
        ? { tipo: 'status', de: tarefa.status, para: campos.status }
        : campos.entregas
        ? { tipo: 'entrega_parcial', qtd: campos.deliveredCount ?? '?' }
        : campos.parkingId !== undefined
        ? { tipo: 'destino_alterado', para: campos.parkingNome ?? campos.parkingId }
        : null;
      if (evento) {
        const { error: logErr } = await supabase.from('tarefas_audit_log').insert({
          tarefa_id: tarefa.id,
          ...evento,
          ts: new Date().toISOString(),
          uid: usuario.uid,
          nome: usuario.nome ?? usuario.email ?? '',
        });
        if (logErr) console.error('[audit] insert error:', logErr);
      }
      setOk(pick(T.atualizado)); setTimeout(() => setOk(''), 2000);
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); }
  };

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !tarefa.id) return;
    setBusy(true); setErro('');
    try {
      const comp = await comprimir(file);
      const url  = await uploadFoto(comp, tarefa.id, fotoTipo);

      if (fotoTipo === 'chegada') {
        await atualizar({ fotoChegadaUrl: url, status: 'em_execucao', iniciadoEm: new Date().toISOString() });
        setOk(pick(T.okChegada));
      } else if (fotoTipo === 'conclusao') {
        await atualizar({ fotoConclusaoUrl: url, status: 'concluida', concluidoEm: new Date().toISOString() });
        setOk(pick(T.okConcluida));
      } else {
        // Entrega parcial
        await registrarEntrega(url);
      }
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); if (e.target) e.target.value = ''; }
  };

  const registrarEntrega = async (fotoUrl: string) => {
    if (!tarefa.id) return;
    const entrega: Entrega = {
      qtd: qtdEntrega,
      fotoUrl,
      entregueEm: new Date().toISOString(),
      agentUid: usuario.uid,
      agentNome: usuario.nome ?? usuario.email,
    };
    const novoEntregue = (tarefa.deliveredCount ?? 0) + qtdEntrega;
    const concluida    = tarefa.targetCount != null && novoEntregue >= tarefa.targetCount;
    await atualizar({
      deliveredCount: novoEntregue,
      entregas: [...(tarefa.entregas ?? []), entrega],
      ...(concluida ? { status: 'concluida', concluidoEm: new Date().toISOString() } : {}),
    });
    setOk(concluida ? pick(T.okMeta) : `+${qtdEntrega} ${pick(T.entregues)} ${novoEntregue}/${tarefa.targetCount}`);
  };

  const reatribuir = async () => {
    if (!novoAgente || !tarefa.id) return;
    const ag = agentes.find(a => a.uid === novoAgente);
    if (!ag) return;
    setBusy(true); setErro('');
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('tarefas_logistica').update({
        assignee_uid: ag.uid, assignee_nome: ag.nome, responsavel_nome: ag.nome,
        reatribuido_em: now, reatribuido_por: usuario.uid,
        atualizado_em: now,
      }).eq('id', tarefa.id);
      if (error) throw error;
      await supabase.from('tarefas_audit_log').insert({
        tarefa_id: tarefa.id,
        tipo: 'reatribuicao',
        de: tarefa.assigneeNome ?? '—',
        para: ag.nome,
        ts: now,
        uid: usuario.uid,
        nome: usuario.nome ?? usuario.email ?? '',
      });
      // Telegram: notificar novo agente
      try {
        const { httpsCallable: hc, getFunctions: gf } = await import('firebase/functions');
        const { getApp: ga } = await import('firebase/app');
        const fn = hc(gf(ga(), 'southamerica-east1'), 'notificarTarefaAtribuida');
        await fn({ assigneeUid: ag.uid, tarefaId: tarefa.id, titulo: tarefa.titulo, kind: tarefa.kind, parkingNome: tarefa.parkingNome ?? null, cidade: tarefa.cidade }).catch(() => {});
      } catch { /* best-effort */ }
      setOk(`${pick(T.okReatribuido)} ${ag.nome}`);
      setShowReatrib(false); setNovoAgente('');
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); }
  };

  const mudarDestino = () => {
    if (!tarefa.id || !onSelecionarDestino) return;
    onSelecionarDestino(tarefa.id, async (parking: any) => {
      await atualizar({
        parkingId: parking.id,
        parkingNome: parking.name ?? parking.nome,
        parkingLat: parking.latitude ?? parking.lat,
        parkingLng: parking.longitude ?? parking.lng,
        destinoAlteradoEm: new Date().toISOString(),
      });
      setOk(pick(T.okDestino));
    });
    onVoltar();
  };

  const lat = tarefa.parkingLat ?? tarefa.bikeLat;
  const lng = tarefa.parkingLng ?? tarefa.bikeLng;
  const k   = KIND[tarefa.kind];
  const s   = STATUS[tarefa.status];
  const progresso = tarefa.targetCount && tarefa.targetCount > 0
    ? Math.min(100, Math.round(((tarefa.deliveredCount??0)/tarefa.targetCount)*100)) : null;

  return (
    <div style={S.painel()}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={handleFoto} />

      <div style={S.header}>
        <button onClick={onVoltar} style={S.ghost}>{pick(T.voltar)}</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff' }}>
            {k.icon} {tarefa.titulo}
          </div>
          <div style={{ fontSize: 10, color: s.cor }}>{pick(STATUS_TR[tarefa.status])}</div>
        </div>
      </div>

      <div style={{ ...S.body, padding: 14 }}>
        {erro && <Alert tipo="erro" msg={erro} />}
        {ok   && <Alert tipo="ok"   msg={ok}   />}

        {/* Progresso */}
        {progresso !== null && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{pick(T.progresso)}</span>
              <span style={{ fontSize: 12, fontWeight: 700,
                color: progresso >= 100 ? '#10b981' : '#3b82f6' }}>
                {tarefa.deliveredCount??0} / {tarefa.targetCount}
              </span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 4 }}>
              <div style={{ height: 8, width: `${progresso}%`,
                background: progresso >= 100 ? '#10b981' : '#3b82f6',
                borderRadius: 4, transition: 'width .3s' }} />
            </div>
            {(tarefa.entregas?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8 }}>
                {tarefa.entregas?.map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 11, color: 'rgba(255,255,255,.4)', padding: '4px 0',
                    borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <span>+{e.qtd} {pick(T.patAbrev)}</span>
                    <span>{fmtTs(e.entregueEm)}</span>
                    {e.fotoUrl && (
                      <a href={e.fotoUrl} target="_blank" rel="noreferrer"
                        style={{ marginLeft: 'auto', color: '#3b82f6', fontSize: 10 }}>{pick(T.ver)}</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Localização + navegação */}
        {lat != null && lng != null && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#dce8ff', marginBottom: 2 }}>
              📍 {tarefa.parkingNome ?? tarefa.bikeIdentifier ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
            </div>
            {tarefa.bateriaPercent != null && (
              <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 8 }}>
                🔋 {Math.round(tarefa.bateriaPercent*100)}%
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => navegar(lat, lng, 'maps')} style={{ ...S.btn('#1a73e8'), flex: 1 }}>
                {pick(T.googleMaps)}
              </button>
              <button onClick={() => navegar(lat, lng, 'waze')} style={{ ...S.btn('#05c8f0'), flex: 1 }}>
                {pick(T.waze)}
              </button>
              {isAdminRole(usuario.role) && onSelecionarDestino && (
                <button onClick={mudarDestino} style={{ ...S.btn('#f97316', true), flexShrink: 0 }}
                  title={pick(T.mudarDestinoTip)}>
                  🎯
                </button>
              )}
            </div>
          </div>
        )}

        {/* Descrição */}
        {tarefa.descricao && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12,
            fontSize: 12, color: 'rgba(255,255,255,.55)', lineHeight: 1.6 }}>
            {tarefa.descricao}
          </div>
        )}

        {/* Fotos existentes */}
        {(tarefa.fotoChegadaUrl || tarefa.fotoConclusaoUrl) && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ ...S.lbl, marginBottom: 8 }}>{pick(T.fotos)}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['fotoChegadaUrl',pick(T.fotoChegada)],['fotoConclusaoUrl',pick(T.fotoConclusao)]].map(([field, label]) => {
                const url = (tarefa as any)[field];
                return url ? (
                  <a key={field} href={url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                    <img src={url} alt={label} style={{ width: '100%', height: 90,
                      objectFit: 'cover', borderRadius: 8 }} />
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textAlign: 'center',
                      marginTop: 3 }}>{label}</div>
                  </a>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Ações */}
        {mine && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {podInic && (
              <>
                <button disabled={busy} onClick={() => { setFotoTipo('chegada'); fileRef.current?.click(); }}
                  style={{ ...S.btn('#3b82f6'), width: '100%' }}>
                  📸 {busy ? pick(T.aguarde) : pick(T.tirarFotoChegada)}
                </button>
                <button disabled={busy} onClick={() => atualizar({ status: 'em_execucao', iniciadoEm: new Date().toISOString() })}
                  style={S.ghost}>{pick(T.iniciarSemFoto)}</button>
              </>
            )}

            {podExec && (
              <>
                {/* Entrega parcial (só PONTO com targetCount) */}
                {tarefa.kind === 'PONTO' && tarefa.targetCount != null && (
                  <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 4 }}>
                    <div style={{ ...S.lbl, marginBottom: 8 }}>{pick(T.registrarEntregaParcial)}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{pick(T.patinetesEntregues)}</label>
                      <button onClick={() => setQtdEntrega(q => Math.max(1, q-1))}
                        style={S.btn('#374151', true)}>−</button>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#dce8ff', minWidth: 24,
                        textAlign: 'center' }}>{qtdEntrega}</span>
                      <button onClick={() => setQtdEntrega(q => Math.min(
                        (tarefa.targetCount??99)-(tarefa.deliveredCount??0), q+1))}
                        style={S.btn('#374151', true)}>+</button>
                    </div>
                    <button disabled={busy}
                      onClick={() => { setFotoTipo('entrega'); fileRef.current?.click(); }}
                      style={{ ...S.btn('#f97316'), width: '100%' }}>
                      📸 {busy ? pick(T.enviando) : `${pick(T.registrarEntregaFoto)} +${qtdEntrega} ${pick(T.entregaComFoto)}`}
                    </button>
                  </div>
                )}

                <button disabled={busy} onClick={() => { setFotoTipo('conclusao'); fileRef.current?.click(); }}
                  style={{ ...S.btn('#10b981'), width: '100%' }}>
                  ✅ {busy ? pick(T.enviando) : pick(T.fotoConclusaoBtn)}
                </button>
                <button disabled={busy}
                  onClick={() => atualizar({ status: 'concluida', concluidoEm: new Date().toISOString() })}
                  style={S.ghost}>{pick(T.concluirSemFoto)}</button>
              </>
            )}

            {podCanc && (
              <button disabled={busy}
                onClick={() => { if (confirm(pick(T.confirmCancelar))) atualizar({ status: 'cancelada' }); }}
                style={{ ...S.btn('#ef4444', true), width: '100%', marginTop: 8 }}>
                {pick(T.cancelarTarefa)}
              </button>
            )}

            {/* Reatribuição — apenas admins/gestores, tarefas não concluídas */}
            {isAdminRole(usuario.role) && tarefa.status !== 'concluida' && tarefa.status !== 'cancelada' && agentes.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {!showReatrib ? (
                  <button onClick={() => setShowReatrib(true)}
                    style={{ ...S.ghost, width: '100%' }}>
                    {pick(T.reatribuirTarefa)}
                  </button>
                ) : (
                  <div style={{ background: '#111827', borderRadius: 10, padding: 12 }}>
                    <div style={{ ...S.lbl, marginBottom: 8 }}>{pick(T.reatribuirPara)}</div>
                    {tarefa.assigneeNome && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 8 }}>
                        {pick(T.agenteAtual)} <span style={{ color: 'rgba(255,255,255,.6)' }}>{tarefa.assigneeNome}</span>
                      </div>
                    )}
                    <select value={novoAgente} onChange={e => setNovoAgente(e.target.value)}
                      style={{ ...S.inp, width: '100%', appearance: 'none' as const, marginBottom: 8 }}>
                      <option value="">{pick(T.selecionarAgente)}</option>
                      {agentes
                        .filter(a => a.uid !== tarefa.assigneeUid)
                        .map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setShowReatrib(false); setNovoAgente(''); }}
                        style={{ ...S.ghost, flex: 1 }}>{pick(T.cancelar)}</button>
                      <button disabled={busy || !novoAgente} onClick={reatribuir}
                        style={{ ...S.btn('#6366f1'), flex: 2,
                          opacity: !novoAgente ? 0.4 : 1 }}>
                        {busy ? pick(T.salvando) : pick(T.confirmar)}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Audit log */}
        {auditLog.length > 0 && (
          <div style={{ marginTop: 16, background: '#111827', borderRadius: 10, padding: 12 }}>
            <div style={{ ...S.lbl, marginBottom: 10 }}>{pick(T.historico)}</div>
            <div style={{ position: 'relative' }}>
              {/* linha vertical */}
              <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2,
                background: 'rgba(255,255,255,.08)', borderRadius: 1 }} />
              {auditLog.map((e, i) => {
                const cor = e.tipo === 'criacao' ? '#6366f1'
                  : e.tipo === 'reatribuicao' ? '#f59e0b'
                  : e.tipo === 'entrega_parcial' ? '#f97316'
                  : e.tipo === 'destino_alterado' ? '#3b82f6'
                  : e.para === 'concluida' ? '#10b981'
                  : e.para === 'cancelada' ? '#ef4444'
                  : '#94a3b8';
                const label = e.tipo === 'criacao' ? `${pick(T.alCriadaTxt)}${e.atribuidoPara ? ` → ${e.atribuidoPara}` : ''}`
                  : e.tipo === 'reatribuicao' ? `${pick(T.alReatribuidaTxt)}: ${e.de} → ${e.para}`
                  : e.tipo === 'entrega_parcial' ? `${pick(T.alEntregaParcialTxt)} (+${e.qtd})`
                  : e.tipo === 'destino_alterado' ? `${pick(T.alDestinoTxt)} → ${e.para}`
                  : e.tipo === 'status' ? `${e.de} → ${e.para}`
                  : e.tipo;
                return (
                  <div key={e.id ?? i} style={{ display: 'flex', gap: 10, marginBottom: 10,
                    alignItems: 'flex-start', paddingLeft: 20 }}>
                    <div style={{ position: 'absolute', left: 3, width: 10, height: 10,
                      borderRadius: '50%', background: cor, border: '2px solid #111827',
                      marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: cor }}>{label}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 1 }}>
                        {e.nome || '—'} · {fmtTs(e.ts)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Meta */}
        <div style={{ marginTop: 16, background: '#111827', borderRadius: 10, padding: 12 }}>
          <div style={{ ...S.lbl, marginBottom: 8 }}>{pick(T.detalhes)}</div>
          {[
            [pick(T.dCriado), fmtTs(tarefa.criadoEm)],
            [pick(T.dPrazo), tarefa.due_at ? fmtTs(tarefa.due_at) : null],
            [pick(T.dIniciado), fmtTs(tarefa.iniciadoEm)],
            [pick(T.dConcluido), fmtTs(tarefa.concluidoEm)],
            [pick(T.dDuracao), fmtDuration(tarefa.iniciadoEm, tarefa.concluidoEm)],
            [pick(T.dAgente), tarefa.assigneeNome ?? '—'],
            [pick(T.dReatribuido), (tarefa as any).reatribuidoEm ? fmtTs((tarefa as any).reatribuidoEm) : null],
            [pick(T.dGeradoPor), tarefa.geradoPorGoJet ? pick(T.geradoAuto) : pick(T.geradoManual)],
          ].map(([k, v]) => v && v !== '—' ? (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: 'rgba(255,255,255,.3)' }}>{k}</span>
              <span style={{ color: 'rgba(255,255,255,.65)' }}>{v}</span>
            </div>
          ) : null)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRIAR TAREFA
// ═══════════════════════════════════════════════════════════════════════════════

function CriarTarefa({ usuario, cidade, pais, agentes, parkingInicial, onCriada }: {
  usuario: Props['usuario']; cidade: string; pais: string;
  agentes: { uid: string; nome: string; email: string }[];
  parkingInicial?: Props['parkingInicial']; onCriada: () => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  // Modo de criação: 'gojet' = selecionar do snapshot | 'manual' = digitar livre
  const [modo, setModo]           = useState<'gojet' | 'manual'>(parkingInicial ? 'gojet' : 'gojet');
  const [kind, setKind]           = useState<TarefaKind>('PONTO');
  const [titulo, setTitulo]       = useState('');
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>(3);
  const [assigneeUid, setAssigneeUid] = useState('');
  const [targetCount, setTargetCount] = useState<number|''>('');
  const [parkSel, setParkSel]     = useState<Props['parkingInicial']>(parkingInicial ?? null);
  const [parkNome, setParkNome]   = useState('');
  const [parkLat, setParkLat]     = useState('');
  const [parkLng, setParkLng]     = useState('');
  const [bikeId, setBikeId]       = useState('');
  const [dueAt, setDueAt]         = useState(''); // datetime-local string
  const [prazoAuto, setPrazoAuto] = useState<Record<TarefaKind, number>>(
    {} as Record<TarefaKind, number>
  );
  const [busy, setBusy]           = useState(false);
  const [erro, setErro]           = useState('');

  // Carrega prazos automáticos por tipo da config_logistica
  useEffect(() => {
    supabase.from('config_logistica').select('prazo_horas').eq('cidade', cidade || 'global').maybeSingle()
      .then(({ data }) => { if (data?.prazo_horas) setPrazoAuto(data.prazo_horas); });
  }, [cidade]);

  // Auto-preenche prazo quando muda o tipo de tarefa
  useEffect(() => {
    const horas = prazoAuto[kind];
    if (horas && horas > 0) {
      const dt = new Date(Date.now() + horas * 3_600_000);
      // formato datetime-local: "YYYY-MM-DDTHH:mm"
      const pad = (n: number) => String(n).padStart(2, '0');
      setDueAt(
        `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}` +
        `T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
      );
    }
  }, [kind, prazoAuto]);

  // Quando parkingInicial muda (ex: clique num P do mapa), pré-seleciona
  useEffect(() => {
    if (parkingInicial) {
      setParkSel(parkingInicial);
      setModo('gojet');
    }
  }, [parkingInicial?.id]);  // Pontos GoJet do snapshot Firestore
  const [pontosGoJet, setPontosGoJet]   = useState<any[]>([]);
  const [buscaPonto,  setBuscaPonto]    = useState('');
  const [loadingPontos, setLoadingPontos] = useState(false);
  const [filtroCriticos, setFiltroCriticos] = useState(true); // só pontos abaixo do target

  // Carregar snapshot GoJet do Supabase
  useEffect(() => {
    setLoadingPontos(true);
    (async () => {
      try {
        const { data } = await supabase.from('gojet_snapshots').select('id, parkings').eq('id', 'latest').maybeSingle();
        if (data) setPontosGoJet(data.parkings ?? []);
      } catch {}
      setLoadingPontos(false);
    })();
  }, []);

  // Auto-preenche target quando seleciona ponto
  useEffect(() => {
    if (parkSel) {
      const falta = parkSel.target != null && parkSel.disponivel != null
        ? Math.max(0, parkSel.target - parkSel.disponivel) : null;
      if (falta != null && falta > 0) setTargetCount(falta);
      const p = PRIO_AUTO(parkSel);
      setPrioridade(p);
    }
  }, [parkSel]);

  // Auto-título inteligente
  useEffect(() => {
    const nome = parkSel?.nome ?? parkNome;
    if (!nome) return;
    const falta = targetCount ? ` ${pick(T.tituloLevar)} ${targetCount} ${pick(T.patAbrev)}` : '';
    const zerado = parkSel?.disponivel === 0 ? '🚨 ' : parkSel && parkSel.disponivel != null && parkSel.target != null && parkSel.disponivel < parkSel.target * 0.5 ? '⚠️ ' : '';
    setTitulo(`${zerado}${pick(KIND_TR[kind])}: ${nome}${falta}`);
  }, [kind, parkSel, parkNome, targetCount]);

  const pontosFiltrados = pontosGoJet
    .filter(p => {
      if (filtroCriticos && p.target_bikes_count > 0) {
        const ratio = (p.availableCount ?? 0) / p.target_bikes_count;
        if (ratio >= 0.5) return false;
      }
      if (buscaPonto) return (p.name ?? '').toLowerCase().includes(buscaPonto.toLowerCase());
      return true;
    })
    .sort((a, b) => {
      // Zerados primeiro, depois por déficit
      const defA = Math.max(0, (a.target_bikes_count ?? 0) - (a.availableCount ?? 0));
      const defB = Math.max(0, (b.target_bikes_count ?? 0) - (b.availableCount ?? 0));
      return defB - defA;
    });

  const salvar = async () => {
    if (!titulo.trim()) { setErro(pick(T.tituloObrig)); return; }
    const lat = parkSel?.lat ?? (parkLat ? parseFloat(parkLat) : null);
    const lng = parkSel?.lng ?? (parkLng ? parseFloat(parkLng) : null);
    setBusy(true); setErro('');
    try {
      const ag = agentes.find(a => a.uid === assigneeUid);
      const now = new Date().toISOString();
      const { data: novaData, error: novaErr } = await supabase.from('tarefas_logistica').insert({
        kind, titulo: titulo.trim(), descricao: descricao.trim() || null,
        status: 'pendente', prioridade, cidade, pais,
        criado_por: usuario.uid, criado_em: now, atualizado_em: now,
        assignee_uid: assigneeUid || null, responsavel_nome: ag?.nome ?? null,
        parking_id: parkSel?.id ?? null,
        parking_nome: (parkSel?.nome ?? parkNome) || null,
        parking_lat: lat, parking_lng: lng,
        target_count: targetCount !== '' ? Number(targetCount) : null,
        bike_identifier: bikeId || null,
        delivered_count: 0, entregas: [],
        gerado_por_gojet: false, slot_id: null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      }).select('id').single();
      if (novaErr) throw novaErr;
      const novaId = novaData.id;
      // Audit: criacao
      await supabase.from('tarefas_audit_log').insert({
        tarefa_id: novaId,
        tipo: 'criacao', para: 'pendente',
        atribuido_para: ag?.nome ?? null,
        ts: now, uid: usuario.uid, nome: usuario.nome ?? usuario.email ?? '',
      });
      // FCM push notification para o agente atribuído
      if (assigneeUid) {
        try {
          const { data: tokenData } = await supabase.from('fcm_tokens').select('token').eq('uid', assigneeUid).maybeSingle();
          if (tokenData?.token) {
            const { httpsCallable, getFunctions } = await import('firebase/functions');
            const { getApp } = await import('firebase/app');
            const fns = getFunctions(getApp(), 'southamerica-east1');
            const fn  = httpsCallable(fns, 'notificarTarefaFn');
            await fn({ tarefaTitulo: titulo, assigneeUid, cidade, fcmToken: tokenData.token }).catch(() => {});
          }
        } catch { /* best-effort */ }
      }
      // Telegram: notificar agente atribuído
      try {
        const { httpsCallable: hc2, getFunctions: gf2 } = await import('firebase/functions');
        const { getApp: ga2 } = await import('firebase/app');
        const fn2 = hc2(gf2(ga2(), 'southamerica-east1'), 'notificarTarefaAtribuida');
        await fn2({ assigneeUid, tarefaId: novaId, titulo: titulo.trim(), kind, parkingNome: parkSel?.nome ?? parkNome ?? null, cidade }).catch(() => {});
      } catch { /* best-effort */ }

      onCriada();
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 14 }}>
      {erro && <Alert tipo="erro" msg={erro} />}

      {/* Modo de seleção de ponto */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button onClick={() => setModo('gojet')} style={{
          flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
          background: modo === 'gojet' ? '#3b82f6' : 'rgba(255,255,255,.06)',
          color: modo === 'gojet' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>{pick(T.pontoGoJet)}</button>
        <button onClick={() => setModo('manual')} style={{
          flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
          background: modo === 'manual' ? '#f97316' : 'rgba(255,255,255,.06)',
          color: modo === 'manual' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>{pick(T.modoManual)}</button>
      </div>

      {/* Tipo de tarefa */}
      <Field label={pick(T.lblTipo)}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {(Object.keys(KIND) as TarefaKind[]).map(k => (
            <button key={k} onClick={() => setKind(k)} style={{
              padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: kind === k ? KIND[k].cor : 'rgba(255,255,255,.06)',
              color: kind === k ? '#fff' : 'rgba(255,255,255,.4)',
            }}>{KIND[k].icon} {pick(KIND_TR[k])}</button>
          ))}
        </div>
      </Field>

      {/* Seleção GoJet */}
      {modo === 'gojet' && (
        <div style={{ marginBottom: 14 }}>
          {parkSel ? (
            // Ponto selecionado — exibe card resumo
            <div style={{ background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.4)',
              borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>
                    📍 {parkSel.nome}
                  </div>
                  {parkSel.disponivel != null && parkSel.target != null && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 3 }}>
                      {parkSel.disponivel}/{parkSel.target} {pick(T.disponiveis)}
                      {parkSel.disponivel === 0 && <span style={{ color: '#ef4444' }}>{pick(T.zeradoBadge)}</span>}
                    </div>
                  )}
                </div>
                <button onClick={() => { setParkSel(null); setTargetCount(''); }}
                  style={{ background: 'rgba(255,255,255,.08)', border: 'none', color: '#fff',
                    borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}>
                  {pick(T.trocar)}
                </button>
              </div>
            </div>
          ) : (
            // Lista para selecionar ponto
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={buscaPonto} onChange={e => setBuscaPonto(e.target.value)}
                  placeholder={pick(T.buscarPontoGoJet)}
                  style={{ ...S.inp, flex: 1 }} />
                <button onClick={() => setFiltroCriticos(v => !v)} style={{
                  padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600, flexShrink: 0,
                  background: filtroCriticos ? '#ef4444' : 'rgba(255,255,255,.06)',
                  color: filtroCriticos ? '#fff' : 'rgba(255,255,255,.4)',
                }}>
                  {filtroCriticos ? pick(T.soCriticos) : pick(T.todosPontos)}
                </button>
              </div>

              {loadingPontos ? (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: 12 }}>
                  {pick(T.carregandoPontos)}
                </div>
              ) : pontosGoJet.length === 0 ? (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: 12 }}>
                  {pick(T.snapshotIndisp)}<br/>{pick(T.ativeOverlay)}
                </div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 8, scrollbarWidth: 'thin' as const }}>
                  {pontosFiltrados.slice(0, 50).map((p: any) => {
                    const avail  = p.availableCount ?? 0;
                    const target = p.target_bikes_count ?? 0;
                    const falta  = Math.max(0, target - avail);
                    const zerado = avail === 0;
                    const cor    = zerado ? '#ef4444' : falta > 0 ? '#f97316' : '#10b981';
                    return (
                      <button key={p.id}
                        onClick={() => setParkSel({
                          id: p.id, nome: p.name,
                          lat: p.latitude, lng: p.longitude,
                          target, disponivel: avail,
                        })}
                        style={{ width: '100%', padding: '10px 12px', background: 'transparent',
                          border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                          textAlign: 'left' as const }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: cor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.monitor ? '⭐ ' : ''}{p.name}
                          </div>
                          {target > 0 && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
                              {avail}/{target} {pick(T.dispAbrev)}
                              {falta > 0 && <span style={{ color: cor }}> · {pick(T.faltam)} {falta}</span>}
                            </div>
                          )}
                        </div>
                        {zerado && (
                          <span style={{ fontSize: 9, background: '#ef44441a', color: '#ef4444',
                            padding: '2px 5px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>
                            {pick(T.zerado)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {pontosFiltrados.length > 50 && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', padding: 8,
                      textAlign: 'center' }}>
                      +{pontosFiltrados.length - 50} {pick(T.pontosUseBusca)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual */}
      {modo === 'manual' && (
        <>
          <Field label={pick(T.lblPontoEndereco)}>
            <input style={S.inp} value={parkNome} placeholder={pick(T.phPontoEndereco)}
              onChange={e => setParkNome(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Field label={pick(T.lblLat)} style={{ flex: 1 }}>
              <input style={S.inp} value={parkLat} placeholder="-23.588"
                onChange={e => setParkLat(e.target.value)} />
            </Field>
            <Field label={pick(T.lblLng)} style={{ flex: 1 }}>
              <input style={S.inp} value={parkLng} placeholder="-46.641"
                onChange={e => setParkLng(e.target.value)} />
            </Field>
          </div>
        </>
      )}

      {kind === 'PONTO' && (
        <Field label={pick(T.lblPatLevar)}>
          <input style={S.inp} type="number" min="1" value={targetCount}
            placeholder={parkSel?.target != null ? `${pick(T.deficitAuto)} ${Math.max(0,(parkSel.target)-(parkSel.disponivel??0))}` : pick(T.phEx5)}
            onChange={e => setTargetCount(e.target.value ? Number(e.target.value) : '')} />
        </Field>
      )}

      {kind === 'PATINETE' && (
        <Field label={pick(T.lblIdentifier)}>
          <input style={S.inp} value={bikeId} placeholder="S.315761"
            onChange={e => setBikeId(e.target.value)} />
        </Field>
      )}

      <Field label={pick(T.lblTitulo)}>
        <input style={S.inp} value={titulo} placeholder={pick(T.phTitulo)}
          onChange={e => setTitulo(e.target.value)} />
      </Field>

      <Field label={pick(T.lblDescricao)}>
        <textarea style={{ ...S.inp, height: 56, resize: 'vertical' as const }}
          value={descricao} onChange={e => setDescricao(e.target.value)} />
      </Field>

      <Field label={pick(T.lblPrioridade)}>
        <div style={{ display: 'flex', gap: 6 }}>
          {([1,2,3,4,5] as TarefaPrioridade[]).map(p => (
            <button key={p} onClick={() => setPrioridade(p)} style={{
              flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none',
              cursor: 'pointer', fontSize: 10, fontWeight: 600,
              background: prioridade === p ? PRIO[p].cor : 'rgba(255,255,255,.06)',
              color: prioridade === p ? '#fff' : 'rgba(255,255,255,.4)',
            }}>{pick(PRIO_TR[p])}</button>
          ))}
        </div>
      </Field>

      <Field label={pick(T.lblAtribuir)}>
        <select style={{ ...S.inp, appearance: 'none' as const }}
          value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)}>
          <option value="">{pick(T.semAtribuicao)}</option>
          {agentes.map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
        </select>
      </Field>

      <Field label={`${pick(T.lblPrazo)}${prazoAuto[kind] ? ` (${pick(T.prazoAutoTxt)}: ${prazoAuto[kind]}h)` : ` (${pick(T.prazoOpcional)})`}`}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="datetime-local" style={{ ...S.inp, flex: 1, colorScheme: 'dark' }}
            value={dueAt} onChange={e => setDueAt(e.target.value)} />
          {dueAt && (
            <button onClick={() => setDueAt('')}
              style={{ padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.4)', fontSize: 11 }}>
              ✕
            </button>
          )}
        </div>
      </Field>

      <button disabled={busy || (modo === 'gojet' && !parkSel && kind !== 'PATINETE')}
        onClick={salvar}
        style={{ ...S.btn(), width: '100%', padding: 12, marginTop: 8,
          opacity: busy || (modo === 'gojet' && !parkSel && kind !== 'PATINETE') ? 0.5 : 1 }}>
        {busy ? pick(T.criando) : pick(T.criarTarefaBtn)}
      </button>
    </div>
  );
}

// Calcula prioridade automática baseada no status do ponto GoJet
function PRIO_AUTO(p: { disponivel?: number; target?: number }): TarefaPrioridade {
  if (p.disponivel === 0) return 5;
  if (p.target != null && p.disponivel != null) {
    const ratio = p.disponivel / p.target;
    if (ratio < 0.25) return 4;
    if (ratio < 0.5)  return 3;
  }
  return 2;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD DE PRODUTIVIDADE
// ═══════════════════════════════════════════════════════════════════════════════

function Dashboard({ tarefas, agentes }: {
  tarefas: TarefaLogistica[];
  agentes: { uid: string; nome: string; email: string }[];
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [periodo, setPeriodo] = useState<'7d'|'30d'|'todos'>('7d');

  const corte = periodo === '7d'  ? Date.now() - 7*86400000
              : periodo === '30d' ? Date.now() - 30*86400000 : 0;

  const filtradas = tarefas.filter(t => {
    if (!corte) return true;
    const d = t.criadoEm?.toDate?.() ?? new Date(t.criadoEm ?? 0);
    return d.getTime() >= corte;
  });

  const concluidas = filtradas.filter(t => t.status === 'concluida');
  const total      = filtradas.length;
  const taxa       = total > 0 ? Math.round((concluidas.length/total)*100) : 0;

  // Durações médias
  const duracoes = concluidas
    .filter(t => t.iniciadoEm && t.concluidoEm)
    .map(t => (t.concluidoEm.toDate().getTime() - t.iniciadoEm.toDate().getTime()) / 60000);
  const mediaMin = duracoes.length > 0
    ? Math.round(duracoes.reduce((a,b)=>a+b,0)/duracoes.length) : 0;

  // Por agente
  const porAgente: Record<string, { nome: string; total: number; concluidas: number; minutos: number[] }> = {};
  filtradas.forEach(t => {
    const uid = t.assigneeUid ?? 'sem_atrib';
    if (!porAgente[uid]) {
      const ag = agentes.find(a => a.uid === uid);
      porAgente[uid] = { nome: t.assigneeNome ?? ag?.nome ?? '—', total: 0, concluidas: 0, minutos: [] };
    }
    porAgente[uid].total++;
    if (t.status === 'concluida') {
      porAgente[uid].concluidas++;
      if (t.iniciadoEm && t.concluidoEm) {
        porAgente[uid].minutos.push(
          (t.concluidoEm.toDate().getTime() - t.iniciadoEm.toDate().getTime()) / 60000
        );
      }
    }
  });

  // Pontos mais atendidos
  const pontos: Record<string, { nome: string; count: number }> = {};
  filtradas.filter(t => t.parkingNome).forEach(t => {
    const id = t.parkingId ?? t.parkingNome ?? '';
    if (!pontos[id]) pontos[id] = { nome: t.parkingNome!, count: 0 };
    pontos[id].count++;
  });
  const topPontos = Object.values(pontos).sort((a,b)=>b.count-a.count).slice(0,5);

  // Por tipo
  const porKind: Record<string, number> = {};
  filtradas.forEach(t => { porKind[t.kind] = (porKind[t.kind]??0)+1; });

  return (
    <div style={{ padding: 14 }}>
      {/* Período */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([['7d',pick(T.per7d)],['30d',pick(T.per30d)],['todos',pick(T.perTudo)]] as const).map(([k,l]) => (
          <button key={k} onClick={() => setPeriodo(k)} style={{
            flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 600,
            background: periodo === k ? '#3b82f6' : 'rgba(255,255,255,.06)',
            color: periodo === k ? '#fff' : 'rgba(255,255,255,.4)',
          }}>{l}</button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { label: pick(T.kpiTotal), val: total, cor: '#3b82f6' },
          { label: pick(T.kpiConcluidas), val: concluidas.length, cor: '#10b981' },
          { label: pick(T.kpiTaxa), val: `${taxa}%`, cor: taxa >= 80 ? '#10b981' : taxa >= 50 ? '#f97316' : '#ef4444' },
          { label: pick(T.kpiDuracao), val: mediaMin > 0 ? `${mediaMin}min` : '—', cor: '#f59e0b' },
        ].map(({ label, val, cor }) => (
          <div key={label} style={{ background: '#111827', borderRadius: 10, padding: 14,
            border: `1px solid ${cor}20` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: cor }}>{val}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Por tipo */}
      <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ ...S.lbl, marginBottom: 10 }}>{pick(T.porTipo)}</div>
        {(Object.keys(KIND) as TarefaKind[]).map(k => {
          const n = porKind[k] ?? 0; if (!n) return null;
          const pct = total > 0 ? Math.round(n/total*100) : 0;
          return (
            <div key={k} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3,
                fontSize: 11 }}>
                <span style={{ color: 'rgba(255,255,255,.55)' }}>{KIND[k].icon} {pick(KIND_TR[k])}</span>
                <span style={{ color: KIND[k].cor, fontWeight: 600 }}>{n} ({pct}%)</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2 }}>
                <div style={{ height: 4, width: `${pct}%`, background: KIND[k].cor, borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Ranking agentes */}
      <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ ...S.lbl, marginBottom: 10 }}>{pick(T.rankingAgentes)}</div>
        {Object.entries(porAgente)
          .sort(([,a],[,b]) => b.concluidas - a.concluidas)
          .slice(0, 8)
          .map(([uid, d], i) => {
            const mediaA = d.minutos.length > 0
              ? Math.round(d.minutos.reduce((a,b)=>a+b,0)/d.minutos.length) : 0;
            return (
              <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: i===0?'#f59e0b':i===1?'#9ca3af':i===2?'#b45309':'rgba(255,255,255,.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {i+1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.nome}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
                    {mediaA > 0 ? `⏱ ${mediaA}${pick(T.porTarefa)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{d.concluidas}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>/{d.total}</div>
                </div>
              </div>
            );
          })}
        {Object.keys(porAgente).length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>{pick(T.semDados)}</div>
        )}
      </div>

      {/* Top pontos */}
      {topPontos.length > 0 && (
        <div style={{ background: '#111827', borderRadius: 10, padding: 12 }}>
          <div style={{ ...S.lbl, marginBottom: 10 }}>{pick(T.topPontos)}</div>
          {topPontos.map((p,i) => (
            <div key={p.nome} style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', padding: '6px 0', fontSize: 12,
              borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <span style={{ color: 'rgba(255,255,255,.55)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {i+1}. 📍 {p.nome}
              </span>
              <span style={{ color: '#3b82f6', fontWeight: 700, flexShrink: 0 }}>{p.count}x</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTÓRICO + EXPORT CSV
// ═══════════════════════════════════════════════════════════════════════════════

function Historico({ tarefas, agentes }: {
  tarefas: TarefaLogistica[];
  agentes: { uid: string; nome: string; email: string }[];
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [filtroStatus, setFiltroStatus] = useState<TarefaStatus|'todas'>('todas');
  const [filtroKind,   setFiltroKind]   = useState<TarefaKind|'todas'>('todas');
  const [filtroAgente, setFiltroAgente] = useState('');
  const [busca,        setBusca]        = useState('');
  const [pagina,       setPagina]       = useState(0);
  const PAGE = 50;

  const agentesMap = new Map(agentes.map(a => [a.uid, a.nome]));

  const filtradas = tarefas.filter(t => {
    if (filtroStatus !== 'todas' && t.status !== filtroStatus) return false;
    if (filtroKind   !== 'todas' && t.kind   !== filtroKind)   return false;
    if (filtroAgente && t.assigneeUid !== filtroAgente)        return false;
    if (busca && !t.titulo.toLowerCase().includes(busca.toLowerCase())
        && !(t.parkingNome ?? '').toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const totalPag = Math.max(1, Math.ceil(filtradas.length / PAGE));
  const pag = Math.min(pagina, totalPag-1);
  const slice = filtradas.slice(pag*PAGE, (pag+1)*PAGE);

  return (
    <div style={{ padding: 12 }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' as const }}>
        <input value={busca} onChange={e => { setBusca(e.target.value); setPagina(0); }}
          placeholder={pick(T.buscar)}
          style={{ ...S.inp, flex: 2, minWidth: 120 }} />
        <select style={{ ...S.inp, flex: 1, minWidth: 100, appearance: 'none' as const, colorScheme: 'dark' }}
          value={filtroStatus} onChange={e => { setFiltroStatus(e.target.value as any); setPagina(0); }}>
          <option value="todas">{pick(T.todosStatus)}</option>
          {(Object.keys(STATUS) as TarefaStatus[]).map(s => (
            <option key={s} value={s}>{pick(STATUS_TR[s])}</option>
          ))}
        </select>
        <select style={{ ...S.inp, flex: 1, minWidth: 100, appearance: 'none' as const, colorScheme: 'dark' }}
          value={filtroKind} onChange={e => { setFiltroKind(e.target.value as any); setPagina(0); }}>
          <option value="todas">{pick(T.todosTipos)}</option>
          {(Object.keys(KIND) as TarefaKind[]).map(k => (
            <option key={k} value={k}>{KIND[k].icon} {pick(KIND_TR[k])}</option>
          ))}
        </select>
        <select style={{ ...S.inp, flex: 1, minWidth: 120, appearance: 'none' as const, colorScheme: 'dark' }}
          value={filtroAgente} onChange={e => { setFiltroAgente(e.target.value); setPagina(0); }}>
          <option value="">{pick(T.histTodosAgentes)}</option>
          {agentes.map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
        </select>
      </div>

      {/* Stats + Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
        <span>{filtradas.length} {pick(T.tarefasPag)} {pag+1}/{totalPag}</span>
        <button onClick={() => exportCSV(filtradas, agentesMap)}
          style={{ ...S.btn('#374151', true) }}>{pick(T.exportCsv)}</button>
      </div>

      {/* Lista */}
      {slice.map(t => {
        const k = KIND[t.kind]; const s = STATUS[t.status];
        return (
          <div key={t.id} style={{ background: '#111827', borderRadius: 8, padding: 10,
            marginBottom: 6, border: `1px solid ${k.cor}15` }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>{k.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.titulo}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
                  {fmtTs(t.criadoEm)}
                  {t.assigneeNome && ` · ${t.assigneeNome.split(' ')[0]}`}
                  {t.iniciadoEm && t.concluidoEm && ` · ${fmtDuration(t.iniciadoEm, t.concluidoEm)}`}
                </div>
              </div>
              <span style={{ fontSize: 9, background: `${s.cor}20`, color: s.cor,
                padding: '2px 5px', borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>
                {pick(STATUS_TR[t.status])}
              </span>
            </div>
          </div>
        );
      })}

      {filtradas.length === 0 && <Empty msg={pick(T.nenhumaEncontrada)} />}

      {/* Paginação */}
      {totalPag > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button disabled={pag === 0} onClick={() => setPagina(p => p-1)} style={S.ghost}>{pick(T.anterior)}</button>
          <button disabled={pag >= totalPag-1} onClick={() => setPagina(p => p+1)} style={S.ghost}>{pick(T.proxima)}</button>
        </div>
      )}
    </div>
  );
}

// ─── Micro-componentes ────────────────────────────────────────────────────────

function Loading() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  return <div style={{ padding: 20, color: 'rgba(255,255,255,.3)', textAlign: 'center', fontSize: 12 }}>
    {pick(T.carregando)}
  </div>;
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 20, color: 'rgba(255,255,255,.3)', textAlign: 'center', fontSize: 12 }}>
    {msg}
  </div>;
}

function Alert({ tipo, msg }: { tipo: 'ok'|'erro'; msg: string }) {
  const cor = tipo === 'ok' ? '#10b981' : '#ef4444';
  return <div style={{ background: `${cor}15`, border: `1px solid ${cor}40`,
    borderRadius: 8, padding: 10, fontSize: 12, color: cor, marginBottom: 10 }}>
    {tipo === 'ok' ? '✅' : '❌'} {msg}
  </div>;
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={S.lbl}>{label}</label>
      {children}
    </div>
  );
}
