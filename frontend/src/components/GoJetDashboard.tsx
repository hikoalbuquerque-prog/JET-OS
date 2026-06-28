// frontend/src/components/GoJetDashboard.tsx
// Dashboard expandido GoJet — visualização rápida por cidade
// Exibe: pontos (status, cores, targets), patinetes (status, bateria), workers online
// Dados: Supabase (parkings/bikes tables + gps via usuarios.ultima_pos)

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { fetchGojetSnapshot, fetchPontosVazios, type PontoVazio } from '../lib/analytics-supabase';
import { classifyBike as classifyBikeShared, BIKE_STATUS_HEX, computeFleetStats } from '../lib/bike-classify';
import { colorForParking } from '../lib/parking-colors';
import { computeZoneAnalytics, type ZonePolygon, type ZoneStats } from '../lib/zone-analytics';

// ─── i18n (pt fonte, padrão TermosUsoGate: sem json) ─────────────────────────

type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const TXT: Record<string, Tr> = {
  // Header
  dashTodas:   { pt:'Todas as cidades', en:'All cities', es:'Todas las ciudades', ru:'Все города' },
  pontosLbl:   { pt:'pontos', en:'points', es:'puntos', ru:'точки' },
  patinetesLbl:{ pt:'patinetes', en:'scooters', es:'patinetes', ru:'самокаты' },
  dadosDe:     { pt:'dados de', en:'data from', es:'datos de', ru:'данные от' },
  agora:       { pt:'agora', en:'now', es:'ahora', ru:'сейчас' },
  minAtras:    { pt:'min atrás', en:'min ago', es:'min atrás', ru:'мин назад' },
  fechar:      { pt:'Fechar', en:'Close', es:'Cerrar', ru:'Закрыть' },
  // Tabs
  tabResumo:    { pt:'Resumo', en:'Summary', es:'Resumen', ru:'Сводка' },
  tabPontos:    { pt:'Pontos', en:'Points', es:'Puntos', ru:'Точки' },
  tabPatinetes: { pt:'Patinetes', en:'Scooters', es:'Patinetes', ru:'Самокаты' },
  tabWorkers:   { pt:'Workers', en:'Workers', es:'Workers', ru:'Работники' },
  tabZonas:     { pt:'Zonas', en:'Zones', es:'Zonas', ru:'Зоны' },
  // Zonas
  zonaNome:     { pt:'Zona', en:'Zone', es:'Zona', ru:'Зона' },
  zonaEfic:     { pt:'Eficiência', en:'Efficiency', es:'Eficiencia', ru:'Эффективность' },
  zonaPontos:   { pt:'Pontos', en:'Points', es:'Puntos', ru:'Точки' },
  zonaMonitor:  { pt:'Monitor', en:'Monitor', es:'Monitor', ru:'Монитор' },
  zonaVazios:   { pt:'Vazios', en:'Empty', es:'Vacíos', ru:'Пустые' },
  zonaBikes:    { pt:'Bikes', en:'Bikes', es:'Bikes', ru:'Байки' },
  zonaFora:     { pt:'Fora', en:'Out', es:'Fuera', ru:'Вне' },
  zonaSemZonas: { pt:'Nenhuma zona cadastrada', en:'No zones registered', es:'Sin zonas registradas', ru:'Нет зон' },
  zonaMonitoresVazios: { pt:'Monitores vazios', en:'Empty monitors', es:'Monitores vacíos', ru:'Пустые мониторы' },
  // Eficiência + Bateria
  eficienciaTit:  { pt:'Eficiência por operador (7d)', en:'Operator efficiency (7d)', es:'Eficiencia por operador (7d)', ru:'Эффективность по оператору (7д)' },
  efNome:         { pt:'Operador', en:'Operator', es:'Operador', ru:'Оператор' },
  efTarefas:      { pt:'Tarefas', en:'Tasks', es:'Tareas', ru:'Задачи' },
  efEntregas:     { pt:'Entregas', en:'Deliveries', es:'Entregas', ru:'Доставки' },
  efScore:        { pt:'Score', en:'Score', es:'Puntaje', ru:'Баллы' },
  efSem:          { pt:'Sem dados de tarefas', en:'No task data', es:'Sin datos de tareas', ru:'Нет данных о задачах' },
  batBaixa:       { pt:'Bateria mais baixa', en:'Lowest battery', es:'Batería más baja', ru:'Самый низкий заряд' },
  // KPIs resumo
  kpiPontosTotal: { pt:'Pontos total', en:'Total points', es:'Puntos total', ru:'Всего точек' },
  kpiZerados:     { pt:'Zerados', en:'Empty', es:'Vacíos', ru:'Пустые' },
  kpiMenos50:     { pt:'< 50%', en:'< 50%', es:'< 50%', ru:'< 50%' },
  kpiNoTarget:    { pt:'No target', en:'On target', es:'En objetivo', ru:'В норме' },
  kpiDisponiveis: { pt:'Disponíveis', en:'Available', es:'Disponibles', ru:'Доступно' },
  kpiTotalFisico: { pt:'Total físico', en:'Physical total', es:'Total físico', ru:'Всего физически' },
  vaziosTitulo:   { pt:'Vazios há mais tempo', en:'Empty the longest', es:'Vacíos hace más tiempo', ru:'Дольше всего пустые' },
  vaziosMais:     { pt:'mais', en:'more', es:'más', ru:'ещё' },
  // Cards resumo
  statusPontos:   { pt:'Status dos Pontos', en:'Points Status', es:'Estado de los Puntos', ru:'Статус точек' },
  workersMonitor: { pt:'Workers & Monitor', en:'Workers & Monitor', es:'Workers & Monitor', ru:'Работники и мониторинг' },
  online30:       { pt:'Online (30min)', en:'Online (30min)', es:'En línea (30min)', ru:'Онлайн (30мин)' },
  total1h:        { pt:'Total (1h)', en:'Total (1h)', es:'Total (1h)', ru:'Всего (1ч)' },
  estacoesMonitor:{ pt:'Estações Monitor vinculadas', en:'Linked Monitor stations', es:'Estaciones Monitor vinculadas', ru:'Связанные станции мониторинга' },
  pontosGoJet:    { pt:'pontos GoJet', en:'GoJet points', es:'puntos GoJet', ru:'точки GoJet' },
  foraPonto:      { pt:'Fora de ponto', en:'Out of point', es:'Fuera de punto', ru:'Вне точки' },
  // Legenda
  legendaCompleta:{ pt:'Legenda completa', en:'Full legend', es:'Leyenda completa', ru:'Полная легенда' },
  legPontos:      { pt:'PONTOS (parkings)', en:'POINTS (parkings)', es:'PUNTOS (parkings)', ru:'ТОЧКИ (парковки)' },
  legPatinetes:   { pt:'PATINETES', en:'SCOOTERS', es:'PATINETES', ru:'САМОКАТЫ' },
  legWorkers:     { pt:'WORKERS', en:'WORKERS', es:'WORKERS', ru:'РАБОТНИКИ' },
  pCircular:      { pt:'P circular', en:'Circular P', es:'P circular', ru:'Круглый P' },
  pCircularDesc:  { pt:'= Ponto monitorado (com target)', en:'= Monitored point (with target)', es:'= Punto monitoreado (con objetivo)', ru:'= Отслеживаемая точка (с целью)' },
  pQuadrado:      { pt:'P quadrado', en:'Square P', es:'P cuadrado', ru:'Квадратный P' },
  pQuadradoDesc:  { pt:'= Ponto neutro (sem target)', en:'= Neutral point (no target)', es:'= Punto neutro (sin objetivo)', ru:'= Нейтральная точка (без цели)' },
  badgeDesc:      { pt:'= estação JET OS a', en:'= JET OS station at', es:'= estación JET OS a', ru:'= станция JET OS в' },
  barrinhaBat:    { pt:'Barrinha colorida abaixo = nível de bateria', en:'Colored bar below = battery level', es:'Barra de color abajo = nivel de batería', ru:'Цветная полоса ниже = уровень заряда' },
  batOk:          { pt:'ok', en:'ok', es:'ok', ru:'норм' },
  gpsVerde:       { pt:'Verde', en:'Green', es:'Verde', ru:'Зелёный' },
  gpsAmarelo:     { pt:'Amarelo', en:'Yellow', es:'Amarillo', ru:'Жёлтый' },
  gpsLaranja:     { pt:'Laranja', en:'Orange', es:'Naranja', ru:'Оранжевый' },
  gpsCinza:       { pt:'Cinza', en:'Gray', es:'Gris', ru:'Серый' },
  gpsOffline:     { pt:'offline', en:'offline', es:'sin conexión', ru:'офлайн' },
  // Filtros pontos
  buscarPonto:    { pt:'Buscar ponto...', en:'Search point...', es:'Buscar punto...', ru:'Поиск точки...' },
  todos:          { pt:'Todos', en:'All', es:'Todos', ru:'Все' },
  sortStatus:     { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
  sortAZ:         { pt:'A-Z', en:'A-Z', es:'A-Z', ru:'А-Я' },
  sortQty:        { pt:'Qty', en:'Qty', es:'Cant.', ru:'Кол-во' },
  // Tabela pontos
  thStatus:       { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
  thNome:         { pt:'Nome', en:'Name', es:'Nombre', ru:'Имя' },
  thDisponivel:   { pt:'Disponível', en:'Available', es:'Disponible', ru:'Доступно' },
  thFisico:       { pt:'Físico', en:'Physical', es:'Físico', ru:'Физически' },
  thTarget:       { pt:'Target', en:'Target', es:'Objetivo', ru:'Цель' },
  thOcupacao:     { pt:'Ocupação', en:'Occupancy', es:'Ocupación', ru:'Заполнение' },
  thMonitor:      { pt:'Monitor', en:'Monitor', es:'Monitor', ru:'Монитор' },
  nenhumPonto:    { pt:'Nenhum ponto', en:'No points', es:'Ningún punto', ru:'Нет точек' },
  pontosExibidos: { pt:'pontos exibidos', en:'points shown', es:'puntos mostrados', ru:'точек показано' },
  // Patinetes
  buscarId:       { pt:'Buscar por ID...', en:'Search by ID...', es:'Buscar por ID...', ru:'Поиск по ID...' },
  limpar:         { pt:'Limpar', en:'Clear', es:'Limpiar', ru:'Очистить' },
  thIdNome:       { pt:'ID / Nome', en:'ID / Name', es:'ID / Nombre', ru:'ID / Имя' },
  thBateria:      { pt:'Bateria', en:'Battery', es:'Batería', ru:'Заряд' },
  thEmPonto:      { pt:'Em ponto', en:'At point', es:'En punto', ru:'В точке' },
  thSubStatus:    { pt:'Sub-status', en:'Sub-status', es:'Sub-estado', ru:'Под-статус' },
  nenhumPatinete: { pt:'Nenhum patinete', en:'No scooters', es:'Ningún patinete', ru:'Нет самокатов' },
  emPontoSim:     { pt:'Em ponto', en:'At point', es:'En punto', ru:'В точке' },
  foraLbl:        { pt:'Fora', en:'Out', es:'Fuera', ru:'Вне' },
  maisRefine:     { pt:'mais — use o filtro para refinar', en:'more — use the filter to refine', es:'más — use el filtro para refinar', ru:'ещё — используйте фильтр для уточнения' },
  // Workers
  kpiGps5:        { pt:'GPS < 5min', en:'GPS < 5min', es:'GPS < 5min', ru:'GPS < 5мин' },
  kpiGps15:       { pt:'GPS < 15min', en:'GPS < 15min', es:'GPS < 15min', ru:'GPS < 15мин' },
  kpiGps30:       { pt:'GPS < 30min', en:'GPS < 30min', es:'GPS < 30min', ru:'GPS < 30мин' },
  kpiTotal1h:     { pt:'Total 1h', en:'Total 1h', es:'Total 1h', ru:'Всего 1ч' },
  thUltimoGps:    { pt:'Último GPS', en:'Last GPS', es:'Último GPS', ru:'Последний GPS' },
  thLocalizacao:  { pt:'Localização', en:'Location', es:'Ubicación', ru:'Местоположение' },
  nenhumWorker:   { pt:'Nenhum worker online', en:'No workers online', es:'Ningún worker en línea', ru:'Нет работников онлайн' },
  min:            { pt:'min', en:'min', es:'min', ru:'мин' },
  // Status pontos (label)
  pontoRed:       { pt:'Zerado', en:'Empty', es:'Vacío', ru:'Пусто' },
  pontoOrange:    { pt:'< 50% target', en:'< 50% target', es:'< 50% objetivo', ru:'< 50% цели' },
  pontoYellow:    { pt:'50–85% target', en:'50–85% target', es:'50–85% objetivo', ru:'50–85% цели' },
  pontoBlue:      { pt:'No target', en:'On target', es:'En objetivo', ru:'В норме' },
  pontoGreen:     { pt:'Excedente', en:'Surplus', es:'Excedente', ru:'Избыток' },
  pontoGray:      { pt:'Sem target', en:'No target', es:'Sin objetivo', ru:'Без цели' },
  // Status bikes (label)
  bikeAvailable:  { pt:'Disponível', en:'Available', es:'Disponible', ru:'Доступен' },
  bikeLowBattery: { pt:'Bat. baixa', en:'Low batt.', es:'Bat. baja', ru:'Низкий заряд' },
  bikeRenting:    { pt:'Em aluguel', en:'In rental', es:'En alquiler', ru:'В аренде' },
  bikeReserved:   { pt:'Reservado', en:'Reserved', es:'Reservado', ru:'Зарезервирован' },
  bikeMaintenance:{ pt:'Manutenção', en:'Maintenance', es:'Mantenimiento', ru:'Обслуживание' },
  bikeWorkshop:   { pt:'Oficina', en:'Workshop', es:'Taller', ru:'Мастерская' },
  bikeApreendidos:{ pt:'Apreendido', en:'Seized', es:'Incautado', ru:'Изъят' },
  kpiOperacional: { pt:'Operacional', en:'Operational', es:'Operacional', ru:'В работе' },
  kpiOcioso48:    { pt:'Ociosas >48h', en:'Idle >48h', es:'Ociosas >48h', ru:'Простой >48ч' },
  kpiOficina:     { pt:'Em oficina', en:'In workshop', es:'En taller', ru:'В мастерской' },
  kpiApreendidos: { pt:'Apreendidos', en:'Seized', es:'Incautados', ru:'Изъятые' },
  kpiForaDisponiveis: { pt:'Fora (disponíveis)', en:'Out (available)', es:'Fuera (disponibles)', ru:'Вне (доступные)' },
};

// Mapeia chave de status de ponto → chave em TXT
const PONTO_LABEL_KEY: Record<string, string> = {
  red:'pontoRed', orange:'pontoOrange', yellow:'pontoYellow', blue:'pontoBlue', green:'pontoGreen', gray:'pontoGray',
};
// Mapeia chave de status de bike → chave em TXT
const BIKE_LABEL_KEY: Record<string, string> = {
  available:'bikeAvailable', low_battery:'bikeLowBattery', renting:'bikeRenting',
  reserved:'bikeReserved', maintenance:'bikeMaintenance', workshop:'bikeWorkshop',
  oficina:'bikeWorkshop', apreendidos:'bikeApreendidos',
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface GoJetParking {
  id: string; name: string; monitor?: boolean;
  bikes_count?: number; target_bikes_count?: number;
  latitude: number; longitude: number;
  availableCount?: number; rentingCount?: number;
  monitorLevel?: 'M1'|'M2'|'M3'|null;
}
interface GoJetBike {
  id: string; identifier?: string; name?: string; model?: string;
  business_status?: string; business_sub_status?: string;
  disabled?: boolean; ordered?: boolean; booked?: boolean; service_mode?: boolean;
  battery_percent?: number;
  last_order_at?: string|null;
  parking_id?: string|null;
  location_lat: number; location_lng: number;
}
interface GpsWorker {
  uid: string; nome?: string; lat?: number; lng?: number; atualizadoEm?: Date | any;
}

function parsePostGISPoint(geo: any): { lat: number; lng: number } | null {
  if (!geo) return null;
  if (typeof geo === 'object' && geo.coordinates) {
    return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
  }
  if (typeof geo === 'string') {
    const m = geo.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (m) return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }
  return null;
}

type BikeStatus = 'available'|'renting'|'reserved'|'maintenance'|'workshop'|'low_battery';
type TabId = 'pontos'|'patinetes'|'workers'|'resumo'|'zonas';

interface Props { visivel: boolean; onFechar: () => void; cidade?: string; }

// ─── Classificação patinetes — usa lib compartilhada ─────────────────────────

function classifyBike(b: GoJetBike): BikeStatus {
  return classifyBikeShared(b) as BikeStatus;
}

// ─── Cores dos pontos — usa lib compartilhada ─────────────────────────────────

const COR_PONTO: Record<string, { bg:string; borda:string; txt:string; emoji:string; label:string }> = {
  red:    { bg:'#7f1d1d', borda:'#ef4444', txt:'#fca5a5', emoji:'🔴', label:'Zerado'        },
  orange: { bg:'#78350f', borda:'#f59e0b', txt:'#fde68a', emoji:'🟠', label:'< 50% target'  },
  yellow: { bg:'#422006', borda:'#d97706', txt:'#fde68a', emoji:'🟡', label:'50–85% target'  },
  blue:   { bg:'#172554', borda:'#3b82f6', txt:'#93c5fd', emoji:'🔵', label:'No target'     },
  green:  { bg:'#052e16', borda:'#22c55e', txt:'#86efac', emoji:'🟢', label:'Excedente'     },
  gray:   { bg:'#1e293b', borda:'#475569', txt:'#94a3b8', emoji:'⚫', label:'Sem target'    },
};

// Mapeamento colorForParking (red/orange/yellow/blue/green/gray) → sort por criticidade
const SORT_ORDER_PONTO = ['red','orange','yellow','gray','blue','green'];

const COR_BIKE: Record<string, { cor: string; emoji: string; label: string }> = {
  available:   { cor:'#22c55e', emoji:'🟢', label:'Disponível'   },
  low_battery: { cor:'#f97316', emoji:'🟠', label:'Bat. baixa'   },
  renting:     { cor:'#eab308', emoji:'🟡', label:'Em aluguel'   },
  reserved:    { cor:'#64748b', emoji:'⚫', label:'Reservado'     },
  maintenance: { cor:'#ef4444', emoji:'🔴', label:'Manutenção'   },
  workshop:    { cor:'#a855f7', emoji:'🟣', label:'Oficina'       },
  oficina:     { cor:'#a855f7', emoji:'🟣', label:'Oficina'       },
  apreendidos: { cor:'#dc2626', emoji:'🟥', label:'Apreendido'   },
};

const M_COR: Record<string, string> = { M1:'#10b981', M2:'#3b82f6', M3:'#f59e0b' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyParking(p: GoJetParking): string {
  return colorForParking({ monitor: p.monitor, availableCount: p.availableCount, target_bikes_count: p.target_bikes_count });
}

function mAtras(ts: any): number {
  if (!ts) return 9999;
  const d = ts?.toDate?.() ?? new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / 60000);
}

function pct(n: number, total: number): string {
  if (!total) return '—';
  return `${Math.round(n / total * 100)}%`;
}

// ─── Design ───────────────────────────────────────────────────────────────────

const T = {
  bg:'rgba(13,18,30,1)', sur:'rgba(13,18,30,.97)', card:'rgba(22,28,40,.95)',
  bdr:'rgba(255,255,255,.08)', bdr2:'rgba(255,255,255,.04)',
  blueg:'linear-gradient(135deg,#1a6fd4,#307FE2)',
  txt:'#e2e8f0', dim:'#8a96b0',
};

const S = {
  overlay: { position:'fixed' as const, inset:0, zIndex:4800, background:'rgba(0,0,0,.7)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  panel: { background:T.bg, border:`1px solid ${T.bdr}`, borderRadius:16, width:'100%', maxWidth:900, maxHeight:'92vh', display:'flex', flexDirection:'column' as const, overflow:'hidden' as const, fontFamily:"'Inter',-apple-system,sans-serif" },
  header: { background:T.sur, backdropFilter:'blur(12px)', borderBottom:`1px solid ${T.bdr}`, padding:'12px 18px', display:'flex', alignItems:'center', gap:12, flexShrink:0 },
  tabs: { display:'flex', borderBottom:`1px solid ${T.bdr}`, background:T.sur, flexShrink:0 },
  tab: (a:boolean): React.CSSProperties => ({ padding:'10px 16px', fontSize:13, fontWeight:600, color:a?'#307FE2':T.dim, background:'none', border:'none', borderBottom:`2px solid ${a?'#307FE2':'transparent'}`, cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s' }),
  body: { flex:1, overflowY:'auto' as const, padding:16, scrollbarWidth:'thin' as const },
  kpiRow: { display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' as const },
  kpi: (c:string): React.CSSProperties => ({ flex:1, minWidth:80, background:T.card, border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, borderRadius:12, padding:'10px 12px' }),
  kpiN: (c:string): React.CSSProperties => ({ fontSize:24, fontWeight:800, color:c, lineHeight:1 }),
  kpiL: { fontSize:10, color:T.dim, marginTop:2, textTransform:'uppercase' as const, letterSpacing:'0.4px' },
  card: (c?:string): React.CSSProperties => ({ background:T.card, border:`1px solid ${c?c+'33':T.bdr}`, borderTop:`2px solid ${c||T.bdr}`, borderRadius:12, padding:'12px 14px', marginBottom:10 }),
  table: { width:'100%', borderCollapse:'collapse' as const },
  th: { padding:'8px 10px', fontSize:10, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase' as const, color:T.dim, borderBottom:`1px solid ${T.bdr}`, textAlign:'left' as const, whiteSpace:'nowrap' as const },
  td: { padding:'8px 10px', fontSize:12, borderBottom:`1px solid ${T.bdr2}` },
  chip: (c:string): React.CSSProperties => ({ display:'inline-block', padding:'2px 7px', borderRadius:20, background:c+'18', color:c, fontSize:10, fontWeight:700, border:`1px solid ${c}33` }),
  inp: { padding:'7px 10px', borderRadius:8, background:'rgba(255,255,255,.06)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:12, outline:'none', width:'100%' },
};

// ─── Barra de progresso ───────────────────────────────────────────────────────

function Barra({ val, max, cor }: { val: number; max: number; cor: string }) {
  const w = max > 0 ? Math.min(100, val / max * 100) : 0;
  return (
    <div style={{ height:6, background:'rgba(255,255,255,.06)', borderRadius:3, overflow:'hidden', marginTop:3 }}>
      <div style={{ height:'100%', width:`${w}%`, background:cor, borderRadius:3, transition:'width .4s' }}/>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function GoJetDashboard({ visivel, onFechar, cidade }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const t = (k: keyof typeof TXT) => pick(TXT[k]);
  const labelPonto = (key: string) => pick(TXT[PONTO_LABEL_KEY[key]] ?? TXT.pontoGray);
  const labelBike = (key: string) => pick(TXT[BIKE_LABEL_KEY[key]] ?? TXT.bikeAvailable);

  const [tab,      setTab     ] = useState<TabId>('resumo');
  const [parkings, setParkings] = useState<GoJetParking[]>([]);
  const [bikes,    setBikes   ] = useState<GoJetBike[]>([]);
  const [vazios,   setVazios  ] = useState<PontoVazio[]>([]);
  const [workers,  setWorkers ] = useState<GpsWorker[]>([]);
  const [freshness,setFreshness] = useState<Date|null>(null);
  const [busca,    setBusca   ] = useState('');
  const [filtroP,  setFiltroP ] = useState<keyof typeof COR_PONTO|'todos'>('todos');
  const [filtroB,  setFiltroB ] = useState<BikeStatus|'todos'>('todos');
  const [sortP,    setSortP   ] = useState<'status'|'nome'|'avail'>('status');
  const [sortDirP, setSortDirP] = useState<'asc'|'desc'>('asc');
  const [zonas,    setZonas   ] = useState<ZonePolygon[]>([]);
  const [eficiencia, setEficiencia] = useState<any[]>([]);
  const [lowBat,   setLowBat  ] = useState<any[]>([]);

  // Carrega parkings + bikes do Supabase
  useEffect(() => {
    if (!visivel || !cidade) return;

    fetchGojetSnapshot(cidade).then(({ parkings: p, bikes: b, savedAtMs }) => {
      setParkings(p as GoJetParking[]);
      setBikes(b as GoJetBike[]);
      if (savedAtMs) setFreshness(new Date(savedAtMs));
    }).catch(e => console.error('[GoJetDash] snapshot:', e));

    // Duração de pontos vazios (parking_history via RPC 0044) — independente do snapshot.
    fetchPontosVazios(cidade).then(setVazios).catch(e => console.warn('[GoJetDash] vazios:', e));

    // Zonas (para aba Zonas)
    (async () => {
      let q = supabase.from('zonas_geo').select('*').eq('ativo', true);
      if (cidade) q = q.eq('cidade', cidade);
      const { data } = await q;
      if (data) {
        setZonas(data.map((z: any) => {
          const geojson = typeof z.geojson === 'string' ? JSON.parse(z.geojson) : z.geojson;
          const coords: [number, number][] = geojson?.coordinates?.[0] ?? [];
          return { id: z.id ?? z.firebase_id, nome: z.nome, cor: z.cor, coordenadas: coords };
        }));
      }
    })().catch(e => console.warn('[GoJetDash] zonas:', e));

    // Eficiência por operador (RPC)
    (async () => {
      const { data } = await supabase.rpc('operator_efficiency', { p_days: 7 });
      if (data) setEficiencia(data);
    })().catch(() => {});

    // Bateria mais baixa
    (async () => {
      const { data } = await supabase.rpc('low_battery_bikes', { p_city_id: cidade || null, p_limit: 20 });
      if (data) setLowBat(data);
    })().catch(() => {});
  }, [visivel, cidade]);

  // Workers GPS — lê usuarios com ultima_pos recente (Supabase) + Realtime
  useEffect(() => {
    if (!visivel) return;

    async function fetchWorkers() {
      const since = new Date(Date.now() - 30 * 60000).toISOString();
      let q = supabase
        .from('usuarios')
        .select('id, nome, cidade, ultima_pos, ultima_pos_em, ultima_velocidade')
        .gte('ultima_pos_em', since)
        .not('ultima_pos', 'is', null);
      if (cidade) q = q.eq('cidade', cidade);
      const { data } = await q;
      if (data) setWorkers(data.map((u: any) => {
        const coords = u.ultima_pos ? parsePostGISPoint(u.ultima_pos) : null;
        return {
          uid: u.id, nome: u.nome,
          lat: coords?.lat, lng: coords?.lng,
          atualizadoEm: u.ultima_pos_em ? new Date(u.ultima_pos_em) : undefined,
        } as GpsWorker;
      }));
    }
    fetchWorkers();

    // Realtime: escuta UPDATE em usuarios onde ultima_pos_em mudou
    const channel = supabase
      .channel('dashboard-workers')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'usuarios',
        filter: cidade ? `cidade=eq.${cidade}` : undefined,
      }, (payload: any) => {
        const u = payload.new;
        if (!u.ultima_pos || !u.ultima_pos_em) return;
        const age = Date.now() - new Date(u.ultima_pos_em).getTime();
        if (age > 30 * 60000) return;
        const coords = parsePostGISPoint(u.ultima_pos);
        if (!coords) return;
        setWorkers(prev => {
          const next = prev.filter(w => w.uid !== u.id);
          next.push({
            uid: u.id, nome: u.nome,
            lat: coords.lat, lng: coords.lng,
            atualizadoEm: new Date(u.ultima_pos_em),
          });
          return next;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [visivel, cidade]);

  if (!visivel) return null;

  // ── Stats globais ─────────────────────────────────────────────────────────

  const byStatus: Record<string, GoJetParking[]> = {
    red: [], orange: [], yellow: [], blue: [], green: [], gray: [],
  };
  parkings.forEach(p => byStatus[classifyParking(p)]?.push(p));

  const totalAvail  = parkings.reduce((s,p) => s + (p.availableCount ?? 0), 0);
  const totalFisico = parkings.reduce((s,p) => s + (p.bikes_count ?? 0), 0);
  const monitorados = parkings.filter(p => p.monitorLevel);

  const bikeStats: Record<BikeStatus, number> = { available:0, low_battery:0, renting:0, reserved:0, maintenance:0, workshop:0 };
  bikes.forEach(b => { bikeStats[classifyBike(b)]++; });
  const foraPonto = bikes.filter(b => !b.parking_id).length;
  const fleet = computeFleetStats(bikes);

  const online30 = workers.filter(w => mAtras(w.atualizadoEm) < 30).length;

  // Zone analytics
  const zoneStats = useMemo(() => {
    if (!zonas.length || !parkings.length) return [] as ZoneStats[];
    const pPoints = parkings.map(p => ({
      id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude,
      monitor: p.monitor, availableCount: p.availableCount, target_bikes_count: p.target_bikes_count,
    }));
    const bPoints = bikes.map(b => ({
      id: b.id, location_lat: b.location_lat, location_lng: b.location_lng,
      parking_id: b.parking_id, business_status: b.business_status,
      business_sub_status: b.business_sub_status, disabled: b.disabled,
      ordered: b.ordered, booked: b.booked, service_mode: b.service_mode,
      battery_percent: b.battery_percent,
    }));
    return computeZoneAnalytics(zonas, pPoints, bPoints);
  }, [zonas, parkings, bikes]);

  // ── Filtros ───────────────────────────────────────────────────────────────

  const parkingsFilt = useMemo(() => {
    let list = parkings;
    if (filtroP !== 'todos') list = byStatus[filtroP] || [];
    if (busca) list = list.filter(p => p.name?.toLowerCase().includes(busca.toLowerCase()));
    const dir = sortDirP === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortP === 'nome') return dir * (a.name||'').localeCompare(b.name||'');
      if (sortP === 'avail') return dir * ((b.availableCount??0) - (a.availableCount??0));
      return dir * (SORT_ORDER_PONTO.indexOf(classifyParking(a)) - SORT_ORDER_PONTO.indexOf(classifyParking(b)));
    });
  }, [parkings, filtroP, busca, sortP, sortDirP]);

  const bikesFilt = useMemo(() => {
    let list = bikes;
    if (filtroB !== 'todos') list = list.filter(b => classifyBike(b) === filtroB);
    if (busca && tab === 'patinetes') list = list.filter(b => (b.identifier||b.name||'').toLowerCase().includes(busca.toLowerCase()));
    return list;
  }, [bikes, filtroB, busca, tab]);

  // ── Freshness ─────────────────────────────────────────────────────────────

  const freshMin = freshness ? Math.floor((Date.now() - freshness.getTime()) / 60000) : null;
  const freshCor = freshMin === null ? T.dim : freshMin < 3 ? '#22c55e' : freshMin < 8 ? '#f59e0b' : '#ef4444';

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={S.panel}>

        {/* Header */}
        <div style={S.header}>
          <div style={{ width:36, height:36, borderRadius:10, background:T.blueg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>🛴</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:15, color:T.txt }}>
              GoJet Dashboard{cidade ? ` — ${cidade}` : ` — ${t('dashTodas')}`}
            </div>
            <div style={{ fontSize:11, color:T.dim }}>
              {parkings.length} {t('pontosLbl')} · {bikes.length} {t('patinetesLbl')}
              {freshMin !== null && (
                <span style={{ color:freshCor, marginLeft:8 }}>
                  ● {t('dadosDe')} {freshMin < 1 ? t('agora') : `${freshMin}${t('minAtras')}`}
                </span>
              )}
            </div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:`1px solid ${T.bdr}`, borderRadius:8, color:T.dim, cursor:'pointer', padding:'6px 12px', fontSize:12 }}>✕ {t('fechar')}</button>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {([
            ['resumo',    `📊 ${t('tabResumo')}`   ],
            ['pontos',    `🅿️ ${t('tabPontos')}`    ],
            ['patinetes', `🛴 ${t('tabPatinetes')}` ],
            ['workers',   `👷 ${t('tabWorkers')}`  ],
            ['zonas',     `🗺 ${t('tabZonas')}`    ],
          ] as [TabId,string][]).map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={S.tab(tab===id)}>{label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* ── RESUMO ──────────────────────────────────────────────────── */}
          {tab === 'resumo' && (
            <div>
              {/* KPIs principais */}
              <div style={S.kpiRow}>
                {[
                  { n:parkings.length,      l:t('kpiPontosTotal'),   c:'#307FE2' },
                  { n:byStatus.red.length,    l:`🔴 ${t('kpiZerados')}`,    c:'#ef4444' },
                  { n:byStatus.orange.length, l:`🟠 ${t('kpiMenos50')}`,      c:'#f59e0b' },
                  { n:(byStatus.blue.length??0)+(byStatus.green.length??0), l:`🔵🟢 ${t('kpiNoTarget')}`, c:'#22c55e' },
                  { n:totalAvail,            l:t('kpiDisponiveis'),   c:'#22c55e' },
                  { n:totalFisico,           l:t('kpiTotalFisico'),  c:'#94a3b8' },
                ].map(({n,l,c}) => (
                  <div key={l} style={S.kpi(c)}>
                    <div style={S.kpiN(c)}>{n}</div>
                    <div style={S.kpiL}>{l}</div>
                  </div>
                ))}
              </div>

              {/* KPIs operacionais — frota */}
              <div style={S.kpiRow}>
                {[
                  { n:fleet.operational,           l:`⚡ ${t('kpiOperacional')}`,    c:'#3b82f6' },
                  { n:fleet.idle48h,               l:`💤 ${t('kpiOcioso48')}`,       c:'#f97316' },
                  { n:fleet.oficina,               l:`🔧 ${t('kpiOficina')}`,        c:'#a855f7' },
                  { n:fleet.apreendidos,           l:`🚫 ${t('kpiApreendidos')}`,    c:'#dc2626' },
                  { n:fleet.outOfParkingAvailable, l:`📍 ${t('kpiForaDisponiveis')}`,c:'#eab308' },
                ].map(({n,l,c}) => (
                  <div key={l} style={S.kpi(c)}>
                    <div style={S.kpiN(c)}>{n}</div>
                    <div style={S.kpiL}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Distribuição por status - Pontos */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div style={S.card('#307FE2')}>
                  <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                    🅿️ {t('statusPontos')} ({parkings.length})
                  </div>
                  {Object.entries(COR_PONTO).map(([key, meta]) => {
                    const n = byStatus[key]?.length || 0;
                    const maxN = parkings.length || 1;
                    return (
                      <div key={key} style={{ marginBottom:8 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:2 }}>
                          <span style={{ color:T.txt }}>{meta.emoji} {labelPonto(key)}</span>
                          <span style={{ color:meta.borda, fontWeight:700 }}>{n} <span style={{ color:T.dim, fontWeight:400 }}>({pct(n,parkings.length)})</span></span>
                        </div>
                        <Barra val={n} max={maxN} cor={meta.borda}/>
                      </div>
                    );
                  })}
                </div>

                <div>
                  {/* Patinetes */}
                  <div style={S.card('#22c55e')}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                      🛴 {t('tabPatinetes')} ({bikes.length})
                    </div>
                    {(Object.entries(COR_BIKE) as [BikeStatus, typeof COR_BIKE[BikeStatus]][]).map(([key, meta]) => {
                      const n = bikeStats[key] || 0;
                      if (!n) return null;
                      return (
                        <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, marginBottom:6 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ width:10, height:10, borderRadius:'50%', background:meta.cor, flexShrink:0 }}/>
                            <span style={{ color:T.txt }}>{labelBike(key)}</span>
                          </div>
                          <span style={{ color:meta.cor, fontWeight:700 }}>{n} <span style={{ color:T.dim, fontWeight:400 }}>({pct(n,bikes.length)})</span></span>
                        </div>
                      );
                    })}
                    {foraPonto > 0 && (
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginTop:6, paddingTop:6, borderTop:`1px solid ${T.bdr}` }}>
                        <span style={{ color:'#f97316' }}>⚠️ {t('foraPonto')}</span>
                        <span style={{ color:'#f97316', fontWeight:700 }}>{foraPonto}</span>
                      </div>
                    )}
                  </div>

                  {/* Workers + Estações monitor */}
                  <div style={S.card('#a855f7')}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:8 }}>
                      👷 {t('workersMonitor')}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
                      <span style={{ color:T.txt }}>{t('online30')}</span>
                      <span style={{ color:'#4ade80', fontWeight:700 }}>{online30}</span>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
                      <span style={{ color:T.txt }}>{t('total1h')}</span>
                      <span style={{ color:T.txt, fontWeight:700 }}>{workers.length}</span>
                    </div>
                    {monitorados.length > 0 && (
                      <>
                        <div style={{ height:1, background:T.bdr, margin:'8px 0' }}/>
                        <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>{t('estacoesMonitor')}</div>
                        {(['M1','M2','M3'] as const).map(m => {
                          const n = parkings.filter(p => p.monitorLevel === m).length;
                          if (!n) return null;
                          return (
                            <div key={m} style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                              <span style={{ color:M_COR[m], fontWeight:700 }}>{m}</span>
                              <span style={{ color:T.dim }}>{n} {t('pontosGoJet')}</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Pontos vazios há mais tempo (duração via parking_history) */}
              {vazios.length > 0 && (
                <div style={S.card('#ef4444')}>
                  <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                    🔴 {t('vaziosTitulo')} ({vazios.length})
                  </div>
                  {vazios.slice(0, 8).map(v => {
                    const h = Math.floor(v.empty_minutes / 60);
                    const m = v.empty_minutes % 60;
                    const dur = h > 0 ? `${h}h ${m}${t('min')}` : `${m}${t('min')}`;
                    const urgente = v.empty_minutes >= 60;
                    return (
                      <div key={v.parking_id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, marginBottom:6 }}>
                        <span style={{ color:T.txt, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginRight:8 }}>
                          {v.is_monitor ? '⭐ ' : ''}{v.nome}
                        </span>
                        <span style={{ color:urgente ? '#ef4444' : '#f59e0b', fontWeight:700, flexShrink:0 }}>{dur}</span>
                      </div>
                    );
                  })}
                  {vazios.length > 8 && (
                    <div style={{ fontSize:11, color:T.dim, marginTop:4 }}>+{vazios.length - 8} {t('vaziosMais')}</div>
                  )}
                </div>
              )}

              {/* Legenda completa */}
              <div style={S.card()}>
                <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                  📖 {t('legendaCompleta')}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:T.dim, marginBottom:6 }}>{t('legPontos')}</div>
                    {Object.entries(COR_PONTO).map(([k, m]) => (
                      <div key={k} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                        <div style={{ width:14, height:14, borderRadius:3, background:m.bg, border:`2px solid ${m.borda}`, flexShrink:0 }}/>
                        <div>
                          <span style={{ fontSize:11, color:T.txt }}>{m.emoji} {labelPonto(k)}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop:8, fontSize:11, color:T.dim }}>
                      <span style={{ fontWeight:700, color:'#10b981' }}>{t('pCircular')}</span> {t('pCircularDesc')}<br/>
                      <span style={{ fontWeight:700, color:T.dim }}>{t('pQuadrado')}</span> {t('pQuadradoDesc')}
                    </div>
                    <div style={{ marginTop:6, fontSize:11, color:T.dim }}>
                      Badge <span style={{ color:'#10b981' }}>M1</span>/<span style={{ color:'#3b82f6' }}>M2</span>/<span style={{ color:'#f59e0b' }}>M3</span> {t('badgeDesc')} &lt;150m
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:T.dim, marginBottom:6 }}>{t('legPatinetes')}</div>
                    {(Object.entries(COR_BIKE) as [BikeStatus, typeof COR_BIKE[BikeStatus]][]).map(([k, m]) => (
                      <div key={k} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                        <div style={{ width:12, height:12, borderRadius:'50%', background:m.cor, flexShrink:0 }}/>
                        <span style={{ fontSize:11, color:T.txt }}>{m.emoji} {labelBike(k)}</span>
                      </div>
                    ))}
                    <div style={{ marginTop:8, fontSize:11, color:T.dim }}>
                      {t('barrinhaBat')}<br/>
                      <span style={{ color:'#ef4444' }}>🔴</span> &lt;20% · <span style={{ color:'#f97316' }}>🟠</span> &lt;40% · <span style={{ color:'#22c55e' }}>🟢</span> {t('batOk')}
                    </div>
                    <div style={{ marginTop:8, fontSize:11, fontWeight:700, color:T.dim }}>{t('legWorkers')}</div>
                    <div style={{ fontSize:11, color:T.dim, marginTop:4 }}>
                      <span style={{ color:'#22c55e' }}>● {t('gpsVerde')}</span> = GPS &lt;5min<br/>
                      <span style={{ color:'#f59e0b' }}>● {t('gpsAmarelo')}</span> = GPS 5–15min<br/>
                      <span style={{ color:'#f97316' }}>● {t('gpsLaranja')}</span> = GPS 15–30min<br/>
                      <span style={{ color:T.dim }}>● {t('gpsCinza')}</span> = {t('gpsOffline')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Eficiência por operador (P4) */}
              {eficiencia.length > 0 && (
                <div style={S.card('#3b82f6')}>
                  <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                    🏆 {t('eficienciaTit')}
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ ...S.table, minWidth:400 }}>
                      <thead><tr>
                        {[t('efNome'), t('efTarefas'), t('efEntregas'), t('efScore')].map(h => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {eficiencia.slice(0, 10).map((op: any, i: number) => {
                          const scoreCor = op.score >= 50 ? '#22c55e' : op.score >= 20 ? '#f59e0b' : '#ef4444';
                          return (
                            <tr key={op.user_id || i}>
                              <td style={{ ...S.td, fontWeight:600, color:T.txt }}>{op.nome || '—'}</td>
                              <td style={S.td}>
                                <span style={{ color:'#22c55e', fontWeight:700 }}>{op.tasks_done}</span>
                                <span style={{ color:T.dim }}>/{op.tasks_total}</span>
                              </td>
                              <td style={{ ...S.td, color:T.txt }}>{op.deliveries} ({op.bikes_moved} 🛴)</td>
                              <td style={S.td}>
                                <span style={{ color:scoreCor, fontWeight:800, fontSize:14 }}>{op.score}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Bateria mais baixa (P4) */}
              {lowBat.length > 0 && (
                <div style={S.card('#f97316')}>
                  <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                    🔋 {t('batBaixa')} (Top {lowBat.length})
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:6 }}>
                    {lowBat.map((b: any) => {
                      const pct = b.bateria ?? 0;
                      const cor = pct < 10 ? '#ef4444' : pct < 20 ? '#f97316' : pct < 40 ? '#f59e0b' : '#22c55e';
                      return (
                        <div key={b.bike_id} style={{ background:'rgba(255,255,255,.04)', borderRadius:8, padding:'6px 10px', border:`1px solid ${cor}22` }}>
                          <div style={{ fontSize:11, fontWeight:700, color:T.txt, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.bike_id.slice(-8)}</div>
                          <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                            <div style={{ flex:1, height:4, background:'rgba(255,255,255,.08)', borderRadius:2, overflow:'hidden' }}>
                              <div style={{ height:'100%', width:`${pct}%`, background:cor, borderRadius:2 }}/>
                            </div>
                            <span style={{ fontSize:11, fontWeight:700, color:cor }}>{pct}%</span>
                          </div>
                          <div style={{ fontSize:9, color:T.dim, marginTop:1 }}>{b.status}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PONTOS ──────────────────────────────────────────────────── */}
          {tab === 'pontos' && (
            <div>
              {/* Filtros */}
              <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={`🔍 ${t('buscarPonto')}`} style={{ ...S.inp, width:180, marginBottom:0 }}/>
                <button onClick={() => setFiltroP('todos')} style={{ padding:'6px 10px', borderRadius:8, border:'none', background:filtroP==='todos'?'#1a6fd4':'rgba(255,255,255,.06)', color:filtroP==='todos'?'#fff':T.dim, fontSize:11, fontWeight:600, cursor:'pointer' }}>{t('todos')} ({parkings.length})</button>
                {Object.entries(COR_PONTO).map(([key, meta]) => {
                  const n = byStatus[key]?.length || 0;
                  if (!n) return null;
                  return (
                    <button key={key} onClick={() => setFiltroP(key as any)}
                      style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${filtroP===key?meta.borda:T.bdr}`, background:filtroP===key?meta.bg:'transparent', color:filtroP===key?meta.txt:T.dim, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                      {meta.emoji} {n}
                    </button>
                  );
                })}
                <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
                  {(['status','nome','avail'] as const).map(s => (
                    <button key={s} onClick={() => { if (sortP === s) setSortDirP(d => d === 'asc' ? 'desc' : 'asc'); else { setSortP(s); setSortDirP('asc'); } }} style={{ padding:'5px 8px', borderRadius:7, border:'none', background:sortP===s?'rgba(26,111,212,.3)':'rgba(255,255,255,.06)', color:sortP===s?'#307FE2':T.dim, fontSize:10, cursor:'pointer' }}>
                      {(s==='status'?`🔴 ${t('sortStatus')}`:s==='nome'?t('sortAZ'):`📊 ${t('sortQty')}`) + (sortP===s ? (sortDirP==='asc'?' ▲':' ▼') : '')}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
                <table style={{ ...S.table, minWidth:700 }}>
                  <thead><tr>
                    {[t('thStatus'),t('thNome'),t('thDisponivel'),t('thFisico'),t('thTarget'),t('thOcupacao'),t('thMonitor')].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parkingsFilt.length === 0 && (
                      <tr><td colSpan={7} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>{t('nenhumPonto')}</td></tr>
                    )}
                    {parkingsFilt.map(p => {
                      const cl = classifyParking(p);
                      const meta = COR_PONTO[cl];
                      const avail = p.availableCount ?? 0;
                      const fisico = p.bikes_count ?? 0;
                      const target = p.target_bikes_count ?? 0;
                      const ocupPct = target > 0 ? Math.round(avail / target * 100) : null;
                      return (
                        <tr key={p.id}>
                          <td style={S.td}><span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:20, fontSize:11, fontWeight:700, background:meta.bg, color:meta.txt, border:`1px solid ${meta.borda}` }}>{meta.emoji} {labelPonto(cl)}</span></td>
                          <td style={{ ...S.td, fontWeight:600, maxWidth:200 }}>
                            <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:T.txt }}>{p.name || p.id}</div>
                          </td>
                          <td style={{ ...S.td, fontWeight:700, color:meta.borda }}>{avail}</td>
                          <td style={{ ...S.td, color:T.dim }}>{fisico}</td>
                          <td style={{ ...S.td, color:T.dim }}>{target || '—'}</td>
                          <td style={{ ...S.td, minWidth:80 }}>
                            {ocupPct !== null ? (
                              <>
                                <div style={{ fontSize:11, color:meta.borda, fontWeight:700 }}>{ocupPct}%</div>
                                <Barra val={avail} max={target} cor={meta.borda}/>
                              </>
                            ) : <span style={{ color:T.dim }}>—</span>}
                          </td>
                          <td style={S.td}>
                            {p.monitorLevel ? (
                              <span style={{ padding:'2px 7px', borderRadius:8, background:M_COR[p.monitorLevel]+'22', color:M_COR[p.monitorLevel], fontSize:11, fontWeight:700, border:`1px solid ${M_COR[p.monitorLevel]}44` }}>
                                {p.monitorLevel}
                              </span>
                            ) : <span style={{ color:T.dim, fontSize:11 }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize:11, color:T.dim, marginTop:8 }}>{parkingsFilt.length} {t('pontosExibidos')}</div>
            </div>
          )}

          {/* ── PATINETES ───────────────────────────────────────────────── */}
          {tab === 'patinetes' && (
            <div>
              <div style={S.kpiRow}>
                {(Object.entries(COR_BIKE) as [BikeStatus, typeof COR_BIKE[BikeStatus]][]).map(([k, m]) => {
                  const n = bikeStats[k] || 0;
                  return (
                    <div key={k} style={{ ...S.kpi(m.cor), cursor:'pointer', opacity:filtroB!==k&&filtroB!=='todos'?.5:1 }} onClick={() => setFiltroB(filtroB===k?'todos':k)}>
                      <div style={S.kpiN(m.cor)}>{n}</div>
                      <div style={S.kpiL}>{m.emoji} {labelBike(k)}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={`🔍 ${t('buscarId')}`} style={{ ...S.inp, marginBottom:0, flex:1 }}/>
                <button onClick={() => { setFiltroB('todos'); setBusca(''); }} style={{ padding:'7px 12px', borderRadius:8, border:`1px solid ${T.bdr}`, background:'transparent', color:T.dim, fontSize:12, cursor:'pointer' }}>{t('limpar')}</button>
              </div>

              {filtroB !== 'todos' && (
                <div style={{ ...S.card(COR_BIKE[filtroB].cor), marginBottom:12 }}>
                  <div style={{ fontSize:12, color:T.txt }}>{COR_BIKE[filtroB].emoji} <b>{labelBike(filtroB)}</b> — {bikesFilt.length} {t('patinetesLbl')}</div>
                </div>
              )}

              <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
                <table style={{ ...S.table, minWidth:600 }}>
                  <thead><tr>
                    {[t('thStatus'),t('thIdNome'),t('thBateria'),t('thEmPonto'),t('thSubStatus')].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {bikesFilt.length === 0 && <tr><td colSpan={5} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>{t('nenhumPatinete')}</td></tr>}
                    {bikesFilt.slice(0, 200).map(b => {
                      const st = classifyBike(b);
                      const meta = COR_BIKE[st];
                      const pct = b.battery_percent;
                      const batCor = pct === undefined ? T.dim : pct < 0.2 ? '#ef4444' : pct < 0.4 ? '#f97316' : '#22c55e';
                      return (
                        <tr key={b.id}>
                          <td style={S.td}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ width:10, height:10, borderRadius:'50%', background:meta.cor, flexShrink:0 }}/>
                              <span style={{ fontSize:11, color:meta.cor, fontWeight:700 }}>{labelBike(st)}</span>
                            </div>
                          </td>
                          <td style={{ ...S.td, fontWeight:600 }}>
                            <div style={{ color:T.txt }}>{b.identifier || b.name || b.id.slice(-8)}</div>
                            <div style={{ fontSize:10, color:T.dim, fontFamily:'monospace' }}>{b.id.slice(-8)}</div>
                          </td>
                          <td style={S.td}>
                            {pct !== undefined ? (
                              <div style={{ minWidth:70 }}>
                                <div style={{ fontSize:12, color:batCor, fontWeight:700 }}>{Math.round(pct * 100)}%</div>
                                <div style={{ height:4, background:'rgba(255,255,255,.08)', borderRadius:2, overflow:'hidden', marginTop:2, width:60 }}>
                                  <div style={{ height:'100%', width:`${Math.round(pct*100)}%`, background:batCor, borderRadius:2 }}/>
                                </div>
                              </div>
                            ) : <span style={{ color:T.dim }}>—</span>}
                          </td>
                          <td style={S.td}>
                            {b.parking_id ? <span style={{ color:'#22c55e', fontSize:11 }}>✅ {t('emPontoSim')}</span> : <span style={{ color:'#f97316', fontSize:11 }}>⚠️ {t('foraLbl')}</span>}
                          </td>
                          <td style={{ ...S.td, fontSize:11, color:T.dim }}>{b.business_sub_status || '—'}</td>
                        </tr>
                      );
                    })}
                    {bikesFilt.length > 200 && (
                      <tr><td colSpan={5} style={{ ...S.td, textAlign:'center', color:T.dim, fontSize:11 }}>+ {bikesFilt.length - 200} {t('maisRefine')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── WORKERS ─────────────────────────────────────────────────── */}
          {tab === 'workers' && (
            <div>
              <div style={S.kpiRow}>
                {[
                  { n:workers.filter(w=>mAtras(w.atualizadoEm)<5).length,  l:t('kpiGps5'),  c:'#22c55e' },
                  { n:workers.filter(w=>mAtras(w.atualizadoEm)<15).length, l:t('kpiGps15'), c:'#f59e0b' },
                  { n:workers.filter(w=>mAtras(w.atualizadoEm)<30).length, l:t('kpiGps30'), c:'#f97316' },
                  { n:workers.length,                                       l:t('kpiTotal1h'),    c:T.dim     },
                ].map(({n,l,c}) => (
                  <div key={l} style={S.kpi(c)}>
                    <div style={S.kpiN(c)}>{n}</div>
                    <div style={S.kpiL}>{l}</div>
                  </div>
                ))}
              </div>

              <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
                <table style={S.table}>
                  <thead><tr>
                    {[t('thStatus'),t('thNome'),t('thUltimoGps'),t('thLocalizacao')].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {workers.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>{t('nenhumWorker')}</td></tr>}
                    {[...workers].sort((a,b) => mAtras(a.atualizadoEm)-mAtras(b.atualizadoEm)).map(w => {
                      const min = mAtras(w.atualizadoEm);
                      const cor = min < 5 ? '#22c55e' : min < 15 ? '#f59e0b' : min < 30 ? '#f97316' : T.dim;
                      return (
                        <tr key={w.uid}>
                          <td style={S.td}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ width:10, height:10, borderRadius:'50%', background:cor }}/>
                              <span style={{ fontSize:11, color:cor, fontWeight:600 }}>{min < 1 ? t('agora') : `${min}${t('min')}`}</span>
                            </div>
                          </td>
                          <td style={{ ...S.td, fontWeight:600, color:T.txt }}>{w.nome || w.uid.slice(-8)}</td>
                          <td style={{ ...S.td, fontSize:11, color:T.dim }}>
                            {w.atualizadoEm ? new Date(w.atualizadoEm?.toDate?.() ?? w.atualizadoEm).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'}
                          </td>
                          <td style={S.td}>
                            {w.lat && w.lng ? (
                              <a href={`https://maps.google.com/?q=${w.lat},${w.lng}`} target="_blank" rel="noreferrer" style={{ color:'#307FE2', fontSize:12, textDecoration:'none' }}>
                                🗺 {w.lat.toFixed(4)}, {w.lng.toFixed(4)}
                              </a>
                            ) : <span style={{ color:T.dim }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ZONAS ──────────────────────────────────────────────────── */}
          {tab === 'zonas' && (
            <div>
              {zoneStats.length === 0 ? (
                <div style={{ textAlign:'center', padding:40, color:T.dim }}>{t('zonaSemZonas')}</div>
              ) : (
                <>
                  {/* KPIs agregados */}
                  <div style={S.kpiRow}>
                    {[
                      { n: zoneStats.length, l: t('tabZonas'), c: '#307FE2' },
                      { n: zoneStats.reduce((s,z) => s + z.monitorEmpty, 0), l: `🔴 ${t('zonaVazios')} (monitor)`, c: '#ef4444' },
                      { n: zoneStats.reduce((s,z) => s + z.bikesOutOfParking, 0), l: `⚠️ ${t('zonaFora')}`, c: '#f97316' },
                    ].map(({n,l,c}) => (
                      <div key={l} style={S.kpi(c)}>
                        <div style={S.kpiN(c)}>{n}</div>
                        <div style={S.kpiL}>{l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Tabela por zona */}
                  <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
                    <table style={{ ...S.table, minWidth:700 }}>
                      <thead><tr>
                        {[t('zonaNome'), t('zonaEfic'), t('zonaPontos'), t('zonaMonitor'), t('zonaVazios'), t('zonaBikes'), t('zonaFora')].map(h => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {[...zoneStats].sort((a,b) => a.efficiencyPct - b.efficiencyPct).map(z => {
                          const efCor = z.efficiencyPct >= 80 ? '#22c55e' : z.efficiencyPct >= 50 ? '#f59e0b' : '#ef4444';
                          return (
                            <tr key={z.zoneId}>
                              <td style={{ ...S.td, fontWeight:700, color:T.txt }}>{z.zoneName}</td>
                              <td style={S.td}>
                                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                  <span style={{ color:efCor, fontWeight:700, fontSize:14 }}>{z.efficiencyPct}%</span>
                                  <div style={{ width:50, height:5, background:'rgba(255,255,255,.08)', borderRadius:3, overflow:'hidden' }}>
                                    <div style={{ height:'100%', width:`${z.efficiencyPct}%`, background:efCor, borderRadius:3 }}/>
                                  </div>
                                </div>
                              </td>
                              <td style={{ ...S.td, color:T.dim }}>{z.parkingsTotal}</td>
                              <td style={S.td}>
                                <span style={{ color:'#3b82f6', fontWeight:600 }}>{z.monitorTotal}</span>
                                {z.monitorEmpty > 0 && <span style={{ color:'#ef4444', marginLeft:4, fontSize:10 }}>({z.monitorEmpty} ⚠)</span>}
                              </td>
                              <td style={S.td}>
                                <span style={{ color: z.pontosEmpty > 0 ? '#ef4444' : '#22c55e', fontWeight:600 }}>{z.pontosEmpty}</span>
                              </td>
                              <td style={S.td}>
                                <div style={{ fontSize:11, color:T.dim }}>
                                  <span style={{ color:'#22c55e' }}>🟢{z.bikesAvailable}</span>{' '}
                                  <span style={{ color:'#eab308' }}>🟡{z.bikesRenting}</span>{' '}
                                  <span style={{ color:'#ef4444' }}>🔴{z.bikesUnavailable}</span>
                                </div>
                              </td>
                              <td style={S.td}>
                                {z.bikesOutOfParking > 0 ? (
                                  <span style={{ color:'#f97316', fontWeight:600 }}>{z.bikesOutOfParking}</span>
                                ) : <span style={{ color:T.dim }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Monitores vazios por zona */}
                  {zoneStats.some(z => z.emptyMonitors.length > 0) && (
                    <div style={{ ...S.card('#ef4444'), marginTop:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                        🔴 {t('zonaMonitoresVazios')}
                      </div>
                      {zoneStats.filter(z => z.emptyMonitors.length > 0).map(z => (
                        <div key={z.zoneId} style={{ marginBottom:10 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:T.txt, marginBottom:4 }}>{z.zoneName} ({z.emptyMonitors.length})</div>
                          {z.emptyMonitors.slice(0, 5).map(em => (
                            <div key={em.id} style={{ fontSize:11, color:T.dim, marginLeft:12, marginBottom:2 }}>
                              • {em.name}
                            </div>
                          ))}
                          {z.emptyMonitors.length > 5 && (
                            <div style={{ fontSize:10, color:T.dim, marginLeft:12 }}>+{z.emptyMonitors.length - 5} {t('vaziosMais')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
