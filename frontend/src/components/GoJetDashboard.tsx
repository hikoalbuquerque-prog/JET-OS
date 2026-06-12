// frontend/src/components/GoJetDashboard.tsx
// Dashboard expandido GoJet — visualização rápida por cidade
// Exibe: pontos (status, cores, targets), patinetes (status, bateria), workers online
// Dados: Firestore gojet_snapshots/latest + gojet_snapshots/bikes_latest
//
// Uso no App.tsx:
//   import GoJetDashboard from './components/GoJetDashboard';
//   {gojetDash && <GoJetDashboard visivel onFechar={() => setGojetDash(false)} cidade={cidade} />}

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, doc, getDoc, onSnapshot, query, where, Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { classifyBike as classifyBikeShared, BIKE_STATUS_HEX } from '../lib/bike-classify';
import { colorForParking } from '../lib/parking-colors';

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
  parking_id?: string|null;
  location_lat: number; location_lng: number;
}
interface GpsWorker {
  uid: string; nome?: string; lat?: number; lng?: number; atualizadoEm?: any;
}

type BikeStatus = 'available'|'renting'|'reserved'|'maintenance'|'workshop'|'low_battery';
type TabId = 'pontos'|'patinetes'|'workers'|'resumo';

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
  txt:'#e2e8f0', dim:'#64748b',
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
  const [tab,      setTab     ] = useState<TabId>('resumo');
  const [parkings, setParkings] = useState<GoJetParking[]>([]);
  const [bikes,    setBikes   ] = useState<GoJetBike[]>([]);
  const [workers,  setWorkers ] = useState<GpsWorker[]>([]);
  const [freshness,setFreshness] = useState<Date|null>(null);
  const [busca,    setBusca   ] = useState('');
  const [filtroP,  setFiltroP ] = useState<keyof typeof COR_PONTO|'todos'>('todos');
  const [filtroB,  setFiltroB ] = useState<BikeStatus|'todos'>('todos');
  const [sortP,    setSortP   ] = useState<'status'|'nome'|'avail'>('status');
  const [cityId,   setCityId  ] = useState<string|null>(null);

  // Carrega cityId de gojet_config/{cidade} — igual ao GoJetOverlay
  useEffect(() => {
    if (!cidade) return;
    getDoc(doc(db, 'gojet_config', cidade)).then(snap => {
      if (snap.exists()) setCityId(snap.data().cityId ?? null);
    });
  }, [cidade]);

  useEffect(() => {
    if (!visivel) return;
    // Aguarda cityId se cidade foi informada
    if (cidade && !cityId) return;

    const snapId      = cityId ? `latest_${cityId}`       : 'latest';
    const bikesSnapId = cityId ? `bikes_latest_${cityId}` : 'bikes_latest';

    // Lê snapshot de parkings (suporta chunks)
    async function lerParkings() {
      const snap = await getDoc(doc(db, 'gojet_snapshots', snapId));
      if (!snap.exists()) return;
      const data = snap.data();
      let list: GoJetParking[] = [];
      if (data.chunked && data.totalChunks) {
        const chunks = await Promise.all(
          Array.from({ length: data.totalChunks as number }, (_, i) =>
            getDoc(doc(db, 'gojet_snapshots', `${snapId}_chunk${i}`))
          )
        );
        for (const c of chunks) if (c.exists()) list = list.concat(c.data().parkings ?? []);
      } else {
        list = data.parkings ?? [];
      }
      setParkings(list);
      const ts = data.savedAt ?? data.atualizadoEm;
      if (ts?.toDate) setFreshness(ts.toDate());
    }

    // Lê snapshot de bikes (suporta chunks)
    async function lerBikes() {
      const snap = await getDoc(doc(db, 'gojet_snapshots', bikesSnapId));
      if (!snap.exists()) return;
      const data = snap.data();
      let list: GoJetBike[] = [];
      if (data.chunked && data.totalChunks) {
        const chunks = await Promise.all(
          Array.from({ length: data.totalChunks as number }, (_, i) =>
            getDoc(doc(db, 'gojet_snapshots', `${bikesSnapId}_chunk${i}`))
          )
        );
        for (const c of chunks) if (c.exists()) list = list.concat(c.data().bikes ?? []);
      } else {
        list = data.bikes ?? [];
      }
      setBikes(list);
    }

    lerParkings();
    lerBikes();

    // Workers GPS (30min)
    const since = Timestamp.fromMillis(Date.now() - 30 * 60000);
    const qW = cidade
      ? query(collection(db, 'gps_logistica'), where('cidade','==',cidade), where('criadoEm','>=',since))
      : query(collection(db, 'gps_logistica'), where('criadoEm','>=',since));
    const unsubW = onSnapshot(qW, snap =>
      setWorkers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as GpsWorker))));

    return () => { unsubW(); };
  }, [visivel, cidade, cityId]);

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

  const online30 = workers.filter(w => mAtras(w.atualizadoEm) < 30).length;

  // ── Filtros ───────────────────────────────────────────────────────────────

  const parkingsFilt = useMemo(() => {
    let list = parkings;
    if (filtroP !== 'todos') list = byStatus[filtroP] || [];
    if (busca) list = list.filter(p => p.name?.toLowerCase().includes(busca.toLowerCase()));
    return [...list].sort((a, b) => {
      if (sortP === 'nome') return (a.name||'').localeCompare(b.name||'');
      if (sortP === 'avail') return (b.availableCount??0) - (a.availableCount??0);
      return SORT_ORDER_PONTO.indexOf(classifyParking(a)) - SORT_ORDER_PONTO.indexOf(classifyParking(b));
    });
  }, [parkings, filtroP, busca, sortP]);

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
              GoJet Dashboard{cidade ? ` — ${cidade}` : ' — Todas as cidades'}
            </div>
            <div style={{ fontSize:11, color:T.dim }}>
              {parkings.length} pontos · {bikes.length} patinetes
              {freshMin !== null && (
                <span style={{ color:freshCor, marginLeft:8 }}>
                  ● dados de {freshMin < 1 ? 'agora' : `${freshMin}min atrás`}
                </span>
              )}
            </div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:`1px solid ${T.bdr}`, borderRadius:8, color:T.dim, cursor:'pointer', padding:'6px 12px', fontSize:12 }}>✕ Fechar</button>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {([
            ['resumo',    '📊 Resumo'   ],
            ['pontos',    '🅿️ Pontos'    ],
            ['patinetes', '🛴 Patinetes' ],
            ['workers',   '👷 Workers'  ],
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
                  { n:parkings.length,      l:'Pontos total',   c:'#307FE2' },
                  { n:byStatus.red.length,    l:'🔴 Zerados',    c:'#ef4444' },
                  { n:byStatus.orange.length, l:'🟠 < 50%',      c:'#f59e0b' },
                  { n:(byStatus.blue.length??0)+(byStatus.green.length??0), l:'🔵🟢 No target', c:'#22c55e' },
                  { n:totalAvail,            l:'Disponíveis',   c:'#22c55e' },
                  { n:totalFisico,           l:'Total físico',  c:'#94a3b8' },
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
                    🅿️ Status dos Pontos ({parkings.length})
                  </div>
                  {Object.entries(COR_PONTO).map(([key, meta]) => {
                    const n = byStatus[key]?.length || 0;
                    const maxN = parkings.length || 1;
                    return (
                      <div key={key} style={{ marginBottom:8 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:2 }}>
                          <span style={{ color:T.txt }}>{meta.emoji} {meta.label}</span>
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
                      🛴 Patinetes ({bikes.length})
                    </div>
                    {(Object.entries(COR_BIKE) as [BikeStatus, typeof COR_BIKE[BikeStatus]][]).map(([key, meta]) => {
                      const n = bikeStats[key] || 0;
                      if (!n) return null;
                      return (
                        <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, marginBottom:6 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ width:10, height:10, borderRadius:'50%', background:meta.cor, flexShrink:0 }}/>
                            <span style={{ color:T.txt }}>{meta.label}</span>
                          </div>
                          <span style={{ color:meta.cor, fontWeight:700 }}>{n} <span style={{ color:T.dim, fontWeight:400 }}>({pct(n,bikes.length)})</span></span>
                        </div>
                      );
                    })}
                    {foraPonto > 0 && (
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginTop:6, paddingTop:6, borderTop:`1px solid ${T.bdr}` }}>
                        <span style={{ color:'#f97316' }}>⚠️ Fora de ponto</span>
                        <span style={{ color:'#f97316', fontWeight:700 }}>{foraPonto}</span>
                      </div>
                    )}
                  </div>

                  {/* Workers + Estações monitor */}
                  <div style={S.card('#a855f7')}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:8 }}>
                      👷 Workers & Monitor
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
                      <span style={{ color:T.txt }}>Online (30min)</span>
                      <span style={{ color:'#4ade80', fontWeight:700 }}>{online30}</span>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
                      <span style={{ color:T.txt }}>Total (1h)</span>
                      <span style={{ color:T.txt, fontWeight:700 }}>{workers.length}</span>
                    </div>
                    {monitorados.length > 0 && (
                      <>
                        <div style={{ height:1, background:T.bdr, margin:'8px 0' }}/>
                        <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>Estações Monitor vinculadas</div>
                        {(['M1','M2','M3'] as const).map(m => {
                          const n = parkings.filter(p => p.monitorLevel === m).length;
                          if (!n) return null;
                          return (
                            <div key={m} style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                              <span style={{ color:M_COR[m], fontWeight:700 }}>{m}</span>
                              <span style={{ color:T.dim }}>{n} pontos GoJet</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Legenda completa */}
              <div style={S.card()}>
                <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:10 }}>
                  📖 Legenda completa
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:T.dim, marginBottom:6 }}>PONTOS (parkings)</div>
                    {Object.entries(COR_PONTO).map(([k, m]) => (
                      <div key={k} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                        <div style={{ width:14, height:14, borderRadius:3, background:m.bg, border:`2px solid ${m.borda}`, flexShrink:0 }}/>
                        <div>
                          <span style={{ fontSize:11, color:T.txt }}>{m.emoji} {m.label}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop:8, fontSize:11, color:T.dim }}>
                      <span style={{ fontWeight:700, color:'#10b981' }}>P circular</span> = Ponto monitorado (com target)<br/>
                      <span style={{ fontWeight:700, color:T.dim }}>P quadrado</span> = Ponto neutro (sem target)
                    </div>
                    <div style={{ marginTop:6, fontSize:11, color:T.dim }}>
                      Badge <span style={{ color:'#10b981' }}>M1</span>/<span style={{ color:'#3b82f6' }}>M2</span>/<span style={{ color:'#f59e0b' }}>M3</span> = estação JET OS a &lt;150m
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:T.dim, marginBottom:6 }}>PATINETES</div>
                    {(Object.entries(COR_BIKE) as [BikeStatus, typeof COR_BIKE[BikeStatus]][]).map(([k, m]) => (
                      <div key={k} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                        <div style={{ width:12, height:12, borderRadius:'50%', background:m.cor, flexShrink:0 }}/>
                        <span style={{ fontSize:11, color:T.txt }}>{m.emoji} {m.label}</span>
                      </div>
                    ))}
                    <div style={{ marginTop:8, fontSize:11, color:T.dim }}>
                      Barrinha colorida abaixo = nível de bateria<br/>
                      <span style={{ color:'#ef4444' }}>🔴</span> &lt;20% · <span style={{ color:'#f97316' }}>🟠</span> &lt;40% · <span style={{ color:'#22c55e' }}>🟢</span> ok
                    </div>
                    <div style={{ marginTop:8, fontSize:11, fontWeight:700, color:T.dim }}>WORKERS</div>
                    <div style={{ fontSize:11, color:T.dim, marginTop:4 }}>
                      <span style={{ color:'#22c55e' }}>● Verde</span> = GPS &lt;5min<br/>
                      <span style={{ color:'#f59e0b' }}>● Amarelo</span> = GPS 5–15min<br/>
                      <span style={{ color:'#f97316' }}>● Laranja</span> = GPS 15–30min<br/>
                      <span style={{ color:T.dim }}>● Cinza</span> = offline
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── PONTOS ──────────────────────────────────────────────────── */}
          {tab === 'pontos' && (
            <div>
              {/* Filtros */}
              <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar ponto..." style={{ ...S.inp, width:180, marginBottom:0 }}/>
                <button onClick={() => setFiltroP('todos')} style={{ padding:'6px 10px', borderRadius:8, border:'none', background:filtroP==='todos'?'#1a6fd4':'rgba(255,255,255,.06)', color:filtroP==='todos'?'#fff':T.dim, fontSize:11, fontWeight:600, cursor:'pointer' }}>Todos ({parkings.length})</button>
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
                    <button key={s} onClick={() => setSortP(s)} style={{ padding:'5px 8px', borderRadius:7, border:'none', background:sortP===s?'rgba(26,111,212,.3)':'rgba(255,255,255,.06)', color:sortP===s?'#307FE2':T.dim, fontSize:10, cursor:'pointer' }}>
                      {s==='status'?'🔴 Status':s==='nome'?'A-Z':'📊 Qty'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
                <table style={{ ...S.table, minWidth:700 }}>
                  <thead><tr>
                    {['Status','Nome','Disponível','Físico','Target','Ocupação','Monitor'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parkingsFilt.length === 0 && (
                      <tr><td colSpan={7} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>Nenhum ponto</td></tr>
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
                          <td style={S.td}><span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:20, fontSize:11, fontWeight:700, background:meta.bg, color:meta.txt, border:`1px solid ${meta.borda}` }}>{meta.emoji} {meta.label}</span></td>
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
              <div style={{ fontSize:11, color:T.dim, marginTop:8 }}>{parkingsFilt.length} pontos exibidos</div>
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
                      <div style={S.kpiL}>{m.emoji} {m.label}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar por ID..." style={{ ...S.inp, marginBottom:0, flex:1 }}/>
                <button onClick={() => { setFiltroB('todos'); setBusca(''); }} style={{ padding:'7px 12px', borderRadius:8, border:`1px solid ${T.bdr}`, background:'transparent', color:T.dim, fontSize:12, cursor:'pointer' }}>Limpar</button>
              </div>

              {filtroB !== 'todos' && (
                <div style={{ ...S.card(COR_BIKE[filtroB].cor), marginBottom:12 }}>
                  <div style={{ fontSize:12, color:T.txt }}>{COR_BIKE[filtroB].emoji} <b>{COR_BIKE[filtroB].label}</b> — {bikesFilt.length} patinetes</div>
                </div>
              )}

              <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
                <table style={{ ...S.table, minWidth:600 }}>
                  <thead><tr>
                    {['Status','ID / Nome','Bateria','Em ponto','Sub-status'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {bikesFilt.length === 0 && <tr><td colSpan={5} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>Nenhum patinete</td></tr>}
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
                              <span style={{ fontSize:11, color:meta.cor, fontWeight:700 }}>{meta.label}</span>
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
                            {b.parking_id ? <span style={{ color:'#22c55e', fontSize:11 }}>✅ Em ponto</span> : <span style={{ color:'#f97316', fontSize:11 }}>⚠️ Fora</span>}
                          </td>
                          <td style={{ ...S.td, fontSize:11, color:T.dim }}>{b.business_sub_status || '—'}</td>
                        </tr>
                      );
                    })}
                    {bikesFilt.length > 200 && (
                      <tr><td colSpan={5} style={{ ...S.td, textAlign:'center', color:T.dim, fontSize:11 }}>+ {bikesFilt.length - 200} mais — use o filtro para refinar</td></tr>
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
                  { n:workers.filter(w=>mAtras(w.atualizadoEm)<5).length,  l:'GPS < 5min',  c:'#22c55e' },
                  { n:workers.filter(w=>mAtras(w.atualizadoEm)<15).length, l:'GPS < 15min', c:'#f59e0b' },
                  { n:workers.filter(w=>mAtras(w.atualizadoEm)<30).length, l:'GPS < 30min', c:'#f97316' },
                  { n:workers.length,                                       l:'Total 1h',    c:T.dim     },
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
                    {['Status','Nome','Último GPS','Localização'].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {workers.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>Nenhum worker online</td></tr>}
                    {[...workers].sort((a,b) => mAtras(a.atualizadoEm)-mAtras(b.atualizadoEm)).map(w => {
                      const min = mAtras(w.atualizadoEm);
                      const cor = min < 5 ? '#22c55e' : min < 15 ? '#f59e0b' : min < 30 ? '#f97316' : T.dim;
                      return (
                        <tr key={w.uid}>
                          <td style={S.td}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ width:10, height:10, borderRadius:'50%', background:cor }}/>
                              <span style={{ fontSize:11, color:cor, fontWeight:600 }}>{min < 1 ? 'agora' : `${min}min`}</span>
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
        </div>
      </div>
    </div>
  );
}
