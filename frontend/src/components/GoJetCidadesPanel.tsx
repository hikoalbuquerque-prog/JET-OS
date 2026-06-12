// frontend/src/components/GoJetCidadesPanel.tsx
// Painel admin para configurar quais cidades têm integração GoJet.
// Salva em Firestore: gojet_config/{cidade} = { cityId, nome, ativo }
//
// Uso no DashboardManager (aba configurações):
//   import GoJetCidadesPanel from './components/GoJetCidadesPanel';
//   <GoJetCidadesPanel />

import { useState, useEffect } from 'react';
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

interface GoJetCidade {
  id: string;          // nome da cidade (doc id)
  cityId: string;      // GoJet city_id
  nome: string;        // nome legível
  ativo: boolean;
}

// Cidades conhecidas (seed inicial)
const SEED: Omit<GoJetCidade, 'id'>[] = [
  { cityId: '669f89ebd06775867c31b984', nome: 'São Paulo',    ativo: true  },
  { cityId: '67ab79f4cd4d3cbb07a0c02e', nome: 'Santo André',  ativo: false },
];

export default function GoJetCidadesPanel() {
  const [cidades,          setCidades]          = useState<GoJetCidade[]>([]);
  const [cidadesFirestore, setCidadesFirestore] = useState<string[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [editando,         setEditando]         = useState<GoJetCidade | null>(null);
  const [nova,             setNova]             = useState(false);
  const [form,             setForm]             = useState({ nome: '', cityId: '', ativo: true });
  const [salvando,         setSalvando]         = useState(false);
  const [erro,             setErro]             = useState('');

  // Carrega cidades disponíveis do Firestore (estações cadastradas)
  useEffect(() => {
    getDocs(collection(db, 'estacoes')).then(snap => {
      const set = new Set<string>();
      snap.docs.forEach(d => {
        const c = d.data().cidade;
        if (c && typeof c === 'string') set.add(c.trim());
      });
      setCidadesFirestore(Array.from(set).sort());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'gojet_config'), snap => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() } as GoJetCidade));
      setCidades(lista);
      setLoading(false);

      // Seed inicial se vazio
      if (snap.empty) {
        Promise.all(SEED.map(s =>
          setDoc(doc(db, 'gojet_config', s.nome), s)
        )).catch(() => {});
      }
    });
    return unsub;
  }, []);

  const salvar = async () => {
    if (!form.nome.trim() || !form.cityId.trim()) {
      setErro('Nome e City ID são obrigatórios');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await setDoc(doc(db, 'gojet_config', form.nome.trim()), {
        cityId: form.cityId.trim(),
        nome:   form.nome.trim(),
        ativo:  form.ativo,
      });
      setNova(false);
      setEditando(null);
      setForm({ nome: '', cityId: '', ativo: true });
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (id: string) => {
    if (!confirm(`Remover ${id}?`)) return;
    await deleteDoc(doc(db, 'gojet_config', id));
  };

  const toggleAtivo = async (c: GoJetCidade) => {
    await setDoc(doc(db, 'gojet_config', c.id), { ...c, ativo: !c.ativo });
  };

  const iniciarEditar = (c: GoJetCidade) => {
    setEditando(c);
    setNova(true);
    setForm({ nome: c.nome, cityId: c.cityId, ativo: c.ativo });
  };

  const S = {
    section: {
      background: '#0d1521', border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 10, padding: 14, marginBottom: 12,
    } as React.CSSProperties,
    title: {
      fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.35)',
      textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10,
    },
    row: {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)',
    } as React.CSSProperties,
    inp: {
      width: '100%', padding: '8px 10px', borderRadius: 7,
      background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
      color: '#dce8ff', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const,
      marginBottom: 8,
    },
    lbl: {
      fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.4)',
      display: 'block' as const, marginBottom: 4,
      textTransform: 'uppercase' as const, letterSpacing: 0.5,
    },
    btn: (cor: string) => ({
      padding: '7px 12px', borderRadius: 7, border: 'none',
      background: cor, color: '#fff', fontSize: 11, fontWeight: 600,
      cursor: 'pointer',
    }),
  };

  return (
    <div>
      <div style={S.title}>🗺 Cidades GoJet</div>

      {/* Lista */}
      <div style={S.section}>
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12 }}>Carregando...</div>
        ) : cidades.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12 }}>
            Nenhuma cidade configurada.
          </div>
        ) : cidades.map(c => (
          <div key={c.id} style={S.row}>
            {/* Toggle ativo */}
            <div
              onClick={() => toggleAtivo(c)}
              style={{
                width: 32, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
                background: c.ativo ? '#10b981' : 'rgba(255,255,255,.1)',
                position: 'relative', transition: 'background .2s',
              }}>
              <div style={{
                position: 'absolute', top: 2,
                left: c.ativo ? 16 : 2,
                width: 14, height: 14, borderRadius: 7,
                background: '#fff', transition: 'left .2s',
              }} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#dce8ff' }}>{c.nome}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontFamily: 'monospace' }}>
                {c.cityId}
              </div>
            </div>

            <button onClick={() => iniciarEditar(c)} style={S.btn('rgba(255,255,255,.08)')}>
              ✏️
            </button>
            <button onClick={() => remover(c.id)} style={S.btn('rgba(239,68,68,.15)')}>
              🗑
            </button>
          </div>
        ))}
      </div>

      {/* Formulário novo/editar */}
      {nova ? (
        <div style={S.section}>
          <div style={S.title}>{editando ? 'Editar cidade' : 'Nova cidade'}</div>

          <label style={S.lbl}>Nome da cidade</label>
          {editando ? (
            // Editando — nome não pode mudar (é o doc ID)
            <div style={{ ...S.inp, color: 'rgba(255,255,255,.4)', cursor: 'not-allowed' }}>
              {form.nome}
            </div>
          ) : cidadesFirestore.length > 0 ? (
            // Dropdown com cidades que têm estações
            <select
              style={{ ...S.inp, cursor: 'pointer' }}
              value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            >
              <option value="">— Selecionar cidade —</option>
              {cidadesFirestore
                .filter(c => !cidades.find(gc => gc.nome === c)) // esconde já configuradas
                .map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              <option value="__manual__">✏️ Digitar manualmente...</option>
            </select>
          ) : (
            <input style={S.inp} value={form.nome}
              placeholder="Ex: Recife"
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          )}
          {form.nome === '__manual__' && (
            <input style={{ ...S.inp, marginTop: 6 }}
              placeholder="Digite o nome da cidade exatamente como no Firestore"
              autoFocus
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          )}

          <label style={S.lbl}>City ID (GoJet)</label>
          <input style={S.inp} value={form.cityId}
            placeholder="Ex: 669f89ebd06775867c31b984"
            onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} />

          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 8 }}>
            💡 Abrir map.gojet.app → selecionar cidade → copiar o ?cid= da URL
          </div>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: 'rgba(255,255,255,.5)', cursor: 'pointer', marginBottom: 10,
          }}>
            <input type="checkbox" checked={form.ativo}
              onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} />
            Ativo (aparece no overlay GoJet)
          </label>

          {erro && <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setNova(false); setEditando(null); setForm({ nome: '', cityId: '', ativo: true }); setErro(''); }}
              style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
                background: 'rgba(255,255,255,.05)', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 12 }}>
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando}
              style={{ flex: 2, padding: '8px', borderRadius: 8, border: 'none',
                background: '#10b981', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              {salvando ? 'Salvando...' : '✓ Salvar'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setNova(true); setEditando(null); setForm({ nome: '', cityId: '', ativo: true }); }}
          style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px dashed rgba(16,185,129,.3)',
            background: 'rgba(16,185,129,.06)', color: '#10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          + Adicionar cidade
        </button>
      )}
    </div>
  );
}
