// CommandCenter — Painel operacional completo com 15 blocos
// Filtros: cidade + zona. Dados: gojet_snapshots, zones, cidade_config, tarefas, v_prestador_status

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { fetchGojetSnapshot } from '../lib/analytics-supabase';

const CommandCenterMap = lazy(() => import('./CommandCenterMap'));

type Lang = 'pt' | 'en' | 'es' | 'ru';
const T = {
  title:        { pt: '🎯 Command Center', en: '🎯 Command Center', es: '🎯 Centro de Comando', ru: '🎯 Командный центр' },
  vagasVazias:  { pt: 'Vagas Vazias', en: 'Empty Spots', es: 'Plazas Vacías', ru: 'Пустые места' },
  monitores:    { pt: 'Monitores vazios', en: 'Empty monitors', es: 'Monitores vacíos', ru: 'Пустые мониторы' },
  semMonitor:   { pt: 'Sem-monitor vazios', en: 'Non-monitor empty', es: 'Sin monitor vacíos', ru: 'Без мониторов пустые' },
  comBike:      { pt: 'Com patinete', en: 'With scooter', es: 'Con patinete', ru: 'С самокатом' },
  excesso:      { pt: 'Com excesso', en: 'Excess', es: 'Con exceso', ru: 'С избытком' },
  totalPontos:  { pt: 'Total pontos', en: 'Total points', es: 'Total puntos', ru: 'Всего точек' },
  zona:         { pt: 'Zona', en: 'Zone', es: 'Zona', ru: 'Зона' },
  todas:        { pt: 'Todas', en: 'All', es: 'Todas', ru: 'Все' },
  scouts:       { pt: 'Scouts', en: 'Scouts', es: 'Scouts', ru: 'Скауты' },
  emTarefa:     { pt: 'Em tarefa', en: 'On task', es: 'En tarea', ru: 'На задаче' },
  ociosos:      { pt: 'Ociosos', en: 'Idle', es: 'Inactivos', ru: 'Свободны' },
  tarefasHoje:  { pt: 'Tarefas hoje', en: 'Tasks today', es: 'Tareas hoy', ru: 'Задачи сегодня' },
  abertas:      { pt: 'Abertas', en: 'Open', es: 'Abiertas', ru: 'Открытые' },
  emAndamento:  { pt: 'Em andamento', en: 'In progress', es: 'En progreso', ru: 'В процессе' },
  concluidas:   { pt: 'Concluídas', en: 'Completed', es: 'Completadas', ru: 'Завершённые' },
  vazios:       { pt: 'Estac. vazios', en: 'Empty parkings', es: 'Estac. vacíos', ru: 'Пустые парковки' },
  excessoList:  { pt: 'Pontos com excesso', en: 'Excess points', es: 'Puntos con exceso', ru: 'Точки с избытком' },
  meta:         { pt: 'meta', en: 'target', es: 'meta', ru: 'цель' },
  atual:        { pt: 'atual', en: 'current', es: 'actual', ru: 'текущий' },
  acima:        { pt: 'acima', en: 'above', es: 'encima', ru: 'выше' },
  vazio:        { pt: 'vazio', en: 'empty', es: 'vacío', ru: 'пусто' },
  carregando:   { pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  semDados:     { pt: 'Sem dados. Execute Sync nas Configurações > GoJet.', en: 'No data. Run Sync in Settings > GoJet.', es: 'Sin datos. Ejecute Sync en Configuraciones > GoJet.', ru: 'Нет данных.' },
  frota:        { pt: 'Frota', en: 'Fleet', es: 'Flota', ru: 'Флот' },
  disp:         { pt: 'Disp', en: 'Avail', es: 'Disp', ru: 'Дост' },
  bat15:        { pt: '<15%', en: '<15%', es: '<15%', ru: '<15%' },
  bat0:         { pt: '0%', en: '0%', es: '0%', ru: '0%' },
  bat5:         { pt: '≤5%', en: '≤5%', es: '≤5%', ru: '≤5%' },
  pontos:       { pt: 'Pontos', en: 'Points', es: 'Puntos', ru: 'Точек' },
  mon:          { pt: 'Mon', en: 'Mon', es: 'Mon', ru: 'Мон' },
  mon0:         { pt: 'Mon∅', en: 'Mon∅', es: 'Mon∅', ru: 'Мон∅' },
  nm0:          { pt: 'NM∅', en: 'NM∅', es: 'NM∅', ru: 'НМ∅' },
  monExc:       { pt: 'Mon↑', en: 'Mon↑', es: 'Mon↑', ru: 'Мон↑' },
  nmExc:        { pt: 'NM↑', en: 'NM↑', es: 'NM↑', ru: 'НМ↑' },
  pontosEsp:    { pt: '📌 Pontos especiais ativos', en: '📌 Active special points', es: '📌 Puntos especiales activos', ru: '📌 Спецточки активные' },
  batCritica:   { pt: '🔋 Bateria crítica', en: '🔋 Critical battery', es: '🔋 Batería crítica', ru: '🔋 Критический заряд' },
  bikes:        { pt: 'bikes', en: 'bikes', es: 'bikes', ru: 'байков' },
  tempoMedio:   { pt: '⏱️ Tempo médio por tipo', en: '⏱️ Avg time by type', es: '⏱️ Tiempo medio por tipo', ru: '⏱️ Среднее время по типу' },
  batFrota:     { pt: '🔋 Bateria da frota', en: '🔋 Fleet battery', es: '🔋 Batería de flota', ru: '🔋 Заряд флота' },
  saudePonto:   { pt: '🏥 Saúde dos pontos', en: '🏥 Point health', es: '🏥 Salud de puntos', ru: '🏥 Здоровье точек' },
  min:          { pt: 'min', en: 'min', es: 'min', ru: 'мин' },
  previsao:     { pt: '🔮 Previsão próxima hora', en: '🔮 Next hour prediction', es: '🔮 Predicción próxima hora', ru: '🔮 Прогноз на час' },
  riscoVazio:   { pt: 'risco de esvaziar', en: 'risk of emptying', es: 'riesgo de vaciarse', ru: 'риск опустошения' },
  capacidade:   { pt: '📋 Capacidade por turno', en: '📋 Capacity by shift', es: '📋 Capacidad por turno', ru: '📋 Мощность по сменам' },
  recomendado:  { pt: 'recomendado', en: 'recommended', es: 'recomendado', ru: 'рекомендуется' },
  tarefasDia:   { pt: 'tarefas/dia', en: 'tasks/day', es: 'tareas/día', ru: 'задач/день' },
  roiCidade:    { pt: '📊 ROI operacional (7d)', en: '📊 Operational ROI (7d)', es: '📊 ROI operacional (7d)', ru: '📊 ROI операций (7д)' },
  custo:        { pt: 'Custo', en: 'Cost', es: 'Costo', ru: 'Затраты' },
  receita:      { pt: 'Receita', en: 'Revenue', es: 'Ingresos', ru: 'Доход' },
};

interface Parking {
  parking_id: string;
  nome: string;
  cidade: string;
  zona?: string;
  bikes_count: number;
  target?: number | null;
  is_monitor: boolean;
  lat?: number;
  lng?: number;
}

interface ZoneData {
  name: string;
  city: string;
  gojet_zone_id: string | null;
  plan_frota: number | null;
  limite_default: number;
}

interface PrestadorRow {
  status_prestador: string;
}

interface TarefaRow {
  id?: string;
  status: string;
  criado_em: string;
  concluido_em?: string | null;
  kind?: string;
  titulo?: string;
  parking_lat?: number | null;
  parking_lng?: number | null;
  rota_osrm?: string | null;
}

interface Props {
  cidade: string;
}

export default function CommandCenter({ cidade }: Props) {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;

  const [parkings, setParkings] = useState<Parking[]>([]);
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [prestadores, setPrestadores] = useState<PrestadorRow[]>([]);
  const [tarefas, setTarefas] = useState<TarefaRow[]>([]);
  const [pontosEsp, setPontosEsp] = useState<any[]>([]);
  const [bikesLowBat, setBikesLowBat] = useState<any[]>([]);
  const [batteryHist, setBatteryHist] = useState<number[]>([]);
  const [roiData, setRoiData] = useState<{ custo: number; receita: number; roi_pct: number; tarefas: number } | null>(null);
  const [predictions, setPredictions] = useState<{ parking_id: string; nome: string; avg_bikes: number }[]>([]);
  const [capacidade, setCapacidade] = useState<{ turno: string; tarefas_dia: number; scouts_rec: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [zonaFiltro, setZonaFiltro] = useState('');

  const fetchAll = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);

    const [snapResult, zRes, prRes, tRes, peRes, bikesRes] = await Promise.all([
      fetchGojetSnapshot(cidade),
      supabase.from('zones')
        .select('name, city, gojet_zone_id, plan_frota, limite_default')
        .eq('city', cidade),
      supabase.from('v_prestador_status')
        .select('status_prestador')
        .eq('cidade', cidade),
      supabase.from('tarefas_logistica')
        .select('id, status, criado_em, concluido_em, kind, titulo, parking_lat, parking_lng, rota_osrm')
        .eq('cidade', cidade)
        .gte('criado_em', `${today}T00:00:00`),
      supabase.from('pontos_especiais')
        .select('id, tipo, nome, parking_id, data_inicio, data_fim, config, ativo')
        .eq('cidade_id', cidade)
        .eq('ativo', true)
        .lte('data_inicio', today)
        .or(`data_fim.gte.${today},data_fim.is.null`),
      supabase.from('bikes').select('dados').limit(2000),
    ]);

    // Build bike counts per parking from bikes data
    const bikeCountPerParking: Record<string, number> = {};
    const bikesList = (bikesRes.data ?? []).map((r: any) => r.dados ?? {});
    for (const b of bikesList) {
      if (b.parking_id) bikeCountPerParking[b.parking_id] = (bikeCountPerParking[b.parking_id] ?? 0) + 1;
    }

    // Map parkings from snapshot
    const mappedParkings: Parking[] = (snapResult.parkings ?? [])
      .filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p: any) => ({
        parking_id: p.id || p.parking_id || '',
        nome: p.name || p.id || '',
        cidade,
        zona: p.zone_name || p.zone || undefined,
        bikes_count: bikeCountPerParking[p.id] ?? p.bikes_count ?? p.availableCount ?? 0,
        target: p.target_bikes_count ?? null,
        is_monitor: (p.target_bikes_count ?? 0) > 0 || p.monitor === true,
        lat: p.latitude,
        lng: p.longitude,
      }));

    setParkings(mappedParkings);
    setZones((zRes.data ?? []) as ZoneData[]);
    setPrestadores((prRes.data ?? []) as PrestadorRow[]);
    setTarefas((tRes.data ?? []) as TarefaRow[]);
    setPontosEsp(peRes.data ?? []);

    // Collect low battery bikes (≤5%)
    const lowBat = bikesList
      .filter((b: any) => b.battery_percent != null && b.battery_percent <= 5)
      .map((b: any) => ({
        parking: b.parking_id || '?',
        battery: b.battery_percent ?? 0,
        bike: b.identifier || b.id || '',
      }))
      .sort((a: any, b: any) => a.battery - b.battery)
      .slice(0, 30);
    setBikesLowBat(lowBat);

    // Battery histogram: [0%, 1-5%, 6-15%, 16-30%, 31-50%, 51-100%]
    const hist = [0, 0, 0, 0, 0, 0];
    for (const b of bikesList) {
      const bp = b.battery_percent ?? b.battery_customer_percent;
      if (bp == null) continue;
      if (bp === 0) hist[0]++;
      else if (bp <= 5) hist[1]++;
      else if (bp <= 15) hist[2]++;
      else if (bp <= 30) hist[3]++;
      else if (bp <= 50) hist[4]++;
      else hist[5]++;
    }
    setBatteryHist(hist);

    // O5: Demand prediction — next hour
    const nextHour = (new Date().getHours() + 1) % 24;
    const dow = new Date().getDay();
    const { data: predRows } = await supabase
      .from('v_demanda_por_hora')
      .select('parking_id, avg_bikes, amostras')
      .eq('city_id', cidade)
      .eq('dia_semana', dow)
      .eq('hora_dia', nextHour)
      .lt('avg_bikes', 1.5)
      .gte('amostras', 4)
      .order('avg_bikes', { ascending: true })
      .limit(10);
    const predMapped = (predRows ?? []).map((r: any) => {
      const p = mappedParkings.find(mp => mp.parking_id === r.parking_id);
      return { parking_id: r.parking_id, nome: p?.nome ?? r.parking_id, avg_bikes: r.avg_bikes };
    });
    setPredictions(predMapped);

    // T5: Capacity planning
    const { data: capRows } = await supabase
      .from('v_capacidade_recomendada')
      .select('turno, tarefas_dia_medio, scouts_recomendados')
      .eq('cidade', cidade)
      .order('turno');
    setCapacidade((capRows ?? []).map((r: any) => ({
      turno: r.turno,
      tarefas_dia: Number(r.tarefas_dia_medio) || 0,
      scouts_rec: Number(r.scouts_recomendados) || 0,
    })));

    // F5: ROI data
    const { data: roiRows } = await supabase
      .from('v_roi_cidade')
      .select('custo_total, receita_total, roi_pct, tarefas_concluidas')
      .eq('cidade', cidade)
      .maybeSingle();
    if (roiRows) {
      setRoiData({
        custo: Number(roiRows.custo_total) || 0,
        receita: Number(roiRows.receita_total) || 0,
        roi_pct: Number(roiRows.roi_pct) || 0,
        tarefas: roiRows.tarefas_concluidas ?? 0,
      });
    }

    setLoading(false);
  }, [cidade]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const filteredParkings = useMemo(() =>
    zonaFiltro ? parkings.filter(p => p.zona === zonaFiltro) : parkings,
  [parkings, zonaFiltro]);

  // --- Computed stats ---
  const stats = useMemo(() => {
    const p = filteredParkings;
    const total = p.length;
    const LIMIT_DEFAULT = 3;
    const vazios = p.filter(x => x.bikes_count === 0);
    const monVazios = vazios.filter(x => x.is_monitor);
    const nmVazios = vazios.filter(x => !x.is_monitor);
    const comBike = p.filter(x => x.bikes_count > 0);
    const excesso = p.filter(x => {
      const limit = x.is_monitor ? (x.target ?? LIMIT_DEFAULT) : LIMIT_DEFAULT;
      return x.bikes_count > limit;
    });

    return { total, vazios: vazios.length, monVazios: monVazios.length, nmVazios: nmVazios.length,
      comBike: comBike.length, excesso: excesso.length };
  }, [filteredParkings]);

  const scoutStats = useMemo(() => {
    const emTarefa = prestadores.filter(p => p.status_prestador === 'em_tarefa').length;
    const ociosos = prestadores.filter(p => p.status_prestador !== 'em_tarefa' && p.status_prestador !== 'sem_acao').length;
    const semAcao = prestadores.filter(p => p.status_prestador === 'sem_acao').length;
    return { total: prestadores.length, emTarefa, ociosos, semAcao };
  }, [prestadores]);

  const tarefaStats = useMemo(() => {
    const abertas = tarefas.filter(t => t.status === 'pendente').length;
    const emAndamento = tarefas.filter(t => t.status === 'em_execucao').length;
    const concluidas = tarefas.filter(t => t.status === 'concluida').length;
    return { abertas, emAndamento, concluidas, total: tarefas.length };
  }, [tarefas]);

  // B5.7: Tempo médio por tipo (tarefas concluídas hoje)
  const tempoMedioPorTipo = useMemo(() => {
    const concluidas = tarefas.filter(t => t.status === 'concluida' && t.concluido_em && t.criado_em && t.kind);
    const porTipo: Record<string, number[]> = {};
    for (const t of concluidas) {
      const mins = (new Date(t.concluido_em!).getTime() - new Date(t.criado_em).getTime()) / 60000;
      if (mins > 0 && mins < 600) { // ignore outliers
        if (!porTipo[t.kind!]) porTipo[t.kind!] = [];
        porTipo[t.kind!].push(mins);
      }
    }
    return Object.entries(porTipo).map(([kind, times]) => ({
      kind,
      avg: Math.round(times.reduce((s, t) => s + t, 0) / times.length),
      count: times.length,
    })).sort((a, b) => b.count - a.count);
  }, [tarefas]);

  // B5.3: Score de saúde do ponto (0-100)
  const pontosComScore = useMemo(() => {
    return filteredParkings.map(p => {
      let score = 100;
      if (p.bikes_count === 0) score -= 40; // vazio
      const limit = p.is_monitor ? (p.target ?? 3) : 3;
      if (p.bikes_count > limit) score -= 20; // excesso
      if (!p.is_monitor) score -= 10; // sem monitor vale menos
      return { ...p, score: Math.max(0, score) };
    }).filter(p => p.score < 60).sort((a, b) => a.score - b.score).slice(0, 15);
  }, [filteredParkings]);

  // Zone matrix
  const zoneMatrix = useMemo(() => {
    const zonaNames = [...new Set(parkings.map(p => p.zona).filter(Boolean))] as string[];
    return zonaNames.map(z => {
      const zp = parkings.filter(p => p.zona === z);
      const total = zp.length;
      const bikes = zp.reduce((s, p) => s + p.bikes_count, 0);
      const mon = zp.filter(p => p.is_monitor);
      const nm = zp.filter(p => !p.is_monitor);
      const monVazio = mon.filter(p => p.bikes_count === 0).length;
      const nmVazio = nm.filter(p => p.bikes_count === 0).length;
      const monExc = mon.filter(p => p.bikes_count > (p.target ?? 3)).length;
      const nmExc = nm.filter(p => p.bikes_count > 3).length;
      const zoneInfo = zones.find(zi => zi.name === z);
      return { zona: z, total, bikes, plan: zoneInfo?.plan_frota, mon: mon.length, monVazio, nmVazio, monExc, nmExc };
    }).sort((a, b) => (b.monVazio + b.nmVazio) - (a.monVazio + a.nmVazio));
  }, [parkings, zones]);

  // Empty parkings list
  const emptyParkings = useMemo(() =>
    filteredParkings.filter(p => p.bikes_count === 0)
      .sort((a, b) => (b.is_monitor ? 1 : 0) - (a.is_monitor ? 1 : 0)),
  [filteredParkings]);

  // Excess parkings
  const excessParkings = useMemo(() =>
    filteredParkings.filter(p => {
      const limit = p.is_monitor ? (p.target ?? 3) : 3;
      return p.bikes_count > limit;
    }).sort((a, b) => {
      const aExc = a.bikes_count - (a.is_monitor ? (a.target ?? 3) : 3);
      const bExc = b.bikes_count - (b.is_monitor ? (b.target ?? 3) : 3);
      return bExc - aExc;
    }),
  [filteredParkings]);

  const zonaNames = useMemo(() => [...new Set(parkings.map(p => p.zona).filter(Boolean))].sort() as string[], [parkings]);

  // --- Styles ---
  const S = {
    container: { padding: 0 } as React.CSSProperties,
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } as React.CSSProperties,
    title: { fontSize: 16, fontWeight: 800, color: '#dce8ff' } as React.CSSProperties,
    filterBar: { display: 'flex', gap: 6, marginBottom: 14 } as React.CSSProperties,
    filterBtn: (active: boolean) => ({
      padding: '4px 10px', borderRadius: 12, border: 'none', fontSize: 10, fontWeight: 600,
      cursor: 'pointer', background: active ? '#3b82f6' : 'rgba(255,255,255,.06)',
      color: active ? '#fff' : 'rgba(255,255,255,.4)',
    }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 } as React.CSSProperties,
    kpi: (color: string) => ({
      background: `${color}08`, border: `1px solid ${color}20`, borderRadius: 10, padding: '12px 14px',
      textAlign: 'center' as const,
    }),
    kpiNum: (color: string) => ({ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }),
    kpiLabel: { fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 4 } as React.CSSProperties,
    section: { fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.5)', marginBottom: 8, marginTop: 16 } as React.CSSProperties,
    table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 } as React.CSSProperties,
    th: { padding: '6px 8px', textAlign: 'left' as const, color: 'rgba(255,255,255,.3)', borderBottom: '1px solid rgba(255,255,255,.08)', fontSize: 10, fontWeight: 600 } as React.CSSProperties,
    td: { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,.04)', color: '#dce8ff' } as React.CSSProperties,
    tdNum: { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,.04)', color: '#dce8ff', textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 11 } as React.CSSProperties,
    emptyRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.04)' } as React.CSSProperties,
    card: { background: '#111827', borderRadius: 10, padding: 14, marginBottom: 10 } as React.CSSProperties,
  };

  if (loading) return <div style={{ color: 'rgba(255,255,255,.3)', padding: 40, textAlign: 'center' }}>{pick(T.carregando)}</div>;
  if (parkings.length === 0) return <div style={{ color: 'rgba(255,255,255,.3)', padding: 40, textAlign: 'center' }}>{pick(T.semDados)}</div>;

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.title}>{pick(T.title)}</div>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.25)' }}>{cidade} · {parkings.length} {pick(T.pontos)}</span>
      </div>

      {/* Zone filter */}
      {zonaNames.length > 1 && (
        <div style={S.filterBar}>
          <button style={S.filterBtn(!zonaFiltro)} onClick={() => setZonaFiltro('')}>{pick(T.todas)}</button>
          {zonaNames.map(z => (
            <button key={z} style={S.filterBtn(zonaFiltro === z)} onClick={() => setZonaFiltro(z)}>
              {z.length > 15 ? z.slice(0, 12) + '…' : z}
            </button>
          ))}
        </div>
      )}

      {/* Bloco 1: KPI cards */}
      <div style={S.grid}>
        <div style={S.kpi('#ef4444')}>
          <div style={S.kpiNum('#ef4444')}>{stats.vazios}</div>
          <div style={S.kpiLabel}>{pick(T.vagasVazias)} ({stats.total > 0 ? Math.round(stats.vazios / stats.total * 100) : 0}%)</div>
        </div>
        <div style={S.kpi('#dc2626')}>
          <div style={S.kpiNum('#dc2626')}>{stats.monVazios}</div>
          <div style={S.kpiLabel}>🔴 {pick(T.monitores)}</div>
        </div>
        <div style={S.kpi('#6b7280')}>
          <div style={S.kpiNum('#6b7280')}>{stats.nmVazios}</div>
          <div style={S.kpiLabel}>⚫ {pick(T.semMonitor)}</div>
        </div>
        <div style={S.kpi('#22c55e')}>
          <div style={S.kpiNum('#22c55e')}>{stats.comBike}</div>
          <div style={S.kpiLabel}>🟢 {pick(T.comBike)}</div>
        </div>
        <div style={S.kpi('#f59e0b')}>
          <div style={S.kpiNum('#f59e0b')}>{stats.excesso}</div>
          <div style={S.kpiLabel}>🟠 {pick(T.excesso)}</div>
        </div>
        <div style={S.kpi('#3b82f6')}>
          <div style={S.kpiNum('#3b82f6')}>{stats.total}</div>
          <div style={S.kpiLabel}>{pick(T.totalPontos)}</div>
        </div>
      </div>

      {/* Bloco 11 + 12: Scouts + Tarefas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div style={S.card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>{pick(T.scouts)}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{scoutStats.emTarefa}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>{pick(T.emTarefa)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{scoutStats.ociosos}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>{pick(T.ociosos)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#6b7280' }}>{scoutStats.semAcao}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>⚫</div>
            </div>
          </div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>{pick(T.tarefasHoje)}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6' }}>{tarefaStats.abertas}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>{pick(T.abertas)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{tarefaStats.emAndamento}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>{pick(T.emAndamento)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{tarefaStats.concluidas}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>{pick(T.concluidas)}</div>
            </div>
          </div>
          {tarefaStats.total > 0 && (
            <div style={{ height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, marginTop: 8 }}>
              <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden' }}>
                {tarefaStats.concluidas > 0 && <div style={{ flex: tarefaStats.concluidas, background: '#22c55e' }} />}
                {tarefaStats.emAndamento > 0 && <div style={{ flex: tarefaStats.emAndamento, background: '#f59e0b' }} />}
                {tarefaStats.abertas > 0 && <div style={{ flex: tarefaStats.abertas, background: '#3b82f6' }} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bloco 5: Matriz por zona */}
      {zoneMatrix.length > 0 && (
        <>
          <div style={S.section}>{pick(T.zona)} — Matriz</div>
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>{pick(T.zona)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.frota)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.pontos)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.mon)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.mon0)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.nm0)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.monExc)}</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.nmExc)}</th>
                </tr>
              </thead>
              <tbody>
                {zoneMatrix.map(z => (
                  <tr key={z.zona} onClick={() => setZonaFiltro(zonaFiltro === z.zona ? '' : z.zona)}
                    style={{ cursor: 'pointer', background: zonaFiltro === z.zona ? 'rgba(59,130,246,.08)' : undefined }}>
                    <td style={{ ...S.td, fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.zona}</td>
                    <td style={S.tdNum}>{z.bikes}</td>
                    <td style={S.tdNum}>{z.total}</td>
                    <td style={S.tdNum}>{z.mon}</td>
                    <td style={{ ...S.tdNum, color: z.monVazio > 0 ? '#ef4444' : 'rgba(255,255,255,.2)' }}>{z.monVazio || '—'}</td>
                    <td style={{ ...S.tdNum, color: z.nmVazio > 0 ? '#6b7280' : 'rgba(255,255,255,.2)' }}>{z.nmVazio || '—'}</td>
                    <td style={{ ...S.tdNum, color: z.monExc > 0 ? '#f59e0b' : 'rgba(255,255,255,.2)' }}>{z.monExc || '—'}</td>
                    <td style={{ ...S.tdNum, color: z.nmExc > 0 ? '#f59e0b' : 'rgba(255,255,255,.2)' }}>{z.nmExc || '—'}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid rgba(255,255,255,.1)' }}>
                  <td style={{ ...S.td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...S.tdNum, fontWeight: 800 }}>{zoneMatrix.reduce((s, z) => s + z.bikes, 0)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 800 }}>{zoneMatrix.reduce((s, z) => s + z.total, 0)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 800 }}>{zoneMatrix.reduce((s, z) => s + z.mon, 0)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 800, color: '#ef4444' }}>{zoneMatrix.reduce((s, z) => s + z.monVazio, 0)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 800, color: '#6b7280' }}>{zoneMatrix.reduce((s, z) => s + z.nmVazio, 0)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 800, color: '#f59e0b' }}>{zoneMatrix.reduce((s, z) => s + z.monExc, 0)}</td>
                  <td style={{ ...S.tdNum, fontWeight: 800, color: '#f59e0b' }}>{zoneMatrix.reduce((s, z) => s + z.nmExc, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Bloco 8: Estacionamentos vazios */}
      {emptyParkings.length > 0 && (
        <>
          <div style={S.section}>🔴 {pick(T.vazios)} ({emptyParkings.length})</div>
          <div style={{ ...S.card, maxHeight: 300, overflowY: 'auto' }}>
            {emptyParkings.map(p => (
              <div key={p.parking_id} style={S.emptyRow}>
                <span style={{ fontSize: 10 }}>{p.is_monitor ? '★' : '○'}</span>
                <span style={{ flex: 1, fontSize: 11, color: '#dce8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.nome}
                </span>
                {p.zona && <span style={{ fontSize: 9, color: 'rgba(255,255,255,.25)' }}>{p.zona}</span>}
                {p.is_monitor && p.target && (
                  <span style={{ fontSize: 9, color: '#ef4444' }}>{pick(T.meta)} {p.target}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Bloco 9: Pontos com excesso */}
      {excessParkings.length > 0 && (
        <>
          <div style={S.section}>🟠 {pick(T.excessoList)} ({excessParkings.length})</div>
          <div style={{ ...S.card, maxHeight: 300, overflowY: 'auto' }}>
            {excessParkings.map(p => {
              const limit = p.is_monitor ? (p.target ?? 3) : 3;
              const exc = p.bikes_count - limit;
              return (
                <div key={p.parking_id} style={S.emptyRow}>
                  <span style={{ fontSize: 10 }}>{p.is_monitor ? '★' : '○'}</span>
                  <span style={{ flex: 1, fontSize: 11, color: '#dce8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.nome}
                  </span>
                  <span style={{ fontSize: 9, color: '#f59e0b' }}>
                    {pick(T.atual)} {p.bikes_count} · +{exc} {pick(T.acima)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* B5.7: Tempo médio por tipo */}
      {tempoMedioPorTipo.length > 0 && (
        <>
          <div style={S.section}>{pick(T.tempoMedio)}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {tempoMedioPorTipo.map(t => (
              <div key={t.kind} style={{ background: '#111827', borderRadius: 10, padding: '10px 14px', textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#dce8ff' }}>{t.avg}<span style={{ fontSize: 11, color: 'rgba(255,255,255,.3)' }}>{pick(T.min)}</span></div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>{t.kind} ({t.count})</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* B5.10: Dashboard bateria da frota */}
      {batteryHist.some(v => v > 0) && (() => {
        const labels = ['0%', '1-5%', '6-15%', '16-30%', '31-50%', '51-100%'];
        const colors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e'];
        const total = batteryHist.reduce((s, v) => s + v, 0);
        const maxVal = Math.max(...batteryHist, 1);
        return (
          <>
            <div style={S.section}>{pick(T.batFrota)} ({total} {pick(T.bikes)})</div>
            <div style={{ ...S.card, display: 'flex', alignItems: 'flex-end', gap: 6, height: 100, padding: '10px 14px' }}>
              {batteryHist.map((v, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 700 }}>{v}</span>
                  <div style={{
                    width: '100%', borderRadius: 4,
                    height: Math.max(4, (v / maxVal) * 60),
                    background: colors[i],
                    transition: 'height .3s',
                  }} />
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,.25)' }}>{labels[i]}</span>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {/* B5.3: Score saúde dos pontos */}
      {pontosComScore.length > 0 && (
        <>
          <div style={S.section}>{pick(T.saudePonto)}</div>
          <div style={{ ...S.card, maxHeight: 200, overflowY: 'auto' }}>
            {pontosComScore.map(p => (
              <div key={p.parking_id} style={S.emptyRow}>
                <span style={{
                  fontSize: 10, fontWeight: 800, minWidth: 28, textAlign: 'right',
                  color: p.score < 30 ? '#ef4444' : p.score < 50 ? '#f59e0b' : '#eab308',
                }}>{p.score}</span>
                <div style={{
                  width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${p.score}%`, height: 4, borderRadius: 2,
                    background: p.score < 30 ? '#ef4444' : p.score < 50 ? '#f59e0b' : '#eab308',
                  }} />
                </div>
                <span style={{ fontSize: 10 }}>{p.is_monitor ? '★' : '○'}</span>
                <span style={{ flex: 1, fontSize: 11, color: '#dce8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.nome}
                </span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.2)' }}>
                  {p.bikes_count} {pick(T.bikes)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* O5: Demand prediction */}
      {predictions.length > 0 && (
        <>
          <div style={S.section}>{pick(T.previsao)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {predictions.map(p => (
              <div key={p.parking_id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: 'rgba(139,92,246,.06)', borderRadius: 6, border: '1px solid rgba(139,92,246,.12)',
              }}>
                <span style={{ fontSize: 12 }}>🔮</span>
                <span style={{ flex: 1, fontSize: 11, color: '#dce8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.nome}
                </span>
                <span style={{ fontSize: 10, color: '#a78bfa', fontFamily: 'monospace' }}>
                  ~{p.avg_bikes} avg
                </span>
                <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 600 }}>
                  {pick(T.riscoVazio)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* F5: ROI operacional */}
      {roiData && (roiData.custo > 0 || roiData.receita > 0) && (
        <>
          <div style={S.section}>{pick(T.roiCidade)}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, background: 'rgba(239,68,68,.08)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(239,68,68,.15)' }}>
              <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 600, textTransform: 'uppercase' }}>{pick(T.custo)}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444', fontFamily: 'monospace' }}>
                R$ {roiData.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ flex: 1, background: 'rgba(16,185,129,.08)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(16,185,129,.15)' }}>
              <div style={{ fontSize: 9, color: '#10b981', fontWeight: 600, textTransform: 'uppercase' }}>{pick(T.receita)}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#10b981', fontFamily: 'monospace' }}>
                R$ {roiData.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ flex: 1, background: 'rgba(59,130,246,.08)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(59,130,246,.15)' }}>
              <div style={{ fontSize: 9, color: '#60a5fa', fontWeight: 600 }}>ROI</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: roiData.roi_pct >= 0 ? '#10b981' : '#ef4444', fontFamily: 'monospace' }}>
                {roiData.roi_pct >= 0 ? '+' : ''}{roiData.roi_pct}%
              </div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginBottom: 12 }}>
            {roiData.tarefas} tarefas concluídas · últimos 7 dias
          </div>
        </>
      )}

      {/* T5: Capacity planning */}
      {capacidade.length > 0 && (
        <>
          <div style={S.section}>{pick(T.capacidade)}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {capacidade.map(c => (
              <div key={c.turno} style={{
                flex: 1, background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '10px 12px',
                border: '1px solid rgba(255,255,255,.06)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dce8ff', marginBottom: 4 }}>{c.turno}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>
                  ~{c.tarefas_dia} {pick(T.tarefasDia)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#60a5fa', marginTop: 4 }}>
                  {c.scouts_rec} <span style={{ fontSize: 9, fontWeight: 400, color: 'rgba(255,255,255,.3)' }}>{pick(T.recomendado)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Bloco 14: Mapa live */}
      <div style={S.section}>🗺️ Mapa</div>
      <Suspense fallback={<div style={{ height: 300, background: '#111827', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.2)' }}>...</div>}>
        <CommandCenterMap
          parkings={filteredParkings.filter(p => p.lat && p.lng).map(p => ({
            id: p.parking_id, nome: p.nome, lat: p.lat!, lng: p.lng!,
            bikes_count: p.bikes_count, target: p.target ?? null, is_monitor: p.is_monitor, zona: p.zona,
          }))}
          tarefas={tarefas
            .filter(t => t.parking_lat && t.parking_lng && t.status !== 'concluida' && t.status !== 'cancelada')
            .map(t => {
              const SLA_DEFAULT_MIN = 60;
              const elapsed = (Date.now() - new Date(t.criado_em).getTime()) / 60000;
              const slaMin = SLA_DEFAULT_MIN;
              return {
                id: t.id || '', lat: t.parking_lat!, lng: t.parking_lng!,
                titulo: t.titulo || t.kind || '', rota_osrm: t.rota_osrm,
                slaRatio: slaMin > 0 ? elapsed / slaMin : 0,
              };
            })}
        />
      </Suspense>

      {/* Bloco 13: Pontos especiais ativos */}
      {pontosEsp.length > 0 && (
        <>
          <div style={S.section}>{pick(T.pontosEsp)} ({pontosEsp.length})</div>
          <div style={S.card}>
            {pontosEsp.map((pe: any) => (
              <div key={pe.id} style={{ ...S.emptyRow, borderLeft: `3px solid ${
                pe.tipo === 'feriado' ? '#ef4444' : pe.tipo === 'evento' ? '#8b5cf6' :
                pe.tipo === 'manutencao' ? '#f59e0b' : '#06b6d4'}`, paddingLeft: 8 }}>
                <span style={{ fontSize: 12 }}>{
                  pe.tipo === 'feriado' ? '🎉' : pe.tipo === 'evento' ? '🎪' :
                  pe.tipo === 'manutencao' ? '🔧' : '🌤️'}</span>
                <span style={{ flex: 1, fontSize: 11, color: '#dce8ff' }}>{pe.nome || pe.tipo}</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.25)' }}>
                  {pe.data_inicio}{pe.data_fim ? ` → ${pe.data_fim}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Bloco 15: Bateria crítica */}
      {bikesLowBat.length > 0 && (
        <>
          <div style={S.section}>{pick(T.batCritica)} ({bikesLowBat.length})</div>
          <div style={{ ...S.card, maxHeight: 200, overflowY: 'auto' }}>
            {bikesLowBat.map((b: any, i: number) => (
              <div key={i} style={S.emptyRow}>
                <span style={{ fontSize: 11, fontWeight: 700, color: b.battery === 0 ? '#ef4444' : '#f59e0b',
                  minWidth: 30, textAlign: 'right' }}>{b.battery}%</span>
                {b.bike && <span style={{ fontSize: 9, color: 'rgba(139,92,246,.7)', background: 'rgba(139,92,246,.1)', padding: '1px 4px', borderRadius: 3 }}>🛴 {b.bike}</span>}
                <span style={{ flex: 1, fontSize: 11, color: '#dce8ff' }}>{b.parking}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
