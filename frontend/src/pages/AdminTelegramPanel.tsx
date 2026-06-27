// src/pages/AdminTelegramPanel.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchUsuarios } from '../lib/usuarios-supabase';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// i18n: padrão do TermosUsoGate — texto definido em objeto { pt, en, es, ru }
// e selecionado pelo idioma atual (sem chaves json). PT é a fonte fiel.
const T = {
  title:           { pt: 'Admin Telegram', en: 'Telegram Admin', es: 'Admin Telegram', ru: 'Администрирование Telegram' },
  subtitle:        { pt: 'Gerenciar grupos e gestores', en: 'Manage groups and managers', es: 'Gestionar grupos y gestores', ru: 'Управление группами и менеджерами' },
  tabGrupos:       { pt: 'Grupos Telegram', en: 'Telegram Groups', es: 'Grupos de Telegram', ru: 'Группы Telegram' },
  tabGestores:     { pt: 'Gestores', en: 'Managers', es: 'Gestores', ru: 'Менеджеры' },
  loading:         { pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  totalGrupos:     { pt: 'Total: {n} grupos', en: 'Total: {n} groups', es: 'Total: {n} grupos', ru: 'Всего: {n} групп' },
  totalGestores:   { pt: 'Total: {n} gestores', en: 'Total: {n} managers', es: 'Total: {n} gestores', ru: 'Всего: {n} менеджеров' },
  semGrupo:        { pt: 'Nenhum grupo cadastrado', en: 'No groups registered', es: 'Ningún grupo registrado', ru: 'Нет зарегистрированных групп' },
  semGestor:       { pt: 'Nenhum gestor cadastrado', en: 'No managers registered', es: 'Ningún gestor registrado', ru: 'Нет зарегистрированных менеджеров' },
  labelId:         { pt: 'ID', en: 'ID', es: 'ID', ru: 'ID' },
  labelTipo:       { pt: 'Tipo', en: 'Type', es: 'Tipo', ru: 'Тип' },
  labelEmail:      { pt: 'Email', en: 'Email', es: 'Correo', ru: 'Эл. почта' },
  labelTelegramId: { pt: 'Telegram ID', en: 'Telegram ID', es: 'ID de Telegram', ru: 'Telegram ID' },
  labelZona:       { pt: 'Zona', en: 'Zone', es: 'Zona', ru: 'Зона' },
  ativo:           { pt: 'Ativo', en: 'Active', es: 'Activo', ru: 'Активен' },
  inativo:         { pt: 'Inativo', en: 'Inactive', es: 'Inactivo', ru: 'Неактивен' },
  footer:          { pt: 'Admin Panel - Gerenciar Telegram e Gestores', en: 'Admin Panel - Manage Telegram and Managers', es: 'Panel de Administración - Gestionar Telegram y Gestores', ru: 'Панель администратора — управление Telegram и менеджерами' },
  toastGrupoOk:    { pt: 'Grupo atualizado', en: 'Group updated', es: 'Grupo actualizado', ru: 'Группа обновлена' },
  toastErroLoad:   { pt: 'Erro ao carregar dados', en: 'Error loading data', es: 'Error al cargar los datos', ru: 'Ошибка загрузки данных' },
  toastErroGrupo:  { pt: 'Erro ao atualizar grupo', en: 'Error updating group', es: 'Error al actualizar el grupo', ru: 'Ошибка обновления группы' },
};

interface GrupoTelegram {
  id: string;
  nome: string;
  chatId: string;
  tipo: 'zona' | 'cidade' | 'geral';
  ativo: boolean;
  criadoEm?: any;
}

interface GestorInfo {
  id: string;
  nome: string;
  email: string;
  telegramId: string;
  telegramUsername?: string;
  zona?: string;
  ativo: boolean;
}

export default function AdminTelegramPanel() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

  const [grupos, setGrupos] = useState<GrupoTelegram[]>([]);
  const [gestores, setGestores] = useState<GestorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'grupos' | 'gestores'>('grupos');

  useEffect(() => {
    carregarDados();
  }, []);

  const carregarDados = async () => {
    try {
      setLoading(true);

      // Carregar grupos Telegram
      const { data: gruposData, error: gruposErr } = await supabase
        .from('telegram_config')
        .select('*');
      if (gruposErr) throw gruposErr;
      setGrupos((gruposData ?? []).map((d: any) => ({ id: d.id ?? d.firebase_id, nome: d.nome, chatId: d.chat_id ?? d.chatId, tipo: d.tipo ?? 'geral', ativo: d.ativo ?? true, criadoEm: d.criado_em })) as GrupoTelegram[]);

      // Carregar gestores
      const gestoresData = await fetchUsuarios({ role_in: ['gestor', 'admin'] });
      setGestores(gestoresData.map(g => ({ ...g, id: g.uid })) as GestorInfo[]);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error(pick(T.toastErroLoad));
    } finally {
      setLoading(false);
    }
  };

  const toggleGrupoAtivo = async (grupoId: string, ativoAtual: boolean) => {
    try {
      const { error } = await supabase.from('telegram_config').update({ ativo: !ativoAtual }).eq('id', grupoId);
      if (error) throw error;
      setGrupos(
        grupos.map((g) => (g.id === grupoId ? { ...g, ativo: !g.ativo } : g))
      );
      toast.success(pick(T.toastGrupoOk));
    } catch (error) {
      console.error('Erro:', error);
      toast.error(pick(T.toastErroGrupo));
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{pick(T.title)}</h1>
          <p className="text-slate-400">{pick(T.subtitle)}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('grupos')}
            className={`px-4 py-2 font-semibold transition ${
              activeTab === 'grupos'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {pick(T.tabGrupos)}
          </button>
          <button
            onClick={() => setActiveTab('gestores')}
            className={`px-4 py-2 font-semibold transition ${
              activeTab === 'gestores'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {pick(T.tabGestores)}
          </button>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="text-center text-slate-400">{pick(T.loading)}</div>
        ) : (
          <>
            {/* Grupos Tab */}
            {activeTab === 'grupos' && (
              <div className="space-y-4">
                <div className="text-sm text-slate-400 mb-4">
                  {pick(T.totalGrupos).replace('{n}', String(grupos.length))}
                </div>
                {grupos.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    {pick(T.semGrupo)}
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {grupos.map((grupo) => (
                      <div
                        key={grupo.id}
                        className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-white font-semibold">
                              {grupo.nome}
                            </h3>
                            <p className="text-slate-400 text-sm mt-1">
                              {pick(T.labelId)}: {grupo.chatId}
                            </p>
                            <p className="text-slate-400 text-sm">
                              {pick(T.labelTipo)}: {grupo.tipo}
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              toggleGrupoAtivo(grupo.id, grupo.ativo)
                            }
                            className={`px-4 py-2 rounded font-semibold transition ${
                              grupo.ativo
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                            }`}
                          >
                            {grupo.ativo ? pick(T.ativo) : pick(T.inativo)}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Gestores Tab */}
            {activeTab === 'gestores' && (
              <div className="space-y-4">
                <div className="text-sm text-slate-400 mb-4">
                  {pick(T.totalGestores).replace('{n}', String(gestores.length))}
                </div>
                {gestores.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    {pick(T.semGestor)}
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {gestores.map((gestor) => (
                      <div
                        key={gestor.id}
                        className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-white font-semibold">
                              {gestor.nome}
                            </h3>
                            <p className="text-slate-400 text-sm mt-1">
                              {pick(T.labelEmail)}: {gestor.email}
                            </p>
                            <p className="text-slate-400 text-sm">
                              {pick(T.labelTelegramId)}: {gestor.telegramId}
                            </p>
                            {gestor.telegramUsername && (
                              <p className="text-slate-400 text-sm">
                                @{gestor.telegramUsername}
                              </p>
                            )}
                            {gestor.zona && (
                              <p className="text-slate-400 text-sm">
                                {pick(T.labelZona)}: {gestor.zona}
                              </p>
                            )}
                          </div>
                          <div
                            className={`px-4 py-2 rounded font-semibold ${
                              gestor.ativo
                                ? 'bg-green-600 text-white'
                                : 'bg-red-600 text-white'
                            }`}
                          >
                            {gestor.ativo ? pick(T.ativo) : pick(T.inativo)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>{pick(T.footer)}</p>
        </div>
      </div>
    </div>
  );
}
