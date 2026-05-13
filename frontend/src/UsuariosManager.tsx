// UsuariosManager.tsx — Gestão de usuários (admin/gestor)
import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db, fnAprovarSolicitacao } from './lib/firebase';

interface Solicitacao {
  id: string;
  nome: string;
  email: string;
  paises: string[];
  motivo?: string;
  status: 'PENDENTE' | 'APROVADA' | 'REJEITADA';
  criadoEm: any;
}

interface Usuario {
  uid: string;
  nome: string;
  email: string;
  role: string;
  paises: string[];
  ativo: boolean;
  criadoEm: any;
  ultimoAcesso?: any;
}

interface Props {
  onFechar: () => void;
  roleAtual: string;
  paisesAtual: string[];
}

const ROLES_POR_ROLE: Record<string, string[]> = {
  admin:  ['campo', 'gestor', 'guard', 'admin'],
  gestor: ['campo', 'gestor', 'guard'],
  campo:  []
};

const ROLE_LABEL: Record<string, string> = {
  admin:  'Admin',
  gestor: 'Gestor',
  campo:  'Campo',
  guard:  'Guard',
};

const ROLE_COLOR: Record<string, string> = {
  admin:  '#f59e0b',
  gestor: '#60a5fa',
  campo:  '#34d399',
  guard:  '#a78bfa',
};

export default function UsuariosManager({ onFechar, roleAtual, paisesAtual }: Props) {
  const [aba,          setAba]          = useState<'solicitacoes'|'usuarios'>('solicitacoes');
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [usuarios,     setUsuarios]     = useState<Usuario[]>([]);
  const [busy,         setBusy]         = useState<string | null>(null);
  const [toast,        setToast]        = useState('');
  const [editando,     setEditando]     = useState<Usuario | null>(null);

  const isAdmin  = roleAtual === 'admin';
  const rolesPermitidos = ROLES_POR_ROLE[roleAtual] || [];

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    const unsubSol = onSnapshot(
      query(collection(db, 'solicitacoes'), orderBy('criadoEm', 'desc')),
      snap => setSolicitacoes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Solicitacao)))
    );
    const unsubUsr = onSnapshot(
      query(collection(db, 'usuarios'), orderBy('criadoEm', 'desc')),
      snap => {
        let lista = snap.docs.map(d => d.data() as Usuario);
        if (!isAdmin) {
          lista = lista.filter(u => u.paises?.some(p => paisesAtual.includes(p)));
        }
        setUsuarios(lista);
      }
    );
    return () => { unsubSol(); unsubUsr(); };
  }, [isAdmin, paisesAtual]);

  const pendentes = solicitacoes.filter(s => s.status === 'PENDENTE');
  const historico = solicitacoes.filter(s => s.status !== 'PENDENTE');

  const handleAprovar = async (sol: Solicitacao) => {
    setBusy(sol.id);
    try {
      await fnAprovarSolicitacao()({ solicitacaoId: sol.id });
      showToast(`✓ ${sol.nome} aprovado — email enviado`);
    } catch(e: unknown) {
      showToast('Erro: ' + (e instanceof Error ? e.message : String(e)));
    }
    setBusy(null);
  };

  const handleRejeitar = async (sol: Solicitacao) => {
    if (!confirm(`Rejeitar solicitação de ${sol.nome}?`)) return;
    setBusy(sol.id);
    try {
      await updateDoc(doc(db, 'solicitacoes', sol.id), { status: 'REJEITADA' });
      showToast(`Solicitação de ${sol.nome} rejeitada`);
    } catch { showToast('Erro ao rejeitar'); }
    setBusy(null);
  };

  const salvarEdicao = async (u: Usuario, novoRole: string, novosNome: string, novosPaises: string[]) => {
    if (!isAdmin && novoRole === 'admin') return;
    setBusy(u.uid);
    try {
      await updateDoc(doc(db, 'usuarios', u.uid), {
        role: novoRole,
        nome: novosNome,
        paises: novosPaises,
      });
      showToast('Usuário atualizado');
      setEditando(null);
    } catch { showToast('Erro ao salvar'); }
    setBusy(null);
  };

  const toggleAtivo = async (u: Usuario) => {
    setBusy(u.uid);
    try {
      await updateDoc(doc(db, 'usuarios', u.uid), { ativo: !u.ativo });
      showToast(u.ativo ? `${u.nome} desativado` : `${u.nome} ativado`);
    } catch { showToast('Erro'); }
    setBusy(null);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 3000,
    background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'Inter,sans-serif',
  };

  const panel: React.CSSProperties = {
    background: '#0d1220', flex: 1, display: 'flex', flexDirection: 'column',
    maxWidth: 560, width: '100%', margin: '0 auto',
    borderLeft: '1px solid rgba(255,255,255,.07)',
    borderRight: '1px solid rgba(255,255,255,.07)',
  };

  return (
    <div style={overlay}>
      <div style={panel}>

        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>👥 Usuários</div>
            <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, marginTop: 2 }}>
              Gerencie acessos e solicitações
            </div>
          </div>
          <button onClick={onFechar} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.5)', padding: '6px 12px',
            fontSize: 12, cursor: 'pointer'
          }}>✕ Fechar</button>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          {(['solicitacoes', 'usuarios'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} style={{
              flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer', fontSize: 12,
              background: aba === a ? 'rgba(48,127,226,.1)' : 'transparent',
              color: aba === a ? '#60a5fa' : 'rgba(255,255,255,.4)',
              borderBottom: aba === a ? '2px solid #307FE2' : '2px solid transparent',
              fontWeight: aba === a ? 600 : 400,
            }}>
              {a === 'solicitacoes'
                ? `Solicitações${pendentes.length > 0 ? ` (${pendentes.length})` : ''}`
                : `Usuários (${usuarios.length})`}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

          {aba === 'solicitacoes' && (
            <>
              {pendentes.length === 0 && (
                <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 13, textAlign: 'center', padding: 32 }}>
                  Nenhuma solicitação pendente
                </div>
              )}
              {pendentes.map(sol => (
                <div key={sol.id} style={{
                  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 10, padding: 14, marginBottom: 10
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{sol.nome}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                      {sol.criadoEm?.toDate?.().toLocaleDateString('pt-BR') || ''}
                    </div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 4 }}>{sol.email}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {sol.paises?.map(p => (
                      <span key={p} style={{
                        background: 'rgba(48,127,226,.15)', border: '1px solid rgba(48,127,226,.3)',
                        borderRadius: 4, padding: '2px 6px', fontSize: 10, color: '#60a5fa'
                      }}>{p}</span>
                    ))}
                  </div>
                  {sol.motivo && (
                    <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, marginBottom: 10,
                      background: 'rgba(255,255,255,.03)', borderRadius: 6, padding: '6px 8px' }}>
                      {sol.motivo}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleAprovar(sol)} disabled={busy === sol.id} style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: 'rgba(16,185,129,.15)', color: '#6ee7b7', fontSize: 12, fontWeight: 600,
                    }}>{busy === sol.id ? '...' : '✓ Aprovar'}</button>
                    <button onClick={() => handleRejeitar(sol)} disabled={busy === sol.id} style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: 'rgba(239,68,68,.1)', color: '#f87171', fontSize: 12, fontWeight: 600,
                    }}>✕ Rejeitar</button>
                  </div>
                </div>
              ))}

              {historico.length > 0 && (
                <>
                  <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, margin: '16px 0 8px' }}>Histórico</div>
                  {historico.map(sol => (
                    <div key={sol.id} style={{
                      background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)',
                      borderRadius: 8, padding: '10px 12px', marginBottom: 6,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 13 }}>{sol.nome}</div>
                        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11 }}>{sol.email}</div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                        background: sol.status === 'APROVADA' ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.1)',
                        color: sol.status === 'APROVADA' ? '#6ee7b7' : '#f87171',
                      }}>{sol.status}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {aba === 'usuarios' && (
            <>
              {usuarios.map(u => (
                <div key={u.uid} style={{
                  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 10, padding: 14, marginBottom: 10,
                  opacity: u.ativo ? 1 : 0.5,
                }}>
                  {editando?.uid === u.uid ? (
                    <EditarUsuario
                      usuario={u}
                      rolesPermitidos={rolesPermitidos}
                      onSalvar={(role, nome, paises) => salvarEdicao(u, role, nome, paises)}
                      onCancelar={() => setEditando(null)}
                      busy={busy === u.uid}
                    />
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div>
                          <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{u.nome}</span>
                          <span style={{
                            marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px',
                            borderRadius: 4, background: `${ROLE_COLOR[u.role]}20`,
                            color: ROLE_COLOR[u.role] || '#fff', border: `1px solid ${ROLE_COLOR[u.role]}40`
                          }}>{ROLE_LABEL[u.role] || u.role}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {rolesPermitidos.length > 0 && (
                            <button onClick={() => setEditando(u)} style={{
                              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                              borderRadius: 6, color: 'rgba(255,255,255,.5)', padding: '4px 8px',
                              fontSize: 11, cursor: 'pointer'
                            }}>✏️</button>
                          )}
                          {isAdmin && (
                            <button onClick={() => toggleAtivo(u)} disabled={busy === u.uid} style={{
                              background: u.ativo ? 'rgba(239,68,68,.1)' : 'rgba(16,185,129,.1)',
                              border: `1px solid ${u.ativo ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.2)'}`,
                              borderRadius: 6, color: u.ativo ? '#f87171' : '#6ee7b7',
                              padding: '4px 8px', fontSize: 11, cursor: 'pointer'
                            }}>{u.ativo ? 'Desativar' : 'Ativar'}</button>
                          )}
                        </div>
                      </div>
                      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11 }}>{u.email}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                        {u.paises?.map(p => (
                          <span key={p} style={{
                            background: 'rgba(255,255,255,.05)', borderRadius: 4,
                            padding: '1px 5px', fontSize: 10, color: 'rgba(255,255,255,.4)'
                          }}>{p}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {toast && (
          <div style={{
            position: 'absolute', bottom: 20, left: 16, right: 16,
            background: '#1c2535', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, textAlign: 'center'
          }}>{toast}</div>
        )}
      </div>
    </div>
  );
}

function EditarUsuario({ usuario, rolesPermitidos, onSalvar, onCancelar, busy }: {
  usuario: Usuario;
  rolesPermitidos: string[];
  onSalvar: (role: string, nome: string, paises: string[]) => void;
  onCancelar: () => void;
  busy: boolean;
}) {
  const [role,   setRole]   = useState(usuario.role);
  const [nome,   setNome]   = useState(usuario.nome);
  const [paises, setPaises] = useState<string[]>(usuario.paises || []);

  const togglePais = (p: string) =>
    setPaises(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, display: 'block', marginBottom: 4 }}>Nome</label>
        <input value={nome} onChange={e => setNome(e.target.value)} style={{
          width: '100%', padding: '7px 10px', background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, color: '#fff',
          fontSize: 13, boxSizing: 'border-box'
        }} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, display: 'block', marginBottom: 4 }}>Role</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rolesPermitidos.map(r => (
            <button key={r} onClick={() => setRole(r)} style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: role === r ? `${ROLE_COLOR[r]}20` : 'rgba(255,255,255,.05)',
              border: `1px solid ${role === r ? `${ROLE_COLOR[r]}50` : 'rgba(255,255,255,.1)'}`,
              color: role === r ? ROLE_COLOR[r] : 'rgba(255,255,255,.5)', fontWeight: role === r ? 600 : 400,
            }}>{ROLE_LABEL[r] || r}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ color: 'rgba(255,255,255,.4)', fontSize: 11, display: 'block', marginBottom: 4 }}>Países</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['BR','MX','AR','CO','CL','PE'].map(p => (
            <button key={p} onClick={() => togglePais(p)} style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              background: paises.includes(p) ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.05)',
              border: `1px solid ${paises.includes(p) ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.1)'}`,
              color: paises.includes(p) ? '#60a5fa' : 'rgba(255,255,255,.4)',
            }}>{p}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSalvar(role, nome, paises)} disabled={busy} style={{
          flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(48,127,226,.2)', color: '#60a5fa', fontSize: 12, fontWeight: 600,
        }}>{busy ? '...' : '✓ Salvar'}</button>
        <button onClick={onCancelar} style={{
          padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
          background: 'transparent', color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer',
        }}>Cancelar</button>
      </div>
    </div>
  );
}
