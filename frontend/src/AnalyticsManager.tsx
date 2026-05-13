// src/AnalyticsManager.tsx — v2: comparação A/B, score estações, clusters, timeline, OD, tendência
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
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
import { ref, uploadBytes, getDownloadURL, deleteObject, getBytes } from 'firebase/storage';

// ── TIPOS ────────────────────────────────────────────────────────
interface Ride { ls:number; lo:number; le:number; ln:number; d:number; dur:number; rev:number; h:number; zs:string; }
interface DayMeta { date:string; regiao?:string; total:number; total_rev:number; avg_dist_km:number; avg_dur_min:number; by_hour:Record<string,number>; cities:string[]; uploaded_at:string; storage_path:string; url?:string; }
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
  const [guardPoints,    setGuardPoints]    = useState<{lat:number;lng:number;tipo:string}[]>([]);
  const [guardDias,      setGuardDias]      = useState<number>(7);
  const [uploading, setUploading] = useState(false);
  const [mergeCtx, setMergeCtx] = useState<{data:DayData;dateKey:string;dayKey:string;existente:DayData}|null>(null);
  const [regiaoFiltro, setRegiaoFiltro] = useState<string>('todas');
  const [uploadProgress, setUploadProgress] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [layer, setLayer] = useState<'heat'|'hex'|'pts'|'arc'|'od'>('heat');
  const [activeTab, setActiveTab] = useState<'map'|'trend'|'od'>('map');
  const [showStarts, setShowStarts] = useState(true);
  const [showEnds, setShowEnds] = useState(true);
  const [showStations, setShowStations] = useState(true);
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
  const [viewState, setViewState] = useState<MapViewState>({ longitude:-46.63, latitude:-23.55, zoom:12, pitch:0, bearing:0 });
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
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db,'estacoes'));
        const sts: Estacao[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (data.lat && data.lng) sts.push({ id:d.id, lat:data.lat, lng:data.lng, codigo:data.codigo, bairro:data.bairro||'', endereco:data.endereco||'', tipo:data.tipo });
        });
        setEstacoes(sts);
      } catch { /* silently fail */ }
    };
    load();
  }, []);

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

  // ── GUARD OCORRÊNCIAS ───────────────────────────────────────────
  useEffect(() => {
    if (!showGuardHeat) return;
    const desde = Timestamp.fromDate(new Date(Date.now() - guardDias * 24 * 60 * 60 * 1000));
    const q = query(
      collection(db, 'ocorrencias'),
      where('criadoEm', '>=', desde)
    );
    const unsub = onSnapshot(q, snap => {
      const pts = snap.docs
        .map(d => d.data())
        .filter(o => o.lat_inicial && o.lng_inicial)
        .map(o => ({ lat: Number(o.lat_inicial), lng: Number(o.lng_inicial), tipo: String(o.tipo || '') }));
      setGuardPoints(pts);
    });
    return unsub;
  }, [showGuardHeat, guardDias]);

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
    if (showStations && estacoes.length) {
      const scored = new Map(stationScores.map(s=>[s.id,s]));
      L.push(new ScatterplotLayer({ id:'stations', data:estacoes,
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
  const allDayKeys = Object.keys(days);

  // Trend data (multi-day)
  const trendData = useMemo(() => {
    return allDayKeys.sort().map(d => ({
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
    const sRef = ref(storage, storagePath);
    await uploadBytes(sRef, new Blob([JSON.stringify(data)], {type:'application/json'}));
    const url = await getDownloadURL(sRef);
    const meta: DayMeta = { ...data.meta, storage_path:storagePath, url };
    await setDoc(doc(db,'analytics_days',dayKey), meta);
    setDays(prev => ({ ...prev, [dayKey]: { meta, rides:data.rides } }));
    setActiveDays(prev => new Set([...prev, dayKey]));
    const dateKey = data.meta.date || dayKey.split('_')[0];
    const [y,mo] = dateKey.split('-').map(Number);
    setCalYear(y); setCalMonth(mo-1);
    if (data.rides.length) {
      const cx=data.rides.reduce((s:number,r:Ride)=>s+r.ls,0)/data.rides.length;
      const cy=data.rides.reduce((s:number,r:Ride)=>s+r.lo,0)/data.rides.length;
      setViewState((vs:any) => ({ ...vs, longitude:cy, latitude:cx, zoom:12 }));
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
      const regiaoDetectada = data.meta.regiao ||
        (!IGNORE_PREFIXES.includes(filePrefix) && filePrefix.length <= 6 ? filePrefix : '');
      const regiao = regiaoDetectada || 'default';
      data.meta.regiao = regiao !== 'default' ? regiao : (data.meta.regiao || '');
      data.meta.date = dateKey;

      // Chave única: data + região (só cria composta se região real detectada)
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
           ['Dias',Object.keys(days).length,'#f5c842'],['Estações',estacoes.length,'#2ecc71']] as [string,any,string][]).map(([l,v,c])=>(
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
      <div style={{display:'flex',alignItems:'center',background:'#0c1018',borderBottom:'1px solid #1c2535',padding:'0 8px',flexShrink:0,gap:4}}>
        {/* View tabs */}
        <div style={{display:'flex',gap:2,padding:'5px 0',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8}}>
          {(['map','trend','od'] as const).map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)} style={tbBtn(activeTab===t)}>
              {t==='map'?'🗺 Mapa':t==='trend'?'📈 Tendência':'🔀 OD'}
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
          {/* Toggles */}
          <div style={{display:'flex',gap:2,padding:'5px 0',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8}}>
            <button onClick={()=>setShowStarts(s=>!s)} style={tbBtn(showStarts)}>Inícios</button>
            <button onClick={()=>setShowEnds(s=>!s)} style={tbBtn(showEnds)}>Fins</button>
            <button onClick={()=>setShowStations(s=>!s)} style={tbBtn(showStations)}>📍 Estações</button>
            <button onClick={()=>setShowClusters(s=>!s)} style={tbBtn(showClusters)} title="Clusters sem cobertura JET">🔴 Gaps</button>
            <button onClick={()=>setShowGuardHeat(s=>!s)} style={{...tbBtn(showGuardHeat), borderColor: showGuardHeat ? 'rgba(167,139,250,.6)' : 'transparent', color: showGuardHeat ? '#a78bfa' : '#4a5a7a'}} title="Heatmap de ocorrências Guard">🛡 Guard{showGuardHeat && guardPoints.length > 0 ? ` (${guardPoints.length})` : ''}</button>
          </div>
          {showGuardHeat && (
            <div style={{display:'flex',gap:4,alignItems:'center',padding:'0 8px',borderRight:'1px solid #1c2535',marginRight:8,paddingRight:8}}>
              <span style={{color:'#a78bfa',fontSize:10,fontWeight:600}}>Período:</span>
              {[1,7,30].map(d => (
                <button key={d} onClick={()=>setGuardDias(d)} style={{...tbBtn(guardDias===d), fontSize:10, padding:'2px 6px', borderColor: guardDias===d ? 'rgba(167,139,250,.5)' : 'transparent', color: guardDias===d ? '#a78bfa' : '#4a5a7a'}}>
                  {d===1?'Hoje':`${d}d`}
                </button>
              ))}
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
          {uploading && <div style={{fontSize:11,color:'#3d9bff',fontFamily:"'IBM Plex Mono',monospace",paddingLeft:8}}>{uploadProgress}</div>}
        </>}
      </div>

      {/* MAIN */}
      <div style={{display:'flex',flex:1,minHeight:0}}>

        {/* MAP / TREND / OD */}
        <div style={{flex:1,position:'relative',minWidth:0}}>
          {activeTab==='map' && (
            <div style={{position:'absolute',top:'0',left:'0',right:'0',bottom:'0'}}
              onDragOver={e=>{e.preventDefault();setDragging(true)}}
              onDragLeave={()=>setDragging(false)}
              onDrop={async e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f&&isGestor)handleFile(f);}}>
              <DeckGL viewState={viewState} onViewStateChange={({viewState:vs}:any)=>setViewState(vs)}
                controller={true} layers={deckLayers}
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
            <div style={{padding:24,height:'100%',overflowY:'auto'}}>
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
            <div style={{padding:24,height:'100%',overflowY:'auto'}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:'#dce8ff'}}>Matriz Origem → Destino</div>
              <div style={{fontSize:11,color:'#4a5a7a',marginBottom:20}}>Top fluxos entre zonas com mais de 5 corridas no período selecionado</div>
              <ODMatrix rides={ridesA}/>
            </div>
          )}
        </div>

        {/* SIDE PANEL */}
        <div style={{width:290,background:'#0c1018',borderLeft:'1px solid #1c2535',display:'flex',flexDirection:'column',overflowY:'auto',overflowX:'hidden',flexShrink:0,height:'100%',position:'relative'}}>

          {/* FILTRO REGIÃO */}
          {Object.keys(days).length > 0 && (() => {
            const regioes = ['todas', ...new Set(Object.values(days).map(d => d.meta.regiao || 'default'))];
            if (regioes.length <= 2) return null;
            return (
              <div style={sec}>
                <div style={secTitle}>Região</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                  {regioes.map(r => (
                    <div key={r} onClick={() => setRegiaoFiltro(r)}
                      style={{padding:'3px 10px',borderRadius:10,cursor:'pointer',fontSize:10,fontWeight:600,
                        border:`1px solid ${regiaoFiltro===r?'#3d9bff':'#1c2535'}`,
                        background:regiaoFiltro===r?'rgba(61,155,255,.15)':'#111722',
                        color:regiaoFiltro===r?'#3d9bff':'#4a5a7a'}}>
                      {r === 'todas' ? 'Todas' : r}
                    </div>
                  ))}
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
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {([['Corridas',n.toLocaleString('pt-BR'),'#3d9bff'],['Receita','R$'+totalRev.toFixed(0),'#f5c842'],['Dist.',avgDist.toFixed(1)+'km','#2ecc71'],['Dur.',avgDur.toFixed(0)+'min','#3d9bff']] as [string,any,string][]).map(([l,v,c])=>(
                  <div key={l} style={{background:'#111722',borderRadius:5,padding:'8px 10px',border:'1px solid #1c2535'}}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:600,color:c}}>{v}</div>
                    <div style={{fontSize:9,color:'#4a5a7a',marginTop:1}}>{l}</div>
                  </div>
                ))}
                <button onClick={exportAnalyticsPDF} title="Exportar relatório PDF" style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',color:'#f87171',cursor:'pointer',fontSize:10,fontWeight:600,borderRadius:5,padding:'8px 10px',alignSelf:'stretch',whiteSpace:'nowrap'}}>📕 PDF</button>
              </div>
              {compareMode && filteredB.length>0 && (
                <div style={{marginTop:8,padding:'8px 10px',background:'rgba(255,100,34,.08)',borderRadius:5,border:'1px solid rgba(255,100,34,.2)',fontSize:10}}>
                  <div style={{color:'#ff6422',fontWeight:700,marginBottom:4}}>B: {filteredB.length.toLocaleString()} corridas</div>
                  <div style={{color:'#4a5a7a'}}>Δ corridas: <span style={{color: filteredA.length>filteredB.length?'#2ecc71':'#ff4757'}}>{filteredA.length>filteredB.length?'+':''}{(filteredA.length-filteredB.length).toLocaleString()}</span></div>
                  <div style={{color:'#4a5a7a'}}>Δ receita: <span style={{color:totalRev>(filteredB.reduce((s,r)=>s+(r.rev||0),0))?'#2ecc71':'#ff4757'}}>R${(totalRev - filteredB.reduce((s,r)=>s+(r.rev||0),0)).toFixed(0)}</span></div>
                </div>
              )}
            </div>
            {/* Hour chart */}
            <div style={sec}>
              <div style={secTitle}>Por Hora</div>
              <div style={{display:'flex',alignItems:'flex-end',gap:2,height:48}}>
                {[...Array(24).keys()].map(h=>{
                  const cnt=byHour[h]||0, pct=(cnt/maxHour)*100, on=animHour!==null?h===animHour:selHours.has(h);
                  return <div key={h} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',gap:2}}>
                    <div style={{width:'100%',borderRadius:'2px 2px 0 0',minHeight:2,height:`${pct}%`,opacity:on?.9:.2,background:`hsl(${210-pct*1.5},70%,${35+pct*.4}%)`}}/>
                    {h%6===0&&<div style={{fontSize:7,color:'#4a5a7a'}}>{h}h</div>}
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
    ls:   findCol([k=>k.includes('Local de transporte') && k.includes('início'), k=>k.includes('Место транспорта') && k.includes('начало'), k=>k.includes('начало поездки')]),
    le:   findCol([k=>k.includes('Local de transporte') && k.includes('final'),  k=>k.includes('Место транспорта') && k.includes('конец'),  k=>k.includes('конец поездки')]),
    dist: findCol([k=>k.includes('Distância'), k=>k.includes('Расстояние'), k=>k==='Distance']),
    dur:  findCol([k=>k.includes('Duração'),   k=>k.includes('Длительность'), k=>k==='Duration']),
    rev:  findCol([k=>k==='Total',             k=>k.includes('Итог'),          k=>k.includes('Receita')]),
    hora: findCol([k=>k.includes('Hora de início'), k=>k.includes('Время начала')]),
    zona: findCol([k=>k.includes('Zona de taxa'),   k=>k.includes('Zona inicial'), k=>k.includes('Зона начала')]),
    date: findCol([k=>k.includes('Data de início'), k=>k.includes('Дата начала')]),
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
  for(const r of raw){const cs=pc(r[C.ls||'']||''),ce=pc(r[C.le||'']||'');if(!cs||!ce||isNaN(cs[0])||isNaN(ce[0]))continue;let h=0;if(C.hora&&r[C.hora])h=parseInt(String(r[C.hora]).split(':')[0])||0;const d=parseFloat(r[C.dist||'']||0)/1000,dur=Math.round(parseFloat(r[C.dur||'']||0)/60),rev=parseFloat(r[C.rev||'']||0);rides.push({ls:cs[0],lo:cs[1],le:ce[0],ln:ce[1],d:Math.round(d*100)/100,dur,rev,h,zs:String(r[C.zona||'']||'').slice(0,30)});totR+=rev;totD+=d;totDur+=dur;byH[String(h)]=(byH[String(h)]||0)+1;}
  return{rides,meta:{date:dateKey,total:rides.length,total_rev:Math.round(totR*100)/100,avg_dist_km:Math.round(totD/rides.length*100)/100,avg_dur_min:Math.round(totDur/rides.length*10)/10,by_hour:byH,cities:[],uploaded_at:new Date().toISOString(),storage_path:''}};
}

function buildCalDays(y:number,m:number):(string|null)[]{
  const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
  const r:(string|null)[]=Array(first).fill(null);
  for(let d=1;d<=days;d++)r.push(`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  return r;
}

const sec:React.CSSProperties={padding:'12px 14px',borderBottom:'1px solid #1c2535'};
const secTitle:React.CSSProperties={fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:1.2,color:'#4a5a7a',marginBottom:6};
const tbBtn=(active:boolean):React.CSSProperties=>({padding:'4px 10px',borderRadius:4,border:`1px solid ${active?'#1c2535':'transparent'}`,cursor:'pointer',fontSize:11,fontWeight:600,background:active?'#111722':'transparent',color:active?'#dce8ff':'#4a5a7a',display:'flex',alignItems:'center',gap:5,fontFamily:"'DM Sans',sans-serif"});
const calBtn:React.CSSProperties={background:'none',border:'none',color:'#4a5a7a',cursor:'pointer',fontSize:16,padding:'2px 6px',borderRadius:3};

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
