// src/components/CandidatosManager.tsx
// Detecta esquinas candidatas para novas estações — custo zero
// Fontes: Overpass OSM (esquinas) + Analytics (fluxo) + POIs (estratégia) + estações JET (gap)

import { useState, useCallback, useRef } from 'react';

// ── TIPOS ────────────────────────────────────────────────────────
export interface Candidato {
  id: string;
  lat: number;
  lng: number;
  score: number;           // 0-100
  scoreGap: number;        // distância mínima até estação JET (peso 40%)
  scoreFluxo: number;      // corridas Analytics no raio (peso 35%)
  scorePOI: number;        // POIs estratégicos próximos (peso 25%)
  distanciaEstacao: number; // metros até estação JET mais próxima
  corridasProximas: number; // corridas no raio de 200m
  poisProximos: string[];  // nomes dos POIs estratégicos
  via1?: string;
  via2?: string;
  semAnalytics?: boolean;  // true quando não há dados de corridas
}

interface Estacao { lat: number; lng: number; id: string; codigo?: string; }
interface Ride { ls: number; lo: number; le: number; ln: number; }

// ── GEO ──────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// ── OVERPASS ─────────────────────────────────────────────────────
async function fetchOverpass(query: string): Promise<any[]> {
  const body = 'data=' + encodeURIComponent(query);
  for (const url of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await fetch(url, { method:'POST', body, headers:{'Content-Type':'application/x-www-form-urlencoded'} });
      if (!r.ok) continue;
      return (await r.json()).elements || [];
    } catch { continue; }
  }
  return [];
}

// Busca esquinas (crossings) + nós de interseção de vias num raio
function queryEsquinas(lat: number, lng: number, raio: number): string {
  const c = `${lat},${lng}`;
  return `[out:json][timeout:30];
(
  node["highway"="crossing"](around:${raio},${c});
  node["highway"="traffic_signals"](around:${raio},${c});
  node["highway"="turning_circle"](around:${raio},${c});
);
out qt ${raio < 500 ? 100 : 300};`;
}

// Busca POIs estratégicos (transporte + educação + comércio)
function queryPOIsEstrategicos(lat: number, lng: number, raio: number): string {
  const c = `${lat},${lng}`;
  return `[out:json][timeout:20];
(
  node["railway"~"subway_entrance|station"](around:${raio},${c});
  node["highway"="bus_stop"](around:${raio},${c});
  node["amenity"~"school|university|hospital|bus_station"](around:${raio},${c});
  node["shop"~"mall|supermarket"](around:${raio},${c});
  node["leisure"="park"](around:${raio},${c});
);
out qt 100;`;
}

// ── SCORE ENGINE ─────────────────────────────────────────────────
function calcularScore(
  lat: number, lng: number,
  estacoes: Estacao[],
  rides: Ride[],
  poisEst: {lat:number;lng:number;nome:string}[],
  raioGap: number,
  raioFluxo: number,
): { score:number; scoreGap:number; scoreFluxo:number; scorePOI:number; distEst:number; corridas:number; pois:string[]; semAnalytics:boolean } {

  // GAP — distância até estação mais próxima (quanto mais longe, melhor candidato)
  const distEst = estacoes.length
    ? Math.min(...estacoes.map(e => haversine(lat, lng, e.lat, e.lng)))
    : 9999;
  // Score gap: 0 se < raioGap/2, 100 se > raioGap
  const scoreGap = distEst < raioGap/2 ? 0
    : distEst > raioGap ? 100
    : Math.round(((distEst - raioGap/2) / (raioGap/2)) * 100);

  // FLUXO — corridas Analytics que iniciam ou terminam no raio
  const corridas = rides.filter(r =>
    haversine(lat, lng, r.ls, r.lo) <= raioFluxo ||
    haversine(lat, lng, r.le, r.ln) <= raioFluxo
  ).length;
  // Score fluxo: normalizado 0-100 (50+ corridas = 100)
  const scoreFluxo = Math.min(100, Math.round((corridas / 50) * 100));

  // POIs estratégicos próximos
  const poisProx = poisEst.filter(p => haversine(lat, lng, p.lat, p.lng) <= 200);
  // Score POI: cada POI vale 20pts, máx 100
  const scorePOI = Math.min(100, poisProx.length * 20);

  // Score adaptativo — sem Analytics usa só Gap + POI
  const temAnalytics = rides.length > 0;
  const score = temAnalytics
    ? Math.round(scoreGap * 0.40 + scoreFluxo * 0.35 + scorePOI * 0.25)
    : Math.round(scoreGap * 0.55 + scorePOI * 0.45);

  return {
    score, scoreGap, scoreFluxo, scorePOI,
    distEst, corridas,
    semAnalytics: !temAnalytics,
    pois: poisProx.map(p => p.nome).slice(0, 3),
  };
}

// ── COMPONENTE ───────────────────────────────────────────────────
export function CandidatosManager({
  mapCenter,
  estacoes,
  ridesAnalytics,
  drawerAberto = false,
  onAbrirDrawer,
  onCandidatosChange,
}: {
  mapCenter: { lat: number; lng: number };
  estacoes: Estacao[];
  ridesAnalytics: Ride[];
  drawerAberto?: boolean;
  onAbrirDrawer: (lat: number, lng: number) => void;
  onCandidatosChange: (candidatos: Candidato[]) => void;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [raioGap, setRaioGap] = useState(300);
  const [raioArea, setRaioArea] = useState(1500);
  const [raioFluxo, setRaioFluxo] = useState(200);
  const [minScore, setMinScore] = useState(30);
  const [aberto, setAberto] = useState(false);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const cacheRef = useRef<Record<string,Candidato[]>>({});

  const buscar = useCallback(async () => {
    const cacheKey = `${mapCenter.lat.toFixed(3)},${mapCenter.lng.toFixed(3)},${raioArea},${raioGap}`;
    if (cacheRef.current[cacheKey]) {
      const cached = cacheRef.current[cacheKey];
      setCandidatos(cached);
      onCandidatosChange(cached);
      return;
    }

    setLoading(true);
    setProgresso('Buscando esquinas no OSM...');

    try {
      // 1. Busca esquinas
      const [esquinaEls, poiEls] = await Promise.all([
        fetchOverpass(queryEsquinas(mapCenter.lat, mapCenter.lng, raioArea)),
        fetchOverpass(queryPOIsEstrategicos(mapCenter.lat, mapCenter.lng, raioArea)),
      ]);

      setProgresso(`${esquinaEls.length} esquinas encontradas. Calculando scores...`);

      // POIs estratégicos com nome
      const poisEst = poiEls
        .filter(el => el.lat && el.lon && (el.tags?.name || el.tags?.ref))
        .map(el => ({
          lat: el.lat, lng: el.lon,
          nome: el.tags?.name || el.tags?.ref || '',
        }));

      // 2. Calcula score para cada esquina
      const resultados: Candidato[] = [];
      const seen = new Set<string>();

      for (const el of esquinaEls) {
        if (!el.lat || !el.lon) continue;
        // Deduplica por grid de 50m
        const gridKey = `${Math.round(el.lat*666)},${Math.round(el.lon*666)}`; // ~150m grid
        if (seen.has(gridKey)) continue;
        seen.add(gridKey);

        const s = calcularScore(
          el.lat, el.lon,
          estacoes,
          ridesAnalytics,
          poisEst,
          raioGap,
          raioFluxo,
        );

        if (s.score < minScore) continue;
        if (s.distEst < raioGap * 0.5) continue; // muito perto de estação existente

        resultados.push({
          id: `cand-${el.id}`,
          lat: el.lat, lng: el.lon,
          score: s.score,
          scoreGap: s.scoreGap,
          scoreFluxo: s.scoreFluxo,
          scorePOI: s.scorePOI,
          distanciaEstacao: s.distEst,
          corridasProximas: s.corridas,
          poisProximos: s.pois,
          semAnalytics: s.semAnalytics,
          via1: el.tags?.['name'] || '',
          via2: el.tags?.['alt_name'] || '',
        });
      }

      // Ordena por score desc, pega top 50
      // Remove candidatos muito próximos entre si (mantém só o melhor de cada cluster)
      const finalResults: typeof resultados = [];
      const usedPositions: {lat:number,lng:number}[] = [];
      for (const c of resultados.sort((a,b) => b.score-a.score)) {
        const tooClose = usedPositions.some(p => haversine(c.lat,c.lng,p.lat,p.lng) < 150);
        if (!tooClose) { finalResults.push(c); usedPositions.push({lat:c.lat,lng:c.lng}); }
        if (finalResults.length >= 30) break;
      }
      const sorted = finalResults;
      cacheRef.current[cacheKey] = sorted;
      setCandidatos(sorted);
      onCandidatosChange(sorted);
      setProgresso('');
    } catch(e) {
      setProgresso('Erro ao buscar esquinas.');
    }
    setLoading(false);
  }, [mapCenter, estacoes, ridesAnalytics, raioArea, raioGap, raioFluxo, minScore]);

  const limpar = () => {
    setCandidatos([]);
    onCandidatosChange([]);
  };

  const scoreColor = (s: number) =>
    s >= 70 ? '#2ecc71' : s >= 40 ? '#f5c842' : '#ff6b35';

  const scoreBar = (val: number, color: string) => (
    <div style={{flex:1,height:3,background:'#1c2535',borderRadius:2}}>
      <div style={{height:'100%',borderRadius:2,background:color,width:`${val}%`,transition:'width .3s'}}/>
    </div>
  );

  return (
    <>
      {/* Botão trigger */}
      <button
        onClick={() => setAberto(v => !v)}
        style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'6px 12px', borderRadius:8,
          border:`1px solid ${aberto?'rgba(245,200,66,.4)':'rgba(255,255,255,.1)'}`,
          background: aberto?'rgba(245,200,66,.12)':'rgba(255,255,255,.06)',
          color: aberto?'#f5c842':'rgba(255,255,255,.5)',
          cursor:'pointer', fontSize:12, fontWeight:600,
        }}
      >
        🎯 Pt. Candidatos{candidatos.length>0?` (${candidatos.length})`:''}
      </button>

      {/* Painel */}
      {aberto && (
        <div style={{
          position:'fixed', right: drawerAberto ? 344 : 0, top:0, bottom:0, width:300,
          background:'#0c1018', borderLeft:'1px solid #1c2535',
          zIndex:800, display:'flex', flexDirection:'column',
          fontFamily:"'DM Sans',sans-serif",
          boxShadow:'-8px 0 32px rgba(0,0,0,.8)',
          backdropFilter:'blur(0px)',
          transition:'right .2s ease',
        }}>
          {/* Header */}
          <div style={{padding:'14px 16px',borderBottom:'1px solid #1c2535',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:18}}>🎯</span>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:'#dce8ff',lineHeight:1.2}}>Candidatos a Estação</div>
                  <div style={{fontSize:9,color:'#4a5a7a',marginTop:1}}>Esquinas OSM · Gap + Fluxo + POI</div>
                </div>
              </div>
              <button onClick={()=>setAberto(false)} style={{background:'none',border:'none',color:'#4a5a7a',cursor:'pointer',fontSize:18,padding:'4px',borderRadius:4}}>✕</button>
            </div>
            {ridesAnalytics.length === 0 && (
              <div style={{padding:'6px 8px',background:'rgba(245,200,66,.06)',border:'1px solid rgba(245,200,66,.15)',borderRadius:6,fontSize:9,color:'#f5c842',marginBottom:6}}>
                ⚠ Sem dados Analytics — score usa Gap(55%) + POI(45%)
              </div>
            )}
            <div style={{display:'flex',gap:6}}>
              {(ridesAnalytics.length>0
                ? [['Gap','#3d9bff','40%'],['Fluxo','#2ecc71','35%'],['POI','#f5c842','25%']]
                : [['Gap','#3d9bff','55%'],['POI','#f5c842','45%']]
              ).map(([l,c,p])=>(
                <div key={String(l)} style={{flex:1,padding:'4px 6px',background:'rgba(255,255,255,.03)',borderRadius:5,border:'1px solid rgba(255,255,255,.06)',textAlign:'center'}}>
                  <div style={{fontSize:9,color:String(c),fontWeight:700}}>{l}</div>
                  <div style={{fontSize:9,color:'#4a5a7a'}}>{p}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Configurações */}
          <div style={{padding:'12px 16px',borderBottom:'1px solid #1c2535',flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'#4a5a7a',marginBottom:10}}>Parâmetros</div>
            {([
              ['Raio busca',raioArea,setRaioArea,500,3000,100,'m','Área ao redor do centro do mapa para buscar esquinas no OSM.'],
              ['Gap mín JET',raioGap,setRaioGap,100,600,50,'m','Candidatos mais próximos que isso de uma estação JET são descartados.'],
              ['Raio fluxo',raioFluxo,setRaioFluxo,50,400,50,'m','Raio para contar corridas Analytics próximas ao candidato (peso 35%).'],
              ['Score mín',minScore,setMinScore,0,80,10,'','Score mínimo para exibir. Combina Gap(40%)+Fluxo(35%)+POI(25%).'],
            ] as [string,number,React.Dispatch<React.SetStateAction<number>>,number,number,number,string,string][]).map(([lbl,val,set,min,max,step,unit,help])=>(
              <div key={lbl} style={{marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                  <span style={{fontSize:10,color:'#dce8ff',flex:1}}>{lbl}</span>
                  <div className="help-tip" style={{position:'relative',display:'inline-block'}}>
                    <div style={{width:14,height:14,borderRadius:'50%',background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,color:'#4a5a7a',cursor:'default',userSelect:'none' as any}}>?</div>
                    <div style={{position:'absolute',right:0,bottom:18,background:'#111722',border:'1px solid #1c2535',borderRadius:6,padding:'8px 10px',fontSize:10,color:'#dce8ff',width:180,lineHeight:1.5,zIndex:999,boxShadow:'0 4px 16px rgba(0,0,0,.8)',pointerEvents:'none',opacity:0,transition:'opacity .15s'}}
                      className="help-text">{help}</div>
                  </div>
                  <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:'#f5c842',width:44,textAlign:'right'}}>{val}{unit}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={val}
                  onChange={e=>set(Number(e.target.value))}
                  style={{width:'100%',height:3,appearance:'none' as any,background:'#1c2535',borderRadius:2,cursor:'pointer'}}/>
              </div>
            ))}
            <style>{'.help-tip:hover .help-text { opacity: 1 !important; }'}</style>
            <div style={{display:'flex',gap:6,marginTop:8}}>
              <button onClick={buscar} disabled={loading} style={{
                flex:2, padding:'8px', borderRadius:6, border:'none',
                background: loading?'rgba(245,200,66,.2)':'rgba(245,200,66,.9)',
                color: loading?'#f5c842':'#000',
                cursor: loading?'not-allowed':'pointer', fontSize:12, fontWeight:700,
              }}>
                {loading ? '⏳ Buscando...' : '🔍 Buscar candidatos'}
              </button>
              {candidatos.length>0 && (
                <button onClick={limpar} style={{
                  flex:1, padding:'8px', borderRadius:6,
                  border:'1px solid #1c2535', background:'rgba(255,255,255,.04)',
                  color:'#4a5a7a', cursor:'pointer', fontSize:11,
                }}>Limpar</button>
              )}
            </div>
            {progresso && (
              <div style={{marginTop:6,fontSize:10,color:'#3d9bff',fontFamily:"'IBM Plex Mono',monospace"}}>{progresso}</div>
            )}
          </div>

          {/* Lista */}
          <div style={{flex:1,overflowY:'auto'}}>
            {candidatos.length===0 && !loading && (
              <div style={{padding:24,textAlign:'center',color:'#4a5a7a',fontSize:12}}>
                Configure os parâmetros e clique em Buscar.
              </div>
            )}
            {candidatos.map((c,i)=>(
              <div key={c.id}
                onClick={()=>setSelectedId(selectedId===c.id?null:c.id)}
                style={{
                  padding:'10px 14px', borderBottom:'1px solid #1c2535',
                  cursor:'pointer', transition:'background .12s',
                  background: selectedId===c.id?'rgba(245,200,66,.06)':'transparent',
                }}>
                {/* Linha principal */}
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <div style={{
                    width:26,height:26,borderRadius:'50%',flexShrink:0,
                    background:`${scoreColor(c.score)}22`,
                    border:`2px solid ${scoreColor(c.score)}`,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,
                    color:scoreColor(c.score),
                  }}>{c.score}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#dce8ff'}}>
                      Candidato #{i+1}
                    </div>
                    <div style={{fontSize:9,color:'#4a5a7a',fontFamily:"'IBM Plex Mono',monospace"}}>
                      {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                    </div>
                  </div>
                  <div style={{fontSize:9,color:c.distanciaEstacao>raioGap?'#2ecc71':'#f5c842',fontFamily:"'IBM Plex Mono',monospace",textAlign:'right'}}>
                    {c.distanciaEstacao}m<br/>
                    <span style={{color:'#4a5a7a'}}>da JET</span>
                  </div>
                </div>

                {/* Barras de score */}
                <div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:4}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:8,color:'#4a5a7a',width:40}}>Gap</span>
                    {scoreBar(c.scoreGap,'#3d9bff')}
                    <span style={{fontSize:8,color:'#3d9bff',width:24,textAlign:'right'}}>{c.scoreGap}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:8,color:'#4a5a7a',width:40}}>Fluxo</span>
                    {scoreBar(c.scoreFluxo,'#2ecc71')}
                    <span style={{fontSize:8,color:'#2ecc71',width:24,textAlign:'right'}}>{c.scoreFluxo}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:8,color:'#4a5a7a',width:40}}>POI</span>
                    {scoreBar(c.scorePOI,'#f5c842')}
                    <span style={{fontSize:8,color:'#f5c842',width:24,textAlign:'right'}}>{c.scorePOI}</span>
                  </div>
                </div>

                {/* Tags */}
                <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:selectedId===c.id?8:0}}>
                  {c.semAnalytics && (
                    <div style={{padding:'1px 6px',borderRadius:8,background:'rgba(245,200,66,.08)',border:'1px solid rgba(245,200,66,.15)',fontSize:9,color:'#f5c842'}}>
                      sem Analytics
                    </div>
                  )}
                  {!c.semAnalytics && c.corridasProximas>0 && (
                    <div style={{padding:'1px 6px',borderRadius:8,background:'rgba(46,204,113,.12)',border:'1px solid rgba(46,204,113,.2)',fontSize:9,color:'#2ecc71'}}>
                      {c.corridasProximas} corridas
                    </div>
                  )}
                  {!c.semAnalytics && c.corridasProximas===0 && (
                    <div style={{padding:'1px 6px',borderRadius:8,background:'rgba(100,116,139,.1)',border:'1px solid rgba(100,116,139,.2)',fontSize:9,color:'#64748b'}}>
                      0 corridas
                    </div>
                  )}
                  {c.poisProximos.map(p=>(
                    <div key={p} style={{padding:'1px 6px',borderRadius:8,background:'rgba(245,200,66,.1)',border:'1px solid rgba(245,200,66,.2)',fontSize:9,color:'#f5c842',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {p}
                    </div>
                  ))}
                </div>

                {/* Ações — expandido */}
                {selectedId===c.id && (
                  <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:6}}>
                    {/* Ação principal */}
                    <button
                      onClick={e=>{
                        e.stopPropagation();
                        onAbrirDrawer(c.lat,c.lng);
                        setAberto(false); // fecha painel para ver o drawer
                      }}
                      style={{
                        width:'100%',padding:'10px',borderRadius:7,border:'none',
                        background:'linear-gradient(135deg,#1a6fd4,#307FE2)',
                        color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',
                        display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                      }}>
                      <span style={{fontSize:16}}>📍</span>
                      <div style={{textAlign:'left'}}>
                        <div>Adicionar estação aqui</div>
                        <div style={{fontSize:9,fontWeight:400,opacity:.8}}>Abre o drawer com coordenadas preenchidas</div>
                      </div>
                    </button>
                    {/* Ações secundárias */}
                    <div style={{display:'flex',gap:5}}>
                      <button
                        onClick={e=>{
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('jetFlyTo',{detail:{lat:c.lat,lng:c.lng,zoom:19}}));
                        }}
                        style={{flex:1,padding:'7px',borderRadius:6,border:'1px solid #1c2535',background:'rgba(255,255,255,.04)',color:'#4a5a7a',fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                        🗺 Ver no mapa
                      </button>
                      <button
                        onClick={e=>{
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('jetOpenSV',{detail:{lat:c.lat,lng:c.lng,nome:'Candidato #'+(i+1)}}));
                        }}
                        style={{flex:1,padding:'7px',borderRadius:6,border:'1px solid #1c2535',background:'rgba(255,255,255,.04)',color:'#4a5a7a',fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                        🌐 Street View
                      </button>
                      <button
                        onClick={e=>{
                          e.stopPropagation();
                          navigator.clipboard.writeText(c.lat.toFixed(6)+', '+c.lng.toFixed(6));
                        }}
                        style={{padding:'7px 10px',borderRadius:6,border:'1px solid #1c2535',background:'rgba(255,255,255,.04)',color:'#4a5a7a',fontSize:10,cursor:'pointer'}}>
                        📋
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer stats */}
          {candidatos.length>0 && (
            <div style={{padding:'8px 16px',borderTop:'1px solid #1c2535',flexShrink:0,display:'flex',gap:16}}>
              {[
                ['Alta prio',candidatos.filter(c=>c.score>=70).length,'#2ecc71'],
                ['Média',candidatos.filter(c=>c.score>=40&&c.score<70).length,'#f5c842'],
                ['Baixa',candidatos.filter(c=>c.score<40).length,'#ff6b35'],
              ].map(([l,v,c])=>(
                <div key={String(l)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:700,color:String(c)}}>{v}</div>
                  <div style={{fontSize:9,color:'#4a5a7a'}}>{l}</div>
                </div>
              ))}
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                <div style={{fontSize:9,color:'#4a5a7a'}}>custo: R$0,00</div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
