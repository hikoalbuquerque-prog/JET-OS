// SlotsModule.tsx — JET OS V2 — Sistema de Slots Inteligente
// Scout: movimentação de patinetes | Charger: troca de baterias
// Slots Manual + Automático (config por zona, clima, horário)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { gpsBackground, capturarPosicaoUnica, TrackingStats } from './lib/gps-background';
import { fnNotificarTarefa, fnGerarSlotsManual, fnScraperGoJetManual } from './lib/edge-functions';
import { supabase } from './lib/supabase';
import { carregarOcorrenciasSupabase, criarOcorrenciaSupabase, atualizarOcorrenciaSupabase } from './lib/ocorrencias-supabase';
import { fetchWorkerPos } from './lib/gps-supabase';
import { fetchUsuarios } from './lib/usuarios-supabase';
import { uploadComRetry } from './lib/uploadUtils';
import { comprimirImagem, capturarFotoNativa } from './lib/imageUtils';
import { isAndroidNative } from './lib/gps-native';
import SlotsDashboard from './components/SlotsDashboard';
import type {
  Slot, Tarefa, Entrega, Ocorrencia, PatineteInfo,
  CargoTipo, SlotStatus, TarefaTipo, OcorrenciaTipo,
  TipoSlot, TipoGeracao, SlotPrioridade, ConfigZonaAuto, FaixaHorario,
} from './lib/slots-schema';
import { salvarConfigZona, buscarConfigZonas } from './lib/slots-schema';
import {
  subscribeSlots, subscribeTarefas,
  aceitarSlotSupa, checkInSlotSupa, checkOutSlotSupa, cancelarSlotSupa, reatribuirSlotSupa,
  criarSlotSupa, criarTarefaSupa, atualizarSlotSupa, atualizarTarefaSupa,
  fetchLogSlotsAuto, fetchPoligonos, updateCheckInFoto,
} from './lib/slots-supabase';

// ─── Geo helpers ─────────────────────────────────────────────────────────────

function distKmClient(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtDist(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// Hook: localização em tempo real do worker via gps_logistica
// bateria: nível (%) do telefone no último ponto — para o painel/infowindow de campo.
interface WorkerPos { lat: number; lng: number; idadeS: number; bateria: number | null; }

function useWorkerGPS(uid: string | null): WorkerPos | null {
  const [pos, setPos] = useState<WorkerPos | null>(null);
  useEffect(() => {
    if (!uid) return;

    // Supabase: polling a cada 15s
    let alive = true;
    const poll = () => {
      fetchWorkerPos(uid).then(r => { if (alive) setPos(r); });
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [uid]);
  return pos;
}

// Hook: localização dos workers atribuídos a um slot
function useSlotsWorkersGPS(uids: string[]): Record<string, WorkerPos> {
  const [mapa, setMapa] = useState<Record<string, WorkerPos>>({});
  useEffect(() => {
    if (uids.length === 0) return;

    // Supabase: polling a cada 15s para todos os uids
    let alive = true;
    const poll = () => {
      Promise.all(uids.map(uid => fetchWorkerPos(uid).then(r => r ? [uid, r] as const : null)))
        .then(results => {
          if (!alive) return;
          const next: Record<string, WorkerPos> = {};
          for (const r of results) { if (r) next[r[0]] = r[1]; }
          setMapa(next);
        });
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [uids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return mapa;
}

// Rótulo/cor de nível de bateria — usado no infowindow e no painel de equipe.
function bateriaLabel(b: number | null): { txt: string; cor: string } | null {
  if (b == null) return null;
  const cor = b <= 15 ? '#ef4444' : b <= 30 ? '#f59e0b' : '#22c55e';
  return { txt: `${b}%`, cor };
}

// agoLabel: sufixo "atrás"/"ago"/... — traduzido pelo chamador via pick(T.atras).
function idadeLabel(s: number, agoLabel = 'atrás'): { txt: string; cor: string } {
  if (s < 90)  return { txt: `${s}s ${agoLabel}`,    cor: '#22c55e' };
  if (s < 300) return { txt: `${Math.floor(s/60)}min`, cor: '#f59e0b' };
  return { txt: `${Math.floor(s/60)}min`,              cor: '#ef4444' };
}

function flyToMapa(lat: number, lng: number, zoom = 17) {
  window.dispatchEvent(new CustomEvent('jetFlyTo', { detail: { lat, lng, zoom } }));
}

// ─── i18n (pt / en / es / ru) — padrão TermosUsoGate, sem json ────────────────
type Lang = 'pt' | 'en' | 'es' | 'ru';
type L = { pt: string; en: string; es: string; ru: string };

// Hook: idioma atual + função pick para escolher o texto.
function usePick() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;
  return { lang, pick };
}

const T = {
  // ── Geral / status ──
  carregando:      { pt: 'Carregando...',       en: 'Loading...',          es: 'Cargando...',          ru: 'Загрузка...' },
  cancelar:        { pt: 'Cancelar',            en: 'Cancel',              es: 'Cancelar',             ru: 'Отмена' },
  voltar:          { pt: '‹ Voltar',            en: '‹ Back',              es: '‹ Volver',             ru: '‹ Назад' },
  voltarPlain:     { pt: 'Voltar',              en: 'Back',                es: 'Volver',               ru: 'Назад' },
  fechar:          { pt: 'Fechar',              en: 'Close',               es: 'Cerrar',               ru: 'Закрыть' },
  confirmar:       { pt: '✓ Confirmar',         en: '✓ Confirm',           es: '✓ Confirmar',          ru: '✓ Подтвердить' },
  progresso:       { pt: 'Progresso',           en: 'Progress',            es: 'Progreso',             ru: 'Прогресс' },
  opcional:        { pt: '(opcional)',          en: '(optional)',          es: '(opcional)',           ru: '(необязательно)' },
  observacao:      { pt: 'Observação (opcional)', en: 'Note (optional)',   es: 'Observación (opcional)', ru: 'Примечание (необязательно)' },
  algumaObs:       { pt: 'Alguma observação?',  en: 'Any note?',           es: '¿Alguna observación?', ru: 'Есть примечание?' },
  atras:           { pt: 'atrás',               en: 'ago',                 es: 'atrás',                ru: 'назад' },

  // ── Tipos de slot (rótulos) ──
  scout:           { pt: 'Scout',               en: 'Scout',               es: 'Scout',                ru: 'Scout' },
  charger:         { pt: 'Charger',             en: 'Charger',             es: 'Charger',              ru: 'Charger' },
  scoutDesc:       { pt: 'Movimentação de patinetes', en: 'Scooter rebalancing', es: 'Movimiento de patinetes', ru: 'Перемещение самокатов' },
  chargerDesc:     { pt: 'Troca de baterias',   en: 'Battery swap',        es: 'Cambio de baterías',   ru: 'Замена батарей' },

  // ── Prioridade (rótulos) ──
  prioNormal:      { pt: 'Normal',              en: 'Normal',              es: 'Normal',               ru: 'Обычный' },
  prioAlta:        { pt: 'Alta',                en: 'High',                es: 'Alta',                 ru: 'Высокий' },
  prioUrgente:     { pt: 'Urgente',             en: 'Urgent',              es: 'Urgente',              ru: 'Срочный' },

  // ── Status do slot (rótulos) ──
  stAberto:        { pt: 'Aberto',              en: 'Open',                es: 'Abierto',              ru: 'Открыт' },
  stAceito:        { pt: 'Aceito',              en: 'Accepted',            es: 'Aceptado',             ru: 'Принят' },
  stACaminho:      { pt: 'A caminho',           en: 'On the way',          es: 'En camino',            ru: 'В пути' },
  stEmAndamento:   { pt: 'Em andamento',        en: 'In progress',         es: 'En curso',             ru: 'Выполняется' },
  stConcluido:     { pt: 'Concluído',           en: 'Completed',           es: 'Completado',           ru: 'Завершён' },
  stCancelado:     { pt: 'Cancelado',           en: 'Cancelled',           es: 'Cancelado',            ru: 'Отменён' },

  // ── Motivos de cancelamento ──
  motDefeito:      { pt: 'Patinete com defeito',      en: 'Faulty scooter',          es: 'Patinete con defecto',    ru: 'Неисправный самокат' },
  motNaoEncontrada:{ pt: 'Patinete não encontrada',   en: 'Scooter not found',       es: 'Patinete no encontrado',  ru: 'Самокат не найден' },
  motInacessivel:  { pt: 'Ponto inacessível',         en: 'Inaccessible point',      es: 'Punto inaccesible',       ru: 'Недоступная точка' },
  motSeguranca:    { pt: 'Problema de segurança',     en: 'Safety issue',            es: 'Problema de seguridad',   ru: 'Проблема безопасности' },
  motEncerramento: { pt: 'Encerramento de turno',     en: 'End of shift',            es: 'Fin de turno',            ru: 'Конец смены' },
  motOutro:        { pt: 'Outro',                     en: 'Other',                   es: 'Otro',                    ru: 'Другое' },

  // ── Tipos de ocorrência ──
  ocRoubo:         { pt: 'Roubo de patinete',   en: 'Scooter theft',       es: 'Robo de patinete',     ru: 'Кража самоката' },
  ocVandalismo:    { pt: 'Vandalismo',          en: 'Vandalism',           es: 'Vandalismo',           ru: 'Вандализм' },
  ocDanificado:    { pt: 'Patinete danificado', en: 'Damaged scooter',     es: 'Patinete dañado',      ru: 'Повреждённый самокат' },
  ocBloqueado:     { pt: 'Ponto bloqueado',     en: 'Blocked point',       es: 'Punto bloqueado',      ru: 'Заблокированная точка' },
  ocInfrator:      { pt: 'Usuário infrator',    en: 'Offending user',      es: 'Usuario infractor',    ru: 'Нарушитель' },
  ocOutro:         { pt: 'Outro',               en: 'Other',               es: 'Otro',                 ru: 'Другое' },

  // ── ModalCancelamento ──
  cancelarTarefa:  { pt: 'Cancelar tarefa',     en: 'Cancel task',         es: 'Cancelar tarea',       ru: 'Отменить задачу' },
  motivo:          { pt: 'Motivo',              en: 'Reason',              es: 'Motivo',               ru: 'Причина' },
  obsAdicionais:   { pt: 'Detalhes adicionais...', en: 'Additional details...', es: 'Detalles adicionales...', ru: 'Дополнительные сведения...' },
  fotoObrigMotivo: { pt: '📷 Foto obrigatória para este motivo', en: '📷 Photo required for this reason', es: '📷 Foto obligatoria para este motivo', ru: '📷 Для этой причины нужно фото' },
  tirarFoto:       { pt: '📷 Tirar foto',       en: '📷 Take photo',       es: '📷 Tomar foto',        ru: '📷 Сделать фото' },
  confirmarCancel: { pt: 'Confirmar cancelamento', en: 'Confirm cancellation', es: 'Confirmar cancelación', ru: 'Подтвердить отмену' },

  // ── ModalEntrega ──
  regEntregaPatinetes: { pt: 'Registrar entrega de patinetes', en: 'Log scooter delivery', es: 'Registrar entrega de patinetes', ru: 'Записать доставку самокатов' },
  regTrocaBateria: { pt: 'Registrar troca de bateria', en: 'Log battery swap', es: 'Registrar cambio de batería', ru: 'Записать замену батареи' },
  qtdPatinetes:    { pt: 'Quantas patinetes entregou nessa viagem?', en: 'How many scooters did you deliver this trip?', es: '¿Cuántos patinetes entregó en este viaje?', ru: 'Сколько самокатов вы доставили за эту поездку?' },
  qtdBaterias:     { pt: 'Quantas baterias trocou agora?', en: 'How many batteries did you swap now?', es: '¿Cuántas baterías cambió ahora?', ru: 'Сколько батарей вы заменили сейчас?' },
  fotoComprov:     { pt: 'Foto de comprovação (obrigatória)', en: 'Proof photo (required)', es: 'Foto de comprobación (obligatoria)', ru: 'Фото-подтверждение (обязательно)' },
  confirmarEntrega:{ pt: '✓ Confirmar entrega', en: '✓ Confirm delivery',  es: '✓ Confirmar entrega',  ru: '✓ Подтвердить' },

  // ── TarefaDetalheView ──
  tConcluida:      { pt: '✓ Concluída',         en: '✓ Completed',         es: '✓ Completada',         ru: '✓ Завершена' },
  tCancelada:      { pt: '✕ Cancelada',         en: '✕ Cancelled',         es: '✕ Cancelada',          ru: '✕ Отменена' },
  abrirNoMapa:     { pt: '🗺 Abrir no mapa',     en: '🗺 Open in map',       es: '🗺 Abrir en el mapa',   ru: '🗺 Открыть на карте' },
  noLocal:         { pt: '✓ No local',          en: '✓ On site',           es: '✓ En el lugar',        ru: '✓ На месте' },
  gpsPrefixo:      { pt: 'GPS: ',               en: 'GPS: ',               es: 'GPS: ',                ru: 'GPS: ' },
  doDestino:       { pt: ' do destino',         en: ' to destination',     es: ' al destino',          ru: ' до точки' },
  gpsAguardando:   { pt: '⚙ GPS aguardando...', en: '⚙ Awaiting GPS...',    es: '⚙ Esperando GPS...',    ru: '⚙ Ожидание GPS...' },
  patBateriaBaixa: { pt: '⚡ Patinetes com bateria baixa', en: '⚡ Scooters with low battery', es: '⚡ Patinetes con batería baja', ru: '⚡ Самокаты с низким зарядом' },
  locDestino:      { pt: '📍 Localização destino', en: '📍 Destination location', es: '📍 Ubicación de destino', ru: '📍 Точка назначения' },
  pontoOrigem:     { pt: '🛴 Ponto origem (coletar patinetes)', en: '🛴 Pickup point (collect scooters)', es: '🛴 Punto de origen (recoger patinetes)', ru: '🛴 Точка сбора (забрать самокаты)' },
  aCaminhoReg:     { pt: 'A caminho registrado', en: 'On the way logged',   es: 'En camino registrado', ru: '«В пути» отмечено' },
  marcarACaminho:  { pt: 'Marcar "A caminho"',  en: 'Mark "On the way"',    es: 'Marcar "En camino"',   ru: 'Отметить «В пути»' },
  iniciarTarefa:   { pt: '▶ Iniciar tarefa',    en: '▶ Start task',        es: '▶ Iniciar tarea',      ru: '▶ Начать задачу' },
  fotoChegada:     { pt: '📷 Foto de chegada ao ponto (opcional)', en: '📷 Arrival photo at point (optional)', es: '📷 Foto de llegada al punto (opcional)', ru: '📷 Фото прибытия на точку (необязательно)' },
  regChegada:      { pt: '✓ Registrar chegada', en: '✓ Log arrival',       es: '✓ Registrar llegada',  ru: '✓ Отметить прибытие' },
  tirarFotoChegada:{ pt: '📷 Tirar foto de chegada', en: '📷 Take arrival photo', es: '📷 Tomar foto de llegada', ru: '📷 Сделать фото прибытия' },
  tarefaConcluida: { pt: 'Tarefa concluída!',   en: 'Task completed!',     es: '¡Tarea completada!',   ru: 'Задача завершена!' },
  patinetesEntregues: { pt: 'patinete(s) entregue(s)', en: 'scooter(s) delivered', es: 'patinete(s) entregado(s)', ru: 'самокат(ов) доставлено' },
  bateriasTrocadas: { pt: 'bateria(s) trocada(s)', en: 'batter(y/ies) swapped', es: 'batería(s) cambiada(s)', ru: 'батаре(я/й) заменено' },
  tarefaCancelada: { pt: 'Tarefa cancelada',    en: 'Task cancelled',      es: 'Tarea cancelada',      ru: 'Задача отменена' },
  motivoLbl:       { pt: 'Motivo: ',            en: 'Reason: ',            es: 'Motivo: ',             ru: 'Причина: ' },
  histEntregas:    { pt: 'Histórico de entregas', en: 'Delivery history',  es: 'Historial de entregas', ru: 'История доставок' },
  patinetesUn:     { pt: 'patinete(s)',         en: 'scooter(s)',          es: 'patinete(s)',          ru: 'самокат(ов)' },
  bateriasUn:      { pt: 'bateria(s)',          en: 'batter(y/ies)',       es: 'batería(s)',           ru: 'батаре(й)' },
  erro:            { pt: 'Erro: ',              en: 'Error: ',             es: 'Error: ',              ru: 'Ошибка: ' },
  erroRegEntrega:  { pt: 'Erro ao registrar entrega: ', en: 'Error logging delivery: ', es: 'Error al registrar entrega: ', ru: 'Ошибка при записи доставки: ' },

  // ── TarefasCampoView ──
  slotAtivo:       { pt: 'Slot ativo — ',       en: 'Active slot — ',      es: 'Slot activo — ',       ru: 'Активный слот — ' },
  pendentes:       { pt: 'Pendentes',           en: 'Pending',             es: 'Pendientes',           ru: 'Ожидают' },
  ativos:          { pt: 'Ativos',              en: 'Active',              es: 'Activos',              ru: 'Активные' },
  concluidas:      { pt: 'Concluídas',          en: 'Completed',           es: 'Completadas',          ru: 'Завершено' },
  semTarefas:      { pt: 'Sem tarefas pendentes!', en: 'No pending tasks!', es: '¡Sin tareas pendientes!', ru: 'Нет ожидающих задач!' },
  aguardeTarefas:  { pt: 'Aguarde novas tarefas ou verifique seu slot.', en: 'Wait for new tasks or check your slot.', es: 'Espere nuevas tareas o verifique su slot.', ru: 'Дождитесь новых задач или проверьте свой слот.' },
  statAtivo:       { pt: '▶ Ativo',             en: '▶ Active',            es: '▶ Activo',             ru: '▶ Активно' },
  statFeito:       { pt: '✓ Feito',             en: '✓ Done',              es: '✓ Hecho',              ru: '✓ Готово' },
  statPendente:    { pt: 'Pendente',            en: 'Pending',             es: 'Pendiente',            ru: 'Ожидает' },

  // ── FormCriarSlot ──
  erroTurno:       { pt: 'Informe início e fim do turno', en: 'Enter shift start and end', es: 'Indique inicio y fin del turno', ru: 'Укажите начало и конец смены' },
  erroTurnoOrdem:  { pt: 'Fim deve ser após início', en: 'End must be after start', es: 'El fin debe ser posterior al inicio', ru: 'Конец должен быть после начала' },
  erroTitulo:      { pt: 'Preencha o título de todas as tarefas', en: 'Fill in the title of all tasks', es: 'Complete el título de todas las tareas', ru: 'Заполните название всех задач' },
  erroCriarSlot:   { pt: 'Erro ao criar slot', en: 'Error creating slot', es: 'Error al crear slot',  ru: 'Ошибка при создании слота' },
  tipoSlot:        { pt: 'Tipo de slot',        en: 'Slot type',           es: 'Tipo de slot',         ru: 'Тип слота' },
  zona:            { pt: 'Zona',                en: 'Zone',                es: 'Zona',                 ru: 'Зона' },
  selecione:       { pt: '— Selecione —',       en: '— Select —',          es: '— Seleccione —',       ru: '— Выберите —' },
  nomeZona:        { pt: 'Nome da zona',        en: 'Zone name',           es: 'Nombre de la zona',    ru: 'Название зоны' },
  prioridade:      { pt: 'Prioridade',          en: 'Priority',            es: 'Prioridad',            ru: 'Приоритет' },
  inicioTurno:     { pt: 'Início do turno',     en: 'Shift start',         es: 'Inicio del turno',     ru: 'Начало смены' },
  fimTurno:        { pt: 'Fim do turno',        en: 'Shift end',           es: 'Fin del turno',        ru: 'Конец смены' },
  atribuirWorker:  { pt: 'Atribuir worker (opcional)', en: 'Assign worker (optional)', es: 'Asignar worker (opcional)', ru: 'Назначить исполнителя (необязательно)' },
  deixarAberto:    { pt: '— Deixar aberto —',   en: '— Leave open —',      es: '— Dejar abierto —',    ru: '— Оставить открытым —' },
  slaAceite:       { pt: 'SLA aceite (min)',    en: 'Accept SLA (min)',    es: 'SLA de aceptación (min)', ru: 'SLA принятия (мин)' },
  min:             { pt: 'min',                 en: 'min',                 es: 'min',                  ru: 'мин' },
  fotoObrigCheckin:{ pt: '📸 Foto obrigatória no check-in', en: '📸 Photo required at check-in', es: '📸 Foto obligatoria en el check-in', ru: '📸 Фото обязательно при чек-ине' },
  instrucoesOperador: { pt: 'Instruções adicionais para o operador', en: 'Additional instructions for the operator', es: 'Instrucciones adicionales para el operador', ru: 'Дополнительные инструкции для оператора' },
  tarefasSlot:     { pt: 'Tarefas do slot',     en: 'Slot tasks',          es: 'Tareas del slot',      ru: 'Задачи слота' },
  adicionar:       { pt: '+ Adicionar',         en: '+ Add',               es: '+ Agregar',            ru: '+ Добавить' },
  tarefaN:         { pt: 'Tarefa ',             en: 'Task ',               es: 'Tarea ',               ru: 'Задача ' },
  titulo:          { pt: 'Título',              en: 'Title',               es: 'Título',               ru: 'Название' },
  phEncherPonto:   { pt: 'Ex: Encher Ponto X',  en: 'e.g. Fill Point X',   es: 'Ej: Llenar Punto X',   ru: 'Напр.: Заполнить точку X' },
  phTrocarBaterias:{ pt: 'Ex: Trocar baterias Zona A', en: 'e.g. Swap batteries Zone A', es: 'Ej: Cambiar baterías Zona A', ru: 'Напр.: Заменить батареи Зона A' },
  qtdAlvo:         { pt: 'Qtd alvo',            en: 'Target qty',          es: 'Cant. objetivo',       ru: 'Целевое кол-во' },
  pontoDestino:    { pt: 'Ponto destino',       en: 'Destination point',   es: 'Punto de destino',     ru: 'Точка назначения' },
  nomePonto:       { pt: 'Nome do ponto',       en: 'Point name',          es: 'Nombre del punto',     ru: 'Название точки' },
  pontoOrigemColeta:{ pt: 'Ponto origem (de onde coletar)', en: 'Pickup point (where to collect)', es: 'Punto de origen (de dónde recoger)', ru: 'Точка сбора (откуда забирать)' },
  nomePontoOrigem: { pt: 'Nome do ponto origem', en: 'Pickup point name',  es: 'Nombre del punto de origen', ru: 'Название точки сбора' },
  patinetesIds:    { pt: 'Patinetes (IDs, uma por linha)', en: 'Scooters (IDs, one per line)', es: 'Patinetes (IDs, uno por línea)', ru: 'Самокаты (ID, по одному в строке)' },
  patinetesSugIds: { pt: 'Patinetes sugeridas (IDs, uma por linha)', en: 'Suggested scooters (IDs, one per line)', es: 'Patinetes sugeridos (IDs, uno por línea)', ru: 'Рекомендуемые самокаты (ID, по одному в строке)' },
  criando:         { pt: '⏳ Criando...',        en: '⏳ Creating...',       es: '⏳ Creando...',         ru: '⏳ Создание...' },
  criarSlot:       { pt: '+ Criar Slot ',       en: '+ Create Slot ',      es: '+ Crear Slot ',        ru: '+ Создать слот ' },

  // ── SlotCard ──
  auto:            { pt: '🤖 Auto',             en: '🤖 Auto',             es: '🤖 Auto',              ru: '🤖 Авто' },
  gpsOffline:      { pt: 'GPS offline',         en: 'GPS offline',         es: 'GPS sin conexión',     ru: 'GPS офлайн' },
  tarefasLbl:      { pt: ' tarefas',            en: ' tasks',              es: ' tareas',              ru: ' задач' },
  checkIn:         { pt: 'Check-in',            en: 'Check-in',            es: 'Check-in',             ru: 'Чек-ин' },
  checkOut:        { pt: 'Check-out',           en: 'Check-out',           es: 'Check-out',            ru: 'Чек-аут' },
  slaAceiteLbl:    { pt: 'SLA aceite',          en: 'Accept SLA',          es: 'SLA de aceptación',    ru: 'SLA принятия' },
  fotoCheckinObrig:{ pt: '📸 Foto de check-in obrigatória', en: '📸 Check-in photo required', es: '📸 Foto de check-in obligatoria', ru: '📸 Фото чек-ина обязательно' },
  confirmarCheckin:{ pt: '📍 Confirmar check-in', en: '📍 Confirm check-in', es: '📍 Confirmar check-in', ru: '📍 Подтвердить чек-ин' },
  reatribuirSlot:  { pt: '✏ Reatribuir slot',   en: '✏ Reassign slot',      es: '✏ Reasignar slot',     ru: '✏ Переназначить слот' },
  selecioneNovoWorker: { pt: '— Selecione o novo worker —', en: '— Select the new worker —', es: '— Seleccione el nuevo worker —', ru: '— Выберите нового исполнителя —' },
  aceitarSlotBtn:  { pt: '✓ Aceitar Slot',      en: '✓ Accept Slot',       es: '✓ Aceptar Slot',       ru: '✓ Принять слот' },
  checkInBtn:      { pt: '📍 Check-in',          en: '📍 Check-in',          es: '📍 Check-in',           ru: '📍 Чек-ин' },
  concluirSlot:    { pt: '🏁 Concluir Slot',     en: '🏁 Complete Slot',     es: '🏁 Completar Slot',     ru: '🏁 Завершить слот' },
  reatribuir:      { pt: '✏ Reatribuir',        en: '✏ Reassign',           es: '✏ Reasignar',          ru: '✏ Переназначить' },

  // ── ConfigAutoSlotsPanel ──
  faixaPicoManha:  { pt: 'Pico manhã',          en: 'Morning peak',        es: 'Pico mañana',          ru: 'Утренний пик' },
  faixaManha:      { pt: 'Manhã',               en: 'Morning',             es: 'Mañana',               ru: 'Утро' },
  faixaAlmoco:     { pt: 'Almoço',              en: 'Lunch',               es: 'Almuerzo',             ru: 'Обед' },
  faixaTarde:      { pt: 'Tarde',               en: 'Afternoon',           es: 'Tarde',                ru: 'День' },
  faixaPicoTarde:  { pt: 'Pico tarde',          en: 'Afternoon peak',      es: 'Pico tarde',           ru: 'Дневной пик' },
  faixaNoite:      { pt: 'Noite',               en: 'Evening',             es: 'Noche',                ru: 'Вечер' },
  faixaMadrugada:  { pt: 'Madrugada',           en: 'Overnight',           es: 'Madrugada',            ru: 'Ночь' },
  configIntro:     { pt: 'Configure geração automática de slots por zona. As ', en: 'Configure automatic slot generation per zone. ', es: 'Configure la generación automática de slots por zona. Las ', ru: 'Настройте автоматическое создание слотов по зонам. ' },
  configIntroBold: { pt: 'faixas de horário',   en: 'time bands',          es: 'franjas horarias',     ru: 'временные интервалы' },
  configIntroFim:  { pt: ' sobrescrevem os valores padrão quando ativas — ideal para picos de demanda.', en: ' override the default values when active — ideal for demand peaks.', es: ' sobrescriben los valores predeterminados cuando están activas — ideal para picos de demanda.', ru: ' переопределяют значения по умолчанию, когда активны — идеально для пиков спроса.' },
  cfgAtivo:        { pt: '✓ Ativo · ',          en: '✓ Active · ',         es: '✓ Activo · ',          ru: '✓ Активно · ' },
  cfgInativo:      { pt: '✗ Inativo',           en: '✗ Inactive',          es: '✗ Inactivo',           ru: '✗ Неактивно' },
  cfgNaoConfig:    { pt: 'Não configurado',     en: 'Not configured',      es: 'No configurado',       ru: 'Не настроено' },
  faixasUn:        { pt: ' faixas',             en: ' bands',              es: ' franjas',             ru: ' интервалов' },
  phNomeZona:      { pt: 'Nome da zona (ex: Centro, Zona Sul…)', en: 'Zone name (e.g. Downtown, South Zone…)', es: 'Nombre de la zona (ej: Centro, Zona Sur…)', ru: 'Название зоны (напр.: Центр, Южная зона…)' },
  zonaBtn:         { pt: '+ Zona',              en: '+ Zone',              es: '+ Zona',               ru: '+ Зона' },
  gerando:         { pt: '⏳ Gerando...',         en: '⏳ Generating...',      es: '⏳ Generando...',        ru: '⏳ Генерация...' },
  gerarSlotsAgora: { pt: '▶ Gerar Slots Agora', en: '▶ Generate Slots Now', es: '▶ Generar Slots Ahora', ru: '▶ Создать слоты сейчас' },
  atualizando:     { pt: '⏳ Atualizando...',     en: '⏳ Updating...',        es: '⏳ Actualizando...',     ru: '⏳ Обновление...' },
  atualizarGoJet:  { pt: '🔄 Atualizar GoJet',   en: '🔄 Update GoJet',      es: '🔄 Actualizar GoJet',   ru: '🔄 Обновить GoJet' },
  slotsGerados:    { pt: '✓ Slots gerados com sucesso', en: '✓ Slots generated successfully', es: '✓ Slots generados con éxito', ru: '✓ Слоты успешно созданы' },
  falhaGeracao:    { pt: 'Falha na geração',    en: 'Generation failed',   es: 'Fallo en la generación', ru: 'Сбой генерации' },
  snapshotAtualizado: { pt: '✓ Snapshot GoJet atualizado', en: '✓ GoJet snapshot updated', es: '✓ Snapshot GoJet actualizado', ru: '✓ Снимок GoJet обновлён' },
  falhaScraper:    { pt: 'Falha no scraper',    en: 'Scraper failed',      es: 'Fallo en el scraper',  ru: 'Сбой скрапера' },
  configSalva:     { pt: '✓ Configuração salva', en: '✓ Configuration saved', es: '✓ Configuración guardada', ru: '✓ Конфигурация сохранена' },
  logDecisoes:     { pt: '📋 Log de decisões recentes', en: '📋 Recent decision log', es: '📋 Registro de decisiones recientes', ru: '📋 Журнал последних решений' },
  padroes:         { pt: '⚙️ Padrões',          en: '⚙️ Defaults',          es: '⚙️ Predeterminados',    ru: '⚙️ По умолчанию' },
  faixasHorario:   { pt: '⏰ Faixas de horário', en: '⏰ Time bands',         es: '⏰ Franjas horarias',    ru: '⏰ Временные интервалы' },
  faixasHorarioPlain: { pt: 'Faixas de horário', en: 'Time bands',          es: 'Franjas horarias',     ru: 'Временные интервалы' },
  chargerTab:      { pt: '⚡ Charger',           en: '⚡ Charger',           es: '⚡ Charger',            ru: '⚡ Charger' },
  scoutPadrao:     { pt: '🛴 Scout — Valores padrão', en: '🛴 Scout — Default values', es: '🛴 Scout — Valores predeterminados', ru: '🛴 Scout — Значения по умолчанию' },
  minimo:          { pt: 'Mínimo',              en: 'Minimum',             es: 'Mínimo',               ru: 'Минимум' },
  alvo:            { pt: 'Alvo',                en: 'Target',              es: 'Objetivo',             ru: 'Цель' },
  maximo:          { pt: 'Máximo',              en: 'Maximum',             es: 'Máximo',               ru: 'Максимум' },
  tipMinimo:       { pt: 'abaixo → scout encher', en: 'below → scout fills', es: 'debajo → scout llena', ru: 'ниже → scout пополняет' },
  tipAlvo:         { pt: 'meta ideal',          en: 'ideal target',        es: 'meta ideal',           ru: 'идеальная цель' },
  tipMaximo:       { pt: 'acima → redistribuir', en: 'above → redistribute', es: 'arriba → redistribuir', ru: 'выше → перераспределить' },
  ajustarHistorico:{ pt: 'Ajustar alvo com histórico do dia anterior', en: 'Adjust target with previous day history', es: 'Ajustar objetivo con el historial del día anterior', ru: 'Корректировать цель по истории предыдущего дня' },
  incluirForaPonto:{ pt: 'Incluir patinetes fora de ponto como tarefa de retorno', en: 'Include out-of-point scooters as a return task', es: 'Incluir patinetes fuera de punto como tarea de retorno', ru: 'Включать самокаты вне точки как задачу возврата' },
  horarioGlobal:   { pt: 'Horário ativo global', en: 'Global active hours', es: 'Horario activo global', ru: 'Глобальные часы активности' },
  intervaloChecagem:{ pt: 'Intervalo checagem', en: 'Check interval',      es: 'Intervalo de chequeo', ru: 'Интервал проверки' },
  sensibilidadeClima:{ pt: 'Sensibilidade ao clima', en: 'Weather sensitivity', es: 'Sensibilidad al clima', ru: 'Чувствительность к погоде' },
  climaIgnorar:    { pt: 'Ignorar',             en: 'Ignore',              es: 'Ignorar',              ru: 'Игнорировать' },
  climaModerada:   { pt: 'Moderada',            en: 'Moderate',            es: 'Moderada',             ru: 'Умеренная' },
  climaAlta:       { pt: 'Alta',                en: 'High',                es: 'Alta',                 ru: 'Высокая' },
  workersPorSlot:  { pt: '👷 Workers por slot', en: '👷 Workers per slot',  es: '👷 Workers por slot',  ru: '👷 Исполнителей на слот' },
  quantidade:      { pt: 'Quantidade',          en: 'Quantity',            es: 'Cantidad',             ru: 'Количество' },
  workersDesc:     { pt: 'Quantos workers o motor tentará atribuir ao criar o slot. Se não houver disponíveis suficientes, o slot fica aberto para aceite manual.', en: 'How many workers the engine will try to assign when creating the slot. If not enough are available, the slot stays open for manual acceptance.', es: 'Cuántos workers intentará asignar el motor al crear el slot. Si no hay suficientes disponibles, el slot queda abierto para aceptación manual.', ru: 'Сколько исполнителей движок попытается назначить при создании слота. Если доступных недостаточно, слот остаётся открытым для ручного принятия.' },
  autoAtribuir:    { pt: 'Auto-atribuir worker mais próximo', en: 'Auto-assign nearest worker', es: 'Auto-asignar al worker más cercano', ru: 'Авто-назначение ближайшего исполнителя' },
  notificarGestor: { pt: 'Notificar gestor ao gerar', en: 'Notify manager on generation', es: 'Notificar al gestor al generar', ru: 'Уведомлять менеджера при генерации' },
  faixasIntro:     { pt: 'Cada faixa ativa ', en: 'Each active band ',     es: 'Cada franja activa ',  ru: 'Каждый активный интервал ' },
  faixasIntroBold: { pt: 'sobrescreve',        en: 'overrides',           es: 'sobrescribe',          ru: 'переопределяет' },
  faixasIntroFim:  { pt: ' os valores padrão quando o horário atual estiver dentro da janela. Útil para picos, turnos e períodos especiais.', en: ' the default values when the current time is within the window. Useful for peaks, shifts and special periods.', es: ' los valores predeterminados cuando la hora actual está dentro de la ventana. Útil para picos, turnos y períodos especiales.', ru: ' значения по умолчанию, когда текущее время в пределах окна. Полезно для пиков, смен и особых периодов.' },
  linhaTempo:      { pt: 'Linha do tempo (07h → 23h)', en: 'Timeline (07h → 23h)', es: 'Línea de tiempo (07h → 23h)', ru: 'Шкала времени (07ч → 23ч)' },
  novaFaixa:       { pt: 'Nova faixa',          en: 'New band',            es: 'Nueva franja',         ru: 'Новый интервал' },
  padraoPh:        { pt: 'padrão',              en: 'default',             es: 'predet.',              ru: 'по умолч.' },
  addFaixa:        { pt: '+ Adicionar faixa',   en: '+ Add band',          es: '+ Agregar franja',     ru: '+ Добавить интервал' },
  dicaFaixas:      { pt: '💡 Campos em branco herdam o valor padrão da zona. Múltiplas faixas podem se sobrepor — a de maior prioridade prevalece.', en: '💡 Blank fields inherit the zone default value. Multiple bands may overlap — the highest priority prevails.', es: '💡 Los campos en blanco heredan el valor predeterminado de la zona. Múltiples franjas pueden superponerse — prevalece la de mayor prioridad.', ru: '💡 Пустые поля наследуют значение зоны по умолчанию. Несколько интервалов могут пересекаться — побеждает самый приоритетный.' },
  chargerAtivo:    { pt: '⚡ Charger ativo',     en: '⚡ Charger active',     es: '⚡ Charger activo',     ru: '⚡ Charger активен' },
  thresholdBat:    { pt: 'Threshold bateria (%)', en: 'Battery threshold (%)', es: 'Umbral de batería (%)', ru: 'Порог заряда (%)' },
  thresholdDesc:   { pt: 'Patinetes abaixo deste % entram na lista', en: 'Scooters below this % enter the list', es: 'Patinetes por debajo de este % entran en la lista', ru: 'Самокаты ниже этого % попадают в список' },
  minimoGerarSlot: { pt: 'Mínimo para gerar slot', en: 'Minimum to generate slot', es: 'Mínimo para generar slot', ru: 'Минимум для создания слота' },
  minimoDesc:      { pt: 'Só gera se tiver pelo menos N patinetes', en: 'Only generates if there are at least N scooters', es: 'Solo genera si hay al menos N patinetes', ru: 'Создаётся только при наличии хотя бы N самокатов' },
  dicaChargerFaixa:{ pt: '💡 Para configurar thresholds de bateria diferentes por horário, use a aba ', en: '💡 To set different battery thresholds per time, use the ', es: '💡 Para configurar umbrales de batería diferentes por horario, use la pestaña ', ru: '💡 Чтобы задать разные пороги заряда по времени, используйте вкладку ' },
  dicaChargerFaixaFim: { pt: ' e preencha o campo "Bat. ⚡" em cada faixa.', en: ' and fill the "Bat. ⚡" field in each band.', es: ' y complete el campo "Bat. ⚡" en cada franja.', ru: ' и заполните поле «Bat. ⚡» в каждом интервале.' },
  salvando:        { pt: '⏳ Salvando...',        en: '⏳ Saving...',         es: '⏳ Guardando...',        ru: '⏳ Сохранение...' },
  salvarConfig:    { pt: '✓ Salvar configuração', en: '✓ Save configuration', es: '✓ Guardar configuración', ru: '✓ Сохранить конфигурацию' },
  ativo:           { pt: 'Ativo',               en: 'Active',              es: 'Activo',               ru: 'Активно' },
  inativo:         { pt: 'Inativo',             en: 'Inactive',            es: 'Inactivo',             ru: 'Неактивно' },

  // ── FormOcorrencia ──
  erroDescOcorr:   { pt: 'Descreva a ocorrência', en: 'Describe the incident', es: 'Describa el incidente', ru: 'Опишите инцидент' },
  erroRegistrar:   { pt: 'Erro ao registrar',   en: 'Error registering',   es: 'Error al registrar',   ru: 'Ошибка при регистрации' },
  tipoOcorrencia:  { pt: 'Tipo de ocorrência',  en: 'Incident type',       es: 'Tipo de incidente',    ru: 'Тип инцидента' },
  rouboDetectado:  { pt: '🚨 Roubo detectado',   en: '🚨 Theft detected',    es: '🚨 Robo detectado',     ru: '🚨 Обнаружена кража' },
  procurandoPatinete: { pt: '🔍 Procurando patinete', en: '🔍 Searching for scooter', es: '🔍 Buscando patinete', ru: '🔍 Поиск самоката' },
  marcarProcurando:{ pt: 'Marcar como "Procurando"', en: 'Mark as "Searching"', es: 'Marcar como "Buscando"', ru: 'Отметить как «Поиск»' },
  idPatinete:      { pt: 'ID do patinete (se conhecido)', en: 'Scooter ID (if known)', es: 'ID del patinete (si se conoce)', ru: 'ID самоката (если известен)' },
  phIdPatinete:    { pt: 'Ex: SC-1234',         en: 'e.g. SC-1234',        es: 'Ej: SC-1234',          ru: 'Напр.: SC-1234' },
  descricao:       { pt: 'Descrição',           en: 'Description',         es: 'Descripción',          ru: 'Описание' },
  phDescOcorr:     { pt: 'Descreva o que aconteceu, local, horário...', en: 'Describe what happened, location, time...', es: 'Describa qué pasó, lugar, hora...', ru: 'Опишите, что произошло, место, время...' },
  registrando:     { pt: '⏳ Registrando...',     en: '⏳ Registering...',     es: '⏳ Registrando...',      ru: '⏳ Регистрация...' },
  registrarOcorr:  { pt: '🚨 Registrar Ocorrência', en: '🚨 Register Incident', es: '🚨 Registrar Incidente', ru: '🚨 Зарегистрировать инцидент' },

  // ── HistoricoSlotsPanel ──
  buscarHist:      { pt: 'Buscar título, worker, zona…', en: 'Search title, worker, zone…', es: 'Buscar título, worker, zona…', ru: 'Поиск по названию, исполнителю, зоне…' },
  todosTipos:      { pt: 'Todos tipos',         en: 'All types',           es: 'Todos los tipos',      ru: 'Все типы' },
  todosStatus:     { pt: 'Todos status',        en: 'All statuses',        es: 'Todos los estados',    ru: 'Все статусы' },
  thTipo:          { pt: 'Tipo',                en: 'Type',                es: 'Tipo',                 ru: 'Тип' },
  thStatus:        { pt: 'Status',              en: 'Status',              es: 'Estado',               ru: 'Статус' },
  thTitulo:        { pt: 'Título',              en: 'Title',               es: 'Título',               ru: 'Название' },
  thWorker:        { pt: 'Worker',              en: 'Worker',              es: 'Worker',               ru: 'Исполнитель' },
  thTurno:         { pt: 'Turno',               en: 'Shift',               es: 'Turno',                ru: 'Смена' },
  thProgresso:     { pt: 'Progresso',           en: 'Progress',            es: 'Progreso',             ru: 'Прогресс' },
  nenhumSlot:      { pt: 'Nenhum slot encontrado.', en: 'No slot found.',  es: 'No se encontró ningún slot.', ru: 'Слоты не найдены.' },
  exibindo:        { pt: 'Exibindo 200 de ',    en: 'Showing 200 of ',     es: 'Mostrando 200 de ',    ru: 'Показано 200 из ' },
  refineFiltros:   { pt: '. Use os filtros para refinar.', en: '. Use the filters to refine.', es: '. Use los filtros para refinar.', ru: '. Используйте фильтры для уточнения.' },

  // ── Componente principal ──
  slotsLogistica:  { pt: '📦 Slots & Logística', en: '📦 Slots & Logistics', es: '📦 Slots y Logística', ru: '📦 Слоты и логистика' },
  adminGestor:     { pt: 'Admin/Gestor',        en: 'Admin/Manager',       es: 'Admin/Gestor',         ru: 'Админ/Менеджер' },
  gpsSemSinal:     { pt: 'GPS sem sinal',       en: 'GPS no signal',       es: 'GPS sin señal',        ru: 'GPS нет сигнала' },
  ativeLocalizacao:{ pt: 'Ative a localização nas configurações do celular', en: 'Enable location in your phone settings', es: 'Active la ubicación en la configuración del teléfono', ru: 'Включите геолокацию в настройках телефона' },
  gpsLabel:        { pt: 'GPS ',                en: 'GPS ',                es: 'GPS ',                 ru: 'GPS ' },
  rastreando2Plano:{ pt: 'rastreando em 2º plano', en: 'tracking in background', es: 'rastreando en 2º plano', ru: 'отслеживание в фоне' },
  pts:             { pt: ' pts',                en: ' pts',                es: ' pts',                 ru: ' точек' },
  offlineLbl:      { pt: ' offline',            en: ' offline',            es: ' sin conexión',        ru: ' офлайн' },
  abaSlots:        { pt: '⏰ Slots',             en: '⏰ Slots',             es: '⏰ Slots',              ru: '⏰ Слоты' },
  abaTarefas:      { pt: '✓ Tarefas',           en: '✓ Tasks',             es: '✓ Tareas',             ru: '✓ Задачи' },
  abaOcorrencias:  { pt: '🚨 Ocorrências',       en: '🚨 Incidents',         es: '🚨 Incidentes',         ru: '🚨 Инциденты' },
  abaEquipe:       { pt: '👥 Equipe',            en: '👥 Team',              es: '👥 Equipo',             ru: '👥 Команда' },
  abaAutoSlots:    { pt: '🤖 Auto-slots',        en: '🤖 Auto-slots',        es: '🤖 Auto-slots',         ru: '🤖 Авто-слоты' },
  abaHistorico:    { pt: '📂 Histórico',         en: '📂 History',           es: '📂 Historial',          ru: '📂 История' },
  novoSlot:        { pt: '+ Novo Slot',         en: '+ New Slot',          es: '+ Nuevo Slot',         ru: '+ Новый слот' },
  filtroAtivos:    { pt: 'Ativos',              en: 'Active',              es: 'Activos',              ru: 'Активные' },
  filtroConcluidos:{ pt: 'Concluídos',          en: 'Completed',           es: 'Completados',          ru: 'Завершённые' },
  filtroAuto:      { pt: '🤖 Auto',             en: '🤖 Auto',             es: '🤖 Auto',              ru: '🤖 Авто' },
  filtroTodos:     { pt: 'Todos',               en: 'All',                 es: 'Todos',                ru: 'Все' },
  nenhumSlotAdmin: { pt: 'Nenhum slot encontrado. Crie um acima.', en: 'No slot found. Create one above.', es: 'No se encontró ningún slot. Cree uno arriba.', ru: 'Слоты не найдены. Создайте один выше.' },
  nenhumSlotWorker:{ pt: 'Nenhum slot disponível para você.', en: 'No slot available for you.', es: 'No hay slots disponibles para usted.', ru: 'Нет доступных для вас слотов.' },
  tarefasEm:       { pt: ' tarefas em ',        en: ' tasks in ',          es: ' tareas en ',          ru: ' задач в ' },
  tarefasAtribuidas:{ pt: ' tarefas atribuídas', en: ' assigned tasks',    es: ' tareas asignadas',    ru: ' назначенных задач' },
  nenhumaTarefa:   { pt: 'Nenhuma tarefa ativa.', en: 'No active tasks.',  es: 'No hay tareas activas.', ru: 'Нет активных задач.' },
  novaOcorrencia:  { pt: '🚨 Nova Ocorrência',   en: '🚨 New Incident',      es: '🚨 Nuevo Incidente',    ru: '🚨 Новый инцидент' },
  registrarOcorrBtn:{ pt: '+ Registrar Ocorrência', en: '+ Register Incident', es: '+ Registrar Incidente', ru: '+ Зарегистрировать инцидент' },
  nenhumaOcorr:    { pt: 'Nenhuma ocorrência aberta.', en: 'No open incidents.', es: 'No hay incidentes abiertos.', ru: 'Нет открытых инцидентов.' },
  procurandoBadge: { pt: '🔍 Procurando',        en: '🔍 Searching',         es: '🔍 Buscando',           ru: '🔍 Поиск' },
  prestadoresAtivos:{ pt: 'Prestadores ativos em ', en: 'Active providers in ', es: 'Prestadores activos en ', ru: 'Активные исполнители в ' },
  bateriaBaixaAlerta:{ pt: ' com bateria baixa (≤15%)', en: ' with low battery (≤15%)', es: ' con batería baja (≤15%)', ru: ' с низким зарядом (≤15%)' },
  semGpsAlerta:    { pt: ' sem GPS há +5min',   en: ' no GPS for +5min',    es: ' sin GPS hace +5min',  ru: ' без GPS более 5 мин' },
  nenhumPrestador: { pt: 'Nenhum prestador ativo em ', en: 'No active providers in ', es: 'No hay prestadores activos en ', ru: 'Нет активных исполнителей в ' },
  emSlot:          { pt: '⚡ Em slot',           en: '⚡ In slot',           es: '⚡ En slot',            ru: '⚡ В слоте' },
  disponivel:      { pt: 'Disponível',          en: 'Available',           es: 'Disponible',           ru: 'Доступен' },
  semGpsRecente:   { pt: '📍 sem GPS recente',   en: '📍 no recent GPS',     es: '📍 sin GPS reciente',   ru: '📍 нет недавнего GPS' },
  confirmarCancelSlot: { pt: 'Cancelar este slot?', en: 'Cancel this slot?', es: '¿Cancelar este slot?', ru: 'Отменить этот слот?' },
  notificadoSlot:  { pt: 'Você foi atribuído ao slot: ', en: 'You have been assigned to the slot: ', es: 'Se le ha asignado al slot: ', ru: 'Вам назначен слот: ' },

  // ── Complementos ──
  observacoes:     { pt: 'Observações (opcional)', en: 'Notes (optional)', es: 'Observaciones (opcional)', ru: 'Примечания (необязательно)' },
  subPatinetes:    { pt: 'Patinetes',          en: 'Scooters',            es: 'Patinetes',            ru: 'Самокаты' },
  subBaterias:     { pt: 'Baterias',           en: 'Batteries',           es: 'Baterías',             ru: 'Батареи' },
  regEntregaBtn:   { pt: '🛴 Registrar entrega', en: '🛴 Log delivery',     es: '🛴 Registrar entrega', ru: '🛴 Записать доставку' },
  regTrocaBtn:     { pt: '⚡ Registrar troca',   en: '⚡ Log swap',          es: '⚡ Registrar cambio',  ru: '⚡ Записать замену' },
  googleMaps:      { pt: '🗺 Google Maps',      en: '🗺 Google Maps',       es: '🗺 Google Maps',       ru: '🗺 Google Maps' },
  wazeBtn:         { pt: '🚗 Waze',             en: '🚗 Waze',             es: '🚗 Waze',              ru: '🚗 Waze' },
  minimoBike:      { pt: 'Mínimo 🛴',           en: 'Minimum 🛴',          es: 'Mínimo 🛴',            ru: 'Минимум 🛴' },
  alvoBike:        { pt: 'Alvo 🛴',             en: 'Target 🛴',           es: 'Objetivo 🛴',          ru: 'Цель 🛴' },
  maximoBike:      { pt: 'Máximo 🛴',           en: 'Maximum 🛴',          es: 'Máximo 🛴',            ru: 'Максимум 🛴' },
  batFaixa:        { pt: 'Bat. ⚡',             en: 'Bat. ⚡',             es: 'Bat. ⚡',              ru: 'Бат. ⚡' },
  exportCsv:       { pt: '⬇ CSV',              en: '⬇ CSV',               es: '⬇ CSV',                ru: '⬇ CSV' },
  csvId:           { pt: 'ID',                 en: 'ID',                  es: 'ID',                   ru: 'ID' },
  csvCriadoEm:     { pt: 'Criado em',          en: 'Created at',          es: 'Creado en',            ru: 'Создано' },
  csvCheckIn:      { pt: 'Check-in',           en: 'Check-in',            es: 'Check-in',             ru: 'Чек-ин' },
  csvCheckOut:     { pt: 'Check-out',          en: 'Check-out',           es: 'Check-out',            ru: 'Чек-аут' },
  csvTarefas:      { pt: 'Tarefas',            en: 'Tasks',               es: 'Tareas',               ru: 'Задачи' },
  csvConcluidas:   { pt: 'Concluídas',         en: 'Completed',           es: 'Completadas',          ru: 'Завершено' },

  // ── Status de tarefa (display) ──
  tsPendente:      { pt: 'pendente',           en: 'pending',             es: 'pendiente',            ru: 'ожидает' },
  tsAceita:        { pt: 'aceita',             en: 'accepted',            es: 'aceptada',             ru: 'принята' },
  tsEmAndamento:   { pt: 'em andamento',       en: 'in progress',         es: 'en curso',             ru: 'выполняется' },
  tsConcluida:     { pt: 'concluída',          en: 'completed',           es: 'completada',           ru: 'завершена' },
  tsCancelada:     { pt: 'cancelada',          en: 'cancelled',           es: 'cancelada',            ru: 'отменена' },
  tsRejeitada:     { pt: 'rejeitada',          en: 'rejected',            es: 'rechazada',            ru: 'отклонена' },

  // ── Status de ocorrência (display) ──
  osAberta:        { pt: 'aberta',             en: 'open',                es: 'abierta',              ru: 'открыт' },
  osEmTratamento:  { pt: 'em tratamento',      en: 'in handling',         es: 'en tratamiento',       ru: 'в обработке' },
  osResolvida:     { pt: 'resolvida',          en: 'resolved',            es: 'resuelta',             ru: 'решён' },
  osArquivada:     { pt: 'arquivada',          en: 'archived',            es: 'archivada',            ru: 'архив' },
} as const;

// Maps de status (display) — não alteram os valores enum gravados/consultados.
const TAREFA_STATUS_TL: Record<string, L> = {
  pendente:     T.tsPendente,
  aceita:       T.tsAceita,
  em_andamento: T.tsEmAndamento,
  concluida:    T.tsConcluida,
  cancelada:    T.tsCancelada,
  rejeitada:    T.tsRejeitada,
};

const OCORRENCIA_STATUS_TL: Record<string, L> = {
  aberta:        T.osAberta,
  em_tratamento: T.osEmTratamento,
  resolvida:     T.osResolvida,
  arquivada:     T.osArquivada,
};

function tStatusTarefa(pick: (o: L) => string, s: string): string {
  return TAREFA_STATUS_TL[s] ? pick(TAREFA_STATUS_TL[s]) : s;
}
function tStatusOcorrencia(pick: (o: L) => string, s: string): string {
  return OCORRENCIA_STATUS_TL[s] ? pick(OCORRENCIA_STATUS_TL[s]) : s;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPO_SLOT_META: Record<TipoSlot, { l: string; icone: string; cor: string; desc: string }> = {
  scout:   { l: 'Scout',   icone: '🛴', cor: '#06b6d4', desc: 'Movimentação de patinetes' },
  charger: { l: 'Charger', icone: '⚡', cor: '#10b981', desc: 'Troca de baterias' },
};

const PRIORIDADE_META: Record<SlotPrioridade, { l: string; cor: string }> = {
  normal:  { l: 'Normal',  cor: '#6b7280' },
  alta:    { l: 'Alta',    cor: '#f59e0b' },
  urgente: { l: 'Urgente', cor: '#ef4444' },
};

const STATUS_SLOT_COR: Record<SlotStatus, string> = {
  aberto:       '#fbbf24',
  aceito:       '#06b6d4',
  a_caminho:    '#a78bfa',
  em_andamento: '#10b981',
  concluido:    '#6b7280',
  cancelado:    '#ef4444',
};

const STATUS_SLOT_L: Record<SlotStatus, string> = {
  aberto:       'Aberto',
  aceito:       'Aceito',
  a_caminho:    'A caminho',
  em_andamento: 'Em andamento',
  concluido:    'Concluído',
  cancelado:    'Cancelado',
};

// Rótulos traduzíveis de status (display) — não substituem STATUS_SLOT_L (logic/CSV PT).
const STATUS_SLOT_TL: Record<SlotStatus, L> = {
  aberto:       T.stAberto,
  aceito:       T.stAceito,
  a_caminho:    T.stACaminho,
  em_andamento: T.stEmAndamento,
  concluido:    T.stConcluido,
  cancelado:    T.stCancelado,
};

// Rótulos traduzíveis de prioridade (display).
const PRIORIDADE_TL: Record<SlotPrioridade, L> = {
  normal:  T.prioNormal,
  alta:    T.prioAlta,
  urgente: T.prioUrgente,
};

const MOTIVOS_CANCELAMENTO = [
  'Patinete com defeito',
  'Patinete não encontrada',
  'Ponto inacessível',
  'Problema de segurança',
  'Encerramento de turno',
  'Outro',
];

// Tradução dos rótulos exibidos (o valor PT continua sendo gravado — não alterar a lógica).
const MOTIVO_L: Record<string, L> = {
  'Patinete com defeito':    T.motDefeito,
  'Patinete não encontrada': T.motNaoEncontrada,
  'Ponto inacessível':       T.motInacessivel,
  'Problema de segurança':   T.motSeguranca,
  'Encerramento de turno':   T.motEncerramento,
  'Outro':                   T.motOutro,
};

const OCORRENCIAS_TIPOS: { k: OcorrenciaTipo; l: string }[] = [
  { k: 'roubo',               l: 'Roubo de patinete' },
  { k: 'vandalismo',          l: 'Vandalismo' },
  { k: 'patinete_danificado', l: 'Patinete danificado' },
  { k: 'ponto_bloqueado',     l: 'Ponto bloqueado' },
  { k: 'usuario_infrator',    l: 'Usuário infrator' },
  { k: 'outro',               l: 'Outro' },
];

// Rótulos traduzíveis dos tipos de ocorrência (display).
const OCORRENCIA_TL: Record<string, L> = {
  roubo:               T.ocRoubo,
  vandalismo:          T.ocVandalismo,
  patinete_danificado: T.ocDanificado,
  ponto_bloqueado:     T.ocBloqueado,
  usuario_infrator:    T.ocInfrator,
  outro:               T.ocOutro,
};

// ─── Estilos ──────────────────────────────────────────────────────────────────

const isMobile = window.innerWidth <= 500;
const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: isMobile ? 0 : 16,
  },
  modal: {
    background: '#0d1521', borderRadius: isMobile ? 0 : 16,
    width: '100%', maxWidth: isMobile ? '100vw' : 1000,
    maxHeight: isMobile ? '100vh' : '92vh',
    display: 'flex', flexDirection: 'column' as const,
    border: '1px solid rgba(16,185,129,.18)',
    boxShadow: '0 12px 40px rgba(0,0,0,.6)',
  },
  header: {
    padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'rgba(16,185,129,.08)', flexShrink: 0,
  },
  tabBar: {
    display: 'flex', gap: 4, padding: '8px 14px',
    borderBottom: '1px solid rgba(255,255,255,.06)',
    overflowX: 'auto' as const, scrollbarWidth: 'none' as any, flexShrink: 0,
  },
  body: { flex: 1, overflowY: 'auto' as const, padding: 16 },
  card: {
    background: 'rgba(255,255,255,.03)',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 10, padding: '12px 14px', marginBottom: 8,
  },
  inp: {
    width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 13, outline: 'none',
  },
  lbl: {
    display: 'block' as const, color: 'rgba(255,255,255,.4)',
    fontSize: 10, fontWeight: 600 as const, marginBottom: 5, textTransform: 'uppercase' as const,
  },
  btn: (cor: string) => ({
    padding: '8px 14px', borderRadius: 7, border: 'none',
    background: cor, color: '#fff', fontWeight: 600 as const,
    fontSize: 12, cursor: 'pointer' as const,
  }),
  btnGhost: {
    padding: '8px 14px', borderRadius: 7,
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)',
    color: 'rgba(255,255,255,.45)', fontWeight: 600 as const,
    fontSize: 12, cursor: 'pointer' as const,
  },
  badge: (cor: string) => ({
    display: 'inline-block' as const,
    padding: '3px 9px', borderRadius: 20,
    background: cor + '22', color: cor,
    fontSize: 10, fontWeight: 700 as const,
  }),
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  sep: { borderTop: '1px solid rgba(255,255,255,.06)', margin: '16px 0' },
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

function fmtDt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtTs(ts: string | Date | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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

async function uploadFoto(file: File, path: string): Promise<string> {
  const comp = await comprimir(file);
  return uploadComRetry(comp, path);
}

// ─── ProgressBar de entregas ──────────────────────────────────────────────────

function ProgressoEntregas({ concluida, alvo, cor }: { concluida: number; alvo: number; cor: string }) {
  const { pick } = usePick();
  const pct = alvo > 0 ? Math.min(100, (concluida / alvo) * 100) : 0;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>
        <span>{pick(T.progresso)}</span>
        <span style={{ color: cor, fontWeight: 700 }}>{concluida}/{alvo}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: cor, borderRadius: 4, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

// ─── Modal Cancelamento ───────────────────────────────────────────────────────

function ModalCancelamento({ onConfirmar, onCancelar }: {
  onConfirmar: (motivo: string, notas: string, foto: File | null) => void;
  onCancelar: () => void;
}) {
  const { pick } = usePick();
  const [motivo, setMotivo] = useState(MOTIVOS_CANCELAMENTO[0]);
  const [notas, setNotas] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);
  const precisaFoto = motivo === 'Patinete com defeito' || motivo === 'Patinete não encontrada';

  const handleFoto = (f: File) => {
    setFoto(f);
    const r = new FileReader();
    r.onload = e => setPreview(e.target?.result as string || '');
    r.readAsDataURL(f);
  };

  const ok = !precisaFoto || foto !== null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: '#0d1521', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440, border: '1px solid rgba(239,68,68,.25)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#ef4444', marginBottom: 16 }}>{pick(T.cancelarTarefa)}</div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>{pick(T.motivo)}</label>
          <select value={motivo} onChange={e => setMotivo(e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
            {MOTIVOS_CANCELAMENTO.map(m => <option key={m} value={m} style={{ background: '#0d1521' }}>{pick(MOTIVO_L[m] ?? { pt: m, en: m, es: m, ru: m })}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>{pick(T.observacoes)}</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
            style={{ ...S.inp, resize: 'none' }} placeholder={pick(T.obsAdicionais)} />
        </div>

        {precisaFoto && (
          <div style={{ marginBottom: 12, padding: 10, background: 'rgba(239,68,68,.07)', borderRadius: 8, border: '1px solid rgba(239,68,68,.2)' }}>
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 8 }}>
              {pick(T.fotoObrigMotivo)}
            </div>
            {preview ? (
              <div style={{ position: 'relative' }}>
                <img src={preview} alt="preview" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 7 }} />
                <button onClick={() => { setFoto(null); setPreview(''); }} style={{
                  position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,.7)',
                  border: 'none', borderRadius: '50%', color: '#fff', width: 22, height: 22, cursor: 'pointer', fontSize: 11,
                }}>✕</button>
              </div>
            ) : (
              <button onClick={async () => {
                if (isAndroidNative()) {
                  let f: File | null = null;
                  try { f = await capturarFotoNativa(); } catch {}
                  if (f) { handleFoto(f); return; }
                }
                fotoRef.current?.click();
              }} style={{ ...S.btnGhost, width: '100%', textAlign: 'center' }}>
                {pick(T.tirarFoto)}
              </button>
            )}
            <input ref={fotoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFoto(f); }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.btn('#ef4444'), flex: 1, opacity: ok ? 1 : 0.5 }}
            onClick={() => ok && onConfirmar(motivo, notas, foto)} disabled={!ok}>
            {pick(T.confirmarCancel)}
          </button>
          <button style={S.btnGhost} onClick={onCancelar}>{pick(T.voltarPlain)}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Registrar Entrega ──────────────────────────────────────────────────

function ModalEntrega({ tipoSlot, onConfirmar, onCancelar }: {
  tipoSlot: TipoSlot;
  onConfirmar: (qtd: 1 | 2, foto: File, obs: string) => void;
  onCancelar: () => void;
}) {
  const { pick } = usePick();
  const [qtd, setQtd] = useState<1 | 2>(1);
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [obs, setObs] = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  const handleFoto = (f: File) => {
    setFoto(f);
    const r = new FileReader();
    r.onload = e => setPreview(e.target?.result as string || '');
    r.readAsDataURL(f);
  };

  const titulo = tipoSlot === 'scout' ? pick(T.regEntregaPatinetes) : pick(T.regTrocaBateria);
  const labelQtd = tipoSlot === 'scout' ? pick(T.qtdPatinetes) : pick(T.qtdBaterias);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: '#0d1521', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440, border: '1px solid rgba(16,185,129,.25)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981', marginBottom: 16 }}>{titulo}</div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.lbl}>{labelQtd}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {([1, 2] as const).map(n => (
              <button key={n} onClick={() => setQtd(n)} style={{
                padding: '12px', borderRadius: 9, border: `2px solid ${qtd === n ? '#10b981' : 'rgba(255,255,255,.1)'}`,
                background: qtd === n ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.03)',
                color: qtd === n ? '#10b981' : 'rgba(255,255,255,.5)',
                fontSize: 18, fontWeight: 800, cursor: 'pointer',
              }}>{n}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={S.lbl}>{pick(T.fotoComprov)}</label>
          {preview ? (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <img src={preview} alt="preview" style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 8 }} />
              <button onClick={() => { setFoto(null); setPreview(''); }} style={{
                position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.7)',
                border: 'none', borderRadius: '50%', color: '#fff', width: 24, height: 24, cursor: 'pointer', fontSize: 12,
              }}>✕</button>
            </div>
          ) : (
            <button onClick={async () => {
              if (isAndroidNative()) {
                let f: File | null = null;
                try { f = await capturarFotoNativa(); } catch {}
                if (f) { handleFoto(f); return; }
              }
              fotoRef.current?.click();
            }} style={{
              width: '100%', padding: '14px', borderRadius: 8, border: '2px dashed rgba(16,185,129,.3)',
              background: 'rgba(16,185,129,.05)', color: '#10b981', fontSize: 13, cursor: 'pointer',
            }}>{pick(T.tirarFoto)}</button>
          )}
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFoto(f); }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.lbl}>{pick(T.observacao)}</label>
          <input style={S.inp} value={obs} onChange={e => setObs(e.target.value)} placeholder={pick(T.algumaObs)} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.btn('#10b981'), flex: 1, opacity: foto ? 1 : 0.5 }}
            onClick={() => foto && onConfirmar(qtd, foto, obs)} disabled={!foto}>
            {pick(T.confirmarEntrega)}
          </button>
          <button style={S.btnGhost} onClick={onCancelar}>{pick(T.cancelar)}</button>
        </div>
      </div>
    </div>
  );
}

// ─── TarefaDetalheView ────────────────────────────────────────────────────────

function TarefaDetalheView({ tarefa, slotTipoSlot, workerUid, onVoltar, onAtualizar }: {
  tarefa: Tarefa;
  slotTipoSlot?: TipoSlot | null;
  workerUid?: string;
  onVoltar: () => void;
  onAtualizar: (status: string, extra?: any) => Promise<void>;
}) {
  const { pick } = usePick();
  const tipoSlot: TipoSlot = (tarefa.tipoSlot ?? slotTipoSlot ?? 'scout') as TipoSlot;
  const meta = TIPO_SLOT_META[tipoSlot];
  const qtdAlvo = tarefa.qtdAlvo ?? tarefa.quantidade ?? 1;
  const qtdConcluida = tarefa.qtdConcluida ?? 0;

  const [busy, setBusy] = useState(false);
  const [showEntrega, setShowEntrega] = useState(false);
  const [showCancelar, setShowCancelar] = useState(false);
  const [fotoChegadaFile, setFotoChegadaFile] = useState<File | null>(null);
  const [fotoChegadaPreview, setFotoChegadaPreview] = useState('');
  const fotoChegadaRef = useRef<HTMLInputElement>(null);

  // GPS do worker em tempo real
  const workerGPS = useWorkerGPS(workerUid ?? null);
  const distancia = workerGPS && tarefa.estacao?.lat
    ? distKmClient(workerGPS.lat, workerGPS.lng, tarefa.estacao.lat, tarefa.estacao.lng)
    : null;

  const gmaps = tarefa.estacao?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${tarefa.estacao.lat},${tarefa.estacao.lng}`
    : null;
  const waze = tarefa.estacao?.lat
    ? `https://waze.com/ul?ll=${tarefa.estacao.lat},${tarefa.estacao.lng}&navigate=yes`
    : null;

  const handleFotoChegada = (f: File) => {
    setFotoChegadaFile(f);
    const r = new FileReader();
    r.onload = e => setFotoChegadaPreview(e.target?.result as string || '');
    r.readAsDataURL(f);
  };

  const marcarACaminho = async () => {
    setBusy(true);
    try { await onAtualizar(tarefa.status === 'pendente' ? 'em_andamento' : tarefa.status, { aCaminhoEm: new Date().toISOString() }); }
    finally { setBusy(false); }
  };

  const iniciar = async () => {
    setBusy(true);
    try { await onAtualizar('em_andamento', { iniciadoEm: new Date().toISOString() }); }
    finally { setBusy(false); }
  };

  const registrarChegada = async () => {
    if (!fotoChegadaFile) return;
    setBusy(true);
    try {
      const url = await uploadFoto(fotoChegadaFile, `tarefas/${tarefa.id}_chegada_${Date.now()}.jpg`);
      await onAtualizar(tarefa.status, { fotoChegadaUrl: url, chegadaEm: new Date().toISOString() });
      setFotoChegadaFile(null);
      setFotoChegadaPreview('');
    } catch (e: any) { alert(pick(T.erro) + e.message); }
    finally { setBusy(false); }
  };

  const registrarEntrega = async (qtd: 1 | 2, foto: File, obs: string) => {
    setBusy(true);
    setShowEntrega(false);
    try {
      const pos = await capturarPosicaoUnica().catch(() => null);
      const url = await uploadFoto(foto, `tarefas/${tarefa.id}_entrega_${Date.now()}.jpg`);
      const novaEntrega: Entrega = {
        id: Date.now().toString(),
        qtd, fotoUrl: url, obs: obs || null,
        lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null,
        registradoEm: new Date().toISOString(),
      };
      const entregasAtuais: Entrega[] = tarefa.entregas ?? [];
      const novasEntregas = [...entregasAtuais, novaEntrega];
      const novaQtdConcluida = qtdConcluida + qtd;
      const concluida = novaQtdConcluida >= qtdAlvo;
      await onAtualizar(
        concluida ? 'concluida' : 'em_andamento',
        {
          entregas: novasEntregas,
          qtdConcluida: novaQtdConcluida,
          ...(concluida ? { concluidoEm: new Date().toISOString(), fotoUrl: url } : {}),
        }
      );
    } catch (e: any) { alert(pick(T.erroRegEntrega) + e.message); }
    finally { setBusy(false); }
  };

  const cancelarTarefa = async (motivo: string, notas: string, foto: File | null) => {
    setBusy(true);
    setShowCancelar(false);
    try {
      let fotoUrl: string | null = null;
      if (foto) fotoUrl = await uploadFoto(foto, `tarefas/${tarefa.id}_cancel_${Date.now()}.jpg`);
      await onAtualizar('cancelada', {
        motivoCancelamento: motivo,
        notasCancelamento: notas || null,
        fotoCancelamentoUrl: fotoUrl,
        canceladoEm: new Date().toISOString(),
      });
    } catch (e: any) { alert(pick(T.erro) + e.message); }
    finally { setBusy(false); }
  };

  const priorCor = (p: number) =>
    p >= 5 ? '#ef4444' : p >= 4 ? '#f59e0b' : p >= 3 ? '#3b82f6' : '#6b7280';

  const concluida = tarefa.status === 'concluida';
  const cancelada = tarefa.status === 'cancelada';
  const emAndamento = tarefa.status === 'em_andamento';
  const pendente = tarefa.status === 'pendente';

  return (
    <div>
      {showEntrega && (
        <ModalEntrega
          tipoSlot={tipoSlot}
          onConfirmar={registrarEntrega}
          onCancelar={() => setShowEntrega(false)}
        />
      )}
      {showCancelar && (
        <ModalCancelamento
          onConfirmar={cancelarTarefa}
          onCancelar={() => setShowCancelar(false)}
        />
      )}

      <button onClick={onVoltar} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
        fontSize: 12, cursor: 'pointer', marginBottom: 14, padding: 0,
      }}>{pick(T.voltar)}</button>

      {/* Header tarefa */}
      <div style={{
        background: `${priorCor(tarefa.prioridade ?? 3)}10`,
        border: `1px solid ${priorCor(tarefa.prioridade ?? 3)}30`,
        borderRadius: 10, padding: '12px 14px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span style={S.badge(meta.cor)}>{meta.icone} {meta.l}</span>
          <span style={S.badge(priorCor(tarefa.prioridade ?? 3))}>P{tarefa.prioridade}</span>
          {concluida && <span style={S.badge('#10b981')}>{pick(T.tConcluida)}</span>}
          {cancelada && <span style={S.badge('#ef4444')}>{pick(T.tCancelada)}</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#dce8ff', marginBottom: 4 }}>{tarefa.titulo}</div>
        {tarefa.descricao && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>{tarefa.descricao}</div>}
        {qtdAlvo > 0 && (
          <ProgressoEntregas concluida={qtdConcluida} alvo={qtdAlvo} cor={meta.cor} />
        )}
      </div>

      {/* ── Painel mapa / distância ─────────────────────────────────── */}
      {tarefa.estacao?.lat && (
        <div style={{ marginBottom: 12, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)' }}>
          {/* Preview do mapa via OSM static */}
          <div style={{ position: 'relative', height: 130, background: '#0d1521', overflow: 'hidden', cursor: 'pointer' }}
            onClick={() => flyToMapa(tarefa.estacao!.lat, tarefa.estacao!.lng)}>
            <img
              src={`https://staticmap.openstreetmap.de/staticmap.php?center=${tarefa.estacao.lat},${tarefa.estacao.lng}&zoom=15&size=400x130&markers=${tarefa.estacao.lat},${tarefa.estacao.lng},red`}
              alt="mapa"
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {/* Overlay com destino */}
            <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ background: 'rgba(0,0,0,.75)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', gap: 5 }}>
                📍 <span style={{ fontWeight: 700 }}>{tarefa.estacao.nome}</span>
              </div>
              {distancia != null && (
                <div style={{ background: 'rgba(0,0,0,.75)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: workerGPS ? (workerGPS.idadeS < 90 ? '#22c55e' : '#f59e0b') : '#6b7280' }}>
                  {distancia < 0.1 ? pick(T.noLocal) : `📏 ${fmtDist(distancia)}`}
                </div>
              )}
            </div>
            {/* Botão de toque — "ver no mapa JET" */}
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(13,18,30,.85)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>
              {pick(T.abrirNoMapa)}
            </div>
          </div>

          {/* Barra de status */}
          <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.03)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
            {/* Posição do worker */}
            {workerGPS ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: idadeLabel(workerGPS.idadeS).cor, flexShrink: 0 }} />
                <span style={{ color: idadeLabel(workerGPS.idadeS).cor }}>{pick(T.gpsPrefixo)}{idadeLabel(workerGPS.idadeS, pick(T.atras)).txt}</span>
                {(() => { const b = bateriaLabel(workerGPS.bateria); return b ? <span style={{ color: b.cor }}>· 🔋 {b.txt}</span> : null; })()}
                {distancia != null && <span style={{ color: 'rgba(255,255,255,.4)' }}>· {fmtDist(distancia)}{pick(T.doDestino)}</span>}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)' }}>{pick(T.gpsAguardando)}</div>
            )}
            <div style={{ flex: 1 }} />
            {/* Botões de navegação */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => flyToMapa(tarefa.estacao!.lat, tarefa.estacao!.lng)} style={{
                padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(167,139,250,.15)', border: '1px solid rgba(167,139,250,.3)', color: '#a78bfa',
              }}>🗺 JET</button>
              {gmaps && <a href={gmaps} target="_blank" rel="noreferrer" style={{ padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.25)', color: '#60a5fa', textDecoration: 'none' }}>GMaps</a>}
              {waze && <a href={waze} target="_blank" rel="noreferrer" style={{ padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.2)', color: '#4ade80', textDecoration: 'none' }}>Waze</a>}
            </div>
          </div>
        </div>
      )}

      {/* Patinetes sugeridas (charger) */}
      {tipoSlot === 'charger' && tarefa.patineteSugeridas && tarefa.patineteSugeridas.length > 0 && (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {pick(T.patBateriaBaixa)}
          </div>
          {tarefa.patineteSugeridas.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < tarefa.patineteSugeridas!.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', fontSize: 12 }}>
              <span style={{ color: '#dce8ff', fontWeight: 600 }}>{p.identifier}</span>
              {p.bateria != null && (
                <span style={{ color: p.bateria < 10 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                  🔋 {p.bateria}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Localização */}
      {tarefa.estacao && (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {pick(T.locDestino)}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#dce8ff', marginBottom: 2 }}>{tarefa.estacao.nome}</div>
          {tarefa.estacao.endereco && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 10 }}>{tarefa.estacao.endereco}</div>
          )}
          {(gmaps || waze) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {gmaps && (
                <a href={gmaps} target="_blank" rel="noreferrer" style={{
                  padding: '9px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(48,127,226,.15)', border: '1px solid rgba(48,127,226,.3)',
                  color: '#60a5fa', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}>{pick(T.googleMaps)}</a>
              )}
              {waze && (
                <a href={waze} target="_blank" rel="noreferrer" style={{
                  padding: '9px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(100,200,100,.1)', border: '1px solid rgba(100,200,100,.2)',
                  color: '#4ade80', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}>{pick(T.wazeBtn)}</a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Origem (scout) */}
      {tipoSlot === 'scout' && tarefa.estacaoOrigem && (
        <div style={{ ...S.card, marginBottom: 12, border: '1px solid rgba(6,182,212,.15)', background: 'rgba(6,182,212,.04)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(6,182,212,.6)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {pick(T.pontoOrigem)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff' }}>{tarefa.estacaoOrigem.nome}</div>
          {tarefa.estacaoOrigem.endereco && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{tarefa.estacaoOrigem.endereco}</div>}
        </div>
      )}

      {/* Ações */}
      {!concluida && !cancelada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* A caminho */}
          {(pendente || (emAndamento && !tarefa.aCaminhoEm)) && (
            <button onClick={marcarACaminho} disabled={busy} style={{
              ...S.btn('#a78bfa'), width: '100%', padding: '11px', fontSize: 13,
            }}>
              🚀 {tarefa.aCaminhoEm ? pick(T.aCaminhoReg) : pick(T.marcarACaminho)}
            </button>
          )}

          {/* Iniciar */}
          {pendente && (
            <button onClick={iniciar} disabled={busy} style={{ ...S.btn('#3b82f6'), width: '100%', padding: '11px', fontSize: 13 }}>
              {busy ? '⏳...' : pick(T.iniciarTarefa)}
            </button>
          )}

          {/* Foto de chegada */}
          {emAndamento && !tarefa.fotoChegadaUrl && tipoSlot === 'scout' && (
            <div style={{ ...S.card }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
                {pick(T.fotoChegada)}
              </div>
              {fotoChegadaPreview ? (
                <div>
                  <img src={fotoChegadaPreview} alt="chegada" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 7, marginBottom: 8 }} />
                  <button onClick={registrarChegada} disabled={busy} style={{ ...S.btn('#06b6d4'), width: '100%', fontSize: 12 }}>
                    {busy ? '⏳...' : pick(T.regChegada)}
                  </button>
                </div>
              ) : (
                <button onClick={async () => {
                  if (isAndroidNative()) {
                    let f: File | null = null;
                    try { f = await capturarFotoNativa(); } catch {}
                    if (f) { handleFotoChegada(f); return; }
                  }
                  fotoChegadaRef.current?.click();
                }} style={{ ...S.btnGhost, width: '100%' }}>
                  {pick(T.tirarFotoChegada)}
                </button>
              )}
              <input ref={fotoChegadaRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFotoChegada(f); }} />
            </div>
          )}

          {/* Registrar entrega */}
          {emAndamento && qtdConcluida < qtdAlvo && (
            <button onClick={() => setShowEntrega(true)} disabled={busy} style={{
              ...S.btn(meta.cor), width: '100%', padding: '13px', fontSize: 14,
            }}>
              {tipoSlot === 'scout' ? `${pick(T.regEntregaBtn)} (${qtdConcluida}/${qtdAlvo})` : `${pick(T.regTrocaBtn)} (${qtdConcluida}/${qtdAlvo})`}
            </button>
          )}

          {/* Cancelar */}
          {(pendente || emAndamento) && (
            <button onClick={() => setShowCancelar(true)} style={{
              ...S.btnGhost, width: '100%', color: '#ef4444',
              border: '1px solid rgba(239,68,68,.2)',
            }}>
              {pick(T.cancelarTarefa)}
            </button>
          )}
        </div>
      )}

      {/* Concluída */}
      {concluida && (
        <div style={{ textAlign: 'center', padding: 20, background: 'rgba(16,185,129,.08)', borderRadius: 10, border: '1px solid rgba(16,185,129,.2)' }}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{pick(T.tarefaConcluida)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
            {qtdConcluida} {tipoSlot === 'scout' ? pick(T.patinetesEntregues) : pick(T.bateriasTrocadas)}
          </div>
        </div>
      )}

      {/* Cancelada */}
      {cancelada && (
        <div style={{ padding: 14, background: 'rgba(239,68,68,.07)', borderRadius: 10, border: '1px solid rgba(239,68,68,.2)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>{pick(T.tarefaCancelada)}</div>
          {tarefa.motivoCancelamento && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>{pick(T.motivoLbl)}{pick(MOTIVO_L[tarefa.motivoCancelamento] ?? { pt: tarefa.motivoCancelamento, en: tarefa.motivoCancelamento, es: tarefa.motivoCancelamento, ru: tarefa.motivoCancelamento })}</div>}
          {tarefa.notasCancelamento && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>{tarefa.notasCancelamento}</div>}
        </div>
      )}

      {/* Histórico entregas */}
      {tarefa.entregas && tarefa.entregas.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {pick(T.histEntregas)}
          </div>
          {tarefa.entregas.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < tarefa.entregas!.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
              {e.fotoUrl && <img src={e.fotoUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
              <div style={{ flex: 1, fontSize: 11 }}>
                <div style={{ color: '#dce8ff', fontWeight: 600 }}>+{e.qtd} {tipoSlot === 'scout' ? pick(T.patinetesUn) : pick(T.bateriasUn)}</div>
                <div style={{ color: 'rgba(255,255,255,.3)' }}>{fmtTs(e.registradoEm)}</div>
                {e.obs && <div style={{ color: 'rgba(255,255,255,.35)' }}>{e.obs}</div>}
              </div>
              <span style={S.badge('#10b981')}>✓</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TarefasCampoView ─────────────────────────────────────────────────────────

function TarefasCampoView({ tarefas, loading, slotAtivo, workerUid, onTarefa }: {
  tarefas: Tarefa[];
  loading: boolean;
  slotAtivo: Slot | null;
  workerUid?: string;
  onTarefa: (t: Tarefa) => void;
}) {
  const { pick } = usePick();
  const tipoSlot: TipoSlot = (slotAtivo?.tipoSlot ?? 'scout') as TipoSlot;
  const workerGPS = useWorkerGPS(workerUid ?? null);
  const meta = TIPO_SLOT_META[tipoSlot];

  // Resumo do turno
  const concluidas = tarefas.filter(t => t.status === 'concluida');
  const ativas     = tarefas.filter(t => t.status === 'em_andamento');
  const pendentes  = tarefas.filter(t => t.status === 'pendente');
  const totalEntregues = tarefas.reduce((s, t) => s + (t.qtdConcluida ?? 0), 0);
  const totalAlvo      = tarefas.reduce((s, t) => s + (t.qtdAlvo ?? t.quantidade ?? 0), 0);

  const sorted = [...tarefas].sort((a, b) => {
    const ord = { em_andamento: 0, pendente: 1, concluida: 2, cancelada: 3 };
    const so = (ord[a.status as keyof typeof ord] ?? 9) - (ord[b.status as keyof typeof ord] ?? 9);
    if (so !== 0) return so;
    return (b.prioridade ?? 0) - (a.prioridade ?? 0);
  });

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.4)', fontSize: 13 }}>⏳ {pick(T.carregando)}</div>;

  return (
    <div>
      {/* Resumo do turno */}
      {slotAtivo && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: `${meta.cor}10`, border: `1px solid ${meta.cor}25`, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: meta.cor, fontWeight: 700, marginBottom: 6 }}>
            {meta.icone} {pick(T.slotAtivo)}{slotAtivo.titulo}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            {[
              { l: pick(T.pendentes), n: pendentes.length, cor: '#f59e0b' },
              { l: pick(T.ativos),    n: ativas.length,    cor: '#3b82f6' },
              { l: pick(T.concluidas),n: concluidas.length, cor: '#10b981' },
              { l: totalAlvo > 0 ? `${totalEntregues}/${totalAlvo}` : '—', n: null, cor: meta.cor, sub: tipoSlot === 'scout' ? pick(T.subPatinetes) : pick(T.subBaterias) },
            ].map((s, i) => (
              <div key={i} style={{ background: `${s.cor}12`, border: `1px solid ${s.cor}25`, borderRadius: 7, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: s.n != null ? 18 : 13, fontWeight: 800, color: s.cor }}>{s.n != null ? s.n : s.l}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', marginTop: 1 }}>{s.n != null ? s.l : (s.sub ?? '')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tarefas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginBottom: 4 }}>{pick(T.semTarefas)}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.3)' }}>{pick(T.aguardeTarefas)}</div>
        </div>
      )}

      {sorted.map((t, i) => {
        const priorCor = (p: number) => p >= 5 ? '#ef4444' : p >= 4 ? '#f59e0b' : p >= 3 ? '#3b82f6' : '#6b7280';
        const ativa = t.status === 'em_andamento';
        const concl = t.status === 'concluida';
        const qtdAlvo = t.qtdAlvo ?? t.quantidade ?? 0;
        const qtdConc = t.qtdConcluida ?? 0;
        return (
          <div key={t.id} onClick={() => onTarefa(t)} style={{
            background: ativa ? 'rgba(59,130,246,.08)' : concl ? 'rgba(16,185,129,.05)' : 'rgba(255,255,255,.03)',
            border: `1px solid ${ativa ? 'rgba(59,130,246,.25)' : concl ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.06)'}`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 8,
            cursor: 'pointer', opacity: concl ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: priorCor(t.prioridade ?? 3) + '20',
              border: `2px solid ${priorCor(t.prioridade ?? 3)}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: priorCor(t.prioridade ?? 3), flexShrink: 0,
            }}>{concl ? '✓' : i + 1}</div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: concl ? '#10b981' : '#dce8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.titulo}
              </div>
              {t.estacao && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {t.estacao.nome}</span>
                  {workerGPS && t.estacao.lat && (() => {
                    const d = distKmClient(workerGPS.lat, workerGPS.lng, t.estacao!.lat, t.estacao!.lng);
                    const cor = workerGPS.idadeS < 90 ? '#22c55e' : '#f59e0b';
                    return (
                      <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, color: cor, padding: '1px 5px', borderRadius: 4, background: cor + '18', border: `1px solid ${cor}30` }}>
                        {fmtDist(d)}
                      </span>
                    );
                  })()}
                </div>
              )}
              {qtdAlvo > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (qtdConc / qtdAlvo) * 100)}%`, background: meta.cor, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>{qtdConc}/{qtdAlvo}</div>
                </div>
              )}
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
              background: ativa ? 'rgba(59,130,246,.2)' : concl ? 'rgba(16,185,129,.2)' : 'rgba(245,158,11,.1)',
              color: ativa ? '#60a5fa' : concl ? '#10b981' : '#f59e0b',
            }}>
              {ativa ? pick(T.statAtivo) : concl ? pick(T.statFeito) : pick(T.statPendente)}
            </div>
            <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 16 }}>›</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── FormCriarSlot ────────────────────────────────────────────────────────────

function FormCriarSlot({ cidade, pais, adminUid, zonas, workers, onSalvo, onCancelar }: {
  cidade: string; pais: string; adminUid: string;
  zonas: string[]; workers: any[];
  onSalvo: () => void; onCancelar: () => void;
}) {
  const { pick } = usePick();
  const [tipoSlot, setTipoSlot] = useState<TipoSlot>('scout');
  const [zona, setZona] = useState('');
  const [prioridade, setPrioridade] = useState<SlotPrioridade>('normal');
  const [turnoInicio, setTurnoInicio] = useState('');
  const [turnoFim, setTurnoFim] = useState('');
  const [descricao, setDescricao] = useState('');
  const [workerUid, setWorkerUid] = useState('');
  const [slaMin, setSlaMin] = useState(10);
  const [checkInFotoObrig, setCheckInFotoObrig] = useState(true);
  // Tarefas
  const [tarefas, setTarefas] = useState<Array<{
    titulo: string; qtdAlvo: number; estNome: string; estLat: string; estLng: string;
    estOrigemNome: string; patinetes: string;
  }>>([{ titulo: '', qtdAlvo: 1, estNome: '', estLat: '', estLng: '', estOrigemNome: '', patinetes: '' }]);

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const meta = TIPO_SLOT_META[tipoSlot];

  const addTarefa = () => setTarefas(t => [...t, { titulo: '', qtdAlvo: 1, estNome: '', estLat: '', estLng: '', estOrigemNome: '', patinetes: '' }]);
  const removeTarefa = (i: number) => setTarefas(t => t.filter((_, idx) => idx !== i));
  const updateTarefa = (i: number, k: string, v: any) => setTarefas(t => t.map((x, idx) => idx === i ? { ...x, [k]: v } : x));

  const salvar = async () => {
    if (!turnoInicio || !turnoFim) { setErro(pick(T.erroTurno)); return; }
    if (turnoInicio >= turnoFim) { setErro(pick(T.erroTurnoOrdem)); return; }
    for (const t of tarefas) {
      if (!t.titulo.trim()) { setErro(pick(T.erroTitulo)); return; }
    }
    setBusy(true); setErro('');
    try {
      const worker = workers.find(w => w.uid === workerUid);
      const slotData: any = {
        titulo: `${meta.icone} ${tipoSlot === 'scout' ? 'Scout' : 'Charger'} — ${zona || cidade}`,
        descricao: descricao.trim() || null,
        tipoSlot, tipoGeracao: 'manual' as TipoGeracao,
        prioridade, zona: zona || null,
        cargo: tipoSlot as CargoTipo,
        cidade, pais,
        turnoInicio, turnoFim,
        status: 'aberto' as SlotStatus,
        criadoPor: adminUid,
        aceitoPor: workerUid || null,
        aceitoPorNome: worker?.nome || null,
        aceitoEm: workerUid ? new Date().toISOString() : null,
        tarefasIds: [], tarefasTotal: tarefas.length, tarefasConcluidas: 0,
        slaAceiteMin: slaMin,
        checkInFotoObrigatoria: checkInFotoObrig,
        n8nDistribuido: false,
      };
      const now = new Date().toISOString();
      const slotId = await criarSlotSupa({
        titulo: slotData.titulo, tipo_slot: tipoSlot, tipo_geracao: 'manual', prioridade, cidade, pais,
        turno_inicio: turnoInicio, turno_fim: turnoFim, status: slotData.status,
        criado_por: slotData.criadoPor, aceito_por: slotData.aceitoPor ?? null,
        aceito_por_nome: slotData.aceitoPorNome ?? null, aceito_em: slotData.aceitoEm,
        tarefas_total: slotData.tarefasTotal, tarefas_concluidas: 0,
        sla_aceite_min: slaMin, check_in_foto_obrigatoria: slotData.checkInFotoObrigatoria,
        criado_em: now, atualizado_em: now,
      });

      const tarefaIds: string[] = [];
      for (let i = 0; i < tarefas.length; i++) {
        const t = tarefas[i];
        const patinetesLista: PatineteInfo[] = t.patinetes.trim()
          ? t.patinetes.split('\n').filter(Boolean).map((s, idx) => ({ id: `p${idx}`, identifier: s.trim(), lat: 0, lng: 0 }))
          : [];
        const tarefaData: any = {
          tipo: tipoSlot === 'scout' ? 'rebalanceamento' : 'troca_bateria',
          tipoSlot, status: 'pendente',
          prioridade: prioridade === 'urgente' ? 5 : prioridade === 'alta' ? 4 : 3,
          titulo: t.titulo.trim() || `${meta.l} #${i + 1}`,
          cargo: tipoSlot as CargoTipo,
          cidade, pais, slotId: slotId,
          assigneeUid: workerUid || null,
          assigneeNome: worker?.nome || null,
          qtdAlvo: t.qtdAlvo, qtdConcluida: 0,
          entregas: [], patineteSugeridas: patinetesLista,
          rotaOrdem: i,
          ...(t.estNome.trim() ? { estacao: { id: `est${i}`, nome: t.estNome.trim(), lat: parseFloat(t.estLat) || 0, lng: parseFloat(t.estLng) || 0 } } : {}),
          ...(tipoSlot === 'scout' && t.estOrigemNome.trim() ? { estacaoOrigem: { id: `orig${i}`, nome: t.estOrigemNome.trim(), lat: 0, lng: 0 } } : {}),
        };
        const tNow = new Date().toISOString();
        const tId = await criarTarefaSupa({
          tipo: tarefaData.tipo, tipo_slot: tipoSlot, status: 'pendente',
          prioridade: tarefaData.prioridade, titulo: tarefaData.titulo,
          cargo: tarefaData.cargo, cidade, pais, slot_id: slotId,
          assignee_uid: tarefaData.assigneeUid, assignee_nome: tarefaData.assigneeNome,
          qtd_alvo: tarefaData.qtdAlvo, qtd_concluida: 0, rota_ordem: tarefaData.rotaOrdem,
          criado_em: tNow, atualizado_em: tNow,
        });
        tarefaIds.push(tId);
      }

      await atualizarSlotSupa(slotId, { tarefas_ids: tarefaIds, atualizado_em: new Date().toISOString() });
      onSalvo();
    } catch (e: any) { setErro(e.message ?? pick(T.erroCriarSlot)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Tipo */}
      <div>
        <label style={S.lbl}>{pick(T.tipoSlot)}</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['scout', 'charger'] as TipoSlot[]).map(t => {
            const m = TIPO_SLOT_META[t];
            const sel = tipoSlot === t;
            return (
              <button key={t} onClick={() => setTipoSlot(t)} style={{
                padding: '12px', borderRadius: 9, border: `2px solid ${sel ? m.cor : 'rgba(255,255,255,.1)'}`,
                background: sel ? m.cor + '18' : 'rgba(255,255,255,.03)',
                color: sel ? m.cor : 'rgba(255,255,255,.4)',
                cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{ fontSize: 18, marginBottom: 3 }}>{m.icone}</div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{m.l}</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>{pick(t === 'scout' ? T.scoutDesc : T.chargerDesc)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Zona + Prioridade */}
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>{pick(T.zona)}</label>
          {zonas.length > 0 ? (
            <select value={zona} onChange={e => setZona(e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
              <option value="" style={{ background: '#0d1521' }}>{pick(T.selecione)}</option>
              {zonas.map(z => <option key={z} value={z} style={{ background: '#0d1521' }}>{z}</option>)}
            </select>
          ) : (
            <input style={S.inp} value={zona} onChange={e => setZona(e.target.value)} placeholder={pick(T.nomeZona)} />
          )}
        </div>
        <div>
          <label style={S.lbl}>{pick(T.prioridade)}</label>
          <select value={prioridade} onChange={e => setPrioridade(e.target.value as SlotPrioridade)} style={{ ...S.inp, colorScheme: 'dark' }}>
            {(['normal', 'alta', 'urgente'] as SlotPrioridade[]).map(p => (
              <option key={p} value={p} style={{ background: '#0d1521' }}>{pick(p === 'normal' ? T.prioNormal : p === 'alta' ? T.prioAlta : T.prioUrgente)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Turno */}
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>{pick(T.inicioTurno)}</label>
          <input type="datetime-local" style={S.inp} value={turnoInicio} onChange={e => setTurnoInicio(e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>{pick(T.fimTurno)}</label>
          <input type="datetime-local" style={S.inp} value={turnoFim} onChange={e => setTurnoFim(e.target.value)} />
        </div>
      </div>

      {/* Worker + SLA */}
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>{pick(T.atribuirWorker)}</label>
          <select value={workerUid} onChange={e => setWorkerUid(e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
            <option value="" style={{ background: '#0d1521' }}>{pick(T.deixarAberto)}</option>
            {workers.filter(w => w.cargoPrestador === tipoSlot || w.cargoPrestador === 'scalt').map(w => (
              <option key={w.uid} value={w.uid} style={{ background: '#0d1521' }}>{w.nome} ({w.cargoPrestador})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={S.lbl}>{pick(T.slaAceite)}</label>
          <select value={slaMin} onChange={e => setSlaMin(parseInt(e.target.value))} style={{ ...S.inp, colorScheme: 'dark' }}>
            {[5, 10, 15, 30].map(n => <option key={n} value={n} style={{ background: '#0d1521' }}>{n} {pick(T.min)}</option>)}
          </select>
        </div>
      </div>

      {/* Check-in foto obrigatória */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
        <input type="checkbox" id="checkInFoto" checked={checkInFotoObrig}
          onChange={e => setCheckInFotoObrig(e.target.checked)} style={{ accentColor: '#06b6d4' }} />
        <label htmlFor="checkInFoto" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', cursor: 'pointer' }}>
          {pick(T.fotoObrigCheckin)}
        </label>
      </div>

      {/* Descrição */}
      <div>
        <label style={S.lbl}>{pick(T.observacoes)}</label>
        <input style={S.inp} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder={pick(T.instrucoesOperador)} />
      </div>

      {/* Tarefas */}
      <div style={S.sep} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: meta.cor }}>{pick(T.tarefasSlot)} ({tarefas.length})</span>
        <button onClick={addTarefa} style={{ ...S.btn(meta.cor), padding: '5px 10px', fontSize: 11 }}>{pick(T.adicionar)}</button>
      </div>

      {tarefas.map((t, i) => (
        <div key={i} style={{ ...S.card, border: `1px solid ${meta.cor}20`, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: meta.cor, fontWeight: 700 }}>{pick(T.tarefaN)}{i + 1}</span>
            {tarefas.length > 1 && (
              <button onClick={() => removeTarefa(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>✕</button>
            )}
          </div>
          <div style={S.grid2}>
            <div>
              <label style={S.lbl}>{pick(T.titulo)}</label>
              <input style={S.inp} value={t.titulo} onChange={e => updateTarefa(i, 'titulo', e.target.value)}
                placeholder={tipoSlot === 'scout' ? pick(T.phEncherPonto) : pick(T.phTrocarBaterias)} />
            </div>
            <div>
              <label style={S.lbl}>{pick(T.qtdAlvo)}</label>
              <input type="number" min={1} max={50} style={S.inp} value={t.qtdAlvo}
                onChange={e => updateTarefa(i, 'qtdAlvo', parseInt(e.target.value) || 1)} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={S.lbl}>{pick(T.pontoDestino)}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6 }}>
              <input style={S.inp} value={t.estNome} onChange={e => updateTarefa(i, 'estNome', e.target.value)} placeholder={pick(T.nomePonto)} />
              <input style={S.inp} value={t.estLat} onChange={e => updateTarefa(i, 'estLat', e.target.value)} placeholder="Lat" />
              <input style={S.inp} value={t.estLng} onChange={e => updateTarefa(i, 'estLng', e.target.value)} placeholder="Lng" />
            </div>
          </div>
          {tipoSlot === 'scout' && (
            <div style={{ marginTop: 8 }}>
              <label style={S.lbl}>{pick(T.pontoOrigemColeta)}</label>
              <input style={S.inp} value={t.estOrigemNome} onChange={e => updateTarefa(i, 'estOrigemNome', e.target.value)} placeholder={pick(T.nomePontoOrigem)} />
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <label style={S.lbl}>{tipoSlot === 'charger' ? pick(T.patinetesIds) : pick(T.patinetesSugIds)}</label>
            <textarea value={t.patinetes} onChange={e => updateTarefa(i, 'patinetes', e.target.value)} rows={2}
              style={{ ...S.inp, resize: 'none' }} placeholder={`SC042\nSC017\nSC031`} />
          </div>
        </div>
      ))}

      {erro && <div style={{ color: '#ef4444', fontSize: 12 }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...S.btn(meta.cor), flex: 1 }} onClick={salvar} disabled={busy}>
          {busy ? pick(T.criando) : `${pick(T.criarSlot)}${meta.l}`}
        </button>
        <button style={S.btnGhost} onClick={onCancelar}>{pick(T.cancelar)}</button>
      </div>
    </div>
  );
}

// ─── SlotCard ─────────────────────────────────────────────────────────────────

function SlotCard({ slot, isAdmin, operadorUid, equipe, onAceitar, onCheckIn, onCheckOut, onCancelar, onReatribuir }: {
  slot: Slot; isAdmin: boolean; operadorUid?: string;
  equipe?: { uid: string; nome: string; cargoPrestador?: string }[];
  onAceitar: (s: Slot) => void; onCheckIn: (s: Slot) => void;
  onCheckOut: (s: Slot) => void; onCancelar: (s: Slot) => void;
  onReatribuir: (slot: Slot, novoUid: string, novoNome: string) => Promise<void>;
}) {
  const { pick } = usePick();
  const [expandido, setExpandido]     = useState(false);
  const [reatribuindo, setReatribuindo] = useState(false);
  const [novoWorker, setNovoWorker]   = useState('');
  const [checkInFoto, setCheckInFoto] = useState(false);
  const [fotoFile, setFotoFile]       = useState<File | null>(null);
  const [salvando, setSalvando]       = useState(false);

  const tipoSlot: TipoSlot = (slot.tipoSlot ?? (slot.cargo === 'charger' ? 'charger' : 'scout')) as TipoSlot;
  const meta = TIPO_SLOT_META[tipoSlot];
  const prio = PRIORIDADE_META[(slot.prioridade as SlotPrioridade) ?? 'normal'];

  // GPS do worker atribuído
  const workerGPS = useWorkerGPS(slot.aceitoPor ?? null);

  const podeAceitar  = !isAdmin && slot.status === 'aberto' && !slot.aceitoPor;
  const podeCheckIn  = !isAdmin && (slot.status === 'aceito' || slot.status === 'a_caminho') && slot.aceitoPor === operadorUid;
  const podeCheckOut = !isAdmin && slot.status === 'em_andamento' && slot.aceitoPor === operadorUid;
  const podeCancelarAdmin    = isAdmin && !['concluido', 'cancelado'].includes(slot.status);
  const podeCancelarWorker   = !isAdmin && slot.aceitoPor === operadorUid && ['aceito', 'a_caminho'].includes(slot.status);
  const podeCancelar         = podeCancelarAdmin || podeCancelarWorker;
  const podeReatribuir  = isAdmin && !['concluido', 'cancelado'].includes(slot.status);
  const fotoObrigatoria = !!(slot as any).checkInFotoObrigatoria;
  const pct = (slot.tarefasTotal ?? 0) > 0
    ? Math.round(((slot.tarefasConcluidas ?? 0) / (slot.tarefasTotal ?? 1)) * 100) : 0;

  const handleCheckIn = async () => {
    if (fotoObrigatoria && !checkInFoto) { setCheckInFoto(true); return; }
    setSalvando(true);
    try {
      let fotoUrl: string | null = null;
      if (fotoFile && slot.id) {
        fotoUrl = await uploadFoto(fotoFile, `slots/${slot.id}/checkin_${Date.now()}.jpg`);
        await updateCheckInFoto(slot.id!, fotoUrl);
      }
      onCheckIn(slot);
      setCheckInFoto(false); setFotoFile(null);
    } finally { setSalvando(false); }
  };

  const handleReatribuir = async () => {
    if (!novoWorker) return;
    const w = equipe?.find(e => e.uid === novoWorker);
    if (!w) return;
    setSalvando(true);
    try {
      await onReatribuir(slot, w.uid, w.nome);
      setReatribuindo(false); setNovoWorker('');
    } finally { setSalvando(false); }
  };

  return (
    <div style={{
      ...S.card,
      border: podeAceitar ? '1px solid rgba(16,185,129,.5)' : `1px solid ${meta.cor}30`,
      background: podeAceitar ? 'rgba(16,185,129,.06)' : `${meta.cor}06`,
      cursor: 'pointer',
    }}
      onClick={() => setExpandido(e => !e)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' as const }}>
            <span style={S.badge(meta.cor)}>{meta.icone} {meta.l}</span>
            <span style={S.badge(STATUS_SLOT_COR[slot.status] ?? '#6b7280')}>{STATUS_SLOT_TL[slot.status] ? pick(STATUS_SLOT_TL[slot.status]) : slot.status}</span>
            <span style={S.badge(prio.cor)}>{pick(PRIORIDADE_TL[(slot.prioridade as SlotPrioridade) ?? 'normal'] ?? T.prioNormal)}</span>
            {slot.tipoGeracao === 'automatico' && <span style={S.badge('#a78bfa')}>{pick(T.auto)}</span>}
            {slot.zona && <span style={S.badge('#6b7280')}>{slot.zona}</span>}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff', marginBottom: 2 }}>{slot.titulo}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
            <span>{fmtDt(slot.turnoInicio)} → {fmtDt(slot.turnoFim)}</span>
            {slot.aceitoPorNome && (
              <>
                <span>· {slot.aceitoPorNome}</span>
                {/* Badge GPS do worker */}
                {workerGPS && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700,
                    padding: '1px 5px', borderRadius: 4,
                    background: idadeLabel(workerGPS.idadeS).cor + '18',
                    color: idadeLabel(workerGPS.idadeS).cor,
                    border: `1px solid ${idadeLabel(workerGPS.idadeS).cor}30` }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: idadeLabel(workerGPS.idadeS).cor, flexShrink: 0 }} />
                    GPS {idadeLabel(workerGPS.idadeS, pick(T.atras)).txt}
                  </span>
                )}
                {!workerGPS && slot.status === 'em_andamento' && (
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(255,255,255,.08)' }}>{pick(T.gpsOffline)}</span>
                )}
              </>
            )}
          </div>
          {(slot.tarefasTotal ?? 0) > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: meta.cor, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>
                {slot.tarefasConcluidas ?? 0}/{slot.tarefasTotal}{pick(T.tarefasLbl)}
              </div>
            </div>
          )}
        </div>
        <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 16 }}>{expandido ? '▲' : '▼'}</span>
      </div>

      {expandido && (
        <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
          {slot.descricao && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 10 }}>{slot.descricao}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11, marginBottom: 12 }}>
            <div><div style={{ color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>{pick(T.checkIn)}</div><div>{fmtTs(slot.checkInEm)}</div></div>
            <div><div style={{ color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>{pick(T.checkOut)}</div><div>{fmtTs(slot.checkOutEm)}</div></div>
            <div><div style={{ color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>{pick(T.slaAceiteLbl)}</div><div>{slot.slaAceiteMin ?? 10} {pick(T.min)}</div></div>
          </div>

          {/* Foto obrigatória no check-in */}
          {podeCheckIn && checkInFoto && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginBottom: 8 }}>{pick(T.fotoCheckinObrig)}</div>
              <input type="file" accept="image/*" capture="environment"
                onClick={async (e) => {
                  if (isAndroidNative()) {
                    e.preventDefault(); // não abre o seletor de arquivo do WebView (HEIC)
                    let f: File | null = null;
                    try { f = await capturarFotoNativa(); } catch {}
                    if (f) { setFotoFile(f); return; } // mesma ação do onChange
                  }
                }}
                onChange={e => setFotoFile(e.target.files?.[0] ?? null)}
                style={{ fontSize: 11, color: '#dce8ff' }} />
              {fotoFile && <div style={{ fontSize: 10, color: '#10b981', marginTop: 4 }}>✓ {fotoFile.name}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button style={S.btn('#06b6d4')} disabled={!fotoFile || salvando} onClick={handleCheckIn}>
                  {salvando ? '⏳' : pick(T.confirmarCheckin)}
                </button>
                <button style={{ ...S.btnGhost }} onClick={() => { setCheckInFoto(false); setFotoFile(null); }}>{pick(T.cancelar)}</button>
              </div>
            </div>
          )}

          {/* Modal reatribuição */}
          {reatribuindo && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>{pick(T.reatribuirSlot)}</div>
              <select value={novoWorker} onChange={e => setNovoWorker(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 7, fontSize: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#dce8ff', colorScheme: 'dark' as any, marginBottom: 10 }}>
                <option value="">{pick(T.selecioneNovoWorker)}</option>
                {(equipe ?? []).filter(w => w.uid !== slot.aceitoPor).map(w => (
                  <option key={w.uid} value={w.uid}>{w.nome} ({w.cargoPrestador ?? 'field'})</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btn('#a78bfa')} disabled={!novoWorker || salvando} onClick={handleReatribuir}>
                  {salvando ? '⏳' : pick(T.confirmar)}
                </button>
                <button style={{ ...S.btnGhost }} onClick={() => { setReatribuindo(false); setNovoWorker(''); }}>{pick(T.cancelar)}</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
            {podeAceitar && <button style={S.btn('#10b981')} onClick={() => onAceitar(slot)}>{pick(T.aceitarSlotBtn)}</button>}
            {podeCheckIn && !checkInFoto && <button style={S.btn('#06b6d4')} onClick={handleCheckIn}>{pick(T.checkInBtn)}</button>}
            {podeCheckOut && <button style={S.btn('#a78bfa')} onClick={() => onCheckOut(slot)}>{pick(T.concluirSlot)}</button>}
            {podeReatribuir && !reatribuindo && (
              <button style={{ ...S.btnGhost, color: '#a78bfa', border: '1px solid rgba(167,139,250,.3)' }}
                onClick={() => setReatribuindo(true)}>{pick(T.reatribuir)}</button>
            )}
            {podeCancelar && (
              <button style={{ ...S.btnGhost, color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' }}
                onClick={() => onCancelar(slot)}>{pick(T.cancelar)}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ConfigAutoSlotsPanel ─────────────────────────────────────────────────────

const FAIXAS_PADRAO: FaixaHorario[] = [
  { id: 'pico_manha', nome: 'Pico manhã',  horaInicio: '07:00', horaFim: '09:00', ativo: true,  bikesAlvo: 12, bikesMinimo: 5, bikesMaximo: 16, prioridade: 'alta' },
  { id: 'manha',      nome: 'Manhã',       horaInicio: '09:00', horaFim: '12:00', ativo: true,  bikesAlvo: 8,  bikesMinimo: 3, bikesMaximo: 12, prioridade: 'normal' },
  { id: 'almoco',     nome: 'Almoço',      horaInicio: '12:00', horaFim: '14:00', ativo: true,  bikesAlvo: 10, bikesMinimo: 4, bikesMaximo: 14, prioridade: 'alta' },
  { id: 'tarde',      nome: 'Tarde',       horaInicio: '14:00', horaFim: '17:00', ativo: true,  bikesAlvo: 8,  bikesMinimo: 3, bikesMaximo: 12, prioridade: 'normal' },
  { id: 'pico_tarde', nome: 'Pico tarde',  horaInicio: '17:00', horaFim: '20:00', ativo: true,  bikesAlvo: 12, bikesMinimo: 5, bikesMaximo: 16, prioridade: 'urgente' },
  { id: 'noite',      nome: 'Noite',       horaInicio: '20:00', horaFim: '23:00', ativo: true,  bikesAlvo: 6,  bikesMinimo: 2, bikesMaximo: 10, prioridade: 'normal' },
  { id: 'madrugada',  nome: 'Madrugada',   horaInicio: '23:00', horaFim: '07:00', ativo: false, bikesAlvo: 4,  bikesMinimo: 1, bikesMaximo: 8,  prioridade: 'normal' },
];

function ConfigAutoSlotsPanel({ cidade, pais, adminUid, zonas }: {
  cidade: string; pais: string; adminUid: string; zonas: string[];
}) {
  const { pick } = usePick();
  const [configs, setConfigs] = useState<ConfigZonaAuto[]>([]);
  const [editando, setEditando] = useState<ConfigZonaAuto | null>(null);
  const [secao, setSecao] = useState<'geral' | 'faixas' | 'charger'>('geral');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [gerando, setGerando] = useState(false);
  const [atualizandoGoJet, setAtualizandoGoJet] = useState(false);
  const [logEntradas, setLogEntradas] = useState<any[]>([]);
  const [logMsg, setLogMsg] = useState('');
  const [novaZonaNome, setNovaZonaNome] = useState('');
  const [zonasManuais, setZonasManuais] = useState<string[]>([]);

  useEffect(() => {
    // Busca últimas 20 entradas do log_slots_auto para esta cidade
    fetchLogSlotsAuto(cidade).then(setLogEntradas).catch(() => {});
  }, [cidade]);

  const gerarAgora = async () => {
    setGerando(true); setLogMsg('');
    try {
      const res: any = await fnGerarSlotsManual()({ cidade });
      setLogMsg(pick(T.slotsGerados));
      // Recarrega log
      fetchLogSlotsAuto(cidade).then(setLogEntradas).catch(() => {});
    } catch (e: any) { setLogMsg(pick(T.erro) + (e.message ?? pick(T.falhaGeracao))); }
    finally { setGerando(false); }
  };

  const atualizarGoJet = async () => {
    setAtualizandoGoJet(true); setLogMsg('');
    try {
      await fnScraperGoJetManual()({ cidade });
      setLogMsg(pick(T.snapshotAtualizado));
    } catch (e: any) { setLogMsg(pick(T.erro) + (e.message ?? pick(T.falhaScraper))); }
    finally { setAtualizandoGoJet(false); }
  };

  useEffect(() => {
    buscarConfigZonas(cidade).then(c => { setConfigs(c); setLoading(false); });
  }, [cidade]);

  const abrirEdicao = (zonaNome: string) => {
    const existente = configs.find(c => c.zonaNome === zonaNome);
    setEditando(existente ?? {
      zonaId: zonaNome.toLowerCase().replace(/\s+/g, '_'),
      zonaNome, cidade, pais, ativo: true,
      scoutAtivo: true, bikesMinimo: 3, bikesAlvo: 8, bikesMaximo: 12, usarHistorico: false,
      incluirForaPonto: true,
      chargerAtivo: false, bateriaThreshold: 20, chargerMinimo: 2,
      qtdWorkers: 1,
      faixasHorario: FAIXAS_PADRAO,
      horarioAtivoInicio: '07:00', horarioAtivoFim: '23:00',
      intervaloChecagemMin: 15, slaAceiteMin: 10, autoAssign: true,
      sensibilidadeClima: 'moderada', notificarGestor: true,
    });
    setSecao('geral');
  };

  const salvar = async () => {
    if (!editando) return;
    setBusy(true); setMsg('');
    try {
      await salvarConfigZona({ ...editando, atualizadoPor: adminUid });
      const novas = await buscarConfigZonas(cidade);
      setConfigs(novas);
      setMsg(pick(T.configSalva));
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg(pick(T.erro) + e.message); }
    finally { setBusy(false); }
  };

  const upd = (k: keyof ConfigZonaAuto, v: any) =>
    setEditando(e => e ? { ...e, [k]: v } : e);

  const updFaixa = (idx: number, k: keyof FaixaHorario, v: any) =>
    setEditando(e => {
      if (!e) return e;
      const faixas = [...(e.faixasHorario ?? [])];
      faixas[idx] = { ...faixas[idx], [k]: v };
      return { ...e, faixasHorario: faixas };
    });

  const addFaixa = () =>
    setEditando(e => {
      if (!e) return e;
      const nova: FaixaHorario = {
        id: `faixa_${Date.now()}`, nome: pick(T.novaFaixa),
        horaInicio: '08:00', horaFim: '10:00', ativo: true,
        bikesAlvo: 8, bikesMinimo: 3, bikesMaximo: 12, prioridade: 'normal',
      };
      return { ...e, faixasHorario: [...(e.faixasHorario ?? []), nova] };
    });

  const removeFaixa = (idx: number) =>
    setEditando(e => {
      if (!e) return e;
      return { ...e, faixasHorario: (e.faixasHorario ?? []).filter((_, i) => i !== idx) };
    });

  const allZonas = Array.from(new Set([...zonas, ...configs.map(c => c.zonaNome), ...zonasManuais]));

  const adicionarZonaManual = () => {
    const nome = novaZonaNome.trim();
    if (!nome || allZonas.includes(nome)) return;
    setZonasManuais(prev => [...prev, nome]);
    setNovaZonaNome('');
    // Abre imediatamente o editor para a nova zona
    abrirEdicao(nome);
  };

  const PRIO_COR: Record<string, string> = { normal: '#6b7280', alta: '#f59e0b', urgente: '#ef4444' };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 14 }}>
        {pick(T.configIntro)}<strong style={{ color: 'rgba(255,255,255,.5)' }}>{pick(T.configIntroBold)}</strong>{pick(T.configIntroFim)}
      </div>

      {/* Grade de zonas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8, marginBottom: 16 }}>
        {allZonas.map(z => {
          const cfg = configs.find(c => c.zonaNome === z);
          const faixasAtivas = (cfg?.faixasHorario ?? []).filter(f => f.ativo).length;
          return (
            <button key={z} onClick={() => abrirEdicao(z)} style={{
              padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${cfg?.ativo ? 'rgba(167,139,250,.35)' : 'rgba(255,255,255,.08)'}`,
              background: cfg?.ativo ? 'rgba(167,139,250,.08)' : 'rgba(255,255,255,.03)',
              color: cfg?.ativo ? '#a78bfa' : 'rgba(255,255,255,.4)',
              cursor: 'pointer', textAlign: 'left' as const, fontSize: 12,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>{z}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                {cfg ? (cfg.ativo ? `${pick(T.cfgAtivo)}${cfg.intervaloChecagemMin}min` : pick(T.cfgInativo)) : pick(T.cfgNaoConfig)}
              </div>
              {cfg?.ativo && (
                <div style={{ fontSize: 9, marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {cfg.scoutAtivo && <span style={{ color: '#06b6d4' }}>🛴 {cfg.bikesMinimo}↔{cfg.bikesMaximo}</span>}
                  {cfg.chargerAtivo && <span style={{ color: '#10b981' }}>⚡ &lt;{cfg.bateriaThreshold}%</span>}
                  {faixasAtivas > 0 && <span style={{ color: '#a78bfa' }}>⏰ {faixasAtivas}{pick(T.faixasUn)}</span>}
                </div>
              )}
            </button>
          );
        })}
        {/* Botão + para adicionar nova zona diretamente */}
        <div style={{
          padding: '12px', borderRadius: 8, border: '1px dashed rgba(167,139,250,.25)',
          background: 'rgba(167,139,250,.03)', display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <input
            value={novaZonaNome}
            onChange={e => setNovaZonaNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionarZonaManual()}
            placeholder={pick(T.phNomeZona)}
            style={{ ...S.inp, flex: 1, margin: 0 }}
          />
          <button
            onClick={adicionarZonaManual}
            disabled={!novaZonaNome.trim()}
            style={{ ...S.btn('#a78bfa'), padding: '6px 14px', opacity: novaZonaNome.trim() ? 1 : 0.4 }}
          >
            {pick(T.zonaBtn)}
          </button>
        </div>
      </div>

      {/* Ações manuais */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
        <button style={{ ...S.btn('#a78bfa'), minWidth: 150 }} onClick={gerarAgora} disabled={gerando}>
          {gerando ? pick(T.gerando) : pick(T.gerarSlotsAgora)}
        </button>
        <button style={{ ...S.btn('#06b6d4'), minWidth: 150 }} onClick={atualizarGoJet} disabled={atualizandoGoJet}>
          {atualizandoGoJet ? pick(T.atualizando) : pick(T.atualizarGoJet)}
        </button>
        {logMsg && (
          <div style={{ fontSize: 11, color: logMsg.startsWith('✓') ? '#10b981' : '#ef4444', alignSelf: 'center' }}>
            {logMsg}
          </div>
        )}
      </div>

      {/* Log de decisões */}
      {logEntradas.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, maxHeight: 200, overflowY: 'auto' as const }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
            {pick(T.logDecisoes)}
          </div>
          {logEntradas.map(e => (
            <div key={e.id} style={{ fontSize: 10, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: e.slotCriado ? '#10b981' : 'rgba(255,255,255,.25)', minWidth: 10 }}>
                {e.slotCriado ? '✓' : '–'}
              </span>
              <span style={{ color: '#a78bfa', minWidth: 90 }}>{e.zona}</span>
              <span style={{ color: 'rgba(255,255,255,.5)' }}>{e.tipoSlot}</span>
              <span style={{ color: 'rgba(255,255,255,.35)', flex: 1 }}>{e.regraAplicada}</span>
              {e.motivo && <span style={{ color: 'rgba(255,255,255,.2)', fontStyle: 'italic' }}>{e.motivo}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {editando && (
        <div style={{ ...S.card, border: '1px solid rgba(167,139,250,.2)', background: 'rgba(167,139,250,.04)' }}>
          {/* Cabeçalho */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>⚙️ {editando.zonaNome}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={editando.ativo} onChange={e => upd('ativo', e.target.checked)} />
              <span style={{ fontSize: 11, color: editando.ativo ? '#a78bfa' : 'rgba(255,255,255,.35)', fontWeight: 600 }}>
                {editando.ativo ? pick(T.ativo) : pick(T.inativo)}
              </span>
            </label>
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {([['geral', T.padroes],['faixas', T.faixasHorario],['charger', T.chargerTab]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSecao(k)} style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: secao === k ? 'rgba(167,139,250,.2)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${secao === k ? 'rgba(167,139,250,.4)' : 'rgba(255,255,255,.08)'}`,
                color: secao === k ? '#a78bfa' : 'rgba(255,255,255,.4)',
              }}>{pick(l)}</button>
            ))}
          </div>

          {/* ── SEÇÃO GERAL ── */}
          {secao === 'geral' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Scout padrão */}
              <div style={{ padding: '12px', background: 'rgba(6,182,212,.05)', borderRadius: 8, border: '1px solid rgba(6,182,212,.15)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={editando.scoutAtivo} onChange={e => upd('scoutAtivo', e.target.checked)} />
                  <span style={{ fontSize: 12, color: '#06b6d4', fontWeight: 700 }}>{pick(T.scoutPadrao)}</span>
                </label>
                {editando.scoutAtivo && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        { k: 'bikesMinimo', l: T.minimo, tip: T.tipMinimo },
                        { k: 'bikesAlvo',   l: T.alvo,   tip: T.tipAlvo },
                        { k: 'bikesMaximo', l: T.maximo,  tip: T.tipMaximo },
                      ].map(f => (
                        <div key={f.k}>
                          <label style={S.lbl}>{pick(f.l)}</label>
                          <input type="number" min={0} style={S.inp} value={(editando as any)[f.k]}
                            onChange={e => upd(f.k as any, parseInt(e.target.value) || 0)} />
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{pick(f.tip)}</div>
                        </div>
                      ))}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 8, fontSize: 11 }}>
                      <input type="checkbox" checked={editando.usarHistorico} onChange={e => upd('usarHistorico', e.target.checked)} />
                      <span style={{ color: 'rgba(255,255,255,.45)' }}>{pick(T.ajustarHistorico)}</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 6, fontSize: 11 }}>
                      <input type="checkbox" checked={editando.incluirForaPonto ?? true} onChange={e => upd('incluirForaPonto', e.target.checked)} />
                      <span style={{ color: 'rgba(255,255,255,.45)' }}>{pick(T.incluirForaPonto)}</span>
                    </label>
                  </>
                )}
              </div>

              {/* Geral */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={S.lbl}>{pick(T.horarioGlobal)}</label>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input type="time" style={{ ...S.inp, flex: 1 }} value={editando.horarioAtivoInicio}
                      onChange={e => upd('horarioAtivoInicio', e.target.value)} />
                    <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>→</span>
                    <input type="time" style={{ ...S.inp, flex: 1 }} value={editando.horarioAtivoFim}
                      onChange={e => upd('horarioAtivoFim', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label style={S.lbl}>{pick(T.intervaloChecagem)}</label>
                  <select value={editando.intervaloChecagemMin} onChange={e => upd('intervaloChecagemMin', parseInt(e.target.value))} style={{ ...S.inp, colorScheme: 'dark' }}>
                    {[15, 30, 60].map(n => <option key={n} value={n} style={{ background: '#0d1521' }}>{n} {pick(T.min)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>{pick(T.slaAceiteLbl)}</label>
                  <select value={editando.slaAceiteMin} onChange={e => upd('slaAceiteMin', parseInt(e.target.value))} style={{ ...S.inp, colorScheme: 'dark' }}>
                    {[5, 10, 15, 30].map(n => <option key={n} value={n} style={{ background: '#0d1521' }}>{n} {pick(T.min)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>{pick(T.sensibilidadeClima)}</label>
                  <select value={editando.sensibilidadeClima} onChange={e => upd('sensibilidadeClima', e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
                    {([['ignorar', T.climaIgnorar],['moderada', T.climaModerada],['alta', T.climaAlta]] as const).map(([v,l]) => (
                      <option key={v} value={v} style={{ background: '#0d1521' }}>{pick(l)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Workers por slot */}
              <div style={{ padding: '10px 12px', background: 'rgba(167,139,250,.04)', borderRadius: 8, border: '1px solid rgba(167,139,250,.12)' }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, marginBottom: 8 }}>{pick(T.workersPorSlot)}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'center' }}>
                  <div>
                    <label style={S.lbl}>{pick(T.quantidade)}</label>
                    <input type="number" min={1} max={10} style={S.inp}
                      value={editando.qtdWorkers ?? 1}
                      onChange={e => upd('qtdWorkers', Math.max(1, parseInt(e.target.value) || 1))} />
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', lineHeight: 1.5 }}>
                    {pick(T.workersDesc)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11 }}>
                  <input type="checkbox" checked={editando.autoAssign} onChange={e => upd('autoAssign', e.target.checked)} />
                  <span style={{ color: 'rgba(255,255,255,.45)' }}>{pick(T.autoAtribuir)}</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11 }}>
                  <input type="checkbox" checked={editando.notificarGestor} onChange={e => upd('notificarGestor', e.target.checked)} />
                  <span style={{ color: 'rgba(255,255,255,.45)' }}>{pick(T.notificarGestor)}</span>
                </label>
              </div>
            </div>
          )}

          {/* ── SEÇÃO FAIXAS DE HORÁRIO ── */}
          {secao === 'faixas' && (
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 12 }}>
                {pick(T.faixasIntro)}<strong style={{ color: 'rgba(255,255,255,.5)' }}>{pick(T.faixasIntroBold)}</strong>{pick(T.faixasIntroFim)}
              </div>

              {/* Visualização de linha do tempo */}
              <div style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.06)' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {pick(T.linhaTempo)}
                </div>
                <div style={{ position: 'relative', height: 28, background: 'rgba(255,255,255,.04)', borderRadius: 5, overflow: 'hidden' }}>
                  {(editando.faixasHorario ?? []).filter(f => f.ativo).map(f => {
                    const toMin = (hhmm: string) => {
                      const [h, m] = hhmm.split(':').map(Number);
                      return h * 60 + (m || 0);
                    };
                    const base = toMin('07:00'), range = toMin('23:00') - base;
                    let start = toMin(f.horaInicio), end = toMin(f.horaFim);
                    if (end <= start) end += 24 * 60;
                    const left = Math.max(0, ((start - base) / range) * 100);
                    const width = Math.min(100 - left, ((end - start) / range) * 100);
                    const cor = PRIO_COR[f.prioridade ?? 'normal'];
                    return (
                      <div key={f.id} title={`${f.nome} ${f.horaInicio}–${f.horaFim}`} style={{
                        position: 'absolute', top: 2, height: 'calc(100% - 4px)',
                        left: `${left}%`, width: `${width}%`,
                        background: cor + '50', border: `1px solid ${cor}80`,
                        borderRadius: 3, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 8, color: cor, overflow: 'hidden',
                        whiteSpace: 'nowrap', fontWeight: 700,
                      }}>{f.nome}</div>
                    );
                  })}
                  {/* Hora labels */}
                  {['07h','09h','12h','15h','17h','20h','23h'].map((l, i) => (
                    <div key={l} style={{
                      position: 'absolute', bottom: -14, fontSize: 8,
                      color: 'rgba(255,255,255,.25)',
                      left: `${(i / 6) * 100}%`, transform: 'translateX(-50%)',
                    }}>{l}</div>
                  ))}
                </div>
                <div style={{ height: 16 }} />
              </div>

              {/* Lista de faixas */}
              {(editando.faixasHorario ?? []).map((f, idx) => {
                const cor = PRIO_COR[f.prioridade ?? 'normal'];
                return (
                  <div key={f.id} style={{
                    marginBottom: 10, padding: '12px', borderRadius: 9,
                    background: f.ativo ? `${cor}08` : 'rgba(255,255,255,.02)',
                    border: `1px solid ${f.ativo ? cor + '25' : 'rgba(255,255,255,.06)'}`,
                  }}>
                    {/* Header faixa */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: f.ativo ? 10 : 0 }}>
                      <input type="checkbox" checked={f.ativo} onChange={e => updFaixa(idx, 'ativo', e.target.checked)} />
                      <input value={f.nome} onChange={e => updFaixa(idx, 'nome', e.target.value)}
                        style={{ ...S.inp, flex: 1, fontSize: 12, fontWeight: 700, padding: '5px 8px' }} />
                      <input type="time" value={f.horaInicio} onChange={e => updFaixa(idx, 'horaInicio', e.target.value)}
                        style={{ ...S.inp, width: 82, fontSize: 11, padding: '5px 8px' }} />
                      <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>→</span>
                      <input type="time" value={f.horaFim} onChange={e => updFaixa(idx, 'horaFim', e.target.value)}
                        style={{ ...S.inp, width: 82, fontSize: 11, padding: '5px 8px' }} />
                      <button onClick={() => removeFaixa(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
                    </div>

                    {f.ativo && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 7 }}>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>{pick(T.minimoBike)}</label>
                          <input type="number" min={0} value={f.bikesMinimo ?? ''} placeholder={pick(T.padraoPh)}
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bikesMinimo', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>{pick(T.alvoBike)}</label>
                          <input type="number" min={0} value={f.bikesAlvo ?? ''} placeholder={pick(T.padraoPh)}
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bikesAlvo', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>{pick(T.maximoBike)}</label>
                          <input type="number" min={0} value={f.bikesMaximo ?? ''} placeholder={pick(T.padraoPh)}
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bikesMaximo', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>{pick(T.batFaixa)}</label>
                          <input type="number" min={0} max={100} value={f.bateriaThreshold ?? ''} placeholder={pick(T.padraoPh)}
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bateriaThreshold', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>{pick(T.prioridade)}</label>
                          <select value={f.prioridade ?? 'normal'} onChange={e => updFaixa(idx, 'prioridade', e.target.value)}
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px', colorScheme: 'dark', color: cor }}>
                            {([['normal', T.prioNormal],['alta', T.prioAlta],['urgente', T.prioUrgente]] as const).map(([v,l]) => (
                              <option key={v} value={v} style={{ background: '#0d1521', color: PRIO_COR[v] }}>{pick(l)}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={addFaixa} style={{ ...S.btnGhost, width: '100%', marginTop: 4 }}>
                {pick(T.addFaixa)}
              </button>

              <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 7, fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                {pick(T.dicaFaixas)}
              </div>
            </div>
          )}

          {/* ── SEÇÃO CHARGER ── */}
          {secao === 'charger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ padding: '12px', background: 'rgba(16,185,129,.05)', borderRadius: 8, border: '1px solid rgba(16,185,129,.15)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={editando.chargerAtivo} onChange={e => upd('chargerAtivo', e.target.checked)} />
                  <span style={{ fontSize: 12, color: '#10b981', fontWeight: 700 }}>{pick(T.chargerAtivo)}</span>
                </label>
                {editando.chargerAtivo && (
                  <div style={S.grid2}>
                    <div>
                      <label style={S.lbl}>{pick(T.thresholdBat)}</label>
                      <input type="number" min={1} max={100} style={S.inp} value={editando.bateriaThreshold}
                        onChange={e => upd('bateriaThreshold', parseInt(e.target.value) || 20)} />
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', marginTop: 2 }}>
                        {pick(T.thresholdDesc)}
                      </div>
                    </div>
                    <div>
                      <label style={S.lbl}>{pick(T.minimoGerarSlot)}</label>
                      <input type="number" min={1} style={S.inp} value={editando.chargerMinimo}
                        onChange={e => upd('chargerMinimo', parseInt(e.target.value) || 1)} />
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', marginTop: 2 }}>
                        {pick(T.minimoDesc)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {editando.chargerAtivo && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', padding: '8px 10px', background: 'rgba(255,255,255,.02)', borderRadius: 7, border: '1px solid rgba(255,255,255,.06)' }}>
                  {pick(T.dicaChargerFaixa)}<strong style={{ color: '#a78bfa' }}>{pick(T.faixasHorarioPlain)}</strong>{pick(T.dicaChargerFaixaFim)}
                </div>
              )}
            </div>
          )}

          {msg && <div style={{ color: msg.startsWith('✓') ? '#10b981' : '#ef4444', fontSize: 12, marginTop: 12 }}>{msg}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...S.btn('#a78bfa'), flex: 1 }} onClick={salvar} disabled={busy}>
              {busy ? pick(T.salvando) : pick(T.salvarConfig)}
            </button>
            <button style={S.btnGhost} onClick={() => setEditando(null)}>{pick(T.fechar)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FormOcorrencia ───────────────────────────────────────────────────────────

function FormOcorrencia({ usuario, cidade, pais, onSalvo, onCancelar }: {
  usuario: any; cidade: string; pais: string;
  onSalvo: () => void; onCancelar: () => void;
}) {
  const { pick } = usePick();
  const [tipo, setTipo] = useState<OcorrenciaTipo>('vandalismo');
  const [desc, setDesc] = useState('');
  const [procurando, setProcurando] = useState(false);
  const [patineteId, setPatineteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const ehRoubo = tipo === 'roubo';

  const salvar = async () => {
    if (!desc.trim()) { setErro(pick(T.erroDescOcorr)); return; }
    setBusy(true); setErro('');
    try {
      const novaOc = {
        tipo, descricao: desc.trim(), status: 'aberta',
        registradoPor: usuario.uid, registradoPorNome: usuario.nome,
        cargo: usuario.cargoPrestador ?? usuario.role,
        cidade, pais, procurando: ehRoubo ? procurando : false,
        patineteId: patineteId.trim() || null, telegramEnviado: false,
        criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
      };
      await criarOcorrenciaSupabase(crypto.randomUUID(), { ...novaOc, asset_id: patineteId.trim() || null });
      onSalvo();
    } catch (e: any) { setErro(e.message ?? pick(T.erroRegistrar)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={S.lbl}>{pick(T.tipoOcorrencia)}</label>
        <select value={tipo} onChange={e => setTipo(e.target.value as OcorrenciaTipo)} style={{ ...S.inp, colorScheme: 'dark' }}>
          {OCORRENCIAS_TIPOS.map(o => <option key={o.k} value={o.k} style={{ background: '#0d1521' }}>{pick(OCORRENCIA_TL[o.k] ?? { pt: o.l, en: o.l, es: o.l, ru: o.l })}</option>)}
        </select>
      </div>
      {ehRoubo && (
        <div style={{ padding: 10, borderRadius: 8, background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)' }}>
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700, marginBottom: 8 }}>{pick(T.rouboDetectado)}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={procurando} onChange={e => setProcurando(e.target.checked)} />
            <span style={{ color: procurando ? '#ef4444' : 'rgba(255,255,255,.5)' }}>
              {procurando ? pick(T.procurandoPatinete) : pick(T.marcarProcurando)}
            </span>
          </label>
          <div style={{ marginTop: 8 }}>
            <label style={S.lbl}>{pick(T.idPatinete)}</label>
            <input style={S.inp} value={patineteId} onChange={e => setPatineteId(e.target.value)} placeholder={pick(T.phIdPatinete)} />
          </div>
        </div>
      )}
      <div>
        <label style={S.lbl}>{pick(T.descricao)}</label>
        <textarea style={{ ...S.inp, resize: 'vertical' as const, minHeight: 70 }}
          value={desc} onChange={e => setDesc(e.target.value)}
          placeholder={pick(T.phDescOcorr)} />
      </div>
      {erro && <div style={{ color: '#ef4444', fontSize: 12 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={S.btn(ehRoubo ? '#ef4444' : '#f97316')} onClick={salvar} disabled={busy}>
          {busy ? pick(T.registrando) : pick(T.registrarOcorr)}
        </button>
        <button style={S.btnGhost} onClick={onCancelar}>{pick(T.cancelar)}</button>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

interface Props {
  usuario: {
    uid: string; nome: string; email: string; role: string;
    cargoPrestador?: string; tipoCadastro?: string; cidade?: string;
  };
  cidade: string; pais: string; onFechar: () => void;
}

type Aba = 'resumo' | 'slots' | 'tarefas' | 'ocorrencias' | 'equipe' | 'config_auto' | 'historico';

// ─── HistoricoSlotsPanel ──────────────────────────────────────────────────────

function HistoricoSlotsPanel({ slots, tarefas }: { slots: Slot[]; tarefas: Tarefa[] }) {
  const { pick } = usePick();
  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo]   = useState<string>('todos');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');

  const filtrados = slots.filter(s => {
    if (filtroTipo   !== 'todos' && s.tipoSlot !== filtroTipo)   return false;
    if (filtroStatus !== 'todos' && s.status   !== filtroStatus) return false;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      return (s.titulo ?? '').toLowerCase().includes(q)
          || (s.aceitoPorNome ?? '').toLowerCase().includes(q)
          || (s.zona ?? '').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    const ta = (a.criadoEm as any)?.seconds ?? 0;
    const tb = (b.criadoEm as any)?.seconds ?? 0;
    return tb - ta;
  });

  const exportCSV = () => {
    const bom = '﻿';
    const header = [pick(T.csvId),pick(T.thTipo),pick(T.thStatus),pick(T.thTitulo),pick(T.zona),pick(T.thWorker),pick(T.csvCriadoEm),pick(T.csvCheckIn),pick(T.csvCheckOut),pick(T.csvTarefas),pick(T.csvConcluidas)];
    const rows = filtrados.map(s => [
      s.id ?? '',
      s.tipoSlot ?? '',
      s.status ?? '',
      `"${(s.titulo ?? '').replace(/"/g, '""')}"`,
      s.zona ?? '',
      s.aceitoPorNome ?? '',
      fmtTs(s.criadoEm),
      fmtTs(s.checkInEm),
      fmtTs(s.checkOutEm),
      String(s.tarefasTotal ?? 0),
      String(s.tarefasConcluidas ?? 0),
    ]);
    const csv = bom + [header, ...rows].map(r => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `slots_historico_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const inpS: React.CSSProperties = { padding: '7px 10px', borderRadius: 7, fontSize: 11, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: '#dce8ff', colorScheme: 'dark' as any };

  return (
    <div style={{ padding: 12 }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 12 }}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={pick(T.buscarHist)} style={{ ...inpS, flex: 1, minWidth: 160 }} />
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inpS}>
          <option value="todos">{pick(T.todosTipos)}</option>
          <option value="scout">Scout</option>
          <option value="charger">Charger</option>
        </select>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={inpS}>
          <option value="todos">{pick(T.todosStatus)}</option>
          <option value="aberto">{pick(T.stAberto)}</option>
          <option value="em_andamento">{pick(T.stEmAndamento)}</option>
          <option value="concluido">{pick(T.stConcluido)}</option>
          <option value="cancelado">{pick(T.stCancelado)}</option>
        </select>
        <button onClick={exportCSV} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.3)', color: '#10b981' }}>
          {pick(T.exportCsv)} ({filtrados.length})
        </button>
      </div>

      {/* Tabela */}
      <div style={{ overflowX: 'auto' as const }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              {[T.thTipo, T.thStatus, T.thTitulo, T.thWorker, T.thTurno, T.thProgresso].map((h, hi) => (
                <th key={hi} style={{ textAlign: 'left', padding: '6px 8px', color: 'rgba(255,255,255,.35)', fontWeight: 600 }}>{pick(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 200).map(s => {
              const meta = TIPO_SLOT_META[(s.tipoSlot ?? 'scout') as TipoSlot];
              const corStatus = STATUS_SLOT_COR[s.status] ?? '#6b7280';
              const pct = s.tarefasTotal ? Math.round(((s.tarefasConcluidas ?? 0) / s.tarefasTotal) * 100) : null;
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)') as any}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent') as any}>
                  <td style={{ padding: '7px 8px' }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: meta.cor + '20', color: meta.cor, fontWeight: 700 }}>{meta.icone} {meta.l}</span></td>
                  <td style={{ padding: '7px 8px' }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: corStatus + '20', color: corStatus, fontWeight: 700 }}>{STATUS_SLOT_TL[s.status] ? pick(STATUS_SLOT_TL[s.status]) : s.status}</span></td>
                  <td style={{ padding: '7px 8px', color: '#dce8ff', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.titulo}</td>
                  <td style={{ padding: '7px 8px', color: 'rgba(255,255,255,.5)' }}>{s.aceitoPorNome ?? '—'}</td>
                  <td style={{ padding: '7px 8px', color: 'rgba(255,255,255,.35)', whiteSpace: 'nowrap' as const }}>{fmtDt(s.turnoInicio)}</td>
                  <td style={{ padding: '7px 8px' }}>
                    {pct != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 50, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : meta.cor, borderRadius: 2 }} />
                        </div>
                        <span style={{ color: 'rgba(255,255,255,.4)' }}>{s.tarefasConcluidas}/{s.tarefasTotal}</span>
                      </div>
                    ) : <span style={{ color: 'rgba(255,255,255,.2)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtrados.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,.3)', fontSize: 12 }}>{pick(T.nenhumSlot)}</div>}
        {filtrados.length > 200 && <div style={{ textAlign: 'center', padding: 8, color: 'rgba(255,255,255,.25)', fontSize: 10 }}>{pick(T.exibindo)}{filtrados.length}{pick(T.refineFiltros)}</div>}
      </div>
    </div>
  );
}

export default function SlotsModule({ usuario, cidade, pais, onFechar }: Props) {
  const { pick } = usePick();
  const isAdmin     = ['admin', 'gestor', 'gestor_log', 'logistica', 'supergestor'].includes(usuario.role);
  const isLogistica = usuario.tipoCadastro === 'prestador' && ['charger', 'scalt', 'scout'].includes(usuario.cargoPrestador ?? '');

  const [aba, setAba]                 = useState<Aba>(isAdmin ? 'slots' : 'tarefas');
  const [slots, setSlots]             = useState<Slot[]>([]);
  const [tarefas, setTarefas]         = useState<Tarefa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [equipe, setEquipe]           = useState<any[]>([]);
  const [zonas, setZonas]             = useState<string[]>([]);
  // GPS+bateria da equipe em tempo real — só assina quando a aba Equipe está aberta.
  const equipeGPS = useSlotsWorkersGPS(aba === 'equipe' ? equipe.map(u => u.id) : []);
  const [loading, setLoading]         = useState(true);
  const [gpsStats, setGpsStats]       = useState<TrackingStats | null>(null);
  const [slotAtivo, setSlotAtivo]     = useState<Slot | null>(null);

  // Sub-views
  const [criandoSlot,  setCriandoSlot]  = useState(false);
  const [criandoOcorr, setCriandoOcorr] = useState(false);
  const [tarefaDetalhe, setTarefaDetalhe] = useState<Tarefa | null>(null);
  const [filtroStatus, setFiltroStatus]   = useState<string>(isAdmin ? 'ativos' : 'disponiveis');

  // Carregar zonas disponíveis
  useEffect(() => {
    fetchPoligonos(cidade).then(setZonas).catch(() => {});
  }, [cidade]);

  // ── Slots realtime ──
  useEffect(() => {
    if (aba !== 'slots') return;
    setLoading(true);
    return subscribeSlots(
      { cidade, isAdmin, cargo: usuario.cargoPrestador },
      s => { setSlots(s as Slot[]); setLoading(false); },
    );
  }, [aba, cidade, pais, isAdmin, usuario.cargoPrestador]);

  // ── Tarefas realtime ──
  useEffect(() => {
    if (aba !== 'tarefas') return;
    setLoading(true);
    return subscribeTarefas(
      { cidade, pais, isAdmin, uid: usuario.uid },
      t => { setTarefas(t as Tarefa[]); setLoading(false); },
    );
  }, [aba, cidade, pais, isAdmin, usuario.uid]);

  // ── Ocorrências realtime ──
  useEffect(() => {
    if (aba !== 'ocorrencias') return;
    setLoading(true);
    let vivo = true;
    carregarOcorrenciasSupabase({ cidade, limit: 5000 })
      .then(rows => { if (vivo) { setOcorrencias(rows as Ocorrencia[]); setLoading(false); } })
      .catch(err => { console.error('[slots-ocor] Supabase', err); if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [aba, cidade]);

  // ── Equipe — carrega sempre que admin abre o módulo (necessário para dropdown de reatribuição) ──
  useEffect(() => {
    if (!isAdmin) return;
    fetchUsuarios({ tipoCadastro: 'prestador', statusPrestador: 'ativo', cidade })
      .then(users => { setEquipe(users.map(u => ({ ...u, id: u.uid }))); });
  }, [isAdmin, cidade]);

  // ── Handlers ──
  const aceitarSlot = useCallback(async (slot: Slot) => {
    if (!slot.id) return;
    await aceitarSlotSupa(slot.id);
  }, []);

  const checkIn = useCallback(async (slot: Slot) => {
    if (!slot.id) return;
    const pos = await capturarPosicaoUnica().catch(() => null);
    await checkInSlotSupa(slot.id, pos?.lat, pos?.lng, pos?.accuracy);
    setSlotAtivo(slot);
    await gpsBackground.iniciar({
      uid: usuario.uid, slotId: slot.id,
      onPosicao: () => {}, onStats: setGpsStats, onErro: msg => console.warn('[GPS]', msg),
    });
  }, [usuario]);

  const checkOut = useCallback(async (slot: Slot) => {
    if (!slot.id) return;
    await gpsBackground.parar();
    setSlotAtivo(null); setGpsStats(null);
    await checkOutSlotSupa(slot.id);
  }, [usuario.uid]);

  const cancelarSlot = useCallback(async (slot: Slot) => {
    if (!slot.id || !window.confirm(pick(T.confirmarCancelSlot))) return;
    await cancelarSlotSupa(slot.id);
  }, []);

  const reatribuirSlot = useCallback(async (slot: Slot, novoUid: string, novoNome: string) => {
    if (!slot.id) return;
    await reatribuirSlotSupa(slot.id, novoUid);
    // Notificar novo worker via push + Telegram
    try {
      await fnNotificarTarefa()({
        tarefaTitulo: slot.titulo,
        assigneeUid: novoUid,
        cidade: slot.cidade,
        fcmToken: null,
        mensagem: `${pick(T.notificadoSlot)}${slot.titulo}`,
      });
    } catch { /* notificação best-effort */ }
  }, []);

  const atualizarTarefa = useCallback(async (id: string, status: string, extra?: Partial<Tarefa>) => {
    // Convert camelCase keys to snake_case for Supabase, skip complex nested objects
    const snakeExtra: Record<string, any> = {};
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (['slotId','entregas','patineteSugeridas','estacao','estacaoOrigem'].includes(k)) continue;
      const snakeKey = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      snakeExtra[snakeKey] = v;
    }
    await atualizarTarefaSupa(id, { status, ...snakeExtra, atualizado_em: new Date().toISOString() });
    // Se concluída, atualiza contagem no slot via Supabase
    if (status === 'concluida' && extra?.slotId) {
      const { data: slotRow } = await supabase.from('slots').select('tarefas_concluidas').eq('id', extra.slotId as string).single();
      if (slotRow) {
        const novasConcluidas = (slotRow.tarefas_concluidas ?? 0) + 1;
        await atualizarSlotSupa(extra.slotId as string, { tarefas_concluidas: novasConcluidas, atualizado_em: new Date().toISOString() }).catch(() => {});
      }
    }
  }, []);

  // Filtro de slots
  const slotsFiltrados = slots.filter(s => {
    if (filtroStatus === 'ativos') return !['concluido', 'cancelado'].includes(s.status);
    if (filtroStatus === 'concluidos') return s.status === 'concluido';
    if (filtroStatus === 'automatico') return s.tipoGeracao === 'automatico';
    if (filtroStatus === 'disponiveis') return s.status === 'aberto';
    if (filtroStatus === 'meus') return s.aceitoPor === usuario.uid;
    return true;
  });

  // Badges
  const slotAbertos      = slots.filter(s => s.status === 'aberto').length;
  const tarefasPendentes = tarefas.filter(t => t.status === 'pendente' || t.status === 'em_andamento').length;
  const ocorrAbertas     = ocorrencias.filter(o => o.status === 'aberta').length;

  const abas: { k: Aba; l: string; acesso: boolean; badge?: number }[] = [
    { k: 'resumo',      l: '📋 Resumo',             acesso: isAdmin },
    { k: 'slots',       l: pick(T.abaSlots),       acesso: true,     badge: slotAbertos },
    { k: 'tarefas',     l: pick(T.abaTarefas),     acesso: true,     badge: tarefasPendentes },
    { k: 'ocorrencias', l: pick(T.abaOcorrencias), acesso: true,     badge: ocorrAbertas },
    { k: 'equipe',      l: pick(T.abaEquipe),       acesso: isAdmin },
    { k: 'config_auto', l: pick(T.abaAutoSlots),    acesso: isAdmin },
    { k: 'historico',   l: pick(T.abaHistorico),    acesso: isAdmin },
  ];

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={S.modal}>

        {/* HEADER */}
        <div style={S.header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#10b981' }}>
              {pick(T.slotsLogistica)}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
              {cidade} · {pais} · {isAdmin ? pick(T.adminGestor) : usuario.cargoPrestador ?? usuario.role}
            </div>
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        {/* GPS STATUS — banner proeminente se sem sinal, sutil se ok */}
        {gpsStats && gpsStats.ultimoErro ? (
          <div style={{
            padding: '10px 14px', flexShrink: 0,
            background: 'rgba(239,68,68,.18)',
            borderBottom: '1px solid rgba(239,68,68,.35)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>📵</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#fca5a5' }}>{pick(T.gpsSemSinal)}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
                {pick(T.ativeLocalizacao)}
              </div>
            </div>
          </div>
        ) : gpsStats ? (
          <div style={{
            padding: '6px 14px', flexShrink: 0,
            background: 'rgba(16,185,129,.08)',
            borderBottom: '1px solid rgba(16,185,129,.15)',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 10,
          }}>
            <span style={{ color: '#10b981' }}>📡</span>
            <span style={{ color: 'rgba(255,255,255,.6)', flex: 1 }}>{pick(T.gpsLabel)}{gpsStats.estrategia}</span>
            {/* No serviço nativo o upload roda fora do JS — o contador "pts" não atualiza.
                Mostra "rastreando em 2º plano" para não confundir o operador (ver DEBRIEF §8). */}
            {gpsStats.estrategia.toLowerCase().includes('nativo') ? (
              <span style={{ color: 'rgba(255,255,255,.4)' }}>{pick(T.rastreando2Plano)}</span>
            ) : (
              <span style={{ color: 'rgba(255,255,255,.4)' }}>{gpsStats.pontoEnviados}{pick(T.pts)}</span>
            )}
            {gpsStats.filaOffline > 0 && <span style={{ color: '#f59e0b' }}>{gpsStats.filaOffline}{pick(T.offlineLbl)}</span>}
          </div>
        ) : null}

        {/* ABAS */}
        <div style={S.tabBar}>
          {abas.filter(a => a.acesso).map(a => {
            const ativo = aba === a.k;
            return (
              <button key={a.k} onClick={() => { setAba(a.k); setCriandoSlot(false); setCriandoOcorr(false); setTarefaDetalhe(null); }} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                background: ativo ? 'rgba(16,185,129,.18)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${ativo ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.08)'}`,
                color: ativo ? '#10b981' : 'rgba(255,255,255,.4)', cursor: 'pointer',
              }}>
                {a.l}
                {(a.badge ?? 0) > 0 && (
                  <span style={{ marginLeft: 5, background: '#10b981', color: '#0d1521', borderRadius: 10, padding: '1px 5px', fontSize: 9, fontWeight: 800 }}>
                    {a.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* BODY */}
        <div style={S.body}>

          {/* ── ABA SLOTS ── */}
          {aba === 'slots' && (
            <div>
              {criandoSlot ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 12 }}>{pick(T.novoSlot)}</div>
                  <FormCriarSlot
                    cidade={cidade} pais={pais} adminUid={usuario.uid}
                    zonas={zonas} workers={equipe.length > 0 ? equipe : []}
                    onSalvo={() => setCriandoSlot(false)}
                    onCancelar={() => setCriandoSlot(false)}
                  />
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                    {isAdmin && (
                      <button style={S.btn('#10b981')} onClick={() => setCriandoSlot(true)}>{pick(T.novoSlot)}</button>
                    )}
                    {(isAdmin
                      ? ['ativos', 'concluidos', 'automatico', 'todos']
                      : ['disponiveis', 'meus', 'ativos', 'todos']
                    ).map(f => (
                      <button key={f} onClick={() => setFiltroStatus(f)} style={{
                        padding: '6px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: filtroStatus === f ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${filtroStatus === f ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.08)'}`,
                        color: filtroStatus === f ? '#10b981' : 'rgba(255,255,255,.4)', cursor: 'pointer',
                      }}>
                        {f === 'ativos' ? pick(T.filtroAtivos) : f === 'concluidos' ? pick(T.filtroConcluidos) : f === 'automatico' ? pick(T.filtroAuto) : f === 'disponiveis' ? '🟢 Disponíveis' : f === 'meus' ? '👤 Meus' : pick(T.filtroTodos)}
                      </button>
                    ))}
                  </div>

                  {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ {pick(T.carregando)}</div>}
                  {!loading && slotsFiltrados.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>
                      {isAdmin ? pick(T.nenhumSlotAdmin) : pick(T.nenhumSlotWorker)}
                    </div>
                  )}
                  {slotsFiltrados.map(s => (
                    <SlotCard key={s.id} slot={s} isAdmin={isAdmin} operadorUid={usuario.uid}
                      equipe={equipe as any}
                      onAceitar={aceitarSlot} onCheckIn={checkIn} onCheckOut={checkOut}
                      onCancelar={cancelarSlot} onReatribuir={reatribuirSlot} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── ABA TAREFAS ── */}
          {aba === 'tarefas' && (
            <div>
              {isLogistica && !isAdmin && tarefaDetalhe ? (
                <TarefaDetalheView
                  tarefa={tarefaDetalhe}
                  slotTipoSlot={slotAtivo?.tipoSlot}
                  workerUid={usuario.uid}
                  onVoltar={() => setTarefaDetalhe(null)}
                  onAtualizar={async (status, extra) => {
                    await atualizarTarefa(tarefaDetalhe.id!, status, { ...extra, slotId: tarefaDetalhe.slotId });
                    // Recarregar a tarefa atualizada do estado
                    setTarefaDetalhe(prev => prev ? { ...prev, status: status as any, ...extra } : null);
                    if (status === 'concluida' || status === 'cancelada') setTarefaDetalhe(null);
                  }}
                />
              ) : isLogistica && !isAdmin ? (
                <TarefasCampoView tarefas={tarefas} loading={loading} slotAtivo={slotAtivo} workerUid={usuario.uid} onTarefa={setTarefaDetalhe} />
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 12 }}>
                    {isAdmin ? `${tarefas.length}${pick(T.tarefasEm)}${cidade}` : `${tarefas.length}${pick(T.tarefasAtribuidas)}`}
                  </div>
                  {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ {pick(T.carregando)}</div>}
                  {!loading && tarefas.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>{pick(T.nenhumaTarefa)}</div>
                  )}
                  {!loading && tarefas.map(t => {
                    const tipoSlot: TipoSlot = (t.tipoSlot ?? 'scout') as TipoSlot;
                    const meta = TIPO_SLOT_META[tipoSlot];
                    const statusCor = { pendente: '#f59e0b', em_andamento: '#3b82f6', concluida: '#10b981', cancelada: '#ef4444', aceita: '#06b6d4', rejeitada: '#ef4444' }[t.status] ?? '#6b7280';
                    return (
                      <div key={t.id} style={{ ...S.card }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
                              <span style={S.badge(meta.cor)}>{meta.icone} {meta.l}</span>
                              <span style={S.badge(statusCor)}>{tStatusTarefa(pick, t.status)}</span>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>{t.titulo}</div>
                            {t.assigneeNome && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{t.assigneeNome}</div>}
                            {(t.qtdAlvo ?? 0) > 0 && (
                              <ProgressoEntregas concluida={t.qtdConcluida ?? 0} alvo={t.qtdAlvo ?? 0} cor={meta.cor} />
                            )}
                          </div>
                          {isAdmin && t.status !== 'concluida' && t.status !== 'cancelada' && (
                            <select value={t.status} style={{ ...S.inp, width: 'auto', fontSize: 10, padding: '3px 6px', colorScheme: 'dark' }}
                              onChange={async e => { if (t.id) await atualizarTarefa(t.id, e.target.value); }}
                              onClick={e => e.stopPropagation()}>
                              {['pendente','aceita','em_andamento','concluida','cancelada'].map(s => (
                                <option key={s} value={s} style={{ background: '#0d1521' }}>{tStatusTarefa(pick, s)}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── ABA OCORRÊNCIAS ── */}
          {aba === 'ocorrencias' && (
            <div>
              {criandoOcorr ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 12 }}>{pick(T.novaOcorrencia)}</div>
                  <FormOcorrencia usuario={usuario} cidade={cidade} pais={pais}
                    onSalvo={() => setCriandoOcorr(false)} onCancelar={() => setCriandoOcorr(false)} />
                </div>
              ) : (
                <>
                  <button style={{ ...S.btn('#ef4444'), marginBottom: 14 }} onClick={() => setCriandoOcorr(true)}>
                    {pick(T.registrarOcorrBtn)}
                  </button>
                  {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ {pick(T.carregando)}</div>}
                  {!loading && ocorrencias.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>{pick(T.nenhumaOcorr)}</div>
                  )}
                  {ocorrencias.map(oc => {
                    const statusCor = oc.status === 'aberta' ? '#ef4444' : oc.status === 'em_tratamento' ? '#f59e0b' : '#10b981';
                    return (
                      <div key={oc.id} style={{ ...S.card, border: `1px solid ${statusCor}20`, background: `${statusCor}06` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div>
                            <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
                              <span style={S.badge(statusCor)}>{tStatusOcorrencia(pick, oc.status)}</span>
                              {oc.procurando && <span style={S.badge('#ef4444')}>{pick(T.procurandoBadge)}</span>}
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>
                              {OCORRENCIA_TL[oc.tipo] ? pick(OCORRENCIA_TL[oc.tipo]) : (OCORRENCIAS_TIPOS.find(o => o.k === oc.tipo)?.l ?? oc.tipo)}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
                              {oc.registradoPorNome}{oc.patineteId && ` · ${oc.patineteId}`}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 4 }}>{oc.descricao}</div>
                          </div>
                          {isAdmin && oc.status !== 'resolvida' && (
                            <select value={oc.status} style={{ ...S.inp, width: 'auto', fontSize: 10, padding: '3px 6px', colorScheme: 'dark' }}
                              onChange={async e => {
                                if (oc.id) { await atualizarOcorrenciaSupabase(oc.id, { status: e.target.value }); }
                              }}
                              onClick={e => e.stopPropagation()}>
                              {['aberta','em_tratamento','resolvida','arquivada'].map(s => (
                                <option key={s} value={s} style={{ background: '#0d1521' }}>{tStatusOcorrencia(pick, s)}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── ABA EQUIPE ── */}
          {aba === 'equipe' && isAdmin && (
            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 14 }}>{pick(T.prestadoresAtivos)}{cidade}</div>
              {(() => {
                const comGps = equipe.filter(u => equipeGPS[u.id]);
                const bateriaBaixa = comGps.filter(u => (equipeGPS[u.id].bateria ?? 100) <= 15);
                const semSinal = comGps.filter(u => equipeGPS[u.id].idadeS >= 300);
                if (!bateriaBaixa.length && !semSinal.length) return null;
                return (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 12 }}>
                    {bateriaBaixa.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '5px 10px' }}>
                        🔋 {bateriaBaixa.length}{pick(T.bateriaBaixaAlerta)}
                      </span>
                    )}
                    {semSinal.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 8, padding: '5px 10px' }}>
                        📵 {semSinal.length}{pick(T.semGpsAlerta)}
                      </span>
                    )}
                  </div>
                );
              })()}
              {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ {pick(T.carregando)}</div>}
              {!loading && equipe.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>{pick(T.nenhumPrestador)}{cidade}.</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {equipe.map(u => {
                  const tipoSlot: TipoSlot = u.cargoPrestador === 'charger' ? 'charger' : 'scout';
                  const meta = TIPO_SLOT_META[tipoSlot];
                  const temSlot = !!u.slotAtualId;
                  const g = equipeGPS[u.id];
                  const bat = g ? bateriaLabel(g.bateria) : null;
                  return (
                    <div key={u.id} style={{ ...S.card, border: `1px solid ${meta.cor}20`, background: `${meta.cor}06` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 16, background: meta.cor + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                          {meta.icone}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>{u.nome}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{u.cargoPrestador} · {u.tipoContrato}</div>
                        </div>
                      </div>
                      <span style={S.badge(temSlot ? '#06b6d4' : '#6b7280')}>{temSlot ? pick(T.emSlot) : pick(T.disponivel)}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 10 }}>
                        {g ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: idadeLabel(g.idadeS).cor }}>
                            <span style={{ width: 6, height: 6, borderRadius: 3, background: idadeLabel(g.idadeS).cor, display: 'inline-block' }} />
                            📍 {idadeLabel(g.idadeS, pick(T.atras)).txt}
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255,255,255,.25)' }}>{pick(T.semGpsRecente)}</span>
                        )}
                        {bat && <span style={{ color: bat.cor, fontWeight: 700 }}>🔋 {bat.txt}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── ABA CONFIG AUTO-SLOTS ── */}
          {aba === 'resumo' && isAdmin && (
            <SlotsDashboard
              cidade={cidade} pais={pais}
              usuario={{ uid: usuario.uid, nome: usuario.nome, role: usuario.role }}
              onEnviarTelegram={async (texto) => {
                try {
                  const { functionsProviderSupabase, getEdgeCallable } = await import('./lib/edge-functions');
                  let fn: any;
                  if (functionsProviderSupabase()) {
                    const edge = getEdgeCallable('enviarResumoManual');
                    fn = edge ? edge() : null;
                  }
                  if (fn) await fn({ cidade });
                  alert('Resumo enviado ao Telegram!');
                } catch (e: any) {
                  alert('Erro ao enviar: ' + (e?.message ?? e));
                }
              }}
            />
          )}

          {aba === 'config_auto' && isAdmin && (
            <ConfigAutoSlotsPanel cidade={cidade} pais={pais} adminUid={usuario.uid} zonas={zonas} />
          )}

          {aba === 'historico' && isAdmin && (
            <HistoricoSlotsPanel slots={slots} tarefas={tarefas} />
          )}

        </div>
      </div>
    </div>
  );
}
