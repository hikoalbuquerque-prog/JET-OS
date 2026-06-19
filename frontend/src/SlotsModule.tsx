// SlotsModule.tsx — JET OS V2 — Sistema de Slots Inteligente
// Scout: movimentação de patinetes | Charger: troca de baterias
// Slots Manual + Automático (config por zona, clima, horário)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { gpsBackground, capturarPosicaoUnica, TrackingStats } from './lib/gps-background';
import {
  collection, query, where, orderBy, getDocs, addDoc,
  updateDoc, doc, onSnapshot, serverTimestamp, Timestamp, getDoc,
} from 'firebase/firestore';
import { db, fnNotificarTarefa, fnGerarSlotsManual, fnScraperGoJetManual } from './lib/firebase';
import { uploadComRetry } from './lib/uploadUtils';
import type {
  Slot, Tarefa, Entrega, Ocorrencia, PatineteInfo,
  CargoTipo, SlotStatus, TarefaTipo, OcorrenciaTipo,
  TipoSlot, TipoGeracao, SlotPrioridade, ConfigZonaAuto, FaixaHorario,
} from './lib/slots-schema';
import { salvarConfigZona, buscarConfigZonas } from './lib/slots-schema';
import {
  slotsProviderSupabase, subscribeSlots,
  aceitarSlotSupa, checkInSlotSupa, checkOutSlotSupa, cancelarSlotSupa, reatribuirSlotSupa,
} from './lib/slots-supabase';

// ─── Geo helpers ─────────────────────────────────────────────────────────────

function distKmClient(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtDist(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// Hook: localização em tempo real do worker via gps_logistica
interface WorkerPos { lat: number; lng: number; idadeS: number; }

function useWorkerGPS(uid: string | null): WorkerPos | null {
  const [pos, setPos] = useState<WorkerPos | null>(null);
  useEffect(() => {
    if (!uid) return;
    const since = Timestamp.fromMillis(Date.now() - 30 * 60_000);
    const q = query(
      collection(db, 'gps_logistica'),
      where('uid', '==', uid),
      where('criadoEm', '>=', since),
      orderBy('criadoEm', 'desc'),
      // limit imported from firebase/firestore below — use getDocs with limit inline
    );
    // onSnapshot com limit(1) — não suportado direto, filtra no resultado
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs;
      if (docs.length === 0) return;
      const d = docs[0].data();
      const ts = d.criadoEm?.toDate?.() ?? new Date(d.criadoEm);
      setPos({ lat: d.lat, lng: d.lng, idadeS: Math.floor((Date.now() - ts.getTime()) / 1000) });
    });
    return unsub;
  }, [uid]);
  return pos;
}

// Hook: localização dos workers atribuídos a um slot
function useSlotsWorkersGPS(uids: string[]): Record<string, WorkerPos> {
  const [mapa, setMapa] = useState<Record<string, WorkerPos>>({});
  useEffect(() => {
    if (uids.length === 0) return;
    const since = Timestamp.fromMillis(Date.now() - 30 * 60_000);
    const unsubs = uids.map(uid => {
      const q = query(
        collection(db, 'gps_logistica'),
        where('uid', '==', uid),
        where('criadoEm', '>=', since),
        orderBy('criadoEm', 'desc'),
      );
      return onSnapshot(q, snap => {
        if (snap.empty) return;
        const d = snap.docs[0].data();
        const ts = d.criadoEm?.toDate?.() ?? new Date(d.criadoEm);
        setMapa(prev => ({ ...prev, [uid]: { lat: d.lat, lng: d.lng, idadeS: Math.floor((Date.now() - ts.getTime()) / 1000) } }));
      });
    });
    return () => unsubs.forEach(u => u());
  }, [uids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return mapa;
}

function idadeLabel(s: number): { txt: string; cor: string } {
  if (s < 90)  return { txt: `${s}s atrás`,          cor: '#22c55e' };
  if (s < 300) return { txt: `${Math.floor(s/60)}min`, cor: '#f59e0b' };
  return { txt: `${Math.floor(s/60)}min`,              cor: '#ef4444' };
}

function flyToMapa(lat: number, lng: number, zoom = 17) {
  window.dispatchEvent(new CustomEvent('jetFlyTo', { detail: { lat, lng, zoom } }));
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPO_SLOT_META: Record<TipoSlot, { l: string; icone: string; cor: string; desc: string }> = {
  scout:   { l: 'Scout',   icone: '🛴', cor: '#06b6d4', desc: 'Movimentação de patinetes' },
  charger: { l: 'Charger', icone: '⚡', cor: '#10b981', desc: 'Troca de baterias' },
};

const PRIORIDADE_META: Record<SlotPrioridade, { l: string; cor: string }> = {
  normal:  { l: 'Normal',  cor: '#6b7280' },
  alta:    { l: 'Alta',    cor: '#f59e0b' },
  urgente: { l: 'Urgente', cor: '#ef4444' },
};

const STATUS_SLOT_COR: Record<SlotStatus, string> = {
  aberto:       '#fbbf24',
  aceito:       '#06b6d4',
  a_caminho:    '#a78bfa',
  em_andamento: '#10b981',
  concluido:    '#6b7280',
  cancelado:    '#ef4444',
};

const STATUS_SLOT_L: Record<SlotStatus, string> = {
  aberto:       'Aberto',
  aceito:       'Aceito',
  a_caminho:    'A caminho',
  em_andamento: 'Em andamento',
  concluido:    'Concluído',
  cancelado:    'Cancelado',
};

const MOTIVOS_CANCELAMENTO = [
  'Patinete com defeito',
  'Patinete não encontrada',
  'Ponto inacessível',
  'Problema de segurança',
  'Encerramento de turno',
  'Outro',
];

const OCORRENCIAS_TIPOS: { k: OcorrenciaTipo; l: string }[] = [
  { k: 'roubo',               l: 'Roubo de patinete' },
  { k: 'vandalismo',          l: 'Vandalismo' },
  { k: 'patinete_danificado', l: 'Patinete danificado' },
  { k: 'ponto_bloqueado',     l: 'Ponto bloqueado' },
  { k: 'usuario_infrator',    l: 'Usuário infrator' },
  { k: 'outro',               l: 'Outro' },
];

// ─── Estilos ──────────────────────────────────────────────────────────────────

const isMobile = window.innerWidth <= 500;
const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: isMobile ? 0 : 16,
  },
  modal: {
    background: '#0d1521', borderRadius: isMobile ? 0 : 16,
    width: '100%', maxWidth: isMobile ? '100vw' : 1000,
    maxHeight: isMobile ? '100vh' : '92vh',
    display: 'flex', flexDirection: 'column' as const,
    border: '1px solid rgba(16,185,129,.18)',
    boxShadow: '0 12px 40px rgba(0,0,0,.6)',
  },
  header: {
    padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'rgba(16,185,129,.08)', flexShrink: 0,
  },
  tabBar: {
    display: 'flex', gap: 4, padding: '8px 14px',
    borderBottom: '1px solid rgba(255,255,255,.06)',
    overflowX: 'auto' as const, scrollbarWidth: 'none' as any, flexShrink: 0,
  },
  body: { flex: 1, overflowY: 'auto' as const, padding: 16 },
  card: {
    background: 'rgba(255,255,255,.03)',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 10, padding: '12px 14px', marginBottom: 8,
  },
  inp: {
    width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 13, outline: 'none',
  },
  lbl: {
    display: 'block' as const, color: 'rgba(255,255,255,.4)',
    fontSize: 10, fontWeight: 600 as const, marginBottom: 5, textTransform: 'uppercase' as const,
  },
  btn: (cor: string) => ({
    padding: '8px 14px', borderRadius: 7, border: 'none',
    background: cor, color: '#fff', fontWeight: 600 as const,
    fontSize: 12, cursor: 'pointer' as const,
  }),
  btnGhost: {
    padding: '8px 14px', borderRadius: 7,
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)',
    color: 'rgba(255,255,255,.45)', fontWeight: 600 as const,
    fontSize: 12, cursor: 'pointer' as const,
  },
  badge: (cor: string) => ({
    display: 'inline-block' as const,
    padding: '3px 9px', borderRadius: 20,
    background: cor + '22', color: cor,
    fontSize: 10, fontWeight: 700 as const,
  }),
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  sep: { borderTop: '1px solid rgba(255,255,255,.06)', margin: '16px 0' },
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

function fmtDt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtTs(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function uploadFoto(file: File, path: string): Promise<string> {
  return uploadComRetry(file, path);
}

// ─── ProgressBar de entregas ──────────────────────────────────────────────────

function ProgressoEntregas({ concluida, alvo, cor }: { concluida: number; alvo: number; cor: string }) {
  const pct = alvo > 0 ? Math.min(100, (concluida / alvo) * 100) : 0;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>
        <span>Progresso</span>
        <span style={{ color: cor, fontWeight: 700 }}>{concluida}/{alvo}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: cor, borderRadius: 4, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

// ─── Modal Cancelamento ───────────────────────────────────────────────────────

function ModalCancelamento({ onConfirmar, onCancelar }: {
  onConfirmar: (motivo: string, notas: string, foto: File | null) => void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState(MOTIVOS_CANCELAMENTO[0]);
  const [notas, setNotas] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);
  const precisaFoto = motivo === 'Patinete com defeito' || motivo === 'Patinete não encontrada';

  const handleFoto = (f: File) => {
    setFoto(f);
    const r = new FileReader();
    r.onload = e => setPreview(e.target?.result as string || '');
    r.readAsDataURL(f);
  };

  const ok = !precisaFoto || foto !== null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: '#0d1521', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440, border: '1px solid rgba(239,68,68,.25)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#ef4444', marginBottom: 16 }}>Cancelar tarefa</div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>Motivo</label>
          <select value={motivo} onChange={e => setMotivo(e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
            {MOTIVOS_CANCELAMENTO.map(m => <option key={m} value={m} style={{ background: '#0d1521' }}>{m}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.lbl}>Observações (opcional)</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
            style={{ ...S.inp, resize: 'none' }} placeholder="Detalhes adicionais..." />
        </div>

        {precisaFoto && (
          <div style={{ marginBottom: 12, padding: 10, background: 'rgba(239,68,68,.07)', borderRadius: 8, border: '1px solid rgba(239,68,68,.2)' }}>
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 8 }}>
              📷 Foto obrigatória para este motivo
            </div>
            {preview ? (
              <div style={{ position: 'relative' }}>
                <img src={preview} alt="preview" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 7 }} />
                <button onClick={() => { setFoto(null); setPreview(''); }} style={{
                  position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,.7)',
                  border: 'none', borderRadius: '50%', color: '#fff', width: 22, height: 22, cursor: 'pointer', fontSize: 11,
                }}>✕</button>
              </div>
            ) : (
              <button onClick={() => fotoRef.current?.click()} style={{ ...S.btnGhost, width: '100%', textAlign: 'center' }}>
                📷 Tirar foto
              </button>
            )}
            <input ref={fotoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFoto(f); }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.btn('#ef4444'), flex: 1, opacity: ok ? 1 : 0.5 }}
            onClick={() => ok && onConfirmar(motivo, notas, foto)} disabled={!ok}>
            Confirmar cancelamento
          </button>
          <button style={S.btnGhost} onClick={onCancelar}>Voltar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Registrar Entrega ──────────────────────────────────────────────────

function ModalEntrega({ tipoSlot, onConfirmar, onCancelar }: {
  tipoSlot: TipoSlot;
  onConfirmar: (qtd: 1 | 2, foto: File, obs: string) => void;
  onCancelar: () => void;
}) {
  const [qtd, setQtd] = useState<1 | 2>(1);
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [obs, setObs] = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  const handleFoto = (f: File) => {
    setFoto(f);
    const r = new FileReader();
    r.onload = e => setPreview(e.target?.result as string || '');
    r.readAsDataURL(f);
  };

  const titulo = tipoSlot === 'scout' ? 'Registrar entrega de patinetes' : 'Registrar troca de bateria';
  const labelQtd = tipoSlot === 'scout' ? 'Quantas patinetes entregou nessa viagem?' : 'Quantas baterias trocou agora?';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: '#0d1521', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440, border: '1px solid rgba(16,185,129,.25)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981', marginBottom: 16 }}>{titulo}</div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.lbl}>{labelQtd}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {([1, 2] as const).map(n => (
              <button key={n} onClick={() => setQtd(n)} style={{
                padding: '12px', borderRadius: 9, border: `2px solid ${qtd === n ? '#10b981' : 'rgba(255,255,255,.1)'}`,
                background: qtd === n ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.03)',
                color: qtd === n ? '#10b981' : 'rgba(255,255,255,.5)',
                fontSize: 18, fontWeight: 800, cursor: 'pointer',
              }}>{n}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={S.lbl}>Foto de comprovação (obrigatória)</label>
          {preview ? (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <img src={preview} alt="preview" style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 8 }} />
              <button onClick={() => { setFoto(null); setPreview(''); }} style={{
                position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.7)',
                border: 'none', borderRadius: '50%', color: '#fff', width: 24, height: 24, cursor: 'pointer', fontSize: 12,
              }}>✕</button>
            </div>
          ) : (
            <button onClick={() => fotoRef.current?.click()} style={{
              width: '100%', padding: '14px', borderRadius: 8, border: '2px dashed rgba(16,185,129,.3)',
              background: 'rgba(16,185,129,.05)', color: '#10b981', fontSize: 13, cursor: 'pointer',
            }}>📷 Tirar foto</button>
          )}
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFoto(f); }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.lbl}>Observação (opcional)</label>
          <input style={S.inp} value={obs} onChange={e => setObs(e.target.value)} placeholder="Alguma observação?" />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.btn('#10b981'), flex: 1, opacity: foto ? 1 : 0.5 }}
            onClick={() => foto && onConfirmar(qtd, foto, obs)} disabled={!foto}>
            ✓ Confirmar entrega
          </button>
          <button style={S.btnGhost} onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── TarefaDetalheView ────────────────────────────────────────────────────────

function TarefaDetalheView({ tarefa, slotTipoSlot, workerUid, onVoltar, onAtualizar }: {
  tarefa: Tarefa;
  slotTipoSlot?: TipoSlot | null;
  workerUid?: string;
  onVoltar: () => void;
  onAtualizar: (status: string, extra?: any) => Promise<void>;
}) {
  const tipoSlot: TipoSlot = (tarefa.tipoSlot ?? slotTipoSlot ?? 'scout') as TipoSlot;
  const meta = TIPO_SLOT_META[tipoSlot];
  const qtdAlvo = tarefa.qtdAlvo ?? tarefa.quantidade ?? 1;
  const qtdConcluida = tarefa.qtdConcluida ?? 0;

  const [busy, setBusy] = useState(false);
  const [showEntrega, setShowEntrega] = useState(false);
  const [showCancelar, setShowCancelar] = useState(false);
  const [fotoChegadaFile, setFotoChegadaFile] = useState<File | null>(null);
  const [fotoChegadaPreview, setFotoChegadaPreview] = useState('');
  const fotoChegadaRef = useRef<HTMLInputElement>(null);

  // GPS do worker em tempo real
  const workerGPS = useWorkerGPS(workerUid ?? null);
  const distancia = workerGPS && tarefa.estacao?.lat
    ? distKmClient(workerGPS.lat, workerGPS.lng, tarefa.estacao.lat, tarefa.estacao.lng)
    : null;

  const gmaps = tarefa.estacao?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${tarefa.estacao.lat},${tarefa.estacao.lng}`
    : null;
  const waze = tarefa.estacao?.lat
    ? `https://waze.com/ul?ll=${tarefa.estacao.lat},${tarefa.estacao.lng}&navigate=yes`
    : null;

  const handleFotoChegada = (f: File) => {
    setFotoChegadaFile(f);
    const r = new FileReader();
    r.onload = e => setFotoChegadaPreview(e.target?.result as string || '');
    r.readAsDataURL(f);
  };

  const marcarACaminho = async () => {
    setBusy(true);
    try { await onAtualizar(tarefa.status === 'pendente' ? 'em_andamento' : tarefa.status, { aCaminhoEm: Timestamp.now() }); }
    finally { setBusy(false); }
  };

  const iniciar = async () => {
    setBusy(true);
    try { await onAtualizar('em_andamento', { iniciadoEm: Timestamp.now() }); }
    finally { setBusy(false); }
  };

  const registrarChegada = async () => {
    if (!fotoChegadaFile) return;
    setBusy(true);
    try {
      const url = await uploadFoto(fotoChegadaFile, `tarefas/${tarefa.id}_chegada_${Date.now()}.jpg`);
      await onAtualizar(tarefa.status, { fotoChegadaUrl: url, chegadaEm: Timestamp.now() });
      setFotoChegadaFile(null);
      setFotoChegadaPreview('');
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const registrarEntrega = async (qtd: 1 | 2, foto: File, obs: string) => {
    setBusy(true);
    setShowEntrega(false);
    try {
      const pos = await capturarPosicaoUnica().catch(() => null);
      const url = await uploadFoto(foto, `tarefas/${tarefa.id}_entrega_${Date.now()}.jpg`);
      const novaEntrega: Entrega = {
        id: Date.now().toString(),
        qtd, fotoUrl: url, obs: obs || null,
        lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null,
        registradoEm: Timestamp.now(),
      };
      const entregasAtuais: Entrega[] = tarefa.entregas ?? [];
      const novasEntregas = [...entregasAtuais, novaEntrega];
      const novaQtdConcluida = qtdConcluida + qtd;
      const concluida = novaQtdConcluida >= qtdAlvo;
      await onAtualizar(
        concluida ? 'concluida' : 'em_andamento',
        {
          entregas: novasEntregas,
          qtdConcluida: novaQtdConcluida,
          ...(concluida ? { concluidoEm: Timestamp.now(), fotoUrl: url } : {}),
        }
      );
    } catch (e: any) { alert('Erro ao registrar entrega: ' + e.message); }
    finally { setBusy(false); }
  };

  const cancelarTarefa = async (motivo: string, notas: string, foto: File | null) => {
    setBusy(true);
    setShowCancelar(false);
    try {
      let fotoUrl: string | null = null;
      if (foto) fotoUrl = await uploadFoto(foto, `tarefas/${tarefa.id}_cancel_${Date.now()}.jpg`);
      await onAtualizar('cancelada', {
        motivoCancelamento: motivo,
        notasCancelamento: notas || null,
        fotoCancelamentoUrl: fotoUrl,
        canceladoEm: Timestamp.now(),
      });
    } catch (e: any) { alert('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const priorCor = (p: number) =>
    p >= 5 ? '#ef4444' : p >= 4 ? '#f59e0b' : p >= 3 ? '#3b82f6' : '#6b7280';

  const concluida = tarefa.status === 'concluida';
  const cancelada = tarefa.status === 'cancelada';
  const emAndamento = tarefa.status === 'em_andamento';
  const pendente = tarefa.status === 'pendente';

  return (
    <div>
      {showEntrega && (
        <ModalEntrega
          tipoSlot={tipoSlot}
          onConfirmar={registrarEntrega}
          onCancelar={() => setShowEntrega(false)}
        />
      )}
      {showCancelar && (
        <ModalCancelamento
          onConfirmar={cancelarTarefa}
          onCancelar={() => setShowCancelar(false)}
        />
      )}

      <button onClick={onVoltar} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
        fontSize: 12, cursor: 'pointer', marginBottom: 14, padding: 0,
      }}>‹ Voltar</button>

      {/* Header tarefa */}
      <div style={{
        background: `${priorCor(tarefa.prioridade ?? 3)}10`,
        border: `1px solid ${priorCor(tarefa.prioridade ?? 3)}30`,
        borderRadius: 10, padding: '12px 14px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span style={S.badge(meta.cor)}>{meta.icone} {meta.l}</span>
          <span style={S.badge(priorCor(tarefa.prioridade ?? 3))}>P{tarefa.prioridade}</span>
          {concluida && <span style={S.badge('#10b981')}>✓ Concluída</span>}
          {cancelada && <span style={S.badge('#ef4444')}>✕ Cancelada</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#dce8ff', marginBottom: 4 }}>{tarefa.titulo}</div>
        {tarefa.descricao && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>{tarefa.descricao}</div>}
        {qtdAlvo > 0 && (
          <ProgressoEntregas concluida={qtdConcluida} alvo={qtdAlvo} cor={meta.cor} />
        )}
      </div>

      {/* ── Painel mapa / distância ─────────────────────────────────── */}
      {tarefa.estacao?.lat && (
        <div style={{ marginBottom: 12, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)' }}>
          {/* Preview do mapa via OSM static */}
          <div style={{ position: 'relative', height: 130, background: '#0d1521', overflow: 'hidden', cursor: 'pointer' }}
            onClick={() => flyToMapa(tarefa.estacao!.lat, tarefa.estacao!.lng)}>
            <img
              src={`https://staticmap.openstreetmap.de/staticmap.php?center=${tarefa.estacao.lat},${tarefa.estacao.lng}&zoom=15&size=400x130&markers=${tarefa.estacao.lat},${tarefa.estacao.lng},red`}
              alt="mapa"
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {/* Overlay com destino */}
            <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ background: 'rgba(0,0,0,.75)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', gap: 5 }}>
                📍 <span style={{ fontWeight: 700 }}>{tarefa.estacao.nome}</span>
              </div>
              {distancia != null && (
                <div style={{ background: 'rgba(0,0,0,.75)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: workerGPS ? (workerGPS.idadeS < 90 ? '#22c55e' : '#f59e0b') : '#6b7280' }}>
                  {distancia < 0.1 ? '✓ No local' : `📏 ${fmtDist(distancia)}`}
                </div>
              )}
            </div>
            {/* Botão de toque — "ver no mapa JET" */}
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(13,18,30,.85)', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>
              🗺 Abrir no mapa
            </div>
          </div>

          {/* Barra de status */}
          <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.03)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
            {/* Posição do worker */}
            {workerGPS ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: idadeLabel(workerGPS.idadeS).cor, flexShrink: 0 }} />
                <span style={{ color: idadeLabel(workerGPS.idadeS).cor }}>GPS: {idadeLabel(workerGPS.idadeS).txt}</span>
                {distancia != null && <span style={{ color: 'rgba(255,255,255,.4)' }}>· {fmtDist(distancia)} do destino</span>}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)' }}>⚙ GPS aguardando...</div>
            )}
            <div style={{ flex: 1 }} />
            {/* Botões de navegação */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => flyToMapa(tarefa.estacao!.lat, tarefa.estacao!.lng)} style={{
                padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(167,139,250,.15)', border: '1px solid rgba(167,139,250,.3)', color: '#a78bfa',
              }}>🗺 JET</button>
              {gmaps && <a href={gmaps} target="_blank" rel="noreferrer" style={{ padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.25)', color: '#60a5fa', textDecoration: 'none' }}>GMaps</a>}
              {waze && <a href={waze} target="_blank" rel="noreferrer" style={{ padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.2)', color: '#4ade80', textDecoration: 'none' }}>Waze</a>}
            </div>
          </div>
        </div>
      )}

      {/* Patinetes sugeridas (charger) */}
      {tipoSlot === 'charger' && tarefa.patineteSugeridas && tarefa.patineteSugeridas.length > 0 && (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            ⚡ Patinetes com bateria baixa
          </div>
          {tarefa.patineteSugeridas.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < tarefa.patineteSugeridas!.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', fontSize: 12 }}>
              <span style={{ color: '#dce8ff', fontWeight: 600 }}>{p.identifier}</span>
              {p.bateria != null && (
                <span style={{ color: p.bateria < 10 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                  🔋 {p.bateria}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Localização */}
      {tarefa.estacao && (
        <div style={{ ...S.card, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            📍 Localização destino
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#dce8ff', marginBottom: 2 }}>{tarefa.estacao.nome}</div>
          {tarefa.estacao.endereco && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 10 }}>{tarefa.estacao.endereco}</div>
          )}
          {(gmaps || waze) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {gmaps && (
                <a href={gmaps} target="_blank" rel="noreferrer" style={{
                  padding: '9px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(48,127,226,.15)', border: '1px solid rgba(48,127,226,.3)',
                  color: '#60a5fa', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}>🗺 Google Maps</a>
              )}
              {waze && (
                <a href={waze} target="_blank" rel="noreferrer" style={{
                  padding: '9px', borderRadius: 8, textAlign: 'center',
                  background: 'rgba(100,200,100,.1)', border: '1px solid rgba(100,200,100,.2)',
                  color: '#4ade80', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                }}>🚗 Waze</a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Origem (scout) */}
      {tipoSlot === 'scout' && tarefa.estacaoOrigem && (
        <div style={{ ...S.card, marginBottom: 12, border: '1px solid rgba(6,182,212,.15)', background: 'rgba(6,182,212,.04)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(6,182,212,.6)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            🛴 Ponto origem (coletar patinetes)
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff' }}>{tarefa.estacaoOrigem.nome}</div>
          {tarefa.estacaoOrigem.endereco && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{tarefa.estacaoOrigem.endereco}</div>}
        </div>
      )}

      {/* Ações */}
      {!concluida && !cancelada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* A caminho */}
          {(pendente || (emAndamento && !tarefa.aCaminhoEm)) && (
            <button onClick={marcarACaminho} disabled={busy} style={{
              ...S.btn('#a78bfa'), width: '100%', padding: '11px', fontSize: 13,
            }}>
              🚀 {tarefa.aCaminhoEm ? 'A caminho registrado' : 'Marcar "A caminho"'}
            </button>
          )}

          {/* Iniciar */}
          {pendente && (
            <button onClick={iniciar} disabled={busy} style={{ ...S.btn('#3b82f6'), width: '100%', padding: '11px', fontSize: 13 }}>
              {busy ? '⏳...' : '▶ Iniciar tarefa'}
            </button>
          )}

          {/* Foto de chegada */}
          {emAndamento && !tarefa.fotoChegadaUrl && tipoSlot === 'scout' && (
            <div style={{ ...S.card }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
                📷 Foto de chegada ao ponto (opcional)
              </div>
              {fotoChegadaPreview ? (
                <div>
                  <img src={fotoChegadaPreview} alt="chegada" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 7, marginBottom: 8 }} />
                  <button onClick={registrarChegada} disabled={busy} style={{ ...S.btn('#06b6d4'), width: '100%', fontSize: 12 }}>
                    {busy ? '⏳...' : '✓ Registrar chegada'}
                  </button>
                </div>
              ) : (
                <button onClick={() => fotoChegadaRef.current?.click()} style={{ ...S.btnGhost, width: '100%' }}>
                  📷 Tirar foto de chegada
                </button>
              )}
              <input ref={fotoChegadaRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFotoChegada(f); }} />
            </div>
          )}

          {/* Registrar entrega */}
          {emAndamento && qtdConcluida < qtdAlvo && (
            <button onClick={() => setShowEntrega(true)} disabled={busy} style={{
              ...S.btn(meta.cor), width: '100%', padding: '13px', fontSize: 14,
            }}>
              {tipoSlot === 'scout' ? `🛴 Registrar entrega (${qtdConcluida}/${qtdAlvo})` : `⚡ Registrar troca (${qtdConcluida}/${qtdAlvo})`}
            </button>
          )}

          {/* Cancelar */}
          {(pendente || emAndamento) && (
            <button onClick={() => setShowCancelar(true)} style={{
              ...S.btnGhost, width: '100%', color: '#ef4444',
              border: '1px solid rgba(239,68,68,.2)',
            }}>
              Cancelar tarefa
            </button>
          )}
        </div>
      )}

      {/* Concluída */}
      {concluida && (
        <div style={{ textAlign: 'center', padding: 20, background: 'rgba(16,185,129,.08)', borderRadius: 10, border: '1px solid rgba(16,185,129,.2)' }}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>Tarefa concluída!</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
            {qtdConcluida} {tipoSlot === 'scout' ? 'patinete(s) entregue(s)' : 'bateria(s) trocada(s)'}
          </div>
        </div>
      )}

      {/* Cancelada */}
      {cancelada && (
        <div style={{ padding: 14, background: 'rgba(239,68,68,.07)', borderRadius: 10, border: '1px solid rgba(239,68,68,.2)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>Tarefa cancelada</div>
          {tarefa.motivoCancelamento && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>Motivo: {tarefa.motivoCancelamento}</div>}
          {tarefa.notasCancelamento && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>{tarefa.notasCancelamento}</div>}
        </div>
      )}

      {/* Histórico entregas */}
      {tarefa.entregas && tarefa.entregas.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Histórico de entregas
          </div>
          {tarefa.entregas.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < tarefa.entregas!.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
              {e.fotoUrl && <img src={e.fotoUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
              <div style={{ flex: 1, fontSize: 11 }}>
                <div style={{ color: '#dce8ff', fontWeight: 600 }}>+{e.qtd} {tipoSlot === 'scout' ? 'patinete(s)' : 'bateria(s)'}</div>
                <div style={{ color: 'rgba(255,255,255,.3)' }}>{fmtTs(e.registradoEm)}</div>
                {e.obs && <div style={{ color: 'rgba(255,255,255,.35)' }}>{e.obs}</div>}
              </div>
              <span style={S.badge('#10b981')}>✓</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TarefasCampoView ─────────────────────────────────────────────────────────

function TarefasCampoView({ tarefas, loading, slotAtivo, workerUid, onTarefa }: {
  tarefas: Tarefa[];
  loading: boolean;
  slotAtivo: Slot | null;
  workerUid?: string;
  onTarefa: (t: Tarefa) => void;
}) {
  const tipoSlot: TipoSlot = (slotAtivo?.tipoSlot ?? 'scout') as TipoSlot;
  const workerGPS = useWorkerGPS(workerUid ?? null);
  const meta = TIPO_SLOT_META[tipoSlot];

  // Resumo do turno
  const concluidas = tarefas.filter(t => t.status === 'concluida');
  const ativas     = tarefas.filter(t => t.status === 'em_andamento');
  const pendentes  = tarefas.filter(t => t.status === 'pendente');
  const totalEntregues = tarefas.reduce((s, t) => s + (t.qtdConcluida ?? 0), 0);
  const totalAlvo      = tarefas.reduce((s, t) => s + (t.qtdAlvo ?? t.quantidade ?? 0), 0);

  const sorted = [...tarefas].sort((a, b) => {
    const ord = { em_andamento: 0, pendente: 1, concluida: 2, cancelada: 3 };
    const so = (ord[a.status as keyof typeof ord] ?? 9) - (ord[b.status as keyof typeof ord] ?? 9);
    if (so !== 0) return so;
    return (b.prioridade ?? 0) - (a.prioridade ?? 0);
  });

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.4)', fontSize: 13 }}>⏳ Carregando...</div>;

  return (
    <div>
      {/* Resumo do turno */}
      {slotAtivo && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: `${meta.cor}10`, border: `1px solid ${meta.cor}25`, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: meta.cor, fontWeight: 700, marginBottom: 6 }}>
            {meta.icone} Slot ativo — {slotAtivo.titulo}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            {[
              { l: 'Pendentes', n: pendentes.length, cor: '#f59e0b' },
              { l: 'Ativos',    n: ativas.length,    cor: '#3b82f6' },
              { l: 'Concluídas',n: concluidas.length, cor: '#10b981' },
              { l: totalAlvo > 0 ? `${totalEntregues}/${totalAlvo}` : '—', n: null, cor: meta.cor, sub: tipoSlot === 'scout' ? 'Patinetes' : 'Baterias' },
            ].map((s, i) => (
              <div key={i} style={{ background: `${s.cor}12`, border: `1px solid ${s.cor}25`, borderRadius: 7, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: s.n != null ? 18 : 13, fontWeight: 800, color: s.cor }}>{s.n != null ? s.n : s.l}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', marginTop: 1 }}>{s.n != null ? s.l : (s.sub ?? '')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tarefas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginBottom: 4 }}>Sem tarefas pendentes!</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.3)' }}>Aguarde novas tarefas ou verifique seu slot.</div>
        </div>
      )}

      {sorted.map((t, i) => {
        const priorCor = (p: number) => p >= 5 ? '#ef4444' : p >= 4 ? '#f59e0b' : p >= 3 ? '#3b82f6' : '#6b7280';
        const ativa = t.status === 'em_andamento';
        const concl = t.status === 'concluida';
        const qtdAlvo = t.qtdAlvo ?? t.quantidade ?? 0;
        const qtdConc = t.qtdConcluida ?? 0;
        return (
          <div key={t.id} onClick={() => onTarefa(t)} style={{
            background: ativa ? 'rgba(59,130,246,.08)' : concl ? 'rgba(16,185,129,.05)' : 'rgba(255,255,255,.03)',
            border: `1px solid ${ativa ? 'rgba(59,130,246,.25)' : concl ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.06)'}`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 8,
            cursor: 'pointer', opacity: concl ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: priorCor(t.prioridade ?? 3) + '20',
              border: `2px solid ${priorCor(t.prioridade ?? 3)}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: priorCor(t.prioridade ?? 3), flexShrink: 0,
            }}>{concl ? '✓' : i + 1}</div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: concl ? '#10b981' : '#dce8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.titulo}
              </div>
              {t.estacao && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {t.estacao.nome}</span>
                  {workerGPS && t.estacao.lat && (() => {
                    const d = distKmClient(workerGPS.lat, workerGPS.lng, t.estacao!.lat, t.estacao!.lng);
                    const cor = workerGPS.idadeS < 90 ? '#22c55e' : '#f59e0b';
                    return (
                      <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, color: cor, padding: '1px 5px', borderRadius: 4, background: cor + '18', border: `1px solid ${cor}30` }}>
                        {fmtDist(d)}
                      </span>
                    );
                  })()}
                </div>
              )}
              {qtdAlvo > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (qtdConc / qtdAlvo) * 100)}%`, background: meta.cor, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>{qtdConc}/{qtdAlvo}</div>
                </div>
              )}
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
              background: ativa ? 'rgba(59,130,246,.2)' : concl ? 'rgba(16,185,129,.2)' : 'rgba(245,158,11,.1)',
              color: ativa ? '#60a5fa' : concl ? '#10b981' : '#f59e0b',
            }}>
              {ativa ? '▶ Ativo' : concl ? '✓ Feito' : 'Pendente'}
            </div>
            <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 16 }}>›</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── FormCriarSlot ────────────────────────────────────────────────────────────

function FormCriarSlot({ cidade, pais, adminUid, zonas, workers, onSalvo, onCancelar }: {
  cidade: string; pais: string; adminUid: string;
  zonas: string[]; workers: any[];
  onSalvo: () => void; onCancelar: () => void;
}) {
  const [tipoSlot, setTipoSlot] = useState<TipoSlot>('scout');
  const [zona, setZona] = useState('');
  const [prioridade, setPrioridade] = useState<SlotPrioridade>('normal');
  const [turnoInicio, setTurnoInicio] = useState('');
  const [turnoFim, setTurnoFim] = useState('');
  const [descricao, setDescricao] = useState('');
  const [workerUid, setWorkerUid] = useState('');
  const [slaMin, setSlaMin] = useState(10);
  const [checkInFotoObrig, setCheckInFotoObrig] = useState(true);
  // Tarefas
  const [tarefas, setTarefas] = useState<Array<{
    titulo: string; qtdAlvo: number; estNome: string; estLat: string; estLng: string;
    estOrigemNome: string; patinetes: string;
  }>>([{ titulo: '', qtdAlvo: 1, estNome: '', estLat: '', estLng: '', estOrigemNome: '', patinetes: '' }]);

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const meta = TIPO_SLOT_META[tipoSlot];

  const addTarefa = () => setTarefas(t => [...t, { titulo: '', qtdAlvo: 1, estNome: '', estLat: '', estLng: '', estOrigemNome: '', patinetes: '' }]);
  const removeTarefa = (i: number) => setTarefas(t => t.filter((_, idx) => idx !== i));
  const updateTarefa = (i: number, k: string, v: any) => setTarefas(t => t.map((x, idx) => idx === i ? { ...x, [k]: v } : x));

  const salvar = async () => {
    if (!turnoInicio || !turnoFim) { setErro('Informe início e fim do turno'); return; }
    if (turnoInicio >= turnoFim) { setErro('Fim deve ser após início'); return; }
    for (const t of tarefas) {
      if (!t.titulo.trim()) { setErro('Preencha o título de todas as tarefas'); return; }
    }
    setBusy(true); setErro('');
    try {
      const worker = workers.find(w => w.uid === workerUid);
      const slotData: any = {
        titulo: `${meta.icone} ${tipoSlot === 'scout' ? 'Scout' : 'Charger'} — ${zona || cidade}`,
        descricao: descricao.trim() || null,
        tipoSlot, tipoGeracao: 'manual' as TipoGeracao,
        prioridade, zona: zona || null,
        cargo: tipoSlot as CargoTipo,
        cidade, pais,
        turnoInicio, turnoFim,
        status: 'aberto' as SlotStatus,
        criadoPor: adminUid,
        aceitoPor: workerUid || null,
        aceitoPorNome: worker?.nome || null,
        aceitoEm: workerUid ? serverTimestamp() : null,
        tarefasIds: [], tarefasTotal: tarefas.length, tarefasConcluidas: 0,
        slaAceiteMin: slaMin,
        checkInFotoObrigatoria: checkInFotoObrig,
        n8nDistribuido: false,
      };
      const slotRef = await addDoc(collection(db, 'slots'), { ...slotData, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });

      const tarefaIds: string[] = [];
      for (let i = 0; i < tarefas.length; i++) {
        const t = tarefas[i];
        const patinetesLista: PatineteInfo[] = t.patinetes.trim()
          ? t.patinetes.split('\n').filter(Boolean).map((s, idx) => ({ id: `p${idx}`, identifier: s.trim(), lat: 0, lng: 0 }))
          : [];
        const tarefaData: any = {
          tipo: tipoSlot === 'scout' ? 'rebalanceamento' : 'troca_bateria',
          tipoSlot, status: 'pendente',
          prioridade: prioridade === 'urgente' ? 5 : prioridade === 'alta' ? 4 : 3,
          titulo: t.titulo.trim() || `${meta.l} #${i + 1}`,
          cargo: tipoSlot as CargoTipo,
          cidade, pais, slotId: slotRef.id,
          assigneeUid: workerUid || null,
          assigneeNome: worker?.nome || null,
          qtdAlvo: t.qtdAlvo, qtdConcluida: 0,
          entregas: [], patineteSugeridas: patinetesLista,
          rotaOrdem: i,
          ...(t.estNome.trim() ? { estacao: { id: `est${i}`, nome: t.estNome.trim(), lat: parseFloat(t.estLat) || 0, lng: parseFloat(t.estLng) || 0 } } : {}),
          ...(tipoSlot === 'scout' && t.estOrigemNome.trim() ? { estacaoOrigem: { id: `orig${i}`, nome: t.estOrigemNome.trim(), lat: 0, lng: 0 } } : {}),
          criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
        };
        const tRef = await addDoc(collection(db, 'tarefas'), tarefaData);
        tarefaIds.push(tRef.id);
      }

      await updateDoc(slotRef, { tarefasIds: tarefaIds, atualizadoEm: serverTimestamp() });
      onSalvo();
    } catch (e: any) { setErro(e.message ?? 'Erro ao criar slot'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Tipo */}
      <div>
        <label style={S.lbl}>Tipo de slot</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['scout', 'charger'] as TipoSlot[]).map(t => {
            const m = TIPO_SLOT_META[t];
            const sel = tipoSlot === t;
            return (
              <button key={t} onClick={() => setTipoSlot(t)} style={{
                padding: '12px', borderRadius: 9, border: `2px solid ${sel ? m.cor : 'rgba(255,255,255,.1)'}`,
                background: sel ? m.cor + '18' : 'rgba(255,255,255,.03)',
                color: sel ? m.cor : 'rgba(255,255,255,.4)',
                cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{ fontSize: 18, marginBottom: 3 }}>{m.icone}</div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{m.l}</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>{m.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Zona + Prioridade */}
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>Zona</label>
          {zonas.length > 0 ? (
            <select value={zona} onChange={e => setZona(e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
              <option value="" style={{ background: '#0d1521' }}>— Selecione —</option>
              {zonas.map(z => <option key={z} value={z} style={{ background: '#0d1521' }}>{z}</option>)}
            </select>
          ) : (
            <input style={S.inp} value={zona} onChange={e => setZona(e.target.value)} placeholder="Nome da zona" />
          )}
        </div>
        <div>
          <label style={S.lbl}>Prioridade</label>
          <select value={prioridade} onChange={e => setPrioridade(e.target.value as SlotPrioridade)} style={{ ...S.inp, colorScheme: 'dark' }}>
            {(['normal', 'alta', 'urgente'] as SlotPrioridade[]).map(p => (
              <option key={p} value={p} style={{ background: '#0d1521' }}>{PRIORIDADE_META[p].l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Turno */}
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>Início do turno</label>
          <input type="datetime-local" style={S.inp} value={turnoInicio} onChange={e => setTurnoInicio(e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>Fim do turno</label>
          <input type="datetime-local" style={S.inp} value={turnoFim} onChange={e => setTurnoFim(e.target.value)} />
        </div>
      </div>

      {/* Worker + SLA */}
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>Atribuir worker (opcional)</label>
          <select value={workerUid} onChange={e => setWorkerUid(e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
            <option value="" style={{ background: '#0d1521' }}>— Deixar aberto —</option>
            {workers.filter(w => w.cargoPrestador === tipoSlot || w.cargoPrestador === 'scalt').map(w => (
              <option key={w.uid} value={w.uid} style={{ background: '#0d1521' }}>{w.nome} ({w.cargoPrestador})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={S.lbl}>SLA aceite (min)</label>
          <select value={slaMin} onChange={e => setSlaMin(parseInt(e.target.value))} style={{ ...S.inp, colorScheme: 'dark' }}>
            {[5, 10, 15, 30].map(n => <option key={n} value={n} style={{ background: '#0d1521' }}>{n} min</option>)}
          </select>
        </div>
      </div>

      {/* Check-in foto obrigatória */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
        <input type="checkbox" id="checkInFoto" checked={checkInFotoObrig}
          onChange={e => setCheckInFotoObrig(e.target.checked)} style={{ accentColor: '#06b6d4' }} />
        <label htmlFor="checkInFoto" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', cursor: 'pointer' }}>
          📸 Foto obrigatória no check-in
        </label>
      </div>

      {/* Descrição */}
      <div>
        <label style={S.lbl}>Observações (opcional)</label>
        <input style={S.inp} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Instruções adicionais para o operador" />
      </div>

      {/* Tarefas */}
      <div style={S.sep} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: meta.cor }}>Tarefas do slot ({tarefas.length})</span>
        <button onClick={addTarefa} style={{ ...S.btn(meta.cor), padding: '5px 10px', fontSize: 11 }}>+ Adicionar</button>
      </div>

      {tarefas.map((t, i) => (
        <div key={i} style={{ ...S.card, border: `1px solid ${meta.cor}20`, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: meta.cor, fontWeight: 700 }}>Tarefa {i + 1}</span>
            {tarefas.length > 1 && (
              <button onClick={() => removeTarefa(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>✕</button>
            )}
          </div>
          <div style={S.grid2}>
            <div>
              <label style={S.lbl}>Título</label>
              <input style={S.inp} value={t.titulo} onChange={e => updateTarefa(i, 'titulo', e.target.value)}
                placeholder={tipoSlot === 'scout' ? 'Ex: Encher Ponto X' : 'Ex: Trocar baterias Zona A'} />
            </div>
            <div>
              <label style={S.lbl}>Qtd alvo</label>
              <input type="number" min={1} max={50} style={S.inp} value={t.qtdAlvo}
                onChange={e => updateTarefa(i, 'qtdAlvo', parseInt(e.target.value) || 1)} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={S.lbl}>Ponto destino</label>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6 }}>
              <input style={S.inp} value={t.estNome} onChange={e => updateTarefa(i, 'estNome', e.target.value)} placeholder="Nome do ponto" />
              <input style={S.inp} value={t.estLat} onChange={e => updateTarefa(i, 'estLat', e.target.value)} placeholder="Lat" />
              <input style={S.inp} value={t.estLng} onChange={e => updateTarefa(i, 'estLng', e.target.value)} placeholder="Lng" />
            </div>
          </div>
          {tipoSlot === 'scout' && (
            <div style={{ marginTop: 8 }}>
              <label style={S.lbl}>Ponto origem (de onde coletar)</label>
              <input style={S.inp} value={t.estOrigemNome} onChange={e => updateTarefa(i, 'estOrigemNome', e.target.value)} placeholder="Nome do ponto origem" />
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <label style={S.lbl}>{tipoSlot === 'charger' ? 'Patinetes (IDs, uma por linha)' : 'Patinetes sugeridas (IDs, uma por linha)'}</label>
            <textarea value={t.patinetes} onChange={e => updateTarefa(i, 'patinetes', e.target.value)} rows={2}
              style={{ ...S.inp, resize: 'none' }} placeholder={`SC042\nSC017\nSC031`} />
          </div>
        </div>
      ))}

      {erro && <div style={{ color: '#ef4444', fontSize: 12 }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...S.btn(meta.cor), flex: 1 }} onClick={salvar} disabled={busy}>
          {busy ? '⏳ Criando...' : `+ Criar Slot ${meta.l}`}
        </button>
        <button style={S.btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── SlotCard ─────────────────────────────────────────────────────────────────

function SlotCard({ slot, isAdmin, operadorUid, equipe, onAceitar, onCheckIn, onCheckOut, onCancelar, onReatribuir }: {
  slot: Slot; isAdmin: boolean; operadorUid?: string;
  equipe?: { uid: string; nome: string; cargoPrestador?: string }[];
  onAceitar: (s: Slot) => void; onCheckIn: (s: Slot) => void;
  onCheckOut: (s: Slot) => void; onCancelar: (s: Slot) => void;
  onReatribuir: (slot: Slot, novoUid: string, novoNome: string) => Promise<void>;
}) {
  const [expandido, setExpandido]     = useState(false);
  const [reatribuindo, setReatribuindo] = useState(false);
  const [novoWorker, setNovoWorker]   = useState('');
  const [checkInFoto, setCheckInFoto] = useState(false);
  const [fotoFile, setFotoFile]       = useState<File | null>(null);
  const [salvando, setSalvando]       = useState(false);

  const tipoSlot: TipoSlot = (slot.tipoSlot ?? (slot.cargo === 'charger' ? 'charger' : 'scout')) as TipoSlot;
  const meta = TIPO_SLOT_META[tipoSlot];
  const prio = PRIORIDADE_META[(slot.prioridade as SlotPrioridade) ?? 'normal'];

  // GPS do worker atribuído
  const workerGPS = useWorkerGPS(slot.aceitoPor ?? null);

  const podeAceitar  = !isAdmin && slot.status === 'aberto' && !slot.aceitoPor;
  const podeCheckIn  = !isAdmin && (slot.status === 'aceito' || slot.status === 'a_caminho') && slot.aceitoPor === operadorUid;
  const podeCheckOut = !isAdmin && slot.status === 'em_andamento' && slot.aceitoPor === operadorUid;
  const podeCancelar    = isAdmin && !['concluido', 'cancelado'].includes(slot.status);
  const podeReatribuir  = isAdmin && !['concluido', 'cancelado'].includes(slot.status);
  const fotoObrigatoria = !!(slot as any).checkInFotoObrigatoria;
  const pct = (slot.tarefasTotal ?? 0) > 0
    ? Math.round(((slot.tarefasConcluidas ?? 0) / (slot.tarefasTotal ?? 1)) * 100) : 0;

  const handleCheckIn = async () => {
    if (fotoObrigatoria && !checkInFoto) { setCheckInFoto(true); return; }
    setSalvando(true);
    try {
      let fotoUrl: string | null = null;
      if (fotoFile && slot.id) {
        fotoUrl = await uploadComRetry(fotoFile, `slots/${slot.id}/checkin_${Date.now()}.jpg`);
        await updateDoc(doc(db, 'slots', slot.id!), { checkInFotoUrl: fotoUrl, atualizadoEm: serverTimestamp() });
      }
      onCheckIn(slot);
      setCheckInFoto(false); setFotoFile(null);
    } finally { setSalvando(false); }
  };

  const handleReatribuir = async () => {
    if (!novoWorker) return;
    const w = equipe?.find(e => e.uid === novoWorker);
    if (!w) return;
    setSalvando(true);
    try {
      await onReatribuir(slot, w.uid, w.nome);
      setReatribuindo(false); setNovoWorker('');
    } finally { setSalvando(false); }
  };

  return (
    <div style={{ ...S.card, border: `1px solid ${meta.cor}30`, background: `${meta.cor}06`, cursor: 'pointer' }}
      onClick={() => setExpandido(e => !e)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' as const }}>
            <span style={S.badge(meta.cor)}>{meta.icone} {meta.l}</span>
            <span style={S.badge(STATUS_SLOT_COR[slot.status] ?? '#6b7280')}>{STATUS_SLOT_L[slot.status] ?? slot.status}</span>
            <span style={S.badge(prio.cor)}>{prio.l}</span>
            {slot.tipoGeracao === 'automatico' && <span style={S.badge('#a78bfa')}>🤖 Auto</span>}
            {slot.zona && <span style={S.badge('#6b7280')}>{slot.zona}</span>}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff', marginBottom: 2 }}>{slot.titulo}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
            <span>{fmtDt(slot.turnoInicio)} → {fmtDt(slot.turnoFim)}</span>
            {slot.aceitoPorNome && (
              <>
                <span>· {slot.aceitoPorNome}</span>
                {/* Badge GPS do worker */}
                {workerGPS && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700,
                    padding: '1px 5px', borderRadius: 4,
                    background: idadeLabel(workerGPS.idadeS).cor + '18',
                    color: idadeLabel(workerGPS.idadeS).cor,
                    border: `1px solid ${idadeLabel(workerGPS.idadeS).cor}30` }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: idadeLabel(workerGPS.idadeS).cor, flexShrink: 0 }} />
                    GPS {idadeLabel(workerGPS.idadeS).txt}
                  </span>
                )}
                {!workerGPS && slot.status === 'em_andamento' && (
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(255,255,255,.08)' }}>GPS offline</span>
                )}
              </>
            )}
          </div>
          {(slot.tarefasTotal ?? 0) > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: meta.cor, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>
                {slot.tarefasConcluidas ?? 0}/{slot.tarefasTotal} tarefas
              </div>
            </div>
          )}
        </div>
        <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 16 }}>{expandido ? '▲' : '▼'}</span>
      </div>

      {expandido && (
        <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
          {slot.descricao && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginBottom: 10 }}>{slot.descricao}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11, marginBottom: 12 }}>
            <div><div style={{ color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>Check-in</div><div>{fmtTs(slot.checkInEm)}</div></div>
            <div><div style={{ color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>Check-out</div><div>{fmtTs(slot.checkOutEm)}</div></div>
            <div><div style={{ color: 'rgba(255,255,255,.35)', marginBottom: 2 }}>SLA aceite</div><div>{slot.slaAceiteMin ?? 10} min</div></div>
          </div>

          {/* Foto obrigatória no check-in */}
          {podeCheckIn && checkInFoto && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginBottom: 8 }}>📸 Foto de check-in obrigatória</div>
              <input type="file" accept="image/*" capture="environment"
                onChange={e => setFotoFile(e.target.files?.[0] ?? null)}
                style={{ fontSize: 11, color: '#dce8ff' }} />
              {fotoFile && <div style={{ fontSize: 10, color: '#10b981', marginTop: 4 }}>✓ {fotoFile.name}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button style={S.btn('#06b6d4')} disabled={!fotoFile || salvando} onClick={handleCheckIn}>
                  {salvando ? '⏳' : '📍 Confirmar check-in'}
                </button>
                <button style={{ ...S.btnGhost }} onClick={() => { setCheckInFoto(false); setFotoFile(null); }}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Modal reatribuição */}
          {reatribuindo && (
            <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>✏ Reatribuir slot</div>
              <select value={novoWorker} onChange={e => setNovoWorker(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 7, fontSize: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: '#dce8ff', colorScheme: 'dark' as any, marginBottom: 10 }}>
                <option value="">— Selecione o novo worker —</option>
                {(equipe ?? []).filter(w => w.uid !== slot.aceitoPor).map(w => (
                  <option key={w.uid} value={w.uid}>{w.nome} ({w.cargoPrestador ?? 'field'})</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btn('#a78bfa')} disabled={!novoWorker || salvando} onClick={handleReatribuir}>
                  {salvando ? '⏳' : '✓ Confirmar'}
                </button>
                <button style={{ ...S.btnGhost }} onClick={() => { setReatribuindo(false); setNovoWorker(''); }}>Cancelar</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
            {podeAceitar && <button style={S.btn('#10b981')} onClick={() => onAceitar(slot)}>✓ Aceitar Slot</button>}
            {podeCheckIn && !checkInFoto && <button style={S.btn('#06b6d4')} onClick={handleCheckIn}>📍 Check-in</button>}
            {podeCheckOut && <button style={S.btn('#a78bfa')} onClick={() => onCheckOut(slot)}>🏁 Concluir Slot</button>}
            {podeReatribuir && !reatribuindo && (
              <button style={{ ...S.btnGhost, color: '#a78bfa', border: '1px solid rgba(167,139,250,.3)' }}
                onClick={() => setReatribuindo(true)}>✏ Reatribuir</button>
            )}
            {podeCancelar && (
              <button style={{ ...S.btnGhost, color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' }}
                onClick={() => onCancelar(slot)}>Cancelar</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ConfigAutoSlotsPanel ─────────────────────────────────────────────────────

const FAIXAS_PADRAO: FaixaHorario[] = [
  { id: 'pico_manha', nome: 'Pico manhã',  horaInicio: '07:00', horaFim: '09:00', ativo: true,  bikesAlvo: 12, bikesMinimo: 5, bikesMaximo: 16, prioridade: 'alta' },
  { id: 'manha',      nome: 'Manhã',       horaInicio: '09:00', horaFim: '12:00', ativo: true,  bikesAlvo: 8,  bikesMinimo: 3, bikesMaximo: 12, prioridade: 'normal' },
  { id: 'almoco',     nome: 'Almoço',      horaInicio: '12:00', horaFim: '14:00', ativo: true,  bikesAlvo: 10, bikesMinimo: 4, bikesMaximo: 14, prioridade: 'alta' },
  { id: 'tarde',      nome: 'Tarde',       horaInicio: '14:00', horaFim: '17:00', ativo: true,  bikesAlvo: 8,  bikesMinimo: 3, bikesMaximo: 12, prioridade: 'normal' },
  { id: 'pico_tarde', nome: 'Pico tarde',  horaInicio: '17:00', horaFim: '20:00', ativo: true,  bikesAlvo: 12, bikesMinimo: 5, bikesMaximo: 16, prioridade: 'urgente' },
  { id: 'noite',      nome: 'Noite',       horaInicio: '20:00', horaFim: '23:00', ativo: true,  bikesAlvo: 6,  bikesMinimo: 2, bikesMaximo: 10, prioridade: 'normal' },
  { id: 'madrugada',  nome: 'Madrugada',   horaInicio: '23:00', horaFim: '07:00', ativo: false, bikesAlvo: 4,  bikesMinimo: 1, bikesMaximo: 8,  prioridade: 'normal' },
];

function ConfigAutoSlotsPanel({ cidade, pais, adminUid, zonas }: {
  cidade: string; pais: string; adminUid: string; zonas: string[];
}) {
  const [configs, setConfigs] = useState<ConfigZonaAuto[]>([]);
  const [editando, setEditando] = useState<ConfigZonaAuto | null>(null);
  const [secao, setSecao] = useState<'geral' | 'faixas' | 'charger'>('geral');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [gerando, setGerando] = useState(false);
  const [atualizandoGoJet, setAtualizandoGoJet] = useState(false);
  const [logEntradas, setLogEntradas] = useState<any[]>([]);
  const [logMsg, setLogMsg] = useState('');
  const [novaZonaNome, setNovaZonaNome] = useState('');
  const [zonasManuais, setZonasManuais] = useState<string[]>([]);

  useEffect(() => {
    // Busca últimas 20 entradas do log_slots_auto para esta cidade
    getDocs(
      query(collection(db, 'log_slots_auto'), where('cidade', '==', cidade), orderBy('registradoEm', 'desc'))
    ).then(snap => setLogEntradas(snap.docs.slice(0, 20).map(d => ({ id: d.id, ...d.data() }))));
  }, [cidade]);

  const gerarAgora = async () => {
    setGerando(true); setLogMsg('');
    try {
      const res: any = await fnGerarSlotsManual()({ cidade });
      setLogMsg('✓ Slots gerados com sucesso');
      // Recarrega log
      getDocs(
        query(collection(db, 'log_slots_auto'), where('cidade', '==', cidade), orderBy('registradoEm', 'desc'))
      ).then(snap => setLogEntradas(snap.docs.slice(0, 20).map(d => ({ id: d.id, ...d.data() }))));
    } catch (e: any) { setLogMsg('Erro: ' + (e.message ?? 'Falha na geração')); }
    finally { setGerando(false); }
  };

  const atualizarGoJet = async () => {
    setAtualizandoGoJet(true); setLogMsg('');
    try {
      await fnScraperGoJetManual()({ cidade });
      setLogMsg('✓ Snapshot GoJet atualizado');
    } catch (e: any) { setLogMsg('Erro: ' + (e.message ?? 'Falha no scraper')); }
    finally { setAtualizandoGoJet(false); }
  };

  useEffect(() => {
    buscarConfigZonas(cidade).then(c => { setConfigs(c); setLoading(false); });
  }, [cidade]);

  const abrirEdicao = (zonaNome: string) => {
    const existente = configs.find(c => c.zonaNome === zonaNome);
    setEditando(existente ?? {
      zonaId: zonaNome.toLowerCase().replace(/\s+/g, '_'),
      zonaNome, cidade, pais, ativo: true,
      scoutAtivo: true, bikesMinimo: 3, bikesAlvo: 8, bikesMaximo: 12, usarHistorico: false,
      incluirForaPonto: true,
      chargerAtivo: false, bateriaThreshold: 20, chargerMinimo: 2,
      qtdWorkers: 1,
      faixasHorario: FAIXAS_PADRAO,
      horarioAtivoInicio: '07:00', horarioAtivoFim: '23:00',
      intervaloChecagemMin: 15, slaAceiteMin: 10, autoAssign: true,
      sensibilidadeClima: 'moderada', notificarGestor: true,
    });
    setSecao('geral');
  };

  const salvar = async () => {
    if (!editando) return;
    setBusy(true); setMsg('');
    try {
      await salvarConfigZona({ ...editando, atualizadoPor: adminUid });
      const novas = await buscarConfigZonas(cidade);
      setConfigs(novas);
      setMsg('✓ Configuração salva');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg('Erro: ' + e.message); }
    finally { setBusy(false); }
  };

  const upd = (k: keyof ConfigZonaAuto, v: any) =>
    setEditando(e => e ? { ...e, [k]: v } : e);

  const updFaixa = (idx: number, k: keyof FaixaHorario, v: any) =>
    setEditando(e => {
      if (!e) return e;
      const faixas = [...(e.faixasHorario ?? [])];
      faixas[idx] = { ...faixas[idx], [k]: v };
      return { ...e, faixasHorario: faixas };
    });

  const addFaixa = () =>
    setEditando(e => {
      if (!e) return e;
      const nova: FaixaHorario = {
        id: `faixa_${Date.now()}`, nome: 'Nova faixa',
        horaInicio: '08:00', horaFim: '10:00', ativo: true,
        bikesAlvo: 8, bikesMinimo: 3, bikesMaximo: 12, prioridade: 'normal',
      };
      return { ...e, faixasHorario: [...(e.faixasHorario ?? []), nova] };
    });

  const removeFaixa = (idx: number) =>
    setEditando(e => {
      if (!e) return e;
      return { ...e, faixasHorario: (e.faixasHorario ?? []).filter((_, i) => i !== idx) };
    });

  const allZonas = Array.from(new Set([...zonas, ...configs.map(c => c.zonaNome), ...zonasManuais]));

  const adicionarZonaManual = () => {
    const nome = novaZonaNome.trim();
    if (!nome || allZonas.includes(nome)) return;
    setZonasManuais(prev => [...prev, nome]);
    setNovaZonaNome('');
    // Abre imediatamente o editor para a nova zona
    abrirEdicao(nome);
  };

  const PRIO_COR: Record<string, string> = { normal: '#6b7280', alta: '#f59e0b', urgente: '#ef4444' };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 14 }}>
        Configure geração automática de slots por zona. As <strong style={{ color: 'rgba(255,255,255,.5)' }}>faixas de horário</strong> sobrescrevem os valores padrão quando ativas — ideal para picos de demanda.
      </div>

      {/* Grade de zonas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8, marginBottom: 16 }}>
        {allZonas.map(z => {
          const cfg = configs.find(c => c.zonaNome === z);
          const faixasAtivas = (cfg?.faixasHorario ?? []).filter(f => f.ativo).length;
          return (
            <button key={z} onClick={() => abrirEdicao(z)} style={{
              padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${cfg?.ativo ? 'rgba(167,139,250,.35)' : 'rgba(255,255,255,.08)'}`,
              background: cfg?.ativo ? 'rgba(167,139,250,.08)' : 'rgba(255,255,255,.03)',
              color: cfg?.ativo ? '#a78bfa' : 'rgba(255,255,255,.4)',
              cursor: 'pointer', textAlign: 'left' as const, fontSize: 12,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>{z}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                {cfg ? (cfg.ativo ? `✓ Ativo · ${cfg.intervaloChecagemMin}min` : '✗ Inativo') : 'Não configurado'}
              </div>
              {cfg?.ativo && (
                <div style={{ fontSize: 9, marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {cfg.scoutAtivo && <span style={{ color: '#06b6d4' }}>🛴 {cfg.bikesMinimo}↔{cfg.bikesMaximo}</span>}
                  {cfg.chargerAtivo && <span style={{ color: '#10b981' }}>⚡ &lt;{cfg.bateriaThreshold}%</span>}
                  {faixasAtivas > 0 && <span style={{ color: '#a78bfa' }}>⏰ {faixasAtivas} faixas</span>}
                </div>
              )}
            </button>
          );
        })}
        {/* Botão + para adicionar nova zona diretamente */}
        <div style={{
          padding: '12px', borderRadius: 8, border: '1px dashed rgba(167,139,250,.25)',
          background: 'rgba(167,139,250,.03)', display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <input
            value={novaZonaNome}
            onChange={e => setNovaZonaNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionarZonaManual()}
            placeholder="Nome da zona (ex: Centro, Zona Sul…)"
            style={{ ...S.inp, flex: 1, margin: 0 }}
          />
          <button
            onClick={adicionarZonaManual}
            disabled={!novaZonaNome.trim()}
            style={{ ...S.btn('#a78bfa'), padding: '6px 14px', opacity: novaZonaNome.trim() ? 1 : 0.4 }}
          >
            + Zona
          </button>
        </div>
      </div>

      {/* Ações manuais */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
        <button style={{ ...S.btn('#a78bfa'), minWidth: 150 }} onClick={gerarAgora} disabled={gerando}>
          {gerando ? '⏳ Gerando...' : '▶ Gerar Slots Agora'}
        </button>
        <button style={{ ...S.btn('#06b6d4'), minWidth: 150 }} onClick={atualizarGoJet} disabled={atualizandoGoJet}>
          {atualizandoGoJet ? '⏳ Atualizando...' : '🔄 Atualizar GoJet'}
        </button>
        {logMsg && (
          <div style={{ fontSize: 11, color: logMsg.startsWith('✓') ? '#10b981' : '#ef4444', alignSelf: 'center' }}>
            {logMsg}
          </div>
        )}
      </div>

      {/* Log de decisões */}
      {logEntradas.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, maxHeight: 200, overflowY: 'auto' as const }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
            📋 Log de decisões recentes
          </div>
          {logEntradas.map(e => (
            <div key={e.id} style={{ fontSize: 10, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: e.slotCriado ? '#10b981' : 'rgba(255,255,255,.25)', minWidth: 10 }}>
                {e.slotCriado ? '✓' : '–'}
              </span>
              <span style={{ color: '#a78bfa', minWidth: 90 }}>{e.zona}</span>
              <span style={{ color: 'rgba(255,255,255,.5)' }}>{e.tipoSlot}</span>
              <span style={{ color: 'rgba(255,255,255,.35)', flex: 1 }}>{e.regraAplicada}</span>
              {e.motivo && <span style={{ color: 'rgba(255,255,255,.2)', fontStyle: 'italic' }}>{e.motivo}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {editando && (
        <div style={{ ...S.card, border: '1px solid rgba(167,139,250,.2)', background: 'rgba(167,139,250,.04)' }}>
          {/* Cabeçalho */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>⚙️ {editando.zonaNome}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={editando.ativo} onChange={e => upd('ativo', e.target.checked)} />
              <span style={{ fontSize: 11, color: editando.ativo ? '#a78bfa' : 'rgba(255,255,255,.35)', fontWeight: 600 }}>
                {editando.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </label>
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {([['geral','⚙️ Padrões'],['faixas','⏰ Faixas de horário'],['charger','⚡ Charger']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSecao(k)} style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: secao === k ? 'rgba(167,139,250,.2)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${secao === k ? 'rgba(167,139,250,.4)' : 'rgba(255,255,255,.08)'}`,
                color: secao === k ? '#a78bfa' : 'rgba(255,255,255,.4)',
              }}>{l}</button>
            ))}
          </div>

          {/* ── SEÇÃO GERAL ── */}
          {secao === 'geral' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Scout padrão */}
              <div style={{ padding: '12px', background: 'rgba(6,182,212,.05)', borderRadius: 8, border: '1px solid rgba(6,182,212,.15)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={editando.scoutAtivo} onChange={e => upd('scoutAtivo', e.target.checked)} />
                  <span style={{ fontSize: 12, color: '#06b6d4', fontWeight: 700 }}>🛴 Scout — Valores padrão</span>
                </label>
                {editando.scoutAtivo && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        { k: 'bikesMinimo', l: 'Mínimo', tip: 'abaixo → scout encher' },
                        { k: 'bikesAlvo',   l: 'Alvo',   tip: 'meta ideal' },
                        { k: 'bikesMaximo', l: 'Máximo',  tip: 'acima → redistribuir' },
                      ].map(f => (
                        <div key={f.k}>
                          <label style={S.lbl}>{f.l}</label>
                          <input type="number" min={0} style={S.inp} value={(editando as any)[f.k]}
                            onChange={e => upd(f.k as any, parseInt(e.target.value) || 0)} />
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{f.tip}</div>
                        </div>
                      ))}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 8, fontSize: 11 }}>
                      <input type="checkbox" checked={editando.usarHistorico} onChange={e => upd('usarHistorico', e.target.checked)} />
                      <span style={{ color: 'rgba(255,255,255,.45)' }}>Ajustar alvo com histórico do dia anterior</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 6, fontSize: 11 }}>
                      <input type="checkbox" checked={editando.incluirForaPonto ?? true} onChange={e => upd('incluirForaPonto', e.target.checked)} />
                      <span style={{ color: 'rgba(255,255,255,.45)' }}>Incluir patinetes fora de ponto como tarefa de retorno</span>
                    </label>
                  </>
                )}
              </div>

              {/* Geral */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={S.lbl}>Horário ativo global</label>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input type="time" style={{ ...S.inp, flex: 1 }} value={editando.horarioAtivoInicio}
                      onChange={e => upd('horarioAtivoInicio', e.target.value)} />
                    <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>→</span>
                    <input type="time" style={{ ...S.inp, flex: 1 }} value={editando.horarioAtivoFim}
                      onChange={e => upd('horarioAtivoFim', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label style={S.lbl}>Intervalo checagem</label>
                  <select value={editando.intervaloChecagemMin} onChange={e => upd('intervaloChecagemMin', parseInt(e.target.value))} style={{ ...S.inp, colorScheme: 'dark' }}>
                    {[15, 30, 60].map(n => <option key={n} value={n} style={{ background: '#0d1521' }}>{n} min</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>SLA aceite</label>
                  <select value={editando.slaAceiteMin} onChange={e => upd('slaAceiteMin', parseInt(e.target.value))} style={{ ...S.inp, colorScheme: 'dark' }}>
                    {[5, 10, 15, 30].map(n => <option key={n} value={n} style={{ background: '#0d1521' }}>{n} min</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Sensibilidade ao clima</label>
                  <select value={editando.sensibilidadeClima} onChange={e => upd('sensibilidadeClima', e.target.value)} style={{ ...S.inp, colorScheme: 'dark' }}>
                    {[['ignorar','Ignorar'],['moderada','Moderada'],['alta','Alta']].map(([v,l]) => (
                      <option key={v} value={v} style={{ background: '#0d1521' }}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Workers por slot */}
              <div style={{ padding: '10px 12px', background: 'rgba(167,139,250,.04)', borderRadius: 8, border: '1px solid rgba(167,139,250,.12)' }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, marginBottom: 8 }}>👷 Workers por slot</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'center' }}>
                  <div>
                    <label style={S.lbl}>Quantidade</label>
                    <input type="number" min={1} max={10} style={S.inp}
                      value={editando.qtdWorkers ?? 1}
                      onChange={e => upd('qtdWorkers', Math.max(1, parseInt(e.target.value) || 1))} />
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', lineHeight: 1.5 }}>
                    Quantos workers o motor tentará atribuir ao criar o slot. Se não houver disponíveis suficientes, o slot fica aberto para aceite manual.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11 }}>
                  <input type="checkbox" checked={editando.autoAssign} onChange={e => upd('autoAssign', e.target.checked)} />
                  <span style={{ color: 'rgba(255,255,255,.45)' }}>Auto-atribuir worker mais próximo</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11 }}>
                  <input type="checkbox" checked={editando.notificarGestor} onChange={e => upd('notificarGestor', e.target.checked)} />
                  <span style={{ color: 'rgba(255,255,255,.45)' }}>Notificar gestor ao gerar</span>
                </label>
              </div>
            </div>
          )}

          {/* ── SEÇÃO FAIXAS DE HORÁRIO ── */}
          {secao === 'faixas' && (
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 12 }}>
                Cada faixa ativa <strong style={{ color: 'rgba(255,255,255,.5)' }}>sobrescreve</strong> os valores padrão quando o horário atual estiver dentro da janela. Útil para picos, turnos e períodos especiais.
              </div>

              {/* Visualização de linha do tempo */}
              <div style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.06)' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Linha do tempo (07h → 23h)
                </div>
                <div style={{ position: 'relative', height: 28, background: 'rgba(255,255,255,.04)', borderRadius: 5, overflow: 'hidden' }}>
                  {(editando.faixasHorario ?? []).filter(f => f.ativo).map(f => {
                    const toMin = (hhmm: string) => {
                      const [h, m] = hhmm.split(':').map(Number);
                      return h * 60 + (m || 0);
                    };
                    const base = toMin('07:00'), range = toMin('23:00') - base;
                    let start = toMin(f.horaInicio), end = toMin(f.horaFim);
                    if (end <= start) end += 24 * 60;
                    const left = Math.max(0, ((start - base) / range) * 100);
                    const width = Math.min(100 - left, ((end - start) / range) * 100);
                    const cor = PRIO_COR[f.prioridade ?? 'normal'];
                    return (
                      <div key={f.id} title={`${f.nome} ${f.horaInicio}–${f.horaFim}`} style={{
                        position: 'absolute', top: 2, height: 'calc(100% - 4px)',
                        left: `${left}%`, width: `${width}%`,
                        background: cor + '50', border: `1px solid ${cor}80`,
                        borderRadius: 3, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 8, color: cor, overflow: 'hidden',
                        whiteSpace: 'nowrap', fontWeight: 700,
                      }}>{f.nome}</div>
                    );
                  })}
                  {/* Hora labels */}
                  {['07h','09h','12h','15h','17h','20h','23h'].map((l, i) => (
                    <div key={l} style={{
                      position: 'absolute', bottom: -14, fontSize: 8,
                      color: 'rgba(255,255,255,.25)',
                      left: `${(i / 6) * 100}%`, transform: 'translateX(-50%)',
                    }}>{l}</div>
                  ))}
                </div>
                <div style={{ height: 16 }} />
              </div>

              {/* Lista de faixas */}
              {(editando.faixasHorario ?? []).map((f, idx) => {
                const cor = PRIO_COR[f.prioridade ?? 'normal'];
                return (
                  <div key={f.id} style={{
                    marginBottom: 10, padding: '12px', borderRadius: 9,
                    background: f.ativo ? `${cor}08` : 'rgba(255,255,255,.02)',
                    border: `1px solid ${f.ativo ? cor + '25' : 'rgba(255,255,255,.06)'}`,
                  }}>
                    {/* Header faixa */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: f.ativo ? 10 : 0 }}>
                      <input type="checkbox" checked={f.ativo} onChange={e => updFaixa(idx, 'ativo', e.target.checked)} />
                      <input value={f.nome} onChange={e => updFaixa(idx, 'nome', e.target.value)}
                        style={{ ...S.inp, flex: 1, fontSize: 12, fontWeight: 700, padding: '5px 8px' }} />
                      <input type="time" value={f.horaInicio} onChange={e => updFaixa(idx, 'horaInicio', e.target.value)}
                        style={{ ...S.inp, width: 82, fontSize: 11, padding: '5px 8px' }} />
                      <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>→</span>
                      <input type="time" value={f.horaFim} onChange={e => updFaixa(idx, 'horaFim', e.target.value)}
                        style={{ ...S.inp, width: 82, fontSize: 11, padding: '5px 8px' }} />
                      <button onClick={() => removeFaixa(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
                    </div>

                    {f.ativo && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 7 }}>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>Mínimo 🛴</label>
                          <input type="number" min={0} value={f.bikesMinimo ?? ''} placeholder="padrão"
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bikesMinimo', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>Alvo 🛴</label>
                          <input type="number" min={0} value={f.bikesAlvo ?? ''} placeholder="padrão"
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bikesAlvo', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>Máximo 🛴</label>
                          <input type="number" min={0} value={f.bikesMaximo ?? ''} placeholder="padrão"
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bikesMaximo', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>Bat. ⚡</label>
                          <input type="number" min={0} max={100} value={f.bateriaThreshold ?? ''} placeholder="padrão"
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px' }}
                            onChange={e => updFaixa(idx, 'bateriaThreshold', e.target.value ? parseInt(e.target.value) : undefined)} />
                        </div>
                        <div>
                          <label style={{ ...S.lbl, fontSize: 9 }}>Prioridade</label>
                          <select value={f.prioridade ?? 'normal'} onChange={e => updFaixa(idx, 'prioridade', e.target.value)}
                            style={{ ...S.inp, fontSize: 11, padding: '5px 7px', colorScheme: 'dark', color: cor }}>
                            {[['normal','Normal'],['alta','Alta'],['urgente','Urgente']].map(([v,l]) => (
                              <option key={v} value={v} style={{ background: '#0d1521', color: PRIO_COR[v] }}>{l}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={addFaixa} style={{ ...S.btnGhost, width: '100%', marginTop: 4 }}>
                + Adicionar faixa
              </button>

              <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 7, fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                💡 Campos em branco herdam o valor padrão da zona. Múltiplas faixas podem se sobrepor — a de maior prioridade prevalece.
              </div>
            </div>
          )}

          {/* ── SEÇÃO CHARGER ── */}
          {secao === 'charger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ padding: '12px', background: 'rgba(16,185,129,.05)', borderRadius: 8, border: '1px solid rgba(16,185,129,.15)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={editando.chargerAtivo} onChange={e => upd('chargerAtivo', e.target.checked)} />
                  <span style={{ fontSize: 12, color: '#10b981', fontWeight: 700 }}>⚡ Charger ativo</span>
                </label>
                {editando.chargerAtivo && (
                  <div style={S.grid2}>
                    <div>
                      <label style={S.lbl}>Threshold bateria (%)</label>
                      <input type="number" min={1} max={100} style={S.inp} value={editando.bateriaThreshold}
                        onChange={e => upd('bateriaThreshold', parseInt(e.target.value) || 20)} />
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', marginTop: 2 }}>
                        Patinetes abaixo deste % entram na lista
                      </div>
                    </div>
                    <div>
                      <label style={S.lbl}>Mínimo para gerar slot</label>
                      <input type="number" min={1} style={S.inp} value={editando.chargerMinimo}
                        onChange={e => upd('chargerMinimo', parseInt(e.target.value) || 1)} />
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', marginTop: 2 }}>
                        Só gera se tiver pelo menos N patinetes
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {editando.chargerAtivo && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', padding: '8px 10px', background: 'rgba(255,255,255,.02)', borderRadius: 7, border: '1px solid rgba(255,255,255,.06)' }}>
                  💡 Para configurar thresholds de bateria diferentes por horário, use a aba <strong style={{ color: '#a78bfa' }}>Faixas de horário</strong> e preencha o campo "Bat. ⚡" em cada faixa.
                </div>
              )}
            </div>
          )}

          {msg && <div style={{ color: msg.startsWith('✓') ? '#10b981' : '#ef4444', fontSize: 12, marginTop: 12 }}>{msg}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...S.btn('#a78bfa'), flex: 1 }} onClick={salvar} disabled={busy}>
              {busy ? '⏳ Salvando...' : '✓ Salvar configuração'}
            </button>
            <button style={S.btnGhost} onClick={() => setEditando(null)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FormOcorrencia ───────────────────────────────────────────────────────────

function FormOcorrencia({ usuario, cidade, pais, onSalvo, onCancelar }: {
  usuario: any; cidade: string; pais: string;
  onSalvo: () => void; onCancelar: () => void;
}) {
  const [tipo, setTipo] = useState<OcorrenciaTipo>('vandalismo');
  const [desc, setDesc] = useState('');
  const [procurando, setProcurando] = useState(false);
  const [patineteId, setPatineteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const ehRoubo = tipo === 'roubo';

  const salvar = async () => {
    if (!desc.trim()) { setErro('Descreva a ocorrência'); return; }
    setBusy(true); setErro('');
    try {
      await addDoc(collection(db, 'ocorrencias'), {
        tipo, descricao: desc.trim(), status: 'aberta',
        registradoPor: usuario.uid, registradoPorNome: usuario.nome,
        cargo: usuario.cargoPrestador ?? usuario.role,
        cidade, pais, procurando: ehRoubo ? procurando : false,
        patineteId: patineteId.trim() || null, telegramEnviado: false,
        criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
      });
      onSalvo();
    } catch (e: any) { setErro(e.message ?? 'Erro ao registrar'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={S.lbl}>Tipo de ocorrência</label>
        <select value={tipo} onChange={e => setTipo(e.target.value as OcorrenciaTipo)} style={{ ...S.inp, colorScheme: 'dark' }}>
          {OCORRENCIAS_TIPOS.map(o => <option key={o.k} value={o.k} style={{ background: '#0d1521' }}>{o.l}</option>)}
        </select>
      </div>
      {ehRoubo && (
        <div style={{ padding: 10, borderRadius: 8, background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)' }}>
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700, marginBottom: 8 }}>🚨 Roubo detectado</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={procurando} onChange={e => setProcurando(e.target.checked)} />
            <span style={{ color: procurando ? '#ef4444' : 'rgba(255,255,255,.5)' }}>
              {procurando ? '🔍 Procurando patinete' : 'Marcar como "Procurando"'}
            </span>
          </label>
          <div style={{ marginTop: 8 }}>
            <label style={S.lbl}>ID do patinete (se conhecido)</label>
            <input style={S.inp} value={patineteId} onChange={e => setPatineteId(e.target.value)} placeholder="Ex: SC-1234" />
          </div>
        </div>
      )}
      <div>
        <label style={S.lbl}>Descrição</label>
        <textarea style={{ ...S.inp, resize: 'vertical' as const, minHeight: 70 }}
          value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Descreva o que aconteceu, local, horário..." />
      </div>
      {erro && <div style={{ color: '#ef4444', fontSize: 12 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={S.btn(ehRoubo ? '#ef4444' : '#f97316')} onClick={salvar} disabled={busy}>
          {busy ? '⏳ Registrando...' : '🚨 Registrar Ocorrência'}
        </button>
        <button style={S.btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

interface Props {
  usuario: {
    uid: string; nome: string; email: string; role: string;
    cargoPrestador?: string; tipoCadastro?: string; cidade?: string;
  };
  cidade: string; pais: string; onFechar: () => void;
}

type Aba = 'slots' | 'tarefas' | 'ocorrencias' | 'equipe' | 'config_auto' | 'historico';

// ─── HistoricoSlotsPanel ──────────────────────────────────────────────────────

function HistoricoSlotsPanel({ slots, tarefas }: { slots: Slot[]; tarefas: Tarefa[] }) {
  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo]   = useState<string>('todos');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');

  const filtrados = slots.filter(s => {
    if (filtroTipo   !== 'todos' && s.tipoSlot !== filtroTipo)   return false;
    if (filtroStatus !== 'todos' && s.status   !== filtroStatus) return false;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      return (s.titulo ?? '').toLowerCase().includes(q)
          || (s.aceitoPorNome ?? '').toLowerCase().includes(q)
          || (s.zona ?? '').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    const ta = (a.criadoEm as any)?.seconds ?? 0;
    const tb = (b.criadoEm as any)?.seconds ?? 0;
    return tb - ta;
  });

  const exportCSV = () => {
    const bom = '﻿';
    const header = ['ID','Tipo','Status','Título','Zona','Worker','Criado em','Check-in','Check-out','Tarefas','Concluídas'];
    const rows = filtrados.map(s => [
      s.id ?? '',
      s.tipoSlot ?? '',
      s.status ?? '',
      `"${(s.titulo ?? '').replace(/"/g, '""')}"`,
      s.zona ?? '',
      s.aceitoPorNome ?? '',
      fmtTs(s.criadoEm),
      fmtTs(s.checkInEm),
      fmtTs(s.checkOutEm),
      String(s.tarefasTotal ?? 0),
      String(s.tarefasConcluidas ?? 0),
    ]);
    const csv = bom + [header, ...rows].map(r => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `slots_historico_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const inpS: React.CSSProperties = { padding: '7px 10px', borderRadius: 7, fontSize: 11, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: '#dce8ff', colorScheme: 'dark' as any };

  return (
    <div style={{ padding: 12 }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 12 }}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar título, worker, zona…" style={{ ...inpS, flex: 1, minWidth: 160 }} />
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inpS}>
          <option value="todos">Todos tipos</option>
          <option value="scout">Scout</option>
          <option value="charger">Charger</option>
        </select>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={inpS}>
          <option value="todos">Todos status</option>
          <option value="aberto">Aberto</option>
          <option value="em_andamento">Em andamento</option>
          <option value="concluido">Concluído</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <button onClick={exportCSV} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.3)', color: '#10b981' }}>
          ⬇ CSV ({filtrados.length})
        </button>
      </div>

      {/* Tabela */}
      <div style={{ overflowX: 'auto' as const }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              {['Tipo','Status','Título','Worker','Turno','Progresso'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'rgba(255,255,255,.35)', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 200).map(s => {
              const meta = TIPO_SLOT_META[(s.tipoSlot ?? 'scout') as TipoSlot];
              const corStatus = STATUS_SLOT_COR[s.status] ?? '#6b7280';
              const pct = s.tarefasTotal ? Math.round(((s.tarefasConcluidas ?? 0) / s.tarefasTotal) * 100) : null;
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)') as any}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent') as any}>
                  <td style={{ padding: '7px 8px' }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: meta.cor + '20', color: meta.cor, fontWeight: 700 }}>{meta.icone} {meta.l}</span></td>
                  <td style={{ padding: '7px 8px' }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: corStatus + '20', color: corStatus, fontWeight: 700 }}>{STATUS_SLOT_L[s.status] ?? s.status}</span></td>
                  <td style={{ padding: '7px 8px', color: '#dce8ff', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.titulo}</td>
                  <td style={{ padding: '7px 8px', color: 'rgba(255,255,255,.5)' }}>{s.aceitoPorNome ?? '—'}</td>
                  <td style={{ padding: '7px 8px', color: 'rgba(255,255,255,.35)', whiteSpace: 'nowrap' as const }}>{fmtDt(s.turnoInicio)}</td>
                  <td style={{ padding: '7px 8px' }}>
                    {pct != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 50, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : meta.cor, borderRadius: 2 }} />
                        </div>
                        <span style={{ color: 'rgba(255,255,255,.4)' }}>{s.tarefasConcluidas}/{s.tarefasTotal}</span>
                      </div>
                    ) : <span style={{ color: 'rgba(255,255,255,.2)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtrados.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,.3)', fontSize: 12 }}>Nenhum slot encontrado.</div>}
        {filtrados.length > 200 && <div style={{ textAlign: 'center', padding: 8, color: 'rgba(255,255,255,.25)', fontSize: 10 }}>Exibindo 200 de {filtrados.length}. Use os filtros para refinar.</div>}
      </div>
    </div>
  );
}

export default function SlotsModule({ usuario, cidade, pais, onFechar }: Props) {
  const isAdmin     = ['admin', 'gestor', 'gestor_log'].includes(usuario.role);
  const isLogistica = usuario.tipoCadastro === 'prestador' && ['charger', 'scalt', 'scout'].includes(usuario.cargoPrestador ?? '');

  const [aba, setAba]                 = useState<Aba>(isAdmin ? 'slots' : 'tarefas');
  const [slots, setSlots]             = useState<Slot[]>([]);
  const [tarefas, setTarefas]         = useState<Tarefa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [equipe, setEquipe]           = useState<any[]>([]);
  const [zonas, setZonas]             = useState<string[]>([]);
  const [loading, setLoading]         = useState(true);
  const [gpsStats, setGpsStats]       = useState<TrackingStats | null>(null);
  const [slotAtivo, setSlotAtivo]     = useState<Slot | null>(null);

  // Sub-views
  const [criandoSlot,  setCriandoSlot]  = useState(false);
  const [criandoOcorr, setCriandoOcorr] = useState(false);
  const [tarefaDetalhe, setTarefaDetalhe] = useState<Tarefa | null>(null);
  const [filtroStatus, setFiltroStatus]   = useState<string>('ativos');

  // Carregar zonas disponíveis
  useEffect(() => {
    getDocs(query(collection(db, 'poligonos'), where('cidade', '==', cidade))).then(snap => {
      setZonas(snap.docs.map(d => d.data().nome).filter(Boolean).sort());
    }).catch(() => {});
  }, [cidade]);

  // ── Slots realtime ──
  useEffect(() => {
    if (aba !== 'slots') return;
    setLoading(true);
    // Migração: lê slots do Supabase (polling) quando o flag está ligado.
    if (slotsProviderSupabase()) {
      return subscribeSlots(
        { cidade, isAdmin, cargo: usuario.cargoPrestador },
        s => { setSlots(s as Slot[]); setLoading(false); },
      );
    }
    let q;
    if (isAdmin) {
      q = query(collection(db, 'slots'), where('cidade', '==', cidade), where('pais', '==', pais), orderBy('criadoEm', 'desc'));
    } else {
      q = query(collection(db, 'slots'), where('cidade', '==', cidade), where('cargo', 'in', [usuario.cargoPrestador ?? '', 'scout', 'charger']), orderBy('turnoInicio', 'asc'));
    }
    const unsub = onSnapshot(q, snap => {
      setSlots(snap.docs.map(d => ({ id: d.id, ...d.data() } as Slot)));
      setLoading(false);
    });
    return () => unsub();
  }, [aba, cidade, pais, isAdmin, usuario.cargoPrestador]);

  // ── Tarefas realtime ──
  useEffect(() => {
    if (aba !== 'tarefas') return;
    setLoading(true);
    let q;
    if (isAdmin) {
      q = query(collection(db, 'tarefas'), where('cidade', '==', cidade), where('pais', '==', pais), orderBy('criadoEm', 'desc'));
    } else {
      q = query(collection(db, 'tarefas'), where('assigneeUid', '==', usuario.uid), where('status', 'in', ['pendente', 'aceita', 'em_andamento']), orderBy('rotaOrdem', 'asc'));
    }
    const unsub = onSnapshot(q, snap => {
      setTarefas(snap.docs.map(d => ({ id: d.id, ...d.data() } as Tarefa)));
      setLoading(false);
    });
    return () => unsub();
  }, [aba, cidade, pais, isAdmin, usuario.uid]);

  // ── Ocorrências realtime ──
  useEffect(() => {
    if (aba !== 'ocorrencias') return;
    setLoading(true);
    const q = query(collection(db, 'ocorrencias'), where('cidade', '==', cidade), orderBy('criadoEm', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ocorrencia)));
      setLoading(false);
    });
    return () => unsub();
  }, [aba, cidade]);

  // ── Equipe — carrega sempre que admin abre o módulo (necessário para dropdown de reatribuição) ──
  useEffect(() => {
    if (!isAdmin) return;
    getDocs(query(collection(db, 'usuarios'), where('tipoCadastro', '==', 'prestador'), where('statusPrestador', '==', 'ativo'), where('cidade', '==', cidade)))
      .then(snap => { setEquipe(snap.docs.map(d => ({ id: d.id, ...d.data() }))); });
  }, [isAdmin, cidade]);

  // ── Handlers ──
  const aceitarSlot = useCallback(async (slot: Slot) => {
    if (!slot.id) return;
    if (slotsProviderSupabase()) { await aceitarSlotSupa(slot.id); return; }
    await updateDoc(doc(db, 'slots', slot.id), {
      status: 'aceito', aceitoPor: usuario.uid, aceitoPorNome: usuario.nome,
      aceitoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
    });
    await updateDoc(doc(db, 'usuarios', usuario.uid), { slotAtualId: slot.id, ultimaAtividade: serverTimestamp() }).catch(() => {});
  }, [usuario]);

  const checkIn = useCallback(async (slot: Slot) => {
    if (!slot.id) return;
    const pos = await capturarPosicaoUnica().catch(() => null);
    if (slotsProviderSupabase()) {
      await checkInSlotSupa(slot.id, pos?.lat, pos?.lng, pos?.accuracy);
    } else {
      await updateDoc(doc(db, 'slots', slot.id), {
        status: 'em_andamento', checkInEm: serverTimestamp(),
        checkInLat: pos?.lat ?? null, checkInLng: pos?.lng ?? null,
        checkInAccuracy: pos?.accuracy ?? null, atualizadoEm: serverTimestamp(),
      });
    }
    setSlotAtivo(slot);
    await gpsBackground.iniciar({
      uid: usuario.uid, slotId: slot.id,
      onPosicao: () => {}, onStats: setGpsStats, onErro: msg => console.warn('[GPS]', msg),
    });
  }, [usuario]);

  const checkOut = useCallback(async (slot: Slot) => {
    if (!slot.id) return;
    await gpsBackground.parar();
    setSlotAtivo(null); setGpsStats(null);
    if (slotsProviderSupabase()) { await checkOutSlotSupa(slot.id); return; }
    await updateDoc(doc(db, 'slots', slot.id), { status: 'concluido', checkOutEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
    await updateDoc(doc(db, 'usuarios', usuario.uid), { slotAtualId: null, ultimaAtividade: serverTimestamp() }).catch(() => {});
  }, [usuario.uid]);

  const cancelarSlot = useCallback(async (slot: Slot) => {
    if (!slot.id || !window.confirm('Cancelar este slot?')) return;
    if (slotsProviderSupabase()) { await cancelarSlotSupa(slot.id); return; }
    await updateDoc(doc(db, 'slots', slot.id), { status: 'cancelado', canceladoPor: usuario.uid, atualizadoEm: serverTimestamp() });
  }, [usuario.uid]);

  const reatribuirSlot = useCallback(async (slot: Slot, novoUid: string, novoNome: string) => {
    if (!slot.id) return;
    if (slotsProviderSupabase()) {
      await reatribuirSlotSupa(slot.id, novoUid);
    } else {
      await updateDoc(doc(db, 'slots', slot.id), {
        aceitoPor: novoUid, aceitoPorNome: novoNome,
        status: slot.status === 'aberto' ? 'aceito' : slot.status,
        aceitoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
      });
    }
    // Notificar novo worker via push + Telegram
    try {
      await fnNotificarTarefa()({
        tarefaTitulo: slot.titulo,
        assigneeUid: novoUid,
        cidade: slot.cidade,
        fcmToken: null,
        mensagem: `Você foi atribuído ao slot: ${slot.titulo}`,
      });
    } catch { /* notificação best-effort */ }
  }, []);

  const atualizarTarefa = useCallback(async (id: string, status: string, extra?: Partial<Tarefa>) => {
    await updateDoc(doc(db, 'tarefas', id), { status, ...extra, atualizadoEm: serverTimestamp() });
    // Se concluída, atualiza contagem no slot
    if (status === 'concluida' && extra?.slotId) {
      const slotRef = doc(db, 'slots', extra.slotId as string);
      const slotSnap = await getDoc(slotRef).catch(() => null);
      if (slotSnap?.exists()) {
        const d = slotSnap.data();
        const novasConcluidas = (d.tarefasConcluidas ?? 0) + 1;
        const total = d.tarefasTotal ?? 1;
        await updateDoc(slotRef, { tarefasConcluidas: novasConcluidas, atualizadoEm: serverTimestamp() }).catch(() => {});
      }
    }
  }, []);

  // Filtro de slots
  const slotsFiltrados = slots.filter(s => {
    if (filtroStatus === 'ativos') return !['concluido', 'cancelado'].includes(s.status);
    if (filtroStatus === 'concluidos') return s.status === 'concluido';
    if (filtroStatus === 'automatico') return s.tipoGeracao === 'automatico';
    return true;
  });

  // Badges
  const slotAbertos      = slots.filter(s => s.status === 'aberto').length;
  const tarefasPendentes = tarefas.filter(t => t.status === 'pendente' || t.status === 'em_andamento').length;
  const ocorrAbertas     = ocorrencias.filter(o => o.status === 'aberta').length;

  const abas: { k: Aba; l: string; acesso: boolean; badge?: number }[] = [
    { k: 'slots',       l: '⏰ Slots',         acesso: true,     badge: slotAbertos },
    { k: 'tarefas',     l: '✓ Tarefas',        acesso: true,     badge: tarefasPendentes },
    { k: 'ocorrencias', l: '🚨 Ocorrências',   acesso: true,     badge: ocorrAbertas },
    { k: 'equipe',      l: '👥 Equipe',         acesso: isAdmin },
    { k: 'config_auto', l: '🤖 Auto-slots',     acesso: isAdmin },
    { k: 'historico',   l: '📂 Histórico',      acesso: isAdmin },
  ];

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={S.modal}>

        {/* HEADER */}
        <div style={S.header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#10b981' }}>
              📦 Slots & Logística
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
              {cidade} · {pais} · {isAdmin ? 'Admin/Gestor' : usuario.cargoPrestador ?? usuario.role}
            </div>
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        {/* GPS STATUS — banner proeminente se sem sinal, sutil se ok */}
        {gpsStats && gpsStats.ultimoErro ? (
          <div style={{
            padding: '10px 14px', flexShrink: 0,
            background: 'rgba(239,68,68,.18)',
            borderBottom: '1px solid rgba(239,68,68,.35)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>📵</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#fca5a5' }}>GPS sem sinal</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
                Ative a localização nas configurações do celular
              </div>
            </div>
          </div>
        ) : gpsStats ? (
          <div style={{
            padding: '6px 14px', flexShrink: 0,
            background: 'rgba(16,185,129,.08)',
            borderBottom: '1px solid rgba(16,185,129,.15)',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 10,
          }}>
            <span style={{ color: '#10b981' }}>📡</span>
            <span style={{ color: 'rgba(255,255,255,.6)', flex: 1 }}>GPS {gpsStats.estrategia}</span>
            {/* No serviço nativo o upload roda fora do JS — o contador "pts" não atualiza.
                Mostra "rastreando em 2º plano" para não confundir o operador (ver DEBRIEF §8). */}
            {gpsStats.estrategia.toLowerCase().includes('nativo') ? (
              <span style={{ color: 'rgba(255,255,255,.4)' }}>rastreando em 2º plano</span>
            ) : (
              <span style={{ color: 'rgba(255,255,255,.4)' }}>{gpsStats.pontoEnviados} pts</span>
            )}
            {gpsStats.filaOffline > 0 && <span style={{ color: '#f59e0b' }}>{gpsStats.filaOffline} offline</span>}
          </div>
        ) : null}

        {/* ABAS */}
        <div style={S.tabBar}>
          {abas.filter(a => a.acesso).map(a => {
            const ativo = aba === a.k;
            return (
              <button key={a.k} onClick={() => { setAba(a.k); setCriandoSlot(false); setCriandoOcorr(false); setTarefaDetalhe(null); }} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                background: ativo ? 'rgba(16,185,129,.18)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${ativo ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.08)'}`,
                color: ativo ? '#10b981' : 'rgba(255,255,255,.4)', cursor: 'pointer',
              }}>
                {a.l}
                {(a.badge ?? 0) > 0 && (
                  <span style={{ marginLeft: 5, background: '#10b981', color: '#0d1521', borderRadius: 10, padding: '1px 5px', fontSize: 9, fontWeight: 800 }}>
                    {a.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* BODY */}
        <div style={S.body}>

          {/* ── ABA SLOTS ── */}
          {aba === 'slots' && (
            <div>
              {criandoSlot ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 12 }}>+ Novo Slot</div>
                  <FormCriarSlot
                    cidade={cidade} pais={pais} adminUid={usuario.uid}
                    zonas={zonas} workers={equipe.length > 0 ? equipe : []}
                    onSalvo={() => setCriandoSlot(false)}
                    onCancelar={() => setCriandoSlot(false)}
                  />
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                    {isAdmin && (
                      <button style={S.btn('#10b981')} onClick={() => setCriandoSlot(true)}>+ Novo Slot</button>
                    )}
                    {['ativos', 'concluidos', 'automatico', 'todos'].map(f => (
                      <button key={f} onClick={() => setFiltroStatus(f)} style={{
                        padding: '6px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: filtroStatus === f ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${filtroStatus === f ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.08)'}`,
                        color: filtroStatus === f ? '#10b981' : 'rgba(255,255,255,.4)', cursor: 'pointer',
                      }}>
                        {f === 'ativos' ? 'Ativos' : f === 'concluidos' ? 'Concluídos' : f === 'automatico' ? '🤖 Auto' : 'Todos'}
                      </button>
                    ))}
                  </div>

                  {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ Carregando...</div>}
                  {!loading && slotsFiltrados.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>
                      {isAdmin ? 'Nenhum slot encontrado. Crie um acima.' : 'Nenhum slot disponível para você.'}
                    </div>
                  )}
                  {slotsFiltrados.map(s => (
                    <SlotCard key={s.id} slot={s} isAdmin={isAdmin} operadorUid={usuario.uid}
                      equipe={equipe as any}
                      onAceitar={aceitarSlot} onCheckIn={checkIn} onCheckOut={checkOut}
                      onCancelar={cancelarSlot} onReatribuir={reatribuirSlot} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── ABA TAREFAS ── */}
          {aba === 'tarefas' && (
            <div>
              {isLogistica && !isAdmin && tarefaDetalhe ? (
                <TarefaDetalheView
                  tarefa={tarefaDetalhe}
                  slotTipoSlot={slotAtivo?.tipoSlot}
                  workerUid={usuario.uid}
                  onVoltar={() => setTarefaDetalhe(null)}
                  onAtualizar={async (status, extra) => {
                    await atualizarTarefa(tarefaDetalhe.id!, status, { ...extra, slotId: tarefaDetalhe.slotId });
                    // Recarregar a tarefa atualizada do estado
                    setTarefaDetalhe(prev => prev ? { ...prev, status: status as any, ...extra } : null);
                    if (status === 'concluida' || status === 'cancelada') setTarefaDetalhe(null);
                  }}
                />
              ) : isLogistica && !isAdmin ? (
                <TarefasCampoView tarefas={tarefas} loading={loading} slotAtivo={slotAtivo} workerUid={usuario.uid} onTarefa={setTarefaDetalhe} />
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 12 }}>
                    {isAdmin ? `${tarefas.length} tarefas em ${cidade}` : `${tarefas.length} tarefas atribuídas`}
                  </div>
                  {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ Carregando...</div>}
                  {!loading && tarefas.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>Nenhuma tarefa ativa.</div>
                  )}
                  {!loading && tarefas.map(t => {
                    const tipoSlot: TipoSlot = (t.tipoSlot ?? 'scout') as TipoSlot;
                    const meta = TIPO_SLOT_META[tipoSlot];
                    const statusCor = { pendente: '#f59e0b', em_andamento: '#3b82f6', concluida: '#10b981', cancelada: '#ef4444', aceita: '#06b6d4', rejeitada: '#ef4444' }[t.status] ?? '#6b7280';
                    return (
                      <div key={t.id} style={{ ...S.card }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
                              <span style={S.badge(meta.cor)}>{meta.icone} {meta.l}</span>
                              <span style={S.badge(statusCor)}>{t.status}</span>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>{t.titulo}</div>
                            {t.assigneeNome && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{t.assigneeNome}</div>}
                            {(t.qtdAlvo ?? 0) > 0 && (
                              <ProgressoEntregas concluida={t.qtdConcluida ?? 0} alvo={t.qtdAlvo ?? 0} cor={meta.cor} />
                            )}
                          </div>
                          {isAdmin && t.status !== 'concluida' && t.status !== 'cancelada' && (
                            <select value={t.status} style={{ ...S.inp, width: 'auto', fontSize: 10, padding: '3px 6px', colorScheme: 'dark' }}
                              onChange={async e => { if (t.id) await atualizarTarefa(t.id, e.target.value); }}
                              onClick={e => e.stopPropagation()}>
                              {['pendente','aceita','em_andamento','concluida','cancelada'].map(s => (
                                <option key={s} value={s} style={{ background: '#0d1521' }}>{s}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── ABA OCORRÊNCIAS ── */}
          {aba === 'ocorrencias' && (
            <div>
              {criandoOcorr ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 12 }}>🚨 Nova Ocorrência</div>
                  <FormOcorrencia usuario={usuario} cidade={cidade} pais={pais}
                    onSalvo={() => setCriandoOcorr(false)} onCancelar={() => setCriandoOcorr(false)} />
                </div>
              ) : (
                <>
                  <button style={{ ...S.btn('#ef4444'), marginBottom: 14 }} onClick={() => setCriandoOcorr(true)}>
                    + Registrar Ocorrência
                  </button>
                  {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ Carregando...</div>}
                  {!loading && ocorrencias.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>Nenhuma ocorrência aberta.</div>
                  )}
                  {ocorrencias.map(oc => {
                    const statusCor = oc.status === 'aberta' ? '#ef4444' : oc.status === 'em_tratamento' ? '#f59e0b' : '#10b981';
                    return (
                      <div key={oc.id} style={{ ...S.card, border: `1px solid ${statusCor}20`, background: `${statusCor}06` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div>
                            <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
                              <span style={S.badge(statusCor)}>{oc.status}</span>
                              {oc.procurando && <span style={S.badge('#ef4444')}>🔍 Procurando</span>}
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>
                              {OCORRENCIAS_TIPOS.find(o => o.k === oc.tipo)?.l ?? oc.tipo}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
                              {oc.registradoPorNome}{oc.patineteId && ` · ${oc.patineteId}`}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 4 }}>{oc.descricao}</div>
                          </div>
                          {isAdmin && oc.status !== 'resolvida' && (
                            <select value={oc.status} style={{ ...S.inp, width: 'auto', fontSize: 10, padding: '3px 6px', colorScheme: 'dark' }}
                              onChange={async e => {
                                if (oc.id) await updateDoc(doc(db, 'ocorrencias', oc.id), { status: e.target.value, atualizadoEm: serverTimestamp() });
                              }}
                              onClick={e => e.stopPropagation()}>
                              {['aberta','em_tratamento','resolvida','arquivada'].map(s => (
                                <option key={s} value={s} style={{ background: '#0d1521' }}>{s}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── ABA EQUIPE ── */}
          {aba === 'equipe' && isAdmin && (
            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginBottom: 14 }}>Prestadores ativos em {cidade}</div>
              {loading && <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, textAlign: 'center', padding: 20 }}>⏳ Carregando...</div>}
              {!loading && equipe.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)', fontSize: 13 }}>Nenhum prestador ativo em {cidade}.</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {equipe.map(u => {
                  const tipoSlot: TipoSlot = u.cargoPrestador === 'charger' ? 'charger' : 'scout';
                  const meta = TIPO_SLOT_META[tipoSlot];
                  const temSlot = !!u.slotAtualId;
                  return (
                    <div key={u.id} style={{ ...S.card, border: `1px solid ${meta.cor}20`, background: `${meta.cor}06` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 16, background: meta.cor + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                          {meta.icone}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>{u.nome}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{u.cargoPrestador} · {u.tipoContrato}</div>
                        </div>
                      </div>
                      <span style={S.badge(temSlot ? '#06b6d4' : '#6b7280')}>{temSlot ? '⚡ Em slot' : 'Disponível'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── ABA CONFIG AUTO-SLOTS ── */}
          {aba === 'config_auto' && isAdmin && (
            <ConfigAutoSlotsPanel cidade={cidade} pais={pais} adminUid={usuario.uid} zonas={zonas} />
          )}

          {aba === 'historico' && isAdmin && (
            <HistoricoSlotsPanel slots={slots} tarefas={tarefas} />
          )}

        </div>
      </div>
    </div>
  );
}
