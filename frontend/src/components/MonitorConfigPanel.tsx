// frontend/src/components/MonitorConfigPanel.tsx
// Painel de configuração dos thresholds M1/M2/M3 do sistema GoJet por cidade.

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const T = {
  nivelLabelM1: { pt: 'M1 — Crítico', en: 'M1 — Critical', es: 'M1 — Crítico', ru: 'M1 — Критический' },
  nivelLabelM2: { pt: 'M2 — Atenção', en: 'M2 — Warning', es: 'M2 — Atención', ru: 'M2 — Внимание' },
  nivelLabelM3: { pt: 'M3 — Informativo', en: 'M3 — Informational', es: 'M3 — Informativo', ru: 'M3 — Информационный' },
  titulo: { pt: 'Configurar Monitores', en: 'Configure Monitors', es: 'Configurar Monitores', ru: 'Настроить мониторы' },
  cidadeLabel: { pt: 'Cidade:', en: 'City:', es: 'Ciudad:', ru: 'Город:' },
  info: {
    pt: 'Estas configurações controlam quando o sistema cria tarefas automaticamente para pontos GoJet com baixa disponibilidade de patinetes.',
    en: 'These settings control when the system automatically creates tasks for GoJet points with low scooter availability.',
    es: 'Estos ajustes controlan cuándo el sistema crea tareas automáticamente para puntos GoJet con baja disponibilidad de patinetes.',
    ru: 'Эти настройки определяют, когда система автоматически создаёт задачи для точек GoJet с низкой доступностью самокатов.',
  },
  ativo: { pt: 'Ativo', en: 'Active', es: 'Activo', ru: 'Активно' },
  inativo: { pt: 'Inativo', en: 'Inactive', es: 'Inactivo', ru: 'Неактивно' },
  alertaQuando: { pt: 'Alerta quando disponibilidade <', en: 'Alert when availability <', es: 'Alerta cuando disponibilidad <', ru: 'Оповещение, когда доступность <' },
  prioridade: { pt: 'Prioridade', en: 'Priority', es: 'Prioridad', ru: 'Приоритет' },
  prioridadeAlta: { pt: 'Alta', en: 'High', es: 'Alta', ru: 'Высокий' },
  prioridadeMedia: { pt: 'Média', en: 'Medium', es: 'Media', ru: 'Средний' },
  prioridadeBaixa: { pt: 'Baixa', en: 'Low', es: 'Baja', ru: 'Низкий' },
  tipoTarefa: { pt: 'Tipo de tarefa', en: 'Task type', es: 'Tipo de tarea', ru: 'Тип задачи' },
  tipoRedistribuicao: { pt: 'Redistribuição', en: 'Redistribution', es: 'Redistribución', ru: 'Перераспределение' },
  tipoRecarga: { pt: 'Recarga', en: 'Recharge', es: 'Recarga', ru: 'Подзарядка' },
  tipoManutencao: { pt: 'Manutenção', en: 'Maintenance', es: 'Mantenimiento', ru: 'Обслуживание' },
  raioBusca: { pt: 'Raio de busca (m)', en: 'Search radius (m)', es: 'Radio de búsqueda (m)', ru: 'Радиус поиска (м)' },
  naoDuplicar: { pt: 'Não duplicar por (h)', en: "Don't duplicate for (h)", es: 'No duplicar por (h)', ru: 'Не дублировать в течение (ч)' },
  erroSalvar: { pt: 'Erro ao salvar: ', en: 'Error saving: ', es: 'Error al guardar: ', ru: 'Ошибка при сохранении: ' },
  salvoOk: { pt: 'Configuração salva com sucesso!', en: 'Settings saved successfully!', es: '¡Configuración guardada con éxito!', ru: 'Настройки успешно сохранены!' },
  cancelar: { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  salvando: { pt: 'Salvando...', en: 'Saving...', es: 'Guardando...', ru: 'Сохранение...' },
  salvarConfig: { pt: 'Salvar configuração', en: 'Save settings', es: 'Guardar configuración', ru: 'Сохранить настройки' },
};

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

const NIVEL_LABEL_KEY: Record<string, keyof typeof T> = {
  M1: 'nivelLabelM1',
  M2: 'nivelLabelM2',
  M3: 'nivelLabelM3',
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
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [config, setConfig] = useState<MonitorConfig>(DEFAULT_CONFIG);
  const [salvando, setSalvando] = useState(false);
  const [salvoOk, setSalvoOk] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('monitor_config').select('*').eq('cidade', cidade).maybeSingle();
        if (error || !data) setConfig(DEFAULT_CONFIG);
        else setConfig({ M1: data.m1, M2: data.m2, M3: data.m3 } as MonitorConfig);
      } catch { setConfig(DEFAULT_CONFIG); }
    })();
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
      const { error } = await supabase.from('monitor_config').upsert({
        cidade,
        m1: config.M1,
        m2: config.M2,
        m3: config.M3,
        atualizado_em: new Date().toISOString(),
      });
      if (error) throw error;
      setSalvoOk(true);
      setTimeout(() => setSalvoOk(false), 3000);
    } catch (e: any) {
      setErro(pick(T.erroSalvar) + (e.message ?? ''));
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
              {pick(T.titulo)}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
              {pick(T.cidadeLabel)} <span style={{ color: '#60a5fa', fontWeight: 700 }}>{cidade}</span>
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
          {pick(T.info)}
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
                    {pick(T[NIVEL_LABEL_KEY[nivel]])}
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
                    {cfg.ativo ? pick(T.ativo) : pick(T.inativo)}
                  </span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Threshold */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>
                    {pick(T.alertaQuando)} {cfg.thresholdPct}%
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
                    {pick(T.prioridade)}
                    <select
                      value={cfg.prioridade}
                      onChange={e => updateNivel(nivel, 'prioridade', e.target.value as 'alta' | 'media' | 'baixa')}
                      style={selectStyle}>
                      <option value="alta">{pick(T.prioridadeAlta)}</option>
                      <option value="media">{pick(T.prioridadeMedia)}</option>
                      <option value="baixa">{pick(T.prioridadeBaixa)}</option>
                    </select>
                  </label>
                </div>

                {/* Tipo de tarefa */}
                <div>
                  <label style={labelStyle}>
                    {pick(T.tipoTarefa)}
                    <select
                      value={cfg.tipoTarefa}
                      onChange={e => updateNivel(nivel, 'tipoTarefa', e.target.value)}
                      style={selectStyle}>
                      <option value="redistribuicao">{pick(T.tipoRedistribuicao)}</option>
                      <option value="recarga">{pick(T.tipoRecarga)}</option>
                      <option value="manutencao">{pick(T.tipoManutencao)}</option>
                    </select>
                  </label>
                </div>

                {/* Raio de busca */}
                <div>
                  <label style={labelStyle}>
                    {pick(T.raioBusca)}
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
                    {pick(T.naoDuplicar)}
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
            {pick(T.salvoOk)}
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
            {pick(T.cancelar)}
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
            {salvando ? pick(T.salvando) : pick(T.salvarConfig)}
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
