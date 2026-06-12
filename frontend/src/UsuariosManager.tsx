import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, auth } from './lib/firebase';

interface SolicitacaoPrestador {
  id: string;
  uid: string;
  email: string;
  nome: string;
  cargo: string;
  cpf_cnpj: string;
  pix_chave: string;
  pix_tipo: string;
  cidade: string;
  tipo_contrato: string;
  telegram: string;
  motivo_cadastro: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  data_criacao: any;
  respondido_por?: string;
}

interface UsuarioAtivo {
  id: string;
  uid: string;
  email: string;
  nome: string;
  role: string;
  paises?: string[];
  cidadesPermitidas?: string[];
  cidadesGerenciaLog?: string[];
  cargoPrestador?: string;
  tipoCadastro?: string;
}

// CIDADES agora é estado dinâmico — ver useEffect abaixo
const CIDADES_FALLBACK = [
  'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília',
  'Salvador', 'Fortaleza', 'Manaus', 'Curitiba',
  'Porto Alegre', 'Recife', 'Goiânia', 'Belém'
];


// ── Componente reutilizável: seletor de cidades com chips ──────────────────────

function CidadesSeletor({
  titulo, descricao, cor, cidades, selecionadas, onChange,
}: {
  titulo: string; descricao: string; cor: string;
  cidades: string[]; selecionadas: string[];
  onChange: (novas: string[]) => void;
}) {
  const [busca, setBusca] = useState('');
  const filtradas = cidades.filter(c => c.toLowerCase().includes(busca.toLowerCase()));

  const toggle = (cidade: string) => {
    if (selecionadas.includes(cidade)) {
      onChange(selecionadas.filter(c => c !== cidade));
    } else {
      onChange([...selecionadas, cidade]);
    }
  };

  const todas = () => onChange([...cidades]);
  const nenhuma = () => onChange([]);

  return (
    <div style={{ background: `${cor}12`, border: `1px solid ${cor}30`,
      borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: cor, marginBottom: 2 }}>{titulo}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>{descricao}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={todas} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6,
            border: `1px solid ${cor}40`, background: `${cor}15`, color: cor, cursor: 'pointer' }}>
            Todas
          </button>
          <button onClick={nenhuma} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,.1)', background: 'transparent',
            color: 'rgba(255,255,255,.4)', cursor: 'pointer' }}>
            Limpar
          </button>
        </div>
      </div>

      {/* Chips selecionadas */}
      {selecionadas.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {selecionadas.map(c => (
            <span key={c} onClick={() => toggle(c)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: `${cor}25`, color: cor, border: `1px solid ${cor}40`,
                cursor: 'pointer' }}>
              {c} <span style={{ fontSize: 12, opacity: .7 }}>×</span>
            </span>
          ))}
        </div>
      )}

      {/* Busca + checkboxes */}
      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="🔍 Filtrar cidades..."
        style={{ width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 11, marginBottom: 8,
          background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
          color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' as const }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4,
        maxHeight: 140, overflowY: 'auto', scrollbarWidth: 'thin' as const }}>
        {filtradas.map(cidade => {
          const sel = selecionadas.includes(cidade);
          return (
            <label key={cidade} style={{ display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', padding: '4px 6px', borderRadius: 6,
              background: sel ? `${cor}15` : 'transparent',
              border: `1px solid ${sel ? cor + '40' : 'transparent'}`,
              fontSize: 11, color: sel ? cor : 'rgba(255,255,255,.5)',
              transition: 'all .1s' }}>
              <input type="checkbox" checked={sel} onChange={() => toggle(cidade)}
                style={{ accentColor: cor, cursor: 'pointer', flexShrink: 0 }} />
              {cidade}
            </label>
          );
        })}
        {filtradas.length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', padding: '8px 0' }}>
            Nenhuma cidade encontrada
          </div>
        )}
      </div>

      <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
        {selecionadas.length} de {cidades.length} selecionadas
      </div>
    </div>
  );
}

export default function UsuariosManager({ 
  onFechar, 
  roleAtual,
  paisesAtual
}: { 
  onFechar: () => void; 
  roleAtual: string;
  paisesAtual: string[];
}) {
  const [aba, setAba] = useState<'solicitacoes' | 'usuarios'>('solicitacoes');
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoPrestador[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioAtivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionada, setSelecionada] = useState<SolicitacaoPrestador | null>(null);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioAtivo | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aprovando, setAprovando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [removendo, setRemovendoAcesso] = useState(false);
  const [roleAprovacao, setRoleAprovacao] = useState('guard');
  const [cidadesAprovacao, setCidadesAprovacao] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  const showMsg = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3000); };
  const [cidadesReais, setCidadesReais] = useState<string[]>(CIDADES_FALLBACK);
  const [buscaUsuario, setBuscaUsuario] = useState('');
  const [filtroRole, setFiltroRole] = useState<string>('todos');
  const [selecionadosLote, setSelecionadosLote] = useState<Set<string>>(new Set());
  const [aprovandoLote, setAprovandoLote] = useState(false);

  // Carrega cidades reais que têm estações no Firestore
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'estacoes'));
        const set = new Set<string>();
        snap.docs.forEach(d => {
          const c = d.data().cidade;
          if (c && typeof c === 'string') set.add(c.trim());
        });
        const lista = Array.from(set).sort();
        if (lista.length > 0) setCidadesReais(lista);
      } catch {
        // mantém CIDADES_FALLBACK
      }
    })();
  }, []);

  useEffect(() => {
    const carregarSolicitacoes = async () => {
      try {
        const q = query(
          collection(db, 'solicitacoes_prestadores'),
          where('status', '==', 'pendente')
        );
        const snap = await getDocs(q);
        const dados = snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        })) as SolicitacaoPrestador[];
        setSolicitacoes(dados);
      } catch (err) {
        console.error('Erro carregando solicitações:', err);
      } finally {
        setLoading(false);
      }
    };

    carregarSolicitacoes();
  }, []);

  useEffect(() => {
    if (aba !== 'usuarios') return;

    const carregarUsuarios = async () => {
      try {
        // gestor_seg só vê guards; outros gestores veem todos
        const rolesGuard = ['guard', 'gestor_seg', 'campo', 'logistica', 'promotor', 'viewer'];
        const q = roleAtual === 'gestor_seg'
          ? query(collection(db, 'usuarios'), where('role', 'in', rolesGuard))
          : query(collection(db, 'usuarios'));
        const snap = await getDocs(q);
        const dados = snap.docs.map(d => ({
          id: d.id,
          uid: d.id,
          ...d.data()
        })) as UsuarioAtivo[];
        setUsuarios(dados);
      } catch (err) {
        console.error('Erro carregando usuários:', err);
      }
    };

    carregarUsuarios();
  }, [aba]);

  const podeVerSolicitacao = (req: SolicitacaoPrestador, role: string): boolean => {
    const cargo = req.cargo;
    if (cargo === 'guard' || cargo === 'seguranca') {
      return role === 'gestor_seg' || role === 'gestor' || role === 'admin' || role === 'supergestor';
    }
    if (cargo === 'logistica' || cargo === 'gestor_log') {
      return role === 'gestor_log' || role === 'gestor' || role === 'admin' || role === 'supergestor';
    }
    return role === 'gestor' || role === 'admin' || role === 'supergestor';
  };

  const aprovar = async (req: SolicitacaoPrestador) => {
    setAprovando(true);
    try {
      await updateDoc(doc(db, 'solicitacoes_prestadores', req.id), {
        status: 'aprovado',
        data_resposta: new Date(),
        respondido_por: auth.currentUser?.uid,
        roleAtribuido: roleAprovacao,
      });

      await updateDoc(doc(db, 'usuarios', req.uid), {
        role:               roleAprovacao,
        cidadesPermitidas:  cidadesAprovacao,
        cidadesGerenciaLog: roleAprovacao === 'logistica' ? cidadesAprovacao : [],
        cargoPrestador: req.cargo,
        tipoCadastro: 'prestador',
        statusPrestador: 'ativo',
        cpf_cnpj: req.cpf_cnpj,
        pix_chave: req.pix_chave,
        pix_tipo: req.pix_tipo,
        cidade: cidadesAprovacao[0] ?? req.cidade,
        tipo_contrato: req.tipo_contrato,
        telegram: req.telegram,
        ativo: true,
      });

      const fns = getFunctions(undefined, 'southamerica-east1');
      await httpsCallable(fns, 'notificarAprovacaoPrestador')({ uid: req.uid, aprovado: true }).catch(() => {});

      setSolicitacoes(prev => prev.filter(s => s.id !== req.id));
      setSelecionada(null);
      setRoleAprovacao('guard');
      setCidadesAprovacao([]);
    } catch (err) {
      console.error('Erro ao aprovar:', err);
    } finally {
      setAprovando(false);
    }
  };

  const rejeitar = async (req: SolicitacaoPrestador) => {
    if (!motivo.trim()) {
      showMsg('⚠ Informe o motivo da rejeição'); return;
    }

    setAprovando(true);
    try {
      await updateDoc(doc(db, 'solicitacoes_prestadores', req.id), {
        status: 'rejeitado',
        data_resposta: new Date(),
        respondido_por: auth.currentUser?.uid,
        motivo_rejeicao: motivo
      });

      const fns = getFunctions(undefined, 'southamerica-east1');
      await httpsCallable(fns, 'notificarAprovacaoPrestador')({ uid: req.uid, aprovado: false, motivo }).catch(() => {});

      setSolicitacoes(prev => prev.filter(s => s.id !== req.id));
      setSelecionada(null);
      setMotivo('');
      setRoleAprovacao('guard');

      showMsg('✅ Solicitação rejeitada');
    } catch (err) {
      console.error('Erro ao rejeitar:', err);
      showMsg('❌ Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setAprovando(false);
    }
  };

  const aprovarLote = async () => {
    if (selecionadosLote.size === 0) return;
    if (!window.confirm(`Aprovar ${selecionadosLote.size} solicitação(ões) como "${roleAprovacao}"?`)) return;
    setAprovandoLote(true);
    const fns = getFunctions(undefined, 'southamerica-east1');
    let ok = 0;
    for (const id of Array.from(selecionadosLote)) {
      const req = solicitacoes.find(s => s.id === id);
      if (!req) continue;
      try {
        await updateDoc(doc(db, 'solicitacoes_prestadores', id), {
          status: 'aprovado', data_resposta: new Date(),
          respondido_por: auth.currentUser?.uid, roleAtribuido: roleAprovacao,
        });
        await updateDoc(doc(db, 'usuarios', req.uid), {
          role: roleAprovacao, cidadesPermitidas: cidadesAprovacao,
          cargoPrestador: req.cargo, tipoCadastro: 'prestador',
          statusPrestador: 'ativo', cpf_cnpj: req.cpf_cnpj,
          pix_chave: req.pix_chave, pix_tipo: req.pix_tipo,
          cidade: cidadesAprovacao[0] ?? req.cidade,
          tipo_contrato: req.tipo_contrato, telegram: req.telegram, ativo: true,
        });
        httpsCallable(fns, 'notificarAprovacaoPrestador')({ uid: req.uid, aprovado: true }).catch(() => {});
        ok++;
      } catch (e) { console.error('Lote erro', id, e); }
    }
    setSolicitacoes(prev => prev.filter(s => !selecionadosLote.has(s.id)));
    setSelecionadosLote(new Set());
    showMsg(`✅ ${ok} aprovados`);
    setAprovandoLote(false);
  };

  const salvarPermissoesCidades = async (usuario: UsuarioAtivo) => {
    setSalvando(true);
    try {
      await updateDoc(doc(db, 'usuarios', usuario.uid), {
        cidadesPermitidas:  usuario.cidadesPermitidas  || [],
        cidadesGerenciaLog: usuario.cidadesGerenciaLog || [],
        role:               usuario.role,
        ativo:              true,
      });
      showMsg('✅ Permissões de cidades salvas!');
      setUsuarioSelecionado(null);
    } catch (err) {
      console.error('Erro:', err);
      showMsg('❌ Erro ao salvar: ' + (err instanceof Error ? err.message : 'Desconhecido'));
    } finally {
      setSalvando(false);
    }
  };

  const executarRemocaoAcesso = async (usuario: UsuarioAtivo) => {
    setRemovendoAcesso(true);
    try {
      const fn = httpsCallable(getFunctions(), 'revogarAcesso');
      await fn({ uid: usuario.uid });
      showMsg('✅ Acesso revogado. Usuário não conseguirá mais entrar.');
      setUsuarios(prev => prev.filter(u => u.uid !== usuario.uid));
      setUsuarioSelecionado(null);
      setConfirmandoRemocao(false);
    } catch (err) {
      showMsg('❌ Erro: ' + (err instanceof Error ? err.message : 'Falha'));
    } finally {
      setRemovendoAcesso(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20
    }} onClick={e => e.target === e.currentTarget && onFechar()}>

      {/* Toast */}
      {toastMsg && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: toastMsg.startsWith('✅') ? 'rgba(16,185,129,.9)' : toastMsg.startsWith('⚠') ? 'rgba(234,179,8,.9)' : 'rgba(239,68,68,.9)',
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
          {toastMsg}
        </div>
      )}

      <div style={{
        background: '#0d1521', borderRadius: 16,
        width: '100%', maxWidth: 900, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(99,102,241,.2)',
        boxShadow: '0 8px 32px rgba(0,0,0,.5)'
      }}>

        <div style={{
          padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#c7d2fe' }}>
            👥 Gerenciar Usuários
          </div>
          <button onClick={onFechar} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
            cursor: 'pointer', fontSize: 20
          }}>✕</button>
        </div>

        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,.06)',
          paddingLeft: 24
        }}>
          <button onClick={() => setAba('solicitacoes')} style={{
            background: 'none', border: 'none', 
            padding: '12px 16px', fontSize: 14, fontWeight: 600,
            color: aba === 'solicitacoes' ? '#6366f1' : 'rgba(255,255,255,.4)',
            borderBottom: aba === 'solicitacoes' ? '2px solid #6366f1' : 'none',
            cursor: 'pointer'
          }}>
            📝 Solicitações ({solicitacoes.length})
          </button>
          <button onClick={() => setAba('usuarios')} style={{
            background: 'none', border: 'none',
            padding: '12px 16px', fontSize: 14, fontWeight: 600,
            color: aba === 'usuarios' ? '#6366f1' : 'rgba(255,255,255,.4)',
            borderBottom: aba === 'usuarios' ? '2px solid #6366f1' : 'none',
            cursor: 'pointer'
          }}>
            ✓ Usuários Ativos ({usuarios.length})
          </button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', padding: 24,
          color: '#dce8ff'
        }}>

          {aba === 'solicitacoes' && (
            <div>
              {selecionada ? (
                <div style={{
                  background: 'rgba(99,102,241,.07)',
                  padding: 20, borderRadius: 12,
                  border: '1px solid rgba(99,102,241,.15)'
                }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                    {selecionada.nome}
                  </div>

                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                    marginBottom: 16, fontSize: 13
                  }}>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Email</div>
                      <div>{selecionada.email}</div>
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Cargo</div>
                      <div style={{ background: 'rgba(16,185,129,.2)', padding: '4px 8px', borderRadius: 4, display: 'inline-block', color: '#10b981' }}>
                        {selecionada.cargo}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>CPF/CNPJ</div>
                      <div>{selecionada.cpf_cnpj}</div>
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Cidade</div>
                      <div>{selecionada.cidade}</div>
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Pix</div>
                      <div>{selecionada.pix_chave} ({selecionada.pix_tipo})</div>
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Telegram</div>
                      <div>{selecionada.telegram}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Motivo</div>
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        {selecionada.motivo_cadastro}
                      </div>
                    </div>
                  </div>

                  {/* Seletor de role/cargo de acesso */}
                  <div style={{ marginBottom: 14, background: 'rgba(16,185,129,.06)',
                    border: '1px solid rgba(16,185,129,.2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981',
                      textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
                      🔑 Cargo de acesso ao aprovar
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {([
                        { role: 'guard',     label: '🛡 Guard',      desc: 'Segurança / ocorrências' },
                        { role: 'campo',     label: '🗺 Campo',      desc: 'Operações de campo' },
                        { role: 'logistica', label: '📦 Logística',  desc: 'Tarefas logísticas' },
                        { role: 'promotor',    label: '📣 Promotor',   desc: 'Promotores' },
                        { role: 'viewer',      label: '👁 Viewer',     desc: 'Somente visualização' },
                        { role: 'gestor_log',  label: '🚚 Gest. Log.', desc: 'Gestão logística' },
                        { role: 'gestor',      label: '⚙ Gestor',     desc: 'Acesso completo' },
                      ] as any[]).map(({ role, label, desc }) => (
                        <button key={role} onClick={() => setRoleAprovacao(role)}
                          style={{
                            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                            border: `1px solid ${roleAprovacao === role ? 'rgba(16,185,129,.5)' : 'rgba(255,255,255,.1)'}`,
                            background: roleAprovacao === role ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.04)',
                            color: roleAprovacao === role ? '#10b981' : 'rgba(255,255,255,.5)',
                            fontWeight: roleAprovacao === role ? 700 : 400,
                            transition: 'all .15s',
                          }}>
                          {label}
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>{desc}</div>
                        </button>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                      Selecionado: <b style={{ color: '#10b981' }}>{roleAprovacao}</b>
                      {' '}— o usuário receberá acesso correspondente ao aprovar.
                    </div>
                  </div>

                  {/* Cidades de atuação — todos os cargos */}
                  <CidadesSeletor
                    titulo="🏙 Cidades de atuação"
                    descricao="Selecione as cidades onde este prestador poderá atuar. A cidade do cadastro já vem pré-selecionada."
                    cor={roleAprovacao === 'viewer' ? '#3b82f6' : roleAprovacao === 'logistica' ? '#10b981' : '#6366f1'}
                    cidades={cidadesReais}
                    selecionadas={cidadesAprovacao}
                    onChange={setCidadesAprovacao}
                  />

                  <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
                    <button onClick={() => aprovar(selecionada)} disabled={aprovando} style={{
                      background: aprovando ? 'rgba(16,185,129,.5)' : 'linear-gradient(135deg,#10b981,#059669)',
                      border: 'none', borderRadius: 8, padding: '10px 20px',
                      color: '#fff', fontWeight: 700, cursor: aprovando ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}>
                      {aprovando ? '⏳ Aprovando...' : `✓ Aprovar como ${roleAprovacao}`}
                    </button>
                    <button onClick={() => setSelecionada(null)} disabled={aprovando} style={{
                      background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                      borderRadius: 8, padding: '10px 16px',
                      color: 'rgba(255,255,255,.5)', cursor: aprovando ? 'not-allowed' : 'pointer'
                    }}>
                      Cancelar
                    </button>
                  </div>

                  <div style={{
                    background: 'rgba(239,68,68,.07)',
                    padding: 12, borderRadius: 8,
                    border: '1px solid rgba(239,68,68,.15)'
                  }}>
                    <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8, fontWeight: 600 }}>
                      Ou Rejeitar Solicitação
                    </div>
                    <textarea value={motivo} onChange={e => setMotivo(e.target.value)} disabled={aprovando}
                      placeholder="Motivo da rejeição..." style={{
                        width: '100%', padding: 8, borderRadius: 4,
                        background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.1)',
                        color: '#dce8ff', fontSize: 12, marginBottom: 8, resize: 'vertical',
                        opacity: aprovando ? 0.5 : 1
                      }} />
                    <button onClick={() => rejeitar(selecionada)} disabled={aprovando} style={{
                      background: aprovando ? 'rgba(239,68,68,.5)' : '#ef4444', border: 'none', borderRadius: 6,
                      padding: '8px 12px', color: '#fff', fontSize: 12,
                      fontWeight: 600, cursor: aprovando ? 'not-allowed' : 'pointer'
                    }}>
                      {aprovando ? '⏳ Rejeitando...' : '🗑 Rejeitar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {loading ? (
                    <div style={{ textAlign: 'center', padding: 32 }}>⏳ Carregando...</div>
                  ) : solicitacoes.filter(req => podeVerSolicitacao(req, roleAtual)).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,.5)' }}>
                      ✓ Nenhuma solicitação pendente
                    </div>
                  ) : (
                    <>
                    {/* Barra de aprovação em lote */}
                    {selecionadosLote.size > 0 && (
                      <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)',
                        borderRadius: 10, padding: '10px 14px', marginBottom: 10,
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#10b981', fontWeight: 700 }}>
                          {selecionadosLote.size} selecionado(s)
                        </span>
                        <select value={roleAprovacao} onChange={e => setRoleAprovacao(e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: 6, background: '#0d1521',
                            border: '1px solid rgba(255,255,255,.15)', color: '#dce8ff', fontSize: 12 }}>
                          {['guard','campo','logistica','promotor','viewer','gestor_log','gestor'].map(r =>
                            <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button onClick={aprovarLote} disabled={aprovandoLote} style={{
                          padding: '6px 14px', borderRadius: 8, border: 'none',
                          background: '#10b981', color: '#fff', fontSize: 12, fontWeight: 700,
                          cursor: aprovandoLote ? 'not-allowed' : 'pointer' }}>
                          {aprovandoLote ? '⏳ Aprovando...' : '✅ Aprovar selecionados'}
                        </button>
                        <button onClick={() => setSelecionadosLote(new Set())} style={{
                          padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
                          background: 'transparent', color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer' }}>
                          Limpar
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {solicitacoes.filter(req => podeVerSolicitacao(req, roleAtual)).map(req => (
                        <div key={req.id} style={{
                          background: selecionadosLote.has(req.id) ? 'rgba(99,102,241,.18)' : 'rgba(99,102,241,.08)',
                          padding: 12, borderRadius: 8,
                          border: `1px solid ${selecionadosLote.has(req.id) ? 'rgba(99,102,241,.4)' : 'rgba(99,102,241,.15)'}`,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                          <input type="checkbox" checked={selecionadosLote.has(req.id)}
                            onChange={e => { e.stopPropagation(); setSelecionadosLote(prev => { const s = new Set(prev); e.target.checked ? s.add(req.id) : s.delete(req.id); return s; }); }}
                            style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                          <div style={{ flex: 1 }} onClick={() => { setSelecionada(req); setCidadesAprovacao(req.cidade ? [req.cidade] : []); }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>{req.nome}</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
                                  {req.email} · {req.cargo}
                                </div>
                              </div>
                              <div style={{
                                background: 'rgba(249,191,36,.15)',
                                padding: '4px 12px', borderRadius: 20,
                                fontSize: 11, color: '#fbbf24', fontWeight: 600
                              }}>
                                Pendente
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {aba === 'usuarios' && (
            <div>
              {usuarioSelecionado ? (
                <div style={{
                  background: 'rgba(99,102,241,.07)',
                  padding: 20, borderRadius: 12,
                  border: '1px solid rgba(99,102,241,.15)'
                }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                    {usuarioSelecionado.nome}
                  </div>

                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                    marginBottom: 16, fontSize: 13
                  }}>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Email</div>
                      <div>{usuarioSelecionado.email}</div>
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>Role</div>
                      <div style={{ background: 'rgba(99,102,241,.2)', padding: '4px 8px', borderRadius: 4, display: 'inline-block', color: '#a5b4fc' }}>
                        {usuarioSelecionado.role}
                      </div>
                    </div>
                  </div>

                  {/* ── Alterar role ─────────────────────── */}
                  <div style={{ marginBottom: 14, background: 'rgba(99,102,241,.07)',
                    border: '1px solid rgba(99,102,241,.2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc',
                      textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
                      🔑 Role de acesso
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {([
                        { role: 'guard',     label: '🛡 Guard'      },
                        { role: 'campo',     label: '🗺 Campo'      },
                        { role: 'logistica', label: '📦 Logística'  },
                        { role: 'promotor',  label: '📣 Promotor'   },
                        { role: 'viewer',    label: '👁 Viewer'     },
                        { role: 'gestor',    label: '⚙ Gestor'     },
                        { role: 'gestor_seg',label: '🛡⚙ Gest.Seg' },
                      ] as const).map(({ role, label }) => (
                        <button key={role}
                          onClick={() => setUsuarioSelecionado({ ...usuarioSelecionado, role })}
                          style={{
                            padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
                            border: `1px solid ${usuarioSelecionado.role === role ? 'rgba(99,102,241,.6)' : 'rgba(255,255,255,.1)'}`,
                            background: usuarioSelecionado.role === role ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.04)',
                            color: usuarioSelecionado.role === role ? '#a5b4fc' : 'rgba(255,255,255,.5)',
                            fontWeight: usuarioSelecionado.role === role ? 700 : 400,
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Cidades Viewer ────────────────────── */}
                  {(usuarioSelecionado.role === 'viewer') && (
                    <CidadesSeletor
                      titulo="🏙 Cidades que pode visualizar"
                      descricao="Viewer só vê dados das cidades selecionadas."
                      cor="#3b82f6"
                      cidades={cidadesReais}
                      selecionadas={usuarioSelecionado.cidadesPermitidas || []}
                      onChange={novas => setUsuarioSelecionado({ ...usuarioSelecionado, cidadesPermitidas: novas })}
                    />
                  )}

                  {/* ── Cidades Ag. Logística ─────────────── */}
                  {(usuarioSelecionado.role === 'logistica') && (
                    <CidadesSeletor
                      titulo="🚚 Cidades que gerencia (Logística)"
                      descricao="Ag. Logística vê tarefas e pedidos apenas das cidades selecionadas."
                      cor="#10b981"
                      cidades={cidadesReais}
                      selecionadas={usuarioSelecionado.cidadesGerenciaLog || []}
                      onChange={novas => setUsuarioSelecionado({ ...usuarioSelecionado, cidadesGerenciaLog: novas })}
                    />
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' as const }}>
                    <button onClick={() => salvarPermissoesCidades(usuarioSelecionado)} disabled={salvando} style={{
                      background: salvando ? 'rgba(99,102,241,.5)' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
                      color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8,
                      cursor: salvando ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13,
                    }}>
                      {salvando ? '⏳ Salvando...' : '💾 Salvar alterações'}
                    </button>
                    <button onClick={() => setUsuarioSelecionado(null)} style={{
                      background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.5)',
                      border: '1px solid rgba(255,255,255,.1)', padding: '9px 16px',
                      borderRadius: 8, cursor: 'pointer',
                    }}>
                      Cancelar
                    </button>
                  </div>

                  {/* Zona de perigo */}
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(239,68,68,.2)' }}>
                    {!confirmandoRemocao ? (
                      <button onClick={() => setConfirmandoRemocao(true)} style={{
                        background: 'rgba(239,68,68,.1)', color: '#f87171',
                        border: '1px solid rgba(239,68,68,.3)', padding: '8px 16px',
                        borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}>
                        🚫 Remover acesso
                      </button>
                    ) : (
                      <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 10, padding: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>
                          Confirmar remoção de acesso?
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 12 }}>
                          {usuarioSelecionado.nome} não conseguirá mais entrar no sistema. Esta ação pode ser revertida pelo suporte.
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => executarRemocaoAcesso(usuarioSelecionado)} disabled={removendo} style={{
                            background: removendo ? 'rgba(239,68,68,.4)' : '#dc2626',
                            color: '#fff', border: 'none', padding: '8px 16px',
                            borderRadius: 8, cursor: removendo ? 'not-allowed' : 'pointer',
                            fontSize: 12, fontWeight: 700,
                          }}>
                            {removendo ? '⏳ Removendo...' : '✓ Confirmar remoção'}
                          </button>
                          <button onClick={() => setConfirmandoRemocao(false)} style={{
                            background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.5)',
                            border: '1px solid rgba(255,255,255,.1)', padding: '8px 14px',
                            borderRadius: 8, cursor: 'pointer', fontSize: 12,
                          }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  {/* Barra de busca + filtros */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' as const }}>
                    <input
                      value={buscaUsuario}
                      onChange={e => setBuscaUsuario(e.target.value)}
                      placeholder="Buscar por nome ou e-mail..."
                      style={{
                        flex: 1, minWidth: 180, padding: '7px 11px', borderRadius: 8,
                        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                        color: '#dce8ff', fontSize: 12, outline: 'none',
                      }}
                    />
                    <select
                      value={filtroRole}
                      onChange={e => setFiltroRole(e.target.value)}
                      style={{
                        padding: '7px 10px', borderRadius: 8,
                        background: '#0d1521', border: '1px solid rgba(255,255,255,.1)',
                        color: filtroRole === 'todos' ? 'rgba(255,255,255,.5)' : '#a5b4fc',
                        fontSize: 12, outline: 'none', cursor: 'pointer',
                        colorScheme: 'dark',
                      } as React.CSSProperties}
                    >
                      <option value="todos" style={{ background: '#0d1521', color: 'rgba(255,255,255,.7)' }}>Todos os acessos</option>
                      <option value="prestadores" style={{ background: '#0d1521', color: '#dce8ff' }}>Prestadores</option>
                      <option value="admin"     style={{ background: '#0d1521', color: '#dce8ff' }}>Admin</option>
                      <option value="gestor"     style={{ background: '#0d1521', color: '#dce8ff' }}>Gestor</option>
                      <option value="gestor_log" style={{ background: '#0d1521', color: '#dce8ff' }}>Gest. Log.</option>
                      <option value="gestor_seg" style={{ background: '#0d1521', color: '#dce8ff' }}>Gest. Seg</option>
                      <option value="guard"     style={{ background: '#0d1521', color: '#dce8ff' }}>Guard</option>
                      <option value="campo"     style={{ background: '#0d1521', color: '#dce8ff' }}>Campo</option>
                      <option value="logistica" style={{ background: '#0d1521', color: '#dce8ff' }}>Logística</option>
                      <option value="promotor"  style={{ background: '#0d1521', color: '#dce8ff' }}>Promotor</option>
                      <option value="viewer"    style={{ background: '#0d1521', color: '#dce8ff' }}>Viewer</option>
                    </select>
                  </div>

                  {/* Lista filtrada e ordenada */}
                  {(() => {
                    const termo = buscaUsuario.toLowerCase();
                    const lista = usuarios
                      .filter(u =>
                        (filtroRole === 'todos'
                          || (filtroRole === 'prestadores' ? u.tipoCadastro === 'prestador' : u.role === filtroRole)) &&
                        (!termo || (u.nome ?? '').toLowerCase().includes(termo) || (u.email ?? '').toLowerCase().includes(termo))
                      )
                      .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR', { sensitivity: 'base' }));

                    if (lista.length === 0) return (
                      <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,.5)' }}>
                        Nenhum usuário encontrado
                      </div>
                    );

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {lista.map(u => (
                          <div key={u.uid} onClick={() => { setUsuarioSelecionado(u); setConfirmandoRemocao(false); }} style={{
                            background: 'rgba(99,102,241,.08)',
                            padding: 12, borderRadius: 8,
                            border: '1px solid rgba(99,102,241,.15)',
                            cursor: 'pointer'
                          }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,.15)'}
                             onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,.08)'}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>{u.nome}</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
                                  {u.email} · {u.role}
                                </div>
                              </div>
                              <div style={{
                                background: u.role === 'viewer' ? 'rgba(59,130,246,.15)' : 'rgba(16,185,129,.15)',
                                padding: '4px 12px', borderRadius: 20,
                                fontSize: 11, color: u.role === 'viewer' ? '#3b82f6' : '#10b981', fontWeight: 600
                              }}>
                                {u.role === 'viewer' && u.cidadesPermitidas?.length
                                  ? `👁 ${u.cidadesPermitidas.length} cidades`
                                  : u.role === 'logistica' && u.cidadesGerenciaLog?.length
                                  ? `🚚 ${u.cidadesGerenciaLog.length} cidades`
                                  : u.role}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
