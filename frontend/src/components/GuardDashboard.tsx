// frontend/src/components/GuardDashboard.tsx — JET OS V2
// Dashboard Guard — Roubos · Vandalismo · Perdas
// Acesso: admin, gestor, gestor_seg
// Design: dark ops command center — dados que salvam ativos

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';

// ─── tipos ───────────────────────────────────────────────────────────────────

interface Ocorrencia {
  id: string;
  tipo: string;
  status: string;
  criadoEm?: any;
  danoPct?: number;
  danoValor?: number;
  cidade_inicial?: string;
  asset_id?: string;
  ativo_tipo?: string;
}

type Periodo = 'hoje' | 'ontem' | '7d' | '30d' | '365d' | 'total';

// Dados acumulados planilha 06/06/26
const BRPD_TOTAL = 416;
const BRPD_PATINS = 406;
const BRPD_BIKES = 10;

// ─── helpers ─────────────────────────────────────────────────────────────────

function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function inicioHoje(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function inicioPeriodo(p: Periodo): Date {
  const agora = new Date();
  if (p === 'hoje')  { agora.setHours(0,0,0,0); return agora; }
  if (p === 'ontem') { agora.setDate(agora.getDate()-1); agora.setHours(0,0,0,0); return agora; }
  if (p === '7d')    return new Date(agora.getTime() - 7*86400000);
  if (p === '30d')   return new Date(agora.getTime() - 30*86400000);
  if (p === '365d')  return new Date(agora.getTime() - 365*86400000);
  return new Date(0); // total
}

function fimPeriodo(p: Periodo): Date {
  if (p === 'ontem') {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  }
  return new Date(Date.now() + 86400000);
}

function filtrarPeriodo(ocs: Ocorrencia[], p: Periodo): Ocorrencia[] {
  if (p === 'total') return ocs;
  const ini = inicioPeriodo(p).getTime();
  const fim = fimPeriodo(p).getTime();
  return ocs.filter(o => {
    const d = toDate(o.criadoEm);
    if (!d) return false;
    return d.getTime() >= ini && d.getTime() <= fim;
  });
}

function pct(v: number, total: number) {
  return total > 0 ? Math.round(v / total * 100) : 0;
}

function fmtNum(n: number): string {
  return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
}

// ─── micro sparkline SVG ──────────────────────────────────────────────────────

function Sparkline({ values, cor, h = 28, w = 80 }: { values: number[]; cor: string; h?: number; w?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} style={{ overflow:'visible' }}>
      <polyline points={pts} fill="none" stroke={cor} strokeWidth="1.5" strokeLinejoin="round" opacity="0.8"/>
      <circle cx={(values.length-1)*step} cy={h - (values[values.length-1]/max)*(h-2)-1}
        r="2.5" fill={cor}/>
    </svg>
  );
}

// ─── barra de progresso horizontal ───────────────────────────────────────────

function BarraHoriz({ v, max, cor, label }: { v: number; max: number; cor: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
        <span style={{ fontSize:10, color:'rgba(255,255,255,.5)' }}>{label}</span>
        <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,.8)' }}>{v}</span>
      </div>
      <div style={{ height:5, background:'rgba(255,255,255,.07)', borderRadius:3 }}>
        <div style={{ height:5, width:`${pct}%`, background:cor, borderRadius:3,
          transition:'width .4s ease' }}/>
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, valor, sub, cor, delta, sparkline, corSpark, warn, icon
}: {
  label: string; valor: number | string; sub?: string;
  cor: string; delta?: number; sparkline?: number[];
  corSpark?: string; warn?: boolean; icon?: string;
}) {
  const showDelta = delta !== undefined && delta !== 0;
  const up = (delta ?? 0) > 0;
  return (
    <div style={{
      background: warn ? `${cor}18` : 'rgba(255,255,255,.04)',
      border: `1px solid ${warn ? cor + '40' : 'rgba(255,255,255,.08)'}`,
      borderTop: `2px solid ${cor}`,
      borderRadius: 10, padding: '12px 14px',
      display:'flex', flexDirection:'column', gap:4,
      position:'relative', overflow:'hidden',
    }}>
      {/* Glow de fundo para críticos */}
      {warn && <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse at top left, ${cor}15, transparent 70%)`, pointerEvents:'none' }}/>}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.4)',
          textTransform:'uppercase', letterSpacing:'.8px' }}>{icon && icon+' '}{label}</span>
        {showDelta && (
          <span style={{ fontSize:9, fontWeight:700,
            color: up ? '#ef4444' : '#22c55e',
            background: up ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)',
            padding:'1px 5px', borderRadius:4 }}>
            {up ? '▲' : '▼'} {Math.abs(delta!)}
          </span>
        )}
      </div>

      <div style={{ fontSize:28, fontWeight:900, color:cor, lineHeight:1, letterSpacing:'-1px' }}>
        {typeof valor === 'number' ? fmtNum(valor) : valor}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
        {sub && <span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>{sub}</span>}
        {sparkline && sparkline.length > 1 && (
          <Sparkline values={sparkline} cor={corSpark || cor} />
        )}
      </div>
    </div>
  );
}

// ─── Seção com título ──────────────────────────────────────────────────────────

function Secao({ titulo, cor, children }: { titulo: string; cor: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
        <div style={{ width:3, height:16, background:cor, borderRadius:2 }}/>
        <span style={{ fontSize:10, fontWeight:800, color:cor,
          textTransform:'uppercase', letterSpacing:'1.2px' }}>{titulo}</span>
        <div style={{ flex:1, height:1, background:`${cor}20` }}/>
      </div>
      {children}
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

interface Props {
  visivel: boolean;
  onFechar: () => void;
  roleUsuario?: string;
}

const PERIODOS: { k: Periodo; l: string }[] = [
  { k:'hoje',  l:'Hoje' },
  { k:'ontem', l:'Ontem' },
  { k:'7d',    l:'7d' },
  { k:'30d',   l:'30d' },
  { k:'365d',  l:'1 Ano' },
  { k:'total', l:'Total' },
];

export default function GuardDashboard({ visivel, onFechar, roleUsuario = 'admin' }: Props) {
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<Periodo>('7d');

  useEffect(() => {
    if (!visivel) return;
    const q = query(collection(db, 'ocorrencias'), orderBy('criadoEm', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ocorrencia)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [visivel]);

  // ── filtrado pelo período selecionado
  const ocs = useMemo(() => filtrarPeriodo(ocorrencias, periodo), [ocorrencias, periodo]);

  // ── dados do período anterior para delta
  const periodoAnterior: Periodo = periodo === 'hoje' ? 'ontem' : periodo === '7d' ? '7d' : '30d';
  const ocsAnt = useMemo(() => {
    if (periodo === 'total') return [];
    const ini = inicioPeriodo(periodo).getTime();
    const dur = ini > 0 ? Date.now() - ini : 0;
    const iniAnt = ini - dur;
    return ocorrencias.filter(o => {
      const d = toDate(o.criadoEm);
      if (!d) return false;
      return d.getTime() >= iniAnt && d.getTime() < ini;
    });
  }, [ocorrencias, periodo]);

  // ── métricas principais
  const M = useMemo(() => {
    const isAberto = (o: Ocorrencia) => !/recuper|encerr/i.test(o.status||'');
    const isRecup  = (o: Ocorrencia) => /recuper/i.test(o.status||'');

    const roubos      = ocs.filter(o => o.tipo === 'Roubo');
    const tentativas  = ocs.filter(o => o.tipo === 'Tentativa');
    const vandalismos = ocs.filter(o => o.tipo === 'Vandalismo');
    const recuperadas = ocs.filter(o => o.tipo === 'Recuperacao' || isRecup(o));

    return {
      total:        ocs.length,
      // Roubos
      roubosTotal:  roubos.length,
      roubosAbertos: roubos.filter(isAberto).length,
      roubosRecup:  roubos.filter(isRecup).length,
      taxaRecupR:   pct(roubos.filter(isRecup).length, roubos.length),
      tentativas:   tentativas.length,
      // Vandalismo
      vandTotal:    vandalismos.length,
      vandAbertos:  vandalismos.filter(isAberto).length,
      vandRecup:    vandalismos.filter(isRecup).length,
      taxaRecupV:   pct(vandalismos.filter(isRecup).length, vandalismos.length),
      vandPatins:   vandalismos.filter(o => /patinete/i.test(o.ativo_tipo||'')).length,
      vandBikes:    vandalismos.filter(o => /bicicleta|bike/i.test(o.ativo_tipo||'')).length,
      vandBat:      vandalismos.filter(o => /bateria/i.test(o.ativo_tipo||'')).length,
      // Danos oficina
      vandComDano:      vandalismos.filter(o => o.danoValor != null && o.danoValor > 0).length,
      danoValorTotal:   vandalismos.reduce((s,o) => s + (o.danoValor||0), 0),
      danoPctMedio:     (() => {
        const comPct = vandalismos.filter(o => o.danoPct != null && o.danoPct > 0);
        return comPct.length > 0 ? Math.round(comPct.reduce((s,o)=>s+(o.danoPct||0),0)/comPct.length) : 0;
      })(),
      vandSemDano:  vandalismos.filter(o => !o.danoValor || o.danoValor === 0).length,
      // Recuperações
      recuperadas:  recuperadas.length,
      // Por cidade
      porCidade: Object.entries(
        ocs.reduce((acc, o) => {
          const c = o.cidade_inicial || 'Outras'; acc[c] = (acc[c]||0)+1; return acc;
        }, {} as Record<string,number>)
      ).sort((a,b)=>b[1]-a[1]).slice(0,8),
    };
  }, [ocs]);

  // Anterior (para delta)
  const MAnt = useMemo(() => ({
    roubosTotal:  ocsAnt.filter(o => o.tipo === 'Roubo').length,
    vandTotal:    ocsAnt.filter(o => o.tipo === 'Vandalismo').length,
    total:        ocsAnt.length,
  }), [ocsAnt]);

  // ── sparkline: últimas 7 semanas por tipo
  const semanasSpark = useMemo(() => {
    const semanas = 7;
    const roubosSp: number[] = [];
    const vandSp:   number[] = [];
    for (let i = semanas-1; i >= 0; i--) {
      const ini = new Date(Date.now() - (i+1)*7*86400000);
      const fim = new Date(Date.now() - i*7*86400000);
      const iniMs = ini.getTime(); const fimMs = fim.getTime();
      const semOcs = ocorrencias.filter(o => {
        const d = toDate(o.criadoEm); if (!d) return false;
        return d.getTime() >= iniMs && d.getTime() < fimMs;
      });
      roubosSp.push(semOcs.filter(o => o.tipo === 'Roubo').length);
      vandSp.push(semOcs.filter(o => o.tipo === 'Vandalismo').length);
    }
    return { roubos: roubosSp, vand: vandSp };
  }, [ocorrencias]);

  // ── evolução semana a semana (gráfico de barras agrupadas)
  const evolucao = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const semI = 7 - i;
      const ini = new Date(Date.now() - (semI+1)*7*86400000);
      const fim = new Date(Date.now() - semI*7*86400000);
      const label = i === 7 ? 'Atual' : `S-${semI}`;
      const semOcs = ocorrencias.filter(o => {
        const d = toDate(o.criadoEm); if (!d) return false;
        return d.getTime() >= ini.getTime() && d.getTime() < fim.getTime();
      });
      return {
        label,
        roubos:    semOcs.filter(o => o.tipo === 'Roubo').length,
        vand:      semOcs.filter(o => o.tipo === 'Vandalismo').length,
        recup:     semOcs.filter(o => o.tipo === 'Recuperacao' || /recuper/i.test(o.status||'')).length,
      };
    });
  }, [ocorrencias]);

  if (!visivel) return null;

  const maxEvolucao = Math.max(...evolucao.flatMap(e => [e.roubos, e.vand, e.recup]), 1);
  const maxCidade = M.porCidade[0]?.[1] || 1;

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:3500,
      background:'#070b12',
      display:'flex', flexDirection:'column',
      fontFamily:"'Inter',-apple-system,sans-serif",
      overflowY:'auto', scrollbarWidth:'thin',
    }}>

      {/* ── HEADER ───────────────────────────────────────────────── */}
      <div style={{
        background:'rgba(255,255,255,.03)', borderBottom:'1px solid rgba(255,255,255,.07)',
        padding:'10px 16px', display:'flex', alignItems:'center', gap:10,
        position:'sticky', top:0, zIndex:10, backdropFilter:'blur(10px)',
        flexShrink:0, flexWrap:'wrap',
      }}>
        <button onClick={onFechar} style={{
          background:'none', border:'none', color:'rgba(255,255,255,.3)',
          cursor:'pointer', fontSize:18, padding:'0 4px', lineHeight:1,
        }}>✕</button>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#fff', letterSpacing:'-0.3px' }}>
            🛡 Guard — Central de Controle
          </div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,.3)' }}>
            {ocorrencias.length} ocorrências · atualizado em tempo real
          </div>
        </div>

        {/* Período selector */}
        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginLeft:'auto' }}>
          {PERIODOS.map(({ k, l }) => (
            <button key={k} onClick={() => setPeriodo(k)} style={{
              padding:'4px 10px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
              border:`1px solid ${periodo===k ? 'rgba(239,68,68,.5)' : 'rgba(255,255,255,.1)'}`,
              background: periodo===k ? 'rgba(239,68,68,.15)' : 'transparent',
              color: periodo===k ? '#ef4444' : 'rgba(255,255,255,.4)',
              transition:'all .15s',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color:'rgba(255,255,255,.3)', textAlign:'center', padding:80, fontSize:14 }}>
          Carregando dados...
        </div>
      ) : (
        <div style={{ padding:'16px 20px', maxWidth:1400, margin:'0 auto', width:'100%' }}>

          {/* ── ALERTA DE URGÊNCIA (se houver roubos abertos) ─────── */}
          {M.roubosAbertos > 0 && (
            <div style={{
              background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.3)',
              borderLeft:'4px solid #ef4444', borderRadius:8, padding:'10px 16px',
              display:'flex', alignItems:'center', gap:12, marginBottom:16,
            }}>
              <span style={{ fontSize:18 }}>🚨</span>
              <div>
                <span style={{ color:'#ef4444', fontWeight:800, fontSize:13 }}>
                  {M.roubosAbertos} roubo{M.roubosAbertos>1?'s':''} em aberto
                </span>
                <span style={{ color:'rgba(255,255,255,.4)', fontSize:11, marginLeft:8 }}>
                  no período selecionado — requer atenção
                </span>
              </div>
            </div>
          )}

          {/* ── LAYOUT RESPONSIVO — 2 colunas desktop / 1 coluna mobile ── */}
          <div style={{ display:'grid',
            gridTemplateColumns:'repeat(auto-fit, minmax(min(100%,380px), 1fr))',
            gap:16 }}>

            {/* ════ COLUNA ESQUERDA — ROUBOS & VANDALISMO ══════════ */}
            <div>

              {/* Roubos */}
              <Secao titulo="Roubos & Tentativas" cor="#ef4444">
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:8, marginBottom:8 }}>
                  <KpiCard
                    label="Roubos"
                    valor={M.roubosTotal}
                    sub={`${M.roubosAbertos} abertos · ${M.roubosRecup} recup.`}
                    cor="#ef4444"
                    delta={M.roubosTotal - MAnt.roubosTotal}
                    sparkline={semanasSpark.roubos}
                    warn={M.roubosAbertos > 0}
                    icon="🔴"
                  />
                  <KpiCard
                    label="Tentativas"
                    valor={M.tentativas}
                    sub="de roubo registradas"
                    cor="#f97316"
                    icon="🟠"
                  />
                </div>

                {/* Taxa recuperação roubos */}
                <div style={{
                  background:'rgba(255,255,255,.03)', borderRadius:8, padding:'10px 12px',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                    <span style={{ fontSize:10, color:'rgba(255,255,255,.4)', textTransform:'uppercase', letterSpacing:'.6px' }}>
                      Taxa de recuperação
                    </span>
                    <span style={{ fontSize:13, fontWeight:800,
                      color: M.taxaRecupR >= 50 ? '#22c55e' : M.taxaRecupR >= 25 ? '#f97316' : '#ef4444' }}>
                      {M.taxaRecupR}%
                    </span>
                  </div>
                  <div style={{ height:6, background:'rgba(255,255,255,.07)', borderRadius:3 }}>
                    <div style={{
                      height:6, borderRadius:3, transition:'width .5s',
                      width:`${M.taxaRecupR}%`,
                      background: M.taxaRecupR >= 50 ? '#22c55e' : M.taxaRecupR >= 25 ? '#f97316' : '#ef4444',
                    }}/>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:10, color:'rgba(255,255,255,.3)' }}>
                    <span>✅ {M.roubosRecup} recuperados</span>
                    <span>🔓 {M.roubosAbertos} em aberto</span>
                  </div>
                </div>
              </Secao>

              {/* Vandalismo */}
              <Secao titulo="Vandalismo" cor="#f59e0b">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <KpiCard
                    label="Total Vandalismo"
                    valor={M.vandTotal}
                    sub={`${M.vandAbertos} abertos`}
                    cor="#f59e0b"
                    delta={M.vandTotal - MAnt.vandTotal}
                    sparkline={semanasSpark.vand}
                    icon="🟡"
                  />
                  <KpiCard
                    label="Recuperados"
                    valor={M.vandRecup}
                    sub={`${M.taxaRecupV}% do total`}
                    cor="#22c55e"
                    icon="✅"
                  />
                </div>

                {/* Por tipo de ativo */}
                <div style={{ background:'rgba(255,255,255,.03)', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.3)',
                    textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}>
                    Por ativo vandalizado
                  </div>
                  <BarraHoriz v={M.vandPatins} max={M.vandTotal} cor="#f59e0b" label="🛴 Patinetes" />
                  <BarraHoriz v={M.vandBikes}  max={M.vandTotal} cor="#3b82f6" label="🚲 Bicicletas" />
                  <BarraHoriz v={M.vandBat}    max={M.vandTotal} cor="#a78bfa" label="🔋 Baterias" />
                  {M.vandTotal - M.vandPatins - M.vandBikes - M.vandBat > 0 && (
                    <BarraHoriz v={M.vandTotal - M.vandPatins - M.vandBikes - M.vandBat}
                      max={M.vandTotal} cor="#6b7280" label="📦 Outros" />
                  )}
                </div>

                {/* Avaliação de danos — oficina */}
                <div style={{ background:'rgba(234,179,8,.04)', borderRadius:8,
                  border:'1px solid rgba(234,179,8,.15)', padding:'10px 12px', marginTop:8 }}>
                  <div style={{ fontSize:9, fontWeight:700, color:'#fbbf24',
                    textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}>
                    🔧 Avaliação de danos (oficina)
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                    <div style={{ background:'rgba(255,255,255,.03)', borderRadius:7,
                      padding:'8px 10px', textAlign:'center' }}>
                      <div style={{ fontSize:20, fontWeight:900,
                        color: M.danoValorTotal > 0 ? '#ef4444' : 'rgba(255,255,255,.3)' }}>
                        {M.danoValorTotal > 0
                          ? `R$${M.danoValorTotal.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0})}`
                          : '—'}
                      </div>
                      <div style={{ fontSize:8, color:'rgba(255,255,255,.3)',
                        textTransform:'uppercase', marginTop:3 }}>Total R$</div>
                    </div>
                    <div style={{ background:'rgba(255,255,255,.03)', borderRadius:7,
                      padding:'8px 10px', textAlign:'center' }}>
                      <div style={{ fontSize:20, fontWeight:900,
                        color: M.danoPctMedio > 0 ? '#f59e0b' : 'rgba(255,255,255,.3)' }}>
                        {M.danoPctMedio > 0 ? `${M.danoPctMedio}%` : '—'}
                      </div>
                      <div style={{ fontSize:8, color:'rgba(255,255,255,.3)',
                        textTransform:'uppercase', marginTop:3 }}>% médio dano</div>
                    </div>
                    <div style={{ background:'rgba(255,255,255,.03)', borderRadius:7,
                      padding:'8px 10px', textAlign:'center' }}>
                      <div style={{ fontSize:20, fontWeight:900,
                        color: M.vandComDano > 0 ? '#a78bfa' : 'rgba(255,255,255,.3)' }}>
                        {M.vandComDano}/{M.vandTotal}
                      </div>
                      <div style={{ fontSize:8, color:'rgba(255,255,255,.3)',
                        textTransform:'uppercase', marginTop:3 }}>Com avaliação</div>
                    </div>
                  </div>
                  {M.vandSemDano > 0 && (
                    <div style={{ marginTop:6, fontSize:9, color:'rgba(255,165,0,.6)',
                      textAlign:'center' }}>
                      ⚠️ {M.vandSemDano} vandalismo{M.vandSemDano>1?'s':''} sem avaliação de dano
                    </div>
                  )}
                </div>
              </Secao>

              {/* Top cidades */}
              <Secao titulo="Por cidade" cor="#60a5fa">
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {M.porCidade.map(([cidade, n]) => {
                    const wr = ocs.filter(o => o.tipo==='Roubo' && o.cidade_inicial===cidade).length;
                    return (
                      <div key={cidade} style={{
                        display:'grid', gridTemplateColumns:'1fr auto auto',
                        alignItems:'center', gap:8,
                        padding:'6px 10px', borderRadius:7,
                        background:'rgba(255,255,255,.03)',
                      }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.8)' }}>{cidade}</div>
                          <div style={{ height:3, background:'rgba(255,255,255,.07)', borderRadius:2, marginTop:3 }}>
                            <div style={{ height:3, borderRadius:2,
                              width:`${pct(n, maxCidade)}%`,
                              background: wr > 0 ? '#ef4444' : '#60a5fa' }}/>
                          </div>
                        </div>
                        <span style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,.5)' }}>{n}</span>
                        {wr > 0 && (
                          <span style={{ fontSize:10, background:'rgba(239,68,68,.15)',
                            color:'#ef4444', padding:'1px 5px', borderRadius:4, fontWeight:700 }}>
                            🔴{wr}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {M.porCidade.length === 0 && (
                    <div style={{ color:'rgba(255,255,255,.2)', fontSize:11, padding:'12px 0', textAlign:'center' }}>
                      Nenhum dado no período
                    </div>
                  )}
                </div>
              </Secao>
            </div>

            {/* ════ COLUNA DIREITA — PERDAS & BRPD ════════════════ */}
            <div>

              {/* BRPD Acumulado */}
              <Secao titulo="Perdas Definitivas — BRPD" cor="#c084fc">
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:8 }}>
                  <KpiCard label="Total BRPD" valor={BRPD_TOTAL} cor="#c084fc"
                    sub="acum. 01/23" warn={true} icon="📉"/>
                  <KpiCard label="🛴 Patinetes" valor={BRPD_PATINS} cor="#f97316"
                    sub={`${pct(BRPD_PATINS,BRPD_TOTAL)}% do total`}/>
                  <KpiCard label="🚲 Bikes" valor={BRPD_BIKES} cor="#3b82f6"
                    sub={`${pct(BRPD_BIKES,BRPD_TOTAL)}% do total`}/>
                </div>

                {/* Composição visual */}
                <div style={{ background:'rgba(255,255,255,.03)', borderRadius:8, padding:'12px 14px', marginBottom:8 }}>
                  <div style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.3)',
                    textTransform:'uppercase', letterSpacing:'.8px', marginBottom:10 }}>
                    Composição do BRPD
                  </div>
                  {/* Barra segmentada */}
                  <div style={{ height:10, borderRadius:5, overflow:'hidden', display:'flex', marginBottom:8 }}>
                    <div style={{ width:`${pct(BRPD_PATINS,BRPD_TOTAL)}%`, background:'#f97316' }}/>
                    <div style={{ width:`${pct(BRPD_BIKES,BRPD_TOTAL)}%`, background:'#3b82f6' }}/>
                  </div>
                  <div style={{ display:'flex', gap:12, fontSize:10 }}>
                    <span style={{ color:'#f97316' }}>● 🛴 {pct(BRPD_PATINS,BRPD_TOTAL)}% patinetes</span>
                    <span style={{ color:'#3b82f6' }}>● 🚲 {pct(BRPD_BIKES,BRPD_TOTAL)}% bikes</span>
                  </div>
                  <div style={{ marginTop:10, fontSize:11, color:'rgba(255,255,255,.3)',
                    borderTop:'1px solid rgba(255,255,255,.05)', paddingTop:8 }}>
                    Ref. planilha 06/06/26 · atualizado via Guard ao registrar ocorrências
                  </div>
                </div>
              </Secao>

              {/* Ocorrências do período */}
              <Secao titulo={`Visão geral — ${PERIODOS.find(p=>p.k===periodo)?.l}`} cor="#34d399">
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:8 }}>
                  <KpiCard label="Total" valor={M.total} cor="#34d399"
                    delta={M.total - MAnt.total}/>
                  <KpiCard label="Recuperados" valor={M.recuperadas} cor="#22c55e"
                    sub={`${pct(M.recuperadas, M.total)}% do total`}/>
                  <KpiCard label="Em aberto" valor={M.roubosAbertos + M.vandAbertos}
                    cor={M.roubosAbertos > 0 ? '#ef4444' : '#f59e0b'}
                    warn={M.roubosAbertos > 0}
                    sub="roubos + vandalismos"/>
                </div>

                {/* Mini radar visual por tipo */}
                <div style={{ background:'rgba(255,255,255,.03)', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.3)',
                    textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}>
                    Distribuição por tipo
                  </div>
                  {[
                    { t:'Roubo',       n: M.roubosTotal, cor:'#ef4444', icon:'🔴' },
                    { t:'Vandalismo',  n: M.vandTotal,   cor:'#f59e0b', icon:'🟡' },
                    { t:'Tentativa',   n: M.tentativas,  cor:'#f97316', icon:'🟠' },
                    { t:'Recuperação', n: M.recuperadas, cor:'#22c55e', icon:'🟢' },
                  ].map(({ t, n, cor, icon }) => (
                    <BarraHoriz key={t} v={n} max={M.total} cor={cor} label={`${icon} ${t}`} />
                  ))}
                </div>
              </Secao>

              {/* Evolução semanal */}
              <Secao titulo="Evolução semanal — últimas 8 semanas" cor="#818cf8">
                <div style={{
                  background:'rgba(255,255,255,.03)', borderRadius:8, padding:'14px 12px',
                  overflowX:'auto',
                }}>
                  {/* Legenda */}
                  <div style={{ display:'flex', gap:12, marginBottom:12, fontSize:10 }}>
                    <span style={{ color:'#ef4444' }}>● Roubos</span>
                    <span style={{ color:'#f59e0b' }}>● Vandalismo</span>
                    <span style={{ color:'#22c55e' }}>● Recuperações</span>
                  </div>

                  {/* Barras agrupadas */}
                  <div style={{ display:'flex', gap:4, alignItems:'flex-end', height:90 }}>
                    {evolucao.map((sem, i) => {
                      const bH = (v: number) => v > 0 ? Math.max(4, Math.round((v/maxEvolucao)*78)) : 0;
                      const isAtual = i === evolucao.length - 1;
                      return (
                        <div key={sem.label} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                          <div style={{ display:'flex', gap:1, alignItems:'flex-end', height:78 }}>
                            <div style={{ width:5, height:bH(sem.roubos), background:'#ef4444', borderRadius:'2px 2px 0 0', opacity: isAtual ? 1 : 0.7 }} title={`Roubos: ${sem.roubos}`}/>
                            <div style={{ width:5, height:bH(sem.vand),   background:'#f59e0b', borderRadius:'2px 2px 0 0', opacity: isAtual ? 1 : 0.7 }} title={`Vand: ${sem.vand}`}/>
                            <div style={{ width:5, height:bH(sem.recup),  background:'#22c55e', borderRadius:'2px 2px 0 0', opacity: isAtual ? 1 : 0.7 }} title={`Recup: ${sem.recup}`}/>
                          </div>
                          <span style={{ fontSize:8, color: isAtual ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.25)',
                            fontWeight: isAtual ? 700 : 400, marginTop:3 }}>
                            {sem.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Totais abaixo */}
                  <div style={{ borderTop:'1px solid rgba(255,255,255,.05)', marginTop:10, paddingTop:8,
                    display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,.3)' }}>
                    <span>🔴 Roubos total: <b style={{color:'rgba(255,255,255,.6)'}}>{evolucao.reduce((s,e)=>s+e.roubos,0)}</b></span>
                    <span>🟡 Vand. total: <b style={{color:'rgba(255,255,255,.6)'}}>{evolucao.reduce((s,e)=>s+e.vand,0)}</b></span>
                    <span>✅ Recup.: <b style={{color:'rgba(255,255,255,.6)'}}>{evolucao.reduce((s,e)=>s+e.recup,0)}</b></span>
                  </div>
                </div>
              </Secao>

            </div>
          </div>

          {/* ── RODAPÉ COM TIMESTAMP ─────────────────────────────── */}
          <div style={{ borderTop:'1px solid rgba(255,255,255,.05)', paddingTop:12, marginTop:8,
            display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,.2)' }}>
            <span>JET OS Guard · Dashboard</span>
            <span>Dados em tempo real via Firestore · {new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})}</span>
          </div>

        </div>
      )}
    </div>
  );
}
