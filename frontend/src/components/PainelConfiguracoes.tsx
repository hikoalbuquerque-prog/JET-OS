// frontend/src/components/PainelConfiguracoes.tsx
// Painel unificado de configurações do sistema.
// Abas: GoJet | Monitor | Pagamentos | Telegram

import { useState, useEffect } from 'react';
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot,
  getDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { MonitorConfigPanel } from './MonitorConfigPanel';
import TelegramConfigPanel from '../TelegramConfigPanel';

// ─── Tipos ────────────────────────────────────────────────────────

interface GoJetCidade {
  id: string;
  cityId: string;
  nome: string;
  ativo: boolean;
}

interface PagConfig {
  valor_por_tarefa: number;
  moeda: string;
  ativo: boolean;
}

interface Props {
  onFechar: () => void;
  cidadeAtual: string;
}

const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 2100,
    background: 'rgba(0,0,0,.75)',
    display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
  },
  panel: {
    width: '100%', maxWidth: 780,
    background: '#0b1120',
    display: 'flex', flexDirection: 'column' as const,
    boxShadow: '-8px 0 40px rgba(0,0,0,.6)',
    borderLeft: '1px solid rgba(255,255,255,.08)',
  },
  header: {
    padding: '18px 22px 0',
    background: 'rgba(99,102,241,.06)',
    borderBottom: '1px solid rgba(255,255,255,.07)',
    flexShrink: 0,
  },
  tab: (ativo: boolean) => ({
    padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    color: ativo ? '#818cf8' : 'rgba(255,255,255,.4)',
    borderBottom: ativo ? '2px solid #818cf8' : '2px solid transparent',
    background: 'none', border: 'none', transition: 'color .15s',
  } as React.CSSProperties),
  body: {
    flex: 1, overflowY: 'auto' as const, padding: 24,
  },
  inp: {
    width: '100%', padding: '8px 11px', borderRadius: 7,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 12, outline: 'none',
    boxSizing: 'border-box' as const,
  },
  lbl: {
    display: 'block' as const, fontSize: 10, color: 'rgba(255,255,255,.38)',
    fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  card: {
    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
    borderRadius: 10, padding: 16, marginBottom: 12,
  },
  btnPrimary: {
    background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff',
    border: 'none', padding: '9px 18px', borderRadius: 8,
    cursor: 'pointer', fontWeight: 700, fontSize: 13,
  } as React.CSSProperties,
  btnGhost: {
    background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.5)',
    border: '1px solid rgba(255,255,255,.1)', padding: '9px 14px',
    borderRadius: 8, cursor: 'pointer', fontSize: 12,
  } as React.CSSProperties,
};

// ─── Aba GoJet ────────────────────────────────────────────────────

function AbaGoJet() {
  const [cidades, setCidades] = useState<GoJetCidade[]>([]);
  const [cidadesEstacoes, setCidadesEstacoes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<GoJetCidade | null>(null);
  const [nova, setNova] = useState(false);
  const [form, setForm] = useState({ nome: '', cityId: '', ativo: true });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'estacoes')).then(snap => {
      const set = new Set<string>();
      snap.docs.forEach(d => { const c = d.data().cidade; if (c) set.add(c.trim()); });
      setCidadesEstacoes(Array.from(set).sort());
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, 'gojet_config'), snap => {
      setCidades(snap.docs.map(d => ({ id: d.id, ...d.data() } as GoJetCidade)));
      setLoading(false);
    });
  }, []);

  const salvar = async () => {
    if (!form.nome.trim() || !form.cityId.trim()) { setMsg('Preencha nome e City ID'); return; }
    setSalvando(true);
    try {
      await setDoc(doc(db, 'gojet_config', form.nome.trim()), {
        cityId: form.cityId.trim(), nome: form.nome.trim(), ativo: form.ativo,
      });
      setMsg('✅ Salvo');
      setEditando(null); setNova(false);
      setForm({ nome: '', cityId: '', ativo: true });
    } catch { setMsg('Erro ao salvar'); }
    finally { setSalvando(false); }
  };

  const toggleAtivo = async (c: GoJetCidade) => {
    await setDoc(doc(db, 'gojet_config', c.id), { ...c, ativo: !c.ativo });
  };

  const remover = async (id: string) => {
    if (!confirm(`Remover ${id}?`)) return;
    await deleteDoc(doc(db, 'gojet_config', id));
  };

  if (loading) return <div style={{ color: 'rgba(255,255,255,.4)', padding: 20 }}>Carregando...</div>;

  return (
    <div>
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff' }}>Cidades GoJet</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>Configure a integração com a API GoJet por cidade</div>
        </div>
        <button onClick={() => { setNova(true); setEditando(null); setForm({ nome: '', cityId: '', ativo: true }); }} style={S.btnPrimary}>
          + Nova cidade
        </button>
      </div>

      {(nova || editando) && (
        <div style={{ ...S.card, border: '1px solid rgba(99,102,241,.3)', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#a5b4fc', marginBottom: 14 }}>
            {editando ? `Editar: ${editando.nome}` : 'Nova cidade'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={S.lbl}>Nome da cidade</label>
              {cidadesEstacoes.length > 0 ? (
                <select value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  style={{ ...S.inp, background: '#0d1521', colorScheme: 'dark' }}>
                  <option value="">Selecionar...</option>
                  {cidadesEstacoes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="São Paulo" style={S.inp} />
              )}
            </div>
            <div>
              <label style={S.lbl}>GoJet City ID</label>
              <input value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))}
                placeholder="669f89ebd06775867c31b984" style={S.inp} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
              <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>Ativo</span>
            </label>
            <button onClick={() => { setNova(false); setEditando(null); }} style={S.btnGhost}>Cancelar</button>
            <button onClick={salvar} disabled={salvando} style={S.btnPrimary}>
              {salvando ? 'Salvando...' : '💾 Salvar'}
            </button>
          </div>
          {msg && <div style={{ fontSize: 11, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', marginTop: 8 }}>{msg}</div>}
        </div>
      )}

      {cidades.map(c => (
        <div key={c.id} style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>{c.nome}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.38)', marginTop: 2, fontFamily: 'monospace' }}>{c.cityId}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                background: c.ativo ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.07)',
                color: c.ativo ? '#22c55e' : 'rgba(255,255,255,.35)',
                border: `1px solid ${c.ativo ? 'rgba(34,197,94,.3)' : 'rgba(255,255,255,.1)'}`,
                cursor: 'pointer',
              }} onClick={() => toggleAtivo(c)}>
                {c.ativo ? '● Ativo' : '○ Inativo'}
              </span>
              <button onClick={() => { setEditando(c); setNova(false); setForm({ nome: c.nome, cityId: c.cityId, ativo: c.ativo }); }}
                style={{ ...S.btnGhost, padding: '5px 10px', fontSize: 11 }}>Editar</button>
              <button onClick={() => remover(c.id)}
                style={{ background: 'rgba(239,68,68,.08)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11 }}>
                Remover
              </button>
            </div>
          </div>
        </div>
      ))}

      {cidades.length === 0 && !nova && (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.3)', padding: '40px 0', fontSize: 13 }}>
          Nenhuma cidade GoJet configurada
        </div>
      )}
    </div>
  );
}

// ─── Aba Monitor ──────────────────────────────────────────────────

function AbaMonitor({ cidadeAtual }: { cidadeAtual: string }) {
  const [cidadesDisp, setCidadesDisp] = useState<string[]>([]);
  const [cidade, setCidade] = useState(cidadeAtual);

  useEffect(() => {
    getDocs(collection(db, 'estacoes')).then(snap => {
      const set = new Set<string>();
      snap.docs.forEach(d => { const c = d.data().cidade; if (c) set.add(c.trim()); });
      const arr = Array.from(set).sort();
      setCidadesDisp(arr);
      if (!arr.includes(cidade) && arr.length > 0) setCidade(arr[0]);
    });
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff', flex: 1 }}>Thresholds M1/M2/M3</div>
        <select value={cidade} onChange={e => setCidade(e.target.value)}
          style={{ ...S.inp, width: 'auto', minWidth: 160, background: '#0d1521', colorScheme: 'dark' }}>
          {cidadesDisp.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {cidade && (
        <MonitorConfigPanel cidade={cidade} onFechar={() => {}} inline />
      )}
    </div>
  );
}

// ─── Aba Pagamentos ───────────────────────────────────────────────

function AbaPagamentos() {
  const [configs, setConfigs] = useState<Record<string, PagConfig>>({});
  const [cidades, setCidades] = useState<string[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState({ valor_por_tarefa: 3.5, moeda: 'BRL', ativo: true });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'pagamentos_config')),
      getDocs(collection(db, 'estacoes')),
    ]).then(([pagSnap, estSnap]) => {
      const cfgs: Record<string, PagConfig> = {};
      pagSnap.docs.forEach(d => { cfgs[d.id] = d.data() as PagConfig; });
      setConfigs(cfgs);

      const set = new Set<string>();
      estSnap.docs.forEach(d => { const c = d.data().cidade; if (c) set.add(c.trim()); });
      setCidades(Array.from(set).sort());
    });
  }, []);

  const abrirEdicao = (cidade: string) => {
    const cfg = configs[cidade] || { valor_por_tarefa: 3.5, moeda: 'BRL', ativo: true };
    setForm({ valor_por_tarefa: cfg.valor_por_tarefa, moeda: cfg.moeda || 'BRL', ativo: cfg.ativo !== false });
    setEditando(cidade);
  };

  const salvar = async () => {
    if (!editando) return;
    setSalvando(true);
    try {
      await setDoc(doc(db, 'pagamentos_config', editando), { ...form, atualizadoEm: serverTimestamp() });
      setConfigs(prev => ({ ...prev, [editando]: form }));
      setMsg('✅ Salvo');
      setEditando(null);
    } catch { setMsg('Erro ao salvar'); }
    finally { setSalvando(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff' }}>Pagamentos por cidade</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>Valor por tarefa concluída (scout/charger)</div>
      </div>

      {editando && (
        <div style={{ ...S.card, border: '1px solid rgba(16,185,129,.25)', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#34d399', marginBottom: 14 }}>Editando: {editando}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={S.lbl}>Valor por tarefa (R$)</label>
              <input type="number" min={0} step={0.5} value={form.valor_por_tarefa}
                onChange={e => setForm(f => ({ ...f, valor_por_tarefa: parseFloat(e.target.value) || 0 }))}
                style={S.inp} />
            </div>
            <div>
              <label style={S.lbl}>Moeda</label>
              <select value={form.moeda} onChange={e => setForm(f => ({ ...f, moeda: e.target.value }))}
                style={{ ...S.inp, background: '#0d1521', colorScheme: 'dark' }}>
                <option value="BRL">BRL</option>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 4 }}>
                <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>Ativo</span>
              </label>
            </div>
          </div>
          {msg && <div style={{ fontSize: 11, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', marginTop: 8 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => { setEditando(null); setMsg(''); }} style={S.btnGhost}>Cancelar</button>
            <button onClick={salvar} disabled={salvando} style={S.btnPrimary}>
              {salvando ? 'Salvando...' : '💾 Salvar'}
            </button>
          </div>
        </div>
      )}

      {cidades.map(cidade => {
        const cfg = configs[cidade];
        return (
          <div key={cidade} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#dce8ff' }}>{cidade}</div>
                {cfg ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 3 }}>
                    {cfg.moeda || 'BRL'} {cfg.valor_por_tarefa?.toFixed(2)}/tarefa
                    {' · '}
                    <span style={{ color: cfg.ativo !== false ? '#22c55e' : '#f87171' }}>
                      {cfg.ativo !== false ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 3 }}>Sem configuração</div>
                )}
              </div>
              <button onClick={() => abrirEdicao(cidade)} style={{ ...S.btnGhost, padding: '5px 12px', fontSize: 11 }}>
                {cfg ? 'Editar' : '+ Configurar'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────

type Aba = 'gojet' | 'monitor' | 'pagamentos' | 'telegram';

export default function PainelConfiguracoes({ onFechar, cidadeAtual }: Props) {
  const [aba, setAba] = useState<Aba>('gojet');

  const ABAS: { id: Aba; label: string }[] = [
    { id: 'gojet',      label: '🛴 GoJet' },
    { id: 'monitor',    label: '📊 Monitor' },
    { id: 'pagamentos', label: '💰 Pagamentos' },
    { id: 'telegram',   label: '📨 Telegram' },
  ];

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={S.panel}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 0 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#dce8ff' }}>⚙️ Configurações</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2, marginBottom: 12 }}>
                Integração, monitores, pagamentos e Telegram
              </div>
            </div>
            <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {ABAS.map(a => (
              <button key={a.id} onClick={() => setAba(a.id)} style={S.tab(aba === a.id)}>{a.label}</button>
            ))}
          </div>
        </div>

        {/* Corpo */}
        <div style={S.body}>
          {aba === 'gojet'      && <AbaGoJet />}
          {aba === 'monitor'    && <AbaMonitor cidadeAtual={cidadeAtual} />}
          {aba === 'pagamentos' && <AbaPagamentos />}
          {aba === 'telegram'   && (
            <TelegramConfigPanel onFechar={onFechar} inline />
          )}
        </div>
      </div>
    </div>
  );
}
