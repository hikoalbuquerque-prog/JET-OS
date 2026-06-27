// frontend/src/components/GoJetOverlay.tsx
// GoJet overlay completo — JET OS V2
//
// Features:
//   🅿 Parkings coloridos por status (toggle independente de bikes)
//   🛴 Bikes individuais com bateria (toggle independente)
//   🏪 Mini-dashboard lateral esquerdo (legenda + stats)
//   🔍 Filtros inteligentes: zerados | abaixo target | excesso | fora de ponto
//   🎯 Cruzamento com estações M1/M2/M3 do JET OS
//   ⭐ Destaque de proximidade parking ↔ estação monitor
//   🔗 Criar tarefa rápida ao clicar no parking

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { buscarCityIdSupabase } from '../lib/gojet-config-supabase';
import { fnScraperGoJetManual } from '../lib/edge-functions';
import { carregarEstacoesSupabase } from '../lib/estacoes-supabase';
import { fetchGojetSnapshot } from '../lib/analytics-supabase';
import { supabase } from '../lib/supabase';
import L from 'leaflet';
import { classifyBike as classifyBikeShared, BIKE_STATUS_HEX } from '../lib/bike-classify';
import { colorForParking, PARKING_COLOR_HEX } from '../lib/parking-colors';
import AdminBikeActionsLazy from './AdminBikeActions';
import { EventoGoJetPanel } from './EventoGoJetPanel';
import { MonitorConfigPanel } from './MonitorConfigPanel';

// Detecta APK Capacitor — no nativo o CORS bloqueia fetch direto
function isNativeApp(): boolean {
  const cap = (window as any).Capacitor;
  return !!(cap?.isNativePlatform?.());
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface GoJetParking {
  id: string;
  name: string;
  monitor?: boolean;
  bikes_count?: number;
  target_bikes_count?: number;
  latitude: number;
  longitude: number;
  availableCount?: number;
  rentingCount?: number;
  // Enriquecido localmente
  monitorLevel?: 'M1' | 'M2' | 'M3' | null; // nível da estação JET OS mais próxima
  estacaoId?: string | null;
  distanciaEstacao?: number | null; // metros
}

interface GoJetBike {
  id: string;
  identifier?: string;
  name?: string;
  model?: string;
  business_status?: string;
  business_sub_status?: string;
  disabled?: boolean;
  ordered?: boolean;
  booked?: boolean;
  service_mode?: boolean;
  battery_percent?: number;
  battery_customer_percent?: number;
  status_since?: number;   // timestamp ms quando entrou no status atual (calculado localmente)
  parking_id?: string | null;
  location_lat: number;
  location_lng: number;
  last_order_at?: string;
}

interface MonitorLevelConfig {
  ativo: boolean;
  thresholdPct: number;       // gera tarefa quando disponível < X% do target
  tipoTarefa: string;         // 'redistribuicao' | 'recarga' | 'manutencao'
  titulo: string;             // '{mLevel} - {parkingName}'
  prioridade: 'alta' | 'media' | 'baixa';
  raioBusca: number;          // metros (padrão 150)
  deduplicarHoras: number;    // não recriar se tarefa aberta < N horas
}

interface MonitorConfig {
  M1?: MonitorLevelConfig;
  M2?: MonitorLevelConfig;
  M3?: MonitorLevelConfig;
}

interface ViolacaoMonitor {
  parking: GoJetParking;
  cfg: MonitorLevelConfig;
  deficit: number;
  pctDisp: number;
}

interface EstacaoMonitor {
  id: string;
  tipoMonitor: 'M1' | 'M2' | 'M3';
  lat: number;
  lng: number;
  nome?: string;
  codigo?: string;
  // Campos para pontos temporários de evento
  temporario?: boolean;
  eventoId?: string;
  eventoNome?: string;
  eventoFim?: Date;
  targetBikes?: number;
}

type BikeStatus = 'available' | 'renting' | 'reserved' | 'maintenance' | 'low_battery' | 'oficina' | 'apreendidos';

// Filtros de visualização
type FiltroParking = 'todos' | 'zerados' | 'abaixo_target' | 'no_target' | 'excesso';
type FiltroBike    = 'todos' | 'fora_ponto' | 'bateria_baixa' | 'disponiveis';
type ViewLayer     = 'parkings' | 'bikes' | 'ambos';

interface Props {
  mapa: L.Map | null;
  visivel: boolean;
  cidade?: string;
  onTarefaRapida?: (parking: GoJetParking) => void;
  isAdmin?: boolean;
  gestorUid?: string;
  gestorNome?: string;
}

// ─── i18n — padrão TermosUsoGate (objeto T por idioma, sem chaves json) ────────
// PT é a fonte fiel; en/es/ru naturais. NÃO traduzir códigos/nomes de dados.
type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const T = {
  // Aviso "não configurado"
  naoConfigTitulo: { pt: '🛴 GoJet não configurado', en: '🛴 GoJet not configured', es: '🛴 GoJet no configurado', ru: '🛴 GoJet не настроен' } as Tr,
  naoConfigHint: {
    pt: (c: string) => `Configure em GoJet Config com o cityId para "${c}" para ativar o mapa ao vivo.`,
    en: (c: string) => `Configure GoJet Config with the cityId for "${c}" to enable the live map.`,
    es: (c: string) => `Configure GoJet Config con el cityId para "${c}" para activar el mapa en vivo.`,
    ru: (c: string) => `Настройте GoJet Config с cityId для «${c}», чтобы включить карту в реальном времени.`,
  },
  // Erros
  errNaoConfig: {
    pt: (c: string) => `GoJet não configurado para "${c}". Configure o cityId em GoJet Config.`,
    en: (c: string) => `GoJet not configured for "${c}". Set the cityId in GoJet Config.`,
    es: (c: string) => `GoJet no configurado para "${c}". Configure el cityId en GoJet Config.`,
    ru: (c: string) => `GoJet не настроен для «${c}». Настройте cityId в GoJet Config.`,
  },
  errBuscarConfig: { pt: 'Erro ao buscar config GoJet', en: 'Error loading GoJet config', es: 'Error al cargar config de GoJet', ru: 'Ошибка загрузки конфигурации GoJet' } as Tr,
  errSnapshotInexistente: {
    pt: 'Snapshot ainda não existe para esta cidade. Clique em "Atualizar agora" para gerar.',
    en: 'Snapshot does not exist yet for this city. Click "Refresh now" to generate it.',
    es: 'El snapshot aún no existe para esta ciudad. Haz clic en "Actualizar ahora" para generarlo.',
    ru: 'Снимок для этого города ещё не создан. Нажмите «Обновить сейчас», чтобы создать его.',
  } as Tr,
  errLerSnapshot: { pt: 'Erro ao ler snapshot GoJet', en: 'Error reading GoJet snapshot', es: 'Error al leer el snapshot de GoJet', ru: 'Ошибка чтения снимка GoJet' } as Tr,
  errAtualizar: { pt: 'Erro ao atualizar: ', en: 'Error refreshing: ', es: 'Error al actualizar: ', ru: 'Ошибка обновления: ' } as Tr,
  errCriarTarefas: { pt: 'Erro ao criar tarefas: ', en: 'Error creating tasks: ', es: 'Error al crear tareas: ', ru: 'Ошибка создания задач: ' } as Tr,
  // Descrição de tarefa gerada
  descTarefa: {
    pt: (nome: string, mLevel: string, avail: number, target: number, deficit: number) => `Ponto ${nome} (${mLevel}) com ${avail}/${target} disponíveis. Déficit: ${deficit} patinetes.`,
    en: (nome: string, mLevel: string, avail: number, target: number, deficit: number) => `Station ${nome} (${mLevel}) with ${avail}/${target} available. Deficit: ${deficit} scooters.`,
    es: (nome: string, mLevel: string, avail: number, target: number, deficit: number) => `Punto ${nome} (${mLevel}) con ${avail}/${target} disponibles. Déficit: ${deficit} patinetes.`,
    ru: (nome: string, mLevel: string, avail: number, target: number, deficit: number) => `Точка ${nome} (${mLevel}): доступно ${avail}/${target}. Дефицит: ${deficit} самокатов.`,
  },
  // Status de bike (popup parking — labels curtos)
  stAvailableShort: { pt: 'Disponível', en: 'Available', es: 'Disponible', ru: 'Доступен' } as Tr,
  stRentingShort: { pt: 'Aluguel', en: 'Renting', es: 'Alquiler', ru: 'Аренда' } as Tr,
  stReservedShort: { pt: 'Reservado', en: 'Reserved', es: 'Reservado', ru: 'Зарезервирован' } as Tr,
  stLowBattShort: { pt: 'Bat. baixa', en: 'Low batt.', es: 'Bat. baja', ru: 'Низкий заряд' } as Tr,
  stMaintenanceShort: { pt: 'Manutenção', en: 'Maintenance', es: 'Mantenimiento', ru: 'Обслуживание' } as Tr,
  stWorkshopShort: { pt: 'Oficina', en: 'Workshop', es: 'Taller', ru: 'Мастерская' } as Tr,
  // Status de bike (popup bike — labels longos)
  stRentingLong: { pt: 'Em aluguel', en: 'Renting', es: 'En alquiler', ru: 'В аренде' } as Tr,
  stLowBattLong: { pt: 'Bateria baixa', en: 'Low battery', es: 'Batería baja', ru: 'Низкий заряд батареи' } as Tr,
  // Popups
  nenhumPatinete: { pt: 'Nenhum patinete neste ponto', en: 'No scooters at this station', es: 'Ningún patinete en este punto', ru: 'Нет самокатов на этой точке' } as Tr,
  maisLabel: { pt: (n: number) => `+${n} mais`, en: (n: number) => `+${n} more`, es: (n: number) => `+${n} más`, ru: (n: number) => `+${n} ещё` },
  total: { pt: 'total', en: 'total', es: 'total', ru: 'всего' } as Tr,
  disponiveisLower: { pt: 'disponíveis', en: 'available', es: 'disponibles', ru: 'доступно' } as Tr,
  target: { pt: 'target', en: 'target', es: 'objetivo', ru: 'цель' } as Tr,
  faltam: {
    pt: (n: number) => `⚠️ Faltam ${n} patinete${n > 1 ? 's' : ''}`,
    en: (n: number) => `⚠️ Missing ${n} scooter${n > 1 ? 's' : ''}`,
    es: (n: number) => `⚠️ Faltan ${n} patinete${n > 1 ? 's' : ''}`,
    ru: (n: number) => `⚠️ Не хватает ${n} самокат${n > 1 ? 'ов' : 'а'}`,
  },
  estacaoA: {
    pt: (m: string, d: number) => `🏪 Estação ${m} a ${d}m`,
    en: (m: string, d: number) => `🏪 ${m} station ${d}m away`,
    es: (m: string, d: number) => `🏪 Estación ${m} a ${d}m`,
    ru: (m: string, d: number) => `🏪 Станция ${m} в ${d} м`,
  },
  encerrado: { pt: 'Encerrado', en: 'Ended', es: 'Finalizado', ru: 'Завершено' } as Tr,
  restantes: {
    pt: (h: number, m: number) => h > 0 ? `${h}h${m}m restantes` : `${m}m restantes`,
    en: (h: number, m: number) => h > 0 ? `${h}h${m}m remaining` : `${m}m remaining`,
    es: (h: number, m: number) => h > 0 ? `${h}h${m}m restantes` : `${m}m restantes`,
    ru: (h: number, m: number) => h > 0 ? `осталось ${h}ч${m}м` : `осталось ${m}м`,
  },
  eventoLabel: { pt: (n: string) => `📅 Evento: ${n}`, en: (n: string) => `📅 Event: ${n}`, es: (n: string) => `📅 Evento: ${n}`, ru: (n: string) => `📅 Событие: ${n}` },
  targetEvento: { pt: (n: number) => `Target evento: ${n} bikes`, en: (n: number) => `Event target: ${n} bikes`, es: (n: number) => `Objetivo evento: ${n} bikes`, ru: (n: number) => `Цель события: ${n} самокатов` },
  patinetesNestePonto: { pt: (n: number) => `🛴 Patinetes neste ponto (${n})`, en: (n: number) => `🛴 Scooters at this station (${n})`, es: (n: number) => `🛴 Patinetes en este punto (${n})`, ru: (n: number) => `🛴 Самокаты на этой точке (${n})` },
  criarTarefa: { pt: '+ Criar tarefa', en: '+ Create task', es: '+ Crear tarea', ru: '+ Создать задачу' } as Tr,
  trazerBikeAdmin: { pt: '🚚 Trazer bike (admin)', en: '🚚 Bring scooter (admin)', es: '🚚 Traer patinete (admin)', ru: '🚚 Доставить самокат (админ)' } as Tr,
  bateria: { pt: '🔋 Bateria', en: '🔋 Battery', es: '🔋 Batería', ru: '🔋 Батарея' } as Tr,
  emPonto: { pt: '📍 Em ponto', en: '📍 At station', es: '📍 En punto', ru: '📍 На точке' } as Tr,
  foraDePontoPopup: { pt: '⚠️ Fora de ponto', en: '⚠️ Out of station', es: '⚠️ Fuera de punto', ru: '⚠️ Вне точки' } as Tr,
  // Dashboard
  pontos: { pt: (n: number) => `PONTOS (${n})`, en: (n: number) => `STATIONS (${n})`, es: (n: number) => `PUNTOS (${n})`, ru: (n: number) => `ТОЧКИ (${n})` },
  zerados: { pt: 'Zerados', en: 'Empty', es: 'Vacíos', ru: 'Пустые' } as Tr,
  abaixoTarget: { pt: 'Abaixo target', en: 'Below target', es: 'Bajo objetivo', ru: 'Ниже цели' } as Tr,
  noTarget: { pt: 'No target', en: 'At target', es: 'En objetivo', ru: 'На цели' } as Tr,
  excesso: { pt: 'Excesso', en: 'Surplus', es: 'Exceso', ru: 'Избыток' } as Tr,
  vinculados: { pt: 'Vinculados M1/M2/M3', en: 'Linked M1/M2/M3', es: 'Vinculados M1/M2/M3', ru: 'Связанные M1/M2/M3' } as Tr,
  patinetesHeader: { pt: (n: number) => `PATINETES (${n})`, en: (n: number) => `SCOOTERS (${n})`, es: (n: number) => `PATINETES (${n})`, ru: (n: number) => `САМОКАТЫ (${n})` },
  stAvailableDash: { pt: 'Disponível', en: 'Available', es: 'Disponible', ru: 'Доступен' } as Tr,
  stLowBattDash: { pt: 'Bat. baixa', en: 'Low batt.', es: 'Bat. baja', ru: 'Низкий заряд' } as Tr,
  stRentingDash: { pt: 'Em aluguel', en: 'Renting', es: 'En alquiler', ru: 'В аренде' } as Tr,
  stReservedDash: { pt: 'Reservado', en: 'Reserved', es: 'Reservado', ru: 'Зарезервирован' } as Tr,
  stMaintenanceDash: { pt: 'Manutenção', en: 'Maintenance', es: 'Mantenimiento', ru: 'Обслуживание' } as Tr,
  foraDePontoDash: { pt: '⚠️ Fora de ponto', en: '⚠️ Out of station', es: '⚠️ Fuera de punto', ru: '⚠️ Вне точки' } as Tr,
  estacoesMonitor: { pt: 'ESTAÇÕES MONITOR', en: 'MONITOR STATIONS', es: 'ESTACIONES MONITOR', ru: 'СТАНЦИИ МОНИТОРА' } as Tr,
  estPts: { pt: (e: number, p: number) => `${e} est. · ${p} pts`, en: (e: number, p: number) => `${e} st. · ${p} pts`, es: (e: number, p: number) => `${e} est. · ${p} pts`, ru: (e: number, p: number) => `${e} ст. · ${p} тчк` },
  carregando: { pt: '⏳ Carregando...', en: '⏳ Loading...', es: '⏳ Cargando...', ru: '⏳ Загрузка...' } as Tr,
  semDado: { pt: '— sem dado', en: '— no data', es: '— sin datos', ru: '— нет данных' } as Tr,
  agora: { pt: '✓ agora', en: '✓ now', es: '✓ ahora', ru: '✓ сейчас' } as Tr,
  snapshotAtras: { pt: (n: number) => `snapshot ${n}min atrás`, en: (n: number) => `snapshot ${n}min ago`, es: (n: number) => `snapshot hace ${n}min`, ru: (n: number) => `снимок ${n} мин назад` },
  atualizando: { pt: '⏳ Atualizando...', en: '⏳ Refreshing...', es: '⏳ Actualizando...', ru: '⏳ Обновление...' } as Tr,
  atualizarAgora: { pt: '🔄 Atualizar agora', en: '🔄 Refresh now', es: '🔄 Actualizar ahora', ru: '🔄 Обновить сейчас' } as Tr,
  monitorDeTarefas: { pt: 'MONITOR DE TAREFAS', en: 'TASK MONITOR', es: 'MONITOR DE TAREAS', ru: 'МОНИТОР ЗАДАЧ' } as Tr,
  tarefasCriadasMsg: {
    pt: (n: number) => `✓ ${n} tarefa${n !== 1 ? 's' : ''} criada${n !== 1 ? 's' : ''}!`,
    en: (n: number) => `✓ ${n} task${n !== 1 ? 's' : ''} created!`,
    es: (n: number) => `✓ ${n} tarea${n !== 1 ? 's' : ''} creada${n !== 1 ? 's' : ''}!`,
    ru: (n: number) => `✓ создано задач: ${n}!`,
  },
  gerarTarefas: { pt: '🎯 Gerar Tarefas', en: '🎯 Generate tasks', es: '🎯 Generar tareas', ru: '🎯 Создать задачи' } as Tr,
  configMonitores: { pt: '⚙️ Config Monitores', en: '⚙️ Monitor config', es: '⚙️ Config Monitores', ru: '⚙️ Настройка мониторов' } as Tr,
  // Barra de filtros parking
  fpTodos: { pt: 'Todos', en: 'All', es: 'Todos', ru: 'Все' } as Tr,
  fpZerados: { pt: '🔴 Zerados', en: '🔴 Empty', es: '🔴 Vacíos', ru: '🔴 Пустые' } as Tr,
  fpAbaixoTarget: { pt: '🟡 < target', en: '🟡 < target', es: '🟡 < objetivo', ru: '🟡 < цели' } as Tr,
  fpNoTarget: { pt: '🔵 No target', en: '🔵 At target', es: '🔵 En objetivo', ru: '🔵 На цели' } as Tr,
  fpExcesso: { pt: '🟢 Excesso', en: '🟢 Surplus', es: '🟢 Exceso', ru: '🟢 Избыток' } as Tr,
  monitorBtn: { pt: '⭐ Monitor', en: '⭐ Monitor', es: '⭐ Monitor', ru: '⭐ Монитор' } as Tr,
  eventosBtn: { pt: '📅 Eventos', en: '📅 Events', es: '📅 Eventos', ru: '📅 События' } as Tr,
  // Layer toggles + filtro bikes
  pontosToggle: { pt: '🅿️ Pontos', en: '🅿️ Stations', es: '🅿️ Puntos', ru: '🅿️ Точки' } as Tr,
  patinetesToggle: { pt: '🛴 Patinetes', en: '🛴 Scooters', es: '🛴 Patinetes', ru: '🛴 Самокаты' } as Tr,
  fbTodos: { pt: 'Todos', en: 'All', es: 'Todos', ru: 'Все' } as Tr,
  fbForaPonto: { pt: '⚠️ Fora ponto', en: '⚠️ Out of station', es: '⚠️ Fuera punto', ru: '⚠️ Вне точки' } as Tr,
  fbBateriaBaixa: { pt: '🟠 Bat. baixa', en: '🟠 Low batt.', es: '🟠 Bat. baja', ru: '🟠 Низкий заряд' } as Tr,
  fbDisponiveis: { pt: '🟢 Disp.', en: '🟢 Avail.', es: '🟢 Disp.', ru: '🟢 Доступ.' } as Tr,
  // Modal de violações de monitor
  modalTitulo: { pt: '🎯 Gerar Tarefas de Monitor', en: '🎯 Generate Monitor Tasks', es: '🎯 Generar Tareas de Monitor', ru: '🎯 Создать задачи монитора' } as Tr,
  modalTudoOk: {
    pt: '✅ Todos os pontos monitorados estão acima dos thresholds configurados.',
    en: '✅ All monitored stations are above the configured thresholds.',
    es: '✅ Todos los puntos monitoreados están por encima de los umbrales configurados.',
    ru: '✅ Все отслеживаемые точки выше заданных порогов.',
  } as Tr,
  modalSubtitulo: {
    pt: (n: number) => `${n} ponto${n > 1 ? 's' : ''} abaixo do threshold — serão criadas tarefas em `,
    en: (n: number) => `${n} station${n > 1 ? 's' : ''} below threshold — tasks will be created in `,
    es: (n: number) => `${n} punto${n > 1 ? 's' : ''} por debajo del umbral — se crearán tareas en `,
    ru: (n: number) => `${n} точек ниже порога — задачи будут созданы в `,
  },
  modalDispMin: {
    pt: (a: number, t: number, pct: number, min: number) => `${a}/${t} disp. (${pct}% — mín. ${min}%)`,
    en: (a: number, t: number, pct: number, min: number) => `${a}/${t} avail. (${pct}% — min. ${min}%)`,
    es: (a: number, t: number, pct: number, min: number) => `${a}/${t} disp. (${pct}% — mín. ${min}%)`,
    ru: (a: number, t: number, pct: number, min: number) => `${a}/${t} дост. (${pct}% — мин. ${min}%)`,
  },
  cancelar: { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' } as Tr,
  criando: { pt: '⏳ Criando...', en: '⏳ Creating...', es: '⏳ Creando...', ru: '⏳ Создание...' } as Tr,
  criarNTarefas: {
    pt: (n: number) => `✓ Criar ${n} tarefa${n > 1 ? 's' : ''}`,
    en: (n: number) => `✓ Create ${n} task${n > 1 ? 's' : ''}`,
    es: (n: number) => `✓ Crear ${n} tarea${n > 1 ? 's' : ''}`,
    ru: (n: number) => `✓ Создать задач: ${n}`,
  },
};

// ─── bike-classify — usa lib compartilhada ────────────────────────────────────

function classifyBike(b: GoJetBike): BikeStatus {
  return classifyBikeShared(b) as BikeStatus;
}

const BIKE_COR: Record<BikeStatus, string> = BIKE_STATUS_HEX as Record<BikeStatus, string>;

// ─── Timer helpers ───────────────────────────────────────────────────────────

function fmtTempo(ms: number): string {
  const min  = Math.floor(ms / 60000);
  if (min < 60)  return `${min}m`;
  const hr   = Math.floor(min / 60);
  const rm   = min % 60;
  if (hr < 24)   return rm > 0 ? `${hr}h${rm}m` : `${hr}h`;
  const dias = Math.floor(hr / 24);
  const rh   = hr % 24;
  return rh > 0 ? `${dias}d${rh}h` : `${dias}d`;
}

function corTempo(ms: number, status: BikeStatus): string {
  const hr = ms / 3600000;
  if (status === 'maintenance') {
    if (hr > 48) return '#ef4444';  // vermelho — mais de 2 dias
    if (hr > 12) return '#f97316';  // laranja — mais de 12h
    return '#fbbf24';               // amarelo — recente
  }
  // low_battery
  if (hr > 24) return '#ef4444';
  if (hr > 6)  return '#f97316';
  return '#fbbf24';
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function distMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ─── Cores parkings — usa lib compartilhada ───────────────────────────────────

const COR_MAP: Record<string, { bg: string; borda: string; texto: string }> = {
  red:    { bg:'#7f1d1d', borda:'#ef4444', texto:'#fca5a5' },
  orange: { bg:'#78350f', borda:'#f59e0b', texto:'#fde68a' },
  yellow: { bg:'#422006', borda:'#d97706', texto:'#fde68a' },
  blue:   { bg:'#172554', borda:'#3b82f6', texto:'#93c5fd' },
  green:  { bg:'#052e16', borda:'#22c55e', texto:'#86efac' },
  gray:   { bg:'#1e293b', borda:'#475569', texto:'#94a3b8' },
};

function corParking(avail: number, target: number, monitor?: boolean): { bg: string; borda: string; texto: string } {
  const cor = colorForParking({ monitor, availableCount: avail, target_bikes_count: target });
  return COR_MAP[cor] ?? COR_MAP.gray;
}

const M_COR: Record<string, string> = { M1:'#10b981', M2:'#3b82f6', M3:'#f59e0b' };

const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  M1: { ativo: true,  thresholdPct: 30, tipoTarefa: 'redistribuicao', titulo: '{mLevel} - {parkingName}', prioridade: 'alta',  raioBusca: 150, deduplicarHoras: 4 },
  M2: { ativo: true,  thresholdPct: 40, tipoTarefa: 'redistribuicao', titulo: '{mLevel} - {parkingName}', prioridade: 'media', raioBusca: 150, deduplicarHoras: 4 },
  M3: { ativo: false, thresholdPct: 50, tipoTarefa: 'recarga',        titulo: '{mLevel} - {parkingName}', prioridade: 'baixa', raioBusca: 200, deduplicarHoras: 8 },
};

// Encontra a estação vinculada a um parking (para checar se é temporária)
const _estacoesPorId: Map<string, EstacaoMonitor> = new Map();

function iconParking(p: GoJetParking, estacaoInfo?: EstacaoMonitor | null): L.DivIcon {
  const total  = p.bikes_count    ?? 0;
  const avail  = p.availableCount ?? 0;
  const target = p.target_bikes_count ?? 0;
  const cor    = corParking(avail, target, p.monitor);
  const isMonitor  = p.monitor === true;
  const mLevel     = p.monitorLevel;
  const isEvento   = estacaoInfo?.temporario === true;
  const mCorBorder = mLevel ? (isEvento ? '#f59e0b' : M_COR[mLevel]) : null;
  const badge      = isEvento ? 'EV' : mLevel;
  const badgeBg    = isEvento ? '#d97706' : mCorBorder;
  const pulse      = isEvento ? `
    @keyframes ev-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,.5)} 50%{box-shadow:0 0 0 4px rgba(217,119,6,0)} }
    animation:ev-pulse 2s infinite;` : '';
  return L.divIcon({
    className: '', iconSize: [18, 18], iconAnchor: [9, 9],
    html: `<style>${pulse ? `#pk-${p.id}{${pulse}}` : ''}</style>
    <div id="pk-${p.id}" style="
      width:18px;height:18px;position:relative;
      border-radius:${isMonitor ? '50%' : '4px'};
      background:${cor.bg};
      border:${isEvento ? `1.5px dashed #f59e0b` : mCorBorder ? `1.5px solid ${mCorBorder}` : `1px solid ${cor.borda}`};
      display:flex;align-items:center;justify-content:center;
      font-size:7px;font-weight:800;color:${cor.texto};
      box-shadow:0 1px 3px rgba(0,0,0,.6);
      font-family:Inter,sans-serif;
    ">${total}${badge ? `<span style="position:absolute;top:-4px;right:-4px;background:${badgeBg};color:#fff;border-radius:3px;padding:0 2px;font-size:6px;font-weight:700">${badge}</span>` : ''}</div>`,
  });
}

function iconBike(b: GoJetBike, agora = Date.now()): L.DivIcon {
  const status  = classifyBike(b);
  const cor     = BIKE_COR[status];
  const pct     = b.battery_percent;
  const hasBatt = pct !== undefined && pct !== null;
  const showTimer = (status === 'maintenance' || status === 'low_battery') && b.status_since;
  const tempoMs   = showTimer ? agora - (b.status_since ?? agora) : 0;
  const tempoStr  = showTimer ? fmtTempo(tempoMs) : '';
  const timerCor  = showTimer ? corTempo(tempoMs, status) : '#fff';

  const h = showTimer ? 30 : hasBatt ? 19 : 12;
  return L.divIcon({
    className: '', iconSize: [28, h], iconAnchor: [14, h / 2],
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">
      <div style="width:12px;height:12px;border-radius:50%;background:${cor};border:1.5px solid rgba(0,0,0,.35);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>
      ${hasBatt ? `<div style="height:3px;width:12px;background:rgba(255,255,255,.15);border-radius:2px"><div style="height:3px;width:${Math.round((pct??0)*100)}%;background:${(pct??0)<0.2?'#ef4444':(pct??0)<0.4?'#f97316':'#22c55e'};border-radius:2px"></div></div>` : ''}
      ${showTimer ? `<div style="background:rgba(0,0,0,.75);color:${timerCor};font-size:8px;font-weight:700;padding:1px 3px;border-radius:3px;white-space:nowrap;line-height:1.2">${tempoStr}</div>` : ''}
    </div>`,
  });
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function GoJetOverlay({ mapa, visivel, cidade, onTarefaRapida, isAdmin, gestorUid, gestorNome }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;

  const parkingLayerRef = useRef<L.LayerGroup | null>(null);
  const bikeLayerRef    = useRef<L.LayerGroup | null>(null);

  const [parkings,      setParkings]      = useState<GoJetParking[]>([]);
  const [bikes,         setBikes]         = useState<GoJetBike[]>([]);
  const [estacoes,      setEstacoes]      = useState<EstacaoMonitor[]>([]);
  const [atualizadoEm,  setAtualizadoEm]  = useState<Date | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [erro,          setErro]          = useState<string | null>(null);
  const [cityId,        setCityId]        = useState('');

  // Layers ativos (independentes)
  const [showParkings, setShowParkings] = useState(true);
  const [showBikes,    setShowBikes]    = useState(false);
  const [tickAgora,    setTickAgora]    = useState(() => Date.now());
  const statusSinceRef = useRef<Record<string, { status: string; since: number }>>({});

  // Filtros
  const [filtroPark, setFiltroPark] = useState<FiltroParking>('todos');
  const [filtroBike, setFiltroBike] = useState<FiltroBike>('todos');
  const [somenteMonitor, setSomenteMonitor] = useState(false);
  const [apenasComVinculo, setApenasComVinculo] = useState(false);

  // Admin bike actions
  const [adminAction, setAdminAction] = useState<{
    modo: 'trazer_bike'|'organizar'|'mover_bike';
    parkingAlvo?: GoJetParking;
    bikeAlvo?: GoJetBike;
  } | null>(null);

  // Eventos GoJet panel
  const [showEventosPanel, setShowEventosPanel] = useState(false);

  // Monitor config
  const [monitorConfig, setMonitorConfig]     = useState<MonitorConfig | null>(null);
  const [violacoesModal, setViolacoesModal]   = useState<ViolacaoMonitor[] | null>(null);
  const [criandoTarefas, setCriandoTarefas]   = useState(false);
  const [tarefasCriadas, setTarefasCriadas]   = useState<number | null>(null);
  const [showConfigMonitor, setShowConfigMonitor] = useState(false);

  // UI
  const [dashAberto, setDashAberto] = useState(false);

  // ── Buscar estações M1/M2/M3 do JET OS + pontos temporários de evento ────────
  useEffect(() => {
    if (!visivel) return;

    async function carregarEstacoes() {
      try {
        const allEstacoes = await carregarEstacoesSupabase();
        // Filter for monitor stations (M1/M2/M3)
        const permanentes: EstacaoMonitor[] = allEstacoes
          .filter((e: any) => ['M1','M2','M3'].includes(e.tipoMonitor || e.tipo_monitor))
          .map((e: any) => ({
            id: e.id, tipoMonitor: e.tipoMonitor || e.tipo_monitor,
            lat: e.lat ?? 0, lng: e.lng ?? 0,
            nome: e.nome ?? e.name, codigo: e.codigo,
          }))
          .filter((e: EstacaoMonitor) => e.lat && e.lng);

        // Temporary event points — also from Supabase
        let temporarias: EstacaoMonitor[] = [];
        if (cidade) {
          const cidadeEstacoes = await carregarEstacoesSupabase(cidade);
          const now = new Date();
          temporarias = cidadeEstacoes
            .filter((e: any) => e.temporario)
            .filter((e: any) => {
              const fim = e.eventoFim ? new Date(e.eventoFim) : null;
              return fim && fim > now;
            })
            .map((e: any) => ({
              id: e.id, tipoMonitor: 'M3' as const,
              lat: e.lat ?? 0, lng: e.lng ?? 0,
              nome: e.eventoNome ?? e.nome,
              temporario: true, eventoId: e.eventoId,
              eventoNome: e.eventoNome,
              eventoFim: e.eventoFim ? new Date(e.eventoFim) : undefined,
              targetBikes: e.targetBikes,
            }))
            .filter((e: EstacaoMonitor) => e.lat && e.lng);
        }
        setEstacoes([...permanentes, ...temporarias]);
      } catch (err) {
        console.error('[GoJetOverlay] erro carregando estacoes:', err);
      }
    }

    carregarEstacoes().catch(() => {});
  }, [visivel, cidade]);

  // Busca cityId — reseta ao trocar cidade para não usar cityId da cidade anterior
  useEffect(() => {
    setCityId('');
    setParkings([]); setBikes([]);
    setErro(null); setAtualizadoEm(null);
    if (!cidade) return;
    buscarCityIdSupabase(cidade).then(cid => {
      if (cid) setCityId(cid);
      else setErro(T.errNaoConfig[lang](cidade));
    }).catch(() => setErro(pick(T.errBuscarConfig)));
  }, [cidade]);

  // ── Carrega snapshot do Supabase ──────────────────────────────────────────────
  const estacoesRef = useRef<EstacaoMonitor[]>([]);
  useEffect(() => { estacoesRef.current = estacoes; }, [estacoes]);

  const [snapshotIdade, setSnapshotIdade] = useState<number | null>(null); // minutos
  const [atualizandoScraper, setAtualizandoScraper] = useState(false);

  const carregarSnapshot = useCallback(async () => {
    if (!cityId || !cidade) return;
    setLoading(true); setErro(null);
    try {
      const result = await fetchGojetSnapshot(cidade);
      const parkingList = result.parkings;
      const bikeList = result.bikes;

      if (parkingList.length === 0 && bikeList.length === 0) {
        setErro(pick(T.errSnapshotInexistente));
        return;
      }

      if (result.savedAtMs) setSnapshotIdade(Math.round((Date.now() - result.savedAtMs) / 60000));

      // Contagens por parking
      const totalPorP:   Record<string, number> = {};
      const availPorP:   Record<string, number> = {};
      const rentingPorP: Record<string, number> = {};
      for (const b of bikeList) {
        if (!b.parking_id) continue;
        totalPorP[b.parking_id]   = (totalPorP[b.parking_id]   ?? 0) + 1;
        const s = classifyBike(b);
        if (s === 'available') availPorP[b.parking_id]   = (availPorP[b.parking_id]   ?? 0) + 1;
        if (s === 'renting')   rentingPorP[b.parking_id] = (rentingPorP[b.parking_id] ?? 0) + 1;
      }

      // Enriquece parkings com contagens + vínculo M1/M2/M3
      const enriched: GoJetParking[] = (parkingList as GoJetParking[])
        .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map(p => {
          let closest: EstacaoMonitor | null = null;
          let closestDist = Infinity;
          for (const e of estacoesRef.current) {
            const d = distMetros(p.latitude, p.longitude, e.lat, e.lng);
            if (d < closestDist && d <= 150) { closest = e; closestDist = d; }
          }
          return {
            ...p,
            bikes_count:      totalPorP[p.id]   ?? p.bikes_count ?? 0,
            availableCount:   availPorP[p.id]   ?? 0,
            rentingCount:     rentingPorP[p.id] ?? 0,
            monitorLevel:     closest?.tipoMonitor ?? null,
            estacaoId:        closest?.id ?? null,
            distanciaEstacao: closest ? closestDist : null,
          };
        });

      const bikesValidos: GoJetBike[] = (bikeList as GoJetBike[]).filter(b =>
        Number.isFinite(b.location_lat) && Number.isFinite(b.location_lng)
      );

      setParkings(enriched);

      const agora = Date.now();
      const enrichedBikes: GoJetBike[] = bikesValidos.map(b => {
        const status = classifyBike(b);
        const prev   = statusSinceRef.current[b.id];
        if (!prev || prev.status !== status) {
          statusSinceRef.current[b.id] = { status, since: agora };
        }
        return { ...b, status_since: statusSinceRef.current[b.id]?.since ?? agora };
      });
      setBikes(enrichedBikes);
      setAtualizadoEm(new Date());

    } catch (e: any) { setErro(e.message ?? pick(T.errLerSnapshot)); }
    finally { setLoading(false); }
  }, [cityId, cidade]);

  // Força atualização: fetch direto da GoJet API pelo browser (sem proxy, sem Cloud Function)
  const forcarAtualizacao = useCallback(async () => {
    if (!cityId || !cidade) return;
    setAtualizandoScraper(true); setErro(null);
    try {
      const { scraperGoJetBrowser } = await import('../lib/gojet-scraper');
      await scraperGoJetBrowser(cityId, cidade);
      await carregarSnapshot();
    } catch (e: any) {
      setErro(pick(T.errAtualizar) + (e.message ?? ''));
    } finally {
      setAtualizandoScraper(false);
    }
  }, [cityId, cidade, carregarSnapshot]);

  // Carrega configuração de monitor para a cidade atual
  useEffect(() => {
    if (!cidade || !visivel) return;
    (async () => {
      try {
        const { data, error } = await supabase.from('monitor_config').select('*').eq('cidade', cidade).single();
        if (error || !data) setMonitorConfig(DEFAULT_MONITOR_CONFIG);
        else setMonitorConfig({ M1: data.m1, M2: data.m2, M3: data.m3 } as MonitorConfig);
      } catch { setMonitorConfig(DEFAULT_MONITOR_CONFIG); }
    })();
  }, [cidade, visivel]);

  // Verifica parkings que violam thresholds dos monitores
  const verificarViolacoes = useCallback((): ViolacaoMonitor[] => {
    if (!monitorConfig) return [];
    const violacoes: ViolacaoMonitor[] = [];
    for (const p of parkings) {
      if (!p.monitorLevel) continue;
      const cfg = monitorConfig[p.monitorLevel];
      if (!cfg?.ativo) continue;
      const avail  = p.availableCount ?? 0;
      const target = p.target_bikes_count ?? 0;
      if (target === 0) continue;
      const pctDisp = (avail / target) * 100;
      if (pctDisp < cfg.thresholdPct) {
        violacoes.push({ parking: p, cfg, deficit: target - avail, pctDisp: Math.round(pctDisp) });
      }
    }
    // Ordena por prioridade: M1 > M2 > M3 e maior déficit primeiro
    const PRIORIDADE_ORDEM = ['alta', 'media', 'baixa'];
    return violacoes.sort((a, b) => {
      const pa = PRIORIDADE_ORDEM.indexOf(a.cfg.prioridade);
      const pb = PRIORIDADE_ORDEM.indexOf(b.cfg.prioridade);
      if (pa !== pb) return pa - pb;
      return b.deficit - a.deficit;
    });
  }, [parkings, monitorConfig]);

  const criarTarefasMonitor = useCallback(async (violacoes: ViolacaoMonitor[]) => {
    if (!cidade || violacoes.length === 0) return 0;
    setCriandoTarefas(true);
    let criadas = 0;
    try {
      for (const { parking: p, cfg, deficit } of violacoes) {
        const avail  = p.availableCount ?? 0;
        const target = p.target_bikes_count ?? 0;
        const titulo = cfg.titulo
          .replace('{mLevel}', p.monitorLevel!)
          .replace('{parkingName}', p.name || p.id);
        const { error } = await supabase.from('tarefas_logistica').insert({
          cidade,
          kind: cfg.tipoTarefa,
          titulo,
          descricao: T.descTarefa[lang](p.name, p.monitorLevel!, avail, target, deficit),
          status: 'aberto',
          prioridade: cfg.prioridade === 'alta' ? 4 : cfg.prioridade === 'media' ? 3 : 2,
          parking_id: p.id,
          parking_nome: p.name,
          parking_lat: p.latitude,
          parking_lng: p.longitude,
          monitor_level: p.monitorLevel,
          estacao_id: p.estacaoId ?? null,
          available_count: avail,
          target_count: target,
          deficit,
          criado_por: 'monitor_manual',
          criado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        });
        if (error) throw error;
        criadas++;
      }
      setTarefasCriadas(criadas);
      setTimeout(() => setTarefasCriadas(null), 4000);
    } catch (e: any) {
      setErro(pick(T.errCriarTarefas) + (e.message ?? ''));
    } finally {
      setCriandoTarefas(false);
    }
    return criadas;
  }, [cidade]);

  useEffect(() => {
    if (!visivel || !cityId) return;
    carregarSnapshot();
    // Recarrega do Supabase a cada 5 min (o scraper já atualizou o snapshot)
    const t = setInterval(carregarSnapshot, 5 * 60_000);
    return () => clearInterval(t);
  }, [visivel, cityId, carregarSnapshot]);

  // ── Parkings filtrados ────────────────────────────────────────────────────

  const parkingsFiltrados = useMemo(() => parkings.filter(p => {
    if (somenteMonitor && !p.monitor) return false;
    if (apenasComVinculo && !p.monitorLevel) return false;
    const avail  = p.availableCount ?? 0;
    const total  = p.bikes_count    ?? 0;
    const target = p.target_bikes_count ?? 0;
    switch (filtroPark) {
      case 'zerados':        return avail === 0;
      case 'abaixo_target':  return target > 0 && avail < target;
      case 'no_target':      return target > 0 && avail >= target && avail < target * 1.2;
      case 'excesso':        return target > 0 && avail >= target * 1.2;
      default:               return true;
    }
  }), [parkings, filtroPark, somenteMonitor, apenasComVinculo]);

  const bikesFiltrados = useMemo(() => bikes.filter(b => {
    const s = classifyBike(b);
    switch (filtroBike) {
      case 'fora_ponto':    return !b.parking_id;
      case 'bateria_baixa': return s === 'low_battery';
      case 'disponiveis':   return s === 'available';
      default:              return true;
    }
  }), [bikes, filtroBike]);

  // ── Markers: criados UMA VEZ, filtro via show/hide (sem recriar) ───────────
  const parkingMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const bikeMarkersRef    = useRef<Map<string, L.Marker>>(new Map());
  // Ref para bikes — lido no popup de parking sem criar dependência que recria markers
  const bikesRef = useRef<GoJetBike[]>([]);
  useEffect(() => { bikesRef.current = bikes; }, [bikes]);

  // Cria/atualiza markers de parkings quando DADOS mudam
  useEffect(() => {
    if (!mapa || !visivel) return;
    // Criar layer desacoplado do mapa — adiciona ao mapa só depois de popular
    if (!parkingLayerRef.current) {
      parkingLayerRef.current = L.layerGroup();
    }
    const layer    = parkingLayerRef.current;
    const existing = parkingMarkersRef.current;
    const newIds   = new Set(parkings.map(p => p.id));
    const isNew    = existing.size === 0 && parkings.length > 0;

    // Remove obsoletos
    for (const [id, m] of existing) {
      if (!newIds.has(id)) { layer.removeLayer(m); existing.delete(id); }
    }

    // Indexa estações por id para popup de evento
    for (const e of estacoesRef.current) _estacoesPorId.set(e.id, e);

    for (const p of parkings) {
      const estInfo = p.estacaoId ? (_estacoesPorId.get(p.estacaoId) ?? null) : null;
      if (existing.has(p.id)) {
        existing.get(p.id)!.setIcon(iconParking(p, estInfo)); // atualiza contagem
      } else {
        const avail   = p.availableCount ?? 0;
        const total   = p.bikes_count    ?? 0;
        const target  = p.target_bikes_count ?? 0;
        const deficit = Math.max(0, target - avail);
        const cor     = corParking(avail, target);
        const mLevel  = p.monitorLevel;
        const isEvento = estInfo?.temporario === true;
        const marker  = L.marker([p.latitude, p.longitude], {
          icon: iconParking(p, estInfo),
          zIndexOffset: isEvento ? 300 : mLevel ? 200 : p.monitor ? 100 : 0,
        });
        marker.bindPopup(() => {
          // Bikes neste ponto — lidos de bikesRef no momento do clique (sempre frescos)
          const bikesNoPonto = bikesRef.current.filter(b => b.parking_id === p.id);
          const statusLabel: Record<string, string> = {
            available: pick(T.stAvailableShort), renting: pick(T.stRentingShort), reserved: pick(T.stReservedShort),
            low_battery: pick(T.stLowBattShort), maintenance: pick(T.stMaintenanceShort), workshop: pick(T.stWorkshopShort),
          };

          const bikesHtml = bikesNoPonto.length === 0
            ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px">${pick(T.nenhumPatinete)}</div>`
            : bikesNoPonto.slice(0, 20).map(b => {
                const st  = classifyBike(b);
                const cor = BIKE_COR[st];
                const pct = b.battery_percent;
                const pctN = pct !== undefined ? Math.round(pct * 100) : null;
                const bCor = pctN !== null ? (pctN < 20 ? '#ef4444' : pctN < 40 ? '#f97316' : '#22c55e') : '#94a3b8';
                return `
                  <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f1f5f9">
                    <div style="width:8px;height:8px;border-radius:50%;background:${cor};flex-shrink:0"></div>
                    <div style="flex:1;min-width:0">
                      <div style="font-size:11px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.identifier || b.id.slice(-6)}</div>
                      <div style="font-size:9px;color:${cor}">${statusLabel[st] ?? st}</div>
                    </div>
                    ${pctN !== null ? `
                      <div style="flex-shrink:0;text-align:right">
                        <div style="font-size:10px;font-weight:700;color:${bCor}">${pctN}%</div>
                        <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin-top:1px">
                          <div style="height:4px;width:${pctN}%;background:${bCor};border-radius:2px"></div>
                        </div>
                      </div>` : ''}
                  </div>`;
              }).join('')
            + (bikesNoPonto.length > 20 ? `<div style="font-size:9px;color:#94a3b8;margin-top:4px;text-align:center">${T.maisLabel[lang](bikesNoPonto.length - 20)}</div>` : '');

          const div = document.createElement('div');
          div.style.cssText = 'font-family:Inter,sans-serif;min-width:220px;max-width:260px;font-size:12px';
          div.innerHTML = `
            <div style="font-weight:700;font-size:13px;color:#0d0d1a;margin-bottom:6px;padding-right:16px">
              ${p.monitor ? '📍' : 'P'} ${p.name || p.id}
              ${mLevel ? `<span style="background:${M_COR[mLevel]};color:#fff;border-radius:4px;padding:1px 5px;font-size:9px;margin-left:4px">${mLevel}</span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px">
              <div style="background:#f0fdf4;border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:16px;font-weight:800;color:#16a34a">${total}</div>
                <div style="font-size:8px;color:#6b7280">${pick(T.total)}</div>
              </div>
              <div style="background:#f0f9ff;border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:16px;font-weight:800;color:#0369a1">${avail}</div>
                <div style="font-size:8px;color:#6b7280">${pick(T.disponiveisLower)}</div>
              </div>
              <div style="background:#fafafa;border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:16px;font-weight:800;color:#374151">${target || '—'}</div>
                <div style="font-size:8px;color:#6b7280">${pick(T.target)}</div>
              </div>
            </div>
            ${deficit > 0 ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:4px 8px;border-radius:4px;font-size:10px;color:#dc2626;margin-bottom:6px">${T.faltam[lang](deficit)}</div>` : ''}
            ${p.distanciaEstacao != null && !isEvento ? `<div style="font-size:10px;color:#7c3aed;margin-bottom:6px">${T.estacaoA[lang](mLevel ?? '', Math.round(p.distanciaEstacao))}</div>` : ''}
            ${isEvento && estInfo?.eventoNome ? (() => {
              const fim = estInfo.eventoFim;
              const diff = fim ? fim.getTime() - Date.now() : 0;
              const horas = Math.floor(diff / 3600000);
              const mins  = Math.floor((diff % 3600000) / 60000);
              const tempoStr = diff <= 0 ? pick(T.encerrado) : T.restantes[lang](horas, mins);
              const corTempo2 = diff <= 0 ? '#ef4444' : diff < 3600000 ? '#f97316' : '#f59e0b';
              return `<div style="background:rgba(217,119,6,.12);border-left:3px solid #f59e0b;padding:6px 8px;border-radius:4px;margin-bottom:6px">
                <div style="font-size:10px;font-weight:700;color:#fbbf24">${T.eventoLabel[lang](estInfo.eventoNome ?? '')}</div>
                <div style="font-size:9px;color:${corTempo2};margin-top:2px">⏱ ${tempoStr}</div>
                ${estInfo.targetBikes ? `<div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:1px">${T.targetEvento[lang](estInfo.targetBikes)}</div>` : ''}
              </div>`;
            })() : ''}
            <div style="font-size:10px;font-weight:700;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px">
              ${T.patinetesNestePonto[lang](bikesNoPonto.length)}
            </div>
            <div style="max-height:180px;overflow-y:auto;scrollbar-width:thin">${bikesHtml}</div>
            ${onTarefaRapida ? `<button id="btn-t-${p.id}" style="width:100%;padding:7px;border:none;border-radius:6px;background:${cor.borda};color:#fff;font-size:11px;font-weight:700;cursor:pointer;margin-top:8px;margin-bottom:4px">${pick(T.criarTarefa)}</button>` : ''}
            ${isAdmin && deficit > 0 ? `<button id="btn-admin-${p.id}" style="width:100%;padding:7px;border:none;border-radius:6px;background:#7c3aed;color:#fff;font-size:11px;font-weight:700;cursor:pointer">${pick(T.trazerBikeAdmin)}</button>` : ''}
          `;
          if (onTarefaRapida) {
            setTimeout(() => {
              document.getElementById(`btn-t-${p.id}`)?.addEventListener('click', () => {
                mapa.closePopup(); onTarefaRapida(p);
              });
            }, 0);
          }
          if (isAdmin && deficit > 0) {
            setTimeout(() => {
              document.getElementById(`btn-admin-${p.id}`)?.addEventListener('click', () => {
                mapa.closePopup();
                setAdminAction({ modo: 'trazer_bike', parkingAlvo: p });
              });
            }, 0);
          }
          return div;
        }, { maxWidth: 270 });
        layer.addLayer(marker);
        existing.set(p.id, marker);
      }
    }
    // Na carga inicial, adiciona layer ao mapa de uma vez (batch)
    if (isNew && !mapa.hasLayer(layer)) layer.addTo(mapa);
    return () => {
      if (parkingLayerRef.current) { mapa.removeLayer(parkingLayerRef.current); parkingLayerRef.current = null; parkingMarkersRef.current.clear(); }
    };
  }, [mapa, visivel, parkings, onTarefaRapida]);

  // Canvas renderer compartilhado para bikes — sem DOM por marker (muito mais rápido)
  const canvasRendererRef = useRef<L.Canvas | null>(null);

  // Cria/atualiza markers de bikes quando DADOS mudam
  useEffect(() => {
    if (!mapa || !visivel) return;
    if (!canvasRendererRef.current) canvasRendererRef.current = L.canvas({ padding: 0.5 });
    if (!bikeLayerRef.current) bikeLayerRef.current = L.layerGroup();
    const layer    = bikeLayerRef.current;
    const existing = bikeMarkersRef.current;
    const renderer = canvasRendererRef.current;
    const newIds   = new Set(bikes.map(b => b.id));

    // Remove obsoletos
    for (const [id, m] of existing) {
      if (!newIds.has(id)) { layer.removeLayer(m); existing.delete(id); }
    }

    // Novos bikes — circleMarker canvas (zero DOM por marker)
    const toAdd: L.CircleMarker[] = [];
    for (const b of bikes) {
      if (existing.has(b.id)) {
        // Apenas atualiza cor se status mudou — sem recriar
        const status = classifyBike(b);
        const cm = existing.get(b.id) as unknown as L.CircleMarker;
        cm.setStyle({ fillColor: BIKE_COR[status], color: BIKE_COR[status] });
      } else {
        const status = classifyBike(b);
        const cor    = BIKE_COR[status];
        const pct    = b.battery_percent;
        const pctN   = pct !== undefined ? Math.round(pct * 100) : null;
        const bCor   = pctN !== null ? (pctN < 20 ? '#ef4444' : pctN < 40 ? '#f97316' : '#22c55e') : '#6b7280';
        const cm = L.circleMarker([b.location_lat, b.location_lng], {
          renderer,
          radius: 5,
          fillColor: cor,
          color: cor,
          fillOpacity: 0.85,
          weight: 1,
        });
        cm.bindPopup(`
          <div style="font-family:Inter,sans-serif;font-size:12px;min-width:160px">
            <div style="font-weight:700;color:#0d0d1a;margin-bottom:6px;font-size:13px">🛴 ${b.identifier ?? b.id.slice(0, 8)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <div style="width:10px;height:10px;border-radius:50%;background:${cor};flex-shrink:0"></div>
              <span style="color:#374151;font-weight:600">${status === 'available' ? pick(T.stAvailableShort) : status === 'renting' ? pick(T.stRentingLong) : status === 'reserved' ? pick(T.stReservedShort) : status === 'low_battery' ? pick(T.stLowBattLong) : pick(T.stMaintenanceShort)}</span>
            </div>
            ${pctN !== null ? `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:2px"><span>${pick(T.bateria)}</span><span style="color:${bCor};font-weight:700">${pctN}%</span></div><div style="height:6px;background:#e5e7eb;border-radius:3px"><div style="height:6px;width:${pctN}%;background:${bCor};border-radius:3px"></div></div></div>` : ''}
            ${b.model ? `<div style="font-size:10px;color:#9ca3af">${b.model}</div>` : ''}
            ${b.parking_id ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">${pick(T.emPonto)}</div>` : `<div style="font-size:10px;color:#f97316;margin-top:2px">${pick(T.foraDePontoPopup)}</div>`}
          </div>
        `, { maxWidth: 200 });
        toAdd.push(cm);
        existing.set(b.id, cm as unknown as L.Marker);
      }
    }
    // Batch-add ao layer de uma vez
    toAdd.forEach(cm => layer.addLayer(cm));

    return () => {
      if (bikeLayerRef.current) { mapa.removeLayer(bikeLayerRef.current); bikeLayerRef.current = null; bikeMarkersRef.current.clear(); }
    };
  }, [mapa, visivel, bikes]);

  // Filtro: show/hide markers individualmente — NÃO recria nada
  useEffect(() => {
    if (!parkingLayerRef.current || !mapa) return;
    const visSet = new Set(parkingsFiltrados.map(p => p.id));
    if (showParkings) {
      if (!mapa.hasLayer(parkingLayerRef.current)) parkingLayerRef.current.addTo(mapa);
      for (const [id, m] of parkingMarkersRef.current) {
        const display = visSet.has(id) ? '' : 'none';
        const el     = (m as any)._icon   as HTMLElement | undefined;
        const shadow = (m as any)._shadow as HTMLElement | undefined;
        if (el)     el.style.display     = display;
        if (shadow) shadow.style.display = display;
      }
    } else {
      if (mapa.hasLayer(parkingLayerRef.current)) mapa.removeLayer(parkingLayerRef.current);
    }
  }, [mapa, showParkings, parkingsFiltrados]);

  useEffect(() => {
    if (!bikeLayerRef.current || !mapa) return;
    const visSet = new Set(bikesFiltrados.map(b => b.id));
    if (showBikes) {
      if (!mapa.hasLayer(bikeLayerRef.current)) bikeLayerRef.current.addTo(mapa);
      for (const [id, m] of bikeMarkersRef.current) {
        const display = visSet.has(id) ? '' : 'none';
        const el     = (m as any)._icon   as HTMLElement | undefined;
        const shadow = (m as any)._shadow as HTMLElement | undefined;
        if (el)     el.style.display     = display;
        if (shadow) shadow.style.display = display;
      }
    } else {
      if (mapa.hasLayer(bikeLayerRef.current)) mapa.removeLayer(bikeLayerRef.current);
    }
  }, [mapa, showBikes, bikesFiltrados]);

  // tickAgora mantido por compatibilidade com iconBike, mas não mais atualiza markers em loop
  useEffect(() => { void tickAgora; }, []);

  if (!visivel) return null;

  // Cidade ainda não configurada — mostra aviso flutuante
  if (!cityId && !loading) {
    return (
      <div style={{
        position: 'fixed', left: '50%', bottom: 120, transform: 'translateX(-50%)',
        zIndex: 900, pointerEvents: 'auto',
        background: 'rgba(13,18,30,.95)', border: '1px solid rgba(251,191,36,.3)',
        borderRadius: 12, padding: '12px 16px', maxWidth: 300, backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 20px rgba(0,0,0,.5)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>
          {pick(T.naoConfigTitulo)}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.5 }}>
          {erro ?? T.naoConfigHint[lang](cidade ?? '?')}
        </div>
      </div>
    );
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalDisp   = parkings.reduce((s, p) => s + (p.availableCount ?? 0), 0);
  const totalFisico = parkings.reduce((s, p) => s + (p.bikes_count    ?? 0), 0);
  const zerados     = parkings.filter(p => (p.availableCount ?? 0) === 0).length;
  const comVinculo  = parkings.filter(p => p.monitorLevel).length;

  const statsBikes = bikes.reduce((acc, b) => {
    const s = classifyBike(b);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const foraPonto = bikes.filter(b => !b.parking_id).length;

  return (
    <>
      {/* ── Mini-dashboard lateral ESQUERDO ──────────────────────────────── */}
      <div style={{
        position: 'fixed', left: 10, bottom: 100, zIndex: 800,
        display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none',
      }}>
        {/* Toggle dashboard */}
        <button
          onClick={() => setDashAberto(v => !v)}
          style={{
            pointerEvents: 'auto', width: 36, height: 36, borderRadius: 8,
            background: dashAberto ? 'rgba(59,130,246,.3)' : 'rgba(13,18,30,.9)',
            color: dashAberto ? '#60a5fa' : 'rgba(255,255,255,.5)', fontSize: 16, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.1)',
          }}>
          {dashAberto ? '✕' : '📊'}
        </button>

        {dashAberto && (
          <div style={{
            pointerEvents: 'auto',
            background: 'rgba(13,18,30,.95)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 10, padding: '10px 12px', backdropFilter: 'blur(8px)',
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180,
          }}>
            {/* Parkings stats */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)',
                letterSpacing: 1, marginBottom: 5 }}>{T.pontos[lang](parkings.length)}</div>
              {[
                { cor: '#ef4444', label: pick(T.zerados), val: zerados },
                { cor: '#f59e0b', label: pick(T.abaixoTarget), val: parkings.filter(p => { const t = p.target_bikes_count??0; return t>0 && (p.availableCount??0)<t; }).length - zerados },
                { cor: '#3b82f6', label: pick(T.noTarget), val: parkings.filter(p => { const t=p.target_bikes_count??0; const a=p.availableCount??0; return t>0&&a>=t&&a<t*1.2; }).length },
                { cor: '#22c55e', label: pick(T.excesso), val: parkings.filter(p => { const t=p.target_bikes_count??0; return t>0&&(p.availableCount??0)>=t*1.2; }).length },
                { cor: '#10b981', label: pick(T.vinculados), val: comVinculo },
              ].map(({ cor, label, val }) => val > 0 ? (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: cor }} />
                    <span style={{ color: 'rgba(255,255,255,.55)' }}>{label}</span>
                  </div>
                  <span style={{ color: cor, fontWeight: 700 }}>{val}</span>
                </div>
              ) : null)}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />

            {/* Bikes stats */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)',
                letterSpacing: 1, marginBottom: 5 }}>{T.patinetesHeader[lang](bikes.length)}</div>
              {([
                ['available',   '🟢', pick(T.stAvailableDash)],
                ['low_battery', '🟠', pick(T.stLowBattDash)],
                ['renting',     '🟡', pick(T.stRentingDash)],
                ['reserved',    '⚫', pick(T.stReservedDash)],
                ['maintenance', '🔴', pick(T.stMaintenanceDash)],
              ] as const).map(([s, emoji, label]) => (statsBikes[s]??0) > 0 ? (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                  <span>{emoji} <span style={{ color: 'rgba(255,255,255,.55)' }}>{label}</span></span>
                  <span style={{ color: 'rgba(255,255,255,.65)', fontWeight: 700 }}>{statsBikes[s]??0}</span>
                </div>
              ) : null)}
              <div style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', fontSize: 10, marginTop: 4, paddingTop: 4,
                borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ color: '#f97316' }}>{pick(T.foraDePontoDash)}</span>
                <span style={{ color: '#f97316', fontWeight: 700 }}>{foraPonto}</span>
              </div>
            </div>

            {/* Estações vinculadas */}
            {estacoes.length > 0 && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)',
                    letterSpacing: 1, marginBottom: 5 }}>{pick(T.estacoesMonitor)}</div>
                  {(['M1','M2','M3'] as const).map(m => {
                    const n = estacoes.filter(e => e.tipoMonitor === m).length;
                    return n > 0 ? (
                      <div key={m} style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                        <span style={{ color: M_COR[m], fontWeight: 700 }}>{m}</span>
                        <span style={{ color: 'rgba(255,255,255,.55)' }}>{T.estPts[lang](n, parkings.filter(p=>p.monitorLevel===m).length)}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </>
            )}

            {/* Idade do snapshot */}
            {(() => {
              const idade = snapshotIdade;
              const cor = loading ? '#6b7280' : idade === null ? '#6b7280' : idade < 6 ? '#22c55e' : idade < 15 ? '#f59e0b' : '#ef4444';
              const label = loading ? pick(T.carregando)
                : idade === null ? pick(T.semDado)
                : idade < 1 ? pick(T.agora)
                : T.snapshotAtras[lang](idade);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 9, color: cor, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: cor }} />
                    {label}
                  </div>
                  <button
                    onClick={forcarAtualizacao}
                    disabled={atualizandoScraper || loading}
                    style={{
                      fontSize: 9, padding: '3px 8px', borderRadius: 6, border: 'none',
                      background: 'rgba(167,139,250,.15)', color: '#a78bfa',
                      cursor: atualizandoScraper ? 'wait' : 'pointer', fontWeight: 700,
                    }}>
                    {atualizandoScraper ? pick(T.atualizando) : pick(T.atualizarAgora)}
                  </button>
                </div>
              );
            })()}

            {/* Gerar Tarefas de Monitor */}
            {parkings.some(p => p.monitorLevel) && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)', letterSpacing: 1 }}>{pick(T.monitorDeTarefas)}</div>
                  {tarefasCriadas !== null && (
                    <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 700 }}>{T.tarefasCriadasMsg[lang](tarefasCriadas)}</div>
                  )}
                  <button
                    onClick={() => setViolacoesModal(verificarViolacoes())}
                    disabled={criandoTarefas}
                    style={{
                      fontSize: 9, padding: '4px 8px', borderRadius: 6, border: 'none',
                      background: 'rgba(16,185,129,.2)', color: '#10b981',
                      cursor: 'pointer', fontWeight: 700,
                    }}>
                    {pick(T.gerarTarefas)}
                  </button>
                  <button
                    onClick={() => setShowConfigMonitor(v => !v)}
                    style={{
                      fontSize: 9, padding: '3px 8px', borderRadius: 6, border: 'none',
                      background: showConfigMonitor ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.05)',
                      color: showConfigMonitor ? '#fbbf24' : 'rgba(255,255,255,.35)',
                      cursor: 'pointer', fontWeight: 700,
                    }}>
                    {pick(T.configMonitores)}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Barra de controles centralizada (inferior) ────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 56, left: '50%', transform: 'translateX(-50%)',
        zIndex: 900, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}>
        {/* Filtros avançados */}
        <div style={{
          display: 'flex', gap: 5, background: 'rgba(13,18,30,.9)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '3px 6px',
          backdropFilter: 'blur(8px)', flexWrap: 'wrap', justifyContent: 'center',
          maxWidth: '90vw',
        }}>
          {/* Filtros parking */}
          {showParkings && ([
            { k: 'todos',        l: pick(T.fpTodos) },
            { k: 'zerados',      l: pick(T.fpZerados) },
            { k: 'abaixo_target',l: pick(T.fpAbaixoTarget) },
            { k: 'no_target',    l: pick(T.fpNoTarget) },
            { k: 'excesso',      l: pick(T.fpExcesso) },
          ] as const).map(opt => (
            <button key={opt.k} onClick={() => setFiltroPark(opt.k)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: filtroPark === opt.k ? 'rgba(59,130,246,.3)' : 'transparent',
              color: filtroPark === opt.k ? '#60a5fa' : 'rgba(255,255,255,.45)',
            }}>{opt.l}</button>
          ))}

          {showParkings && <div style={{ width: 1, background: 'rgba(255,255,255,.1)', margin: '3px 0' }} />}

          {/* Toggle monitor */}
          {showParkings && (
            <button onClick={() => setSomenteMonitor(v => !v)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: somenteMonitor ? 'rgba(16,185,129,.25)' : 'transparent',
              color: somenteMonitor ? '#10b981' : 'rgba(255,255,255,.45)',
            }}>{pick(T.monitorBtn)}</button>
          )}

          {/* Toggle só vinculados */}
          {showParkings && estacoes.length > 0 && (
            <button onClick={() => setApenasComVinculo(v => !v)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: apenasComVinculo ? 'rgba(124,58,237,.25)' : 'transparent',
              color: apenasComVinculo ? '#a78bfa' : 'rgba(255,255,255,.45)',
            }}>🔗 M1/M2/M3</button>
          )}

          {/* Eventos temporários */}
          {cidade && (
            <button onClick={() => setShowEventosPanel(v => !v)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: showEventosPanel ? 'rgba(217,119,6,.25)' : 'transparent',
              color: showEventosPanel ? '#f59e0b' : 'rgba(255,255,255,.45)',
            }}>
              {pick(T.eventosBtn)}
              {estacoes.filter(e => e.temporario).length > 0
                ? ` (${estacoes.filter(e => e.temporario).length})` : ''}
            </button>
          )}
        </div>

        {/* Layer toggles + filtro bikes */}
        <div style={{
          display: 'flex', gap: 5, background: 'rgba(13,18,30,.9)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '3px 6px',
          backdropFilter: 'blur(8px)',
        }}>
          <button onClick={() => setShowParkings(v => !v)} style={{
            padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700,
            background: showParkings ? 'rgba(59,130,246,.25)' : 'transparent',
            color: showParkings ? '#60a5fa' : 'rgba(255,255,255,.45)',
          }}>{pick(T.pontosToggle)} {showParkings ? `(${parkingsFiltrados.length})` : ''}</button>

          <button onClick={() => setShowBikes(v => !v)} style={{
            padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700,
            background: showBikes ? 'rgba(16,185,129,.25)' : 'transparent',
            color: showBikes ? '#10b981' : 'rgba(255,255,255,.45)',
          }}>{pick(T.patinetesToggle)} {showBikes ? `(${bikesFiltrados.length})` : `(${bikes.length})`}</button>

          {/* Filtros bikes */}
          {showBikes && ([
            { k: 'todos',        l: pick(T.fbTodos) },
            { k: 'fora_ponto',   l: pick(T.fbForaPonto) },
            { k: 'bateria_baixa',l: pick(T.fbBateriaBaixa) },
            { k: 'disponiveis',  l: pick(T.fbDisponiveis) },
          ] as const).map(opt => (
            <button key={opt.k} onClick={() => setFiltroBike(opt.k)} style={{
              padding: '5px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: filtroBike === opt.k ? 'rgba(16,185,129,.25)' : 'transparent',
              color: filtroBike === opt.k ? '#10b981' : 'rgba(255,255,255,.4)',
            }}>{opt.l}</button>
          ))}
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div style={{ position:'fixed', bottom:110, left:10, zIndex:800,
          background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)',
          borderRadius:8, padding:'5px 10px', fontSize:10, color:'#ef4444',
          display:'flex', flexDirection:'column', gap:6, maxWidth:240 }}>
          <span>⚠️ {erro}</span>
          {cityId && (
            <button
              onClick={forcarAtualizacao}
              disabled={atualizandoScraper || loading}
              style={{
                fontSize:10, padding:'4px 10px', borderRadius:6, border:'none',
                background:'rgba(239,68,68,.3)', color:'#fca5a5',
                cursor: atualizandoScraper ? 'wait' : 'pointer', fontWeight:700,
              }}>
              {atualizandoScraper ? pick(T.atualizando) : pick(T.atualizarAgora)}
            </button>
          )}
        </div>
      )}

      {/* ── Modal de Violações de Monitor ─────────────────────────────────── */}
      {violacoesModal !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: '#0d1218', border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 14, padding: 20, maxWidth: 480, width: '100%',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#f0f4ff' }}>
                {pick(T.modalTitulo)}
              </div>
              <button onClick={() => setViolacoesModal(null)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>

            {violacoesModal.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,.5)', fontSize: 13 }}>
                {pick(T.modalTudoOk)}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>
                  {T.modalSubtitulo[lang](violacoesModal.length)}<strong style={{ color: '#f0f4ff' }}>tarefas_logistica</strong>.
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {violacoesModal.map(({ parking: p, cfg, deficit, pctDisp }) => (
                    <div key={p.id} style={{
                      background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '8px 10px',
                      border: `1px solid ${M_COR[p.monitorLevel!]}33`,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{
                        background: M_COR[p.monitorLevel!], color: '#fff',
                        borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 800, flexShrink: 0,
                      }}>{p.monitorLevel}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#f0f4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.id}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }}>
                          {T.modalDispMin[lang](p.availableCount ?? 0, p.target_bikes_count ?? 0, pctDisp, cfg.thresholdPct)}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444' }}>-{deficit}</div>
                        <div style={{ fontSize: 8, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase' }}>{cfg.prioridade}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setViolacoesModal(null); }}
                    style={{
                      flex: 1, padding: '9px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
                      background: 'transparent', color: 'rgba(255,255,255,.5)', fontSize: 12, cursor: 'pointer', fontWeight: 700,
                    }}>{pick(T.cancelar)}</button>
                  <button
                    onClick={async () => {
                      const criadas = await criarTarefasMonitor(violacoesModal);
                      if (criadas > 0) setViolacoesModal(null);
                    }}
                    disabled={criandoTarefas}
                    style={{
                      flex: 2, padding: '9px', borderRadius: 8, border: 'none',
                      background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12,
                      cursor: criandoTarefas ? 'wait' : 'pointer', fontWeight: 800,
                    }}>
                    {criandoTarefas ? pick(T.criando) : T.criarNTarefas[lang](violacoesModal.length)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Painel de Config dos Monitores ────────────────────────────────── */}
      {showConfigMonitor && cidade && (
        <MonitorConfigPanel
          cidade={cidade}
          onFechar={() => setShowConfigMonitor(false)}
        />
      )}

      {/* ── Painel de Eventos GoJet ───────────────────────────────────────── */}
      {showEventosPanel && cidade && (
        <EventoGoJetPanel
          cidade={cidade}
          parkings={parkings}
          mapa={mapa}
          onFechar={() => setShowEventosPanel(false)}
          onEstacaoCriada={() => {
            // Recarrega estações e snapshot com o novo ponto temporário
            carregarSnapshot();
          }}
        />
      )}

      {/* Admin bike actions modal */}
      {adminAction && isAdmin && gestorUid && (
        <AdminBikeActionsLazy
          modo={adminAction.modo}
          cidade={cidade ?? ''}
          gestorUid={gestorUid}
          gestorNome={gestorNome ?? ''}
          parkingAlvo={adminAction.parkingAlvo as any}
          bikeAlvo={adminAction.bikeAlvo as any}
          parkings={parkings as any}
          bikes={bikes as any}
          onFechar={() => setAdminAction(null)}
          onCriado={() => setAdminAction(null)}
        />
      )}
    </>
  );
}
