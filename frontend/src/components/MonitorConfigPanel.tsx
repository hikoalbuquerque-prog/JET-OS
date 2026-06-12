// frontend/src/components/MonitorConfigPanel.tsx
// Painel de configuração dos thresholds M1/M2/M3 do sistema GoJet por cidade.

import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface MonitorLevelConfig {
  ativo: boolean;
  thresholdPct: number;
  tipoTarefa: string;
  titulo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  raioBusca: number;
  deduplicarHoras: number;
}

interface MonitorConfig {
  M1?: MonitorLevelConfig;
  M2?: MonitorLevelConfig;
  M3?: MonitorLevelConfig;
}

interface Props {
  cidade: string;
  onFechar: () => void;
  inline?: boolean;
}

const NIVEL_COR: Record<string, string> = {
  M1: '#ef4444',
  M2: '#f59e0b',
  M3: '#3b82f6',
};

const NIVEL_LABEL: Record<string, string> = {
  M1: 'M1 — Crítico',
  M2: 'M2 — Atenção',
  M3: 'M3 — Informativo',
};

const DEFAULT_CONFIG: MonitorConfig = {
  M1: {
    ativo: true,
    thresholdPct: 30,
    tipoTarefa: 'redistribuicao',
    titulo: 'M1 - {parkingName}',
    prioridade: 'alta',
    raioBusca: 150,
    deduplicarHoras: 4,
  },
  M2: {
    ativo: true,
    thresholdPct: 40,
    tipoTarefa: 'redistribuicao',
    titulo: 'M2 - {parkingName}',
    prioridade: 'media',
    raioBusca: 150,
    deduplicarHoras: 4,
  },
  M3: {
    ativo: false,
    thresholdPct: 50,
    tipoTarefa: 'recarga',
    titulo: 'M3 - {parkingName}',
    prioridade: 'baixa',
    raioBusca: 200,
    deduplicarHoras: 8,
  },
};

export function MonitorConfigPanel({ cidade, onFechar, inline }: Props) {
  const [config, setConfig] = useState<MonitorConfig>(DEFAULT_CONFIG);
  const [salvando, setSalvando] = useState(false);
  const [salvoOk, setSalvoOk] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'monitor_config', cidade))
      .then(snap => {
        if (snap.exists()) {
          setConfig(snap.data() as MonitorConfig);
        } else {
          setConfig(DEFAULT_CONFIG);
        }
      })
      .catch(() => setConfig(DEFAULT_CONFIG));
  }, [cidade]);

  function updateNivel(nivel: 'M1' | 'M2' | 'M3', field: keyof MonitorLevelConfig, value: any) {
    setConfig(prev => ({
      ...prev,
      [nivel]: { ...(prev[nivel] ?? DEFAULT_CONFIG[nivel]!), [field]: value },
    }));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await setDoc(
        doc(db, 'monitor_config', cidade),
        { ...config, atualizadoEm: serverTimestamp() },
        { merge: true }
      );
      setSalvoOk(true);
      setTimeout(() => setSalvoOk(false), 3000);
    } catch (e: any) {
      setErro('Erro ao salvar: ' + (e.message ?? ''));
    } finally {
      setSalvando(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,.15)',
    background: 'rgba(255,255,255,.06)',
    color: '#f0f4ff',
    fontSize: 12,
    marginTop: 3,
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    background: '#0d121e',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'rgba(255,255,255,.45)',
    display: 'block',
  };

  const inner = (
      <div style={{
        background: '#0d121e',
        border: '1px solid rgba(255,255,255,.12)',
        borderRadius: 14,
        padding: 20,
        width: '100%',
        maxWidth: 520,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,.7)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#f0f4ff' }}>
              Configurar Monitores
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
              Cidade: <span style={{ color: '#60a5fa', fontWeight: 700 }}>{cidade}</span>
            </div>
          </div>
          <button
            onClick={onFechar}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,.4)',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}>
            ✕
          </button>
        </div>

        {/* Informativo */}
        <div style={{
          background: 'rgba(59,130,246,.08)',
          border: '1px solid rgba(59,130,246,.2)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 11,
          color: 'rgba(255,255,255,.55)',
          lineHeight: 1.5,
        }}>
          Estas configurações controlam quando o sistema cria tarefas automaticamente para pontos GoJet com baixa disponibilidade de patinetes.
        </div>

        {/* Seções M1 / M2 / M3 */}
        {(['M1', 'M2', 'M3'] as const).map(nivel => {
          const cfg = config[nivel] ?? DEFAULT_CONFIG[nivel]!;
          const cor = NIVEL_COR[nivel];

          return (
            <div key={nivel} style={{
              background: `${cor}0d`,
              border: `1px solid ${cor}33`,
              borderRadius: 10,
              padding: '12px 14px',
            }}>
              {/* Cabeçalho do nível */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    background: cor,
                    color: '#fff',
                    borderRadius: 5,
                    padding: '2px 8px',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 0.5,
                  }}>{nivel}</div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
                    {NIVEL_LABEL[nivel]}
                  </span>
                </div>

                {/* Toggle ativo/inativo */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <div
                    onClick={() => updateNivel(nivel, 'ativo', !cfg.ativo)}
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      background: cfg.ativo ? cor : 'rgba(255,255,255,.15)',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'background .2s',
                      flexShrink: 0,
                    }}>
                    <div style={{
                      position: 'absolute',
                      top: 3,
                      left: cfg.ativo ? 19 : 3,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left .2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,.4)',
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: cfg.ativo ? cor : 'rgba(255,255,255,.35)', fontWeight: 700 }}>
                    {cfg.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Threshold */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>
                    Alerta quando disponibilidade &lt; {cfg.thresholdPct}%
                    <input
                      type="range"
                      min={5}
                      max={80}
                      step={5}
                      value={cfg.thresholdPct}
                      onChange={e => updateNivel(nivel, 'thresholdPct', Number(e.target.value))}
                      style={{ display: 'block', width: '100%', marginTop: 4, accentColor: cor }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>
                      <span>5%</span>
                      <span style={{ color: cor, fontWeight: 700 }}>{cfg.thresholdPct}%</span>
                      <span>80%</span>
                    </div>
                  </label>
                </div>

                {/* Prioridade */}
                <div>
                  <label style={labelStyle}>
                    Prioridade
                    <select
                      value={cfg.prioridade}
                      onChange={e => updateNivel(nivel, 'prioridade', e.target.value as 'alta' | 'media' | 'baixa')}
                      style={selectStyle}>
                      <option value="alta">Alta</option>
                      <option value="media">Média</option>
                      <option value="baixa">Baixa</option>
                    </select>
                  </label>
                </div>

                {/* Tipo de tarefa */}
                <div>
                  <label style={labelStyle}>
                    Tipo de tarefa
                    <select
                      value={cfg.tipoTarefa}
                      onChange={e => updateNivel(nivel, 'tipoTarefa', e.target.value)}
                      style={selectStyle}>
                      <option value="redistribuicao">Redistribuição</option>
                      <option value="recarga">Recarga</option>
                      <option value="manutencao">Manutenção</option>
                    </select>
                  </label>
                </div>

                {/* Raio de busca */}
                <div>
                  <label style={labelStyle}>
                    Raio de busca (m)
                    <input
                      type="number"
                      min={50}
                      max={500}
                      step={10}
                      value={cfg.raioBusca}
                      onChange={e => updateNivel(nivel, 'raioBusca', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </label>
                </div>

                {/* Deduplicar */}
                <div>
                  <label style={labelStyle}>
                    Não duplicar por (h)
                    <input
                      type="number"
                      min={1}
                      max={48}
                      step={1}
                      value={cfg.deduplicarHoras}
                      onChange={e => updateNivel(nivel, 'deduplicarHoras', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </label>
                </div>
              </div>
            </div>
          );
        })}

        {/* Feedback */}
        {erro && (
          <div style={{
            background: 'rgba(239,68,68,.1)',
            border: '1px solid rgba(239,68,68,.3)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            color: '#ef4444',
          }}>
            {erro}
          </div>
        )}
        {salvoOk && (
          <div style={{
            background: 'rgba(34,197,94,.1)',
            border: '1px solid rgba(34,197,94,.3)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            color: '#22c55e',
            fontWeight: 700,
          }}>
            Configuração salva com sucesso!
          </div>
        )}

        {/* Ações */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onFechar}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,.1)',
              background: 'transparent',
              color: 'rgba(255,255,255,.5)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}>
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            style={{
              flex: 2,
              padding: '10px',
              borderRadius: 8,
              border: 'none',
              background: salvando ? 'rgba(255,255,255,.1)' : 'rgba(251,191,36,.9)',
              color: salvando ? 'rgba(255,255,255,.4)' : '#0d0d1a',
              fontSize: 12,
              fontWeight: 800,
              cursor: salvando ? 'wait' : 'pointer',
            }}>
            {salvando ? 'Salvando...' : 'Salvar configuração'}
          </button>
        </div>
      </div>
  );

  if (inline) return inner;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      {inner}
    </div>
  );
}
