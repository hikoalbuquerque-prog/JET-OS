// MonitorPanel.tsx
// Painel inline para classificar tipo de monitor de uma estação diretamente no mapa.
// Aparece como popup ao clicar numa estação (role supergestor ou admin).
//
// tipoMonitor: null | 'M1' | 'M2' | 'M3'
// Campos extras salvos em estacoes/{id}:
//   tipoMonitor: 'M1' | 'M2' | 'M3' | null
//   monitorConfig: {
//     M1: { alertaZero: true }
//     M2: { minDia, maxDia, minNoite, maxNoite, minFds, maxFds }
//     M3: { horarioInicio, horarioFim, promotorAtivo, observacao }
//   }

import React, { useState, useCallback } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './lib/firebase';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TipoMonitor = 'M1' | 'M2' | 'M3' | null;

export interface MonitorConfigM2 {
  minDia: number;   maxDia: number;
  minNoite: number; maxNoite: number;
  minFds: number;   maxFds: number;
}

export interface MonitorConfigM3 {
  horarioInicio: string;
  horarioFim: string;
  promotorAtivo: boolean;
  observacao: string;
}

export interface MonitorConfig {
  M1?: { alertaZero: boolean };
  M2?: MonitorConfigM2;
  M3?: MonitorConfigM3;
}

interface Estacao {
  id: string;
  nome?: string;
  codigo?: string;
  tipoMonitor?: TipoMonitor;
  monitorConfig?: MonitorConfig;
}

interface Props {
  estacao: Estacao;
  posicao: { x: number; y: number };   // posição pixel no mapa
  onFechar: () => void;
  onSalvo: (id: string, tipo: TipoMonitor, config: MonitorConfig) => void;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const COR: Record<string, string> = {
  M1: '#10b981', M2: '#3b82f6', M3: '#f59e0b', null: '#6b7280',
};

const S = {
  panel: (x: number, y: number) => ({
    position: 'fixed' as const,
    left: Math.min(x + 12, window.innerWidth - 320),
    top:  Math.min(y + 12, window.innerHeight - 500),
    zIndex: 3000,
    width: 300,
    background: '#0d1521',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,.7)',
    overflow: 'hidden',
  }),
  header: (cor: string) => ({
    padding: '10px 14px',
    background: cor + '20',
    borderBottom: '1px solid rgba(255,255,255,.06)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  }),
  body: { padding: 14 },
  inp: {
    width: '100%', padding: '7px 10px', borderRadius: 7,
    boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#dce8ff', fontSize: 12, outline: 'none',
  },
  lbl: {
    display: 'block' as const, fontSize: 10, fontWeight: 600 as const,
    color: 'rgba(255,255,255,.38)', marginBottom: 4,
    textTransform: 'uppercase' as const, letterSpacing: '0.5px',
  },
  btn: (cor: string, ativo = false) => ({
    flex: 1, padding: '7px 4px', borderRadius: 7, border: 'none',
    background: ativo ? cor : 'rgba(255,255,255,.07)',
    color: ativo ? '#fff' : 'rgba(255,255,255,.5)',
    fontWeight: 700 as const, fontSize: 12, cursor: 'pointer' as const,
    transition: 'all .15s',
  }),
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 },
};

// ─── Sub: Config M2 ───────────────────────────────────────────────────────────

function ConfigM2({ cfg, onChange }: {
  cfg: MonitorConfigM2;
  onChange: (c: MonitorConfigM2) => void;
}) {
  const set = (k: keyof MonitorConfigM2, v: string) =>
    onChange({ ...cfg, [k]: parseInt(v) || 0 });

  return (
    <div>
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>Min dia</label>
          <input style={S.inp} type="number" min={0} value={cfg.minDia}
            onChange={e => set('minDia', e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>Max dia</label>
          <input style={S.inp} type="number" min={0} value={cfg.maxDia}
            onChange={e => set('maxDia', e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>Min noite</label>
          <input style={S.inp} type="number" min={0} value={cfg.minNoite}
            onChange={e => set('minNoite', e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>Max noite</label>
          <input style={S.inp} type="number" min={0} value={cfg.maxNoite}
            onChange={e => set('maxNoite', e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>Min FDS</label>
          <input style={S.inp} type="number" min={0} value={cfg.minFds}
            onChange={e => set('minFds', e.target.value)} />
        </div>
        <div>
          <label style={S.lbl}>Max FDS</label>
          <input style={S.inp} type="number" min={0} value={cfg.maxFds}
            onChange={e => set('maxFds', e.target.value)} />
        </div>
      </div>
    </div>
  );
}

// ─── Sub: Config M3 ───────────────────────────────────────────────────────────

function ConfigM3({ cfg, onChange }: {
  cfg: MonitorConfigM3;
  onChange: (c: MonitorConfigM3) => void;
}) {
  return (
    <div>
      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>Início</label>
          <input style={S.inp} type="time" value={cfg.horarioInicio}
            onChange={e => onChange({ ...cfg, horarioInicio: e.target.value })} />
        </div>
        <div>
          <label style={S.lbl}>Fim</label>
          <input style={S.inp} type="time" value={cfg.horarioFim}
            onChange={e => onChange({ ...cfg, horarioFim: e.target.value })} />
        </div>
      </div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: 'rgba(255,255,255,.6)', cursor: 'pointer',
        marginBottom: 8,
      }}>
        <input type="checkbox" checked={cfg.promotorAtivo}
          onChange={e => onChange({ ...cfg, promotorAtivo: e.target.checked })} />
        Promotor ativo neste ponto
      </label>
      <div>
        <label style={S.lbl}>Observação</label>
        <input style={S.inp} value={cfg.observacao}
          onChange={e => onChange({ ...cfg, observacao: e.target.value })}
          placeholder="Ex: Ponto Faria Lima — ativar 16h-20h" />
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

const DEFAULTS: Record<string, MonitorConfig> = {
  M1: { M1: { alertaZero: true } },
  M2: { M2: { minDia: 2, maxDia: 10, minNoite: 1, maxNoite: 6, minFds: 2, maxFds: 15 } },
  M3: { M3: { horarioInicio: '16:00', horarioFim: '20:00', promotorAtivo: false, observacao: '' } },
};

export default function MonitorPanel({ estacao, posicao, onFechar, onSalvo }: Props) {
  const [tipo, setTipo] = useState<TipoMonitor>(estacao.tipoMonitor ?? null);
  const [config, setConfig] = useState<MonitorConfig>(
    estacao.monitorConfig ?? (estacao.tipoMonitor ? DEFAULTS[estacao.tipoMonitor] : {})
  );
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const selecionarTipo = (t: TipoMonitor) => {
    setTipo(t);
    if (t && !config[t as keyof MonitorConfig]) {
      setConfig(DEFAULTS[t!] ?? {});
    }
  };

  const salvar = useCallback(async () => {
    setBusy(true);
    setErro('');
    try {
      const configFinal = tipo ? { [tipo]: config[tipo as keyof MonitorConfig] } : {};
      await updateDoc(doc(db, 'estacoes', estacao.id), {
        tipoMonitor:    tipo,
        monitorConfig:  configFinal,
        atualizadoEm:   serverTimestamp(),
      });
      onSalvo(estacao.id, tipo, configFinal);
      onFechar();
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao salvar');
    } finally {
      setBusy(false);
    }
  }, [tipo, config, estacao.id, onSalvo, onFechar]);

  const corAtual = tipo ? COR[tipo] : COR.null;

  return (
    <div style={S.panel(posicao.x, posicao.y)}>
      {/* Header */}
      <div style={S.header(corAtual)}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: corAtual }}>
            Monitor — {estacao.codigo ?? estacao.nome ?? estacao.id.slice(-6)}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 1 }}>
            {tipo ? `Tipo ${tipo} configurado` : 'Sem tipo definido'}
          </div>
        </div>
        <button onClick={onFechar} style={{
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 16,
        }}>✕</button>
      </div>

      {/* Body */}
      <div style={S.body}>
        {/* Seletor de tipo */}
        <label style={S.lbl}>Tipo de monitor</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['M1', 'M2', 'M3', null] as TipoMonitor[]).map(t => (
            <button
              key={String(t)}
              style={S.btn(COR[String(t)], tipo === t)}
              onClick={() => selecionarTipo(t)}
            >
              {t ?? 'Nenhum'}
            </button>
          ))}
        </div>

        {/* Descrição do tipo */}
        {tipo === 'M1' && (
          <div style={{
            padding: '8px 10px', borderRadius: 6, marginBottom: 12,
            background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)',
            fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.5,
          }}>
            Alerta quando o ponto chega a zero patinetes.
            Gera tarefa urgente para reposição imediata.
          </div>
        )}

        {tipo === 'M2' && (
          <>
            <div style={{
              padding: '8px 10px', borderRadius: 6, marginBottom: 10,
              background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)',
              fontSize: 11, color: 'rgba(255,255,255,.5)',
            }}>
              Mantém faixa min/max por turno. Gera tarefa automática quando fora da faixa.
            </div>
            <ConfigM2
              cfg={config.M2 ?? DEFAULTS.M2.M2!}
              onChange={c => setConfig({ M2: c })}
            />
          </>
        )}

        {tipo === 'M3' && (
          <>
            <div style={{
              padding: '8px 10px', borderRadius: 6, marginBottom: 10,
              background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)',
              fontSize: 11, color: 'rgba(255,255,255,.5)',
            }}>
              Ponto especial com horário e promotor configurável.
            </div>
            <ConfigM3
              cfg={config.M3 ?? DEFAULTS.M3.M3!}
              onChange={c => setConfig({ M3: c })}
            />
          </>
        )}

        {erro && (
          <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>{erro}</div>
        )}

        <button
          onClick={salvar}
          disabled={busy}
          style={{
            width: '100%', padding: '9px', borderRadius: 8, border: 'none',
            background: corAtual, color: '#fff',
            fontWeight: 700, fontSize: 12, cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Salvando...' : 'Salvar monitor'}
        </button>
      </div>
    </div>
  );
}

// ─── Hook para usar no App.tsx ────────────────────────────────────────────────
// No App.tsx, adicionar:
//
// import MonitorPanel, { TipoMonitor, MonitorConfig } from './MonitorPanel';
//
// Estado:
//   const [monitorPanel, setMonitorPanel] = useState<{
//     estacao: any; posicao: { x: number; y: number };
//   } | null>(null);
//
// Verificação de permissão (novo role 'supergestor'):
//   const isSuperGestor = ['admin', 'supergestor'].includes(usuario.role);
//
// No clique de uma estação no mapa (dentro do handler existente de clique):
//   if (isSuperGestor && e.originalEvent) {
//     setMonitorPanel({
//       estacao: estacaoClicada,
//       posicao: { x: e.originalEvent.clientX, y: e.originalEvent.clientY }
//     });
//   }
//
// No render:
//   {monitorPanel && isSuperGestor && (
//     <MonitorPanel
//       estacao={monitorPanel.estacao}
//       posicao={monitorPanel.posicao}
//       onFechar={() => setMonitorPanel(null)}
//       onSalvo={(id, tipo, cfg) => {
//         // Atualiza o estado local das estações para refletir no mapa
//         setEstacoes(prev => prev.map(e =>
//           e.id === id ? { ...e, tipoMonitor: tipo, monitorConfig: cfg } : e
//         ));
//       }}
//     />
//   )}
//
// ─── ÍCONE NO MAPA ────────────────────────────────────────────────────────────
// Para mostrar M1/M2/M3 como overlay no ícone da estação, no Leaflet:
//
// const iconColor = (e: any) => {
//   if (e.tipoMonitor === 'M1') return '#10b981';
//   if (e.tipoMonitor === 'M2') return '#3b82f6';
//   if (e.tipoMonitor === 'M3') return '#f59e0b';
//   return null;
// };
//
// Adicionar um badge colorido no DivIcon do Leaflet quando tipoMonitor !== null.
