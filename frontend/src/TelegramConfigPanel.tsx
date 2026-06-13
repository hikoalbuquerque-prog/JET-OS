// TelegramConfigPanel.tsx
// Painel visual de gestão da hierarquia Telegram — JET OS V2
// Mostra a hierarquia interativa + permite configurar grupos, tópicos e gestores inline
//
// Coleção Firestore: telegram_config/
//   doc "global"   → botToken, diretoria[], regionais[]
//   doc "cidades"  → { [cidade]: { grupos: {...}, gestores: [] } }

import React, { useState, useEffect, useCallback } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from './lib/firebase';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type CargoGrupo = 'logistica' | 'promo' | 'seguranca' | 'geral';

interface TopicosGrupo {
  charger?: number;
  scalt?: number;
  promotor?: number;
  fiscal?: number;
  seguranca?: number;
  lider?: number;
  alertas?: number;
  geral?: number;
}

interface GrupoConfig {
  chatId: string;
  nome: string;
  topicos: TopicosGrupo;
}

interface GestorRef {
  uid: string;
  nome: string;
  cargo: string;
  nivel: 'diretoria' | 'regional' | 'gerente' | 'lider';
  regioes?: string[];
}

interface CidadeConfig {
  grupos: Partial<Record<CargoGrupo, GrupoConfig>>;
  gestores: GestorRef[];
}

interface ConfigGlobal {
  botToken: string;
  botUsername?: string;
  diretoria: GestorRef[];
  regionais: GestorRef[];
  relatoriosChatId?: string;
  atualizadoEm?: any;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const CIDADES_BR = [
  'São Paulo','Curitiba','Rio de Janeiro','Belo Horizonte',
  'Porto Alegre','Fortaleza','Recife','Salvador','Manaus','Brasília',
];

const CARGOS_META: Record<string, { l: string; cor: string; icone: string; grupo: CargoGrupo; topicos: string[] }> = {
  charger:   { l: 'Charger',   cor: '#10b981', icone: '⚡', grupo: 'logistica', topicos: ['charger','lider','alertas'] },
  scalt:     { l: 'Scalt',     cor: '#06b6d4', icone: '📦', grupo: 'logistica', topicos: ['scalt','lider','alertas'] },
  promotor:  { l: 'Promotor',  cor: '#f59e0b', icone: '📢', grupo: 'promo',     topicos: ['promotor','alertas'] },
  fiscal:    { l: 'Fiscal',    cor: '#f97316', icone: '🔍', grupo: 'promo',     topicos: ['fiscal','alertas'] },
  seguranca: { l: 'Segurança', cor: '#ef4444', icone: '🛡', grupo: 'seguranca', topicos: ['seguranca','alertas'] },
};

const GRUPOS_META: Record<CargoGrupo, { l: string; cor: string; cargos: string[]; topicosDisponiveis: string[] }> = {
  logistica: { l: 'Logística',  cor: '#10b981', cargos: ['charger','scalt'],     topicosDisponiveis: ['charger','scalt','lider','alertas'] },
  promo:     { l: 'Promo',      cor: '#f59e0b', cargos: ['promotor','fiscal'],   topicosDisponiveis: ['promotor','fiscal','alertas'] },
  seguranca: { l: 'Segurança',  cor: '#ef4444', cargos: ['seguranca'],           topicosDisponiveis: ['seguranca','alertas'] },
  geral:     { l: 'Geral',      cor: '#6b7280', cargos: [],                      topicosDisponiveis: ['geral','alertas'] },
};

const NIVEL_META: Record<string, { l: string; cor: string; escopo: string }> = {
  diretoria: { l: 'Diretoria',      cor: '#a78bfa', escopo: 'Todas as cidades e alertas' },
  regional:  { l: 'Ger. Regional',  cor: '#7c3aed', escopo: 'Cidades da sua região' },
  gerente:   { l: 'Gerente',        cor: '#1D9E75', escopo: 'Cidade específica' },
  lider:     { l: 'Líder',          cor: '#06b6d4', escopo: 'Cargo na cidade' },
};

// ─── Estilos ─────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 2100,
    background: 'rgba(0,0,0,.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: '#0d1521', borderRadius: 16,
    width: '100%', maxWidth: 1100, maxHeight: '94vh',
    display: 'flex', flexDirection: 'column' as const,
    border: '1px solid rgba(167,139,250,.2)',
    boxShadow: '0 12px 48px rgba(0,0,0,.7)',
  },
  header: {
    padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'rgba(167,139,250,.07)', flexShrink: 0,
  },
  body: {
    flex: 1, overflowY: 'auto' as const,
    display: 'grid', gridTemplateColumns: '320px 1fr',
  },
  sidebar: {
    borderRight: '1px solid rgba(255,255,255,.06)',
    padding: 16, overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column' as const, gap: 8,
  },
  main: { padding: 20, overflowY: 'auto' as const },
  inp: {
    width: '100%', padding: '8px 11px', borderRadius: 7,
    boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 12, outline: 'none',
  },
  lbl: {
    display: 'block' as const, color: 'rgba(255,255,255,.38)',
    fontSize: 10, fontWeight: 600 as const, marginBottom: 4,
    textTransform: 'uppercase' as const, letterSpacing: '0.5px',
  },
  btn: (cor: string, ghost = false) => ghost ? {
    padding: '7px 13px', borderRadius: 7,
    background: 'rgba(255,255,255,.05)',
    border: `1px solid ${cor}40`,
    color: cor, fontWeight: 600 as const,
    fontSize: 11, cursor: 'pointer' as const,
  } : {
    padding: '7px 13px', borderRadius: 7, border: 'none',
    background: cor, color: '#fff', fontWeight: 600 as const,
    fontSize: 11, cursor: 'pointer' as const,
  },
  badge: (cor: string) => ({
    display: 'inline-block' as const,
    padding: '2px 8px', borderRadius: 20,
    background: cor + '22', color: cor,
    fontSize: 10, fontWeight: 700 as const,
  }),
  card: (cor: string, ativo = false) => ({
    padding: '10px 14px', borderRadius: 10, cursor: 'pointer' as const,
    background: ativo ? cor + '15' : 'rgba(255,255,255,.03)',
    border: `1px solid ${ativo ? cor + '50' : 'rgba(255,255,255,.07)'}`,
    transition: 'all .15s',
  }),
  sep: { borderTop: '1px solid rgba(255,255,255,.06)', margin: '16px 0' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
};

// ─── Componente: Node da hierarquia ──────────────────────────────────────────

function HierarquiaNode({
  nivel, nome, sub, cor, ativo, count,
  onClick,
}: {
  nivel: string; nome: string; sub?: string; cor: string;
  ativo: boolean; count?: number; onClick: () => void;
}) {
  return (
    <div style={S.card(cor, ativo)} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, color: cor, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {NIVEL_META[nivel]?.l ?? nivel}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff' }}>{nome}</div>
          {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>{sub}</div>}
        </div>
        {count !== undefined && (
          <div style={{
            width: 22, height: 22, borderRadius: 11,
            background: cor + '30', color: cor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 800,
          }}>{count}</div>
        )}
      </div>
    </div>
  );
}

// ─── Componente: Config de um grupo Telegram ─────────────────────────────────

function GrupoEditor({
  grupo, tipoGrupo, cidadeKey,
  onChange,
}: {
  grupo: GrupoConfig | undefined;
  tipoGrupo: CargoGrupo;
  cidadeKey: string;
  onChange: (g: GrupoConfig) => void;
}) {
  const meta = GRUPOS_META[tipoGrupo];
  const [chatId, setChatId] = useState(grupo?.chatId ?? '');
  const [nome, setNome] = useState(grupo?.nome ?? '');
  const [topicos, setTopicos] = useState<TopicosGrupo>(grupo?.topicos ?? {});
  const [testando, setTestando] = useState(false);
  const [testeMsg, setTesteMsg] = useState('');

  const setTopico = (k: string, v: string) => {
    setTopicos(prev => ({ ...prev, [k]: v ? parseInt(v) : undefined }));
  };

  const salvar = () => {
    if (!chatId.trim()) return;
    onChange({ chatId: chatId.trim(), nome: nome.trim() || meta.l, topicos });
  };

  const testarBot = async () => {
    if (!chatId.trim()) return;
    setTestando(true);
    setTesteMsg('');
    try {
      const fn = (window as any).__jetCallFunction;
      if (fn) {
        await fn('testarTelegram', { chatId, topicId: topicos.alertas ?? null });
        setTesteMsg('Mensagem enviada!');
      } else {
        setTesteMsg('Function não disponível em dev');
      }
    } catch (e: any) {
      setTesteMsg('Erro: ' + (e.message ?? 'desconhecido'));
    } finally {
      setTestando(false);
    }
  };

  return (
    <div style={{
      padding: 14, borderRadius: 10, marginBottom: 12,
      background: meta.cor + '09',
      border: `1px solid ${meta.cor}30`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={S.badge(meta.cor)}>{meta.l}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
          {meta.cargos.join(' · ')} · {cidadeKey}
        </span>
      </div>

      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>Chat ID do grupo</label>
          <input style={S.inp} value={chatId} onChange={e => setChatId(e.target.value)}
            placeholder="-100123456789" />
        </div>
        <div>
          <label style={S.lbl}>Nome do grupo (referência)</label>
          <input style={S.inp} value={nome} onChange={e => setNome(e.target.value)}
            placeholder={`JET OS ${meta.l} - ${cidadeKey}`} />
        </div>
      </div>

      <div style={{ ...S.sep, margin: '12px 0' }} />
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Thread IDs dos tópicos (0 = tópico geral do grupo)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {meta.topicosDisponiveis.map(t => (
          <div key={t}>
            <label style={S.lbl}>{t}</label>
            <input
              style={S.inp}
              type="number"
              value={(topicos as any)[t] ?? ''}
              onChange={e => setTopico(t, e.target.value)}
              placeholder="0"
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button style={S.btn(meta.cor)} onClick={salvar}>Salvar grupo</button>
        <button style={S.btn(meta.cor, true)} onClick={testarBot} disabled={testando}>
          {testando ? 'Enviando...' : 'Testar'}
        </button>
        {testeMsg && (
          <span style={{ fontSize: 11, color: testeMsg.startsWith('Erro') ? '#ef4444' : '#10b981' }}>
            {testeMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Componente: Config de gestores de um nível ──────────────────────────────

function GestoresEditor({
  gestores, nivel, cor,
  onAdd, onRemove,
}: {
  gestores: GestorRef[]; nivel: string; cor: string;
  onAdd: (g: GestorRef) => void;
  onRemove: (uid: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);

  const buscarUsuarios = async (termo: string) => {
    if (termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'usuarios'),
        where('role', 'in', ['admin', 'gestor'])
      ));
      const todos = snap.docs.map(d => ({ uid: d.id, ...d.data() })) as any[];
      const filtrado = todos.filter((u: any) =>
        u.nome?.toLowerCase().includes(termo.toLowerCase()) ||
        u.email?.toLowerCase().includes(termo.toLowerCase())
      );
      setResultados(filtrado.slice(0, 6));
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => buscarUsuarios(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const jaNaLista = (uid: string) => gestores.some(g => g.uid === uid);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={S.badge(cor)}>{NIVEL_META[nivel]?.l}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
          {NIVEL_META[nivel]?.escopo}
        </span>
      </div>

      {/* Lista atual */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 10 }}>
        {gestores.length === 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.25)' }}>Nenhum gestor configurado</span>
        )}
        {gestores.map(g => (
          <div key={g.uid} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 20,
            background: cor + '18', border: `1px solid ${cor}35`,
          }}>
            <span style={{ fontSize: 11, color: '#dce8ff' }}>{g.nome}</span>
            <span style={{ fontSize: 10, color: cor }}>{g.cargo}</span>
            <button onClick={() => onRemove(g.uid)} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,.3)',
              cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0,
            }}>×</button>
          </div>
        ))}
      </div>

      {/* Busca */}
      <div style={{ position: 'relative' as const }}>
        <input style={S.inp} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar usuário para adicionar..." />
        {resultados.length > 0 && (
          <div style={{
            position: 'absolute' as const, top: '100%', left: 0, right: 0, zIndex: 10,
            background: '#131e30', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: '0 0 8px 8px', overflow: 'hidden',
          }}>
            {resultados.map((u: any) => (
              <div key={u.uid}
                onClick={() => {
                  if (!jaNaLista(u.uid)) {
                    onAdd({ uid: u.uid, nome: u.nome, cargo: u.role, nivel: nivel as any });
                  }
                  setBusca('');
                  setResultados([]);
                }}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between',
                  background: jaNaLista(u.uid) ? 'rgba(16,185,129,.1)' : 'transparent',
                  opacity: jaNaLista(u.uid) ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 12, color: '#dce8ff' }}>{u.nome}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{u.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PAINEL PRINCIPAL ─────────────────────────────────────────────────────────

type ViewTipo = 'global' | 'cidade' | 'hierarquia';
interface ViewState {
  tipo: ViewTipo;
  cidade?: string;
  nivel?: string;
}

interface Props {
  onFechar: () => void;
  inline?: boolean;
}

export default function TelegramConfigPanel({ onFechar, inline }: Props) {
  const [view, setView] = useState<ViewState>({ tipo: 'hierarquia' });
  const [global, setGlobal] = useState<ConfigGlobal>({
    botToken: '', diretoria: [], regionais: [],
  });
  const [cidadesConfig, setCidadesConfig] = useState<Record<string, CidadeConfig>>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvoMsg, setSalvoMsg] = useState('');

  // ── Load ──
  useEffect(() => {
    const carregar = async () => {
      try {
        const [gSnap, cSnap] = await Promise.all([
          getDoc(doc(db, 'telegram_config', 'global')),
          getDoc(doc(db, 'telegram_config', 'cidades')),
        ]);
        if (gSnap.exists()) {
          const d = gSnap.data() as Partial<ConfigGlobal>;
          setGlobal({
            botToken:         d.botToken ?? '',
            diretoria:        d.diretoria ?? [],
            regionais:        d.regionais ?? [],
            relatoriosChatId: d.relatoriosChatId,
            atualizadoEm:     d.atualizadoEm,
          });
        }
        if (cSnap.exists()) {
          const raw = cSnap.data() as Record<string, any>;
          const normalizado: Record<string, CidadeConfig> = {};
          for (const [k, v] of Object.entries(raw)) {
            normalizado[k] = { grupos: v?.grupos ?? {}, gestores: v?.gestores ?? [] };
          }
          setCidadesConfig(normalizado);
        }
      } catch (e) {
        console.error('[TelegramConfig] load:', e);
      } finally {
        setLoading(false);
      }
    };
    carregar();
  }, []);

  // ── Save global ──
  const salvarGlobal = useCallback(async () => {
    setSalvando(true);
    try {
      await setDoc(doc(db, 'telegram_config', 'global'), {
        ...global,
        atualizadoEm: serverTimestamp(),
      });
      setSalvoMsg('Salvo!');
      setTimeout(() => setSalvoMsg(''), 2000);
    } catch (e: any) {
      setSalvoMsg('Erro: ' + e.message);
    } finally {
      setSalvando(false);
    }
  }, [global]);

  // ── Save cidade ──
  const salvarCidade = useCallback(async (cidadeKey: string, config: CidadeConfig) => {
    setSalvando(true);
    try {
      const novas = { ...cidadesConfig, [cidadeKey]: config };
      await setDoc(doc(db, 'telegram_config', 'cidades'), novas);
      setCidadesConfig(novas);
      setSalvoMsg('Salvo!');
      setTimeout(() => setSalvoMsg(''), 2000);
    } catch (e: any) {
      setSalvoMsg('Erro: ' + e.message);
    } finally {
      setSalvando(false);
    }
  }, [cidadesConfig]);

  const cidadeConfig = (c: string): CidadeConfig => {
    const cfg = cidadesConfig[c];
    if (!cfg) return { grupos: {}, gestores: [] };
    return { grupos: cfg.grupos ?? {}, gestores: cfg.gestores ?? [] };
  };

  const updateGrupo = (cidade: string, tipo: CargoGrupo, g: GrupoConfig) => {
    const cfg = cidadeConfig(cidade);
    salvarCidade(cidade, { ...cfg, grupos: { ...cfg.grupos, [tipo]: g } });
  };

  const updateGestores = (cidade: string, lista: GestorRef[]) => {
    const cfg = cidadeConfig(cidade);
    salvarCidade(cidade, { ...cfg, gestores: lista });
  };

  const updateGlobalGestores = (nivel: 'diretoria' | 'regionais', lista: GestorRef[]) => {
    setGlobal(prev => ({ ...prev, [nivel]: lista }));
  };

  // ── Counts para badges ──
  const gruposConfigurados = (cidade: string) =>
    Object.keys(cidadeConfig(cidade).grupos).length;
  const gestoresCount = (cidade: string) =>
    cidadeConfig(cidade).gestores.length;

  // ─── RENDER SIDEBAR ───────────────────────────────────────────────────────

  const renderSidebar = () => (
    <div style={S.sidebar}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Visão
      </div>

      <HierarquiaNode
        nivel="diretoria" nome="Hierarquia" cor="#a78bfa"
        ativo={view.tipo === 'hierarquia'}
        onClick={() => setView({ tipo: 'hierarquia' })}
      />

      <HierarquiaNode
        nivel="regional" nome="Config global" cor="#7c3aed"
        sub="Bot token · Diretoria · Regionais"
        ativo={view.tipo === 'global'}
        onClick={() => setView({ tipo: 'global' })}
        count={global.diretoria.length + global.regionais.length}
      />

      <div style={{ ...S.sep, margin: '10px 0' }} />
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Cidades
      </div>

      {CIDADES_BR.map(cidade => {
        const chave = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toLowerCase();
        const gc = gruposConfigurados(chave);
        const ativo = view.tipo === 'cidade' && view.cidade === chave;
        return (
          <HierarquiaNode
            key={chave}
            nivel="gerente" nome={cidade} cor="#1D9E75"
            sub={gc > 0 ? `${gc} grupo${gc > 1 ? 's' : ''} configurado${gc > 1 ? 's' : ''}` : 'Sem grupos'}
            ativo={ativo}
            count={gestoresCount(chave) || undefined}
            onClick={() => setView({ tipo: 'cidade', cidade: chave })}
          />
        );
      })}
    </div>
  );

  // ─── RENDER MAIN ─────────────────────────────────────────────────────────

  const renderHierarquia = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#a78bfa', marginBottom: 16 }}>
        Hierarquia de notificações
      </div>

      {/* Diagrama visual inline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 24 }}>

        {/* Diretoria */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <div style={{
            padding: '8px 28px', borderRadius: 8,
            background: '#a78bfa22', border: '1px solid #a78bfa50',
            fontSize: 12, fontWeight: 700, color: '#a78bfa',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            👑 Diretoria
            <span style={S.badge('#a78bfa')}>{global.diretoria.length} membros</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>Recebe tudo</span>
          </div>
        </div>

        {/* Linha vertical */}
        <div style={{ display: 'flex', justifyContent: 'center', height: 20 }}>
          <div style={{ width: 1, background: 'rgba(167,139,250,.3)' }} />
        </div>

        {/* Regionais */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <div style={{
            padding: '8px 28px', borderRadius: 8,
            background: '#7c3aed22', border: '1px solid #7c3aed50',
            fontSize: 12, fontWeight: 700, color: '#a78bfa',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            🗺 Gerentes regionais
            <span style={S.badge('#7c3aed')}>{global.regionais.length} membros</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>Alertas da região</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', height: 20 }}>
          <div style={{ width: 1, background: 'rgba(29,158,117,.3)' }} />
        </div>

        {/* Cidades configuradas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {CIDADES_BR.slice(0, 6).map(cidade => {
            const chave = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toLowerCase();
            const cfg = cidadeConfig(chave);
            const temGrupos = Object.keys(cfg.grupos).length > 0;
            return (
              <div
                key={chave}
                onClick={() => setView({ tipo: 'cidade', cidade: chave })}
                style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: temGrupos ? 'rgba(29,158,117,.1)' : 'rgba(255,255,255,.03)',
                  border: `1px solid ${temGrupos ? 'rgba(29,158,117,.4)' : 'rgba(255,255,255,.08)'}`,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: temGrupos ? '#10b981' : 'rgba(255,255,255,.4)', marginBottom: 4 }}>
                  {cidade}
                </div>
                {Object.entries(cfg.grupos).map(([tipo, g]) => (
                  <div key={tipo} style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
                    {GRUPOS_META[tipo as CargoGrupo]?.l}: {Object.keys(g.topicos).length} tópicos
                  </div>
                ))}
                {!temGrupos && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.2)' }}>Sem grupos configurados</div>
                )}
                {cfg.gestores.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <span style={S.badge('#1D9E75')}>{cfg.gestores.length} gestores</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela de roteamento */}
      <div style={{ ...S.sep }} />
      <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.7)', marginBottom: 12 }}>
        Roteamento de eventos
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', lineHeight: 2 }}>
        {[
          ['Slot aceito',               'Tópico do cargo · Líder da cidade'],
          ['Tarefa concluída',          'Líder + Gerente da cidade'],
          ['Tarefa rejeitada',          'Líder da cidade'],
          ['Ocorrência roubo (procurando)', 'Tópico alertas · Ger. regional · Diretoria'],
          ['Ocorrência normal',         'Tópico do cargo na cidade'],
          ['Check-in / check-out',      'Líder da cidade'],
          ['Operador sem atividade 30min', 'Líder + Gerente (alerta)'],
        ].map(([evento, destino]) => (
          <div key={evento} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
            <span style={{ color: '#dce8ff' }}>{evento}</span>
            <span>{destino}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderGlobal = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#a78bfa', marginBottom: 20 }}>
        Configuração global
      </div>

      {/* Bot token */}
      <div style={{ marginBottom: 20 }}>
        <label style={S.lbl}>Token do bot Telegram</label>
        <input
          style={{ ...S.inp, fontFamily: 'monospace' }}
          type="password"
          value={global.botToken}
          onChange={e => setGlobal(prev => ({ ...prev, botToken: e.target.value }))}
          placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
        />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          Obtenha em @BotFather no Telegram
        </div>
      </div>

      {/* Username do bot */}
      <div style={{ marginBottom: 20 }}>
        <label style={S.lbl}>Username do bot (ex: @jet_os_bot)</label>
        <input
          style={S.inp}
          value={global.botUsername ?? ''}
          onChange={e => setGlobal(prev => ({ ...prev, botUsername: e.target.value.trim() }))}
          placeholder="@jet_os_bot"
        />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          Usado no link de vinculação dos operadores
        </div>
      </div>

      {/* Chat ID relatórios Guard */}
      <div style={{ marginBottom: 20 }}>
        <label style={S.lbl}>Chat ID para relatórios Guard</label>
        <input
          style={S.inp}
          value={global.relatoriosChatId ?? ''}
          onChange={e => setGlobal(prev => ({ ...prev, relatoriosChatId: e.target.value.trim() }))}
          placeholder="-100123456789 (vazio = usa primeiro grupo configurado)"
        />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          Grupo exclusivo para receber os relatórios diários e semanais do Guard.
          Deixe vazio para usar o tópico de alertas da primeira cidade configurada.
        </div>
      </div>

      <div style={S.sep} />

      {/* Diretoria */}
      <GestoresEditor
        gestores={global.diretoria}
        nivel="diretoria"
        cor="#a78bfa"
        onAdd={g => updateGlobalGestores('diretoria', [...global.diretoria, g])}
        onRemove={uid => updateGlobalGestores('diretoria', global.diretoria.filter(g => g.uid !== uid))}
      />

      <div style={S.sep} />

      {/* Regionais */}
      <GestoresEditor
        gestores={global.regionais}
        nivel="regional"
        cor="#7c3aed"
        onAdd={g => updateGlobalGestores('regionais', [...global.regionais, g])}
        onRemove={uid => updateGlobalGestores('regionais', global.regionais.filter(g => g.uid !== uid))}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
        <button style={S.btn('#a78bfa')} onClick={salvarGlobal} disabled={salvando}>
          {salvando ? '⏳ Salvando...' : '💾 Salvar config global'}
        </button>
        {salvoMsg && (
          <span style={{ fontSize: 12, color: salvoMsg.startsWith('Erro') ? '#ef4444' : '#10b981' }}>
            {salvoMsg}
          </span>
        )}
      </div>
    </div>
  );

  const renderCidade = (cidadeKey: string) => {
    const nomeExibicao = CIDADES_BR.find(c =>
      c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toLowerCase() === cidadeKey
    ) ?? cidadeKey;
    const cfg = cidadeConfig(cidadeKey);

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#10b981' }}>
            {nomeExibicao}
          </div>
          {salvoMsg && (
            <span style={{ fontSize: 12, color: salvoMsg.startsWith('Erro') ? '#ef4444' : '#10b981' }}>
              {salvoMsg}
            </span>
          )}
        </div>

        {/* Grupos por tipo */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 12 }}>
          Grupos Telegram
        </div>

        {(Object.keys(GRUPOS_META) as CargoGrupo[]).map(tipo => (
          <GrupoEditor
            key={tipo}
            grupo={cfg.grupos[tipo]}
            tipoGrupo={tipo}
            cidadeKey={nomeExibicao}
            onChange={g => updateGrupo(cidadeKey, tipo, g)}
          />
        ))}

        <div style={S.sep} />

        {/* Gestores da cidade */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 12 }}>
          Gestores e líderes da cidade
        </div>

        <GestoresEditor
          gestores={cfg.gestores.filter(g => g.nivel === 'gerente')}
          nivel="gerente"
          cor="#1D9E75"
          onAdd={g => updateGestores(cidadeKey, [...cfg.gestores, { ...g, nivel: 'gerente' }])}
          onRemove={uid => updateGestores(cidadeKey, cfg.gestores.filter(g => g.uid !== uid))}
        />

        <GestoresEditor
          gestores={cfg.gestores.filter(g => g.nivel === 'lider')}
          nivel="lider"
          cor="#06b6d4"
          onAdd={g => updateGestores(cidadeKey, [...cfg.gestores, { ...g, nivel: 'lider' }])}
          onRemove={uid => updateGestores(cidadeKey, cfg.gestores.filter(g => g.uid !== uid))}
        />
      </div>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const modalContent = (
    <div style={inline ? { display: 'flex', flexDirection: 'column', height: '100%' } : S.modal}>

        {/* Header */}
        <div style={S.header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#a78bfa' }}>
              Telegram — Grupos & Hierarquia
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
              Configure grupos, tópicos e gestores por nível e cidade
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {salvando && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>⏳ Salvando...</span>}
            {salvoMsg && <span style={{ fontSize: 11, color: salvoMsg.startsWith('Erro') ? '#ef4444' : '#10b981' }}>{salvoMsg}</span>}
            <button onClick={onFechar} style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 20,
            }}>✕</button>
          </div>
        </div>

        {/* Body split */}
        <div style={S.body}>
          {/* Sidebar */}
          {renderSidebar()}

          {/* Main */}
          <div style={S.main}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)' }}>
                ⏳ Carregando configuração...
              </div>
            ) : view.tipo === 'hierarquia' ? renderHierarquia()
              : view.tipo === 'global' ? renderGlobal()
              : view.tipo === 'cidade' && view.cidade ? renderCidade(view.cidade)
              : null}
          </div>
        </div>
    </div>
  );

  if (inline) return modalContent;

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar()}>
      {modalContent}
    </div>
  );
}
