// frontend/src/components/PainelControlePerdasSeg.tsx — JET OS V2
// Painel Controle de Perdas — Segurança
// Acesso: admin, gestor, gestor_seg
// Dados: alimentados pelas ocorrências do Guard + dados iniciais da planilha

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, setDoc, getDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface FilialDados {
  regiao:       string;
  filial:       string;
  responsavel:  string;
  patins:       number;
  bikes:        number;
  brpd:         number;   // BRPD = patins+bikes com status de perda grave
  vand_patins:  number;   // vandalismo últimas 24h
  vand_bikes:   number;
  vand_total:   number;
  nao_enc_patins: number; // não encontrado últimas 24h
  nao_enc_bikes:  number;
  nao_enc_bat:    number;
  status1_24h?:   string; // STATUS 1 - trabalho do segurança
  status2_7d?:    string; // STATUS 2 - procurado últimos 7 dias
}

interface OcorrenciaGuard {
  id: string;
  tipo: string;
  status?: string;
  cidade_inicial?: string;
  ativo_tipo?: string;
  asset_id?: string;
  criadoEm?: any;
  registradoPorNome?: string;
}

interface Props {
  visivel: boolean;
  onFechar: () => void;
  roleUsuario?: string;
}

type Aba = 'perdas' | 'vandalismo' | 'brpd' | 'ocorrencias';
type Periodo = '24h' | '7d' | '30d' | 'total';

// ─── Dados iniciais da planilha (06.06.2026) ─────────────────────────────────
// Alimentados automaticamente pelas ocorrências do Guard no futuro

const DADOS_INICIAIS: FilialDados[] = [
  { regiao:'Norte', filial:'Pará (Belém)',              responsavel:'Willian',                  patins:1,   bikes:0, brpd:1,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'Ceará (Fortaleza)',          responsavel:'Abel Holando',              patins:2,   bikes:0, brpd:2,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'Pernambuco (Recife)',        responsavel:'Geova Francisco',           patins:12,  bikes:0, brpd:12,  vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'R.G. Norte (Natal)',         responsavel:'Daniel Augusto da Silva',   patins:8,   bikes:0, brpd:8,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'Sergipe (Aracajú)',          responsavel:'Gabriel Peres',             patins:1,   bikes:4, brpd:5,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'Alagoas (Maceió)',           responsavel:'Diego Alves',               patins:0,   bikes:0, brpd:0,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'Bahia (Salvador/Ilhéus)',    responsavel:'Jackson Imperial',          patins:5,   bikes:0, brpd:5,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:1 },
  { regiao:'Norte', filial:'Minas Gerais (BH)',          responsavel:'Emerson Simões',            patins:128, bikes:0, brpd:128, vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:1, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Norte', filial:'E.S (VV/Serra/Guarapari)',   responsavel:'Jean Fraga',                patins:20,  bikes:4, brpd:24,  vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Centro', filial:'SP Estado',                 responsavel:'Marcos Allan',              patins:15,  bikes:0, brpd:15,  vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Centro', filial:'SP Capital',                responsavel:'Eliel Alves',               patins:152, bikes:0, brpd:152, vand_patins:1, vand_bikes:0, vand_total:1, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Centro', filial:'SP Litoral',                responsavel:'Jean Alves Ramos',          patins:23,  bikes:0, brpd:23,  vand_patins:1, vand_bikes:0, vand_total:1, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Sul',   filial:'Distr. Fed. (Brasília)',     responsavel:'Matheus Henrique',          patins:7,   bikes:0, brpd:7,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Sul',   filial:'Paraná (Crt/Londri/Guar)',   responsavel:'Valmir Ferreira Jr',        patins:3,   bikes:0, brpd:3,   vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Sul',   filial:'SC (BC/Florip/Joinville)',   responsavel:'Gilberto Onofre',           patins:13,  bikes:2, brpd:15,  vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
  { regiao:'Sul',   filial:'R.G.Sul (Poa/Gramado/Tram)', responsavel:'Ewerton Silveira',         patins:16,  bikes:0, brpd:16,  vand_patins:0, vand_bikes:0, vand_total:0, nao_enc_patins:0, nao_enc_bikes:0, nao_enc_bat:0 },
];

const REGIAO_COR: Record<string, string> = {
  'Norte': '#f97316', 'Centro': '#3b82f6', 'Sul': '#a78bfa',
};
const REGIAO_EMOJI: Record<string, string> = {
  'Norte': '🟢', 'Centro': '🔵', 'Sul': '🟡',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTs(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const T = {
  bg: '#080d14', card: '#0d1521', card2: '#111827',
  bdr: 'rgba(255,255,255,.08)', bdr2: 'rgba(255,255,255,.04)',
  txt: '#e2e8f0', dim: '#64748b', dim2: '#94a3b8',
  red: '#ef4444', orange: '#f97316', green: '#22c55e',
  blue: '#3b82f6', bluel: '#60a5fa', purple: '#a78bfa',
};

const S = {
  wrap: { position: 'fixed' as const, inset: 0, zIndex: 3600,
    background: T.bg, display: 'flex', flexDirection: 'column' as const,
    fontFamily: "'Inter',-apple-system,sans-serif" },
  header: { background: T.card, borderBottom: `1px solid ${T.bdr}`,
    padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' as const },
  tabs: { background: T.card, borderBottom: `1px solid ${T.bdr}`, display: 'flex', flexShrink: 0 },
  tab: (a: boolean): React.CSSProperties => ({
    padding: '10px 18px', fontSize: 12, fontWeight: 600, border: 'none', background: 'none',
    color: a ? T.bluel : T.dim, borderBottom: `2px solid ${a ? T.bluel : 'transparent'}`,
    cursor: 'pointer',
  }),
  body: { flex: 1, overflowY: 'auto' as const, padding: 16, scrollbarWidth: 'thin' as const },
  th: { padding: '9px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '.5px', color: T.dim, borderBottom: `1px solid ${T.bdr}`,
    background: T.card, position: 'sticky' as const, top: 0, zIndex: 1, whiteSpace: 'nowrap' as const },
  td: { padding: '8px 12px', fontSize: 12, borderBottom: `1px solid ${T.bdr2}`, color: T.txt },
  tdNum: (highlight = false): React.CSSProperties => ({
    padding: '8px 12px', fontSize: 13, fontWeight: highlight ? 800 : 600,
    borderBottom: `1px solid ${T.bdr2}`, textAlign: 'center' as const,
    color: highlight ? T.red : T.txt,
  }),
  btn: (c = T.blue, ghost = false): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, border: ghost ? `1px solid ${T.bdr}` : 'none',
    background: ghost ? 'transparent' : c, color: ghost ? T.dim2 : '#fff',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  }),
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function PainelControlePerdasSeg({ visivel, onFechar, roleUsuario = 'viewer' }: Props) {
  const [aba,          setAba         ] = useState<Aba>('perdas');
  const [ocorrencias,  setOcorrencias ] = useState<OcorrenciaGuard[]>([]);
  const [filiais,      setFiliais     ] = useState<FilialDados[]>(DADOS_INICIAIS);
  const [loading,      setLoading     ] = useState(true);
  const [periodo,      setPeriodo     ] = useState<Periodo>('total');
  const [filtroBusca,  setFiltroBusca ] = useState('');
  const [filtroRegiao, setFiltroRegiao] = useState('');
  const [editando,     setEditando    ] = useState<string | null>(null);
  const [statusEdit,   setStatusEdit  ] = useState({ s1: '', s2: '' });
  const podeEditar = ['admin','gestor','gestor_seg'].includes(roleUsuario);

  // Carrega dados salvos + ocorrências do Guard
  useEffect(() => {
    if (!visivel) return;
    // Carrega config salva
    getDoc(doc(db, 'guard_config', 'controle_perdas')).then(d => {
      if (d.exists() && d.data().filiais) setFiliais(d.data().filiais);
    }).catch(() => {});

    // Escuta ocorrências
    const q = query(collection(db, 'ocorrencias'), orderBy('criadoEm', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as OcorrenciaGuard)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [visivel]);

  // KPIs globais
  const totais = useMemo(() => ({
    patins:   filiais.reduce((s, f) => s + f.patins, 0),
    bikes:    filiais.reduce((s, f) => s + f.bikes, 0),
    brpd:     filiais.reduce((s, f) => s + f.brpd, 0),
    vand:     filiais.reduce((s, f) => s + f.vand_total, 0),
    nao_enc:  filiais.reduce((s, f) => s + f.nao_enc_patins + f.nao_enc_bikes + f.nao_enc_bat, 0),
  }), [filiais]);

  // Ocorrências filtradas por período
  const ocsFiltradas = useMemo(() => {
    const ms = periodo === '24h' ? 86400000 : periodo === '7d' ? 7*86400000 : periodo === '30d' ? 30*86400000 : Infinity;
    const desde = new Date(Date.now() - ms);
    return ocorrencias.filter(o => {
      const d = o.criadoEm?.toDate?.() ?? new Date(0);
      const passaPeriodo = ms === Infinity || d >= desde;
      const passaBusca = !filtroBusca || [o.asset_id, o.cidade_inicial, o.registradoPorNome]
        .some(v => (v||'').toLowerCase().includes(filtroBusca.toLowerCase()));
      return passaPeriodo && passaBusca;
    });
  }, [ocorrencias, periodo, filtroBusca]);

  // Filiais filtradas
  const filiaisFilt = useMemo(() =>
    filiais.filter(f =>
      (!filtroRegiao || f.regiao === filtroRegiao) &&
      (!filtroBusca || f.filial.toLowerCase().includes(filtroBusca.toLowerCase()) ||
        f.responsavel.toLowerCase().includes(filtroBusca.toLowerCase()))
    ), [filiais, filtroRegiao, filtroBusca]);

  // Subtotais por região
  const subTotais = useMemo(() => {
    const m: Record<string, any> = {};
    for (const f of filiaisFilt) {
      if (!m[f.regiao]) m[f.regiao] = { patins:0, bikes:0, brpd:0, vand:0, nao:0 };
      m[f.regiao].patins += f.patins;
      m[f.regiao].bikes  += f.bikes;
      m[f.regiao].brpd   += f.brpd;
      m[f.regiao].vand   += f.vand_total;
      m[f.regiao].nao    += f.nao_enc_patins + f.nao_enc_bikes + f.nao_enc_bat;
    }
    return m;
  }, [filiaisFilt]);

  const salvarStatus = async (filialNome: string, s1: string, s2: string) => {
    const novas = filiais.map(f => f.filial === filialNome ? { ...f, status1_24h: s1, status2_7d: s2 } : f);
    setFiliais(novas);
    setEditando(null);
    await setDoc(doc(db, 'guard_config', 'controle_perdas'), { filiais: novas, atualizadoEm: serverTimestamp() }, { merge: true });
  };

  const regioes = [...new Set(filiais.map(f => f.regiao))];

  if (!visivel) return null;

  return (
    <div style={S.wrap}>
      {/* ── Header ── */}
      <div style={S.header}>
        <button onClick={onFechar} style={{ background:'none', border:'none', color:T.dim, cursor:'pointer', fontSize:20, padding:'0 4px' }}>✕</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.txt }}>📊 Controle de Perdas — Segurança</div>
          <div style={{ fontSize: 10, color: T.dim }}>
            Atualizado 06.06.26 · {filiais.length} filiais · {ocorrencias.length} ocorrências registradas
          </div>
        </div>

        {/* Período para ocorrências */}
        <div style={{ display:'flex', gap:4 }}>
          {(['24h','7d','30d','total'] as Periodo[]).map(p => (
            <button key={p} onClick={() => setPeriodo(p)}
              style={{ ...S.btn(T.blue, periodo !== p), padding:'4px 10px', fontSize:10,
                background: periodo === p ? 'rgba(59,130,246,.2)' : 'transparent',
                color: periodo === p ? T.bluel : T.dim,
                border: `1px solid ${periodo === p ? 'rgba(59,130,246,.4)' : T.bdr}` }}>
              {p === 'total' ? 'Total' : p}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ background: T.card, borderBottom:`1px solid ${T.bdr}`, padding:'10px 16px',
        display:'flex', gap:8, flexWrap:'wrap', flexShrink:0 }}>
        {[
          { l:'Total BRPD',      v: totais.brpd,    c: T.red,    emoji:'🔴' },
          { l:'🛴 Patins perdas', v: totais.patins,  c: T.orange, emoji:'🛴' },
          { l:'🚲 Bikes perdas',  v: totais.bikes,   c: '#eab308',emoji:'🚲' },
          { l:'⚡ Vandalismo 24h', v: totais.vand,    c: T.purple, emoji:'⚡' },
          { l:'🔍 Não encontrado', v: totais.nao_enc, c: T.dim2,   emoji:'🔍' },
          { l:'📋 Ocorrências',    v: ocsFiltradas.length, c: T.bluel, emoji:'📋' },
        ].map(({ l, v, c, emoji }) => (
          <div key={l} style={{ flex:1, minWidth:90, background:T.card2, borderRadius:10,
            padding:'10px 12px', borderTop:`2px solid ${c}`, border:`1px solid ${c}22` }}>
            <div style={{ fontSize:22, fontWeight:800, color:c }}>{v}</div>
            <div style={{ fontSize:10, color:T.dim, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* ── Abas ── */}
      <div style={S.tabs}>
        <button onClick={() => setAba('perdas')}     style={S.tab(aba==='perdas')}>🔴 Perdas por Filial</button>
        <button onClick={() => setAba('vandalismo')} style={S.tab(aba==='vandalismo')}>⚡ Vandalismo</button>
        <button onClick={() => setAba('brpd')}       style={S.tab(aba==='brpd')}>📉 BRPD</button>
        <button onClick={() => setAba('ocorrencias')}style={S.tab(aba==='ocorrencias')}>📋 Ocorrências ({ocsFiltradas.length})</button>
      </div>

      {/* ── Filtros ── */}
      <div style={{ background:T.card, borderBottom:`1px solid ${T.bdr}`,
        padding:'8px 16px', display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
        <input value={filtroBusca} onChange={e => setFiltroBusca(e.target.value)}
          placeholder="🔍 Buscar filial, responsável, ativo..."
          style={{ padding:'6px 10px', borderRadius:8, fontSize:11, width:220,
            background:'rgba(255,255,255,.06)', border:`1px solid ${T.bdr}`, color:T.txt, outline:'none' }} />
        <select value={filtroRegiao} onChange={e => setFiltroRegiao(e.target.value)}
          style={{ padding:'6px 10px', borderRadius:8, fontSize:11,
            background:'rgba(255,255,255,.06)', border:`1px solid ${T.bdr}`, color:T.txt }}>
          <option value="">Todas as regiões</option>
          {regioes.map(r => <option key={r} value={r}>{REGIAO_EMOJI[r]} {r}</option>)}
        </select>
        <div style={{ fontSize:11, color:T.dim, marginLeft:'auto' }}>
          {filiaisFilt.length} filiais
        </div>
      </div>

      {/* ── Body ── */}
      <div style={S.body}>
        {loading ? (
          <div style={{ color:T.dim, textAlign:'center', padding:60 }}>Carregando...</div>
        ) : aba === 'perdas' ? (

          // ── TABELA PERDAS ────────────────────────────────────────────
          <div style={{ background:T.card2, borderRadius:12, border:`1px solid ${T.bdr}`, overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    {['Região','Filial','Responsável','🛴 Patins','🚲 Bikes','BRPD Total','⚡Vand.24h','🔍Não enc.24h','STATUS 1 — 24h','STATUS 2 — 7d',''].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Agrupa por região */}
                  {regioes.filter(r => !filtroRegiao || r === filtroRegiao).map(regiao => {
                    const filiaisRegiao = filiaisFilt.filter(f => f.regiao === regiao);
                    if (!filiaisRegiao.length) return null;
                    const cor = REGIAO_COR[regiao] || T.dim;
                    const sub = subTotais[regiao] || {};
                    return (
                      <React.Fragment key={regiao}>
                        {filiaisRegiao.map((f, i) => (
                          <tr key={f.filial} style={{ cursor:'pointer' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            {i === 0 ? (
                              <td style={{ ...S.td, fontWeight:700, color:cor,
                                borderLeft:`3px solid ${cor}`, paddingLeft:10 }}
                                rowSpan={filiaisRegiao.length}>
                                {REGIAO_EMOJI[regiao]} {regiao}
                              </td>
                            ) : null}
                            <td style={{ ...S.td, fontWeight:600 }}>{f.filial}</td>
                            <td style={{ ...S.td, fontSize:11, color:T.dim2 }}>{f.responsavel}</td>
                            <td style={S.tdNum(f.patins > 50)}>{f.patins || 0}</td>
                            <td style={S.tdNum(f.bikes > 5)}>{f.bikes || 0}</td>
                            <td style={{ ...S.tdNum(f.brpd > 50), color: f.brpd > 50 ? T.red : T.txt }}>{f.brpd || 0}</td>
                            <td style={{ ...S.tdNum(), color: f.vand_total > 0 ? T.orange : T.dim }}>{f.vand_total || 0}</td>
                            <td style={{ ...S.tdNum(), color: (f.nao_enc_patins+f.nao_enc_bikes+f.nao_enc_bat) > 0 ? T.purple : T.dim }}>
                              {(f.nao_enc_patins+f.nao_enc_bikes+f.nao_enc_bat) || 0}
                            </td>
                            {/* STATUS 1 */}
                            <td style={{ ...S.td, maxWidth: 200 }}>
                              {editando === f.filial ? (
                                <input value={statusEdit.s1} onChange={e => setStatusEdit(p => ({...p, s1: e.target.value}))}
                                  placeholder="IDs patinetes em trabalho..."
                                  style={{ width:'100%', padding:'4px 6px', borderRadius:6, fontSize:11,
                                    background:'rgba(255,255,255,.08)', border:`1px solid ${T.bdr}`, color:T.txt, outline:'none' }} />
                              ) : (
                                <span style={{ fontSize:11, color: f.status1_24h ? T.txt : T.dim }}>
                                  {f.status1_24h || '—'}
                                </span>
                              )}
                            </td>
                            {/* STATUS 2 */}
                            <td style={{ ...S.td, maxWidth: 160 }}>
                              {editando === f.filial ? (
                                <input value={statusEdit.s2} onChange={e => setStatusEdit(p => ({...p, s2: e.target.value}))}
                                  placeholder="IDs procurados..."
                                  style={{ width:'100%', padding:'4px 6px', borderRadius:6, fontSize:11,
                                    background:'rgba(255,255,255,.08)', border:`1px solid ${T.bdr}`, color:T.txt, outline:'none' }} />
                              ) : (
                                <span style={{ fontSize:11, color: f.status2_7d ? T.bluel : T.dim }}>
                                  {f.status2_7d || '—'}
                                </span>
                              )}
                            </td>
                            {/* Ações */}
                            <td style={S.td}>
                              {podeEditar && (
                                editando === f.filial ? (
                                  <div style={{ display:'flex', gap:4 }}>
                                    <button onClick={() => salvarStatus(f.filial, statusEdit.s1, statusEdit.s2)}
                                      style={{ ...S.btn(T.green), padding:'3px 8px', fontSize:11 }}>✓</button>
                                    <button onClick={() => setEditando(null)}
                                      style={{ ...S.btn(T.dim, true), padding:'3px 8px', fontSize:11 }}>✕</button>
                                  </div>
                                ) : (
                                  <button onClick={() => { setEditando(f.filial); setStatusEdit({ s1: f.status1_24h||'', s2: f.status2_7d||'' }); }}
                                    style={{ ...S.btn(T.blue, true), padding:'3px 8px', fontSize:11 }}>✏</button>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                        {/* Subtotal região */}
                        <tr style={{ background:`${cor}10` }}>
                          <td style={{ ...S.td, fontWeight:800, color:cor, fontSize:11, paddingLeft:10 }}>Σ {regiao}</td>
                          <td colSpan={2} style={S.td}></td>
                          <td style={{ ...S.tdNum(), fontWeight:800, color:cor }}>{sub.patins||0}</td>
                          <td style={{ ...S.tdNum(), fontWeight:800, color:cor }}>{sub.bikes||0}</td>
                          <td style={{ ...S.tdNum(), fontWeight:800, color:cor }}>{sub.brpd||0}</td>
                          <td style={{ ...S.tdNum(), fontWeight:800, color:cor }}>{sub.vand||0}</td>
                          <td style={{ ...S.tdNum(), fontWeight:800, color:cor }}>{sub.nao||0}</td>
                          <td colSpan={3} style={S.td}></td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  {/* Total geral */}
                  <tr style={{ background:'rgba(255,255,255,.04)' }}>
                    <td colSpan={3} style={{ ...S.td, fontWeight:800, fontSize:13, color:T.txt }}>TOTAL GERAL</td>
                    <td style={{ ...S.tdNum(), fontWeight:800, fontSize:14, color:T.orange }}>{totais.patins}</td>
                    <td style={{ ...S.tdNum(), fontWeight:800, fontSize:14, color:'#eab308' }}>{totais.bikes}</td>
                    <td style={{ ...S.tdNum(), fontWeight:800, fontSize:14, color:T.red }}>{totais.brpd}</td>
                    <td style={{ ...S.tdNum(), fontWeight:800, color:T.purple }}>{totais.vand}</td>
                    <td style={{ ...S.tdNum(), fontWeight:800, color:T.dim2 }}>{totais.nao_enc}</td>
                    <td colSpan={3} style={S.td}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

        ) : aba === 'vandalismo' ? (

          // ── VANDALISMO ────────────────────────────────────────────────
          <div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:12 }}>
              Vandalismos nas últimas 24h por filial + histórico das ocorrências registradas
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
              {filiaisFilt.filter(f => f.vand_total > 0).map(f => (
                <div key={f.filial} style={{ background:T.card2, borderRadius:10, padding:'12px 14px',
                  border:`1px solid ${T.orange}30`, minWidth:160 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:T.orange, marginBottom:4 }}>{f.filial}</div>
                  <div style={{ fontSize:11, color:T.dim2 }}>{f.responsavel}</div>
                  <div style={{ marginTop:8, display:'flex', gap:8 }}>
                    <div style={{ textAlign:'center' as const }}>
                      <div style={{ fontSize:20, fontWeight:800, color:'#f97316' }}>{f.vand_patins}</div>
                      <div style={{ fontSize:9, color:T.dim }}>🛴 Patins</div>
                    </div>
                    <div style={{ textAlign:'center' as const }}>
                      <div style={{ fontSize:20, fontWeight:800, color:'#eab308' }}>{f.vand_bikes}</div>
                      <div style={{ fontSize:9, color:T.dim }}>🚲 Bikes</div>
                    </div>
                    <div style={{ textAlign:'center' as const }}>
                      <div style={{ fontSize:20, fontWeight:800, color:T.orange }}>{f.vand_total}</div>
                      <div style={{ fontSize:9, color:T.dim }}>Total</div>
                    </div>
                  </div>
                </div>
              ))}
              {filiaisFilt.filter(f => f.vand_total > 0).length === 0 && (
                <div style={{ color:T.dim, fontSize:13, padding:40, textAlign:'center', width:'100%' }}>
                  ✅ Nenhum vandalismo registrado no período
                </div>
              )}
            </div>

            {/* Ocorrências Vandalismo do Guard */}
            <div style={{ background:T.card2, borderRadius:12, border:`1px solid ${T.bdr}`, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:`1px solid ${T.bdr}`,
                fontSize:11, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px' }}>
                Registros de Vandalismo ({ocsFiltradas.filter(o => o.tipo === 'Vandalismo').length})
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    {['ID Ativo','Cidade','Guard','Data','Status'].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {ocsFiltradas.filter(o => o.tipo === 'Vandalismo').slice(0,50).map(o => (
                      <tr key={o.id}>
                        <td style={{ ...S.td, fontFamily:'monospace', fontSize:11 }}>{o.asset_id || '—'}</td>
                        <td style={S.td}>{o.cidade_inicial || '—'}</td>
                        <td style={{ ...S.td, fontSize:11, color:T.dim2 }}>{o.registradoPorNome || '—'}</td>
                        <td style={{ ...S.td, fontSize:11, color:T.dim, fontFamily:'monospace' }}>{fmtTs(o.criadoEm)}</td>
                        <td style={S.td}>{o.status ? <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10,
                          background:o.status==='Recuperado'?'rgba(34,197,94,.15)':'rgba(239,68,68,.1)',
                          color:o.status==='Recuperado'?T.green:T.red }}>{o.status}</span> : '—'}</td>
                      </tr>
                    ))}
                    {ocsFiltradas.filter(o => o.tipo === 'Vandalismo').length === 0 && (
                      <tr><td colSpan={5} style={{ ...S.td, textAlign:'center', padding:30, color:T.dim }}>
                        Nenhum vandalismo registrado no período
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        ) : aba === 'brpd' ? (

          // ── BRPD ──────────────────────────────────────────────────────
          <div>
            <div style={{ background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.2)',
              borderRadius:10, padding:'12px 14px', marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.red, marginBottom:4 }}>
                📉 O que é BRPD?
              </div>
              <div style={{ fontSize:11, color:T.dim2, lineHeight:1.6 }}>
                BRPD (Baixa por Perda/Dano) = patinetes ou bikes com status alterado para <b>perda grave</b>,
                desativados da frota por roubo confirmado, vandalismo severo ou desaparecimento prolongado.
                Total acumulado desde 01.01.23. Coluna <b>BRPD</b> = patins + bikes nessa condição.
              </div>
            </div>

            <div style={{ background:T.card2, borderRadius:12, border:`1px solid ${T.bdr}`, overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    {['Região','Filial','Responsável','🛴 Patins BRPD','🚲 Bikes BRPD','Total BRPD','% do Total Brasil'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filiaisFilt.sort((a,b) => b.brpd - a.brpd).map(f => {
                      const pct = totais.brpd > 0 ? ((f.brpd / totais.brpd) * 100).toFixed(1) : '0';
                      const cor = REGIAO_COR[f.regiao] || T.dim;
                      return (
                        <tr key={f.filial}>
                          <td style={{ ...S.td, color:cor, fontWeight:600, fontSize:11 }}>
                            {REGIAO_EMOJI[f.regiao]} {f.regiao}
                          </td>
                          <td style={{ ...S.td, fontWeight:600 }}>{f.filial}</td>
                          <td style={{ ...S.td, fontSize:11, color:T.dim2 }}>{f.responsavel}</td>
                          <td style={{ ...S.tdNum(), color: f.patins > 50 ? T.red : T.txt }}>{f.patins}</td>
                          <td style={{ ...S.tdNum(), color: f.bikes > 5 ? T.orange : T.txt }}>{f.bikes}</td>
                          <td style={{ ...S.tdNum(f.brpd > 100), fontSize:14 }}>{f.brpd}</td>
                          <td style={S.td}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ flex:1, height:6, background:'rgba(255,255,255,.08)', borderRadius:3 }}>
                                <div style={{ height:'100%', borderRadius:3,
                                  width:`${pct}%`, background: parseFloat(pct) > 30 ? T.red : parseFloat(pct) > 15 ? T.orange : T.green }} />
                              </div>
                              <span style={{ fontSize:11, color:T.dim2, minWidth:36 }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background:'rgba(255,255,255,.04)' }}>
                      <td colSpan={3} style={{ ...S.td, fontWeight:800 }}>TOTAL GERAL</td>
                      <td style={{ ...S.tdNum(), fontWeight:800, color:T.orange }}>{totais.patins}</td>
                      <td style={{ ...S.tdNum(), fontWeight:800, color:'#eab308' }}>{totais.bikes}</td>
                      <td style={{ ...S.tdNum(true), fontSize:15 }}>{totais.brpd}</td>
                      <td style={S.td}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        ) : (

          // ── OCORRÊNCIAS ───────────────────────────────────────────────
          <div style={{ background:T.card2, borderRadius:12, border:`1px solid ${T.bdr}`, overflow:'hidden' }}>
            <div style={{ padding:'10px 14px', borderBottom:`1px solid ${T.bdr}`,
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px' }}>
                Todas as ocorrências do Guard
              </span>
              <span style={{ fontSize:11, color:T.dim }}>{ocsFiltradas.length} registros</span>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  {['Tipo','ID Ativo','Tipo Ativo','Cidade','Guard','Data','Status'].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {ocsFiltradas.slice(0,200).map(o => {
                    const cor = o.tipo==='Roubo'?T.red:o.tipo==='Tentativa'?T.orange:o.tipo==='Vandalismo'?'#eab308':o.tipo==='Recuperacao'?T.green:T.dim;
                    return (
                      <tr key={o.id}>
                        <td style={S.td}>
                          <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700,
                            background:`${cor}18`, color:cor, border:`1px solid ${cor}30` }}>
                            {o.tipo}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontFamily:'monospace', fontSize:11 }}>{o.asset_id || '—'}</td>
                        <td style={{ ...S.td, fontSize:11, color:T.dim2 }}>{o.ativo_tipo || '—'}</td>
                        <td style={S.td}>{o.cidade_inicial || '—'}</td>
                        <td style={{ ...S.td, fontSize:11, color:T.dim2 }}>{o.registradoPorNome || '—'}</td>
                        <td style={{ ...S.td, fontSize:11, fontFamily:'monospace' }}>{fmtTs(o.criadoEm)}</td>
                        <td style={S.td}>
                          {o.status && <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10,
                            background:'rgba(255,255,255,.06)', color:T.dim2 }}>{o.status}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {ocsFiltradas.length === 0 && (
                    <tr><td colSpan={7} style={{ ...S.td, textAlign:'center', padding:40, color:T.dim }}>
                      Nenhuma ocorrência no período
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
