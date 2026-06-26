// TurnoRegistro.tsx — Registro de turno para trabalhadores CLT
// Feature portada do V2 shift-register-screen.tsx → Firebase/Firestore
//
// Fluxo:
//   1. Worker abre o painel
//   2. Seleciona função (motorista/scout/charger/clt) e turno (T0/T1/T2)
//   3. Tira foto obrigatória
//   4. Confirma → grava em /turnos/{uid}_{timestamp}
//   5. Status "trabalhando" ativo até registrar saída

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, addDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, Timestamp, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem, capturarFotoNativa } from '../lib/imageUtils';
import { isAndroidNative } from '../lib/gps-native';
import { capturarPosicaoUnica } from '../lib/gps-background';

// Compressão HEIC-safe (ver lib/imageUtils). Converte HEIC→JPEG antes de comprimir,
// evitando o bug de foto "quebrada" (HEIC enviado como .jpg que o WebView não renderiza).
async function comprimir(file: File, maxW = 1280, q = 0.82): Promise<File> {
  try {
    return await comprimirImagem(file, maxW, q);
  } catch (e) {
    console.warn('[comprimir] falha ao processar imagem, enviando original', e);
    return file;
  }
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TurnoFuncao = 'motorista' | 'scout' | 'charger' | 'clt' | 'fiscal' | 'seguranca';
export type TurnoId    = 'T0' | 'T1' | 'T2';
export type TurnoAcao  = 'entrada' | 'saida';

export interface TurnoRecord {
  id?: string;
  uid: string;
  nome: string;
  acao: TurnoAcao;
  funcao: TurnoFuncao;
  turno: TurnoId;
  fotoUrl?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  cidade: string;
  registradoEm: any;
  aberto: boolean; // true enquanto não há saída correspondente
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const FUNCOES: { id: TurnoFuncao; label: string; emoji: string }[] = [
  { id: 'motorista', label: 'Motorista',  emoji: '🚗' },
  { id: 'scout',     label: 'Scout',      emoji: '🛵' },
  { id: 'charger',   label: 'Charger',    emoji: '⚡' },
  { id: 'clt',       label: 'CLT',        emoji: '👷' },
  { id: 'fiscal',    label: 'Fiscal',     emoji: '🔍' },
  { id: 'seguranca', label: 'Segurança',  emoji: '🛡' },
];

const TURNOS: { id: TurnoId; label: string; horario: string }[] = [
  { id: 'T0', label: 'Turno T0', horario: '06h–14h' },
  { id: 'T1', label: 'Turno T1', horario: '14h–22h' },
  { id: 'T2', label: 'Turno T2', horario: '22h–06h' },
];

const COR_FUNCAO: Record<TurnoFuncao, string> = {
  motorista: '#06b6d4', scout: '#f59e0b', charger: '#22c55e',
  clt: '#a78bfa', fiscal: '#f97316', seguranca: '#ef4444',
};

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  uid: string;
  nome: string;
  cidade: string;
  role: string;
  visivel: boolean;
  onFechar: () => void;
}

export default function TurnoRegistro({ uid, nome, cidade, role, visivel, onFechar }: Props) {
  const [turnoAberto, setTurnoAberto] = useState<TurnoRecord | null>(null);
  const [funcao, setFuncao]           = useState<TurnoFuncao>('motorista');
  const [turno, setTurno]             = useState<TurnoId>('T1');
  const [fotoBase64, setFotoBase64]   = useState<string | null>(null);
  const [fotoBlob, setFotoBlob]       = useState<Blob | null>(null);
  const [gps, setGps]                 = useState<{lat:number;lng:number;accuracy:number} | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [salvando, setSalvando]       = useState(false);
  const [msg, setMsg]                 = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  // Carrega turno aberto (se houver)
  useEffect(() => {
    if (!uid || !visivel) return;
    const q = query(
      collection(db, 'turnos'),
      where('uid', '==', uid),
      where('aberto', '==', true),
      orderBy('registradoEm', 'desc'),
      limit(1),
    );
    return onSnapshot(q, snap => {
      setTurnoAberto(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as TurnoRecord));
    });
  }, [uid, visivel]);

  // Captura GPS ao abrir
  useEffect(() => {
    if (!visivel) return;
    setBuscandoGps(true);
    capturarPosicaoUnica().then(pos => {
      if (pos) setGps({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
      setBuscandoGps(false);
    });
  }, [visivel]);

  const processarFoto = useCallback(async (file: File) => {
    const comp = await comprimir(file); // HEIC→JPEG + compressão antes de guardar/enviar
    setFotoBlob(comp);
    const reader = new FileReader();
    reader.onload = ev => setFotoBase64(ev.target?.result as string);
    reader.readAsDataURL(comp);
  }, []);

  const handleFoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processarFoto(file);
  }, [processarFoto]);

  // Abre a câmera: no app nativo usa a câmera do Capacitor (JPEG garantido);
  // na web cai no <input capture> como antes.
  const abrirCamera = useCallback(async () => {
    if (isAndroidNative()) {
      let f: File | null = null;
      try { f = await capturarFotoNativa(); } catch {}
      if (f) { await processarFoto(f); return; }
    }
    fotoRef.current?.click();
  }, [processarFoto]);

  const registrar = useCallback(async (acao: TurnoAcao) => {
    if (!fotoBlob && acao === 'entrada') { setMsg('Tire uma foto para confirmar a entrada'); return; }
    setSalvando(true); setMsg('');
    try {
      let fotoUrl: string | undefined;
      if (fotoBlob) {
        const path = `turnos/${uid}/${Date.now()}.jpg`;
        fotoUrl = await uploadComRetry(fotoBlob, path);
      }

      // Fecha turno aberto se houver
      if (acao === 'saida' && turnoAberto?.id) {
        await updateDoc(doc(db, 'turnos', turnoAberto.id), {
          aberto: false,
          saidaEm: serverTimestamp(),
          fotoSaidaUrl: fotoUrl,
          latSaida: gps?.lat, lngSaida: gps?.lng,
        });
        setMsg('✓ Saída registrada');
      } else {
        await addDoc(collection(db, 'turnos'), {
          uid, nome, acao, funcao, turno,
          fotoUrl,
          lat: gps?.lat, lng: gps?.lng, accuracy: gps?.accuracy,
          cidade, registradoEm: serverTimestamp(), aberto: true,
        } satisfies Omit<TurnoRecord, 'id'>);
        setMsg('✓ Entrada registrada');
      }
      setFotoBase64(null); setFotoBlob(null);
      setTimeout(() => { setMsg(''); onFechar(); }, 1500);
    } catch (e: any) {
      setMsg('Erro: ' + e.message);
    } finally { setSalvando(false); }
  }, [fotoBlob, uid, nome, funcao, turno, gps, cidade, turnoAberto, onFechar]);

  if (!visivel) return null;

  const S = {
    overlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,.7)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
    box:     { background:'#1a1f2e', border:'1px solid rgba(255,255,255,.1)', borderRadius:16, padding:24, width:'100%', maxWidth:440, maxHeight:'90vh', overflowY:'auto' as const },
    h:       { fontSize:16, fontWeight:700, color:'#fff', marginBottom:4 },
    sub:     { fontSize:11, color:'rgba(255,255,255,.4)', marginBottom:16 },
    grid:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 },
    chip:    (active:boolean, cor:string) => ({
               padding:'8px 10px', borderRadius:8, border:`1px solid ${active ? cor : 'rgba(255,255,255,.1)'}`,
               background: active ? cor+'22' : 'rgba(255,255,255,.03)', color: active ? cor : 'rgba(255,255,255,.5)',
               cursor:'pointer', fontSize:12, fontWeight: active?700:400, textAlign:'center' as const,
             }),
    btn: (c:string) => ({ padding:'11px 0', borderRadius:10, border:'none', background:c, color:'#fff',
                          fontWeight:700, fontSize:14, cursor:'pointer', width:'100%', marginBottom:8 }),
    fotoBox: { border:'2px dashed rgba(255,255,255,.15)', borderRadius:10, padding:12, textAlign:'center' as const,
               cursor:'pointer', marginBottom:16 },
  };

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={S.box}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <div style={S.h}>⏱ Registro de Turno</div>
            <div style={S.sub}>{nome} • {cidade}</div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:18, cursor:'pointer' }}>✕</button>
        </div>

        {/* Status do turno aberto */}
        {turnoAberto && (
          <div style={{ background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)', borderRadius:10, padding:'10px 14px', marginBottom:16 }}>
            <div style={{ fontSize:12, color:'#22c55e', fontWeight:700 }}>✓ Turno em andamento</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.5)', marginTop:2 }}>
              {turnoAberto.funcao} • {turnoAberto.turno} • desde {
                turnoAberto.registradoEm?.toDate
                  ? new Date(turnoAberto.registradoEm.toDate()).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})
                  : '—'
              }
            </div>
          </div>
        )}

        {!turnoAberto && (
          <>
            {/* Função */}
            <div style={{ fontSize:11, color:'rgba(255,255,255,.4)', marginBottom:8 }}>Função</div>
            <div style={S.grid}>
              {FUNCOES.map(f => (
                <div key={f.id} style={S.chip(funcao===f.id, COR_FUNCAO[f.id])} onClick={() => setFuncao(f.id)}>
                  {f.emoji} {f.label}
                </div>
              ))}
            </div>

            {/* Turno */}
            <div style={{ fontSize:11, color:'rgba(255,255,255,.4)', marginBottom:8 }}>Turno</div>
            <div style={{ display:'flex', gap:8, marginBottom:16 }}>
              {TURNOS.map(t => (
                <div key={t.id} style={{ ...S.chip(turno===t.id,'#a78bfa'), flex:1 }} onClick={() => setTurno(t.id)}>
                  <div style={{ fontWeight:700 }}>{t.id}</div>
                  <div style={{ fontSize:9 }}>{t.horario}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Foto */}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={handleFoto} />
        <div style={S.fotoBox} onClick={abrirCamera}>
          {fotoBase64
            ? <img src={fotoBase64} style={{ width:'100%', maxHeight:180, objectFit:'cover', borderRadius:8 }} alt="foto" />
            : <div style={{ color:'rgba(255,255,255,.3)', fontSize:12 }}>📷 Toque para tirar foto{!turnoAberto ? ' de entrada' : ' de saída'}</div>
          }
        </div>

        {/* GPS */}
        <div style={{ fontSize:10, color: gps ? '#22c55e' : 'rgba(255,255,255,.3)', marginBottom:12 }}>
          {buscandoGps ? '📡 Buscando GPS...'
            : gps ? `📍 GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${Math.round(gps.accuracy)}m)`
            : '⚠ GPS indisponível'}
        </div>

        {msg && (
          <div style={{ fontSize:12, color: msg.startsWith('✓') ? '#22c55e' : '#ef4444', marginBottom:10, textAlign:'center' }}>
            {msg}
          </div>
        )}

        {/* Ações */}
        {!turnoAberto ? (
          <button style={S.btn('#22c55e')} disabled={salvando || !fotoBase64} onClick={() => registrar('entrada')}>
            {salvando ? '⏳ Registrando...' : '▶ Registrar Entrada'}
          </button>
        ) : (
          <button style={S.btn('#ef4444')} disabled={salvando} onClick={() => registrar('saida')}>
            {salvando ? '⏳ Registrando...' : '⏹ Registrar Saída'}
          </button>
        )}

        <button onClick={onFechar} style={{ padding:'8px 0', borderRadius:10, border:'1px solid rgba(255,255,255,.1)', background:'none', color:'rgba(255,255,255,.4)', fontSize:12, cursor:'pointer', width:'100%' }}>
          Fechar
        </button>
      </div>
    </div>
  );
}
