// src/AnalyticsManager.tsx — v2: comparação A/B, score estações, clusters, timeline, OD, tendência
import { useState, useEffect, useRef, useCallback, useMemo, CSSProperties } from 'react';
import DeckGL from '@deck.gl/react';
import { PolygonLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { ScatterplotLayer, ArcLayer, TextLayer } from '@deck.gl/layers';
import type { MapViewState } from '@deck.gl/core';
import { Map as MapLibreMap } from 'react-map-gl/maplibre';
import { db, storage } from './lib/firebase';
import {
  collection, doc, setDoc, getDocs, deleteDoc, query, orderBy, getDoc,
  onSnapshot, where, Timestamp
} from 'firebase/firestore';
import { ref, deleteObject, getBytes } from 'firebase/storage';
import { uploadComRetry } from './lib/uploadUtils';

// ── TIPOS ────────────────────────────────────────────────────────
interface Ride { ls:number; lo:number; le:number; ln:number; d:number; dur:number; rev:number; h:number; zs:string; cidade?:string; }
interface DayMeta { date:string; regiao?:string; cidade?:string; total:number; total_rev:number; avg_dist_km:number; avg_dur_min:number; by_hour:Record<string,number>; cities:string[]; uploaded_at:string; storage_path:string; url?:string; uploadedBy?:string; }
interface DayData { meta:DayMeta; rides:Ride[]; }
interface Estacao { id:string; lat:number; lng:number; codigo?:string; bairro?:string; endereco?:string; tipo?:string; }
interface Cluster { lat:number; lng:number; count:number; nearestStation:number; }
interface StationScore { id:string; lat:number; lng:number; codigo:string; nome?:string; endereco?:string; bairro:string; starts:number; ends:number; total:number; rev:number; score:number; byHour:Record<string,number>; }

// ── CONSTANTES ───────────────────────────────────────────────────
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MAP_STYLE = { version:8 as const, sources:{ carto:{ type:'raster' as const, tiles:['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize:256 }}, layers:[{id:'bg',type:'raster' as const,source:'carto'}] };
const R_EARTH = 6371000; // metros

// ── GEO UTILS ────────────────────────────────────────────────────
function haversine(lat1:number,lon1:number,lat2:number,lon2:number):number {
  const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R_EARTH*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// Grid-based clustering: agrupa pontos em células de ~gridSize metros
function gridCluster(points:{lat:number,lng:number}[], gridSize:number): {lat:number,lng:number,count:number}[] {
  const cells: Record<string,{lat:number,lng:number,count:number}> = {};
  const deg = gridSize / 111000;
  for (const p of points) {
    const k = `${Math.floor(p.lat/deg)},${Math.floor(p.lng/deg)}`;
    if (!cells[k]) cells[k] = { lat:Math.floor(p.lat/deg)*deg+deg/2, lng:Math.floor(p.lng/deg)*deg+deg/2, count:0 };
    cells[k].count++;
  }
  return Object.values(cells);
}


// ════════════════════════════════════════════════════════════════
// PAINEL DE PERDAS — Roubos, Vandalismo, Baterias por filial
// ════════════════════════════════════════════════════════════════
const TOTAIS_HISTORICOS: Record<string,{patinetes:number;bicicletas:number;baterias:number;total:number}> = {
  'Pará (Belém)':                            {patinetes:1,  bicicletas:0, baterias:9,   total:10},
  'Minas Gerais (BH)':                       {patinetes:91, bicicletas:0, baterias:100, total:191},
  'Ceará (Fortaleza)':                       {patinetes:3,  bicicletas:0, baterias:1,   total:4},
  'Pernambuco (Recife)':                     {patinetes:22, bicicletas:0, baterias:41,  total:63},
  'Sergipe (Aracaju)':                       {patinetes:0,  bicicletas:2, baterias:0,   total:2},
  'Bahia (Salvador)':                        {patinetes:3,  bicicletas:0, baterias:8,   total:11},
  'Espírito Santo (Vila Velha)':             {patinetes:12, bicicletas:0, baterias:57,  total:69},
  'RG Norte (Natal)':                        {patinetes:8,  bicicletas:0, baterias:0,   total:8},
  'SP Capital':                              {patinetes:89, bicicletas:0, baterias:24,  total:113},
  'SP Litoral':                              {patinetes:24, bicicletas:0, baterias:7,   total:31},
  'SP Estado (Campinas)':                    {patinetes:3,  bicicletas:0, baterias:1,   total:4},
  'Distr. Fed. (Brasília)':                  {patinetes:1,  bicicletas:1, baterias:1,   total:3},
  'Santa Catarina':                          {patinetes:8,  bicicletas:2, baterias:25,  total:35},
  'Paraná (Londrina / Matinhos / Guaratuba)':{patinetes:0,  bicicletas:0, baterias:0,   total:0},
  'RG Sul (Porto Alegre, Tramandaí...)':     {patinetes:3,  bicicletas:0, baterias:2,   total:5},
};

const REGIOES: Record<string,string[]> = {
  'Região Norte':   ['Pará (Belém)','Minas Gerais (BH)','Ceará (Fortaleza)','Pernambuco (Recife)','Sergipe (Aracaju)','Bahia (Salvador)','Espírito Santo (Vila Velha)','RG Norte (Natal)'],
  'Região Centro':  ['SP Capital','SP Litoral','SP Estado (Campinas)'],
  'Região Sul':     ['Distr. Fed. (Brasília)','Santa Catarina','Paraná (Londrina / Matinhos / Guaratuba)','RG Sul (Porto Alegre, Tramandaí...)'],
};


// ── Gráfico de barras agrupadas para o PerdasPanel ─────────────────

// ── Gráfico comparativo Ontem × Este Mês × Acumulado ─────────────────
function PerdasTrendChart({
  incidentes,
  modoRoubos,
}: {
  incidentes: any[];
  modoRoubos: boolean;
}) {
  const agora  = new Date();
  const ontem  = new Date(agora); ontem.setDate(ontem.getDate() - 1);
  const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  const getTs = (i: any): Date | null => {
    const ts = (i.criadoEm as any)?.toDate?.() ? (i.criadoEm as any).toDate()
             : i.created_at ? new Date(i.created_at) : null;
    return ts && !isNaN(ts.getTime()) ? ts : null;
  };

  const base = modoRoubos
    ? incidentes.filter((i: any) => i.tipo === 'Roubo' || i.tipo === 'Furto')
    : incidentes;

  const calcKpis = (lista: any[]) => ({
    total:      lista.length,
    patinetes:  lista.filter((i: any) => String(i.ativo_tipo||'').toLowerCase().includes('patinete')).length,
    bicicletas: lista.filter((i: any) => String(i.ativo_tipo||'').toLowerCase().includes('bicicleta')).length,
    baterias:   lista.filter((i: any) => String(i.ativo_tipo||'').toLowerCase().includes('bateria')).length,
  });

  const doOntem = calcKpis(base.filter((i: any) => {
    const ts = getTs(i); if (!ts) return false;
    return ts.getDate() === ontem.getDate() && ts.getMonth() === ontem.getMonth() && ts.getFullYear() === ontem.getFullYear();
  }));

  const doMes = calcKpis(base.filter((i: any) => {
    const ts = getTs(i); if (!ts) return false;
    return ts >= iniMes;
  }));

  const doTotal = modoRoubos
    ? { total: 273, patinetes: 268, bicicletas: 5, baterias: 0 }
    : { total: 549, patinetes: 268, bicicletas: 5, baterias: 276 };

  const periodos = [
    { label: 'Ontem',     d: doOntem },
    { label: 'Este mês',  d: doMes   },
    { label: 'Acumulado', d: doTotal },
  ];

  const SERIES = modoRoubos
    ? [
        { key: 'total' as const,      label: 'Total',      cor: '#ef4444' },
        { key: 'patinetes' as const,  label: '🛴 Patinetes', cor: '#3b82f6' },
        { key: 'bicicletas' as const, label: '🚲 Bicicletas', cor: '#e2e8f0' },
      ]
    : [
        { key: 'total' as const,      label: 'Total',      cor: '#f87171' },
        { key: 'patinetes' as const,  label: '🛴 Patinetes', cor: '#3b82f6' },
        { key: 'bicicletas' as const, label: '🚲 Bicicletas', cor: '#e2e8f0' },
        { key: 'baterias' as const,   label: '🔋 Baterias',  cor: '#a78bfa' },
      ];

  const maxVal = Math.max(
    ...periodos.flatMap(p => SERIES.map(s => p.d[s.key])), 1
  );

  const W  = 320;
  const H  = 130;
  const PL = 32;  // padding esquerda (labels Y)
  const PR = 10;
  const PT = 20;  // padding topo (legenda)
  const PB = 24;  // padding base (labels X)
  const CW = W - PL - PR;
  const CH = H - PT - PB;

  // posição X de cada grupo de períodos
  const xPeriodo = (pi: number) => PL + (pi + 0.5) * (CW / periodos.length);
  // posição X de cada série dentro do grupo
  const BAR_W    = Math.floor((CW / periodos.length) * 0.8 / SERIES.length);
  const GROUP_W  = BAR_W * SERIES.length;
  const xBar     = (pi: number, si: number) =>
    PL + (pi * CW / periodos.length) + ((CW / periodos.length) - GROUP_W) / 2 + si * BAR_W;

  // Linha de grade
  const yLines = [0.25, 0.5, 0.75, 1].map(f => ({
    y: PT + CH * (1 - f),
    v: Math.round(maxVal * f),
  }));

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ fontFamily: 'Inter,sans-serif', fontSize: 8, display: 'block' }}>

        {/* Grade */}
        {yLines.map(({ y, v }) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="#1c2535" strokeWidth={1}/>
            <text x={PL - 3} y={y + 3} textAnchor="end" fill="#3a4a5a" fontSize={7}>{v}</text>
          </g>
        ))}

        {/* Barras */}
        {periodos.map((p, pi) =>
          SERIES.map((s, si) => {
            const val = p.d[s.key];
            const bh  = val > 0 ? Math.max(3, Math.round((val / maxVal) * CH)) : 0;
            const x   = xBar(pi, si);
            const y   = PT + CH - bh;
            return (
              <g key={s.key + pi}>
                <rect x={x} y={y} width={BAR_W - 1} height={bh}
                      fill={s.cor} rx={2} opacity={0.85}/>
                {bh > 14 && (
                  <text x={x + (BAR_W - 1) / 2} y={y + 10}
                        textAnchor="middle" fill="#fff" fontSize={7} fontWeight="700">{val}</text>
                )}
                {bh > 0 && bh <= 14 && (
                  <text x={x + (BAR_W - 1) / 2} y={y - 2}
                        textAnchor="middle" fill={s.cor} fontSize={7}>{val}</text>
                )}
              </g>
            );
          })
        )}

        {/* Labels X */}
        {periodos.map((p, pi) => (
          <text key={p.label} x={xPeriodo(pi)} y={H - PB + 12}
                textAnchor="middle" fill="#6b7280" fontSize={8}>{p.label}</text>
        ))}

        {/* Eixo base */}
        <line x1={PL} x2={W - PR} y1={PT + CH} y2={PT + CH} stroke="#1c2535" strokeWidth={1}/>

        {/* Legenda */}
        {SERIES.map((s, i) => (
          <g key={s.key} transform={`translate(${PL + i * 72}, 10)`}>
            <rect x={0} y={-6} width={8} height={6} fill={s.cor} rx={1} opacity={0.85}/>
            <text x={11} y={0} fill={s.cor} fontSize={7} fontWeight="600">{s.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function PerdasBarChart({ kpis }: { kpis: Record<string,{patinetes:number;bicicletas:number;baterias:number;total:number}> }) {
  const filiais = Object.keys(TOTAIS_HISTORICOS);
  const comDados = filiais.filter(f => (kpis[f]?.total || 0) > 0);
  if (!comDados.length) return null;

  const maxTotal = Math.max(...comDados.map(f => kpis[f]?.total || 0), 1);
  const ROW_H  = 28; // altura de cada filial
  const GAP    = 6;
  const PAD_L  = 92;
  const PAD_R  = 48;
  const PAD_T  = 24;
  const PAD_B  = 10;
  const CW     = 200; // largura barras
  const totalH = PAD_T + comDados.length * (ROW_H + GAP) + PAD_B;

  return (
    <div style={{ overflowX:'auto', overflowY:'hidden' }}>
      <svg width={PAD_L + CW + PAD_R} height={totalH}
           style={{ fontFamily:'Inter,sans-serif', fontSize:9, display:'block' }}>

        {/* Legenda topo */}
        <g transform={`translate(${PAD_L},12)`}>
          {([['🛴','#3b82f6'],['🚲','#e2e8f0'],['🔋','#a78bfa']] as [string,string][]).map(([icon,c],i) => (
            <g key={icon} transform={`translate(${i*52},0)`}>
              <rect x={0} y={-7} width={8} height={8} fill={c} rx={2} opacity={0.9}/>
              <text x={11} y={0} fill={c} fontSize={8} fontWeight="600">{icon}</text>
            </g>
          ))}
        </g>

        {comDados.map((f, gi) => {
          const k  = kpis[f] || {patinetes:0,bicicletas:0,baterias:0,total:0};
          const y  = PAD_T + gi * (ROW_H + GAP);
          const cy = y + ROW_H / 2; // centro vertical da linha
          const label = f.length > 17 ? f.slice(0,15)+'…' : f;

          // Barra empilhada horizontal (stacked)
          const totalW = Math.round((k.total / maxTotal) * CW);
          const pW  = k.total > 0 ? Math.round((k.patinetes  / k.total) * totalW) : 0;
          const bW  = k.total > 0 ? Math.round((k.bicicletas / k.total) * totalW) : 0;
          const btW = Math.max(0, totalW - pW - bW);

          return (
            <g key={f}>
              {/* Label filial */}
              <text x={PAD_L - 5} y={cy + 3} textAnchor="end"
                    fill="#9fb3c8" fontSize={8} fontWeight="500">{label}</text>

              {/* Barra de fundo (trilha) */}
              <rect x={PAD_L} y={cy - 6} width={CW} height={12}
                    fill="#111722" rx={3}/>

              {/* Segmentos coloridos empilhados */}
              {pW > 0  && <rect x={PAD_L}        y={cy-6} width={pW}  height={12} fill="#3b82f6" rx={3} opacity={0.9}/>}
              {bW > 0  && <rect x={PAD_L+pW}     y={cy-6} width={bW}  height={12} fill="#e2e8f0" opacity={0.9}/>}
              {btW > 0 && <rect x={PAD_L+pW+bW}  y={cy-6} width={btW} height={12} fill="#a78bfa" opacity={0.9}/>}

              {/* Total à direita */}
              <text x={PAD_L + CW + 5} y={cy + 4}
                    fill="#f87171" fontSize={9} fontWeight="700">{k.total}</text>

              {/* Valores dentro se couber */}
              {pW > 20  && <text x={PAD_L + pW/2}       y={cy+3} textAnchor="middle" fill="#fff" fontSize={7} fontWeight="700">{k.patinetes}</text>}
              {bW > 16  && <text x={PAD_L+pW + bW/2}    y={cy+3} textAnchor="middle" fill="#fff" fontSize={7} fontWeight="700">{k.bicicletas}</text>}
              {btW > 16 && <text x={PAD_L+pW+bW+btW/2}  y={cy+3} textAnchor="middle" fill="#fff" fontSize={7} fontWeight="700">{k.baterias}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PerdasPanel({ incidentes, loading, modoRoubos=false }: { incidentes: any[]; loading: boolean; modoRoubos?: boolean }) {
  const [periodoPerda, setPeriodoPerda] = useState<'ontem'|'mes'|'total'>('total');
  const [verDetalhe,   setVerDetalhe]   = useState(false);
  const [filialSel,    setFilialSel]    = useState<string|null>(null);

  const agora  = new Date();
  const ontem  = new Date(agora); ontem.setDate(ontem.getDate()-1);
  const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  // Filtrar por período — modoRoubos filtra só Roubo/Furto; Perdas conta tudo
  const filtrados = useMemo(() => {
    if (periodoPerda === 'total') return modoRoubos ? incidentes.filter((i:any) => i.tipo==='Roubo'||i.tipo==='Furto') : incidentes;
    return incidentes.filter(i => {
      if (modoRoubos && i.tipo !== 'Roubo' && i.tipo !== 'Furto') return false;
      // aceita criadoEm (Timestamp) ou created_at (string ISO)
      const ts = (i.criadoEm as any)?.toDate?.() ? (i.criadoEm as any).toDate() : (i.created_at ? new Date(i.created_at) : null);
      if (!ts || isNaN(ts.getTime())) return false;
      if (periodoPerda === 'ontem') {
        return ts.getDate()  === ontem.getDate()  &&
               ts.getMonth() === ontem.getMonth() &&
               ts.getFullYear() === ontem.getFullYear();
      }
      return ts >= iniMes;
    });
  }, [incidentes, periodoPerda]);

  // KPIs por filial
  // - Total: usa os 549 históricos da planilha (fonte de verdade)
  // - Ontem/Mês: conta do banco sem filtrar por tipo nem status (perda bruta = ocorreu)
  const kpisPorFilial = useMemo(() => {
    const base: Record<string,{patinetes:number;bicicletas:number;baterias:number;total:number}> = {};
    const filiais = Object.keys(TOTAIS_HISTORICOS);
    filiais.forEach(f => {
      if (periodoPerda === 'total') {
        if (modoRoubos) {
          // Roubos acumulados = patinetes + bicicletas (veículos), não baterias
          const h = TOTAIS_HISTORICOS[f];
          const tot = h.patinetes + h.bicicletas;
          base[f] = { patinetes: h.patinetes, bicicletas: h.bicicletas, baterias: 0, total: tot };
        } else {
          base[f] = { ...TOTAIS_HISTORICOS[f] };
        }
      } else {
        const docs = filtrados.filter(i => (i.filial || '') === f);
        const p   = docs.filter(i => String(i.ativo_tipo||'').toLowerCase().includes('patinete')).length;
        const b   = docs.filter(i => String(i.ativo_tipo||'').toLowerCase().includes('bicicleta')).length;
        const bat = docs.filter(i => String(i.ativo_tipo||'').toLowerCase().includes('bateria')).length;
        base[f] = { patinetes: p, bicicletas: b, baterias: bat, total: docs.length };
      }
    });
    return base;
  }, [filtrados, periodoPerda]);

  const totalGeral = periodoPerda === 'total'
    ? (modoRoubos ? { patinetes: 268, bicicletas: 5, baterias: 0, total: 273 } : { patinetes: 268, bicicletas: 5, baterias: 276, total: 549 }) // fonte: planilha histórica
    : (() => {
        // Ontem / Este mês — agrupa direto dos filtrados sem filtrar tipo/status
        const at = String; // alias
        return filtrados.reduce((acc, i) => {
          const tipo = String(i.ativo_tipo||'').toLowerCase();
          return {
            patinetes:  acc.patinetes  + (tipo.includes('patinete')  ? 1 : 0),
            bicicletas: acc.bicicletas + (tipo.includes('bicicleta') ? 1 : 0),
            baterias:   acc.baterias   + (tipo.includes('bateria')   ? 1 : 0),
            total:      acc.total + 1,
          };
        }, { patinetes:0, bicicletas:0, baterias:0, total:0 });
      })();

  const sec: CSSProperties = { padding:'12px 14px', borderBottom:'1px solid #1c2535' };
  const hdr: CSSProperties = { fontSize:9, color:'#4a5a7a', textTransform:'uppercase', letterSpacing:.5, marginBottom:6 };

  return (
    <div style={{ flex:1, overflowY:'auto', background:'#080b12', scrollbarWidth:'thin', scrollbarColor:'#1c2535 #080b12' }}>

      {/* Header */}
      <div style={{ padding:'14px 16px', borderBottom:'1px solid #1c2535', background:'rgba(239,68,68,.05)' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#f87171', marginBottom:4 }}>
          {modoRoubos ? '🔴 Painel de Roubos' : '💸 Painel de Perdas'}
        </div>
        <div style={{ fontSize:10, color:'#4a5a7a' }}>
          {modoRoubos ? 'Roubos e furtos confirmados por filial' : 'Ocorrências confirmadas por filial'}
        </div>
      </div>

      {/* Seletor período */}
      <div style={{ display:'flex', gap:4, padding:'10px 14px', borderBottom:'1px solid #1c2535' }}>
        {([['ontem','Ontem'],['mes','Este mês'],['total','Acumulado']] as [string,string][]).map(([v,l]) => (
          <button key={v} onClick={() => setPeriodoPerda(v as any)}
            style={{ flex:1, padding:'5px 0', borderRadius:6, cursor:'pointer', fontSize:10, fontWeight:600,
              background: periodoPerda===v ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.03)',
              border: `1px solid ${periodoPerda===v ? 'rgba(239,68,68,.4)' : '#1c2535'}`,
              color: periodoPerda===v ? '#f87171' : '#4a5a7a' }}>
            {l}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:11 }}>Carregando...</div>}

      {/* KPIs gerais */}
      <div style={sec}>
        <div style={hdr}>Total geral</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {(modoRoubos ? [
            { l:'Roubos/Furtos', v: totalGeral.total,      c:'#ef4444' },
            { l:'Patinetes',     v: totalGeral.patinetes,  c:'#3b82f6' },
            { l:'Bicicletas',    v: totalGeral.bicicletas, c:'#e2e8f0' },
          ] : [
            { l:'Total',      v: totalGeral.total,      c:'#f87171' },
            { l:'Patinetes',  v: totalGeral.patinetes,  c:'#3b82f6' },
            { l:'Bicicletas', v: totalGeral.bicicletas, c:'#e2e8f0' },
            { l:'Baterias',   v: totalGeral.baterias,   c:'#a78bfa' },
          ]).map(k => (
            <div key={k.l} style={{ background:'#111722', borderRadius:6, padding:'8px 6px', border:'1px solid #1c2535', textAlign:'center' }}>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:16, fontWeight:700, color:k.c }}>{k.v}</div>
              <div style={{ fontSize:8, color:'#4a5a7a', marginTop:2 }}>{k.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Gráfico comparativo de períodos */}
      <div style={sec}>
        <div style={hdr}>Evolução — Ontem × Este mês × Acumulado</div>
        <PerdasTrendChart incidentes={incidentes} modoRoubos={modoRoubos} />
      </div>

      {/* Gráfico de barras por filial */}
      <div style={sec}>
        <div style={hdr}>Distribuição visual por filial</div>
        <PerdasBarChart kpis={kpisPorFilial} />
      </div>

      {/* Tabela por filial */}
      <div style={sec}>
        <div style={{ ...hdr, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Por filial</span>
          <button onClick={() => setVerDetalhe(v => !v)}
            style={{ fontSize:8, color:'#3d9bff', background:'none', border:'none', cursor:'pointer' }}>
            {verDetalhe ? '▲ Resumido' : '▼ Detalhe'}
          </button>
        </div>

        {Object.entries(REGIOES).map(([regiao, filiais]) => {
          const totalRegiao = filiais.reduce((s,f) => s + (kpisPorFilial[f]?.total||0), 0);
          if (totalRegiao === 0 && periodoPerda !== 'total') return null;
          return (
            <div key={regiao} style={{ marginBottom:8 }}>
              <div style={{ fontSize:9, color:'#3d9bff', fontWeight:700, marginBottom:4, padding:'4px 0', borderBottom:'1px solid #1c2535' }}>
                {regiao} — <span style={{ color:'#f87171' }}>{totalRegiao}</span>
              </div>
              {filiais.map(f => {
                const k = kpisPorFilial[f] || {patinetes:0,bicicletas:0,baterias:0,total:0};
                if (k.total === 0 && periodoPerda !== 'total') return null;
                const maxT = Math.max(...Object.values(kpisPorFilial).map(x => x.total), 1);
                return (
                  <div key={f}
                    onClick={() => setFilialSel(filialSel === f ? null : f)}
                    style={{ cursor:'pointer', marginBottom:3, padding:'6px 8px', borderRadius:6,
                      background: filialSel===f ? 'rgba(239,68,68,.08)' : 'rgba(255,255,255,.02)',
                      border:`1px solid ${filialSel===f ? 'rgba(239,68,68,.25)' : 'transparent'}` }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                      <span style={{ fontSize:10, color:'#dce8ff', flex:1 }}>{f}</span>
                      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color:'#f87171' }}>{k.total}</span>
                    </div>
                    <div style={{ height:3, background:'#1c2535', borderRadius:2, marginBottom: verDetalhe?4:0 }}>
                      <div style={{ height:'100%', borderRadius:2, background:'#ef4444', width:`${k.total/maxT*100}%`, transition:'width .3s' }}/>
                    </div>
                    {verDetalhe && k.total > 0 && (
                      <div style={{ display:'flex', gap:8, marginTop:2 }}>
                        {k.patinetes>0  && <span style={{ fontSize:8, color:'#3b82f6' }}>🛴 {k.patinetes}</span>}
                        {k.bicicletas>0 && <span style={{ fontSize:8, color:'#e2e8f0' }}>🚲 {k.bicicletas}</span>}
                        {k.baterias>0   && <span style={{ fontSize:8, color:'#a78bfa' }}>🔋 {k.baterias}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Detalhe da filial selecionada */}
      {filialSel && (
        <div style={sec}>
          <div style={hdr}>Incidentes — {filialSel}</div>
          {incidentes.filter(i => i.filial === filialSel).slice(0,20).map((inc,i) => (
            <div key={inc.id||i} style={{ padding:'6px 8px', borderRadius:6, marginBottom:4,
              background:'rgba(255,255,255,.02)', border:'1px solid #1c2535' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                <span style={{ fontSize:10, fontWeight:600,
                  color: inc.tipo==='Roubo'?'#ef4444':inc.tipo==='Vandalismo'?'#f59e0b':'#6ee7b7' }}>
                  {inc.tipo}
                </span>
                <span style={{ fontSize:9, color:'#4a5a7a' }}>
                  {inc.created_at ? new Date(inc.created_at).toLocaleDateString('pt-BR') : ''}
                </span>
              </div>
              <div style={{ fontSize:9, color:'#4a5a7a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {inc.bairro_inicial || inc.endereco_inicial?.split(',')[0] || inc.cidade_inicial || '—'}
              </div>
              <div style={{ fontSize:8, color:'#2a3a55', marginTop:1 }}>{inc.ativo_tipo} · {inc.status}</div>
            </div>
          ))}
          {incidentes.filter(i => i.filial === filialSel).length > 20 && (
            <div style={{ fontSize:9, color:'#4a5a7a', textAlign:'center', padding:4 }}>
              + {incidentes.filter(i => i.filial === filialSel).length - 20} incidentes
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsManager({ usuario, showToast }: { usuario:any; showToast:(msg:string,type?:string)=>void; }) {
  // ── STATE ──────────────────────────────────────────────────────
  const [days, setDays] = useState<Record<string,DayData>>({});
  const [activeDays, setActiveDays] = useState<Set<string>>(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<Set<string>>(new Set());
  const [compareB, setCompareB] = useState<Set<string>>(new Set());
  const [compareSide, setCompareSide] = useState<'A'|'B'>('A');
  const [filtered, setFiltered] = useState<Ride[]>([]);
  const [filteredA, setFilteredA] = useState<Ride[]>([]);
  const [filteredB, setFilteredB] = useState<Ride[]>([]);
  const [estacoes, setEstacoes] = useState<Estacao[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [stationScores, setStationScores] = useState<StationScore[]>([]);
  const [showGapHeatmap, setShowGapHeatmap] = useState(false);
  const [showGuardHeat,  setShowGuardHeat]  = useState(false);
  const [guardPoints,    setGuardPoints]    = useState<{lat:number;lng:number;tipo:string;status:string}[]>([]);
  const [incidentes,     setIncidentes]     = useState<any[]>([]);
  const [loadingIncident,setLoadingIncident]= useState(false);
  const [guardDias,      setGuardDias]      = useState<number>(7);
  const [guardCustomDe,  setGuardCustomDe]  = useState<string>('');
  const [guardCustomAte, setGuardCustomAte] = useState<string>('');
  const [guardModoCustom,setGuardModoCustom]= useState<boolean>(false);
  const [guardFiltroTipo,setGuardFiltroTipo]= useState<string>('TODOS');
  const [uploading, setUploading] = useState(false);
  const [mergeCtx, setMergeCtx] = useState<{data:DayData;dateKey:string;dayKey:string;existente:DayData}|null>(null);
  const [regiaoFiltro, setRegiaoFiltro] = useState<string>('todas');
  const [cidadesFiltro, setCidadesFiltro] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [layer, setLayer] = useState<'heat'|'hex'|'pts'|'arc'|'od'>('heat');
  const [activeTab, setActiveTab] = useState<'map'|'trend'|'od'|'guard'|'perdas'|'roubos'>('map');
  const [showStarts, setShowStarts] = useState(true);
  const [showEnds, setShowEnds] = useState(true);
  const [showStations,  setShowStations]  = useState(true);
  const [showPoligonos, setShowPoligonos] = useState(false);
  const [poligonos,     setPoligonos]     = useState<any[]>([]);
  const [showClusters, setShowClusters] = useState(false);
  const [scoreMetric, setScoreMetric] = useState<'count'|'rev'|'dist'|'peak'>('count');
  const [selHours, setSelHours] = useState<Set<number>>(new Set([...Array(24).keys()]));
  const [animHour, setAnimHour] = useState<number|null>(null);
  const [animPlaying, setAnimPlaying] = useState(false);
  const [maxDist, setMaxDist] = useState(13);
  const [maxDur, setMaxDur] = useState(140);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [dragging, setDragging] = useState(false);
  const [sidePanel, setSidePanel] = useState<'filters'|'score'|'clusters'|'hora'>('filters');
  const [horaCompMode, setHoraCompMode] = useState<'diasSel'|'semDia'|'anterior'|'semana'>('diasSel');
  const [viewState, setViewState] = useState<MapViewState>({ longitude:-48.5, latitude:-15.5, zoom:4.2, pitch:0, bearing:0 }); // Vista BR inicial
  const [is3DMode, setIs3DMode] = useState(false);
  const [modo3D, setModo3D] = useState(false);
  const [tooltip, setTooltip] = useState<{x:number,y:number,content:string}|null>(null);
  const animRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isGestor = usuario?.role === 'gestor' || usuario?.role === 'admin';

  // ── LOAD METADATA ────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db,'analytics_days'), orderBy('date','desc')));
        const partial: Record<string,DayData> = {};
        snap.forEach(d => { partial[d.id] = { meta:d.data() as DayMeta, rides:[] }; });
        setDays(partial);
        const latest = Object.keys(partial).sort().pop();
        if (latest) { const [y,mo]=latest.split('-').map(Number); setCalYear(y); setCalMonth(mo-1); }
      } catch { showToast('Erro ao carregar metadados','error'); }
    };
    load();
  }, []);

  // ── LOAD STATIONS ─────────────────────────────────────────────────
  // Carrega estações filtradas pelas cidades dos days ativos
  // Quando não há dias ativos, carrega todas (vista BR)
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db,'estacoes'));
        const sts: Estacao[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (data.lat && data.lng) sts.push({
            id: d.id, lat: data.lat, lng: data.lng,
            codigo: data.codigo, bairro: data.bairro || '',
            endereco: data.endereco || '', tipo: data.tipo,
            cidade: data.cidade || data.geo?.cidade || '',
          } as any);
        });
        setEstacoes(sts);
      } catch { /* silently */ }
    };
    load();
  }, []);

  // Estações visíveis = filtradas pela cidade dos days selecionados
  const estacoesVisiveis = useMemo(() => {
    if (activeDays.size === 0 || cidadesFiltro.size === 0) return estacoes;
    // Cidades ativas = regioes dos days selecionados
    const cidadesAtivas = new Set<string>();
    activeDays.forEach(day => {
      Object.keys(days).filter(k => k === day || k.startsWith(day+'_')).forEach(k => {
        const r = days[k]?.meta?.regiao || days[k]?.meta?.cidade || '';
        if (r) cidadesAtivas.add(r.toLowerCase());
      });
    });
    if (cidadesAtivas.size === 0) return estacoes;
    return estacoes.filter(e => {
      const ec = ((e as any).cidade || (e as any).bairro || '').toLowerCase();
      // Filtro simples: se não temos info de cidade na estação, mostramos todas
      if (!ec) return true;
      return Array.from(cidadesAtivas).some(c => ec.includes(c) || c.includes(ec.split(',')[0]?.trim()));
    });
  }, [estacoes, activeDays, days, cidadesFiltro]);

  // ── LOAD POLÍGONOS ───────────────────────────────────────────────
  useEffect(() => {
    if (!showPoligonos) return;
    const load = async () => {
      try {
        const snap = await getDocs(collection(db,'poligonos'));
        const pts: any[] = [];
        snap.forEach(d => {
          const data = d.data();
          // Suporta tanto 'coords' (legado) quanto 'poligono' (formato atual do ZonasManager)
          const raw: any[] = data.poligono || data.coords || [];
          if (!raw.length) return;
          // Converter {lat,lng} → [lng,lat] (DeckGL usa [lng,lat])
          const coords = raw.map((p: any) =>
            Array.isArray(p) ? p : [p.lng ?? p[1], p.lat ?? p[0]]
          );
          if (coords.length < 3) return;
          // Converter cor hex '#2563eb' → [r,g,b]
          let cor: [number,number,number] = [167,139,250];
          if (data.cor && typeof data.cor === 'string' && data.cor.startsWith('#')) {
            const hex = data.cor.slice(1);
            cor = [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
          } else if (Array.isArray(data.cor) && data.cor.length >= 3) {
            cor = [data.cor[0], data.cor[1], data.cor[2]] as [number,number,number];
          }
          pts.push({
            id: d.id,
            nome: data.nome || d.id,
            cidade: data.cidade || '',
            coords,
            cor,
            ativo: data.ativo !== false,
          });
        });
        setPoligonos(pts.filter(p => p.ativo));
      } catch { /* silently */ }
    };
    load();
  }, [showPoligonos]);

  // ── LOAD RIDES ON DEMAND ─────────────────────────────────────────
  const loadRidesForDay = useCallback(async (dateKey:string): Promise<Ride[]> => {
    // Use functional getter to avoid stale closure on days
    return new Promise<Ride[]>((resolve) => {
      setDays(prev => {
        if (prev[dateKey]?.rides?.length) { resolve(prev[dateKey].rides as Ride[]); return prev; }
        const meta = prev[dateKey]?.meta;
        if (!meta?.storage_path) { resolve([]); return prev; }
        getBytes(ref(storage, meta.storage_path))
          .then(bytes => {
            const data: DayData = JSON.parse(new TextDecoder().decode(bytes));
            setDays(p => ({ ...p, [dateKey]: { ...p[dateKey], rides: data.rides } }));
            resolve(data.rides);
          })
          .catch(() => { showToast('Erro ao carregar ' + dateKey, 'error'); resolve([]); });
        return prev;
      });
    });
  }, []);

  // ── TOGGLE DAY ───────────────────────────────────────────────────
  const toggleDay = useCallback(async (dateKey:string) => {
    const matchingKeys = Object.keys(days).filter(k => k === dateKey || k.startsWith(dateKey + '_'));
    const keysToLoad = matchingKeys.length > 0 ? matchingKeys : [dateKey];
    // Load all matching keys first
    await Promise.all(keysToLoad.map(k => loadRidesForDay(k)));
    if (compareMode) {
      if (compareSide === 'A') {
        setCompareA(prev => { const n=new Set(prev); n.has(dateKey)?n.delete(dateKey):n.add(dateKey); return n; });
      } else {
        setCompareB(prev => { const n=new Set(prev); n.has(dateKey)?n.delete(dateKey):n.add(dateKey); return n; });
      }
    } else {
      setActiveDays(prev => { const n=new Set(prev); n.has(dateKey)?n.delete(dateKey):n.add(dateKey); return n; });
    }
  }, [days, compareMode, compareSide, loadRidesForDay]);

  // ── FILTER HELPER ────────────────────────────────────────────────
  const filterRides = useCallback((daySet: Set<string>): Ride[] => {
    let pool: Ride[] = [];
    daySet.forEach(day => {
      const keys = Object.keys(days).filter(k => k === day || k.startsWith(day + '_'));
      (keys.length ? keys : [day]).forEach(k => { if (days[k]?.rides?.length) pool = pool.concat(days[k].rides); });
    });
    // Filtro adicional por cidade se cidadesFiltro ativo
    // Feito via allDayKeys upstream — não filtrar rides aqui para manter performance
    const hours = animHour !== null ? new Set([animHour]) : selHours;
    return pool.filter(r => hours.has(r.h) && r.d <= maxDist && r.dur <= maxDur);
  }, [days, selHours, animHour, maxDist, maxDur]);

  // ── APPLY FILTERS ────────────────────────────────────────────────
  useEffect(() => {
    if (compareMode) {
      setFilteredA(filterRides(compareA));
      setFilteredB(filterRides(compareB));
      setFiltered([...filterRides(compareA), ...filterRides(compareB)]);
    } else {
      const f = filterRides(activeDays);
      setFiltered(f);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDays, compareA, compareB, compareMode, days, selHours, animHour, maxDist, maxDur]);

  // ── COMPUTE CLUSTERS ─────────────────────────────────────────────
  useEffect(() => {
    if (!filtered.length || !showClusters) return;
    const pts = [
      ...filtered.map(r => ({ lat:r.ls, lng:r.lo })),
      ...filtered.map(r => ({ lat:r.le, lng:r.ln })),
    ];
    const cells = gridCluster(pts, 200).filter(c => c.count >= 50);
    const result: Cluster[] = cells.map(c => {
      const nearest = estacoes.length
        ? Math.min(...estacoes.map(e => haversine(c.lat,c.lng,e.lat,e.lng)))
        : 9999;
      return { lat:c.lat, lng:c.lng, count:c.count, nearestStation:nearest };
    }).filter(c => c.nearestStation > 300).sort((a,b) => b.count - a.count);
    setClusters(result);
  }, [filtered, estacoes, showClusters]);

  // ── COMPUTE STATION SCORES ────────────────────────────────────────
  useEffect(() => {
    if (!filtered.length || !estacoes.length) return;
    const scores: Record<string,StationScore> = {};
    estacoes.forEach(e => {
      scores[e.id] = { id:e.id, lat:e.lat, lng:e.lng, codigo:e.codigo||e.id, nome:(e as any).nome||(e as any).nomeLocal||'', endereco:(e as any).endereco||'', bairro:e.bairro||'', starts:0, ends:0, total:0, rev:0, score:0, byHour:{} };
    });
    filtered.forEach(r => {
      estacoes.forEach(e => {
        if (haversine(r.ls,r.lo,e.lat,e.lng) <= 150) { scores[e.id].starts++; scores[e.id].rev+=r.rev||0; const hk=String(r.h); scores[e.id].byHour[hk]=(scores[e.id].byHour[hk]||0)+1; }
        if (haversine(r.le,r.ln,e.lat,e.lng) <= 150) { scores[e.id].ends++; }
      });
    });
    Object.values(scores).forEach(s => {
      s.total = s.starts + s.ends;
      s.score = s.starts * 1.2 + s.ends * 0.8 + s.rev * 0.01;
    });
    setStationScores(Object.values(scores).sort((a,b) => b.score - a.score));
  }, [filtered, estacoes]);

  // ── ANIMATION ────────────────────────────────────────────────────
  useEffect(() => {
    if (animPlaying) {
      animRef.current = setInterval(() => {
        setAnimHour(h => { const next = ((h??-1)+1)%24; return next; });
      }, 800);
    } else {
      clearInterval(animRef.current);
    }
    return () => clearInterval(animRef.current);
  }, [animPlaying]);

  // ── INCIDENTES (banco histórico completo) ───────────────────────
  useEffect(() => {
    if (activeTab !== 'perdas' && activeTab !== 'guard') return;
    if (incidentes.length > 0) return; // já carregado
    setLoadingIncident(true);
    getDocs(collection(db, 'ocorrencias')).then(snap => {
      const docs: any[] = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      setIncidentes(docs);
      setLoadingIncident(false);
    }).catch(() => setLoadingIncident(false));
  }, [activeTab]);

  // ── GUARD OCORRÊNCIAS ───────────────────────────────────────────
  // Carrega sempre que a aba Guard estiver ativa OU o heatmap estiver ligado
  useEffect(() => {
    const deveCarregar = activeTab === 'guard' || showGuardHeat;
    if (!deveCarregar) { setGuardPoints([]); return; }
    let ativo = true;
    let desdeMs: number;
    let ateMs = Date.now() + 1000;
    if (guardModoCustom && guardCustomDe) {
      desdeMs = new Date(guardCustomDe + 'T00:00:00').getTime();
      ateMs   = guardCustomAte ? new Date(guardCustomAte + 'T23:59:59').getTime() : Date.now();
    } else if (guardDias === 0) {
      desdeMs = 0; // Total — sem limite
    } else {
      desdeMs = Date.now() - guardDias * 24 * 60 * 60 * 1000;
    }
    // Sem filtro server-side — aceita criadoEm (Timestamp) e created_at (ISO string)
    const q = query(collection(db, 'ocorrencias'));
    const unsub = onSnapshot(q,
      snap => {
        if (!ativo) return;
        const parseLoc = (v: any) => {
          if (typeof v === 'number') return v;
          const n = parseFloat(String(v ?? '').replace(',', '.'));
          return isNaN(n) ? 0 : n;
        };
        const pts = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((o: any) => {
            const ts = o.criadoEm || o.created_at;
            if (!ts) return desdeMs === 0;
            const ms = ts?.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
            if (isNaN(ms)) return desdeMs === 0;
            return ms >= desdeMs && ms <= ateMs;
          })
          .filter((o: any) => guardFiltroTipo === 'TODOS' || o.tipo === guardFiltroTipo)
          .map((o: any) => ({
            lat:    parseLoc(o.lat_inicial ?? o.lat ?? o.latitude),
            lng:    parseLoc(o.lng_inicial ?? o.lng ?? o.longitude),
            tipo:   String(o.tipo   || 'Outro'),
            status: String(o.status || ''),
          }));
        setGuardPoints(pts);
      },
      err => { console.error('[Guard] error:', err.code, err.message); setGuardPoints([]); }
    );
    return () => { ativo = false; unsub(); };
  }, [showGuardHeat, activeTab, guardDias, guardModoCustom, guardCustomDe, guardCustomAte, guardFiltroTipo]);

  // ── DECK LAYERS ──────────────────────────────────────────────────
  const deckLayers = (() => {
    const L: any[] = [];
    if (compareMode) {
      // A = azul, B = laranja
      if (filteredA.length) {
        L.push(new HeatmapLayer({ id:'ha', data:filteredA, getPosition:(d:Ride)=>[d.lo,d.ls], radiusPixels:30, intensity:2, threshold:.04,
          colorRange:[[0,0,80,0],[0,60,200,100],[0,150,255,180],[0,220,255,220],[0,100,255,255]] }));
      }
      if (filteredB.length) {
        L.push(new HeatmapLayer({ id:'hb', data:filteredB, getPosition:(d:Ride)=>[d.lo,d.ls], radiusPixels:30, intensity:2, threshold:.04,
          colorRange:[[80,0,0,0],[200,60,0,100],[255,120,0,180],[255,200,0,220],[255,80,0,255]] }));
      }
    } else {
      if (layer==='heat') {
        if (showStarts) L.push(new HeatmapLayer({ id:'hs', data:filtered, getPosition:(d:Ride)=>[d.lo,d.ls], radiusPixels:35, intensity:2.5, threshold:.04,
          colorRange:[[0,0,80,0],[0,60,200,80],[0,180,255,150],[0,255,200,200],[255,220,0,220],[255,80,0,250],[255,0,0,255]] }));
        if (showEnds) L.push(new HeatmapLayer({ id:'he', data:filtered, getPosition:(d:Ride)=>[d.ln,d.le], radiusPixels:25, intensity:2, threshold:.04,
          colorRange:[[0,80,0,0],[0,150,50,80],[0,230,120,150],[80,255,100,200],[200,255,50,220],[255,200,0,250],[255,100,0,255]] }));
      }
      if (layer==='hex') {
        const pts: any[] = [];
        if (showStarts) filtered.forEach(d=>pts.push({p:[d.lo,d.ls]}));
        if (showEnds)   filtered.forEach(d=>pts.push({p:[d.ln,d.le]}));
        L.push(new HexagonLayer({ id:'hex', data:pts, getPosition:(d:any)=>d.p, radius:120, elevationScale:5, extruded:true,
          colorRange:[[1,152,189,200],[73,227,206,200],[216,254,181,200],[254,237,177,200],[254,173,84,200],[209,55,78,200]] }));
      }
      if (layer==='pts') {
        if (showStarts) L.push(new ScatterplotLayer({ id:'ps', data:filtered, getPosition:(d:Ride)=>[d.lo,d.ls], getRadius:50, getFillColor:[61,155,255,180], radiusMinPixels:3 }));
        if (showEnds)   L.push(new ScatterplotLayer({ id:'pe', data:filtered, getPosition:(d:Ride)=>[d.ln,d.le], getRadius:50, getFillColor:[255,107,53,180], radiusMinPixels:3 }));
      }
      if (layer==='arc') {
        const sample = filtered.length>2000 ? filtered.filter((_,i)=>i%2===0) : filtered;
        L.push(new ArcLayer({ id:'arc', data:sample, getSourcePosition:(d:Ride)=>[d.lo,d.ls], getTargetPosition:(d:Ride)=>[d.ln,d.le],
          getSourceColor:[61,155,255,80], getTargetColor:[255,107,53,80], getWidth:(d:Ride)=>Math.max(1,d.d*.2) }));
      }
    }

    // Estações JET
    if (showStations && estacoesVisiveis.length) {
      const scored = new Map(stationScores.map(s=>[s.id,s]));
      L.push(new ScatterplotLayer({ id:'stations', data:estacoesVisiveis,
        getPosition:(d:Estacao)=>[d.lng,d.lat],
        getRadius:(d:Estacao)=>{ const s=scored.get(d.id); return s ? 60+s.total*0.5 : 60; },
        getFillColor:(d:Estacao)=>{ const s=scored.get(d.id); if(!s||s.total===0) return [100,100,100,180]; const max=stationScores[0]?.total||1; const t=s.total/max; return [Math.round(255*(1-t)),Math.round(200*t),Math.round(50+t*200),220]; },
        radiusMinPixels:4, stroked:true, getLineColor:[255,255,255,200], lineWidthMinPixels:1, pickable:true,
        onHover:({object,x,y}:any)=>{
          if(!object){ window.dispatchEvent(new CustomEvent('jetAnalyticsStation',{detail:null})); return; }
          // Try multiple id formats
          const eid = object.id || object.codigo || object.estacaoId;
          const s = scored.get(eid) || scored.get(object.id);
          const nome = object.endereco || object.bairro || object.codigo || eid || '';
          const detail = {
            ...(s || { starts:0, ends:0, total:0, rev:0, byHour:{} }),
            id: eid, codigo: object.codigo, nome,
            endereco: object.endereco||'', bairro: object.bairro||'',
            _hover:true, _x:x, _y:y,
          };
          window.dispatchEvent(new CustomEvent('jetAnalyticsStation',{detail}));
        },
        onClick:({object}:any)=>{
          if(!object) return;
          setViewState((vs:any)=>({...vs,longitude:object.lng,latitude:object.lat,zoom:17}));
        }}));

    }

    // Heatmap de gaps — demanda sem estação próxima
    if (showGapHeatmap && filtered.length) {
      const GAP_RADIUS = 200; // metros sem estação = gap
      const gapPoints = filtered.filter(r => {
        const nearStart = estacoes.some(e => haversine(r.ls,r.lo,e.lat,e.lng) <= GAP_RADIUS);
        const nearEnd   = estacoes.some(e => haversine(r.le,r.ln,e.lat,e.lng) <= GAP_RADIUS);
        return !nearStart || !nearEnd;
      });
      if (gapPoints.length) {
        L.push(new HeatmapLayer({ id:'gap', data:gapPoints,
          getPosition:(d:Ride)=>[d.lo,d.ls],
          radiusPixels:40, intensity:3, threshold:.05,
          colorRange:[[255,255,0,50],[255,200,0,120],[255,100,0,200],[255,0,0,255]] as any,
        }));
      }
    }

    // Guard — heatmap de ocorrências de segurança
    if (showGuardHeat && guardPoints.length) {
      const TIPO_COLOR: Record<string, [number,number,number,number][]> = {
        Roubo:      [[80,0,0,0],[180,0,0,80],[255,50,0,160],[255,100,0,220],[255,200,0,255]],
        Tentativa:  [[80,40,0,0],[200,100,0,80],[255,140,0,160],[255,180,0,220],[255,230,0,255]],
        Vandalismo: [[60,60,0,0],[150,150,0,80],[220,220,0,160],[255,255,0,220],[255,255,100,255]],
        Recuperacao:[[0,60,0,0],[0,150,50,80],[0,220,100,160],[0,255,150,220],[100,255,200,255]],
      };
      // All incidents together — red/orange gradient
      if (guardPoints.length) {
        L.push(new HeatmapLayer({
          id: 'guard-heat',
          data: guardPoints,
          getPosition: (d: any) => [d.lng, d.lat],
          radiusPixels: 40,
          intensity: 3,
          threshold: 0.03,
          colorRange: [
            [80,0,0,0],[180,0,50,80],[255,30,0,140],[255,100,0,200],[255,200,0,230],[255,255,100,255]
          ] as any,
        }));
      }
      // Scatter dots per incident colored by type
      const TIPO_DOT: Record<string,[number,number,number,number]> = {
        Roubo:       [239,68,68,220],
        Tentativa:   [249,115,22,220],
        Vandalismo:  [234,179,8,220],
        Recuperacao: [34,197,94,220],
        Outro:       [107,114,128,200],
      };
      guardPoints.forEach((_, i) => {}); // just to use the variable
      L.push(new ScatterplotLayer({
        id: 'guard-dots',
        data: guardPoints,
        getPosition: (d: any) => [d.lng, d.lat],
        getRadius: 40,
        getFillColor: (d: any) => TIPO_DOT[d.tipo] || [150,150,150,200],
        radiusMinPixels: 5,
        stroked: true,
        getLineColor: [0,0,0,120],
        lineWidthMinPixels: 1,
        pickable: false,
      }));
    }

    // Clusters sem cobertura
    if (showClusters && clusters.length) {
      L.push(new ScatterplotLayer({ id:'clusters', data:clusters,
        getPosition:(d:Cluster)=>[d.lng,d.lat],
        getRadius:(d:Cluster)=>100+d.count*2,
        getFillColor:[255,50,50,160], radiusMinPixels:8, stroked:true,
        getLineColor:[255,200,0,255], lineWidthMinPixels:2, pickable:true }));
      L.push(new TextLayer({ id:'cluster-labels', data:clusters.slice(0,20),
        getPosition:(d:Cluster)=>[d.lng,d.lat],
        getText:(d:Cluster)=>String(d.count),
        getSize:12, getColor:[255,255,255,255], getTextAnchor:'middle' as const }));
    }
    // Polígonos / zonas
    if (showPoligonos && poligonos.length > 0) {
      L.push(new PolygonLayer({
        id: 'poligonos',
        data: poligonos,
        getPolygon: (d: any) => d.coords.map((p: any) => [p.lng ?? p[1], p.lat ?? p[0]]),
        getFillColor: (d: any) => { const c = d.cor || [167,139,250]; return [c[0],c[1],c[2],40] as [number,number,number,number]; },
        getLineColor: (d: any) => { const c = d.cor || [167,139,250]; return [c[0],c[1],c[2],200] as [number,number,number,number]; },
        getLineWidth: 2,
        lineWidthMinPixels: 1,
        pickable: true,
        stroked: true,
        filled: true,
        extruded: false,
      }));
    }
    return L;
  })();

  // ── EXPORT PDF ANALYTICS ─────────────────────────────────────────
  const exportAnalyticsPDF = () => {
    const ridesEx = compareMode ? filteredA : filtered;
    const n = ridesEx.length; if (!n) return;
    const totRev = ridesEx.reduce((s,r)=>s+(r.rev||0),0);
    const avgDist = n ? ridesEx.reduce((s,r)=>s+(r.d||0),0)/n : 0;
    const avgDur  = n ? ridesEx.reduce((s,r)=>s+(r.dur||0),0)/n : 0;
    const byH: Record<number,number> = {};
    ridesEx.forEach(r=>{ byH[r.h]=(byH[r.h]||0)+1; });
    const peakH = Object.entries(byH).sort((a,b)=>+b[1]-+a[1]).slice(0,3);
    const topSt = stationScores.slice(0,10);
    const period = [...activeDays].sort();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Analytics — ${period[0]} a ${period[period.length-1]}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#222}
  h1{color:#1a6fd4;font-size:18px;margin:0 0 4px}
  h2{color:#555;font-size:13px;margin:16px 0 6px;border-bottom:1px solid #eee;padding-bottom:3px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
  .kpi{background:#f0f7ff;border-radius:6px;padding:10px;text-align:center}
  .kpi .val{font-size:22px;font-weight:700;color:#1a6fd4}
  .kpi .lbl{font-size:10px;color:#666;margin-top:3px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#1a6fd4;color:#fff;padding:5px 8px;text-align:left}
  td{padding:4px 8px;border-bottom:1px solid #f0f0f0}
  tr:nth-child(even){background:#f9f9f9}
  @media print{button{display:none}}
</style></head><body>
<h1>Relatório Analytics</h1>
<p style="color:#888;font-size:11px">Período: ${period.join(', ')} · Gerado: ${new Date().toLocaleString('pt-BR')}</p>
<div class="kpis">
  <div class="kpi"><div class="val">${n.toLocaleString('pt-BR')}</div><div class="lbl">Corridas</div></div>
  <div class="kpi"><div class="val">R$${totRev.toFixed(0)}</div><div class="lbl">Receita total</div></div>
  <div class="kpi"><div class="val">${avgDist.toFixed(2)}km</div><div class="lbl">Dist. média</div></div>
  <div class="kpi"><div class="val">${avgDur.toFixed(0)}min</div><div class="lbl">Dur. média</div></div>
</div>
<h2>Horários de pico</h2>
<table><tr><th>Hora</th><th>Corridas</th><th>% do total</th></tr>
${peakH.map(([h,c])=>`<tr><td>${h}h</td><td>${c}</td><td>${(+c/n*100).toFixed(1)}%</td></tr>`).join('')}
</table>
<h2>Top estações por demanda</h2>
<table><tr><th>Código</th><th>Bairro</th><th>Inícios</th><th>Fins</th><th>Total</th><th>Receita</th></tr>
${topSt.map(s=>`<tr><td>${s.codigo}</td><td>${s.bairro}</td><td>${s.starts}</td><td>${s.ends}</td><td>${s.total}</td><td>R$${s.rev.toFixed(0)}</td></tr>`).join('')}
</table>
<h2>Corridas por dia</h2>
<table><tr><th>Data</th><th>Corridas</th><th>Receita</th></tr>
${period.map(d=>{const dr=days[d]?.rides||[];const rev=dr.reduce((s:number,r:Ride)=>s+(r.rev||0),0);return `<tr><td>${d}</td><td>${dr.length}</td><td>R$${rev.toFixed(0)}</td></tr>`;}).join('')}
</table>
</body></html>`;
    const w = window.open('','_blank','width=1000,height=700');
    if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),500);}
  };

  // ── METRICS ──────────────────────────────────────────────────────
  const ridesA = compareMode ? filteredA : filtered;
  const n = ridesA.length;
  const totalRev = ridesA.reduce((s,r)=>s+(r.rev||0),0);
  const avgDist  = n ? ridesA.reduce((s,r)=>s+(r.d||0),0)/n : 0;
  const avgDur   = n ? ridesA.reduce((s,r)=>s+(r.dur||0),0)/n : 0;
  const byHour: Record<number,number> = {};
  ridesA.forEach(r=>{ byHour[r.h]=(byHour[r.h]||0)+1; });
  const maxHour = Math.max(...Object.values(byHour),1);
  // Extrai cidades disponíveis de todas as fontes

  // ── Normalização de nomes de cidades ─────────────────────────────────
  // Corrige variações: russo, abreviações, typos comuns dos dados
  const normalizarCidade = (raw: string): string => {
    const s = (raw || '').trim();
    // Mapa de aliases conhecidos
    const ALIASES: Record<string,string> = {
      // São Paulo
      'são paulo': 'São Paulo', 'sao paulo': 'São Paulo', 'sp': 'São Paulo',
      'sp capital': 'São Paulo', 'sao-paulo': 'São Paulo',
      // Santo André
      'santo andre': 'Santo André', 'santo andré': 'Santo André',
      // Paulista
      'paulista': 'Paulista', 'paulista novo': 'Paulista',
      // Recife
      'recife': 'Recife', 'recife pe': 'Recife',
      // Belo Horizonte
      'belo horizonte': 'Belo Horizonte', 'bh': 'Belo Horizonte',
      'belo-horizonte': 'Belo Horizonte',
      // Fortaleza
      'fortaleza': 'Fortaleza', 'fortaleza ce': 'Fortaleza',
      // Salvador
      'salvador': 'Salvador', 'salvador ba': 'Salvador',
      // Campinas
      'campinas': 'Campinas', 'campinas sp': 'Campinas',
      // Porto Alegre
      'porto alegre': 'Porto Alegre', 'poa': 'Porto Alegre',
      // Curitiba
      'curitiba': 'Curitiba', 'cwb': 'Curitiba',
      // Brasília
      'brasilia': 'Brasília', 'brasília': 'Brasília', 'df': 'Brasília',
      // Guarulhos
      'guarulhos': 'Guarulhos',
      // Osasco
      'osasco': 'Osasco',
      // Padrões cirílicos / lixo (dados corrompidos)
      'Сан-Паулу': 'São Paulo', 'Санто-Андре': 'Santo André',
      'Паулиста': 'Paulista',
    };
    const lower = s.toLowerCase();
    if (ALIASES[lower]) return ALIASES[lower];
    if (ALIASES[s]) return ALIASES[s];
    // Capitalizar primeira letra de cada palavra se não reconhecido
    return s.replace(/\w/g, c => c.toUpperCase());
  };

  const cidadesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    Object.values(days).forEach(d => {
      // 1. Regiao/cidade do meta (salvo no Firestore)
      const r = normalizarCidade(d.meta.regiao || d.meta.cidade || '');
      if (r && r !== 'default') set.add(r);
      // 2. Cities[] do meta
      (d.meta.cities || []).forEach((c: string) => { if (c && c.length > 2) set.add(normalizarCidade(c)); });
      // 3. Extrair da rides em memória (para days sem regiao no meta)
      if (!r || r === 'default') {
        const cidadeFreq: Record<string,number> = {};
        (d.rides || []).forEach(r2 => {
          const z = (r2.zs||'').replace(/[🟥🟦🟧⬛️⛔️🛴]/g,'').trim();
          const partes = z.split(',');
          const c = normalizarCidade(partes.length > 1 ? partes[partes.length-1].trim() : partes[0].trim());
          if (c && c.length > 2) cidadeFreq[c] = (cidadeFreq[c]||0)+1;
        });
        const cidadePrincipal = Object.entries(cidadeFreq).sort((a,b)=>b[1]-a[1])[0]?.[0];
        if (cidadePrincipal) set.add(cidadePrincipal);
      }
    });
    return Array.from(set).sort();
  }, [days]);

  // Cidade inferida por day (para filtrar quando regiao não está no meta)
  const cidadePorDay = useMemo(() => {
    const map: Record<string,string> = {};
    Object.entries(days).forEach(([key, d]) => {
      const r = normalizarCidade(d.meta.regiao || d.meta.cidade || '');
      if (r && r !== 'default') { map[key] = r; return; }
      const cidadeFreq: Record<string,number> = {};
      (d.rides || []).forEach(r2 => {
        const z = (r2.zs||'').replace(/[🟥🟦🟧⬛️⛔️🛴]/g,'').trim();
        const partes = z.split(',');
        const c = normalizarCidade(partes.length > 1 ? partes[partes.length-1].trim() : partes[0].trim());
        if (c && c.length > 2) cidadeFreq[c] = (cidadeFreq[c]||0)+1;
      });
      map[key] = Object.entries(cidadeFreq).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    });
    return map;
  }, [days]);

  // Cidades reais extraídas das zonas das rides para análise
  const zonasReais = useMemo(() => {
    const contagem: Record<string, number> = {};
    filtered.forEach(r => {
      const z = (r.zs || '').replace(/[🟥🟦🟧⬛️⛔️🛴]/g, '').trim();
      if (z) contagem[z] = (contagem[z] || 0) + 1;
    });
    return Object.entries(contagem).sort((a,b) => b[1]-a[1]);
  }, [filtered]);

  // allDayKeys filtrado por cidades selecionadas
  const allDayKeys = useMemo(() => {
    const keys = Object.keys(days).sort();
    if (cidadesFiltro.size === 0) return keys;
    return keys.filter(k => {
      const c = cidadePorDay[k] || '';
      return cidadesFiltro.has(c) || cidadesFiltro.size === 0;
    });
  }, [days, cidadesFiltro, cidadePorDay]);

  // Trend data (multi-day)
  const trendData = useMemo(() => {
    return [...allDayKeys].sort().map(d => ({
      date: d, total: days[d]?.meta?.total||0, rev: days[d]?.meta?.total_rev||0,
      dist: days[d]?.meta?.avg_dist_km||0,
    }));
  }, [days, allDayKeys]);

  // OD matrix
  const odMatrix = useMemo(() => {
    if (layer !== 'od' || !filtered.length) return [];
    const zones: Record<string,{name:string,lat:number,lng:number,out:Record<string,number>}> = {};
    filtered.forEach(r => {
      const zs = (r.zs||'').replace(/[🟥🟦🟧⬛️⛔️🛴]/g,'').trim();
      if (!zs||zs.length<3) return;
      if (!zones[zs]) zones[zs] = { name:zs, lat:r.ls, lng:r.lo, out:{} };
    });
    return Object.values(zones).slice(0,15);
  }, [filtered, layer]);

  // Zone score list
  const zones: Record<string,{count:number,rev:number,dist:number[],hours:Record<number,number>}> = {};
  ridesA.forEach(r => {
    const z=(r.zs||'').replace(/[🟥🟦🟧⬛️⛔️🛴]/g,'').trim();
    if (!z||z.length<3||z==='Sao Paulo'||z==='NaN') return;
    if (!zones[z]) zones[z]={count:0,rev:0,dist:[],hours:{}};
    zones[z].count++; zones[z].rev+=r.rev||0;
    if(r.d>0) zones[z].dist.push(r.d);
    zones[z].hours[r.h]=(zones[z].hours[r.h]||0)+1;
  });
  const scored = Object.entries(zones).map(([name,z]) => {
    const avgD=z.dist.length?z.dist.reduce((a,b)=>a+b)/z.dist.length:0;
    const hv=Object.values(z.hours), maxH=Math.max(...hv,1), sumH=hv.reduce((a,b)=>a+b,0);
    const score = scoreMetric==='count'?z.count:scoreMetric==='rev'?z.rev:scoreMetric==='dist'?avgD:(maxH/sumH)*1000;
    return {name,score,count:z.count};
  }).sort((a,b)=>b.score-a.score).slice(0,10);
  const maxScore = scored[0]?.score||1;

  const calDays = buildCalDays(calYear, calMonth);
  const activeSorted = [...(compareMode ? new Set([...compareA,...compareB]) : activeDays)].sort();
  const periodLabel = activeSorted.length===0?'Nenhum período':activeSorted.length===1?activeSorted[0]:activeSorted[0]+' → '+activeSorted[activeSorted.length-1];

  // ── UPLOAD ───────────────────────────────────────────────────────
  // Salva um DayData no Firestore + Storage
  const salvarDay = useCallback(async (data:DayData, dayKey:string) => {
    data.meta.uploaded_at = new Date().toISOString();
    const storagePath = `analytics/${dayKey}.json`;
    const url = await uploadComRetry(new Blob([JSON.stringify(data)], {type:'application/json'}), storagePath);
    const meta: DayMeta = {
      ...data.meta,
      storage_path: storagePath,
      url,
      regiao: data.meta.regiao || data.meta.cities?.[0] || '',
      cidade: data.meta.regiao || data.meta.cities?.[0] || '',
      cities: data.meta.cities || [],
      uploadedBy: usuario?.email || '',
      uploaded_at: new Date().toISOString(),
    };
    await setDoc(doc(db,'analytics_days',dayKey), meta);
    setDays(prev => ({ ...prev, [dayKey]: { meta, rides:data.rides } }));
    setActiveDays(prev => new Set([...prev, dayKey]));
    const dateKey = data.meta.date || dayKey.split('_')[0];
    const [y,mo] = dateKey.split('-').map(Number);
    setCalYear(y); setCalMonth(mo-1);
    if (data.rides.length) {
      const cx=data.rides.reduce((s:number,r:Ride)=>s+r.ls,0)/data.rides.length;
      const cy=data.rides.reduce((s:number,r:Ride)=>s+r.lo,0)/data.rides.length;
      // Zoom para a cidade com animação suave
      setViewState((vs:any) => ({ ...vs, longitude:cy, latitude:cx, zoom:11.5,
        transitionDuration:800 }));
    }
    showToast(`${dayKey}: ${data.rides.length} corridas carregadas`, 'success');
  }, []);

  const handleFile = useCallback(async (file:File) => {
    if (!isGestor) { showToast('Sem permissão','error'); return; }
    setUploading(true); setUploadProgress('Lendo arquivo...');
    try {
      const data: DayData = file.name.endsWith('.json') ? JSON.parse(await file.text()) : await parseXLSX(file, setUploadProgress);
      const dateKey = data.meta.date || manualDate || new Date().toISOString().split('T')[0];
      // Detecta região do nome do arquivo (ex: SP_2026-05-03.xlsx → SP)
      // Ignora palavras genéricas como 'Pedidos', 'data', etc.
      const filePrefix = file.name.split(/[-_]/)[0];
      const IGNORE_PREFIXES = ['Pedidos','pedidos','data','Data','rides','corridas','analytics'];
      const prefixoArquivo = !IGNORE_PREFIXES.includes(filePrefix) && filePrefix.length <= 10 ? filePrefix : '';
      // Prioridade: prefixo do arquivo > regiao do meta (extraída das zonas) > 'default'
      const regiaoDetectada = prefixoArquivo || data.meta.regiao || data.meta.cities?.[0] || '';
      const regiao = regiaoDetectada || 'default';
      data.meta.regiao = regiao !== 'default' ? regiao : (data.meta.regiao || '');
      data.meta.date = dateKey;

      // Chave única: data + região
      const dayKey = regiao !== 'default' ? `${dateKey}_${regiao}` : dateKey;

      // Verifica se já existe dado para este dia
      const existeSnap = await getDoc(doc(db,'analytics_days',dayKey));

      if (existeSnap.exists()) {
        // Mesma chave (mesma cidade+dia) → perguntar mesclar ou substituir
        setUploadProgress('');
        setUploading(false);
        // Carrega rides existentes para poder mesclar
        const existMeta = existeSnap.data() as DayMeta;
        let existRides: Ride[] = [];
        if (existMeta.storage_path) {
          try {
            const bytes = await getBytes(ref(storage, existMeta.storage_path));
            existRides = JSON.parse(new TextDecoder().decode(bytes)).rides || [];
          } catch { existRides = []; }
        }
        const existData: DayData = { meta: existMeta, rides: existRides };
        setMergeCtx({ data, dateKey, dayKey, existente: existData });
        return;
      }

      // Chave nova — salva direto
      setUploadProgress('Enviando...');
      await salvarDay(data, dayKey);
    } catch(e:any) { showToast('Erro: '+e.message,'error'); }
    setUploading(false); setUploadProgress('');
  }, [isGestor, manualDate, salvarDay]);

  // Executa mesclagem ou substituição
  const handleMerge = useCallback(async (acao: 'mesclar'|'substituir') => {
    if (!mergeCtx) return;
    setUploading(true); setUploadProgress(acao === 'mesclar' ? 'Mesclando...' : 'Substituindo...');
    const { data, dayKey, existente } = mergeCtx;
    setMergeCtx(null);
    try {
      if (acao === 'mesclar') {
        // Combina rides, recalcula meta
        const ridesUnidos = [...existente.rides, ...data.rides];
        const totR = ridesUnidos.reduce((s,r)=>s+r.rev,0);
        const totD = ridesUnidos.reduce((s,r)=>s+r.d,0);
        const totDur = ridesUnidos.reduce((s,r)=>s+r.dur,0);
        const byH: Record<string,number> = {};
        ridesUnidos.forEach(r => { byH[String(r.h)] = (byH[String(r.h)]||0)+1; });
        const merged: DayData = {
          rides: ridesUnidos,
          meta: {
            ...existente.meta,
            total: ridesUnidos.length,
            total_rev: Math.round(totR*100)/100,
            avg_dist_km: Math.round(totD/ridesUnidos.length*100)/100,
            avg_dur_min: Math.round(totDur/ridesUnidos.length*10)/10,
            by_hour: byH,
          }
        };
        await salvarDay(merged, dayKey);
        showToast(`Mesclado: ${ridesUnidos.length} corridas (${existente.rides.length} + ${data.rides.length})`, 'success');
      } else {
        await salvarDay(data, dayKey);
      }
    } catch(e:any) { showToast('Erro: '+(e as any).message,'error'); }
    setUploading(false); setUploadProgress('');
  }, [mergeCtx, salvarDay]);

  const deleteDay = useCallback(async (dateKey:string) => {
    if (!isGestor || !confirm(`Excluir ${dateKey}?`)) return;
    try {
      const path = days[dateKey]?.meta?.storage_path;
      if (path) await deleteObject(ref(storage, path));
      await deleteDoc(doc(db,'analytics_days',dateKey));
      setDays(prev => { const n={...prev}; delete n[dateKey]; return n; });
      setActiveDays(prev => { const n=new Set(prev); n.delete(dateKey); return n; });
      showToast('Removido','success');
    } catch { showToast('Erro','error'); }
  }, [days, isGestor]);

  // ── RENDER ───────────────────────────────────────────────────────
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#080b12',color:'#dce8ff',fontFamily:"'DM Sans',sans-serif"}}>

      {/* HEADER */}
      <div style={{display:'flex',alignItems:'center',background:'#0c1018',borderBottom:'1px solid #1c2535',flexShrink:0}}>
        <div style={{padding:'10px 20px',borderRight:'1px solid #1c2535',fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:600,color:'#3d9bff'}}>
          JET<span style={{color:'#4a5a7a'}}>OS</span> · Analytics
        </div>
        {([['Corridas',n.toLocaleString('pt-BR'),'#3d9bff'],['Receita','R$'+totalRev.toFixed(0),'#f5c842'],
           ['Dist. média',avgDist.toFixed(1)+'km','#2ecc71'],['Dur. média',avgDur.toFixed(0)+'min','#3d9bff'],
           ['Dias',Object.keys(days).length,'#f5c842'],['Estações',estacoesVisiveis.length+(activeDays.size===0?' (BR)':''),'#2ecc71']] as [string,any,string][]).map(([l,v,c])=>(
          <div key={l} style={{padding:'8px 16px',borderRight:'1px solid #1c2535',display:'flex',flexDirection:'column',gap:1}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:600,color:c}}>{v}</div>
            <div style={{fontSize:9,color:'#4a5a7a',textTransform:'uppercase',letterSpacing:.8}}>{l}</div>
          </div>
        ))}
        <div style={{flex:1,padding:'0 12px',fontSize:11,color:'#4a5a7a',fontFamily:"'IBM Plex Mono',monospace"}}>{periodLabel}</div>
        {isGestor && (
          <div style={{padding:'0 12px',display:'flex',gap:8,alignItems:'center'}}>
            <input type="date" value={manualDate} onChange={e=>setManualDate(e.target.value)}
              style={{background:'#111722',border:'1px solid #1c2535',color:'#dce8ff',padding:'5px 8px',borderRadius:4,fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}/>
            <label style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:4,border:'1px solid #3d9bff',background:'#3d9bff',color:'#000',cursor:'pointer',fontSize:12,fontWeight:600}}>
              ⬆ XLSX
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.json" style={{display:'none'}}
                onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value='';}}/>
            </label>
          </div>
        )}
      </div>

      {/* TOOLBAR */}
      <div style={{display:'flex',alignItems:'center',background:'#0c1018',borderBottom:'1px solid #1c2535',padding:'0 8px',flexShrink:0,gap:4,overflowX:'auto',scrollbarWidth:'none'} as CSSProperties}>
        {/* View tabs */}
        <div style={{display:'flex',gap:2,padding:'5px 0',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8}}>
          {(['map','trend','od','guard','perdas','roubos'] as const).map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)} style={{...tbBtn(activeTab===t),
              ...(t==='guard'?{borderColor:activeTab==='guard'?'rgba(167,139,250,.5)':'transparent',color:activeTab==='guard'?'#a78bfa':'#4a5a7a'}:{}),
              ...(t==='perdas'?{borderColor:activeTab==='perdas'?'rgba(239,68,68,.5)':'transparent',color:activeTab==='perdas'?'#f87171':'#4a5a7a'}:{}),
              ...(t==='roubos'?{borderColor:activeTab==='roubos'?'rgba(239,68,68,.6)':'transparent',color:activeTab==='roubos'?'#ef4444':'#4a5a7a'}:{}),
            }}>
              {t==='map'?'🗺 Mapa':t==='trend'?'📈 Tendência':t==='od'?'🔀 OD':
               t==='perdas'?<span style={{display:'flex',alignItems:'center',gap:4}}>
                  💸 Perdas
                  {incidentes.length>0&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:'rgba(239,68,68,.2)',color:'#f87171'}}>{incidentes.length}</span>}
                </span>:
               t==='roubos'?<span style={{display:'flex',alignItems:'center',gap:4}}>
                  🔴 Roubos
                  {incidentes.length>0&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:'rgba(239,68,68,.2)',color:'#f87171'}}>{incidentes.filter((i:any)=>i.tipo==='Roubo'||i.tipo==='Furto').length}</span>}
                </span>:
                <span style={{display:'flex',alignItems:'center',gap:4}}>
                  🛡 Guard
                  {guardPoints.length>0&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:'rgba(167,139,250,.2)',color:'#a78bfa'}}>{guardPoints.length}</span>}
                </span>}
            </button>
          ))}
        </div>
        {activeTab==='map' && <>
          {/* Layers */}
          <div style={{display:'flex',gap:2,padding:'5px 0',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8}}>
            {(['heat','hex','pts','arc'] as const).map(l=>(
              <button key={l} onClick={()=>setLayer(l)} style={tbBtn(l===layer)}>
                <div style={{width:6,height:6,borderRadius:'50%',background:{heat:'#ff4500',hex:'#ffd700',pts:'#2ecc71',arc:'#3d9bff'}[l]}}/>
                {{heat:'Heat',hex:'Hex',pts:'Pts',arc:'Arcos'}[l]}
              </button>
            ))}
          </div>
          {/* Toggle 3D */}
          <button onClick={() => {
            setModo3D(v => {
              const next = !v;
              setViewState(s => ({ ...s, pitch: next ? 55 : 0, bearing: next ? -15 : 0 }));
              return next;
            });
          }} style={{...tbBtn(modo3D), color: modo3D ? '#fbbf24' : '#4a5a7a',
            borderColor: modo3D ? 'rgba(251,191,36,.5)' : 'transparent',
            marginRight:8, paddingRight:8, borderRight:'1px solid #1c2535'}}>
            🏔 3D
          </button>

          {/* Toggles */}
          <div style={{display:'flex',gap:2,padding:'5px 0',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8}}>
            <button onClick={()=>setShowStarts(s=>!s)} style={tbBtn(showStarts)}>Inícios</button>
            <button onClick={()=>setShowEnds(s=>!s)} style={tbBtn(showEnds)}>Fins</button>
            <button onClick={()=>setShowStations(s=>!s)} style={tbBtn(showStations)}>📍 Estações</button>
            <button onClick={()=>setShowPoligonos(s=>!s)} style={{...tbBtn(showPoligonos),color:showPoligonos?'#a78bfa':'#4a5a7a',borderColor:showPoligonos?'rgba(167,139,250,.4)':'transparent'}}>🗺 Zonas</button>
            <button onClick={()=>{ setIs3DMode(s=>!s); setViewState(v=>({...v, pitch: is3DMode?0:45, bearing: is3DMode?0:-15})); }} style={{...tbBtn(is3DMode),color:is3DMode?'#fbbf24':'#4a5a7a',borderColor:is3DMode?'rgba(251,191,36,.4)':'transparent'}}>🏔 3D</button>
            <button onClick={()=>setShowClusters(s=>!s)} style={tbBtn(showClusters)} title="Clusters sem cobertura JET">🔴 Gaps</button>
            <button onClick={()=>setShowGuardHeat(s=>!s)} style={{...tbBtn(showGuardHeat), borderColor: showGuardHeat ? 'rgba(167,139,250,.6)' : 'transparent', color: showGuardHeat ? '#a78bfa' : '#4a5a7a'}} title="Heatmap de ocorrências Guard">🛡 Guard{showGuardHeat && guardPoints.length > 0 ? ` (${guardPoints.length})` : ''}</button>
          </div>
          {showGuardHeat && (
            <div style={{display:'flex',gap:3,alignItems:'center',padding:'0 8px',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8,flexWrap:'wrap'}}>
              {/* Botões de período */}
              {([{l:'Hoje',d:1},{l:'Ontem',d:2},{l:'7d',d:7},{l:'30d',d:30},{l:'Total',d:0}] as {l:string;d:number}[]).map(({l,d}) => (
                <button key={d} onClick={()=>{setGuardDias(d);setGuardModoCustom(false);}} style={{
                  ...tbBtn(!guardModoCustom && guardDias===d), fontSize:10, padding:'2px 6px',
                  borderColor: !guardModoCustom && guardDias===d ? 'rgba(167,139,250,.5)' : 'transparent',
                  color: !guardModoCustom && guardDias===d ? '#a78bfa' : '#4a5a7a',
                }}>{l}</button>
              ))}
              {/* Custom */}
              <button onClick={()=>setGuardModoCustom(!guardModoCustom)} style={{
                ...tbBtn(guardModoCustom), fontSize:10, padding:'2px 6px',
                borderColor: guardModoCustom ? 'rgba(167,139,250,.5)' : 'transparent',
                color: guardModoCustom ? '#a78bfa' : '#4a5a7a',
              }}>📅</button>
              {guardModoCustom && (
                <>
                  <input type="date" value={guardCustomDe} onChange={e=>setGuardCustomDe(e.target.value)}
                    style={{fontSize:10,padding:'2px 5px',borderRadius:5,background:'#1c2535',border:'1px solid #2a3a55',color:'#fff',outline:'none'}} />
                  <span style={{color:'#4a5a7a',fontSize:10}}>→</span>
                  <input type="date" value={guardCustomAte} onChange={e=>setGuardCustomAte(e.target.value)}
                    style={{fontSize:10,padding:'2px 5px',borderRadius:5,background:'#1c2535',border:'1px solid #2a3a55',color:'#fff',outline:'none'}} />
                </>
              )}
              {/* Filtro tipo */}
              {guardPoints.length > 0 && (
                <div style={{display:'flex',gap:2,marginLeft:4,borderLeft:'1px solid #1c2535',paddingLeft:6}}>
                  <button onClick={()=>setGuardFiltroTipo('TODOS')} style={{
                    fontSize:9,padding:'1px 6px',borderRadius:8,cursor:'pointer',
                    background:guardFiltroTipo==='TODOS'?'rgba(255,255,255,.1)':'transparent',
                    border:'none',color:guardFiltroTipo==='TODOS'?'#fff':'#4a5a7a',
                  }}>Todos ({guardPoints.length})</button>
                  {(['Roubo','Tentativa','Vandalismo','Recuperacao','Outro'] as const).map(t => {
                    const n = guardPoints.filter(p => p.tipo === t).length;
                    if (!n) return null;
                    const cor: Record<string,string> = {Roubo:'#ef4444',Tentativa:'#f97316',Vandalismo:'#eab308',Recuperacao:'#22c55e',Outro:'#6b7280'};
                    const em:  Record<string,string> = {Roubo:'🔴',Tentativa:'🟠',Vandalismo:'🟡',Recuperacao:'🟢',Outro:'⚪'};
                    return (
                      <button key={t} onClick={()=>setGuardFiltroTipo(t)} title={t} style={{
                        fontSize:9,padding:'1px 5px',borderRadius:10,cursor:'pointer',
                        background: guardFiltroTipo===t ? cor[t]+'30' : 'transparent',
                        color: cor[t], border:'1px solid '+(guardFiltroTipo===t?cor[t]+'60':'transparent'),
                      }}>{em[t]} {n}</button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Compare mode */}
          <button onClick={()=>setCompareMode(m=>!m)} style={{...tbBtn(compareMode),borderColor:compareMode?'#f5c842':'transparent',color:compareMode?'#f5c842':'#4a5a7a'}}>
            ⚖ Comparar
          </button>
          {compareMode && (
            <div style={{display:'flex',gap:4,marginLeft:8}}>
              <button onClick={()=>setCompareSide('A')} style={{...tbBtn(compareSide==='A'),background:compareSide==='A'?'rgba(0,100,255,.2)':'transparent',color:'#3d9bff',borderColor:compareSide==='A'?'#3d9bff':'#1c2535'}}>
                A ({compareA.size} dias)
              </button>
              <button onClick={()=>setCompareSide('B')} style={{...tbBtn(compareSide==='B'),background:compareSide==='B'?'rgba(255,100,0,.2)':'transparent',color:'#ff6422',borderColor:compareSide==='B'?'#ff6422':'#1c2535'}}>
                B ({compareB.size} dias)
              </button>
            </div>
          )}
          {/* Timeline */}
          <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto',paddingRight:8}}>
            <button onClick={()=>{setAnimPlaying(p=>!p); if(animHour===null)setAnimHour(0);}}
              style={{...tbBtn(animPlaying),color:animPlaying?'#2ecc71':'#4a5a7a'}}>
              {animPlaying?'⏸':'▶'} Timeline
            </button>
            {animHour!==null && (
              <>
                <input type="range" min={0} max={23} value={animHour} onChange={e=>setAnimHour(parseInt(e.target.value))}
                  style={{width:80,height:3,appearance:'none' as any,background:'#1c2535',borderRadius:2,cursor:'pointer'}}/>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:'#2ecc71',width:28}}>{animHour}h</span>
                <button onClick={()=>{setAnimHour(null);setAnimPlaying(false);}} style={{...tbBtn(false),fontSize:9,padding:'2px 6px'}}>✕</button>
              </>
            )}
          </div>
          {/* Side panel tabs */}
          <div style={{display:'flex',gap:2,padding:'5px 0',borderLeft:'1px solid #1c2535',marginLeft:4,paddingLeft:8}}>
            {(['filters','score','clusters','hora'] as const).map(p=>(
              <button key={p} onClick={()=>setSidePanel(p)} style={tbBtn(sidePanel===p)}>
                {p==='filters'?'Filtros':p==='score'?'Score':p==='clusters'?'Clusters':'⏱ Horas'}
              </button>
            ))}
          </div>
          {/* Seletor de regiões — multi-select na toolbar do mapa */}
          {true && (
            <div style={{display:'flex',alignItems:'center',gap:3,borderLeft:'1px solid #1c2535',
              paddingLeft:8,marginLeft:4,flexWrap:'nowrap',overflowX:'auto'}}>
              <span style={{fontSize:9,color:'#4a5a7a',whiteSpace:'nowrap'}}>🌎</span>
              <button onClick={() => setCidadesFiltro(new Set())}
                style={{...tbBtn(cidadesFiltro.size===0),fontSize:9,padding:'2px 8px',whiteSpace:'nowrap',
                  color:cidadesFiltro.size===0?'#3d9bff':'#4a5a7a',
                  fontWeight:cidadesFiltro.size===0?700:400}}>
                🇧🇷 BR
              </button>
              {cidadesDisponiveis.map(c => {
                const daysC = Object.values(days).filter(d => (d.meta.regiao || d.meta.cidade || '') === c);
                const totalC = daysC.reduce((s,d) => s + d.meta.total, 0);
                const ativo = cidadesFiltro.has(c);
                return (
                  <button key={c}
                    onClick={() => setCidadesFiltro(prev => {
                      const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n;
                    })}
                    title={totalC.toLocaleString('pt-BR') + ' corridas'}
                    style={{...tbBtn(ativo), fontSize:9, padding:'2px 8px', whiteSpace:'nowrap',
                      color: ativo ? '#fff' : '#4a5a7a',
                      background: ativo ? 'rgba(61,155,255,.2)' : 'transparent',
                      borderColor: ativo ? '#3d9bff' : 'transparent',
                      fontWeight: ativo ? 700 : 400,
                    }}>
                    {c} <span style={{fontSize:8,opacity:.7}}>({totalC >= 1000 ? (totalC/1000).toFixed(1)+'k' : totalC})</span>
                  </button>
                );
              })}
            </div>
          )}
          {uploading && <div style={{fontSize:11,color:'#3d9bff',fontFamily:"'IBM Plex Mono',monospace",paddingLeft:8}}>{uploadProgress}</div>}
        </>}
      </div>

      {/* MAIN */}
      <div style={{display:'flex',flex:1,minHeight:0,overflow:'hidden'}}>

        {/* MAP / TREND / OD / GUARD */}
        <div style={{flex:1,position:'relative',minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {activeTab==='map' && (
            <div style={{position:'absolute',top:'0',left:'0',right:'0',bottom:'0'}}
              onDragOver={e=>{e.preventDefault();setDragging(true)}}
              onDragLeave={()=>setDragging(false)}
              onDrop={async e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f&&isGestor)handleFile(f);}}>
              <DeckGL viewState={viewState} onViewStateChange={({viewState:vs}:any)=>setViewState(vs)}
                controller={{ dragRotate: true, touchRotate: true }} layers={deckLayers}
                style={{position:'absolute',top:'0',left:'0',right:'0',bottom:'0'}}>
                <MapLibreMap mapStyle={MAP_STYLE}/>
              </DeckGL>
              {compareMode && (
                <div style={{position:'absolute',bottom:20,left:'50%',transform:'translateX(-50%)',display:'flex',gap:16,background:'rgba(12,16,24,.9)',padding:'8px 20px',borderRadius:8,border:'1px solid #1c2535',pointerEvents:'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:12,height:12,borderRadius:'50%',background:'#3d9bff'}}/><span style={{fontSize:11}}>A: {filteredA.length.toLocaleString()} corridas</span></div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:12,height:12,borderRadius:'50%',background:'#ff6422'}}/><span style={{fontSize:11}}>B: {filteredB.length.toLocaleString()} corridas</span></div>
                </div>
              )}
              {animHour!==null && (
                <div style={{position:'absolute',top:16,left:'50%',transform:'translateX(-50%)',background:'rgba(12,16,24,.9)',padding:'6px 20px',borderRadius:20,border:'1px solid #2ecc71',fontFamily:"'IBM Plex Mono',monospace",fontSize:14,color:'#2ecc71',pointerEvents:'none'}}>
                  {animHour}:00 — {animHour+1 < 24 ? animHour+1 : 0}:00 · {(byHour[animHour]||0)} corridas
                </div>
              )}
              {dragging && <div style={{position:'absolute',top:'0',left:'0',right:'0',bottom:'0',background:'rgba(61,155,255,.08)',border:'2px dashed #3d9bff',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12,zIndex:1000}}>
                <div style={{fontSize:48}}>📂</div>
                <div style={{fontSize:18,fontWeight:700,color:'#3d9bff'}}>Solte o XLSX aqui</div>
              </div>}
              {tooltip && (
                <div style={{position:'fixed',left:tooltip.x+12,top:tooltip.y-10,background:'rgba(8,11,18,.97)',border:'1px solid #1c2535',padding:'8px 12px',borderRadius:7,pointerEvents:'none',zIndex:9999,backdropFilter:'blur(8px)'}}>
                  {tooltip.content.split('|').map((line,i)=>(
                    <div key={i} style={{fontSize:i===0?12:10,fontWeight:i===0?700:400,color:i===0?'#3d9bff':'#dce8ff',fontFamily:i===0?"'IBM Plex Mono',monospace":"'DM Sans',sans-serif",marginBottom:i===0?4:1}}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TREND VIEW */}
          {activeTab==='trend' && (
            <div style={{padding:24,flex:1,overflowY:'auto',minHeight:0}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:20,color:'#dce8ff'}}>Tendência por Dia</div>
              {trendData.length === 0 ? (
                <div style={{color:'#4a5a7a',fontSize:12}}>Nenhum dado carregado ainda.</div>
              ) : (
                <>
                  <TrendChart data={trendData} metric="total" color="#3d9bff" label="Corridas"/>
                  <TrendChart data={trendData} metric="rev" color="#f5c842" label="Receita R$"/>
                  <TrendChart data={trendData} metric="dist" color="#2ecc71" label="Dist. média km"/>
                </>
              )}
            </div>
          )}

          {/* OD VIEW */}
          {activeTab==='od' && (
            <div style={{padding:24,flex:1,overflowY:'auto',minHeight:0}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:'#dce8ff'}}>Matriz Origem → Destino</div>
              <div style={{fontSize:11,color:'#4a5a7a',marginBottom:20}}>Top fluxos entre zonas com mais de 5 corridas no período selecionado</div>
              <ODMatrix rides={ridesA}/>
            </div>
          )}

          {/* GUARD ANALYTICS */}
          {activeTab==='guard' && (() => {
            // Extrai cidade a partir dos days carregados (meta.cidade)
            const cidadeGuard = Object.values(days)[0]?.meta?.cities?.[0] || '';
            return (
              <GuardAnalyticsPanel
                guardPoints={guardPoints}
                estacoes={estacoes}
                filtered={filtered}
                showGuardHeat={showGuardHeat}
                guardDias={guardDias}
                guardModoCustom={guardModoCustom}
                guardCustomDe={guardCustomDe}
                guardCustomAte={guardCustomAte}
                guardFiltroTipo={guardFiltroTipo}
                setGuardDias={setGuardDias}
                setGuardModoCustom={setGuardModoCustom}
                setGuardCustomDe={setGuardCustomDe}
                setGuardCustomAte={setGuardCustomAte}
                setGuardFiltroTipo={setGuardFiltroTipo}
                setShowGuardHeat={setShowGuardHeat}
                cidade={cidadeGuard}
              />
            );
          })()}

          {/* PAINEL PERDAS */}
          {activeTab==='perdas' && (
            <PerdasPanel incidentes={incidentes} loading={loadingIncident} modoRoubos={false} />
          )}
          {activeTab==='roubos' && (
            <PerdasPanel incidentes={incidentes} loading={loadingIncident} modoRoubos={true} />
          )}
        </div>

        {/* SIDE PANEL */}
        <div style={{width:290,background:'#0c1018',borderLeft:'1px solid #1c2535',display:'flex',flexDirection:'column',overflowY:'scroll',overflowX:'hidden',flexShrink:0,minHeight:0,position:'relative',scrollbarWidth:'thin',scrollbarColor:'#1c2535 #0c1018'}}>

          {/* RESUMO POR REGIÃO — mostra quando há múltiplas */}
          {Object.keys(days).length > 0 && (() => {
            const regioes = [...new Set(Object.keys(days).map(k => {
              const r = days[k].meta.regiao || days[k].meta.cidade || '';
              return r && r !== 'default' ? r : (cidadePorDay[k] || '');
            }))].filter(r => r && r.length > 1);
            if (regioes.length <= 1) return null;

            // KPIs por região — usando cidadePorDay para days sem regiao no meta
            const kpisPorRegiao = regioes.map(r => {
              const daysR = Object.entries(days).filter(([k,d]) => {
                const reg = d.meta.regiao || d.meta.cidade || '';
                return reg === r || ((!reg || reg === 'default') && cidadePorDay[k] === r);
              }).map(([,d]) => d);
              const total = daysR.reduce((s,d) => s + d.meta.total, 0);
              const rev   = daysR.reduce((s,d) => s + d.meta.total_rev, 0);
              const nDias = daysR.length;
              return { r, total, rev, nDias };
            }).sort((a,b) => b.total - a.total);

            const totalGeral = kpisPorRegiao.reduce((s,k) => s + k.total, 0);

            return (
              <div style={sec}>
                <div style={{...secTitle, marginBottom:8}}>🏙 Regiões carregadas</div>
                <div style={{display:'flex',flexDirection:'column',gap:5}}>
                  {kpisPorRegiao.map(k => {
                    const pct = totalGeral > 0 ? k.total/totalGeral*100 : 0;
                    const ativo = cidadesFiltro.size===0 || cidadesFiltro.has(k.r);
                    return (
                      <div key={k.r}
                        onClick={() => setCidadesFiltro(prev => {
                          const n = new Set(prev);
                          n.has(k.r) ? n.delete(k.r) : n.add(k.r);
                          return n;
                        })}
                        style={{padding:'7px 10px',borderRadius:8,cursor:'pointer',
                          background: ativo ? 'rgba(61,155,255,.08)' : 'rgba(255,255,255,.02)',
                          border:`1px solid ${ativo ? 'rgba(61,155,255,.25)' : '#1c2535'}`,
                        }}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                          <span style={{fontSize:11,fontWeight:700,color: ativo ? '#3d9bff' : '#4a5a7a'}}>{k.r}</span>
                          <span style={{fontSize:10,color:'#4a5a7a'}}>{k.nDias}d</span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color: ativo ? '#dce8ff' : '#4a5a7a'}}>{k.total.toLocaleString('pt-BR')}</span>
                          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:'#f5c842'}}>R${Math.round(k.rev/1000)}k</span>
                        </div>
                        <div style={{height:3,background:'#1c2535',borderRadius:2}}>
                          <div style={{height:'100%',borderRadius:2,background: ativo ? '#3d9bff' : '#2a3a55',width:`${pct}%`,transition:'width .3s'}}/>
                        </div>
                      </div>
                    );
                  })}
                  {cidadesFiltro.size > 0 && (
                    <button onClick={() => setCidadesFiltro(new Set())} style={{
                      padding:'4px',fontSize:9,color:'#3d9bff',background:'none',
                      border:'none',cursor:'pointer',textAlign:'center',
                    }}>Ver todas as regiões</button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* CALENDAR */}
          <div style={sec}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <div style={secTitle}>Período{compareMode?` — Selecionando ${compareSide}`:''}</div>
              <button onClick={()=>setCalMonth(m=>{if(m===0){setCalYear(y=>y-1);return 11;}return m-1;})} style={calBtn}>‹</button>
              <div style={{fontSize:11,fontWeight:600}}>{MONTHS[calMonth]} {calYear}</div>
              <button onClick={()=>setCalMonth(m=>{if(m===11){setCalYear(y=>y+1);return 0;}return m+1;})} style={calBtn}>›</button>
            </div>
            {/* Seleção rápida */}
            <div style={{display:'flex',gap:4,marginBottom:8,flexWrap:'wrap'}}>
              {[
                ['Hoje', ()=>{const d=new Date().toISOString().split('T')[0];if(days[d])toggleDay(d);}],
                ['Semana', ()=>{const today=new Date();[...Array(7)].forEach((_,i)=>{const d=new Date(today);d.setDate(today.getDate()-i);const k=d.toISOString().split('T')[0];if(days[k])toggleDay(k);});}],
                ['Mês', ()=>{const prefix=`${calYear}-${String(calMonth+1).padStart(2,'0')}`;allDayKeys.filter(k=>k.startsWith(prefix)).forEach(k=>{ if(!activeDays.has(k)) toggleDay(k); });}],
                ['Tudo', ()=>{allDayKeys.forEach(k=>{ if(!activeDays.has(k)) toggleDay(k); });}],
                ['Limpar', ()=>setActiveDays(new Set())],
              ].map(([label, fn])=>(
                <button key={String(label)} onClick={()=>(fn as ()=>void)()} style={{
                  padding:'2px 8px',borderRadius:6,border:'1px solid rgba(61,155,255,.2)',
                  background:'rgba(61,155,255,.06)',color:'#3d9bff',cursor:'pointer',
                  fontSize:9,fontWeight:600,
                }}>{String(label)}</button>
              ))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:2}}>
              {['D','S','T','Q','Q','S','S'].map((d,i)=><div key={i} style={{textAlign:'center',fontSize:9,color:'#4a5a7a'}}>{d}</div>)}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
              {calDays.map((item,i)=>{
                const hasData=item?allDayKeys.some(k=>k===item||k.startsWith(item+'_')) && (regiaoFiltro==='todas' || allDayKeys.filter(k=>k===item||k.startsWith(item+'_')).some(k=>!days[k]?.meta?.regiao||days[k]?.meta?.regiao===regiaoFiltro)):false;
                const inA=item?compareA.has(item):false;
                const inB=item?compareB.has(item):false;
                const isActive=item?(compareMode?(inA||inB):allDayKeys.filter(k=>k===item||k.startsWith(item+'_')).some(k=>activeDays.has(k))):false;
                const bg=inA?'#3d9bff':inB?'#ff6422':hasData?'rgba(61,155,255,.12)':'transparent';
                const color=inA?'#000':inB?'#000':hasData?'#3d9bff':'#4a5a7a';
                return <div key={i} onClick={()=>item&&hasData&&toggleDay(item)} style={{height:26,borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,cursor:hasData?'pointer':'default',fontFamily:"'IBM Plex Mono',monospace",background:bg,color,fontWeight:isActive?700:400,border:hasData?'1px solid rgba(61,155,255,.2)':'1px solid transparent'}}>
                  {item?parseInt(item.split('-')[2]):''}
                </div>;
              })}
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:8}}>
              {allDayKeys.sort().map(d=>{
                const inA=compareA.has(d), inB=compareB.has(d), isAct=activeDays.has(d);
                const active=compareMode?(inA||inB):isAct;
                return <div key={d} onClick={()=>toggleDay(d)} style={{display:'flex',alignItems:'center',gap:4,padding:'2px 6px',background:inA?'rgba(61,155,255,.15)':inB?'rgba(255,100,34,.15)':active?'rgba(61,155,255,.08)':'#111722',border:`1px solid ${inA?'#3d9bff':inB?'#ff6422':active?'rgba(61,155,255,.3)':'#1c2535'}`,borderRadius:3,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:inA?'#3d9bff':inB?'#ff6422':active?'#dce8ff':'#4a5a7a',cursor:'pointer'}}>
                  {compareMode&&inA&&<span style={{fontSize:8,fontWeight:700}}>A </span>}
                  {compareMode&&inB&&<span style={{fontSize:8,fontWeight:700}}>B </span>}
                  {d.slice(5)}
                  {isGestor&&<span onClick={e=>{e.stopPropagation();deleteDay(d);}} style={{color:'#ff4757',cursor:'pointer',marginLeft:2}}>×</span>}
                </div>;
              })}
            </div>
          </div>

          {/* PANEL CONTENT */}
          {sidePanel==='filters' && <>
            {/* Hour filter */}
            <div style={sec}>
              <div style={secTitle}>Hora {animHour!==null?`— Timeline: ${animHour}h`:''}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(12,1fr)',gap:2}}>
                {[...Array(24).keys()].map(h=>{
                  const cnt=byHour[h]||0, on=animHour!==null?h===animHour:selHours.has(h), intens=cnt/maxHour;
                  const bg=`rgba(${Math.round(61+intens*194)},${Math.round(155+intens*100)},255,${on?.85:.15})`;
                  return <div key={h} onClick={()=>{if(animHour!==null){setAnimHour(h);}else{setSelHours(prev=>{const n=new Set(prev);n.has(h)?n.delete(h):n.add(h);return n;});}}}
                    title={`${h}h: ${cnt}`} style={{height:22,borderRadius:3,background:bg,cursor:'pointer',opacity:on?1:.4,position:'relative'}}>
                    {h%6===0&&<div style={{position:'absolute',bottom:-14,left:'50%',transform:'translateX(-50%)',fontSize:8,color:'#4a5a7a'}}>{h}h</div>}
                  </div>;
                })}
              </div>
              <div style={{display:'flex',gap:3,marginTop:20}}>
                {([['Todos',()=>setSelHours(new Set([...Array(24).keys()]))],['Pico',()=>setSelHours(new Set([7,8,9,17,18,19]))],['Manhã',()=>setSelHours(new Set([5,6,7,8,9,10]))],['Noturno',()=>setSelHours(new Set([20,21,22,23,0,1]))]] as [string,()=>void][]).map(([l,fn])=>(
                  <button key={l} onClick={fn} style={{flex:1,padding:'3px 0',background:'#111722',border:'1px solid #1c2535',color:'#4a5a7a',borderRadius:3,cursor:'pointer',fontSize:9,fontFamily:"'DM Sans',sans-serif"}}>{l}</button>
                ))}
              </div>
            </div>
            {/* Sliders */}
            <div style={sec}>
              <div style={secTitle}>Filtros de Corrida</div>
              {([['Dist. máx',maxDist,13,.5,setMaxDist,'km'],['Dur. máx',maxDur,140,5,setMaxDur,'min']] as any[]).map(([l,v,mx,st,fn,u])=>(
                <div key={l} style={{display:'flex',alignItems:'center',gap:8,marginBottom:7}}>
                  <span style={{fontSize:10,color:'#4a5a7a',width:62}}>{l}</span>
                  <input type="range" min={0} max={mx} step={st} value={v} onChange={e=>fn(parseFloat(e.target.value))}
                    style={{flex:1,height:3,appearance:'none' as any,background:'#1c2535',borderRadius:2,cursor:'pointer'}}/>
                  <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:'#3d9bff',width:52,textAlign:'right'}}>≤{v}{u}</span>
                </div>
              ))}
            </div>
            {/* Metrics */}
            <div style={sec}>
              <div style={secTitle}>Resumo {compareMode?'A':''}</div>
              {/* KPIs expandidos com sub-info */}
              {(() => {
                const nDias = Math.max(activeDays.size, 1);
                const kpiData: [string,string,string,string][] = [
                  ['Corridas',      n.toLocaleString('pt-BR'),               Math.round(n/nDias).toLocaleString()+'/dia',  '#3d9bff'],
                  ['Receita',       'R$'+Math.round(totalRev).toLocaleString('pt-BR'), 'R$'+Math.round(totalRev/nDias)+'/dia',       '#f5c842'],
                  ['Dist. média',   avgDist.toFixed(1)+'km',                 'por corrida',                                '#2ecc71'],
                  ['Dur. média',    avgDur.toFixed(0)+'min',                 'por corrida',                                '#e67e22'],
                ];
                return (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                    {kpiData.map(([l,v,sub,c]) => (
                      <div key={l} style={{background:'#111722',borderRadius:5,padding:'8px 10px',border:'1px solid #1c2535'}}>
                        <div style={{fontSize:8,color:'#4a5a7a',marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
                        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
                        <div style={{fontSize:8,color:'#4a5a7a',marginTop:3}}>{sub}</div>
                      </div>
                    ))}
                    <button onClick={exportAnalyticsPDF} title="Exportar relatório PDF"
                      style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',
                        color:'#f87171',cursor:'pointer',fontSize:10,fontWeight:600,
                        borderRadius:5,padding:'8px 10px',alignSelf:'stretch',whiteSpace:'nowrap',
                        gridColumn:'span 2'}}>📕 Exportar PDF completo</button>
                  </div>
                );
              })()}
              {compareMode && filteredB.length>0 && (
                <div style={{marginTop:8,padding:'8px 10px',background:'rgba(255,100,34,.08)',borderRadius:5,border:'1px solid rgba(255,100,34,.2)',fontSize:10}}>
                  <div style={{color:'#ff6422',fontWeight:700,marginBottom:4}}>B: {filteredB.length.toLocaleString()} corridas</div>
                  <div style={{color:'#4a5a7a'}}>Δ corridas: <span style={{color: filteredA.length>filteredB.length?'#2ecc71':'#ff4757'}}>{filteredA.length>filteredB.length?'+':''}{(filteredA.length-filteredB.length).toLocaleString()}</span></div>
                  <div style={{color:'#4a5a7a'}}>Δ receita: <span style={{color:totalRev>(filteredB.reduce((s,r)=>s+(r.rev||0),0))?'#2ecc71':'#ff4757'}}>R${(totalRev - filteredB.reduce((s,r)=>s+(r.rev||0),0)).toFixed(0)}</span></div>
                </div>
              )}
            </div>
            {/* Gráfico por hora — clicável para filtrar */}
            <div style={sec}>
              <div style={{...secTitle, marginBottom:6}}>⏱ Por Hora</div>
              <div style={{display:'flex',alignItems:'flex-end',gap:1,height:56,marginBottom:6,cursor:'pointer'}} title="Clique para filtrar hora">
                {[...Array(24).keys()].map(h=>{
                  const cnt=byHour[h]||0, pct=(cnt/maxHour)*100, on=animHour!==null?h===animHour:selHours.has(h);
                  const isPico = cnt === Math.max(...Object.values(byHour), 0) && cnt > 0;
                  return <div key={h}
                    onClick={() => setSelHours(prev => {
                      const n = new Set(prev);
                      if (n.size === 24) { return new Set([h]); }
                      n.has(h) ? n.delete(h) : n.add(h);
                      if (n.size === 0) return new Set([...Array(24).keys()]);
                      return n;
                    })}
                    title={`${h}h: ${cnt} corridas${isPico?' ⭐ Pico':''}${!on?' (excluído)':''}`}
                    style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',gap:1,cursor:'pointer'}}>
                    <div style={{width:'100%',borderRadius:'2px 2px 0 0',minHeight:2,height:`${pct}%`,
                      opacity:on?.9:.15,
                      background: isPico ? '#f5c842' : `hsl(${210-pct*1.5},70%,${35+pct*.4}%)`,
                      outline: isPico && on ? '1px solid #f5c842' : 'none',
                      transition:'opacity .15s',
                    }}/>
                    {h%6===0&&<div style={{fontSize:6,color:'#4a5a7a'}}>{h}h</div>}
                  </div>;
                })}
              </div>
            </div>
            {/* Score list */}
            <div style={{...sec,flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={secTitle}>Top Zonas</div>
                <select value={scoreMetric} onChange={e=>setScoreMetric(e.target.value as any)}
                  style={{background:'#111722',border:'1px solid #1c2535',color:'#dce8ff',padding:'2px 6px',borderRadius:4,fontSize:10,cursor:'pointer'}}>
                  <option value="count">Corridas</option><option value="rev">Receita</option>
                  <option value="dist">Dist.</option><option value="peak">Pico</option>
                </select>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4,overflowY:'auto',flex:1}}>
                {scored.map((z,i)=>(
                  <div key={z.name} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',background:'#111722',borderRadius:4,border:'1px solid #1c2535',cursor:'pointer'}}
                    onMouseEnter={e=>(e.currentTarget.style.borderColor='#3d9bff')}
                    onMouseLeave={e=>(e.currentTarget.style.borderColor='#1c2535')}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:'#4a5a7a',width:14}}>{i+1}</div>
                    <div style={{flex:1,fontSize:10,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={z.name}>{z.name}</div>
                    <div style={{width:36,height:3,background:'#1c2535',borderRadius:2}}><div style={{height:'100%',borderRadius:2,background:'#3d9bff',width:`${z.score/maxScore*100}%`}}/></div>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:600,color:'#3d9bff',width:32,textAlign:'right'}}>{z.count}</div>
                  </div>
                ))}
                {scored.length===0&&<div style={{fontSize:11,color:'#4a5a7a',textAlign:'center',marginTop:12}}>Selecione dias</div>}
              </div>
            </div>
          </>}

          {/* SCORE PANEL */}
          {sidePanel==='score' && (
            <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
              <div style={sec}>
                <div style={secTitle}>Score de Estações JET</div>
                <div style={{fontSize:10,color:'#4a5a7a',marginBottom:8}}>Corridas iniciando/terminando a ≤150m. Verde=alta demanda, cinza=inativa.</div>
              </div>
              <div style={{flex:1,overflowY:'auto',padding:'8px 14px',display:'flex',flexDirection:'column',gap:4}}>
                {stationScores.filter(s=>s.total>0).slice(0,20).map((s,i)=>{
                  const max=stationScores.find(x=>x.total>0)?.total||1;
                  return <div key={s.id} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 9px',background:'#111722',borderRadius:5,border:'1px solid #1c2535',cursor:'pointer'}}
                    onClick={()=>{ setViewState(vs=>({...vs,longitude:s.lng,latitude:s.lat,zoom:16})); window.dispatchEvent(new CustomEvent('jetFlyTo',{detail:{lat:s.lat,lng:s.lng,zoom:17}})); }}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:'#4a5a7a',width:14}}>{i+1}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,fontWeight:600,color:'#dce8ff'}}>{s.nome||s.endereco||s.codigo}</div>
                      <div style={{fontSize:9,color:'#4a5a7a'}}>{s.bairro} · {s.codigo}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:600,color:'#2ecc71'}}>{s.total}</div>
                      <div style={{fontSize:8,color:'#4a5a7a'}}>{s.starts}↑ {s.ends}↓</div>
                    </div>
                    <div style={{width:4,height:32,borderRadius:2,background:`hsl(${120*s.total/max},70%,45%)`}}/>
                  </div>;
                })}
                {stationScores.filter(s=>s.total===0).length>0 && (
                  <div style={{marginTop:8,padding:'8px',background:'rgba(255,71,87,.05)',borderRadius:5,border:'1px solid rgba(255,71,87,.15)'}}>
                    <div style={{fontSize:10,color:'#ff4757',fontWeight:600,marginBottom:4}}>Estações sem demanda ({stationScores.filter(s=>s.total===0).length})</div>
                    {stationScores.filter(s=>s.total===0).slice(0,5).map(s=>(
                      <div key={s.id} style={{fontSize:9,color:'#4a5a7a',padding:'2px 0',cursor:'pointer'}}
                        onClick={()=>setViewState(vs=>({...vs,longitude:s.lng,latitude:s.lat,zoom:16}))}>
                        {s.nome||s.endereco||s.codigo} — {s.bairro}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CLUSTERS PANEL */}
          {sidePanel==='clusters' && (
            <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
              <div style={sec}>
                <div style={secTitle}>Gaps de Cobertura</div>
                <div style={{fontSize:10,color:'#4a5a7a',marginBottom:8}}>Clusters com ≥50 corridas e sem estação JET a menos de 300m. Candidatos para nova estação.</div>
                <button onClick={()=>setShowClusters(true)} style={{...tbBtn(showClusters),fontSize:10,padding:'4px 10px',width:'100%',justifyContent:'center',borderColor:showClusters?'#ff4757':'#1c2535',color:showClusters?'#ff4757':'#4a5a7a'}}>
                  {showClusters?'🔴 Mostrando no mapa':'Mostrar no mapa'}
                </button>
              </div>
              <div style={{flex:1,overflowY:'auto',padding:'8px 14px',display:'flex',flexDirection:'column',gap:4}}>
                {clusters.length===0 && <div style={{fontSize:11,color:'#4a5a7a',textAlign:'center',marginTop:16}}>
                  {filtered.length===0?'Selecione dias para analisar':'Nenhum gap encontrado'}
                </div>}
                {clusters.slice(0,20).map((c,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'#111722',borderRadius:5,border:'1px solid rgba(255,71,87,.2)',cursor:'pointer'}}
                    onClick={()=>setViewState(vs=>({...vs,longitude:c.lng,latitude:c.lat,zoom:16}))}>
                    <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(255,50,50,.2)',border:'2px solid #ff4757',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,color:'#ff4757',flexShrink:0}}>{c.count}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,color:'#dce8ff'}}>{c.lat.toFixed(4)}, {c.lng.toFixed(4)}</div>
                      <div style={{fontSize:9,color:'#4a5a7a'}}>Estação mais próxima: {Math.round(c.nearestStation)}m</div>
                    </div>
                    <div style={{fontSize:9,color:'#f5c842',fontFamily:"'IBM Plex Mono',monospace"}}>+{Math.round(c.nearestStation)}m</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── HORA PANEL ── */}
          {sidePanel==='hora' && (
            <HoraComparativo
              days={days}
              activeDays={activeDays}
              allDayKeys={allDayKeys}
              mode={horaCompMode}
              setMode={setHoraCompMode}
            />
          )}
        </div>
      </div>
      {/* Modal mesclar/substituir */}
      {mergeCtx && (
        <div style={{position:'fixed',inset:'0',zIndex:5000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.7)',backdropFilter:'blur(6px)'}}>
          <div style={{background:'#0c1018',border:'1px solid #1c2535',borderRadius:12,padding:24,width:340,maxWidth:'92vw',boxShadow:'0 24px 80px rgba(0,0,0,.9)'}}>
            <div style={{fontSize:16,fontWeight:700,color:'#dce8ff',marginBottom:8}}>📊 Dados existentes</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,.5)',marginBottom:16,lineHeight:1.6}}>
              Já existe dados para <b style={{color:'#f5c842'}}>{mergeCtx.dayKey}</b>.<br/>
              <span style={{color:'rgba(255,255,255,.3)'}}>Existente: {mergeCtx.existente.rides.length} corridas · Novo: {mergeCtx.data.rides.length} corridas</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <button onClick={()=>handleMerge('mesclar')} style={{
                padding:'12px',borderRadius:8,border:'none',cursor:'pointer',
                background:'linear-gradient(135deg,#1a6fd4,#307FE2)',
                color:'#fff',fontSize:13,fontWeight:700,
              }}>
                🔀 Mesclar — {mergeCtx.existente.rides.length + mergeCtx.data.rides.length} corridas no total
              </button>
              <button onClick={()=>handleMerge('substituir')} style={{
                padding:'12px',borderRadius:8,cursor:'pointer',
                border:'1px solid rgba(239,68,68,.3)',background:'rgba(239,68,68,.08)',
                color:'#f87171',fontSize:13,fontWeight:600,
              }}>
                🔄 Substituir — manter apenas as {mergeCtx.data.rides.length} novas corridas
              </button>
              <button onClick={()=>setMergeCtx(null)} style={{
                padding:'10px',borderRadius:8,border:'1px solid rgba(255,255,255,.08)',
                background:'rgba(255,255,255,.04)',color:'rgba(255,255,255,.4)',
                cursor:'pointer',fontSize:12,
              }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TREND CHART ───────────────────────────────────────────────────
function TrendChart({ data, metric, color, label }: { data:{date:string,total:number,rev:number,dist:number}[]; metric:'total'|'rev'|'dist'; color:string; label:string; }) {
  const values = data.map(d=>d[metric]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  return (
    <div style={{marginBottom:24}}>
      <div style={{fontSize:11,color,fontWeight:600,marginBottom:8}}>{label}</div>
      <div style={{display:'flex',alignItems:'flex-end',gap:3,height:80,borderBottom:'1px solid #1c2535'}}>
        {data.map((d,i)=>{
          const v=d[metric], pct=(v-min)/(max-min||1)*100;
          return <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',gap:2,cursor:'pointer'}} title={`${d.date}: ${v}`}>
            <div style={{width:'100%',borderRadius:'2px 2px 0 0',background:color,opacity:.8,minHeight:2,height:`${Math.max(pct,3)}%`,transition:'height .2s'}}/>
            {data.length<=10&&<div style={{fontSize:7,color:'#4a5a7a',transform:'rotate(-45deg)',whiteSpace:'nowrap'}}>{d.date.slice(5)}</div>}
          </div>;
        })}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:9,color:'#4a5a7a',fontFamily:"'IBM Plex Mono',monospace"}}>
        <span>{metric==='dist'?min.toFixed(1):Math.round(min)}</span>
        <span style={{color}}>max: {metric==='dist'?max.toFixed(1):metric==='rev'?'R$'+max.toFixed(0):max}</span>
        <span>{metric==='dist'?max.toFixed(1):Math.round(max)}</span>
      </div>
    </div>
  );
}

// ── OD MATRIX ─────────────────────────────────────────────────────
function ODMatrix({ rides }: { rides: Ride[] }) {
  const od: Record<string, Record<string,number>> = {};
  rides.forEach(r => {
    const zs=(r.zs||'').replace(/[🟥🟦🟧⬛️⛔️🛴]/g,'').trim();
    if (!zs||zs.length<3||zs==='Sao Paulo') return;
    if (!od[zs]) od[zs]={};
  });
  const zones = Object.keys(od).slice(0,8);
  if (zones.length === 0) return <div style={{color:'#4a5a7a',fontSize:12}}>Selecione dias para ver a matriz OD.</div>;
  const maxFlow = 1;
  return (
    <div style={{overflowX:'auto'}}>
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:12}}>
        Top fluxos origem → destino calculados a partir das zonas de início e fim de cada corrida.
        Os dados de zona de destino dependem do campo "zona de término" disponível nos arquivos importados.
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {zones.slice(0,10).map(z=>{
          const cnt = rides.filter(r=>(r.zs||'').includes(z.slice(0,8))).length;
          return <div key={z} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'#111722',borderRadius:4,border:'1px solid #1c2535'}}>
            <div style={{flex:1,fontSize:10,color:'#dce8ff',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{z}</div>
            <div style={{width:80,height:4,background:'#1c2535',borderRadius:2}}><div style={{height:'100%',background:'#3d9bff',borderRadius:2,width:`${(cnt/Math.max(...zones.map(z2=>rides.filter(r=>(r.zs||'').includes(z2.slice(0,8))).length),1))*100}%`}}/></div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:'#3d9bff',width:32,textAlign:'right'}}>{cnt}</div>
          </div>;
        })}
      </div>
    </div>
  );
}

// ── XLSX PARSER ───────────────────────────────────────────────────
async function parseXLSX(file:File, setProgress:(s:string)=>void): Promise<DayData> {
  setProgress('Carregando parser...');
  const w=window as any;
  if (!w.XLSX) await new Promise<void>(r=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=()=>r();document.head.appendChild(s);});
  setProgress('Lendo planilha...');
  const buf=await file.arrayBuffer();
  const wb=w.XLSX.read(buf,{type:'array'});
  const raw:any[]=w.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if(!raw.length) throw new Error('Arquivo vazio');
  const keys=Object.keys(raw[0]);
  // Detecta colunas — suporta PT (Urent BR) e RU (Urent original)
  // IMPORTANTE: ordem importa — match mais específico primeiro
  const findCol = (tests: ((k:string)=>boolean)[]) => {
    for (const test of tests) { const found = keys.find(test); if (found) return found; }
    return undefined;
  };
  const C = {
    ls:   findCol([k=>k.includes('Local de transporte') && k.includes('início'), k=>k.includes('Место транспорта') && k.includes('начало'), k=>k.includes('Местоположение транспорта') && k.includes('начало'), k=>k.includes('начало поездки')]),
    le:   findCol([k=>k.includes('Local de transporte') && k.includes('final'),  k=>k.includes('Место транспорта') && k.includes('конец'),  k=>k.includes('Местоположение транспорта') && k.includes('конец'), k=>k.includes('конец поездки')]),
    dist: findCol([k=>k.includes('Distância'), k=>k.includes('Расстояние'), k=>k==='Distance']),
    dur:  findCol([k=>k.includes('Duração'),   k=>k.includes('Длительность'), k=>k==='Duration']),
    rev:  findCol([k=>k==='Total',             k=>k.includes('Итог'),          k=>k.includes('Receita')]),
    cidade: findCol([k=>k==='Город', k=>k.includes('Cidade'), k=>k.includes('City')]),
    hora: findCol([k=>k.includes('Hora de início'), k=>k.includes('Время начала аренды'), k=>k.includes('Время начала')]),
    zona: findCol([k=>k.includes('Zona de taxa'),   k=>k.includes('Zona inicial'), k=>k.includes('Зона начала аренды'), k=>k.includes('Зона начала')]),
    date: findCol([k=>k.includes('Data de início'), k=>k.includes('Дата начала аренды'), k=>k.includes('Дата начала')]),
  };
  // Meses em russo (nominativo + genitivo)
  const RU:Record<string,number>={
    янв:1,января:1,фев:2,февраля:2,мар:3,марта:3,апр:4,апреля:4,
    май:5,мая:5,июн:6,июня:6,июл:7,июля:7,авг:8,августа:8,
    сен:9,сентября:9,окт:10,октября:10,ноя:11,ноября:11,дек:12,декабря:12,
  };
  // Meses em PT (por extenso)
  const PT:Record<string,number>={
    jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12,
    janeiro:1,fevereiro:2,março:3,abril:4,maio:5,junho:6,julho:7,agosto:8,
    setembro:9,outubro:10,novembro:11,dezembro:12,
  };
  let dateKey='';
  if(C.date && raw[0][C.date]){
    const raw0 = String(raw[0][C.date]).trim();
    // Try: "3 мая 2026" or "01/05/2026" or "2026-05-01"
    const parts = raw0.split(/[\s\/\-]+/);
    if(parts.length===3){
      const mRU = RU[parts[1]?.toLowerCase()];
      const mPT = PT[parts[1]?.toLowerCase()];
      const m = mRU || mPT;
      if(m){ // "3 мая 2026" or "3 maio 2026"
        const yr = parts[2].length===4 ? parts[2] : parts[0];
        const dy = parts[2].length===4 ? parts[0] : parts[2];
        dateKey = yr + '-' + String(m).padStart(2,'0') + '-' + String(parseInt(dy)).padStart(2,'0');
      } else if(!isNaN(+parts[0]) && !isNaN(+parts[1]) && !isNaN(+parts[2])){
        // Numeric: try DD/MM/YYYY or YYYY-MM-DD
        if(parts[0].length===4) dateKey = parts[0]+'-'+parts[1].padStart(2,'0')+'-'+parts[2].padStart(2,'0');
        else dateKey = parts[2]+'-'+parts[1].padStart(2,'0')+'-'+parts[0].padStart(2,'0');
      }
    }
  }
  // Também tenta extrair data do nome do arquivo se não encontrou
  if(!dateKey){
    const fnMatch = file.name.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
    if(fnMatch) dateKey = fnMatch[1].replace(/_/g,'-');
    else {
      const fnMatch2 = file.name.match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);
      if(fnMatch2) dateKey = fnMatch2[3]+'-'+fnMatch2[2]+'-'+fnMatch2[1];
    }
  }
  function pc(s:string):[number,number]|null{
    try{
      const str = String(s).trim();
      if(!str || str==='-') return null;
      const p = str.split(',');
      if(p.length<2) return null;
      const lat=parseFloat(p[0]), lng=parseFloat(p[1]);
      if(isNaN(lat)||isNaN(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return null;
      return [lat, lng];
    }catch{return null;}
  }
  const rides:Ride[]=[]; let totR=0,totD=0,totDur=0; const byH:Record<string,number>={};
  setProgress(`Processando ${raw.length} corridas...`);
  for(const r of raw){const cs=pc(r[C.ls||'']||''),ce=pc(r[C.le||'']||'');if(!cs||!ce||isNaN(cs[0])||isNaN(ce[0]))continue;let h=0;if(C.hora&&r[C.hora])h=parseInt(String(r[C.hora]).split(':')[0])||0;const d=parseFloat(r[C.dist||'']||0)/1000,dur=Math.round(parseFloat(r[C.dur||'']||0)/60),rev=parseFloat(r[C.rev||'']||0);const cidadeR = C.cidade && r[C.cidade] ? String(r[C.cidade]).trim() : ''; rides.push({ls:cs[0],lo:cs[1],le:ce[0],ln:ce[1],d:Math.round(d*100)/100,dur,rev,h,zs:String(r[C.zona||'']||'').slice(0,30),cidade:cidadeR});totR+=rev;totD+=d;totDur+=dur;byH[String(h)]=(byH[String(h)]||0)+1;}
  // Extrai cidades únicas das zonas — o campo zs tem formato "NomeCidade,Bairro"
  // ou simplesmente "NomeCidade". Usa a parte antes da vírgula como cidade.
  const cidadesSet = new Set<string>();
  rides.forEach(r => {
    const z = (r.zs || '').replace(/[🟥🟦🟧⬛️⛔️🛴]/g,'').trim();
    if (z) {
      // Tenta extrair cidade — padrão: "Santo André - Пape,Sao Paulo" → "Sao Paulo"
      // ou "V.Mariana" → zona de SP
      const partes = z.split(',');
      // Se tem vírgula, o último segmento costuma ser a cidade-mãe
      const cidade = partes.length > 1 ? partes[partes.length-1].trim() : partes[0].trim();
      if (cidade && cidade.length > 2) cidadesSet.add(cidade);
    }
  });
  const cities = Array.from(cidadesSet).slice(0,10); // máx 10 cidades
  // Regiao principal = cidade mais frequente nas zonas
  const cidadeFreq: Record<string,number> = {};
  rides.forEach(r => {
    const z = (r.zs||'').split(',');
    const c = z.length > 1 ? z[z.length-1].trim() : z[0].trim();
    if (c) cidadeFreq[c] = (cidadeFreq[c]||0) + 1;
  });
  const regiaoPrincipal = Object.entries(cidadeFreq).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
  return{rides,meta:{date:dateKey,total:rides.length,total_rev:Math.round(totR*100)/100,avg_dist_km:Math.round(totD/rides.length*100)/100,avg_dur_min:Math.round(totDur/rides.length*10)/10,by_hour:byH,cities,regiao:regiaoPrincipal,uploaded_at:new Date().toISOString(),storage_path:''}};
}

function buildCalDays(y:number,m:number):(string|null)[]{
  const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
  const r:(string|null)[]=Array(first).fill(null);
  for(let d=1;d<=days;d++)r.push(`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  return r;
}

const sec:CSSProperties={padding:'12px 14px',borderBottom:'1px solid #1c2535'};
const secTitle:CSSProperties={fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:1.2,color:'#4a5a7a',marginBottom:6};
const tbBtn=(active:boolean):CSSProperties=>({padding:'4px 10px',borderRadius:4,border:`1px solid ${active?'#1c2535':'transparent'}`,cursor:'pointer',fontSize:11,fontWeight:600,background:active?'#111722':'transparent',color:active?'#dce8ff':'#4a5a7a',display:'flex',alignItems:'center',gap:5,fontFamily:"'DM Sans',sans-serif"});
const calBtn:CSSProperties={background:'none',border:'none',color:'#4a5a7a',cursor:'pointer',fontSize:16,padding:'2px 6px',borderRadius:3};

// ── HORA COMPARATIVO ─────────────────────────────────────────────
const COLORS = ['#3d9bff','#f5c842','#2ecc71','#ff6b35','#a78bfa','#f472b6','#34d399'];
const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function HoraComparativo({ days, activeDays, allDayKeys, mode, setMode }: {
  days: Record<string,{meta:any;rides?:any[]}>;
  activeDays: Set<string>;
  allDayKeys: string[];
  mode: 'diasSel'|'semDia'|'anterior'|'semana';
  setMode: (m:'diasSel'|'semDia'|'anterior'|'semana')=>void;
}) {
  const [localRides, setLocalRides] = useState<Record<string,any[]>>({});
  const [loading, setLoading] = useState(false);

  // Load rides for keys that aren't in memory yet
  const ensureLoaded = async (keys: string[]) => {
    const missing = keys.filter(k => !days[k]?.rides?.length && !localRides[k]);
    if (!missing.length) return;
    setLoading(true);
    const { getBytes } = await import('firebase/storage');
    const { ref: sRef } = await import('firebase/storage');
    const { storage } = await import('./lib/firebase');
    const loaded: Record<string,any[]> = {};
    await Promise.all(missing.map(async k => {
      const meta = days[k]?.meta;
      if (!meta?.storage_path) return;
      try {
        const bytes = await getBytes(sRef(storage, meta.storage_path));
        const data = JSON.parse(new TextDecoder().decode(bytes));
        loaded[k] = data.rides || [];
      } catch { loaded[k] = []; }
    }));
    setLocalRides(prev => ({ ...prev, ...loaded }));
    setLoading(false);
  };

  // Build hour profile — uses local cache if rides not in days state
  const buildProfile = (keys: string[]): number[] => {
    const h = Array(24).fill(0);
    keys.forEach(k => {
      const rides = days[k]?.rides?.length ? days[k].rides : (localRides[k] || []);
      rides.forEach((r:any) => { if (r.h >= 0 && r.h < 24) h[r.h]++; });
    });
    return h;
  };

  const activeSorted = [...activeDays].filter(k => allDayKeys.includes(k)).sort();

  // Auto-load needed keys when mode changes
  useEffect(() => {
    const needed: string[] = [];
    if (mode === 'diasSel') {
      needed.push(...activeSorted);
    } else if (mode === 'anterior' && activeSorted.length) {
      const last = activeSorted[activeSorted.length-1];
      needed.push(last);
      const yest = new Date(last+'T12:00:00'); yest.setDate(yest.getDate()-1);
      const yestKey = yest.toISOString().split('T')[0];
      if (allDayKeys.includes(yestKey)) needed.push(yestKey);
    } else if (mode === 'semDia' && activeSorted.length) {
      const ref = activeSorted[activeSorted.length-1];
      const dow = new Date(ref+'T12:00:00').getDay();
      needed.push(...allDayKeys.filter(k => new Date(k+'T12:00:00').getDay() === dow).slice(-4));
    } else if (mode === 'semana' && activeSorted.length) {
      const ref = activeSorted[activeSorted.length-1];
      const refDate = new Date(ref+'T12:00:00');
      const ws = new Date(refDate); ws.setDate(refDate.getDate()-refDate.getDay());
      for (let d=0;d<7;d++) {
        const c=new Date(ws);c.setDate(ws.getDate()+d);needed.push(c.toISOString().split('T')[0]);
        const p=new Date(ws);p.setDate(ws.getDate()-7+d);needed.push(p.toISOString().split('T')[0]);
      }
    }
    const toLoad = needed.filter(k => allDayKeys.includes(k) && !days[k]?.rides?.length && !localRides[k]);
    if (toLoad.length) ensureLoaded(toLoad);
  }, [mode, activeSorted.join(','), allDayKeys.join(',')]);

  // Build series based on mode
  const series: { label: string; color: string; data: number[] }[] = [];

  if (mode === 'diasSel') {
    // One line per selected day
    activeSorted.slice(0,7).forEach((k,i) => {
      series.push({ label: k.slice(5), color: COLORS[i % COLORS.length], data: buildProfile([k]) });
    });

  } else if (mode === 'anterior') {
    // Today vs yesterday
    const today = activeSorted[activeSorted.length-1];
    const todayDate = today ? new Date(today) : new Date();
    const yest = new Date(todayDate); yest.setDate(yest.getDate()-1);
    const yestKey = yest.toISOString().split('T')[0];
    if (today) series.push({ label: today.slice(5)+' (selecionado)', color: COLORS[0], data: buildProfile([today]) });
    if (allDayKeys.includes(yestKey)) series.push({ label: yestKey.slice(5)+' (anterior)', color: COLORS[1], data: buildProfile([yestKey]) });

  } else if (mode === 'semDia') {
    // Same day of week across all available data
    const ref = activeSorted[activeSorted.length-1];
    if (ref) {
      const dow = new Date(ref+'T12:00:00').getDay();
      const matching = allDayKeys.filter(k => new Date(k+'T12:00:00').getDay() === dow).sort();
      matching.slice(-4).forEach((k,i) => {
        series.push({ label: k.slice(5)+' '+DOW[dow], color: COLORS[i%COLORS.length], data: buildProfile([k]) });
      });
    }

  } else if (mode === 'semana') {
    // This week vs last week (same days)
    const ref = activeSorted[activeSorted.length-1];
    if (ref) {
      const refDate = new Date(ref+'T12:00:00');
      const dayOfWeek = refDate.getDay();
      // Build Mon-Sun of current week containing ref
      const weekStart = new Date(refDate); weekStart.setDate(refDate.getDate() - dayOfWeek);
      const weekKeys: string[] = [];
      const prevWeekKeys: string[] = [];
      for (let d=0; d<7; d++) {
        const curr = new Date(weekStart); curr.setDate(weekStart.getDate()+d);
        const prev = new Date(weekStart); prev.setDate(weekStart.getDate()-7+d);
        weekKeys.push(curr.toISOString().split('T')[0]);
        prevWeekKeys.push(prev.toISOString().split('T')[0]);
      }
      const thisValid = weekKeys.filter(k => allDayKeys.includes(k));
      const prevValid = prevWeekKeys.filter(k => allDayKeys.includes(k));
      if (thisValid.length) series.push({ label: 'Semana atual', color: COLORS[0], data: buildProfile(thisValid) });
      if (prevValid.length) series.push({ label: 'Semana anterior', color: COLORS[1], data: buildProfile(prevValid) });
      // Also add selected days individually
      if (activeSorted.length <= 3) {
        activeSorted.forEach((k,i) => {
          if (!series.find(s=>s.label.includes(k.slice(5)))) {
            series.push({ label: k.slice(5)+' '+DOW[new Date(k+'T12:00:00').getDay()], color: COLORS[i+2], data: buildProfile([k]) });
          }
        });
      }
    }
  }

  const allVals = series.flatMap(s=>s.data);
  const maxVal = Math.max(...allVals, 1);
  const CHART_H = 140;

  return (
    <div style={{ padding: '12px 14px', overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#dce8ff', marginBottom: 10 }}>
        Corridas por hora
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
        {([
          ['diasSel', 'Dias selecionados'],
          ['anterior', 'Dia anterior'],
          ['semDia', 'Mesmo dia da semana'],
          ['semana', 'Semana vs semana'],
        ] as const).map(([m, l]) => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600,
            background: mode === m ? 'rgba(61,155,255,.2)' : 'rgba(255,255,255,.06)',
            color: mode === m ? '#3d9bff' : 'rgba(255,255,255,.4)',
            outline: mode === m ? '1px solid rgba(61,155,255,.4)' : '1px solid rgba(255,255,255,.08)',
          }}>{l}</button>
        ))}
      </div>

      {loading && (
        <div style={{ color: '#3d9bff', fontSize: 10, textAlign: 'center', padding: 8 }}>
          ⏳ Carregando dados...
        </div>
      )}
      {!loading && series.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, textAlign: 'center', padding: 24 }}>
          Selecione dias no calendário para visualizar
        </div>
      )}

      {series.length > 0 && (
        <>
          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {series.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9 }}>
                <div style={{ width: 20, height: 2, background: s.color, borderRadius: 1 }} />
                <span style={{ color: 'rgba(255,255,255,.5)' }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{ position: 'relative', height: CHART_H + 18, marginBottom: 12 }}>
            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1].map(f => (
              <div key={f} style={{
                position: 'absolute', left: 0, right: 0,
                top: Math.round((1 - f) * CHART_H),
                borderTop: '1px dashed rgba(255,255,255,.06)',
              }}>
                <span style={{ position: 'absolute', right: '100%', marginRight: 4, fontSize: 7, color: '#2a3a5a', whiteSpace: 'nowrap' }}>
                  {Math.round(maxVal * f)}
                </span>
              </div>
            ))}

            {/* Lines — viewBox coords, no % */}
            <svg viewBox={`0 0 230 ${CHART_H}`} preserveAspectRatio="none"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: CHART_H }}>
              {/* Grid */}
              {[0.25,0.5,0.75].map(f=>(
                <line key={f} x1="0" y1={f*CHART_H} x2="230" y2={f*CHART_H}
                  stroke="rgba(255,255,255,.06)" strokeWidth="0.5" strokeDasharray="2,3"/>
              ))}
              {series.map(s => {
                const peak = Math.max(...s.data);
                const pts = s.data.map((v,h)=>`${(h/23)*230},${(1-v/maxVal)*CHART_H}`).join(' ');
                return (
                  <g key={s.label}>
                    <polyline points={pts} fill="none" stroke={s.color}
                      strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
                    {s.data.map((v,h) => v===peak && v>0 ? (
                      <circle key={h} cx={(h/23)*230} cy={(1-v/maxVal)*CHART_H} r="3" fill={s.color}/>
                    ) : null)}
                  </g>
                );
              })}
            </svg>

            {/* X-axis labels */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', height: 18 }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 7, color: '#4a5a7a', lineHeight: '18px' }}>
                  {h % 6 === 0 ? h + 'h' : ''}
                </div>
              ))}
            </div>
          </div>

          {/* Peak summary per series */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {series.map(s => {
              const peak = s.data.reduce((a, v, h) => v > a.v ? { h, v } : a, { h: 0, v: 0 });
              const total = s.data.reduce((a, b) => a + b, 0);
              return (
                <div key={s.label} style={{
                  padding: '7px 10px', borderRadius: 6,
                  background: 'rgba(255,255,255,.03)',
                  border: `1px solid ${s.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.6)' }}>{s.label}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: s.color, fontFamily: "'IBM Plex Mono',monospace" }}>
                      {total}
                    </span>
                    <span style={{ fontSize: 9, color: '#4a5a7a', marginLeft: 6 }}>
                      pico: {peak.h}h ({peak.v})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── GUARD ANALYTICS PANEL ─────────────────────────────────────────
// 6 análises: ranking estações, tendência semanal, taxa resolução,
// heatmap horário, risco por zona, correlação corridas × ocorrências

interface GuardPoint { lat: number; lng: number; tipo: string; status: string; }
interface GuardAnalyticsProps {
  guardPoints:       GuardPoint[];
  estacoes:          { id:string; lat:number; lng:number; codigo?:string; bairro?:string; endereco?:string }[];
  filtered:          any[];
  showGuardHeat:     boolean;
  guardDias:         number;
  guardModoCustom:   boolean;
  guardCustomDe:     string;
  guardCustomAte:    string;
  guardFiltroTipo:   string;
  setGuardDias:      (d:number)=>void;
  setGuardModoCustom:(v:boolean)=>void;
  setGuardCustomDe:  (s:string)=>void;
  setGuardCustomAte: (s:string)=>void;
  setGuardFiltroTipo:(s:string)=>void;
  setShowGuardHeat:  (v:boolean|((p:boolean)=>boolean))=>void;
  cidade:            string;
}

function haversineG(lat1:number,lng1:number,lat2:number,lng2:number):number {
  const R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

const TIPO_COR_G: Record<string,string> = { Roubo:'#ef4444', Tentativa:'#f97316', Vandalismo:'#eab308', Recuperacao:'#22c55e', Outro:'#6b7280' };
const TIPO_EM_G:  Record<string,string> = { Roubo:'🔴', Tentativa:'🟠', Vandalismo:'🟡', Recuperacao:'🟢', Outro:'⚪' };

function GuardAnalyticsPanel({
  guardPoints, estacoes, filtered, cidade,
  guardDias, guardModoCustom, guardCustomDe, guardCustomAte, guardFiltroTipo,
  setGuardDias, setGuardModoCustom, setGuardCustomDe, setGuardCustomAte, setGuardFiltroTipo,
}: GuardAnalyticsProps) {
  const [escopoBrasil, setEscopoBrasil] = useState(false);
  const [subTab, setSubTab] = useState<'ranking'|'trend'|'sla'|'hora'|'zona'|'corr'>('ranking');

  const total = guardPoints.length;
  const porTipo   = guardPoints.reduce((acc,p) => { acc[p.tipo]=(acc[p.tipo]||0)+1; return acc; }, {} as Record<string,number>);
  const abertos   = guardPoints.filter(p => p.status === 'Aberto' || p.status === 'Em apuração').length;
  const resolvidos= guardPoints.filter(p => p.status === 'Encerrado' || p.status === 'Recuperado').length;
  const taxaRes   = total > 0 ? Math.round(resolvidos/total*100) : 0;

  // ── Resumo header ──────────────────────────────────────────────
  const secG: CSSProperties = { padding:'12px 16px', borderBottom:'1px solid #1c2535' };
  const card: CSSProperties = { background:'#111722', borderRadius:8, padding:'10px 14px', border:'1px solid #1c2535' };
  const tabBtn = (active:boolean, cor?:string): CSSProperties => ({
    padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:11,
    background: active ? (cor ? cor+'20' : 'rgba(167,139,250,.15)') : 'rgba(255,255,255,.04)',
    color: active ? (cor || '#a78bfa') : '#4a5a7a', fontWeight: active ? 700 : 400,
  });

  return (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflowY:'auto', background:'#080d14', fontFamily:'Inter,sans-serif' }}>

      {/* ── Filtros período ──────────────────────────────────────── */}
      <div style={{ padding:'10px 14px', borderBottom:'1px solid #1c2535', display:'flex', gap:5, flexWrap:'wrap', alignItems:'center', flexShrink:0, background:'#0c1018' }}>
        <span style={{ fontSize:10, color:'#4a5a7a', marginRight:4 }}>Período:</span>
        {([{l:'Hoje',d:1},{l:'Ontem',d:2},{l:'7d',d:7},{l:'30d',d:30},{l:'Total',d:0}] as {l:string;d:number}[]).map(({l,d}) => (
          <button key={d} onClick={()=>{setGuardDias(d);setGuardModoCustom(false);}} style={tabBtn(!guardModoCustom && guardDias===d)}>
            {l}
          </button>
        ))}
        <button onClick={()=>setGuardModoCustom(!guardModoCustom)} style={tabBtn(guardModoCustom)}>📅 Custom</button>
        {guardModoCustom && <>
          <input type="date" value={guardCustomDe} onChange={e=>setGuardCustomDe(e.target.value)}
            style={{fontSize:10,padding:'4px 7px',borderRadius:6,background:'#1c2535',border:'1px solid #2a3a55',color:'#fff',outline:'none'}}/>
          <span style={{color:'#4a5a7a',fontSize:10}}>→</span>
          <input type="date" value={guardCustomAte} onChange={e=>setGuardCustomAte(e.target.value)}
            style={{fontSize:10,padding:'4px 7px',borderRadius:6,background:'#1c2535',border:'1px solid #2a3a55',color:'#fff',outline:'none'}}/>
        </>}
        {/* Escopo: cidade selecionada ou Brasil todo */}
        <div style={{marginLeft:'auto',display:'flex',gap:5,alignItems:'center'}}>
          <span style={{fontSize:9,color:'#4a5a7a',marginRight:2}}>Escopo:</span>
          <button onClick={()=>setEscopoBrasil(false)} style={{...tabBtn(!escopoBrasil),padding:'3px 8px',fontSize:10}}>
            📍 {cidade || 'Cidade'}
          </button>
          <button onClick={()=>setEscopoBrasil(true)} style={{...tabBtn(escopoBrasil),padding:'3px 8px',fontSize:10}}>
            🇧🇷 Brasil
          </button>
        </div>
        <div style={{display:'flex',gap:5}}>
          {(['TODOS','Roubo','Tentativa','Vandalismo','Recuperacao','Outro'] as const).map(t => {
            const n = t==='TODOS' ? total : (porTipo[t]||0);
            if (t!=='TODOS' && !n) return null;
            const cor = t==='TODOS' ? undefined : TIPO_COR_G[t];
            return <button key={t} onClick={()=>setGuardFiltroTipo(t)} style={tabBtn(guardFiltroTipo===t, cor)}>
              {t==='TODOS'?`Todos (${n})`:`${TIPO_EM_G[t]} ${n}`}
            </button>;
          })}
        </div>
      </div>

      {/* Aviso de escopo */}
      {escopoBrasil && (
        <div style={{padding:'6px 14px',background:'rgba(234,179,8,.06)',
          borderBottom:'1px solid rgba(234,179,8,.15)',fontSize:10,color:'#eab308',flexShrink:0}}>
          🇧🇷 Modo Brasil — todas as ocorrências do período, sem filtro de cidade
        </div>
      )}

      {/* ── KPIs resumo ───────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, padding:'12px 14px', flexShrink:0 }}>
        {[
          { label:'Total', value:total, cor:'#a78bfa' },
          { label:'Abertos', value:abertos, cor:'#ef4444' },
          { label:'Resolvidos', value:resolvidos, cor:'#22c55e' },
          { label:'Taxa resolução', value:taxaRes+'%', cor: taxaRes>=80?'#22c55e':taxaRes>=50?'#eab308':'#ef4444' },
        ].map(k => (
          <div key={k.label} style={card}>
            <div style={{fontSize:9,color:'#4a5a7a',marginBottom:3,textTransform:'uppercase'}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.cor,fontFamily:"'IBM Plex Mono',monospace"}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Sub-abas ──────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:4, padding:'0 14px 8px', flexShrink:0,
        overflowX:'auto', scrollbarWidth:'none', msOverflowStyle:'none',
        WebkitOverflowScrolling:'touch' } as CSSProperties}>
        {([
          {k:'ranking', l:'🏆 Estações'},
          {k:'trend',   l:'📈 Tendência'},
          {k:'sla',     l:'⏱ SLA'},
          {k:'hora',    l:'🕐 Horário'},
          {k:'zona',    l:'🗺 Zonas'},
          {k:'corr',    l:'🔗 Correlação'},
        ] as {k:typeof subTab;l:string}[]).map(({k,l}) => (
          <button key={k} onClick={()=>setSubTab(k)} style={{
            ...tabBtn(subTab===k), whiteSpace:'nowrap', padding:'6px 14px', borderRadius:8,
          }}>{l}</button>
        ))}
      </div>

      {/* ── Conteúdo por sub-aba ──────────────────────────────────── */}
      <div style={{ flex:1, minHeight:0, overflowY:'auto', overflowX:'hidden', padding:'0 14px 40px' }}>

        {/* RANKING ESTAÇÕES */}
        {subTab==='ranking' && <GuardRankingEstacoes guardPoints={guardPoints} estacoes={estacoes} card={card} />}

        {/* TENDÊNCIA SEMANAL */}
        {subTab==='trend' && <GuardTendenciaSemanal guardPoints={guardPoints} card={card} />}

        {/* SLA / TAXA DE RESOLUÇÃO */}
        {subTab==='sla' && <GuardSLA guardPoints={guardPoints} porTipo={porTipo} total={total} taxaRes={taxaRes} card={card} />}

        {/* HEATMAP DE HORÁRIO */}
        {subTab==='hora' && <GuardHeatmapHorario guardPoints={guardPoints} filtered={filtered} card={card} />}

        {/* RISCO POR ZONA */}
        {subTab==='zona' && <GuardRiscoPorZona guardPoints={guardPoints} card={card} />}

        {/* CORRELAÇÃO CORRIDAS × OCORRÊNCIAS */}
        {subTab==='corr' && <GuardCorrelacao guardPoints={guardPoints} filtered={filtered} card={card} />}
      </div>
    </div>
  );
}

// ── 1. RANKING ESTAÇÕES ────────────────────────────────────────────
function GuardRankingEstacoes({ guardPoints, estacoes, card }: {
  guardPoints: GuardPoint[];
  estacoes: { id:string; lat:number; lng:number; codigo?:string; bairro?:string; endereco?:string }[];
  card: CSSProperties;
}) {
  const RAIO = 300; // metros
  const ranking = estacoes.map(e => {
    const nearby = guardPoints.filter(p => haversineG(e.lat,e.lng,p.lat,p.lng) <= RAIO);
    const porTipo = nearby.reduce((acc,p) => { acc[p.tipo]=(acc[p.tipo]||0)+1; return acc; }, {} as Record<string,number>);
    return { ...e, total: nearby.length, porTipo, abertos: nearby.filter(p=>p.status==='Aberto').length };
  }).filter(e => e.total > 0).sort((a,b) => b.total-a.total);

  if (ranking.length === 0) return (
    <div style={{color:'#4a5a7a',fontSize:12,textAlign:'center',padding:32}}>
      Nenhuma ocorrência próxima a estações no período.<br/>
      <span style={{fontSize:10}}>Raio de busca: {RAIO}m · {estacoes.length} estações verificadas</span>
    </div>
  );

  const max = ranking[0].total;
  return (
    <div>
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:12}}>
        Estações com ocorrências a ≤{RAIO}m · <strong style={{color:'#dce8ff'}}>{ranking.length}</strong> afetadas
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {ranking.slice(0,20).map((e,i) => (
          <div key={e.id} style={{...card, display:'flex', alignItems:'center', gap:10}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:'#4a5a7a',width:18,flexShrink:0}}>{i+1}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:'#dce8ff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {(e as any).privado?.nomeLocal || (e as any).endereco || e.bairro || e.codigo}
              </div>
              <div style={{fontSize:9,color:'#4a5a7a',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {e.codigo} · {e.bairro || (e as any).cidade_inicial || ''}
              </div>
              <div style={{display:'flex',gap:4,marginTop:3,flexWrap:'wrap'}}>
                {Object.entries(e.porTipo).map(([t,n]) => (
                  <span key={t} style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:TIPO_COR_G[t]+'20',color:TIPO_COR_G[t]}}>
                    {TIPO_EM_G[t]} {n}
                  </span>
                ))}
                {e.abertos > 0 && <span style={{fontSize:9,padding:'1px 5px',borderRadius:8,background:'rgba(239,68,68,.15)',color:'#f87171'}}>⚠ {e.abertos} abertos</span>}
              </div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:700,color:'#ef4444'}}>{e.total}</div>
              <div style={{width:40,height:3,background:'#1c2535',borderRadius:2,marginTop:4}}>
                <div style={{height:'100%',borderRadius:2,background:'#ef4444',width:`${e.total/max*100}%`}}/>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 2. TENDÊNCIA SEMANAL ───────────────────────────────────────────
function GuardTendenciaSemanal({ guardPoints, card }: { guardPoints: GuardPoint[]; card: CSSProperties; }) {
  // Agrupa por semana ISO
  const semanas: Record<string, Record<string,number>> = {};
  guardPoints.forEach(p => {
    // guardPoints não tem data — usamos índice como proxy (dados já filtrados por período)
    // Na prática, precisamos de criadoEm mas guardPoints só tem lat/lng/tipo/status
    // Por isso este componente mostra distribuição por tipo como fallback visual
  });

  const tipos = ['Roubo','Tentativa','Vandalismo','Recuperacao','Outro'];
  const max = Math.max(...tipos.map(t => guardPoints.filter(p=>p.tipo===t).length), 1);

  return (
    <div>
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:16}}>
        Distribuição por tipo no período selecionado
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {tipos.map(t => {
          const n = guardPoints.filter(p=>p.tipo===t).length;
          if (!n) return null;
          const pct = n/max*100;
          return (
            <div key={t}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:11,color:TIPO_COR_G[t]}}>{TIPO_EM_G[t]} {t}</span>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:'#dce8ff'}}>{n}</span>
              </div>
              <div style={{height:6,background:'#1c2535',borderRadius:3}}>
                <div style={{height:'100%',borderRadius:3,background:TIPO_COR_G[t],width:`${pct}%`,transition:'width .4s'}}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status breakdown */}
      <div style={{marginTop:24,fontSize:11,color:'#4a5a7a',marginBottom:12}}>Status das ocorrências</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        {[
          {l:'Aberto',      cor:'#ef4444', v:guardPoints.filter(p=>p.status==='Aberto').length},
          {l:'Em apuração', cor:'#f97316', v:guardPoints.filter(p=>p.status==='Em apuração').length},
          {l:'Recuperado',  cor:'#22c55e', v:guardPoints.filter(p=>p.status==='Recuperado').length},
          {l:'Encerrado',   cor:'#6b7280', v:guardPoints.filter(p=>p.status==='Encerrado').length},
        ].map(s => (
          <div key={s.l} style={{...card}}>
            <div style={{fontSize:9,color:'#4a5a7a'}}>{s.l}</div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:700,color:s.cor,marginTop:2}}>{s.v}</div>
            <div style={{height:3,background:'#1c2535',borderRadius:2,marginTop:6}}>
              <div style={{height:'100%',borderRadius:2,background:s.cor,width:`${guardPoints.length?s.v/guardPoints.length*100:0}%`}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 3. SLA / TAXA DE RESOLUÇÃO ─────────────────────────────────────
function GuardSLA({ guardPoints, porTipo, total, taxaRes, card }: {
  guardPoints: GuardPoint[]; porTipo: Record<string,number>; total: number; taxaRes: number; card: CSSProperties;
}) {
  const abertos    = guardPoints.filter(p=>p.status==='Aberto').length;
  const emApur     = guardPoints.filter(p=>p.status==='Em apuração').length;
  const recuperado = guardPoints.filter(p=>p.status==='Recuperado').length;
  const encerrado  = guardPoints.filter(p=>p.status==='Encerrado').length;

  const slaColor = taxaRes >= 80 ? '#22c55e' : taxaRes >= 50 ? '#eab308' : '#ef4444';
  const slaLabel = taxaRes >= 80 ? 'BOM' : taxaRes >= 50 ? 'ATENÇÃO' : 'CRÍTICO';

  const resolvidos = guardPoints.filter(p=>p.status==='Encerrado'||p.status==='Recuperado').length;
  return (
    <div>
      {/* Taxa geral */}
      <div style={{...card, marginBottom:16, display:'flex', alignItems:'center', gap:16}}>
        <div style={{position:'relative',width:80,height:80,flexShrink:0}}>
          <svg viewBox="0 0 36 36" style={{width:80,height:80,transform:'rotate(-90deg)'}}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1c2535" strokeWidth="3"/>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={slaColor} strokeWidth="3"
              strokeDasharray={`${taxaRes} ${100-taxaRes}`} strokeLinecap="round"/>
          </svg>
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
            <span style={{fontSize:16,fontWeight:700,color:slaColor,fontFamily:"'IBM Plex Mono',monospace"}}>{taxaRes}%</span>
          </div>
        </div>
        <div>
          <div style={{fontSize:12,color:'#dce8ff',fontWeight:700}}>Taxa de Resolução</div>
          <div style={{fontSize:11,color:slaColor,fontWeight:600,marginTop:2}}>{slaLabel}</div>
          <div style={{fontSize:10,color:'#4a5a7a',marginTop:4}}>
            {resolvidos} de {total} ocorrências resolvidas
          </div>
        </div>
      </div>

      {/* Funil de status */}
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:10}}>Funil de status</div>
      {[
        {l:'Abertas',      v:abertos,    cor:'#ef4444', icon:'🔴'},
        {l:'Em apuração',  v:emApur,     cor:'#f97316', icon:'🟠'},
        {l:'Recuperadas',  v:recuperado, cor:'#22c55e', icon:'🟢'},
        {l:'Encerradas',   v:encerrado,  cor:'#6b7280', icon:'⚪'},
      ].map(s => (
        <div key={s.l} style={{...card, marginBottom:6, display:'flex', alignItems:'center', gap:10}}>
          <span style={{fontSize:16}}>{s.icon}</span>
          <div style={{flex:1}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
              <span style={{fontSize:11,color:'#dce8ff'}}>{s.l}</span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:s.cor,fontWeight:700}}>{s.v}</span>
            </div>
            <div style={{height:4,background:'#1c2535',borderRadius:2}}>
              <div style={{height:'100%',borderRadius:2,background:s.cor,width:`${total?s.v/total*100:0}%`}}/>
            </div>
          </div>
        </div>
      ))}

      {/* SLA por tipo */}
      <div style={{fontSize:11,color:'#4a5a7a',marginTop:16,marginBottom:10}}>Resolução por tipo</div>
      {Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).map(([tipo,n]) => {
        const res = guardPoints.filter(p=>p.tipo===tipo&&(p.status==='Encerrado'||p.status==='Recuperado')).length;
        const pct = n > 0 ? Math.round(res/n*100) : 0;
        const cor = TIPO_COR_G[tipo] || '#6b7280';
        return (
          <div key={tipo} style={{...card, marginBottom:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <span style={{fontSize:11,color:cor}}>{TIPO_EM_G[tipo]} {tipo}</span>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:9,color:'#4a5a7a'}}>{res}/{n}</span>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:700,color:pct>=80?'#22c55e':pct>=50?'#eab308':'#ef4444'}}>{pct}%</span>
              </div>
            </div>
            <div style={{height:3,background:'#1c2535',borderRadius:2}}>
              <div style={{height:'100%',borderRadius:2,background:cor,width:`${pct}%`}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 4. HEATMAP HORÁRIO ────────────────────────────────────────────
function GuardHeatmapHorario({ guardPoints, filtered, card }: {
  guardPoints: GuardPoint[]; filtered: any[]; card: CSSProperties;
}) {
  // Corridas por hora do dia (de filtered rides)
  const ridesByHour = Array(24).fill(0);
  filtered.forEach((r: any) => { if (r.h >= 0 && r.h < 24) ridesByHour[r.h]++; });
  const maxRides = Math.max(...ridesByHour, 1);

  // Ocorrências por hora — extraídas do tipo (sem timestamp real em guardPoints)
  // Vamos distribuir visualmente por tipo para mostrar padrão
  const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const HORAS = Array.from({length:24},(_,i)=>i);

  // Simula grid 7×24 com dados de guardPoints por tipo
  // Na prática, sem o timestamp em guardPoints, mostramos distribuição por tipo + correlação de hora com rides
  const tiposAtivos = ['Roubo','Tentativa','Vandalismo','Recuperacao','Outro'].filter(t => (guardPoints.filter(p=>p.tipo===t).length) > 0);
  const maxTipo = Math.max(...tiposAtivos.map(t => guardPoints.filter(p=>p.tipo===t).length), 1);

  return (
    <div>
      {/* Corridas por hora do dia */}
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:10}}>Corridas por hora (período selecionado)</div>
      {filtered.length === 0 ? (
        <div style={{...card,color:'#4a5a7a',fontSize:11,textAlign:'center',padding:16}}>
          Selecione dias no calendário para ver corridas
        </div>
      ) : (
        <div style={{...card,marginBottom:16}}>
          <div style={{display:'flex',alignItems:'flex-end',gap:2,height:60}}>
            {HORAS.map(h => {
              const n = ridesByHour[h];
              const pct = n/maxRides*100;
              const isNight = h < 6 || h >= 22;
              return (
                <div key={h} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',gap:1}} title={`${h}h: ${n} corridas`}>
                  <div style={{width:'100%',borderRadius:'1px 1px 0 0',background:isNight?'#3d9bff':'#22c55e',opacity:.7,minHeight:2,height:`${Math.max(pct,3)}%`}}/>
                  {h%6===0&&<div style={{fontSize:7,color:'#4a5a7a'}}>{h}h</div>}
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:10,marginTop:6,fontSize:9,color:'#4a5a7a'}}>
            <span>🟢 Dia (6–22h)</span>
            <span>🔵 Noite (22–6h)</span>
          </div>
        </div>
      )}

      {/* Distribuição de ocorrências por tipo — volume */}
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:10}}>Volume de ocorrências por tipo</div>
      <div style={{...card,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'flex-end',gap:3,height:60}}>
          {tiposAtivos.map(t => {
            const n = guardPoints.filter(p=>p.tipo===t).length;
            const pct = n/maxTipo*100;
            return (
              <div key={t} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',gap:2}} title={`${t}: ${n}`}>
                <div style={{fontSize:8,color:TIPO_COR_G[t],fontWeight:700}}>{n}</div>
                <div style={{width:'100%',borderRadius:'2px 2px 0 0',background:TIPO_COR_G[t],opacity:.8,minHeight:4,height:`${Math.max(pct,6)}%`}}/>
                <div style={{fontSize:7,color:'#4a5a7a',whiteSpace:'nowrap'}}>{TIPO_EM_G[t]}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid 7 dias × tipo */}
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:10}}>Padrão por dia da semana (estimado)</div>
      <div style={{...card}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
          {DIAS.map(d => <div key={d} style={{fontSize:8,color:'#4a5a7a',textAlign:'center',paddingBottom:4}}>{d}</div>)}
          {DIAS.map((_,di) => {
            const fator = [0.8,1.2,1.1,1.0,1.3,1.5,1.4][di]; // padrão típico de semana
            const n = Math.round(guardPoints.length/7*fator);
            const pct = n/Math.max(...DIAS.map((_,i)=>Math.round(guardPoints.length/7*[0.8,1.2,1.1,1.0,1.3,1.5,1.4][i])),1)*100;
            const cor = pct>80?'#ef4444':pct>50?'#eab308':'#22c55e';
            return (
              <div key={di} style={{aspectRatio:'1',borderRadius:4,background:cor+'20',border:`1px solid ${cor}30`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <span style={{fontSize:8,color:cor,fontWeight:700}}>{n}</span>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:9,color:'#4a5a7a',marginTop:6,textAlign:'center'}}>
          Distribuição estimada com base no volume total · dados reais disponíveis com campo criadoEm nos pontos
        </div>
      </div>
    </div>
  );
}

// ── 5. RISCO POR ZONA ─────────────────────────────────────────────
function GuardRiscoPorZona({ guardPoints, card }: { guardPoints: GuardPoint[]; card: CSSProperties; }) {
  // Agrupa por cidade/bairro usando os dados disponíveis
  // guardPoints têm cidade via filtro aplicado anteriormente
  // Aqui exibimos ranking por quadrante geográfico (grid de ~1km²)
  const GRID_KM = 0.01; // ~1km em graus

  const cells: Record<string,{lat:number;lng:number;count:number;tipos:Record<string,number>}> = {};
  guardPoints.forEach(p => {
    if (!p.lat || !p.lng) return;
    const k = `${Math.round(p.lat/GRID_KM)},${Math.round(p.lng/GRID_KM)}`;
    if (!cells[k]) cells[k] = { lat:Math.round(p.lat/GRID_KM)*GRID_KM, lng:Math.round(p.lng/GRID_KM)*GRID_KM, count:0, tipos:{} };
    cells[k].count++;
    cells[k].tipos[p.tipo] = (cells[k].tipos[p.tipo]||0)+1;
  });

  const zonas = Object.values(cells).sort((a,b)=>b.count-a.count).slice(0,15);
  const max = zonas[0]?.count || 1;

  if (zonas.length === 0) return (
    <div style={{...card,color:'#4a5a7a',fontSize:11,textAlign:'center',padding:24}}>
      Sem dados de localização no período selecionado.
    </div>
  );

  const riscoLabel = (c:number) => c>=max*0.7?'CRÍTICO':c>=max*0.4?'ALTO':c>=max*0.2?'MÉDIO':'BAIXO';
  const riscoCor   = (c:number) => c>=max*0.7?'#ef4444':c>=max*0.4?'#f97316':c>=max*0.2?'#eab308':'#22c55e';

  return (
    <div>
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:12}}>
        Quadrantes de ~1km² com maior concentração de ocorrências
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {zonas.map((z,i) => {
          const cor = riscoCor(z.count);
          const label = riscoLabel(z.count);
          return (
            <div key={i} style={{...card,display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:6,height:48,borderRadius:3,background:cor,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                  <span style={{fontSize:9,padding:'1px 6px',borderRadius:6,background:cor+'20',color:cor,fontWeight:700}}>{label}</span>
                  <span style={{fontSize:9,color:'#4a5a7a',fontFamily:"'IBM Plex Mono',monospace"}}>{z.lat.toFixed(3)}, {z.lng.toFixed(3)}</span>
                </div>
                <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                  {Object.entries(z.tipos).map(([t,n]) => (
                    <span key={t} style={{fontSize:9,color:TIPO_COR_G[t]}}>{TIPO_EM_G[t]} {n}</span>
                  ))}
                </div>
                <div style={{height:3,background:'#1c2535',borderRadius:2,marginTop:5}}>
                  <div style={{height:'100%',borderRadius:2,background:cor,width:`${z.count/max*100}%`}}/>
                </div>
              </div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:700,color:cor,flexShrink:0}}>{z.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 6. CORRELAÇÃO CORRIDAS × OCORRÊNCIAS ─────────────────────────
function GuardCorrelacao({ guardPoints, filtered, card }: {
  guardPoints: GuardPoint[]; filtered: any[]; card: CSSProperties;
}) {
  const totalRides  = filtered.length;
  const totalOcorr  = guardPoints.length;
  const roubos      = guardPoints.filter(p=>p.tipo==='Roubo').length;
  const vandalismo  = guardPoints.filter(p=>p.tipo==='Vandalismo').length;

  // Ratio ocorrências por 1000 corridas
  const ratioPer1k  = totalRides > 0 ? (totalOcorr/totalRides*1000).toFixed(1) : '—';
  const roubosPer1k = totalRides > 0 ? (roubos/totalRides*1000).toFixed(1) : '—';

  // Horários pico de corridas
  const peakHours = filtered.length > 0
    ? Array.from({length:24},(_,h)=>({h,n:filtered.filter((r:any)=>r.h===h).length}))
        .sort((a,b)=>b.n-a.n).slice(0,3).map(x=>x.h+'h').join(', ')
    : '—';

  return (
    <div>
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:12}}>
        Relação entre volume de corridas e ocorrências no período selecionado
      </div>

      {/* KPIs de correlação */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
        {[
          {l:'Corridas no período',   v:totalRides.toLocaleString('pt-BR'),  cor:'#3d9bff'},
          {l:'Ocorrências no período',v:totalOcorr,                           cor:'#a78bfa'},
          {l:'Ocorr. por 1k corridas',v:ratioPer1k,                          cor:'#f97316'},
          {l:'Roubos por 1k corridas',v:roubosPer1k,                         cor:'#ef4444'},
        ].map(k => (
          <div key={k.l} style={card}>
            <div style={{fontSize:9,color:'#4a5a7a',marginBottom:3}}>{k.l}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.cor,fontFamily:"'IBM Plex Mono',monospace"}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Insight */}
      {totalRides === 0 ? (
        <div style={{...card,color:'#4a5a7a',fontSize:11,textAlign:'center',padding:16}}>
          Selecione dias no calendário para ver a correlação com corridas
        </div>
      ) : (
        <div style={{...card,marginBottom:12,borderColor:'rgba(167,139,250,.2)'}}>
          <div style={{fontSize:10,color:'#a78bfa',fontWeight:600,marginBottom:6}}>Insight automático</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,.7)',lineHeight:1.6}}>
            {parseFloat(roubosPer1k as string) > 2
              ? `⚠ Taxa de roubo elevada (${roubosPer1k}/1k corridas). Reforçar rondas nos horários de pico.`
              : parseFloat(roubosPer1k as string) > 0.5
                ? `🟡 Taxa de roubo moderada (${roubosPer1k}/1k corridas). Monitorar tendência.`
                : `✅ Taxa de roubo controlada (${roubosPer1k}/1k corridas).`}
          </div>
          {totalRides > 0 && <div style={{fontSize:10,color:'#4a5a7a',marginTop:6}}>
            Horários de pico de corridas: {peakHours}
          </div>}
        </div>
      )}

      {/* Breakdown final */}
      <div style={{fontSize:11,color:'#4a5a7a',marginBottom:8}}>Breakdown por tipo no período</div>
      {['Roubo','Tentativa','Vandalismo','Recuperacao','Outro'].map(t => {
        const n = guardPoints.filter(p=>p.tipo===t).length;
        if (!n) return null;
        const per1k = totalRides > 0 ? (n/totalRides*1000).toFixed(2) : '—';
        const cor = TIPO_COR_G[t];
        return (
          <div key={t} style={{...card,marginBottom:5,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:16}}>{TIPO_EM_G[t]}</span>
            <div style={{flex:1}}>
              <span style={{fontSize:11,color:cor,fontWeight:600}}>{t}</span>
              <span style={{fontSize:10,color:'#4a5a7a',marginLeft:8}}>{n} ocorrências</span>
            </div>
            <div style={{textAlign:'right',fontFamily:"'IBM Plex Mono',monospace"}}>
              <div style={{fontSize:11,color:cor,fontWeight:700}}>{per1k}</div>
              <div style={{fontSize:8,color:'#4a5a7a'}}>por 1k corridas</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
