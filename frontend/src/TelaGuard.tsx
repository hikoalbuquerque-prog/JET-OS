// src/TelaGuard.tsx — Tela mobile-first para registro de ocorrências JET Guard
import { useState, useEffect, useRef, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import {
  collection, addDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, Timestamp, doc, updateDoc, arrayUnion
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { uploadComRetry } from './lib/uploadUtils';
import { comprimirImagem, capturarFotoNativa } from './lib/imageUtils';
import { capturarPosicaoUnica } from './lib/gps-background';
import { isAndroidNative } from './lib/gps-native';
import { guardProviderSupabase, carregarMinhasOcorrenciasSupabase, guardWriteSupabase, criarOcorrenciaSupabase, atualizarOcorrenciaSupabase, deletarOcorrenciaSupabase } from './lib/ocorrencias-supabase';

// ── TIPOS ─────────────────────────────────────────────────────────
interface Ocorrencia {
  id: string;
  tipo: string;
  descricao: string;
  lat_inicial?: number;
  lng_inicial?: number;
  estacaoId?: string;
  ativo_tipo?: string;
  turno: string;
  status: 'Aberto' | 'Em apuração' | 'Recuperado' | 'Encerrado';
  prioridade: 'Baixa' | 'Media' | 'Alta' | 'Critica';
  foto1_url?: string;
  foto2_url?: string;
  bo_numero?: string;
  bo_url?: string;
  registradoPor: string;
  registradoPorNome: string;
  cidade_inicial: string;
  bairro_inicial: string;
  endereco_inicial: string;
  origem_registro: string;
  criadoEm: any;
  dataManual?: string;
  asset_id?: string;
  procurando?: string;
  cargo?: string;
  danoPct?: number;
  danoValor?: number;
  historico?: Array<{ts: any; usuario: string; nomeUsuario: string; campo: string; de: string; para: string}>;
  observacao_fechamento?: string;
  resultado?: string;
}

interface Props {
  usuario: { uid: string; email: string; nome: string; role: string; paises: string[] };
  onLogout: () => void;
  onVoltarMapa?: () => void;
}

// ── ENUMS ─────────────────────────────────────────────────────────
// Keys fixas (salvas no DB) — labels traduzidos dentro do componente
const TIPOS_KEYS = [
  { key: 'Roubo',      emoji: '🔴', cor: '#ef4444', tk: 'guard.robbery'   },
  { key: 'Tentativa',  emoji: '🟠', cor: '#f97316', tk: 'guard.attempt'   },
  { key: 'Vandalismo', emoji: '🟡', cor: '#eab308', tk: 'guard.vandalism' },
  { key: 'Recuperacao',emoji: '🟢', cor: '#22c55e', tk: 'guard.recovery'  },
  { key: 'Perda',      emoji: '🟣', cor: '#a855f7', tk: 'guard.loss'      },
  { key: 'Outro',      emoji: '⚪', cor: '#6b7280', tk: 'guard.other'     },
];

const ATIVOS_KEYS = ['Patinete', 'Bicicleta', 'Bateria'];
const TURNOS_KEYS = ['shiftMorning', 'shiftAfternoon', 'shiftNight'];

const STATUS_COR: Record<string, string> = {
  'Aberto':      '#ef4444',
  'Em apuração': '#f97316',
  'Recuperado':  '#22c55e',
  'Encerrado':   '#6b7280',
};

function turnoAtual(): string {
  const h = new Date().getHours();
  if (h >= 6  && h < 14) return TURNOS_KEYS[0];
  if (h >= 14 && h < 22) return TURNOS_KEYS[1];
  return TURNOS_KEYS[2];
}

// ── HELPERS ───────────────────────────────────────────────────────
function fmtData(ts: any, dataManual?: string): string {
  if (dataManual) {
    const d = new Date(dataManual);
    if (!isNaN(d.getTime()))
      return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  if (!ts) return '';
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function nowDatetimeLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function generateId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand  = Math.floor(Math.random() * 900 + 100);
  return 'JET-SEC-' + stamp + '-' + rand;
}

async function reverseGeocode(lat: number, lng: number): Promise<{ endereco: string; bairro: string; cidade: string }> {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&accept-language=pt-BR';
    const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();
    const addr = data.address || {};
    return {
      endereco: [addr.road, addr.house_number].filter(Boolean).join(', ') || '',
      bairro:   addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || '',
      cidade:   addr.city   || addr.town          || addr.municipality || '',
    };
  } catch {
    return { endereco: '', bairro: '', cidade: '' };
  }
}

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

async function uploadFotoStorage(file: File, path: string): Promise<string> {
  const comp = await comprimir(file);
  return uploadComRetry(comp, path);
}

// ── BOTÃO DE FOTO — câmera OU galeria ────────────────────────────
function BotaoFoto({ slot, preview, onArquivo, onRemover }: {
  slot: number;
  preview: string;
  onArquivo: (f: File) => void;
  onRemover: () => void;
}) {
  const { t } = useTranslation();
  const cameraRef  = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);

  const pick = (e: React.ChangeEvent<HTMLInputElement>, r: React.RefObject<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onArquivo(f);
    if (r.current) r.current.value = '';
  };

  if (preview) {
    return (
      <div style={{ position: 'relative' }}>
        <img src={preview} alt={'Foto ' + slot}
          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, display: 'block' }} />
        <button onClick={onRemover} style={{
          position: 'absolute', top: 6, right: 6,
          background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%',
          color: '#fff', width: 26, height: 26, fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input ref={cameraRef}  type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={e => pick(e, cameraRef)} />
      <input ref={galeriaRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => pick(e, galeriaRef)} />
      <button onClick={async () => {
        if (isAndroidNative()) {
          try {
            const f = await capturarFotoNativa();
            if (f) onArquivo(f);
            // f === null => usuário cancelou; não abre o input
            return;
          } catch { /* plugin indisponível: cai no fallback do input abaixo */ }
        }
        cameraRef.current?.click();
      }} style={{
        padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13,
        background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
        color: 'rgba(255,255,255,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      } as React.CSSProperties}>{t('drawer.camera')}</button>
      <button onClick={() => galeriaRef.current?.click()} style={{
        padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 13,
        background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
        color: 'rgba(255,255,255,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      } as React.CSSProperties}>{t('drawer.gallery')}</button>
      <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 10, textAlign: 'center' }}>{t('guard.photo1').replace('1', String(slot))}</span>
    </div>
  );
}

// ── MODAL EDITAR / FECHAR OCORRÊNCIA ─────────────────────────────
function ModalEdicao({ ocorrencia, onFechar, onSalvo, showToast, roleUsuario = 'guard' }: {
  ocorrencia: Ocorrencia;
  onFechar: () => void;
  onSalvo: () => void;
  showToast: (msg: string, tipo?: 'ok' | 'erro' | 'info') => void;
  roleUsuario?: string;
}) {
  const statusOpcoes: Ocorrencia['status'][] = ['Aberto', 'Em apuração', 'Recuperado', 'Encerrado'];
  const { t } = useTranslation();
  const TIPOS  = TIPOS_KEYS.map(tp => ({ ...tp, label: t(tp.tk) }));
  const TURNOS = TURNOS_KEYS.map(k => t('guard.' + k));
  const podeExcluir = ['admin','gestor'].includes(roleUsuario);

  // Todos os campos editáveis
  const [tipo,      setTipo]      = useState(() => {
    const t = ocorrencia.tipo || '';
    // Normalize to canonical key regardless of case or translation
    const match = TIPOS_KEYS.find(k => k.key.toLowerCase() === t.toLowerCase());
    return match ? match.key : t;
  });
  const [status,    setStatus]    = useState<Ocorrencia['status']>(ocorrencia.status);
  const [assetId,   setAssetId]   = useState(ocorrencia.asset_id || '');
  const [ativoTipo, setAtivoTipo] = useState((ocorrencia as any).ativo_tipo || 'Patinete');
  const [descricao, setDescricao] = useState(ocorrencia.descricao || '');
  const [turno,     setTurno]     = useState(ocorrencia.turno || TURNOS_KEYS[0]);
  const [procurando,setProcurando]= useState((ocorrencia as any).procurando || '');
  const [danoPct,   setDanoPct]   = useState<string>(String(ocorrencia.danoPct ?? ''));
  const [danoValor, setDanoValor] = useState<string>(String(ocorrencia.danoValor ?? ''));
  const [estacaoId, setEstacaoId] = useState(ocorrencia.estacaoId || '');
  const [obs,       setObs]       = useState(ocorrencia.observacao_fechamento || '');
  const [boNum,     setBoNum]     = useState(ocorrencia.bo_numero || '');
  const [boPreview, setBoPreview] = useState(ocorrencia.bo_url || '');
  const [boFile,    setBoFile]    = useState<File | null>(null);
  // Localização
  const [lat,       setLat]       = useState(String(ocorrencia.lat_inicial || ''));
  const [lng,       setLng]       = useState(String(ocorrencia.lng_inicial || ''));
  const [endereco,  setEndereco]  = useState(ocorrencia.endereco_inicial || '');
  const [bairro,    setBairro]    = useState(ocorrencia.bairro_inicial || '');
  const [cidade,    setCidade]    = useState(ocorrencia.cidade_inicial || '');
  // Data
  const toDateStr = (ts: any) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toISOString().slice(0,16);
  };
  const [dataOcorr, setDataOcorr] = useState(
    ocorrencia.dataManual || toDateStr(ocorrencia.criadoEm)
  );
  const [busy,      setBusy]      = useState(false);
  const [showLoc,   setShowLoc]   = useState(false);

  const boRef    = useRef<HTMLInputElement>(null);
  const boGalRef = useRef<HTMLInputElement>(null);

  const handleBoFile = (f: File) => {
    setBoFile(f);
    const reader = new FileReader();
    reader.onload = e => setBoPreview((e.target?.result as string) || '');
    reader.readAsDataURL(f);
  };

  const buscarGPS = () => {
    capturarPosicaoUnica().then(pos => {
      if (pos) {
        setLat(String(pos.lat.toFixed(6)));
        setLng(String(pos.lng.toFixed(6)));
        showToast('GPS atualizado', 'ok');
      } else {
        showToast('GPS indisponível', 'erro');
      }
    });
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)',
    borderRadius: 10, color: '#fff', fontSize: 13, outline: 'none',
  };

  const lbl: React.CSSProperties = {
    color: 'rgba(255,255,255,.4)', fontSize: 10, fontWeight: 600,
    letterSpacing: '.06em', display: 'block', marginBottom: 5,
  };

  const salvar = async () => {
    if ((status === 'Encerrado' || status === 'Recuperado') && !obs.trim()) {
      showToast('Adicione uma observação de fechamento', 'erro');
      return;
    }
    setBusy(true);
    try {
      let boUrl = ocorrencia.bo_url || '';
      if (boFile) {
        const ext = boFile.name.split('.').pop() || 'jpg';
        boUrl = await uploadFotoStorage(boFile, 'ocorrencias/bo_' + ocorrencia.id + '.' + ext);
      }
      const update: Record<string,any> = {
        tipo,
        status,
        asset_id:              assetId.trim(),
        ativo_tipo:            ativoTipo,
        descricao:             descricao.trim(),
        turno,
        procurando:            procurando.trim(),
        estacaoId:             estacaoId.trim(),
        danoPct:               tipo.toLowerCase() === 'vandalismo' && danoPct.trim() !== '' ? Number(danoPct) : null,
        danoValor:             tipo.toLowerCase() === 'vandalismo' && danoValor.trim() !== '' ? Number(danoValor.replace(',','.')) : null,
        observacao_fechamento: obs.trim(),
        bo_numero:             boNum.trim(),
        bo_url:                boUrl,
        updated_at:            serverTimestamp(),
      };
      // Localização (só atualiza se preenchida)
      if (lat && lng) {
        update.lat_inicial = parseFloat(lat);
        update.lng_inicial = parseFloat(lng);
      }
      if (endereco) update.endereco_inicial = endereco.trim();
      if (bairro)   update.bairro_inicial   = bairro.trim();
      if (cidade)   update.cidade_inicial   = cidade.trim();
      // Data/hora manual (se modificada pelo usuário)
      if (dataOcorr) {
        update.dataManual = dataOcorr;
      }
      // Log quem editou
      update.ultimoEditor = ocorrencia.registradoPor || '';
      update.ultimoEditorNome = ocorrencia.registradoPorNome || '';
      // Histórico de alterações
      const agoraTs = serverTimestamp();
      const entradas: any[] = [];
      const checar = (campo: string, de: string, para: string) => {
        if (String(de).trim() !== String(para).trim())
          entradas.push({ ts: agoraTs, usuario: ocorrencia.registradoPor, nomeUsuario: ocorrencia.registradoPorNome, campo, de: String(de), para: String(para) });
      };
      checar('status',    ocorrencia.status,            status);
      checar('tipo',      ocorrencia.tipo,              tipo);
      checar('asset_id',  ocorrencia.asset_id || '',    assetId.trim());
      checar('procurando',(ocorrencia.procurando || ''),procurando.trim());
      checar('bo_numero', ocorrencia.bo_numero || '',   boNum.trim());
      checar('danoPct',   String(ocorrencia.danoPct ?? ''), danoPct.trim());
      checar('danoValor', String(ocorrencia.danoValor ?? ''), danoValor.trim());
      checar('data',      ocorrencia.dataManual || toDateStr(ocorrencia.criadoEm), dataOcorr);
      if (entradas.length > 0) {
        update.historico = arrayUnion(...entradas);
      }

      await updateDoc(doc(db, 'ocorrencias', ocorrencia.id), update);
      if (guardWriteSupabase()) {
        atualizarOcorrenciaSupabase(ocorrencia.id, update)
          .catch(err => console.error('[guard-write] update Supabase falhou:', err));
      }

      // Notificação Telegram ao recuperar
      if ((status === 'Recuperado' || status === 'Encerrado') &&
          (['roubo','vandalismo','tentativa'].includes(tipo.toLowerCase())) &&
          ocorrencia.status !== status) {
        try {
          const { functionsProviderSupabase, getEdgeCallable } = await import('./lib/edge-functions');
          let fn: any;
          if (functionsProviderSupabase()) {
            const edge = getEdgeCallable('notificarOcorrencia');
            fn = edge ? edge() : null;
          }
          if (!fn) {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const { getApp } = await import('firebase/app');
            fn = httpsCallable(getFunctions(getApp(), 'southamerica-east1'), 'notificarOcorrencia');
          }
          fn({ ocorrenciaId: ocorrencia.id, statusAtualizado: status }).catch(() => {});
        } catch { /* best-effort */ }
      }

      showToast('Ocorrência atualizada!', 'ok');
      onSalvo();
    } catch (e: any) {
      console.error('[ModalEdicao]', e);
      const msg = e?.code === 'permission-denied' ? 'Sem permissão.'
        : e?.message ? `Erro: ${e.message}` : 'Erro ao salvar.';
      showToast(msg, 'erro');
    }
    setBusy(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      display: 'flex', alignItems: 'flex-end',
      background: 'rgba(0,0,0,.75)', fontFamily: 'Inter,sans-serif',
    }} onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{
        width: '100%', maxWidth: 480, margin: '0 auto',
        background: '#0d1220', borderRadius: '18px 18px 0 0',
        border: '1px solid rgba(167,139,250,.2)',
        padding: '20px 18px 36px',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ color:'#a78bfa', fontWeight:700, fontSize:16 }}>✏️ Editar ocorrência</div>
            <div style={{ color:'rgba(255,255,255,.3)', fontSize:11, marginTop:2 }}>
              ID: {ocorrencia.id}
            </div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:'none',
            color:'rgba(255,255,255,.4)', fontSize:22, cursor:'pointer' }}>✕</button>
        </div>

        {/* Tipo */}
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>TIPO DE OCORRÊNCIA</label>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
            {TIPOS.map(tp => (
              <button key={tp.key} onClick={() => setTipo(tp.key)}
                style={{ padding:'6px 10px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                  background: tipo===tp.key ? tp.cor+'22' : 'rgba(255,255,255,.04)',
                  border:`1px solid ${tipo===tp.key ? tp.cor+'55' : 'rgba(255,255,255,.08)'}`,
                  color: tipo===tp.key ? tp.cor : 'rgba(255,255,255,.4)' }}>
                {tp.emoji} {tp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>STATUS</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {statusOpcoes.map(s => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding:'9px 8px', borderRadius:10, cursor:'pointer', fontSize:12,
                background: status===s ? (STATUS_COR[s]||'#fff')+'20' : 'rgba(255,255,255,.04)',
                border:`1px solid ${status===s ? (STATUS_COR[s]||'#fff')+'50' : 'rgba(255,255,255,.08)'}`,
                color: status===s ? (STATUS_COR[s]||'#fff') : 'rgba(255,255,255,.4)',
                fontWeight: status===s ? 700 : 400,
              } as React.CSSProperties}>{s}</button>
            ))}
          </div>
        </div>

        {/* Ativo */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
          <div>
            <label style={lbl}>TIPO DE ATIVO</label>
            <select value={ativoTipo} onChange={e=>setAtivoTipo(e.target.value)} style={{ ...inp, cursor:'pointer' }}>
              {ATIVOS_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>ID / PLACA DO ATIVO</label>
            <input value={assetId} onChange={e=>setAssetId(e.target.value)}
              placeholder="JET-001234" style={inp} />
          </div>
        </div>

        {/* Procurando */}
        {(tipo.toLowerCase() === 'roubo' || tipo.toLowerCase() === 'tentativa') && (
          <div style={{ marginBottom:14, padding:'10px 12px', borderRadius:10,
            background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.15)' }}>
            <label style={{ ...lbl, color:'#f87171' }}>PROCURANDO</label>
            <input value={procurando} onChange={e=>setProcurando(e.target.value)}
              placeholder="Descrição do ativo procurado..." style={{ ...inp,
                borderColor:'rgba(239,68,68,.2)' }} />
          </div>
        )}

        {/* Dano da oficina — só Vandalismo */}
        {tipo.toLowerCase() === 'vandalismo' && (
          <div style={{ marginBottom:14, padding:'12px 14px', borderRadius:10,
            background:'rgba(234,179,8,.05)', border:'1px solid rgba(234,179,8,.2)' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#fbbf24',
              textTransform:'uppercase', letterSpacing:'.8px', marginBottom:10 }}>
              🔧 Avaliação da oficina
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div>
                <label style={{ ...lbl, color:'#fbbf24' }}>% DANO</label>
                <div style={{ position:'relative' }}>
                  <input type="number" min="0" max="100" step="1"
                    value={danoPct} onChange={e => setDanoPct(e.target.value)}
                    placeholder="0"
                    style={{ ...inp, borderColor:'rgba(234,179,8,.25)', paddingRight:28 }}
                  />
                  <span style={{ position:'absolute', right:10, top:'50%',
                    transform:'translateY(-50%)', color:'rgba(255,255,255,.4)',
                    fontSize:12, pointerEvents:'none' as const }}>%</span>
                </div>
                {danoPct && !isNaN(Number(danoPct)) && (
                  <div style={{ marginTop:4 }}>
                    <div style={{ height:4, background:'rgba(255,255,255,.08)', borderRadius:2 }}>
                      <div style={{ height:4, borderRadius:2, transition:'width .3s',
                        width:`${Math.min(100,Number(danoPct))}%`,
                        background: Number(danoPct) >= 75 ? '#ef4444'
                          : Number(danoPct) >= 40 ? '#f97316' : '#fbbf24' }}/>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label style={{ ...lbl, color:'#fbbf24' }}>VALOR R$</label>
                <div style={{ position:'relative' }}>
                  <span style={{ position:'absolute', left:10, top:'50%',
                    transform:'translateY(-50%)', color:'rgba(255,255,255,.4)',
                    fontSize:12, pointerEvents:'none' as const }}>R$</span>
                  <input type="number" min="0" step="0.01"
                    value={danoValor} onChange={e => setDanoValor(e.target.value)}
                    placeholder="0,00"
                    style={{ ...inp, borderColor:'rgba(234,179,8,.25)', paddingLeft:30 }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Descrição */}
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>DESCRIÇÃO</label>
          <textarea value={descricao} onChange={e=>setDescricao(e.target.value)}
            rows={2} style={{ ...inp, resize:'none' as const }} />
        </div>

        {/* Turno + Estação */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
          <div>
            <label style={lbl}>TURNO</label>
            <select value={turno} onChange={e=>setTurno(e.target.value)} style={{ ...inp, cursor:'pointer' }}>
              {TURNOS_KEYS.map((k,i) => <option key={k} value={k}>{TURNOS[i]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>ID DA ESTAÇÃO</label>
            <input value={estacaoId} onChange={e=>setEstacaoId(e.target.value)}
              placeholder="Opcional" style={inp} />
          </div>
        </div>

        {/* Data/hora */}
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>DATA / HORA DA OCORRÊNCIA</label>
          <input type="datetime-local" value={dataOcorr}
            onChange={e=>setDataOcorr(e.target.value)}
            style={{ ...inp, colorScheme:'dark' as any }} />
          <div style={{ fontSize:9, color:'rgba(255,255,255,.25)', marginTop:4 }}>
            Alterar registra a data manual. A data original é preservada nos logs.
          </div>
        </div>

        {/* Localização */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <label style={{ ...lbl, marginBottom:0 }}>LOCALIZAÇÃO</label>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={buscarGPS}
                style={{ fontSize:10, padding:'3px 8px', borderRadius:6, cursor:'pointer',
                  background:'rgba(59,130,246,.15)', border:'1px solid rgba(59,130,246,.3)',
                  color:'#60a5fa' }}>
                📡 GPS atual
              </button>
              <button onClick={() => setShowLoc(v => !v)}
                style={{ fontSize:10, padding:'3px 8px', borderRadius:6, cursor:'pointer',
                  background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                  color:'rgba(255,255,255,.5)' }}>
                {showLoc ? '▲ Ocultar' : '▼ Editar'}
              </button>
            </div>
          </div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,.3)', marginBottom:6 }}>
            📍 {[ocorrencia.endereco_inicial, ocorrencia.bairro_inicial, ocorrencia.cidade_inicial]
              .filter(Boolean).join(' · ')}
          </div>
          {showLoc && (
            <div style={{ display:'flex', flexDirection:'column', gap:8,
              padding:'10px 12px', borderRadius:10,
              background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div>
                  <label style={lbl}>LATITUDE</label>
                  <input value={lat} onChange={e=>setLat(e.target.value)}
                    placeholder="-8.063116" style={inp} />
                </div>
                <div>
                  <label style={lbl}>LONGITUDE</label>
                  <input value={lng} onChange={e=>setLng(e.target.value)}
                    placeholder="-34.872091" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>ENDEREÇO</label>
                <input value={endereco} onChange={e=>setEndereco(e.target.value)} style={inp} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div>
                  <label style={lbl}>BAIRRO</label>
                  <input value={bairro} onChange={e=>setBairro(e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={lbl}>CIDADE</label>
                  <input value={cidade} onChange={e=>setCidade(e.target.value)} style={inp} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BO */}
        <div style={{
          background: 'rgba(234,179,8,.05)', border: '1px solid rgba(234,179,8,.15)',
          borderRadius: 12, padding: '14px', marginBottom: 18,
        }}>
          <div style={{ color: '#eab308', fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
            {t('guard.bo')}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, display: 'block', marginBottom: 6 }}>
              {t('guard.boNumber')}
            </label>
            <input value={boNum} onChange={e => setBoNum(e.target.value)}
              placeholder="Ex: 2026-1234567" style={inp} />
          </div>
          <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, marginBottom: 8 }}>{t('guard.boPhoto')}</div>
          <input ref={boRef}    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleBoFile(f); if (boRef.current) boRef.current.value = ''; }} />
          <input ref={boGalRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleBoFile(f); if (boGalRef.current) boGalRef.current.value = ''; }} />
          {boPreview ? (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <img src={boPreview} alt="BO" style={{ width: '100%', borderRadius: 10, maxHeight: 180, objectFit: 'cover' }} />
              <button onClick={() => { setBoPreview(''); setBoFile(null); }} style={{
                position: 'absolute', top: 6, right: 6,
                background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%',
                color: '#fff', width: 26, height: 26, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
              }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={async () => {
                if (isAndroidNative()) {
                  try {
                    const f = await capturarFotoNativa();
                    if (f) handleBoFile(f);
                    return;
                  } catch { /* plugin indisponível: fallback ao input */ }
                }
                boRef.current?.click();
              }} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 12,
                background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.12)',
                color: 'rgba(255,255,255,.4)',
              } as React.CSSProperties}>📷 Câmera</button>
              <button onClick={() => boGalRef.current?.click()} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 12,
                background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.12)',
                color: 'rgba(255,255,255,.4)',
              } as React.CSSProperties}>🖼 Galeria</button>
            </div>
          )}
        </div>

        {/* Observação fechamento */}
        <div style={{ marginBottom: 22 }}>
          <label style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
            Observação de fechamento{(status === 'Encerrado' || status === 'Recuperado') ? ' *' : ''}
          </label>
          <textarea value={obs} onChange={e => setObs(e.target.value)}
            placeholder="Descreva o desfecho / ação tomada..." rows={3}
            style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
        </div>

        {/* Botão excluir — só admin/gestor */}
        {podeExcluir && (
          <button onClick={async () => {
            if (!confirm('Excluir esta ocorrência permanentemente?')) return;
            try {
              const { doc: fsDoc, deleteDoc: fsDel, collection: col } = await import('firebase/firestore');
              await fsDel(fsDoc(col(db, 'ocorrencias'), ocorrencia.id));
              if (guardWriteSupabase()) deletarOcorrenciaSupabase(ocorrencia.id).catch(err => console.error('[guard-write] delete Supabase:', err));
              showToast('Ocorrência excluída', 'ok');
              onSalvo();
            } catch { showToast('Erro ao excluir', 'erro'); }
          }} style={{
            width: '100%', padding: '11px 0', borderRadius: 12, marginBottom: 8,
            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
            color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          } as React.CSSProperties}>
            🗑 Excluir ocorrência
          </button>
        )}
        {/* Timeline */}
        {ocorrencia.historico && ocorrencia.historico.length > 0 && (
          <div style={{ marginBottom: 16, background: 'rgba(255,255,255,.03)',
            border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700,
              color: 'rgba(255,255,255,.35)', textTransform: 'uppercase' as const, letterSpacing: '.8px',
              borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              📋 Histórico de alterações
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto' as const }}>
              {[...ocorrencia.historico].reverse().map((h, i) => {
                const dt = h.ts?.toDate?.() ?? new Date();
                const dtStr = dt.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit',
                  hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
                const CAMPO_LABEL: Record<string,string> = {
                  status:'Status', tipo:'Tipo', asset_id:'Ativo',
                  procurando:'Procurando', cidade:'Cidade', bo_numero:'BO',
                  danoPct:'% Dano', danoValor:'Valor R$'
                };
                const STATUS_COR_TL: Record<string,string> = {
                  'Recuperado':'#22c55e','Encerrado':'#6b7280',
                  'Aberto':'#ef4444','Em apuração':'#f97316'
                };
                const cor = STATUS_COR_TL[h.para] || 'rgba(255,255,255,.5)';
                return (
                  <div key={i} style={{ padding: '8px 14px',
                    borderBottom: i < (ocorrencia.historico?.length ?? 1)-1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                    display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%',
                      background: cor, marginTop: 5, flexShrink: 0 }}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>
                        <span style={{ fontWeight: 700, color: cor }}>
                          {CAMPO_LABEL[h.campo] || h.campo}
                        </span>
                        {': '}
                        <span style={{ color: 'rgba(255,255,255,.35)', textDecoration: 'line-through' }}>
                          {h.de || '—'}
                        </span>
                        {' → '}
                        <span style={{ fontWeight: 700, color: cor }}>{h.para}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>
                        {h.nomeUsuario || h.usuario} · {dtStr}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onFechar} style={{
            flex: 1, padding: '14px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,.1)',
            background: 'rgba(255,255,255,.05)', color: 'rgba(255,255,255,.5)', fontSize: 14, cursor: 'pointer',
          }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} style={{
            flex: 2, padding: '14px 0', borderRadius: 12, border: 'none',
            cursor: busy ? 'not-allowed' : 'pointer',
            background: busy ? 'rgba(124,58,237,.3)' : 'linear-gradient(135deg,#7c3aed,#a78bfa)',
            color: '#fff', fontSize: 14, fontWeight: 700, opacity: busy ? .6 : 1,
          }}>
            {busy ? 'Salvando...' : '💾 Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────────
export default function TelaGuard({ usuario, onLogout, onVoltarMapa }: Props) {
  const { t } = useTranslation();
  const TIPOS = TIPOS_KEYS.map(tp => ({ ...tp, label: t(tp.tk) }));
  const [aba,         setAba]         = useState<'novo' | 'lista'>('novo');
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [toast,       setToast]       = useState<{ msg: string; tipo: 'ok' | 'erro' | 'info' } | null>(null);

  const showToast = (msg: string, tipo: 'ok' | 'erro' | 'info' = 'ok') => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    // Fase 2 / Onda B — leitura do Supabase atrás de flag (read-only; escrita ainda Firestore).
    if (guardProviderSupabase()) {
      let vivo = true;
      carregarMinhasOcorrenciasSupabase(usuario.uid)
        .then(rows => { if (vivo) setOcorrencias(rows as Ocorrencia[]); })
        .catch(err => console.error('[guard] leitura Supabase falhou:', err));
      return () => { vivo = false; };
    }
    const ontemTs = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const q = query(
      collection(db, 'ocorrencias'),
      where('registradoPor', '==', usuario.uid),
      where('criadoEm', '>=', ontemTs),
      orderBy('criadoEm', 'desc')
    );
    return onSnapshot(q, snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ocorrencia)));
    });
  }, [usuario.uid]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#080d14',
      display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif',
      overscrollBehavior: 'none', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(8,13,20,.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(167,139,250,.15)',
        padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>🛡</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>JET Guard</div>
            <div style={{ color: 'rgba(167,139,250,.7)', fontSize: 10 }}>{usuario.nome}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {onVoltarMapa && (
            <button onClick={onVoltarMapa}
              style={{ background:'rgba(59,130,246,.15)', border:'1px solid rgba(59,130,246,.3)',
                borderRadius:8, color:'#60a5fa', fontSize:11, fontWeight:700,
                padding:'5px 12px', cursor:'pointer' }}>
              🗺 Mapa
            </button>
          )}
          <button onClick={onLogout} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,.3)',
            fontSize: 20, cursor: 'pointer', padding: '4px 8px',
          }}>⏻</button>
        </div>
      </div>

      {/* Abas */}
      <div style={{
        display: 'flex', background: 'rgba(255,255,255,.03)',
        borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0,
      }}>
        {[
          { key: 'novo',  label: t('guard.newOccurrence') },
          { key: 'lista', label: '📋 Meu turno' + (ocorrencias.length > 0 ? ' (' + ocorrencias.length + ')' : '') },
        ].map(a => (
          <button key={a.key} onClick={() => setAba(a.key as any)} style={{
            flex: 1, padding: '11px 0', border: 'none', cursor: 'pointer', fontSize: 13,
            background: aba === a.key ? 'rgba(124,58,237,.1)' : 'transparent',
            color: aba === a.key ? '#a78bfa' : 'rgba(255,255,255,.4)',
            borderBottom: aba === a.key ? '2px solid #7c3aed' : '2px solid transparent',
            fontWeight: aba === a.key ? 600 : 400,
          }}>{a.label}</button>
        ))}
      </div>

      {/* Conteúdo */}
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {aba === 'novo'  && <FormNovaOcorrenciaExport usuario={usuario} showToast={showToast} onSucesso={() => setAba('lista')} />}
        {aba === 'lista' && <ListaOcorrencias ocorrencias={ocorrencias} showToast={showToast} roleUsuario={usuario.role} />}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: 16, right: 16, zIndex: 9999,
          background: toast.tipo === 'ok' ? '#14532d' : toast.tipo === 'erro' ? '#7f1d1d' : '#1e3a5f',
          border: '1px solid ' + (toast.tipo === 'ok' ? '#16a34a' : toast.tipo === 'erro' ? '#dc2626' : '#2563eb'),
          borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 14,
          textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

// ── Seletor de localização — GPS / Mapa / Busca de endereço ──────────
function LocSelector({
  gps, setGps, gpsStatus, setGpsStatus, geocoded, setGeocoded,
  modoLoc, setModoLoc, showMapa, setShowMapa,
  buscaEnd, setBuscaEnd, buscandoEnd, setBuscandoEnd,
  mapContainerRef, mapaLocRef, markerLocRef,
}: {
  gps: { lat: number; lng: number } | null;
  setGps: (v: { lat: number; lng: number } | null) => void;
  gpsStatus: string; setGpsStatus: (v: any) => void;
  geocoded: { endereco: string; bairro: string; cidade: string } | null;
  setGeocoded: (v: any) => void;
  modoLoc: string; setModoLoc: (v: any) => void;
  showMapa: boolean; setShowMapa: (v: boolean) => void;
  buscaEnd: string; setBuscaEnd: (v: string) => void;
  buscandoEnd: boolean; setBuscandoEnd: (v: boolean) => void;
  mapContainerRef: React.RefObject<HTMLDivElement>;
  mapaLocRef: React.MutableRefObject<L.Map | null>;
  markerLocRef: React.MutableRefObject<L.Marker | null>;
}) {
  const { t } = useTranslation();
  const inp: CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.06)',
    color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const,
  };

  // Inicializar mapa quando showMapa fica true
  useEffect(() => {
    if (!showMapa || !mapContainerRef.current) return;
    if (mapaLocRef.current) return; // já inicializado

    setTimeout(() => {
      if (!mapContainerRef.current) return;
      const center: [number, number] = gps ? [gps.lat, gps.lng] : [-8.05, -34.88];
      const map = L.map(mapContainerRef.current, {
        center, zoom: 16, zoomControl: true,
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', maxZoom: 19,
      }).addTo(map);

      // Marker arrastável
      const pinIcon = L.divIcon({
        className: '',
        html: '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;background:#a78bfa;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>',
        iconSize: [20, 20] as [number,number],
        iconAnchor: [10, 20] as [number,number],
      });
      const marker = L.marker(center, { draggable: true, icon: pinIcon }).addTo(map);
      markerLocRef.current = marker;

      // Atualizar coords ao arrastar
      marker.on('dragend', async () => {
        const ll = marker.getLatLng();
        setGps({ lat: ll.lat, lng: ll.lng });
        setGpsStatus('manual');
        const geo = await reverseGeocode(ll.lat, ll.lng);
        setGeocoded(geo);
      });

      // Click no mapa move o marker
      map.on('click', async (e: L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        setGps({ lat: e.latlng.lat, lng: e.latlng.lng });
        setGpsStatus('manual');
        const geo = await reverseGeocode(e.latlng.lat, e.latlng.lng);
        setGeocoded(geo);
      });

      mapaLocRef.current = map;
    }, 100);
  }, [showMapa]);

  // Busca de endereço via Nominatim (gratuito)
  const buscarEndereco = async () => {
    if (!buscaEnd.trim()) return;
    setBuscandoEnd(true);
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
        + encodeURIComponent(buscaEnd + ', Brasil');
      const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      const data = await res.json();
      if (data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        setGps({ lat, lng });
        setGpsStatus('manual');
        const geo = await reverseGeocode(lat, lng);
        setGeocoded(geo);
        // Mover mapa se estiver aberto
        if (mapaLocRef.current && markerLocRef.current) {
          mapaLocRef.current.setView([lat, lng], 17);
          markerLocRef.current.setLatLng([lat, lng]);
        }
      } else {
        alert('Endereço não encontrado. Tente ser mais específico.');
      }
    } catch { alert('Erro ao buscar endereço.'); }
    setBuscandoEnd(false);
  };

  // Capturar GPS atual
  const capturarGPS = () => {
    setGpsStatus('aguardando');
    capturarPosicaoUnica().then(async pos => {
      if (!pos) { setGpsStatus('erro'); return; }
      const { lat, lng } = pos;
      setGps({ lat, lng });
      setGpsStatus('ok');
      const geo = await reverseGeocode(lat, lng);
      setGeocoded(geo);
      if (mapaLocRef.current && markerLocRef.current) {
        mapaLocRef.current.setView([lat, lng], 17);
        markerLocRef.current.setLatLng([lat, lng]);
      }
    });
  };

  const corStatus = gpsStatus === 'ok' || gpsStatus === 'manual'
    ? 'rgba(34,197,94,.2)' : gpsStatus === 'erro'
    ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.08)';

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Status atual */}
      <div style={{
        background: gpsStatus === 'ok' || gpsStatus === 'manual'
          ? 'rgba(34,197,94,.08)' : gpsStatus === 'erro'
          ? 'rgba(239,68,68,.08)' : 'rgba(255,255,255,.04)',
        border: '1px solid ' + corStatus,
        borderRadius: 10, padding: '10px 14px', marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>
            {gpsStatus === 'ok' ? '📍' : gpsStatus === 'manual' ? '🗺' : gpsStatus === 'erro' ? '⚠️' : '⏳'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
              {gpsStatus === 'ok' ? t('guard.gpsOk')
                : gpsStatus === 'manual' ? t('guard.locationAdjusted')
                : gpsStatus === 'erro' ? t('guard.gpsError')
                : t('guard.gpsLoading')}
            </div>
            {geocoded && (
              <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 11, marginTop: 2 }}>
                {[geocoded.endereco, geocoded.bairro, geocoded.cidade].filter(Boolean).join(' · ')}
              </div>
            )}
            {gps && (
              <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 10, marginTop: 1 }}>
                {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Botões de modo */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[
          { key: 'gps',   icon: '📡', label: t('guard.myGPS') },
          { key: 'mapa',  icon: '🗺',  label: t('guard.onMap') },
          { key: 'busca', icon: '🔍', label: t('guard.byAddress') },
        ].map(m => (
          <button key={m.key} onClick={() => {
            setModoLoc(m.key);
            if (m.key === 'mapa') setShowMapa(true);
            else setShowMapa(false);
            if (m.key === 'gps') capturarGPS();
          }} style={{
            flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            background: modoLoc === m.key ? 'rgba(167,139,250,.2)' : 'rgba(255,255,255,.05)',
            border: '1px solid ' + (modoLoc === m.key ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.08)'),
            color: modoLoc === m.key ? '#a78bfa' : 'rgba(255,255,255,.45)', fontWeight: modoLoc === m.key ? 700 : 400,
          } as CSSProperties}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Busca de endereço */}
      {modoLoc === 'busca' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={buscaEnd}
            onChange={e => setBuscaEnd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarEndereco()}
            placeholder="Ex: Av. Boa Viagem 500, Recife"
            style={{ ...inp, flex: 1 }}
          />
          <button onClick={buscarEndereco} disabled={buscandoEnd}
            style={{ padding: '10px 14px', borderRadius: 8, cursor: 'pointer', border: 'none',
              background: 'rgba(167,139,250,.2)', color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>
            {buscandoEnd ? '⏳' : '🔍'}
          </button>
        </div>
      )}

      {/* Mapa interativo */}
      {showMapa && (
        <div style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(167,139,250,.2)' }}>
          <div style={{ padding: '6px 10px', background: 'rgba(167,139,250,.1)',
            fontSize: 10, color: '#a78bfa' }}>
            🗺 Toque no mapa ou arraste o pin para ajustar a localização
          </div>
          <div ref={mapContainerRef} style={{ width: '100%', height: 280 }} />
        </div>
      )}
    </div>
  );
}


// ── FORMULÁRIO NOVA OCORRÊNCIA ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function FormNovaOcorrenciaExport({ usuario, showToast, onSucesso }: {
  usuario: Props['usuario'];
  showToast: (msg: string, tipo?: 'ok' | 'erro' | 'info') => void;
  onSucesso: () => void;
}) {
  const { t } = useTranslation();
  const TIPOS  = TIPOS_KEYS.map(tp => ({ ...tp, label: t(tp.tk) }));
  const ATIVOS = ATIVOS_KEYS.map(k => t('guard.' + k));
  const TURNOS = TURNOS_KEYS.map(k => t('guard.' + k));
  const [tipo,         setTipo]         = useState('');
  const [descricao,    setDescricao]    = useState('');
  const [patineteId,   setPatineteId]   = useState('');
  const [ativoTipo,    setAtivoTipo]    = useState(t('guard.Patinete'));
  const [turno,        setTurno]        = useState(turnoAtual());
  const [estacaoId,    setEstacaoId]    = useState('');
  const [obs,          setObs]          = useState('');
  const [boNumero,     setBoNumero]     = useState('');
  const [foto1,        setFoto1]        = useState<File | null>(null);
  const [foto2,        setFoto2]        = useState<File | null>(null);
  const [foto1Preview, setFoto1Preview] = useState('');
  const [foto2Preview, setFoto2Preview] = useState('');
  const [boFile,       setBoFile]       = useState<File | null>(null);
  const [boPreview,    setBoPreview]    = useState('');
  const [gps,          setGps]          = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus,    setGpsStatus]    = useState<'aguardando' | 'ok' | 'erro' | 'manual'>('aguardando');
  const [geocoded,     setGeocoded]     = useState<{ endereco: string; bairro: string; cidade: string } | null>(null);
  const [modoLoc,      setModoLoc]      = useState<'gps' | 'mapa' | 'busca'>('gps');
  const [showMapa,     setShowMapa]     = useState(false);
  const [buscaEnd,     setBuscaEnd]     = useState('');
  const [buscandoEnd,  setBuscandoEnd]  = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapaLocRef      = useRef<L.Map | null>(null);
  const markerLocRef    = useRef<L.Marker | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [procurando,   setProcurando]   = useState('');
  const [dataOcorr,    setDataOcorr]    = useState(nowDatetimeLocal);

  const boRef    = useRef<HTMLInputElement>(null);
  const boGalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    capturarPosicaoUnica().then(async pos => {
      if (!pos) { setGpsStatus('erro'); return; }
      const { lat, lng } = pos;
      setGps({ lat, lng });
      setGpsStatus('ok');
      const geo = await reverseGeocode(lat, lng);
      setGeocoded(geo);
    });
  }, []);

  const handleFoto = (slot: 1 | 2, file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const prev = (e.target?.result as string) || '';
      if (slot === 1) { setFoto1(file); setFoto1Preview(prev); }
      else            { setFoto2(file); setFoto2Preview(prev); }
    };
    reader.readAsDataURL(file);
  };

  const handleBoFile = (f: File) => {
    setBoFile(f);
    const reader = new FileReader();
    reader.onload = e => setBoPreview((e.target?.result as string) || '');
    reader.readAsDataURL(f);
  };

  const enviar = async () => {
    if (!tipo)            { showToast('Selecione o tipo de ocorrência', 'erro'); return; }
    if (!descricao.trim()){ showToast('Descreva a ocorrência', 'erro'); return; }
    if (!gps)             { showToast('Aguarde o GPS', 'erro'); return; }

    setBusy(true);
    try {
      const id = generateId();
      const prioridade = tipo === t('guard.robbery') ? 'Critica'
        : tipo === t('guard.attempt') ? 'Alta'
        : tipo === t('guard.vandalism') ? 'Media' : 'Baixa';

      let foto1Url = '';
      let foto2Url = '';
      let boUrl    = '';

      if (foto1)  foto1Url = await uploadFotoStorage(foto1,  'ocorrencias/' + id + '_foto1.' + (foto1.name.split('.').pop()  || 'jpg'));
      if (foto2)  foto2Url = await uploadFotoStorage(foto2,  'ocorrencias/' + id + '_foto2.' + (foto2.name.split('.').pop()  || 'jpg'));
      if (boFile) boUrl    = await uploadFotoStorage(boFile, 'ocorrencias/' + id + '_bo.'    + (boFile.name.split('.').pop() || 'jpg'));

      const novaOcorrencia = {
        id,
        tipo,
        ativo_tipo:  ativoTipo,
        descricao,
        status:      'Aberto',
        prioridade,
        lat_inicial: gps.lat,
        lng_inicial: gps.lng,
        endereco_inicial: geocoded?.endereco || '',
        bairro_inicial:   geocoded?.bairro   || '',
        cidade_inicial:   geocoded?.cidade   || '',
        asset_id:    patineteId.trim() || '',
        estacaoId:   estacaoId.trim()  || '',
        turno,
        observacao_fechamento: obs.trim() || '',
        bo_numero:   boNumero.trim() || '',
        bo_url:      boUrl,
        foto1_url:   foto1Url,
        foto2_url:   foto2Url,
        registradoPor:     usuario.uid,
        registradoPorNome: usuario.nome,
        cargo:             (usuario as any).cargoPrestador || 'seguranca',
        origem_registro:   'Guard',
        procurando:        !!(tipo === 'Roubo' && procurando.trim()),
        telegramEnviado:   false,
        criadoEm:    serverTimestamp(),
        dataManual:  dataOcorr,
        updated_at:  serverTimestamp(),
      };
      const ocorrenciaDoc = await addDoc(collection(db, 'ocorrencias'), novaOcorrencia);
      // Cutover de writes (Onda C): dual-write no Supabase atrás de flag (best-effort).
      if (guardWriteSupabase()) {
        criarOcorrenciaSupabase(ocorrenciaDoc.id, { ...novaOcorrencia, lat_inicial: gps.lat, lng_inicial: gps.lng })
          .catch(err => console.error('[guard-write] create Supabase falhou:', err));
      }

      // Dispara notificação Telegram para roubos e ocorrências urgentes
      try {
        const fnNotificar = (window as any).__fnNotificarOcorrencia;
        if (fnNotificar) {
          fnNotificar({ ocorrenciaId: ocorrenciaDoc.id }).catch(() => {});
        }
      } catch { /* notificação é best-effort */ }

      showToast('Ocorrência registrada!', 'ok');
      setTipo(''); setDescricao(''); setPatineteId(''); setAtivoTipo(t('guard.Patinete'));
      setTurno(turnoAtual()); setEstacaoId(''); setObs(''); setBoNumero(''); setProcurando('');
      setFoto1(null); setFoto2(null); setFoto1Preview(''); setFoto2Preview('');
      setBoFile(null); setBoPreview('');
      setDataOcorr(nowDatetimeLocal());
      onSucesso();
    } catch (e: any) {
      console.error('[ModalEdicao]', e);
      const msg = e?.code === 'permission-denied' ? 'Sem permissão.'
        : e?.message ? `Erro: ${e.message}` : 'Erro ao salvar.';
      showToast(msg, 'erro');
    }
    setBusy(false);
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '13px 14px', boxSizing: 'border-box',
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)',
    borderRadius: 10, color: '#fff', fontSize: 15, outline: 'none',
  };
  const lbl: React.CSSProperties = {
    display: 'block', color: 'rgba(255,255,255,.4)', fontSize: 11,
    fontWeight: 600, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase',
  };

  return (
    <div style={{ padding: '16px 16px 32px' }}>

      {/* Localização — GPS / Mapa / Busca */}
      <LocSelector
        gps={gps} setGps={setGps}
        gpsStatus={gpsStatus} setGpsStatus={setGpsStatus}
        geocoded={geocoded} setGeocoded={setGeocoded}
        modoLoc={modoLoc} setModoLoc={setModoLoc}
        showMapa={showMapa} setShowMapa={setShowMapa}
        buscaEnd={buscaEnd} setBuscaEnd={setBuscaEnd}
        buscandoEnd={buscandoEnd} setBuscandoEnd={setBuscandoEnd}
        mapContainerRef={mapContainerRef}
        mapaLocRef={mapaLocRef}
        markerLocRef={markerLocRef}
      />

      {/* Tipo */}
      <div style={{ marginBottom: 20 }}>
        <span style={lbl}>Tipo de ocorrência *</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TIPOS.map(t => (
            <button key={t.key} onClick={() => setTipo(t.key)} style={{
              padding: '12px 10px', borderRadius: 10, cursor: 'pointer',
              background: tipo === t.key ? t.cor + '20' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (tipo === t.key ? t.cor + '60' : 'rgba(255,255,255,.08)'),
              color: tipo === t.key ? t.cor : 'rgba(255,255,255,.5)',
              fontSize: 13, fontWeight: tipo === t.key ? 700 : 400,
              display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
            } as React.CSSProperties}>{t.emoji} {t.label}</button>
          ))}
        </div>
      </div>


      {/* Campo procurando — aparece quando tipo é Roubo ou Tentativa */}
      {(tipo === 'Roubo' || tipo === 'Tentativa') && (
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>🔍 Procurando (suspeito/veículo)</label>
          <input value={procurando} onChange={e => setProcurando(e.target.value)}
            placeholder="Ex: Homem, camisa vermelha, moto preta ABC-1234"
            style={inp} />
        </div>
      )}
      {/* Ativo */}
      <div style={{ marginBottom: 20 }}>
        <span style={lbl}>{t('guard.assetType')}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {ATIVOS.map(a => (
            <button key={a} onClick={() => setAtivoTipo(a)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
              background: ativoTipo === a ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (ativoTipo === a ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.08)'),
              color: ativoTipo === a ? '#a78bfa' : 'rgba(255,255,255,.4)',
              fontSize: 12, fontWeight: ativoTipo === a ? 600 : 400,
            } as React.CSSProperties}>{a}</button>
          ))}
        </div>
      </div>

      {/* ID ativo */}
      <div style={{ marginBottom: 20 }}>
        <label style={lbl}>{t('guard.assetIdPlaceholder')}</label>
        <input value={patineteId} onChange={e => setPatineteId(e.target.value.toUpperCase())}
          placeholder="Ex: JET-0042" style={{ ...inp, textTransform: 'uppercase' }} />
      </div>

      {/* Descrição */}
      <div style={{ marginBottom: 20 }}>
        <label style={lbl}>{t('guard.descRequired')}</label>
        <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
          placeholder="Descreva o que aconteceu..." rows={4}
          style={{ ...inp, resize: 'none', lineHeight: 1.5 }} />
      </div>

      {/* Estação */}
      <div style={{ marginBottom: 20 }}>
        <label style={lbl}>{t('guard.stationId')}</label>
        <input value={estacaoId} onChange={e => setEstacaoId(e.target.value)}
          placeholder="Ex: SP-001" style={inp} />
      </div>

      {/* Turno */}
      <div style={{ marginBottom: 20 }}>
        <span style={lbl}>Turno</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TURNOS.map(trn => (
            <button key={trn} onClick={() => setTurno(trn)} style={{
              padding: '11px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: turno === trn ? 'rgba(124,58,237,.15)' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (turno === trn ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.08)'),
              color: turno === trn ? '#a78bfa' : 'rgba(255,255,255,.5)',
              fontSize: 13, fontWeight: turno === trn ? 600 : 400,
            } as React.CSSProperties}>{trn}</button>
          ))}
        </div>
      </div>

      {/* Data/hora da ocorrência */}
      <div style={{ marginBottom: 20 }}>
        <label style={lbl}>Data / hora da ocorrência</label>
        <input type="datetime-local" value={dataOcorr}
          onChange={e => setDataOcorr(e.target.value)}
          style={{ ...inp, colorScheme: 'dark' as any }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          Padrão: agora. Altere para registrar ocorrências retroativas.
        </div>
      </div>

      {/* Fotos — câmera OU galeria separados */}
      <div style={{ marginBottom: 20 }}>
        <span style={lbl}>{t('guard.photos')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <BotaoFoto slot={1} preview={foto1Preview}
            onArquivo={f => handleFoto(1, f)}
            onRemover={() => { setFoto1(null); setFoto1Preview(''); }} />
          <BotaoFoto slot={2} preview={foto2Preview}
            onArquivo={f => handleFoto(2, f)}
            onRemover={() => { setFoto2(null); setFoto2Preview(''); }} />
        </div>
      </div>

      {/* Boletim de Ocorrência */}
      <div style={{
        background: 'rgba(234,179,8,.05)', border: '1px solid rgba(234,179,8,.15)',
        borderRadius: 12, padding: '14px', marginBottom: 20,
      }}>
        <div style={{ color: '#eab308', fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
          {t('guard.bo')}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, display: 'block', marginBottom: 6 }}>
            {t('guard.boNumber')}
          </label>
          <input value={boNumero} onChange={e => setBoNumero(e.target.value)}
            placeholder="Ex: 2026-1234567" style={inp} />
        </div>
        <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, marginBottom: 8 }}>{t('guard.boPhoto')}</div>
        <input ref={boRef}    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleBoFile(f); if (boRef.current) boRef.current.value = ''; }} />
        <input ref={boGalRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleBoFile(f); if (boGalRef.current) boGalRef.current.value = ''; }} />
        {boPreview ? (
          <div style={{ position: 'relative' }}>
            <img src={boPreview} alt="BO" style={{ width: '100%', borderRadius: 10, maxHeight: 180, objectFit: 'cover' }} />
            <button onClick={() => { setBoFile(null); setBoPreview(''); }} style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%',
              color: '#fff', width: 26, height: 26, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
            }}>✕</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => {
              if (isAndroidNative()) {
                try {
                  const f = await capturarFotoNativa();
                  if (f) handleBoFile(f);
                  return;
                } catch { /* plugin indisponível: fallback ao input */ }
              }
              boRef.current?.click();
            }} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 12,
              background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.12)',
              color: 'rgba(255,255,255,.4)',
            } as React.CSSProperties}>📷 Câmera</button>
            <button onClick={() => boGalRef.current?.click()} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontSize: 12,
              background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.12)',
              color: 'rgba(255,255,255,.4)',
            } as React.CSSProperties}>🖼 Galeria</button>
          </div>
        )}
      </div>

      {/* Observação */}
      <div style={{ marginBottom: 28 }}>
        <label style={lbl}>{t('guard.additionalObs')}</label>
        <textarea value={obs} onChange={e => setObs(e.target.value)}
          placeholder="Informações extras..." rows={2}
          style={{ ...inp, resize: 'none' }} />
      </div>

      <button onClick={enviar} disabled={busy} style={{
        width: '100%', padding: '16px 0', borderRadius: 12, border: 'none',
        cursor: busy ? 'not-allowed' : 'pointer',
        background: busy ? 'rgba(124,58,237,.3)' : 'linear-gradient(135deg,#7c3aed,#a78bfa)',
        color: '#fff', fontSize: 16, fontWeight: 700,
        boxShadow: busy ? 'none' : '0 4px 20px rgba(124,58,237,.4)',
      }}>
        {busy ? 'Enviando...' : t('guard.save')}
      </button>
    </div>
  );
}

// ── LISTA DE OCORRÊNCIAS DO TURNO ─────────────────────────────────
function ListaOcorrencias({ ocorrencias, showToast, roleUsuario = 'guard' }: {
  ocorrencias: Ocorrencia[];
  showToast: (msg: string, tipo?: 'ok' | 'erro' | 'info') => void;
  roleUsuario?: string;
}) {
  const { t } = useTranslation();
  const TIPOS = TIPOS_KEYS.map(tp => ({ ...tp, label: t(tp.tk) }));
  const [expandido, setExpandido] = useState<string | null>(null);
  const [editando,  setEditando]  = useState<Ocorrencia | null>(null);
  const [busca,     setBusca]     = useState('');
  const podeExcluir = ['admin','gestor'].includes(roleUsuario);
  const ocorrenciasFiltradas = busca.trim()
    ? ocorrencias.filter(o =>
        (o.asset_id || '').toLowerCase().includes(busca.toLowerCase()) ||
        (o.id       || '').toLowerCase().includes(busca.toLowerCase()) ||
        (o.tipo     || '').toLowerCase().includes(busca.toLowerCase())
      )
    : ocorrencias;

  const handleSalvo = () => { setEditando(null); setExpandido(null); };

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Campo de busca */}
      <input
        value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="🔍 Buscar por ID, placa ou tipo..."
        style={{ width: '100%', padding: '9px 12px', borderRadius: 10,
          boxSizing: 'border-box' as const,
          border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)',
          color: '#fff', fontSize: 12, outline: 'none', marginBottom: 10 }}
      />

      {/* Contador */}
      <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, marginBottom: 12, textAlign: 'center' }}>
        Últimas 24h · {ocorrencias.length} ocorrência{ocorrencias.length !== 1 ? 's' : ''}
        {busca && ` · ${ocorrenciasFiltradas.length} resultado${ocorrenciasFiltradas.length !== 1 ? 's' : ''}`}
      </div>

      {/* Vazio */}
      {ocorrenciasFiltradas.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '40px 24px', color: 'rgba(255,255,255,.3)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛡</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {busca ? 'Nenhum resultado' : 'Nenhuma ocorrência hoje'}
          </div>
          <div style={{ fontSize: 12, textAlign: 'center' }}>
            {busca ? 'Tente outro termo de busca.' : 'As ocorrências registradas nas últimas 24h aparecerão aqui.'}
          </div>
        </div>
      )}

      {/* Lista */}
      {ocorrenciasFiltradas.map(o => {
        const tipoMeta   = TIPOS.find(tp => tp.key === o.tipo);
        const aberto     = expandido === o.id;
        const podeEditar = true; // todos podem editar

        return (
          <div key={o.id} style={{ marginBottom: 8, borderRadius: 12,
            border: `1px solid ${tipoMeta?.cor || '#4a5a7a'}30`,
            background: 'rgba(255,255,255,.03)', overflow: 'hidden' }}>

            {/* Card resumo */}
            <div onClick={() => setExpandido(aberto ? null : o.id)}
              style={{ padding: '12px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: (tipoMeta?.cor || '#4a5a7a') + '22',
                border: '1px solid ' + (tipoMeta?.cor || '#4a5a7a') + '44',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                {tipoMeta?.emoji || '⚪'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
                  {tipoMeta?.label || o.tipo}
                  {o.asset_id ? <span style={{ color: 'rgba(255,255,255,.4)', fontWeight: 400, fontSize: 11 }}> · {o.asset_id}</span> : null}
                </div>
                <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, marginTop: 2 }}>
                  {[o.bairro_inicial, o.cidade_inicial].filter(Boolean).join(' · ')}
                  {o.turno ? ' · ' + o.turno : ''}
                </div>
              </div>
              <div style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, flexShrink: 0,
                background: o.status === 'Encerrado' ? 'rgba(34,197,94,.1)' : 'rgba(234,179,8,.1)',
                border: o.status === 'Encerrado' ? '1px solid rgba(34,197,94,.2)' : '1px solid rgba(234,179,8,.2)',
                color: o.status === 'Encerrado' ? '#4ade80' : '#eab308' }}>
                {o.status}
              </div>
              <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 14 }}>{aberto ? '▲' : '▼'}</div>
            </div>

            {/* Detalhes expandidos */}
            {aberto && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10, marginBottom: 10 }}>
                  {[
                    ['ID',         o.id],
                    ['Ativo',      o.asset_id || '—'],
                    [t('guard.shift'),      o.turno],
                    ['Prioridade', o.prioridade],
                    ['Estação',    o.estacaoId || '—'],
                    ['Cidade',     o.cidade_inicial || '—'],
                    ['Data/hora',  fmtData(o.criadoEm, o.dataManual)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 10, marginBottom: 2 }}>{k}</div>
                      <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {o.endereco_inicial && (
                  <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, marginBottom: 10 }}>
                    📍 {[o.endereco_inicial, o.bairro_inicial].filter(Boolean).join(', ')}
                  </div>
                )}

                {(o.foto1_url || o.foto2_url) && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {[o.foto1_url, o.foto2_url].filter(Boolean).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                        <img src={url} alt={'Foto ' + (i + 1)}
                          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} />
                      </a>
                    ))}
                  </div>
                )}

                {(o.bo_numero || o.bo_url) && (
                  <div style={{ background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.2)',
                    borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ color: '#eab308', fontSize: 12, fontWeight: 600 }}>
                      📋 Boletim: {o.bo_numero || '—'}
                    </div>
                    {o.bo_url && (
                      <a href={o.bo_url} target="_blank" rel="noreferrer"
                        style={{ display: 'block', color: '#eab308', fontSize: 11, marginTop: 4, textDecoration: 'none' }}>
                        Ver imagem do BO ↗
                      </a>
                    )}
                  </div>
                )}

                {o.observacao_fechamento && (
                  <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8,
                    padding: '8px 10px', marginBottom: 10, color: 'rgba(255,255,255,.5)', fontSize: 12 }}>
                    💬 {o.observacao_fechamento}
                  </div>
                )}

                {/* Botões */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {podeEditar && (
                    <button onClick={() => setEditando(o)} style={{ flex: 2, padding: '11px 0',
                      borderRadius: 10, background: 'rgba(124,58,237,.15)',
                      border: '1px solid rgba(124,58,237,.3)',
                      color: '#a78bfa', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties}>
                      ✏️ Editar
                    </button>
                  )}
                  {podeExcluir && (
                    <button onClick={async () => {
                      if (!confirm('Excluir esta ocorrência permanentemente?')) return;
                      try {
                        const { doc: fsDoc, deleteDoc: fsDel, collection: col } = await import('firebase/firestore');
                        await fsDel(fsDoc(col(db, 'ocorrencias'), o.id));
                        if (guardWriteSupabase()) deletarOcorrenciaSupabase(o.id).catch(err => console.error('[guard-write] delete Supabase:', err));
                        showToast('Ocorrência excluída', 'ok');
                      } catch { showToast('Erro ao excluir', 'erro'); }
                    }} style={{ flex: 1, padding: '11px 0', borderRadius: 10,
                      background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                      color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editando && (
        <ModalEdicao
          key={editando.id}
          ocorrencia={editando}
          onFechar={() => setEditando(null)}
          onSalvo={handleSalvo}
          showToast={showToast}
          roleUsuario={roleUsuario}
        />
      )}
    </div>
  );
}


