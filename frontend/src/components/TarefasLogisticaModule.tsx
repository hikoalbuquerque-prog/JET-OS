// frontend/src/components/TarefasLogisticaModule.tsx
// Módulo completo de Tarefas de Logística — JET OS V2
// Features: Kanban fullscreen · Entregas parciais · Dashboard produtividade
//           Histórico CSV · Worker Home · Mudar destino · Realtime onSnapshot

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, getDoc, serverTimestamp, getDocs, limit,
  Timestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uploadComRetry } from '../lib/uploadUtils';

// GPS background — importado dinamicamente para não quebrar se Capacitor não disponível
let _gpsStarted = false;

async function startGPSTracking(uid: string): Promise<void> {
  if (_gpsStarted) return;
  try {
    const { gpsBackground } = await import('../lib/gps-background');
    await gpsBackground.iniciar({
      uid,
      slotId: null,
      onErro: (msg: string) => console.warn('[GPS]', msg),
    });
    _gpsStarted = true;
  } catch { /* gps-background não disponível */ }
}

async function stopGPSTracking() {
  if (!_gpsStarted) return;
  try {
    const { gpsBackground } = await import('../lib/gps-background');
    await gpsBackground.parar();
    _gpsStarted = false;
  } catch {}
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TarefaKind      = 'PONTO' | 'PATINETE' | 'ORGANIZACAO' | 'CARGA_BATERIA';
export type TarefaStatus    = 'pendente' | 'em_execucao' | 'concluida' | 'cancelada';
export type TarefaPrioridade = 1 | 2 | 3 | 4 | 5;

export interface Entrega {
  id?: string;
  qtd: number;
  fotoUrl: string;
  lat?: number | null;
  lng?: number | null;
  entregueEm: any;
  agentUid: string;
  agentNome?: string;
}

export interface TarefaLogistica {
  id?: string;
  kind: TarefaKind;
  titulo: string;
  descricao?: string;
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  parkingId?: string | null;
  parkingNome?: string | null;
  parkingLat?: number | null;
  parkingLng?: number | null;
  bikeIdentifier?: string | null;
  bikeLat?: number | null;
  bikeLng?: number | null;
  targetCount?: number | null;
  deliveredCount?: number;
  entregas?: Entrega[];
  assigneeUid?: string | null;
  assigneeNome?: string | null;
  cidade: string;
  pais: string;
  criadoPor: string;
  criadoEm?: any;
  atualizadoEm?: any;
  iniciadoEm?: any;
  concluidoEm?: any;
  fotoChegadaUrl?: string | null;
  fotoConclusaoUrl?: string | null;
  geradoPorGoJet?: boolean;
  slotId?: string | null;
  bateriaPercent?: number | null;
  due_at?: any; // Timestamp | null — prazo da tarefa
  // Para "mudar destino"
  destinoAlteradoEm?: any;
}

interface Props {
  usuario: { uid: string; nome?: string; email?: string; role: string };
  cidade: string;
  pais: string;
  onFechar: () => void;
  parkingInicial?: { id: string; nome: string; lat: number; lng: number; target?: number; disponivel?: number } | null;
  tarefaAbertaId?: string | null; // deep link — abre tarefa diretamente
  onSelecionarDestino?: (tarefaId: string, onParkingSelected: (p: any) => void) => void;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const KIND: Record<TarefaKind, { icon: string; label: string; cor: string }> = {
  PONTO:        { icon: '📍', label: 'Encher ponto',   cor: '#3b82f6' },
  PATINETE:     { icon: '🛴', label: 'Mover patinete', cor: '#10b981' },
  ORGANIZACAO:  { icon: '🧹', label: 'Organizar',      cor: '#f97316' },
  CARGA_BATERIA:{ icon: '🔋', label: 'Bateria baixa',  cor: '#f59e0b' },
};

const STATUS: Record<TarefaStatus, { label: string; cor: string }> = {
  pendente:    { label: 'Pendente',     cor: '#6b7280' },
  em_execucao: { label: 'Em execução',  cor: '#3b82f6' },
  concluida:   { label: 'Concluída',    cor: '#10b981' },
  cancelada:   { label: 'Cancelada',    cor: '#ef4444' },
};

const PRIO: Record<number, { label: string; cor: string }> = {
  1: { label: 'Baixa',      cor: '#6b7280' },
  2: { label: 'Normal',     cor: '#3b82f6' },
  3: { label: 'Alta',       cor: '#f97316' },
  4: { label: 'Urgente',    cor: '#ef4444' },
  5: { label: '🚨 CRÍTICA', cor: '#dc2626' },
};

const isAdminRole = (r: string) => ['admin','gestor','supergestor','gestor_seg'].includes(r);
const isFieldRole = (r: string) => ['admin','gestor','supergestor','logistica','campo'].includes(r);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTs(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtIdade(ts: any): string {
  if (!ts) return '';
  const ms = Date.now() - (ts?.toDate?.() ?? new Date(ts)).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h/24)}d`;
}

function fmtDuration(start: any, end: any): string {
  if (!start || !end) return '—';
  const s = (end?.toDate?.() ?? new Date(end)).getTime() - (start?.toDate?.() ?? new Date(start)).getTime();
  const m = Math.floor(s / 60000);
  return m < 60 ? `${m}min` : `${Math.floor(m/60)}h${m%60>0?` ${m%60}min`:''}`;
}

async function uploadFoto(file: File, tarefaId: string, tipo: string): Promise<string> {
  const p = `tarefas_logistica/${tarefaId}/${tipo}_${Date.now()}.jpg`;
  return uploadComRetry(file, p);
}

function navegar(lat: number, lng: number, app: 'maps' | 'waze') {
  app === 'waze'
    ? window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank')
    : window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
}

async function comprimir(file: File, maxW = 1280, q = 0.82): Promise<File> {
  try {
    const bm = await createImageBitmap(file);
    const r  = Math.min(1, maxW / bm.width);
    const c  = document.createElement('canvas');
    c.width  = Math.round(bm.width * r);
    c.height = Math.round(bm.height * r);
    c.getContext('2d')?.drawImage(bm, 0, 0, c.width, c.height);
    bm.close?.();
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', q));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch { return file; }
}

function exportCSV(tarefas: TarefaLogistica[], agentes: Map<string, string>) {
  const h = ['ID','Tipo','Título','Status','Prioridade','Agente','Ponto','Target',
             'Entregue','Criado em','Iniciado em','Concluído em','Duração'];
  const rows = tarefas.map(t => [
    t.id ?? '',
    KIND[t.kind]?.label ?? t.kind,
    t.titulo,
    STATUS[t.status]?.label ?? t.status,
    PRIO[t.prioridade ?? 3]?.label ?? '',
    t.assigneeNome ?? (t.assigneeUid ? agentes.get(t.assigneeUid) ?? t.assigneeUid : '—'),
    t.parkingNome ?? '',
    t.targetCount ?? '',
    t.deliveredCount ?? '',
    fmtTs(t.criadoEm),
    fmtTs(t.iniciadoEm),
    fmtTs(t.concluidoEm),
    fmtDuration(t.iniciadoEm, t.concluidoEm),
  ].map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(','));
  const csv = '\uFEFF' + [h.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `tarefas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const S = {
  painel: (full = false) => ({
    position: 'fixed' as const, top: 0, right: 0, bottom: 0, zIndex: 2600,
    width: '100%', maxWidth: full ? '100vw' : 580,
    background: '#0d1521', borderLeft: '1px solid rgba(255,255,255,.08)',
    display: 'flex', flexDirection: 'column' as const, fontFamily: 'Inter,sans-serif',
  }),
  header: {
    padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  body: { flex: 1, overflowY: 'auto' as const, scrollbarWidth: 'thin' as const },
  btn: (cor = '#3b82f6', small = false) => ({
    padding: small ? '6px 10px' : '9px 14px',
    borderRadius: 8, border: 'none', background: cor, color: '#fff',
    fontSize: small ? 11 : 12, fontWeight: 600, cursor: 'pointer',
  }),
  ghost: {
    padding: '7px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'transparent', color: 'rgba(255,255,255,.5)',
    fontSize: 12, cursor: 'pointer',
  },
  inp: {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const,
  },
  lbl: {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.35)',
    letterSpacing: 1, display: 'block' as const, marginBottom: 4,
    textTransform: 'uppercase' as const,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function TarefasLogisticaModule({
  usuario, cidade, pais, onFechar, parkingInicial, tarefaAbertaId, onSelecionarDestino,
}: Props) {
  type Aba = 'home' | 'minhas' | 'kanban' | 'criar' | 'dashboard' | 'historico';
  const [aba, setAba]               = useState<Aba>(isAdminRole(usuario.role) ? 'kanban' : 'home');
  const [tarefas, setTarefas]       = useState<TarefaLogistica[]>([]);
  const [tarefaSel, setTarefaSel]   = useState<TarefaLogistica | null>(null);
  const [loading, setLoading]       = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [agentes, setAgentes]       = useState<{ uid: string; nome: string; email: string }[]>([]);

  useEffect(() => { if (parkingInicial && isAdminRole(usuario.role)) setAba('criar'); }, [parkingInicial]);

  // Deep link: abre tarefa específica assim que a lista carregar
  useEffect(() => {
    if (!tarefaAbertaId || loading) return;
    const t = tarefas.find(x => x.id === tarefaAbertaId);
    if (t) setTarefaSel(t);
  }, [tarefaAbertaId, tarefas, loading]);

  // Realtime onSnapshot — equivalente ao Supabase Realtime
  useEffect(() => {
    const q = isAdminRole(usuario.role)
      ? query(collection(db,'tarefas_logistica'), where('cidade','==',cidade),
               orderBy('criadoEm','desc'), limit(300))
      : query(collection(db,'tarefas_logistica'), where('cidade','==',cidade),
               where('assigneeUid','==',usuario.uid), orderBy('criadoEm','desc'), limit(100));
    const unsub = onSnapshot(q, snap => {
      setTarefas(snap.docs.map(d => ({ id: d.id, ...d.data() } as TarefaLogistica)));
      setLoading(false);
    });
    return unsub;
  }, [cidade, usuario.uid, usuario.role]);

  useEffect(() => {
    if (!isAdminRole(usuario.role)) return;
    getDocs(query(collection(db,'usuarios'), where('role','in',['logistica','campo','charger','scalt'])))
      .then(snap => setAgentes(snap.docs.map(d => {
        const x = d.data(); return { uid: d.id, nome: x.nome||x.email, email: x.email };
      }))).catch(() => {});
  }, [usuario.role]);

  if (tarefaSel) return (
    <TarefaDetalhe
      tarefa={tarefaSel} usuario={usuario} agentes={agentes}
      onVoltar={() => setTarefaSel(null)}
      onAtualizar={(t) => { if (t) setTarefaSel(t); else setTarefaSel(null); }}
      onSelecionarDestino={onSelecionarDestino}
    />
  );

  const abas: { k: Aba; l: string; roles: string[] }[] = [
    { k: 'home',       l: '🏠 Início',     roles: ['logistica','campo','charger'] },
    { k: 'minhas',     l: '📋 Minhas',      roles: ['logistica','campo','charger','admin','gestor','supergestor'] },
    { k: 'kanban',     l: '📊 Kanban',      roles: ['admin','gestor','supergestor'] },
    { k: 'criar',      l: '➕ Criar',       roles: ['admin','gestor','supergestor'] },
    { k: 'dashboard',  l: '📈 Stats',       roles: ['admin','gestor','supergestor'] },
    { k: 'historico',  l: '📂 Histórico',   roles: ['admin','gestor','supergestor'] },
  ];
  const abasFiltradas = abas.filter(a => a.roles.some(r => usuario.role.includes(r) || a.roles.includes(usuario.role)));

  const pendentes = tarefas.filter(t => t.status==='pendente'||t.status==='em_execucao').length;

  return (
    <div style={S.painel(fullscreen)}>
      {/* Header */}
      <div style={S.header}>
        <button onClick={onFechar} style={S.ghost}>✕</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#dce8ff' }}>📦 Tarefas Logística</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{cidade}</div>
        </div>
        {pendentes > 0 && (
          <div style={{ background: '#ef4444', color: '#fff', borderRadius: 10,
            padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{pendentes}</div>
        )}
        {isAdminRole(usuario.role) && (
          <button onClick={() => setFullscreen(v => !v)} style={S.ghost} title="Tela cheia">
            {fullscreen ? '⊡' : '⊞'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.06)',
        overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }}>
        {abasFiltradas.map(a => (
          <button key={a.k} onClick={() => setAba(a.k)} style={{
            flexShrink: 0, padding: '10px 12px', border: 'none', cursor: 'pointer',
            background: 'transparent', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            color: aba === a.k ? '#3b82f6' : 'rgba(255,255,255,.4)',
            borderBottom: aba === a.k ? '2px solid #3b82f6' : '2px solid transparent',
          }}>{a.l}</button>
        ))}
      </div>

      {/* Content */}
      <div style={S.body}>
        {aba === 'home'      && <WorkerHome tarefas={tarefas} usuario={usuario} onAbrirTarefa={setTarefaSel} />}
        {aba === 'minhas'    && <MinhasTarefas tarefas={tarefas} loading={loading} usuario={usuario} onAbrirTarefa={setTarefaSel} />}
        {aba === 'kanban'    && <KanbanBoard tarefas={tarefas} loading={loading} fullscreen={fullscreen} onAbrirTarefa={setTarefaSel} agentes={agentes} />}
        {aba === 'criar'     && <CriarTarefa usuario={usuario} cidade={cidade} pais={pais} agentes={agentes} parkingInicial={parkingInicial} onCriada={() => setAba('kanban')} />}
        {aba === 'dashboard' && <Dashboard tarefas={tarefas} agentes={agentes} />}
        {aba === 'historico' && <Historico tarefas={tarefas} agentes={agentes} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER HOME — tela inicial do agente de campo
// ═══════════════════════════════════════════════════════════════════════════════

function WorkerHome({ tarefas, usuario, onAbrirTarefa }: {
  tarefas: TarefaLogistica[]; usuario: Props['usuario'];
  onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const [trabalhando, setTrabalhando] = useState(
    () => localStorage.getItem('jet:worker-status') === 'working'
  );
  const [startedAt] = useState(() => {
    const v = localStorage.getItem('jet:worker-started-at');
    return v ? new Date(v) : null;
  });
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (trabalhando) void startGPSTracking(usuario.uid);
    return () => { /* não para GPS ao desmontar — continua em background */ };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!trabalhando || !startedAt) return;
    const t = setInterval(() => {
      const ms = Date.now() - startedAt.getTime();
      const m  = Math.floor(ms / 60000);
      setElapsed(m < 60 ? `${m}min` : `${Math.floor(m/60)}h ${m%60}min`);
    }, 30000);
    return () => clearInterval(t);
  }, [trabalhando, startedAt]);

  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fotoTurno, setFotoTurno] = useState<string | null>(
    () => localStorage.getItem('jet:worker-foto-turno')
  );
  const [uploadingFoto, setUploadingFoto] = useState(false);

  const toggle = () => {
    const agora = new Date();
    if (trabalhando) {
      localStorage.setItem('jet:worker-status', 'stopped');
      localStorage.removeItem('jet:worker-started-at');
      localStorage.removeItem('jet:worker-foto-turno');
      setTrabalhando(false);
      setFotoTurno(null);
      void stopGPSTracking();
    } else {
      // Solicita foto antes de iniciar
      fileRef.current?.click();
    }
  };

  const iniciarComFoto = async (file: File) => {
    const agora = new Date();
    setUploadingFoto(true);
    try {
      const comp = await comprimir(file);
      const path = `turnos/${usuario.uid}/${agora.getTime()}.jpg`;
      const url  = await uploadComRetry(comp, path);
      // Salva no Firestore (best-effort)
      try {
        await addDoc(collection(db, 'turnos_logistica'), {
          uid: usuario.uid, nome: usuario.nome ?? usuario.email,
          fotoUrl: url, acao: 'inicio',
          criadoEm: serverTimestamp(),
          cidade: '',
        });
      } catch { /* best-effort */ }
      localStorage.setItem('jet:worker-status', 'working');
      localStorage.setItem('jet:worker-started-at', agora.toISOString());
      localStorage.setItem('jet:worker-foto-turno', url);
      setFotoTurno(url);
      setTrabalhando(true);
      void startGPSTracking(usuario.uid);
    } catch (e: any) {
      localStorage.setItem('jet:worker-status', 'working');
      localStorage.setItem('jet:worker-started-at', agora.toISOString());
      setTrabalhando(true);
      void startGPSTracking(usuario.uid);
    } finally {
      setUploadingFoto(false);
    }
  };

  const ativas = tarefas.filter(t => t.assigneeUid === usuario.uid &&
    (t.status === 'pendente' || t.status === 'em_execucao'));

  return (
    <div style={{ padding: 16 }}>

      {/* Status card */}
      <div style={{ background: '#111827', borderRadius: 12, padding: 20,
        border: `1px solid ${trabalhando ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.08)'}`,
        marginBottom: 16, textAlign: 'center' as const }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
          Olá, {(usuario.nome ?? usuario.email ?? '').split(' ')[0]}! 👋
        </div>
        <div style={{ fontSize: 28, marginBottom: 4 }}>
          {trabalhando ? '🟢' : '⚪'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: trabalhando ? '#10b981' : '#6b7280',
          marginBottom: trabalhando ? 4 : 12 }}>
          {trabalhando ? 'TRABALHANDO' : 'PARADO'}
        </div>
        {trabalhando && elapsed && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 12 }}>
            Há {elapsed}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          style={{ display: 'none' }}
          onChange={async e => {
            const f = e.target.files?.[0];
            if (f) await iniciarComFoto(f);
            if (e.target) e.target.value = '';
          }} />
        <button onClick={toggle} disabled={uploadingFoto} style={{
          ...S.btn(trabalhando ? '#ef4444' : '#10b981'),
          width: '100%', fontSize: 14, padding: '12px',
          opacity: uploadingFoto ? 0.6 : 1,
        }}>
          {uploadingFoto ? '📸 Enviando foto...' : trabalhando ? '⏸ Parar trabalho' : '▶ Iniciar trabalho + Foto'}
        </button>
        {fotoTurno && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <img src={fotoTurno} alt="Foto turno" style={{ width: 48, height: 48,
              objectFit: 'cover', borderRadius: 8 }} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>
              📸 Foto de início de turno registrada
            </span>
          </div>
        )}
        {trabalhando && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 8 }}>
            📍 Sua localização está sendo compartilhada
          </div>
        )}
      </div>

      {/* Tarefas ativas */}
      {ativas.length > 0 && (
        <>
          <div style={{ ...S.lbl, marginBottom: 10 }}>
            TAREFAS ATIVAS ({ativas.length})
          </div>
          {ativas.sort((a,b) => (b.prioridade??3)-(a.prioridade??3)).map(t => (
            <TarefaCard key={t.id} tarefa={t} onClick={() => onAbrirTarefa(t)} />
          ))}
        </>
      )}

      {ativas.length === 0 && trabalhando && (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.3)', padding: '20px 0', fontSize: 12 }}>
          ✅ Nenhuma tarefa pendente no momento
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINHAS TAREFAS
// ═══════════════════════════════════════════════════════════════════════════════

function MinhasTarefas({ tarefas, loading, usuario, onAbrirTarefa }: {
  tarefas: TarefaLogistica[]; loading: boolean;
  usuario: Props['usuario']; onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const [filtro, setFiltro] = useState<TarefaStatus | 'todas'>('todas');
  const minhas = tarefas.filter(t => t.assigneeUid === usuario.uid || isAdminRole(usuario.role));
  const filtradas = filtro === 'todas' ? minhas : minhas.filter(t => t.status === filtro);

  if (loading) return <Loading />;
  return (
    <div style={{ padding: 12 }}>
      {/* Filtro status */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' as const }}>
        {(['todas','pendente','em_execucao','concluida'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            padding: '5px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600,
            background: filtro === f ? '#3b82f6' : 'rgba(255,255,255,.06)',
            color: filtro === f ? '#fff' : 'rgba(255,255,255,.4)',
          }}>
            {f === 'todas' ? `Todas (${minhas.length})`
              : f === 'em_execucao' ? `Em execução (${minhas.filter(t=>t.status===f).length})`
              : `${STATUS[f].label} (${minhas.filter(t=>t.status===f).length})`}
          </button>
        ))}
      </div>

      {filtradas.length === 0
        ? <Empty msg="Nenhuma tarefa neste filtro" />
        : filtradas.sort((a,b)=>(b.prioridade??3)-(a.prioridade??3)).map(t => (
            <TarefaCard key={t.id} tarefa={t} onClick={() => onAbrirTarefa(t)} showAssignee={isAdminRole(usuario.role)} />
          ))
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// KANBAN
// ═══════════════════════════════════════════════════════════════════════════════

function KanbanBoard({ tarefas, loading, fullscreen, onAbrirTarefa, agentes }: {
  tarefas: TarefaLogistica[]; loading: boolean; agentes: { uid: string; nome: string }[];
  fullscreen: boolean; onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const [busca,        setBusca       ] = useState('');
  const [filtroKind,   setFiltroKind  ] = useState<TarefaKind | 'todas'>('todas');
  const [filtroAgente, setFiltroAgente] = useState('');
  const [soPrazoVenc,  setSoPrazoVenc ] = useState(false);

  if (loading) return <Loading />;

  const agora = Date.now();
  const filtradas = tarefas.filter(t => {
    if (filtroKind !== 'todas' && t.kind !== filtroKind) return false;
    if (filtroAgente === '__sem__' && t.assigneeUid) return false;
    if (filtroAgente && filtroAgente !== '__sem__' && t.assigneeUid !== filtroAgente) return false;
    if (soPrazoVenc) {
      const due = t.due_at?.toDate?.()?.getTime() ?? (t.due_at ? new Date(t.due_at).getTime() : null);
      if (!due || due >= agora || t.status === 'concluida' || t.status === 'cancelada') return false;
    }
    if (busca) {
      const q = busca.toLowerCase();
      if (!t.titulo.toLowerCase().includes(q)
        && !(t.parkingNome ?? '').toLowerCase().includes(q)
        && !(t.assigneeNome ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cols: TarefaStatus[] = ['pendente','em_execucao','concluida'];

  return (
    <div style={{ padding: 12 }}>
      {/* Stats header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {cols.map(s => {
          const n = tarefas.filter(t => t.status === s).length;
          return (
            <div key={s} style={{ flex: 1, background: '#111827', borderRadius: 8,
              padding: '8px 10px', border: `1px solid ${STATUS[s].cor}25` }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: STATUS[s].cor }}>{n}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)' }}>{STATUS[s].label}</div>
            </div>
          );
        })}
        {/* Vencidas badge */}
        {(() => { const v = tarefas.filter(t => { const d = t.due_at?.toDate?.()?.getTime() ?? null; return d && d < agora && t.status !== 'concluida' && t.status !== 'cancelada'; }).length; return v > 0 ? (
          <div style={{ flex: 1, background: '#1a0a0a', borderRadius: 8,
            padding: '8px 10px', border: '1px solid #ef444430', cursor: 'pointer' }}
            onClick={() => setSoPrazoVenc(v => !v)}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{v}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)' }}>⏰ Vencidas</div>
          </div>
        ) : null; })()}
      </div>

      {/* Filtros */}
      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="🔍 Buscar tarefa, ponto ou agente..."
        style={{ ...S.inp, marginBottom: 8 }} />

      {/* Linha 1: tipo */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, overflowX: 'auto', paddingBottom: 2 }}>
        <button onClick={() => setFiltroKind('todas')} style={{
          padding: '4px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 600, flexShrink: 0,
          background: filtroKind === 'todas' ? '#3b82f6' : 'rgba(255,255,255,.06)',
          color: filtroKind === 'todas' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>Todos</button>
        {(Object.keys(KIND) as TarefaKind[]).map(k => (
          <button key={k} onClick={() => setFiltroKind(k)} style={{
            padding: '4px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600, flexShrink: 0,
            background: filtroKind === k ? KIND[k].cor : 'rgba(255,255,255,.06)',
            color: filtroKind === k ? '#fff' : 'rgba(255,255,255,.4)',
          }}>{KIND[k].icon} {KIND[k].label}</button>
        ))}
      </div>

      {/* Linha 2: agente + prazo vencido */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={filtroAgente} onChange={e => setFiltroAgente(e.target.value)}
          style={{ ...S.inp, width: 'auto', flex: 1, minWidth: 140, marginBottom: 0 }}>
          <option value="">👤 Todos os agentes</option>
          <option value="__sem__">Sem agente</option>
          {agentes.map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
        </select>
        <button onClick={() => setSoPrazoVenc(v => !v)} style={{
          padding: '4px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 600, flexShrink: 0,
          background: soPrazoVenc ? '#ef4444' : 'rgba(255,255,255,.06)',
          color: soPrazoVenc ? '#fff' : 'rgba(255,255,255,.4)',
        }}>⏰ Prazo vencido</button>
        {(busca || filtroKind !== 'todas' || filtroAgente || soPrazoVenc) && (
          <button onClick={() => { setBusca(''); setFiltroKind('todas'); setFiltroAgente(''); setSoPrazoVenc(false); }} style={{
            padding: '4px 10px', borderRadius: 16, border: '1px solid rgba(255,255,255,.15)',
            background: 'transparent', color: 'rgba(255,255,255,.4)', fontSize: 10, cursor: 'pointer',
          }}>✕ Limpar</button>
        )}
      </div>

      {/* Colunas */}
      {fullscreen ? (
        // Desktop fullscreen: colunas lado a lado
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {cols.map(status => (
            <KanbanCol key={status} status={status}
              items={filtradas.filter(t => t.status === status)}
              onAbrirTarefa={onAbrirTarefa} />
          ))}
        </div>
      ) : (
        // Mobile: colunas em lista
        <>
          {cols.map(status => {
            const items = filtradas.filter(t => t.status === status);
            if (items.length === 0) return null;
            return <KanbanCol key={status} status={status} items={items} onAbrirTarefa={onAbrirTarefa} />;
          })}
        </>
      )}

      {filtradas.length === 0 && <Empty msg="Nenhuma tarefa encontrada" />}
    </div>
  );
}

function KanbanCol({ status, items, onAbrirTarefa }: {
  status: TarefaStatus; items: TarefaLogistica[];
  onAbrirTarefa: (t: TarefaLogistica) => void;
}) {
  const m = STATUS[status];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: m.cor,
        marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.cor, display: 'inline-block' }} />
        {m.label} ({items.length})
      </div>
      {items.sort((a,b) => (b.prioridade??3)-(a.prioridade??3)).map(t => (
        <TarefaCard key={t.id} tarefa={t} onClick={() => onAbrirTarefa(t)} showAssignee compact />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAREFA CARD
// ═══════════════════════════════════════════════════════════════════════════════

function TarefaCard({ tarefa, onClick, compact, showAssignee }: {
  tarefa: TarefaLogistica; onClick: () => void;
  compact?: boolean; showAssignee?: boolean;
}) {
  const k = KIND[tarefa.kind]; const s = STATUS[tarefa.status]; const p = PRIO[tarefa.prioridade??3];
  const progresso = tarefa.targetCount && tarefa.targetCount > 0
    ? Math.min(100, Math.round(((tarefa.deliveredCount??0)/tarefa.targetCount)*100)) : null;

  const cardLat = tarefa.parkingLat ?? tarefa.bikeLat;
  const cardLng = tarefa.parkingLng ?? tarefa.bikeLng;
  const hasCoords = cardLat != null && cardLng != null;

  return (
    <div onClick={onClick} style={{ background: '#111827', borderRadius: 10, padding: compact?10:14,
      marginBottom: 8, border: `1px solid ${k.cor}20`, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 13 }}>{k.icon}</span>
        {tarefa.geradoPorGoJet && (
          <span style={{ fontSize: 8, background: 'rgba(59,130,246,.2)', color: '#60a5fa',
            padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>AUTO</span>
        )}
        <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#dce8ff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tarefa.titulo}
        </div>
        {hasCoords && (
          <button
            title="Ver no mapa"
            onClick={e => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('jetMapFocus', {
                detail: { lat: cardLat, lng: cardLng, label: tarefa.parkingNome ?? tarefa.titulo },
              }));
            }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#60a5fa', fontSize: 14, padding: '2px 4px', flexShrink: 0,
              lineHeight: 1,
            }}
          >📍</button>
        )}
        <span style={{ fontSize: 9, background: `${p.cor}20`, color: p.cor,
          padding: '1px 5px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>
          {p.label}
        </span>
      </div>

      {!compact && tarefa.parkingNome && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>
          📍 {tarefa.parkingNome}
          {tarefa.targetCount != null && (
            <span style={{ color: '#3b82f6' }}>
              {' '}— {tarefa.deliveredCount??0}/{tarefa.targetCount} pat.
            </span>
          )}
        </div>
      )}

      {/* Barra de progresso */}
      {progresso !== null && (
        <div style={{ height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, marginBottom: 6 }}>
          <div style={{ height: 3, width: `${progresso}%`,
            background: progresso >= 100 ? '#10b981' : '#3b82f6', borderRadius: 2 }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, background: `${s.cor}20`, color: s.cor,
          padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>{s.label}</span>
        {showAssignee && tarefa.assigneeNome && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
            👤 {tarefa.assigneeNome.split(' ')[0]}
          </span>
        )}
        {tarefa.due_at && (() => {
          const ms = tarefa.due_at.toMillis ? tarefa.due_at.toMillis() : new Date(tarefa.due_at).getTime();
          const diff = ms - Date.now();
          const vencida = diff < 0 && !['concluida','cancelada'].includes(tarefa.status);
          const urgente = diff > 0 && diff < 2 * 3_600_000;
          const label = vencida ? '⏰ Vencida'
            : urgente ? `⚠️ ${Math.ceil(diff/60000)}min`
            : `📅 ${fmtTs(tarefa.due_at)}`;
          return (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
              background: vencida ? 'rgba(239,68,68,.2)' : urgente ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.07)',
              color: vencida ? '#ef4444' : urgente ? '#fbbf24' : 'rgba(255,255,255,.35)',
            }}>{label}</span>
          );
        })()}
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.2)', marginLeft: 'auto' }}>
          {fmtIdade(tarefa.criadoEm)}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETALHE + EXECUÇÃO DA TAREFA
// ═══════════════════════════════════════════════════════════════════════════════

function TarefaDetalhe({ tarefa: tarefaInicial, usuario, agentes, onVoltar, onAtualizar, onSelecionarDestino }: {
  tarefa: TarefaLogistica; usuario: Props['usuario'];
  agentes: { uid: string; nome: string; email: string }[];
  onVoltar: () => void; onAtualizar: (t?: TarefaLogistica) => void;
  onSelecionarDestino?: Props['onSelecionarDestino'];
}) {
  const [tarefa, setTarefa] = useState(tarefaInicial);
  const [busy, setBusy]     = useState(false);
  const [erro, setErro]     = useState('');
  const [ok, setOk]         = useState('');
  const [qtdEntrega, setQtdEntrega] = useState(1);
  const fileRef  = useRef<HTMLInputElement>(null);
  const [fotoTipo, setFotoTipo] = useState<'chegada' | 'conclusao' | 'entrega'>('chegada');
  const [showReatrib, setShowReatrib] = useState(false);
  const [novoAgente, setNovoAgente]   = useState('');
  const [auditLog, setAuditLog]       = useState<any[]>([]);

  // Realtime: escuta mudanças nessa tarefa específica
  useEffect(() => {
    if (!tarefa.id) return;
    const unsub = onSnapshot(doc(db, 'tarefas_logistica', tarefa.id), d => {
      if (d.exists()) setTarefa({ id: d.id, ...d.data() } as TarefaLogistica);
    });
    return unsub;
  }, [tarefa.id]);

  // Realtime: audit log da tarefa
  useEffect(() => {
    if (!tarefa.id) return;
    const q = query(
      collection(db, 'tarefas_logistica', tarefa.id, 'audit_log'),
      orderBy('ts', 'asc'),
    );
    return onSnapshot(q, snap => {
      setAuditLog(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [tarefa.id]);

  const mine    = tarefa.assigneeUid === usuario.uid || isAdminRole(usuario.role);
  const podInic = tarefa.status === 'pendente' && mine;
  const podExec = tarefa.status === 'em_execucao' && mine;
  const podCanc = isAdminRole(usuario.role) && tarefa.status !== 'concluida';

  const atualizar = async (campos: Partial<TarefaLogistica> & Record<string, any>) => {
    if (!tarefa.id) return;
    setBusy(true); setErro('');
    try {
      await updateDoc(doc(db,'tarefas_logistica',tarefa.id), {
        ...campos, atualizadoEm: serverTimestamp(),
      });
      // Audit log: registra transições de status e entrega parcial
      const evento = campos.status
        ? { tipo: 'status', de: tarefa.status, para: campos.status }
        : campos.entregas
        ? { tipo: 'entrega_parcial', qtd: campos.deliveredCount ?? '?' }
        : campos.parkingId !== undefined
        ? { tipo: 'destino_alterado', para: campos.parkingNome ?? campos.parkingId }
        : null;
      if (evento) {
        await addDoc(
          collection(db, 'tarefas_logistica', tarefa.id, 'audit_log'),
          { ...evento, ts: serverTimestamp(), uid: usuario.uid, nome: usuario.nome ?? usuario.email ?? '' }
        );
      }
      setOk('Atualizado!'); setTimeout(() => setOk(''), 2000);
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); }
  };

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !tarefa.id) return;
    setBusy(true); setErro('');
    try {
      const comp = await comprimir(file);
      const url  = await uploadFoto(comp, tarefa.id, fotoTipo);

      if (fotoTipo === 'chegada') {
        await atualizar({ fotoChegadaUrl: url, status: 'em_execucao', iniciadoEm: serverTimestamp() });
        setOk('Chegada registrada! Tarefa iniciada.');
      } else if (fotoTipo === 'conclusao') {
        await atualizar({ fotoConclusaoUrl: url, status: 'concluida', concluidoEm: serverTimestamp() });
        setOk('Tarefa concluída!');
      } else {
        // Entrega parcial
        await registrarEntrega(url);
      }
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); if (e.target) e.target.value = ''; }
  };

  const registrarEntrega = async (fotoUrl: string) => {
    if (!tarefa.id) return;
    const entrega: Entrega = {
      qtd: qtdEntrega,
      fotoUrl,
      entregueEm: serverTimestamp(),
      agentUid: usuario.uid,
      agentNome: usuario.nome ?? usuario.email,
    };
    const novoEntregue = (tarefa.deliveredCount ?? 0) + qtdEntrega;
    const concluida    = tarefa.targetCount != null && novoEntregue >= tarefa.targetCount;
    await atualizar({
      deliveredCount: novoEntregue,
      entregas: [...(tarefa.entregas ?? []), entrega],
      ...(concluida ? { status: 'concluida', concluidoEm: serverTimestamp() } : {}),
    });
    setOk(concluida ? `✅ Meta atingida! Tarefa concluída.` : `+${qtdEntrega} entregue(s). Total: ${novoEntregue}/${tarefa.targetCount}`);
  };

  const reatribuir = async () => {
    if (!novoAgente || !tarefa.id) return;
    const ag = agentes.find(a => a.uid === novoAgente);
    if (!ag) return;
    setBusy(true); setErro('');
    try {
      await updateDoc(doc(db, 'tarefas_logistica', tarefa.id), {
        assigneeUid: ag.uid, assigneeNome: ag.nome,
        reatribuidoEm: serverTimestamp(), reatribuidoPor: usuario.uid,
        atualizadoEm: serverTimestamp(),
      });
      await addDoc(
        collection(db, 'tarefas_logistica', tarefa.id, 'audit_log'),
        {
          tipo: 'reatribuicao',
          de: tarefa.assigneeNome ?? '—',
          para: ag.nome,
          ts: serverTimestamp(),
          uid: usuario.uid,
          nome: usuario.nome ?? usuario.email ?? '',
        }
      );
      // Telegram: notificar novo agente
      try {
        const { httpsCallable: hc, getFunctions: gf } = await import('firebase/functions');
        const { getApp: ga } = await import('firebase/app');
        const fn = hc(gf(ga(), 'southamerica-east1'), 'notificarTarefaAtribuida');
        await fn({ assigneeUid: ag.uid, tarefaId: tarefa.id, titulo: tarefa.titulo, kind: tarefa.kind, parkingNome: tarefa.parkingNome ?? null, cidade: tarefa.cidade }).catch(() => {});
      } catch { /* best-effort */ }
      setOk(`Reatribuído para ${ag.nome}`);
      setShowReatrib(false); setNovoAgente('');
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); }
  };

  const mudarDestino = () => {
    if (!tarefa.id || !onSelecionarDestino) return;
    onSelecionarDestino(tarefa.id, async (parking: any) => {
      await atualizar({
        parkingId: parking.id,
        parkingNome: parking.name ?? parking.nome,
        parkingLat: parking.latitude ?? parking.lat,
        parkingLng: parking.longitude ?? parking.lng,
        destinoAlteradoEm: serverTimestamp(),
      });
      setOk('Destino atualizado!');
    });
    onVoltar();
  };

  const lat = tarefa.parkingLat ?? tarefa.bikeLat;
  const lng = tarefa.parkingLng ?? tarefa.bikeLng;
  const k   = KIND[tarefa.kind];
  const s   = STATUS[tarefa.status];
  const progresso = tarefa.targetCount && tarefa.targetCount > 0
    ? Math.min(100, Math.round(((tarefa.deliveredCount??0)/tarefa.targetCount)*100)) : null;

  return (
    <div style={S.painel()}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={handleFoto} />

      <div style={S.header}>
        <button onClick={onVoltar} style={S.ghost}>← Voltar</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff' }}>
            {k.icon} {tarefa.titulo}
          </div>
          <div style={{ fontSize: 10, color: s.cor }}>{s.label}</div>
        </div>
      </div>

      <div style={{ ...S.body, padding: 14 }}>
        {erro && <Alert tipo="erro" msg={erro} />}
        {ok   && <Alert tipo="ok"   msg={ok}   />}

        {/* Progresso */}
        {progresso !== null && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>Progresso</span>
              <span style={{ fontSize: 12, fontWeight: 700,
                color: progresso >= 100 ? '#10b981' : '#3b82f6' }}>
                {tarefa.deliveredCount??0} / {tarefa.targetCount}
              </span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,.08)', borderRadius: 4 }}>
              <div style={{ height: 8, width: `${progresso}%`,
                background: progresso >= 100 ? '#10b981' : '#3b82f6',
                borderRadius: 4, transition: 'width .3s' }} />
            </div>
            {(tarefa.entregas?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8 }}>
                {tarefa.entregas?.map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 11, color: 'rgba(255,255,255,.4)', padding: '4px 0',
                    borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <span>+{e.qtd} pat.</span>
                    <span>{fmtTs(e.entregueEm)}</span>
                    {e.fotoUrl && (
                      <a href={e.fotoUrl} target="_blank" rel="noreferrer"
                        style={{ marginLeft: 'auto', color: '#3b82f6', fontSize: 10 }}>📸 ver</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Localização + navegação */}
        {lat != null && lng != null && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#dce8ff', marginBottom: 2 }}>
              📍 {tarefa.parkingNome ?? tarefa.bikeIdentifier ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
            </div>
            {tarefa.bateriaPercent != null && (
              <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 8 }}>
                🔋 {Math.round(tarefa.bateriaPercent*100)}%
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => navegar(lat, lng, 'maps')} style={{ ...S.btn('#1a73e8'), flex: 1 }}>
                🗺 Google Maps
              </button>
              <button onClick={() => navegar(lat, lng, 'waze')} style={{ ...S.btn('#05c8f0'), flex: 1 }}>
                🚗 Waze
              </button>
              {isAdminRole(usuario.role) && onSelecionarDestino && (
                <button onClick={mudarDestino} style={{ ...S.btn('#f97316', true), flexShrink: 0 }}
                  title="Mudar destino clicando num ponto do mapa GoJet">
                  🎯
                </button>
              )}
            </div>
          </div>
        )}

        {/* Descrição */}
        {tarefa.descricao && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12,
            fontSize: 12, color: 'rgba(255,255,255,.55)', lineHeight: 1.6 }}>
            {tarefa.descricao}
          </div>
        )}

        {/* Fotos existentes */}
        {(tarefa.fotoChegadaUrl || tarefa.fotoConclusaoUrl) && (
          <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ ...S.lbl, marginBottom: 8 }}>FOTOS</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['fotoChegadaUrl','📸 Chegada'],['fotoConclusaoUrl','✅ Conclusão']].map(([field, label]) => {
                const url = (tarefa as any)[field];
                return url ? (
                  <a key={field} href={url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                    <img src={url} alt={label} style={{ width: '100%', height: 90,
                      objectFit: 'cover', borderRadius: 8 }} />
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textAlign: 'center',
                      marginTop: 3 }}>{label}</div>
                  </a>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Ações */}
        {mine && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {podInic && (
              <>
                <button disabled={busy} onClick={() => { setFotoTipo('chegada'); fileRef.current?.click(); }}
                  style={{ ...S.btn('#3b82f6'), width: '100%' }}>
                  📸 {busy ? 'Aguarde...' : 'Tirar foto de chegada (Iniciar)'}
                </button>
                <button disabled={busy} onClick={() => atualizar({ status: 'em_execucao', iniciadoEm: serverTimestamp() })}
                  style={S.ghost}>▶ Iniciar sem foto</button>
              </>
            )}

            {podExec && (
              <>
                {/* Entrega parcial (só PONTO com targetCount) */}
                {tarefa.kind === 'PONTO' && tarefa.targetCount != null && (
                  <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 4 }}>
                    <div style={{ ...S.lbl, marginBottom: 8 }}>REGISTRAR ENTREGA PARCIAL</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>Patinetes entregues:</label>
                      <button onClick={() => setQtdEntrega(q => Math.max(1, q-1))}
                        style={S.btn('#374151', true)}>−</button>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#dce8ff', minWidth: 24,
                        textAlign: 'center' }}>{qtdEntrega}</span>
                      <button onClick={() => setQtdEntrega(q => Math.min(
                        (tarefa.targetCount??99)-(tarefa.deliveredCount??0), q+1))}
                        style={S.btn('#374151', true)}>+</button>
                    </div>
                    <button disabled={busy}
                      onClick={() => { setFotoTipo('entrega'); fileRef.current?.click(); }}
                      style={{ ...S.btn('#f97316'), width: '100%' }}>
                      📸 {busy ? 'Enviando...' : `Registrar +${qtdEntrega} entrega(s) com foto`}
                    </button>
                  </div>
                )}

                <button disabled={busy} onClick={() => { setFotoTipo('conclusao'); fileRef.current?.click(); }}
                  style={{ ...S.btn('#10b981'), width: '100%' }}>
                  ✅ {busy ? 'Enviando...' : 'Foto de conclusão (Concluir)'}
                </button>
                <button disabled={busy}
                  onClick={() => atualizar({ status: 'concluida', concluidoEm: serverTimestamp() })}
                  style={S.ghost}>✓ Concluir sem foto</button>
              </>
            )}

            {podCanc && (
              <button disabled={busy}
                onClick={() => { if (confirm('Cancelar tarefa?')) atualizar({ status: 'cancelada' }); }}
                style={{ ...S.btn('#ef4444', true), width: '100%', marginTop: 8 }}>
                🗑 Cancelar tarefa
              </button>
            )}

            {/* Reatribuição — apenas admins/gestores, tarefas não concluídas */}
            {isAdminRole(usuario.role) && tarefa.status !== 'concluida' && tarefa.status !== 'cancelada' && agentes.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {!showReatrib ? (
                  <button onClick={() => setShowReatrib(true)}
                    style={{ ...S.ghost, width: '100%' }}>
                    🔄 Reatribuir tarefa
                  </button>
                ) : (
                  <div style={{ background: '#111827', borderRadius: 10, padding: 12 }}>
                    <div style={{ ...S.lbl, marginBottom: 8 }}>REATRIBUIR PARA</div>
                    {tarefa.assigneeNome && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 8 }}>
                        Agente atual: <span style={{ color: 'rgba(255,255,255,.6)' }}>{tarefa.assigneeNome}</span>
                      </div>
                    )}
                    <select value={novoAgente} onChange={e => setNovoAgente(e.target.value)}
                      style={{ ...S.inp, width: '100%', appearance: 'none' as const, marginBottom: 8 }}>
                      <option value="">— Selecionar agente —</option>
                      {agentes
                        .filter(a => a.uid !== tarefa.assigneeUid)
                        .map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
                    </select>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setShowReatrib(false); setNovoAgente(''); }}
                        style={{ ...S.ghost, flex: 1 }}>Cancelar</button>
                      <button disabled={busy || !novoAgente} onClick={reatribuir}
                        style={{ ...S.btn('#6366f1'), flex: 2,
                          opacity: !novoAgente ? 0.4 : 1 }}>
                        {busy ? '⏳ Salvando...' : '✓ Confirmar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Audit log */}
        {auditLog.length > 0 && (
          <div style={{ marginTop: 16, background: '#111827', borderRadius: 10, padding: 12 }}>
            <div style={{ ...S.lbl, marginBottom: 10 }}>HISTÓRICO</div>
            <div style={{ position: 'relative' }}>
              {/* linha vertical */}
              <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2,
                background: 'rgba(255,255,255,.08)', borderRadius: 1 }} />
              {auditLog.map((e, i) => {
                const cor = e.tipo === 'criacao' ? '#6366f1'
                  : e.tipo === 'reatribuicao' ? '#f59e0b'
                  : e.tipo === 'entrega_parcial' ? '#f97316'
                  : e.tipo === 'destino_alterado' ? '#3b82f6'
                  : e.para === 'concluida' ? '#10b981'
                  : e.para === 'cancelada' ? '#ef4444'
                  : '#94a3b8';
                const label = e.tipo === 'criacao' ? `Criada${e.atribuidoPara ? ` → ${e.atribuidoPara}` : ''}`
                  : e.tipo === 'reatribuicao' ? `Reatribuída: ${e.de} → ${e.para}`
                  : e.tipo === 'entrega_parcial' ? `Entrega parcial (+${e.qtd})`
                  : e.tipo === 'destino_alterado' ? `Destino → ${e.para}`
                  : e.tipo === 'status' ? `${e.de} → ${e.para}`
                  : e.tipo;
                return (
                  <div key={e.id ?? i} style={{ display: 'flex', gap: 10, marginBottom: 10,
                    alignItems: 'flex-start', paddingLeft: 20 }}>
                    <div style={{ position: 'absolute', left: 3, width: 10, height: 10,
                      borderRadius: '50%', background: cor, border: '2px solid #111827',
                      marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: cor }}>{label}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 1 }}>
                        {e.nome || '—'} · {fmtTs(e.ts)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Meta */}
        <div style={{ marginTop: 16, background: '#111827', borderRadius: 10, padding: 12 }}>
          <div style={{ ...S.lbl, marginBottom: 8 }}>DETALHES</div>
          {[
            ['Criado', fmtTs(tarefa.criadoEm)],
            ['Prazo', tarefa.due_at ? fmtTs(tarefa.due_at) : null],
            ['Iniciado', fmtTs(tarefa.iniciadoEm)],
            ['Concluído', fmtTs(tarefa.concluidoEm)],
            ['Duração', fmtDuration(tarefa.iniciadoEm, tarefa.concluidoEm)],
            ['Agente', tarefa.assigneeNome ?? '—'],
            ['Reatribuído em', (tarefa as any).reatribuidoEm ? fmtTs((tarefa as any).reatribuidoEm) : null],
            ['Gerado por', tarefa.geradoPorGoJet ? 'GoJet automático' : 'Manual'],
          ].map(([k, v]) => v && v !== '—' ? (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: 'rgba(255,255,255,.3)' }}>{k}</span>
              <span style={{ color: 'rgba(255,255,255,.65)' }}>{v}</span>
            </div>
          ) : null)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRIAR TAREFA
// ═══════════════════════════════════════════════════════════════════════════════

function CriarTarefa({ usuario, cidade, pais, agentes, parkingInicial, onCriada }: {
  usuario: Props['usuario']; cidade: string; pais: string;
  agentes: { uid: string; nome: string; email: string }[];
  parkingInicial?: Props['parkingInicial']; onCriada: () => void;
}) {
  // Modo de criação: 'gojet' = selecionar do snapshot | 'manual' = digitar livre
  const [modo, setModo]           = useState<'gojet' | 'manual'>(parkingInicial ? 'gojet' : 'gojet');
  const [kind, setKind]           = useState<TarefaKind>('PONTO');
  const [titulo, setTitulo]       = useState('');
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>(3);
  const [assigneeUid, setAssigneeUid] = useState('');
  const [targetCount, setTargetCount] = useState<number|''>('');
  const [parkSel, setParkSel]     = useState<Props['parkingInicial']>(parkingInicial ?? null);
  const [parkNome, setParkNome]   = useState('');
  const [parkLat, setParkLat]     = useState('');
  const [parkLng, setParkLng]     = useState('');
  const [bikeId, setBikeId]       = useState('');
  const [dueAt, setDueAt]         = useState(''); // datetime-local string
  const [prazoAuto, setPrazoAuto] = useState<Record<TarefaKind, number>>(
    {} as Record<TarefaKind, number>
  );
  const [busy, setBusy]           = useState(false);
  const [erro, setErro]           = useState('');

  // Carrega prazos automáticos por tipo da config_logistica
  useEffect(() => {
    getDoc(doc(db, 'config_logistica', cidade || 'global')).then((d: any) => {
      if (d.exists()) {
        const data = d.data();
        if (data.prazoHoras) setPrazoAuto(data.prazoHoras);
      }
    }).catch(() => {});
  }, [cidade]);

  // Auto-preenche prazo quando muda o tipo de tarefa
  useEffect(() => {
    const horas = prazoAuto[kind];
    if (horas && horas > 0) {
      const dt = new Date(Date.now() + horas * 3_600_000);
      // formato datetime-local: "YYYY-MM-DDTHH:mm"
      const pad = (n: number) => String(n).padStart(2, '0');
      setDueAt(
        `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}` +
        `T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
      );
    }
  }, [kind, prazoAuto]);

  // Quando parkingInicial muda (ex: clique num P do mapa), pré-seleciona
  useEffect(() => {
    if (parkingInicial) {
      setParkSel(parkingInicial);
      setModo('gojet');
    }
  }, [parkingInicial?.id]);  // Pontos GoJet do snapshot Firestore
  const [pontosGoJet, setPontosGoJet]   = useState<any[]>([]);
  const [buscaPonto,  setBuscaPonto]    = useState('');
  const [loadingPontos, setLoadingPontos] = useState(false);
  const [filtroCriticos, setFiltroCriticos] = useState(true); // só pontos abaixo do target

  // Carregar snapshot GoJet do Firestore
  useEffect(() => {
    setLoadingPontos(true);
    getDocs(collection(db, 'gojet_snapshots')).then(snap => {
      const latest = snap.docs.find(d => d.id === 'latest');
      if (latest) {
        const data = latest.data();
        setPontosGoJet(data.parkings ?? []);
      }
    }).catch(() => {}).finally(() => setLoadingPontos(false));
  }, []);

  // Auto-preenche target quando seleciona ponto
  useEffect(() => {
    if (parkSel) {
      const falta = parkSel.target != null && parkSel.disponivel != null
        ? Math.max(0, parkSel.target - parkSel.disponivel) : null;
      if (falta != null && falta > 0) setTargetCount(falta);
      const p = PRIO_AUTO(parkSel);
      setPrioridade(p);
    }
  }, [parkSel]);

  // Auto-título inteligente
  useEffect(() => {
    const nome = parkSel?.nome ?? parkNome;
    if (!nome) return;
    const falta = targetCount ? ` → levar ${targetCount} pat.` : '';
    const zerado = parkSel?.disponivel === 0 ? '🚨 ' : parkSel && parkSel.disponivel != null && parkSel.target != null && parkSel.disponivel < parkSel.target * 0.5 ? '⚠️ ' : '';
    setTitulo(`${zerado}${KIND[kind].label}: ${nome}${falta}`);
  }, [kind, parkSel, parkNome, targetCount]);

  const pontosFiltrados = pontosGoJet
    .filter(p => {
      if (filtroCriticos && p.target_bikes_count > 0) {
        const ratio = (p.availableCount ?? 0) / p.target_bikes_count;
        if (ratio >= 0.5) return false;
      }
      if (buscaPonto) return (p.name ?? '').toLowerCase().includes(buscaPonto.toLowerCase());
      return true;
    })
    .sort((a, b) => {
      // Zerados primeiro, depois por déficit
      const defA = Math.max(0, (a.target_bikes_count ?? 0) - (a.availableCount ?? 0));
      const defB = Math.max(0, (b.target_bikes_count ?? 0) - (b.availableCount ?? 0));
      return defB - defA;
    });

  const salvar = async () => {
    if (!titulo.trim()) { setErro('Título obrigatório'); return; }
    const lat = parkSel?.lat ?? (parkLat ? parseFloat(parkLat) : null);
    const lng = parkSel?.lng ?? (parkLng ? parseFloat(parkLng) : null);
    setBusy(true); setErro('');
    try {
      const ag = agentes.find(a => a.uid === assigneeUid);
      const novaRef = await addDoc(collection(db, 'tarefas_logistica'), {
        kind, titulo: titulo.trim(), descricao: descricao.trim() || null,
        status: 'pendente', prioridade, cidade, pais,
        criadoPor: usuario.uid, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
        assigneeUid: assigneeUid || null, assigneeNome: ag?.nome ?? null,
        parkingId:   parkSel?.id ?? null,
        parkingNome: (parkSel?.nome ?? parkNome) || null,
        parkingLat:  lat, parkingLng: lng,
        targetCount: targetCount !== '' ? Number(targetCount) : null,
        bikeIdentifier: bikeId || null,
        deliveredCount: 0, entregas: [],
        geradoPorGoJet: false, slotId: null,
        due_at: dueAt ? Timestamp.fromDate(new Date(dueAt)) : null,
      });
      // Audit: criação
      await addDoc(collection(db, 'tarefas_logistica', novaRef.id, 'audit_log'), {
        tipo: 'criacao', para: 'pendente',
        atribuidoPara: ag?.nome ?? null,
        ts: serverTimestamp(), uid: usuario.uid, nome: usuario.nome ?? usuario.email ?? '',
      });
      // FCM push notification para o agente atribuído
      if (assigneeUid) {
        try {
          const { getDoc: gd, doc: fd } = await import('firebase/firestore');
          const tokenSnap = await gd(fd(db, 'fcm_tokens', assigneeUid));
          if (tokenSnap.exists()) {
            const fcmToken = tokenSnap.data().token;
            // Chama Cloud Function para enviar FCM (token no servidor)
            const { httpsCallable, getFunctions } = await import('firebase/functions');
            const { getApp } = await import('firebase/app');
            const fns = getFunctions(getApp(), 'southamerica-east1');
            const fn  = httpsCallable(fns, 'notificarTarefaFn');
            await fn({ tarefaTitulo: titulo, assigneeUid, cidade, fcmToken }).catch(() => {});
          }
        } catch { /* best-effort */ }
      }
      // Telegram: notificar agente atribuído
      try {
        const { httpsCallable: hc2, getFunctions: gf2 } = await import('firebase/functions');
        const { getApp: ga2 } = await import('firebase/app');
        const fn2 = hc2(gf2(ga2(), 'southamerica-east1'), 'notificarTarefaAtribuida');
        await fn2({ assigneeUid, tarefaId: novaRef.id, titulo: titulo.trim(), kind, parkingNome: parkSel?.nome ?? parkNome ?? null, cidade }).catch(() => {});
      } catch { /* best-effort */ }

      onCriada();
    } catch (e: any) { setErro(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 14 }}>
      {erro && <Alert tipo="erro" msg={erro} />}

      {/* Modo de seleção de ponto */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button onClick={() => setModo('gojet')} style={{
          flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
          background: modo === 'gojet' ? '#3b82f6' : 'rgba(255,255,255,.06)',
          color: modo === 'gojet' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>🛴 Ponto GoJet</button>
        <button onClick={() => setModo('manual')} style={{
          flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
          background: modo === 'manual' ? '#f97316' : 'rgba(255,255,255,.06)',
          color: modo === 'manual' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>✏️ Manual</button>
      </div>

      {/* Tipo de tarefa */}
      <Field label="TIPO">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {(Object.keys(KIND) as TarefaKind[]).map(k => (
            <button key={k} onClick={() => setKind(k)} style={{
              padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: kind === k ? KIND[k].cor : 'rgba(255,255,255,.06)',
              color: kind === k ? '#fff' : 'rgba(255,255,255,.4)',
            }}>{KIND[k].icon} {KIND[k].label}</button>
          ))}
        </div>
      </Field>

      {/* Seleção GoJet */}
      {modo === 'gojet' && (
        <div style={{ marginBottom: 14 }}>
          {parkSel ? (
            // Ponto selecionado — exibe card resumo
            <div style={{ background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.4)',
              borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>
                    📍 {parkSel.nome}
                  </div>
                  {parkSel.disponivel != null && parkSel.target != null && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 3 }}>
                      {parkSel.disponivel}/{parkSel.target} disponíveis
                      {parkSel.disponivel === 0 && <span style={{ color: '#ef4444' }}> — ZERADO 🚨</span>}
                    </div>
                  )}
                </div>
                <button onClick={() => { setParkSel(null); setTargetCount(''); }}
                  style={{ background: 'rgba(255,255,255,.08)', border: 'none', color: '#fff',
                    borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}>
                  ✕ Trocar
                </button>
              </div>
            </div>
          ) : (
            // Lista para selecionar ponto
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={buscaPonto} onChange={e => setBuscaPonto(e.target.value)}
                  placeholder="🔍 Buscar ponto GoJet..."
                  style={{ ...S.inp, flex: 1 }} />
                <button onClick={() => setFiltroCriticos(v => !v)} style={{
                  padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600, flexShrink: 0,
                  background: filtroCriticos ? '#ef4444' : 'rgba(255,255,255,.06)',
                  color: filtroCriticos ? '#fff' : 'rgba(255,255,255,.4)',
                }}>
                  {filtroCriticos ? '🔴 Só críticos' : '📍 Todos'}
                </button>
              </div>

              {loadingPontos ? (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: 12 }}>
                  Carregando pontos...
                </div>
              ) : pontosGoJet.length === 0 ? (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: 12 }}>
                  Snapshot GoJet não disponível.<br/>Ative o overlay GoJet no mapa para atualizar.
                </div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 8, scrollbarWidth: 'thin' as const }}>
                  {pontosFiltrados.slice(0, 50).map((p: any) => {
                    const avail  = p.availableCount ?? 0;
                    const target = p.target_bikes_count ?? 0;
                    const falta  = Math.max(0, target - avail);
                    const zerado = avail === 0;
                    const cor    = zerado ? '#ef4444' : falta > 0 ? '#f97316' : '#10b981';
                    return (
                      <button key={p.id}
                        onClick={() => setParkSel({
                          id: p.id, nome: p.name,
                          lat: p.latitude, lng: p.longitude,
                          target, disponivel: avail,
                        })}
                        style={{ width: '100%', padding: '10px 12px', background: 'transparent',
                          border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                          textAlign: 'left' as const }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: cor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.monitor ? '⭐ ' : ''}{p.name}
                          </div>
                          {target > 0 && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
                              {avail}/{target} disp.
                              {falta > 0 && <span style={{ color: cor }}> · faltam {falta}</span>}
                            </div>
                          )}
                        </div>
                        {zerado && (
                          <span style={{ fontSize: 9, background: '#ef44441a', color: '#ef4444',
                            padding: '2px 5px', borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>
                            ZERADO
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {pontosFiltrados.length > 50 && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', padding: 8,
                      textAlign: 'center' }}>
                      +{pontosFiltrados.length - 50} pontos. Use a busca para filtrar.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual */}
      {modo === 'manual' && (
        <>
          <Field label="PONTO / ENDEREÇO">
            <input style={S.inp} value={parkNome} placeholder="Ex: Ibirapuera Portão 6"
              onChange={e => setParkNome(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Field label="LAT" style={{ flex: 1 }}>
              <input style={S.inp} value={parkLat} placeholder="-23.588"
                onChange={e => setParkLat(e.target.value)} />
            </Field>
            <Field label="LNG" style={{ flex: 1 }}>
              <input style={S.inp} value={parkLng} placeholder="-46.641"
                onChange={e => setParkLng(e.target.value)} />
            </Field>
          </div>
        </>
      )}

      {kind === 'PONTO' && (
        <Field label="PATINETES A LEVAR">
          <input style={S.inp} type="number" min="1" value={targetCount}
            placeholder={parkSel?.target != null ? `Déficit automático: ${Math.max(0,(parkSel.target)-(parkSel.disponivel??0))}` : 'Ex: 5'}
            onChange={e => setTargetCount(e.target.value ? Number(e.target.value) : '')} />
        </Field>
      )}

      {kind === 'PATINETE' && (
        <Field label="IDENTIFIER DA PATINETE">
          <input style={S.inp} value={bikeId} placeholder="S.315761"
            onChange={e => setBikeId(e.target.value)} />
        </Field>
      )}

      <Field label="TÍTULO">
        <input style={S.inp} value={titulo} placeholder="Título da tarefa"
          onChange={e => setTitulo(e.target.value)} />
      </Field>

      <Field label="DESCRIÇÃO (opcional)">
        <textarea style={{ ...S.inp, height: 56, resize: 'vertical' as const }}
          value={descricao} onChange={e => setDescricao(e.target.value)} />
      </Field>

      <Field label="PRIORIDADE">
        <div style={{ display: 'flex', gap: 6 }}>
          {([1,2,3,4,5] as TarefaPrioridade[]).map(p => (
            <button key={p} onClick={() => setPrioridade(p)} style={{
              flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none',
              cursor: 'pointer', fontSize: 10, fontWeight: 600,
              background: prioridade === p ? PRIO[p].cor : 'rgba(255,255,255,.06)',
              color: prioridade === p ? '#fff' : 'rgba(255,255,255,.4)',
            }}>{PRIO[p].label}</button>
          ))}
        </div>
      </Field>

      <Field label="ATRIBUIR A">
        <select style={{ ...S.inp, appearance: 'none' as const }}
          value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)}>
          <option value="">— Sem atribuição —</option>
          {agentes.map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
        </select>
      </Field>

      <Field label={`PRAZO${prazoAuto[kind] ? ` (auto: ${prazoAuto[kind]}h)` : ' (opcional)'}`}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="datetime-local" style={{ ...S.inp, flex: 1, colorScheme: 'dark' }}
            value={dueAt} onChange={e => setDueAt(e.target.value)} />
          {dueAt && (
            <button onClick={() => setDueAt('')}
              style={{ padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.4)', fontSize: 11 }}>
              ✕
            </button>
          )}
        </div>
      </Field>

      <button disabled={busy || (modo === 'gojet' && !parkSel && kind !== 'PATINETE')}
        onClick={salvar}
        style={{ ...S.btn(), width: '100%', padding: 12, marginTop: 8,
          opacity: busy || (modo === 'gojet' && !parkSel && kind !== 'PATINETE') ? 0.5 : 1 }}>
        {busy ? '⏳ Criando...' : '✅ Criar tarefa'}
      </button>
    </div>
  );
}

// Calcula prioridade automática baseada no status do ponto GoJet
function PRIO_AUTO(p: { disponivel?: number; target?: number }): TarefaPrioridade {
  if (p.disponivel === 0) return 5;
  if (p.target != null && p.disponivel != null) {
    const ratio = p.disponivel / p.target;
    if (ratio < 0.25) return 4;
    if (ratio < 0.5)  return 3;
  }
  return 2;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD DE PRODUTIVIDADE
// ═══════════════════════════════════════════════════════════════════════════════

function Dashboard({ tarefas, agentes }: {
  tarefas: TarefaLogistica[];
  agentes: { uid: string; nome: string; email: string }[];
}) {
  const [periodo, setPeriodo] = useState<'7d'|'30d'|'todos'>('7d');

  const corte = periodo === '7d'  ? Date.now() - 7*86400000
              : periodo === '30d' ? Date.now() - 30*86400000 : 0;

  const filtradas = tarefas.filter(t => {
    if (!corte) return true;
    const d = t.criadoEm?.toDate?.() ?? new Date(t.criadoEm ?? 0);
    return d.getTime() >= corte;
  });

  const concluidas = filtradas.filter(t => t.status === 'concluida');
  const total      = filtradas.length;
  const taxa       = total > 0 ? Math.round((concluidas.length/total)*100) : 0;

  // Durações médias
  const duracoes = concluidas
    .filter(t => t.iniciadoEm && t.concluidoEm)
    .map(t => (t.concluidoEm.toDate().getTime() - t.iniciadoEm.toDate().getTime()) / 60000);
  const mediaMin = duracoes.length > 0
    ? Math.round(duracoes.reduce((a,b)=>a+b,0)/duracoes.length) : 0;

  // Por agente
  const porAgente: Record<string, { nome: string; total: number; concluidas: number; minutos: number[] }> = {};
  filtradas.forEach(t => {
    const uid = t.assigneeUid ?? 'sem_atrib';
    if (!porAgente[uid]) {
      const ag = agentes.find(a => a.uid === uid);
      porAgente[uid] = { nome: t.assigneeNome ?? ag?.nome ?? '—', total: 0, concluidas: 0, minutos: [] };
    }
    porAgente[uid].total++;
    if (t.status === 'concluida') {
      porAgente[uid].concluidas++;
      if (t.iniciadoEm && t.concluidoEm) {
        porAgente[uid].minutos.push(
          (t.concluidoEm.toDate().getTime() - t.iniciadoEm.toDate().getTime()) / 60000
        );
      }
    }
  });

  // Pontos mais atendidos
  const pontos: Record<string, { nome: string; count: number }> = {};
  filtradas.filter(t => t.parkingNome).forEach(t => {
    const id = t.parkingId ?? t.parkingNome ?? '';
    if (!pontos[id]) pontos[id] = { nome: t.parkingNome!, count: 0 };
    pontos[id].count++;
  });
  const topPontos = Object.values(pontos).sort((a,b)=>b.count-a.count).slice(0,5);

  // Por tipo
  const porKind: Record<string, number> = {};
  filtradas.forEach(t => { porKind[t.kind] = (porKind[t.kind]??0)+1; });

  return (
    <div style={{ padding: 14 }}>
      {/* Período */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([['7d','7 dias'],['30d','30 dias'],['todos','Tudo']] as const).map(([k,l]) => (
          <button key={k} onClick={() => setPeriodo(k)} style={{
            flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 600,
            background: periodo === k ? '#3b82f6' : 'rgba(255,255,255,.06)',
            color: periodo === k ? '#fff' : 'rgba(255,255,255,.4)',
          }}>{l}</button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Total tarefas', val: total, cor: '#3b82f6' },
          { label: 'Concluídas', val: concluidas.length, cor: '#10b981' },
          { label: 'Taxa conclusão', val: `${taxa}%`, cor: taxa >= 80 ? '#10b981' : taxa >= 50 ? '#f97316' : '#ef4444' },
          { label: 'Duração média', val: mediaMin > 0 ? `${mediaMin}min` : '—', cor: '#f59e0b' },
        ].map(({ label, val, cor }) => (
          <div key={label} style={{ background: '#111827', borderRadius: 10, padding: 14,
            border: `1px solid ${cor}20` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: cor }}>{val}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Por tipo */}
      <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ ...S.lbl, marginBottom: 10 }}>POR TIPO</div>
        {(Object.keys(KIND) as TarefaKind[]).map(k => {
          const n = porKind[k] ?? 0; if (!n) return null;
          const pct = total > 0 ? Math.round(n/total*100) : 0;
          return (
            <div key={k} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3,
                fontSize: 11 }}>
                <span style={{ color: 'rgba(255,255,255,.55)' }}>{KIND[k].icon} {KIND[k].label}</span>
                <span style={{ color: KIND[k].cor, fontWeight: 600 }}>{n} ({pct}%)</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2 }}>
                <div style={{ height: 4, width: `${pct}%`, background: KIND[k].cor, borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Ranking agentes */}
      <div style={{ background: '#111827', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ ...S.lbl, marginBottom: 10 }}>RANKING AGENTES</div>
        {Object.entries(porAgente)
          .sort(([,a],[,b]) => b.concluidas - a.concluidas)
          .slice(0, 8)
          .map(([uid, d], i) => {
            const mediaA = d.minutos.length > 0
              ? Math.round(d.minutos.reduce((a,b)=>a+b,0)/d.minutos.length) : 0;
            return (
              <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: i===0?'#f59e0b':i===1?'#9ca3af':i===2?'#b45309':'rgba(255,255,255,.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {i+1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.nome}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
                    {mediaA > 0 ? `⏱ ${mediaA}min/tarefa` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{d.concluidas}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>/{d.total}</div>
                </div>
              </div>
            );
          })}
        {Object.keys(porAgente).length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>Sem dados</div>
        )}
      </div>

      {/* Top pontos */}
      {topPontos.length > 0 && (
        <div style={{ background: '#111827', borderRadius: 10, padding: 12 }}>
          <div style={{ ...S.lbl, marginBottom: 10 }}>TOP PONTOS</div>
          {topPontos.map((p,i) => (
            <div key={p.nome} style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', padding: '6px 0', fontSize: 12,
              borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <span style={{ color: 'rgba(255,255,255,.55)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {i+1}. 📍 {p.nome}
              </span>
              <span style={{ color: '#3b82f6', fontWeight: 700, flexShrink: 0 }}>{p.count}x</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTÓRICO + EXPORT CSV
// ═══════════════════════════════════════════════════════════════════════════════

function Historico({ tarefas, agentes }: {
  tarefas: TarefaLogistica[];
  agentes: { uid: string; nome: string; email: string }[];
}) {
  const [filtroStatus, setFiltroStatus] = useState<TarefaStatus|'todas'>('todas');
  const [filtroKind,   setFiltroKind]   = useState<TarefaKind|'todas'>('todas');
  const [filtroAgente, setFiltroAgente] = useState('');
  const [busca,        setBusca]        = useState('');
  const [pagina,       setPagina]       = useState(0);
  const PAGE = 50;

  const agentesMap = new Map(agentes.map(a => [a.uid, a.nome]));

  const filtradas = tarefas.filter(t => {
    if (filtroStatus !== 'todas' && t.status !== filtroStatus) return false;
    if (filtroKind   !== 'todas' && t.kind   !== filtroKind)   return false;
    if (filtroAgente && t.assigneeUid !== filtroAgente)        return false;
    if (busca && !t.titulo.toLowerCase().includes(busca.toLowerCase())
        && !(t.parkingNome ?? '').toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const totalPag = Math.max(1, Math.ceil(filtradas.length / PAGE));
  const pag = Math.min(pagina, totalPag-1);
  const slice = filtradas.slice(pag*PAGE, (pag+1)*PAGE);

  return (
    <div style={{ padding: 12 }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' as const }}>
        <input value={busca} onChange={e => { setBusca(e.target.value); setPagina(0); }}
          placeholder="🔍 Buscar..."
          style={{ ...S.inp, flex: 2, minWidth: 120 }} />
        <select style={{ ...S.inp, flex: 1, minWidth: 100, appearance: 'none' as const }}
          value={filtroStatus} onChange={e => { setFiltroStatus(e.target.value as any); setPagina(0); }}>
          <option value="todas">Todos status</option>
          {(Object.keys(STATUS) as TarefaStatus[]).map(s => (
            <option key={s} value={s}>{STATUS[s].label}</option>
          ))}
        </select>
        <select style={{ ...S.inp, flex: 1, minWidth: 100, appearance: 'none' as const }}
          value={filtroKind} onChange={e => { setFiltroKind(e.target.value as any); setPagina(0); }}>
          <option value="todas">Todos tipos</option>
          {(Object.keys(KIND) as TarefaKind[]).map(k => (
            <option key={k} value={k}>{KIND[k].icon} {KIND[k].label}</option>
          ))}
        </select>
        <select style={{ ...S.inp, flex: 1, minWidth: 120, appearance: 'none' as const }}
          value={filtroAgente} onChange={e => { setFiltroAgente(e.target.value); setPagina(0); }}>
          <option value="">Todos agentes</option>
          {agentes.map(a => <option key={a.uid} value={a.uid}>{a.nome}</option>)}
        </select>
      </div>

      {/* Stats + Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
        <span>{filtradas.length} tarefas · pág {pag+1}/{totalPag}</span>
        <button onClick={() => exportCSV(filtradas, agentesMap)}
          style={{ ...S.btn('#374151', true) }}>⬇ CSV</button>
      </div>

      {/* Lista */}
      {slice.map(t => {
        const k = KIND[t.kind]; const s = STATUS[t.status];
        return (
          <div key={t.id} style={{ background: '#111827', borderRadius: 8, padding: 10,
            marginBottom: 6, border: `1px solid ${k.cor}15` }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>{k.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.titulo}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
                  {fmtTs(t.criadoEm)}
                  {t.assigneeNome && ` · ${t.assigneeNome.split(' ')[0]}`}
                  {t.iniciadoEm && t.concluidoEm && ` · ${fmtDuration(t.iniciadoEm, t.concluidoEm)}`}
                </div>
              </div>
              <span style={{ fontSize: 9, background: `${s.cor}20`, color: s.cor,
                padding: '2px 5px', borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>
                {s.label}
              </span>
            </div>
          </div>
        );
      })}

      {filtradas.length === 0 && <Empty msg="Nenhuma tarefa encontrada" />}

      {/* Paginação */}
      {totalPag > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button disabled={pag === 0} onClick={() => setPagina(p => p-1)} style={S.ghost}>‹ Anterior</button>
          <button disabled={pag >= totalPag-1} onClick={() => setPagina(p => p+1)} style={S.ghost}>Próxima ›</button>
        </div>
      )}
    </div>
  );
}

// ─── Micro-componentes ────────────────────────────────────────────────────────

function Loading() {
  return <div style={{ padding: 20, color: 'rgba(255,255,255,.3)', textAlign: 'center', fontSize: 12 }}>
    Carregando...
  </div>;
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 20, color: 'rgba(255,255,255,.3)', textAlign: 'center', fontSize: 12 }}>
    {msg}
  </div>;
}

function Alert({ tipo, msg }: { tipo: 'ok'|'erro'; msg: string }) {
  const cor = tipo === 'ok' ? '#10b981' : '#ef4444';
  return <div style={{ background: `${cor}15`, border: `1px solid ${cor}40`,
    borderRadius: 8, padding: 10, fontSize: 12, color: cor, marginBottom: 10 }}>
    {tipo === 'ok' ? '✅' : '❌'} {msg}
  </div>;
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={S.lbl}>{label}</label>
      {children}
    </div>
  );
}
