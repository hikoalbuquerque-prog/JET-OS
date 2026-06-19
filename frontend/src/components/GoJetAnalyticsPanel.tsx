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
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { fnExportarHistoricoParking } from '../lib/firebase';
import { classifyBike, BIKE_STATUS_HEX, BIKE_STATUS_LABEL, BikeForClassify, BikeStatus } from '../lib/bike-classify';
import { analyticsProviderSupabase, fetchGojetSnapshot } from '../lib/analytics-supabase';
import { colorForParking, PARKING_COLOR_HEX, ParkingColor } from '../lib/parking-colors';
import {
  computeZoneAnalytics, ZoneStats, ZonePolygon, ParkingPoint, BikePoint,
} from '../lib/zone-analytics';

// ─── Helpers para ler snapshot chunked do Firestore ──────────────────────────

async function lerSnapshotDoc(docId: string, campo: string): Promise<any[]> {
  const snap = await getDoc(doc(db, 'gojet_snapshots', docId));
  if (!snap.exists()) return [];
  const data = snap.data()!;
  if (!data.chunked) return data[campo] ?? [];
  const chunkDocs = await Promise.all(
    Array.from({ length: data.totalChunks as number }, (_, i) =>
      getDoc(doc(db, 'gojet_snapshots', `${docId}_chunk${i}`))
    )
  );
  return chunkDocs.flatMap(c => c.exists() ? (c.data()![campo] ?? []) : []);
}

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

// ─── Componente principal ─────────────────────────────────────────────────────

export default function GoJetAnalyticsPanel({ visivel, onFechar, cidade }: Props) {
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
      // Migração: lê parkings/bikes do Postgres (scrape-gojet) quando o flag está ligado.
      if (analyticsProviderSupabase()) {
        const r = await fetchGojetSnapshot(cidade);
        setParkings(r.parkings as any);
        setBikes(r.bikes as any);
        setSnapshotAge(r.savedAtMs ? Math.round((Date.now() - r.savedAtMs) / 60000) : null);
      } else {
        const [pList, bList] = await Promise.all([
          lerSnapshotDoc(`latest_${cidade}`, 'parkings'),
          lerSnapshotDoc(`bikes_latest_${cidade}`, 'bikes'),
        ]);
        setParkings(pList);
        setBikes(bList);
        const snap = await getDoc(doc(db, 'gojet_snapshots', `latest_${cidade}`));
        if (snap.exists()) {
          const ts = snap.data()?.savedAt?.toMillis?.() ?? null;
          setSnapshotAge(ts ? Math.round((Date.now() - ts) / 60000) : null);
        }
      }

      // Zonas (poligonos collection)
      const zonasSnap = await getDocs(query(collection(db, 'poligonos'), where('cidade', '==', cidade)));
      const zonasList: ZonePolygon[] = zonasSnap.docs.map(d => {
        const data = d.data();
        // Converte coordenadas GeoJSON [[lng,lat]] ou Leaflet [[lat,lng]]
        let coords: [number, number][] = [];
        if (data.coordenadas && Array.isArray(data.coordenadas)) {
          coords = data.coordenadas;
        } else if (data.latlngs && Array.isArray(data.latlngs)) {
          coords = data.latlngs.map((p: any) => [p.lng ?? p[1], p.lat ?? p[0]]);
        }
        return { id: d.id, nome: data.nome ?? d.id, cor: data.cor, coordenadas: coords };
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
      const snap = await getDocs(query(
        collection(db, 'parking_history'),
        where('cidade', '==', cidade),
        orderBy('data', 'desc'),
        limit(90),
      ));
      setHistorico(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    { id:'resumo',    label:'📊 Resumo'   },
    { id:'pontos',    label:'📍 Pontos'   },
    { id:'zonas',     label:'🗺 Zonas'    },
    { id:'patinetes', label:'🛴 Patinetes' },
    { id:'historico', label:'📅 Histórico' },
  ];

  return (
    <div style={S.overlay}>
      {/* Header */}
      <div style={S.header}>
        <button onClick={onFechar} style={{ background:'none',border:'none',color:'rgba(255,255,255,.5)',fontSize:20,cursor:'pointer',padding:0 }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>📊 Analytics GoJet</div>
          <div style={{ fontSize:10, color:C.dim }}>
            {cidade} {snapshotAge !== null ? `• snapshot ${snapshotAge}min atrás` : ''} {carregando ? '• carregando…' : `• ${parkings.length} pontos · ${bikes.length} bikes`}
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
          <div style={{ textAlign:'center', color:C.dim, paddingTop:40 }}>Carregando snapshot…</div>
        ) : (
          <>
            {/* ── RESUMO ── */}
            {aba === 'resumo' && (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, marginBottom:14 }}>
                  <KpiCard label="Patinetes disponíveis" value={stats.bikesDisponiveis} color="#22c55e" sub={`de ${stats.bikesTotal} total`} />
                  <KpiCard label="Em uso agora"          value={stats.bikesEmUso}       color="#f59e0b" />
                  <KpiCard label="Pontos zerados"        value={stats.monitoresZerados} color="#ef4444" sub={`de ${stats.monitores} monitores`} />
                  <KpiCard label="Eficiência monitores"  value={`${stats.efficiencyPct}%`} color={stats.efficiencyPct>80?'#22c55e':stats.efficiencyPct>50?'#f59e0b':'#ef4444'} />
                </div>
                <Card style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:C.txt, marginBottom:10 }}>Distribuição de Cores</div>
                  {(['red','orange','yellow','blue','green','gray'] as ParkingColor[]).map(cor => {
                    const count = parkings.filter(p => colorForParking(p) === cor).length;
                    const pct   = parkings.length > 0 ? Math.round((count/parkings.length)*100) : 0;
                    return (
                      <div key={cor} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                        <div style={{ width:10, height:10, borderRadius:'50%', background:PARKING_COLOR_HEX[cor], flexShrink:0 }} />
                        <div style={{ fontSize:11, color:C.txt, width:120 }}>{cor === 'red' ? 'Zerado' : cor === 'orange' ? '< 50% target' : cor === 'yellow' ? '50–85%' : cor === 'blue' ? 'No target' : cor === 'green' ? 'Excesso' : 'S/ target'}</div>
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
                    <div style={{ fontSize:12, fontWeight:700, color:C.txt, marginBottom:10 }}>Top Zonas Críticas</div>
                    {[...zoneStats].sort((a,b) => a.efficiencyPct-b.efficiencyPct).slice(0,5).map(z => (
                      <div key={z.zoneId} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        <div style={{ fontSize:11, color:C.txt, flex:1 }}>{z.zoneName}</div>
                        <div style={{ fontSize:11, color: z.efficiencyPct>80?'#22c55e':z.efficiencyPct>50?'#f59e0b':'#ef4444', fontWeight:700 }}>{z.efficiencyPct}%</div>
                        <div style={{ fontSize:10, color:C.dim }}>{z.monitorEmpty} zerados</div>
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
                      {f==='todos'?'Todos':f==='red'?'Zerados':f==='orange'?'Baixo':f==='yellow'?'Médio':f==='blue'?'OK':'Excesso'}
                    </button>
                  ))}
                  <input value={buscaPonto} onChange={e=>setBuscaPonto(e.target.value)} placeholder="Buscar…"
                    style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:8, border:`1px solid ${C.bord}`, background:'rgba(255,255,255,.05)', color:'#fff', fontSize:11 }} />
                  <button onClick={exportCSV} style={{ padding:'4px 10px', borderRadius:8, border:`1px solid ${C.bord}`, background:'none', color:C.dim, fontSize:11, cursor:'pointer' }}>📥 CSV</button>
                </div>
                <div style={{ fontSize:11, color:C.dim, marginBottom:8 }}>{pontosFiltrados.length} pontos</div>
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
                    <div style={{ fontSize:12, marginTop:8 }}>Nenhuma zona configurada para {cidade}</div>
                    <div style={{ fontSize:10, marginTop:4 }}>Configure zonas em Zonas → desenhar polígono</div>
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
                        <div style={{ fontSize:11, color:C.dim }}>Pontos <span style={{ color:'#fff', fontWeight:700 }}>{z.parkingsTotal}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>Monitores <span style={{ color:'#fff', fontWeight:700 }}>{z.monitorTotal}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>Zerados <span style={{ color:'#ef4444', fontWeight:700 }}>{z.monitorEmpty}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>Bikes <span style={{ color:'#22c55e', fontWeight:700 }}>{z.bikesAvailable}</span> disp</div>
                        <div style={{ fontSize:11, color:C.dim }}>Em uso <span style={{ color:'#f59e0b', fontWeight:700 }}>{z.bikesRenting}</span></div>
                        <div style={{ fontSize:11, color:C.dim }}>Fora ponto <span style={{ color:C.dim, fontWeight:700 }}>{z.bikesOutOfParking}</span></div>
                      </div>
                      {z.emptyMonitors.length > 0 && (
                        <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.bord}` }}>
                          <div style={{ fontSize:10, color:C.dim, marginBottom:4 }}>Monitores sem bike:</div>
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
                    <div style={{ fontSize:12, fontWeight:700, color:'#f97316', marginBottom:8 }}>⚡ Bateria Baixa ({stats.bikesByStatus.low_battery})</div>
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
                    🔄 Atualizar
                  </button>
                  <button onClick={exportarHistoricoCSV} disabled={exportandoHist}
                    style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${C.bord}`, background:'none', color:'#22c55e', fontSize:11, cursor:'pointer' }}>
                    {exportandoHist ? '⏳ Exportando…' : '📥 Exportar CSV (90 dias)'}
                  </button>
                </div>
                {carregandoHist ? (
                  <div style={{ textAlign:'center', color:C.dim, paddingTop:30 }}>Carregando histórico…</div>
                ) : historico.length === 0 ? (
                  <div style={{ textAlign:'center', color:C.dim, paddingTop:30 }}>
                    <div style={{ fontSize:28 }}>📅</div>
                    <div style={{ fontSize:12, marginTop:8 }}>Nenhum histórico ainda</div>
                    <div style={{ fontSize:10, marginTop:4 }}>O histórico é salvo automaticamente todo dia às 23:55</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:11, color:C.dim, marginBottom:8 }}>{historico.length} registros</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4, marginBottom:6, fontSize:10, color:C.dim, padding:'0 4px' }}>
                      <div>Data</div><div>Pontos</div><div>Monitores</div><div>Zerados</div><div>Eficiência</div>
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
