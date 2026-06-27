// TelegramConfigPanel.tsx
// Painel visual de gestão da hierarquia Telegram — JET OS V2
// Mostra a hierarquia interativa + permite configurar grupos, tópicos e gestores inline
//
// Coleção Firestore: telegram_config/
//   doc "global"   → botToken, diretoria[], regionais[]
//   doc "cidades"  → { [cidade]: { grupos: {...}, gestores: [] } }

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usuariosReadSupabase, fetchUsuarios } from './lib/usuarios-supabase';
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

// ─── i18n (padrão TermosUsoGate: objeto T { pt, en, es, ru } + pick, sem json) ──

type Lang = 'pt' | 'en' | 'es' | 'ru';
type L = { pt: string; en: string; es: string; ru: string };

const T = {
  // Níveis (NIVEL_META)
  nivelDiretoria:     { pt: 'Diretoria',      en: 'Board',            es: 'Dirección',         ru: 'Руководство' },
  nivelRegional:      { pt: 'Ger. Regional',  en: 'Regional Mgr.',    es: 'Ger. Regional',     ru: 'Рег. менеджер' },
  nivelGerente:       { pt: 'Gerente',        en: 'Manager',          es: 'Gerente',           ru: 'Менеджер' },
  nivelLider:         { pt: 'Líder',          en: 'Lead',             es: 'Líder',             ru: 'Лидер' },
  escopoDiretoria:    { pt: 'Todas as cidades e alertas', en: 'All cities and alerts', es: 'Todas las ciudades y alertas', ru: 'Все города и оповещения' },
  escopoRegional:     { pt: 'Cidades da sua região',      en: 'Cities in your region', es: 'Ciudades de su región',        ru: 'Города вашего региона' },
  escopoGerente:      { pt: 'Cidade específica',          en: 'Specific city',         es: 'Ciudad específica',            ru: 'Конкретный город' },
  escopoLider:        { pt: 'Cargo na cidade',            en: 'Role in the city',      es: 'Cargo en la ciudad',           ru: 'Должность в городе' },

  // Grupos (GRUPOS_META)
  grupoLogistica:     { pt: 'Logística', en: 'Logistics', es: 'Logística', ru: 'Логистика' },
  grupoPromo:         { pt: 'Promo',     en: 'Promo',     es: 'Promo',     ru: 'Промо' },
  grupoSeguranca:     { pt: 'Segurança', en: 'Security',  es: 'Seguridad', ru: 'Охрана' },
  grupoGeral:         { pt: 'Geral',     en: 'General',   es: 'General',   ru: 'Общее' },

  // GrupoEditor
  chatIdLabel:        { pt: 'Chat ID do grupo',                 en: 'Group Chat ID',                  es: 'Chat ID del grupo',                ru: 'Chat ID группы' },
  nomeGrupoLabel:     { pt: 'Nome do grupo (referência)',       en: 'Group name (reference)',         es: 'Nombre del grupo (referencia)',    ru: 'Название группы (для справки)' },
  threadIdsTitulo:    { pt: 'Thread IDs dos tópicos (0 = tópico geral do grupo)', en: 'Topic thread IDs (0 = group general topic)', es: 'Thread IDs de los temas (0 = tema general del grupo)', ru: 'Thread ID тем (0 = общая тема группы)' },
  salvarGrupo:        { pt: 'Salvar grupo', en: 'Save group', es: 'Guardar grupo', ru: 'Сохранить группу' },
  testar:             { pt: 'Testar',       en: 'Test',       es: 'Probar',        ru: 'Тест' },
  enviando:           { pt: 'Enviando...',  en: 'Sending...', es: 'Enviando...',   ru: 'Отправка...' },
  msgEnviada:         { pt: 'Mensagem enviada!', en: 'Message sent!', es: '¡Mensaje enviado!', ru: 'Сообщение отправлено!' },
  fnIndisponivel:     { pt: 'Function não disponível em dev', en: 'Function not available in dev', es: 'Function no disponible en dev', ru: 'Function недоступна в dev' },
  erroPrefixo:        { pt: 'Erro: ',       en: 'Error: ',    es: 'Error: ',       ru: 'Ошибка: ' },
  erroDesconhecido:   { pt: 'desconhecido', en: 'unknown',    es: 'desconocido',   ru: 'неизвестно' },

  // GestoresEditor
  nenhumGestor:       { pt: 'Nenhum gestor configurado', en: 'No managers configured', es: 'Ningún gestor configurado', ru: 'Менеджеры не настроены' },
  buscarUsuario:      { pt: 'Buscar usuário para adicionar...', en: 'Search user to add...', es: 'Buscar usuario para añadir...', ru: 'Найти пользователя для добавления...' },

  // Sidebar
  visao:              { pt: 'Visão',        en: 'View',       es: 'Vista',         ru: 'Вид' },
  hierarquia:         { pt: 'Hierarquia',   en: 'Hierarchy',  es: 'Jerarquía',     ru: 'Иерархия' },
  configGlobal:       { pt: 'Config global', en: 'Global config', es: 'Config global', ru: 'Глобальная конфиг.' },
  configGlobalSub:    { pt: 'Bot token · Diretoria · Regionais', en: 'Bot token · Board · Regionals', es: 'Bot token · Dirección · Regionales', ru: 'Токен бота · Руководство · Региональные' },
  cidades:            { pt: 'Cidades',      en: 'Cities',     es: 'Ciudades',      ru: 'Города' },
  grupoConfigurado:   { pt: 'grupo configurado',  en: 'group configured',  es: 'grupo configurado',   ru: 'группа настроена' },
  gruposConfigurados: { pt: 'grupos configurados', en: 'groups configured', es: 'grupos configurados', ru: 'групп настроено' },
  semGrupos:          { pt: 'Sem grupos',   en: 'No groups',  es: 'Sin grupos',    ru: 'Нет групп' },

  // Hierarquia (render)
  hierarquiaTitulo:   { pt: 'Hierarquia de notificações', en: 'Notification hierarchy', es: 'Jerarquía de notificaciones', ru: 'Иерархия уведомлений' },
  diretoria:          { pt: 'Diretoria',    en: 'Board',      es: 'Dirección',     ru: 'Руководство' },
  membros:            { pt: 'membros',      en: 'members',    es: 'miembros',      ru: 'участников' },
  recebeTudo:         { pt: 'Recebe tudo',  en: 'Receives everything', es: 'Recibe todo', ru: 'Получает всё' },
  gerentesRegionais:  { pt: 'Gerentes regionais', en: 'Regional managers', es: 'Gerentes regionales', ru: 'Региональные менеджеры' },
  alertasRegiao:      { pt: 'Alertas da região', en: 'Region alerts', es: 'Alertas de la región', ru: 'Оповещения региона' },
  topicos:            { pt: 'tópicos',      en: 'topics',     es: 'temas',         ru: 'тем' },
  semGruposConfig:    { pt: 'Sem grupos configurados', en: 'No groups configured', es: 'Sin grupos configurados', ru: 'Группы не настроены' },
  gestores:           { pt: 'gestores',     en: 'managers',   es: 'gestores',      ru: 'менеджеров' },
  roteamentoTitulo:   { pt: 'Roteamento de eventos', en: 'Event routing', es: 'Enrutamiento de eventos', ru: 'Маршрутизация событий' },

  // Tabela de roteamento (eventos · destinos)
  evtSlotAceito:      { pt: 'Slot aceito',  en: 'Slot accepted', es: 'Slot aceptado', ru: 'Слот принят' },
  dstSlotAceito:      { pt: 'Tópico do cargo · Líder da cidade', en: 'Role topic · City lead', es: 'Tema del cargo · Líder de la ciudad', ru: 'Тема должности · Лидер города' },
  evtTarefaConcluida: { pt: 'Tarefa concluída', en: 'Task completed', es: 'Tarea completada', ru: 'Задача выполнена' },
  dstTarefaConcluida: { pt: 'Líder + Gerente da cidade', en: 'Lead + City manager', es: 'Líder + Gerente de la ciudad', ru: 'Лидер + Менеджер города' },
  evtTarefaRejeitada: { pt: 'Tarefa rejeitada', en: 'Task rejected', es: 'Tarea rechazada', ru: 'Задача отклонена' },
  dstTarefaRejeitada: { pt: 'Líder da cidade', en: 'City lead', es: 'Líder de la ciudad', ru: 'Лидер города' },
  evtRoubo:           { pt: 'Ocorrência roubo (procurando)', en: 'Theft incident (searching)', es: 'Incidente robo (buscando)', ru: 'Инцидент кражи (поиск)' },
  dstRoubo:           { pt: 'Tópico alertas · Ger. regional · Diretoria', en: 'Alerts topic · Regional mgr. · Board', es: 'Tema alertas · Ger. regional · Dirección', ru: 'Тема оповещений · Рег. менеджер · Руководство' },
  evtOcorrenciaNormal:{ pt: 'Ocorrência normal', en: 'Normal incident', es: 'Incidente normal', ru: 'Обычный инцидент' },
  dstOcorrenciaNormal:{ pt: 'Tópico do cargo na cidade', en: 'Role topic in the city', es: 'Tema del cargo en la ciudad', ru: 'Тема должности в городе' },
  evtCheckin:         { pt: 'Check-in / check-out', en: 'Check-in / check-out', es: 'Check-in / check-out', ru: 'Чек-ин / чек-аут' },
  dstCheckin:         { pt: 'Líder da cidade', en: 'City lead', es: 'Líder de la ciudad', ru: 'Лидер города' },
  evtSemAtividade:    { pt: 'Operador sem atividade 30min', en: 'Operator idle 30min', es: 'Operador sin actividad 30min', ru: 'Оператор без активности 30 мин' },
  dstSemAtividade:    { pt: 'Líder + Gerente (alerta)', en: 'Lead + Manager (alert)', es: 'Líder + Gerente (alerta)', ru: 'Лидер + Менеджер (оповещение)' },

  // Global
  configGlobalTitulo: { pt: 'Configuração global', en: 'Global configuration', es: 'Configuración global', ru: 'Глобальная конфигурация' },
  botTokenLabel:      { pt: 'Token do bot Telegram', en: 'Telegram bot token', es: 'Token del bot de Telegram', ru: 'Токен бота Telegram' },
  botTokenAjuda:      { pt: 'Obtenha em @BotFather no Telegram', en: 'Get it from @BotFather on Telegram', es: 'Obténgalo en @BotFather en Telegram', ru: 'Получите у @BotFather в Telegram' },
  botUsernameLabel:   { pt: 'Username do bot (ex: @jet_os_bot)', en: 'Bot username (e.g. @jet_os_bot)', es: 'Username del bot (ej: @jet_os_bot)', ru: 'Username бота (напр.: @jet_os_bot)' },
  botUsernameAjuda:   { pt: 'Usado no link de vinculação dos operadores', en: 'Used in the operator linking link', es: 'Usado en el enlace de vinculación de los operadores', ru: 'Используется в ссылке привязки операторов' },
  relatoriosLabel:    { pt: 'Chat ID para relatórios Guard', en: 'Chat ID for Guard reports', es: 'Chat ID para informes Guard', ru: 'Chat ID для отчётов Guard' },
  relatoriosPlaceholder: { pt: '-100123456789 (vazio = usa primeiro grupo configurado)', en: '-100123456789 (empty = uses first configured group)', es: '-100123456789 (vacío = usa el primer grupo configurado)', ru: '-100123456789 (пусто = первая настроенная группа)' },
  relatoriosAjuda:    { pt: 'Grupo exclusivo para receber os relatórios diários e semanais do Guard. Deixe vazio para usar o tópico de alertas da primeira cidade configurada.', en: 'Dedicated group to receive the daily and weekly Guard reports. Leave empty to use the alerts topic of the first configured city.', es: 'Grupo exclusivo para recibir los informes diarios y semanales de Guard. Deje vacío para usar el tema de alertas de la primera ciudad configurada.', ru: 'Отдельная группа для получения ежедневных и еженедельных отчётов Guard. Оставьте пустым, чтобы использовать тему оповещений первого настроенного города.' },
  salvando:           { pt: '⏳ Salvando...', en: '⏳ Saving...', es: '⏳ Guardando...', ru: '⏳ Сохранение...' },
  salvarConfigGlobal: { pt: '💾 Salvar config global', en: '💾 Save global config', es: '💾 Guardar config global', ru: '💾 Сохранить глоб. конфиг.' },

  // Cidade
  gruposTelegram:     { pt: 'Grupos Telegram', en: 'Telegram groups', es: 'Grupos de Telegram', ru: 'Группы Telegram' },
  gestoresLideres:    { pt: 'Gestores e líderes da cidade', en: 'City managers and leads', es: 'Gestores y líderes de la ciudad', ru: 'Менеджеры и лидеры города' },

  // Header / loading / save status
  headerTitulo:       { pt: 'Telegram — Grupos & Hierarquia', en: 'Telegram — Groups & Hierarchy', es: 'Telegram — Grupos y Jerarquía', ru: 'Telegram — Группы и иерархия' },
  headerSub:          { pt: 'Configure grupos, tópicos e gestores por nível e cidade', en: 'Configure groups, topics and managers by level and city', es: 'Configure grupos, temas y gestores por nivel y ciudad', ru: 'Настройте группы, темы и менеджеров по уровню и городу' },
  salvandoHeader:     { pt: '⏳ Salvando...', en: '⏳ Saving...', es: '⏳ Guardando...', ru: '⏳ Сохранение...' },
  carregando:         { pt: '⏳ Carregando configuração...', en: '⏳ Loading configuration...', es: '⏳ Cargando configuración...', ru: '⏳ Загрузка конфигурации...' },
  salvo:              { pt: 'Salvo!',     en: 'Saved!',     es: '¡Guardado!',    ru: 'Сохранено!' },
} as const;

function usePick() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;
  return pick;
}

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

// Rótulos traduzíveis dos níveis e grupos (logica/cores/enums permanecem nas METAs acima)
const NIVEL_LABEL: Record<string, L> = {
  diretoria: T.nivelDiretoria,
  regional:  T.nivelRegional,
  gerente:   T.nivelGerente,
  lider:     T.nivelLider,
};
const NIVEL_ESCOPO: Record<string, L> = {
  diretoria: T.escopoDiretoria,
  regional:  T.escopoRegional,
  gerente:   T.escopoGerente,
  lider:     T.escopoLider,
};
const GRUPO_LABEL: Record<CargoGrupo, L> = {
  logistica: T.grupoLogistica,
  promo:     T.grupoPromo,
  seguranca: T.grupoSeguranca,
  geral:     T.grupoGeral,
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
  const pick = usePick();
  return (
    <div style={S.card(cor, ativo)} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, color: cor, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {NIVEL_LABEL[nivel] ? pick(NIVEL_LABEL[nivel]) : (NIVEL_META[nivel]?.l ?? nivel)}
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
  const pick = usePick();
  const meta = GRUPOS_META[tipoGrupo];
  const metaLabel = pick(GRUPO_LABEL[tipoGrupo]);
  const [chatId, setChatId] = useState(grupo?.chatId ?? '');
  const [nome, setNome] = useState(grupo?.nome ?? '');
  const [topicos, setTopicos] = useState<TopicosGrupo>(grupo?.topicos ?? {});
  const [testando, setTestando] = useState(false);
  const [testeMsg, setTesteMsg] = useState('');
  const [testeErro, setTesteErro] = useState(false);

  const setTopico = (k: string, v: string) => {
    setTopicos(prev => ({ ...prev, [k]: v ? parseInt(v) : undefined }));
  };

  const salvar = () => {
    if (!chatId.trim()) return;
    onChange({ chatId: chatId.trim(), nome: nome.trim() || metaLabel, topicos });
  };

  const testarBot = async () => {
    if (!chatId.trim()) return;
    setTestando(true);
    setTesteMsg('');
    setTesteErro(false);
    try {
      const fn = (window as any).__jetCallFunction;
      if (fn) {
        await fn('testarTelegram', { chatId, topicId: topicos.alertas ?? null });
        setTesteMsg(pick(T.msgEnviada));
      } else {
        setTesteMsg(pick(T.fnIndisponivel));
      }
    } catch (e: any) {
      setTesteErro(true);
      setTesteMsg(pick(T.erroPrefixo) + (e.message ?? pick(T.erroDesconhecido)));
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
        <span style={S.badge(meta.cor)}>{metaLabel}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
          {meta.cargos.join(' · ')} · {cidadeKey}
        </span>
      </div>

      <div style={S.grid2}>
        <div>
          <label style={S.lbl}>{pick(T.chatIdLabel)}</label>
          <input style={S.inp} value={chatId} onChange={e => setChatId(e.target.value)}
            placeholder="-100123456789" />
        </div>
        <div>
          <label style={S.lbl}>{pick(T.nomeGrupoLabel)}</label>
          <input style={S.inp} value={nome} onChange={e => setNome(e.target.value)}
            placeholder={`JET OS ${metaLabel} - ${cidadeKey}`} />
        </div>
      </div>

      <div style={{ ...S.sep, margin: '12px 0' }} />
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {pick(T.threadIdsTitulo)}
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
        <button style={S.btn(meta.cor)} onClick={salvar}>{pick(T.salvarGrupo)}</button>
        <button style={S.btn(meta.cor, true)} onClick={testarBot} disabled={testando}>
          {testando ? pick(T.enviando) : pick(T.testar)}
        </button>
        {testeMsg && (
          <span style={{ fontSize: 11, color: testeErro ? '#ef4444' : '#10b981' }}>
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
  const pick = usePick();
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);

  const buscarUsuarios = async (termo: string) => {
    if (termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    try {
      let todos: any[];
      if (usuariosReadSupabase()) {
        todos = await fetchUsuarios({ role_in: ['admin', 'gestor'] });
      } else {
        const snap = await getDocs(query(
          collection(db, 'usuarios'),
          where('role', 'in', ['admin', 'gestor'])
        ));
        todos = snap.docs.map(d => ({ uid: d.id, ...d.data() })) as any[];
      }
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
        <span style={S.badge(cor)}>{NIVEL_LABEL[nivel] ? pick(NIVEL_LABEL[nivel]) : NIVEL_META[nivel]?.l}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
          {NIVEL_ESCOPO[nivel] ? pick(NIVEL_ESCOPO[nivel]) : NIVEL_META[nivel]?.escopo}
        </span>
      </div>

      {/* Lista atual */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 10 }}>
        {gestores.length === 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.25)' }}>{pick(T.nenhumGestor)}</span>
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
          placeholder={pick(T.buscarUsuario)} />
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
  const pick = usePick();
  const [view, setView] = useState<ViewState>({ tipo: 'hierarquia' });
  const [global, setGlobal] = useState<ConfigGlobal>({
    botToken: '', diretoria: [], regionais: [],
  });
  const [cidadesConfig, setCidadesConfig] = useState<Record<string, CidadeConfig>>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvoMsg, setSalvoMsg] = useState('');
  const [salvoErro, setSalvoErro] = useState(false);

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
      setSalvoErro(false);
      setSalvoMsg(pick(T.salvo));
      setTimeout(() => setSalvoMsg(''), 2000);
    } catch (e: any) {
      setSalvoErro(true);
      setSalvoMsg(pick(T.erroPrefixo) + e.message);
    } finally {
      setSalvando(false);
    }
  }, [global, pick]);

  // ── Save cidade ──
  const salvarCidade = useCallback(async (cidadeKey: string, config: CidadeConfig) => {
    setSalvando(true);
    try {
      const novas = { ...cidadesConfig, [cidadeKey]: config };
      await setDoc(doc(db, 'telegram_config', 'cidades'), novas);
      setCidadesConfig(novas);
      setSalvoErro(false);
      setSalvoMsg(pick(T.salvo));
      setTimeout(() => setSalvoMsg(''), 2000);
    } catch (e: any) {
      setSalvoErro(true);
      setSalvoMsg(pick(T.erroPrefixo) + e.message);
    } finally {
      setSalvando(false);
    }
  }, [cidadesConfig, pick]);

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
        {pick(T.visao)}
      </div>

      <HierarquiaNode
        nivel="diretoria" nome={pick(T.hierarquia)} cor="#a78bfa"
        ativo={view.tipo === 'hierarquia'}
        onClick={() => setView({ tipo: 'hierarquia' })}
      />

      <HierarquiaNode
        nivel="regional" nome={pick(T.configGlobal)} cor="#7c3aed"
        sub={pick(T.configGlobalSub)}
        ativo={view.tipo === 'global'}
        onClick={() => setView({ tipo: 'global' })}
        count={global.diretoria.length + global.regionais.length}
      />

      <div style={{ ...S.sep, margin: '10px 0' }} />
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        {pick(T.cidades)}
      </div>

      {CIDADES_BR.map(cidade => {
        const chave = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toLowerCase();
        const gc = gruposConfigurados(chave);
        const ativo = view.tipo === 'cidade' && view.cidade === chave;
        return (
          <HierarquiaNode
            key={chave}
            nivel="gerente" nome={cidade} cor="#1D9E75"
            sub={gc > 0 ? `${gc} ${gc > 1 ? pick(T.gruposConfigurados) : pick(T.grupoConfigurado)}` : pick(T.semGrupos)}
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
        {pick(T.hierarquiaTitulo)}
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
            👑 {pick(T.diretoria)}
            <span style={S.badge('#a78bfa')}>{global.diretoria.length} {pick(T.membros)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{pick(T.recebeTudo)}</span>
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
            🗺 {pick(T.gerentesRegionais)}
            <span style={S.badge('#7c3aed')}>{global.regionais.length} {pick(T.membros)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{pick(T.alertasRegiao)}</span>
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
                    {pick(GRUPO_LABEL[tipo as CargoGrupo])}: {Object.keys(g.topicos).length} {pick(T.topicos)}
                  </div>
                ))}
                {!temGrupos && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.2)' }}>{pick(T.semGruposConfig)}</div>
                )}
                {cfg.gestores.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <span style={S.badge('#1D9E75')}>{cfg.gestores.length} {pick(T.gestores)}</span>
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
        {pick(T.roteamentoTitulo)}
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', lineHeight: 2 }}>
        {[
          [T.evtSlotAceito,        T.dstSlotAceito],
          [T.evtTarefaConcluida,   T.dstTarefaConcluida],
          [T.evtTarefaRejeitada,   T.dstTarefaRejeitada],
          [T.evtRoubo,             T.dstRoubo],
          [T.evtOcorrenciaNormal,  T.dstOcorrenciaNormal],
          [T.evtCheckin,           T.dstCheckin],
          [T.evtSemAtividade,      T.dstSemAtividade],
        ].map(([evento, destino], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
            <span style={{ color: '#dce8ff' }}>{pick(evento)}</span>
            <span>{pick(destino)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderGlobal = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#a78bfa', marginBottom: 20 }}>
        {pick(T.configGlobalTitulo)}
      </div>

      {/* Bot token */}
      <div style={{ marginBottom: 20 }}>
        <label style={S.lbl}>{pick(T.botTokenLabel)}</label>
        <input
          style={{ ...S.inp, fontFamily: 'monospace' }}
          type="password"
          value={global.botToken}
          onChange={e => setGlobal(prev => ({ ...prev, botToken: e.target.value }))}
          placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
        />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          {pick(T.botTokenAjuda)}
        </div>
      </div>

      {/* Username do bot */}
      <div style={{ marginBottom: 20 }}>
        <label style={S.lbl}>{pick(T.botUsernameLabel)}</label>
        <input
          style={S.inp}
          value={global.botUsername ?? ''}
          onChange={e => setGlobal(prev => ({ ...prev, botUsername: e.target.value.trim() }))}
          placeholder="@jet_os_bot"
        />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          {pick(T.botUsernameAjuda)}
        </div>
      </div>

      {/* Chat ID relatórios Guard */}
      <div style={{ marginBottom: 20 }}>
        <label style={S.lbl}>{pick(T.relatoriosLabel)}</label>
        <input
          style={S.inp}
          value={global.relatoriosChatId ?? ''}
          onChange={e => setGlobal(prev => ({ ...prev, relatoriosChatId: e.target.value.trim() }))}
          placeholder={pick(T.relatoriosPlaceholder)}
        />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
          {pick(T.relatoriosAjuda)}
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
          {salvando ? pick(T.salvando) : pick(T.salvarConfigGlobal)}
        </button>
        {salvoMsg && (
          <span style={{ fontSize: 12, color: salvoErro ? '#ef4444' : '#10b981' }}>
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
            <span style={{ fontSize: 12, color: salvoErro ? '#ef4444' : '#10b981' }}>
              {salvoMsg}
            </span>
          )}
        </div>

        {/* Grupos por tipo */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 12 }}>
          {pick(T.gruposTelegram)}
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
          {pick(T.gestoresLideres)}
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
              {pick(T.headerTitulo)}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
              {pick(T.headerSub)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {salvando && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{pick(T.salvandoHeader)}</span>}
            {salvoMsg && <span style={{ fontSize: 11, color: salvoErro ? '#ef4444' : '#10b981' }}>{salvoMsg}</span>}
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
                {pick(T.carregando)}
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
