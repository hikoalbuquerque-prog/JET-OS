// src/components/LocaisOperacionais.tsx
// Locais operacionais: Base de Carga, Centro de Serviço, Depósito, Ponto de Redistribuição

import { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, where, serverTimestamp
} from 'firebase/firestore';

// ── TIPOS ────────────────────────────────────────────────────────
export type TipoLocal =
  | 'BASE_CARGA'
  | 'CENTRO_SERVICO'
  | 'DEPOSITO'
  | 'PONTO_REDISTRIBUICAO';

export interface LocalOperacional {
  id: string;
  tipo: TipoLocal;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  cidade: string;
  pais: string;
  capacidade?: number;     // patinetes
  responsavel?: string;
  telefone?: string;
  horario?: string;        // "08:00–18:00"
  obs?: string;
  foto?: string;           // URL da foto
  ativo: boolean;
  criadoEm?: any;
  atualizadoEm?: any;
}

// ── META DOS TIPOS ────────────────────────────────────────────────
export const TIPO_LOCAL_META: Record<TipoLocal, {
  icon: string; label: string; color: string; bgColor: string;
}> = {
  BASE_CARGA: {
    icon: '⚡',
    label: 'Base de Carga',
    color: '#facc15',
    bgColor: 'rgba(250,204,21,.15)',
  },
  CENTRO_SERVICO: {
    icon: '🔧',
    label: 'Centro de Serviço',
    color: '#60a5fa',
    bgColor: 'rgba(96,165,250,.15)',
  },
  DEPOSITO: {
    icon: '🏭',
    label: 'Depósito',
    color: '#a78bfa',
    bgColor: 'rgba(167,139,250,.15)',
  },
  PONTO_REDISTRIBUICAO: {
    icon: '🔄',
    label: 'Redistribuição',
    color: '#34d399',
    bgColor: 'rgba(52,211,153,.15)',
  },
};

// ── HOOK ──────────────────────────────────────────────────────────
export function useLocaisOperacionais(cidade: string, pais: string) {
  const [locais, setLocais] = useState<LocalOperacional[]>([]);

  useEffect(() => {
    if (!cidade) return;
    const q = query(
      collection(db, 'locais_operacionais'),
      where('cidade', '==', cidade),
      where('pais', '==', pais)
    );
    const unsub = onSnapshot(q, snap => {
      setLocais(snap.docs.map(d => ({ id: d.id, ...d.data() } as LocalOperacional)));
    });
    return () => unsub();
  }, [cidade, pais]);

  return locais;
}

// ── MODAL CADASTRO/EDIÇÃO ─────────────────────────────────────────
export function LocalOperacionalModal({
  latLng,
  cidade,
  pais,
  editando,
  onFechar,
  showToast,
}: {
  latLng: { lat: number; lng: number };
  cidade: string;
  pais: string;
  editando?: LocalOperacional | null;
  onFechar: () => void;
  showToast: (msg: string, type?: string) => void;
}) {
  const [tipo, setTipo]           = useState<TipoLocal>(editando?.tipo || 'BASE_CARGA');
  const [nome, setNome]           = useState(editando?.nome || '');
  const [endereco, setEndereco]   = useState(editando?.endereco || '');
  const [capacidade, setCapacidade] = useState(String(editando?.capacidade || ''));
  const [responsavel, setResponsavel] = useState(editando?.responsavel || '');
  const [telefone, setTelefone]   = useState(editando?.telefone || '');
  const [horario, setHorario]     = useState(editando?.horario || '');
  const [obs, setObs]             = useState(editando?.obs || '');
  const [foto, setFoto]           = useState(editando?.foto || '');
  const [fotoPreview, setFotoPreview] = useState(editando?.foto || '');
  const [ativo, setAtivo]         = useState(editando?.ativo ?? true);
  const [busy, setBusy]           = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Geocode reverso para preencher endereço
  useEffect(() => {
    if (editando?.endereco || endereco) return;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latLng.lat}&lon=${latLng.lng}&format=json&accept-language=pt-BR`)
      .then(r => r.json())
      .then(d => { if (d.display_name) setEndereco(d.display_name); })
      .catch(() => {});
  }, []);

  // Handle foto upload
  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setFoto(base64);
      setFotoPreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast('Informe o nome do local', 'error'); return; }
    setBusy(true);
    try {
      const raw: Record<string,any> = {
        tipo, nome: nome.trim(), endereco, lat: latLng.lat, lng: latLng.lng,
        cidade, pais, ativo, atualizadoEm: serverTimestamp(),
      };
      if (capacidade)  raw.capacidade  = Number(capacidade);
      if (responsavel) raw.responsavel = responsavel;
      if (telefone)    raw.telefone    = telefone;
      if (horario)     raw.horario     = horario;
      if (obs)         raw.obs         = obs;
      if (foto)        raw.foto        = foto;
      const payload = raw as Omit<LocalOperacional, 'id'>;
      if (editando) {
        await updateDoc(doc(db, 'locais_operacionais', editando.id), payload as any);
        showToast('Local atualizado', 'success');
      } else {
        await addDoc(collection(db, 'locais_operacionais'), {
          ...payload, criadoEm: serverTimestamp()
        });
        showToast('Local adicionado', 'success');
      }
      onFechar();
    } catch (e: any) {
      showToast('Erro: ' + e.message, 'error');
    }
    setBusy(false);
  };

  const excluir = async () => {
    if (!editando || !confirm(`Excluir "${editando.nome}"?`)) return;
    await deleteDoc(doc(db, 'locais_operacionais', editando.id));
    showToast('Local removido', 'success');
    onFechar();
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none',
    fontFamily: 'inherit',
  };
  const lbl: React.CSSProperties = {
    fontSize: 11, color: 'rgba(255,255,255,.5)',
    marginBottom: 4, display: 'block',
  };

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 420,
      background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
      borderLeft: '1px solid rgba(255,255,255,.08)', zIndex: 500,
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
            {editando ? 'Editar local' : 'Novo local operacional'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
            {latLng.lat.toFixed(5)}, {latLng.lng.toFixed(5)}
          </div>
        </div>
        <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 20 }}>✕</button>
      </div>

      {/* Form */}
      <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>

        {/* Tipo */}
        <div>
          <label style={lbl}>Tipo de local</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(Object.keys(TIPO_LOCAL_META) as TipoLocal[]).map(t => {
              const m = TIPO_LOCAL_META[t];
              return (
                <button key={t} onClick={() => setTipo(t)} style={{
                  padding: '10px 8px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${tipo === t ? m.color + '88' : 'rgba(255,255,255,.08)'}`,
                  background: tipo === t ? m.bgColor : 'rgba(255,255,255,.03)',
                  color: tipo === t ? m.color : 'rgba(255,255,255,.4)',
                  fontSize: 12, fontWeight: tipo === t ? 700 : 400,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span> {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Nome */}
        <div>
          <label style={lbl}>Nome *</label>
          <input value={nome} onChange={e => setNome(e.target.value)}
            placeholder={`Ex: ${TIPO_LOCAL_META[tipo].label} Centro`}
            style={inp} />
        </div>

        {/* Endereço */}
        <div>
          <label style={lbl}>Endereço</label>
          <input value={endereco} onChange={e => setEndereco(e.target.value)}
            placeholder="Endereço completo" style={inp} />
        </div>

        {/* Foto */}
        <div>
          <label style={lbl}>Foto do local</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFotoChange}
            style={{ display: 'none' }}
          />
          {fotoPreview && (
            <div style={{ marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)' }}>
              <img src={fotoPreview} alt="Preview" style={{ width: '100%', height: 200, objectFit: 'cover' }} />
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%', padding: '10px 12px',
              background: 'rgba(96,165,250,.1)', border: '1px solid rgba(96,165,250,.3)',
              borderRadius: 8, color: '#60a5fa', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            📷 {fotoPreview ? 'Alterar foto' : 'Adicionar foto'}
          </button>
          {fotoPreview && (
            <button
              onClick={() => { setFoto(''); setFotoPreview(''); }}
              style={{
                width: '100%', padding: '8px 12px', marginTop: 6,
                background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
                borderRadius: 8, color: '#ef4444', fontSize: 12, cursor: 'pointer',
              }}>
              Remover foto
            </button>
          )}
        </div>

        {/* Capacidade + Horário */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>Capacidade (pat.)</label>
            <input type="number" value={capacidade} onChange={e => setCapacidade(e.target.value)}
              placeholder="ex: 50" style={inp} />
          </div>
          <div>
            <label style={lbl}>Horário</label>
            <input value={horario} onChange={e => setHorario(e.target.value)}
              placeholder="08:00–18:00" style={inp} />
          </div>
        </div>

        {/* Responsável + Telefone */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>Responsável</label>
            <input value={responsavel} onChange={e => setResponsavel(e.target.value)}
              placeholder="Nome" style={inp} />
          </div>
          <div>
            <label style={lbl}>Telefone</label>
            <input value={telefone} onChange={e => setTelefone(e.target.value)}
              placeholder="(11) 9xxxx-xxxx" style={inp} />
          </div>
        </div>

        {/* Obs */}
        <div>
          <label style={lbl}>Observações</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)}
            rows={3} placeholder="Informações adicionais..."
            style={{ ...inp, resize: 'vertical', minHeight: 72 }} />
        </div>

        {/* Ativo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <label style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', cursor: 'pointer' }}
            onClick={() => setAtivo(v => !v)}>
            Local ativo
          </label>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 8, flexShrink: 0 }}>
        {editando && (
          <button onClick={excluir} style={{
            padding: '11px 14px', borderRadius: 10,
            border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)',
            color: '#ef4444', cursor: 'pointer', fontSize: 13,
          }}>🗑</button>
        )}
        <button onClick={onFechar} style={{
          flex: 1, padding: '11px', borderRadius: 10,
          border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)',
          color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer',
        }}>Cancelar</button>
        <button onClick={salvar} disabled={busy} style={{
          flex: 2, padding: '11px', borderRadius: 10, border: 'none',
          background: busy ? 'rgba(96,165,250,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
          color: '#fff', fontSize: 13, fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}>
          {busy ? 'Salvando...' : editando ? 'Salvar' : 'Adicionar'}
        </button>
      </div>
    </div>
  );
}
