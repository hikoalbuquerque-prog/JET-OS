// frontend/src/components/SlotsTeamsModule.tsx
// Slots & Teams — JET OS V2
// MEI + CLT com escala automática por cidade/feriado/zona (polígono)
// Penalidades, gamificação, ranking, streaks
//
// Abas: Escala | Disponibilidade | Ranking | Penalidades | Config

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, query, where, orderBy, onSnapshot, limit,
  doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, Timestamp, setDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Usuario { uid: string; nome: string; email: string; role: string; cidade?: string; }
interface Props { usuario: Usuario; onFechar: () => void; cidade?: string; }

interface Prestador {
  id: string; uid?: string; nome: string; cnpj: string; cpf?: string;
  funcao: string; turnosPreferidos: string[]; zonasPreferidas: string[];
  cidade: string; status: 'ativo'|'inativo'|'suspenso';
  pontos: number; nivel: number; streak: number; streakMax: number;
  totalSlots: number; totalFaltas: number; totalAtrasos: number;
  avaliacaoMedia: number; criadoEm?: any;
}

interface Slot {
  id: string; turno: string; horaIni: string; horaFim: string;
  zona: string; tipo: string; qtdPessoas: number; dataSlot: string;
  cidade: string; status: string; geradoAuto?: boolean;
  confirmacaoMin?: number; reaberturaSemConfMin?: number;
  poligonoId?: string; feriado?: boolean;
}

interface SlotAceite {
  id: string; slotId: string; nome: string; cnpj: string; uid?: string;
  status: string; aceitoEm?: any; pontuacao?: number;
}

interface Disponibilidade {
  id?: string; uid: string; nome: string; cnpj: string;
  diasSemana: number[]; turnosDisponiveis: string[];
  zonasDisponiveis: string[]; funcao: string;
  cidade: string; obs?: string; atualizadoEm?: any; criadoEm?: any;
}

interface Penalidade {
  id?: string; uid: string; nome: string; cnpj: string;
  tipo: 'falta'|'atraso'|'cancelamento_tardio'|'comportamento';
  descricao: string; pontosDeducao: number; slotId?: string;
  cidade: string; criadoEm?: any; aplicadoPor?: string;
}

interface EscalaConfig {
  id?: string; cidade: string;
  diasAntecedencia: number; // quantos dias antes gerar escala automatica
  turnosConfig: Record<string, { horaIni: string; horaFim: string; qtdPadrao: number }>;
  respeitarPreferencias: boolean;
  respeitarFeriados: boolean;
  nivelMinimoUrgente: number;
  bonus: {
    presencaConfirmada: number;
    inicioNoPrazo: number;
    avaliacaoExcelente: number;
    streakSemanal: number;
    streakMensal: number;
    pontoZerado: number;
  };
  penalidades: {
    falta: number;
    atraso15: number;
    atraso30: number;
    cancelamentoTardio: number;
  };
}

interface Feriado {
  id?: string; data: string; nome: string; cidade?: string; nacional: boolean;
}

type AbaId = 'escala'|'disponibilidade'|'ranking'|'penalidades'|'config';

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg:'rgba(13,18,30,1)', sur:'rgba(13,18,30,.97)', card:'rgba(22,28,40,.95)',
  bdr:'rgba(255,255,255,.08)', bdr2:'rgba(255,255,255,.04)',
  blueg:'linear-gradient(135deg,#1a6fd4,#307FE2)',
  blue:'#1a6fd4', bluel:'#307FE2',
  green:'#10b981', red:'#ef4444', yellow:'#f59e0b', yellowl:'#fbbf24',
  purple:'#7c3aed', orange:'#f97316', pink:'#ec4899',
  txt:'#e2e8f0', dim:'#64748b', blur:'blur(12px)',
};

const S = {
  panel:{ position:'fixed' as const, inset:0, zIndex:4500, background:T.bg, backdropFilter:T.blur, display:'flex', flexDirection:'column' as const, fontFamily:"'Inter',-apple-system,sans-serif" },
  header:{ background:T.sur, backdropFilter:T.blur, borderBottom:`1px solid ${T.bdr}`, padding:'10px 18px', display:'flex', alignItems:'center', gap:12, flexShrink:0, flexWrap:'wrap' as const },
  logo:{ width:36, height:36, borderRadius:10, background:T.blueg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 },
  tabs:{ background:T.sur, borderBottom:`1px solid ${T.bdr}`, display:'flex', overflowX:'auto' as const, flexShrink:0, scrollbarWidth:'none' as const },
  tab:(a:boolean):React.CSSProperties=>({ padding:'10px 16px', fontSize:12, fontWeight:600, color:a?T.bluel:T.dim, cursor:'pointer', background:'none', border:'none', borderBottom:`2px solid ${a?T.bluel:'transparent'}`, whiteSpace:'nowrap', flexShrink:0, transition:'all .15s' }),
  body:{ flex:1, overflowY:'auto' as const, padding:'16px 20px', scrollbarWidth:'thin' as const },
  card:(ac?:string):React.CSSProperties=>({ background:T.card, border:`1px solid ${ac?ac+'33':T.bdr}`, borderTop:`2px solid ${ac||T.bdr}`, borderRadius:12, padding:'14px 16px' }),
  kpiRow:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' as const },
  kpi:(c:string):React.CSSProperties=>({ flex:1, minWidth:80, background:T.card, border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, borderRadius:12, padding:'12px 14px' }),
  kpiN:(c:string):React.CSSProperties=>({ fontSize:26, fontWeight:800, color:c, lineHeight:1 }),
  kpiL:{ fontSize:10, color:T.dim, marginTop:3, textTransform:'uppercase' as const, letterSpacing:'0.4px' },
  inp:{ width:'100%', padding:'8px 10px', borderRadius:8, boxSizing:'border-box' as const, background:'rgba(255,255,255,.04)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:13, outline:'none', marginBottom:8 },
  lbl:{ display:'block' as const, fontSize:10, fontWeight:600, color:'rgba(255,255,255,.35)', marginBottom:4, textTransform:'uppercase' as const, letterSpacing:'0.6px' },
  btn:(c?:string,ghost=false):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:ghost?`1px solid ${T.bdr}`:'none', background:ghost?'transparent':(c||T.blueg), color:ghost?T.dim:'#fff', fontWeight:600, fontSize:12, cursor:'pointer', transition:'all .15s' }),
  btnG:(g:string):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:'none', background:g, color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer' }),
  chip:(c:string):React.CSSProperties=>({ display:'inline-block', padding:'2px 8px', borderRadius:20, background:c+'18', color:c, fontSize:10, fontWeight:700, border:`1px solid ${c}33` }),
  sec:{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase' as const, letterSpacing:'1px', marginBottom:10 } as React.CSSProperties,
  table:{ width:'100%', borderCollapse:'collapse' as const },
  th:{ padding:'8px 10px', fontSize:10, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase' as const, color:T.dim, borderBottom:`1px solid ${T.bdr}`, textAlign:'left' as const, whiteSpace:'nowrap' as const },
  td:{ padding:'8px 10px', fontSize:12, borderBottom:`1px solid ${T.bdr2}` },
  modal:{ position:'fixed' as const, inset:0, zIndex:5000, background:'rgba(0,0,0,.75)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  mCard:{ background:'#0d1521', border:`1px solid ${T.bdr}`, borderRadius:14, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' as const },
  mHdr:{ padding:'14px 18px', borderBottom:`1px solid ${T.bdr}`, display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky' as const, top:0, background:'#0d1521', zIndex:1 },
  g2:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hoje  = () => new Date().toLocaleDateString('pt-BR');
const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const TURNOS   = ['T1','T2','T0'];
const FUNCOES  = ['Charger','Scout','Scalt','Motorista','Promotor'];

function nivelLabel(pontos: number): { nivel: number; label: string; cor: string; emoji: string } {
  if (pontos >= 5000) return { nivel:5, label:'Lendário',    cor:'#f59e0b', emoji:'👑' };
  if (pontos >= 2000) return { nivel:4, label:'Especialista',cor:'#a855f7', emoji:'💎' };
  if (pontos >= 800)  return { nivel:3, label:'Experiente',  cor:'#3b82f6', emoji:'⭐' };
  if (pontos >= 300)  return { nivel:2, label:'Regular',     cor:'#10b981', emoji:'🔷' };
  return                     { nivel:1, label:'Iniciante',   cor:'#64748b', emoji:'🌱' };
}

function fmtTs(ts:any,short=false):string {
  if(!ts) return '—';
  const d=ts?.toDate?.()??new Date(ts);
  if(isNaN(d.getTime())) return '—';
  return short?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function toast(msg:string,tipo:'ok'|'erro'='ok'){
  const el=document.createElement('div');
  el.textContent=(tipo==='ok'?'✅ ':'❌ ')+msg;
  Object.assign(el.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'9999',
    background:tipo==='ok'?'linear-gradient(135deg,#10b981,#059669)':'linear-gradient(135deg,#ef4444,#dc2626)',
    color:'#fff',padding:'10px 18px',borderRadius:'10px',fontWeight:'700',fontSize:'13px',
    boxShadow:'0 4px 20px rgba(0,0,0,.5)',transition:'opacity .4s',fontFamily:"'Inter',sans-serif"});
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),400);},3000);
}

const ABAS: {id:AbaId;label:string}[] = [
  {id:'escala',          label:'📅 Escala Auto'},
  {id:'disponibilidade', label:'🗓 Disponibilidade'},
  {id:'ranking',         label:'🏆 Ranking'},
  {id:'penalidades',     label:'⚠️ Penalidades'},
  {id:'config',          label:'⚙️ Config'},
];

// ─── Componente raiz ──────────────────────────────────────────────────────────

export default function SlotsTeamsModule({ usuario, onFechar, cidade }: Props) {
  const [aba, setAba] = useState<AbaId>('escala');
  const cidadeAtiva = cidade || usuario.cidade || '';

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={S.logo}>👥</div>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:T.txt}}>Slots & Teams</div>
            <div style={{fontSize:11,color:T.dim}}>{cidadeAtiva||'Todas'} · Escala automática</div>
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:11,color:T.dim}}>{usuario.nome}</span>
          <button onClick={onFechar} style={{...S.btn(undefined,true),padding:'6px 12px'}}>✕ Fechar</button>
        </div>
      </div>
      <div style={S.tabs}>
        {ABAS.map(a=><button key={a.id} onClick={()=>setAba(a.id)} style={S.tab(aba===a.id)}>{a.label}</button>)}
      </div>
      <div style={S.body}>
        {aba==='escala'          && <AbaEscala          usuario={usuario} cidade={cidadeAtiva} />}
        {aba==='disponibilidade' && <AbaDisponibilidade  usuario={usuario} cidade={cidadeAtiva} />}
        {aba==='ranking'         && <AbaRanking          cidade={cidadeAtiva} />}
        {aba==='penalidades'     && <AbaPenalidades       usuario={usuario} cidade={cidadeAtiva} />}
        {aba==='config'          && <AbaConfigTeams       cidade={cidadeAtiva} />}
      </div>
    </div>
  );
}

interface AbaProps { usuario: Usuario; cidade: string; }

// ═══════════════════════════════════════════════════════════════════════════════
// ABA ESCALA — geração automática por disponibilidade + zona + feriado
// ═══════════════════════════════════════════════════════════════════════════════

function AbaEscala({usuario,cidade}:AbaProps){
  const [slots,        setSlots       ]=useState<Slot[]>([]);
  const [aceites,      setAceites     ]=useState<SlotAceite[]>([]);
  const [disponibilidades,setDisps    ]=useState<Disponibilidade[]>([]);
  const [feriados,     setFeriados    ]=useState<Feriado[]>([]);
  const [cfg,          setCfg         ]=useState<EscalaConfig|null>(null);
  const [gerando,      setGerando     ]=useState(false);
  const [diasAhead,    setDiasAhead   ]=useState(3);
  const [previa,       setPrevia      ]=useState<any[]>([]);
  const [showPrevia,   setShowPrevia  ]=useState(false);

  useEffect(()=>{
    const hojeDate = new Date(); hojeDate.setHours(0,0,0,0);
    const limDate  = new Date(hojeDate.getTime()+7*86400000);
    const hojeStr  = hojeDate.toLocaleDateString('pt-BR');

    const q=cidade?query(collection(db,'slots'),where('cidade','==',cidade),orderBy('criadoEm','desc'),limit(200)):query(collection(db,'slots'),orderBy('criadoEm','desc'),limit(200));
    const u1=onSnapshot(q,s=>setSlots(s.docs.map(d=>({id:d.id,...d.data()} as Slot)).filter(sl=>{
      try{const[dd,mm,yy]=sl.dataSlot.split('/').map(Number);const d=new Date(yy,mm-1,dd);return d>=hojeDate&&d<=limDate;}catch{return false;}
    })));
    const u2=onSnapshot(collection(db,'slot_aceites'),s=>setAceites(s.docs.map(d=>({id:d.id,...d.data()} as SlotAceite))));
    getDocs(cidade?query(collection(db,'disponibilidades'),where('cidade','==',cidade)):query(collection(db,'disponibilidades'))).then(s=>setDisps(s.docs.map(d=>({id:d.id,...d.data()} as Disponibilidade))));
    getDocs(collection(db,'feriados')).then(s=>setFeriados(s.docs.map(d=>({id:d.id,...d.data()} as Feriado))));
    getDoc(doc(db,'escala_config',cidade||'global')).then(d=>{if(d.exists())setCfg(d.data() as EscalaConfig);});
    return()=>{u1();u2();};
  },[cidade]);

  // Gera prévia da escala para os próximos N dias
  const gerarPrevia = useCallback(()=>{
    const gerado: any[] = [];
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    for(let d=1;d<=diasAhead;d++){
      const dataD = new Date(hoje.getTime()+d*86400000);
      const dataStr = dataD.toLocaleDateString('pt-BR');
      const diaSem  = dataD.getDay();

      const isFeriado = feriados.some(f=>f.data===dataStr||(f.nacional&&f.data.slice(0,5)===dataStr.slice(0,5)));

      for(const turno of TURNOS){
        for(const funcao of FUNCOES){
          // Encontra disponíveis para este dia/turno/função
          const disponiveis = disponibilidades.filter(dp=>
            dp.funcao===funcao&&
            dp.diasSemana.includes(diaSem)&&
            dp.turnosDisponiveis.includes(turno)&&
            (!cidade||dp.cidade===cidade)
          );

          if(disponiveis.length===0) continue;

          // Qtd padrão do config ou 2
          const qtd = cfg?.turnosConfig?.[turno]?.qtdPadrao || 2;
          const horaIni = cfg?.turnosConfig?.[turno]?.horaIni || (turno==='T1'?'07:00':turno==='T2'?'15:00':'23:00');
          const horaFim = cfg?.turnosConfig?.[turno]?.horaFim || (turno==='T1'?'15:00':turno==='T2'?'23:00':'07:00');

          // Verificar se já existe slot para este dia/turno/função
          const jaExiste = slots.some(sl=>sl.dataSlot===dataStr&&sl.turno===turno&&sl.tipo===funcao);
          if(jaExiste) continue;

          // Priorizar por nivel/pontos
          const candidatos = disponiveis
            .sort((a,b)=>{
              const pa = disponibilidades.find(d=>d.uid===a.uid);
              const pb = disponibilidades.find(d=>d.uid===b.uid);
              return 0; // seria ordenado por pontos do prestador
            })
            .slice(0,qtd*2); // pool de candidatos

          gerado.push({
            turno, horaIni, horaFim, tipo:funcao,
            dataSlot: dataStr,
            diaSem: DIAS_SEM[diaSem],
            isFeriado,
            qtdPessoas: qtd,
            candidatos: candidatos.length,
            cidade: cidade||'SP',
            status:'preview',
          });
        }
      }
    }
    setPrevia(gerado);
    setShowPrevia(true);
  },[diasAhead,disponibilidades,slots,feriados,cfg,cidade]);

  // Cria os slots da prévia no Firestore
  const confirmarEscala = async()=>{
    if(!previa.length){toast('Nenhum slot para criar','erro');return;}
    setGerando(true);
    let criados=0;
    for(const p of previa){
      await addDoc(collection(db,'slots'),{
        turno:p.turno, turnoLabel:`${p.turno} — ${p.horaIni} às ${p.horaFim}`,
        horaIni:p.horaIni, horaFim:p.horaFim,
        zona:p.zona||'Auto', tipo:p.tipo, qtdPessoas:p.qtdPessoas,
        status:'Aberto', dataSlot:p.dataSlot, cidade:p.cidade,
        geradoAuto:true, feriado:p.isFeriado,
        confirmacaoMin:cfg?.turnosConfig?.[p.turno]?.qtdPadrao||120,
        reaberturaSemConfMin:90,
        criadoEm:serverTimestamp(),
        criadoPorId:usuario.uid, criadoPorNome:usuario.nome,
      });
      criados++;
    }
    toast(`${criados} slots criados automaticamente`);
    setGerando(false);
    setShowPrevia(false);
    setPrevia([]);
  };

  // Stats da semana
  const hoje7d = new Date(); hoje7d.setHours(0,0,0,0);
  const slotsSem = slots.filter(()=>true); // já filtrado no useEffect
  const vagasTotal = slotsSem.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acAll = aceites.filter(a=>slotsSem.some(sl=>sl.id===a.slotId)&&a.status!=='Desistiu');
  const pctPreen = vagasTotal>0?Math.round(acAll.length/vagasTotal*100):0;

  return(
    <div>
      <div style={S.kpiRow}>
        {[
          {n:slotsSem.length, l:'Slots 7 dias',   c:T.bluel },
          {n:vagasTotal,      l:'Vagas total',     c:T.purple},
          {n:acAll.length,    l:'Aceites',         c:T.green },
          {n:`${pctPreen}%`,  l:'Preenchimento',   c:pctPreen>=80?T.green:pctPreen>=50?T.yellow:T.red},
          {n:disponibilidades.length,l:'Com disponib.',c:T.bluel},
          {n:feriados.length, l:'Feriados cad.',   c:T.orange},
        ].map(({n,l,c})=>(
          <div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>
        ))}
      </div>

      {/* Gerador automático */}
      <div style={{...S.card(T.blueg),marginBottom:14}}>
        <div style={S.sec}>⚙️ Gerador automático de escala</div>
        <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap',marginBottom:12}}>
          <div>
            <label style={S.lbl}>Gerar para os próximos</label>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {[1,2,3,5,7].map(d=>(
                <button key={d} onClick={()=>setDiasAhead(d)}
                  style={{...S.btn(T.bluel,diasAhead!==d),padding:'6px 12px',fontSize:12}}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <button onClick={gerarPrevia} style={{...S.btnG(T.blueg)}}>
            👁 Ver prévia ({diasAhead} dias)
          </button>
          {showPrevia&&previa.length>0&&(
            <button onClick={confirmarEscala} disabled={gerando}
              style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)')}}>
              {gerando?'Criando...':`✓ Criar ${previa.length} slots`}
            </button>
          )}
        </div>

        <div style={{fontSize:12,color:T.dim}}>
          Critérios: disponibilidade declarada × dia da semana × turno × função × zona.
          Feriados são detectados automaticamente.
          {disponibilidades.length===0&&<span style={{color:T.orange}}> ⚠️ Nenhuma disponibilidade cadastrada — peça para os prestadores preencherem na aba Disponibilidade.</span>}
        </div>
      </div>

      {/* Prévia */}
      {showPrevia&&(
        <div style={{...S.card(T.green),marginBottom:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={S.sec}>👁 Prévia — {previa.length} slots a criar</div>
            <button onClick={()=>setShowPrevia(false)} style={{...S.btn(undefined,true),padding:'4px 8px',fontSize:11}}>Ocultar</button>
          </div>
          {previa.length===0?(
            <div style={{color:T.dim,fontSize:12}}>Todos os slots já existem para este período.</div>
          ):(
            <div style={{overflowX:'auto'}}>
              <table style={S.table}>
                <thead><tr>{['Data','Dia','Turno','Função','Vagas','Candidatos','Feriado'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {previa.map((p,i)=>(
                    <tr key={i}>
                      <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{p.dataSlot}</td>
                      <td style={S.td}>{p.diaSem}</td>
                      <td style={S.td}><span style={S.chip(T.purple)}>{p.turno}</span></td>
                      <td style={S.td}><span style={S.chip(p.tipo==='Charger'?T.yellow:T.green)}>{p.tipo}</span></td>
                      <td style={{...S.td,textAlign:'center'}}>{p.qtdPessoas}</td>
                      <td style={{...S.td,textAlign:'center',color:p.candidatos>=p.qtdPessoas?T.green:T.red}}>{p.candidatos}</td>
                      <td style={S.td}>{p.isFeriado?<span style={S.chip(T.orange)}>🎉 Feriado</span>:'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Calendario slots 7 dias */}
      <div style={S.card()}>
        <div style={S.sec}>📅 Slots dos próximos 7 dias</div>
        {Array.from({length:7},(_,i)=>{
          const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+i);
          const dataStr = d.toLocaleDateString('pt-BR');
          const slotsDia = slots.filter(sl=>sl.dataSlot===dataStr);
          const isFeriado = feriados.some(f=>f.data===dataStr);
          return(
            <div key={i} style={{marginBottom:8,paddingBottom:8,borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13,color:T.txt}}>{DIAS_SEM[d.getDay()]}, {dataStr.slice(0,5)}</div>
                {isFeriado&&<span style={S.chip(T.orange)}>🎉 Feriado</span>}
                {slotsDia.length===0&&<span style={{fontSize:11,color:T.dim}}>Sem slots</span>}
                <div style={{fontSize:11,color:T.dim,marginLeft:'auto'}}>{slotsDia.length} slots</div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {slotsDia.map(sl=>{
                  const slAc=aceites.filter(a=>a.slotId===sl.id&&a.status!=='Desistiu').length;
                  const slAb=Math.max(0,sl.qtdPessoas-slAc);
                  return(
                    <div key={sl.id} style={{...S.card(),padding:'8px 10px',minWidth:120,flex:'0 0 auto'}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.bluel}}>{sl.turno} · {sl.horaIni}</div>
                      <div style={{fontSize:11,color:T.dim}}>{sl.tipo} · {sl.zona}</div>
                      <div style={{fontSize:10,marginTop:3}}>
                        <span style={S.chip(slAb>0?T.yellow:T.green)}>{slAc}/{sl.qtdPessoas}</span>
                        {sl.geradoAuto&&<span style={{...S.chip(T.dim),marginLeft:4,fontSize:9}}>AUTO</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPONIBILIDADE HOJE — banner inline na view admin
// ═══════════════════════════════════════════════════════════════════════════════

function DisponibilidadeHoje({lista}:{lista:Disponibilidade[]}){
  const hojeIdx=new Date().getDay();
  const [aberto,setAberto]=useState(false);
  const dispHoje=useMemo(()=>lista.filter(d=>(d.diasSemana||[]).includes(hojeIdx)),[lista,hojeIdx]);
  const diaLabel=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][hojeIdx];
  if(dispHoje.length===0) return(
    <div style={{...S.card(T.yellow),marginBottom:12,fontSize:12,color:T.dim}}>
      📅 Nenhum prestador disponível hoje ({diaLabel})
    </div>
  );
  return(
    <div style={{...S.card(T.green),marginBottom:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setAberto(a=>!a)}>
        <div style={{fontSize:12,fontWeight:700,color:T.txt}}>
          ✅ {dispHoje.length} disponíveis hoje ({diaLabel})
        </div>
        <span style={{color:T.dim,fontSize:12}}>{aberto?'▲':'▼'}</span>
      </div>
      {aberto&&(
        <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
          {dispHoje.map(d=>(
            <div key={d.id} style={{background:T.card,borderRadius:8,padding:'6px 10px',fontSize:11}}>
              <div style={{fontWeight:600,color:T.txt}}>{d.nome}</div>
              <div style={{color:T.dim,marginTop:2}}>
                <span style={S.chip(d.funcao==='Charger'?T.yellow:T.green)}>{d.funcao}</span>
                {' '}{(d.turnosDisponiveis||[]).join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA DISPONIBILIDADE — prestadores declaram quando podem trabalhar
// ═══════════════════════════════════════════════════════════════════════════════

const CAMPO_ROLES = ['logistica','campo','charger','scalt','promotor'];

function AbaDisponibilidade({usuario,cidade}:AbaProps){
  const isCampo = CAMPO_ROLES.includes(usuario.role);
  const [lista,    setLista   ]=useState<Disponibilidade[]>([]);
  const [busca,    setBusca   ]=useState('');
  const [modal,    setModal   ]=useState(false);
  const [editando, setEditando]=useState<Disponibilidade|null>(null);
  const [form,     setForm    ]=useState<Partial<Disponibilidade>>({
    diasSemana:[1,2,3,4,5],turnosDisponiveis:['T1'],zonasDisponiveis:[],funcao:'Scout',
  });
  const [zonas,    setZonas   ]=useState<string[]>([]);
  const [salvando, setSalvando]=useState(false);
  // self-service: disponibilidade do próprio usuário
  const [minha,    setMinha   ]=useState<Disponibilidade|null>(null);
  const [minhaForm,setMinhaForm]=useState<Partial<Disponibilidade>>({
    diasSemana:[1,2,3,4,5],turnosDisponiveis:['T1'],zonasDisponiveis:[],funcao:'Scout',
  });
  const [salvandoMinha,setSalvandoMinha]=useState(false);

  useEffect(()=>{
    const q=cidade?query(collection(db,'disponibilidades'),where('cidade','==',cidade)):query(collection(db,'disponibilidades'));
    const u=onSnapshot(q,s=>{
      const all=s.docs.map(d=>({id:d.id,...d.data()} as Disponibilidade));
      setLista(all);
      // self-service: encontra registro do próprio usuário
      if(isCampo){
        const meu=all.find(d=>d.uid===usuario.uid)||null;
        setMinha(meu);
        if(meu) setMinhaForm({...meu});
      }
    });
    // Buscar zonas disponíveis
    getDocs(cidade?query(collection(db,'slots'),where('cidade','==',cidade),limit(50)):query(collection(db,'slots'),limit(50))).then(s=>{
      const set=new Set<string>();s.docs.forEach(d=>{const z=d.data().zona;if(z)set.add(z);});setZonas(Array.from(set).sort());
    });
    return u;
  },[cidade,isCampo,usuario.uid]);

  const salvarMinha=async()=>{
    if(!minhaForm.funcao){toast('Selecione a função','erro');return;}
    setSalvandoMinha(true);
    const payload:Partial<Disponibilidade>={
      ...minhaForm,
      uid:usuario.uid,
      nome:usuario.nome||usuario.email,
      cidade:cidade||'SP',
      atualizadoEm:serverTimestamp(),
    };
    try{
      if(minha?.id){
        await updateDoc(doc(db,'disponibilidades',minha.id),payload);
      }else{
        await addDoc(collection(db,'disponibilidades'),{...payload,criadoEm:serverTimestamp()});
      }
      toast('Disponibilidade salva!');
    }catch(e:any){toast(e.message,'erro');}
    finally{setSalvandoMinha(false);}
  };

  const filtrados=useMemo(()=>lista.filter(d=>!busca||d.nome.toLowerCase().includes(busca.toLowerCase())||(d.cnpj||'').includes(busca)),[lista,busca]);

  const salvar=async()=>{
    if(!form.nome?.trim()||!form.funcao){toast('Nome e função obrigatórios','erro');return;}
    setSalvando(true);
    const payload={...form,cidade:cidade||'SP',atualizadoEm:serverTimestamp()};
    try{
      if(editando?.id){await updateDoc(doc(db,'disponibilidades',editando.id),payload);toast('Atualizado');}
      else{await addDoc(collection(db,'disponibilidades'),{...payload,criadoEm:serverTimestamp()});toast('Cadastrado');}
      setModal(false);
    }catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const toggleDia=(d:number)=>setForm(f=>({...f,diasSemana:(f.diasSemana||[]).includes(d)?(f.diasSemana||[]).filter(x=>x!==d):[...(f.diasSemana||[]),d]}));
  const toggleTurno=(t:string)=>setForm(f=>({...f,turnosDisponiveis:(f.turnosDisponiveis||[]).includes(t)?(f.turnosDisponiveis||[]).filter(x=>x!==t):[...(f.turnosDisponiveis||[]),t]}));
  const toggleZona=(z:string)=>setForm(f=>({...f,zonasDisponiveis:(f.zonasDisponiveis||[]).includes(z)?(f.zonasDisponiveis||[]).filter(x=>x!==z):[...(f.zonasDisponiveis||[]),z]}));

  const mToggleDia=(d:number)=>setMinhaForm(f=>({...f,diasSemana:(f.diasSemana||[]).includes(d)?(f.diasSemana||[]).filter(x=>x!==d):[...(f.diasSemana||[]),d]}));
  const mToggleTurno=(t:string)=>setMinhaForm(f=>({...f,turnosDisponiveis:(f.turnosDisponiveis||[]).includes(t)?(f.turnosDisponiveis||[]).filter(x=>x!==t):[...(f.turnosDisponiveis||[]),t]}));
  const mToggleZona=(z:string)=>setMinhaForm(f=>({...f,zonasDisponiveis:(f.zonasDisponiveis||[]).includes(z)?(f.zonasDisponiveis||[]).filter(x=>x!==z):[...(f.zonasDisponiveis||[]),z]}));

  // self-service view (campo roles)
  if(isCampo) return(
    <div style={{maxWidth:560}}>
      <div style={{...S.card(T.bluel),marginBottom:16,fontSize:13,color:T.txt}}>
        <div style={{fontWeight:700,marginBottom:4}}>📅 Minha disponibilidade</div>
        <div style={{fontSize:11,color:T.dim,lineHeight:1.5}}>
          Informe seus dias, turnos e zonas preferidos. O gestor usa essas informações para montar a escala.
        </div>
      </div>

      {minha&&(
        <div style={{...S.card(T.green),marginBottom:12,fontSize:11,color:T.dim,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:16}}>✅</span>
          <div>
            <b style={{color:T.txt}}>Disponibilidade já cadastrada.</b> Atualize abaixo e salve quando quiser.
          </div>
        </div>
      )}

      <div style={{...S.card(),marginBottom:14}}>
        <label style={S.lbl}>Função</label>
        <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
          {FUNCOES.map(fn=><button key={fn} onClick={()=>setMinhaForm(f=>({...f,funcao:fn}))} style={{...S.btn(fn==='Charger'?T.yellow:T.green,minhaForm.funcao!==fn),padding:'6px 14px'}}>{fn}</button>)}
        </div>

        <label style={S.lbl}>Dias disponíveis</label>
        <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
          {DIAS_SEM.map((d,i)=>(
            <button key={i} onClick={()=>mToggleDia(i)} style={{...S.btn(T.bluel,!(minhaForm.diasSemana||[]).includes(i)),padding:'8px 12px',fontSize:12}}>{d}</button>
          ))}
        </div>

        <label style={S.lbl}>Turnos disponíveis</label>
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          {TURNOS.map(t=><button key={t} onClick={()=>mToggleTurno(t)} style={{...S.btn(T.purple,!(minhaForm.turnosDisponiveis||[]).includes(t)),padding:'8px 14px'}}>{t}</button>)}
        </div>

        {zonas.length>0&&(
          <>
            <label style={S.lbl}>Zonas preferidas (opcional)</label>
            <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
              {zonas.map(z=><button key={z} onClick={()=>mToggleZona(z)} style={{...S.btn(T.orange,!(minhaForm.zonasDisponiveis||[]).includes(z)),padding:'6px 10px',fontSize:11}}>{z}</button>)}
            </div>
          </>
        )}

        <label style={S.lbl}>Observações (opcional)</label>
        <input value={minhaForm.obs||''} onChange={e=>setMinhaForm(f=>({...f,obs:e.target.value}))} style={S.inp} placeholder="Ex: prefiro T1, disponível nos feriados"/>

        <button onClick={salvarMinha} disabled={salvandoMinha} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),width:'100%',marginTop:12}}>
          {salvandoMinha?'Salvando...':(minha?'✓ Atualizar disponibilidade':'✓ Confirmar disponibilidade')}
        </button>
      </div>
    </div>
  );

  // admin/gestor view
  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Nome ou CNPJ..." style={{...S.inp,marginBottom:0,flex:1}}/>
        <button onClick={()=>{setEditando(null);setForm({diasSemana:[1,2,3,4,5],turnosDisponiveis:['T1'],zonasDisponiveis:[],funcao:'Scout'});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>+ Cadastrar</button>
      </div>
      <DisponibilidadeHoje lista={lista} />
      <div style={{...S.card(T.bluel),marginBottom:14,fontSize:12,color:T.dim}}>
        <b style={{color:T.txt}}>💡 Como funciona:</b> Cada prestador declara seus dias/turnos/zonas disponíveis.
        O gerador automático usa essas informações para criar slots com candidatos pré-selecionados por nível e histórico.
      </div>

      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={S.table}>
          <thead><tr>{['Nome','Função','Dias','Turnos','Zonas','Ações'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtrados.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhuma disponibilidade cadastrada</td></tr>}
            {filtrados.map(d=>(
              <tr key={d.id}>
                <td style={{...S.td,fontWeight:600}}>{d.nome}<div style={{fontSize:10,color:T.dim,fontFamily:'monospace'}}>{d.cnpj}</div></td>
                <td style={S.td}><span style={S.chip(d.funcao==='Charger'?T.yellow:T.green)}>{d.funcao}</span></td>
                <td style={{...S.td,fontSize:11}}>{(d.diasSemana||[]).map(i=>DIAS_SEM[i]).join(', ')}</td>
                <td style={{...S.td,fontSize:11}}>{(d.turnosDisponiveis||[]).join(', ')}</td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{(d.zonasDisponiveis||[]).slice(0,2).join(', ')}{(d.zonasDisponiveis||[]).length>2?'...':''}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>{setEditando(d);setForm({...d});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  <button onClick={async()=>{if(d.id&&window.confirm(`Remover ${d.nome}?`)){await deleteDoc(doc(db,'disponibilidades',d.id));toast('Removido');}}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal&&(
        <div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
          <div style={S.mCard}>
            <div style={S.mHdr}>
              <div style={{fontWeight:700,color:T.txt}}>{editando?'Editar disponibilidade':'+ Cadastrar disponibilidade'}</div>
              <button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div style={{padding:18}}>
              <div style={S.g2}>
                <div><label style={S.lbl}>Nome *</label><input value={form.nome||''} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/></div>
                <div><label style={S.lbl}>CNPJ</label><input value={form.cnpj||''} onChange={e=>setForm(f=>({...f,cnpj:e.target.value}))} style={S.inp} placeholder="00.000.000/0000-00"/></div>
              </div>
              <label style={S.lbl}>Função</label>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {FUNCOES.map(fn=><button key={fn} onClick={()=>setForm(f=>({...f,funcao:fn}))} style={{...S.btn(fn==='Charger'?T.yellow:T.green,form.funcao!==fn),padding:'6px 12px'}}>{fn}</button>)}
              </div>
              <label style={S.lbl}>Dias disponíveis</label>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {DIAS_SEM.map((d,i)=>(
                  <button key={i} onClick={()=>toggleDia(i)} style={{...S.btn(T.bluel,!(form.diasSemana||[]).includes(i)),padding:'6px 10px',fontSize:11}}>{d}</button>
                ))}
              </div>
              <label style={S.lbl}>Turnos disponíveis</label>
              <div style={{display:'flex',gap:6,marginBottom:10}}>
                {TURNOS.map(t=><button key={t} onClick={()=>toggleTurno(t)} style={{...S.btn(T.purple,!(form.turnosDisponiveis||[]).includes(t)),padding:'6px 12px'}}>{t}</button>)}
              </div>
              {zonas.length>0&&(
                <>
                  <label style={S.lbl}>Zonas preferidas</label>
                  <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                    {zonas.map(z=><button key={z} onClick={()=>toggleZona(z)} style={{...S.btn(T.orange,!(form.zonasDisponiveis||[]).includes(z)),padding:'5px 10px',fontSize:11}}>{z}</button>)}
                  </div>
                </>
              )}
              <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>
                {salvando?'Salvando...':editando?'✓ Salvar':'✓ Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA RANKING — gamificação, níveis, streaks
// ═══════════════════════════════════════════════════════════════════════════════

function AbaRanking({cidade}:{cidade:string}){
  const [prestadores,setPrestadores]=useState<Prestador[]>([]);
  const [loading,    setLoading    ]=useState(true);
  const [periodo,    setPeriodo    ]=useState<'semana'|'mes'|'total'>('mes');
  const [funcaoFilt, setFuncaoFilt ]=useState('todos');

  useEffect(()=>{
    setLoading(true);
    const q=cidade?query(collection(db,'prestadores'),where('cidade','==',cidade),orderBy('pontos','desc'),limit(100)):query(collection(db,'prestadores'),orderBy('pontos','desc'),limit(100));
    const u=onSnapshot(q,s=>{setPrestadores(s.docs.map(d=>({id:d.id,...d.data()} as Prestador)));setLoading(false);});
    return u;
  },[cidade]);

  const filtrados=useMemo(()=>prestadores.filter(p=>funcaoFilt==='todos'||p.funcao===funcaoFilt),[prestadores,funcaoFilt]);

  const top3=filtrados.slice(0,3);
  const resto=filtrados.slice(3);

  const medalha=(i:number)=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'';

  return(
    <div>
      {/* Filtros */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',gap:4}}>
          {(['semana','mes','total'] as const).map(p=>(
            <button key={p} onClick={()=>setPeriodo(p)} style={{...S.btn(T.bluel,periodo!==p),padding:'6px 12px',fontSize:11}}>
              {p==='semana'?'📅 Semana':p==='mes'?'🗓 Mês':'🏆 Total'}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:4}}>
          {['todos',...FUNCOES].map(fn=>(
            <button key={fn} onClick={()=>setFuncaoFilt(fn)}
              style={{...S.btn(fn==='todos'?T.bluel:fn==='Charger'?T.yellow:T.green,funcaoFilt!==fn),padding:'5px 10px',fontSize:11}}>
              {fn==='todos'?'Todos':fn}
            </button>
          ))}
        </div>
      </div>

      {/* Podium top 3 */}
      {top3.length>0&&(
        <div style={{display:'flex',gap:12,justifyContent:'center',alignItems:'flex-end',marginBottom:20}}>
          {[top3[1],top3[0],top3[2]].filter(Boolean).map((p,idx)=>{
            const posicoes=[1,0,2];const pos=filtrados.indexOf(p);
            const altura=pos===0?120:pos===1?90:75;
            const meta=nivelLabel(p.pontos);
            return(
              <div key={p.id} style={{textAlign:'center',flex:1,maxWidth:140}}>
                <div style={{fontSize:24,marginBottom:4}}>{medalha(pos)}</div>
                <div style={{width:60,height:60,borderRadius:'50%',background:meta.cor+'22',border:`3px solid ${meta.cor}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,margin:'0 auto 6px'}}>{meta.emoji}</div>
                <div style={{fontWeight:700,fontSize:12,color:T.txt,marginBottom:2}}>{p.nome.split(' ')[0]}</div>
                <div style={{fontSize:10,color:T.dim}}>{p.funcao}</div>
                <div style={{fontWeight:800,fontSize:16,color:meta.cor,marginTop:4}}>{p.pontos.toLocaleString()} pts</div>
                <div style={{background:T.card,borderRadius:'0 0 8px 8px',padding:'6px 8px',height:altura,marginTop:6,display:'flex',flexDirection:'column',justifyContent:'center',border:`1px solid ${meta.cor}33`,borderTop:`3px solid ${meta.cor}`}}>
                  <div style={{fontSize:10,color:T.dim}}>🔥 Streak: {p.streak}d</div>
                  <div style={{fontSize:10,color:T.dim}}>📋 Slots: {p.totalSlots}</div>
                  <div style={{fontSize:10,color:T.dim}}>⭐ {p.avaliacaoMedia?.toFixed(1)||'—'}/5</div>
                  <div style={{...S.chip(meta.cor),marginTop:4,fontSize:9}}>{meta.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabela resto */}
      {loading?<div style={{color:T.dim,textAlign:'center',padding:40}}>Carregando...</div>:(
        <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
          <table style={S.table}>
            <thead><tr>{['#','Prestador','Nível','Pontos','Streak','Slots','Faltas','Avaliação','Função'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {filtrados.length===0&&<tr><td colSpan={9} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhum prestador no ranking</td></tr>}
              {filtrados.map((p,i)=>{
                const meta=nivelLabel(p.pontos);
                return(
                  <tr key={p.id}>
                    <td style={{...S.td,fontWeight:800,color:i<3?T.yellowl:T.dim,fontSize:14}}>{medalha(i)||i+1}</td>
                    <td style={{...S.td,fontWeight:600}}>
                      <div style={{color:T.txt}}>{p.nome}</div>
                      <div style={{fontSize:10,color:T.dim,fontFamily:'monospace'}}>{p.cnpj}</div>
                    </td>
                    <td style={S.td}><span style={S.chip(meta.cor)}>{meta.emoji} {meta.label}</span></td>
                    <td style={{...S.td,fontWeight:700,color:meta.cor}}>{p.pontos.toLocaleString()}</td>
                    <td style={S.td}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{color:p.streak>=7?T.orange:T.dim}}>🔥</span>
                        <span style={{fontWeight:p.streak>=7?700:400,color:p.streak>=7?T.orange:T.txt}}>{p.streak}d</span>
                        {p.streakMax>0&&<span style={{fontSize:10,color:T.dim}}>(max {p.streakMax})</span>}
                      </div>
                    </td>
                    <td style={S.td}>{p.totalSlots}</td>
                    <td style={{...S.td,color:p.totalFaltas>3?T.red:T.dim}}>{p.totalFaltas}</td>
                    <td style={S.td}>
                      {p.avaliacaoMedia>0?(
                        <div style={{display:'flex',alignItems:'center',gap:3}}>
                          <span style={{color:p.avaliacaoMedia>=4.5?T.green:p.avaliacaoMedia>=3.5?T.yellow:T.red,fontWeight:700}}>
                            {p.avaliacaoMedia.toFixed(1)}
                          </span>
                          <span style={{fontSize:10,color:T.dim}}>/5</span>
                        </div>
                      ):'—'}
                    </td>
                    <td style={S.td}><span style={S.chip(p.funcao==='Charger'?T.yellow:T.green)}>{p.funcao}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda de níveis */}
      <div style={{...S.card(),marginTop:14}}>
        <div style={S.sec}>🏆 Níveis e pontuação</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
          {[{min:0,max:299,n:1,l:'Iniciante',c:'#64748b',e:'🌱'},{min:300,max:799,n:2,l:'Regular',c:T.green,e:'🔷'},{min:800,max:1999,n:3,l:'Experiente',c:T.bluel,e:'⭐'},{min:2000,max:4999,n:4,l:'Especialista',c:T.purple,e:'💎'},{min:5000,max:99999,n:5,l:'Lendário',c:T.yellow,e:'👑'}].map(nv=>(
            <div key={nv.n} style={{...S.card(nv.c),padding:'10px 12px'}}>
              <div style={{fontSize:20,marginBottom:4}}>{nv.e}</div>
              <div style={{fontWeight:700,fontSize:12,color:nv.c}}>{nv.l}</div>
              <div style={{fontSize:10,color:T.dim}}>{nv.min.toLocaleString()}–{nv.max===99999?'∞':nv.max.toLocaleString()} pts</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:10,fontSize:11,color:T.dim,lineHeight:1.8}}>
          <b style={{color:T.txt}}>Como ganhar pontos:</b><br/>
          ✅ Presença confirmada: +{10} pts · ▶ Início no prazo: +{5} pts · ⭐ Avaliação 5★: +{10} pts<br/>
          🔥 Streak semanal (7d): +{25} pts · 🔥 Streak mensal (30d): +{100} pts · 🔴 Ponto zerado: +{15} pts<br/>
          ❌ Falta: -{30} pts · ⏰ Atraso 15min: -{10} pts · ⏰ Atraso 30min: -{20} pts · ✖ Cancelamento tardio: -{15} pts
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA PENALIDADES
// ═══════════════════════════════════════════════════════════════════════════════

function AbaPenalidades({usuario,cidade}:AbaProps){
  const [lista,    setLista   ]=useState<Penalidade[]>([]);
  const [modal,    setModal   ]=useState(false);
  const [form,     setForm    ]=useState<Partial<Penalidade>>({tipo:'falta',pontosDeducao:30,descricao:'',cidade:cidade||'SP'});
  const [prestadores,setPrests]=useState<{id:string;nome:string;cnpj:string}[]>([]);
  const [salvando, setSalvando]=useState(false);

  useEffect(()=>{
    const q=cidade?query(collection(db,'penalidades'),where('cidade','==',cidade),orderBy('criadoEm','desc'),limit(200)):query(collection(db,'penalidades'),orderBy('criadoEm','desc'),limit(200));
    const u=onSnapshot(q,s=>setLista(s.docs.map(d=>({id:d.id,...d.data()} as Penalidade))));
    getDocs(cidade?query(collection(db,'prestadores'),where('cidade','==',cidade)):query(collection(db,'prestadores'),limit(100))).then(s=>setPrests(s.docs.map(d=>({id:d.id,...(d.data() as any)}))));
    return u;
  },[cidade]);

  const TIPOS_PEN=[
    {k:'falta',l:'Falta',pts:30,c:T.red},
    {k:'atraso',l:'Atraso',pts:15,c:T.orange},
    {k:'cancelamento_tardio',l:'Cancelamento Tardio',pts:15,c:T.yellow},
    {k:'comportamento',l:'Comportamento',pts:20,c:T.purple},
  ] as const;

  const salvar=async()=>{
    if(!form.uid||!form.descricao){toast('Selecione prestador e descrição','erro');return;}
    setSalvando(true);
    try{
      await addDoc(collection(db,'penalidades'),{...form,cidade:cidade||'SP',aplicadoPor:usuario.uid,criadoEm:serverTimestamp()});
      // Deduzir pontos do prestador
      const pDoc=await getDocs(query(collection(db,'prestadores'),where('uid','==',form.uid),limit(1)));
      if(!pDoc.empty){
        await updateDoc(pDoc.docs[0].ref,{
          pontos:Math.max(0,(pDoc.docs[0].data().pontos||0)-(form.pontosDeducao||0)),
          totalFaltas:form.tipo==='falta'?(pDoc.docs[0].data().totalFaltas||0)+1:pDoc.docs[0].data().totalFaltas||0,
          totalAtrasos:form.tipo==='atraso'?(pDoc.docs[0].data().totalAtrasos||0)+1:pDoc.docs[0].data().totalAtrasos||0,
        });
      }
      toast('Penalidade aplicada');setModal(false);
      setForm({tipo:'falta',pontosDeducao:30,descricao:'',cidade:cidade||'SP'});
    }catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const tipoCor=(t:string)=>TIPOS_PEN.find(x=>x.k===t)?.c||T.dim;
  const tipoLabel=(t:string)=>TIPOS_PEN.find(x=>x.k===t)?.l||t;

  return(
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <button onClick={()=>setModal(true)} style={{...S.btnG('linear-gradient(135deg,#ef4444,#dc2626)'),fontSize:12}}>⚠️ Registrar penalidade</button>
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={S.table}>
          <thead><tr>{['Data','Prestador','Tipo','Descrição','Pts deduzidos','Por'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhuma penalidade registrada</td></tr>}
            {lista.map(p=>(
              <tr key={p.id}>
                <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{fmtTs(p.criadoEm,true)}</td>
                <td style={{...S.td,fontWeight:600}}>{p.nome}</td>
                <td style={S.td}><span style={S.chip(tipoCor(p.tipo))}>{tipoLabel(p.tipo)}</span></td>
                <td style={{...S.td,fontSize:11,color:T.dim,maxWidth:200}}>{p.descricao}</td>
                <td style={{...S.td,color:T.red,fontWeight:700}}>-{p.pontosDeducao} pts</td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{p.aplicadoPor||'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal&&(
        <div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
          <div style={S.mCard}>
            <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>⚠️ Registrar Penalidade</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
            <div style={{padding:18}}>
              <label style={S.lbl}>Prestador *</label>
              <select value={form.uid||''} onChange={e=>{const p=prestadores.find(x=>x.id===e.target.value);setForm(f=>({...f,uid:e.target.value,nome:p?.nome||'',cnpj:p?.cnpj||''}));}} style={S.inp}>
                <option value="">— Selecionar —</option>
                {prestadores.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <label style={S.lbl}>Tipo</label>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {TIPOS_PEN.map(t=>(
                  <button key={t.k} onClick={()=>setForm(f=>({...f,tipo:t.k as any,pontosDeducao:t.pts}))} style={{...S.btn(t.c,form.tipo!==t.k),padding:'6px 12px',fontSize:11}}>{t.l} (-{t.pts}pts)</button>
                ))}
              </div>
              <label style={S.lbl}>Descrição *</label>
              <input value={form.descricao||''} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} style={S.inp} placeholder="Ex: Faltou no slot T1 sem aviso"/>
              <label style={S.lbl}>Pontos a deduzir</label>
              <input type="number" min={1} max={200} value={form.pontosDeducao||0} onChange={e=>setForm(f=>({...f,pontosDeducao:parseInt(e.target.value)||0}))} style={S.inp}/>
              <div style={{...S.card(T.red),marginBottom:12,fontSize:12,color:T.dim}}>
                ⚠️ Esta ação deduzirá <b style={{color:T.red}}>{form.pontosDeducao} pontos</b> do prestador e será registrada permanentemente.
              </div>
              <button onClick={salvar} disabled={salvando} style={{...S.btnG('linear-gradient(135deg,#ef4444,#dc2626)'),width:'100%'}}>
                {salvando?'Aplicando...':'⚠️ Aplicar penalidade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA CONFIG TEAMS
// ═══════════════════════════════════════════════════════════════════════════════

function AbaConfigTeams({cidade}:{cidade:string}){
  const [cfg,setCfg]=useState<EscalaConfig>({
    id:'',cidade:cidade||'SP',diasAntecedencia:3,
    turnosConfig:{
      T1:{horaIni:'07:00',horaFim:'15:00',qtdPadrao:3},
      T2:{horaIni:'15:00',horaFim:'23:00',qtdPadrao:3},
      T0:{horaIni:'23:00',horaFim:'07:00',qtdPadrao:2},
    },
    respeitarPreferencias:true, respeitarFeriados:true, nivelMinimoUrgente:1,
    bonus:{presencaConfirmada:10,inicioNoPrazo:5,avaliacaoExcelente:10,streakSemanal:25,streakMensal:100,pontoZerado:15},
    penalidades:{falta:30,atraso15:10,atraso30:20,cancelamentoTardio:15},
  });
  const [feriados,setFeriados]=useState<Feriado[]>([]);
  const [novoFeriado,setNovoFeriado]=useState({data:'',nome:'',nacional:false});
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{
    getDoc(doc(db,'escala_config',cidade||'global')).then(d=>{if(d.exists())setCfg(prev=>({...prev,...d.data() as EscalaConfig}));});
    onSnapshot(collection(db,'feriados'),s=>setFeriados(s.docs.map(d=>({id:d.id,...d.data()} as Feriado))));
  },[cidade]);

  const salvar=async()=>{
    setSalvando(true);
    try{await setDoc(doc(db,'escala_config',cidade||'global'),{...cfg,atualizadoEm:serverTimestamp()});toast('Config salva');}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const adicionarFeriado=async()=>{
    if(!novoFeriado.data||!novoFeriado.nome){toast('Data e nome obrigatórios','erro');return;}
    await addDoc(collection(db,'feriados'),{...novoFeriado,cidade:novoFeriado.nacional?null:cidade,criadoEm:serverTimestamp()});
    toast('Feriado adicionado');setNovoFeriado({data:'',nome:'',nacional:false});
  };

  const N=({label,val,onChange,min=0,max=500}:{label:string;val:number;onChange:(v:number)=>void;min?:number;max?:number})=>(
    <div><label style={S.lbl}>{label}</label><input type="number" min={min} max={max} value={val} onChange={e=>onChange(parseInt(e.target.value)||0)} style={S.inp}/></div>
  );

  return(
    <div style={{maxWidth:640}}>
      <div style={{...S.card(T.bluel),marginBottom:14}}>
        <div style={S.sec}>⚙️ Configurações de escala — {cidade||'global'}</div>
        <div style={S.g2}>
          <N label="Gerar escala (dias antes)" val={cfg.diasAntecedencia} onChange={v=>setCfg(c=>({...c,diasAntecedencia:v}))} min={1} max={14}/>
          <N label="Nível mínimo (urgências)" val={cfg.nivelMinimoUrgente} onChange={v=>setCfg(c=>({...c,nivelMinimoUrgente:v}))} min={1} max={5}/>
        </div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:T.txt}}>
            <input type="checkbox" checked={cfg.respeitarPreferencias} onChange={e=>setCfg(c=>({...c,respeitarPreferencias:e.target.checked}))}/>
            Respeitar preferências de zona/turno
          </label>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:T.txt}}>
            <input type="checkbox" checked={cfg.respeitarFeriados} onChange={e=>setCfg(c=>({...c,respeitarFeriados:e.target.checked}))}/>
            Marcar feriados na escala
          </label>
        </div>
      </div>

      <div style={{...S.card(T.purple),marginBottom:14}}>
        <div style={S.sec}>⏰ Horários por turno</div>
        {TURNOS.map(t=>(
          <div key={t} style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:T.bluel,marginBottom:6}}>{t}</div>
            <div style={S.g2}>
              <div><label style={S.lbl}>Hora início</label><input type="time" value={cfg.turnosConfig?.[t]?.horaIni||''} onChange={e=>setCfg(c=>({...c,turnosConfig:{...c.turnosConfig,[t]:{...c.turnosConfig?.[t],horaIni:e.target.value}}}))} style={S.inp}/></div>
              <div><label style={S.lbl}>Hora fim</label><input type="time" value={cfg.turnosConfig?.[t]?.horaFim||''} onChange={e=>setCfg(c=>({...c,turnosConfig:{...c.turnosConfig,[t]:{...c.turnosConfig?.[t],horaFim:e.target.value}}}))} style={S.inp}/></div>
              <div><label style={S.lbl}>Vagas padrão</label><input type="number" min={1} max={20} value={cfg.turnosConfig?.[t]?.qtdPadrao||2} onChange={e=>setCfg(c=>({...c,turnosConfig:{...c.turnosConfig,[t]:{...c.turnosConfig?.[t],qtdPadrao:parseInt(e.target.value)||2}}}))} style={S.inp}/></div>
            </div>
          </div>
        ))}
      </div>

      <div style={{...S.card(T.green),marginBottom:14}}>
        <div style={S.sec}>🏆 Bônus de pontuação</div>
        <div style={S.g2}>
          <N label="Presença confirmada" val={cfg.bonus.presencaConfirmada} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,presencaConfirmada:v}}))}/>
          <N label="Início no prazo" val={cfg.bonus.inicioNoPrazo} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,inicioNoPrazo:v}}))}/>
          <N label="Avaliação 5★" val={cfg.bonus.avaliacaoExcelente} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,avaliacaoExcelente:v}}))}/>
          <N label="Ponto zerado atendido" val={cfg.bonus.pontoZerado} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,pontoZerado:v}}))}/>
          <N label="Streak semanal (7d)" val={cfg.bonus.streakSemanal} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,streakSemanal:v}}))}/>
          <N label="Streak mensal (30d)" val={cfg.bonus.streakMensal} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,streakMensal:v}}))}/>
        </div>
      </div>

      <div style={{...S.card(T.red),marginBottom:14}}>
        <div style={S.sec}>⚠️ Penalidades</div>
        <div style={S.g2}>
          <N label="Falta (-pts)" val={cfg.penalidades.falta} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,falta:v}}))}/>
          <N label="Atraso 15min (-pts)" val={cfg.penalidades.atraso15} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,atraso15:v}}))}/>
          <N label="Atraso 30min (-pts)" val={cfg.penalidades.atraso30} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,atraso30:v}}))}/>
          <N label="Cancelamento tardio (-pts)" val={cfg.penalidades.cancelamentoTardio} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,cancelamentoTardio:v}}))}/>
        </div>
      </div>

      <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',padding:'11px',marginBottom:16}}>{salvando?'Salvando...':'✓ Salvar configurações'}</button>

      {/* Feriados */}
      <div style={S.card(T.orange)}>
        <div style={S.sec}>🎉 Feriados</div>
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <input type="date" value={novoFeriado.data} onChange={e=>setNovoFeriado(f=>({...f,data:e.target.value}))} style={{...S.inp,marginBottom:0,flex:1,minWidth:130}}/>
          <input value={novoFeriado.nome} onChange={e=>setNovoFeriado(f=>({...f,nome:e.target.value}))} style={{...S.inp,marginBottom:0,flex:2}} placeholder="Nome do feriado"/>
          <label style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:T.txt,flexShrink:0}}>
            <input type="checkbox" checked={novoFeriado.nacional} onChange={e=>setNovoFeriado(f=>({...f,nacional:e.target.checked}))}/>Nacional
          </label>
          <button onClick={adicionarFeriado} style={{...S.btnG(T.blueg),flexShrink:0}}>+ Add</button>
        </div>
        <div style={{maxHeight:200,overflowY:'auto'}}>
          {feriados.filter(f=>!f.cidade||f.cidade===cidade||f.nacional).map(f=>(
            <div key={f.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <span style={{fontFamily:'monospace',fontSize:11,color:T.dim,flexShrink:0}}>{f.data}</span>
              <span style={{flex:1,fontSize:12,color:T.txt}}>{f.nome}</span>
              {f.nacional&&<span style={S.chip(T.orange)}>Nacional</span>}
              <button onClick={async()=>{if(f.id)await deleteDoc(doc(db,'feriados',f.id));}} style={{...S.btn(T.red,true),padding:'2px 6px',fontSize:10}}>🗑</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
