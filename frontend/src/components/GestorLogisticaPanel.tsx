// frontend/src/components/GestorLogisticaPanel.tsx — JET OS V2 — v3.0
// Controle de cidade: gestor vê só sua cidade; supergestor/admin escolhem via dropdown
// Abas: Dashboard | Presença | Operadores | Slots | Tarefas | Desempenho | MEIs | CLT | Inventário | Telegram | Config

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SkeletonTable, SkeletonPulseStyle } from './ui/Skeleton';
import { useTranslation } from 'react-i18next';
import { fetchUsuarios } from '../lib/usuarios-supabase';
import {
  fetchCidadesEstacoes,
  fetchTarefas, subscribeTarefas, updateTarefa,
  fetchGpsLogistica, subscribeGpsLogistica, fetchGpsHist as fetchGpsHistSupa,
  fetchSlotsLogistica, subscribeSlots as subscribeSlotsGestor, criarSlot, deleteSlot,
  fetchAceites, subscribeAceites, updateAceiteStatus,
  fetchMeis, subscribeMeis, upsertMei, deleteMei,
  fetchEficiencias, subscribeEficiencias, criarEficiencia,
  fetchAlertas, subscribeAlertas,
  fetchConfigLogistica, salvarConfigLogistica,
  fetchTelegramGrupos, salvarTelegramGrupo,
  fetchInventario, subscribeInventario, upsertInventario, deleteInventario,
  fetchGojetConfig, fetchGojetSnapInfo, salvarGojetConfig,
  upsertUsuario, deleteUsuario,
} from '../lib/gestor-logistica-supabase';
import { carregarTurnosLogisticaSupabase } from '../lib/onda-b-supabase';
import LiveTrackingMap from './LiveTrackingMap';
import { confirmDialog } from './ui/ConfirmDialog';
import GpsHeatmapPanel from './GpsHeatmapPanel';
import PrestadorStatusPanel from './PrestadorStatusPanel';
import CommandCenter from './CommandCenter';
import CalendarioOpsEspeciais from './CalendarioOpsEspeciais';
import ExportPanel from './ExportPanel';
import ComparativoCidades from './ComparativoCidades';
import { supabase } from '../lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Usuario {
  uid: string; nome: string; email: string; role: string;
  cidadesGerenciaLog?: string[];
}
interface Props {
  usuario: Usuario; onFechar: () => void; cidade?: string;
}
type AbaId = 'dashboard'|'command_center'|'comparativo'|'presenca'|'operadores'|'slots'|'tarefas'|'desempenho'|'meis'|'clt'|'inventario'|'telegram'|'config'|'gojet_config'|'alertas'|'rastreamento'|'heatmap'|'calendario'|'exportar';

interface Funcionario {
  id?: string; nome: string; cpf: string; cargo: string; turno: string;
  funcao: string; zona: string; status: string; gerente: string; lider: string;
  telefone: string; dataAdmissao: string; escala: string; diaFolga: string;
}
interface MEI {
  id?: string; nome: string; cpf: string; cnpj: string; status: string;
  cidade?: string; suspensoInicio?: string; suspensoAte?: string; motivoSuspensao?: string;
  criadoEm?: any;
}
interface Slot {
  id: string; turno: string; turnoLabel: string; horaIni: string; horaFim: string;
  zona: string; qtdPessoas: number; tipo: string; status: string; dataSlot: string;
  criadoEm?: any; cidade?: string; confirmacaoMin?: number; reaberturaSemConfMin?: number;
}
interface SlotAceite { id: string; slotId: string; nome: string; cnpj: string; status: string; aceitoEm?: any; }
interface TarefaLogistica {
  id: string; tipo: string; status: string; titulo?: string; descricao?: string;
  lat?: number; lng?: number; endereco?: string; responsavelId?: string;
  responsavelNome?: string; prioridade?: number; cidade?: string; criadoEm?: any; atualizadoEm?: any;
}
interface GpsWorker {
  uid: string; nome?: string; lat: number; lng: number; atualizadoEm?: any; cidade?: string;
}
interface TurnoLog {
  id?: string; uid: string; nome: string; acao: 'inicio'|'fim'; fotoUrl?: string; criadoEm?: any;
}
interface Eficiencia {
  id?: string; uid: string; nome: string; data: string; cidade: string;
  movimentacoes: number; baterias: number; obs?: string; criadoEm?: any;
}
interface Inventario {
  id?: string; tipo: 'armario'|'patinete'|'carro'|'suporte';
  nome: string; identificador?: string; zona?: string; status: string; observacao?: string;
}
interface ConfigGlobal {
  slaMinutos: number; raioSugestaoKm: number; alertaZeroGoJet: boolean;
  thresholdBatBaixa: number; confirmacaoMin: number; reaberturaSemConfMin: number;
  prazoHoras: Record<string, number>; // TarefaKind → horas (0 = sem prazo auto)
}
interface TelegramGrupo {
  chatId: string; nome: string; cidade: string;
  topicos: Record<string,number>; // cargo → threadId
  tipos: string[]; // quais cargos recebem
}
interface ClimaPrev { temp: number; descricao: string; emoji: string; chuva: boolean; }

// ─── i18n (padrão TermosUsoGate: objeto {pt,en,es,ru}, sem chaves json) ─────────

type Lang = 'pt' | 'en' | 'es' | 'ru';
type L = { pt: string; en: string; es: string; ru: string };

// Cada subcomponente chama useT() localmente para obter pick().
function useT() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;
  // "há X min" / "X min ago" / "hace X min" / "X мин назад"
  const haMin = (min: number) =>
    lang === 'pt' ? `há ${min}min`
    : lang === 'es' ? `hace ${min}min`
    : lang === 'ru' ? `${min}мин назад`
    : `${min}min ago`;
  return { lang, pick, haMin };
}

const TR = {
  // Cabeçalho / raiz
  titulo:        { pt:'Gestor Logística', en:'Logistics Manager', es:'Gestor de Logística', ru:'Менеджер логистики' },
  cidade:        { pt:'Cidade:', en:'City:', es:'Ciudad:', ru:'Город:' },
  todasCidades:  { pt:'Todas as cidades', en:'All cities', es:'Todas las ciudades', ru:'Все города' },
  fechar:        { pt:'✕ Fechar', en:'✕ Close', es:'✕ Cerrar', ru:'✕ Закрыть' },
  avisoTodas:    { pt:'todas as cidades', en:'all cities', es:'todas las ciudades', ru:'все города' },
  selecioneCidade: { pt:'Selecione uma cidade para filtrar.', en:'Select a city to filter.', es:'Seleccione una ciudad para filtrar.', ru:'Выберите город для фильтрации.' },
  exibindoDados: { pt:'Exibindo dados de', en:'Showing data for', es:'Mostrando datos de', ru:'Показаны данные по' },

  // Abas
  abaDashboard:  { pt:'📊 Dashboard', en:'📊 Dashboard', es:'📊 Panel', ru:'📊 Панель' },
  abaPresenca:   { pt:'🕐 Presença', en:'🕐 Attendance', es:'🕐 Asistencia', ru:'🕐 Посещаемость' },
  abaOperadores: { pt:'👷 Operadores', en:'👷 Operators', es:'👷 Operadores', ru:'👷 Операторы' },
  abaSlots:      { pt:'🎰 Slots', en:'🎰 Slots', es:'🎰 Turnos', ru:'🎰 Слоты' },
  abaTarefas:    { pt:'📋 Tarefas', en:'📋 Tasks', es:'📋 Tareas', ru:'📋 Задачи' },
  abaDesempenho: { pt:'🏆 Desempenho', en:'🏆 Performance', es:'🏆 Desempeño', ru:'🏆 Эффективность' },
  abaMeis:       { pt:'📝 MEIs', en:'📝 MEIs', es:'📝 MEIs', ru:'📝 ИП' },
  abaClt:        { pt:'👥 CLT', en:'👥 Staff', es:'👥 Personal', ru:'👥 Штат' },
  abaInventario: { pt:'📦 Inventário', en:'📦 Inventory', es:'📦 Inventario', ru:'📦 Инвентарь' },
  abaTelegram:   { pt:'📱 Telegram', en:'📱 Telegram', es:'📱 Telegram', ru:'📱 Telegram' },
  abaCommandCenter: { pt:'🎯 Command Center', en:'🎯 Command Center', es:'🎯 Centro de Comando', ru:'🎯 Командный центр' },
  abaCalendario: { pt:'📅 Calendário', en:'📅 Calendar', es:'📅 Calendario', ru:'📅 Календарь' },
  abaExportar:   { pt:'📤 Exportar', en:'📤 Export', es:'📤 Exportar', ru:'📤 Экспорт' },
  abaComparativo:{ pt:'🌎 Comparativo', en:'🌎 Compare', es:'🌎 Comparativo', ru:'🌎 Сравнение' },
  abaAlertas:    { pt:'🔔 Alertas', en:'🔔 Alerts', es:'🔔 Alertas', ru:'🔔 Оповещения' },
  abaConfig:     { pt:'⚙️ Config', en:'⚙️ Settings', es:'⚙️ Config', ru:'⚙️ Настройки' },
  abaGoJet:      { pt:'🛴 GoJet', en:'🛴 GoJet', es:'🛴 GoJet', ru:'🛴 GoJet' },
  abaRastreamento: { pt:'📍 Rastreamento', en:'📍 Tracking', es:'📍 Rastreo', ru:'📍 Отслеживание' },
  abaHeatmap:    { pt:'🔥 Heatmap', en:'🔥 Heatmap', es:'🔥 Mapa de calor', ru:'🔥 Тепловая карта' },

  // Genéricos
  agora:         { pt:'agora', en:'now', es:'ahora', ru:'сейчас' },
  hojeLabel:     { pt:'Hoje', en:'Today', es:'Hoy', ru:'Сегодня' },
  amanhaLabel:   { pt:'Amanhã', en:'Tomorrow', es:'Mañana', ru:'Завтра' },
  salvar:        { pt:'✓ Salvar', en:'✓ Save', es:'✓ Guardar', ru:'✓ Сохранить' },
  salvando:      { pt:'Salvando...', en:'Saving...', es:'Guardando...', ru:'Сохранение...' },
  cadastrar:     { pt:'✓ Cadastrar', en:'✓ Register', es:'✓ Registrar', ru:'✓ Зарегистрировать' },
  cancelar:      { pt:'Cancelar', en:'Cancel', es:'Cancelar', ru:'Отмена' },
  criando:       { pt:'Criando...', en:'Creating...', es:'Creando...', ru:'Создание...' },
  carregando:    { pt:'Carregando...', en:'Loading...', es:'Cargando...', ru:'Загрузка...' },
  novo:          { pt:'+ Novo', en:'+ New', es:'+ Nuevo', ru:'+ Новый' },
  editarBtn:     { pt:'Editar', en:'Edit', es:'Editar', ru:'Изменить' },
  acoes:         { pt:'Ações', en:'Actions', es:'Acciones', ru:'Действия' },
  status:        { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
  nome:          { pt:'Nome', en:'Name', es:'Nombre', ru:'Имя' },
  turno:         { pt:'Turno', en:'Shift', es:'Turno', ru:'Смена' },
  zona:          { pt:'Zona', en:'Zone', es:'Zona', ru:'Зона' },
  tipo:          { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
  cidadeCol:     { pt:'Cidade', en:'City', es:'Ciudad', ru:'Город' },
  obs:           { pt:'Obs', en:'Notes', es:'Obs', ru:'Прим.' },
  observacao:    { pt:'Observação', en:'Note', es:'Observación', ru:'Примечание' },
  de:            { pt:'De', en:'From', es:'Desde', ru:'С' },
  ate:           { pt:'Até', en:'To', es:'Hasta', ru:'По' },
  inicio:        { pt:'Início', en:'Start', es:'Inicio', ru:'Начало' },
  fim:           { pt:'Fim', en:'End', es:'Fin', ru:'Конец' },
  todos:         { pt:'Todos', en:'All', es:'Todos', ru:'Все' },
  copiar:        { pt:'📋 Copiar', en:'📋 Copy', es:'📋 Copiar', ru:'📋 Копировать' },
  copiado:       { pt:'Copiado!', en:'Copied!', es:'¡Copiado!', ru:'Скопировано!' },
  atualizar:     { pt:'🔄 Atualizar', en:'🔄 Refresh', es:'🔄 Actualizar', ru:'🔄 Обновить' },
  atribuir:      { pt:'Atribuir →', en:'Assign →', es:'Asignar →', ru:'Назначить →' },
  atribuidoA:    { pt:'Atribuído a', en:'Assigned to', es:'Asignado a', ru:'Назначено' },
  removido:      { pt:'Removido', en:'Removed', es:'Eliminado', ru:'Удалено' },
  atualizado:    { pt:'Atualizado', en:'Updated', es:'Actualizado', ru:'Обновлено' },
  cadastrado:    { pt:'Cadastrado', en:'Registered', es:'Registrado', ru:'Зарегистрировано' },
  adicionado:    { pt:'Adicionado', en:'Added', es:'Agregado', ru:'Добавлено' },
  excluir:       { pt:'Excluir?', en:'Delete?', es:'¿Eliminar?', ru:'Удалить?' },
  remover:       { pt:'Remover?', en:'Remove?', es:'¿Eliminar?', ru:'Удалить?' },
  removerNome:   { pt:'Remover', en:'Remove', es:'Eliminar', ru:'Удалить' },
  semResp:       { pt:'Sem resp.', en:'Unassigned', es:'Sin resp.', ru:'Без отв.' },
  xlsxExportado: { pt:'XLSX exportado', en:'XLSX exported', es:'XLSX exportado', ru:'XLSX экспортирован' },
  pdfExportado:  { pt:'PDF exportado', en:'PDF exported', es:'PDF exportado', ru:'PDF экспортирован' },
  nenhumOperOnline: { pt:'Nenhum operador online', en:'No operators online', es:'Ningún operador en línea', ru:'Нет операторов в сети' },

  // Dashboard
  chuvaPrevista: { pt:'Chuva prevista', en:'Rain expected', es:'Lluvia prevista', ru:'Ожидается дождь' },
  tempoBom:      { pt:'Tempo bom', en:'Good weather', es:'Buen tiempo', ru:'Хорошая погода' },
  alertarChuva:  { pt:'⚠️ Alertar chargers sobre chuva', en:'⚠️ Warn chargers about rain', es:'⚠️ Avisar a los chargers sobre la lluvia', ru:'⚠️ Предупредить зарядчиков о дожде' },
  condFavoraveis:{ pt:'Condições favoráveis', en:'Favorable conditions', es:'Condiciones favorables', ru:'Благоприятные условия' },
  kpiOnline:     { pt:'Online 30min', en:'Online 30min', es:'En línea 30min', ru:'Онлайн 30мин' },
  kpiPendentes:  { pt:'Pendentes', en:'Pending', es:'Pendientes', ru:'Ожидают' },
  kpiAndamento:  { pt:'Em andamento', en:'In progress', es:'En curso', ru:'В работе' },
  kpiSemResp:    { pt:'Sem resp.', en:'Unassigned', es:'Sin resp.', ru:'Без отв.' },
  kpiVagasHoje:  { pt:'Vagas hoje', en:'Slots today', es:'Vacantes hoy', ru:'Места сегодня' },
  kpiIniciou:    { pt:'Iniciou', en:'Started', es:'Inició', ru:'Начал' },
  kpiFaltou:     { pt:'Faltou', en:'No-show', es:'Faltó', ru:'Не пришёл' },
  kpiAbertas:    { pt:'Abertas', en:'Open', es:'Abiertas', ru:'Открыто' },
  onlineAgora:   { pt:'👷 Online agora', en:'👷 Online now', es:'👷 En línea ahora', ru:'👷 Сейчас онлайн' },
  semResponsavel:{ pt:'🚨 Sem responsável', en:'🚨 Unassigned', es:'🚨 Sin responsable', ru:'🚨 Без ответственного' },
  todasTemResp:  { pt:'✅ Todas têm responsável', en:'✅ All assigned', es:'✅ Todas tienen responsable', ru:'✅ Все назначены' },
  slotsHoje:     { pt:'🎰 Slots hoje', en:'🎰 Slots today', es:'🎰 Turnos hoy', ru:'🎰 Слоты сегодня' },
  nenhumSlot:    { pt:'Nenhum slot', en:'No slots', es:'Ningún turno', ru:'Нет слотов' },
  colHorario:    { pt:'Horário', en:'Time', es:'Horario', ru:'Время' },
  colVagas:      { pt:'Vagas', en:'Slots', es:'Vacantes', ru:'Места' },
  colAceites:    { pt:'Aceites', en:'Accepts', es:'Aceptados', ru:'Принято' },
  colAbertas:    { pt:'Abertas', en:'Open', es:'Abiertas', ru:'Открыто' },
  abAbrev:       { pt:'ab', en:'open', es:'ab', ru:'откр' },
  ok:            { pt:'OK', en:'OK', es:'OK', ru:'OK' },

  // Presença
  cltVieram:     { pt:'CLT vieram', en:'Staff present', es:'Personal presente', ru:'Штат пришёл' },
  cltFaltaram:   { pt:'CLT faltaram', en:'Staff absent', es:'Personal ausente', ru:'Штат отсутствует' },
  cltFolga:      { pt:'CLT folga', en:'Staff off', es:'Personal libre', ru:'Штат выходной' },
  meiIniciou:    { pt:'MEI iniciou', en:'MEI started', es:'MEI inició', ru:'ИП начал' },
  meiFaltou:     { pt:'MEI faltou', en:'MEI no-show', es:'MEI faltó', ru:'ИП не пришёл' },
  pontosHoje:    { pt:'Pontos hoje', en:'Check-ins today', es:'Fichajes hoy', ru:'Отметок сегодня' },
  fTodos:        { pt:'Todos', en:'All', es:'Todos', ru:'Все' },
  fVieram:       { pt:'✅ Vieram', en:'✅ Present', es:'✅ Presentes', ru:'✅ Пришли' },
  fFaltaram:     { pt:'❌ Faltaram', en:'❌ Absent', es:'❌ Ausentes', ru:'❌ Отсутствуют' },
  fFolga:        { pt:'😴 Folga', en:'😴 Off', es:'😴 Libre', ru:'😴 Выходной' },
  stVeio:        { pt:'✅ Veio', en:'✅ Present', es:'✅ Presente', ru:'✅ Пришёл' },
  stFaltou:      { pt:'❌ Faltou', en:'❌ Absent', es:'❌ Ausente', ru:'❌ Отсутствует' },
  stFolga:       { pt:'😴 Folga', en:'😴 Off', es:'😴 Libre', ru:'😴 Выходной' },
  stAguardando:  { pt:'⏳ Aguardando', en:'⏳ Waiting', es:'⏳ Esperando', ru:'⏳ Ожидание' },
  funcaoCol:     { pt:'Função', en:'Role', es:'Función', ru:'Функция' },
  pontoCol:      { pt:'Ponto', en:'Check-in', es:'Fichaje', ru:'Отметка' },
  meiSlotsHoje:  { pt:'📝 MEI — Slots hoje', en:'📝 MEI — Slots today', es:'📝 MEI — Turnos hoy', ru:'📝 ИП — Слоты сегодня' },
  nenhumResultado: { pt:'Nenhum resultado', en:'No results', es:'Sin resultados', ru:'Нет результатов' },
  nenhumAceite:  { pt:'Nenhum aceite', en:'No accepts', es:'Sin aceptados', ru:'Нет принятых' },
  registrosPonto:{ pt:'🕐 Registros de ponto — hoje', en:'🕐 Check-in records — today', es:'🕐 Registros de fichaje — hoy', ru:'🕐 Записи отметок — сегодня' },
  colHora:       { pt:'Hora', en:'Time', es:'Hora', ru:'Время' },
  colAcao:       { pt:'Ação', en:'Action', es:'Acción', ru:'Действие' },
  colFoto:       { pt:'Foto', en:'Photo', es:'Foto', ru:'Фото' },
  nenhumPonto:   { pt:'Nenhum ponto hoje', en:'No check-ins today', es:'Ningún fichaje hoy', ru:'Нет отметок сегодня' },
  acaoInicio:    { pt:'▶ Início', en:'▶ Start', es:'▶ Inicio', ru:'▶ Начало' },
  acaoFim:       { pt:'⏹ Fim', en:'⏹ End', es:'⏹ Fin', ru:'⏹ Конец' },
  verFoto:       { pt:'📷 Ver', en:'📷 View', es:'📷 Ver', ru:'📷 Смотреть' },

  // Operadores
  buscarOperador:{ pt:'🔍 Buscar operador...', en:'🔍 Search operator...', es:'🔍 Buscar operador...', ru:'🔍 Поиск оператора...' },
  operadores:    { pt:'operadores', en:'operators', es:'operadores', ru:'операторов' },
  gpsHist:       { pt:'🔍 GPS histórico', en:'🔍 GPS history', es:'🔍 GPS histórico', ru:'🔍 История GPS' },
  pts:           { pt:'pts', en:'pts', es:'pts', ru:'точек' },
  spoofingAviso: { pt:'⚠️ Distâncias anormais podem indicar spoofing de GPS', en:'⚠️ Abnormal distances may indicate GPS spoofing', es:'⚠️ Distancias anormales pueden indicar spoofing de GPS', ru:'⚠️ Аномальные расстояния могут указывать на подмену GPS' },
  atribuirTarefa:{ pt:'📋 Atribuir tarefa', en:'📋 Assign task', es:'📋 Asignar tarea', ru:'📋 Назначить задачу' },
  semTarefasSemResp: { pt:'✅ Sem tarefas sem responsável', en:'✅ No unassigned tasks', es:'✅ Sin tareas sin responsable', ru:'✅ Нет неназначенных задач' },
  sugestaoAuto:  { pt:'💡 Sugestão automática', en:'💡 Auto suggestion', es:'💡 Sugerencia automática', ru:'💡 Авто-предложение' },
  sugerido:      { pt:'Sugerido:', en:'Suggested:', es:'Sugerido:', ru:'Предложено:' },

  // Slots
  chuvaAmanha:   { pt:'Chuva prevista amanhã', en:'Rain expected tomorrow', es:'Lluvia prevista mañana', ru:'Завтра ожидается дождь' },
  reduzaScout:   { pt:'Reduza vagas de Scout em regiões de alta declividade', en:'Reduce Scout slots in steep areas', es:'Reduzca vacantes de Scout en zonas de alta pendiente', ru:'Сократите слоты Scout в районах с большим уклоном' },
  loteBtn:       { pt:'⚡ Lote', en:'⚡ Batch', es:'⚡ Lote', ru:'⚡ Пакет' },
  novoSlotBtn:   { pt:'+ Slot', en:'+ Slot', es:'+ Turno', ru:'+ Слот' },
  kpiSlots:      { pt:'Slots', en:'Slots', es:'Turnos', ru:'Слоты' },
  preenchTurno:  { pt:'📊 Preenchimento por turno', en:'📊 Fill rate by shift', es:'📊 Ocupación por turno', ru:'📊 Заполнение по сменам' },
  nenhumSlotPara:{ pt:'Nenhum slot para', en:'No slots for', es:'Ningún turno para', ru:'Нет слотов на' },
  vagasLabel:    { pt:'vagas', en:'slots', es:'vacantes', ru:'мест' },
  completo:      { pt:'Completo', en:'Full', es:'Completo', ru:'Заполнено' },
  semAceites:    { pt:'Sem aceites', en:'No accepts', es:'Sin aceptados', ru:'Нет принятых' },
  colAceitoEm:   { pt:'Aceito em', en:'Accepted at', es:'Aceptado en', ru:'Принято в' },
  criarLoteTit:  { pt:'⚡ Criar slots em lote', en:'⚡ Create slots in batch', es:'⚡ Crear turnos en lote', ru:'⚡ Создать слоты пакетом' },
  chuvaReduza:   { pt:'🌧 Chuva prevista — reduza vagas de Scout', en:'🌧 Rain expected — reduce Scout slots', es:'🌧 Lluvia prevista — reduzca vacantes de Scout', ru:'🌧 Ожидается дождь — сократите слоты Scout' },
  data:          { pt:'Data', en:'Date', es:'Fecha', ru:'Дата' },
  zonaObrig:     { pt:'Zona *', en:'Zone *', es:'Zona *', ru:'Зона *' },
  zonaPlaceholder:{ pt:'Ex: Z1 - Vermelha', en:'Ex: Z1 - Red', es:'Ej: Z1 - Roja', ru:'Напр.: Z1 - Красная' },
  vagasPorSlot:  { pt:'Vagas por slot', en:'Slots per shift', es:'Vacantes por turno', ru:'Мест на слот' },
  confirmarMinAntes: { pt:'Confirmar (min antes)', en:'Confirm (min before)', es:'Confirmar (min antes)', ru:'Подтвердить (мин до)' },
  turnos:        { pt:'Turnos', en:'Shifts', es:'Turnos', ru:'Смены' },
  tipos:         { pt:'Tipos', en:'Types', es:'Tipos', ru:'Типы' },
  t1Manha:       { pt:'T1 — Manhã', en:'T1 — Morning', es:'T1 — Mañana', ru:'T1 — Утро' },
  t2Tarde:       { pt:'T2 — Tarde', en:'T2 — Afternoon', es:'T2 — Tarde', ru:'T2 — День' },
  t0Noite:       { pt:'T0 — Noite', en:'T0 — Night', es:'T0 — Noche', ru:'T0 — Ночь' },
  seraoCriados:  { pt:'Serão criados', en:'Will create', es:'Se crearán', ru:'Будет создано' },
  slotsEm:       { pt:'slots em', en:'slots in', es:'turnos en', ru:'слотов в' },
  semZona:       { pt:'(sem zona)', en:'(no zone)', es:'(sin zona)', ru:'(без зоны)' },
  criarTodos:    { pt:'⚡ Criar todos os slots', en:'⚡ Create all slots', es:'⚡ Crear todos los turnos', ru:'⚡ Создать все слоты' },
  criarSlotTit:  { pt:'🎰 Criar Slot', en:'🎰 Create Slot', es:'🎰 Crear Turno', ru:'🎰 Создать слот' },
  confirmarMin:  { pt:'Confirmar (min)', en:'Confirm (min)', es:'Confirmar (min)', ru:'Подтвердить (мин)' },
  reabrirSemConf:{ pt:'Reabrir sem conf.', en:'Reopen w/o confirm', es:'Reabrir sin conf.', ru:'Открыть без подтв.' },
  dataObrig:     { pt:'Data *', en:'Date *', es:'Fecha *', ru:'Дата *' },
  criarSlotBtn:  { pt:'✓ Criar slot', en:'✓ Create slot', es:'✓ Crear turno', ru:'✓ Создать слот' },
  slotCriado:    { pt:'Slot criado', en:'Slot created', es:'Turno creado', ru:'Слот создан' },
  preenchaZonaTurnos: { pt:'Preencha zona, turnos e tipos', en:'Fill in zone, shifts and types', es:'Complete zona, turnos y tipos', ru:'Заполните зону, смены и типы' },
  preenchaZonaData: { pt:'Preencha zona e data', en:'Fill in zone and date', es:'Complete zona y fecha', ru:'Заполните зону и дату' },
  slotsCriados:  { pt:'slots criados em', en:'slots created in', es:'turnos creados en', ru:'слотов создано в' },

  // Tarefas
  kpiConcluidas: { pt:'Concluídas', en:'Completed', es:'Completadas', ru:'Завершено' },
  kpiCanceladas: { pt:'Canceladas', en:'Cancelled', es:'Canceladas', ru:'Отменено' },
  kpiTotal:      { pt:'Total', en:'Total', es:'Total', ru:'Всего' },
  todosTipos:    { pt:'Todos tipos', en:'All types', es:'Todos los tipos', ru:'Все типы' },
  colTitulo:     { pt:'Título', en:'Title', es:'Título', ru:'Заголовок' },
  colEndereco:   { pt:'Endereço', en:'Address', es:'Dirección', ru:'Адрес' },
  colResponsavel:{ pt:'Responsável', en:'Assignee', es:'Responsable', ru:'Ответственный' },
  colCriadoEm:   { pt:'Criado em', en:'Created at', es:'Creado en', ru:'Создано' },
  nenhumaTarefa: { pt:'Nenhuma tarefa', en:'No tasks', es:'Ninguna tarea', ru:'Нет задач' },
  cancelada:     { pt:'Cancelada', en:'Cancelled', es:'Cancelada', ru:'Отменено' },
  reatribuir:    { pt:'Reatribuir:', en:'Reassign:', es:'Reasignar:', ru:'Переназначить:' },
  operadoresOnline: { pt:'Operadores online', en:'Operators online', es:'Operadores en línea', ru:'Операторы онлайн' },

  // Desempenho
  subRanking:    { pt:'🏆 Ranking', en:'🏆 Ranking', es:'🏆 Ranking', ru:'🏆 Рейтинг' },
  subHeatmap:    { pt:'🔥 Heatmap', en:'🔥 Heatmap', es:'🔥 Mapa de calor', ru:'🔥 Тепловая карта' },
  subEficiencias:{ pt:'⚡ Eficiências', en:'⚡ Efficiency', es:'⚡ Eficiencias', ru:'⚡ Эффективность' },
  semDadosPeriodo: { pt:'Sem dados no período', en:'No data in period', es:'Sin datos en el período', ru:'Нет данных за период' },
  colOperador:   { pt:'Operador', en:'Operator', es:'Operador', ru:'Оператор' },
  colMovs:       { pt:'Movs', en:'Moves', es:'Movs', ru:'Перем.' },
  colBaterias:   { pt:'Baterias', en:'Batteries', es:'Baterías', ru:'Батареи' },
  colBarra:      { pt:'Barra', en:'Bar', es:'Barra', ru:'Шкала' },
  registrarEf:   { pt:'+ Registrar eficiência', en:'+ Log efficiency', es:'+ Registrar eficiencia', ru:'+ Записать эффективность' },
  nenhumaEf:     { pt:'Nenhuma eficiência registrada', en:'No efficiency logged', es:'Sin eficiencias registradas', ru:'Эффективность не записана' },
  registrarEfTit:{ pt:'⚡ Registrar Eficiência', en:'⚡ Log Efficiency', es:'⚡ Registrar Eficiencia', ru:'⚡ Запись эффективности' },
  selecionar:    { pt:'— Selecionar —', en:'— Select —', es:'— Seleccionar —', ru:'— Выбрать —' },
  movimentacoes: { pt:'Movimentações 🛴', en:'Moves 🛴', es:'Movimientos 🛴', ru:'Перемещения 🛴' },
  bateriasLabel: { pt:'Baterias 🔋', en:'Batteries 🔋', es:'Baterías 🔋', ru:'Батареи 🔋' },
  nomeDataObrig: { pt:'Nome e data obrigatórios', en:'Name and date required', es:'Nombre y fecha obligatorios', ru:'Имя и дата обязательны' },
  registrado:    { pt:'Registrado', en:'Logged', es:'Registrado', ru:'Записано' },
  rankingDesemp: { pt:'Ranking Desempenho', en:'Performance Ranking', es:'Ranking de Desempeño', ru:'Рейтинг эффективности' },
  tarefasTit:    { pt:'Tarefas', en:'Tasks', es:'Tareas', ru:'Задачи' },

  // MEIs
  suspVencendo:  { pt:'⚠️ Suspensões vencendo em até 3 dias', en:'⚠️ Suspensions ending within 3 days', es:'⚠️ Suspensiones que vencen en 3 días', ru:'⚠️ Приостановки заканчиваются в течение 3 дней' },
  buscarNomeCnpj:{ pt:'🔍 Nome, CNPJ...', en:'🔍 Name, CNPJ...', es:'🔍 Nombre, CNPJ...', ru:'🔍 Имя, CNPJ...' },
  fAtivo:        { pt:'Ativo', en:'Active', es:'Activo', ru:'Активен' },
  fSuspenso:     { pt:'Suspenso', en:'Suspended', es:'Suspendido', ru:'Приостановлен' },
  fInativo:      { pt:'Inativo', en:'Inactive', es:'Inactivo', ru:'Неактивен' },
  cadastrarMei:  { pt:'+ Cadastrar MEI', en:'+ Register MEI', es:'+ Registrar MEI', ru:'+ Зарегистрировать ИП' },
  colSuspensao:  { pt:'Suspensão', en:'Suspension', es:'Suspensión', ru:'Приостановка' },
  colDiasRest:   { pt:'Dias rest.', en:'Days left', es:'Días rest.', ru:'Дней ост.' },
  nenhumMei:     { pt:'Nenhum MEI', en:'No MEI', es:'Ningún MEI', ru:'Нет ИП' },
  suspensoLabel: { pt:'SUSPENSO', en:'SUSPENDED', es:'SUSPENDIDO', ru:'ПРИОСТАНОВЛЕН' },
  ateLabel:      { pt:'até', en:'until', es:'hasta', ru:'до' },
  editarPrefix:  { pt:'Editar:', en:'Edit:', es:'Editar:', ru:'Изменить:' },
  nomeObrig:     { pt:'Nome *', en:'Name *', es:'Nombre *', ru:'Имя *' },
  cnpjObrig:     { pt:'CNPJ *', en:'CNPJ *', es:'CNPJ *', ru:'CNPJ *' },
  suspTemporaria:{ pt:'🚫 Suspensão temporária', en:'🚫 Temporary suspension', es:'🚫 Suspensión temporal', ru:'🚫 Временная приостановка' },
  diasSusp:      { pt:'dias de suspensão', en:'days of suspension', es:'días de suspensión', ru:'дней приостановки' },
  motivo:        { pt:'Motivo', en:'Reason', es:'Motivo', ru:'Причина' },
  motivoPlaceholder: { pt:'Ex: Falta em slot', en:'Ex: Missed slot', es:'Ej: Falta en turno', ru:'Напр.: Пропуск слота' },
  nomeCnpjObrig: { pt:'Nome e CNPJ obrigatórios', en:'Name and CNPJ required', es:'Nombre y CNPJ obligatorios', ru:'Имя и CNPJ обязательны' },
  meiAtualizado: { pt:'MEI atualizado', en:'MEI updated', es:'MEI actualizado', ru:'ИП обновлён' },
  meiCadastrado: { pt:'MEI cadastrado', en:'MEI registered', es:'MEI registrado', ru:'ИП зарегистрирован' },

  // CLT
  buscarNomeCpf: { pt:'🔍 Nome ou CPF...', en:'🔍 Name or CPF...', es:'🔍 Nombre o CPF...', ru:'🔍 Имя или CPF...' },
  novoClt:       { pt:'+ CLT', en:'+ Staff', es:'+ Personal', ru:'+ Штат' },
  colFolga:      { pt:'Folga', en:'Day off', es:'Libre', ru:'Выходной' },
  nenhumFunc:    { pt:'Nenhum funcionário', en:'No employees', es:'Ningún empleado', ru:'Нет сотрудников' },
  cadastrarClt:  { pt:'+ Cadastrar CLT', en:'+ Register staff', es:'+ Registrar personal', ru:'+ Зарегистрировать штат' },
  funcao:        { pt:'Função', en:'Role', es:'Función', ru:'Функция' },
  diaFolga:      { pt:'Dia de folga', en:'Day off', es:'Día libre', ru:'Выходной день' },
  semFolgaFixa:  { pt:'— Sem folga fixa —', en:'— No fixed day off —', es:'— Sin día libre fijo —', ru:'— Без фикс. выходного —' },
  gerente:       { pt:'Gerente', en:'Manager', es:'Gerente', ru:'Менеджер' },
  telefone:      { pt:'Telefone', en:'Phone', es:'Teléfono', ru:'Телефон' },
  admissao:      { pt:'Admissão', en:'Hire date', es:'Admisión', ru:'Дата найма' },
  cpfObrig:      { pt:'CPF *', en:'CPF *', es:'CPF *', ru:'CPF *' },
  nomeCpfObrig:  { pt:'Nome e CPF obrigatórios', en:'Name and CPF required', es:'Nombre y CPF obligatorios', ru:'Имя и CPF обязательны' },

  // Inventário
  invArmarios:   { pt:'Armários', en:'Lockers', es:'Armarios', ru:'Шкафы' },
  invPatinetes:  { pt:'Patinetes', en:'Scooters', es:'Patinetes', ru:'Самокаты' },
  invCarros:     { pt:'Carros', en:'Cars', es:'Coches', ru:'Машины' },
  invSuportes:   { pt:'Suportes', en:'Racks', es:'Soportes', ru:'Стойки' },
  adicionar:     { pt:'+ Adicionar', en:'+ Add', es:'+ Agregar', ru:'+ Добавить' },
  invAtivos:     { pt:'Ativos', en:'Active', es:'Activos', ru:'Активны' },
  invManutencao: { pt:'Manutenção', en:'Maintenance', es:'Mantenimiento', ru:'Обслуживание' },
  invInativos:   { pt:'Inativos', en:'Inactive', es:'Inactivos', ru:'Неактивны' },
  colIdentificador:{ pt:'Identificador', en:'Identifier', es:'Identificador', ru:'Идентификатор' },
  nenhumItem:    { pt:'Nenhum item', en:'No items', es:'Ningún ítem', ru:'Нет элементов' },
  identificadorPlaceholder: { pt:'Placa, série...', en:'Plate, serial...', es:'Placa, serie...', ru:'Номер, серия...' },
  nomeObrigInv:  { pt:'Nome obrigatório', en:'Name required', es:'Nombre obligatorio', ru:'Имя обязательно' },
  manutencaoOpt: { pt:'MANUTENÇÃO', en:'MAINTENANCE', es:'MANTENIMIENTO', ru:'ОБСЛУЖИВАНИЕ' },

  // Telegram
  confSlots:     { pt:'⏰ Confirmação de slots', en:'⏰ Slot confirmation', es:'⏰ Confirmación de turnos', ru:'⏰ Подтверждение слотов' },
  aceitesPend:   { pt:'aceites pendentes.', en:'pending accepts.', es:'aceptaciones pendientes.', ru:'ожидающих подтверждения.' },
  cliquePara:    { pt:'Clique para enviar lembrete de confirmação.', en:'Click to send confirmation reminder.', es:'Haga clic para enviar recordatorio de confirmación.', ru:'Нажмите, чтобы отправить напоминание о подтверждении.' },
  enviarConfs:   { pt:'📨 Enviar confirmações', en:'📨 Send confirmations', es:'📨 Enviar confirmaciones', ru:'📨 Отправить подтверждения' },
  enviando:      { pt:'Enviando...', en:'Sending...', es:'Enviando...', ru:'Отправка...' },
  gruposTelegram:{ pt:'📡 Grupos Telegram', en:'📡 Telegram groups', es:'📡 Grupos de Telegram', ru:'📡 Группы Telegram' },
  todosGrupos:   { pt:'Todos os grupos', en:'All groups', es:'Todos los grupos', ru:'Все группы' },
  msgEnviadaPara:{ pt:'Mensagem será enviada para:', en:'Message will be sent to:', es:'El mensaje se enviará a:', ru:'Сообщение будет отправлено:' },
  templates:     { pt:'📝 Templates', en:'📝 Templates', es:'📝 Plantillas', ru:'📝 Шаблоны' },
  enviarBtn:     { pt:'📤 Enviar', en:'📤 Send', es:'📤 Enviar', ru:'📤 Отправить' },
  msgLivre:      { pt:'✍️ Mensagem livre', en:'✍️ Free message', es:'✍️ Mensaje libre', ru:'✍️ Свободное сообщение' },
  msgPlaceholderA: { pt:'Mensagem para', en:'Message to', es:'Mensaje para', ru:'Сообщение для' },
  msgPlaceholderB: { pt:'Suporta *negrito* e _itálico_ (Telegram Markdown)', en:'Supports *bold* and _italic_ (Telegram Markdown)', es:'Soporta *negrita* e _cursiva_ (Telegram Markdown)', ru:'Поддерживает *жирный* и _курсив_ (Telegram Markdown)' },
  configGrupos:  { pt:'💡 Configure grupos em Config → Telegram para habilitar envio direto por grupo.', en:'💡 Configure groups in Settings → Telegram to enable direct group sending.', es:'💡 Configure grupos en Config → Telegram para habilitar el envío directo por grupo.', ru:'💡 Настройте группы в Настройки → Telegram, чтобы включить прямую отправку по группам.' },
  digiteMsg:     { pt:'Digite uma mensagem', en:'Type a message', es:'Escriba un mensaje', ru:'Введите сообщение' },
  msgEnviada:    { pt:'Mensagem enviada', en:'Message sent', es:'Mensaje enviado', ru:'Сообщение отправлено' },
  copiadoIndisp: { pt:'Copiado para área de transferência (envio direto indisponível)', en:'Copied to clipboard (direct sending unavailable)', es:'Copiado al portapapeles (envío directo no disponible)', ru:'Скопировано в буфер (прямая отправка недоступна)' },
  nenhumAcePend: { pt:'Nenhum aceite pendente', en:'No pending accepts', es:'Sin aceptaciones pendientes', ru:'Нет ожидающих подтверждений' },
  confEnviadas:  { pt:'confirmações enviadas', en:'confirmations sent', es:'confirmaciones enviadas', ru:'подтверждений отправлено' },
  erroPrefix:    { pt:'Erro:', en:'Error:', es:'Error:', ru:'Ошибка:' },
  tplResumo:     { pt:'Resumo turno', en:'Shift summary', es:'Resumen de turno', ru:'Сводка смены' },
  tplVagas:      { pt:'Vagas urgentes', en:'Urgent slots', es:'Vacantes urgentes', ru:'Срочные слоты' },
  tplInicio:     { pt:'Inicio operação', en:'Operation start', es:'Inicio de operación', ru:'Начало работы' },
  tplChargers:   { pt:'Rel. Chargers', en:'Chargers report', es:'Inf. Chargers', ru:'Отчёт зарядчиков' },
  tplScouts:     { pt:'Rel. Scouts', en:'Scouts report', es:'Inf. Scouts', ru:'Отчёт скаутов' },
  geral:         { pt:'Geral', en:'General', es:'General', ru:'Общее' },
  // Conteúdo de mensagens (Markdown Telegram)
  msgResumoTit:  { pt:'RESUMO LOGÍSTICA', en:'LOGISTICS SUMMARY', es:'RESUMEN LOGÍSTICA', ru:'СВОДКА ЛОГИСТИКИ' },
  msgOnlineAgora:{ pt:'Online agora:', en:'Online now:', es:'En línea ahora:', ru:'Сейчас онлайн:' },
  msgSlotsHoje:  { pt:'Slots hoje:', en:'Slots today:', es:'Turnos hoy:', ru:'Слоты сегодня:' },
  msgVagas:      { pt:'Vagas:', en:'Slots:', es:'Vacantes:', ru:'Места:' },
  msgAceites:    { pt:'Aceites:', en:'Accepts:', es:'Aceptados:', ru:'Принято:' },
  msgIniciou:    { pt:'Iniciou:', en:'Started:', es:'Inició:', ru:'Начал:' },
  msgFaltou:     { pt:'Faltou:', en:'No-show:', es:'Faltó:', ru:'Не пришёл:' },
  msgAbertas:    { pt:'Abertas:', en:'Open:', es:'Abiertas:', ru:'Открыто:' },
  msgTarefasPend:{ pt:'Tarefas pendentes:', en:'Pending tasks:', es:'Tareas pendientes:', ru:'Ожидающие задачи:' },
  msgVagasAbertas:{ pt:'VAGAS ABERTAS — URGENTE', en:'OPEN SLOTS — URGENT', es:'VACANTES ABIERTAS — URGENTE', ru:'ОТКРЫТЫЕ СЛОТЫ — СРОЧНО' },
  msgVagaDisp:   { pt:'vaga(s) disponível hoje!', en:'slot(s) available today!', es:'¡vacante(s) disponible(s) hoy!', ru:'мест доступно сегодня!' },
  msgRespConfirmar:{ pt:'Responda para confirmar presença.', en:'Reply to confirm attendance.', es:'Responda para confirmar asistencia.', ru:'Ответьте, чтобы подтвердить присутствие.' },
  msgInicioOper: { pt:'INÍCIO DE OPERAÇÃO', en:'OPERATION START', es:'INICIO DE OPERACIÓN', ru:'НАЧАЛО РАБОТЫ' },
  msgBomTurno:   { pt:'Bom turno a todos! 💪', en:'Have a great shift! 💪', es:'¡Buen turno a todos! 💪', ru:'Хорошей смены всем! 💪' },
  msgRelatorio:  { pt:'Relatório', en:'Report', es:'Informe', ru:'Отчёт' },
  msgSemTarefas: { pt:'Sem tarefas ativas.', en:'No active tasks.', es:'Sin tareas activas.', ru:'Нет активных задач.' },
  msgConfSlotTit:{ pt:'Confirmação de Slot', en:'Slot Confirmation', es:'Confirmación de Turno', ru:'Подтверждение слота' },
  msgVoceTemSlot:{ pt:'você tem um slot hoje às', en:'you have a slot today at', es:'tiene un turno hoy a las', ru:'у вас сегодня слот в' },
  msgNaZona:     { pt:'na zona', en:'in zone', es:'en la zona', ru:'в зоне' },
  msgEm:         { pt:'em', en:'in', es:'en', ru:'в' },
  msgConfirmeResp:{ pt:'✅ Confirme respondendo esta mensagem.', en:'✅ Confirm by replying to this message.', es:'✅ Confirme respondiendo este mensaje.', ru:'✅ Подтвердите, ответив на это сообщение.' },
  msgCasoNaoPossa:{ pt:'❌ Caso não possa, avise com antecedência.', en:'❌ If you cannot, let us know in advance.', es:'❌ Si no puede, avise con antelación.', ru:'❌ Если не можете, сообщите заранее.' },

  // Alertas
  alBateriaCritica:{ pt:'🔋 Bateria crítica', en:'🔋 Critical battery', es:'🔋 Batería crítica', ru:'🔋 Критический заряд' },
  alPontoZerado: { pt:'⭕ Ponto zerado', en:'⭕ Empty point', es:'⭕ Punto vacío', ru:'⭕ Пустая точка' },
  alPontoBaixo:  { pt:'📉 Ponto baixo', en:'📉 Low point', es:'📉 Punto bajo', ru:'📉 Низкая точка' },
  histAlertas:   { pt:'🔔 Histórico de Alertas', en:'🔔 Alert History', es:'🔔 Historial de Alertas', ru:'🔔 История оповещений' },
  nenhumAlertaAinda: { pt:'Nenhum alerta registrado ainda. Os alertas aparecerão aqui quando o monitor detectar baterias críticas.', en:'No alerts logged yet. Alerts will appear here when the monitor detects critical batteries.', es:'Aún no hay alertas registradas. Las alertas aparecerán aquí cuando el monitor detecte baterías críticas.', ru:'Оповещений пока нет. Они появятся здесь, когда монитор обнаружит критический заряд.' },
  nenhumAlertaFiltro: { pt:'Nenhum alerta neste filtro.', en:'No alerts in this filter.', es:'No hay alertas en este filtro.', ru:'Нет оповещений по этому фильтру.' },
  bikeSing:      { pt:'bike', en:'bike', es:'bici', ru:'байк' },
  bikePlur:      { pt:'bikes', en:'bikes', es:'bicis', ru:'байков' },
  minLabel:      { pt:'min', en:'min', es:'mín', ru:'мин' },
  slotLabel:     { pt:'slot:', en:'slot:', es:'turno:', ru:'слот:' },

  // Config
  configPara:    { pt:'⚙️ Configurações para:', en:'⚙️ Settings for:', es:'⚙️ Configuración para:', ru:'⚙️ Настройки для:' },
  globalTodas:   { pt:'(global — todas as cidades)', en:'(global — all cities)', es:'(global — todas las ciudades)', ru:'(глобально — все города)' },
  operacao:      { pt:'⚙️ Operação', en:'⚙️ Operation', es:'⚙️ Operación', ru:'⚙️ Операции' },
  slaPadrao:     { pt:'SLA padrão (min)', en:'Default SLA (min)', es:'SLA estándar (min)', ru:'SLA по умолч. (мин)' },
  raioSugestao:  { pt:'Raio sugestão oper. (km)', en:'Operator suggestion radius (km)', es:'Radio sugerencia oper. (km)', ru:'Радиус подсказки опер. (км)' },
  thresholdBat:  { pt:'Threshold bateria baixa %', en:'Low battery threshold %', es:'Umbral batería baja %', ru:'Порог низкого заряда %' },
  alertarGoJetZero: { pt:'Alertar pontos GoJet com zero patinetes', en:'Alert GoJet points with zero scooters', es:'Alertar puntos GoJet con cero patinetes', ru:'Оповещать точки GoJet с нулём самокатов' },
  confSlotsTit:  { pt:'⏰ Confirmação de Slots', en:'⏰ Slot Confirmation', es:'⏰ Confirmación de Turnos', ru:'⏰ Подтверждение слотов' },
  avisarConf:    { pt:'Avisar confirmação (min antes)', en:'Confirmation notice (min before)', es:'Avisar confirmación (min antes)', ru:'Уведомление о подтв. (мин до)' },
  reabrirSemConfMin: { pt:'Reabrir sem confirmação (min)', en:'Reopen w/o confirmation (min)', es:'Reabrir sin confirmación (min)', ru:'Открыть без подтв. (мин)' },
  confExA:       { pt:'Ex: slot às 15h → aviso às ~', en:'Ex: slot at 3pm → notice ~', es:'Ej: turno a las 15h → aviso ~', ru:'Напр.: слот в 15:00 → уведомление за ~' },
  confExB:       { pt:'min antes. Sem confirmação → vaga reaberta como urgente em', en:'min before. No confirmation → slot reopened as urgent in', es:'min antes. Sin confirmación → vacante reabierta como urgente en', ru:'мин. Без подтверждения → слот открыт как срочный через' },
  confExC:       { pt:'min.', en:'min.', es:'min.', ru:'мин.' },
  prazoAuto:     { pt:'⏱ Prazo automático por tipo de tarefa', en:'⏱ Automatic deadline by task type', es:'⏱ Plazo automático por tipo de tarea', ru:'⏱ Авто-срок по типу задачи' },
  prazoDesc:     { pt:'Define quantas horas após a criação a tarefa vence. 0 = sem prazo automático.', en:'Sets how many hours after creation the task is due. 0 = no automatic deadline.', es:'Define cuántas horas tras la creación vence la tarea. 0 = sin plazo automático.', ru:'Задаёт, через сколько часов после создания истекает задача. 0 = без авто-срока.' },
  prazoPonto:    { pt:'📍 Encher ponto', en:'📍 Fill point', es:'📍 Llenar punto', ru:'📍 Заполнить точку' },
  prazoPatinete: { pt:'🛴 Patinete', en:'🛴 Scooter', es:'🛴 Patinete', ru:'🛴 Самокат' },
  prazoOrg:      { pt:'🗂 Organização', en:'🗂 Organization', es:'🗂 Organización', ru:'🗂 Организация' },
  prazoCarga:    { pt:'🔋 Carga bateria', en:'🔋 Battery charge', es:'🔋 Carga batería', ru:'🔋 Заряд батареи' },
  salvarConfig:  { pt:'✓ Salvar configurações', en:'✓ Save settings', es:'✓ Guardar configuración', ru:'✓ Сохранить настройки' },
  configSalva:   { pt:'Config salva', en:'Settings saved', es:'Configuración guardada', ru:'Настройки сохранены' },
  grupoBtn:      { pt:'+ Grupo', en:'+ Group', es:'+ Grupo', ru:'+ Группа' },
  nenhumGrupo:   { pt:'Nenhum grupo configurado para esta cidade.', en:'No group configured for this city.', es:'Ningún grupo configurado para esta ciudad.', ru:'Для этого города не настроена ни одна группа.' },
  tiposLabel:    { pt:'Tipos:', en:'Types:', es:'Tipos:', ru:'Типы:' },
  nomeGrupo:     { pt:'Nome do grupo', en:'Group name', es:'Nombre del grupo', ru:'Название группы' },
  nomeGrupoPlaceholder: { pt:'Ex: Chargers SP', en:'Ex: Chargers SP', es:'Ej: Chargers SP', ru:'Напр.: Chargers SP' },
  chatId:        { pt:'Chat ID', en:'Chat ID', es:'Chat ID', ru:'Chat ID' },
  tiposCargo:    { pt:'Tipos de cargo', en:'Role types', es:'Tipos de cargo', ru:'Типы ролей' },
  cargoSeguranca:{ pt:'Segurança', en:'Security', es:'Seguridad', ru:'Охрана' },
  cargoLideres:  { pt:'Líderes', en:'Leaders', es:'Líderes', ru:'Лидеры' },
  cargoAlertas:  { pt:'Alertas', en:'Alerts', es:'Alertas', ru:'Оповещения' },
  salvarGrupo:   { pt:'✓ Salvar grupo', en:'✓ Save group', es:'✓ Guardar grupo', ru:'✓ Сохранить группу' },
  grupoSalvo:    { pt:'Grupo salvo', en:'Group saved', es:'Grupo guardado', ru:'Группа сохранена' },
  chatIdObrig:   { pt:'Chat ID e nome obrigatórios', en:'Chat ID and name required', es:'Chat ID y nombre obligatorios', ru:'Chat ID и имя обязательны' },
  chatIdDica:    { pt:'💡 Chat ID: abra o grupo no Telegram, encaminhe uma msg para @getidsbot. Thread ID: use @getidsbot no tópico.', en:'💡 Chat ID: open the group in Telegram, forward a message to @getidsbot. Thread ID: use @getidsbot in the topic.', es:'💡 Chat ID: abra el grupo en Telegram, reenvíe un mensaje a @getidsbot. Thread ID: use @getidsbot en el tema.', ru:'💡 Chat ID: откройте группу в Telegram, перешлите сообщение @getidsbot. Thread ID: используйте @getidsbot в теме.' },
  gestoresLog:   { pt:'👷 Gestores de logística', en:'👷 Logistics managers', es:'👷 Gestores de logística', ru:'👷 Менеджеры логистики' },
  gestoresDesc:  { pt:'Configure quais gestores têm acesso a cada cidade. Campo', en:'Configure which managers have access to each city. Field', es:'Configure qué gestores tienen acceso a cada ciudad. Campo', ru:'Настройте, какие менеджеры имеют доступ к каждому городу. Поле' },
  noDocUsuario:  { pt:'no documento do usuário em', en:'in the user document in', es:'en el documento del usuario en', ru:'в документе пользователя в' },
  todasLabel:    { pt:'Todas', en:'All', es:'Todas', ru:'Все' },
  gestoresFooter:{ pt:'Para configurar cidades de um gestor, edite o usuário em Usuários Manager → campo', en:'To configure a manager’s cities, edit the user in Users Manager → field', es:'Para configurar las ciudades de un gestor, edite el usuario en Usuarios Manager → campo', ru:'Чтобы настроить города менеджера, измените пользователя в Users Manager → поле' },
  arrayStrings:  { pt:'(array de strings).', en:'(array of strings).', es:'(arreglo de strings).', ru:'(массив строк).' },

  // GoJet Config
  goJetIntro:    { pt:'Configure o cityId da API GoJet e os limiares de automação para', en:'Configure the GoJet API cityId and automation thresholds for', es:'Configure el cityId de la API GoJet y los umbrales de automatización para', ru:'Настройте cityId API GoJet и пороги автоматизации для' },
  semCidade:     { pt:'(sem cidade)', en:'(no city)', es:'(sin ciudad)', ru:'(без города)' },
  pontosSnapshot:{ pt:'pontos no snapshot', en:'points in snapshot', es:'puntos en snapshot', ru:'точек в снимке' },
  patinetesLabel:{ pt:'patinetes', en:'scooters', es:'patinetes', ru:'самокатов' },
  semSnapshot:   { pt:'sem snapshot', en:'no snapshot', es:'sin snapshot', ru:'нет снимка' },
  minAtras:      { pt:'atrás', en:'ago', es:'atrás', ru:'назад' },
  identCidade:   { pt:'🔑 Identificação da Cidade', en:'🔑 City Identification', es:'🔑 Identificación de la Ciudad', ru:'🔑 Идентификация города' },
  cityIdLabel:   { pt:'cityId (API GoJet)', en:'cityId (GoJet API)', es:'cityId (API GoJet)', ru:'cityId (API GoJet)' },
  cityIdPlaceholder: { pt:'Ex: 5f3a2b1c-... (ID da cidade na API GoJet)', en:'Ex: 5f3a2b1c-... (city ID in GoJet API)', es:'Ej: 5f3a2b1c-... (ID de la ciudad en la API GoJet)', ru:'Напр.: 5f3a2b1c-... (ID города в API GoJet)' },
  encontreEm:    { pt:'Encontre em:', en:'Find at:', es:'Encuentre en:', ru:'Найдите по:' },
  ativoScraper:  { pt:'✓ Ativo — scraper coletando dados', en:'✓ Active — scraper collecting data', es:'✓ Activo — scraper recopilando datos', ru:'✓ Активен — сбор данных' },
  inativoLabel:  { pt:'Inativo', en:'Inactive', es:'Inactivo', ru:'Неактивен' },
  limiaresClass: { pt:'📊 Limiares de Classificação', en:'📊 Classification Thresholds', es:'📊 Umbrales de Clasificación', ru:'📊 Пороги классификации' },
  baixoTarget:   { pt:'🟡 Baixo (% do target)', en:'🟡 Low (% of target)', es:'🟡 Bajo (% del target)', ru:'🟡 Низкий (% от цели)' },
  baixoDesc:     { pt:'ponto "baixo" quando avail', en:'"low" point when avail', es:'punto "bajo" cuando avail', ru:'точка "низкая" когда avail' },
  excessoTarget: { pt:'🟢 Excesso (% do target)', en:'🟢 Surplus (% of target)', es:'🟢 Exceso (% del target)', ru:'🟢 Избыток (% от цели)' },
  excessoDesc:   { pt:'ponto "excesso" quando avail ≥ target × N%', en:'"surplus" point when avail ≥ target × N%', es:'punto "exceso" cuando avail ≥ target × N%', ru:'точка "избыток" когда avail ≥ target × N%' },
  bateriaPct:    { pt:'⚡ Bateria (%)', en:'⚡ Battery (%)', es:'⚡ Batería (%)', ru:'⚡ Батарея (%)' },
  bateriaDesc:   { pt:'gera slot charger quando bat', en:'creates charger slot when bat', es:'genera turno charger cuando bat', ru:'создаёт слот зарядки когда bat' },
  bateriaCritPct:{ pt:'⚡ Bateria crítica ⚠️ (%)', en:'⚡ Critical battery ⚠️ (%)', es:'⚡ Batería crítica ⚠️ (%)', ru:'⚡ Критический заряд ⚠️ (%)' },
  bateriaCritDesc:{ pt:'slot urgente quando bat', en:'urgent slot when bat', es:'turno urgente cuando bat', ru:'срочный слот когда bat' },
  automacaoTarefas:{ pt:'🤖 Automação de Tarefas', en:'🤖 Task Automation', es:'🤖 Automatización de Tareas', ru:'🤖 Автоматизация задач' },
  autoGerarSlots:{ pt:'Gerar slots automaticamente (a cada 15min)', en:'Generate slots automatically (every 15min)', es:'Generar turnos automáticamente (cada 15min)', ru:'Создавать слоты автоматически (каждые 15 мин)' },
  apenasMonitor: { pt:'Apenas pontos com flag Monitor', en:'Only points with Monitor flag', es:'Solo puntos con flag Monitor', ru:'Только точки с флагом Monitor' },
  notificarGestorTg: { pt:'Notificar gestor via Telegram ao criar slot', en:'Notify manager via Telegram when creating slot', es:'Notificar al gestor por Telegram al crear turno', ru:'Уведомлять менеджера в Telegram при создании слота' },
  configGoJetSalva: { pt:'✓ Configuração salva', en:'✓ Settings saved', es:'✓ Configuración guardada', ru:'✓ Настройки сохранены' },
  salvarGoJet:   { pt:'✓ Salvar configuração GoJet', en:'✓ Save GoJet settings', es:'✓ Guardar configuración GoJet', ru:'✓ Сохранить настройки GoJet' },
} satisfies Record<string, L>;

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg:'rgba(13,18,30,1)', sur:'rgba(13,18,30,.97)', card:'rgba(22,28,40,.95)',
  bdr:'rgba(255,255,255,.08)', bdr2:'rgba(255,255,255,.04)',
  blueg:'linear-gradient(135deg,#1a6fd4,#307FE2)',
  blue:'#1a6fd4', bluel:'#307FE2',
  green:'#10b981', red:'#ef4444', yellow:'#f59e0b', yellowl:'#fbbf24',
  purple:'#7c3aed', orange:'#f97316',
  txt:'#e2e8f0', dim:'#8a96b0', dim2:'#94a3b8', blur:'blur(12px)',
};

const S = {
  panel:{ position:'fixed' as const, inset:0, zIndex:4500, background:T.bg, backdropFilter:T.blur, display:'flex', flexDirection:'column' as const, fontFamily:"'Inter',-apple-system,sans-serif" },
  header:{ background:T.sur, backdropFilter:T.blur, borderBottom:`1px solid ${T.bdr}`, padding:'10px 18px', display:'flex', alignItems:'center', gap:12, flexShrink:0, flexWrap:'wrap' as const },
  logo:{ width:36, height:36, borderRadius:10, background:T.blueg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 },
  tabs:{ background:T.sur, borderBottom:`1px solid ${T.bdr}`, display:'flex', overflowX:'auto' as const, flexShrink:0, scrollbarWidth:'none' as const },
  tab:(a:boolean):React.CSSProperties=>({ padding:'10px 15px', fontSize:12, fontWeight:600, color:a?T.bluel:T.dim, cursor:'pointer', background:'none', border:'none', borderBottom:`2px solid ${a?T.bluel:'transparent'}`, whiteSpace:'nowrap', flexShrink:0, transition:'all .15s' }),
  body:{ flex:1, overflowY:'auto' as const, padding:'16px 20px', scrollbarWidth:'thin' as const },
  card:(ac?:string):React.CSSProperties=>({ background:T.card, border:`1px solid ${ac?ac+'33':T.bdr}`, borderTop:`2px solid ${ac||T.bdr}`, borderRadius:12, padding:'14px 16px' }),
  kpiRow:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' as const },
  kpi:(c:string):React.CSSProperties=>({ flex:1, minWidth:80, background:T.card, border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, borderRadius:12, padding:'12px 14px' }),
  kpiN:(c:string):React.CSSProperties=>({ fontSize:26, fontWeight:800, color:c, lineHeight:1 }),
  kpiL:{ fontSize:10, color:T.dim, marginTop:3, textTransform:'uppercase' as const, letterSpacing:'0.4px' },
  inp:{ width:'100%', padding:'8px 10px', borderRadius:8, boxSizing:'border-box' as const, background:'rgba(255,255,255,.04)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:13, outline:'none', marginBottom:8 },
  inpSm:{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,.06)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:12, outline:'none' },
  lbl:{ display:'block' as const, fontSize:10, fontWeight:600, color:'rgba(255,255,255,.35)', marginBottom:4, textTransform:'uppercase' as const, letterSpacing:'0.6px' },
  btn:(c?:string,ghost=false):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:ghost?`1px solid ${T.bdr}`:'none', background:ghost?'transparent':(c||T.blueg), color:ghost?T.dim2:'#fff', fontWeight:600, fontSize:12, cursor:'pointer', transition:'all .15s' }),
  btnG:(g:string):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:'none', background:g, color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer' }),
  chip:(c:string):React.CSSProperties=>({ display:'inline-block', padding:'2px 8px', borderRadius:20, background:c+'18', color:c, fontSize:10, fontWeight:700, border:`1px solid ${c}33` }),
  sec:{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase' as const, letterSpacing:'1px', marginBottom:10 } as React.CSSProperties,
  table:{ width:'100%', borderCollapse:'collapse' as const },
  th:{ padding:'9px 12px', fontSize:10, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase' as const, color:T.dim, borderBottom:`1px solid ${T.bdr}`, textAlign:'left' as const, whiteSpace:'nowrap' as const },
  td:{ padding:'9px 12px', fontSize:12, borderBottom:`1px solid ${T.bdr2}` },
  modal:{ position:'fixed' as const, inset:0, zIndex:5000, background:'rgba(0,0,0,.75)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  mCard:{ background:'#0d1521', border:`1px solid ${T.bdr}`, borderRadius:14, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' as const },
  mHdr:{ padding:'14px 18px', borderBottom:`1px solid ${T.bdr}`, display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky' as const, top:0, background:'#0d1521', zIndex:1 },
  g2:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

import { getEdgeCallable } from '../lib/edge-functions';
function fnBridge(name: string) {
  const e = getEdgeCallable(name);
  if (e) return e();
  throw new Error(`[fnBridge] função não mapeada: ${name}`);
}
const hoje   = () => new Date().toLocaleDateString('pt-BR');
const amanha  = () => new Date(Date.now()+86400000).toLocaleDateString('pt-BR');

function fmtTs(ts:any,short=false):string {
  if(!ts) return '—';
  const d=ts?.toDate?.()??new Date(ts);
  if(isNaN(d.getTime())) return '—';
  return short?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function mAtras(ts:any):number { if(!ts)return 9999; const d=ts?.toDate?.()??new Date(ts); return Math.floor((Date.now()-d.getTime())/60000); }
function distKm(la1:number,ln1:number,la2:number,ln2:number){const R=6371,dL=(la2-la1)*Math.PI/180,dN=(ln2-ln1)*Math.PI/180;const a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function diasRest(s:string):number { if(!s)return 0; return Math.max(0,Math.ceil((new Date(s+'T23:59:59').getTime()-Date.now())/86400000)); }
function isSusp(m:MEI):boolean { return !!m.suspensoAte&&new Date(m.suspensoAte+'T23:59:59')>=new Date(); }
function toast(msg:string,tipo:'ok'|'erro'='ok'){
  const el=document.createElement('div');
  el.textContent=(tipo==='ok'?'✅ ':'❌ ')+msg;
  Object.assign(el.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'9999',background:tipo==='ok'?'linear-gradient(135deg,#10b981,#059669)':'linear-gradient(135deg,#ef4444,#dc2626)',color:'#fff',padding:'10px 18px',borderRadius:'10px',fontWeight:'700',fontSize:'13px',boxShadow:'0 4px 20px rgba(0,0,0,.5)',transition:'opacity .4s',fontFamily:"'Inter',sans-serif"});
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),400);},3000);
}
async function loadXLSX():Promise<any>{const w=window as any;if(w.XLSX)return w.XLSX;await new Promise<void>((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=()=>res();s.onerror=()=>rej();document.head.appendChild(s);});return w.XLSX;}
async function loadJsPDF():Promise<any>{const w=window as any;if(w.jspdf?.jsPDF)return w.jspdf.jsPDF;await new Promise<void>((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=()=>res();s.onerror=()=>rej();document.head.appendChild(s);});return w.jspdf.jsPDF;}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TURNOS=['T1','T2','T0'];
const STATUS_FUNC=['ATIVO','ATESTADO','AFASTAMENTO','DEMITIDO','SE DEMITIU','SUMIU'];
const FUNCOES=['Charger','Scout','Scalt','Motorista','Promotor','Fiscal'];
const DIAS_SEM=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const ROLES_ADMIN=['admin','supergestor'];

const ABAS_ALL:{id:AbaId;trKey:keyof typeof TR;soAdmin?:boolean}[]=[
  {id:'dashboard', trKey:'abaDashboard' },{id:'command_center', trKey:'abaCommandCenter'},{id:'comparativo', trKey:'abaComparativo', soAdmin:true},
  {id:'presenca',   trKey:'abaPresenca'  },
  {id:'operadores',trKey:'abaOperadores'},{id:'slots',      trKey:'abaSlots'      },
  {id:'tarefas',   trKey:'abaTarefas'   },{id:'desempenho', trKey:'abaDesempenho'},
  {id:'meis',      trKey:'abaMeis'      },{id:'clt',        trKey:'abaClt'        },
  {id:'inventario',  trKey:'abaInventario' },{id:'telegram',     trKey:'abaTelegram',   soAdmin:true},
  {id:'alertas',     trKey:'abaAlertas',   soAdmin:true},
  {id:'config',      trKey:'abaConfig',    soAdmin:true},
  {id:'calendario',     trKey:'abaCalendario',   soAdmin:true},
  {id:'exportar',       trKey:'abaExportar',     soAdmin:true},
  {id:'gojet_config',  trKey:'abaGoJet',        soAdmin:true},
  {id:'rastreamento',  trKey:'abaRastreamento', soAdmin:false},
  {id:'heatmap',       trKey:'abaHeatmap',      soAdmin:true},
];

// ─── Hook: cidades disponíveis para o usuário ──────────────────────────────────

function useCidadesDisponiveis(usuario: Usuario): string[] {
  const [cidades, setCidades] = useState<string[]>([]);
  useEffect(() => {
    if (ROLES_ADMIN.includes(usuario.role) || usuario.role === 'gestor') {
      fetchCidadesEstacoes().then(setCidades).catch(() => {});
    } else if (usuario.cidadesGerenciaLog?.length) {
      setCidades(usuario.cidadesGerenciaLog);
    }
  }, [usuario.uid]);
  return cidades;
}

// ─── Seletor de cidade (topo do painel) ───────────────────────────────────────

function CidadeSelector({
  usuario, cidadeAtiva, onChange, cidadesDisponiveis,
}: {
  usuario: Usuario; cidadeAtiva: string; onChange: (c: string) => void; cidadesDisponiveis: string[];
}) {
  const { pick } = useT();
  const isAdmin = ROLES_ADMIN.includes(usuario.role) || usuario.role === 'gestor';

  if (!isAdmin) {
    // Gestor de cidade específica — sem dropdown, só exibe
    return (
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 12px',background:'rgba(26,111,212,.15)',borderRadius:8,border:'1px solid rgba(26,111,212,.3)'}}>
        <span style={{fontSize:11,color:T.dim}}>{pick(TR.cidade)}</span>
        <span style={{fontWeight:700,fontSize:13,color:T.bluel}}>{cidadeAtiva||'—'}</span>
      </div>
    );
  }

  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <span style={{fontSize:11,color:T.dim,flexShrink:0}}>📍 {pick(TR.cidade)}</span>
      <select
        value={cidadeAtiva}
        onChange={e => onChange(e.target.value)}
        style={{...S.inpSm, width:'auto', minWidth:140, marginBottom:0, colorScheme:'dark', appearance:'none' as const}}
      >
        {isAdmin && <option value="">{pick(TR.todasCidades)}</option>}
        {cidadesDisponiveis.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {cidadeAtiva && (
        <button onClick={() => onChange('')} aria-label={pick(TR.todasCidades)} style={{...S.btn(undefined,true),padding:'4px 8px',fontSize:10}}>✕</button>
      )}
    </div>
  );
}

// ─── RAIZ ─────────────────────────────────────────────────────────────────────

export default function GestorLogisticaPanel({usuario, onFechar, cidade: cidadeInicial}: Props) {
  const { pick } = useT();
  const [aba, setAba] = useState<AbaId>('dashboard');
  const cidadesDisp   = useCidadesDisponiveis(usuario);
  const isAdmin       = ROLES_ADMIN.includes(usuario.role) || usuario.role === 'gestor'; // gestor_log NOT included

  // Cidade ativa: admin pode mudar via dropdown; gestor fica travado na sua cidade
  const cidadeDefault = isAdmin
    ? (cidadeInicial || '')
    : (usuario.cidadesGerenciaLog?.[0] || cidadeInicial || '');

  const [cidadeAtiva, setCidadeAtiva] = useState(cidadeDefault);

  // Se gestor tem uma cidade só, trava ali
  useEffect(() => {
    if (!isAdmin && usuario.cidadesGerenciaLog?.length === 1) {
      setCidadeAtiva(usuario.cidadesGerenciaLog[0]);
    }
  }, [usuario.cidadesGerenciaLog]);

  const ctx = { usuario, cidade: cidadeAtiva, isAdmin };

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={S.logo}>🚚</div>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:T.txt}}>{pick(TR.titulo)}</div>
            <div style={{fontSize:11,color:T.dim}}>{usuario.role}</div>
          </div>
        </div>

        {/* Seletor de cidade */}
        <CidadeSelector
          usuario={usuario}
          cidadeAtiva={cidadeAtiva}
          onChange={setCidadeAtiva}
          cidadesDisponiveis={cidadesDisp}
        />

        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:11,color:T.dim}}>{usuario.nome}</span>
          <button onClick={onFechar} style={{...S.btn(undefined,true),padding:'6px 12px'}}>{pick(TR.fechar)}</button>
        </div>
      </div>

      {/* Abas */}
      <div style={S.tabs}>
        {ABAS_ALL.filter(a => !a.soAdmin || isAdmin).map(a=><button key={a.id} onClick={()=>setAba(a.id)} style={S.tab(aba===a.id)}>{pick(TR[a.trKey])}</button>)}
      </div>

      {/* Aviso sem cidade (admin sem cidade selecionada) */}
      {isAdmin && !cidadeAtiva && (
        <div style={{padding:'10px 20px',background:'rgba(245,158,11,.08)',borderBottom:`1px solid ${T.yellow}33`,fontSize:12,color:T.yellowl}}>
          ⚠️ {pick(TR.exibindoDados)} <b>{pick(TR.avisoTodas)}</b>. {pick(TR.selecioneCidade)}
        </div>
      )}

      {/* Conteúdo */}
      {(aba==='rastreamento'||aba==='heatmap') ? (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
          {aba==='rastreamento' &&<LiveTrackingMap cidade={cidadeAtiva} usuario={usuario}/>}
          {aba==='heatmap'      &&<div style={{...S.body}}><GpsHeatmapPanel cidade={cidadeAtiva}/></div>}
        </div>
      ) : (
        <div style={S.body}>
          {aba==='dashboard'  &&<AbaDashboard  {...ctx}/>}
          {aba==='command_center' && <CommandCenter cidade={cidadeAtiva} />}
          {aba==='presenca'   &&<AbaPresenca   {...ctx}/>}
          {aba==='operadores' &&<AbaOperadores {...ctx}/>}
          {aba==='slots'      &&<AbaSlots      {...ctx}/>}
          {aba==='tarefas'    &&<AbaTarefas    {...ctx}/>}
          {aba==='desempenho' &&<AbaDesempenho {...ctx}/>}
          {aba==='meis'       &&<AbaMEIs       {...ctx}/>}
          {aba==='clt'        &&<AbaCLT        {...ctx}/>}
          {aba==='inventario' &&<AbaInventario {...ctx}/>}
          {aba==='alertas'      &&<AbaAlertas      {...ctx}/>}
          {aba==='telegram'     &&<AbaTelegram     {...ctx}/>}
          {aba==='config'       &&<AbaConfig       {...ctx}/>}
          {aba==='calendario'   && <CalendarioOpsEspeciais cidade={cidadeAtiva} usuario={usuario} />}
          {aba==='exportar'     && <ExportPanel cidade={cidadeAtiva} />}
          {aba==='comparativo' && <ComparativoCidades />}
          {aba==='gojet_config' &&<AbaGoJetConfig  {...ctx}/>}
        </div>
      )}
    </div>
  );
}

// ─── Props compartilhadas ─────────────────────────────────────────────────────

interface AbaProps { usuario: Usuario; cidade: string; isAdmin: boolean; }

// (qCidade removed — Supabase queries handle city filtering inline)

// ═══════════════════════════════════════════════════════════════════════════════
// ABA DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function AbaDashboard({usuario,cidade,isAdmin}:AbaProps){
  const { pick, haMin } = useT();
  const [tarefas,setTarefas]=useState<TarefaLogistica[]>([]);
  const [workers,setWorkers]=useState<GpsWorker[]>([]);
  const [slots,  setSlots  ]=useState<Slot[]>([]);
  const [aceites,setAceites]=useState<SlotAceite[]>([]);
  const [clima,  setClima  ]=useState<ClimaPrev|null>(null);

  useEffect(()=>{
    const u1=subscribeTarefas({cidade,status:['pendente','em_andamento'],limit:200},t=>setTarefas(t as TarefaLogistica[]));
    const u2=subscribeGpsLogistica({cidade,minutos:30},w=>setWorkers(w as GpsWorker[]));
    const u3=subscribeSlotsGestor({cidade,limit:100},s=>setSlots((s as Slot[]).filter(sl=>sl.dataSlot===hoje())));
    const u4=subscribeAceites(a=>setAceites(a as SlotAceite[]));
    // Clima
    navigator.geolocation?.getCurrentPosition(pos=>{
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current_weather=true&hourly=precipitation_probability&forecast_days=1`)
        .then(r=>r.json()).then(data=>{const w=data.current_weather;const chuva=(data.hourly?.precipitation_probability?.[new Date().getHours()]||0)>50;const em:Record<number,string>={0:'☀️',1:'🌤',2:'⛅',3:'☁️',61:'🌧',80:'🌦',95:'⛈'};setClima({temp:Math.round(w.temperature),descricao:chuva?'Chuva prevista':'Tempo bom',emoji:em[w.weathercode]||'🌡',chuva});}).catch(()=>{});
    });
    return()=>{u1();u2();u3();u4();};
  },[cidade]);

  const online  =workers.filter(w=>mAtras(w.atualizadoEm)<30).length;
  const pend    =tarefas.filter(t=>t.status==='pendente').length;
  const andamento=tarefas.filter(t=>t.status==='em_andamento').length;
  const semResp =tarefas.filter(t=>!t.responsavelId).length;
  const vagH    =slots.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acH     =aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status!=='Desistiu');
  const iniH    =acH.filter(a=>a.status==='Iniciou').length;
  const fltH    =acH.filter(a=>a.status==='Faltou').length;
  const abertas =Math.max(0,vagH-acH.length);

  return(
    <div>
      {clima&&<div style={{...S.card(clima.chuva?T.yellow:T.green),marginBottom:14,display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:28}}>{clima.emoji}</span><div><div style={{fontWeight:700,fontSize:14,color:T.txt}}>{clima.temp}°C — {clima.chuva?pick(TR.chuvaPrevista):pick(TR.tempoBom)}</div><div style={{fontSize:11,color:T.dim}}>{clima.chuva?pick(TR.alertarChuva):pick(TR.condFavoraveis)}</div></div></div>}
      <div style={S.kpiRow}>
        {[
          {n:online,   l:pick(TR.kpiOnline),c:online>0?T.green:T.dim        },
          {n:pend,     l:pick(TR.kpiPendentes),   c:pend>0?T.yellow:T.green        },
          {n:andamento,l:pick(TR.kpiAndamento),c:T.bluel                         },
          {n:semResp,  l:pick(TR.kpiSemResp),   c:semResp>0?T.red:T.green        },
          {n:`${acH.length}/${vagH}`,l:pick(TR.kpiVagasHoje),c:T.purple           },
          {n:iniH,     l:pick(TR.kpiIniciou),     c:T.green                         },
          {n:fltH,     l:pick(TR.kpiFaltou),      c:fltH>0?T.red:T.green           },
          {n:abertas,  l:pick(TR.kpiAbertas),     c:abertas>0?T.yellow:T.green     },
        ].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={S.card(T.green)}>
          <div style={S.sec}>{pick(TR.onlineAgora)}</div>
          {workers.length===0&&<div style={{color:T.dim,fontSize:12}}>{pick(TR.nenhumOperOnline)}</div>}
          {workers.slice(0,8).map(w=>{const min=mAtras(w.atualizadoEm);const c=min<5?T.green:min<15?T.yellowl:T.orange;return(
            <div key={w.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:c,flexShrink:0}}/>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:T.txt}}>{w.nome||w.uid.slice(-6)}</div><div style={{fontSize:10,color:T.dim}}>{min<1?pick(TR.agora):haMin(min)}</div></div>
              {w.lat&&w.lng&&<a href={`https://maps.google.com/?q=${w.lat},${w.lng}`} target="_blank" rel="noreferrer" style={{fontSize:14,textDecoration:'none'}}>🗺</a>}
            </div>
          );})}
        </div>
        <div style={S.card(T.yellow)}>
          <div style={S.sec}>{pick(TR.semResponsavel)} ({semResp})</div>
          {tarefas.filter(t=>!t.responsavelId).slice(0,6).map(t=>(
            <div key={t.id} style={{padding:'7px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{fontSize:12,fontWeight:600,color:T.yellowl}}>{t.tipo}</div>
              <div style={{fontSize:11,color:T.dim}}>{t.endereco||t.titulo||t.id.slice(-6)}</div>
            </div>
          ))}
          {semResp===0&&<div style={{fontSize:12,color:T.green}}>{pick(TR.todasTemResp)}</div>}
        </div>
      </div>
      <div style={{...S.card(T.purple),marginTop:14}}>
        <div style={S.sec}>{pick(TR.slotsHoje)}{cidade&&` — ${cidade}`} — {hoje()}</div>
        {slots.length===0?<div style={{color:T.dim,fontSize:12}}>{pick(TR.nenhumSlot)}</div>:(
          <div style={{overflowX:'auto'}}>
            <table style={S.table}>
              <thead><tr>{[pick(TR.turno),pick(TR.colHorario),pick(TR.zona),pick(TR.tipo),pick(TR.colVagas),pick(TR.colAceites),pick(TR.kpiIniciou),pick(TR.kpiFaltou),pick(TR.colAbertas)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{slots.map(sl=>{const slAc=aceites.filter(a=>a.slotId===sl.id&&a.status!=='Desistiu');const slI=slAc.filter(a=>a.status==='Iniciou').length;const slF=slAc.filter(a=>a.status==='Faltou').length;const slAb=Math.max(0,sl.qtdPessoas-slAc.length);return(
                <tr key={sl.id}>
                  <td style={S.td}><b>{sl.turno}</b></td><td style={S.td}>{sl.horaIni}–{sl.horaFim}</td><td style={S.td}>{sl.zona}</td>
                  <td style={S.td}><span style={S.chip(sl.tipo==='Charger'?T.yellow:T.green)}>{sl.tipo||'—'}</span></td>
                  <td style={{...S.td,textAlign:'center'}}>{sl.qtdPessoas}</td><td style={{...S.td,textAlign:'center'}}>{slAc.length}</td>
                  <td style={{...S.td,textAlign:'center',color:T.green}}>{slI}</td><td style={{...S.td,textAlign:'center',color:slF>0?T.red:T.dim}}>{slF}</td>
                  <td style={S.td}><span style={S.chip(slAb>0?T.yellow:T.green)}>{slAb>0?`${slAb} ${pick(TR.abAbrev)}`:pick(TR.ok)}</span></td>
                </tr>);})}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA PRESENÇA
// ═══════════════════════════════════════════════════════════════════════════════

function AbaPresenca({cidade}:AbaProps){
  const { pick } = useT();
  const [turnos, setTurnos]=useState<TurnoLog[]>([]);
  const [clt,    setClt   ]=useState<any[]>([]);
  const [slots,  setSlots ]=useState<Slot[]>([]);
  const [aceites,setAceites]=useState<SlotAceite[]>([]);
  const [filtro, setFiltro]=useState<'todos'|'vieram'|'faltaram'|'folga'>('todos');

  useEffect(()=>{
    const ini=new Date(); ini.setHours(0,0,0,0);
    let vivo=true;
    carregarTurnosLogisticaSupabase(ini.toISOString())
      .then(rows=>{ if(vivo) setTurnos(rows as TurnoLog[]); })
      .catch(err=>console.error('[logistica-turnos] Supabase', err));
    const u1=()=>{vivo=false;};
    fetchUsuarios({ role_in: ['campo','logistica','charger','scalt','promotor'] }).then(users=>setClt(users.map(u=>({...u,id:u.uid}))));
    const u3=subscribeSlotsGestor({cidade,limit:100},s=>setSlots((s as Slot[]).filter(sl=>sl.dataSlot===hoje())));
    const u4=subscribeAceites(a=>setAceites(a as SlotAceite[]));
    return()=>{u1();u3();u4();};
  },[cidade]);

  const cltFilt = cidade ? clt.filter((f:any)=>!f.cidade||f.cidade===cidade) : clt;
  const diaSem=new Date().getDay();
  const horAtual=new Date().getHours()*60+new Date().getMinutes();
  const tIni:Record<string,number>={T1:7*60,T2:15*60,T0:23*60};

  interface CLTItem{f:any;status:'veio'|'faltou'|'folga'|'aguardando';tlog?:TurnoLog;}
  const cltItems:CLTItem[]=cltFilt.map(f=>{
    const dF=DIAS_SEM.indexOf(f.diaFolga||'');
    if(dF===diaSem)return{f,status:'folga'};
    const tlog=turnos.find(t=>t.uid===f.id||t.uid===f.uid);
    if(tlog)return{f,status:'veio',tlog};
    const ini=tIni[f.turno]||0;
    const jaDevia=f.turno==='T0'?(horAtual>=23*60||horAtual<=7*60+30):(horAtual>=ini+30);
    return{f,status:jaDevia?'faltou':'aguardando'};
  });

  const filtrados=cltItems.filter(i=>filtro==='todos'||(filtro==='vieram'&&i.status==='veio')||(filtro==='faltaram'&&i.status==='faltou')||(filtro==='folga'&&i.status==='folga'));
  const meiPres=aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)).map(a=>({...a,turno:slots.find(s=>s.id===a.slotId)?.turno||''}));
  const nVieram=cltItems.filter(i=>i.status==='veio').length;
  const nFaltou=cltItems.filter(i=>i.status==='faltou').length;
  const nFolga =cltItems.filter(i=>i.status==='folga').length;
  const corSt=(s:string)=>s==='veio'?T.green:s==='faltou'?T.red:s==='folga'?T.dim:T.yellow;
  const lbSt =(s:string)=>s==='veio'?pick(TR.stVeio):s==='faltou'?pick(TR.stFaltou):s==='folga'?pick(TR.stFolga):pick(TR.stAguardando);

  return(
    <div>
      <div style={S.kpiRow}>
        {[{n:nVieram,l:pick(TR.cltVieram),c:T.green},{n:nFaltou,l:pick(TR.cltFaltaram),c:nFaltou>0?T.red:T.green},{n:nFolga,l:pick(TR.cltFolga),c:T.dim},{n:meiPres.filter(m=>m.status==='Iniciou').length,l:pick(TR.meiIniciou),c:T.purple},{n:meiPres.filter(m=>m.status==='Faltou').length,l:pick(TR.meiFaltou),c:T.red},{n:turnos.filter(t=>t.acao==='inicio').length,l:pick(TR.pontosHoje),c:T.bluel}].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {(['todos','vieram','faltaram','folga'] as const).map(f=><button key={f} onClick={()=>setFiltro(f)} style={{...S.btn(T.bluel,filtro!==f),padding:'6px 12px',fontSize:11}}>{f==='todos'?pick(TR.fTodos):f==='vieram'?pick(TR.fVieram):f==='faltaram'?pick(TR.fFaltaram):pick(TR.fFolga)}</button>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={S.card()}>
          <div style={S.sec}>👷 CLT — {filtrados.length}</div>
          <div style={{overflowX:'auto'}}>
            <table style={S.table}>
              <thead><tr>{[pick(TR.nome),pick(TR.turno),pick(TR.funcaoCol),pick(TR.status),pick(TR.pontoCol)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {filtrados.length===0&&<tr><td colSpan={5} style={{...S.td,textAlign:'center',padding:30,color:T.dim}}>{pick(TR.nenhumResultado)}</td></tr>}
                {filtrados.map(({f,status,tlog})=>(
                  <tr key={f.id||f.cpf}><td style={{...S.td,fontWeight:600}}>{f.nome}</td><td style={S.td}>{f.turno}</td><td style={S.td}>{f.funcao}</td><td style={S.td}><span style={S.chip(corSt(status))}>{lbSt(status)}</span></td><td style={{...S.td,fontSize:11,color:T.dim}}>{tlog?fmtTs(tlog.criadoEm,true):'—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={S.card(T.purple)}>
          <div style={S.sec}>{pick(TR.meiSlotsHoje)}</div>
          <table style={S.table}>
            <thead><tr>{[pick(TR.nome),pick(TR.turno),pick(TR.status)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {meiPres.length===0&&<tr><td colSpan={3} style={{...S.td,textAlign:'center',padding:30,color:T.dim}}>{pick(TR.nenhumAceite)}</td></tr>}
              {meiPres.map((m,i)=>{const c=m.status==='Iniciou'?T.green:m.status==='Faltou'?T.red:m.status==='Atrasado'?T.orange:T.yellow;return<tr key={i}><td style={{...S.td,fontWeight:600}}>{m.nome}</td><td style={S.td}>{m.turno}</td><td style={S.td}><span style={S.chip(c)}>{m.status}</span></td></tr>;})}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{...S.card(),marginTop:14}}>
        <div style={S.sec}>{pick(TR.registrosPonto)} ({turnos.length})</div>
        <div style={{overflowX:'auto',maxHeight:260,overflowY:'auto'}}>
          <table style={S.table}>
            <thead><tr>{[pick(TR.colHora),pick(TR.nome),pick(TR.colAcao),pick(TR.colFoto)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {turnos.length===0&&<tr><td colSpan={4} style={{...S.td,textAlign:'center',padding:30,color:T.dim}}>{pick(TR.nenhumPonto)}</td></tr>}
              {turnos.map(t=><tr key={t.id}><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{fmtTs(t.criadoEm,true)}</td><td style={{...S.td,fontWeight:600}}>{t.nome}</td><td style={S.td}><span style={S.chip(t.acao==='inicio'?T.green:T.orange)}>{t.acao==='inicio'?pick(TR.acaoInicio):pick(TR.acaoFim)}</span></td><td style={S.td}>{t.fotoUrl?<a href={t.fotoUrl} target="_blank" rel="noreferrer" style={{color:T.bluel,fontSize:11}}>{pick(TR.verFoto)}</a>:<span style={{color:T.dim,fontSize:11}}>—</span>}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA OPERADORES
// ═══════════════════════════════════════════════════════════════════════════════

function AbaOperadores({usuario,cidade}:AbaProps){
  const { pick, haMin } = useT();
  const [workers,setWorkers]=useState<GpsWorker[]>([]);
  const [tarefas,setTarefas]=useState<TarefaLogistica[]>([]);
  const [sel,    setSel    ]=useState<GpsWorker|null>(null);
  const [hist,   setHist   ]=useState<any[]>([]);
  const [busca,  setBusca  ]=useState('');

  useEffect(()=>{
    const u1=subscribeGpsLogistica({cidade,minutos:60,intervaloMs:10000},w=>setWorkers(w as GpsWorker[]));
    const u2=subscribeTarefas({cidade,status:['pendente','em_andamento'],limit:200},t=>setTarefas(t as TarefaLogistica[]));
    return()=>{u1();u2();};
  },[cidade]);

  useEffect(()=>{
    if(!sel){setHist([]);return;}
    fetchGpsHistSupa(sel.uid, 8).then(pts => setHist(pts)).catch(() => {});
  },[sel]);

  const filtrados=useMemo(()=>workers.filter(w=>!busca||(w.nome||'').toLowerCase().includes(busca.toLowerCase())).sort((a,b)=>mAtras(a.atualizadoEm)-mAtras(b.atualizadoEm)),[workers,busca]);
  const semResp=tarefas.filter(t=>!t.responsavelId);
  function melhor(t:TarefaLogistica):GpsWorker|null{if(!t.lat||!t.lng)return null;const d=workers.filter(w=>mAtras(w.atualizadoEm)<30);if(!d.length)return null;return d.reduce((b,w)=>distKm(t.lat!,t.lng!,b.lat,b.lng)>distKm(t.lat!,t.lng!,w.lat,w.lng)?w:b);}

  return(
    <div>
      <PrestadorStatusPanel cidade={cidade} />
      <div style={{height:14}}/>
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder={pick(TR.buscarOperador)} style={{...S.inp,marginBottom:0,flex:1}}/>
        <span style={{fontSize:12,color:T.dim,alignSelf:'center'}}>{filtrados.length} {pick(TR.operadores)}{cidade&&` · ${cidade}`}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div>
          {filtrados.map(w=>{const min=mAtras(w.atualizadoEm);const c=min<5?T.green:min<15?T.yellowl:min<30?T.orange:T.dim;const isSel=sel?.uid===w.uid;return(
            <div key={w.uid} onClick={()=>setSel(isSel?null:w)} style={{...S.card(),marginBottom:8,cursor:'pointer',borderColor:isSel?T.bluel:T.bdr,background:isSel?'rgba(26,111,212,.08)':T.card}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:c,flexShrink:0}}/>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:T.txt}}>{w.nome||w.uid.slice(-8)}</div><div style={{fontSize:10,color:T.dim}}>GPS: {min<1?pick(TR.agora):haMin(min)}</div></div>
                {w.lat&&w.lng&&<a href={`https://maps.google.com/?q=${w.lat},${w.lng}`} target="_blank" rel="noreferrer" style={{fontSize:16,textDecoration:'none'}} onClick={e=>e.stopPropagation()}>🗺</a>}
              </div>
            </div>
          );})}
          {filtrados.length===0&&<div style={{color:T.dim,fontSize:12}}>{pick(TR.nenhumOperOnline)}</div>}
        </div>
        <div>
          {sel?(
            <>
              <div style={S.card(T.bluel)}>
                <div style={S.sec}>📍 {sel.nome||sel.uid.slice(-8)}</div>
                <div style={{fontSize:12,color:T.dim,marginBottom:10}}>GPS: {mAtras(sel.atualizadoEm)<1?pick(TR.agora):haMin(mAtras(sel.atualizadoEm))}<br/>{sel.lat?.toFixed(5)}, {sel.lng?.toFixed(5)}</div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  {sel.lat&&sel.lng&&<><a href={`https://www.google.com/maps/dir/?api=1&destination=${sel.lat},${sel.lng}`} target="_blank" rel="noreferrer" style={{...S.btnG(T.blueg),textDecoration:'none',fontSize:12}}>🗺 Maps</a><a href={`waze://?ll=${sel.lat},${sel.lng}&navigate=yes`} style={{...S.btnG('linear-gradient(135deg,#00b5d8,#0097b2)'),textDecoration:'none',fontSize:12}}>🚗 Waze</a></>}
                </div>
                {hist.length>0&&(<>
                  <div style={{...S.sec,marginTop:6}}>{pick(TR.gpsHist)} — {hist.length} {pick(TR.pts)}</div>
                  <div style={{maxHeight:120,overflowY:'auto',fontSize:10,color:T.dim,fontFamily:'monospace'}}>
                    {hist.map((g:any,i:number)=><div key={i} style={{padding:'2px 0',borderBottom:`1px solid ${T.bdr2}`}}>{fmtTs(g.criadoEm,true)} — {g.lat?.toFixed(4)},{g.lng?.toFixed(4)}{i>0&&` (${distKm(hist[i-1].lat,hist[i-1].lng,g.lat,g.lng).toFixed(2)}km)`}</div>)}
                  </div>
                  <div style={{fontSize:10,color:T.orange,marginTop:4}}>{pick(TR.spoofingAviso)}</div>
                </>)}
              </div>
              <div style={{...S.card(),marginTop:10}}>
                <div style={S.sec}>{pick(TR.atribuirTarefa)}</div>
                {semResp.slice(0,4).map(t=><div key={t.id} style={{...S.card(),marginBottom:6}}><div style={{fontSize:11,fontWeight:600,color:T.yellowl}}>{t.tipo}</div><div style={{fontSize:11,color:T.dim,marginBottom:6}}>{t.endereco||t.titulo||''}</div><button onClick={async()=>{await updateTarefa(t.id,{responsavelId:sel.uid,responsavelNome:sel.nome||sel.uid,status:'em_andamento'});toast(`${pick(TR.atribuidoA)} ${sel.nome||sel.uid}`);}} style={{...S.btnG(T.blueg),padding:'5px 10px',fontSize:11}}>{pick(TR.atribuir)}</button></div>)}
                {semResp.length===0&&<div style={{fontSize:12,color:T.green}}>{pick(TR.semTarefasSemResp)}</div>}
              </div>
            </>
          ):(
            <div style={S.card()}>
              <div style={S.sec}>{pick(TR.sugestaoAuto)}</div>
              {semResp.slice(0,4).map(t=>{const m=melhor(t);return(
                <div key={t.id} style={{...S.card(),marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:T.yellowl}}>{t.tipo}</div>
                  <div style={{fontSize:11,color:T.dim}}>{t.endereco||t.titulo||''}</div>
                  {m&&<div style={{fontSize:10,color:T.green,marginTop:4}}>{pick(TR.sugerido)} {m.nome||m.uid.slice(-6)} ({distKm(t.lat||0,t.lng||0,m.lat,m.lng).toFixed(1)}km)</div>}
                  {m&&<button style={{...S.btnG(T.blueg),marginTop:6,fontSize:11,padding:'4px 10px'}} onClick={async()=>{await updateTarefa(t.id,{responsavelId:m.uid,responsavelNome:m.nome||m.uid,status:'em_andamento'});toast(`${pick(TR.atribuidoA)} ${m.nome||m.uid}`);}}>{pick(TR.atribuir)}</button>}
                </div>
              );})}
              {semResp.length===0&&<div style={{fontSize:12,color:T.green}}>{pick(TR.semTarefasSemResp)}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA SLOTS
// ═══════════════════════════════════════════════════════════════════════════════

function AbaSlots({usuario,cidade}:AbaProps){
  const { pick } = useT();
  const [slots,   setSlots  ]=useState<Slot[]>([]);
  const [aceites, setAceites]=useState<SlotAceite[]>([]);
  const [dia,     setDia    ]=useState<'hoje'|'amanha'>('hoje');
  const [modal,   setModal  ]=useState(false);
  const [lote,    setLote   ]=useState(false);
  const [salvando,setSalvando]=useState(false);
  const [clima,   setClima  ]=useState<ClimaPrev|null>(null);
  const [loteForm,setLoteForm]=useState({tipos:['Scout','Charger'],turnos:['T1','T2'],zona:'',qtd:2,dataAlvo:'amanha' as 'hoje'|'amanha',T1ini:'07:00',T1fim:'15:00',T2ini:'15:00',T2fim:'23:00',T0ini:'23:00',T0fim:'07:00',confMin:120,reabrMin:90});
  const [sf,setSf]=useState({turno:'T1',horaIni:'07:00',horaFim:'15:00',zona:'',tipo:'Scout',qtdPessoas:2,dataSlot:'',confMin:120,reabrMin:90});

  useEffect(()=>{
    const u1=subscribeSlotsGestor({cidade,limit:150},s=>setSlots(s as Slot[]));
    const u2=subscribeAceites(a=>setAceites(a as SlotAceite[]));
    navigator.geolocation?.getCurrentPosition(pos=>{
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current_weather=true&forecast_days=2&hourly=precipitation_probability`)
        .then(r=>r.json()).then(data=>{const w=data.current_weather;const am=data.hourly?.precipitation_probability?.slice(24,48)||[];const chuva=am.some((p:number)=>p>60);const em:Record<number,string>={0:'☀️',1:'🌤',2:'⛅',3:'☁️',61:'🌧',95:'⛈'};setClima({temp:Math.round(w.temperature),descricao:chuva?'Chuva amanhã':'OK para amanhã',emoji:chuva?'🌧':em[w.weathercode]||'☀️',chuva});}).catch(()=>{});
    });
    return()=>{u1();u2();};
  },[cidade]);

  const diaStr=dia==='hoje'?hoje():amanha();
  const filtrados=slots.filter(s=>s.dataSlot===diaStr);
  const vagT=filtrados.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acD=aceites.filter(a=>filtrados.some(s=>s.id===a.slotId)&&a.status!=='Desistiu');
  const ini=acD.filter(a=>a.status==='Iniciou').length;
  const flt=acD.filter(a=>a.status==='Faltou').length;
  const ab=Math.max(0,vagT-acD.length);

  const porTurno:Record<string,{vagas:number;aceites:number}>={};
  filtrados.forEach(sl=>{if(!porTurno[sl.turno])porTurno[sl.turno]={vagas:0,aceites:0};porTurno[sl.turno].vagas+=sl.qtdPessoas||0;porTurno[sl.turno].aceites+=aceites.filter(a=>a.slotId===sl.id&&a.status!=='Desistiu').length;});

  const cidadeSlot = cidade || 'SP';

  const criarLote=async()=>{
    if(!loteForm.zona||!loteForm.turnos.length||!loteForm.tipos.length){toast(pick(TR.preenchaZonaTurnos),'erro');return;}
    setSalvando(true);
    const dataStr=loteForm.dataAlvo==='hoje'?hoje():amanha();
    const hor:Record<string,{ini:string;fim:string}>={T1:{ini:loteForm.T1ini,fim:loteForm.T1fim},T2:{ini:loteForm.T2ini,fim:loteForm.T2fim},T0:{ini:loteForm.T0ini,fim:loteForm.T0fim}};
    let n=0;
    for(const turno of loteForm.turnos){for(const tipo of loteForm.tipos){await criarSlot({turno,turnoLabel:`${turno} — ${hor[turno].ini} às ${hor[turno].fim}`,horaIni:hor[turno].ini,horaFim:hor[turno].fim,zona:loteForm.zona,tipo,qtdPessoas:loteForm.qtd,status:'Aberto',dataSlot:dataStr,cidade:cidadeSlot,confMin:loteForm.confMin,reabrMin:loteForm.reabrMin,criadoPorId:usuario.uid,criadoPorNome:usuario.nome} as Record<string, unknown>);n++;}}
    toast(`${n} ${pick(TR.slotsCriados)} ${cidadeSlot}`);setSalvando(false);setLote(false);
  };

  const criarSlotLocal=async()=>{
    if(!sf.zona||!sf.dataSlot){toast(pick(TR.preenchaZonaData),'erro');return;}
    setSalvando(true);
    await criarSlot({...sf,status:'Aberto',cidade:cidadeSlot,turnoLabel:`${sf.turno} — ${sf.horaIni} às ${sf.horaFim}`,criadoPorId:usuario.uid,criadoPorNome:usuario.nome} as Record<string, unknown>);
    toast(pick(TR.slotCriado));setSalvando(false);setModal(false);
  };

  const scor=(s:string)=>s==='Iniciou'?T.green:s==='Atrasado'?T.orange:s==='Faltou'?T.red:s==='Veio'?T.green:s==='Desistiu'?T.dim:T.bluel;

  return(
    <div>
      {clima?.chuva&&<div style={{...S.card(T.yellow),marginBottom:12,display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:22}}>🌧</span><div><div style={{fontWeight:700,fontSize:13,color:T.yellowl}}>{pick(TR.chuvaAmanha)}</div><div style={{fontSize:11,color:T.dim}}>{pick(TR.reduzaScout)}</div></div></div>}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        {(['hoje','amanha'] as const).map(d=><button key={d} onClick={()=>setDia(d)} style={{...S.btn(T.bluel,dia!==d),padding:'7px 14px'}}>{d==='hoje'?`${pick(TR.hojeLabel)} (${hoje()})`:`${pick(TR.amanhaLabel)} (${amanha()})`}</button>)}
        <span style={{fontSize:11,color:T.dim}}>📍 {cidadeSlot}</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button onClick={()=>{setLote(true);setModal(false);}} style={{...S.btnG('linear-gradient(135deg,#7c3aed,#a855f7)'),fontSize:12}}>{pick(TR.loteBtn)}</button>
          <button onClick={()=>{setModal(true);setLote(false);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>{pick(TR.novoSlotBtn)}</button>
        </div>
      </div>
      <div style={S.kpiRow}>
        {[{n:filtrados.length,l:pick(TR.kpiSlots),c:T.purple},{n:vagT,l:pick(TR.colVagas),c:T.bluel},{n:acD.length,l:pick(TR.colAceites),c:'#60a5fa'},{n:ini,l:pick(TR.kpiIniciou),c:T.green},{n:flt,l:pick(TR.kpiFaltou),c:flt>0?T.red:T.dim},{n:ab,l:pick(TR.kpiAbertas),c:ab>0?T.yellow:T.green}].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>

      {Object.keys(porTurno).length>0&&(
        <div style={{...S.card(),marginBottom:14}}>
          <div style={S.sec}>{pick(TR.preenchTurno)}</div>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {Object.entries(porTurno).map(([t,d])=>{const pct=d.vagas>0?Math.round(d.aceites/d.vagas*100):0;const c=pct>=80?T.green:pct>=50?T.yellowl:T.red;return(
              <div key={t} style={{flex:1,minWidth:100}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><b style={{color:T.txt}}>{t}</b><span style={{color:c}}>{pct}%</span></div>
                <div style={{height:8,background:T.bdr,borderRadius:4,overflow:'hidden'}}><div style={{width:`${pct}%`,height:'100%',background:c,borderRadius:4,transition:'width .5s'}}/></div>
                <div style={{fontSize:10,color:T.dim,marginTop:3}}>{d.aceites}/{d.vagas}</div>
              </div>
            );})}
          </div>
        </div>
      )}

      {filtrados.length===0?<div style={{color:T.dim,fontSize:13,textAlign:'center',padding:40}}>{pick(TR.nenhumSlotPara)} {diaStr}</div>:filtrados.map(sl=>{
        const slAc=aceites.filter(a=>a.slotId===sl.id);const slAb=Math.max(0,sl.qtdPessoas-slAc.filter(a=>a.status!=='Desistiu').length);
        return(
          <div key={sl.id} style={{...S.card(),marginBottom:12}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:8}}>
              <div style={{flex:1}}><span style={{...S.chip(T.purple),marginRight:6}}>{sl.turno}</span><span style={{...S.chip(T.bluel),marginRight:6}}>{sl.horaIni}–{sl.horaFim}</span><span style={{...S.chip(sl.tipo==='Charger'?T.yellow:T.green),marginRight:6}}>{sl.tipo||'—'}</span><b style={{color:T.txt}}>{sl.zona}</b></div>
              <span style={S.chip(slAb>0?T.yellow:T.green)}>{slAb>0?`${slAb} ${pick(TR.vagasLabel)}`:pick(TR.completo)}</span>
              <button onClick={async()=>{if(await confirmDialog(pick(TR.excluir), '', {variant:'danger'}))await deleteSlot(sl.id);}} style={{...S.btn(T.red,true),padding:'3px 7px',fontSize:11}}>🗑</button>
            </div>
            {slAc.length===0?<div style={{fontSize:11,color:T.dim}}>{pick(TR.semAceites)}</div>:(
              <table style={{...S.table,fontSize:11}}>
                <thead><tr>{[pick(TR.nome),pick(TR.status),pick(TR.colAceitoEm),pick(TR.colAcao)].map(h=><th key={h} style={{...S.th,fontSize:9}}>{h}</th>)}</tr></thead>
                <tbody>{slAc.map(a=><tr key={a.id}><td style={S.td}>{a.nome}</td><td style={S.td}><span style={S.chip(scor(a.status))}>{a.status}</span></td><td style={{...S.td,fontSize:10,color:T.dim}}>{fmtTs(a.aceitoEm,true)}</td><td style={S.td}><select value={a.status} onChange={async e=>{await updateAceiteStatus(a.id,e.target.value);toast(`→ ${e.target.value}`);}} style={{...S.inp,marginBottom:0,padding:'3px 6px',width:'auto',fontSize:11}}>{['Pendente','Iniciou','Atrasado','Faltou','Veio','Desistiu'].map(s=><option key={s} value={s}>{s}</option>)}</select></td></tr>)}</tbody>
              </table>
            )}
          </div>
        );
      })}

      {lote&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setLote(false);}}>
        <div style={{...S.mCard,maxWidth:600}}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{pick(TR.criarLoteTit)} — {cidadeSlot}</div><button onClick={()=>setLote(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            {clima?.chuva&&<div style={{...S.card(T.yellow),marginBottom:12,fontSize:12,color:T.yellowl}}>{pick(TR.chuvaReduza)}</div>}
            <div style={S.g2}>
              <div><label style={S.lbl}>{pick(TR.data)}</label><select value={loteForm.dataAlvo} onChange={e=>setLoteForm(f=>({...f,dataAlvo:e.target.value as any}))} style={S.inp}><option value="hoje">{pick(TR.hojeLabel)} ({hoje()})</option><option value="amanha">{pick(TR.amanhaLabel)} ({amanha()})</option></select></div>
              <div><label style={S.lbl}>{pick(TR.zonaObrig)}</label><input value={loteForm.zona} onChange={e=>setLoteForm(f=>({...f,zona:e.target.value}))} style={S.inp} placeholder={pick(TR.zonaPlaceholder)}/></div>
              <div><label style={S.lbl}>{pick(TR.vagasPorSlot)}</label><input type="number" min={1} max={20} value={loteForm.qtd} onChange={e=>setLoteForm(f=>({...f,qtd:parseInt(e.target.value)||1}))} style={S.inp}/></div>
              <div><label style={S.lbl}>{pick(TR.confirmarMinAntes)}</label><input type="number" min={30} max={480} value={loteForm.confMin} onChange={e=>setLoteForm(f=>({...f,confMin:parseInt(e.target.value)||120}))} style={S.inp}/></div>
            </div>
            <label style={S.lbl}>{pick(TR.turnos)}</label>
            <div style={{display:'flex',gap:6,marginBottom:10}}>{TURNOS.map(t=>{const s=loteForm.turnos.includes(t);return<button key={t} onClick={()=>setLoteForm(f=>({...f,turnos:s?f.turnos.filter(x=>x!==t):[...f.turnos,t]}))} style={{...S.btn(T.bluel,!s),padding:'6px 14px'}}>{t}</button>;})}</div>
            <label style={S.lbl}>{pick(TR.tipos)}</label>
            <div style={{display:'flex',gap:6,marginBottom:14}}>{['Scout','Charger','Scalt'].map(t=>{const s=loteForm.tipos.includes(t);const c=t==='Charger'?T.yellow:t==='Scalt'?T.purple:T.green;return<button key={t} onClick={()=>setLoteForm(f=>({...f,tipos:s?f.tipos.filter(x=>x!==t):[...f.tipos,t]}))} style={{...S.btn(c,!s),padding:'6px 14px'}}>{t}</button>;})}</div>
            {loteForm.turnos.includes('T1')&&<div style={{...S.card(),marginBottom:8}}><div style={{...S.sec,marginBottom:6}}>{pick(TR.t1Manha)}</div><div style={S.g2}><div><label style={S.lbl}>{pick(TR.inicio)}</label><input type="time" value={loteForm.T1ini} onChange={e=>setLoteForm(f=>({...f,T1ini:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>{pick(TR.fim)}</label><input type="time" value={loteForm.T1fim} onChange={e=>setLoteForm(f=>({...f,T1fim:e.target.value}))} style={S.inp}/></div></div></div>}
            {loteForm.turnos.includes('T2')&&<div style={{...S.card(),marginBottom:8}}><div style={{...S.sec,marginBottom:6}}>{pick(TR.t2Tarde)}</div><div style={S.g2}><div><label style={S.lbl}>{pick(TR.inicio)}</label><input type="time" value={loteForm.T2ini} onChange={e=>setLoteForm(f=>({...f,T2ini:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>{pick(TR.fim)}</label><input type="time" value={loteForm.T2fim} onChange={e=>setLoteForm(f=>({...f,T2fim:e.target.value}))} style={S.inp}/></div></div></div>}
            {loteForm.turnos.includes('T0')&&<div style={{...S.card(),marginBottom:8}}><div style={{...S.sec,marginBottom:6}}>{pick(TR.t0Noite)}</div><div style={S.g2}><div><label style={S.lbl}>{pick(TR.inicio)}</label><input type="time" value={loteForm.T0ini} onChange={e=>setLoteForm(f=>({...f,T0ini:e.target.value}))} style={S.inp}/></div><div><label style={S.lbl}>{pick(TR.fim)}</label><input type="time" value={loteForm.T0fim} onChange={e=>setLoteForm(f=>({...f,T0fim:e.target.value}))} style={S.inp}/></div></div></div>}
            <div style={{...S.card(T.bluel),marginBottom:12,fontSize:12,color:T.dim}}>{pick(TR.seraoCriados)} <b style={{color:T.txt}}>{loteForm.turnos.length*loteForm.tipos.length}</b> {pick(TR.slotsEm)} <b style={{color:T.bluel}}>{cidadeSlot}</b> — {loteForm.zona||pick(TR.semZona)}</div>
            <button onClick={criarLote} disabled={salvando} style={{...S.btnG('linear-gradient(135deg,#7c3aed,#a855f7)'),width:'100%',padding:'10px'}}>{salvando?pick(TR.criando):pick(TR.criarTodos)}</button>
          </div>
        </div>
      </div>}

      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={S.mCard}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{pick(TR.criarSlotTit)} — {cidadeSlot}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            <div style={S.g2}>
              <div><label style={S.lbl}>{pick(TR.turno)}</label><select value={sf.turno} onChange={e=>setSf(f=>({...f,turno:e.target.value}))} style={S.inp}>{TURNOS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div><label style={S.lbl}>{pick(TR.tipo)}</label><select value={sf.tipo} onChange={e=>setSf(f=>({...f,tipo:e.target.value}))} style={S.inp}>{['Scout','Charger','Scalt'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div><label style={S.lbl}>{pick(TR.inicio)}</label><input type="time" value={sf.horaIni} onChange={e=>setSf(f=>({...f,horaIni:e.target.value}))} style={S.inp}/></div>
              <div><label style={S.lbl}>{pick(TR.fim)}</label><input type="time" value={sf.horaFim} onChange={e=>setSf(f=>({...f,horaFim:e.target.value}))} style={S.inp}/></div>
              <div><label style={S.lbl}>{pick(TR.confirmarMin)}</label><input type="number" min={30} value={sf.confMin} onChange={e=>setSf(f=>({...f,confMin:parseInt(e.target.value)||120}))} style={S.inp}/></div>
              <div><label style={S.lbl}>{pick(TR.reabrirSemConf)}</label><input type="number" min={15} value={sf.reabrMin} onChange={e=>setSf(f=>({...f,reabrMin:parseInt(e.target.value)||90}))} style={S.inp}/></div>
            </div>
            <label style={S.lbl}>{pick(TR.zonaObrig)}</label><input value={sf.zona} onChange={e=>setSf(f=>({...f,zona:e.target.value}))} style={S.inp}/>
            <label style={S.lbl}>{pick(TR.dataObrig)}</label><input type="date" onChange={e=>setSf(f=>({...f,dataSlot:new Date(e.target.value+'T12:00:00').toLocaleDateString('pt-BR')}))} style={S.inp}/>
            <label style={S.lbl}>{pick(TR.colVagas)}</label><input type="number" min={1} max={20} value={sf.qtdPessoas} onChange={e=>setSf(f=>({...f,qtdPessoas:parseInt(e.target.value)||1}))} style={S.inp}/>
            <button onClick={criarSlotLocal} disabled={salvando} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),width:'100%',marginTop:4}}>{salvando?pick(TR.criando):pick(TR.criarSlotBtn)}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA TAREFAS
// ═══════════════════════════════════════════════════════════════════════════════

function AbaTarefas({usuario,cidade}:AbaProps){
  const { pick } = useT();
  const [tarefas,setTarefas]=useState<TarefaLogistica[]>([]);
  const [workers,setWorkers]=useState<GpsWorker[]>([]);
  const [filtroSt,setFiltroSt]=useState('pendente');
  const [filtroTp,setFiltroTp]=useState('todos');
  const [sel,setSel]=useState<TarefaLogistica|null>(null);

  useEffect(()=>{
    const u1=subscribeTarefas({cidade,limit:400},t=>setTarefas(t as TarefaLogistica[]));
    const u2=subscribeGpsLogistica({cidade,minutos:30},w=>setWorkers(w as GpsWorker[]));
    return()=>{u1();u2();};
  },[cidade]);

  const tipos=['todos',...Array.from(new Set(tarefas.map(t=>t.tipo)))];
  const filtradas=useMemo(()=>tarefas.filter(t=>(filtroSt==='todas'||t.status===filtroSt)&&(filtroTp==='todos'||t.tipo===filtroTp)),[tarefas,filtroSt,filtroTp]);
  const por=(s:string)=>tarefas.filter(t=>t.status===s).length;
  const stCor=(s:string)=>s==='concluida'?T.green:s==='em_andamento'?T.bluel:s==='pendente'?T.yellow:T.dim;
  const tpCor=(t:string)=>t==='CARGA_BATERIA'?T.yellow:t==='PONTO'?T.green:t==='PATINETE'?T.bluel:T.dim;

  const expXLSX=async()=>{const XLSX=await loadXLSX();const data=filtradas.map(t=>({[pick(TR.tipo)]:t.tipo,[pick(TR.status)]:t.status,[pick(TR.colTitulo)]:t.titulo||'',[pick(TR.colEndereco)]:t.endereco||'',[pick(TR.colResponsavel)]:t.responsavelNome||'',[pick(TR.cidadeCol)]:t.cidade||'',[pick(TR.colCriadoEm)]:fmtTs(t.criadoEm)}));const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,pick(TR.tarefasTit));XLSX.writeFile(wb,`tarefas_${cidade||'all'}_${new Date().toISOString().slice(0,10)}.xlsx`);toast(pick(TR.xlsxExportado));};
  const expPDF=async()=>{const JsPDF=await loadJsPDF();const pdf=new JsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text(`${pick(TR.tarefasTit)} — ${cidade||pick(TR.todasCidades)}`,14,15);pdf.setFontSize(9);filtradas.slice(0,100).forEach((t,i)=>pdf.text(`${i+1}. [${t.tipo}] ${t.status} — ${t.endereco||t.titulo||''} — ${t.responsavelNome||pick(TR.semResp)}`,14,25+i*6));pdf.save(`tarefas_${new Date().toISOString().slice(0,10)}.pdf`);toast(pick(TR.pdfExportado));};

  return(
    <div>
      <div style={S.kpiRow}>
        {[{n:por('pendente'),l:pick(TR.kpiPendentes),c:T.yellow,st:'pendente'},{n:por('em_andamento'),l:pick(TR.kpiAndamento),c:T.bluel,st:'em_andamento'},{n:por('concluida'),l:pick(TR.kpiConcluidas),c:T.green,st:'concluida'},{n:por('cancelada'),l:pick(TR.kpiCanceladas),c:T.dim,st:'cancelada'},{n:tarefas.length,l:pick(TR.kpiTotal),c:T.bluel,st:'todas'}].map(({n,l,c,st})=>(
          <div key={l} style={{...S.kpi(c),cursor:'pointer',borderColor:filtroSt===st?c:T.bdr}} onClick={()=>setFiltroSt(st)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>
        ))}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{tipos.map(t=><button key={t} onClick={()=>setFiltroTp(t)} style={{...S.btn(tpCor(t),filtroTp!==t),padding:'5px 10px',fontSize:11}}>{t==='todos'?pick(TR.todosTipos):t}</button>)}</div>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={expXLSX} style={{...S.btn(T.green,true),padding:'6px 10px',fontSize:11}}>📊 XLSX</button>
          <button onClick={expPDF}  style={{...S.btn(T.red,true),  padding:'6px 10px',fontSize:11}}>📄 PDF</button>
        </div>
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={{...S.table,minWidth:900}}>
          <thead><tr>{[pick(TR.tipo),pick(TR.status),pick(TR.colTitulo),pick(TR.colEndereco),pick(TR.cidadeCol),pick(TR.colResponsavel),pick(TR.colCriadoEm),pick(TR.acoes)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtradas.length===0&&<tr><td colSpan={8} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TR.nenhumaTarefa)}</td></tr>}
            {filtradas.map(t=>(
              <tr key={t.id}>
                <td style={S.td}><span style={S.chip(tpCor(t.tipo))}>{t.tipo}</span></td>
                <td style={S.td}><span style={S.chip(stCor(t.status))}>{t.status}</span></td>
                <td style={{...S.td,maxWidth:160}}><div style={{fontWeight:600,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:T.txt}}>{t.titulo||t.descricao?.slice(0,40)||'—'}</div></td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{t.endereco||'—'}</td>
                <td style={{...S.td,fontSize:11}}>{t.cidade||'—'}</td>
                <td style={S.td}>{t.responsavelNome||<span style={{color:T.red,fontSize:11}}>{pick(TR.semResp)}</span>}</td>
                <td style={{...S.td,fontSize:11}}>{fmtTs(t.criadoEm,true)}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>setSel(t)} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  {t.status!=='cancelada'&&t.status!=='concluida'&&<button onClick={async()=>{await updateTarefa(t.id,{status:'cancelada'});toast(pick(TR.cancelada));}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>✕</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setSel(null);}}>
        <div style={S.mCard}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{pick(TR.reatribuir)} {sel.tipo}</div><button onClick={()=>setSel(null)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            <div style={S.sec}>{pick(TR.operadoresOnline)} — {cidade||pick(TR.todos)}</div>
            {workers.length===0&&<div style={{color:T.dim,fontSize:12}}>{pick(TR.nenhumOperOnline)}</div>}
            {workers.map(w=>(
              <div key={w.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:`1px solid ${T.bdr2}`}}>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:12}}>{w.nome||w.uid.slice(-8)}</div><div style={{fontSize:10,color:T.dim}}>{mAtras(w.atualizadoEm)}min{sel.lat&&sel.lng&&w.lat&&w.lng&&` · ${distKm(sel.lat,sel.lng,w.lat,w.lng).toFixed(1)}km`}</div></div>
                <button onClick={async()=>{await updateTarefa(sel.id,{responsavelId:w.uid,responsavelNome:w.nome||w.uid,status:'em_andamento'});toast(`${pick(TR.atribuidoA)} ${w.nome||w.uid}`);setSel(null);}} style={{...S.btnG(T.blueg),fontSize:11}}>{pick(TR.atribuir)}</button>
              </div>
            ))}
          </div>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA DESEMPENHO
// ═══════════════════════════════════════════════════════════════════════════════

function AbaDesempenho({cidade}:AbaProps){
  const { pick } = useT();
  const [subtab,setSubtab]=useState<'ranking'|'heatmap'|'eficiencias'>('ranking');
  const [dados,  setDados  ]=useState<any[]>([]);
  const [efics,  setEfics  ]=useState<Eficiencia[]>([]);
  const [dataIni,setDataIni]=useState('');
  const [dataFim,setDataFim]=useState('');
  const [loading,setLoading]=useState(true);
  const [modal,  setModal  ]=useState(false);
  const [opers,  setOpers  ]=useState<{uid:string;nome:string}[]>([]);
  const [ef,     setEf     ]=useState<Partial<Eficiencia>>({uid:'',nome:'',data:'',cidade:cidade||'',movimentacoes:0,baterias:0,obs:''});

  const carregar=useCallback(async()=>{
    setLoading(true);
    const ts=await fetchTarefas({cidade,status:['concluida'],limit:1000});
    const ini=dataIni?new Date(dataIni+'T00:00:00'):new Date(Date.now()-7*86400000);
    const fim=dataFim?new Date(dataFim+'T23:59:59'):new Date();
    const filtered=ts.filter((t:any)=>{const d=new Date(t.criadoEm);return d>=ini&&d<=fim;});
    const mapa:Record<string,{nome:string;dias:Record<string,{mov:number;bat:number}>}>={};
    filtered.forEach((t:any)=>{if(!t.responsavelId)return;if(!mapa[t.responsavelId])mapa[t.responsavelId]={nome:t.responsavelNome||t.responsavelId,dias:{}};const dia=new Date(t.criadoEm).toLocaleDateString('pt-BR');if(!mapa[t.responsavelId].dias[dia])mapa[t.responsavelId].dias[dia]={mov:0,bat:0};if(t.tipo==='CARGA_BATERIA')mapa[t.responsavelId].dias[dia].bat++;else mapa[t.responsavelId].dias[dia].mov++;});
    setDados(Object.entries(mapa).map(([uid,v])=>({uid,nome:v.nome,totalMov:Object.values(v.dias).reduce((s,d)=>s+d.mov,0),totalBat:Object.values(v.dias).reduce((s,d)=>s+d.bat,0),dias:v.dias})).sort((a,b)=>(b.totalMov+b.totalBat)-(a.totalMov+a.totalBat)));
    setLoading(false);
  },[cidade,dataIni,dataFim]);

  useEffect(()=>{carregar();},[carregar]);
  useEffect(()=>{
    const u=subscribeEficiencias(cidade,e=>setEfics(e as Eficiencia[]));
    fetchUsuarios().then(users=>setOpers(users.map((u:any)=>({uid:u.uid,nome:u.nome||u.uid})).slice(0,80)));
    return u;
  },[cidade]);

  const datas=useMemo(()=>{const set=new Set<string>();dados.forEach(p=>Object.keys(p.dias).forEach(d=>set.add(d)));return Array.from(set).sort((a,b)=>{const p=(s:string)=>{const[d,m,y]=s.split('/').map(Number);return new Date(y,m-1,d).getTime();};return p(a)-p(b);});},[dados]);
  const maxVal=useMemo(()=>{let max=1;dados.forEach(p=>Object.values(p.dias as any).forEach((d:any)=>{if(d.mov+d.bat>max)max=d.mov+d.bat;}));return max;},[dados]);
  const corHeat=(n:number)=>{if(!n)return 'transparent';const p=n/maxVal;return p<.3?'rgba(26,111,212,.2)':p<.6?'rgba(26,111,212,.5)':p<.9?'rgba(26,111,212,.8)':'#1a6fd4';};

  const expXLSX=async()=>{const XLSX=await loadXLSX();const rows=dados.map((p,i)=>({'#':i+1,[pick(TR.nome)]:p.nome,[pick(TR.colMovs)]:p.totalMov,[pick(TR.colBaterias)]:p.totalBat,[pick(TR.kpiTotal)]:p.totalMov+p.totalBat,[pick(TR.cidadeCol)]:cidade||pick(TR.todasLabel)}));const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,pick(TR.abaDesempenho).replace(/^[^\w]+/,''));XLSX.writeFile(wb,`desempenho_${cidade||'all'}_${new Date().toISOString().slice(0,10)}.xlsx`);toast(pick(TR.xlsxExportado));};
  const expPDF=async()=>{const JsPDF=await loadJsPDF();const pdf=new JsPDF();pdf.setFontSize(14);pdf.text(`${pick(TR.rankingDesemp)} — ${cidade||pick(TR.todasLabel)}`,14,15);pdf.setFontSize(9);dados.forEach((p,i)=>pdf.text(`${i+1}. ${p.nome} — ${p.totalMov+p.totalBat} ${pick(TR.kpiTotal).toLowerCase()}`,14,25+i*7));pdf.save(`desempenho_${new Date().toISOString().slice(0,10)}.pdf`);toast(pick(TR.pdfExportado));};
  const salvarEf=async()=>{if(!ef.nome||!ef.data){toast(pick(TR.nomeDataObrig),'erro');return;}await criarEficiencia({...ef,cidade:cidade||'SP'});toast(pick(TR.registrado));setModal(false);setEf({uid:'',nome:'',data:'',cidade:cidade||'',movimentacoes:0,baterias:0,obs:''}); };

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'flex-end',flexWrap:'wrap'}}>
        <div><label style={S.lbl}>{pick(TR.de)}</label><input type="date" value={dataIni} onChange={e=>setDataIni(e.target.value)} style={{...S.inp,marginBottom:0,width:150}}/></div>
        <div><label style={S.lbl}>{pick(TR.ate)}</label><input type="date" value={dataFim} onChange={e=>setDataFim(e.target.value)} style={{...S.inp,marginBottom:0,width:150}}/></div>
        <button onClick={carregar} style={{...S.btnG(T.blueg)}}>{pick(TR.atualizar)}</button>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          {(['ranking','heatmap','eficiencias'] as const).map(s=><button key={s} onClick={()=>setSubtab(s)} style={{...S.btn(T.bluel,subtab!==s),padding:'7px 12px'}}>{s==='ranking'?pick(TR.subRanking):s==='heatmap'?pick(TR.subHeatmap):pick(TR.subEficiencias)}</button>)}
          <button onClick={expXLSX} style={{...S.btn(T.green,true),padding:'7px 10px',fontSize:11}}>📊 XLSX</button>
          <button onClick={expPDF}  style={{...S.btn(T.red,true),  padding:'7px 10px',fontSize:11}}>📄 PDF</button>
        </div>
      </div>
      {loading&&<div style={{color:T.dim,textAlign:'center',padding:40}}>{pick(TR.carregando)}</div>}
      {!loading&&subtab==='ranking'&&(
        <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
          <table style={S.table}>
            <thead><tr>{['#',pick(TR.colOperador),pick(TR.colMovs),pick(TR.colBaterias),pick(TR.kpiTotal),pick(TR.colBarra)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {dados.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TR.semDadosPeriodo)}</td></tr>}
              {dados.map((p,i)=>{const total=p.totalMov+p.totalBat;const maxT=dados[0]?dados[0].totalMov+dados[0].totalBat:1;const pct=maxT>0?total/maxT*100:0;const med=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';return(
                <tr key={p.uid}><td style={{...S.td,fontWeight:800,color:i<3?T.yellowl:T.dim}}>{med||i+1}</td><td style={{...S.td,fontWeight:600}}>{p.nome}</td><td style={S.td}>{p.totalMov}</td><td style={S.td}>{p.totalBat}</td><td style={{...S.td,fontWeight:700,color:T.bluel}}>{total}</td><td style={{...S.td,minWidth:120}}><div style={{height:8,borderRadius:4,background:T.bdr,overflow:'hidden'}}><div style={{width:`${pct}%`,height:'100%',background:T.blueg,borderRadius:4}}/></div></td></tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
      {!loading&&subtab==='heatmap'&&(
        <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
          <table style={{...S.table,minWidth:100+datas.length*60}}>
            <thead><tr><th style={{...S.th,minWidth:140}}>{pick(TR.colOperador)}</th>{datas.map(d=><th key={d} style={{...S.th,textAlign:'center'}}>{d.slice(0,5)}</th>)}<th style={{...S.th,textAlign:'center'}}>{pick(TR.kpiTotal)}</th></tr></thead>
            <tbody>{dados.map(p=><tr key={p.uid}><td style={{...S.td,fontWeight:600}}>{p.nome}</td>{datas.map(d=>{const dia=(p.dias as any)[d]||{mov:0,bat:0};const n=dia.mov+dia.bat;return<td key={d} style={{...S.td,textAlign:'center',background:corHeat(n),fontWeight:n>0?700:400}}>{n||''}</td>;})} <td style={{...S.td,textAlign:'center',fontWeight:700,color:T.bluel}}>{p.totalMov+p.totalBat}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {subtab==='eficiencias'&&(
        <div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}><button onClick={()=>setModal(true)} style={{...S.btnG(T.blueg)}}>{pick(TR.registrarEf)}</button></div>
          <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
            <table style={S.table}>
              <thead><tr>{[pick(TR.data),pick(TR.colOperador),pick(TR.colMovs),pick(TR.colBaterias),pick(TR.obs)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {efics.length===0&&<tr><td colSpan={5} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TR.nenhumaEf)}</td></tr>}
                {efics.map(e=><tr key={e.id}><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{e.data}</td><td style={{...S.td,fontWeight:600}}>{e.nome}</td><td style={{...S.td,color:T.bluel,fontWeight:700}}>{e.movimentacoes}</td><td style={{...S.td,color:T.yellowl,fontWeight:700}}>{e.baterias}</td><td style={{...S.td,fontSize:11,color:T.dim}}>{e.obs||'—'}</td></tr>)}
              </tbody>
            </table>
          </div>
          {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
            <div style={{...S.mCard,maxWidth:480}}>
              <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{pick(TR.registrarEfTit)} — {cidade||'SP'}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
              <div style={{padding:18}}>
                <label style={S.lbl}>{pick(TR.colOperador)}</label>
                <select value={ef.uid} onChange={e=>{const op=opers.find(o=>o.uid===e.target.value);setEf(f=>({...f,uid:e.target.value,nome:op?.nome||''}));}} style={S.inp}><option value="">{pick(TR.selecionar)}</option>{opers.map(o=><option key={o.uid} value={o.uid}>{o.nome}</option>)}</select>
                <label style={S.lbl}>{pick(TR.data)}</label><input type="date" onChange={e=>setEf(f=>({...f,data:new Date(e.target.value+'T12:00:00').toLocaleDateString('pt-BR')}))} style={S.inp}/>
                <div style={S.g2}>
                  <div><label style={S.lbl}>{pick(TR.movimentacoes)}</label><input type="number" min={0} value={ef.movimentacoes||0} onChange={e=>setEf(f=>({...f,movimentacoes:parseInt(e.target.value)||0}))} style={S.inp}/></div>
                  <div><label style={S.lbl}>{pick(TR.bateriasLabel)}</label><input type="number" min={0} value={ef.baterias||0} onChange={e=>setEf(f=>({...f,baterias:parseInt(e.target.value)||0}))} style={S.inp}/></div>
                </div>
                <label style={S.lbl}>{pick(TR.observacao)}</label><input value={ef.obs||''} onChange={e=>setEf(f=>({...f,obs:e.target.value}))} style={S.inp}/>
                <button onClick={salvarEf} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>{pick(TR.salvar)}</button>
              </div>
            </div>
          </div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA MEIs
// ═══════════════════════════════════════════════════════════════════════════════

function AbaMEIs({cidade}:AbaProps){
  const { pick } = useT();
  const [lista,   setLista  ]=useState<MEI[]>([]);
  const [busca,   setBusca  ]=useState('');
  const [filtroSt,setFiltroSt]=useState('ATIVO');
  const [modal,   setModal  ]=useState(false);
  const [edit,    setEdit   ]=useState<MEI|null>(null);
  const [form,    setForm   ]=useState<MEI>({nome:'',cpf:'',cnpj:'',status:'ATIVO'});
  const [suspForm,setSuspForm]=useState({ativo:false,inicio:'',ate:'',motivo:''});
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{
    const u=subscribeMeis(cidade,m=>setLista(m as MEI[]));
    return u;
  },[cidade]);

  const filtrados=useMemo(()=>lista.filter(m=>(filtroSt==='TODOS'||(filtroSt==='SUSPENSO'&&isSusp(m))||(!isSusp(m)&&m.status===filtroSt))&&(!busca||m.nome.toLowerCase().includes(busca.toLowerCase())||(m.cnpj||'').includes(busca))),[lista,busca,filtroSt]);
  const vencEm3=lista.filter(m=>isSusp(m)&&diasRest(m.suspensoAte||'')<=3);

  const salvar=async()=>{
    if(!form.nome?.trim()||!form.cnpj?.trim()){toast(pick(TR.nomeCnpjObrig),'erro');return;}
    setSalvando(true);
    const p:any={...form,cidade:cidade||'SP',suspensoInicio:suspForm.ativo?suspForm.inicio:'',suspensoAte:suspForm.ativo?suspForm.ate:'',motivoSuspensao:suspForm.ativo?suspForm.motivo:''};
    try{await upsertMei(p,edit?.id);toast(edit?pick(TR.meiAtualizado):pick(TR.meiCadastrado));setModal(false);}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  return(
    <div>
      {vencEm3.length>0&&<div style={{...S.card(T.orange),marginBottom:12}}><div style={{fontWeight:700,fontSize:12,color:T.orange,marginBottom:6}}>{pick(TR.suspVencendo)}</div>{vencEm3.map(m=><div key={m.id} style={{fontSize:11,color:T.dim,marginBottom:2}}>• <b style={{color:T.txt}}>{m.nome}</b> — <b style={{color:T.orange}}>{diasRest(m.suspensoAte||'')}d</b>{m.motivoSuspensao&&` (${m.motivoSuspensao})`}</div>)}</div>}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder={pick(TR.buscarNomeCnpj)} style={{...S.inp,marginBottom:0,flex:1}}/>
        <select value={filtroSt} onChange={e=>setFiltroSt(e.target.value)} style={{...S.inp,marginBottom:0,width:130}}><option value="TODOS">{pick(TR.todos)}</option><option value="ATIVO">{pick(TR.fAtivo)}</option><option value="SUSPENSO">{pick(TR.fSuspenso)}</option><option value="INATIVO">{pick(TR.fInativo)}</option></select>
        <button onClick={()=>{setEdit(null);setForm({nome:'',cpf:'',cnpj:'',status:'ATIVO'});setSuspForm({ativo:false,inicio:'',ate:'',motivo:''});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>{pick(TR.cadastrarMei)}</button>
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={{...S.table,minWidth:700}}>
          <thead><tr>{[pick(TR.nome),'CNPJ',pick(TR.status),pick(TR.colSuspensao),pick(TR.colDiasRest),pick(TR.cidadeCol),pick(TR.acoes)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtrados.length===0&&<tr><td colSpan={7} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TR.nenhumMei)}</td></tr>}
            {filtrados.map(m=>{const susp=isSusp(m);const dias=susp?diasRest(m.suspensoAte||''):0;const cSt=susp?T.orange:m.status==='ATIVO'?T.green:T.dim;return(
              <tr key={m.id||m.cnpj}>
                <td style={{...S.td,fontWeight:600}}>{m.nome}</td>
                <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{m.cnpj}</td>
                <td style={S.td}><span style={S.chip(cSt)}>{susp?pick(TR.suspensoLabel):m.status}</span></td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{susp?<span>{pick(TR.ateLabel)} {m.suspensoAte}{m.motivoSuspensao&&` — ${m.motivoSuspensao.slice(0,20)}`}</span>:'—'}</td>
                <td style={{...S.td,textAlign:'center'}}>{susp&&<span style={{fontWeight:700,color:dias<=3?T.red:T.orange}}>{dias}d</span>}{!susp&&'—'}</td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{m.cidade||cidade||'—'}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>{setEdit(m);setForm({...m});setSuspForm({ativo:!!(m.suspensoAte),inicio:m.suspensoInicio||'',ate:m.suspensoAte||'',motivo:m.motivoSuspensao||''});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  <button onClick={async()=>{if(m.id&&await confirmDialog(pick(TR.removerNome), m.nome+'?', {variant:'danger'})){await deleteMei(m.id);toast(pick(TR.removido));}}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={S.mCard}>
          <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{edit?`${pick(TR.editarPrefix)} ${edit.nome}`:pick(TR.cadastrarMei)}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
          <div style={{padding:18}}>
            <div style={S.g2}>
              <div><label style={S.lbl}>{pick(TR.nomeObrig)}</label><input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/></div>
              <div><label style={S.lbl}>CPF</label><input value={form.cpf} onChange={e=>setForm(f=>({...f,cpf:e.target.value}))} style={S.inp} placeholder="000.000.000-00"/></div>
              <div><label style={S.lbl}>{pick(TR.cnpjObrig)}</label><input value={form.cnpj} onChange={e=>setForm(f=>({...f,cnpj:e.target.value}))} style={S.inp} placeholder="00.000.000/0000-00"/></div>
              <div><label style={S.lbl}>{pick(TR.status)}</label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={S.inp}><option value="ATIVO">ATIVO</option><option value="INATIVO">INATIVO</option></select></div>
            </div>
            <div style={{...S.card(T.red),marginBottom:12}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:suspForm.ativo?10:0}}><input type="checkbox" checked={suspForm.ativo} onChange={e=>setSuspForm(s=>({...s,ativo:e.target.checked}))}/><span style={{fontSize:12,fontWeight:600}}>{pick(TR.suspTemporaria)}</span></label>
              {suspForm.ativo&&<div style={S.g2}>
                <div><label style={S.lbl}>{pick(TR.de)}</label><input type="date" value={suspForm.inicio} onChange={e=>setSuspForm(s=>({...s,inicio:e.target.value}))} style={S.inp}/></div>
                <div><label style={S.lbl}>{pick(TR.ate)}</label><input type="date" value={suspForm.ate} onChange={e=>setSuspForm(s=>({...s,ate:e.target.value}))} style={S.inp}/></div>
                {suspForm.inicio&&suspForm.ate&&<div style={{gridColumn:'1/-1',fontSize:11,color:T.orange}}>⏱ {diasRest(suspForm.ate)} {pick(TR.diasSusp)}</div>}
                <div style={{gridColumn:'1/-1'}}><label style={S.lbl}>{pick(TR.motivo)}</label><input value={suspForm.motivo} onChange={e=>setSuspForm(s=>({...s,motivo:e.target.value}))} style={S.inp} placeholder={pick(TR.motivoPlaceholder)}/></div>
              </div>}
            </div>
            <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%'}}>{salvando?pick(TR.salvando):edit?pick(TR.salvar):pick(TR.cadastrar)}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA CLT
// ═══════════════════════════════════════════════════════════════════════════════

function AbaCLT({cidade}:AbaProps){
  const { pick } = useT();
  const [lista,   setLista  ]=useState<any[]>([]);
  const [busca,   setBusca  ]=useState('');
  const [filtroSt,setFiltroSt]=useState('ATIVO');
  const [modal,   setModal  ]=useState(false);
  const [edit,    setEdit   ]=useState<any>(null);
  const [form,    setForm   ]=useState<Funcionario>({nome:'',cpf:'',cargo:'CLT',turno:'T1',funcao:'Scout',zona:'',status:'ATIVO',gerente:'',lider:'',telefone:'',dataAdmissao:'',escala:'',diaFolga:''});
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{
    let vivo=true;
    const carregar=()=>fetchUsuarios({ role_in: ['campo','logistica','charger','scalt','promotor'] }).then(users=>{ if(vivo) setLista(users.map((u:any)=>({...u,id:u.uid}))); });
    carregar();
    const iv=setInterval(carregar,30000);
    return()=>{vivo=false;clearInterval(iv);};
  },[]);
  const listaCidade = cidade ? lista.filter((f:any)=>!f.cidade||f.cidade===cidade) : lista;
  const filtrados=useMemo(()=>listaCidade.filter(f=>(filtroSt==='TODOS'||f.status===filtroSt)&&(!busca||f.nome?.toLowerCase().includes(busca.toLowerCase())||(f.cpf||'').includes(busca))),[listaCidade,busca,filtroSt]);
  const stCor=(s:string)=>s==='ATIVO'?T.green:s==='ATESTADO'?T.yellow:s==='AFASTAMENTO'?T.purple:T.red;

  const salvar=async()=>{
    if(!form.nome?.trim()||!form.cpf?.trim()){toast(pick(TR.nomeCpfObrig),'erro');return;}
    setSalvando(true);
    try{await upsertUsuario(edit?.id?{...form}:{...form,cidade:cidade||'SP',role:'campo'},edit?.id);toast(edit?pick(TR.atualizado):pick(TR.cadastrado));setModal(false);}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const expXLSX=async()=>{const XLSX=await loadXLSX();const rows=filtrados.map(f=>({[pick(TR.nome)]:f.nome,CPF:f.cpf,[pick(TR.turno)]:f.turno,[pick(TR.funcaoCol)]:f.funcao,[pick(TR.zona)]:f.zona,[pick(TR.status)]:f.status,[pick(TR.colFolga)]:f.diaFolga,[pick(TR.cidadeCol)]:f.cidade||cidade||''}));const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'CLT');XLSX.writeFile(wb,`clt_${cidade||'all'}_${new Date().toISOString().slice(0,10)}.xlsx`);toast(pick(TR.xlsxExportado));};

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder={pick(TR.buscarNomeCpf)} style={{...S.inp,marginBottom:0,flex:1}}/>
        <select value={filtroSt} onChange={e=>setFiltroSt(e.target.value)} style={{...S.inp,marginBottom:0,width:120}}><option value="TODOS">{pick(TR.todos)}</option>{STATUS_FUNC.map(s=><option key={s} value={s}>{s}</option>)}</select>
        <button onClick={expXLSX} style={{...S.btn(T.green,true),padding:'7px 10px',fontSize:11}}>📊 XLSX</button>
        <button onClick={()=>{setEdit(null);setForm({nome:'',cpf:'',cargo:'CLT',turno:'T1',funcao:'Scout',zona:'',status:'ATIVO',gerente:'',lider:'',telefone:'',dataAdmissao:'',escala:'',diaFolga:''});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>{pick(TR.novoClt)}</button>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
        {STATUS_FUNC.map(st=>{const n=listaCidade.filter(f=>f.status===st).length;if(!n)return null;return<div key={st} style={{background:T.card,border:`1px solid ${filtroSt===st?stCor(st):T.bdr}`,borderRadius:8,padding:'5px 12px',fontSize:11,cursor:'pointer'}} onClick={()=>setFiltroSt(filtroSt===st?'TODOS':st)}><span style={{color:stCor(st),fontWeight:700}}>{n}</span><span style={{color:T.dim,marginLeft:4}}>{st}</span></div>;})}
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={{...S.table,minWidth:800}}>
          <thead><tr>{[pick(TR.nome),'CPF',pick(TR.turno),pick(TR.funcaoCol),pick(TR.zona),pick(TR.status),pick(TR.colFolga),pick(TR.acoes)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtrados.length===0&&<tr><td colSpan={8} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TR.nenhumFunc)}</td></tr>}
            {filtrados.map(f=>(
              <tr key={f.id||f.cpf}>
                <td style={{...S.td,fontWeight:600}}>{f.nome}</td><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{f.cpf}</td><td style={S.td}>{f.turno}</td><td style={S.td}>{f.funcao}</td><td style={S.td}>{f.zona||'—'}</td>
                <td style={S.td}><span style={S.chip(stCor(f.status||'ATIVO'))}>{f.status||'—'}</span></td><td style={S.td}>{f.diaFolga||'—'}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>{setEdit(f);setForm({...f});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  <button onClick={async()=>{if(f.id&&await confirmDialog(pick(TR.removerNome), f.nome+'?', {variant:'danger'})){await deleteUsuario(f.id);toast(pick(TR.removido));}}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={S.mCard}><div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{edit?`${pick(TR.editarPrefix)} ${edit.nome}`:pick(TR.cadastrarClt)}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
        <div style={{padding:18}}>
          <div style={S.g2}>
            <div><label style={S.lbl}>{pick(TR.nomeObrig)}</label><input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>{pick(TR.cpfObrig)}</label><input value={form.cpf} onChange={e=>setForm(f=>({...f,cpf:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>{pick(TR.turno)}</label><select value={form.turno} onChange={e=>setForm(f=>({...f,turno:e.target.value}))} style={S.inp}>{TURNOS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><label style={S.lbl}>{pick(TR.funcao)}</label><select value={form.funcao} onChange={e=>setForm(f=>({...f,funcao:e.target.value}))} style={S.inp}>{FUNCOES.map(fn=><option key={fn} value={fn}>{fn}</option>)}</select></div>
            <div><label style={S.lbl}>{pick(TR.status)}</label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={S.inp}>{STATUS_FUNC.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><label style={S.lbl}>{pick(TR.diaFolga)}</label><select value={form.diaFolga} onChange={e=>setForm(f=>({...f,diaFolga:e.target.value}))} style={S.inp}><option value="">{pick(TR.semFolgaFixa)}</option>{DIAS_SEM.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
            <div><label style={S.lbl}>{pick(TR.zona)}</label><input value={form.zona} onChange={e=>setForm(f=>({...f,zona:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>{pick(TR.gerente)}</label><input value={form.gerente} onChange={e=>setForm(f=>({...f,gerente:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>{pick(TR.telefone)}</label><input value={form.telefone} onChange={e=>setForm(f=>({...f,telefone:e.target.value}))} style={S.inp}/></div>
            <div><label style={S.lbl}>{pick(TR.admissao)}</label><input type="date" value={form.dataAdmissao} onChange={e=>setForm(f=>({...f,dataAdmissao:e.target.value}))} style={S.inp}/></div>
          </div>
          <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>{salvando?pick(TR.salvando):edit?pick(TR.salvar):pick(TR.cadastrar)}</button>
        </div></div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA INVENTÁRIO
// ═══════════════════════════════════════════════════════════════════════════════

function AbaInventario({cidade}:AbaProps){
  const { pick } = useT();
  const [tipo,    setTipo   ]=useState<Inventario['tipo']>('armario');
  const [lista,   setLista  ]=useState<Inventario[]>([]);
  const [modal,   setModal  ]=useState(false);
  const [edit,    setEdit   ]=useState<Inventario|null>(null);
  const [form,    setForm   ]=useState<Partial<Inventario>>({tipo:'armario',nome:'',status:'ATIVO',zona:'',identificador:'',observacao:''});
  const [salvando,setSalvando]=useState(false);
  useEffect(()=>{
    const u=subscribeInventario(tipo,cidade,i=>setLista(i as Inventario[]));return u;
  },[tipo,cidade]);

  const tipos=[{k:'armario',l:pick(TR.invArmarios),e:'🔋'},{k:'patinete',l:pick(TR.invPatinetes),e:'🛴'},{k:'carro',l:pick(TR.invCarros),e:'🚗'},{k:'suporte',l:pick(TR.invSuportes),e:'🧰'}] as {k:Inventario['tipo'];l:string;e:string}[];
  const stCor=(s:string)=>s==='ATIVO'?T.green:s==='MANUTENCAO'?T.yellow:T.red;

  const salvar=async()=>{
    if(!form.nome?.trim()){toast(pick(TR.nomeObrigInv),'erro');return;}
    setSalvando(true);
    const p={...form,tipo,cidade:cidade||'SP'};
    try{await upsertInventario(p,edit?.id);toast(edit?pick(TR.atualizado):pick(TR.adicionado));setModal(false);}
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        {tipos.map(t=><button key={t.k} onClick={()=>setTipo(t.k)} style={{...S.btn(T.bluel,tipo!==t.k),padding:'7px 14px'}}>{t.e} {t.l}</button>)}
        <button onClick={()=>{setEdit(null);setForm({tipo,nome:'',status:'ATIVO',zona:'',identificador:'',observacao:''});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),marginLeft:'auto',fontSize:12}}>{pick(TR.adicionar)}</button>
      </div>
      <div style={S.kpiRow}>
        {[{n:lista.length,l:pick(TR.kpiTotal),c:T.bluel},{n:lista.filter(i=>i.status==='ATIVO').length,l:pick(TR.invAtivos),c:T.green},{n:lista.filter(i=>i.status==='MANUTENCAO').length,l:pick(TR.invManutencao),c:T.yellow},{n:lista.filter(i=>i.status==='INATIVO').length,l:pick(TR.invInativos),c:T.red}].map(({n,l,c})=><div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>)}
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={S.table}>
          <thead><tr>{[pick(TR.nome),pick(TR.colIdentificador),pick(TR.zona),pick(TR.status),pick(TR.obs),pick(TR.acoes)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TR.nenhumItem)}</td></tr>}
            {lista.map(item=>(
              <tr key={item.id}><td style={{...S.td,fontWeight:600}}>{item.nome}</td><td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{item.identificador||'—'}</td><td style={S.td}>{item.zona||'—'}</td><td style={S.td}><span style={S.chip(stCor(item.status))}>{item.status}</span></td><td style={{...S.td,fontSize:11,color:T.dim,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{item.observacao||'—'}</td>
              <td style={S.td}><div style={{display:'flex',gap:4}}>
                <button onClick={()=>{setEdit(item);setForm({...item});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                <button onClick={async()=>{if(item.id&&await confirmDialog(pick(TR.remover), '', {variant:'danger'}))await deleteInventario(item.id);}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
              </div></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal&&<div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
        <div style={{...S.mCard,maxWidth:420}}><div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{edit?pick(TR.editarBtn):pick(TR.novo)}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
        <div style={{padding:18}}>
          <label style={S.lbl}>{pick(TR.nomeObrig)}</label><input value={form.nome||''} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/>
          <label style={S.lbl}>{pick(TR.colIdentificador)}</label><input value={form.identificador||''} onChange={e=>setForm(f=>({...f,identificador:e.target.value}))} style={S.inp} placeholder={pick(TR.identificadorPlaceholder)}/>
          <label style={S.lbl}>{pick(TR.zona)}</label><input value={form.zona||''} onChange={e=>setForm(f=>({...f,zona:e.target.value}))} style={S.inp}/>
          <label style={S.lbl}>{pick(TR.status)}</label><select value={form.status||'ATIVO'} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={S.inp}><option value="ATIVO">ATIVO</option><option value="MANUTENCAO">{pick(TR.manutencaoOpt)}</option><option value="INATIVO">INATIVO</option></select>
          <label style={S.lbl}>{pick(TR.observacao)}</label><input value={form.observacao||''} onChange={e=>setForm(f=>({...f,observacao:e.target.value}))} style={S.inp}/>
          <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>{salvando?pick(TR.salvando):pick(TR.salvar)}</button>
        </div></div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA TELEGRAM — por cidade, múltiplos grupos, relatórios automáticos
// ═══════════════════════════════════════════════════════════════════════════════

function AbaTelegram({usuario,cidade}:AbaProps){
  const { pick } = useT();
  const [msg,     setMsg    ]=useState('');
  const [slots,   setSlots  ]=useState<Slot[]>([]);
  const [aceites, setAceites]=useState<SlotAceite[]>([]);
  const [tarefas, setTarefas]=useState<TarefaLogistica[]>([]);
  const [workers, setWorkers]=useState<GpsWorker[]>([]);
  const [grupos,  setGrupos ]=useState<TelegramGrupo[]>([]);
  const [enviando,setEnviando]=useState(false);
  const [destino, setDestino]=useState<'todos'|'cidade'|'grupo'>('cidade');
  const [grupoSel,setGrupoSel]=useState('');
  const [cargoFiltro,setCargoFiltro]=useState('todos');

  useEffect(()=>{
    const u1=subscribeSlotsGestor({cidade,limit:100},s=>setSlots((s as Slot[]).filter(sl=>sl.dataSlot===hoje())));
    const u2=subscribeAceites(a=>setAceites(a as SlotAceite[]));
    const u3=subscribeTarefas({cidade,status:['pendente','em_andamento'],limit:100},t=>setTarefas(t as TarefaLogistica[]));
    const u4=subscribeGpsLogistica({cidade,minutos:30},w=>setWorkers(w as GpsWorker[]));
    // Grupos Telegram da cidade
    const cidadeKey=cidade||'global';
    fetchTelegramGrupos(cidadeKey).then(gs=>setGrupos(gs as TelegramGrupo[])).catch(()=>{});
    return()=>{u1();u2();u3();u4();};
  },[cidade]);

  const vagT=slots.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acH=aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status!=='Desistiu');
  const iniH=acH.filter(a=>a.status==='Iniciou').length;
  const fltH=acH.filter(a=>a.status==='Faltou').length;
  const online=workers.filter(w=>mAtras(w.atualizadoEm)<30).length;
  const pend=tarefas.filter(t=>t.status==='pendente').length;

  const textoResumo=`📋 *${pick(TR.msgResumoTit)} — ${cidade||pick(TR.geral)} · ${hoje()}*\n━━━━━━━━━━━━━━━━━━━\n\n👷 *${pick(TR.msgOnlineAgora)}* ${online}\n\n🎰 *${pick(TR.msgSlotsHoje)}*\n  ${pick(TR.msgVagas)} ${vagT} | ${pick(TR.msgAceites)} ${acH.length}\n  ✅ ${pick(TR.msgIniciou)} ${iniH} | ❌ ${pick(TR.msgFaltou)} ${fltH}\n  🟡 ${pick(TR.msgAbertas)} ${Math.max(0,vagT-acH.length)}\n\n📋 *${pick(TR.msgTarefasPend)}* ${pend}\n\n🕐 ${new Date().toLocaleString('pt-BR')}`;

  const enviar=async(texto:string,grupoId?:string)=>{
    if(!texto.trim()){toast(pick(TR.digiteMsg),'erro');return;}
    setEnviando(true);
    try{
      const fn=fnBridge('notificarTarefa');
      await fn({mensagem:texto,cidade:cidade||'SP',tipo:'telegram_gestor',remetente:usuario.nome,chatId:grupoId||undefined});
      toast(pick(TR.msgEnviada));
    }catch{
      await navigator.clipboard.writeText(texto).catch(()=>{});
      toast(pick(TR.copiadoIndisp));
    }finally{setEnviando(false);}
  };

  const enviarConfs=async()=>{
    setEnviando(true);
    const pends=aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status==='Pendente');
    if(!pends.length){toast(pick(TR.nenhumAcePend));setEnviando(false);return;}
    try{
      const fn=fnBridge('notificarTarefa');
      for(const a of pends){const sl=slots.find(s=>s.id===a.slotId);await fn({mensagem:`⏰ *${pick(TR.msgConfSlotTit)}*\n\n${a.nome}, ${pick(TR.msgVoceTemSlot)} ${sl?.horaIni||'?'} ${pick(TR.msgNaZona)} ${sl?.zona||'?'} ${pick(TR.msgEm)} ${cidade||'SP'}.\n\n${pick(TR.msgConfirmeResp)}\n${pick(TR.msgCasoNaoPossa)}`,cidade:cidade||'SP',tipo:'confirmacao_slot',cnpj:a.cnpj,slotId:a.slotId});}
      toast(`${pends.length} ${pick(TR.confEnviadas)}`);
    }catch(e:any){toast(pick(TR.erroPrefix)+' '+e.message,'erro');}finally{setEnviando(false);}
  };

  // Relatórios por cargo
  const relPorCargo=(cargo:string)=>{
    const t=tarefas.filter(t=>t.status==='em_andamento');
    return `📋 *${pick(TR.msgRelatorio)} ${cargo} — ${cidade||'SP'} · ${hoje()}*\n\n${t.filter(x=>(x as any).funcao===cargo||x.tipo.includes(cargo.toUpperCase())).slice(0,10).map(x=>`• ${x.endereco||x.titulo||x.id.slice(-6)} — ${x.responsavelNome||pick(TR.semResp)}`).join('\n')||pick(TR.msgSemTarefas)}`;
  };

  const TEMPLATES=[
    {label:pick(TR.tplResumo),texto:textoResumo},
    {label:pick(TR.tplVagas),texto:`🚨 *${pick(TR.msgVagasAbertas)} — ${cidade||'SP'}*\n\n${Math.max(0,vagT-acH.length)} ${pick(TR.msgVagaDisp)}\n${pick(TR.msgRespConfirmar)}`},
    {label:pick(TR.tplInicio),texto:`▶️ *${pick(TR.msgInicioOper)} — ${cidade||'SP'}*\n📅 ${hoje()}\n\n${pick(TR.msgBomTurno)}\n— ${usuario.nome}`},
    {label:pick(TR.tplChargers),  texto:relPorCargo('Charger')},
    {label:pick(TR.tplScouts),    texto:relPorCargo('Scout')},
  ];

  const filtrosCargo=['todos','Charger','Scout','Scalt','Motorista'];

  return(
    <div>
      {/* Confirmações */}
      <div style={{...S.card(T.bluel),marginBottom:14}}>
        <div style={S.sec}>{pick(TR.confSlots)} — {cidade||pick(TR.todasCidades).toLowerCase()}</div>
        <div style={{display:'flex',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div style={{flex:1,fontSize:12,color:T.dim}}>
            <b style={{color:T.txt}}>{aceites.filter(a=>slots.some(sl=>sl.id===a.slotId)&&a.status==='Pendente').length}</b> {pick(TR.aceitesPend)}
            {' '}{pick(TR.cliquePara)}
          </div>
          <button onClick={enviarConfs} disabled={enviando} style={{...S.btnG(T.blueg),flexShrink:0,fontSize:12}}>{enviando?pick(TR.enviando):pick(TR.enviarConfs)}</button>
        </div>
      </div>

      {/* Grupos configurados */}
      {grupos.length>0&&(
        <div style={{...S.card(T.purple),marginBottom:14}}>
          <div style={S.sec}>{pick(TR.gruposTelegram)} — {cidade||'global'}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
            <button onClick={()=>setGrupoSel('')} style={{...S.btn(T.bluel,!!grupoSel),padding:'5px 10px',fontSize:11}}>{pick(TR.todosGrupos)}</button>
            {grupos.map(g=><button key={g.chatId} onClick={()=>setGrupoSel(g.chatId)} style={{...S.btn(T.purple,grupoSel!==g.chatId),padding:'5px 10px',fontSize:11}}>{g.nome}</button>)}
          </div>
          {grupoSel&&<div style={{fontSize:11,color:T.dim}}>{pick(TR.msgEnviadaPara)} <b style={{color:T.txt}}>{grupos.find(g=>g.chatId===grupoSel)?.nome}</b> (chatId: {grupoSel})</div>}
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div>
          <div style={S.sec}>{pick(TR.templates)}</div>
          {TEMPLATES.map(t=>(
            <div key={t.label} style={{...S.card(),marginBottom:8}}>
              <div style={{fontWeight:600,fontSize:12,color:T.txt,marginBottom:6}}>{t.label}</div>
              <pre style={{fontSize:10,color:T.dim,whiteSpace:'pre-wrap',marginBottom:8,maxHeight:60,overflowY:'auto',lineHeight:1.5}}>{t.texto.slice(0,160)}...</pre>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>setMsg(t.texto)} style={{...S.btn(T.bluel,true),padding:'5px 10px',fontSize:11}}>✏ {pick(TR.editarBtn)}</button>
                <button onClick={()=>enviar(t.texto,grupoSel||undefined)} disabled={enviando} style={{...S.btnG(T.blueg),padding:'5px 10px',fontSize:11}}>{pick(TR.enviarBtn)}</button>
              </div>
            </div>
          ))}
        </div>
        <div>
          <div style={S.sec}>{pick(TR.msgLivre)}</div>
          <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
            {filtrosCargo.map(c=><button key={c} onClick={()=>{setCargoFiltro(c);if(c!=='todos')setMsg(relPorCargo(c));}} style={{...S.btn(T.bluel,cargoFiltro!==c),padding:'4px 8px',fontSize:10}}>{c==='todos'?pick(TR.todos):c}</button>)}
          </div>
          <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder={`${pick(TR.msgPlaceholderA)} ${cidade||pick(TR.todasCidades).toLowerCase()}...\n\n${pick(TR.msgPlaceholderB)}`} style={{...S.inp,marginBottom:10,height:200,resize:'vertical',fontFamily:'monospace',fontSize:12}}/>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>navigator.clipboard.writeText(msg).then(()=>toast(pick(TR.copiado)))} style={{...S.btn(T.bluel,true),flex:1}}>{pick(TR.copiar)}</button>
            <button onClick={()=>enviar(msg,grupoSel||undefined)} disabled={enviando||!msg.trim()} style={{...S.btnG(T.blueg),flex:2}}>{enviando?pick(TR.enviando):pick(TR.enviarBtn)}</button>
          </div>
          {grupos.length===0&&<div style={{fontSize:10,color:T.dim,marginTop:8}}>{pick(TR.configGrupos)}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA ALERTAS — histórico de alertas críticos detectados pelo monitor
// ═══════════════════════════════════════════════════════════════════════════════

interface MonitorAlerta {
  id: string;
  tipo: string;
  cidade: string;
  zona?: string;
  qtdBikes?: number;
  batMinPct?: number;
  slotId?: string | null;
  ts?: any;
}

function AbaAlertas({cidade}:AbaProps){
  const { pick } = useT();
  const [lista,setLista]=useState<MonitorAlerta[]>([]);
  const [loading,setLoading]=useState(true);
  const [filtroTipo,setFiltroTipo]=useState('todos');
  const [fraudAlerts,setFraudAlerts]=useState<any[]>([]);

  useEffect(()=>{
    setLoading(true);
    fetchAlertas(cidade).then(a=>{setLista(a as MonitorAlerta[]);setLoading(false);}).catch(()=>setLoading(false));
    const u=subscribeAlertas(cidade,a=>{setLista(a as MonitorAlerta[]);setLoading(false);},15000);
    // O2: Load fraud alerts from audit_log
    Promise.resolve(supabase.from('audit_log')
      .select('*')
      .eq('entidade','fraude_suspeita')
      .order('criado_em',{ascending:false})
      .limit(20))
      .then(({data})=>setFraudAlerts(data??[]))
      .catch(()=>{});
    return u;
  },[cidade]);

  const TIPOS={
    bateria_critica:{label:pick(TR.alBateriaCritica),cor:'#f59e0b'},
    ponto_zerado:   {label:pick(TR.alPontoZerado),   cor:'#ef4444'},
    ponto_baixo:    {label:pick(TR.alPontoBaixo),    cor:'#f97316'},
  } as Record<string,{label:string;cor:string}>;

  const fmtTs=(ts:any)=>{
    if(!ts) return '—';
    const d=ts?.toDate?.()??new Date(ts);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  };

  const filtrados=useMemo(()=>filtroTipo==='todos'?lista:lista.filter(a=>a.tipo===filtroTipo),[lista,filtroTipo]);

  if(loading) return <div style={{padding:16}}><SkeletonPulseStyle /><SkeletonTable rows={6} cols={4} /></div>;

  const FRAUD_LABELS: Record<string,{label:string;cor:string}>={
    velocidade_suspeita:{label:'Velocidade suspeita',cor:'#ef4444'},
    swap_excessivo:{label:'Swap excessivo',cor:'#f59e0b'},
    gps_estatico:{label:'GPS estático',cor:'#8b5cf6'},
  };

  return(
    <div style={{maxWidth:780}}>
      {/* O2: Fraud alerts */}
      {fraudAlerts.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:700,color:'#ef4444',marginBottom:10}}>🚨 Alertas de fraude (últimos 20)</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {fraudAlerts.map((a:any)=>{
              const info=FRAUD_LABELS[a.acao]??{label:a.acao,cor:'#6b7280'};
              const dados=a.dados??{};
              const ts=a.criado_em?new Date(a.criado_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
              return(
                <div key={a.id} style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.15)',borderLeft:`3px solid ${info.cor}`,borderRadius:8,padding:'10px 14px'}}>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                    <span style={{background:info.cor+'22',color:info.cor,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700}}>{info.label}</span>
                    <span style={{fontSize:10,color:'rgba(255,255,255,.3)'}}>{ts}</span>
                  </div>
                  <div style={{fontSize:11,color:'#dce8ff'}}>{dados.scout_nome??a.entidade_id}</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,.4)',marginTop:2}}>{dados.msg??''}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#dce8ff',flex:1}}>{pick(TR.histAlertas)}</div>
        <div style={{display:'flex',gap:4}}>
          {(['todos',...Object.keys(TIPOS)] as string[]).map(t=>(
            <button key={t} onClick={()=>setFiltroTipo(t)} style={{
              padding:'4px 10px',borderRadius:16,border:'none',cursor:'pointer',fontSize:10,fontWeight:600,
              background:filtroTipo===t?(TIPOS[t]?.cor??'#3b82f6'):'rgba(255,255,255,.06)',
              color:filtroTipo===t?'#fff':'rgba(255,255,255,.4)',
            }}>{t==='todos'?pick(TR.todos):TIPOS[t]?.label??t}</button>
          ))}
        </div>
      </div>

      {filtrados.length===0&&(
        <div style={{textAlign:'center',padding:60,color:'rgba(255,255,255,.3)',fontSize:13}}>
          {lista.length===0?pick(TR.nenhumAlertaAinda):pick(TR.nenhumAlertaFiltro)}
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtrados.map(a=>{
          const info=TIPOS[a.tipo]??{label:a.tipo,cor:'#6b7280'};
          return(
            <div key={a.id} style={{background:'rgba(255,255,255,.03)',border:`1px solid ${info.cor}33`,borderLeft:`3px solid ${info.cor}`,borderRadius:10,padding:'12px 16px',display:'flex',gap:14,alignItems:'flex-start'}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                  <span style={{background:info.cor+'22',color:info.cor,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700}}>{info.label}</span>
                  {a.zona&&<span style={{fontSize:10,color:'rgba(255,255,255,.35)',background:'rgba(255,255,255,.06)',padding:'2px 8px',borderRadius:8}}>{a.zona}</span>}
                </div>
                <div style={{fontSize:12,color:'#dce8ff',marginBottom:2}}>
                  {a.qtdBikes!=null&&<span>🛴 <b>{a.qtdBikes}</b> {a.qtdBikes!==1?pick(TR.bikePlur):pick(TR.bikeSing)}</span>}
                  {a.batMinPct!=null&&<span style={{marginLeft:8}}>⚡ {pick(TR.minLabel)} <b style={{color:'#f59e0b'}}>{a.batMinPct}%</b></span>}
                  {a.cidade&&<span style={{marginLeft:8,color:'rgba(255,255,255,.4)'}}>📍 {a.cidade}</span>}
                </div>
                {a.slotId&&<div style={{fontSize:10,color:'rgba(255,255,255,.25)',fontFamily:'monospace'}}>{pick(TR.slotLabel)} {a.slotId}</div>}
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,.3)',flexShrink:0,textAlign:'right'}}>
                {fmtTs(a.ts)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA CONFIG — por cidade
// ═══════════════════════════════════════════════════════════════════════════════

function AbaConfig({cidade,isAdmin}:AbaProps){
  const { pick } = useT();
  const [cfg,setCfg]=useState<ConfigGlobal>({slaMinutos:120,raioSugestaoKm:2,alertaZeroGoJet:true,thresholdBatBaixa:30,confirmacaoMin:120,reaberturaSemConfMin:90,prazoHoras:{PONTO:4,PATINETE:2,ORGANIZACAO:8,CARGA_BATERIA:3}});
  const [tgGrupos,setTgGrupos]=useState<TelegramGrupo[]>([]);
  const [novoGrupo,setNovoGrupo]=useState(false);
  const [gf,setGf]=useState({chatId:'',nome:'',tipos:['Scout','Charger'],topicos:{}} as Partial<TelegramGrupo>);
  const [gestoresLog,setGestoresLog]=useState<{uid:string;nome:string;cidades:string[]}[]>([]);
  const [todosUsers,setTodosUsers]=useState<any[]>([]);
  const [salvando,setSalvando]=useState(false);

  useEffect(()=>{
    const cidadeKey=cidade||'global';
    fetchConfigLogistica(cidadeKey).then(d=>{if(d)setCfg(prev=>({...prev,...(d as ConfigGlobal)}));}).catch(()=>{});
    fetchTelegramGrupos(cidadeKey).then(gs=>setTgGrupos(gs as TelegramGrupo[])).catch(()=>{});
    if(isAdmin){
      fetchUsuarios().then(users=>{
        setTodosUsers(users as any[]);
        setGestoresLog(users.filter((u:any)=>['gestor','supergestor','logistica'].includes(u.role)).map((u:any)=>({uid:u.uid,nome:u.nome||'',...u})));
      });
    }
  },[cidade,isAdmin]);

  const salvar=async()=>{
    setSalvando(true);
    try{
      const cidadeKey=cidade||'global';
      await salvarConfigLogistica(cidadeKey,cfg as unknown as Record<string, unknown>);
      toast(`${pick(TR.configSalva)}${cidade?` — ${cidade}`:''}`)
    }catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const salvarGrupo=async()=>{
    if(!gf.chatId||!gf.nome){toast(pick(TR.chatIdObrig),'erro');return;}
    const cidadeKey=cidade||'global';
    const tipoKey=(gf.tipos?.[0]||'geral').toLowerCase();
    await salvarTelegramGrupo(cidadeKey,tipoKey,{chatId:gf.chatId,nome:gf.nome,topicos:gf.topicos||{}});
    toast(pick(TR.grupoSalvo));setNovoGrupo(false);setGf({chatId:'',nome:'',tipos:['Scout','Charger'],topicos:{}});
    // recarregar grupos
    fetchTelegramGrupos(cidadeKey).then(gs=>setTgGrupos(gs as TelegramGrupo[])).catch(()=>{});
  };

  const N=({label,field,min,max,step=1}:{label:string;field:keyof ConfigGlobal;min:number;max:number;step?:number})=>(
    <div><label style={S.lbl}>{label}</label><input type="number" min={min} max={max} step={step} value={cfg[field] as number} onChange={e=>setCfg(c=>({...c,[field]:parseFloat(e.target.value)||0}))} style={S.inp}/></div>
  );

  return(
    <div style={{maxWidth:640}}>
      <div style={{fontSize:12,color:T.dim,marginBottom:12}}>
        {pick(TR.configPara)} <b style={{color:T.txt}}>{cidade||pick(TR.globalTodas)}</b>
      </div>

      <div style={{...S.card(T.bluel),marginBottom:14}}>
        <div style={S.sec}>{pick(TR.operacao)}</div>
        <div style={S.g2}>
          <N label={pick(TR.slaPadrao)}         field="slaMinutos"        min={15}  max={480}/>
          <N label={pick(TR.raioSugestao)}  field="raioSugestaoKm"    min={0.5} max={20} step={0.5}/>
          <N label={pick(TR.thresholdBat)} field="thresholdBatBaixa" min={5}   max={50}/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:8,marginTop:4,cursor:'pointer'}}>
          <input type="checkbox" checked={cfg.alertaZeroGoJet} onChange={e=>setCfg(c=>({...c,alertaZeroGoJet:e.target.checked}))}/>
          <span style={{fontSize:12,color:T.txt}}>{pick(TR.alertarGoJetZero)}</span>
        </label>
      </div>

      <div style={{...S.card(T.yellow),marginBottom:14}}>
        <div style={S.sec}>{pick(TR.confSlotsTit)}</div>
        <div style={S.g2}>
          <N label={pick(TR.avisarConf)} field="confirmacaoMin"       min={30} max={480}/>
          <N label={pick(TR.reabrirSemConfMin)}  field="reaberturaSemConfMin" min={15} max={240}/>
        </div>
        <div style={{fontSize:11,color:T.dim,marginTop:4}}>{pick(TR.confExA)}{cfg.confirmacaoMin}{pick(TR.confExB)} {cfg.reaberturaSemConfMin}{pick(TR.confExC)}</div>
      </div>

      <div style={{...S.card(T.yellow),marginBottom:14}}>
        <div style={S.sec}>{pick(TR.prazoAuto)}</div>
        <div style={{fontSize:11,color:T.dim,marginBottom:10}}>{pick(TR.prazoDesc)}</div>
        <div style={S.g2}>
          {([['PONTO',pick(TR.prazoPonto)],['PATINETE',pick(TR.prazoPatinete)],['ORGANIZACAO',pick(TR.prazoOrg)],['CARGA_BATERIA',pick(TR.prazoCarga)]] as const).map(([k,label])=>(
            <div key={k}>
              <label style={S.lbl}>{label}</label>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <input type="number" min={0} max={72} step={0.5}
                  value={cfg.prazoHoras?.[k] ?? 0}
                  onChange={e=>setCfg(c=>({...c,prazoHoras:{...c.prazoHoras,[k]:parseFloat(e.target.value)||0}}))}
                  style={{...S.inp,flex:1}}/>
                <span style={{fontSize:10,color:T.dim,flexShrink:0}}>h</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',padding:'11px',fontSize:13,marginBottom:16}}>{salvando?pick(TR.salvando):pick(TR.salvarConfig)}</button>

      {/* Grupos Telegram por cidade */}
      <div style={{...S.card(T.purple),marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={S.sec}>{pick(TR.gruposTelegram)} — {cidade||'global'}</div>
          <button onClick={()=>setNovoGrupo(v=>!v)} style={{...S.btn(T.purple,true),padding:'5px 10px',fontSize:11}}>{pick(TR.grupoBtn)}</button>
        </div>
        {tgGrupos.length===0&&!novoGrupo&&<div style={{fontSize:12,color:T.dim}}>{pick(TR.nenhumGrupo)}</div>}
        {tgGrupos.map((g,i)=>(
          <div key={i} style={{...S.card(),marginBottom:8}}>
            <div style={{fontWeight:600,fontSize:12,color:T.txt}}>{g.nome}</div>
            <div style={{fontSize:10,color:T.dim,fontFamily:'monospace'}}>{g.chatId}</div>
            <div style={{fontSize:11,color:T.dim,marginTop:4}}>{pick(TR.tiposLabel)} {g.tipos?.join(', ')||'—'}</div>
          </div>
        ))}
        {novoGrupo&&(
          <div style={{...S.card(),marginTop:8}}>
            <label style={S.lbl}>{pick(TR.nomeGrupo)}</label><input value={gf.nome||''} onChange={e=>setGf(f=>({...f,nome:e.target.value}))} style={S.inp} placeholder={pick(TR.nomeGrupoPlaceholder)}/>
            <label style={S.lbl}>{pick(TR.chatId)}</label><input value={gf.chatId||''} onChange={e=>setGf(f=>({...f,chatId:e.target.value}))} style={S.inp} placeholder="-1001234567890"/>
            <label style={S.lbl}>{pick(TR.tiposCargo)}</label>
            <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
              {[['Scout','Scout'],['Charger','Charger'],['Scalt','Scalt'],['Fiscal','Fiscal'],['Segurança',pick(TR.cargoSeguranca)],['Líderes',pick(TR.cargoLideres)],['Alertas',pick(TR.cargoAlertas)]].map(([val,lbl])=>{const sel=(gf.tipos||[]).includes(val);return<button key={val} onClick={()=>setGf(f=>({...f,tipos:sel?(f.tipos||[]).filter(x=>x!==val):[...(f.tipos||[]),val]}))} style={{...S.btn(T.purple,!sel),padding:'4px 8px',fontSize:11}}>{lbl}</button>;})}</div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setNovoGrupo(false)} style={{...S.btn(undefined,true),flex:1}}>{pick(TR.cancelar)}</button>
              <button onClick={salvarGrupo} style={{...S.btnG(T.blueg),flex:2}}>{pick(TR.salvarGrupo)}</button>
            </div>
          </div>
        )}
        <div style={{fontSize:10,color:T.dim,marginTop:8}}>{pick(TR.chatIdDica)}</div>
      </div>

      {/* Gestores por cidade (só admin) */}
      {isAdmin&&(
        <div style={S.card()}>
          <div style={S.sec}>{pick(TR.gestoresLog)}</div>
          <div style={{fontSize:11,color:T.dim,marginBottom:10}}>
            {pick(TR.gestoresDesc)} <code>cidadesGerenciaLog</code> {pick(TR.noDocUsuario)} <code>usuarios/</code>.
          </div>
          {gestoresLog.slice(0,10).map(g=>(
            <div key={g.uid} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:T.txt}}>{g.nome}</div><div style={{fontSize:10,color:T.dim}}>{(g as any).role}</div></div>
              <div style={{fontSize:11,color:T.dim}}>{(g as any).cidadesGerenciaLog?.join(', ')||pick(TR.todasLabel)}</div>
            </div>
          ))}
          <div style={{fontSize:10,color:T.dim,marginTop:8}}>
            {pick(TR.gestoresFooter)} <b>cidadesGerenciaLog</b> {pick(TR.arrayStrings)}
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABA GOJET CONFIG — configuração por cidade (cityId, limiares, automação)
// ═══════════════════════════════════════════════════════════════════════════════

interface GoJetCidadeConfig {
  cityId: string;
  ativo: boolean;
  limiarBaixoPct: number;   // % abaixo do target → ponto "baixo"  (default 50)
  limiarExcessoPct: number; // % acima do target → "excesso"        (default 120)
  batThresholdPct: number;  // % bateria → alerta charger           (default 30)
  batCriticalPct:  number;  // % bateria crítica → urgente           (default 15)
  somenteMonitor: boolean;  // só pontos monitor                    (default true)
  autoTarefas: boolean;     // gerar tarefas automaticamente        (default true)
  notificarGestor: boolean; // notificar via Telegram               (default true)
}

const CFG_PADRAO: GoJetCidadeConfig = {
  cityId: '', ativo: true,
  limiarBaixoPct: 50, limiarExcessoPct: 120, batThresholdPct: 30, batCriticalPct: 15,
  somenteMonitor: true, autoTarefas: true, notificarGestor: true,
};

function AbaGoJetConfig({ cidade, isAdmin }: AbaProps) {
  const { pick } = useT();
  const [cfg, setCfg]     = useState<GoJetCidadeConfig>(CFG_PADRAO);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [snapInfo, setSnapInfo] = useState<{ total: number; bikes: number; idade: number | null } | null>(null);

  useEffect(() => {
    if (!cidade) return;
    fetchGojetConfig(cidade).then(data => {
      if (data) setCfg({ ...CFG_PADRAO, ...data });
    });
    fetchGojetSnapInfo(cidade).then(info => {
      if (info) setSnapInfo(info);
    }).catch(() => {});
  }, [cidade]);

  const upd = (k: keyof GoJetCidadeConfig, v: any) => setCfg(c => ({ ...c, [k]: v }));

  const salvar = async () => {
    if (!cidade) return;
    setBusy(true); setMsg('');
    try {
      await salvarGojetConfig(cidade, cfg as unknown as Record<string, unknown>);
      setMsg(pick(TR.configGoJetSalva));
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg(pick(TR.erroPrefix) + ' ' + e.message); }
    finally { setBusy(false); }
  };

  const S2 = {
    card: { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 } as React.CSSProperties,
    lbl:  { fontSize: 11, color: 'rgba(255,255,255,.4)', display: 'block', marginBottom: 4 } as React.CSSProperties,
    inp:  { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 12, boxSizing: 'border-box' as const },
    row:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as React.CSSProperties,
    num:  { width: 70, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 12, textAlign: 'center' as const },
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 14 }}>
        {pick(TR.goJetIntro)} <strong style={{ color: 'rgba(255,255,255,.55)' }}>{cidade || pick(TR.semCidade)}</strong>.
      </div>

      {/* Snapshot info */}
      {snapInfo && (
        <div style={{ ...S2.card, background: 'rgba(6,182,212,.05)', border: '1px solid rgba(6,182,212,.15)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            📍 <strong style={{ color: '#06b6d4' }}>{snapInfo.total}</strong> {pick(TR.pontosSnapshot)}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            🛴 <strong style={{ color: '#06b6d4' }}>{snapInfo.bikes}</strong> {pick(TR.patinetesLabel)}
          </div>
          <div style={{ fontSize: 11, color: snapInfo.idade === null ? '#6b7280' : snapInfo.idade < 10 ? '#22c55e' : snapInfo.idade < 30 ? '#f59e0b' : '#ef4444' }}>
            ⏱ {snapInfo.idade === null ? pick(TR.semSnapshot) : snapInfo.idade < 1 ? pick(TR.agora) : `${snapInfo.idade}${pick(TR.minLabel)} ${pick(TR.minAtras)}`}
          </div>
        </div>
      )}

      {/* City ID */}
      <div style={S2.card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', marginBottom: 10 }}>{pick(TR.identCidade)}</div>
        <label style={S2.lbl}>{pick(TR.cityIdLabel)}</label>
        <input style={S2.inp} value={cfg.cityId} onChange={e => upd('cityId', e.target.value)}
          placeholder={pick(TR.cityIdPlaceholder)} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.25)', marginTop: 4 }}>
          {pick(TR.encontreEm)} logistic.gojet.app/api/v0/urent/cities
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.ativo} onChange={e => upd('ativo', e.target.checked)} />
          <span style={{ fontSize: 12, color: cfg.ativo ? '#22c55e' : 'rgba(255,255,255,.4)' }}>
            {cfg.ativo ? pick(TR.ativoScraper) : pick(TR.inativoLabel)}
          </span>
        </label>
      </div>

      {/* Limiares */}
      <div style={S2.card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 12 }}>{pick(TR.limiaresClass)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <div>
            <label style={S2.lbl}>{pick(TR.baixoTarget)}</label>
            <input type="number" min={10} max={99} style={S2.inp} value={cfg.limiarBaixoPct}
              onChange={e => upd('limiarBaixoPct', parseInt(e.target.value) || 50)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{pick(TR.baixoDesc)} &lt; target × N%</div>
          </div>
          <div>
            <label style={S2.lbl}>{pick(TR.excessoTarget)}</label>
            <input type="number" min={101} max={300} style={S2.inp} value={cfg.limiarExcessoPct}
              onChange={e => upd('limiarExcessoPct', parseInt(e.target.value) || 120)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{pick(TR.excessoDesc)}</div>
          </div>
          <div>
            <label style={S2.lbl}>{pick(TR.bateriaPct)}</label>
            <input type="number" min={10} max={80} style={S2.inp} value={cfg.batThresholdPct}
              onChange={e => upd('batThresholdPct', parseInt(e.target.value) || 30)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{pick(TR.bateriaDesc)} &lt; N%</div>
          </div>
          <div>
            <label style={S2.lbl}>{pick(TR.bateriaCritPct)}</label>
            <input type="number" min={5} max={50} style={S2.inp} value={cfg.batCriticalPct}
              onChange={e => upd('batCriticalPct', parseInt(e.target.value) || 15)} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 2 }}>{pick(TR.bateriaCritDesc)} &lt; N%</div>
          </div>
        </div>
      </div>

      {/* Automação */}
      <div style={S2.card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 12 }}>{pick(TR.automacaoTarefas)}</div>
        {[
          { k: 'autoTarefas',     l: pick(TR.autoGerarSlots), cor: '#10b981' },
          { k: 'somenteMonitor',  l: pick(TR.apenasMonitor),             cor: '#06b6d4' },
          { k: 'notificarGestor', l: pick(TR.notificarGestorTg), cor: '#a78bfa' },
        ].map(({ k, l, cor }) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={(cfg as any)[k]} onChange={e => upd(k as any, e.target.checked)} />
            <span style={{ fontSize: 12, color: (cfg as any)[k] ? cor : 'rgba(255,255,255,.4)' }}>{l}</span>
          </label>
        ))}
      </div>

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('✓') ? '#10b981' : '#ef4444', marginBottom: 10 }}>{msg}</div>}

      <button
        onClick={salvar} disabled={busy || !cidade || !cfg.cityId}
        style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#a78bfa', color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer', opacity: (!cidade || !cfg.cityId) ? 0.5 : 1 }}>
        {busy ? `⏳ ${pick(TR.salvando)}` : pick(TR.salvarGoJet)}
      </button>
    </div>
  );
}
