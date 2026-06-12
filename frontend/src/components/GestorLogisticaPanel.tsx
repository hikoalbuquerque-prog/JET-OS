// frontend/src/components/GestorLogisticaPanel.tsx — JET OS V2 — v3.0
// Controle de cidade: gestor vê só sua cidade; supergestor/admin escolhem via dropdown
// Abas: Dashboard | Presença | Operadores | Slots | Tarefas | Desempenho | MEIs | CLT | Inventário | Telegram | Config

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, query, where, orderBy, onSnapshot, limit,
  doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, Timestamp, setDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Usuario {
  uid: string; nome: string; email: string; role: string;
  cidadesGerenciaLog?: string[];
}
interface Props {
  usuario: Usuario; onFechar: () => void; cidade?: string;
}
type AbaId = 'dashboard'|'presenca'|'operadores'|'slots'|'tarefas'|'desempenho'|'meis'|'clt'|'inventario'|'telegram'|'config'|'gojet_config'|'alertas';

interface Funcionario {
  id?: string; nome: string; cpf: string; cargo: string; turno: string;
  funcao: string; zona: string; status: string; gerente: string; lider: string;
  telefone: string; dataAdmissao: string; escala: string; diaFolga: string;
}
interface MEI {
  id?: string; nome: string; cpf: string; cnpj: string; status: string;
  cidade?: string; suspensoInicio?: string; suspensoAte?: string; motivoSuspensao?: string;
  criadoEm?: any;
}
interface Slot {
  id: string; turno: string; turnoLabel: string; horaIni: string; horaFim: string;
  zona: string; qtdPessoas: number; tipo: string; status: string; dataSlot: string;
  criadoEm?: any; cidade?: string; confirmacaoMin?: number; reaberturaSemConfMin?: number;
}
interface SlotAceite { id: string; slotId: string; nome: string; cnpj: string; status: string; aceitoEm?: any; }
interface TarefaLogistica {
  id: string; tipo: string; status: string; titulo?: string; descricao?: string;
  lat?: number; lng?: number; endereco?: string; responsavelId?: string;
  responsavelNome?: string; prioridade?: number; cidade?: string; criadoEm?: any; atualizadoEm?: any;
}
interface GpsWorker {
  uid: string; nome?: string; lat: number; lng: number; atualizadoEm?: any; cidade?: string;
}
interface TurnoLog {
  id?: string; uid: string; nome: string; acao: 'inicio'|'fim'; fotoUrl?: string; criadoEm?: any;
}
interface Eficiencia {
  id?: string; uid: string; nome: string; data: string; cidade: string;
  movimentacoes: number; baterias: number; obs?: string; criadoEm?: any;
}
interface Inventario {
  id?: string; tipo: 'armario'|'patinete'|'carro'|'suporte';
  nome: string; identificador?: string; zona?: string; status: string; observacao?: string;
}
interface ConfigGlobal {
  slaMinutos: number; raioSugestaoKm: number; alertaZeroGoJet: boolean;
  thresholdBatBaixa: number; confirmacaoMin: number; reaberturaSemConfMin: number;
  prazoHoras: Record<string, number>; // TarefaKind → horas (0 = sem prazo auto)
}
interface TelegramGrupo {
  chatId: string; nome: string; cidade: string;
  topicos: Record<string,number>; // cargo → threadId
  tipos: string[]; // quais cargos recebem
}
interface ClimaPrev { temp: number; descricao: string; emoji: string; chuva: boolean; }

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg:'rgba(13,18,30,1)', sur:'rgba(13,18,30,.97)', card:'rgba(22,28,40,.95)',
  bdr:'rgba(255,255,255,.08)', bdr2:'rgba(255,255,255,.04)',
  blueg:'linear-gradient(135deg,#1a6fd4,#307FE2)',
  blue:'#1a6fd4', bluel:'#307FE2',
  green:'#10b981', red:'#ef4444', yellow:'#f59e0b', yellowl:'#fbbf24',
  purple:'#7c3aed', orange:'#f97316',
  txt:'#e2e8f0', dim:'#64748b', dim2:'#94a3b8', blur:'blur(12px)',
};

const S = {
  panel:{ position:'fixed' as const, inset:0, zIndex:4500, background:T.bg, backdropFilter:T.blur, display:'flex', flexDirection:'column' as const, fontFamily:"'Inter',-apple-system,sans-serif" },
  header:{ background:T.sur, backdropFilter:T.blur, borderBottom:`1px solid ${T.bdr}`, padding:'10px 18px', display:'flex', alignItems:'center', gap:12, flexShrink:0, flexWrap:'wrap' as const },
  logo:{ width:36, height:36, borderRadius:10, background:T.blueg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 },
  tabs:{ background:T.sur, borderBottom:`1px solid ${T.bdr}`, display:'flex', overflowX:'auto' as const, flexShrink:0, scrollbarWidth:'none' as const },
  tab:(a:boolean):React.CSSProperties=>({ padding:'10px 15px', fontSize:12, fontWeight:600, color:a?T.bluel:T.dim, cursor:'pointer', background:'none', border:'none', borderBottom:`2px solid ${a?T.bluel:'transparent'}`, whiteSpace:'nowrap', flexShrink:0, transition:'all .15s' }),
  body:{ flex:1, overflowY:'auto' as const, padding:'16px 20px', scrollbarWidth:'thin' as const },
  card:(ac?:string):React.CSSProperties=>({ background:T.card, border:`1px solid ${ac?ac+'33':T.bdr}`, borderTop:`2px solid ${ac||T.bdr}`, borderRadius:12, padding:'14px 16px' }),
  kpiRow:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' as const },
  kpi:(c:string):React.CSSProperties=>({ flex:1, minWidth:80, background:T.card, border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, borderRadius:12, padding:'12px 14px' }),
  kpiN:(c:string):React.CSSProperties=>({ fontSize:26, fontWeight:800, color:c, lineHeight:1 }),
  kpiL:{ fontSize:10, color:T.dim, marginTop:3, textTransform:'uppercase' as const, letterSpacing:'0.4px' },
  inp:{ width:'100%', padding:'8px 10px', borderRadius:8, boxSizing:'border-box' as const, background:'rgba(255,255,255,.04)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:13, outline:'none', marginBottom:8 },
  inpSm:{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,.06)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:12, outline:'none' },
  lbl:{ display:'block' as const, fontSize:10, fontWeight:600, color:'rgba(255,255,255,.35)', marginBottom:4, textTransform:'uppercase' as const, letterSpacing:'0.6px' },
  btn:(c?:string,ghost=false):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:ghost?`1px solid ${T.bdr}`:'none', background:ghost?'transparent':(c||T.blueg), color:ghost?T.dim2:'#fff', fontWeight:600, fontSize:12, cursor:'pointer', transition:'all .15s' }),
  btnG:(g:string):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:'none', background:g, color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer' }),
  chip:(c:string):React.CSSProperties=>({ display:'inline-block', padding:'2px 8px', borderRadius:20, background:c+'18', color:c, fontSize:10, fontWeight:700, border:`1px solid ${c}33` }),
  sec:{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase' as const, letterSpacing:'1px', marginBottom:10 } as React.CSSProperties,
  table:{ width:'100%', borderCollapse:'collapse' as const },
  th:{ padding:'9px 12px', fontSize:10, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase' as const, color:T.dim, borderBottom:`1px solid ${T.bdr}`, textAlign:'left' as const, whiteSpace:'nowrap' as const },
  td:{ padding:'9px 12px', fontSize:12, borderBottom:`1px solid ${T.bdr2}` },
  modal:{ position:'fixed' as const, inset:0, zIndex:5000, background:'rgba(0,0,0,.75)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  mCard:{ background:'#0d1521', border:`1px solid ${T.bdr}`, borderRadius:14, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' as const },
  mHdr:{ padding:'14px 18px', borderBottom:`1px solid ${T.bdr}`, display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky' as const, top:0, background:'#0d1521', zIndex:1 },
  g2:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

const fnsCli = getFunctions(undefined as any, 'southamerica-east1');
const hoje   = () => new Date().toLocaleDateString('pt-BR');
const amanha  = () => new Date(Date.now()+86400000).toLocaleDateString('pt-BR');

function fmtTs(ts:any,short=false):string {
  if(!ts) return '—';
  const d=ts?.toDate?.()??new Date(ts);
  if(isNaN(d.getTime())) return '—';
  return short?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function mAtras(ts:any):number { if(!ts)return 9999; const d=ts?.toDate?.()??new Date(ts); return Math.floor((Date.now()-d.getTime())/60000); }
function distKm(la1:number,ln1:number,la2:number,ln2:number){const R=6371,dL=(la2-la1)*Math.PI/180,dN=(ln2-ln1)*Math.PI/180;const a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function diasRest(s:string):number { if(!s)return 0; return Math.max(0,Math.ceil((new Date(s+'T23:59:59').getTime()-Date.now())/86400000)); }
function isSusp(m:MEI):boolean { return !!m.suspensoAte&&new Date(m.suspensoAte+'T23:59:59')>=new Date(); }
function toast(msg:string,tipo:'ok'|'erro'='ok'){
  const el=document.createElement('div');
  el.textContent=(tipo==='ok'?'✅ ':'❌ ')+msg;
  Object.assign(el.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'9999',background:tipo==='ok'?'linear-gradient(135deg,#10b981,#059669)':'linear-gradient(135deg,#ef4444,#dc2626)',color:'#fff',padding:'10px 18px',borderRadius:'10px',fontWeight:'700',fontSize:'13px',boxShadow:'0 4px 20px rgba(0,0,0,.5)',transition:'opacity .4s',fontFamily:"'Inter',sans-serif"});
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),400);},3000);
}
async function loadXLSX():Promise<any>{const w=window as any;if(w.XLSX)return w.XLSX;await new Promise<void>((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=()=>res();s.onerror=()=>rej();document.head.appendChild(s);});return w.XLSX;}
async function loadJsPDF():Promise<any>{const w=window as any;if(w.jspdf?.jsPDF)return w.jspdf.jsPDF;await new Promise<void>((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=()=>res();s.onerror=()=>rej();document.head.appendChild(s);});return w.jspdf.jsPDF;}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TURNOS=['T1','T2','T0'];
const STATUS_FUNC=['ATIVO','ATESTADO','AFASTAMENTO','DEMITIDO','SE DEMITIU','SUMIU'];
const FUNCOES=['Charger','Scout','Scalt','Motorista','Promotor','Fiscal'];
const DIAS_SEM=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const ROLES_ADMIN=['admin','supergestor'];

const ABAS_ALL:{id:AbaId;label:string;soAdmin?:boolean}[]=[
  {id:'dashboard', label:'📊 Dashboard' },{id:'presenca',   label:'🕐 Presença'  },
  {id:'operadores',label:'👷 Operadores'},{id:'slots',      label:'🎰 Slots'      },
  {id:'tarefas',   label:'📋 Tarefas'   },{id:'desempenho', label:'🏆 Desempenho'},
  {id:'meis',      label:'📝 MEIs'      },{id:'clt',        label:'👥 CLT'        },
  {id:'inventario',  label:'📦 Inventário' },{id:'telegram',     label:'📱 Telegram',   soAdmin:true},
  {id:'alertas',     label:'🔔 Alertas',   soAdmin:true},
  {id:'config',      label:'⚙️ Config',    soAdmin:true},
  {id:'gojet_config',label:'🛴 GoJet',     soAdmin:true},
];

// ─── Hook: cidades disponíveis para o usuário ──────────────────────────────────

function useCidadesDisponiveis(usuario: Usuario): string[] {
  const [cidades, setCidades] = useState<string[]>([]);
  useEffect(() => {
    // Admin/supergestor: lista todas as cidades das estações
    if (ROLES_ADMIN.includes(usuario.role) || usuario.role === 'gestor') {
      getDocs(collection(db, 'estacoes')).then(snap => {
        const set = new Set<string>();
        snap.docs.forEach(d => { const c = d.data().cidade; if (c) set.add(c); });
        setCidades(Array.from(set).sort());
      }).catch(() => {});
    } else if (usuario.cidadesGerenciaLog?.length) {
      setCidades(usuario.cidadesGerenciaLog);
    }
  }, [usuario.uid]);
  return cidades;
}

// ─── Seletor de cidade (topo do painel) ───────────────────────────────────────

function CidadeSelector({
  usuario, cidadeAtiva, onChange, cidadesDisponiveis,
}: {
  usuario: Usuario; cidadeAtiva: string; onChange: (c: string) => void; cidadesDisponiveis: string[];
}) {
  const isAdmin = ROLES_ADMIN.includes(usuario.role) || usuario.role === 'gestor';

  if (!isAdmin) {
    // Gestor de cidade específica — sem dropdown, só exibe
    return (
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 12px',background:'rgba(26,111,212,.15)',borderRadius:8,border:'1px solid rgba(26,111,212,.3)'}}>
        <span style={{fontSize:11,color:T.dim}}>Cidade:</span>
        <span style={{fontWeight:700,fontSize:13,color:T.bluel}}>{cidadeAtiva||'—'}</span>
      </div>
    );
  }

  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <span style={{fontSize:11,color:T.dim,flexShrink:0}}>📍 Cidade:</span>
      <select
        value={cidadeAtiva}
        onChange={e => onChange(e.target.value)}
        style={{...S.inpSm, width:'auto', minWidth:140, marginBottom:0}}
      >
        {isAdmin && <option value="">Todas as cidades</option>}
        {cidadesDisponiveis.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {cidadeAtiva && (
        <button onClick={() => onChange('')} style={{...S.btn(undefined,true),padding:'4px 8px',fontSize:10}}>✕</button>
      )}
    </div>
  );
}

// ─── RAIZ ─────────────────────────────────────────────────────────────────────

export default function GestorLogisticaPanel({usuario, onFechar, cidade: cidadeInicial}: Props) {
  const [aba, setAba] = useState<AbaId>('dashboard');
  const cidadesDisp   = useCidadesDisponiveis(usuario);
  const isAdmin       = ROLES_ADMIN.includes(usuario.role) || usuario.role === 'gestor'; // gestor_log NOT included

  // Cidade ativa: admin pode mudar via dropdown; gestor fica travado na sua cidade
  const cidadeDefault = isAdmin
    ? (cidadeInicial || '')
    : (usuario.cidadesGerenciaLog?.[0] || cidadeInicial || '');

  const [cidadeAtiva, setCidadeAtiva] = useState(cidadeDefault);

  // Se gestor tem uma cidade só, trava ali
  useEffect(() => {
    if (!isAdmin && usuario.cidadesGerenciaLog?.length === 1) {
      setCidadeAtiva(usuario.cidadesGerenciaLog[0]);
    }
  }, [usuario.cidadesGerenciaLog]);

  const ctx = { usuario, cidade: cidadeAtiva, isAdmin };

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={S.logo}>🚚</div>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:T.txt}}>Gestor Logística</div>
            <div style={{fontSize:11,color:T.dim}}>{usuario.role}</div>
          </div>
        </div>

        {/* Seletor de cidade */}
        <CidadeSelector
          usuario={usuario}
          cidadeAtiva={cidadeAtiva}
          onChange={setCidadeAtiva}
          cidadesDisponiveis={cidadesDisp}
        />

        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:11,color:T.dim}}>{usuario.nome}</span>
          <button onClick={onFechar} style={{...S.btn(undefined,true),padding:'6px 12px'}}>✕ Fechar</button>
        </div>
      </div>

      {/* Abas */}
      <div style={S.tabs}>
        {ABAS_ALL.filter(a => !a.soAdmin || isAdmin).map(a=><button key={a.id} onClick={()=>setAba(a.id)} style={S.tab(aba===a.id)}>{a.label}</button>)}
      </div>

      {/* Aviso sem cidade (admin sem cidade selecionada) */}
      {isAdmin && !cidadeAtiva && (
        <div style={{padding:'10px 20px',background:'rgba(245,158,11,.08)',borderBottom:`1px solid ${T.yellow}33`,fontSize:12,color:T.yellowl}}>
          ⚠️ Exibindo dados de <b>todas as cidades</b>. Selecione uma cidade para filtrar.
        </div>
      )}

      {/* Conteúdo */}
      <div style={S.body}>
        {aba==='dashboard'  &&<AbaDashboard  {...ctx}/>}
        {aba==='presenca'   &&<AbaPresenca   {...ctx}/>}
        {aba==='operadores' &&<AbaOperadores {...ctx}/>}
        {aba==='slots'      &&<AbaSlots      {...ctx}/>}
        {aba==='tarefas'    &&<AbaTarefas    {...ctx}/>}
        {aba==='desempenho' &&<AbaDesempenho {...ctx}/>}
        {aba==='meis'       &&<AbaMEIs       {...ctx}/>}
        {aba==='clt'        &&<AbaCLT        {...ctx}/>}
        {aba==='inventario' &&<AbaInventario {...ctx}/>}
        {aba==='alertas'      &&<AbaAlertas      {...ctx}/>}
        {aba==='telegram'     &&<AbaTelegram     {...ctx}/>}
        {aba==='config'       &&<AbaConfig       {...ctx}/>}
        {aba==='gojet_config' &&<AbaGoJetConfig  {...ctx}/>}
      </div>
    </div>
  );
}

// ─── Props compartilhadas ─────────────────────────────────────────────────────

interface AbaProps { usuario: Usuario; cidade: string; isAdmin: boolean; }

// ─── Helper query com filtro cidade ───────────────────────────────────────────
// Evita duplicar o ternário cidade em todo lugar

function qCidade(col: string, cidade: string, ...clauses: any[]) {
  const base = collection(db, col);
  const filters = cidade ? [where('cidade','==',cidade), ...clauses] : clauses;
  return filters.length ? query(base, ...filters) : query(base);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function AbaDashboard({usuario,cidade,isAdmin}:AbaProps){
  const [tarefas,setTarefas]=useState<TarefaLogistica[]>([]);
  const [workers,setWorkers]=useState<GpsWorker[]>([]);
  const [slots,  setSlots  ]=useState<Slot[]>([]);
  const [aceites,setAceites]=useState<SlotAceite[]>([]);
  const [clima,  setClima  ]=useState<ClimaPrev|null>(null);

  useEffect(()=>{
    const since30=Timestamp.fromMillis(Date.now()-30*60000);
    const u1=onSnapshot(qCidade('tarefas_logistica',cidade,where('status','in',['pendente','em_andamento']),limit(200)),s=>setTarefas(s.docs.map(d=>({id:d.id,...d.data()} as TarefaLogistica))));
    const u2=onSnapshot(qCidade('gps_logistica',cidade,where('criadoEm','>=',since30)),s=>setWorkers(s.docs.map(d=>({uid:d.id,...d.data()} as GpsWorker))));
    const u3=onSnapshot(qCidade('slots',cidade,orderBy('criadoEm','desc'),limit(100)),s=>setSlots(s.docs.map(d=>({id:d.id,...d.data()} as Slot)).filter(sl=>sl.dataSlot===hoje())));
    const u4=onSnapshot(collection(db,'slot_aceites'),s=>setAceites(s.docs.map(d=>({id:d.id,...d.data()} as SlotAceite))));
    // Clima
    navigator.geolocation?.getCurrentPosition(pos=>{
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current_weather=true&hourly=precipitation_probability&forecast_days=1`)
        .then(r=>r.json()).then(data=>{const w=data.current_weather;const chuva=(data.hourly?.precipitation_probability?.[new Date().getHours()]||0)>50;const em:Record<number,string>={0:'☀️',1:'🌤',2:'⛅',3:'☁️',61:'🌧',80:'🌦',95:'⛈'};setClima({temp:Math.round(w.temperature),descricao:chuva?'Chuva prevista':'Tempo bom',emoji:em[w.weathercode]||'🌡',chuva});}).catch(()=>{});
    });
    return()=>{u1();u2();u3();u4();};
  },[cidade]);

  const online  =workers.filter(w=>mAtras(w.atualizadoEm)<30).length;
  const pend    =tarefas.filter(t=>t.status==='pendente').length;
  const andamento=tarefas.filter(t=>t.status==='em_andamento').length;
  const semResp =tarefas.filter(t=>!t.responsavelId).length;
  const vagH    =slots.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acH     =aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status!=='Desistiu');
  const iniH    =acH.filter(a=>a.status==='Iniciou').length;
  const fltH    =acH.filter(a=>a.status==='Faltou').length;
  const abertas =Math.max(0,vagH-acH.length);

  return(
    <div>
      {clima&&<div style={{...S.card(clima.chuva?T.yellow:T.green),marginBottom:14,display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:28}}>{clima.emoji}</span><div><div style={{fontWeight:700,fontSize:14,color:T.txt}}>{clima.temp}°C — {clima.descricao}</div><div style={{fontSize:11,color:T.dim}}>{clima.chuva?'⚠️ Alertar chargers sobre chuva':'Condições favoráveis'}</div></div></div>}
      <div style={S.kpiRow}>
        {[
          {n:online,   l:'Online 30min',c:online>0?T.green:T.dim        },
          {n:pend,     l:'Pendentes',   c:pend>0?T.yellow:T.green        },
          {n:andamento,l:'Em andamento',c:T.bluel                         },
          {n:semResp,  l:'Sem resp.',   c:semResp>0?T.red:T.green        },
          {n:`${acH.length}/${vagH}`,l:'Vagas hoje',c:T.purple           },
          {n:iniH,     l:'Iniciou',     c:T.green                         },
          {n:fltH,     l:'Faltou',      c:fltH>0?T.red:T.green           },
          {n:abertas,  l:'Abertas',     c:abertas>0?T.yellow:T.green     },
        ].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={S.card(T.green)}>
          <div style={S.sec}>👷 Online agora</div>
          {workers.length===0&&<div style={{color:T.dim,fontSize:12}}>Nenhum operador online</div>}
          {workers.slice(0,8).map(w=>{const min=mAtras(w.atualizadoEm);const c=min<5?T.green:min<15?T.yellowl:T.orange;return(
            <div key={w.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:c,flexShrink:0}}/>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:T.txt}}>{w.nome||w.uid.slice(-6)}</div><div style={{fontSize:10,color:T.dim}}>{min<1?'agora':`há ${min}min`}</div></div>
              {w.lat&&w.lng&&<a href={`https://maps.google.com/?q=${w.lat},${w.lng}`} target="_blank" rel="noreferrer" style={{fontSize:14,textDecoration:'none'}}>🗺</a>}
            </div>
          );})}
        </div>
        <div style={S.card(T.yellow)}>
          <div style={S.sec}>🚨 Sem responsável ({semResp})</div>
          {tarefas.filter(t=>!t.responsavelId).slice(0,6).map(t=>(
            <div key={t.id} style={{padding:'7px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{fontSize:12,fontWeight:600,color:T.yellowl}}>{t.tipo}</div>
              <div style={{fontSize:11,color:T.dim}}>{t.endereco||t.titulo||t.id.slice(-6)}</div>
            </div>
          ))}
          {semResp===0&&<div style={{fontSize:12,color:T.green}}>✅ Todas têm responsável</div>}
        </div>
      </div>
      <div style={{...S.card(T.purple),marginTop:14}}>
        <div style={S.sec}>🎰 Slots hoje{cidade&&` — ${cidade}`} — {hoje()}</div>
        {slots.length===0?<div style={{color:T.dim,fontSize:12}}>Nenhum slot</div>:(
          <div style={{overflowX:'auto'}}>
            <table style={S.table}>
              <thead><tr>{['Turno','Horário','Zona','Tipo','Vagas','Aceites','Iniciou','Faltou','Abertas'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{slots.map(sl=>{const slAc=aceites.filter(a=>a.slotId===sl.id&&a.status!=='Desistiu');const slI=slAc.filter(a=>a.status==='Iniciou').length;const slF=slAc.filter(a=>a.status==='Faltou').length;const slAb=Math.max(0,sl.qtdPessoas-slAc.length);return(
                <tr key={sl.id}>
                  <td style={S.td}><b>{sl.turno}</b></td><td style={S.td}>{sl.horaIni}–{sl.horaFim}</td><td style={S.td}>{sl.zona}</td>
                  <td style={S.td}><span style={S.chip(sl.tipo==='Charger'?T.yellow:T.green)}>{sl.tipo||'—'}</span></td>
                  <td style={{...S.td,textAlign:'center'}}>{sl.qtdPessoas}</td><td style={{...S.td,textAlign:'center'}}>{slAc.length}</td>
                  <td style={{...S.td,textAlign:'center',color:T.green}}>{slI}</td><td style={{...S.td,textAlign:'center',color:slF>0?T.red:T.dim}}>{slF}</td>
                  <td style={S.td}><span style={S.chip(slAb>0?T.yellow:T.green)}>{slAb>0?`${slAb} ab`:'OK'}</span></td>
                </tr>);})}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA PRESENÇA
// ═══════════════════════════════════════════════════════════════════════════════

function AbaPresenca({cidade}:AbaProps){
  const [turnos, setTurnos]=useState<TurnoLog[]>([]);
  const [clt,    setClt   ]=useState<any[]>([]);
  const [slots,  setSlots ]=useState<Slot[]>([]);
  const [aceites,setAceites]=useState<SlotAceite[]>([]);
  const [filtro, setFiltro]=useState<'todos'|'vieram'|'faltaram'|'folga'>('todos');

  useEffect(()=>{
    const ini=new Date(); ini.setHours(0,0,0,0);
    const u1=onSnapshot(query(collection(db,'turnos_logistica'),where('criadoEm','>=',Timestamp.fromDate(ini)),orderBy('criadoEm','desc'),limit(300)),s=>setTurnos(s.docs.map(d=>({id:d.id,...d.data()} as TurnoLog))));
    getDocs(collection(db,'usuarios')).then(s=>setClt(s.docs.map(d=>({id:d.id,...d.data()})).filter((f:any)=>['campo','logistica','charger','scalt','promotor'].includes(f.role||''))));
    const u3=onSnapshot(qCidade('slots',cidade,orderBy('criadoEm','desc'),limit(100)),s=>setSlots(s.docs.map(d=>({id:d.id,...d.data()} as Slot)).filter(sl=>sl.dataSlot===hoje())));
    const u4=onSnapshot(collection(db,'slot_aceites'),s=>setAceites(s.docs.map(d=>({id:d.id,...d.data()} as SlotAceite))));
    return()=>{u1();u3();u4();};
  },[cidade]);

  const cltFilt = cidade ? clt.filter((f:any)=>!f.cidade||f.cidade===cidade) : clt;
  const diaSem=new Date().getDay();
  const horAtual=new Date().getHours()*60+new Date().getMinutes();
  const tIni:Record<string,number>={T1:7*60,T2:15*60,T0:23*60};

  interface CLTItem{f:any;status:'veio'|'faltou'|'folga'|'aguardando';tlog?:TurnoLog;}
  const cltItems:CLTItem[]=cltFilt.map(f=>{
    const dF=DIAS_SEM.indexOf(f.diaFolga||'');
    if(dF===diaSem)return{f,status:'folga'};
    const tlog=turnos.find(t=>t.uid===f.id||t.uid===f.uid);
    if(tlog)return{f,status:'veio',tlog};
    const ini=tIni[f.turno]||0;
    const jaDevia=f.turno==='T0'?(horAtual>=23*60||horAtual<=7*60+30):(horAtual>=ini+30);
    return{f,status:jaDevia?'faltou':'aguardando'};
  });

  const filtrados=cltItems.filter(i=>filtro==='todos'||(filtro==='vieram'&&i.status==='veio')||(filtro==='faltaram'&&i.status==='faltou')||(filtro==='folga'&&i.status==='folga'));
  const meiPres=aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)).map(a=>({...a,turno:slots.find(s=>s.id===a.slotId)?.turno||''}));
  const nVieram=cltItems.filter(i=>i.status==='veio').length;
  const nFaltou=cltItems.filter(i=>i.status==='faltou').length;
  const nFolga =cltItems.filter(i=>i.status==='folga').length;
  const corSt=(s:string)=>s==='veio'?T.green:s==='faltou'?T.red:s==='folga'?T.dim:T.yellow;
  const lbSt =(s:string)=>s==='veio'?'✅ Veio':s==='faltou'?'❌ Faltou':s==='folga'?'😴 Folga':'⏳ Aguardando';

  return(
    <div>
      <div style={S.kpiRow}>
        {[{n:nVieram,l:'CLT vieram',c:T.green},{n:nFaltou,l:'CLT faltaram',c:nFaltou>0?T.red:T.green},{n:nFolga,l:'CLT folga',c:T.dim},{n:meiPres.filter(m=>m.status==='Iniciou').length,l:'MEI iniciou',c:T.purple},{n:meiPres.filter(m=>m.status==='Faltou').length,l:'MEI faltou',c:T.red},{n:turnos.filter(t=>t.acao==='inicio').length,l:'Pontos hoje',c:T.bluel}].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {(['todos','vieram','faltaram','folga'] as const).map(f=><button key={f} onClick={()=>setFiltro(f)} style={{...S.btn(T.bluel,filtro!==f),padding:'6px 12px',fontSize:11}}>{f==='todos'?'Todos':f==='vieram'?'✅ Vieram':f==='faltaram'?'❌ Faltaram':'😴 Folga'}</button>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={S.card()}>
          <div style={S.sec}>👷 CLT — {filtrados.length}</div>
          <div style={{overflowX:'auto'}}>
            <table style={S.table}>
              <thead><tr>{['Nome','Turno','Função','Status','Ponto'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {filtrados.length===0&&<tr><td colSpan={5} style={{...S.td,textAlign:'center',padding:30,color:T.dim}}>Nenhum resultado</td></tr>}
                {filtrados.map(({f,status,tlog})=>(
                  <tr key={f.id||f.cpf}><td style={{...S.td,fontWeight:600}}>{f.nome}</td><td style={S.td}>{f.turno}</td><td style={S.td}>{f.funcao}</td><td style={S.td}><span style={S.chip(corSt(status))}>{lbSt(status)}</span></td><td style={{...S.td,fontSize:11,color:T.dim}}>{tlog?fmtTs(tlog.criadoEm,true):'—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={S.card(T.purple)}>
          <div style={S.sec}>📝 MEI — Slots hoje</div>
          <table style={S.table}>
            <thead><tr>{['Nome','Turno','Status'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {meiPres.length===0&&<tr><td colSpan={3} style={{...S.td,textAlign:'center',padding:30,color:T.dim}}>Nenhum aceite</td></tr>}
              {meiPres.map((m,i)=>{const c=m.status==='Iniciou'?T.green:m.status==='Faltou'?T.red:m.status==='Atrasado'?T.orange:T.yellow;return<tr key={i}><td style={{...S.td,fontWeight:600}}>{m.nome}</td><td style={S.td}>{m.turno}</td><td style={S.td}><span style={S.chip(c)}>{m.status}</span></td></tr>;})}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{...S.card(),marginTop:14}}>
        <div style={S.sec}>🕐 Registros de ponto — hoje ({turnos.length})</div>
        <div style={{overflowX:'auto',maxHeight:260,overflowY:'auto'}}>
          <table style={S.table}>
            <thead><tr>{['Hora','Nome','Ação','Foto'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {turnos.length===0&&<tr><td colSpan={4} style={{...S.td,textAlign:'center',padding:30,color:T.dim}}>Nenhum ponto hoje</td></tr>}
              {turnos.map(t=><tr key={t.id}><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{fmtTs(t.criadoEm,true)}</td><td style={{...S.td,fontWeight:600}}>{t.nome}</td><td style={S.td}><span style={S.chip(t.acao==='inicio'?T.green:T.orange)}>{t.acao==='inicio'?'▶ Início':'⏹ Fim'}</span></td><td style={S.td}>{t.fotoUrl?<a href={t.fotoUrl} target="_blank" rel="noreferrer" style={{color:T.bluel,fontSize:11}}>📷 Ver</a>:<span style={{color:T.dim,fontSize:11}}>—</span>}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA OPERADORES
// ═══════════════════════════════════════════════════════════════════════════════

function AbaOperadores({usuario,cidade}:AbaProps){
  const [workers,setWorkers]=useState<GpsWorker[]>([]);
  const [tarefas,setTarefas]=useState<TarefaLogistica[]>([]);
  const [sel,    setSel    ]=useState<GpsWorker|null>(null);
  const [hist,   setHist   ]=useState<any[]>([]);
  const [busca,  setBusca  ]=useState('');

  useEffect(()=>{
    const since=Timestamp.fromMillis(Date.now()-60*60000);
    const u1=onSnapshot(qCidade('gps_logistica',cidade,where('criadoEm','>=',since)),s=>setWorkers(s.docs.map(d=>({uid:d.id,...d.data()} as GpsWorker))));
    const u2=onSnapshot(qCidade('tarefas_logistica',cidade,where('status','in',['pendente','em_andamento']),limit(200)),s=>setTarefas(s.docs.map(d=>({id:d.id,...d.data()} as TarefaLogistica))));
    return()=>{u1();u2();};
  },[cidade]);

  useEffect(()=>{
    if(!sel){setHist([]);return;}
    const since=Timestamp.fromMillis(Date.now()-8*60*60000);
    getDocs(query(collection(db,'gps_logistica_hist'),where('uid','==',sel.uid),where('criadoEm','>=',since),orderBy('criadoEm','asc'),limit(200))).then(s=>setHist(s.docs.map(d=>d.data()))).catch(()=>{});
  },[sel]);

  const filtrados=useMemo(()=>workers.filter(w=>!busca||(w.nome||'').toLowerCase().includes(busca.toLowerCase())).sort((a,b)=>mAtras(a.atualizadoEm)-mAtras(b.atualizadoEm)),[workers,busca]);
  const semResp=tarefas.filter(t=>!t.responsavelId);
  function melhor(t:TarefaLogistica):GpsWorker|null{if(!t.lat||!t.lng)return null;const d=workers.filter(w=>mAtras(w.atualizadoEm)<30);if(!d.length)return null;return d.reduce((b,w)=>distKm(t.lat!,t.lng!,b.lat,b.lng)>distKm(t.lat!,t.lng!,w.lat,w.lng)?w:b);}

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Buscar operador..." style={{...S.inp,marginBottom:0,flex:1}}/>
        <span style={{fontSize:12,color:T.dim,alignSelf:'center'}}>{filtrados.length} operadores{cidade&&` · ${cidade}`}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div>
          {filtrados.map(w=>{const min=mAtras(w.atualizadoEm);const c=min<5?T.green:min<15?T.yellowl:min<30?T.orange:T.dim;const isSel=sel?.uid===w.uid;return(
            <div key={w.uid} onClick={()=>setSel(isSel?null:w)} style={{...S.card(),marginBottom:8,cursor:'pointer',borderColor:isSel?T.bluel:T.bdr,background:isSel?'rgba(26,111,212,.08)':T.card}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:c,flexShrink:0}}/>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:T.txt}}>{w.nome||w.uid.slice(-8)}</div><div style={{fontSize:10,color:T.dim}}>GPS: {min<1?'agora':`há ${min}min`}</div></div>
                {w.lat&&w.lng&&<a href={`https://maps.google.com/?q=${w.lat},${w.lng}`} target="_blank" rel="noreferrer" style={{fontSize:16,textDecoration:'none'}} onClick={e=>e.stopPropagation()}>🗺</a>}
              </div>
            </div>
          );})}
          {filtrados.length===0&&<div style={{color:T.dim,fontSize:12}}>Nenhum operador online</div>}
        </div>
        <div>
          {sel?(
            <>
              <div style={S.card(T.bluel)}>
                <div style={S.sec}>📍 {sel.nome||sel.uid.slice(-8)}</div>
                <div style={{fontSize:12,color:T.dim,marginBottom:10}}>GPS: {mAtras(sel.atualizadoEm)<1?'agora':`há ${mAtras(sel.atualizadoEm)}min`}<br/>{sel.lat?.toFixed(5)}, {sel.lng?.toFixed(5)}</div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  {sel.lat&&sel.lng&&<><a href={`https://www.google.com/maps/dir/?api=1&destination=${sel.lat},${sel.lng}`} target="_blank" rel="noreferrer" style={{...S.btnG(T.blueg),textDecoration:'none',fontSize:12}}>🗺 Maps</a><a href={`waze://?ll=${sel.lat},${sel.lng}&navigate=yes`} style={{...S.btnG('linear-gradient(135deg,#00b5d8,#0097b2)'),textDecoration:'none',fontSize:12}}>🚗 Waze</a></>}
                </div>
                {hist.length>0&&(<>
                  <div style={{...S.sec,marginTop:6}}>🔍 GPS histórico — {hist.length} pts</div>
                  <div style={{maxHeight:120,overflowY:'auto',fontSize:10,color:T.dim,fontFamily:'monospace'}}>
                    {hist.map((g:any,i:number)=><div key={i} style={{padding:'2px 0',borderBottom:`1px solid ${T.bdr2}`}}>{fmtTs(g.criadoEm,true)} — {g.lat?.toFixed(4)},{g.lng?.toFixed(4)}{i>0&&` (${distKm(hist[i-1].lat,hist[i-1].lng,g.lat,g.lng).toFixed(2)}km)`}</div>)}
                  </div>
                  <div style={{fontSize:10,color:T.orange,marginTop:4}}>⚠️ Distâncias anormais podem indicar spoofing de GPS</div>
                </>)}
              </div>
              <div style={{...S.card(),marginTop:10}}>
                <div style={S.sec}>📋 Atribuir tarefa</div>
                {semResp.slice(0,4).map(t=><div key={t.id} style={{...S.card(),marginBottom:6}}><div style={{fontSize:11,fontWeight:600,color:T.yellowl}}>{t.tipo}</div><div style={{fontSize:11,color:T.dim,marginBottom:6}}>{t.endereco||t.titulo||''}</div><button onClick={async()=>{await updateDoc(doc(db,'tarefas_logistica',t.id),{responsavelId:sel.uid,responsavelNome:sel.nome||sel.uid,status:'em_andamento',atualizadoEm:serverTimestamp()});toast(`Atribuído a ${sel.nome||sel.uid}`);}} style={{...S.btnG(T.blueg),padding:'5px 10px',fontSize:11}}>Atribuir →</button></div>)}
                {semResp.length===0&&<div style={{fontSize:12,color:T.green}}>✅ Sem tarefas sem responsável</div>}
              </div>
            </>
          ):(
            <div style={S.card()}>
              <div style={S.sec}>💡 Sugestão automática</div>
              {semResp.slice(0,4).map(t=>{const m=melhor(t);return(
                <div key={t.id} style={{...S.card(),marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:T.yellowl}}>{t.tipo}</div>
                  <div style={{fontSize:11,color:T.dim}}>{t.endereco||t.titulo||''}</div>
                  {m&&<div style={{fontSize:10,color:T.green,marginTop:4}}>Sugerido: {m.nome||m.uid.slice(-6)} ({distKm(t.lat||0,t.lng||0,m.lat,m.lng).toFixed(1)}km)</div>}
                  {m&&<button style={{...S.btnG(T.blueg),marginTop:6,fontSize:11,padding:'4px 10px'}} onClick={async()=>{await updateDoc(doc(db,'tarefas_logistica',t.id),{responsavelId:m.uid,responsavelNome:m.nome||m.uid,status:'em_andamento',atualizadoEm:serverTimestamp()});toast(`Atribuído a ${m.nome||m.uid}`);}}>Atribuir →</button>}
                </div>
              );})}
              {semResp.length===0&&<div style={{fontSize:12,color:T.green}}>✅ Sem tarefas sem responsável</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA SLOTS
// ═══════════════════════════════════════════════════════════════════════════════

function AbaSlots({usuario,cidade}:AbaProps){
  const [slots,   setSlots  ]=useState<Slot[]>([]);
  const [aceites, setAceites]=useState<SlotAceite[]>([]);
  const [dia,     setDia    ]=useState<'hoje'|'amanha'>('hoje');
  const [modal,   setModal  ]=useState(false);
  const [lote,    setLote   ]=useState(false);
  const [salvando,setSalvando]=useState(false);
  const [clima,   setClima  ]=useState<ClimaPrev|null>(null);
  const [loteForm,setLoteForm]=useState({tipos:['Scout','Charger'],turnos:['T1','T2'],zona:'',qtd:2,dataAlvo:'amanha' as 'hoje'|'amanha',T1ini:'07:00',T1fim:'15:00',T2ini:'15:00',T2fim:'23:00',T0ini:'23:00',T0fim:'07:00',confMin:120,reabrMin:90});
  const [sf,setSf]=useState({turno:'T1',horaIni:'07:00',horaFim:'15:00',zona:'',tipo:'Scout',qtdPessoas:2,dataSlot:'',confMin:120,reabrMin:90});

  useEffect(()=>{
    const u1=onSnapshot(qCidade('slots',cidade,orderBy('criadoEm','desc'),limit(150)),s=>setSlots(s.docs.map(d=>({id:d.id,...d.data()} as Slot))));
    const u2=onSnapshot(collection(db,'slot_aceites'),s=>setAceites(s.docs.map(d=>({id:d.id,...d.data()} as SlotAceite))));
    navigator.geolocation?.getCurrentPosition(pos=>{
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current_weather=true&forecast_days=2&hourly=precipitation_probability`)
        .then(r=>r.json()).then(data=>{const w=data.current_weather;const am=data.hourly?.precipitation_probability?.slice(24,48)||[];const chuva=am.some((p:number)=>p>60);const em:Record<number,string>={0:'☀️',1:'🌤',2:'⛅',3:'☁️',61:'🌧',95:'⛈'};setClima({temp:Math.round(w.temperature),descricao:chuva?'Chuva amanhã':'OK para amanhã',emoji:chuva?'🌧':em[w.weathercode]||'☀️',chuva});}).catch(()=>{});
    });
    return()=>{u1();u2();};
  },[cidade]);

  const diaStr=dia==='hoje'?hoje():amanha();
  const filtrados=slots.filter(s=>s.dataSlot===diaStr);
  const vagT=filtrados.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acD=aceites.filter(a=>filtrados.some(s=>s.id===a.slotId)&&a.status!=='Desistiu');
  const ini=acD.filter(a=>a.status==='Iniciou').length;
  const flt=acD.filter(a=>a.status==='Faltou').length;
  const ab=Math.max(0,vagT-acD.length);

  const porTurno:Record<string,{vagas:number;aceites:number}>={};
  filtrados.forEach(sl=>{if(!porTurno[sl.turno])porTurno[sl.turno]={vagas:0,aceites:0};porTurno[sl.turno].vagas+=sl.qtdPessoas||0;porTurno[sl.turno].aceites+=aceites.filter(a=>a.slotId===sl.id&&a.status!=='Desistiu').length;});

  const cidadeSlot = cidade || 'SP';

  const criarLote=async()=>{
    if(!loteForm.zona||!loteForm.turnos.length||!loteForm.tipos.length){toast('Preencha zona, turnos e tipos','erro');return;}
    setSalvando(true);
    const dataStr=loteForm.dataAlvo==='hoje'?hoje():amanha();
    const hor:Record<string,{ini:string;fim:string}>={T1:{ini:loteForm.T1ini,fim:loteForm.T1fim},T2:{ini:loteForm.T2ini,fim:loteForm.T2fim},T0:{ini:loteForm.T0ini,fim:loteForm.T0fim}};
    let n=0;
    for(const turno of loteForm.turnos){for(const tipo of loteForm.tipos){await addDoc(collection(db,'slots'),{turno,turnoLabel:`${turno} — ${hor[turno].ini} às ${hor[turno].fim}`,horaIni:hor[turno].ini,horaFim:hor[turno].fim,zona:loteForm.zona,tipo,qtdPessoas:loteForm.qtd,status:'Aberto',dataSlot:dataStr,cidade:cidadeSlot,confirmacaoMin:loteForm.confMin,reaberturaSemConfMin:loteForm.reabrMin,criadoEm:serverTimestamp(),criadoPorId:usuario.uid,criadoPorNome:usuario.nome});n++;}}
    toast(`${n} slots criados em ${cidadeSlot}`);setSalvando(false);setLote(false);
  };

  const criarSlot=async()=>{
    if(!sf.zona||!sf.dataSlot){toast('Preencha zona e data','erro');return;}
    setSalvando(true);
    await addDoc(collection(db,'slots'),{...sf,status:'Aberto',cidade:cidadeSlot,turnoLabel:`${sf.turno} — ${sf.horaIni} às ${sf.horaFim}`,confirmacaoMin:sf.confMin,reaberturaSemConfMin:sf.reabrMin,criadoEm:serverTimestamp(),criadoPorId:usuario.uid,criadoPorNome:usuario.nome});
    toast('Slot criado');setSalvando(false);setModal(false);
  };

  const scor=(s:string)=>s==='Iniciou'?T.green:s==='Atrasado'?T.orange:s==='Faltou'?T.red:s==='Veio'?T.green:s==='Desistiu'?T.dim:T.bluel;

  return(
    <div>
      {clima?.chuva&&<div style={{...S.card(T.yellow),marginBottom:12,display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:22}}>🌧</span><div><div style={{fontWeight:700,fontSize:13,color:T.yellowl}}>Chuva prevista amanhã</div><div style={{fontSize:11,color:T.dim}}>Reduza vagas de Scout em regiões de alta declividade</div></div></div>}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        {(['hoje','amanha'] as const).map(d=><button key={d} onClick={()=>setDia(d)} style={{...S.btn(T.bluel,dia!==d),padding:'7px 14px'}}>{d==='hoje'?`Hoje (${hoje()})`:`Amanhã (${amanha()})`}</button>)}
        <span style={{fontSize:11,color:T.dim}}>📍 {cidadeSlot}</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button onClick={()=>{setLote(true);setModal(false);}} style={{...S.btnG('linear-gradient(135deg,#7c3aed,#a855f7)'),fontSize:12}}>⚡ Lote</button>
          <button onClick={()=>{setModal(true);setLote(false);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>+ Slot</button>
        </div>
      </div>
      <div style={S.kpiRow}>
        {[{n:filtrados.length,l:'Slots',c:T.purple},{n:vagT,l:'Vagas',c:T.bluel},{n:acD.length,l:'Aceites',c:'#60a5fa'},{n:ini,l:'Iniciou',c:T.green},{n:flt,l:'Faltou',c:flt>0?T.red:T.dim},{n:ab,l:'Abertas',c:ab>0?T.yellow:T.green}].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>

      {Object.keys(porTurno).length>0&&(
        <div style={{...S.card(),marginBottom:14}}>
          <div style={S.sec}>📊 Preenchimento por turno</div>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {Object.entries(porTurno).map(([t,d])=>{const pct=d.vagas>0?Math.round(d.aceites/d.vagas*100):0;const c=pct>=80?T.green:pct>=50?T.yellowl:T.red;return(
              <div key={t} style={{flex:1,minWidth:100}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><b style={{color:T.txt}}>{t}</b><span style={{color:c}}>{pct}%</span></div>
                <div style={{height:8,background:T.bdr,borderRadius:4,overflow:'hidden'}}><div style={{width:`${pct}%`,height:'100%',background:c,borderRadius:4,transition:'width .5s'}}/></div>
                <div style={{fontSize:10,color:T.dim,marginTop:3}}>{d.aceites}/{d.vagas}</div>
              </div>
            );})}
          </div>
        </div>
      )}

      {filtrados.length===0?<div style={{color:T.dim,fontSize:13,textAlign:'center',padding:40}}>Nenhum slot para {diaStr}</div>:filtrados.map(sl=>{
        const slAc=aceites.filter(a=>a.slotId===sl.id);const slAb=Math.max(0,sl.qtdPessoas-slAc.filter(a=>a.status!=='Desistiu').length);
        return(
          <div key={sl.id} style={{...S.card(),marginBottom:12}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:8}}>
              <div style={{flex:1}}><span style={{...S.chip(T.purple),marginRight:6}}>{sl.turno}</span><span style={{...S.chip(T.bluel),marginRight:6}}>{sl.horaIni}–{sl.horaFim}</span><span style={{...S.chip(sl.tipo==='Charger'?T.yellow:T.green),marginRight:6}}>{sl.tipo||'—'}</span><b style={{color:T.txt}}>{sl.zona}</b></div>
              <span style={S.chip(slAb>0?T.yellow:T.green)}>{slAb>0?`${slAb} vagas`:'Completo'}</span>
              <button onClick={async()=>{if(window.confirm('Excluir?'))await deleteDoc(doc(db,'slots',sl.id));}} style={{...S.btn(T.red,true),padding:'3px 7px',fontSize:11}}>🗑</button>
            </div>
            {slAc.length===0?<div style={{fontSize:11,color:T.dim}}>Sem aceites</div>:(
              <table style={{...S.table,fontSize:11}}>
                <thead><tr>{['Nome','Status','Aceito em','Ação'].map(h=><th key={h} style={{...S.th,fontSize:9}}>{h}</th>)}</tr></thead>
                <tbody>{slAc.map(a=><tr key={a.id}><td style={S.td}>{a.nome}</td><td style={S.td}><span style={S.chip(scor(a.status))}>{a.status}</span></td><td style={{...S.td,fontSize:10,color:T.dim}}>{fmtTs(a.aceitoEm,true)}</td><td style={S.td}><select value={a.status} onChange={async e=>{await updateDoc(doc(db,'slot_aceites',a.id),{status:e.target.value});toast(`→ ${e.target.value}`);}} style={{...S.inp,marginBottom:0,padding:'3px 6px',width:'auto',fontSize:11}}>{['Pendente','Iniciou','Atrasado','Faltou','Veio','Desistiu'].map(s=><option key={s} value={s}>{s}</option>)}</select></td></tr>)}</tbody>
              </table>
            )}
          </div>
        );
      })}

      {lote&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setLote(false);}}>
        <div style={{...S.mCard,maxWidth:600}}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>⚡ Criar slots em lote — {cidadeSlot}</div><button onClick={()=>setLote(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            {clima?.chuva&&<div style={{...S.card(T.yellow),marginBottom:12,fontSize:12,color:T.yellowl}}>🌧 Chuva prevista — reduza vagas de Scout</div>}
            <div style={S.g2}>
              <div><label style={S.lbl}>Data</label><select value={loteForm.dataAlvo} onChange={e=>setLoteForm(f=>({...f,dataAlvo:e.target.value as any}))} style={S.inp}><option value="hoje">Hoje ({hoje()})</option><option value="amanha">Amanhã ({amanha()})</option></select></div>
              <div><label style={S.lbl}>Zona *</label><input value={loteForm.zona} onChange={e=>setLoteForm(f=>({...f,zona:e.target.value}))} style={S.inp} placeholder="Ex: Z1 - Vermelha"/></div>
              <div><label style={S.lbl}>Vagas por slot</label><input type="number" min={1} max={20} value={loteForm.qtd} onChange={e=>setLoteForm(f=>({...f,qtd:parseInt(e.target.value)||1}))} style={S.inp}/></div>
              <div><label style={S.lbl}>Confirmar (min antes)</label><input type="number" min={30} max={480} value={loteForm.confMin} onChange={e=>setLoteForm(f=>({...f,confMin:parseInt(e.target.value)||120}))} style={S.inp}/></div>
            </div>
            <label style={S.lbl}>Turnos</label>
            <div style={{display:'flex',gap:6,marginBottom:10}}>{TURNOS.map(t=>{const s=loteForm.turnos.includes(t);return<button key={t} onClick={()=>setLoteForm(f=>({...f,turnos:s?f.turnos.filter(x=>x!==t):[...f.turnos,t]}))} style={{...S.btn(T.bluel,!s),padding:'6px 14px'}}>{t}</button>;})}</div>
            <label style={S.lbl}>Tipos</label>
            <div style={{display:'flex',gap:6,marginBottom:14}}>{['Scout','Charger','Scalt'].map(t=>{const s=loteForm.tipos.includes(t);const c=t==='Charger'?T.yellow:t==='Scalt'?T.purple:T.green;return<button key={t} onClick={()=>setLoteForm(f=>({...f,tipos:s?f.tipos.filter(x=>x!==t):[...f.tipos,t]}))} style={{...S.btn(c,!s),padding:'6px 14px'}}>{t}</button>;})}</div>
            {loteForm.turnos.includes('T1')&&<div style={{...S.card(),marginBottom:8}}><div style={{...S.sec,marginBottom:6}}>T1 — Manhã</div><div style={S.g2}><div><label style={S.lbl}>Início</label><input type="time" value={loteForm.T1ini} onChange={e=>setLoteForm(f=>({...f,T1ini:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>Fim</label><input type="time" value={loteForm.T1fim} onChange={e=>setLoteForm(f=>({...f,T1fim:e.target.value}))} style={S.inp}/></div></div></div>}
            {loteForm.turnos.includes('T2')&&<div style={{...S.card(),marginBottom:8}}><div style={{...S.sec,marginBottom:6}}>T2 — Tarde</div><div style={S.g2}><div><label style={S.lbl}>Início</label><input type="time" value={loteForm.T2ini} onChange={e=>setLoteForm(f=>({...f,T2ini:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>Fim</label><input type="time" value={loteForm.T2fim} onChange={e=>setLoteForm(f=>({...f,T2fim:e.target.value}))} style={S.inp}/></div></div></div>}
            {loteForm.turnos.includes('T0')&&<div style={{...S.card(),marginBottom:8}}><div style={{...S.sec,marginBottom:6}}>T0 — Noite</div><div style={S.g2}><div><label style={S.lbl}>Início</label><input type="time" value={loteForm.T0ini} onChange={e=>setLoteForm(f=>({...f,T0ini:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>Fim</label><input type="time" value={loteForm.T0fim} onChange={e=>setLoteForm(f=>({...f,T0fim:e.target.value}))} style={S.inp}/></div></div></div>}
            <div style={{...S.card(T.bluel),marginBottom:12,fontSize:12,color:T.dim}}>Serão criados <b style={{color:T.txt}}>{loteForm.turnos.length*loteForm.tipos.length}</b> slots em <b style={{color:T.bluel}}>{cidadeSlot}</b> — {loteForm.zona||'(sem zona)'}</div>
            <button onClick={criarLote} disabled={salvando} style={{...S.btnG('linear-gradient(135deg,#7c3aed,#a855f7)'),width:'100%',padding:'10px'}}>{salvando?'Criando...':'⚡ Criar todos os slots'}</button>
          </div>
        </div>
      </div>}

      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={S.mCard}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>🎰 Criar Slot — {cidadeSlot}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            <div style={S.g2}>
              <div><label style={S.lbl}>Turno</label><select value={sf.turno} onChange={e=>setSf(f=>({...f,turno:e.target.value}))} style={S.inp}>{TURNOS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div><label style={S.lbl}>Tipo</label><select value={sf.tipo} onChange={e=>setSf(f=>({...f,tipo:e.target.value}))} style={S.inp}>{['Scout','Charger','Scalt'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div><label style={S.lbl}>Início</label><input type="time" value={sf.horaIni} onChange={e=>setSf(f=>({...f,horaIni:e.target.value}))} style={S.inp}/></div>
              <div><label style={S.lbl}>Fim</label><input type="time" value={sf.horaFim} onChange={e=>setSf(f=>({...f,horaFim:e.target.value}))} style={S.inp}/></div>
              <div><label style={S.lbl}>Confirmar (min)</label><input type="number" min={30} value={sf.confMin} onChange={e=>setSf(f=>({...f,confMin:parseInt(e.target.value)||120}))} style={S.inp}/></div>
              <div><label style={S.lbl}>Reabrir sem conf.</label><input type="number" min={15} value={sf.reabrMin} onChange={e=>setSf(f=>({...f,reabrMin:parseInt(e.target.value)||90}))} style={S.inp}/></div>
            </div>
            <label style={S.lbl}>Zona *</label><input value={sf.zona} onChange={e=>setSf(f=>({...f,zona:e.target.value}))} style={S.inp}/>
            <label style={S.lbl}>Data *</label><input type="date" onChange={e=>setSf(f=>({...f,dataSlot:new Date(e.target.value+'T12:00:00').toLocaleDateString('pt-BR')}))} style={S.inp}/>
            <label style={S.lbl}>Vagas</label><input type="number" min={1} max={20} value={sf.qtdPessoas} onChange={e=>setSf(f=>({...f,qtdPessoas:parseInt(e.target.value)||1}))} style={S.inp}/>
            <button onClick={criarSlot} disabled={salvando} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),width:'100%',marginTop:4}}>{salvando?'Criando...':'✓ Criar slot'}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA TAREFAS
// ═══════════════════════════════════════════════════════════════════════════════

function AbaTarefas({usuario,cidade}:AbaProps){
  const [tarefas,setTarefas]=useState<TarefaLogistica[]>([]);
  const [workers,setWorkers]=useState<GpsWorker[]>([]);
  const [filtroSt,setFiltroSt]=useState('pendente');
  const [filtroTp,setFiltroTp]=useState('todos');
  const [sel,setSel]=useState<TarefaLogistica|null>(null);

  useEffect(()=>{
    const u1=onSnapshot(qCidade('tarefas_logistica',cidade,orderBy('criadoEm','desc'),limit(400)),s=>setTarefas(s.docs.map(d=>({id:d.id,...d.data()} as TarefaLogistica))));
    const since=Timestamp.fromMillis(Date.now()-30*60000);
    const u2=onSnapshot(qCidade('gps_logistica',cidade,where('criadoEm','>=',since)),s=>setWorkers(s.docs.map(d=>({uid:d.id,...d.data()} as GpsWorker))));
    return()=>{u1();u2();};
  },[cidade]);

  const tipos=['todos',...Array.from(new Set(tarefas.map(t=>t.tipo)))];
  const filtradas=useMemo(()=>tarefas.filter(t=>(filtroSt==='todas'||t.status===filtroSt)&&(filtroTp==='todos'||t.tipo===filtroTp)),[tarefas,filtroSt,filtroTp]);
  const por=(s:string)=>tarefas.filter(t=>t.status===s).length;
  const stCor=(s:string)=>s==='concluida'?T.green:s==='em_andamento'?T.bluel:s==='pendente'?T.yellow:T.dim;
  const tpCor=(t:string)=>t==='CARGA_BATERIA'?T.yellow:t==='PONTO'?T.green:t==='PATINETE'?T.bluel:T.dim;

  const expXLSX=async()=>{const XLSX=await loadXLSX();const data=filtradas.map(t=>({Tipo:t.tipo,Status:t.status,Título:t.titulo||'',Endereço:t.endereco||'',Responsável:t.responsavelNome||'',Cidade:t.cidade||'','Criado em':fmtTs(t.criadoEm)}));const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Tarefas');XLSX.writeFile(wb,`tarefas_${cidade||'all'}_${new Date().toISOString().slice(0,10)}.xlsx`);toast('XLSX exportado');};
  const expPDF=async()=>{const JsPDF=await loadJsPDF();const pdf=new JsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text(`Tarefas — ${cidade||'Todas as cidades'}`,14,15);pdf.setFontSize(9);filtradas.slice(0,100).forEach((t,i)=>pdf.text(`${i+1}. [${t.tipo}] ${t.status} — ${t.endereco||t.titulo||''} — ${t.responsavelNome||'Sem resp.'}`,14,25+i*6));pdf.save(`tarefas_${new Date().toISOString().slice(0,10)}.pdf`);toast('PDF exportado');};

  return(
    <div>
      <div style={S.kpiRow}>
        {[{n:por('pendente'),l:'Pendentes',c:T.yellow,st:'pendente'},{n:por('em_andamento'),l:'Em andamento',c:T.bluel,st:'em_andamento'},{n:por('concluida'),l:'Concluídas',c:T.green,st:'concluida'},{n:por('cancelada'),l:'Canceladas',c:T.dim,st:'cancelada'},{n:tarefas.length,l:'Total',c:T.bluel,st:'todas'}].map(({n,l,c,st})=>(
          <div key={l} style={{...S.kpi(c),cursor:'pointer',borderColor:filtroSt===st?c:T.bdr}} onClick={()=>setFiltroSt(st)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>
        ))}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{tipos.map(t=><button key={t} onClick={()=>setFiltroTp(t)} style={{...S.btn(tpCor(t),filtroTp!==t),padding:'5px 10px',fontSize:11}}>{t==='todos'?'Todos tipos':t}</button>)}</div>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={expXLSX} style={{...S.btn(T.green,true),padding:'6px 10px',fontSize:11}}>📊 XLSX</button>
          <button onClick={expPDF}  style={{...S.btn(T.red,true),  padding:'6px 10px',fontSize:11}}>📄 PDF</button>
        </div>
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={{...S.table,minWidth:900}}>
          <thead><tr>{['Tipo','Status','Título','Endereço','Cidade','Responsável','Criado em','Ações'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtradas.length===0&&<tr><td colSpan={8} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhuma tarefa</td></tr>}
            {filtradas.map(t=>(
              <tr key={t.id}>
                <td style={S.td}><span style={S.chip(tpCor(t.tipo))}>{t.tipo}</span></td>
                <td style={S.td}><span style={S.chip(stCor(t.status))}>{t.status}</span></td>
                <td style={{...S.td,maxWidth:160}}><div style={{fontWeight:600,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:T.txt}}>{t.titulo||t.descricao?.slice(0,40)||'—'}</div></td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{t.endereco||'—'}</td>
                <td style={{...S.td,fontSize:11}}>{t.cidade||'—'}</td>
                <td style={S.td}>{t.responsavelNome||<span style={{color:T.red,fontSize:11}}>Sem resp.</span>}</td>
                <td style={{...S.td,fontSize:11}}>{fmtTs(t.criadoEm,true)}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>setSel(t)} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  {t.status!=='cancelada'&&t.status!=='concluida'&&<button onClick={async()=>{await updateDoc(doc(db,'tarefas_logistica',t.id),{status:'cancelada',atualizadoEm:serverTimestamp()});toast('Cancelada');}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>✕</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setSel(null);}}>
        <div style={S.mCard}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>Reatribuir: {sel.tipo}</div><button onClick={()=>setSel(null)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            <div style={S.sec}>Operadores online — {cidade||'Todos'}</div>
            {workers.length===0&&<div style={{color:T.dim,fontSize:12}}>Nenhum operador online</div>}
            {workers.map(w=>(
              <div key={w.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:`1px solid ${T.bdr2}`}}>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:12}}>{w.nome||w.uid.slice(-8)}</div><div style={{fontSize:10,color:T.dim}}>{mAtras(w.atualizadoEm)}min{sel.lat&&sel.lng&&w.lat&&w.lng&&` · ${distKm(sel.lat,sel.lng,w.lat,w.lng).toFixed(1)}km`}</div></div>
                <button onClick={async()=>{await updateDoc(doc(db,'tarefas_logistica',sel.id),{responsavelId:w.uid,responsavelNome:w.nome||w.uid,status:'em_andamento',atualizadoEm:serverTimestamp()});toast(`Atribuído a ${w.nome||w.uid}`);setSel(null);}} style={{...S.btnG(T.blueg),fontSize:11}}>Atribuir →</button>
              </div>
            ))}
          </div>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA DESEMPENHO
// ═══════════════════════════════════════════════════════════════════════════════

function AbaDesempenho({cidade}:AbaProps){
  const [subtab,setSubtab]=useState<'ranking'|'heatmap'|'eficiencias'>('ranking');
  const [dados,  setDados  ]=useState<any[]>([]);
  const [efics,  setEfics  ]=useState<Eficiencia[]>([]);
  const [dataIni,setDataIni]=useState('');
  const [dataFim,setDataFim]=useState('');
  const [loading,setLoading]=useState(true);
  const [modal,  setModal  ]=useState(false);
  const [opers,  setOpers  ]=useState<{uid:string;nome:string}[]>([]);
  const [ef,     setEf     ]=useState<Partial<Eficiencia>>({uid:'',nome:'',data:'',cidade:cidade||'',movimentacoes:0,baterias:0,obs:''});

  const carregar=useCallback(async()=>{
    setLoading(true);
    const ini=dataIni?new Date(dataIni+'T00:00:00'):new Date(Date.now()-7*86400000);
    const fim=dataFim?new Date(dataFim+'T23:59:59'):new Date();
    const q=qCidade('tarefas_logistica',cidade,where('status','==','concluida'),where('criadoEm','>=',Timestamp.fromDate(ini)),where('criadoEm','<=',Timestamp.fromDate(fim)),limit(1000));
    const snap=await getDocs(q);
    const ts=snap.docs.map(d=>({id:d.id,...d.data()} as TarefaLogistica));
    const mapa:Record<string,{nome:string;dias:Record<string,{mov:number;bat:number}>}>={};
    ts.forEach(t=>{if(!t.responsavelId)return;if(!mapa[t.responsavelId])mapa[t.responsavelId]={nome:t.responsavelNome||t.responsavelId,dias:{}};const dia=t.criadoEm?.toDate?.()?.toLocaleDateString('pt-BR')||'?';if(!mapa[t.responsavelId].dias[dia])mapa[t.responsavelId].dias[dia]={mov:0,bat:0};if(t.tipo==='CARGA_BATERIA')mapa[t.responsavelId].dias[dia].bat++;else mapa[t.responsavelId].dias[dia].mov++;});
    setDados(Object.entries(mapa).map(([uid,v])=>({uid,nome:v.nome,totalMov:Object.values(v.dias).reduce((s,d)=>s+d.mov,0),totalBat:Object.values(v.dias).reduce((s,d)=>s+d.bat,0),dias:v.dias})).sort((a,b)=>(b.totalMov+b.totalBat)-(a.totalMov+a.totalBat)));
    setLoading(false);
  },[cidade,dataIni,dataFim]);

  useEffect(()=>{carregar();},[carregar]);
  useEffect(()=>{
    const u=onSnapshot(qCidade('eficiencias_logistica',cidade,orderBy('criadoEm','desc'),limit(300)),s=>setEfics(s.docs.map(d=>({id:d.id,...d.data()} as Eficiencia))));
    getDocs(collection(db,'usuarios')).then(s=>setOpers(s.docs.map(d=>({uid:d.id,nome:(d.data() as any).nome||d.id})).slice(0,80)));
    return u;
  },[cidade]);

  const datas=useMemo(()=>{const set=new Set<string>();dados.forEach(p=>Object.keys(p.dias).forEach(d=>set.add(d)));return Array.from(set).sort((a,b)=>{const p=(s:string)=>{const[d,m,y]=s.split('/').map(Number);return new Date(y,m-1,d).getTime();};return p(a)-p(b);});},[dados]);
  const maxVal=useMemo(()=>{let max=1;dados.forEach(p=>Object.values(p.dias as any).forEach((d:any)=>{if(d.mov+d.bat>max)max=d.mov+d.bat;}));return max;},[dados]);
  const corHeat=(n:number)=>{if(!n)return 'transparent';const p=n/maxVal;return p<.3?'rgba(26,111,212,.2)':p<.6?'rgba(26,111,212,.5)':p<.9?'rgba(26,111,212,.8)':'#1a6fd4';};

  const expXLSX=async()=>{const XLSX=await loadXLSX();const rows=dados.map((p,i)=>({'#':i+1,Nome:p.nome,Movs:p.totalMov,Baterias:p.totalBat,Total:p.totalMov+p.totalBat,Cidade:cidade||'Todas'}));const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Desempenho');XLSX.writeFile(wb,`desempenho_${cidade||'all'}_${new Date().toISOString().slice(0,10)}.xlsx`);toast('XLSX exportado');};
  const expPDF=async()=>{const JsPDF=await loadJsPDF();const pdf=new JsPDF();pdf.setFontSize(14);pdf.text(`Ranking Desempenho — ${cidade||'Todas'}`,14,15);pdf.setFontSize(9);dados.forEach((p,i)=>pdf.text(`${i+1}. ${p.nome} — ${p.totalMov+p.totalBat} total`,14,25+i*7));pdf.save(`desempenho_${new Date().toISOString().slice(0,10)}.pdf`);toast('PDF exportado');};
  const salvarEf=async()=>{if(!ef.nome||!ef.data){toast('Nome e data obrigatórios','erro');return;}await addDoc(collection(db,'eficiencias_logistica'),{...ef,cidade:cidade||'SP',criadoEm:serverTimestamp()});toast('Registrado');setModal(false);setEf({uid:'',nome:'',data:'',cidade:cidade||'',movimentacoes:0,baterias:0,obs:''}); };

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'flex-end',flexWrap:'wrap'}}>
        <div><label style={S.lbl}>De</label><input type="date" value={dataIni} onChange={e=>setDataIni(e.target.value)} style={{...S.inp,marginBottom:0,width:150}}/></div>
        <div><label style={S.lbl}>Até</label><input type="date" value={dataFim} onChange={e=>setDataFim(e.target.value)} style={{...S.inp,marginBottom:0,width:150}}/></div>
        <button onClick={carregar} style={{...S.btnG(T.blueg)}}>🔄 Atualizar</button>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          {(['ranking','heatmap','eficiencias'] as const).map(s=><button key={s} onClick={()=>setSubtab(s)} style={{...S.btn(T.bluel,subtab!==s),padding:'7px 12px'}}>{s==='ranking'?'🏆 Ranking':s==='heatmap'?'🔥 Heatmap':'⚡ Eficiências'}</button>)}
          <button onClick={expXLSX} style={{...S.btn(T.green,true),padding:'7px 10px',fontSize:11}}>📊 XLSX</button>
          <button onClick={expPDF}  style={{...S.btn(T.red,true),  padding:'7px 10px',fontSize:11}}>📄 PDF</button>
        </div>
      </div>
      {loading&&<div style={{color:T.dim,textAlign:'center',padding:40}}>Carregando...</div>}
      {!loading&&subtab==='ranking'&&(
        <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
          <table style={S.table}>
            <thead><tr>{['#','Operador','Movs','Baterias','Total','Barra'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {dados.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Sem dados no período</td></tr>}
              {dados.map((p,i)=>{const total=p.totalMov+p.totalBat;const maxT=dados[0]?dados[0].totalMov+dados[0].totalBat:1;const pct=maxT>0?total/maxT*100:0;const med=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';return(
                <tr key={p.uid}><td style={{...S.td,fontWeight:800,color:i<3?T.yellowl:T.dim}}>{med||i+1}</td><td style={{...S.td,fontWeight:600}}>{p.nome}</td><td style={S.td}>{p.totalMov}</td><td style={S.td}>{p.totalBat}</td><td style={{...S.td,fontWeight:700,color:T.bluel}}>{total}</td><td style={{...S.td,minWidth:120}}><div style={{height:8,borderRadius:4,background:T.bdr,overflow:'hidden'}}><div style={{width:`${pct}%`,height:'100%',background:T.blueg,borderRadius:4}}/></div></td></tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
      {!loading&&subtab==='heatmap'&&(
        <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
          <table style={{...S.table,minWidth:100+datas.length*60}}>
            <thead><tr><th style={{...S.th,minWidth:140}}>Operador</th>{datas.map(d=><th key={d} style={{...S.th,textAlign:'center'}}>{d.slice(0,5)}</th>)}<th style={{...S.th,textAlign:'center'}}>Total</th></tr></thead>
            <tbody>{dados.map(p=><tr key={p.uid}><td style={{...S.td,fontWeight:600}}>{p.nome}</td>{datas.map(d=>{const dia=(p.dias as any)[d]||{mov:0,bat:0};const n=dia.mov+dia.bat;return<td key={d} style={{...S.td,textAlign:'center',background:corHeat(n),fontWeight:n>0?700:400}}>{n||''}</td>;})} <td style={{...S.td,textAlign:'center',fontWeight:700,color:T.bluel}}>{p.totalMov+p.totalBat}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {subtab==='eficiencias'&&(
        <div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}><button onClick={()=>setModal(true)} style={{...S.btnG(T.blueg)}}>+ Registrar eficiência</button></div>
          <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
            <table style={S.table}>
              <thead><tr>{['Data','Operador','Movs','Baterias','Obs'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {efics.length===0&&<tr><td colSpan={5} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhuma eficiência registrada</td></tr>}
                {efics.map(e=><tr key={e.id}><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{e.data}</td><td style={{...S.td,fontWeight:600}}>{e.nome}</td><td style={{...S.td,color:T.bluel,fontWeight:700}}>{e.movimentacoes}</td><td style={{...S.td,color:T.yellowl,fontWeight:700}}>{e.baterias}</td><td style={{...S.td,fontSize:11,color:T.dim}}>{e.obs||'—'}</td></tr>)}
              </tbody>
            </table>
          </div>
          {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
            <div style={{...S.mCard,maxWidth:480}}>
              <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>⚡ Registrar Eficiência — {cidade||'SP'}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
              <div style={{padding:18}}>
                <label style={S.lbl}>Operador</label>
                <select value={ef.uid} onChange={e=>{const op=opers.find(o=>o.uid===e.target.value);setEf(f=>({...f,uid:e.target.value,nome:op?.nome||''}));}} style={S.inp}><option value="">— Selecionar —</option>{opers.map(o=><option key={o.uid} value={o.uid}>{o.nome}</option>)}</select>
                <label style={S.lbl}>Data</label><input type="date" onChange={e=>setEf(f=>({...f,data:new Date(e.target.value+'T12:00:00').toLocaleDateString('pt-BR')}))} style={S.inp}/>
                <div style={S.g2}>
                  <div><label style={S.lbl}>Movimentações 🛴</label><input type="number" min={0} value={ef.movimentacoes||0} onChange={e=>setEf(f=>({...f,movimentacoes:parseInt(e.target.value)||0}))} style={S.inp}/></div>
                  <div><label style={S.lbl}>Baterias 🔋</label><input type="number" min={0} value={ef.baterias||0} onChange={e=>setEf(f=>({...f,baterias:parseInt(e.target.value)||0}))} style={S.inp}/></div>
                </div>
                <label style={S.lbl}>Observação</label><input value={ef.obs||''} onChange={e=>setEf(f=>({...f,obs:e.target.value}))} style={S.inp}/>
                <button onClick={salvarEf} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>✓ Salvar</button>
              </div>
            </div>
          </div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA MEIs
// ═══════════════════════════════════════════════════════════════════════════════

function AbaMEIs({cidade}:AbaProps){
  const [lista,   setLista  ]=useState<MEI[]>([]);
  const [busca,   setBusca  ]=useState('');
  const [filtroSt,setFiltroSt]=useState('ATIVO');
  const [modal,   setModal  ]=useState(false);
  const [edit,    setEdit   ]=useState<MEI|null>(null);
  const [form,    setForm   ]=useState<MEI>({nome:'',cpf:'',cnpj:'',status:'ATIVO'});
  const [suspForm,setSuspForm]=useState({ativo:false,inicio:'',ate:'',motivo:''});
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{
    const u=onSnapshot(qCidade('meis',cidade),s=>setLista(s.docs.map(d=>({id:d.id,...d.data()} as MEI))));
    return u;
  },[cidade]);

  const filtrados=useMemo(()=>lista.filter(m=>(filtroSt==='TODOS'||(filtroSt==='SUSPENSO'&&isSusp(m))||(!isSusp(m)&&m.status===filtroSt))&&(!busca||m.nome.toLowerCase().includes(busca.toLowerCase())||(m.cnpj||'').includes(busca))),[lista,busca,filtroSt]);
  const vencEm3=lista.filter(m=>isSusp(m)&&diasRest(m.suspensoAte||'')<=3);

  const salvar=async()=>{
    if(!form.nome?.trim()||!form.cnpj?.trim()){toast('Nome e CNPJ obrigatórios','erro');return;}
    setSalvando(true);
    const p:any={...form,cidade:cidade||'SP',suspensoInicio:suspForm.ativo?suspForm.inicio:'',suspensoAte:suspForm.ativo?suspForm.ate:'',motivoSuspensao:suspForm.ativo?suspForm.motivo:'',atualizadoEm:serverTimestamp()};
    try{if(edit?.id){await updateDoc(doc(db,'meis',edit.id),p);toast('MEI atualizado');}else{await addDoc(collection(db,'meis'),{...p,criadoEm:serverTimestamp()});toast('MEI cadastrado');}setModal(false);}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  return(
    <div>
      {vencEm3.length>0&&<div style={{...S.card(T.orange),marginBottom:12}}><div style={{fontWeight:700,fontSize:12,color:T.orange,marginBottom:6}}>⚠️ Suspensões vencendo em até 3 dias</div>{vencEm3.map(m=><div key={m.id} style={{fontSize:11,color:T.dim,marginBottom:2}}>• <b style={{color:T.txt}}>{m.nome}</b> — <b style={{color:T.orange}}>{diasRest(m.suspensoAte||'')}d</b>{m.motivoSuspensao&&` (${m.motivoSuspensao})`}</div>)}</div>}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Nome, CNPJ..." style={{...S.inp,marginBottom:0,flex:1}}/>
        <select value={filtroSt} onChange={e=>setFiltroSt(e.target.value)} style={{...S.inp,marginBottom:0,width:130}}><option value="TODOS">Todos</option><option value="ATIVO">Ativo</option><option value="SUSPENSO">Suspenso</option><option value="INATIVO">Inativo</option></select>
        <button onClick={()=>{setEdit(null);setForm({nome:'',cpf:'',cnpj:'',status:'ATIVO'});setSuspForm({ativo:false,inicio:'',ate:'',motivo:''});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>+ Cadastrar MEI</button>
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={{...S.table,minWidth:700}}>
          <thead><tr>{['Nome','CNPJ','Status','Suspensão','Dias rest.','Cidade','Ações'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtrados.length===0&&<tr><td colSpan={7} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhum MEI</td></tr>}
            {filtrados.map(m=>{const susp=isSusp(m);const dias=susp?diasRest(m.suspensoAte||''):0;const cSt=susp?T.orange:m.status==='ATIVO'?T.green:T.dim;return(
              <tr key={m.id||m.cnpj}>
                <td style={{...S.td,fontWeight:600}}>{m.nome}</td>
                <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{m.cnpj}</td>
                <td style={S.td}><span style={S.chip(cSt)}>{susp?'SUSPENSO':m.status}</span></td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{susp?<span>até {m.suspensoAte}{m.motivoSuspensao&&` — ${m.motivoSuspensao.slice(0,20)}`}</span>:'—'}</td>
                <td style={{...S.td,textAlign:'center'}}>{susp&&<span style={{fontWeight:700,color:dias<=3?T.red:T.orange}}>{dias}d</span>}{!susp&&'—'}</td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{m.cidade||cidade||'—'}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>{setEdit(m);setForm({...m});setSuspForm({ativo:!!(m.suspensoAte),inicio:m.suspensoInicio||'',ate:m.suspensoAte||'',motivo:m.motivoSuspensao||''});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  <button onClick={async()=>{if(m.id&&window.confirm(`Remover ${m.nome}?`)){await deleteDoc(doc(db,'meis',m.id));toast('Removido');}}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={S.mCard}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{edit?`Editar: ${edit.nome}`:'+ Cadastrar MEI'}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            <div style={S.g2}>
              <div><label style={S.lbl}>Nome *</label><input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/></div>
              <div><label style={S.lbl}>CPF</label><input value={form.cpf} onChange={e=>setForm(f=>({...f,cpf:e.target.value}))} style={S.inp} placeholder="000.000.000-00"/></div>
              <div><label style={S.lbl}>CNPJ *</label><input value={form.cnpj} onChange={e=>setForm(f=>({...f,cnpj:e.target.value}))} style={S.inp} placeholder="00.000.000/0000-00"/></div>
              <div><label style={S.lbl}>Status</label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={S.inp}><option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option></select></div>
            </div>
            <div style={{...S.card(T.red),marginBottom:12}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:suspForm.ativo?10:0}}><input type="checkbox" checked={suspForm.ativo} onChange={e=>setSuspForm(s=>({...s,ativo:e.target.checked}))}/><span style={{fontSize:12,fontWeight:600}}>🚫 Suspensão temporária</span></label>
              {suspForm.ativo&&<div style={S.g2}>
                <div><label style={S.lbl}>De</label><input type="date" value={suspForm.inicio} onChange={e=>setSuspForm(s=>({...s,inicio:e.target.value}))} style={S.inp}/></div>
                <div><label style={S.lbl}>Até</label><input type="date" value={suspForm.ate} onChange={e=>setSuspForm(s=>({...s,ate:e.target.value}))} style={S.inp}/></div>
                {suspForm.inicio&&suspForm.ate&&<div style={{gridColumn:'1/-1',fontSize:11,color:T.orange}}>⏱ {diasRest(suspForm.ate)} dias de suspensão</div>}
                <div style={{gridColumn:'1/-1'}}><label style={S.lbl}>Motivo</label><input value={suspForm.motivo} onChange={e=>setSuspForm(s=>({...s,motivo:e.target.value}))} style={S.inp} placeholder="Ex: Falta em slot"/></div>
              </div>}
            </div>
            <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%'}}>{salvando?'Salvando...':edit?'✓ Salvar':'✓ Cadastrar'}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA CLT
// ═══════════════════════════════════════════════════════════════════════════════

function AbaCLT({cidade}:AbaProps){
  const [lista,   setLista  ]=useState<any[]>([]);
  const [busca,   setBusca  ]=useState('');
  const [filtroSt,setFiltroSt]=useState('ATIVO');
  const [modal,   setModal  ]=useState(false);
  const [edit,    setEdit   ]=useState<any>(null);
  const [form,    setForm   ]=useState<Funcionario>({nome:'',cpf:'',cargo:'CLT',turno:'T1',funcao:'Scout',zona:'',status:'ATIVO',gerente:'',lider:'',telefone:'',dataAdmissao:'',escala:'',diaFolga:''});
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{const u=onSnapshot(collection(db,'usuarios'),s=>setLista(s.docs.map(d=>({id:d.id,...d.data()})).filter((f:any)=>['campo','logistica','charger','scalt','promotor'].includes(f.role||''))));return u;},[]);
  const listaCidade = cidade ? lista.filter((f:any)=>!f.cidade||f.cidade===cidade) : lista;
  const filtrados=useMemo(()=>listaCidade.filter(f=>(filtroSt==='TODOS'||f.status===filtroSt)&&(!busca||f.nome?.toLowerCase().includes(busca.toLowerCase())||(f.cpf||'').includes(busca))),[listaCidade,busca,filtroSt]);
  const stCor=(s:string)=>s==='ATIVO'?T.green:s==='ATESTADO'?T.yellow:s==='AFASTAMENTO'?T.purple:T.red;

  const salvar=async()=>{
    if(!form.nome?.trim()||!form.cpf?.trim()){toast('Nome e CPF obrigatórios','erro');return;}
    setSalvando(true);
    try{if(edit?.id){await updateDoc(doc(db,'usuarios',edit.id),{...form,atualizadoEm:serverTimestamp()});toast('Atualizado');}else{await addDoc(collection(db,'usuarios'),{...form,cidade:cidade||'SP',role:'campo',criadoEm:serverTimestamp()});toast('Cadastrado');}setModal(false);}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const expXLSX=async()=>{const XLSX=await loadXLSX();const rows=filtrados.map(f=>({Nome:f.nome,CPF:f.cpf,Turno:f.turno,Função:f.funcao,Zona:f.zona,Status:f.status,'Dia Folga':f.diaFolga,Cidade:f.cidade||cidade||''}));const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'CLT');XLSX.writeFile(wb,`clt_${cidade||'all'}_${new Date().toISOString().slice(0,10)}.xlsx`);toast('XLSX exportado');};

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Nome ou CPF..." style={{...S.inp,marginBottom:0,flex:1}}/>
        <select value={filtroSt} onChange={e=>setFiltroSt(e.target.value)} style={{...S.inp,marginBottom:0,width:120}}><option value="TODOS">Todos</option>{STATUS_FUNC.map(s=><option key={s} value={s}>{s}</option>)}</select>
        <button onClick={expXLSX} style={{...S.btn(T.green,true),padding:'7px 10px',fontSize:11}}>📊 XLSX</button>
        <button onClick={()=>{setEdit(null);setForm({nome:'',cpf:'',cargo:'CLT',turno:'T1',funcao:'Scout',zona:'',status:'ATIVO',gerente:'',lider:'',telefone:'',dataAdmissao:'',escala:'',diaFolga:''});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>+ CLT</button>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
        {STATUS_FUNC.map(st=>{const n=listaCidade.filter(f=>f.status===st).length;if(!n)return null;return<div key={st} style={{background:T.card,border:`1px solid ${filtroSt===st?stCor(st):T.bdr}`,borderRadius:8,padding:'5px 12px',fontSize:11,cursor:'pointer'}} onClick={()=>setFiltroSt(filtroSt===st?'TODOS':st)}><span style={{color:stCor(st),fontWeight:700}}>{n}</span><span style={{color:T.dim,marginLeft:4}}>{st}</span></div>;})}
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={{...S.table,minWidth:800}}>
          <thead><tr>{['Nome','CPF','Turno','Função','Zona','Status','Folga','Ações'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtrados.length===0&&<tr><td colSpan={8} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhum funcionário</td></tr>}
            {filtrados.map(f=>(
              <tr key={f.id||f.cpf}>
                <td style={{...S.td,fontWeight:600}}>{f.nome}</td><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{f.cpf}</td><td style={S.td}>{f.turno}</td><td style={S.td}>{f.funcao}</td><td style={S.td}>{f.zona||'—'}</td>
                <td style={S.td}><span style={S.chip(stCor(f.status||'ATIVO'))}>{f.status||'—'}</span></td><td style={S.td}>{f.diaFolga||'—'}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>{setEdit(f);setForm({...f});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  <button onClick={async()=>{if(f.id&&window.confirm(`Remover ${f.nome}?`)){await deleteDoc(doc(db,'usuarios',f.id));toast('Removido');}}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={S.mCard}><div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{edit?`Editar: ${edit.nome}`:'+ Cadastrar CLT'}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
        <div style={{padding:18}}>
          <div style={S.g2}>
            <div><label style={S.lbl}>Nome *</label><input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>CPF *</label><input value={form.cpf} onChange={e=>setForm(f=>({...f,cpf:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>Turno</label><select value={form.turno} onChange={e=>setForm(f=>({...f,turno:e.target.value}))} style={S.inp}>{TURNOS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><label style={S.lbl}>Função</label><select value={form.funcao} onChange={e=>setForm(f=>({...f,funcao:e.target.value}))} style={S.inp}>{FUNCOES.map(fn=><option key={fn} value={fn}>{fn}</option>)}</select></div>
            <div><label style={S.lbl}>Status</label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={S.inp}>{STATUS_FUNC.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><label style={S.lbl}>Dia de folga</label><select value={form.diaFolga} onChange={e=>setForm(f=>({...f,diaFolga:e.target.value}))} style={S.inp}><option value="">— Sem folga fixa —</option>{DIAS_SEM.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
            <div><label style={S.lbl}>Zona</label><input value={form.zona} onChange={e=>setForm(f=>({...f,zona:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>Gerente</label><input value={form.gerente} onChange={e=>setForm(f=>({...f,gerente:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>Telefone</label><input value={form.telefone} onChange={e=>setForm(f=>({...f,telefone:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>Admissão</label><input type="date" value={form.dataAdmissao} onChange={e=>setForm(f=>({...f,dataAdmissao:e.target.value}))} style={S.inp}/></div>
          </div>
          <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>{salvando?'Salvando...':edit?'✓ Salvar':'✓ Cadastrar'}</button>
        </div></div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA INVENTÁRIO
// ═══════════════════════════════════════════════════════════════════════════════

function AbaInventario({cidade}:AbaProps){
  const [tipo,    setTipo   ]=useState<Inventario['tipo']>('armario');
  const [lista,   setLista  ]=useState<Inventario[]>([]);
  const [modal,   setModal  ]=useState(false);
  const [edit,    setEdit   ]=useState<Inventario|null>(null);
  const [form,    setForm   ]=useState<Partial<Inventario>>({tipo:'armario',nome:'',status:'ATIVO',zona:'',identificador:'',observacao:''});
  const [salvando,setSalvando]=useState(false);
  const col=`inventario_${tipo}`;

  useEffect(()=>{
    const u=onSnapshot(qCidade(col,cidade),s=>setLista(s.docs.map(d=>({id:d.id,...d.data()} as Inventario))));return u;
  },[tipo,cidade]);

  const tipos=[{k:'armario',l:'Armários',e:'🔋'},{k:'patinete',l:'Patinetes',e:'🛴'},{k:'carro',l:'Carros',e:'🚗'},{k:'suporte',l:'Suportes',e:'🧰'}] as {k:Inventario['tipo'];l:string;e:string}[];
  const stCor=(s:string)=>s==='ATIVO'?T.green:s==='MANUTENCAO'?T.yellow:T.red;

  const salvar=async()=>{
    if(!form.nome?.trim()){toast('Nome obrigatório','erro');return;}
    setSalvando(true);
    const p={...form,tipo,cidade:cidade||'SP',atualizadoEm:serverTimestamp()};
    try{if(edit?.id){await updateDoc(doc(db,col,edit.id),p);toast('Atualizado');}else{await addDoc(collection(db,col),{...p,criadoEm:serverTimestamp()});toast('Adicionado');}setModal(false);}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        {tipos.map(t=><button key={t.k} onClick={()=>setTipo(t.k)} style={{...S.btn(T.bluel,tipo!==t.k),padding:'7px 14px'}}>{t.e} {t.l}</button>)}
        <button onClick={()=>{setEdit(null);setForm({tipo,nome:'',status:'ATIVO',zona:'',identificador:'',observacao:''});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),marginLeft:'auto',fontSize:12}}>+ Adicionar</button>
      </div>
      <div style={S.kpiRow}>
        {[{n:lista.length,l:'Total',c:T.bluel},{n:lista.filter(i=>i.status==='ATIVO').length,l:'Ativos',c:T.green},{n:lista.filter(i=>i.status==='MANUTENCAO').length,l:'Manutenção',c:T.yellow},{n:lista.filter(i=>i.status==='INATIVO').length,l:'Inativos',c:T.red}].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={S.table}>
          <thead><tr>{['Nome','Identificador','Zona','Status','Obs','Ações'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>Nenhum item</td></tr>}
            {lista.map(item=>(
              <tr key={item.id}><td style={{...S.td,fontWeight:600}}>{item.nome}</td><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{item.identificador||'—'}</td><td style={S.td}>{item.zona||'—'}</td><td style={S.td}><span style={S.chip(stCor(item.status))}>{item.status}</span></td><td style={{...S.td,fontSize:11,color:T.dim,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{item.observacao||'—'}</td>
              <td style={S.td}><div style={{display:'flex',gap:4}}>
                <button onClick={()=>{setEdit(item);setForm({...item});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                <button onClick={async()=>{if(item.id&&window.confirm('Remover?'))await deleteDoc(doc(db,col,item.id));}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
              </div></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={{...S.mCard,maxWidth:420}}><div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{edit?'Editar':'+ Novo'}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
        <div style={{padding:18}}>
          <label style={S.lbl}>Nome *</label><input value={form.nome||''} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/>
          <label style={S.lbl}>Identificador</label><input value={form.identificador||''} onChange={e=>setForm(f=>({...f,identificador:e.target.value}))} style={S.inp} placeholder="Placa, série..."/>
          <label style={S.lbl}>Zona</label><input value={form.zona||''} onChange={e=>setForm(f=>({...f,zona:e.target.value}))} style={S.inp}/>
          <label style={S.lbl}>Status</label><select value={form.status||'ATIVO'} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={S.inp}><option value="ATIVO">ATIVO</option><option value="MANUTENCAO">MANUTENÇÃO</option><option value="INATIVO">INATIVO</option></select>
          <label style={S.lbl}>Observação</label><input value={form.observacao||''} onChange={e=>setForm(f=>({...f,observacao:e.target.value}))} style={S.inp}/>
          <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>{salvando?'Salvando...':'✓ Salvar'}</button>
        </div></div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA TELEGRAM — por cidade, múltiplos grupos, relatórios automáticos
// ═══════════════════════════════════════════════════════════════════════════════

function AbaTelegram({usuario,cidade}:AbaProps){
  const [msg,     setMsg    ]=useState('');
  const [slots,   setSlots  ]=useState<Slot[]>([]);
  const [aceites, setAceites]=useState<SlotAceite[]>([]);
  const [tarefas, setTarefas]=useState<TarefaLogistica[]>([]);
  const [workers, setWorkers]=useState<GpsWorker[]>([]);
  const [grupos,  setGrupos ]=useState<TelegramGrupo[]>([]);
  const [enviando,setEnviando]=useState(false);
  const [destino, setDestino]=useState<'todos'|'cidade'|'grupo'>('cidade');
  const [grupoSel,setGrupoSel]=useState('');
  const [cargoFiltro,setCargoFiltro]=useState('todos');

  useEffect(()=>{
    const u1=onSnapshot(qCidade('slots',cidade,orderBy('criadoEm','desc'),limit(100)),s=>setSlots(s.docs.map(d=>({id:d.id,...d.data()} as Slot)).filter(sl=>sl.dataSlot===hoje())));
    const u2=onSnapshot(collection(db,'slot_aceites'),s=>setAceites(s.docs.map(d=>({id:d.id,...d.data()} as SlotAceite))));
    const u3=onSnapshot(qCidade('tarefas_logistica',cidade,where('status','in',['pendente','em_andamento']),limit(100)),s=>setTarefas(s.docs.map(d=>({id:d.id,...d.data()} as TarefaLogistica))));
    const since=Timestamp.fromMillis(Date.now()-30*60000);
    const u4=onSnapshot(qCidade('gps_logistica',cidade,where('criadoEm','>=',since)),s=>setWorkers(s.docs.map(d=>({uid:d.id,...d.data()} as GpsWorker))));
    // Grupos Telegram da cidade
    getDoc(doc(db,'telegram_config','cidades')).then(d=>{
      if(d.exists()){const data=d.data();const cidadeKey=cidade||'global';const cfg=data[cidadeKey];if(cfg?.grupos){const gs:TelegramGrupo[]=Object.entries(cfg.grupos).map(([tipo,g]:any)=>({...g,cidade:cidadeKey,tipos:[tipo]}));setGrupos(gs);}}
    }).catch(()=>{});
    return()=>{u1();u2();u3();u4();};
  },[cidade]);

  const vagT=slots.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acH=aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status!=='Desistiu');
  const iniH=acH.filter(a=>a.status==='Iniciou').length;
  const fltH=acH.filter(a=>a.status==='Faltou').length;
  const online=workers.filter(w=>mAtras(w.atualizadoEm)<30).length;
  const pend=tarefas.filter(t=>t.status==='pendente').length;

  const textoResumo=`📋 *RESUMO LOGÍSTICA — ${cidade||'Geral'} · ${hoje()}*\n━━━━━━━━━━━━━━━━━━━\n\n👷 *Online agora:* ${online}\n\n🎰 *Slots hoje:*\n  Vagas: ${vagT} | Aceites: ${acH.length}\n  ✅ Iniciou: ${iniH} | ❌ Faltou: ${fltH}\n  🟡 Abertas: ${Math.max(0,vagT-acH.length)}\n\n📋 *Tarefas pendentes:* ${pend}\n\n🕐 ${new Date().toLocaleString('pt-BR')}`;

  const enviar=async(texto:string,grupoId?:string)=>{
    if(!texto.trim()){toast('Digite uma mensagem','erro');return;}
    setEnviando(true);
    try{
      const fn=httpsCallable(fnsCli,'notificarTarefa');
      await fn({mensagem:texto,cidade:cidade||'SP',tipo:'telegram_gestor',remetente:usuario.nome,chatId:grupoId||undefined});
      toast('Mensagem enviada');
    }catch{
      await navigator.clipboard.writeText(texto).catch(()=>{});
      toast('Copiado para área de transferência (envio direto indisponível)');
    }finally{setEnviando(false);}
  };

  const enviarConfs=async()=>{
    setEnviando(true);
    const pends=aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status==='Pendente');
    if(!pends.length){toast('Nenhum aceite pendente');setEnviando(false);return;}
    try{
      const fn=httpsCallable(fnsCli,'notificarTarefa');
      for(const a of pends){const sl=slots.find(s=>s.id===a.slotId);await fn({mensagem:`⏰ *Confirmação de Slot*\n\n${a.nome}, você tem um slot hoje às ${sl?.horaIni||'?'} na zona ${sl?.zona||'?'} em ${cidade||'SP'}.\n\n✅ Confirme respondendo esta mensagem.\n❌ Caso não possa, avise com antecedência.`,cidade:cidade||'SP',tipo:'confirmacao_slot',cnpj:a.cnpj,slotId:a.slotId});}
      toast(`${pends.length} confirmações enviadas`);
    }catch(e:any){toast('Erro: '+e.message,'erro');}finally{setEnviando(false);}
  };

  // Relatórios por cargo
  const relPorCargo=(cargo:string)=>{
    const t=tarefas.filter(t=>t.status==='em_andamento');
    return `📋 *Relatório ${cargo} — ${cidade||'SP'} · ${hoje()}*\n\n${t.filter(x=>(x as any).funcao===cargo||x.tipo.includes(cargo.toUpperCase())).slice(0,10).map(x=>`• ${x.endereco||x.titulo||x.id.slice(-6)} — ${x.responsavelNome||'Sem resp.'}`).join('\n')||'Sem tarefas ativas.'}`;
  };

  const TEMPLATES=[
    {label:'Resumo turno',texto:textoResumo},
    {label:'Vagas urgentes',texto:`🚨 *VAGAS ABERTAS — URGENTE — ${cidade||'SP'}*\n\n${Math.max(0,vagT-acH.length)} vaga(s) disponível hoje!\nResponda para confirmar presença.`},
    {label:'Inicio operação',texto:`▶️ *INÍCIO DE OPERAÇÃO — ${cidade||'SP'}*\n📅 ${hoje()}\n\nBom turno a todos! 💪\n— ${usuario.nome}`},
    {label:'Rel. Chargers',  texto:relPorCargo('Charger')},
    {label:'Rel. Scouts',    texto:relPorCargo('Scout')},
  ];

  const filtrosCargo=['todos','Charger','Scout','Scalt','Motorista'];

  return(
    <div>
      {/* Confirmações */}
      <div style={{...S.card(T.bluel),marginBottom:14}}>
        <div style={S.sec}>⏰ Confirmação de slots — {cidade||'todas as cidades'}</div>
        <div style={{display:'flex',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div style={{flex:1,fontSize:12,color:T.dim}}>
            <b style={{color:T.txt}}>{aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status==='Pendente').length}</b> aceites pendentes.
            Clique para enviar lembrete de confirmação.
          </div>
          <button onClick={enviarConfs} disabled={enviando} style={{...S.btnG(T.blueg),flexShrink:0,fontSize:12}}>{enviando?'Enviando...':'📨 Enviar confirmações'}</button>
        </div>
      </div>

      {/* Grupos configurados */}
      {grupos.length>0&&(
        <div style={{...S.card(T.purple),marginBottom:14}}>
          <div style={S.sec}>📡 Grupos Telegram — {cidade||'global'}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
            <button onClick={()=>setGrupoSel('')} style={{...S.btn(T.bluel,!!grupoSel),padding:'5px 10px',fontSize:11}}>Todos os grupos</button>
            {grupos.map(g=><button key={g.chatId} onClick={()=>setGrupoSel(g.chatId)} style={{...S.btn(T.purple,grupoSel!==g.chatId),padding:'5px 10px',fontSize:11}}>{g.nome}</button>)}
          </div>
          {grupoSel&&<div style={{fontSize:11,color:T.dim}}>Mensagem será enviada para: <b style={{color:T.txt}}>{grupos.find(g=>g.chatId===grupoSel)?.nome}</b> (chatId: {grupoSel})</div>}
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div>
          <div style={S.sec}>📝 Templates</div>
          {TEMPLATES.map(t=>(
            <div key={t.label} style={{...S.card(),marginBottom:8}}>
              <div style={{fontWeight:600,fontSize:12,color:T.txt,marginBottom:6}}>{t.label}</div>
              <pre style={{fontSize:10,color:T.dim,whiteSpace:'pre-wrap',marginBottom:8,maxHeight:60,overflowY:'auto',lineHeight:1.5}}>{t.texto.slice(0,160)}...</pre>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>setMsg(t.texto)} style={{...S.btn(T.bluel,true),padding:'5px 10px',fontSize:11}}>✏ Editar</button>
                <button onClick={()=>enviar(t.texto,grupoSel||undefined)} disabled={enviando} style={{...S.btnG(T.blueg),padding:'5px 10px',fontSize:11}}>📤 Enviar</button>
              </div>
            </div>
          ))}
        </div>
        <div>
          <div style={S.sec}>✍️ Mensagem livre</div>
          <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
            {filtrosCargo.map(c=><button key={c} onClick={()=>{setCargoFiltro(c);if(c!=='todos')setMsg(relPorCargo(c));}} style={{...S.btn(T.bluel,cargoFiltro!==c),padding:'4px 8px',fontSize:10}}>{c}</button>)}
          </div>
          <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder={`Mensagem para ${cidade||'todas as cidades'}...\n\nSuporta *negrito* e _itálico_ (Telegram Markdown)`} style={{...S.inp,marginBottom:10,height:200,resize:'vertical',fontFamily:'monospace',fontSize:12}}/>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>navigator.clipboard.writeText(msg).then(()=>toast('Copiado!'))} style={{...S.btn(T.bluel,true),flex:1}}>📋 Copiar</button>
            <button onClick={()=>enviar(msg,grupoSel||undefined)} disabled={enviando||!msg.trim()} style={{...S.btnG(T.blueg),flex:2}}>{enviando?'Enviando...':'📤 Enviar'}</button>
          </div>
          {grupos.length===0&&<div style={{fontSize:10,color:T.dim,marginTop:8}}>💡 Configure grupos em Config → Telegram para habilitar envio direto por grupo.</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA ALERTAS — histórico de alertas críticos detectados pelo monitor
// ═══════════════════════════════════════════════════════════════════════════════

interface MonitorAlerta {
  id: string;
  tipo: string;
  cidade: string;
  zona?: string;
  qtdBikes?: number;
  batMinPct?: number;
  slotId?: string | null;
  ts?: any;
}

function AbaAlertas({cidade}:AbaProps){
  const [lista,setLista]=useState<MonitorAlerta[]>([]);
  const [loading,setLoading]=useState(true);
  const [filtroTipo,setFiltroTipo]=useState('todos');

  useEffect(()=>{
    setLoading(true);
    const q = cidade
      ? query(collection(db,'monitor_alertas'),where('cidade','==',cidade),orderBy('ts','desc'),limit(100))
      : query(collection(db,'monitor_alertas'),orderBy('ts','desc'),limit(100));
    const u=onSnapshot(q,s=>{
      setLista(s.docs.map(d=>({id:d.id,...d.data()} as MonitorAlerta)));
      setLoading(false);
    },()=>setLoading(false));
    return u;
  },[cidade]);

  const TIPOS={
    bateria_critica:{label:'🔋 Bateria crítica',cor:'#f59e0b'},
    ponto_zerado:   {label:'⭕ Ponto zerado',   cor:'#ef4444'},
    ponto_baixo:    {label:'📉 Ponto baixo',    cor:'#f97316'},
  } as Record<string,{label:string;cor:string}>;

  const fmtTs=(ts:any)=>{
    if(!ts) return '—';
    const d=ts?.toDate?.()??new Date(ts);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  };

  const filtrados=useMemo(()=>filtroTipo==='todos'?lista:lista.filter(a=>a.tipo===filtroTipo),[lista,filtroTipo]);

  if(loading) return <div style={{padding:40,textAlign:'center',color:'rgba(255,255,255,.4)'}}>Carregando...</div>;

  return(
    <div style={{maxWidth:780}}>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#dce8ff',flex:1}}>🔔 Histórico de Alertas</div>
        <div style={{display:'flex',gap:4}}>
          {(['todos',...Object.keys(TIPOS)] as string[]).map(t=>(
            <button key={t} onClick={()=>setFiltroTipo(t)} style={{
              padding:'4px 10px',borderRadius:16,border:'none',cursor:'pointer',fontSize:10,fontWeight:600,
              background:filtroTipo===t?(TIPOS[t]?.cor??'#3b82f6'):'rgba(255,255,255,.06)',
              color:filtroTipo===t?'#fff':'rgba(255,255,255,.4)',
            }}>{t==='todos'?'Todos':TIPOS[t]?.label??t}</button>
          ))}
        </div>
      </div>

      {filtrados.length===0&&(
        <div style={{textAlign:'center',padding:60,color:'rgba(255,255,255,.3)',fontSize:13}}>
          {lista.length===0?'Nenhum alerta registrado ainda. Os alertas aparecerão aqui quando o monitor detectar baterias críticas.':'Nenhum alerta neste filtro.'}
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtrados.map(a=>{
          const info=TIPOS[a.tipo]??{label:a.tipo,cor:'#6b7280'};
          return(
            <div key={a.id} style={{background:'rgba(255,255,255,.03)',border:`1px solid ${info.cor}33`,borderLeft:`3px solid ${info.cor}`,borderRadius:10,padding:'12px 16px',display:'flex',gap:14,alignItems:'flex-start'}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                  <span style={{background:info.cor+'22',color:info.cor,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700}}>{info.label}</span>
                  {a.zona&&<span style={{fontSize:10,color:'rgba(255,255,255,.35)',background:'rgba(255,255,255,.06)',padding:'2px 8px',borderRadius:8}}>{a.zona}</span>}
                </div>
                <div style={{fontSize:12,color:'#dce8ff',marginBottom:2}}>
                  {a.qtdBikes!=null&&<span>🛴 <b>{a.qtdBikes}</b> bike{a.qtdBikes!==1?'s':''}</span>}
                  {a.batMinPct!=null&&<span style={{marginLeft:8}}>⚡ min <b style={{color:'#f59e0b'}}>{a.batMinPct}%</b></span>}
                  {a.cidade&&<span style={{marginLeft:8,color:'rgba(255,255,255,.4)'}}>📍 {a.cidade}</span>}
                </div>
                {a.slotId&&<div style={{fontSize:10,color:'rgba(255,255,255,.25)',fontFamily:'monospace'}}>slot: {a.slotId}</div>}
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,.3)',flexShrink:0,textAlign:'right'}}>
                {fmtTs(a.ts)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA CONFIG — por cidade
// ═══════════════════════════════════════════════════════════════════════════════

function AbaConfig({cidade,isAdmin}:AbaProps){
  const [cfg,setCfg]=useState<ConfigGlobal>({slaMinutos:120,raioSugestaoKm:2,alertaZeroGoJet:true,thresholdBatBaixa:30,confirmacaoMin:120,reaberturaSemConfMin:90,prazoHoras:{PONTO:4,PATINETE:2,ORGANIZACAO:8,CARGA_BATERIA:3}});
  const [tgGrupos,setTgGrupos]=useState<TelegramGrupo[]>([]);
  const [novoGrupo,setNovoGrupo]=useState(false);
  const [gf,setGf]=useState({chatId:'',nome:'',tipos:['Scout','Charger'],topicos:{}} as Partial<TelegramGrupo>);
  const [gestoresLog,setGestoresLog]=useState<{uid:string;nome:string;cidades:string[]}[]>([]);
  const [todosUsers,setTodosUsers]=useState<any[]>([]);
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{
    const cidadeKey=cidade||'global';
    getDoc(doc(db,'config_logistica',cidadeKey)).then(d=>{if(d.exists())setCfg(prev=>({...prev,...(d.data() as ConfigGlobal)}));}).catch(()=>{});
    getDoc(doc(db,'telegram_config','cidades')).then(d=>{if(d.exists()){const data=d.data();const gs:TelegramGrupo[]=Object.entries(data[cidadeKey]?.grupos||{}).map(([tipo,g]:any)=>({...g,cidade:cidadeKey,tipos:[tipo]}));setTgGrupos(gs);}}).catch(()=>{});
    if(isAdmin){
      getDocs(collection(db,'usuarios')).then(s=>{
        const users=s.docs.map(d=>({uid:d.id,...d.data()}));
        setTodosUsers(users as any[]);
        setGestoresLog((users as any[]).filter(u=>['gestor','supergestor','logistica'].includes((u as any).role)).map(u=>({uid:(u as any).uid,nome:(u as any).nome||'',...(u as any)})));
      });
    }
  },[cidade,isAdmin]);

  const salvar=async()=>{
    setSalvando(true);
    try{
      const cidadeKey=cidade||'global';
      await setDoc(doc(db,'config_logistica',cidadeKey),{...cfg,atualizadoEm:serverTimestamp()});
      toast(`Config salva${cidade?` — ${cidade}`:''}`)
    }catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const salvarGrupo=async()=>{
    if(!gf.chatId||!gf.nome){toast('Chat ID e nome obrigatórios','erro');return;}
    const cidadeKey=cidade||'global';
    const tipoKey=(gf.tipos?.[0]||'geral').toLowerCase();
    await setDoc(doc(db,'telegram_config','cidades'),{[cidadeKey]:{grupos:{[tipoKey]:{chatId:gf.chatId,nome:gf.nome,topicos:gf.topicos||{}}}}},{merge:true});
    toast('Grupo salvo');setNovoGrupo(false);setGf({chatId:'',nome:'',tipos:['Scout','Charger'],topicos:{}});
    // recarregar grupos
    getDoc(doc(db,'telegram_config','cidades')).then(d=>{if(d.exists()){const data=d.data();const gs:TelegramGrupo[]=Object.entries(data[cidadeKey]?.grupos||{}).map(([tipo,g]:any)=>({...g,cidade:cidadeKey,tipos:[tipo]}));setTgGrupos(gs);}}).catch(()=>{});
  };

  const N=({label,field,min,max,step=1}:{label:string;field:keyof ConfigGlobal;min:number;max:number;step?:number})=>(
    <div><label style={S.lbl}>{label}</label><input type="number" min={min} max={max} step={step} value={cfg[field] as number} onChange={e=>setCfg(c=>({...c,[field]:parseFloat(e.target.value)||0}))} style={S.inp}/></div>
  );

  return(
    <div style={{maxWidth:640}}>
      <div style={{fontSize:12,color:T.dim,marginBottom:12}}>
        ⚙️ Configurações para: <b style={{color:T.txt}}>{cidade||'(global — todas as cidades)'}</b>
      </div>

      <div style={{...S.card(T.bluel),marginBottom:14}}>
        <div style={S.sec}>⚙️ Operação</div>
        <div style={S.g2}>
          <N label="SLA padrão (min)"         field="slaMinutos"        min={15}  max={480}/>
          <N label="Raio sugestão oper. (km)"  field="raioSugestaoKm"    min={0.5} max={20} step={0.5}/>
          <N label="Threshold bateria baixa %" field="thresholdBatBaixa" min={5}   max={50}/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:8,marginTop:4,cursor:'pointer'}}>
          <input type="checkbox" checked={cfg.alertaZeroGoJet} onChange={e=>setCfg(c=>({...c,alertaZeroGoJet:e.target.checked}))}/>
          <span style={{fontSize:12,color:T.txt}}>Alertar pontos GoJet com zero patinetes</span>
        </label>
      </div>

      <div style={{...S.card(T.yellow),marginBottom:14}}>
        <div style={S.sec}>⏰ Confirmação de Slots</div>
        <div style={S.g2}>
          <N label="Avisar confirmação (min antes)" field="confirmacaoMin"       min={30} max={480}/>
          <N label="Reabrir sem confirmação (min)"  field="reaberturaSemConfMin" min={15} max={240}/>
        </div>
        <div style={{fontSize:11,color:T.dim,marginTop:4}}>Ex: slot às 15h → aviso às ~{cfg.confirmacaoMin}min antes. Sem confirmação → vaga reaberta como urgente em {cfg.reaberturaSemConfMin}min.</div>
      </div>

      <div style={{...S.card(T.yellow),marginBottom:14}}>
        <div style={S.sec}>⏱ Prazo automático por tipo de tarefa</div>
        <div style={{fontSize:11,color:T.dim,marginBottom:10}}>Define quantas horas após a criação a tarefa vence. 0 = sem prazo automático.</div>
        <div style={S.g2}>
          {([['PONTO','📍 Encher ponto'],['PATINETE','🛴 Patinete'],['ORGANIZACAO','🗂 Organização'],['CARGA_BATERIA','🔋 Carga bateria']] as const).map(([k,label])=>(
            <div key={k}>
              <label style={S.lbl}>{label}</label>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <input type="number" min={0} max={72} step={0.5}
                  value={cfg.prazoHoras?.[k] ?? 0}
                  onChange={e=>setCfg(c=>({...c,prazoHoras:{...c.prazoHoras,[k]:parseFloat(e.target.value)||0}}))}
                  style={{...S.inp,flex:1}}/>
                <span style={{fontSize:10,color:T.dim,flexShrink:0}}>h</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',padding:'11px',fontSize:13,marginBottom:16}}>{salvando?'Salvando...':'✓ Salvar configurações'}</button>

      {/* Grupos Telegram por cidade */}
      <div style={{...S.card(T.purple),marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={S.sec}>📱 Grupos Telegram — {cidade||'global'}</div>
          <button onClick={()=>setNovoGrupo(v=>!v)} style={{...S.btn(T.purple,true),padding:'5px 10px',fontSize:11}}>+ Grupo</button>
        </div>
        {tgGrupos.length===0&&!novoGrupo&&<div style={{fontSize:12,color:T.dim}}>Nenhum grupo configurado para esta cidade.</div>}
        {tgGrupos.map((g,i)=>(
          <div key={i} style={{...S.card(),marginBottom:8}}>
            <div style={{fontWeight:600,fontSize:12,color:T.txt}}>{g.nome}</div>
            <div style={{fontSize:10,color:T.dim,fontFamily:'monospace'}}>{g.chatId}</div>
            <div style={{fontSize:11,color:T.dim,marginTop:4}}>Tipos: {g.tipos?.join(', ')||'—'}</div>
          </div>
        ))}
        {novoGrupo&&(
          <div style={{...S.card(),marginTop:8}}>
            <label style={S.lbl}>Nome do grupo</label><input value={gf.nome||''} onChange={e=>setGf(f=>({...f,nome:e.target.value}))} style={S.inp} placeholder="Ex: Chargers SP"/>
            <label style={S.lbl}>Chat ID</label><input value={gf.chatId||''} onChange={e=>setGf(f=>({...f,chatId:e.target.value}))} style={S.inp} placeholder="-1001234567890"/>
            <label style={S.lbl}>Tipos de cargo</label>
            <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
              {['Scout','Charger','Scalt','Fiscal','Segurança','Líderes','Alertas'].map(t=>{const sel=(gf.tipos||[]).includes(t);return<button key={t} onClick={()=>setGf(f=>({...f,tipos:sel?(f.tipos||[]).filter(x=>x!==t):[...(f.tipos||[]),t]}))} style={{...S.btn(T.purple,!sel),padding:'4px 8px',fontSize:11}}>{t}</button>;})}</div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setNovoGrupo(false)} style={{...S.btn(undefined,true),flex:1}}>Cancelar</button>
              <button onClick={salvarGrupo} style={{...S.btnG(T.blueg),flex:2}}>✓ Salvar grupo</button>
            </div>
          </div>
        )}
        <div style={{fontSize:10,color:T.dim,marginTop:8}}>💡 Chat ID: abra o grupo no Telegram, encaminhe uma msg para @getidsbot. Thread ID: use @getidsbot no tópico.</div>
      </div>

      {/* Gestores por cidade (só admin) */}
      {isAdmin&&(
        <div style={S.card()}>
          <div style={S.sec}>👷 Gestores de logística</div>
          <div style={{fontSize:11,color:T.dim,marginBottom:10}}>
            Configure quais gestores têm acesso a cada cidade. Campo <code>cidadesGerenciaLog</code> no documento do usuário em <code>usuarios/</code>.
          </div>
          {gestoresLog.slice(0,10).map(g=>(
            <div key={g.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:T.txt}}>{g.nome}</div><div style={{fontSize:10,color:T.dim}}>{(g as any).role}</div></div>
              <div style={{fontSize:11,color:T.dim}}>{(g as any).cidadesGerenciaLog?.join(', ')||'Todas'}</div>
            </div>
          ))}
          <div style={{fontSize:10,color:T.dim,marginTop:8}}>
            Para configurar cidades de um gestor, edite o usuário em Usuários Manager → campo <b>cidadesGerenciaLog</b> (array de strings).
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABA GOJET CONFIG — configuração por cidade (cityId, limiares, automação)
// ═══════════════════════════════════════════════════════════════════════════════

interface GoJetCidadeConfig {
  cityId: string;
  ativo: boolean;
  limiarBaixoPct: number;   // % abaixo do target → ponto "baixo"  (default 50)
  limiarExcessoPct: number; // % acima do target → "excesso"        (default 120)
  batThresholdPct: number;  // % bateria → alerta charger           (default 30)
  batCriticalPct:  number;  // % bateria crítica → urgente           (default 15)
  somenteMonitor: boolean;  // só pontos monitor                    (default true)
  autoTarefas: boolean;     // gerar tarefas automaticamente        (default true)
  notificarGestor: boolean; // notificar via Telegram               (default true)
}

const CFG_PADRAO: GoJetCidadeConfig = {
  cityId: '', ativo: true,
  limiarBaixoPct: 50, limiarExcessoPct: 120, batThresholdPct: 30, batCriticalPct: 15,
  somenteMonitor: true, autoTarefas: true, notificarGestor: true,
};

function AbaGoJetConfig({ cidade, isAdmin }: AbaProps) {
  const [cfg, setCfg]     = useState<GoJetCidadeConfig>(CFG_PADRAO);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [snapInfo, setSnapInfo] = useState<{ total: number; bikes: number; idade: number | null } | null>(null);

  useEffect(() => {
    if (!cidade) return;
    getDoc(doc(db, 'gojet_config', cidade)).then(snap => {
      if (snap.exists()) setCfg({ ...CFG_PADRAO, ...snap.data() });
    });
    // Info do snapshot mais recente
    Promise.all([
      getDoc(doc(db, 'gojet_snapshots', `latest_${cidade}`))
        .then(s => s.exists() ? s : getDoc(doc(db, 'gojet_snapshots', 'latest'))),
      getDoc(doc(db, 'gojet_snapshots', `bikes_latest_${cidade}`))
        .then(s => s.exists() ? s : getDoc(doc(db, 'gojet_snapshots', 'bikes_latest'))),
    ]).then(([pSnap, bSnap]) => {
      const total = pSnap.exists() ? (pSnap.data()?.total ?? (pSnap.data()?.parkings ?? []).length) : 0;
      const bikes = bSnap.exists() ? (bSnap.data()?.total ?? (bSnap.data()?.bikes ?? []).length) : 0;
      const ts = pSnap.exists() ? (pSnap.data()?.savedAt?.toMillis?.() ?? pSnap.data()?.atualizadoEm?.toMillis?.() ?? null) : null;
      const idade = ts ? Math.round((Date.now() - ts) / 60000) : null;
      setSnapInfo({ total, bikes, idade });
    }).catch(() => {});
  }, [cidade]);

  const upd = (k: keyof GoJetCidadeConfig, v: any) => setCfg(c => ({ ...c, [k]: v }));

  const salvar = async () => {
    if (!cidade) return;
    setBusy(true); setMsg('');
    try {
      await setDoc(doc(db, 'gojet_config', cidade), cfg, { merge: true });
      setMsg('✓ Configuração salva');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const S2 = {
    card: { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 } as React.CSSProperties,
    lbl:  { fontSize: 11, color: 'rgba(255,255,255,.4)', display: 'block', marginBottom: 4 } as React.CSSProperties,
    inp:  { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 12, boxSizing: 'border-box' as const },
    row:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as React.CSSProperties,
    num:  { width: 70, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 12, textAlign: 'center' as const },
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 14 }}>
        Configure o cityId da API GoJet e os limiares de automação para <strong style={{ color: 'rgba(255,255,255,.55)' }}>{cidade || '(sem cidade)'}</strong>.
      </div>

      {/* Snapshot info */}
      {snapInfo && (
        <div style={{ ...S2.card, background: 'rgba(6,182,212,.05)', border: '1px solid rgba(6,182,212,.15)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            📍 <strong style={{ color: '#06b6d4' }}>{snapInfo.total}</strong> pontos no snapshot
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            🛴 <strong style={{ color: '#06b6d4' }}>{snapInfo.bikes}</strong> patinetes
          </div>
          <div style={{ fontSize: 11, color: snapInfo.idade === null ? '#6b7280' : snapInfo.idade < 10 ? '#22c55e' : snapInfo.idade < 30 ? '#f59e0b' : '#ef4444' }}>
            ⏱ {snapInfo.idade === null ? 'sem snapshot' : snapInfo.idade < 1 ? 'agora' : `${snapInfo.idade}min atrás`}
          </div>
        </div>
      )}

      {/* City ID */}
      <div style={S2.card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', marginBottom: 10 }}>🔑 Identificação da Cidade</div>
        <label style={S2.lbl}>cityId (API GoJet)</label>
        <input style={S2.inp} value={cfg.cityId} onChange={e => upd('cityId', e.target.value)}
          placeholder="Ex: 5f3a2b1c-... (ID da cidade na API GoJet)" />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.25)', marginTop: 4 }}>
          Encontre em: logistic.gojet.app/api/v0/urent/cities
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.ativo} onChange={e => upd('ativo', e.target.checked)} />
          <span style={{ fontSize: 12, color: cfg.ativo ? '#22c55e' : 'rgba(255,255,255,.4)' }}>
            {cfg.ativo ? '✓ Ativo — scraper coletando dados' : 'Inativo'}
          </span>
        </label>
      </div>

      {/* Limiares */}
      <div style={S2.card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 12 }}>📊 Limiares de Classificação</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <div>
            <label style={S2.lbl}>🟡 Baixo (% do target)</label>
            <input type="number" min={10} max={99} style={S2.inp} value={cfg.limiarBaixoPct}
              onChange={e => upd('limiarBaixoPct', parseInt(e.target.value) || 50)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>ponto "baixo" quando avail &lt; target × N%</div>
          </div>
          <div>
            <label style={S2.lbl}>🟢 Excesso (% do target)</label>
            <input type="number" min={101} max={300} style={S2.inp} value={cfg.limiarExcessoPct}
              onChange={e => upd('limiarExcessoPct', parseInt(e.target.value) || 120)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>ponto "excesso" quando avail ≥ target × N%</div>
          </div>
          <div>
            <label style={S2.lbl}>⚡ Bateria (%)</label>
            <input type="number" min={10} max={80} style={S2.inp} value={cfg.batThresholdPct}
              onChange={e => upd('batThresholdPct', parseInt(e.target.value) || 30)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>gera slot charger quando bat &lt; N%</div>
          </div>
          <div>
            <label style={S2.lbl}>⚡ Bateria crítica ⚠️ (%)</label>
            <input type="number" min={5} max={50} style={S2.inp} value={cfg.batCriticalPct}
              onChange={e => upd('batCriticalPct', parseInt(e.target.value) || 15)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>slot urgente quando bat &lt; N%</div>
          </div>
        </div>
      </div>

      {/* Automação */}
      <div style={S2.card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 12 }}>🤖 Automação de Tarefas</div>
        {[
          { k: 'autoTarefas',     l: 'Gerar slots automaticamente (a cada 15min)', cor: '#10b981' },
          { k: 'somenteMonitor',  l: 'Apenas pontos com flag Monitor',             cor: '#06b6d4' },
          { k: 'notificarGestor', l: 'Notificar gestor via Telegram ao criar slot', cor: '#a78bfa' },
        ].map(({ k, l, cor }) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={(cfg as any)[k]} onChange={e => upd(k as any, e.target.checked)} />
            <span style={{ fontSize: 12, color: (cfg as any)[k] ? cor : 'rgba(255,255,255,.4)' }}>{l}</span>
          </label>
        ))}
      </div>

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? '#10b981' : '#ef4444', marginBottom: 10 }}>{msg}</div>}

      <button
        onClick={salvar} disabled={busy || !cidade || !cfg.cityId}
        style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#a78bfa', color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer', opacity: (!cidade || !cfg.cityId) ? 0.5 : 1 }}>
        {busy ? '⏳ Salvando...' : '✓ Salvar configuração GoJet'}
      </button>
    </div>
  );
}
