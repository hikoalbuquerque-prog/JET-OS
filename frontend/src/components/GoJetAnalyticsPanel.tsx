// GoJetAnalyticsPanel.tsx — Dashboard completo de analytics GoJet
// Portado do V2 dashboard-ui.ts + zone-analytics.ts → React + Firebase
//
// Features:
//   📊 KPIs globais (disponíveis, em uso, zerados, eficiência%)
//   🗺 Breakdown por zona (eficiência, pontos vazios, bikes)
//   🛴 Distribuição de status de patinetes
//   📋 Tabela de pontos críticos (vermelhos/laranjas)
//   📥 Export CSV de pontos

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fnExportarHistoricoParking } from '../lib/edge-functions';
import { supabase } from '../lib/supabase';
import { classifyBike, BIKE_STATUS_HEX, BIKE_STATUS_LABEL, BikeForClassify, BikeStatus } from '../lib/bike-classify';
import { fetchGojetSnapshot } from '../lib/analytics-supabase';
import { carregarZonasSupabase } from '../lib/estacoes-supabase';
import { colorForParking, PARKING_COLOR_HEX, ParkingColor } from '../lib/parking-colors';
import {
  computeZoneAnalytics, ZoneStats, ZonePolygon, ParkingPoint, BikePoint,
} from '../lib/zone-analytics';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Props {
  visivel: boolean;
  onFechar: () => void;
  cidade: string;
}

type AbaId = 'resumo' | 'pontos' | 'zonas' | 'patinetes' | 'historico';

// ─── Cores UI ─────────────────────────────────────────────────────────────────

const C = {
  bg:   '#1a1f2e',
  card: 'rgba(255,255,255,.03)',
  bord: 'rgba(255,255,255,.08)',
  txt:  'rgba(255,255,255,.7)',
  dim:  'rgba(255,255,255,.35)',
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.bord}`, borderRadius: 10, padding: '12px 14px', ...style }}>
      {children}
    </div>
  );
}

function KpiCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <Card style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

type Tr = { pt: string; en: string; es: string; ru: string };
const T = {
  abaResumo:    { pt: '📊 Resumo',    en: '📊 Summary',    es: '📊 Resumen',    ru: '📊 Сводка' },
  abaPontos:    { pt: '📍 Pontos',    en: '📍 Points',     es: '📍 Puntos',     ru: '📍 Точки' },
  abaZonas:     { pt: '🗺 Zonas',     en: '🗺 Zones',      es: '🗺 Zonas',      ru: '🗺 Зоны' },
  abaPatinetes: { pt: '🛴 Patinetes', en: '🛴 Scooters',   es: '🛴 Patinetes',  ru: '🛴 Самокаты' },
  abaHistorico: { pt: '📅 Histórico', en: '📅 History',    es: '📅 Historial',  ru: '📅 История' },

  titulo:       { pt: '📊 Analytics GoJet', en: '📊 GoJet Analytics', es: '📊 Analytics GoJet', ru: '📊 Аналитика GoJet' },
  snapshotAtras:{ pt: 'snapshot {n}min atrás', en: 'snapshot {n}min ago', es: 'snapshot hace {n}min', ru: 'снимок {n}мин назад' },
  carregando:   { pt: 'carregando…', en: 'loading…', es: 'cargando…', ru: 'загрузка…' },
  pontosBikes:  { pt: '{p} pontos · {b} bikes', en: '{p} points · {b} bikes', es: '{p} puntos · {b} bikes', ru: '{p} точек · {b} велосипедов' },
  carregandoSnapshot: { pt: 'Carregando snapshot…', en: 'Loading snapshot…', es: 'Cargando snapshot…', ru: 'Загрузка снимка…' },

  kpiDisponiveis: { pt: 'Patinetes disponíveis', en: 'Available scooters', es: 'Patinetes disponibles', ru: 'Доступные самокаты' },
  kpiDeTotal:     { pt: 'de {n} total', en: 'of {n} total', es: 'de {n} total', ru: 'из {n} всего' },
  kpiEmUso:       { pt: 'Em uso agora', en: 'In use now', es: 'En uso ahora', ru: 'Сейчас используется' },
  kpiZerados:     { pt: 'Pontos zerados', en: 'Empty points', es: 'Puntos vacíos', ru: 'Пустые точки' },
  kpiDeMonitores: { pt: 'de {n} monitores', en: 'of {n} monitors', es: 'de {n} monitores', ru: 'из {n} мониторов' },
  kpiEficiencia:  { pt: 'Eficiência monitores', en: 'Monitor efficiency', es: 'Eficiencia monitores', ru: 'Эффективность мониторов' },

  distCores:    { pt: 'Distribuição de Cores', en: 'Color Distribution', es: 'Distribución de Colores', ru: 'Распределение цветов' },
  corZerado:    { pt: 'Zerado', en: 'Empty', es: 'Vacío', ru: 'Пусто' },
  corBaixo:     { pt: '< 50% target', en: '< 50% target', es: '< 50% objetivo', ru: '< 50% цели' },
  corMedio:     { pt: '50–85%', en: '50–85%', es: '50–85%', ru: '50–85%' },
  corNoTarget:  { pt: 'No target', en: 'On target', es: 'En objetivo', ru: 'В цели' },
  corExcesso:   { pt: 'Excesso', en: 'Excess', es: 'Exceso', ru: 'Избыток' },
  corSemTarget: { pt: 'S/ target', en: 'No target', es: 'Sin objetivo', ru: 'Без цели' },

  topZonas:     { pt: 'Top Zonas Críticas', en: 'Top Critical Zones', es: 'Top Zonas Críticas', ru: 'Топ критических зон' },
  zerados:      { pt: '{n} zerados', en: '{n} empty', es: '{n} vacíos', ru: '{n} пустых' },

  filtroTodos:  { pt: 'Todos', en: 'All', es: 'Todos', ru: 'Все' },
  filtroZerados:{ pt: 'Zerados', en: 'Empty', es: 'Vacíos', ru: 'Пустые' },
  filtroBaixo:  { pt: 'Baixo', en: 'Low', es: 'Bajo', ru: 'Низкий' },
  filtroMedio:  { pt: 'Médio', en: 'Medium', es: 'Medio', ru: 'Средний' },
  filtroOk:     { pt: 'OK', en: 'OK', es: 'OK', ru: 'OK' },
  filtroExcesso:{ pt: 'Excesso', en: 'Excess', es: 'Exceso', ru: 'Избыток' },
  buscar:       { pt: 'Buscar…', en: 'Search…', es: 'Buscar…', ru: 'Поиск…' },
  nPontos:      { pt: '{n} pontos', en: '{n} points', es: '{n} puntos', ru: '{n} точек' },

  nenhumaZona:  { pt: 'Nenhuma zona configurada para {cidade}', en: 'No zones configured for {cidade}', es: 'Ninguna zona configurada para {cidade}', ru: 'Нет настроенных зон для {cidade}' },
  configZonas:  { pt: 'Configure zonas em Zonas → desenhar polígono', en: 'Set up zones in Zones → draw polygon', es: 'Configura zonas en Zonas → dibujar polígono', ru: 'Настройте зоны в разделе Зоны → нарисовать полигон' },
  zPontos:      { pt: 'Pontos', en: 'Points', es: 'Puntos', ru: 'Точки' },
  zMonitores:   { pt: 'Monitores', en: 'Monitors', es: 'Monitores', ru: 'Мониторы' },
  zZerados:     { pt: 'Zerados', en: 'Empty', es: 'Vacíos', ru: 'Пустые' },
  zBikes:       { pt: 'Bikes', en: 'Bikes', es: 'Bikes', ru: 'Велосипеды' },
  zDisp:        { pt: 'disp', en: 'avail', es: 'disp', ru: 'дост' },
  zEmUso:       { pt: 'Em uso', en: 'In use', es: 'En uso', ru: 'Исп.' },
  zForaPonto:   { pt: 'Fora ponto', en: 'Off point', es: 'Fuera de punto', ru: 'Вне точки' },
  zSemBike:     { pt: 'Monitores sem bike:', en: 'Monitors without bike:', es: 'Monitores sin bike:', ru: 'Мониторы без велосипеда:' },

  bateriaBaixa: { pt: '⚡ Bateria Baixa ({n})', en: '⚡ Low Battery ({n})', es: '⚡ Batería Baja ({n})', ru: '⚡ Низкий заряд ({n})' },

  atualizar:    { pt: '🔄 Atualizar', en: '🔄 Refresh', es: '🔄 Actualizar', ru: '🔄 Обновить' },
  exportando:   { pt: '⏳ Exportando…', en: '⏳ Exporting…', es: '⏳ Exportando…', ru: '⏳ Экспорт…' },
  exportarCSV:  { pt: '📥 Exportar CSV (90 dias)', en: '📥 Export CSV (90 days)', es: '📥 Exportar CSV (90 días)', ru: '📥 Экспорт CSV (90 дней)' },
  carregandoHist: { pt: 'Carregando histórico…', en: 'Loading history…', es: 'Cargando historial…', ru: 'Загрузка истории…' },
  nenhumHist:   { pt: 'Nenhum histórico ainda', en: 'No history yet', es: 'Aún no hay historial', ru: 'Истории пока нет' },
  histAuto:     { pt: 'O histórico é salvo automaticamente todo dia às 23:55', en: 'History is saved automatically every day at 23:55', es: 'El historial se guarda automáticamente todos los días a las 23:55', ru: 'История сохраняется автоматически каждый день в 23:55' },
  nRegistros:   { pt: '{n} registros', en: '{n} records', es: '{n} registros', ru: '{n} записей' },
  hData:        { pt: 'Data', en: 'Date', es: 'Fecha', ru: 'Дата' },
  hPontos:      { pt: 'Pontos', en: 'Points', es: 'Puntos', ru: 'Точки' },
  hMonitores:   { pt: 'Monitores', en: 'Monitors', es: 'Monitores', ru: 'Мониторы' },
  hZerados:     { pt: 'Zerados', en: 'Empty', es: 'Vacíos', ru: 'Пустые' },
  hEficiencia:  { pt: 'Eficiência', en: 'Efficiency', es: 'Eficiencia', ru: 'Эффективность' },
} as const;

// ─── Componente principal ─────────────────────────────────────────────────────

export default function GoJetAnalyticsPanel({ visivel, onFechar, cidade }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: Tr) => o[lang] ?? o.pt;
  const [aba, setAba]           = useState<AbaId>('resumo');
  const [carregando, setCarregando] = useState(false);
  const [parkings, setParkings] = useState<ParkingPoint[]>([]);
  const [bikes, setBikes]       = useState<BikePoint[]>([]);
  const [zonas, setZonas]       = useState<ZonePolygon[]>([]);
  const [snapshotAge, setSnapshotAge] = useState<number | null>(null);
  const [filtroPontos, setFiltroPontos] = useState<ParkingColor | 'todos'>('todos');
  const [buscaPonto, setBuscaPonto] = useState('');
  // Histórico
  const [historico, setHistorico]     = useState<any[]>([]);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [exportandoHist, setExportandoHist] = useState(false);

  const carregar = useCallback(async () => {
    if (!cidade) return;
    setCarregando(true);
    try {
      const r = await fetchGojetSnapshot(cidade);
      setParkings(r.parkings as any);
      setBikes(r.bikes as any);
      setSnapshotAge(r.savedAtMs ? Math.round((Date.now() - r.savedAtMs) / 60000) : null);

      // Zonas (polígonos) via Supabase
      const zonasData = await carregarZonasSupabase([cidade]);
      const zonasList: ZonePolygon[] = zonasData.map((z: any) => {
        const coords: [number, number][] = (z.pontos || []).map((p: any) => [p.lng, p.lat]);
        return { id: z.id, nome: z.nome ?? z.id, cor: z.cor, coordenadas: coords };
      });
      setZonas(zonasList);
    } finally {
      setCarregando(false);
    }
  }, [cidade]);

  useEffect(() => { if (visivel) carregar(); }, [visivel, carregar]);

  // ── Stats globais
  const stats = useMemo(() => {
    const bikesByStatus: Record<BikeStatus, number> = {
      available: 0, renting: 0, reserved: 0, maintenance: 0, low_battery: 0, oficina: 0, apreendidos: 0,
    };
    for (const b of bikes) bikesByStatus[classifyBike(b)]++;

    const pontosTotal    = parkings.length;
    const monitores      = parkings.filter(p => p.monitor);
    const monitoresOk    = monitores.filter(p => (p.availableCount ?? 0) > 0);
    const monitoresZerados = monitores.length - monitoresOk.length;
    const efficiencyPct  = monitores.length > 0 ? Math.round((monitoresOk.length / monitores.length) * 100) : 0;
    const pontosVermelhos = parkings.filter(p => colorForParking(p) === 'red');
    const pontosLaranjas  = parkings.filter(p => colorForParking(p) === 'orange');

    return {
      bikesByStatus,
      bikesTotal: bikes.length,
      bikesDisponiveis: bikesByStatus.available,
      bikesEmUso: bikesByStatus.renting,
      pontosTotal, monitores: monitores.length, monitoresOk: monitoresOk.length,
      monitoresZerados, efficiencyPct,
      pontosVermelhos: pontosVermelhos.length, pontosLaranjas: pontosLaranjas.length,
    };
  }, [parkings, bikes]);

  // ── Zone analytics
  const zoneStats = useMemo(() =>
    zonas.length > 0 ? computeZoneAnalytics(zonas, parkings, bikes) : [],
    [zonas, parkings, bikes]);

  // ── Pontos filtrados
  const pontosFiltrados = useMemo(() => {
    let list = [...parkings];
    if (filtroPontos !== 'todos') list = list.filter(p => colorForParking(p) === filtroPontos);
    if (buscaPonto) {
      const b = buscaPonto.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(b));
    }
    list.sort((a, b) => {
      const order: Record<ParkingColor, number> = { red:5,orange:4,yellow:3,blue:2,green:1,gray:0 };
      return order[colorForParking(b)] - order[colorForParking(a)];
    });
    return list;
  }, [parkings, filtroPontos, buscaPonto]);

  // ── Carregar histórico
  const carregarHistorico = useCallback(async () => {
    if (!cidade) return;
    setCarregandoHist(true);
    try {
      const { data, error } = await supabase
        .from('parking_history')
        .select('*')
        .eq('cidade', cidade)
        .order('data', { ascending: false })
        .limit(90);
      if (error) throw error;
      setHistorico((data ?? []).map((d: any) => ({ id: d.id, ...d })));
    } catch { setHistorico([]); }
    finally { setCarregandoHist(false); }
  }, [cidade]);

  useEffect(() => { if (aba === 'historico' && historico.length === 0) carregarHistorico(); }, [aba, historico.length, carregarHistorico]);

  // ── Export histórico CSV
  const exportarHistoricoCSV = useCallback(async () => {
    setExportandoHist(true);
    try {
      const fn = fnExportarHistoricoParking();
      const res: any = await fn({ cidade, dias: 90 });
      const rows = res.data ?? [];
      const header = 'Data,Cidade,Pontos,Monitores,Zerados,Bikes,Disponíveis,Eficiência%';
      const lines = rows.map((r: any) =>
        `${r.data},${r.cidade},${r.pontosTotal??0},${r.monitoresTotal??0},${r.monitoresZerados??0},${r.bikesTotal??0},${r.bikesDisponiveis??0},${r.eficienciaPct??0}`
      );
      const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `historico_${cidade}_${new Date().toISOString().slice(0,10)}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch { /* silencioso */ }
    finally { setExportandoHist(false); }
  }, [cidade]);

  // ── Export CSV pontos (snapshot atual)
  const exportCSV = useCallback(() => {
    const header = 'Nome,Monitor,Disponíveis,Target,Cor,Lat,Lng';
    const rows = parkings.map(p =>
      `"${p.name}",${p.monitor?'sim':'não'},${p.availableCount??0},${p.target_bikes_count??0},${colorForParking(p)},${p.latitude},${p.longitude}`
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `pontos_${cidade}_${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(url);
  }, [parkings, cidade]);

  if (!visivel) return null;

  const S = {
    overlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,.85)', zIndex:2500, display:'flex', flexDirection:'column' as const },
    header:  { background:'#111827', borderBottom:`1px solid ${C.bord}`, padding:'12px 16px', display:'flex', alignItems:'center', gap:12, flexShrink:0 },
    abas:    { display:'flex', gap:4, padding:'10px 12px', borderBottom:`1px solid ${C.bord}`, background:'#111827', flexShrink:0, overflowX:'auto' as const },
    abaBtn:  (a:boolean) => ({ padding:'6px 14px', borderRadius:20, border:'none', background: a?'rgba(167,139,250,.2)':'none', color: a?'#a78bfa':'rgba(255,255,255,.4)', fontSize:12, fontWeight:a?700:400, cursor:'pointer', whiteSpace:'nowrap' as const }),
    body:    { flex:1, overflowY:'auto' as const, padding:14 },
  };

  const ABAS: { id:AbaId; label:string }[] = [
    { id:'resumo',    label:pick(T.abaResumo)    },
    { id:'pontos',    label:pick(T.abaPontos)    },
    { id:'zonas',     label:pick(T.abaZonas)     },
    { id:'patinetes', label:pick(T.abaPatinetes) },
    { id:'historico', label:pick(T.abaHistorico) },
  ];

  return (
    <div style={S.overlay}>
      {/* Header */}
      <div style={S.header}>
        <button onClick={onFechar} style={{ background:'none',border:'none',color:'rgba(255,255,255,.5)',fontSize:20,cursor:'pointer',padding:0 }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>{pick(T.titulo)}</div>
          <div style={{ fontSize:10, color:C.dim }}>
            {cidade} {snapshotAge !== null ? `• ${pick(T.snapshotAtras).replace('{n}', String(snapshotAge))}` : ''} {carregando ? `• ${pick(T.carregando)}` : `• ${pick(T.pontosBikes).replace('{p}', String(parkings.length)).replace('{b}', String(bikes.length))}`}
          </div>
        </div>
        <button onClick={carregar} style={{ background:'rgba(255,255,255,.05)',border:`1px solid ${C.bord}`,borderRadius:8,color:C.txt,fontSize:11,padding:'5px 10px',cursor:'pointer' }}>
          🔄
        </button>
      </div>

      {/* Abas */}
      <div style={S.abas}>
        {ABAS.map(a => <button key={a.id} style={S.abaBtn(aba===a.id)} onClick={() => setAba(a.id)}>{a.label}</button>)}
      </div>

      {/* Body */}
      <div style={S.body}>
        {carregando && !parkings.length ? (
          <div style={{ textAlign:'center', color:C.dim, paddingTop:40 }}>{pick(T.carregandoSnapshot)}</div>
        ) : (
          <>
            {/* ── RESUMO ── */}
            {aba === 'resumo' && (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, marginBottom:14 }}>
                  <KpiCard label={pick(T.kpiDisponiveis)} value={stats.bikesDisponiveis} color="#22c55e" sub={pick(T.kpiDeTotal).replace('{n}', String(stats.bikesTotal))} />
                  <KpiCard label={pick(T.kpiEmUso)}       value={stats.bikesEmUso}       color="#f59e0b" />
                  <KpiCard label={pick(T.kpiZerados)}     value={stats.monitoresZerados} color="#ef4444" sub={pick(T.kpiDeMonitores).replace('{n}', String(stats.monitores))} />
                  <KpiCard label={pick(T.kpiEficiencia)}  value={`${stats.efficiencyPct}%`} color={stats.efficiencyPct>80?'#22c55e':stats.efficiencyPct>50?'#f59e0b':'#ef4444'} />
                </div>
                <Card style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:C.txt, marginBottom:10 }}>{pick(T.distCores)}</div>
                  {(['red','orange','yellow','blue','green','gray'] as ParkingColor[]).map(cor => {
                    const count = parkings.filter(p => colorForParking(p) === cor).length;
                    const pct   = parkings.length > 0 ? Math.round((count/parkings.length)*100) : 0;
                    return (
                      <div key={cor} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                        <div style={{ width:10, height:10, borderRadius:'50%', background:PARKING_COLOR_HEX[cor], flexShrink:0 }} />
                        <div style={{ fontSize:11, color:C.txt, width:120 }}>{cor === 'red' ? pick(T.corZerado) : cor === 'orange' ? pick(T.corBaixo) : cor === 'yellow' ? pick(T.corMedio) : cor === 'blue' ? pick(T.corNoTarget) : cor === 'green' ? pick(T.corExcesso) : pick(T.corSemTarget)}</div>
                        <div style={{ flex:1, background:C.bord, borderRadius:4, height:6 }}>
                          <div style={{ width:`${pct}%`, background:PARKING_COLOR_HEX[cor], height:6, borderRadius:4 }} />
                        </div>
                        <div style={{ fontSize:11, color:C.dim, width:36, textAlign:'right' }}>{count}</div>
                      </div>
                    );
                  })}
                </Card>
                {zoneStats.length > 0 && (
                  <Card>
                    <div style={{ fontSize:12, fontWeight:700, color:C.txt, marginBottom:10 }}>{pick(T.topZonas)}</div>
                    {[...zoneStats].sort((a,b) => a.efficiencyPct-b.efficiencyPct).slice(0,5).map(z => (
                      <div key={z.zoneId} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        <div style={{ fontSize:11, color:C.txt, flex:1 }}>{z.zoneName}</div>
                        <div style={{ fontSize:11, color: z.efficiencyPct>80?'#22c55e':z.efficiencyPct>50?'#f59e0b':'#ef4444', fontWeight:700 }}>{z.efficiencyPct}%</div>
                        <div style={{ fontSize:10, color:C.dim }}>{pick(T.zerados).replace('{n}', String(z.monitorEmpty))}</div>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            )}

            {/* ── PONTOS ── */}
            {aba === 'pontos' && (
              <div>
                <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' as const }}>
                  {(['todos','red','orange','yellow','blue','green'] as const).map(f => (
                    <button key={f} onClick={() => setFiltroPontos(f)}
                      style={{ padding:'4px 10px', borderRadius:20, border:'none', fontSize:11, cursor:'pointer',
                               background: filtroPontos===f ? (f==='todos'?'#a78bfa':PARKING_COLOR_HEX[f as ParkingColor])+'33' : 'rgba(255,255,255,.06)',
                               color: filtroPontos===f ? (f==='todos'?'#a78bfa':PARKING_COLOR_HEX[f as ParkingColor]) : C.dim }}>
                      {f==='todos'?pick(T.filtroTodos):f==='red'?pick(T.filtroZerados):f==='orange'?pick(T.filtroBaixo):f==='yellow'?pick(T.filtroMedio):f==='blue'?pick(T.filtroOk):pick(T.filtroExcesso)}
                    </button>
                  ))}
                  <input value={buscaPonto} onChange={e=>setBuscaPonto(e.target.value)} placeholder={pick(T.buscar)}
                    style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:8, border:`1px solid ${C.bord}`, background:'rgba(255,255,255,.05)', color:'#fff', fontSize:11 }} />
                  <button onClick={exportCSV} style={{ padding:'4px 10px', borderRadius:8, border:`1px solid ${C.bord}`, background:'none', color:C.dim, fontSize:11, cursor:'pointer' }}>📥 CSV</button>
                </div>
                <div style={{ fontSize:11, color:C.dim, marginBottom:8 }}>{pick(T.nPontos).replace('{n}', String(pontosFiltrados.length))}</div>
                {pontosFiltrados.slice(0,200).map(p => {
                  const cor = colorForParking(p);
                  const avail = p.availableCount ?? 0;
                  return (
                    <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderBottom:`1px solid ${C.bord}` }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:PARKING_COLOR_HEX[cor], flexShrink:0 }} />
                      <div style={{ flex:1, fontSize:12, color:C.txt }}>{p.name}</div>
                      <div style={{ fontSize:11, color: avail===0?'#ef4444':'#22c55e', fontWeight:700 }}>{avail}</div>
                      <div style={{ fontSize:10, color:C.dim }}>/{p.target_bikes_count??'—'}</div>
                      {p.monitor && <div style={{ fontSize:9, background:'rgba(167,139,250,.15)', color:'#a78bfa', borderRadius:4, padding:'1px 5px' }}>MON</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── ZONAS ── */}
            {aba === 'zonas' && (
              <div>
                {zoneStats.length === 0 ? (
                  <div style={{ textAlign:'center', color:C.dim, paddingTop:40 }}>
                    <div style={{ fontSize:32 }}>🗺</div>
                    <div style={{ fontSize:12, marginTop:8 }}>{pick(T.nenhumaZona).replace('{cidade}', cidade)}</div>
                    <div style={{ fontSize:10, marginTop:4 }}>{pick(T.configZonas)}</div>
                  </div>
                ) : (
                  zoneStats.map(z => (
                    <Card key={z.zoneId} style={{ marginBottom:10 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#fff', flex:1 }}>{z.zoneName}</div>
                        <div style={{
                          fontSize:13, fontWeight:800,
                          color: z.efficiencyPct>80?'#22c55e':z.efficiencyPct>50?'#f59e0b':'#ef4444'
                        }}>{z.efficiencyPct}%</div>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                        <div style={{ fontSize:11, color:C.dim }}>{pick(T.zPontos)} <span style={{ color:'#fff', fontWeight:700 }}>{z.parkingsTotal}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>{pick(T.zMonitores)} <span style={{ color:'#fff', fontWeight:700 }}>{z.monitorTotal}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>{pick(T.zZerados)} <span style={{ color:'#ef4444', fontWeight:700 }}>{z.monitorEmpty}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>{pick(T.zBikes)} <span style={{ color:'#22c55e', fontWeight:700 }}>{z.bikesAvailable}</span> {pick(T.zDisp)}</div>
                        <div style={{ fontSize:11, color:C.dim }}>{pick(T.zEmUso)} <span style={{ color:'#f59e0b', fontWeight:700 }}>{z.bikesRenting}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>{pick(T.zForaPonto)} <span style={{ color:C.dim, fontWeight:700 }}>{z.bikesOutOfParking}</span></div>
                      </div>
                      {z.emptyMonitors.length > 0 && (
                        <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.bord}` }}>
                          <div style={{ fontSize:10, color:C.dim, marginBottom:4 }}>{pick(T.zSemBike)}</div>
                          <div style={{ display:'flex', flexWrap:'wrap' as const, gap:4 }}>
                            {z.emptyMonitors.slice(0,8).map(m => (
                              <span key={m.id} style={{ fontSize:9, background:'rgba(239,68,68,.12)', color:'#ef4444', borderRadius:4, padding:'2px 6px' }}>{m.name}</span>
                            ))}
                            {z.emptyMonitors.length > 8 && <span style={{ fontSize:9, color:C.dim }}>+{z.emptyMonitors.length-8}</span>}
                          </div>
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* ── PATINETES ── */}
            {aba === 'patinetes' && (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, marginBottom:14 }}>
                  {(Object.entries(stats.bikesByStatus) as [BikeStatus,number][])
                    .filter(([,v]) => v > 0)
                    .sort((a,b) => b[1]-a[1])
                    .map(([st, count]) => (
                      <Card key={st} style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:10, height:10, borderRadius:'50%', background:BIKE_STATUS_HEX[st], flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'#fff' }}>{count}</div>
                          <div style={{ fontSize:10, color:C.dim }}>{BIKE_STATUS_LABEL[st]}</div>
                        </div>
                        <div style={{ fontSize:11, color:C.dim }}>{Math.round((count/Math.max(1,stats.bikesTotal))*100)}%</div>
                      </Card>
                    ))}
                </div>
                {/* Bikes bateria baixa */}
                {stats.bikesByStatus.low_battery > 0 && (
                  <Card>
                    <div style={{ fontSize:12, fontWeight:700, color:'#f97316', marginBottom:8 }}>{pick(T.bateriaBaixa).replace('{n}', String(stats.bikesByStatus.low_battery))}</div>
                    {bikes
                      .filter(b => classifyBike(b) === 'low_battery')
                      .sort((a,b) => (a.battery_percent??1)-(b.battery_percent??1))
                      .slice(0,20)
                      .map(b => (
                        <div key={b.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                          <div style={{ fontSize:11, color:C.txt, flex:1 }}>{(b as any).identifier ?? b.id.slice(-6)}</div>
                          <div style={{ fontSize:11, color:'#f97316', fontWeight:700 }}>
                            {Math.round(((b.battery_percent??0))*100)}%
                          </div>
                        </div>
                      ))}
                  </Card>
                )}
              </div>
            )}
            {/* ── HISTÓRICO ── */}
            {aba === 'historico' && (
              <div>
                <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' as const }}>
                  <button onClick={carregarHistorico} disabled={carregandoHist}
                    style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${C.bord}`, background:'none', color:C.txt, fontSize:11, cursor:'pointer' }}>
                    {pick(T.atualizar)}
                  </button>
                  <button onClick={exportarHistoricoCSV} disabled={exportandoHist}
                    style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${C.bord}`, background:'none', color:'#22c55e', fontSize:11, cursor:'pointer' }}>
                    {exportandoHist ? pick(T.exportando) : pick(T.exportarCSV)}
                  </button>
                </div>
                {carregandoHist ? (
                  <div style={{ textAlign:'center', color:C.dim, paddingTop:30 }}>{pick(T.carregandoHist)}</div>
                ) : historico.length === 0 ? (
                  <div style={{ textAlign:'center', color:C.dim, paddingTop:30 }}>
                    <div style={{ fontSize:28 }}>📅</div>
                    <div style={{ fontSize:12, marginTop:8 }}>{pick(T.nenhumHist)}</div>
                    <div style={{ fontSize:10, marginTop:4 }}>{pick(T.histAuto)}</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:11, color:C.dim, marginBottom:8 }}>{pick(T.nRegistros).replace('{n}', String(historico.length))}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4, marginBottom:6, fontSize:10, color:C.dim, padding:'0 4px' }}>
                      <div>{pick(T.hData)}</div><div>{pick(T.hPontos)}</div><div>{pick(T.hMonitores)}</div><div>{pick(T.hZerados)}</div><div>{pick(T.hEficiencia)}</div>
                    </div>
                    {historico.map(h => (
                      <div key={h.id} style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4, padding:'7px 4px', borderBottom:`1px solid ${C.bord}` }}>
                        <div style={{ fontSize:11, color:C.txt }}>{h.data}</div>
                        <div style={{ fontSize:11, color:C.txt }}>{h.pontosTotal ?? '—'}</div>
                        <div style={{ fontSize:11, color:C.txt }}>{h.monitoresTotal ?? '—'}</div>
                        <div style={{ fontSize:11, color: (h.monitoresZerados ?? 0) > 0 ? '#ef4444' : '#22c55e' }}>{h.monitoresZerados ?? '—'}</div>
                        <div style={{ fontSize:11, fontWeight:700, color: (h.eficienciaPct??0) > 80 ? '#22c55e' : (h.eficienciaPct??0) > 50 ? '#f59e0b' : '#ef4444' }}>
                          {h.eficienciaPct ?? '—'}%
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
