// frontend/src/components/GoJetCidadesPanel.tsx
// Painel admin para configurar quais cidades têm integração GoJet.
// Salva em Supabase: gojet_config
//
// Uso no DashboardManager (aba configurações):
//   import GoJetCidadesPanel from './components/GoJetCidadesPanel';
//   <GoJetCidadesPanel />

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { onGojetConfigChange, salvarGojetConfigSupabase, removerGojetConfigSupabase } from '../lib/gojet-config-supabase';
import { supabase } from '../lib/supabase';

const T = {
  cidadesGoJet:       { pt: '🗺 Cidades GoJet',                                    en: '🗺 GoJet Cities',                                          es: '🗺 Ciudades GoJet',                                       ru: '🗺 Города GoJet' },
  carregando:         { pt: 'Carregando...',                                       en: 'Loading...',                                               es: 'Cargando...',                                             ru: 'Загрузка...' },
  nenhumaCidade:      { pt: 'Nenhuma cidade configurada.',                         en: 'No cities configured.',                                    es: 'Ninguna ciudad configurada.',                             ru: 'Нет настроенных городов.' },
  editarCidade:       { pt: 'Editar cidade',                                       en: 'Edit city',                                                es: 'Editar ciudad',                                           ru: 'Редактировать город' },
  novaCidade:         { pt: 'Nova cidade',                                         en: 'New city',                                                 es: 'Nueva ciudad',                                            ru: 'Новый город' },
  nomeDaCidade:       { pt: 'Nome da cidade',                                      en: 'City name',                                                es: 'Nombre de la ciudad',                                     ru: 'Название города' },
  selecionarCidade:   { pt: '— Selecionar cidade —',                               en: '— Select city —',                                          es: '— Seleccionar ciudad —',                                  ru: '— Выбрать город —' },
  digitarManual:      { pt: '✏️ Digitar manualmente...',                           en: '✏️ Enter manually...',                                     es: '✏️ Escribir manualmente...',                              ru: '✏️ Ввести вручную...' },
  exRecife:           { pt: 'Ex: Recife',                                          en: 'E.g.: Recife',                                             es: 'Ej.: Recife',                                             ru: 'Напр.: Recife' },
  digiteNomeExato:    { pt: 'Digite o nome da cidade exatamente como cadastrada',   en: 'Enter the city name exactly as registered',              es: 'Escriba el nombre de la ciudad exactamente como registrada',  ru: 'Введите название города точно как зарегистрировано' },
  cityIdGoJet:        { pt: 'City ID (GoJet)',                                     en: 'City ID (GoJet)',                                          es: 'City ID (GoJet)',                                         ru: 'City ID (GoJet)' },
  exCityId:           { pt: 'Ex: 669f89ebd06775867c31b984',                        en: 'E.g.: 669f89ebd06775867c31b984',                           es: 'Ej.: 669f89ebd06775867c31b984',                           ru: 'Напр.: 669f89ebd06775867c31b984' },
  dicaCityId:         { pt: '💡 Abrir map.gojet.app → selecionar cidade → copiar o ?cid= da URL', en: '💡 Open map.gojet.app → select city → copy the ?cid= from the URL', es: '💡 Abrir map.gojet.app → seleccionar ciudad → copiar el ?cid= de la URL', ru: '💡 Откройте map.gojet.app → выберите город → скопируйте ?cid= из URL' },
  ativoOverlay:       { pt: 'Ativo (aparece no overlay GoJet)',                    en: 'Active (shown in the GoJet overlay)',                      es: 'Activo (aparece en el overlay GoJet)',                    ru: 'Активен (отображается в слое GoJet)' },
  cancelar:           { pt: 'Cancelar',                                            en: 'Cancel',                                                   es: 'Cancelar',                                                ru: 'Отмена' },
  salvando:           { pt: 'Salvando...',                                         en: 'Saving...',                                                es: 'Guardando...',                                            ru: 'Сохранение...' },
  salvar:             { pt: '✓ Salvar',                                            en: '✓ Save',                                                   es: '✓ Guardar',                                               ru: '✓ Сохранить' },
  adicionarCidade:    { pt: '+ Adicionar cidade',                                  en: '+ Add city',                                               es: '+ Agregar ciudad',                                        ru: '+ Добавить город' },
  erroObrigatorio:    { pt: 'Nome e City ID são obrigatórios',                     en: 'Name and City ID are required',                            es: 'Nombre y City ID son obligatorios',                       ru: 'Имя и City ID обязательны' },
  confirmRemover:     { pt: 'Remover',                                             en: 'Remove',                                                   es: 'Eliminar',                                                ru: 'Удалить' },
};

interface GoJetCidade {
  id: string;          // nome da cidade (doc id)
  cityId: string;      // GoJet city_id
  nome: string;        // nome legível
  ativo: boolean;
}

// Cidades conhecidas (seed inicial)
const SEED: Omit<GoJetCidade, 'id'>[] = [
  { cityId: '669f89ebd06775867c31b984', nome: 'São Paulo',    ativo: true  },
  { cityId: '67ab79f4cd4d3cbb07a0c02e', nome: 'Santo André',  ativo: false },
];

export default function GoJetCidadesPanel() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

  const [cidades,           setCidades]           = useState<GoJetCidade[]>([]);
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState<string[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [editando,          setEditando]          = useState<GoJetCidade | null>(null);
  const [nova,              setNova]              = useState(false);
  const [form,              setForm]              = useState({ nome: '', cityId: '', ativo: true });
  const [salvando,          setSalvando]          = useState(false);
  const [erro,              setErro]              = useState('');

  // Carrega cidades disponíveis do Supabase (estações cadastradas)
  useEffect(() => {
    supabase.from('estacoes_geo').select('cidade').then(({ data }) => {
      const set = new Set<string>();
      (data ?? []).forEach((r: any) => {
        const c = r.cidade;
        if (c && typeof c === 'string') set.add(c.trim());
      });
      setCidadesDisponiveis(Array.from(set).sort());
    });
  }, []);

  useEffect(() => {
    return onGojetConfigChange(lista => {
      setCidades(lista);
      setLoading(false);

      // Seed inicial se vazio
      if (lista.length === 0) {
        Promise.all(SEED.map(s =>
          salvarGojetConfigSupabase(s.nome, s.cityId, s.ativo)
        )).catch(() => {});
      }
    });
  }, []);

  const salvar = async () => {
    if (!form.nome.trim() || !form.cityId.trim()) {
      setErro(pick(T.erroObrigatorio));
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      const nome = form.nome.trim();
      const cityId = form.cityId.trim();
      await salvarGojetConfigSupabase(nome, cityId, form.ativo);
      setNova(false);
      setEditando(null);
      setForm({ nome: '', cityId: '', ativo: true });
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (id: string) => {
    if (!confirm(`${pick(T.confirmRemover)} ${id}?`)) return;
    await removerGojetConfigSupabase(id);
  };

  const toggleAtivo = async (c: GoJetCidade) => {
    await salvarGojetConfigSupabase(c.id, c.cityId, !c.ativo);
  };

  const iniciarEditar = (c: GoJetCidade) => {
    setEditando(c);
    setNova(true);
    setForm({ nome: c.nome, cityId: c.cityId, ativo: c.ativo });
  };

  const S = {
    section: {
      background: '#0d1521', border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 10, padding: 14, marginBottom: 12,
    } as React.CSSProperties,
    title: {
      fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.35)',
      textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10,
    },
    row: {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)',
    } as React.CSSProperties,
    inp: {
      width: '100%', padding: '8px 10px', borderRadius: 7,
      background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
      color: '#dce8ff', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const,
      marginBottom: 8,
    },
    lbl: {
      fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.4)',
      display: 'block' as const, marginBottom: 4,
      textTransform: 'uppercase' as const, letterSpacing: 0.5,
    },
    btn: (cor: string) => ({
      padding: '7px 12px', borderRadius: 7, border: 'none',
      background: cor, color: '#fff', fontSize: 11, fontWeight: 600,
      cursor: 'pointer',
    }),
  };

  return (
    <div>
      <div style={S.title}>{pick(T.cidadesGoJet)}</div>

      {/* Lista */}
      <div style={S.section}>
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12 }}>{pick(T.carregando)}</div>
        ) : cidades.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12 }}>
            {pick(T.nenhumaCidade)}
          </div>
        ) : cidades.map(c => (
          <div key={c.id} style={S.row}>
            {/* Toggle ativo */}
            <div
              onClick={() => toggleAtivo(c)}
              style={{
                width: 32, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
                background: c.ativo ? '#10b981' : 'rgba(255,255,255,.1)',
                position: 'relative', transition: 'background .2s',
              }}>
              <div style={{
                position: 'absolute', top: 2,
                left: c.ativo ? 16 : 2,
                width: 14, height: 14, borderRadius: 7,
                background: '#fff', transition: 'left .2s',
              }} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#dce8ff' }}>{c.nome}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontFamily: 'monospace' }}>
                {c.cityId}
              </div>
            </div>

            <button onClick={() => iniciarEditar(c)} style={S.btn('rgba(255,255,255,.08)')}>
              ✏️
            </button>
            <button onClick={() => remover(c.id)} style={S.btn('rgba(239,68,68,.15)')}>
              🗑
            </button>
          </div>
        ))}
      </div>

      {/* Formulário novo/editar */}
      {nova ? (
        <div style={S.section}>
          <div style={S.title}>{editando ? pick(T.editarCidade) : pick(T.novaCidade)}</div>

          <label style={S.lbl}>{pick(T.nomeDaCidade)}</label>
          {editando ? (
            // Editando — nome não pode mudar (é o doc ID)
            <div style={{ ...S.inp, color: 'rgba(255,255,255,.4)', cursor: 'not-allowed' }}>
              {form.nome}
            </div>
          ) : cidadesDisponiveis.length > 0 ? (
            // Dropdown com cidades que têm estações
            <select
              style={{ ...S.inp, cursor: 'pointer' }}
              value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            >
              <option value="">{pick(T.selecionarCidade)}</option>
              {cidadesDisponiveis
                .filter(c => !cidades.find(gc => gc.nome === c)) // esconde já configuradas
                .map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              <option value="__manual__">{pick(T.digitarManual)}</option>
            </select>
          ) : (
            <input style={S.inp} value={form.nome}
              placeholder={pick(T.exRecife)}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          )}
          {form.nome === '__manual__' && (
            <input style={{ ...S.inp, marginTop: 6 }}
              placeholder={pick(T.digiteNomeExato)}
              autoFocus
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          )}

          <label style={S.lbl}>{pick(T.cityIdGoJet)}</label>
          <input style={S.inp} value={form.cityId}
            placeholder={pick(T.exCityId)}
            onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} />

          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 8 }}>
            {pick(T.dicaCityId)}
          </div>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: 'rgba(255,255,255,.5)', cursor: 'pointer', marginBottom: 10,
          }}>
            <input type="checkbox" checked={form.ativo}
              onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} />
            {pick(T.ativoOverlay)}
          </label>

          {erro && <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setNova(false); setEditando(null); setForm({ nome: '', cityId: '', ativo: true }); setErro(''); }}
              style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
                background: 'rgba(255,255,255,.05)', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 12 }}>
              {pick(T.cancelar)}
            </button>
            <button onClick={salvar} disabled={salvando}
              style={{ flex: 2, padding: '8px', borderRadius: 8, border: 'none',
                background: '#10b981', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              {salvando ? pick(T.salvando) : pick(T.salvar)}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setNova(true); setEditando(null); setForm({ nome: '', cityId: '', ativo: true }); }}
          style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px dashed rgba(16,185,129,.3)',
            background: 'rgba(16,185,129,.06)', color: '#10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {pick(T.adicionarCidade)}
        </button>
      )}
    </div>
  );
}
