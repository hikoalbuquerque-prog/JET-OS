// src/TelaGuard.tsx — Tela mobile-first para registro de ocorrências JET Guard
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, addDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, Timestamp, doc, updateDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './lib/firebase';

// ── TIPOS ─────────────────────────────────────────────────────────
interface Ocorrencia {
  id: string;
  tipo: string;
  descricao: string;
  lat: number;
  lng: number;
  estacaoId?: string;
  patineteId?: string;
  turno: string;
  status: 'Aberto' | 'Em apuração' | 'Recuperado' | 'Encerrado';
  prioridade: 'Baixa' | 'Media' | 'Alta' | 'Critica';
  foto1_url?: string;
  foto2_url?: string;
  registradoPor: string;
  registradoPorNome: string;
  cidade_inicial: string;
  bairro_inicial: string;
  endereco_inicial: string;
  origem_registro: string;
  criadoEm: any;
  asset_id?: string;
  observacao_fechamento?: string;
  resultado?: string;
}

interface Props {
  usuario: { uid: string; email: string; nome: string; role: string; paises: string[] };
  onLogout: () => void;
}

// ── ENUMS ─────────────────────────────────────────────────────────
const TIPOS = [
  { key: 'Roubo',        label: 'Roubo',         emoji: '🔴', cor: '#ef4444' },
  { key: 'Tentativa',    label: 'Tentativa',      emoji: '🟠', cor: '#f97316' },
  { key: 'Vandalismo',   label: 'Vandalismo',     emoji: '🟡', cor: '#eab308' },
  { key: 'Recuperacao',  label: 'Recuperação',    emoji: '🟢', cor: '#22c55e' },
  { key: 'Outro',        label: 'Outro',          emoji: '⚪', cor: '#6b7280' },
];

const ATIVOS = ['Patinete', 'Bicicleta', 'Bateria'];
const TURNOS = ['Manhã (06–14h)', 'Tarde (14–22h)', 'Noite (22–06h)'];

function turnoAtual(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return TURNOS[0];
  if (h >= 14 && h < 22) return TURNOS[1];
  return TURNOS[2];
}

// ── HELPERS ───────────────────────────────────────────────────────
function fmtData(ts: any): string {
  if (!ts) return '';
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function generateId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.floor(Math.random() * 900 + 100);
  return 'JET-SEC-' + stamp + '-' + rand;
}

async function reverseGeocode(lat: number, lng: number): Promise<{ endereco: string; bairro: string; cidade: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt-BR`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();
    const addr = data.address || {};
    return {
      endereco: [addr.road, addr.house_number].filter(Boolean).join(', ') || '',
      bairro: addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || '',
      cidade: addr.city || addr.town || addr.municipality || '',
    };
  } catch {
    return { endereco: '', bairro: '', cidade: '' };
  }
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────────
export default function TelaGuard({ usuario, onLogout }: Props) {
  const [aba, setAba] = useState<'novo' | 'lista'>('novo');
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' | 'info' } | null>(null);

  const showToast = (msg: string, tipo: 'ok' | 'erro' | 'info' = 'ok') => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3500);
  };

  // Carrega ocorrências do turno atual (últimas 24h das próprias)
  useEffect(() => {
    const ontemTs = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const q = query(
      collection(db, 'ocorrencias'),
      where('registradoPor', '==', usuario.uid),
      where('criadoEm', '>=', ontemTs),
      orderBy('criadoEm', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ocorrencia)));
    });
    return unsub;
  }, [usuario.uid]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#080d14',
      display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif',
      overscrollBehavior: 'none',
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>🛡</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>JET Guard</div>
            <div style={{ color: 'rgba(167,139,250,.7)', fontSize: 10 }}>{usuario.nome}</div>
          </div>
        </div>
        <button onClick={onLogout} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.3)',
          fontSize: 20, cursor: 'pointer', padding: '4px 8px',
        }}>⏻</button>
      </div>

      {/* Abas */}
      <div style={{
        display: 'flex', background: 'rgba(255,255,255,.03)',
        borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0,
      }}>
        {[
          { key: 'novo', label: '+ Nova ocorrência' },
          { key: 'lista', label: `📋 Meu turno${ocorrencias.length > 0 ? ` (${ocorrencias.length})` : ''}` },
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
        {aba === 'novo' && (
          <FormNovaOcorrencia usuario={usuario} showToast={showToast} onSucesso={() => setAba('lista')} />
        )}
        {aba === 'lista' && (
          <ListaOcorrencias ocorrencias={ocorrencias} showToast={showToast} />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: 16, right: 16, zIndex: 9999,
          background: toast.tipo === 'ok' ? '#14532d' : toast.tipo === 'erro' ? '#7f1d1d' : '#1e3a5f',
          border: `1px solid ${toast.tipo === 'ok' ? '#16a34a' : toast.tipo === 'erro' ? '#dc2626' : '#2563eb'}`,
          borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 14,
          textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

// ── FORMULÁRIO NOVA OCORRÊNCIA ────────────────────────────────────
function FormNovaOcorrencia({ usuario, showToast, onSucesso }: {
  usuario: Props['usuario'];
  showToast: (msg: string, tipo?: 'ok' | 'erro' | 'info') => void;
  onSucesso: () => void;
}) {
  const [tipo,       setTipo]       = useState('');
  const [descricao,  setDescricao]  = useState('');
  const [patineteId, setPatineteId] = useState('');
  const [ativoTipo,  setAtivoTipo]  = useState('Patinete');
  const [turno,      setTurno]      = useState(turnoAtual());
  const [estacaoId,  setEstacaoId]  = useState('');
  const [obs,        setObs]        = useState('');
  const [foto1,      setFoto1]      = useState<File | null>(null);
  const [foto2,      setFoto2]      = useState<File | null>(null);
  const [foto1Preview, setFoto1Preview] = useState<string>('');
  const [foto2Preview, setFoto2Preview] = useState<string>('');
  const [gps,        setGps]        = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus,  setGpsStatus]  = useState<'aguardando' | 'ok' | 'erro'>('aguardando');
  const [geocoded,   setGeocoded]   = useState<{ endereco: string; bairro: string; cidade: string } | null>(null);
  const [busy,       setBusy]       = useState(false);

  const foto1Ref = useRef<HTMLInputElement>(null);
  const foto2Ref = useRef<HTMLInputElement>(null);

  // GPS automático ao montar
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('erro'); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGps({ lat, lng });
        setGpsStatus('ok');
        const geo = await reverseGeocode(lat, lng);
        setGeocoded(geo);
      },
      () => setGpsStatus('erro'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleFoto = (slot: 1 | 2, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const preview = (e.target?.result as string) || '';
      if (slot === 1) { setFoto1(file); setFoto1Preview(preview); }
      else            { setFoto2(file); setFoto2Preview(preview); }
    };
    reader.readAsDataURL(file);
  };

  const uploadFoto = async (file: File, id: string, slot: number): Promise<string> => {
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = 'ocorrencias/' + id + '_foto' + slot + '.' + ext;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  };

  const limpar = () => {
    setTipo(''); setDescricao(''); setPatineteId('');
    setAtivoTipo('Patinete'); setTurno(turnoAtual());
    setEstacaoId(''); setObs('');
    setFoto1(null); setFoto2(null); setFoto1Preview(''); setFoto2Preview('');
  };

  const enviar = async () => {
    if (!tipo) { showToast('Selecione o tipo de ocorrência', 'erro'); return; }
    if (!descricao.trim()) { showToast('Descreva a ocorrência', 'erro'); return; }
    if (!gps) { showToast('Aguarde o GPS', 'erro'); return; }

    setBusy(true);
    try {
      const id = generateId();
      const prioridade = tipo === 'Roubo' ? 'Critica'
        : tipo === 'Tentativa' ? 'Alta'
        : tipo === 'Vandalismo' ? 'Media' : 'Baixa';

      // Upload fotos para Storage (não salva base64 no Firestore)
      let foto1Url = '';
      let foto2Url = '';
      if (foto1) foto1Url = await uploadFoto(foto1, id, 1);
      if (foto2) foto2Url = await uploadFoto(foto2, id, 2);

      await addDoc(collection(db, 'ocorrencias'), {
        id,
        tipo,
        ativo_tipo: ativoTipo,
        descricao,
        status: 'Aberto',
        prioridade,
        lat_inicial: gps.lat,
        lng_inicial: gps.lng,
        endereco_inicial: geocoded?.endereco || '',
        bairro_inicial:   geocoded?.bairro || '',
        cidade_inicial:   geocoded?.cidade || '',
        asset_id: patineteId.trim() || '',
        estacaoId: estacaoId.trim() || '',
        turno,
        observacao_fechamento: obs.trim() || '',
        foto1_url: foto1Url,
        foto2_url: foto2Url,
        registradoPor: usuario.uid,
        registradoPorNome: usuario.nome,
        origem_registro: 'Guard',
        criadoEm: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      showToast('Ocorrência registrada!', 'ok');
      limpar();
      onSucesso();
    } catch (e) {
      console.error(e);
      showToast('Erro ao salvar. Tente novamente.', 'erro');
    }
    setBusy(false);
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '13px 14px', boxSizing: 'border-box',
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)',
    borderRadius: 10, color: '#fff', fontSize: 15, outline: 'none',
  };

  const label: React.CSSProperties = {
    display: 'block', color: 'rgba(255,255,255,.4)', fontSize: 11,
    fontWeight: 600, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase',
  };

  return (
    <div style={{ padding: '16px 16px 32px' }}>

      {/* GPS Status */}
      <div style={{
        background: gpsStatus === 'ok' ? 'rgba(34,197,94,.08)' : gpsStatus === 'erro' ? 'rgba(239,68,68,.08)' : 'rgba(255,255,255,.04)',
        border: `1px solid ${gpsStatus === 'ok' ? 'rgba(34,197,94,.2)' : gpsStatus === 'erro' ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.08)'}`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 18 }}>
          {gpsStatus === 'ok' ? '📍' : gpsStatus === 'erro' ? '⚠️' : '⏳'}
        </span>
        <div>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
            {gpsStatus === 'ok' ? 'Localização capturada' : gpsStatus === 'erro' ? 'GPS indisponível' : 'Obtendo localização...'}
          </div>
          {gpsStatus === 'ok' && geocoded && (
            <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, marginTop: 2 }}>
              {[geocoded.endereco, geocoded.bairro, geocoded.cidade].filter(Boolean).join(' · ')}
            </div>
          )}
          {gpsStatus === 'ok' && gps && (
            <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 10, marginTop: 1 }}>
              {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
            </div>
          )}
        </div>
      </div>

      {/* Tipo de ocorrência */}
      <div style={{ marginBottom: 20 }}>
        <span style={label}>Tipo de ocorrência *</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TIPOS.map(t => (
            <button key={t.key} onClick={() => setTipo(t.key)} style={{
              padding: '12px 10px', borderRadius: 10, cursor: 'pointer',
              background: tipo === t.key ? `${t.cor}20` : 'rgba(255,255,255,.04)',
              border: `1px solid ${tipo === t.key ? t.cor + '60' : 'rgba(255,255,255,.08)'}`,
              color: tipo === t.key ? t.cor : 'rgba(255,255,255,.5)',
              fontSize: 13, fontWeight: tipo === t.key ? 700 : 400,
              display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
            } as React.CSSProperties}>
              <span>{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ativo */}
      <div style={{ marginBottom: 20 }}>
        <span style={label}>Tipo de ativo</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {ATIVOS.map(a => (
            <button key={a} onClick={() => setAtivoTipo(a)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
              background: ativoTipo === a ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${ativoTipo === a ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.08)'}`,
              color: ativoTipo === a ? '#a78bfa' : 'rgba(255,255,255,.4)',
              fontSize: 12, fontWeight: ativoTipo === a ? 600 : 400,
            } as React.CSSProperties}>{a}</button>
          ))}
        </div>
      </div>

      {/* ID do patinete */}
      <div style={{ marginBottom: 20 }}>
        <label style={label}>ID / placa do ativo</label>
        <input
          value={patineteId}
          onChange={e => setPatineteId(e.target.value.toUpperCase())}
          placeholder="Ex: JET-0042"
          style={{ ...inp, textTransform: 'uppercase' }}
        />
      </div>

      {/* Descrição */}
      <div style={{ marginBottom: 20 }}>
        <label style={label}>Descrição *</label>
        <textarea
          value={descricao}
          onChange={e => setDescricao(e.target.value)}
          placeholder="Descreva o que aconteceu..."
          rows={4}
          style={{ ...inp, resize: 'none', lineHeight: 1.5 }}
        />
      </div>

      {/* Estação próxima */}
      <div style={{ marginBottom: 20 }}>
        <label style={label}>ID da estação (opcional)</label>
        <input
          value={estacaoId}
          onChange={e => setEstacaoId(e.target.value)}
          placeholder="Ex: SP-001"
          style={inp}
        />
      </div>

      {/* Turno */}
      <div style={{ marginBottom: 20 }}>
        <span style={label}>Turno</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TURNOS.map(t => (
            <button key={t} onClick={() => setTurno(t)} style={{
              padding: '11px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: turno === t ? 'rgba(124,58,237,.15)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${turno === t ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.08)'}`,
              color: turno === t ? '#a78bfa' : 'rgba(255,255,255,.5)',
              fontSize: 13, fontWeight: turno === t ? 600 : 400,
            } as React.CSSProperties}>{t}</button>
          ))}
        </div>
      </div>

      {/* Fotos */}
      <div style={{ marginBottom: 20 }}>
        <span style={label}>Fotos da ocorrência</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([1, 2] as const).map(slot => {
            const foto    = slot === 1 ? foto1 : foto2;
            const preview = slot === 1 ? foto1Preview : foto2Preview;
            const ref  = slot === 1 ? foto1Ref : foto2Ref;
            return (
              <div key={slot}>
                <input
                  ref={ref} type="file" accept="image/*" capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => handleFoto(slot, e.target.files?.[0] || null)}
                />
                <button onClick={() => ref.current?.click()} style={{
                  width: '100%', aspectRatio: '1', borderRadius: 10, cursor: 'pointer',
                  background: preview ? 'transparent' : 'rgba(255,255,255,.04)',
                  border: `1px dashed ${foto ? 'transparent' : 'rgba(255,255,255,.15)'}`,
                  overflow: 'hidden', position: 'relative', padding: 0,
                } as React.CSSProperties}>
                  {preview ? (
                    <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', height: '100%', gap: 6 }}>
                      <span style={{ fontSize: 28 }}>📷</span>
                      <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 11 }}>Foto {slot}</span>
                    </div>
                  )}
                </button>
                {foto && (
                  <button onClick={() => { if (slot === 1) { setFoto1(null); setFoto1Preview(''); } else { setFoto2(null); setFoto2Preview(''); } }} style={{
                    width: '100%', marginTop: 4, padding: '5px 0', borderRadius: 6,
                    background: 'rgba(239,68,68,.1)', border: 'none', color: '#f87171',
                    fontSize: 11, cursor: 'pointer',
                  }}>✕ Remover</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Observação */}
      <div style={{ marginBottom: 28 }}>
        <label style={label}>Observação adicional</label>
        <textarea
          value={obs}
          onChange={e => setObs(e.target.value)}
          placeholder="Informações extras..."
          rows={2}
          style={{ ...inp, resize: 'none' }}
        />
      </div>

      {/* Botão enviar */}
      <button
        onClick={enviar}
        disabled={busy}
        style={{
          width: '100%', padding: '16px 0', borderRadius: 12, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
          background: busy ? 'rgba(124,58,237,.3)' : 'linear-gradient(135deg,#7c3aed,#a78bfa)',
          color: '#fff', fontSize: 16, fontWeight: 700,
          boxShadow: busy ? 'none' : '0 4px 20px rgba(124,58,237,.4)',
          transition: 'all .2s',
        }}>
        {busy ? 'Enviando...' : '🛡 Registrar Ocorrência'}
      </button>
    </div>
  );
}

// ── LISTA DE OCORRÊNCIAS DO TURNO ─────────────────────────────────
function ListaOcorrencias({ ocorrencias, showToast }: {
  ocorrencias: Ocorrencia[];
  showToast: (msg: string, tipo?: 'ok' | 'erro' | 'info') => void;
}) {
  const [expandido, setExpandido] = useState<string | null>(null);

  if (ocorrencias.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '60px 24px', color: 'rgba(255,255,255,.3)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🛡</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Nenhuma ocorrência hoje</div>
        <div style={{ fontSize: 12, textAlign: 'center' }}>
          As ocorrências registradas nas últimas 24h aparecerão aqui.
        </div>
      </div>
    );
  }

  const STATUS_COR: Record<string, string> = {
    'Aberto':      '#ef4444',
    'Em apuração': '#f97316',
    'Recuperado':  '#22c55e',
    'Encerrado':   '#6b7280',
  };

  return (
    <div style={{ padding: '12px 16px 32px' }}>
      <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, marginBottom: 12, textAlign: 'center' }}>
        Últimas 24 horas · {ocorrencias.length} ocorrência{ocorrencias.length > 1 ? 's' : ''}
      </div>

      {ocorrencias.map(o => {
        const tipoMeta = TIPOS.find(t => t.key === o.tipo);
        const aberto   = expandido === o.id;
        return (
          <div key={o.id} style={{
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 12, marginBottom: 10, overflow: 'hidden',
          }}>
            {/* Cabeçalho do card */}
            <button
              onClick={() => setExpandido(aberto ? null : o.id)}
              style={{
                width: '100%', padding: '14px 16px', background: 'none', border: 'none',
                cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
              }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{tipoMeta?.emoji || '⚪'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ color: tipoMeta?.cor || '#fff', fontWeight: 700, fontSize: 14 }}>
                    {tipoMeta?.label || o.tipo}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: `${STATUS_COR[o.status] || '#fff'}20`,
                    color: STATUS_COR[o.status] || '#fff',
                    border: `1px solid ${STATUS_COR[o.status] || '#fff'}40`,
                  }}>{o.status}</span>
                </div>
                <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.descricao}
                </div>
                <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 10, marginTop: 3 }}>
                  {fmtData(o.criadoEm)} · {o.bairro_inicial || o.cidade_inicial || 'Sem localização'}
                </div>
              </div>
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 16, flexShrink: 0 }}>
                {aberto ? '▲' : '▼'}
              </span>
            </button>

            {/* Detalhe expandido */}
            {aberto && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, marginBottom: 12 }}>
                  {[
                    ['ID', o.id],
                    ['Ativo', o.asset_id || '—'],
                    ['Turno', o.turno],
                    ['Prioridade', o.prioridade],
                    ['Estação', o.estacaoId || '—'],
                    ['Cidade', o.cidade_inicial || '—'],
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

                {/* Fotos */}
                {(o.foto1_url || o.foto2_url) && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {[o.foto1_url, o.foto2_url].filter(Boolean).map((url, i) => (
                      <img key={i} src={url} alt={`Foto ${i + 1}`} style={{
                        width: '50%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8,
                      }} />
                    ))}
                  </div>
                )}

                {o.observacao_fechamento && (
                  <div style={{
                    background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 10px',
                    color: 'rgba(255,255,255,.5)', fontSize: 12,
                  }}>💬 {o.observacao_fechamento}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
