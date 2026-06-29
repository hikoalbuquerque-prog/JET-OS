// frontend/src/components/PainelConfiguracoes.tsx
// Painel unificado de configurações do sistema.
// Abas: GoJet | Monitor | Pagamentos | Telegram

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { MonitorConfigPanel } from './MonitorConfigPanel';
import TelegramConfigPanel from '../TelegramConfigPanel';
import BroadcastPanel from './BroadcastPanel';
import GoJetCidadesPanel from './GoJetCidadesPanel';

// ─── i18n ─────────────────────────────────────────────────────────

const T = {
  loading:            { pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  // Aba GoJet
  fillNameCityId:     { pt: 'Preencha nome e City ID', en: 'Fill in name and City ID', es: 'Complete nombre y City ID', ru: 'Заполните название и City ID' },
  saved:              { pt: '✅ Salvo', en: '✅ Saved', es: '✅ Guardado', ru: '✅ Сохранено' },
  errorSaving:        { pt: 'Erro ao salvar', en: 'Error saving', es: 'Error al guardar', ru: 'Ошибка при сохранении' },
  gojetCities:        { pt: 'Cidades GoJet', en: 'GoJet Cities', es: 'Ciudades GoJet', ru: 'Города GoJet' },
  gojetCitiesDesc:    { pt: 'Configure a integração com a API GoJet por cidade', en: 'Configure the GoJet API integration per city', es: 'Configure la integración con la API GoJet por ciudad', ru: 'Настройте интеграцию с API GoJet по городам' },
  newCity:            { pt: '+ Nova cidade', en: '+ New city', es: '+ Nueva ciudad', ru: '+ Новый город' },
  editPrefix:         { pt: 'Editar:', en: 'Edit:', es: 'Editar:', ru: 'Редактировать:' },
  newCityTitle:       { pt: 'Nova cidade', en: 'New city', es: 'Nueva ciudad', ru: 'Новый город' },
  cityName:           { pt: 'Nome da cidade', en: 'City name', es: 'Nombre de la ciudad', ru: 'Название города' },
  select:             { pt: 'Selecionar...', en: 'Select...', es: 'Seleccionar...', ru: 'Выбрать...' },
  gojetCityId:        { pt: 'GoJet City ID', en: 'GoJet City ID', es: 'GoJet City ID', ru: 'GoJet City ID' },
  active:             { pt: 'Ativo', en: 'Active', es: 'Activo', ru: 'Активно' },
  inactive:           { pt: 'Inativo', en: 'Inactive', es: 'Inactivo', ru: 'Неактивно' },
  cancel:             { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  saving:             { pt: 'Salvando...', en: 'Saving...', es: 'Guardando...', ru: 'Сохранение...' },
  save:               { pt: '💾 Salvar', en: '💾 Save', es: '💾 Guardar', ru: '💾 Сохранить' },
  edit:               { pt: 'Editar', en: 'Edit', es: 'Editar', ru: 'Редактировать' },
  remove:             { pt: 'Remover', en: 'Remove', es: 'Eliminar', ru: 'Удалить' },
  badgeActive:        { pt: '● Ativo', en: '● Active', es: '● Activo', ru: '● Активно' },
  badgeInactive:      { pt: '○ Inativo', en: '○ Inactive', es: '○ Inactivo', ru: '○ Неактивно' },
  noGojetCity:        { pt: 'Nenhuma cidade GoJet configurada', en: 'No GoJet city configured', es: 'Ninguna ciudad GoJet configurada', ru: 'Города GoJet не настроены' },
  // Aba Monitor
  thresholds:         { pt: 'Thresholds M1/M2/M3', en: 'M1/M2/M3 Thresholds', es: 'Umbrales M1/M2/M3', ru: 'Пороги M1/M2/M3' },
  // Aba Pagamentos
  paymentsByCity:     { pt: 'Pagamentos por cidade', en: 'Payments per city', es: 'Pagos por ciudad', ru: 'Платежи по городам' },
  paymentsByCityDesc: { pt: 'Valor por tarefa concluída (scout/charger)', en: 'Amount per completed task (scout/charger)', es: 'Monto por tarea completada (scout/charger)', ru: 'Сумма за выполненную задачу (scout/charger)' },
  editingPrefix:      { pt: 'Editando:', en: 'Editing:', es: 'Editando:', ru: 'Редактирование:' },
  valuePerTask:       { pt: 'Valor por tarefa (R$)', en: 'Amount per task (R$)', es: 'Monto por tarea (R$)', ru: 'Сумма за задачу (R$)' },
  currency:           { pt: 'Moeda', en: 'Currency', es: 'Moneda', ru: 'Валюта' },
  perTask:            { pt: '/tarefa', en: '/task', es: '/tarea', ru: '/задача' },
  noConfig:           { pt: 'Sem configuração', en: 'No configuration', es: 'Sin configuración', ru: 'Нет конфигурации' },
  configure:          { pt: '+ Configurar', en: '+ Configure', es: '+ Configurar', ru: '+ Настроить' },
  // Componente principal
  tabGojet:           { pt: '🛴 GoJet', en: '🛴 GoJet', es: '🛴 GoJet', ru: '🛴 GoJet' },
  tabMonitor:         { pt: '📊 Monitor', en: '📊 Monitor', es: '📊 Monitor', ru: '📊 Монитор' },
  tabPayments:        { pt: '💰 Pagamentos', en: '💰 Payments', es: '💰 Pagos', ru: '💰 Платежи' },
  tabTelegram:        { pt: '📨 Telegram', en: '📨 Telegram', es: '📨 Telegram', ru: '📨 Telegram' },
  tabBroadcast:       { pt: '📡 Broadcast', en: '📡 Broadcast', es: '📡 Broadcast', ru: '📡 Рассылка' },
  settings:           { pt: '⚙️ Configurações', en: '⚙️ Settings', es: '⚙️ Configuración', ru: '⚙️ Настройки' },
  settingsSubtitle:   { pt: 'Integração, monitores, pagamentos e Telegram', en: 'Integration, monitors, payments and Telegram', es: 'Integración, monitores, pagos y Telegram', ru: 'Интеграция, мониторы, платежи и Telegram' },
};

// ─── Tipos ────────────────────────────────────────────────────────

interface PagConfig {
  valor_por_tarefa: number;
  moeda: string;
  ativo: boolean;
}

interface Props {
  onFechar: () => void;
  cidadeAtual: string;
  autorUid?: string;
  autorNome?: string;
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
  tab: (ativo: boolean): React.CSSProperties => ({
    padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    color: ativo ? '#818cf8' : 'rgba(255,255,255,.4)',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderWidth: '0 0 2px 0',
    borderBottomColor: ativo ? '#818cf8' : 'transparent',
    background: 'none', transition: 'color .15s', outline: 'none',
  }),
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

// ─── Aba GoJet — agora usa GoJetCidadesPanel (cidade_config) ──────

function AbaGoJet() {
  return <GoJetCidadesPanel />;
}

// ─── Aba Monitor ──────────────────────────────────────────────────

function AbaMonitor({ cidadeAtual }: { cidadeAtual: string }) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [cidadesDisp, setCidadesDisp] = useState<string[]>([]);
  const [cidade, setCidade] = useState(cidadeAtual);

  useEffect(() => {
    supabase.from('estacoes').select('cidade').then(({ data }) => {
      const set = new Set<string>();
      (data || []).forEach((d: any) => { if (d.cidade) set.add(d.cidade.trim()); });
      const arr = Array.from(set).sort();
      setCidadesDisp(arr);
      if (!arr.includes(cidade) && arr.length > 0) setCidade(arr[0]);
    });
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff', flex: 1 }}>{pick(T.thresholds)}</div>
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
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [configs, setConfigs] = useState<Record<string, PagConfig>>({});
  const [cidades, setCidades] = useState<string[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState({ valor_por_tarefa: 3.5, moeda: 'BRL', ativo: true });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.from('pagamentos_config').select('*'),
      supabase.from('estacoes').select('cidade'),
    ]).then(([pagRes, estRes]) => {
      const cfgs: Record<string, PagConfig> = {};
      (pagRes.data || []).forEach((d: any) => { cfgs[d.id] = { valor_por_tarefa: d.valor_por_tarefa, moeda: d.moeda, ativo: d.ativo }; });
      setConfigs(cfgs);

      const set = new Set<string>();
      (estRes.data || []).forEach((d: any) => { if (d.cidade) set.add(d.cidade.trim()); });
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
      const { error } = await supabase.from('pagamentos_config').upsert({
        id: editando,
        valor_por_tarefa: form.valor_por_tarefa,
        moeda: form.moeda,
        ativo: form.ativo,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      setConfigs(prev => ({ ...prev, [editando]: form }));
      setMsg(pick(T.saved));
      setEditando(null);
    } catch { setMsg(pick(T.errorSaving)); }
    finally { setSalvando(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#dce8ff' }}>{pick(T.paymentsByCity)}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>{pick(T.paymentsByCityDesc)}</div>
      </div>

      {editando && (
        <div style={{ ...S.card, border: '1px solid rgba(16,185,129,.25)', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#34d399', marginBottom: 14 }}>{pick(T.editingPrefix)} {editando}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={S.lbl}>{pick(T.valuePerTask)}</label>
              <input type="number" min={0} step={0.5} value={form.valor_por_tarefa}
                onChange={e => setForm(f => ({ ...f, valor_por_tarefa: parseFloat(e.target.value) || 0 }))}
                style={S.inp} />
            </div>
            <div>
              <label style={S.lbl}>{pick(T.currency)}</label>
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
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{pick(T.active)}</span>
              </label>
            </div>
          </div>
          {msg && <div style={{ fontSize: 11, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', marginTop: 8 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => { setEditando(null); setMsg(''); }} style={S.btnGhost}>{pick(T.cancel)}</button>
            <button onClick={salvar} disabled={salvando} style={S.btnPrimary}>
              {salvando ? pick(T.saving) : pick(T.save)}
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
                    {cfg.moeda || 'BRL'} {cfg.valor_por_tarefa?.toFixed(2)}{pick(T.perTask)}
                    {' · '}
                    <span style={{ color: cfg.ativo !== false ? '#22c55e' : '#f87171' }}>
                      {cfg.ativo !== false ? pick(T.active) : pick(T.inactive)}
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 3 }}>{pick(T.noConfig)}</div>
                )}
              </div>
              <button onClick={() => abrirEdicao(cidade)} style={{ ...S.btnGhost, padding: '5px 12px', fontSize: 11 }}>
                {cfg ? pick(T.edit) : pick(T.configure)}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────

type Aba = 'gojet' | 'monitor' | 'pagamentos' | 'telegram' | 'broadcast';

export default function PainelConfiguracoes({ onFechar, cidadeAtual, autorUid, autorNome }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [aba, setAba] = useState<Aba>('gojet');

  const ABAS: { id: Aba; label: string }[] = [
    { id: 'gojet',      label: pick(T.tabGojet) },
    { id: 'monitor',    label: pick(T.tabMonitor) },
    { id: 'pagamentos', label: pick(T.tabPayments) },
    { id: 'telegram',   label: pick(T.tabTelegram) },
    { id: 'broadcast',  label: pick(T.tabBroadcast) },
  ];

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={S.panel}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 0 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#dce8ff' }}>{pick(T.settings)}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2, marginBottom: 12 }}>
                {pick(T.settingsSubtitle)}
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
          {aba === 'broadcast'  && (
            <BroadcastPanel autorUid={autorUid} autorNome={autorNome} />
          )}
        </div>
      </div>
    </div>
  );
}
