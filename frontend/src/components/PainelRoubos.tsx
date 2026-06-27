// frontend/src/components/PainelRoubos.tsx — JET OS V2 — v2.0
// Dashboard estilo tabela por Região/Filial + lista de ocorrências clicável/editável
// Permissões: admin, gestor_seg podem editar

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, setDoc, updateDoc, serverTimestamp, limit,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { guardProviderSupabase, carregarOcorrenciasSupabase, guardWriteSupabase, atualizarOcorrenciaSupabase } from '../lib/ocorrencias-supabase';
import { analyticsProviderSupabase, fetchOcorrenciasRegional } from '../lib/analytics-supabase';
import L from 'leaflet';

// ─── i18n (pt/en/es/ru) — padrão TermosUsoGate/OnboardingWizard, sem chaves json ──
type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const TXT = {
  // Header principal
  tituloPainel:   { pt: 'Painel de Segurança',            en: 'Security Panel',               es: 'Panel de Seguridad',             ru: 'Панель безопасности' },
  ocorrencias:    { pt: 'ocorrências',                     en: 'incidents',                    es: 'incidencias',                    ru: 'инциденты' },
  carregando:     { pt: 'carregando...',                   en: 'loading...',                   es: 'cargando...',                    ru: 'загрузка...' },
  total:          { pt: 'total',                           en: 'total',                        es: 'total',                          ru: 'всего' },
  carregandoFull: { pt: 'Carregando...',                   en: 'Loading...',                   es: 'Cargando...',                    ru: 'Загрузка...' },

  // Períodos
  periodoInicio:  { pt: 'Desde o início',                  en: 'Since the start',              es: 'Desde el inicio',                ru: 'С самого начала' },
  periodo90:      { pt: '90 dias',                         en: '90 days',                      es: '90 días',                        ru: '90 дней' },
  periodo30:      { pt: '30 dias',                         en: '30 days',                      es: '30 días',                        ru: '30 дней' },
  periodo7:       { pt: '7 dias',                          en: '7 days',                       es: '7 días',                         ru: '7 дней' },
  desdeInicio:    { pt: 'desde o início',                  en: 'since the start',              es: 'desde el inicio',                ru: 'с начала' },
  ultimos:        { pt: 'últimos',                         en: 'last',                         es: 'últimos',                        ru: 'последние' },

  // Abas
  abaDashboard:   { pt: 'Dashboard',                       en: 'Dashboard',                    es: 'Panel',                          ru: 'Дашборд' },
  abaOcorrencias: { pt: 'Ocorrências',                     en: 'Incidents',                    es: 'Incidencias',                    ru: 'Инциденты' },
  abaConfig:      { pt: 'Configurações',                   en: 'Settings',                     es: 'Configuración',                  ru: 'Настройки' },

  // Filtros
  buscaPlaceholder:{ pt: '🔍 Ativo, local, guard...',      en: '🔍 Asset, location, guard...', es: '🔍 Activo, lugar, guard...',     ru: '🔍 Актив, место, охрана...' },
  todasCidades:   { pt: 'Todas as cidades',               en: 'All cities',                   es: 'Todas las ciudades',             ru: 'Все города' },
  todosTipos:     { pt: 'Todos os tipos',                  en: 'All types',                    es: 'Todos los tipos',                ru: 'Все типы' },
  todosStatus:    { pt: 'Todos os status',                 en: 'All statuses',                 es: 'Todos los estados',              ru: 'Все статусы' },
  resultados:     { pt: 'resultado(s)',                    en: 'result(s)',                    es: 'resultado(s)',                   ru: 'результат(ов)' },

  // Tipos de ocorrência
  tipoRoubo:      { pt: 'Roubo',                           en: 'Theft',                        es: 'Robo',                           ru: 'Кража' },
  tipoTentativa:  { pt: 'Tentativa',                       en: 'Attempt',                      es: 'Intento',                        ru: 'Попытка' },
  tipoVandalismo: { pt: 'Vandalismo',                      en: 'Vandalism',                    es: 'Vandalismo',                     ru: 'Вандализм' },
  tipoRecuperacao:{ pt: 'Recuperação',                     en: 'Recovery',                     es: 'Recuperación',                   ru: 'Возврат' },
  tipoOutro:      { pt: 'Outro',                           en: 'Other',                        es: 'Otro',                           ru: 'Другое' },

  // Status
  stAberto:       { pt: 'Aberto',                          en: 'Open',                         es: 'Abierto',                        ru: 'Открыт' },
  stApuracao:     { pt: 'Em apuração',                     en: 'Investigating',                es: 'En investigación',               ru: 'Расследуется' },
  stRecuperado:   { pt: 'Recuperado',                      en: 'Recovered',                    es: 'Recuperado',                     ru: 'Возвращён' },
  stEncerrado:    { pt: 'Encerrado',                       en: 'Closed',                       es: 'Cerrado',                        ru: 'Закрыт' },

  // KPIs dashboard
  kpiTotalGeral:  { pt: 'Total geral',                     en: 'Grand total',                  es: 'Total general',                  ru: 'Общий итог' },
  kpiPatinetes:   { pt: '🛴 Patinetes',                    en: '🛴 Scooters',                  es: '🛴 Patinetes',                   ru: '🛴 Самокаты' },
  kpiBicicletas:  { pt: '🚲 Bicicletas',                   en: '🚲 Bikes',                     es: '🚲 Bicicletas',                  ru: '🚲 Велосипеды' },
  kpiBaterias:    { pt: '🔋 Baterias',                     en: '🔋 Batteries',                 es: '🔋 Baterías',                    ru: '🔋 Батареи' },
  kpiRecuperados: { pt: '🟢 Recuperados',                  en: '🟢 Recovered',                 es: '🟢 Recuperados',                 ru: '🟢 Возвращено' },
  kpiTaxaRecup:   { pt: 'Taxa recup.',                     en: 'Recovery rate',                es: 'Tasa recup.',                    ru: 'Возврат, %' },

  // Tabela regional
  porRegiaoFilial:{ pt: 'Por Região / Filial',            en: 'By Region / Branch',           es: 'Por Región / Sucursal',          ru: 'По региону / филиалу' },
  sortRegiao:     { pt: 'Região',                          en: 'Region',                       es: 'Región',                         ru: 'Регион' },
  sortAZ:         { pt: 'A-Z',                             en: 'A-Z',                          es: 'A-Z',                            ru: 'А-Я' },
  sortTotal:      { pt: 'Total',                           en: 'Total',                        es: 'Total',                          ru: 'Всего' },
  colRegiao:      { pt: 'Região',                          en: 'Region',                       es: 'Región',                         ru: 'Регион' },
  colFilial:      { pt: 'Filial',                          en: 'Branch',                       es: 'Sucursal',                       ru: 'Филиал' },
  colPatinetes:   { pt: 'Patinetes furtados',             en: 'Scooters stolen',              es: 'Patinetes hurtados',             ru: 'Украдено самокатов' },
  colBicicletas:  { pt: 'Bicicletas furtadas',            en: 'Bikes stolen',                 es: 'Bicicletas hurtadas',            ru: 'Украдено велосипедов' },
  colBaterias:    { pt: 'Baterias furtadas',              en: 'Batteries stolen',             es: 'Baterías hurtadas',              ru: 'Украдено батарей' },
  colOutros:      { pt: 'Outros',                          en: 'Other',                        es: 'Otros',                          ru: 'Другое' },
  colTotal:       { pt: 'Total',                           en: 'Total',                        es: 'Total',                          ru: 'Всего' },
  colRecuperados: { pt: 'Recuperados',                     en: 'Recovered',                    es: 'Recuperados',                    ru: 'Возвращено' },
  colPeriodo:     { pt: 'Período',                         en: 'Period',                       es: 'Período',                        ru: 'Период' },
  semOcorrPeriodo:{ pt: 'Nenhuma ocorrência no período',  en: 'No incidents in this period',  es: 'Sin incidencias en el período',  ru: 'Нет инцидентов за период' },
  totalGeralRow:  { pt: 'TOTAL GERAL',                     en: 'GRAND TOTAL',                  es: 'TOTAL GENERAL',                  ru: 'ОБЩИЙ ИТОГ' },

  // Lista de ocorrências (cabeçalhos)
  colTipo:        { pt: 'Tipo',                            en: 'Type',                         es: 'Tipo',                           ru: 'Тип' },
  colStatus:      { pt: 'Status',                          en: 'Status',                       es: 'Estado',                         ru: 'Статус' },
  colAtivo:       { pt: 'Ativo',                           en: 'Asset',                        es: 'Activo',                         ru: 'Актив' },
  colLocalCidade: { pt: 'Local / Cidade',                  en: 'Location / City',              es: 'Lugar / Ciudad',                 ru: 'Место / Город' },
  colGuard:       { pt: 'Guard',                           en: 'Guard',                        es: 'Guard',                          ru: 'Guard' },
  colData:        { pt: 'Data',                            en: 'Date',                         es: 'Fecha',                          ru: 'Дата' },
  colAcoes:       { pt: 'Ações',                           en: 'Actions',                      es: 'Acciones',                       ru: 'Действия' },
  semOcorrEncontr:{ pt: 'Nenhuma ocorrência encontrada',  en: 'No incidents found',           es: 'No se encontraron incidencias',  ru: 'Инциденты не найдены' },

  // Modal editar
  campoTipo:      { pt: 'Tipo',                            en: 'Type',                         es: 'Tipo',                           ru: 'Тип' },
  campoAtivo:     { pt: 'Ativo',                           en: 'Asset',                        es: 'Activo',                         ru: 'Актив' },
  campoTipoAtivo: { pt: 'Tipo ativo',                      en: 'Asset type',                   es: 'Tipo de activo',                 ru: 'Тип актива' },
  campoLocal:     { pt: 'Local',                           en: 'Location',                     es: 'Lugar',                          ru: 'Место' },
  campoCidade:    { pt: 'Cidade',                          en: 'City',                         es: 'Ciudad',                         ru: 'Город' },
  campoGuard:     { pt: 'Guard',                           en: 'Guard',                        es: 'Guard',                          ru: 'Guard' },
  campoTurno:     { pt: 'Turno',                           en: 'Shift',                        es: 'Turno',                          ru: 'Смена' },
  campoBO:        { pt: 'BO',                              en: 'Police report',                es: 'Denuncia',                       ru: 'Заявление' },
  campoRegistrado:{ pt: 'Registrado',                      en: 'Recorded',                     es: 'Registrado',                     ru: 'Зарегистрировано' },
  procurando:     { pt: '🔍 PROCURANDO',                   en: '🔍 SEARCHING',                 es: '🔍 BUSCANDO',                    ru: '🔍 В РОЗЫСКЕ' },
  avaliacaoOficina:{ pt: '🔧 Avaliação da oficina',       en: '🔧 Workshop assessment',       es: '🔧 Evaluación del taller',       ru: '🔧 Оценка мастерской' },
  percDano:       { pt: '% DANO',                          en: '% DAMAGE',                     es: '% DAÑO',                         ru: '% УЩЕРБА' },
  valorRS:        { pt: 'VALOR R$',                        en: 'AMOUNT',                       es: 'VALOR',                          ru: 'СУММА' },
  labelStatus:    { pt: 'Status',                          en: 'Status',                       es: 'Estado',                         ru: 'Статус' },
  labelObs:       { pt: 'Observação',                      en: 'Notes',                        es: 'Observación',                    ru: 'Примечание' },
  obsPlaceholder: { pt: 'Desfecho, informações adicionais...', en: 'Outcome, additional information...', es: 'Desenlace, información adicional...', ru: 'Итог, дополнительная информация...' },
  salvando:       { pt: 'Salvando...',                     en: 'Saving...',                    es: 'Guardando...',                   ru: 'Сохранение...' },
  salvarAlteracoes:{ pt: '✓ Salvar alterações',           en: '✓ Save changes',               es: '✓ Guardar cambios',              ru: '✓ Сохранить изменения' },
  fotoAlt:        { pt: 'Foto',                            en: 'Photo',                        es: 'Foto',                           ru: 'Фото' },

  // Config de regiões
  regioesFiliais: { pt: '🗺 Regiões & Filiais',            en: '🗺 Regions & Branches',        es: '🗺 Regiones y Sucursales',       ru: '🗺 Регионы и филиалы' },
  configDesc1:    { pt: 'Define como cada cidade aparece no dashboard. Cidades não mapeadas → ', en: 'Defines how each city appears on the dashboard. Unmapped cities → ', es: 'Define cómo aparece cada ciudad en el panel. Ciudades no mapeadas → ', ru: 'Определяет, как каждый город отображается в дашборде. Несопоставленные города → ' },
  outras:         { pt: 'Outras',                          en: 'Others',                       es: 'Otras',                          ru: 'Прочие' },
  salvarTudo:     { pt: '💾 Salvar tudo',                  en: '💾 Save all',                  es: '💾 Guardar todo',                ru: '💾 Сохранить всё' },
  subPorFilial:   { pt: '🏙 Por Filial',                   en: '🏙 By Branch',                 es: '🏙 Por Sucursal',                ru: '🏙 По филиалу' },
  subPorCidade:   { pt: '🌆 Por Cidade',                   en: '🌆 By City',                   es: '🌆 Por Ciudad',                  ru: '🌆 По городу' },
  filtrarPlaceholder:{ pt: '🔍 Filtrar...',                en: '🔍 Filter...',                 es: '🔍 Filtrar...',                  ru: '🔍 Фильтр...' },
  novaFilial:     { pt: '+ Nova Filial',                   en: '+ New Branch',                 es: '+ Nueva Sucursal',               ru: '+ Новый филиал' },
  nomeFilial:     { pt: 'Nome da filial',                  en: 'Branch name',                  es: 'Nombre de la sucursal',          ru: 'Название филиала' },
  exFilial:       { pt: 'Ex: SP Litoral',                  en: 'e.g.: SP Coast',               es: 'Ej: SP Litoral',                 ru: 'Напр.: SP Litoral' },
  regiao:         { pt: 'Região',                          en: 'Region',                       es: 'Región',                         ru: 'Регион' },
  exRegiaoCentro: { pt: 'Ex: Região Centro',               en: 'e.g.: Central Region',         es: 'Ej: Región Centro',              ru: 'Напр.: Центральный регион' },
  btnFilial:      { pt: '+ Filial',                        en: '+ Branch',                     es: '+ Sucursal',                     ru: '+ Филиал' },
  nenhumaFilial:  { pt: 'Nenhuma filial configurada',     en: 'No branches configured',       es: 'Ninguna sucursal configurada',   ru: 'Филиалы не настроены' },
  addCidade:      { pt: '+ Adicionar cidade',              en: '+ Add city',                   es: '+ Añadir ciudad',                ru: '+ Добавить город' },
  cidadeExato:    { pt: 'Cidade (exato do Firestore)',     en: 'City (exact from Firestore)',  es: 'Ciudad (exacto de Firestore)',   ru: 'Город (точно как в Firestore)' },
  exRecife:       { pt: 'Ex: Recife',                      en: 'e.g.: Recife',                 es: 'Ej: Recife',                     ru: 'Напр.: Recife' },
  exRegiaoNorte:  { pt: 'Ex: Região Norte',               en: 'e.g.: North Region',           es: 'Ej: Región Norte',               ru: 'Напр.: Северный регион' },
  filialLabel:    { pt: 'Filial',                          en: 'Branch',                       es: 'Sucursal',                       ru: 'Филиал' },
  exFilialPE:     { pt: 'Ex: Pernambuco (Recife)',         en: 'e.g.: Pernambuco (Recife)',    es: 'Ej: Pernambuco (Recife)',        ru: 'Напр.: Pernambuco (Recife)' },
  btnCidade:      { pt: '+ Cidade',                        en: '+ City',                       es: '+ Ciudad',                       ru: '+ Город' },
  cCidade:        { pt: 'Cidade',                          en: 'City',                         es: 'Ciudad',                         ru: 'Город' },
  cRegiao:        { pt: 'Região',                          en: 'Region',                       es: 'Región',                         ru: 'Регион' },
  cFilial:        { pt: 'Filial',                          en: 'Branch',                       es: 'Sucursal',                       ru: 'Филиал' },
  nenhumaCidadeMap:{ pt: 'Nenhuma cidade mapeada',        en: 'No cities mapped',             es: 'Ninguna ciudad mapeada',         ru: 'Города не сопоставлены' },
  nCidades:       { pt: 'cidades',                         en: 'cities',                       es: 'ciudades',                       ru: 'городов' },
  semCidades:     { pt: 'Sem cidades — adicione abaixo',  en: 'No cities — add below',        es: 'Sin ciudades — añade abajo',     ru: 'Нет городов — добавьте ниже' },
  nomeCidadeExato:{ pt: 'Nome da cidade (exato do Firestore)', en: 'City name (exact from Firestore)', es: 'Nombre de la ciudad (exacto de Firestore)', ru: 'Название города (точно как в Firestore)' },

  // Mensagens config (validação / feedback)
  msgPreenchaCRF: { pt: 'Preencha cidade, região e filial', en: 'Fill in city, region and branch', es: 'Complete ciudad, región y sucursal', ru: 'Заполните город, регион и филиал' },
  msgCidadeExiste:{ pt: 'Cidade já cadastrada',           en: 'City already registered',      es: 'Ciudad ya registrada',           ru: 'Город уже добавлен' },
  msgPreenchaFR:  { pt: 'Preencha nome da filial e região', en: 'Fill in branch name and region', es: 'Complete nombre de sucursal y región', ru: 'Заполните название филиала и регион' },
  msgFilialExiste:{ pt: 'Filial já existe',               en: 'Branch already exists',        es: 'La sucursal ya existe',          ru: 'Филиал уже существует' },
  msgSalvas:      { pt: '✅ Configurações salvas!',        en: '✅ Settings saved!',           es: '✅ ¡Configuración guardada!',    ru: '✅ Настройки сохранены!' },

  // FilialCard
  placeholderRegiao:{ pt: 'Região',                       en: 'Region',                       es: 'Región',                         ru: 'Регион' },
  confirmRemoverFilial:{ pt: 'Remover filial "{f}" e todas as suas {n} cidades?',
                         en: 'Remove branch "{f}" and all its {n} cities?',
                         es: '¿Eliminar la sucursal "{f}" y todas sus {n} ciudades?',
                         ru: 'Удалить филиал «{f}» и все его города ({n})?' },

  // Mapa popup (sem texto fixo além de tipo) — nenhum

  // CSV
  csvHeaders:     { pt: 'ID,Tipo,Status,Ativo,Tipo Ativo,Local,Cidade,Filial,Região,Registrado em,Guard,BO',
                    en: 'ID,Type,Status,Asset,Asset Type,Location,City,Branch,Region,Recorded at,Guard,Police report',
                    es: 'ID,Tipo,Estado,Activo,Tipo de Activo,Lugar,Ciudad,Sucursal,Región,Registrado en,Guard,Denuncia',
                    ru: 'ID,Тип,Статус,Актив,Тип актива,Место,Город,Филиал,Регион,Зарегистрировано,Guard,Заявление' },
} satisfies Record<string, Tr>;

// pick por idioma corrente
function makePick(language: string | undefined) {
  const lang = (((language || 'pt').slice(0, 2)) as Lang);
  return (o: Tr) => o[lang] ?? o.pt;
}

// Rótulos de TIPO (enum interno → texto traduzido). Chaves NÃO mudam.
const TIPO_LABEL: Record<string, Tr> = {
  Roubo:       TXT.tipoRoubo,
  Tentativa:   TXT.tipoTentativa,
  Vandalismo:  TXT.tipoVandalismo,
  Recuperacao: TXT.tipoRecuperacao,
  Outro:       TXT.tipoOutro,
};
// Rótulos de STATUS (enum interno → texto traduzido). Chaves NÃO mudam.
const STATUS_LABEL: Record<string, Tr> = {
  'Aberto':       TXT.stAberto,
  'Em apuração':  TXT.stApuracao,
  'Recuperado':   TXT.stRecuperado,
  'Encerrado':    TXT.stEncerrado,
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Ocorrencia {
  id: string;
  tipo: string;
  status?: string;
  prioridade?: string;
  descricao?: string;
  local?: string;
  endereco_inicial?: string;
  bairro_inicial?: string;
  cidade_inicial?: string;
  filial?: string;
  lat_inicial?: number;
  lng_inicial?: number;
  criadoEm?: any;
  registradoPorNome?: string;
  asset_id?: string;
  ativo_tipo?: string;
  bikeIdentifier?: string;
  recuperado?: boolean;
  foto1_url?: string;
  foto2_url?: string;
  bo_numero?: string;
  bo_url?: string;
  procurando?: string;
  observacao_fechamento?: string;
  turno?: string;
  danoPct?: number;
  danoValor?: number;
}

interface RegionalRow {
  regiao: string;
  filial: string;
  patinetes: number;
  bicicletas: number;
  baterias: number;
  outros: number;
  total: number;
  recuperados: number;
}

interface Props {
  visivel: boolean;
  onFechar: () => void;
  mapa?: L.Map | null;
  cidade?: string;
  roleUsuario?: string;
}

type Periodo = '7d' | '30d' | '90d' | 'todos';
type Aba = 'dashboard' | 'lista' | 'config';

// ─── Mapeamento Região/Filial ─────────────────────────────────────────────────
// Configurável via Firestore: guard_config/regioes → { cidades: Record<string, {regiao, filial}> }
// Fallback hardcoded abaixo — admin pode editar pelo painel de Config

const REGIAO_DEFAULT: Record<string, { regiao: string; filial: string }> = {
  'São Paulo':           { regiao: 'Região Centro',  filial: 'SP Capital' },
  'Santo André':         { regiao: 'Região Centro',  filial: 'SP Capital' },
  'Guarulhos':           { regiao: 'Região Centro',  filial: 'SP Capital' },
  'Campinas':            { regiao: 'Região Centro',  filial: 'SP Estado (Campinas)' },
  'Praia Grande':        { regiao: 'Região Centro',  filial: 'SP Litoral' },
  'Santos':              { regiao: 'Região Centro',  filial: 'SP Litoral' },
  'Recife':              { regiao: 'Região Norte',   filial: 'Pernambuco (Recife)' },
  'Fortaleza':           { regiao: 'Região Norte',   filial: 'Ceará (Fortaleza)' },
  'Salvador':            { regiao: 'Região Norte',   filial: 'Bahia (Salvador)' },
  'Belo Horizonte':      { regiao: 'Região Norte',   filial: 'Minas Gerais (BH)' },
  'Belém':               { regiao: 'Região Norte',   filial: 'Pará (Belém)' },
  'Natal':               { regiao: 'Região Norte',   filial: 'RG Norte (Natal)' },
  'Aracaju':             { regiao: 'Região Norte',   filial: 'Sergipe (Aracaju)' },
  'Vila Velha':          { regiao: 'Região Norte',   filial: 'Espírito Santo (Vila Velha)' },
  'Brasília':            { regiao: 'Região Sul',     filial: 'Distr. Fed. (Brasília)' },
  'Florianópolis':       { regiao: 'Região Sul',     filial: 'Santa Catarina' },
  'Joinville':           { regiao: 'Região Sul',     filial: 'Santa Catarina' },
  'Curitiba':            { regiao: 'Região Sul',     filial: 'Paraná (Curitiba)' },
  'Londrina':            { regiao: 'Região Sul',     filial: 'Paraná (Londrina)' },
  'Porto Alegre':        { regiao: 'Região Sul',     filial: 'RG Sul (Porto Alegre)' },
  'México':              { regiao: 'Internacional',  filial: 'México' },
  'Ciudad de México':    { regiao: 'Internacional',  filial: 'México' },
};

function getRegiao(o: Ocorrencia, cfg: typeof REGIAO_DEFAULT): { regiao: string; filial: string } {
  if (o.filial) return { regiao: 'Configurado', filial: o.filial };
  const cidade = o.cidade_inicial || '';
  return cfg[cidade] || { regiao: 'Outras', filial: cidade || 'Desconhecida' };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTs(ts: any, short = false): string {
  if (!ts) return '—';
  const d = ts?.toDate?.() ?? new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return short
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sanitizarFotoUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.includes('drive.google.com')) return null;
  if (url.includes('lh3.googleusercontent.com')) return null;
  return url;
}

function csvEscape(v: any): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function filtrarPorPeriodo(lista: Ocorrencia[], periodo: Periodo): Ocorrencia[] {
  if (periodo === 'todos') return lista;
  const ms = periodo === '7d' ? 7 * 86400000 : periodo === '30d' ? 30 * 86400000 : 90 * 86400000;
  const desde = new Date(Date.now() - ms);
  return lista.filter(o => {
    const d = o.criadoEm?.toDate?.() ?? new Date(0);
    return d >= desde;
  });
}

// ─── Design ───────────────────────────────────────────────────────────────────

const T = {
  bg: '#080d14', card: '#0d1521', card2: '#111827',
  bdr: 'rgba(255,255,255,.08)', bdr2: 'rgba(255,255,255,.04)',
  txt: '#e2e8f0', dim: '#64748b', dim2: '#94a3b8',
  blue: '#3b82f6', bluel: '#60a5fa',
  green: '#22c55e', red: '#ef4444', orange: '#f97316',
  yellow: '#eab308', purple: '#a78bfa',
};

const TIPO_COR: Record<string, string> = {
  Roubo:       '#ef4444',
  Tentativa:   '#f97316',
  Vandalismo:  '#eab308',
  Recuperacao: '#22c55e',
  Outro:       '#6b7280',
};
const TIPO_EMOJI: Record<string, string> = {
  Roubo: '🔴', Tentativa: '🟠', Vandalismo: '🟡', Recuperacao: '🟢', Outro: '⚪',
};
const STATUS_COR: Record<string, string> = {
  'Aberto': '#ef4444', 'Em apuração': '#f97316', 'Recuperado': '#22c55e', 'Encerrado': '#6b7280',
};

const S = {
  painel: {
    position: 'fixed' as const, inset: 0, zIndex: 3500, background: T.bg,
    display: 'flex', flexDirection: 'column' as const, fontFamily: "'Inter',-apple-system,sans-serif",
  },
  header: {
    background: T.card, backdropFilter: 'blur(12px)',
    borderBottom: `1px solid ${T.bdr}`, padding: '12px 18px',
    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' as const,
  },
  tabs: {
    background: T.card, borderBottom: `1px solid ${T.bdr}`,
    display: 'flex', flexShrink: 0,
  },
  tab: (a: boolean): React.CSSProperties => ({
    padding: '10px 20px', fontSize: 13, fontWeight: 600,
    color: a ? T.bluel : T.dim, background: 'none', border: 'none',
    borderBottom: `2px solid ${a ? T.bluel : 'transparent'}`,
    cursor: 'pointer', transition: 'all .15s',
  }),
  body: { flex: 1, overflowY: 'auto' as const, padding: 16, scrollbarWidth: 'thin' as const },
  th: {
    padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.5px',
    textTransform: 'uppercase' as const, color: T.dim, borderBottom: `1px solid ${T.bdr}`,
    textAlign: 'left' as const, whiteSpace: 'nowrap' as const, background: T.card,
    position: 'sticky' as const, top: 0, zIndex: 1,
  },
  td: { padding: '9px 12px', fontSize: 12, borderBottom: `1px solid ${T.bdr2}`, color: T.txt },
  tdNum: { padding: '9px 12px', fontSize: 13, fontWeight: 700, borderBottom: `1px solid ${T.bdr2}`, textAlign: 'center' as const },
  chip: (c: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 20,
    background: c + '18', color: c, fontSize: 10, fontWeight: 700, border: `1px solid ${c}33`,
  }),
  btn: (c = T.blue, ghost = false): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 8, border: ghost ? `1px solid ${T.bdr}` : 'none',
    background: ghost ? 'transparent' : c, color: ghost ? T.dim2 : '#fff',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  }),
  inp: {
    padding: '7px 10px', borderRadius: 8, fontSize: 12,
    background: 'rgba(255,255,255,.06)', border: `1px solid ${T.bdr}`,
    color: T.txt, outline: 'none',
  },
  modal: {
    position: 'fixed' as const, inset: 0, zIndex: 4000,
    background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  mCard: {
    background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14,
    width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' as const,
  },
};

// ─── Modal editar ocorrência ──────────────────────────────────────────────────

function ModalEditar({
  ocorrencia, onFechar, onSalvo, podeEditar,
}: {
  ocorrencia: Ocorrencia;
  onFechar: () => void;
  onSalvo: () => void;
  podeEditar: boolean;
}) {
  const [status,   setStatus  ] = useState(ocorrencia.status || 'Aberto');
  const [obs,      setObs     ] = useState(ocorrencia.observacao_fechamento || '');
  const [danoPct,  setDanoPct ] = useState<string>(String(ocorrencia.danoPct ?? ''));
  const [danoValor,setDanoValor] = useState<string>(String(ocorrencia.danoValor ?? ''));
  const [salvando, setSalvando] = useState(false);
  const isVandal = ocorrencia.tipo === 'Vandalismo';
  const { i18n } = useTranslation();
  const pick = makePick(i18n.language);
  const tipoLabel = (t: string) => (TIPO_LABEL[t] ? pick(TIPO_LABEL[t]) : t);
  const statusLabel = (s: string) => (STATUS_LABEL[s] ? pick(STATUS_LABEL[s]) : s);

  const salvar = async () => {
    setSalvando(true);
    try {
      await updateDoc(doc(db, 'ocorrencias', ocorrencia.id), {
        status, observacao_fechamento: obs,
        ...(isVandal && {
          danoPct:   danoPct.trim()   !== '' ? Number(danoPct)                       : null,
          danoValor: danoValor.trim() !== '' ? Number(danoValor.replace(',', '.'))   : null,
        }),
        atualizadoEm: serverTimestamp(),
      });
      if (guardWriteSupabase()) atualizarOcorrenciaSupabase(ocorrencia.id, { status, observacao_fechamento: obs }).catch(err => console.error('[guard-write] update Supabase:', err));
      onSalvo();
      onFechar();
    } catch (e) {
      console.error(e);
    } finally {
      setSalvando(false);
    }
  };

  const campos: [string, string][] = [
    [pick(TXT.campoTipo),       (TIPO_EMOJI[ocorrencia.tipo] || '') + ' ' + tipoLabel(ocorrencia.tipo)],
    [pick(TXT.campoAtivo),      ocorrencia.asset_id || ocorrencia.bikeIdentifier || '—'],
    [pick(TXT.campoTipoAtivo),  ocorrencia.ativo_tipo || '—'],
    [pick(TXT.campoLocal),      ocorrencia.endereco_inicial || ocorrencia.local || '—'],
    [pick(TXT.campoCidade),     ocorrencia.cidade_inicial || '—'],
    [pick(TXT.campoGuard),      ocorrencia.registradoPorNome || '—'],
    [pick(TXT.campoTurno),      ocorrencia.turno || '—'],
    [pick(TXT.campoBO),         ocorrencia.bo_numero || '—'],
    [pick(TXT.campoRegistrado), fmtTs(ocorrencia.criadoEm)],
  ];

  const foto1 = sanitizarFotoUrl(ocorrencia.foto1_url);
  const foto2 = sanitizarFotoUrl(ocorrencia.foto2_url);

  return (
    <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={S.mCard}>
        {/* Header modal */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.bdr}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          position: 'sticky', top: 0, background: T.card, zIndex: 1 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.txt }}>
              {TIPO_EMOJI[ocorrencia.tipo]} {tipoLabel(ocorrencia.tipo)}
            </div>
            <div style={{ fontSize: 11, color: T.dim }}>{ocorrencia.id}</div>
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Fotos */}
          {(foto1 || foto2) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[foto1, foto2].map((url, i) => url ? (
                <a key={i} href={url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                  <img src={url} alt={`${pick(TXT.fotoAlt)} ${i+1}`}
                    style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.bdr}` }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </a>
              ) : null)}
            </div>
          )}

          {/* Campos */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
            {campos.map(([k, v]) => (
              <div key={k} style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: T.dim, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, color: T.txt, fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Procurando */}
          {ocorrencia.procurando && (
            <div style={{ background: 'rgba(249,115,22,.08)', border: `1px solid rgba(249,115,22,.2)`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: T.orange, fontWeight: 700, marginBottom: 4 }}>{pick(TXT.procurando)}</div>
              <div style={{ fontSize: 12, color: T.txt }}>{ocorrencia.procurando}</div>
            </div>
          )}

          {/* Descrição */}
          {ocorrencia.descricao && (
            <div style={{ fontSize: 12, color: T.dim2, marginBottom: 14, lineHeight: 1.6,
              background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '10px 12px' }}>
              {ocorrencia.descricao}
            </div>
          )}

          {/* Avaliação da oficina — só Vandalismo */}
          {podeEditar && isVandal && (
            <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 10,
              background: 'rgba(234,179,8,.05)', border: '1px solid rgba(234,179,8,.2)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24',
                textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10 }}>
                {pick(TXT.avaliacaoOficina)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600, marginBottom: 4 }}>{pick(TXT.percDano)}</div>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="0" max="100" step="1"
                      value={danoPct} onChange={e => setDanoPct(e.target.value)}
                      placeholder="0"
                      style={{ ...S.inp, width: '100%', boxSizing: 'border-box' as const,
                        borderColor: 'rgba(234,179,8,.25)', paddingRight: 28 }} />
                    <span style={{ position: 'absolute', right: 10, top: '50%',
                      transform: 'translateY(-50%)', color: T.dim, fontSize: 12,
                      pointerEvents: 'none' as const }}>%</span>
                  </div>
                  {danoPct && !isNaN(Number(danoPct)) && (
                    <div style={{ marginTop: 4, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 2 }}>
                      <div style={{ height: 4, borderRadius: 2, transition: 'width .3s',
                        width: `${Math.min(100, Number(danoPct))}%`,
                        background: Number(danoPct) >= 75 ? '#ef4444'
                          : Number(danoPct) >= 40 ? '#f97316' : '#fbbf24' }} />
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600, marginBottom: 4 }}>{pick(TXT.valorRS)}</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%',
                      transform: 'translateY(-50%)', color: T.dim, fontSize: 12,
                      pointerEvents: 'none' as const }}>R$</span>
                    <input type="number" min="0" step="0.01"
                      value={danoValor} onChange={e => setDanoValor(e.target.value)}
                      placeholder="0,00"
                      style={{ ...S.inp, width: '100%', boxSizing: 'border-box' as const,
                        borderColor: 'rgba(234,179,8,.25)', paddingLeft: 30 }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Editar status */}
          {podeEditar && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{pick(TXT.labelStatus)}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {(['Aberto','Em apuração','Recuperado','Encerrado'] as const).map(s => (
                  <button key={s} onClick={() => setStatus(s)}
                    style={{ ...S.btn(STATUS_COR[s] || T.blue, status !== s), padding: '6px 12px', fontSize: 11 }}>
                    {statusLabel(s)}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{pick(TXT.labelObs)}</div>
              <textarea value={obs} onChange={e => setObs(e.target.value)}
                placeholder={pick(TXT.obsPlaceholder)}
                style={{ ...S.inp, width: '100%', height: 80, resize: 'vertical',
                  boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />

              <button onClick={salvar} disabled={salvando}
                style={{ ...S.btn(), width: '100%', padding: '10px' }}>
                {salvando ? pick(TXT.salvando) : pick(TXT.salvarAlteracoes)}
              </button>
            </>
          )}

          {/* Só visualização */}
          {!podeEditar && ocorrencia.status && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={S.chip(STATUS_COR[ocorrencia.status] || T.dim)}>{statusLabel(ocorrencia.status)}</span>
              {ocorrencia.observacao_fechamento && (
                <span style={{ fontSize: 11, color: T.dim2 }}>{ocorrencia.observacao_fechamento}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Config de Regiões ────────────────────────────────────────────────────────

function ConfigRegioes({
  regiaoMap,
  onSalvo,
}: {
  regiaoMap: typeof REGIAO_DEFAULT;
  onSalvo: (novo: typeof REGIAO_DEFAULT) => void;
}) {
  type Linha = { cidade: string; regiao: string; filial: string };
  type SubAba = 'cidades' | 'filiais';

  const { i18n } = useTranslation();
  const pick = makePick(i18n.language);

  const [subAba,    setSubAba   ] = useState<SubAba>('filiais');
  const [linhas,    setLinhas   ] = useState<Linha[]>(() =>
    Object.entries(regiaoMap).map(([cidade, v]) => ({ cidade, regiao: v.regiao, filial: v.filial }))
  );
  const [busca,     setBusca    ] = useState('');

  // Sincroniza quando regiaoMap carrega do Firestore após montagem
  useEffect(() => {
    setLinhas(Object.entries(regiaoMap).map(([cidade, v]) => ({ cidade, regiao: v.regiao, filial: v.filial })));
  }, [regiaoMap]);
  const [salvando,  setSalvando ] = useState(false);
  const [msg,       setMsg      ] = useState('');

  // ── Add cidade ─────────────────────────────────────────────────────
  const [novaCidade, setNovaCidade] = useState('');
  const [novaRegiao, setNovaRegiao] = useState('');
  const [novaFilial, setNovaFilial] = useState('');

  // ── Add filial ─────────────────────────────────────────────────────
  const [novaFilialNome,   setNovaFilialNome  ] = useState('');
  const [novaFilialRegiao, setNovaFilialRegiao] = useState('');
  const [editFilial,       setEditFilial      ] = useState<string | null>(null); // filial em edição
  const [editFilialNome,   setEditFilialNome  ] = useState('');
  const [editFilialRegiao, setEditFilialRegiao] = useState('');

  // Regiões e filiais únicas
  const regioes = [...new Set(linhas.map(l => l.regiao).filter(Boolean))].sort();
  const filiais  = [...new Set(linhas.map(l => l.filial).filter(Boolean))].sort();

  // Agrupa por filial → { filial: { regiao, cidades[] } }
  const porFilial = useMemo(() => {
    const m: Record<string, { regiao: string; cidades: string[] }> = {};
    linhas.forEach(l => {
      if (!l.filial) return;
      if (!m[l.filial]) m[l.filial] = { regiao: l.regiao, cidades: [] };
      m[l.filial].cidades.push(l.cidade);
    });
    return m;
  }, [linhas]);

  // Filtro
  const linhasFilt = linhas.filter(l =>
    !busca ||
    l.cidade.toLowerCase().includes(busca.toLowerCase()) ||
    l.regiao.toLowerCase().includes(busca.toLowerCase()) ||
    l.filial.toLowerCase().includes(busca.toLowerCase())
  );
  const filiaisFilt = Object.entries(porFilial).filter(([f, v]) =>
    !busca ||
    f.toLowerCase().includes(busca.toLowerCase()) ||
    v.regiao.toLowerCase().includes(busca.toLowerCase()) ||
    v.cidades.some(c => c.toLowerCase().includes(busca.toLowerCase()))
  );

  // ── Editar inline ────────────────────────────────────────────────────
  const atualizarLinha = (idx: number, campo: 'regiao' | 'filial', valor: string) => {
    setLinhas(prev => { const n = [...prev]; n[idx] = { ...n[idx], [campo]: valor }; return n; });
  };

  // ── Adicionar cidade ─────────────────────────────────────────────────
  const adicionarCidade = () => {
    if (!novaCidade.trim() || !novaRegiao.trim() || !novaFilial.trim()) {
      setMsg(pick(TXT.msgPreenchaCRF)); return;
    }
    if (linhas.find(l => l.cidade === novaCidade.trim())) {
      setMsg(pick(TXT.msgCidadeExiste)); return;
    }
    setLinhas(prev => [...prev, { cidade: novaCidade.trim(), regiao: novaRegiao.trim(), filial: novaFilial.trim() }]);
    setNovaCidade(''); setNovaRegiao(''); setNovaFilial(''); setMsg('');
  };

  // ── Adicionar filial (sem cidades ainda) ─────────────────────────────
  const adicionarFilial = () => {
    if (!novaFilialNome.trim() || !novaFilialRegiao.trim()) {
      setMsg(pick(TXT.msgPreenchaFR)); return;
    }
    if (porFilial[novaFilialNome.trim()]) {
      setMsg(pick(TXT.msgFilialExiste)); return;
    }
    // Cria uma entrada placeholder — usuário adiciona cidades depois
    setLinhas(prev => [...prev, { cidade: `(${novaFilialNome.trim()})`, regiao: novaFilialRegiao.trim(), filial: novaFilialNome.trim() }]);
    setNovaFilialNome(''); setNovaFilialRegiao(''); setMsg('');
  };

  // ── Renomear filial ───────────────────────────────────────────────────
  const salvarEditFilial = () => {
    if (!editFilialNome.trim() || !editFilialRegiao.trim()) return;
    setLinhas(prev => prev.map(l =>
      l.filial === editFilial
        ? { ...l, filial: editFilialNome.trim(), regiao: editFilialRegiao.trim() }
        : l
    ));
    setEditFilial(null);
  };

  // ── Adicionar cidade a filial existente ───────────────────────────────
  const adicionarCidadeAFilial = (filial: string, regiao: string, novaCidadeInput: string) => {
    const c = novaCidadeInput.trim();
    if (!c || linhas.find(l => l.cidade === c)) return false;
    setLinhas(prev => [...prev, { cidade: c, regiao, filial }]);
    return true;
  };

  // ── Remover cidade de filial ──────────────────────────────────────────
  const removerCidade = (cidade: string) => {
    setLinhas(prev => prev.filter(l => l.cidade !== cidade));
  };

  // ── Remover filial inteira ────────────────────────────────────────────
  const removerFilial = (filial: string) => {
    setLinhas(prev => prev.filter(l => l.filial !== filial));
  };

  // ── Salvar no Firestore ───────────────────────────────────────────────
  const salvar = async () => {
    setSalvando(true); setMsg('');
    try {
      const obj: Record<string, { regiao: string; filial: string }> = {};
      linhas.filter(l => l.cidade && !l.cidade.startsWith('(')).forEach(l => {
        obj[l.cidade] = { regiao: l.regiao, filial: l.filial };
      });
      await setDoc(doc(db, 'guard_config', 'regioes'), obj);
      onSalvo(obj as typeof REGIAO_DEFAULT);
      setMsg(pick(TXT.msgSalvas));
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally { setSalvando(false); }
  };

  const inp: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 7, fontSize: 12,
    background: 'rgba(255,255,255,.06)', border: `1px solid ${T.bdr}`,
    color: T.txt, outline: 'none', width: '100%', boxSizing: 'border-box',
  };
  const inpSm: React.CSSProperties = { ...inp, padding: '5px 7px', fontSize: 11 };

  return (
    <div>
      {/* Header + salvar */}
      <div style={{ background: T.card2, borderRadius: 12, border: `1px solid ${T.bdr}`,
        padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.txt }}>{pick(TXT.regioesFiliais)}</div>
          <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>
            {pick(TXT.configDesc1)}<b style={{color:T.dim2}}>{pick(TXT.outras)}</b>.
          </div>
        </div>
        <button onClick={salvar} disabled={salvando}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', flexShrink: 0,
            background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
            color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          {salvando ? pick(TXT.salvando) : pick(TXT.salvarTudo)}
        </button>
      </div>
      {msg && <div style={{ marginBottom: 10, fontSize: 12, padding: '8px 12px', borderRadius: 8,
        background: msg.startsWith('✅') ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
        color: msg.startsWith('✅') ? T.green : '#ef4444', border: `1px solid ${msg.startsWith('✅') ? T.green+'33' : '#ef444433'}` }}>
        {msg}
      </div>}

      {/* Sub-abas */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {([['filiais', pick(TXT.subPorFilial)],['cidades', pick(TXT.subPorCidade)]] as const).map(([k,l]) => (
          <button key={k} onClick={() => setSubAba(k as SubAba)}
            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', background: subAba === k ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.06)',
              color: subAba === k ? T.bluel : T.dim,
              boxShadow: subAba === k ? `0 0 0 1px rgba(59,130,246,.4)` : `0 0 0 1px ${T.bdr}` }}>
            {l}
          </button>
        ))}
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder={pick(TXT.filtrarPlaceholder)} style={{ ...inpSm, width: 160, marginLeft: 'auto' }} />
      </div>

      {/* ── VISÃO POR FILIAL ─────────────────────────────────────── */}
      {subAba === 'filiais' && (
        <div>
          {/* Adicionar filial */}
          <div style={{ background: T.card2, borderRadius: 10, border: `1px solid ${T.bdr}`,
            padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, textTransform: 'uppercase',
              letterSpacing: '1px', marginBottom: 8 }}>{pick(TXT.novaFilial)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <div style={{ fontSize: 10, color: T.dim, marginBottom: 3 }}>{pick(TXT.nomeFilial)}</div>
                <input value={novaFilialNome} onChange={e => setNovaFilialNome(e.target.value)}
                  placeholder={pick(TXT.exFilial)} style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.dim, marginBottom: 3 }}>{pick(TXT.regiao)}</div>
                <input value={novaFilialRegiao} onChange={e => setNovaFilialRegiao(e.target.value)}
                  placeholder={pick(TXT.exRegiaoCentro)} list="regioes-list" style={inp} />
                <datalist id="regioes-list">{regioes.map(r => <option key={r} value={r} />)}</datalist>
              </div>
              <button onClick={adicionarFilial}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', whiteSpace: 'nowrap',
                  background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {pick(TXT.btnFilial)}
              </button>
            </div>
          </div>

          {/* Cards de filiais */}
          {filiaisFilt.length === 0 && (
            <div style={{ color: T.dim, textAlign: 'center', padding: 40, fontSize: 12 }}>
              {pick(TXT.nenhumaFilial)}
            </div>
          )}
          {filiaisFilt.map(([filial, data]) => (
            <FilialCard key={filial}
              filial={filial} regiao={data.regiao} cidades={data.cidades}
              regioes={regioes}
              onRenomear={(novoNome, novaReg) => {
                setLinhas(prev => prev.map(l =>
                  l.filial === filial ? { ...l, filial: novoNome, regiao: novaReg } : l
                ));
              }}
              onAdicionarCidade={(cidade) => adicionarCidadeAFilial(filial, data.regiao, cidade)}
              onRemoverCidade={removerCidade}
              onRemoverFilial={() => removerFilial(filial)}
            />
          ))}
        </div>
      )}

      {/* ── VISÃO POR CIDADE ─────────────────────────────────────── */}
      {subAba === 'cidades' && (
        <div>
          {/* Adicionar cidade */}
          <div style={{ background: T.card2, borderRadius: 10, border: `1px solid ${T.bdr}`,
            padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.dim, textTransform: 'uppercase',
              letterSpacing: '1px', marginBottom: 8 }}>{pick(TXT.addCidade)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <div style={{ fontSize: 10, color: T.dim, marginBottom: 3 }}>{pick(TXT.cidadeExato)}</div>
                <input value={novaCidade} onChange={e => setNovaCidade(e.target.value)}
                  placeholder={pick(TXT.exRecife)} style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.dim, marginBottom: 3 }}>{pick(TXT.regiao)}</div>
                <input value={novaRegiao} onChange={e => setNovaRegiao(e.target.value)}
                  placeholder={pick(TXT.exRegiaoNorte)} list="regioes-list2" style={inp} />
                <datalist id="regioes-list2">{regioes.map(r => <option key={r} value={r} />)}</datalist>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.dim, marginBottom: 3 }}>{pick(TXT.filialLabel)}</div>
                <input value={novaFilial} onChange={e => setNovaFilial(e.target.value)}
                  placeholder={pick(TXT.exFilialPE)} list="filiais-list" style={inp} />
                <datalist id="filiais-list">{filiais.map(f => <option key={f} value={f} />)}</datalist>
              </div>
              <button onClick={adicionarCidade}
                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', whiteSpace: 'nowrap',
                  background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {pick(TXT.btnCidade)}
              </button>
            </div>
          </div>

          <div style={{ background: T.card2, borderRadius: 10, border: `1px solid ${T.bdr}`, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[pick(TXT.cCidade), pick(TXT.cRegiao), pick(TXT.cFilial), ''].map(h => (
                      <th key={h} style={{ ...S.th, position: 'sticky', top: 0 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhasFilt.filter(l => !l.cidade.startsWith('(')).length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', padding: 30, color: T.dim }}>
                      {pick(TXT.nenhumaCidadeMap)}
                    </td></tr>
                  )}
                  {linhasFilt.filter(l => !l.cidade.startsWith('(')).map((l) => {
                    const realIdx = linhas.indexOf(l);
                    return (
                      <tr key={l.cidade}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{l.cidade}</td>
                        <td style={S.td}>
                          <input value={l.regiao} onChange={e => atualizarLinha(realIdx, 'regiao', e.target.value)}
                            list="regioes-list2" style={{ ...inpSm }} />
                        </td>
                        <td style={S.td}>
                          <input value={l.filial} onChange={e => atualizarLinha(realIdx, 'filial', e.target.value)}
                            list="filiais-list" style={{ ...inpSm }} />
                        </td>
                        <td style={{ ...S.td, textAlign: 'center' }}>
                          <button onClick={() => removerCidade(l.cidade)}
                            style={{ background: 'none', border: `1px solid rgba(239,68,68,.3)`,
                              borderRadius: 6, color: '#ef4444', cursor: 'pointer', padding: '3px 8px', fontSize: 11 }}>
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FilialCard — card expansível por filial ──────────────────────────────────

function FilialCard({
  filial, regiao, cidades, regioes,
  onRenomear, onAdicionarCidade, onRemoverCidade, onRemoverFilial,
}: {
  filial: string; regiao: string; cidades: string[]; regioes: string[];
  onRenomear: (nome: string, regiao: string) => void;
  onAdicionarCidade: (cidade: string) => boolean;
  onRemoverCidade: (cidade: string) => void;
  onRemoverFilial: () => void;
}) {
  const { i18n } = useTranslation();
  const pick = makePick(i18n.language);
  const [expandido,   setExpandido  ] = useState(false);
  const [editando,    setEditando   ] = useState(false);
  const [nomeEdit,    setNomeEdit   ] = useState(filial);
  const [regiaoEdit,  setRegiaoEdit ] = useState(regiao);
  const [novaCidade,  setNovaCidade ] = useState('');

  const inp: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 7, fontSize: 12,
    background: 'rgba(255,255,255,.06)', border: `1px solid rgba(59,130,246,.3)`,
    color: '#e2e8f0', outline: 'none', flex: 1,
  };

  return (
    <div style={{ background: T.card2, borderRadius: 10, border: `1px solid ${T.bdr}`,
      marginBottom: 8, overflow: 'hidden' }}>
      {/* Header do card */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        onClick={() => setExpandido(v => !v)}>
        <span style={{ fontSize: 14, transition: 'transform .2s',
          transform: expandido ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
        {editando ? (
          <div style={{ display: 'flex', gap: 8, flex: 1 }} onClick={e => e.stopPropagation()}>
            <input value={nomeEdit} onChange={e => setNomeEdit(e.target.value)}
              placeholder={pick(TXT.nomeFilial)} style={inp} />
            <input value={regiaoEdit} onChange={e => setRegiaoEdit(e.target.value)}
              placeholder={pick(TXT.placeholderRegiao)} list="regioes-list" style={{ ...inp, flex: 0.8 }} />
            <button onClick={() => { onRenomear(nomeEdit, regiaoEdit); setEditando(false); }}
              style={{ padding: '5px 10px', borderRadius: 7, border: 'none',
                background: T.green, color: '#fff', fontSize: 11, cursor: 'pointer' }}>✓</button>
            <button onClick={() => setEditando(false)}
              style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${T.bdr}`,
                background: 'transparent', color: T.dim, fontSize: 11, cursor: 'pointer' }}>✕</button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{filial}</span>
              <span style={{ fontSize: 11, color: T.dim, marginLeft: 8 }}>{regiao}</span>
            </div>
            <span style={{ fontSize: 11, color: T.dim, background: 'rgba(255,255,255,.06)',
              borderRadius: 20, padding: '2px 8px' }}>{cidades.length} {pick(TXT.nCidades)}</span>
            <button onClick={e => { e.stopPropagation(); setEditando(true); setNomeEdit(filial); setRegiaoEdit(regiao); }}
              style={{ background: 'none', border: `1px solid ${T.bdr}`, borderRadius: 6,
                color: T.dim, cursor: 'pointer', padding: '3px 7px', fontSize: 11 }}>✏</button>
            <button onClick={e => { e.stopPropagation(); if (cidades.length === 0 || window.confirm(pick(TXT.confirmRemoverFilial).replace('{f}', filial).replace('{n}', String(cidades.length)))) onRemoverFilial(); }}
              style={{ background: 'none', border: '1px solid rgba(239,68,68,.3)',
                borderRadius: 6, color: '#ef4444', cursor: 'pointer', padding: '3px 7px', fontSize: 11 }}>🗑</button>
          </>
        )}
      </div>

      {/* Cidades expandidas */}
      {expandido && (
        <div style={{ borderTop: `1px solid ${T.bdr}`, padding: '10px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {cidades.map(c => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(255,255,255,.06)', borderRadius: 20, padding: '4px 10px',
                fontSize: 12, color: '#e2e8f0' }}>
                {c}
                <button onClick={() => onRemoverCidade(c)}
                  style={{ background: 'none', border: 'none', color: '#ef4444',
                    cursor: 'pointer', fontSize: 12, padding: '0 0 0 4px', lineHeight: 1 }}>×</button>
              </div>
            ))}
            {cidades.length === 0 && <span style={{ fontSize: 11, color: T.dim }}>{pick(TXT.semCidades)}</span>}
          </div>
          {/* Adicionar cidade */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={novaCidade} onChange={e => setNovaCidade(e.target.value)}
              placeholder={pick(TXT.nomeCidadeExato)}
              onKeyDown={e => { if (e.key === 'Enter') { if(onAdicionarCidade(novaCidade)) setNovaCidade(''); } }}
              style={{ ...inp, flex: 1 }} />
            <button onClick={() => { if(onAdicionarCidade(novaCidade)) setNovaCidade(''); }}
              style={{ padding: '5px 12px', borderRadius: 7, border: 'none',
                background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
                color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {pick(TXT.btnCidade)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PainelRoubos({ visivel, onFechar, mapa, cidade, roleUsuario = 'viewer' }: Props) {
  const [ocorrencias,  setOcorrencias ] = useState<Ocorrencia[]>([]);
  const [periodo,      setPeriodo     ] = useState<Periodo>('todos');
  const [aba,          setAba         ] = useState<Aba>('dashboard');
  const [busca,        setBusca       ] = useState('');
  const [tipoFiltro,   setTipoFiltro  ] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [cidadeFiltro, setCidadeFiltro] = useState(cidade || '');
  const [selecionada,  setSelecionada ] = useState<Ocorrencia | null>(null);
  const [loading,      setLoading     ] = useState(true);
  const [regiaoMap,    setRegiaoMap   ] = useState<typeof REGIAO_DEFAULT>(REGIAO_DEFAULT);
  const [sortDash,     setSortDash    ] = useState<'total'|'regiao'|'filial'>('regiao');
  const layerRef = React.useRef<L.LayerGroup | null>(null);

  const { i18n } = useTranslation();
  const pick = makePick(i18n.language);
  const tipoLabel = (t: string) => (TIPO_LABEL[t] ? pick(TIPO_LABEL[t]) : t);
  const statusLabel = (s: string) => (STATUS_LABEL[s] ? pick(STATUS_LABEL[s]) : s);

  const podeEditar = ['admin','gestor','supergestor','gestor_seg'].includes(roleUsuario);

  // Carregar config de regiões do Firestore
  useEffect(() => {
    getDoc(doc(db, 'guard_config', 'regioes')).then(d => {
      if (d.exists()) {
        const data = d.data() as Record<string, { regiao: string; filial: string }>;
        setRegiaoMap({ ...REGIAO_DEFAULT, ...data });
      }
    }).catch(() => {});
  }, [visivel]);

  // Carregar ocorrências — sem filtro de tipo (mostra tudo, filtramos no cliente)
  useEffect(() => {
    if (!visivel) return;
    setLoading(true);
    // Fase 2 / Onda B — leitura do Supabase atrás de flag (read-only).
    if (guardProviderSupabase()) {
      let vivo = true;
      carregarOcorrenciasSupabase({ cidade: cidade || undefined, limit: 2000 })
        .then(rows => { if (vivo) { setOcorrencias(rows as Ocorrencia[]); setLoading(false); } })
        .catch(err => { console.error('[roubos] leitura Supabase falhou:', err); if (vivo) setLoading(false); });
      return () => { vivo = false; };
    }
    const q = cidade
      ? query(collection(db, 'ocorrencias'), where('cidade_inicial', '==', cidade), orderBy('criadoEm', 'desc'), limit(2000))
      : query(collection(db, 'ocorrencias'), orderBy('criadoEm', 'desc'), limit(2000));

    const unsub = onSnapshot(q, snap => {
      setOcorrencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ocorrencia)));
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [visivel, cidade]);

  // Markers no mapa
  useEffect(() => {
    if (!mapa) return;
    if (layerRef.current) { mapa.removeLayer(layerRef.current); layerRef.current = null; }
    if (!visivel) return;
    const layer = L.layerGroup().addTo(mapa);
    layerRef.current = layer;
    for (const o of filtradas) {
      if (!o.lat_inicial || !o.lng_inicial) continue;
      const cor = o.tipo === 'Recuperacao' ? T.green : TIPO_COR[o.tipo] || T.dim;
      L.circleMarker([o.lat_inicial, o.lng_inicial], {
        radius: 8, color: cor, fillColor: cor, fillOpacity: 0.6, weight: 2,
      }).bindPopup(`<b>${TIPO_EMOJI[o.tipo] || ''} ${tipoLabel(o.tipo)}</b><br>${o.asset_id || ''}<br>${o.cidade_inicial || ''}<br>${fmtTs(o.criadoEm, true)}`)
        .on('click', () => setSelecionada(o))
        .addTo(layer);
    }
    return () => { if (layerRef.current) { mapa.removeLayer(layerRef.current); layerRef.current = null; } };
  });

  // Filtros
  const filtradas = useMemo(() => {
    let lista = filtrarPorPeriodo(ocorrencias, periodo);
    if (cidadeFiltro) lista = lista.filter(o => (o.cidade_inicial || '').toLowerCase().includes(cidadeFiltro.toLowerCase()));
    if (tipoFiltro !== 'todos') lista = lista.filter(o => o.tipo === tipoFiltro);
    if (statusFiltro !== 'todos') lista = lista.filter(o => o.status === statusFiltro);
    if (busca) lista = lista.filter(o =>
      [o.asset_id, o.bikeIdentifier, o.descricao, o.cidade_inicial, o.registradoPorNome, o.endereco_inicial]
        .some(v => (v || '').toLowerCase().includes(busca.toLowerCase()))
    );
    return lista;
  }, [ocorrencias, periodo, cidadeFiltro, tipoFiltro, statusFiltro, busca]);

  // Dashboard — agrupa por região/filial
  const dashboardRows = useMemo((): RegionalRow[] => {
    const mapa: Record<string, RegionalRow> = {};
    for (const o of filtradas) {
      const { regiao, filial } = getRegiao(o, regiaoMap);
      const key = `${regiao}||${filial}`;
      if (!mapa[key]) mapa[key] = { regiao, filial, patinetes: 0, bicicletas: 0, baterias: 0, outros: 0, total: 0, recuperados: 0 };
      const r = mapa[key];
      const at = (o.ativo_tipo || '').toLowerCase();
      if (at.includes('patinete') || at.includes('scooter')) r.patinetes++;
      else if (at.includes('bicicleta') || at.includes('bike')) r.bicicletas++;
      else if (at.includes('bateria') || at.includes('battery')) r.baterias++;
      else r.outros++;
      if (o.tipo === 'Recuperacao' || o.recuperado) r.recuperados++;
      else r.total++;
    }
    const rows = Object.values(mapa);
    if (sortDash === 'total') return rows.sort((a, b) => b.total - a.total);
    if (sortDash === 'filial') return rows.sort((a, b) => a.filial.localeCompare(b.filial));
    return rows.sort((a, b) => a.regiao.localeCompare(b.regiao) || a.filial.localeCompare(b.filial));
  }, [filtradas, regiaoMap, sortDash]);

  // ── Migração #3: dashboard via RPC do Supabase (dual-run, flag VITE_ANALYTICS_PROVIDER) ──
  // A RPC retorna `total` = todas as ocorrências; o cliente usa `total` = não-recuperados.
  // Normalizamos (total - recuperados) para casar com a renderização existente.
  // Map/lista/CSV continuam no Firestore (`filtradas`). `busca` não filtra a tabela via RPC.
  const supabaseAnalytics = analyticsProviderSupabase();
  const [supaRows, setSupaRows] = useState<RegionalRow[]>([]);
  useEffect(() => {
    if (!visivel || !supabaseAnalytics) return;
    let alive = true;
    fetchOcorrenciasRegional({
      periodo,
      tipo: tipoFiltro !== 'todos' ? tipoFiltro : null,
      status: statusFiltro !== 'todos' ? statusFiltro : null,
      cidade: cidade || null,
    })
      .then(rows => { if (alive) setSupaRows(rows.map(r => ({ ...r, total: Math.max(0, r.total - r.recuperados) }))); })
      .catch(e => console.warn('[analytics] RPC Supabase falhou, mantendo cálculo do cliente:', e.message));
    return () => { alive = false; };
  }, [visivel, supabaseAnalytics, periodo, tipoFiltro, statusFiltro, cidade]);

  const rowsToShow = useMemo((): RegionalRow[] => {
    if (!(supabaseAnalytics && supaRows.length)) return dashboardRows;
    const rows = [...supaRows];
    if (sortDash === 'total') return rows.sort((a, b) => b.total - a.total);
    if (sortDash === 'filial') return rows.sort((a, b) => a.filial.localeCompare(b.filial));
    return rows.sort((a, b) => a.regiao.localeCompare(b.regiao) || a.filial.localeCompare(b.filial));
  }, [supabaseAnalytics, supaRows, dashboardRows, sortDash]);

  const totalGeral = rowsToShow.reduce((s, r) => s + r.total + r.recuperados, 0);
  const totalPatinetes = rowsToShow.reduce((s, r) => s + r.patinetes, 0);
  const totalBicicletas = rowsToShow.reduce((s, r) => s + r.bicicletas, 0);
  const totalBaterias = rowsToShow.reduce((s, r) => s + r.baterias, 0);
  const totalOutros = rowsToShow.reduce((s, r) => s + r.outros, 0);
  const totalRecup = rowsToShow.reduce((s, r) => s + r.recuperados, 0);

  // Export CSV
  const exportCSV = useCallback(() => {
    const h = pick(TXT.csvHeaders);
    const rows = filtradas.map(o => {
      const { regiao, filial } = getRegiao(o, regiaoMap);
      return [
        o.id, tipoLabel(o.tipo), o.status ? statusLabel(o.status) : '', o.asset_id || '', o.ativo_tipo || '',
        o.endereco_inicial || '', o.cidade_inicial || '', filial, regiao,
        fmtTs(o.criadoEm), o.registradoPorNome || '', o.bo_numero || '',
      ].map(csvEscape).join(',');
    });
    const csv = '\uFEFF' + [h, ...rows].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `roubos_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }, [filtradas, regiaoMap]);

  if (!visivel) return null;

  const periodos: { k: Periodo; l: string }[] = [
    { k: 'todos', l: pick(TXT.periodoInicio) },
    { k: '90d',   l: pick(TXT.periodo90)     },
    { k: '30d',   l: pick(TXT.periodo30)     },
    { k: '7d',    l: pick(TXT.periodo7)      },
  ];

  const cidades = [...new Set(ocorrencias.map(o => o.cidade_inicial).filter(Boolean))].sort();

  return (
    <div style={S.painel}>
      {/* Header */}
      <div style={S.header}>
        <button onClick={onFechar} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 20, padding: '0 4px' }}>✕</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.txt }}>🔴 {pick(TXT.tituloPainel)}</div>
          <div style={{ fontSize: 10, color: T.dim }}>
            {filtradas.length} {pick(TXT.ocorrencias)} · {loading ? pick(TXT.carregando) : `${ocorrencias.length} ${pick(TXT.total)}`}
          </div>
        </div>

        {/* Período */}
        <div style={{ display: 'flex', gap: 4 }}>
          {periodos.map(p => (
            <button key={p.k} onClick={() => setPeriodo(p.k)}
              style={{ ...S.btn(T.blue, periodo !== p.k), padding: '5px 10px', fontSize: 10,
                background: periodo === p.k ? 'rgba(59,130,246,.2)' : 'transparent',
                color: periodo === p.k ? T.bluel : T.dim,
                border: `1px solid ${periodo === p.k ? 'rgba(59,130,246,.4)' : T.bdr}` }}>
              {p.l}
            </button>
          ))}
        </div>

        <button onClick={exportCSV} style={{ ...S.btn('#374151'), fontSize: 11 }}>⬇ CSV</button>
      </div>

      {/* Abas */}
      <div style={S.tabs}>
        <button onClick={() => setAba('dashboard')} style={S.tab(aba === 'dashboard')}>📊 {pick(TXT.abaDashboard)}</button>
        <button onClick={() => setAba('lista')} style={S.tab(aba === 'lista')}>📋 {pick(TXT.abaOcorrencias)} ({filtradas.length})</button>
        {podeEditar && (
          <button onClick={() => setAba('config')} style={S.tab(aba === 'config')}>⚙️ {pick(TXT.abaConfig)}</button>
        )}
      </div>

      {/* Filtros comuns — oculto na aba config */}
      {aba !== 'config' && <div style={{ background: T.card, borderBottom: `1px solid ${T.bdr}`,
        padding: '8px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder={pick(TXT.buscaPlaceholder)}
          style={{ ...S.inp, width: 180, fontSize: 11 }} />
        <select value={cidadeFiltro} onChange={e => setCidadeFiltro(e.target.value)}
          style={{ ...S.inp, fontSize: 11 }}>
          <option value="">{pick(TXT.todasCidades)}</option>
          {cidades.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
          style={{ ...S.inp, fontSize: 11 }}>
          <option value="todos">{pick(TXT.todosTipos)}</option>
          {['Roubo','Tentativa','Vandalismo','Recuperacao','Outro'].map(t => (
            <option key={t} value={t}>{TIPO_EMOJI[t]} {tipoLabel(t)}</option>
          ))}
        </select>
        <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}
          style={{ ...S.inp, fontSize: 11 }}>
          <option value="todos">{pick(TXT.todosStatus)}</option>
          {['Aberto','Em apuração','Recuperado','Encerrado'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: T.dim }}>
          {filtradas.length} {pick(TXT.resultados)}
        </div>
      </div>}

      {/* Body com scroll */}
      <div style={S.body}>
        {loading ? (
          <div style={{ color: T.dim, textAlign: 'center', padding: 60 }}>{pick(TXT.carregandoFull)}</div>
        ) : aba === 'config' ? null : aba === 'dashboard' ? (

          /* ── DASHBOARD ──────────────────────────────────────────── */
          <div>
            {/* KPIs rápidos */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { l: pick(TXT.kpiTotalGeral),  v: totalGeral,      c: T.red    },
                { l: pick(TXT.kpiPatinetes),   v: totalPatinetes,  c: '#f97316' },
                { l: pick(TXT.kpiBicicletas),  v: totalBicicletas, c: '#eab308' },
                { l: pick(TXT.kpiBaterias),    v: totalBaterias,   c: '#a78bfa' },
                { l: pick(TXT.kpiRecuperados), v: totalRecup,      c: T.green  },
                { l: pick(TXT.kpiTaxaRecup),   v: totalGeral > 0 ? `${Math.round(totalRecup/(totalGeral)*100)}%` : '—', c: totalRecup > 0 ? T.green : T.dim },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ flex: 1, minWidth: 90, background: T.card2,
                  borderRadius: 10, padding: '12px 14px', border: `1px solid ${c}22`, borderTop: `2px solid ${c}` }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
                  <div style={{ fontSize: 10, color: T.dim, marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Tabela regional */}
            <div style={{ background: T.card2, borderRadius: 12, border: `1px solid ${T.bdr}`, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.bdr}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {pick(TXT.porRegiaoFilial)}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {([['regiao', pick(TXT.sortRegiao)],['filial', pick(TXT.sortAZ)],['total', pick(TXT.sortTotal)]] as const).map(([k,l]) => (
                    <button key={k} onClick={() => setSortDash(k as 'total'|'regiao'|'filial')}
                      style={{ ...S.btn(T.blue, sortDash !== k), padding: '3px 8px', fontSize: 10 }}>{l}</button>
                  ))}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {[pick(TXT.colRegiao), pick(TXT.colFilial), pick(TXT.colPatinetes), pick(TXT.colBicicletas), pick(TXT.colBaterias), pick(TXT.colOutros), pick(TXT.colTotal), pick(TXT.colRecuperados), pick(TXT.colPeriodo)].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsToShow.length === 0 && (
                      <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', padding: 40, color: T.dim }}>
                        {pick(TXT.semOcorrPeriodo)}
                      </td></tr>
                    )}
                    {rowsToShow.map((r, i) => (
                      <tr key={i} style={{ cursor: 'pointer' }}
                        onClick={() => { setAba('lista'); setCidadeFiltro(''); }}>
                        <td style={S.td}>
                          <span style={{ fontSize: 11, color: T.dim2 }}>{r.regiao}</span>
                        </td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{r.filial}</td>
                        <td style={{ ...S.tdNum, color: r.patinetes > 0 ? T.red : T.dim }}>{r.patinetes || 0}</td>
                        <td style={{ ...S.tdNum, color: r.bicicletas > 0 ? T.orange : T.dim }}>{r.bicicletas || 0}</td>
                        <td style={{ ...S.tdNum, color: r.baterias > 0 ? T.purple : T.dim }}>{r.baterias || 0}</td>
                        <td style={{ ...S.tdNum, color: r.outros > 0 ? T.dim2 : T.dim }}>{r.outros || 0}</td>
                        <td style={{ ...S.tdNum, color: T.txt, fontSize: 14 }}>{r.total + r.recuperados}</td>
                        <td style={{ ...S.tdNum, color: T.green }}>{r.recuperados || 0}</td>
                        <td style={{ ...S.td, fontSize: 11, color: T.dim }}>
                          {periodo === 'todos' ? pick(TXT.desdeInicio) : `${pick(TXT.ultimos)} ${periodo}`}
                        </td>
                      </tr>
                    ))}
                    {/* Total geral */}
                    {rowsToShow.length > 0 && (
                      <tr style={{ background: 'rgba(255,255,255,.03)' }}>
                        <td colSpan={2} style={{ ...S.td, fontWeight: 800, color: T.txt }}>{pick(TXT.totalGeralRow)}</td>
                        <td style={{ ...S.tdNum, fontWeight: 800, color: T.red }}>{totalPatinetes}</td>
                        <td style={{ ...S.tdNum, fontWeight: 800, color: T.orange }}>{totalBicicletas}</td>
                        <td style={{ ...S.tdNum, fontWeight: 800, color: T.purple }}>{totalBaterias}</td>
                        <td style={{ ...S.tdNum, fontWeight: 800 }}>{totalOutros}</td>
                        <td style={{ ...S.tdNum, fontWeight: 800, color: T.txt, fontSize: 15 }}>{totalGeral}</td>
                        <td style={{ ...S.tdNum, fontWeight: 800, color: T.green }}>{totalRecup}</td>
                        <td style={S.td}></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        ) : (

          /* ── LISTA ──────────────────────────────────────────────── */
          <div style={{ background: T.card2, borderRadius: 12, border: `1px solid ${T.bdr}`, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[pick(TXT.colTipo), pick(TXT.colStatus), pick(TXT.colAtivo), pick(TXT.colLocalCidade), pick(TXT.colGuard), pick(TXT.colData), pick(TXT.colAcoes)].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', padding: 40, color: T.dim }}>
                    {pick(TXT.semOcorrEncontr)}
                  </td></tr>
                )}
                {filtradas.map(o => {
                  const cor = TIPO_COR[o.tipo] || T.dim;
                  const foto = sanitizarFotoUrl(o.foto1_url);
                  return (
                    <tr key={o.id}
                      onClick={() => setSelecionada(o)}
                      style={{ cursor: 'pointer', transition: 'background .1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={S.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {foto && (
                            <img src={foto} alt=""
                              style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          )}
                          <div>
                            <span style={S.chip(cor)}>{TIPO_EMOJI[o.tipo]} {tipoLabel(o.tipo)}</span>
                            {o.procurando && <span style={{ ...S.chip(T.orange), marginLeft: 4 }}>🔍</span>}
                          </div>
                        </div>
                      </td>
                      <td style={S.td}>
                        {o.status && <span style={S.chip(STATUS_COR[o.status] || T.dim)}>{statusLabel(o.status)}</span>}
                      </td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>
                        {o.asset_id || o.bikeIdentifier || '—'}
                        {o.ativo_tipo && <div style={{ fontSize: 10, color: T.dim }}>{o.ativo_tipo}</div>}
                      </td>
                      <td style={{ ...S.td, maxWidth: 180 }}>
                        <div style={{ fontSize: 12, color: T.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.endereco_inicial || o.local || '—'}
                        </div>
                        <div style={{ fontSize: 10, color: T.dim }}>{o.cidade_inicial || ''}</div>
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: T.dim2 }}>{o.registradoPorNome || '—'}</td>
                      <td style={{ ...S.td, fontSize: 11, color: T.dim, fontFamily: 'monospace' }}>
                        {fmtTs(o.criadoEm, true)}
                      </td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={e => { e.stopPropagation(); setSelecionada(o); }}
                            style={{ ...S.btn(T.blue, true), padding: '3px 8px', fontSize: 11 }}>
                            {podeEditar ? '✏' : '👁'}
                          </button>
                          {o.lat_inicial && o.lng_inicial && mapa && (
                            <button onClick={e => { e.stopPropagation(); mapa.flyTo([o.lat_inicial!, o.lng_inicial!], 17); }}
                              style={{ ...S.btn('#374151', true), padding: '3px 8px', fontSize: 11 }}>
                              🗺
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        )}

        {/* ── CONFIG ──────────────────────────────────────────────── */}
        {aba === 'config' && podeEditar && (
          <ConfigRegioes
            regiaoMap={regiaoMap}
            onSalvo={novo => setRegiaoMap(novo)}
          />
        )}

      </div>

      {/* Modal editar */}
      {selecionada && (
        <ModalEditar
          ocorrencia={selecionada}
          onFechar={() => setSelecionada(null)}
          onSalvo={() => setSelecionada(null)}
          podeEditar={podeEditar}
        />
      )}
    </div>
  );
}
