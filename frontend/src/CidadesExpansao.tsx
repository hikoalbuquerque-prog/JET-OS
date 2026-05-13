// src/components/CidadesExpansao.tsx
// Planejamento de expansão para novas cidades

import { useState, useEffect } from 'react';
import { db } from './lib/firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';

export type StatusExpansao = 'em_analise' | 'aprovada' | 'em_implantacao' | 'ativa' | 'descartada';

export interface CidadeExpansao {
  id: string;
  nome: string;
  pais: string;
  lat: number;
  lng: number;
  populacao?: number;
  mercadoEst?: number;       // corridas/mês estimadas
  investimentoEst?: number;  // R$
  status: StatusExpansao;
  dataPrevista?: string;     // YYYY-MM-DD
  responsavel?: string;
  obs?: string;
  criadoEm?: any;
  atualizadoEm?: any;
}

export const STATUS_META: Record<StatusExpansao, { label: string; cor: string; icon: string }> = {
  em_analise:      { label: 'Em análise',      cor: '#60a5fa', icon: '🔍' },
  aprovada:        { label: 'Aprovada',         cor: '#2ecc71', icon: '✅' },
  em_implantacao:  { label: 'Em implantação',   cor: '#f5c842', icon: '🚧' },
  ativa:           { label: 'Ativa',            cor: '#34d399', icon: '🟢' },
  descartada:      { label: 'Descartada',       cor: '#6b7280', icon: '❌' },
};

export function useCidadesExpansao() {
  const [cidades, setCidades] = useState<CidadeExpansao[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'cidades_expansao'), orderBy('criadoEm', 'desc'));
    return onSnapshot(q, snap => {
      setCidades(snap.docs.map(d => ({ id: d.id, ...d.data() } as CidadeExpansao)));
    });
  }, []);
  return cidades;
}

// ── MODAL CADASTRO/EDIÇÃO ─────────────────────────────────────────
export function CidadeExpansaoModal({
  editando, latLng, onFechar, showToast,
}: {
  editando?: CidadeExpansao | null;
  latLng?: { lat: number; lng: number };
  onFechar: () => void;
  showToast: (msg: string, type?: string) => void;
}) {
  const [nome,            setNome]            = useState(editando?.nome || '');
  const [pais,            setPais]            = useState(editando?.pais || 'BR');
  const [lat,             setLat]             = useState(editando?.lat || latLng?.lat || 0);
  const [lng,             setLng]             = useState(editando?.lng || latLng?.lng || 0);
  const [status,          setStatus]          = useState<StatusExpansao>(editando?.status || 'em_analise');
  const [populacao,       setPopulacao]       = useState(String(editando?.populacao || ''));
  const [mercadoEst,      setMercadoEst]      = useState(String(editando?.mercadoEst || ''));
  const [investimentoEst, setInvestimentoEst] = useState(String(editando?.investimentoEst || ''));
  const [dataPrevista,    setDataPrevista]    = useState(editando?.dataPrevista || '');
  const [responsavel,     setResponsavel]     = useState(editando?.responsavel || '');
  const [obs,             setObs]             = useState(editando?.obs || '');
  const [busy,            setBusy]            = useState(false);
  const [analisando,      setAnalisando]      = useState(false);
  const [analise,         setAnalise]         = useState<{
    score: number; pois: number; ciclovias: number; estimativa: number;
    detalhe: string[]; benchmark: string;
  } | null>(null);

  // Geocode cidade pelo nome
  const geocodeCidade = async () => {
    if (!nome.trim()) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(nome)}&format=json&limit=1`);
      const d = await r.json();
      if (d[0]) { setLat(parseFloat(d[0].lat)); setLng(parseFloat(d[0].lon)); }
    } catch {}
  };

  const analisarCidade = async () => {
    if (!lat || !lng) { showToast('Geocode a cidade primeiro (clique em 📍)', 'error'); return; }
    setAnalisando(true); setAnalise(null);
    const detalhe: string[] = [];
    try {
      // ── 1. POIs via Overpass ──────────────────────────────────
      const radius = 5000; // 5km do centro
      const overpassQ = `[out:json][timeout:20];(
        node["amenity"~"university|college|school"](around:${radius},${lat},${lng});
        node["shop"="mall"](around:${radius},${lat},${lng});
        node["public_transport"="station"](around:${radius},${lat},${lng});
        node["railway"~"subway_entrance|station"](around:${radius},${lat},${lng});
        node["amenity"~"restaurant|cafe|bar"](around:${radius},${lat},${lng});
        way["leisure"="park"](around:${radius},${lat},${lng});
      );out count;`;
      let pois = 0;
      try {
        const r = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST', body: overpassQ,
        });
        const d = await r.json();
        pois = d.elements?.[0]?.tags?.total || 0;
        detalhe.push('POIs num raio 5km: ' + pois);
      } catch { detalhe.push('POIs: erro ao buscar'); }

      // ── 2. Ciclovias via Overpass ─────────────────────────────
      const ciclQ = `[out:json][timeout:15];(
        way["highway"="cycleway"](around:10000,${lat},${lng});
        way["bicycle"="designated"](around:10000,${lat},${lng});
      );out count;`;
      let ciclovias = 0;
      try {
        const r2 = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST', body: ciclQ,
        });
        const d2 = await r2.json();
        ciclovias = d2.elements?.[0]?.tags?.total || 0;
        detalhe.push('Trechos de ciclovia: ' + ciclovias);
      } catch { detalhe.push('Ciclovias: erro ao buscar'); }

      // ── 3. Score 0-100 ────────────────────────────────────────
      // Benchmark SP: ~8000 POIs, ~400 ciclovias, 4865 corridas/dia
      const SP_POIS = 8000; const SP_CICL = 400;
      const scorePOI   = Math.min(100, Math.round((pois / SP_POIS) * 100));
      const scoreCicl  = Math.min(100, Math.round((ciclovias / SP_CICL) * 100));
      const pop = Number(populacao) || 0;
      const SP_POP = 12300000;
      const scorePop   = pop > 0 ? Math.min(100, Math.round((pop / SP_POP) * 100)) : 30;
      const score = Math.round(scorePOI * 0.45 + scoreCicl * 0.25 + scorePop * 0.30);
      detalhe.push('Score POIs: ' + scorePOI + '/100');
      detalhe.push('Score mobilidade: ' + scoreCicl + '/100');
      detalhe.push('Score população: ' + scorePop + '/100');

      // ── 4. Estimativa corridas/mês ────────────────────────────
      // SP: ~4500 corridas/dia média → ~135.000/mês para ~1200 estações
      // Corridas por estação/dia = 4500/1200 ≈ 3.75
      // Estima estações necessárias: 1 a cada 400m numa área de 10km²
      // Área útil ≈ score% do raio de 5km
      const areaKm2 = Math.PI * 5 * 5 * (score / 100);
      const estacoesEst = Math.round(areaKm2 * 4); // ~4 est/km² em SP
      const corridasDia = Math.round(estacoesEst * 3.75 * (score / 100));
      const estimativa = corridasDia * 30;

      const benchmark = score >= 70
        ? 'Perfil similar a bairros centrais de SP (Pinheiros, Vila Madalena)'
        : score >= 40
        ? 'Perfil similar a bairros intermediários de SP (Tatuapé, Santo André)'
        : 'Mercado menor — recomendado piloto com 10-20 estações';

      detalhe.push('Estações estimadas: ' + estacoesEst);
      detalhe.push('Corridas/dia est.: ' + corridasDia);

      setAnalise({ score, pois, ciclovias, estimativa, detalhe, benchmark });
      if (!mercadoEst) setMercadoEst(String(estimativa));
    } catch (e: any) { showToast('Erro na análise: ' + e.message, 'error'); }
    setAnalisando(false);
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast('Informe o nome da cidade', 'error'); return; }
    if (!lat || !lng)  { showToast('Informe as coordenadas', 'error'); return; }
    setBusy(true);
    try {
      const raw: Record<string, any> = {
        nome: nome.trim(), pais, lat, lng, status,
        atualizadoEm: serverTimestamp(),
      };
      if (populacao)       raw.populacao       = Number(populacao);
      if (mercadoEst)      raw.mercadoEst      = Number(mercadoEst);
      if (investimentoEst) raw.investimentoEst = Number(investimentoEst);
      if (dataPrevista)    raw.dataPrevista    = dataPrevista;
      if (responsavel)     raw.responsavel     = responsavel;
      if (obs)             raw.obs             = obs;

      if (editando) {
        await updateDoc(doc(db, 'cidades_expansao', editando.id), raw);
        showToast('Cidade atualizada', 'success');
      } else {
        await addDoc(collection(db, 'cidades_expansao'), { ...raw, criadoEm: serverTimestamp() });
        showToast('Cidade adicionada ao planejamento', 'success');
      }
      onFechar();
    } catch (e: any) { showToast('Erro: ' + e.message, 'error'); }
    setBusy(false);
  };

  const excluir = async () => {
    if (!editando || !confirm(`Excluir "${editando.nome}"?`)) return;
    await deleteDoc(doc(db, 'cidades_expansao', editando.id));
    showToast('Cidade removida', 'success');
    onFechar();
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.1)', borderRadius: 7,
    color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 3, display: 'block' };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)' }}
      onClick={onFechar}>
      <div style={{ background:'#0c1018', border:'1px solid #1c2535', borderRadius:12, width:380, maxWidth:'94vw', maxHeight:'90vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,.9)' }}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #1c2535', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#dce8ff' }}>
            {editando ? '✏ Editar cidade' : '🌍 Nova cidade — Expansão'}
          </div>
          <button onClick={onFechar} style={{ background:'none', border:'none', color:'#4a5a7a', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 18px', display:'flex', flexDirection:'column', gap:12 }}>

          {/* Status */}
          <div>
            <label style={lbl}>Status</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {(Object.keys(STATUS_META) as StatusExpansao[]).map(s => {
                const m = STATUS_META[s];
                return (
                  <button key={s} onClick={() => setStatus(s)} style={{
                    padding:'5px 10px', borderRadius:8, border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
                    background: status===s ? m.cor+'22' : 'rgba(255,255,255,.04)',
                    color: status===s ? m.cor : 'rgba(255,255,255,.3)',
                    outline: status===s ? `1px solid ${m.cor}66` : '1px solid rgba(255,255,255,.08)',
                  }}>{m.icon} {m.label}</button>
                );
              })}
            </div>
          </div>

          {/* Nome + geocode */}
          <div>
            <label style={lbl}>Nome da cidade *</label>
            <div style={{ display:'flex', gap:6 }}>
              <input value={nome} onChange={e=>setNome(e.target.value)}
                placeholder="Ex: Curitiba" style={{ ...inp, flex:1 }} />
              <button onClick={geocodeCidade} title="Buscar coordenadas"
                style={{ padding:'8px 10px', borderRadius:7, border:'1px solid rgba(61,155,255,.3)', background:'rgba(61,155,255,.1)', color:'#3d9bff', cursor:'pointer', fontSize:12 }}>
                📍
              </button>
            </div>
          </div>

          {/* País + Coords */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            <div>
              <label style={lbl}>País</label>
              <input value={pais} onChange={e=>setPais(e.target.value)} placeholder="BR" style={inp} />
            </div>
            <div>
              <label style={lbl}>Latitude</label>
              <input type="number" value={lat} onChange={e=>setLat(parseFloat(e.target.value))} step="0.0001" style={inp} />
            </div>
            <div>
              <label style={lbl}>Longitude</label>
              <input type="number" value={lng} onChange={e=>setLng(parseFloat(e.target.value))} step="0.0001" style={inp} />
            </div>
          </div>

          {/* Métricas */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            <div>
              <label style={lbl}>População</label>
              <input type="number" value={populacao} onChange={e=>setPopulacao(e.target.value)} placeholder="hab." style={inp} />
            </div>
            <div>
              <label style={lbl}>Corridas/mês est.</label>
              <input type="number" value={mercadoEst} onChange={e=>setMercadoEst(e.target.value)} placeholder="0" style={inp} />
            </div>
            <div>
              <label style={lbl}>Investimento R$</label>
              <input type="number" value={investimentoEst} onChange={e=>setInvestimentoEst(e.target.value)} placeholder="0" style={inp} />
            </div>
          </div>

          {/* Data + Responsável */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div>
              <label style={lbl}>Data prevista</label>
              <input type="date" value={dataPrevista} onChange={e=>setDataPrevista(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Responsável</label>
              <input value={responsavel} onChange={e=>setResponsavel(e.target.value)} placeholder="Nome" style={inp} />
            </div>
          </div>

          {/* Obs */}
          <div>
            <label style={lbl}>Observações</label>
            <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={3}
              placeholder="Contexto, parceiros, riscos..." style={{ ...inp, resize:'vertical' as any }} />
          </div>
        </div>

        {/* Análise automática */}
        <div>
          <button onClick={analisarCidade} disabled={analisando || !lat || !lng} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: analisando || !lat || !lng ? 'not-allowed' : 'pointer',
            background: analisando ? 'rgba(99,102,241,.3)' : 'linear-gradient(135deg,rgba(99,102,241,.8),rgba(139,92,246,.8))',
            color: '#fff', fontSize: 12, fontWeight: 700,
          }}>
            {analisando ? '⏳ Analisando via OSM...' : '🤖 Analisar potencial da cidade'}
          </button>

          {analise && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 8,
              background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)' }}>

              {/* Score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: 56, height: 56, transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3"/>
                    <circle cx="18" cy="18" r="15.9" fill="none"
                      stroke={analise.score >= 70 ? '#2ecc71' : analise.score >= 40 ? '#f5c842' : '#f87171'}
                      strokeWidth="3" strokeDasharray={`${analise.score} ${100 - analise.score}`}
                      strokeLinecap="round"/>
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 13, fontWeight: 800,
                    color: analise.score >= 70 ? '#2ecc71' : analise.score >= 40 ? '#f5c842' : '#f87171',
                    fontFamily: "'IBM Plex Mono',monospace" }}>{analise.score}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#dce8ff', marginBottom: 3 }}>
                    Score de potencial
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', lineHeight: 1.4 }}>
                    {analise.benchmark}
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
                {([
                  ['POIs', analise.pois.toLocaleString('pt-BR'), '#60a5fa'],
                  ['Ciclovias', analise.ciclovias + ' trechos', '#2ecc71'],
                  ['Est. corridas/mês', analise.estimativa.toLocaleString('pt-BR'), '#f5c842'],
                ] as [string,string,string][]).map(([l,v,c]) => (
                  <div key={l} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6,
                    padding: '7px 6px', textAlign: 'center', border: '1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c,
                      fontFamily: "'IBM Plex Mono',monospace" }}>{v}</div>
                    <div style={{ fontSize: 9, color: '#4a5a7a', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Detalhes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {analise.detalhe.map((d, i) => (
                  <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,.35)',
                    display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ color: '#818cf8', flexShrink: 0 }}>›</span>{d}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,.25)', fontStyle: 'italic' }}>
                Estimativa preenchida em "Corridas/mês est." automaticamente.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid #1c2535', display:'flex', gap:8 }}>
          {editando && (
            <button onClick={excluir} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid rgba(239,68,68,.3)', background:'rgba(239,68,68,.08)', color:'#ef4444', cursor:'pointer', fontSize:12 }}>🗑</button>
          )}
          <button onClick={onFechar} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid rgba(255,255,255,.08)', background:'rgba(255,255,255,.04)', color:'rgba(255,255,255,.4)', cursor:'pointer', fontSize:12 }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background: busy?'rgba(48,127,226,.3)':'linear-gradient(135deg,#1a6fd4,#307FE2)', color:'#fff', fontSize:13, fontWeight:700, cursor: busy?'not-allowed':'pointer' }}>
            {busy ? 'Salvando...' : editando ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}
