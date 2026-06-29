// frontend/src/components/GoJetCidadesPanel.tsx
// Painel admin para gerenciar cidades GoJet.
// Puxa lista automaticamente da API GoJet via Edge Function.
// Admin ativa/desativa cidades. Ao ativar, importa zonas automaticamente.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type CidadeConfig,
  carregarCidadeConfig,
  toggleCidadeAtiva,
  syncCidadesGoJet,
  importZonas,
  atualizarConfigCidade,
  onCidadeConfigChange,
} from '../lib/cidade-config';
import { showToastGlobal } from './ui/ToastQueue';
import { confirmDialog } from './ui/ConfirmDialog';

const T = {
  title:      { pt: '🌐 Cidades GoJet', en: '🌐 GoJet Cities', es: '🌐 Ciudades GoJet', ru: '🌐 Города GoJet' },
  ativas:     { pt: 'Ativas', en: 'Active', es: 'Activas', ru: 'Активные' },
  inativas:   { pt: 'Inativas', en: 'Inactive', es: 'Inactivas', ru: 'Неактивные' },
  novas:      { pt: 'Novas', en: 'New', es: 'Nuevas', ru: 'Новые' },
  sync:       { pt: '🔄 Sincronizar', en: '🔄 Sync', es: '🔄 Sincronizar', ru: '🔄 Синхронизировать' },
  syncing:    { pt: 'Sincronizando...', en: 'Syncing...', es: 'Sincronizando...', ru: 'Синхронизация...' },
  syncOk:     { pt: 'Sincronizado!', en: 'Synced!', es: '¡Sincronizado!', ru: 'Синхронизировано!' },
  importando: { pt: 'Importando zonas...', en: 'Importing zones...', es: 'Importando zonas...', ru: 'Импорт зон...' },
  zones:      { pt: 'zonas', en: 'zones', es: 'zonas', ru: 'зон' },
  bikes:      { pt: 'bikes', en: 'bikes', es: 'bikes', ru: 'байков' },
  semSync:    { pt: 'Nunca sincronizado. Clique em Sincronizar.', en: 'Never synced. Click Sync.', es: 'Nunca sincronizado. Haz clic en Sincronizar.', ru: 'Никогда не синхронизировалось. Нажмите Синхронизировать.' },
  config:     { pt: '⚙ Configuração', en: '⚙ Settings', es: '⚙ Configuración', ru: '⚙ Настройки' },
  limiteDefault: { pt: 'Limite padrão (bikes/ponto)', en: 'Default limit (bikes/point)', es: 'Límite por defecto (bikes/punto)', ru: 'Лимит по умолчанию (байков/точка)' },
  salvar:     { pt: 'Salvar', en: 'Save', es: 'Guardar', ru: 'Сохранить' },
  confirmarAtivar: { pt: 'Ativar cidade?', en: 'Activate city?', es: '¿Activar ciudad?', ru: 'Активировать город?' },
  msgAtivar:  { pt: 'Zonas serão importadas automaticamente do GoJet.', en: 'Zones will be imported automatically from GoJet.', es: 'Las zonas se importarán automáticamente de GoJet.', ru: 'Зоны будут импортированы автоматически из GoJet.' },
  removida:   { pt: 'Removida do GoJet', en: 'Removed from GoJet', es: 'Eliminada de GoJet', ru: 'Удалён из GoJet' },
  ultimaSync: { pt: 'Última sync', en: 'Last sync', es: 'Última sync', ru: 'Последняя синхронизация' },
  reImport:   { pt: 'Re-importar zonas', en: 'Re-import zones', es: 'Re-importar zonas', ru: 'Повторный импорт зон' },
};

type Lang = 'pt' | 'en' | 'es' | 'ru';

export default function GoJetCidadesPanel() {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;

  const [cidades, setCidades] = useState<CidadeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'ativas' | 'inativas' | 'novas'>('ativas');
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, any>>({});

  useEffect(() => {
    return onCidadeConfigChange(list => {
      setCidades(list);
      setLoading(false);
    });
  }, []);

  const ativas = cidades.filter(c => c.ativo && !c.gojet_removida);
  const inativas = cidades.filter(c => !c.ativo && !c.gojet_removida);
  const novas = cidades.filter(c => !c.ativo && !c.gojet_removida && !c.ultima_sync);
  const counts = { ativas: ativas.length, inativas: inativas.length, novas: novas.length };

  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await syncCidadesGoJet();
      showToastGlobal(`${pick(T.syncOk)} ${res.total} cidades. ${res.novas} novas.`, 'success');
    } catch (e: any) {
      showToastGlobal(`Sync erro: ${e.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  }, [lang]);

  const doToggle = useCallback(async (c: CidadeConfig) => {
    if (!c.ativo) {
      const ok = await confirmDialog(pick(T.confirmarAtivar), pick(T.msgAtivar));
      if (!ok) return;
    }
    try {
      await toggleCidadeAtiva(c.id, !c.ativo);
      if (!c.ativo) showToastGlobal(`${c.nome} ativada! Importando zonas...`, 'success');
    } catch (e: any) {
      showToastGlobal(`Erro: ${e.message}`, 'error');
    }
  }, [lang]);

  const doReImport = useCallback(async (cityId: string) => {
    showToastGlobal(pick(T.importando), 'info');
    try {
      const res = await importZonas(cityId);
      showToastGlobal(`${res.imported} zonas importadas!`, 'success');
    } catch (e: any) {
      showToastGlobal(`Erro: ${e.message}`, 'error');
    }
  }, [lang]);

  const doSaveConfig = useCallback(async (id: string) => {
    try {
      await atualizarConfigCidade(id, configForm);
      showToastGlobal('Config salva!', 'success');
      setConfigOpen(null);
    } catch (e: any) {
      showToastGlobal(`Erro: ${e.message}`, 'error');
    }
  }, [configForm]);

  const filtered = tab === 'ativas' ? ativas : tab === 'novas' ? novas : inativas;

  const S = {
    container: { background: '#0d1521', borderRadius: 10, padding: 14 } as React.CSSProperties,
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } as React.CSSProperties,
    title: { fontSize: 13, fontWeight: 700, color: '#dce8ff' } as React.CSSProperties,
    tabs: { display: 'flex', gap: 4, marginBottom: 10 } as React.CSSProperties,
    tab: (active: boolean) => ({
      padding: '4px 10px', borderRadius: 12, border: 'none', fontSize: 11, fontWeight: 600,
      cursor: 'pointer', background: active ? '#10b981' : 'rgba(255,255,255,.08)',
      color: active ? '#fff' : 'rgba(255,255,255,.5)',
    }),
    row: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' } as React.CSSProperties,
    toggle: (on: boolean) => ({
      width: 34, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
      background: on ? '#10b981' : 'rgba(255,255,255,.1)', position: 'relative' as const, transition: 'background .2s',
    }),
    toggleDot: (on: boolean) => ({
      position: 'absolute' as const, top: 2, left: on ? 18 : 2,
      width: 14, height: 14, borderRadius: 7, background: '#fff', transition: 'left .2s',
    }),
    badge: (color: string) => ({
      fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
      background: `${color}30`, color,
    }),
    syncBtn: {
      padding: '5px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
      cursor: 'pointer', background: '#3b82f6', color: '#fff',
    } as React.CSSProperties,
    configSection: {
      background: 'rgba(255,255,255,.03)', borderRadius: 6, padding: 10, marginTop: 6,
      borderLeft: '3px solid #3b82f6',
    } as React.CSSProperties,
    inp: {
      width: 80, padding: '4px 6px', borderRadius: 4,
      background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
      color: '#dce8ff', fontSize: 12, outline: 'none',
    } as React.CSSProperties,
    miniBtn: (color: string) => ({
      padding: '3px 8px', borderRadius: 4, border: 'none', fontSize: 10,
      cursor: 'pointer', background: color, color: '#fff', fontWeight: 600,
    }),
  };

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.title}>{pick(T.title)}</div>
        <button
          onClick={doSync}
          disabled={syncing}
          style={{ ...S.syncBtn, opacity: syncing ? 0.5 : 1 }}
        >
          {syncing ? pick(T.syncing) : pick(T.sync)}
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12 }}>Carregando...</div>
      ) : cidades.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
          {pick(T.semSync)}
        </div>
      ) : (
        <>
          <div style={S.tabs}>
            <button style={S.tab(tab === 'ativas')} onClick={() => setTab('ativas')}>
              {pick(T.ativas)} ({counts.ativas})
            </button>
            <button style={S.tab(tab === 'inativas')} onClick={() => setTab('inativas')}>
              {pick(T.inativas)} ({counts.inativas})
            </button>
            {counts.novas > 0 && (
              <button style={S.tab(tab === 'novas')} onClick={() => setTab('novas')}>
                🆕 {pick(T.novas)} ({counts.novas})
              </button>
            )}
          </div>

          {filtered.map(c => (
            <div key={c.id}>
              <div style={S.row}>
                <div style={S.toggle(c.ativo)} onClick={() => doToggle(c)}>
                  <div style={S.toggleDot(c.ativo)} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#dce8ff' }}>{c.nome}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', display: 'flex', gap: 8 }}>
                    {c.total_zones != null && <span>{c.total_zones} {pick(T.zones)}</span>}
                    {c.total_bikes != null && <span>{c.total_bikes} {pick(T.bikes)}</span>}
                    {c.gojet_removida && <span style={{ color: '#ef4444' }}>{pick(T.removida)}</span>}
                    {c.ultima_sync && (
                      <span>{pick(T.ultimaSync)}: {new Date(c.ultima_sync).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                {c.total_zones != null && c.total_zones > 0 && (
                  <span style={S.badge('#3b82f6')}>{c.total_zones}z</span>
                )}
                {!c.ultima_sync && <span style={S.badge('#f59e0b')}>NOVA</span>}

                {c.ativo && (
                  <button
                    onClick={() => {
                      if (configOpen === c.id) { setConfigOpen(null); }
                      else { setConfigOpen(c.id); setConfigForm(c.config || {}); }
                    }}
                    style={S.miniBtn('rgba(255,255,255,.08)')}
                  >
                    ⚙
                  </button>
                )}
              </div>

              {configOpen === c.id && (
                <div style={S.configSection}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', marginBottom: 6 }}>
                    {pick(T.config)} — {c.nome}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11 }}>
                    <span style={{ color: 'rgba(255,255,255,.5)' }}>{pick(T.limiteDefault)}:</span>
                    <input
                      type="number"
                      style={S.inp}
                      value={configForm.limite_default ?? 3}
                      onChange={e => setConfigForm(f => ({ ...f, limite_default: parseInt(e.target.value) || 3 }))}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => doSaveConfig(c.id)} style={S.miniBtn('#10b981')}>
                      {pick(T.salvar)}
                    </button>
                    <button onClick={() => doReImport(c.id)} style={S.miniBtn('#3b82f6')}>
                      {pick(T.reImport)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
