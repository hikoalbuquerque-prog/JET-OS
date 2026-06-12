import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './lib/firebase';
import TelegramVinculo from './TelegramVinculo';

interface Usuario {
  uid: string;
  email: string;
  nome: string;
  role: string;
  cargoPrestador?: string;
  tipoCadastro?: string;
  statusPrestador?: string;
  cidade?: string;
}

interface Props {
  usuario: Usuario;
  onFechar: () => void;
  onLogout: () => void;
}

const TIPOS_PIX = ['CPF', 'CNPJ', 'E-mail', 'Telefone', 'Chave aleatória'];

const CARGO_LABEL: Record<string, string> = {
  logistica: 'Agente de Logística',
  promotor: 'Promotor',
  fiscal: 'Fiscal',
  seguranca: 'Segurança',
};

const COR_STATUS: Record<string, string> = {
  ativo: '#4ade80',
  pendente_aprovacao: '#fbbf24',
  pendente: '#fbbf24',
  inativo: '#ef4444',
};

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box',
  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
  color: '#fff', fontSize: 13, outline: 'none',
};

const lbl: React.CSSProperties = {
  display: 'block', color: 'rgba(255,255,255,.45)', fontSize: 10,
  fontWeight: 600, marginBottom: 5, letterSpacing: '.05em',
};

export default function TelaPrestadorPerfil({ usuario, onFechar, onLogout }: Props) {
  const [tab, setTab] = useState<'dados' | 'pagamento' | 'telegram'>('dados');
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Dados pessoais
  const [nome, setNome] = useState(usuario.nome || '');
  const [cidade, setCidade] = useState(usuario.cidade || '');

  // CPF/CNPJ e dados fiscais
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [tipoContrato, setTipoContrato] = useState('');

  // PIX
  const [tipoPix, setTipoPix] = useState('CPF');
  const [chavePix, setChavePix] = useState('');

  // Cidades disponíveis
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // Tenta carregar da coleção usuarios primeiro
      const userSnap = await getDoc(doc(db, 'usuarios', usuario.uid));
      if (userSnap.exists()) {
        const d = userSnap.data();
        setNome(d.nome || usuario.nome || '');
        setCidade(d.cidade || usuario.cidade || '');
        if (d.cpf_cnpj) setCpfCnpj(d.cpf_cnpj);
        if (d.pix_tipo) setTipoPix(d.pix_tipo);
        if (d.pix_chave) setChavePix(d.pix_chave);
        if (d.tipo_contrato) setTipoContrato(d.tipo_contrato);
      }

      // Complementa com solicitação de cadastro se não tiver pix/cpf ainda
      const sol = await getDocs(query(
        collection(db, 'solicitacoes_prestadores'),
        where('uid', '==', usuario.uid)
      ));
      if (!sol.empty) {
        const s = sol.docs[0].data();
        if (s.cpf_cnpj) setCpfCnpj(prev => prev || s.cpf_cnpj);
        if (s.pix_chave) setChavePix(prev => prev || s.pix_chave);
        if (s.pix_tipo) setTipoPix(s.pix_tipo);
        if (s.tipo_contrato) setTipoContrato(prev => prev || s.tipo_contrato);
      }

      // Buscar cidades reais das estações
      const estSnap = await getDocs(collection(db, 'estacoes'));
      const cidSet = new Set<string>();
      estSnap.docs.forEach(d => { const c = d.data().cidade; if (c) cidSet.add(c.trim()); });
      setCidadesDisponiveis(Array.from(cidSet).sort());
    } catch (e) {
      console.error('[perfil prestador] erro ao carregar:', e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.uid]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast('Nome é obrigatório'); return; }
    setSalvando(true);
    try {
      const patch = {
        nome: nome.trim(),
        cidade: cidade.trim(),
        cpf_cnpj: cpfCnpj.trim(),
        pix_tipo: tipoPix,
        pix_chave: chavePix.trim(),
        atualizadoEm: serverTimestamp(),
      };
      await updateDoc(doc(db, 'usuarios', usuario.uid), patch);

      // Espelha na solicitação de cadastro para o gestor ver dados atualizados
      const sol = await getDocs(query(
        collection(db, 'solicitacoes_prestadores'),
        where('uid', '==', usuario.uid)
      ));
      if (!sol.empty) {
        await updateDoc(sol.docs[0].ref, patch);
      }

      showToast('Dados salvos com sucesso!');
    } catch (e) {
      console.error(e);
      showToast('Erro ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const statusLabel = usuario.statusPrestador === 'ativo' ? 'Ativo'
    : usuario.statusPrestador === 'pendente_aprovacao' || usuario.statusPrestador === 'pendente' ? 'Aguardando aprovação'
    : usuario.statusPrestador === 'inativo' ? 'Inativo'
    : '—';

  const statusCor = COR_STATUS[usuario.statusPrestador ?? ''] ?? '#4a5a7a';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2100,
      background: '#0d121e', display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)',
        background: '#0d121e', position: 'sticky', top: 0, zIndex: 1,
        flexShrink: 0,
      }}>
        <button onClick={onFechar} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
          fontSize: 20, cursor: 'pointer', padding: 4, lineHeight: 1,
        }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#dce8ff' }}>Meu Perfil</div>
          <div style={{ fontSize: 11, color: '#4a5a7a' }}>
            {CARGO_LABEL[usuario.cargoPrestador ?? ''] ?? usuario.cargoPrestador ?? 'Prestador'}
          </div>
        </div>
        <button onClick={carregar} style={{
          background:'none', border:'none', color:'rgba(255,255,255,.4)',
          fontSize:18, cursor:'pointer', padding:4
        }}>↻</button>
        <button onClick={onLogout} style={{
          background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
          color: '#ef4444', borderRadius: 8, padding: '6px 12px',
          fontSize: 12, cursor: 'pointer', fontWeight: 600,
        }}>Sair</button>
      </div>

      {/* Status card */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <div style={{
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
          borderRadius: 12, padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(26,111,212,.15)', border: '1px solid rgba(26,111,212,.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>👤</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#dce8ff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nome || usuario.nome}</div>
            <div style={{ fontSize: 11, color: '#4a5a7a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{usuario.email}</div>
          </div>
          <div style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
            background: statusCor + '18', color: statusCor,
            border: `1px solid ${statusCor}44`, whiteSpace: 'nowrap', flexShrink: 0,
          }}>{statusLabel}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '0 16px 12px',
        flexShrink: 0,
      }}>
        {([
          { k: 'dados',    label: '👤 Dados pessoais' },
          { k: 'pagamento', label: '💳 Pagamento' },
          { k: 'telegram', label: '📲 Telegram' },
        ] as { k: typeof tab; label: string }[]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, border: 'none',
            background: tab === t.k ? 'rgba(26,111,212,.2)' : 'rgba(255,255,255,.04)',
            color: tab === t.k ? '#60a5fa' : 'rgba(255,255,255,.4)',
            outline: tab === t.k ? '1px solid rgba(26,111,212,.4)' : '1px solid rgba(255,255,255,.07)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '0 16px 24px', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#4a5a7a', paddingTop: 40, fontSize: 13 }}>
            Carregando...
          </div>
        ) : tab === 'dados' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={lbl}>NOME COMPLETO</label>
              <input style={inp} value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Seu nome completo" />
            </div>
            <div>
              <label style={lbl}>E-MAIL</label>
              <input style={{ ...inp, opacity: 0.5, cursor: 'not-allowed' }}
                value={usuario.email} readOnly />
            </div>
            <div>
              <label style={lbl}>CARGO</label>
              <input style={{ ...inp, opacity: 0.5, cursor: 'not-allowed' }}
                value={CARGO_LABEL[usuario.cargoPrestador ?? ''] ?? usuario.cargoPrestador ?? '—'} readOnly />
            </div>
            <div>
              <label style={lbl}>CIDADE DE ATUAÇÃO</label>
              <select style={{ ...inp, appearance: 'none' as any }} value={cidade} onChange={e => setCidade(e.target.value)}>
                <option value="">Selecione a cidade...</option>
                {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>TIPO DE CONTRATO</label>
              <input style={{ ...inp, opacity: 0.5, cursor: 'not-allowed' }}
                value={tipoContrato || '—'} readOnly />
            </div>
            <div>
              <label style={lbl}>CPF / CNPJ</label>
              <input style={inp} value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
                placeholder="000.000.000-00 ou 00.000.000/0001-00" />
            </div>
            <button onClick={salvar} disabled={salvando} style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: salvando ? 'rgba(26,111,212,.3)' : '#1a6fd4',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}>{salvando ? 'Salvando...' : 'Salvar dados'}</button>
          </div>
        ) : tab === 'pagamento' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)',
              borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#6ee7b7', lineHeight: 1.5,
            }}>
              Seus dados de pagamento são usados para processar repasses e pagamentos dos serviços prestados.
            </div>
            <div>
              <label style={lbl}>TIPO DA CHAVE PIX</label>
              <select style={{ ...inp, appearance: 'none' as const }} value={tipoPix}
                onChange={e => setTipoPix(e.target.value)}>
                {TIPOS_PIX.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>CHAVE PIX</label>
              <input style={inp} value={chavePix} onChange={e => setChavePix(e.target.value)}
                placeholder={
                  tipoPix === 'CPF' ? '000.000.000-00'
                  : tipoPix === 'CNPJ' ? '00.000.000/0001-00'
                  : tipoPix === 'E-mail' ? 'seu@email.com'
                  : tipoPix === 'Telefone' ? '+55 (11) 99999-9999'
                  : 'Cole a chave aleatória'
                } />
            </div>
            <div>
              <label style={lbl}>CPF / CNPJ TITULAR</label>
              <input style={inp} value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
                placeholder="Documento do titular da conta Pix" />
            </div>
            <button onClick={salvar} disabled={salvando} style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: salvando ? 'rgba(16,185,129,.3)' : '#059669',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}>{salvando ? 'Salvando...' : 'Salvar dados de pagamento'}</button>
          </div>
        ) : (
          <TelegramVinculo
            usuario={usuario}
            modo="inline"
            onVinculado={() => {}}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1a6fd4', color: '#fff', borderRadius: 20,
          padding: '10px 20px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,.4)', zIndex: 9999,
          whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}
    </div>
  );
}
