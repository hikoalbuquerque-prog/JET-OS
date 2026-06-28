// frontend/src/components/SlotsTeamsModule.tsx
// Slots & Teams — JET OS V2
// MEI + CLT com escala automática por cidade/feriado/zona (polígono)
// Penalidades, gamificação, ranking, streaks
//
// Abas: Escala | Disponibilidade | Ranking | Penalidades | Config

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import {
  subscribeEscala, criarSlotsEscala, salvarDisponibilidade, fetchDisponibilidades,
  salvarDisponibilidadeForm, delDisponibilidade, salvarEscalaConfig, addFeriado, delFeriado, fetchEscala,
  fetchPrestadores, fetchPenalidadesList, salvarPenalidade, fetchDemandaGojet, logEscalaAudit,
  aceitarEscala, fetchMetricasEscala, overrideSlotEscala, cancelarSlotEscala,
} from '../lib/escala-supabase';
import { confirmDialog, promptDialog } from './ui/ConfirmDialog';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Usuario { uid: string; nome: string; email: string; role: string; cidade?: string; cargoPrestador?: string; }
interface Props { usuario: Usuario; onFechar: () => void; cidade?: string; }

interface Prestador {
  id: string; uid?: string; nome: string; cnpj: string; cpf?: string;
  funcao: string; turnosPreferidos: string[]; zonasPreferidas: string[];
  cidade: string; status: 'ativo'|'inativo'|'suspenso';
  pontos: number; nivel: number; streak: number; streakMax: number;
  totalSlots: number; totalFaltas: number; totalAtrasos: number;
  avaliacaoMedia: number; criadoEm?: any;
}

interface Slot {
  id: string; turno: string; horaIni: string; horaFim: string;
  zona: string; tipo: string; qtdPessoas: number; dataSlot: string;
  cidade: string; status: string; geradoAuto?: boolean;
  turnoInicio?: string; turnoFim?: string;
  confirmacaoMin?: number; reaberturaSemConfMin?: number;
  poligonoId?: string; feriado?: boolean;
  zonaOrigem?: string; cargo?: string; titulo?: string;
  geradoAutomatico?: boolean; aceitoPor?: string | null;
  aceitoPorNome?: string | null;
}

interface SlotAceite {
  id: string; slotId: string; nome: string; cnpj: string; uid?: string;
  status: string; aceitoEm?: any; pontuacao?: number;
}

interface Disponibilidade {
  id?: string; uid: string; nome: string; cnpj: string;
  diasSemana: number[]; turnosDisponiveis: string[];
  zonasDisponiveis: string[]; funcao: string;
  cidade: string; obs?: string; atualizadoEm?: any; criadoEm?: any;
}

interface Penalidade {
  id?: string; uid: string; nome: string; cnpj: string;
  tipo: 'falta'|'atraso'|'cancelamento_tardio'|'comportamento';
  descricao: string; pontosDeducao: number; slotId?: string;
  cidade: string; criadoEm?: any; aplicadoPor?: string;
}

interface FaixaHoraria { id: string; horaIni: string; horaFim: string; }
interface EscalaConfig {
  id?: string; cidade: string;
  diasAntecedencia: number; // quantos dias antes gerar escala automatica
  tetoVagas?: number; // guardrail: máximo de vagas por slot gerado
  turnosConfig: Record<string, { horaIni: string; horaFim: string; qtdPadrao: number }>;
  respeitarPreferencias: boolean;
  respeitarFeriados: boolean;
  nivelMinimoUrgente: number;
  bonus: {
    presencaConfirmada: number;
    inicioNoPrazo: number;
    avaliacaoExcelente: number;
    streakSemanal: number;
    streakMensal: number;
    pontoZerado: number;
  };
  penalidades: {
    falta: number;
    atraso15: number;
    atraso30: number;
    cancelamentoTardio: number;
  };
  // Novo modelo unificado (migration 0074)
  faixas: FaixaHoraria[];
  perfis: Record<string, Record<string, Record<string, number>>>; // {alta:{_default:{Charger:2,...},...},...}
  mapaDias: Record<string, string>; // {"0":"baixa",...,"6":"alta"}
  overridesData: Record<string, any>;
  zonasAtivas: string[];
  gojetCityId: string | null;
  gojetAjuste: boolean;
  feriadoPerfil: string;
  tetoVagasZona: number;
  cargos: string[];
}

interface Feriado {
  id?: string; data: string; nome: string; cidade?: string; nacional: boolean;
}

type AbaId = 'escala'|'disponibilidade'|'ranking'|'penalidades'|'config';

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg:'rgba(13,18,30,1)', sur:'rgba(13,18,30,.97)', card:'rgba(22,28,40,.95)',
  bdr:'rgba(255,255,255,.08)', bdr2:'rgba(255,255,255,.04)',
  blueg:'linear-gradient(135deg,#1a6fd4,#307FE2)',
  blue:'#1a6fd4', bluel:'#307FE2',
  green:'#10b981', red:'#ef4444', yellow:'#f59e0b', yellowl:'#fbbf24',
  purple:'#7c3aed', orange:'#f97316', pink:'#ec4899',
  txt:'#e2e8f0', dim:'#8a96b0', blur:'blur(12px)',
};

const S = {
  panel:{ position:'fixed' as const, inset:0, zIndex:4500, background:T.bg, backdropFilter:T.blur, display:'flex', flexDirection:'column' as const, fontFamily:"'Inter',-apple-system,sans-serif" },
  header:{ background:T.sur, backdropFilter:T.blur, borderBottom:`1px solid ${T.bdr}`, padding:'10px 18px', display:'flex', alignItems:'center', gap:12, flexShrink:0, flexWrap:'wrap' as const },
  logo:{ width:36, height:36, borderRadius:10, background:T.blueg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 },
  tabs:{ background:T.sur, borderBottom:`1px solid ${T.bdr}`, display:'flex', overflowX:'auto' as const, flexShrink:0, scrollbarWidth:'none' as const },
  tab:(a:boolean):React.CSSProperties=>({ padding:'10px 16px', fontSize:12, fontWeight:600, color:a?T.bluel:T.dim, cursor:'pointer', background:'none', border:'none', borderBottom:`2px solid ${a?T.bluel:'transparent'}`, whiteSpace:'nowrap', flexShrink:0, transition:'all .15s' }),
  body:{ flex:1, overflowY:'auto' as const, padding:'16px 20px', scrollbarWidth:'thin' as const },
  card:(ac?:string):React.CSSProperties=>({ background:T.card, border:`1px solid ${ac?ac+'33':T.bdr}`, borderTop:`2px solid ${ac||T.bdr}`, borderRadius:12, padding:'14px 16px' }),
  kpiRow:{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' as const },
  kpi:(c:string):React.CSSProperties=>({ flex:1, minWidth:80, background:T.card, border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, borderRadius:12, padding:'12px 14px' }),
  kpiN:(c:string):React.CSSProperties=>({ fontSize:26, fontWeight:800, color:c, lineHeight:1 }),
  kpiL:{ fontSize:10, color:T.dim, marginTop:3, textTransform:'uppercase' as const, letterSpacing:'0.4px' },
  inp:{ width:'100%', padding:'8px 10px', borderRadius:8, boxSizing:'border-box' as const, background:'rgba(255,255,255,.04)', border:`1px solid ${T.bdr}`, color:T.txt, fontSize:13, outline:'none', marginBottom:8 },
  lbl:{ display:'block' as const, fontSize:10, fontWeight:600, color:'rgba(255,255,255,.35)', marginBottom:4, textTransform:'uppercase' as const, letterSpacing:'0.6px' },
  btn:(c?:string,ghost=false):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:ghost?`1px solid ${T.bdr}`:'none', background:ghost?'transparent':(c||T.blueg), color:ghost?T.dim:'#fff', fontWeight:600, fontSize:12, cursor:'pointer', transition:'all .15s' }),
  btnG:(g:string):React.CSSProperties=>({ padding:'8px 14px', borderRadius:8, border:'none', background:g, color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer' }),
  chip:(c:string):React.CSSProperties=>({ display:'inline-block', padding:'2px 8px', borderRadius:20, background:c+'18', color:c, fontSize:10, fontWeight:700, border:`1px solid ${c}33` }),
  sec:{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase' as const, letterSpacing:'1px', marginBottom:10 } as React.CSSProperties,
  table:{ width:'100%', borderCollapse:'collapse' as const },
  th:{ padding:'8px 10px', fontSize:10, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase' as const, color:T.dim, borderBottom:`1px solid ${T.bdr}`, textAlign:'left' as const, whiteSpace:'nowrap' as const },
  td:{ padding:'8px 10px', fontSize:12, borderBottom:`1px solid ${T.bdr2}` },
  modal:{ position:'fixed' as const, inset:0, zIndex:5000, background:'rgba(0,0,0,.75)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  mCard:{ background:'#0d1521', border:`1px solid ${T.bdr}`, borderRadius:14, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' as const },
  mHdr:{ padding:'14px 18px', borderBottom:`1px solid ${T.bdr}`, display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky' as const, top:0, background:'#0d1521', zIndex:1 },
  g2:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 } as React.CSSProperties,
};

// ─── i18n (pt/en/es/ru) ─────────────────────────────────────────────────────
// Padrão do TermosUsoGate: dicionário { pt, en, es, ru } + seletor por idioma.
// PT é a fonte fiel ao texto original. Não altera lógica/queries/campos/enums.

type Lang = 'pt' | 'en' | 'es' | 'ru';
type L = { pt: string; en: string; es: string; ru: string };

const TX = {
  // Cabeçalho / raiz
  todas:            { pt:'Todas',                 en:'All',                  es:'Todas',                ru:'Все' },
  subtitulo:        { pt:'Escala automática',     en:'Auto scheduling',      es:'Turnos automáticos',   ru:'Автоматическое расписание' },
  fechar:           { pt:'✕ Fechar',              en:'✕ Close',              es:'✕ Cerrar',             ru:'✕ Закрыть' },
  // Abas
  abaEscala:        { pt:'📅 Escala Auto',        en:'📅 Auto Schedule',     es:'📅 Turno Auto',        ru:'📅 Авто-расписание' },
  abaDisponib:      { pt:'🗓 Disponibilidade',    en:'🗓 Availability',       es:'🗓 Disponibilidad',    ru:'🗓 Доступность' },
  abaRanking:       { pt:'🏆 Ranking',            en:'🏆 Ranking',           es:'🏆 Ranking',           ru:'🏆 Рейтинг' },
  abaPenalidades:   { pt:'⚠️ Penalidades',        en:'⚠️ Penalties',         es:'⚠️ Penalizaciones',    ru:'⚠️ Штрафы' },
  abaConfig:        { pt:'⚙️ Config',             en:'⚙️ Settings',          es:'⚙️ Config',            ru:'⚙️ Настройки' },
  // Niveis
  nvLendario:       { pt:'Lendário',              en:'Legendary',            es:'Legendario',           ru:'Легенда' },
  nvEspecialista:   { pt:'Especialista',          en:'Specialist',           es:'Especialista',         ru:'Специалист' },
  nvExperiente:     { pt:'Experiente',            en:'Experienced',          es:'Experimentado',        ru:'Опытный' },
  nvRegular:        { pt:'Regular',               en:'Regular',              es:'Regular',              ru:'Постоянный' },
  nvIniciante:      { pt:'Iniciante',             en:'Beginner',             es:'Principiante',         ru:'Новичок' },
  // KPIs Escala
  kpiSlots7:        { pt:'Slots 7 dias',          en:'Slots 7 days',         es:'Slots 7 días',         ru:'Слоты за 7 дней' },
  kpiVagas:         { pt:'Vagas total',           en:'Total spots',          es:'Vacantes total',       ru:'Всего мест' },
  kpiAceites:       { pt:'Aceites',               en:'Accepted',             es:'Aceptaciones',         ru:'Принято' },
  kpiPreench:       { pt:'Preenchimento',         en:'Fill rate',            es:'Cobertura',            ru:'Заполнение' },
  kpiComDisp:       { pt:'Com disponib.',         en:'With availability',    es:'Con disponib.',        ru:'С доступностью' },
  kpiFeriados:      { pt:'Feriados cad.',         en:'Holidays reg.',        es:'Feriados reg.',        ru:'Праздники' },
  // Gerador
  geradorTitulo:    { pt:'⚙️ Gerador automático de escala', en:'⚙️ Automatic schedule generator', es:'⚙️ Generador automático de turnos', ru:'⚙️ Автоматический генератор расписания' },
  gerarProximos:    { pt:'Gerar para os próximos', en:'Generate for the next', es:'Generar para los próximos', ru:'Создать на ближайшие' },
  verPrevia:        { pt:'👁 Ver prévia',         en:'👁 Preview',            es:'👁 Ver vista previa',  ru:'👁 Предпросмотр' },
  dias:             { pt:'dias',                  en:'days',                 es:'días',                 ru:'дн.' },
  criando:          { pt:'Criando...',            en:'Creating...',          es:'Creando...',           ru:'Создание...' },
  criarSlots:       { pt:'✓ Criar',               en:'✓ Create',             es:'✓ Crear',              ru:'✓ Создать' },
  slotsLabel:       { pt:'slots',                 en:'slots',                es:'slots',                ru:'слотов' },
  criterios:        { pt:'Critérios: disponibilidade declarada × dia da semana × turno × função × zona. Feriados são detectados automaticamente.', en:'Criteria: declared availability × weekday × shift × role × zone. Holidays are detected automatically.', es:'Criterios: disponibilidad declarada × día de la semana × turno × función × zona. Los feriados se detectan automáticamente.', ru:'Критерии: заявленная доступность × день недели × смена × роль × зона. Праздники определяются автоматически.' },
  semDispAviso:     { pt:' ⚠️ Nenhuma disponibilidade cadastrada — peça para os prestadores preencherem na aba Disponibilidade.', en:' ⚠️ No availability registered — ask the providers to fill it in the Availability tab.', es:' ⚠️ No hay disponibilidad registrada — pide a los prestadores que la completen en la pestaña Disponibilidad.', ru:' ⚠️ Доступность не указана — попросите исполнителей заполнить её на вкладке «Доступность».' },
  // Previa
  previaTitulo:     { pt:'👁 Prévia',             en:'👁 Preview',            es:'👁 Vista previa',      ru:'👁 Предпросмотр' },
  slotsACriar:      { pt:'slots a criar',         en:'slots to create',      es:'slots a crear',        ru:'слотов к созданию' },
  ocultar:          { pt:'Ocultar',               en:'Hide',                 es:'Ocultar',              ru:'Скрыть' },
  todosExistem:     { pt:'Todos os slots já existem para este período.', en:'All slots already exist for this period.', es:'Todos los slots ya existen para este período.', ru:'Все слоты уже существуют на этот период.' },
  thData:           { pt:'Data',                  en:'Date',                 es:'Fecha',                ru:'Дата' },
  thDia:            { pt:'Dia',                    en:'Day',                  es:'Día',                  ru:'День' },
  thTurno:          { pt:'Turno',                 en:'Shift',                es:'Turno',                ru:'Смена' },
  thFuncao:         { pt:'Função',                en:'Role',                 es:'Función',              ru:'Роль' },
  thVagas:          { pt:'Vagas',                 en:'Spots',                es:'Vacantes',             ru:'Места' },
  thCandidatos:     { pt:'Candidatos',            en:'Candidates',           es:'Candidatos',           ru:'Кандидаты' },
  thFeriado:        { pt:'Feriado',               en:'Holiday',              es:'Feriado',              ru:'Праздник' },
  feriadoChip:      { pt:'🎉 Feriado',            en:'🎉 Holiday',           es:'🎉 Feriado',           ru:'🎉 Праздник' },
  // Metricas
  metAuto:          { pt:'auto',                  en:'auto',                 es:'auto',                 ru:'авто' },
  // Calendario
  calTitulo:        { pt:'📅 Slots dos próximos 7 dias', en:'📅 Slots for the next 7 days', es:'📅 Slots de los próximos 7 días', ru:'📅 Слоты на ближайшие 7 дней' },
  semSlots:         { pt:'Sem slots',             en:'No slots',             es:'Sin slots',            ru:'Нет слотов' },
  aceitar:          { pt:'✓ Aceitar',             en:'✓ Accept',             es:'✓ Aceptar',            ru:'✓ Принять' },
  jaAceitou:        { pt:'Você já aceitou',       en:'You already accepted', es:'Ya aceptaste',         ru:'Вы уже приняли' },
  aceitoOk:         { pt:'Aceito! ✓',             en:'Accepted! ✓',          es:'¡Aceptado! ✓',         ru:'Принято! ✓' },
  // Toasts genericos
  erroGenerico:     { pt:'Erro',                  en:'Error',                es:'Error',                ru:'Ошибка' },
  nenhumSlotCriar:  { pt:'Nenhum slot para criar', en:'No slots to create',  es:'Ningún slot para crear', ru:'Нет слотов для создания' },
  erroAoCriar:      { pt:'Erro ao criar',         en:'Error while creating', es:'Error al crear',       ru:'Ошибка создания' },
  slotsCriadosAuto: { pt:'slots criados automaticamente', en:'slots created automatically', es:'slots creados automáticamente', ru:'слотов создано автоматически' },
  // Disponibilidade Hoje
  nenhumDispHoje:   { pt:'📅 Nenhum prestador disponível hoje', en:'📅 No provider available today', es:'📅 Ningún prestador disponible hoy', ru:'📅 Сегодня нет доступных исполнителей' },
  dispHoje:         { pt:'disponíveis hoje',      en:'available today',      es:'disponibles hoy',      ru:'доступны сегодня' },
  // Aba Disponibilidade — self-service
  minhaDispTitulo:  { pt:'📅 Minha disponibilidade', en:'📅 My availability', es:'📅 Mi disponibilidad', ru:'📅 Моя доступность' },
  minhaDispDesc:    { pt:'Informe seus dias, turnos e zonas preferidos. O gestor usa essas informações para montar a escala.', en:'Tell us your preferred days, shifts and zones. The manager uses this to build the schedule.', es:'Indica tus días, turnos y zonas preferidos. El gestor usa esta información para armar el turno.', ru:'Укажите предпочитаемые дни, смены и зоны. Менеджер использует это для составления расписания.' },
  dispJaCadastrada: { pt:'Disponibilidade já cadastrada.', en:'Availability already registered.', es:'Disponibilidad ya registrada.', ru:'Доступность уже зарегистрирована.' },
  atualizeAbaixo:   { pt:' Atualize abaixo e salve quando quiser.', en:' Update below and save whenever you like.', es:' Actualiza abajo y guarda cuando quieras.', ru:' Обновите ниже и сохраните в любой момент.' },
  funcao:           { pt:'Função',                en:'Role',                 es:'Función',              ru:'Роль' },
  diasDisponiveis:  { pt:'Dias disponíveis',      en:'Available days',       es:'Días disponibles',     ru:'Доступные дни' },
  turnosDisponiveis:{ pt:'Turnos disponíveis',    en:'Available shifts',     es:'Turnos disponibles',   ru:'Доступные смены' },
  zonasPrefOpc:     { pt:'Zonas preferidas (opcional)', en:'Preferred zones (optional)', es:'Zonas preferidas (opcional)', ru:'Предпочитаемые зоны (необязательно)' },
  obsOpc:           { pt:'Observações (opcional)', en:'Notes (optional)',     es:'Observaciones (opcional)', ru:'Примечания (необязательно)' },
  obsPlaceholder:   { pt:'Ex: prefiro T1, disponível nos feriados', en:'E.g.: prefer T1, available on holidays', es:'Ej: prefiero T1, disponible en feriados', ru:'Напр.: предпочитаю T1, доступен в праздники' },
  salvando:         { pt:'Salvando...',           en:'Saving...',            es:'Guardando...',         ru:'Сохранение...' },
  atualizarDisp:    { pt:'✓ Atualizar disponibilidade', en:'✓ Update availability', es:'✓ Actualizar disponibilidad', ru:'✓ Обновить доступность' },
  confirmarDisp:    { pt:'✓ Confirmar disponibilidade', en:'✓ Confirm availability', es:'✓ Confirmar disponibilidad', ru:'✓ Подтвердить доступность' },
  selecioneFuncao:  { pt:'Selecione a função',    en:'Select the role',      es:'Selecciona la función', ru:'Выберите роль' },
  dispSalva:        { pt:'Disponibilidade salva!', en:'Availability saved!',  es:'¡Disponibilidad guardada!', ru:'Доступность сохранена!' },
  // Aba Disponibilidade — admin
  buscaNomeCnpj:    { pt:'🔍 Nome ou CNPJ...',    en:'🔍 Name or tax ID...', es:'🔍 Nombre o CNPJ...',  ru:'🔍 Имя или CNPJ...' },
  cadastrar:        { pt:'+ Cadastrar',           en:'+ Add',                es:'+ Registrar',          ru:'+ Добавить' },
  comoFuncionaTit:  { pt:'💡 Como funciona:',     en:'💡 How it works:',     es:'💡 Cómo funciona:',    ru:'💡 Как это работает:' },
  comoFuncionaTxt:  { pt:' Cada prestador declara seus dias/turnos/zonas disponíveis. O gerador automático usa essas informações para criar slots com candidatos pré-selecionados por nível e histórico.', en:' Each provider declares their available days/shifts/zones. The automatic generator uses this to create slots with candidates pre-selected by level and history.', es:' Cada prestador declara sus días/turnos/zonas disponibles. El generador automático usa esta información para crear slots con candidatos preseleccionados por nivel e historial.', ru:' Каждый исполнитель указывает доступные дни/смены/зоны. Автоматический генератор использует это для создания слотов с кандидатами, отобранными по уровню и истории.' },
  thNome:           { pt:'Nome',                  en:'Name',                 es:'Nombre',               ru:'Имя' },
  thDias:           { pt:'Dias',                  en:'Days',                 es:'Días',                 ru:'Дни' },
  thTurnos:         { pt:'Turnos',                en:'Shifts',               es:'Turnos',               ru:'Смены' },
  thZonas:          { pt:'Zonas',                 en:'Zones',                es:'Zonas',                ru:'Зоны' },
  thAcoes:          { pt:'Ações',                 en:'Actions',              es:'Acciones',             ru:'Действия' },
  nenhumaDispCad:   { pt:'Nenhuma disponibilidade cadastrada', en:'No availability registered', es:'Ninguna disponibilidad registrada', ru:'Доступность не зарегистрирована' },
  removerConfirm:   { pt:'Remover',               en:'Remove',               es:'Eliminar',             ru:'Удалить' },
  removido:         { pt:'Removido',              en:'Removed',              es:'Eliminado',            ru:'Удалено' },
  editarDisp:       { pt:'Editar disponibilidade', en:'Edit availability',   es:'Editar disponibilidad', ru:'Изменить доступность' },
  cadastrarDisp:    { pt:'+ Cadastrar disponibilidade', en:'+ Add availability', es:'+ Registrar disponibilidad', ru:'+ Добавить доступность' },
  nome:             { pt:'Nome',                  en:'Name',                 es:'Nombre',               ru:'Имя' },
  zonasPref:        { pt:'Zonas preferidas',      en:'Preferred zones',      es:'Zonas preferidas',     ru:'Предпочитаемые зоны' },
  salvar:           { pt:'✓ Salvar',              en:'✓ Save',               es:'✓ Guardar',            ru:'✓ Сохранить' },
  cadastrarBtn:     { pt:'✓ Cadastrar',           en:'✓ Add',                es:'✓ Registrar',          ru:'✓ Добавить' },
  nomeFuncaoObrig:  { pt:'Nome e função obrigatórios', en:'Name and role are required', es:'Nombre y función obligatorios', ru:'Имя и роль обязательны' },
  atualizado:       { pt:'Atualizado',            en:'Updated',              es:'Actualizado',          ru:'Обновлено' },
  cadastrado:       { pt:'Cadastrado',            en:'Registered',           es:'Registrado',           ru:'Добавлено' },
  // Ranking
  rkSemana:         { pt:'📅 Semana',             en:'📅 Week',              es:'📅 Semana',            ru:'📅 Неделя' },
  rkMes:            { pt:'🗓 Mês',                 en:'🗓 Month',             es:'🗓 Mes',               ru:'🗓 Месяц' },
  rkTotal:          { pt:'🏆 Total',              en:'🏆 Total',             es:'🏆 Total',             ru:'🏆 Всего' },
  rkTodos:          { pt:'Todos',                 en:'All',                  es:'Todos',                ru:'Все' },
  streak:           { pt:'Streak',                en:'Streak',               es:'Racha',                ru:'Серия' },
  rkSlots:          { pt:'Slots',                 en:'Slots',                es:'Slots',                ru:'Слоты' },
  carregando:       { pt:'Carregando...',         en:'Loading...',           es:'Cargando...',          ru:'Загрузка...' },
  thPrestador:      { pt:'Prestador',             en:'Provider',             es:'Prestador',            ru:'Исполнитель' },
  thNivel:          { pt:'Nível',                 en:'Level',                es:'Nivel',                ru:'Уровень' },
  thPontos:         { pt:'Pontos',                en:'Points',               es:'Puntos',               ru:'Очки' },
  thStreak:         { pt:'Streak',                en:'Streak',               es:'Racha',                ru:'Серия' },
  thSlots:          { pt:'Slots',                 en:'Slots',                es:'Slots',                ru:'Слоты' },
  thFaltas:         { pt:'Faltas',                en:'Absences',             es:'Ausencias',            ru:'Прогулы' },
  thAvaliacao:      { pt:'Avaliação',             en:'Rating',               es:'Evaluación',           ru:'Оценка' },
  nenhumPrestRk:    { pt:'Nenhum prestador no ranking', en:'No provider in the ranking', es:'Ningún prestador en el ranking', ru:'Нет исполнителей в рейтинге' },
  niveisPontuacao:  { pt:'🏆 Níveis e pontuação', en:'🏆 Levels and points', es:'🏆 Niveles y puntuación', ru:'🏆 Уровни и очки' },
  pts:              { pt:'pts',                    en:'pts',                  es:'pts',                  ru:'очк.' },
  comoGanhar:       { pt:'Como ganhar pontos:',   en:'How to earn points:',  es:'Cómo ganar puntos:',   ru:'Как зарабатывать очки:' },
  gpPresenca:       { pt:'Presença confirmada',   en:'Confirmed presence',   es:'Presencia confirmada', ru:'Подтверждённое присутствие' },
  gpInicioPrazo:    { pt:'Início no prazo',       en:'On-time start',        es:'Inicio a tiempo',      ru:'Своевременное начало' },
  gpAvaliacao5:     { pt:'Avaliação 5★',          en:'5★ rating',            es:'Evaluación 5★',        ru:'Оценка 5★' },
  gpStreakSemanal:  { pt:'Streak semanal (7d)',   en:'Weekly streak (7d)',   es:'Racha semanal (7d)',   ru:'Недельная серия (7д)' },
  gpStreakMensal:   { pt:'Streak mensal (30d)',   en:'Monthly streak (30d)', es:'Racha mensual (30d)',  ru:'Месячная серия (30д)' },
  gpPontoZerado:    { pt:'Ponto zerado',          en:'Empty spot covered',   es:'Punto cubierto',       ru:'Закрытая точка' },
  gpFalta:          { pt:'Falta',                 en:'Absence',              es:'Ausencia',             ru:'Прогул' },
  gpAtraso15:       { pt:'Atraso 15min',          en:'15min late',           es:'Retraso 15min',        ru:'Опоздание 15 мин' },
  gpAtraso30:       { pt:'Atraso 30min',          en:'30min late',           es:'Retraso 30min',        ru:'Опоздание 30 мин' },
  gpCancelTardio:   { pt:'Cancelamento tardio',   en:'Late cancellation',    es:'Cancelación tardía',   ru:'Позднее отмена' },
  // Penalidades
  penFalta:         { pt:'Falta',                 en:'Absence',              es:'Ausencia',             ru:'Прогул' },
  penAtraso:        { pt:'Atraso',                en:'Late',                 es:'Retraso',              ru:'Опоздание' },
  penCancelTardio:  { pt:'Cancelamento Tardio',   en:'Late Cancellation',    es:'Cancelación Tardía',   ru:'Позднее отмена' },
  penComportamento: { pt:'Comportamento',         en:'Behavior',             es:'Comportamiento',       ru:'Поведение' },
  registrarPen:     { pt:'⚠️ Registrar penalidade', en:'⚠️ Record penalty',  es:'⚠️ Registrar penalización', ru:'⚠️ Записать штраф' },
  thDescricao:      { pt:'Descrição',             en:'Description',          es:'Descripción',          ru:'Описание' },
  thPtsDeduzidos:   { pt:'Pts deduzidos',         en:'Pts deducted',         es:'Pts deducidos',        ru:'Снято очков' },
  thPor:            { pt:'Por',                    en:'By',                   es:'Por',                  ru:'Кем' },
  thTipo:           { pt:'Tipo',                   en:'Type',                 es:'Tipo',                 ru:'Тип' },
  nenhumaPen:       { pt:'Nenhuma penalidade registrada', en:'No penalty recorded', es:'Ninguna penalización registrada', ru:'Штрафы не зарегистрированы' },
  registrarPenTit:  { pt:'⚠️ Registrar Penalidade', en:'⚠️ Record Penalty',  es:'⚠️ Registrar Penalización', ru:'⚠️ Запись штрафа' },
  prestador:        { pt:'Prestador',             en:'Provider',             es:'Prestador',            ru:'Исполнитель' },
  selecionar:       { pt:'— Selecionar —',        en:'— Select —',           es:'— Seleccionar —',      ru:'— Выбрать —' },
  tipo:             { pt:'Tipo',                   en:'Type',                 es:'Tipo',                 ru:'Тип' },
  descricao:        { pt:'Descrição',             en:'Description',          es:'Descripción',          ru:'Описание' },
  descPlaceholder:  { pt:'Ex: Faltou no slot T1 sem aviso', en:'E.g.: Missed T1 slot without notice', es:'Ej: Faltó al slot T1 sin aviso', ru:'Напр.: Пропустил слот T1 без предупреждения' },
  pontosDeduzir:    { pt:'Pontos a deduzir',      en:'Points to deduct',     es:'Puntos a deducir',     ru:'Очков к вычету' },
  penAvisoA:        { pt:'⚠️ Esta ação deduzirá ', en:'⚠️ This action will deduct ', es:'⚠️ Esta acción deducirá ', ru:'⚠️ Это действие вычтет ' },
  penAvisoPontos:   { pt:'pontos',                en:'points',               es:'puntos',               ru:'очков' },
  penAvisoB:        { pt:' do prestador e será registrada permanentemente.', en:' from the provider and will be recorded permanently.', es:' del prestador y se registrará permanentemente.', ru:' у исполнителя и будет записано навсегда.' },
  aplicando:        { pt:'Aplicando...',          en:'Applying...',          es:'Aplicando...',         ru:'Применение...' },
  aplicarPen:       { pt:'⚠️ Aplicar penalidade', en:'⚠️ Apply penalty',     es:'⚠️ Aplicar penalización', ru:'⚠️ Применить штраф' },
  selPrestDesc:     { pt:'Selecione prestador e descrição', en:'Select provider and description', es:'Selecciona prestador y descripción', ru:'Выберите исполнителя и описание' },
  penAplicada:      { pt:'Penalidade aplicada',   en:'Penalty applied',      es:'Penalización aplicada', ru:'Штраф применён' },
  // Config
  configTitulo:     { pt:'⚙️ Configurações de escala —', en:'⚙️ Schedule settings —', es:'⚙️ Configuración de turnos —', ru:'⚙️ Настройки расписания —' },
  global:           { pt:'global',                en:'global',               es:'global',               ru:'глобально' },
  cfgGerarDias:     { pt:'Gerar escala (dias antes)', en:'Generate schedule (days ahead)', es:'Generar turno (días antes)', ru:'Создавать расписание (за дней)' },
  cfgNivelMin:      { pt:'Nível mínimo (urgências)', en:'Minimum level (urgent)', es:'Nivel mínimo (urgencias)', ru:'Мин. уровень (срочные)' },
  cfgRespeitarPref: { pt:'Respeitar preferências de zona/turno', en:'Respect zone/shift preferences', es:'Respetar preferencias de zona/turno', ru:'Учитывать предпочтения зоны/смены' },
  cfgMarcarFeriados:{ pt:'Marcar feriados na escala', en:'Mark holidays on the schedule', es:'Marcar feriados en el turno', ru:'Отмечать праздники в расписании' },
  horariosTurno:    { pt:'⏰ Horários por turno',  en:'⏰ Shift hours',       es:'⏰ Horarios por turno', ru:'⏰ Часы по сменам' },
  horaInicio:       { pt:'Hora início',           en:'Start time',           es:'Hora inicio',          ru:'Время начала' },
  horaFim:          { pt:'Hora fim',              en:'End time',             es:'Hora fin',             ru:'Время окончания' },
  vagasPadrao:      { pt:'Vagas padrão',          en:'Default spots',        es:'Vacantes por defecto', ru:'Места по умолчанию' },
  bonusPontuacao:   { pt:'🏆 Bônus de pontuação', en:'🏆 Point bonuses',     es:'🏆 Bonos de puntuación', ru:'🏆 Бонусы очков' },
  bnPresenca:       { pt:'Presença confirmada',   en:'Confirmed presence',   es:'Presencia confirmada', ru:'Подтверждённое присутствие' },
  bnInicioPrazo:    { pt:'Início no prazo',       en:'On-time start',        es:'Inicio a tiempo',      ru:'Своевременное начало' },
  bnAvaliacao5:     { pt:'Avaliação 5★',          en:'5★ rating',            es:'Evaluación 5★',        ru:'Оценка 5★' },
  bnPontoZerado:    { pt:'Ponto zerado atendido', en:'Empty spot covered',   es:'Punto cubierto',       ru:'Закрытая точка' },
  bnStreakSemanal:  { pt:'Streak semanal (7d)',   en:'Weekly streak (7d)',   es:'Racha semanal (7d)',   ru:'Недельная серия (7д)' },
  bnStreakMensal:   { pt:'Streak mensal (30d)',   en:'Monthly streak (30d)', es:'Racha mensual (30d)',  ru:'Месячная серия (30д)' },
  penalidadesTit:   { pt:'⚠️ Penalidades',        en:'⚠️ Penalties',         es:'⚠️ Penalizaciones',    ru:'⚠️ Штрафы' },
  pnFalta:          { pt:'Falta (-pts)',          en:'Absence (-pts)',       es:'Ausencia (-pts)',      ru:'Прогул (-очк.)' },
  pnAtraso15:       { pt:'Atraso 15min (-pts)',   en:'15min late (-pts)',    es:'Retraso 15min (-pts)', ru:'Опоздание 15 мин (-очк.)' },
  pnAtraso30:       { pt:'Atraso 30min (-pts)',   en:'30min late (-pts)',    es:'Retraso 30min (-pts)', ru:'Опоздание 30 мин (-очк.)' },
  pnCancelTardio:   { pt:'Cancelamento tardio (-pts)', en:'Late cancellation (-pts)', es:'Cancelación tardía (-pts)', ru:'Позднее отмена (-очк.)' },
  configSalva:      { pt:'Config salva',          en:'Settings saved',       es:'Config guardada',      ru:'Настройки сохранены' },
  salvarConfig:     { pt:'✓ Salvar configurações', en:'✓ Save settings',     es:'✓ Guardar configuración', ru:'✓ Сохранить настройки' },
  feriadosTit:      { pt:'🎉 Feriados',           en:'🎉 Holidays',          es:'🎉 Feriados',          ru:'🎉 Праздники' },
  nomeFeriado:      { pt:'Nome do feriado',       en:'Holiday name',         es:'Nombre del feriado',   ru:'Название праздника' },
  nacional:         { pt:'Nacional',              en:'National',             es:'Nacional',             ru:'Национальный' },
  addBtn:           { pt:'+ Add',                 en:'+ Add',                es:'+ Add',                ru:'+ Доб.' },
  dataNomeObrig:    { pt:'Data e nome obrigatórios', en:'Date and name are required', es:'Fecha y nombre obligatorios', ru:'Дата и название обязательны' },
  feriadoAdd:       { pt:'Feriado adicionado',    en:'Holiday added',        es:'Feriado agregado',     ru:'Праздник добавлен' },
  // Novo modelo unificado
  faixasTit:        { pt:'⏰ Faixas Horárias',    en:'⏰ Time Slots',         es:'⏰ Franjas Horarias',   ru:'⏰ Временные слоты' },
  faixaVazia:       { pt:'Modo Manual (sem geração automática)', en:'Manual Mode (no auto-generation)', es:'Modo Manual (sin generación automática)', ru:'Ручной режим (без авто-генерации)' },
  addFaixa:         { pt:'+ Faixa',               en:'+ Slot',               es:'+ Franja',             ru:'+ Слот' },
  remover:          { pt:'Remover',                en:'Remove',               es:'Eliminar',             ru:'Удалить' },
  perfisTit:        { pt:'📊 Perfis de Demanda',   en:'📊 Demand Profiles',   es:'📊 Perfiles de Demanda', ru:'📊 Профили спроса' },
  perfilDefault:    { pt:'_default (todas as zonas)', en:'_default (all zones)', es:'_default (todas las zonas)', ru:'_default (все зоны)' },
  mapaDiasTit:      { pt:'📅 Mapa de Dias',        en:'📅 Day Mapping',       es:'📅 Mapa de Días',      ru:'📅 Карта дней' },
  dom:              { pt:'Dom', en:'Sun', es:'Dom', ru:'Вс' },
  seg:              { pt:'Seg', en:'Mon', es:'Lun', ru:'Пн' },
  ter:              { pt:'Ter', en:'Tue', es:'Mar', ru:'Вт' },
  qua:              { pt:'Qua', en:'Wed', es:'Mié', ru:'Ср' },
  qui:              { pt:'Qui', en:'Thu', es:'Jue', ru:'Чт' },
  sex:              { pt:'Sex', en:'Fri', es:'Vie', ru:'Пт' },
  sab:              { pt:'Sáb', en:'Sat', es:'Sáb', ru:'Сб' },
  gojetTit:         { pt:'🚀 GoJet & Ajustes',     en:'🚀 GoJet & Adjustments', es:'🚀 GoJet & Ajustes', ru:'🚀 GoJet и настройки' },
  gojetAjuste:      { pt:'Usar dados GoJet ao vivo', en:'Use live GoJet data', es:'Usar datos GoJet en vivo', ru:'Использовать данные GoJet' },
  gojetCityId:      { pt:'GoJet City ID',          en:'GoJet City ID',        es:'GoJet City ID',        ru:'GoJet City ID' },
  feriadoPerfil:    { pt:'Perfil em feriados',     en:'Holiday profile',      es:'Perfil en feriados',   ru:'Профиль в праздники' },
  tetoVagasZona:    { pt:'Teto vagas/zona',        en:'Max slots/zone',       es:'Techo vagas/zona',     ru:'Макс. слотов/зона' },
  cargosTit:        { pt:'👷 Cargos',               en:'👷 Roles',             es:'👷 Cargos',             ru:'👷 Должности' },
  zonasAtivasTit:   { pt:'📍 Zonas Ativas',         en:'📍 Active Zones',      es:'📍 Zonas Activas',     ru:'📍 Активные зоны' },
  addZona:          { pt:'+ Zona',                 en:'+ Zone',               es:'+ Zona',               ru:'+ Зона' },
  syncZonas:        { pt:'🔄 Sincronizar do GoJet', en:'🔄 Sync from GoJet',   es:'🔄 Sincronizar de GoJet', ru:'🔄 Синхронизация из GoJet' },
  syncZonasOk:      { pt:'zonas descobertas',      en:'zones discovered',     es:'zonas descubiertas',   ru:'зон обнаружено' },
  syncZonasNone:    { pt:'Nenhuma zona encontrada', en:'No zones found',       es:'Ninguna zona encontrada', ru:'Зоны не найдены' },
  syncZonasNeedId:  { pt:'Preencha o GoJet City ID primeiro', en:'Fill GoJet City ID first', es:'Complete el GoJet City ID primero', ru:'Сначала заполните GoJet City ID' },
  addCargo:         { pt:'+ Cargo',                en:'+ Role',               es:'+ Cargo',              ru:'+ Должность' },
};

// Mapeia rótulos de nível (calculados por pontos) para o idioma atual.
const NIVEL_LABELS: Record<string, L> = {
  'Lendário':     TX.nvLendario,
  'Especialista': TX.nvEspecialista,
  'Experiente':   TX.nvExperiente,
  'Regular':      TX.nvRegular,
  'Iniciante':    TX.nvIniciante,
};

function useLang() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;
  // Traduz o rótulo de nível (calculado por pontos, em PT) para o idioma atual.
  const pickNivel = (labelPt: string) => { const o = NIVEL_LABELS[labelPt]; return o ? o[lang] ?? o.pt : labelPt; };
  return { lang, pick, pickNivel };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hoje  = () => new Date().toLocaleDateString('pt-BR');
const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const TURNOS   = ['T1','T2','T0'];
const FUNCOES_TODAS = ['Charger','Scalt','Motorista','Promotor','Fiscal'];
function funcoesParaUsuario(cargo?: string, role?: string): string[] {
  if (['admin','gestor','gestor_log','supergestor'].includes(role ?? '')) return FUNCOES_TODAS;
  const c = (cargo ?? '').toLowerCase();
  if (['charger','scalt','scout'].includes(c)) return ['Charger','Scalt'];
  if (c === 'motorista') return ['Motorista'];
  if (['promotor','promo','fiscal'].includes(c)) return ['Promotor','Fiscal'];
  return FUNCOES_TODAS;
}

function nivelLabel(pontos: number): { nivel: number; label: string; cor: string; emoji: string } {
  if (pontos >= 5000) return { nivel:5, label:'Lendário',    cor:'#f59e0b', emoji:'👑' };
  if (pontos >= 2000) return { nivel:4, label:'Especialista',cor:'#a855f7', emoji:'💎' };
  if (pontos >= 800)  return { nivel:3, label:'Experiente',  cor:'#3b82f6', emoji:'⭐' };
  if (pontos >= 300)  return { nivel:2, label:'Regular',     cor:'#10b981', emoji:'🔷' };
  return                     { nivel:1, label:'Iniciante',   cor:'#64748b', emoji:'🌱' };
}

function fmtTs(ts:any,short=false):string {
  if(!ts) return '—';
  const d=ts?.toDate?.()??new Date(ts);
  if(isNaN(d.getTime())) return '—';
  return short?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function toast(msg:string,tipo:'ok'|'erro'='ok'){
  const el=document.createElement('div');
  el.textContent=(tipo==='ok'?'✅ ':'❌ ')+msg;
  Object.assign(el.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'9999',
    background:tipo==='ok'?'linear-gradient(135deg,#10b981,#059669)':'linear-gradient(135deg,#ef4444,#dc2626)',
    color:'#fff',padding:'10px 18px',borderRadius:'10px',fontWeight:'700',fontSize:'13px',
    boxShadow:'0 4px 20px rgba(0,0,0,.5)',transition:'opacity .4s',fontFamily:"'Inter',sans-serif"});
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),400);},3000);
}

const ABAS: {id:AbaId;label:L}[] = [
  {id:'escala',          label:TX.abaEscala},
  {id:'disponibilidade', label:TX.abaDisponib},
  {id:'ranking',         label:TX.abaRanking},
  {id:'penalidades',     label:TX.abaPenalidades},
  {id:'config',          label:TX.abaConfig},
];

// ─── Componente raiz ──────────────────────────────────────────────────────────

export default function SlotsTeamsModule({ usuario, onFechar, cidade }: Props) {
  const [aba, setAba] = useState<AbaId>('escala');
  const cidadeAtiva = cidade || usuario.cidade || '';
  const { pick } = useLang();

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={S.logo}>👥</div>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:T.txt}}>Slots & Teams</div>
            <div style={{fontSize:11,color:T.dim}}>{cidadeAtiva||pick(TX.todas)} · {pick(TX.subtitulo)}</div>
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:11,color:T.dim}}>{usuario.nome}</span>
          <button onClick={onFechar} style={{...S.btn(undefined,true),padding:'6px 12px'}}>{pick(TX.fechar)}</button>
        </div>
      </div>
      <div style={S.tabs}>
        {ABAS.map(a=><button key={a.id} onClick={()=>setAba(a.id)} style={S.tab(aba===a.id)}>{pick(a.label)}</button>)}
      </div>
      <div style={S.body}>
        {aba==='escala'          && <AbaEscala          usuario={usuario} cidade={cidadeAtiva} />}
        {aba==='disponibilidade' && <AbaDisponibilidade  usuario={usuario} cidade={cidadeAtiva} />}
        {aba==='ranking'         && <AbaRanking          cidade={cidadeAtiva} />}
        {aba==='penalidades'     && <AbaPenalidades       usuario={usuario} cidade={cidadeAtiva} />}
        {aba==='config'          && <AbaConfigTeams       cidade={cidadeAtiva} />}
      </div>
    </div>
  );
}

interface AbaProps { usuario: Usuario; cidade: string; }

// ═══════════════════════════════════════════════════════════════════════════════
// ABA ESCALA — geração automática por disponibilidade + zona + feriado
// ═══════════════════════════════════════════════════════════════════════════════

function AbaEscala({usuario,cidade}:AbaProps){
  const { pick } = useLang();
  const [slots,        setSlots       ]=useState<Slot[]>([]);
  const [aceites,      setAceites     ]=useState<SlotAceite[]>([]);
  const [disponibilidades,setDisps    ]=useState<Disponibilidade[]>([]);
  const [feriados,     setFeriados    ]=useState<Feriado[]>([]);
  const [cfg,          setCfg         ]=useState<EscalaConfig|null>(null);
  const [gerando,      setGerando     ]=useState(false);
  const [diasAhead,    setDiasAhead   ]=useState(3);
  const [previa,       setPrevia      ]=useState<any[]>([]);
  const [showPrevia,   setShowPrevia  ]=useState(false);
  // Fase 1 (convergência): demanda GoJet → bônus de vagas p/ funções de campo.
  const [demanda,      setDemanda     ]=useState<{bonus:number;zonasCriticas:string[]}>({bonus:0,zonasCriticas:[]});
  // Fase 3 (inteligência): prestadores p/ priorizar alocação por confiabilidade.
  const [prests,       setPrests      ]=useState<any[]>([]);
  // Fase 2 (métricas): previsibilidade da escala (RPC analytics_escala).
  const [metricas,     setMetricas    ]=useState<any>(null);

  useEffect(()=>{
    fetchDemandaGojet(cidade).then(setDemanda).catch(()=>{});
    fetchPrestadores(cidade).then(setPrests).catch(()=>{});
    fetchMetricasEscala(cidade).then(setMetricas).catch(()=>{});
    return subscribeEscala(cidade, d => {
      setSlots(d.slots as any); setAceites(d.aceites as any);
      setDisps(d.disponibilidades as any); setFeriados(d.feriados as any);
      if (d.cfg) setCfg(d.cfg as any);
    });
  },[cidade]);

  // Resolve perfil do dia: override por data > feriado > mapa_dias
  const resolvePerfilDia = useCallback((dataD: Date, dataStr: string, isFer: boolean): string => {
    const isoCheck = dataD.toISOString().slice(0,10);
    if (cfg?.overridesData?.[isoCheck]) return cfg.overridesData[isoCheck];
    if (isFer) return cfg?.feriadoPerfil ?? 'baixa';
    const dow = String(dataD.getDay());
    return cfg?.mapaDias?.[dow] ?? 'media';
  },[cfg]);

  // Vagas do perfil para zona×cargo (zone-specific > _default)
  const vagasDoPerfil = useCallback((perfilNome: string, zona: string, cargo: string): number => {
    const perfil = cfg?.perfis?.[perfilNome];
    if (!perfil) return 0;
    return perfil[zona]?.[cargo] ?? perfil._default?.[cargo] ?? 0;
  },[cfg]);

  // Gera prévia da escala para os próximos N dias
  const gerarPrevia = useCallback(()=>{
    const gerado: any[] = [];
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const teto = cfg?.tetoVagasZona ?? cfg?.tetoVagas ?? 10;
    const pontosMap: Record<string,number> = Object.fromEntries(prests.map((p:any)=>[p.uid, p.pontos||0]));

    // Use new model (faixas+perfis) if configured, else legacy (turnosConfig)
    const usarNovoModelo = (cfg?.faixas?.length ?? 0) > 0 && Object.keys(cfg?.perfis ?? {}).length > 0;
    const faixas = usarNovoModelo ? cfg!.faixas : TURNOS.map(t => ({ id: t, horaIni: cfg?.turnosConfig?.[t]?.horaIni || '07:00', horaFim: cfg?.turnosConfig?.[t]?.horaFim || '15:00' }));
    const cargos = usarNovoModelo ? (cfg?.cargos ?? FUNCOES_TODAS) : FUNCOES_TODAS;
    const zonas = usarNovoModelo ? (cfg?.zonasAtivas ?? ['Auto']) : ['Auto'];

    for(let d=1;d<=diasAhead;d++){
      const dataD = new Date(hoje.getTime()+d*86400000);
      const dataStr = dataD.toLocaleDateString('pt-BR');
      const diaSem  = dataD.getDay();
      const isFeriado = feriados.some(f=>f.data===dataStr||(f.nacional&&f.data.slice(0,5)===dataStr.slice(0,5)));

      for(const faixa of faixas){
        const turnoId = faixa.id;
        const horaIni = faixa.horaIni;
        const horaFim = faixa.horaFim;

        for(const zona of zonas){
          for(const funcao of cargos){
            // Calculate vagas: new model uses perfis, legacy uses turnosConfig.qtdPadrao
            let qtd: number;
            if (usarNovoModelo) {
              const perfilNome = resolvePerfilDia(dataD, dataStr, isFeriado);
              qtd = vagasDoPerfil(perfilNome, zona, funcao);
              // GoJet bonus for field roles
              const ehCampo = ['Charger','Scout','Scalt'].includes(funcao);
              if (ehCampo && demanda.bonus > 0) qtd += demanda.bonus;
            } else {
              const ehCampo = funcao==='Charger'||funcao==='Scout'||funcao==='Scalt';
              qtd = (cfg?.turnosConfig?.[turnoId]?.qtdPadrao || 2) + (ehCampo ? demanda.bonus : 0);
            }
            qtd = Math.min(teto, qtd);
            if (qtd <= 0) continue;

            // Encontra disponíveis para este dia/turno/função
            const disponiveis = disponibilidades.filter(dp=>
              dp.funcao===funcao&&
              dp.diasSemana.includes(diaSem)&&
              dp.turnosDisponiveis.includes(turnoId)&&
              (!cidade||dp.cidade===cidade)&&
              (zona==='Auto'||!dp.zonasDisponiveis?.length||dp.zonasDisponiveis.includes(zona))
            );

            // Verificar se já existe slot para este dia/turno/função/zona
            const isoCheck = dataD.toISOString().slice(0,10);
            const jaExiste = slots.some(sl=>(sl.dataSlot===dataStr||(sl.turnoInicio&&sl.turnoInicio.slice(0,10)===isoCheck))&&sl.turno===turnoId&&sl.tipo===funcao&&(zona==='Auto'||sl.zona===zona));
            if(jaExiste) continue;

            // Fase 3: prioriza por CONFIABILIDADE (pontos do prestador), desc.
            const candidatos = disponiveis
              .slice()
              .sort((a,b)=>(pontosMap[b.uid!]||0)-(pontosMap[a.uid!]||0))
              .slice(0,qtd*2);
            const sugeridos = candidatos.slice(0,qtd).map(c=>({uid:c.uid,nome:c.nome,pontos:pontosMap[c.uid!]||0}));

            gerado.push({
              turno: turnoId, horaIni, horaFim, tipo: funcao, zona,
              dataSlot: dataStr,
              diaSem: DIAS_SEM[diaSem],
              isFeriado,
              qtdPessoas: qtd,
              candidatos: candidatos.length,
              sugeridos,
              cidade: cidade||'SP',
              status:'preview',
            });
          }
        }
      }
    }
    setPrevia(gerado);
    setShowPrevia(true);
  },[diasAhead,disponibilidades,slots,feriados,cfg,cidade,demanda,prests,resolvePerfilDia,vagasDoPerfil]);

  // Cria os slots da prévia no Firestore
  const confirmarEscala = async()=>{
    if(!previa.length){toast(pick(TX.nenhumSlotCriar),'erro');return;}
    setGerando(true);
    try {
      const n = await criarSlotsEscala(previa, usuario, cfg);
      await logEscalaAudit('geracao_escala', { dias: diasAhead, slots: n, demandaBonus: demanda.bonus }, usuario.uid, cidade);
      toast(`${n} ${pick(TX.slotsCriadosAuto)}`);
    }
    catch(e:any){ toast(e?.message||pick(TX.erroAoCriar),'erro'); }
    setGerando(false); setShowPrevia(false); setPrevia([]);
  };

  // Stats da semana
  const hoje7d = new Date(); hoje7d.setHours(0,0,0,0);
  const slotsSem = slots.filter(()=>true); // já filtrado no useEffect
  const vagasTotal = slotsSem.reduce((s,sl)=>s+(sl.qtdPessoas||0),0);
  const acAll = aceites.filter(a=>slotsSem.some(sl=>sl.id===a.slotId)&&a.status!=='Desistiu');
  const pctPreen = vagasTotal>0?Math.round(acAll.length/vagasTotal*100):0;

  return(
    <div>
      <div style={S.kpiRow}>
        {[
          {n:slotsSem.length, l:pick(TX.kpiSlots7),   c:T.bluel },
          {n:vagasTotal,      l:pick(TX.kpiVagas),     c:T.purple},
          {n:acAll.length,    l:pick(TX.kpiAceites),         c:T.green },
          {n:`${pctPreen}%`,  l:pick(TX.kpiPreench),   c:pctPreen>=80?T.green:pctPreen>=50?T.yellow:T.red},
          {n:disponibilidades.length,l:pick(TX.kpiComDisp),c:T.bluel},
          {n:feriados.length, l:pick(TX.kpiFeriados),   c:T.orange},
        ].map(({n,l,c})=>(
          <div key={l} style={S.kpi(c)}><div style={S.kpiN(c)}>{n}</div><div style={S.kpiL}>{l}</div></div>
        ))}
      </div>

      {/* Gerador automático */}
      <div style={{...S.card(T.blueg),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.geradorTitulo)}</div>
        <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap',marginBottom:12}}>
          <div>
            <label style={S.lbl}>{pick(TX.gerarProximos)}</label>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {[1,2,3,5,7].map(d=>(
                <button key={d} onClick={()=>setDiasAhead(d)}
                  style={{...S.btn(T.bluel,diasAhead!==d),padding:'6px 12px',fontSize:12}}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <button onClick={gerarPrevia} style={{...S.btnG(T.blueg)}}>
            {pick(TX.verPrevia)} ({diasAhead} {pick(TX.dias)})
          </button>
          {showPrevia&&previa.length>0&&(
            <button onClick={confirmarEscala} disabled={gerando}
              style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)')}}>
              {gerando?pick(TX.criando):`${pick(TX.criarSlots)} ${previa.length} ${pick(TX.slotsLabel)}`}
            </button>
          )}
        </div>

        <div style={{fontSize:12,color:T.dim}}>
          {pick(TX.criterios)}
          {disponibilidades.length===0&&<span style={{color:T.orange}}>{pick(TX.semDispAviso)}</span>}
        </div>
      </div>

      {/* Prévia */}
      {showPrevia&&(
        <div style={{...S.card(T.green),marginBottom:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={S.sec}>{pick(TX.previaTitulo)} — {previa.length} {pick(TX.slotsACriar)}</div>
            <button onClick={()=>setShowPrevia(false)} style={{...S.btn(undefined,true),padding:'4px 8px',fontSize:11}}>{pick(TX.ocultar)}</button>
          </div>
          {previa.length===0?(
            <div style={{color:T.dim,fontSize:12}}>{pick(TX.todosExistem)}</div>
          ):(
            <div style={{overflowX:'auto'}}>
              <table style={S.table}>
                <thead><tr>{[pick(TX.thData),pick(TX.thDia),pick(TX.thTurno),pick(TX.thFuncao),pick(TX.thVagas),pick(TX.thCandidatos),pick(TX.thFeriado)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {previa.map((p,i)=>(
                    <tr key={i}>
                      <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{p.dataSlot}</td>
                      <td style={S.td}>{p.diaSem}</td>
                      <td style={S.td}><span style={S.chip(T.purple)}>{p.turno}</span></td>
                      <td style={S.td}><span style={S.chip(p.tipo==='Charger'?T.yellow:T.green)}>{p.tipo}</span></td>
                      <td style={{...S.td,textAlign:'center'}}>{p.qtdPessoas}</td>
                      <td style={{...S.td,textAlign:'center',color:p.candidatos>=p.qtdPessoas?T.green:T.red}}>{p.candidatos}</td>
                      <td style={S.td}>{p.isFeriado?<span style={S.chip(T.orange)}>{pick(TX.feriadoChip)}</span>:'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Métricas de previsibilidade (analytics_escala) */}
      {metricas&&(
        <div style={{...S.card(),padding:'8px 12px',marginBottom:8,display:'flex',gap:14,flexWrap:'wrap',fontSize:11,color:T.dim}}>
          <span>📊 <b style={{color:T.txt}}>{metricas.slots||0}</b> {pick(TX.slotsLabel)} · <b style={{color:T.txt}}>{metricas.vagas||0}</b> {pick(TX.kpiVagas).toLowerCase()} · <b style={{color:T.txt}}>{metricas.gerado_auto||0}</b> {pick(TX.metAuto)} (7d)</span>
          {metricas.por_funcao&&Object.entries(metricas.por_funcao).map(([f,n]:any)=><span key={f}>{f}: <b style={{color:T.bluel}}>{n}</b></span>)}
          {metricas.pct_preenchimento!=null&&<span>Preenchi: <b style={{color:metricas.pct_preenchimento>=80?T.green:metricas.pct_preenchimento>=50?T.yellow:T.red}}>{metricas.pct_preenchimento}%</b></span>}
          {metricas.antecedencia_media_min!=null&&<span>Antecedência: <b style={{color:T.txt}}>{metricas.antecedencia_media_min}min</b></span>}
          {metricas.total_aceites!=null&&<span>Aceites: <b style={{color:T.txt}}>{metricas.total_aceites}</b></span>}
          {metricas.total_reabertos>0&&<span>Reabertos: <b style={{color:T.orange}}>{metricas.total_reabertos}</b></span>}
          {metricas.total_overrides>0&&<span>Overrides: <b style={{color:T.orange}}>{metricas.total_overrides}</b></span>}
        </div>
      )}

      {/* Calendario slots 7 dias */}
      <div style={S.card()}>
        <div style={S.sec}>{pick(TX.calTitulo)}</div>
        {Array.from({length:7},(_,i)=>{
          const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+i);
          const dataStr = d.toLocaleDateString('pt-BR');
          const isoStr = d.toISOString().slice(0,10);
          const slotsDia = slots.filter(sl=>{
            if(sl.dataSlot===dataStr) return true;
            if(sl.turnoInicio && sl.turnoInicio.slice(0,10)===isoStr) return true;
            return false;
          }).sort((a,b)=>(a.turnoInicio||a.horaIni||'').localeCompare(b.turnoInicio||b.horaIni||''));
          const isFeriado = feriados.some(f=>f.data===dataStr);
          return(
            <div key={i} style={{marginBottom:8,paddingBottom:8,borderBottom:`1px solid ${T.bdr2}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13,color:T.txt}}>{DIAS_SEM[d.getDay()]}, {dataStr.slice(0,5)}</div>
                {isFeriado&&<span style={S.chip(T.orange)}>{pick(TX.feriadoChip)}</span>}
                {slotsDia.length===0&&<span style={{fontSize:11,color:T.dim}}>{pick(TX.semSlots)}</span>}
                <div style={{fontSize:11,color:T.dim,marginLeft:'auto'}}>{slotsDia.length} {pick(TX.slotsLabel)}</div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {slotsDia.map(sl=>{
                  const slAc=aceites.filter(a=>a.slotId===sl.id&&a.status!=='Desistiu').length;
                  const vagas = sl.qtdPessoas||1;
                  const slAb=Math.max(0,vagas-slAc);
                  const hora = sl.horaIni||(sl.turnoInicio?sl.turnoInicio.slice(11,16):'');
                  const horaFim = sl.horaFim||(sl.turnoFim?sl.turnoFim.slice(11,16):'');
                  const jaAceitou = sl.aceitoPor===usuario.uid;
                  const meuTurno = sl.turno||sl.turnoInicio?.slice(11,16)||'';
                  const conflito = !jaAceitou && slots.some(o=>
                    o.id!==sl.id && o.aceitoPor===usuario.uid &&
                    (o.turno||o.turnoInicio?.slice(11,16)||'')=== meuTurno &&
                    ((o.dataSlot && o.dataSlot===sl.dataSlot) ||
                     (o.turnoInicio && sl.turnoInicio && o.turnoInicio.slice(0,10)===sl.turnoInicio.slice(0,10)))
                  );
                  const podeAceitar = sl.status==='aberto' && !sl.aceitoPor && !conflito;
                  const isAdmin = ['admin','gestor','gestor_log','logistica','supergestor'].includes(usuario.role);
                  const podeCancelar = jaAceitou || (isAdmin && sl.aceitoPor && sl.status==='aceito');
                  return(
                    <div key={sl.id} style={{...S.card(),padding:'8px 10px',minWidth:150,flex:'0 0 auto',
                      border: jaAceitou?`2px solid ${T.green}`:podeAceitar?`2px solid ${T.yellow}`:conflito?`2px solid ${T.red}`:'none',
                      opacity: sl.status==='aceito'&&!jaAceitou&&!isAdmin?0.6:1}}>
                      <div style={{fontSize:12,fontWeight:700,color:T.bluel}}>{sl.turno||''} · {hora}–{horaFim}</div>
                      <div style={{fontSize:11,color:T.dim}}>{sl.tipo||sl.cargo||''} · {sl.zona||sl.zonaOrigem||''}</div>
                      <div style={{fontSize:10,marginTop:3,display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                        <span style={S.chip(slAb>0?T.yellow:T.green)}>{slAc}/{vagas}</span>
                        <span style={{...S.chip(sl.status==='aceito'?T.green:sl.status==='aberto'?T.yellow:T.dim),fontSize:9}}>{sl.status}</span>
                        {(sl.geradoAuto||sl.geradoAutomatico)&&<span style={{...S.chip(T.dim),fontSize:9}}>AUTO</span>}
                      </div>
                      {podeAceitar&&(
                        <button onClick={async()=>{
                          if(!await confirmDialog('Aceitar slot', `Aceitar slot ${sl.turno||''} ${hora}–${horaFim} em ${sl.zona||sl.zonaOrigem||''}?`)) return;
                          try{
                            const r:any=await aceitarEscala(sl.id);
                            toast(r?.jaAceito?pick(TX.jaAceitou):pick(TX.aceitoOk));
                          }catch(e:any){toast(e?.message||pick(TX.erroGenerico),'erro');}
                        }}
                          style={{...S.btn(T.green),padding:'4px 10px',fontSize:11,marginTop:5,width:'100%'}}>Aceitar</button>
                      )}
                      {conflito&&sl.status==='aberto'&&(
                        <div style={{fontSize:10,marginTop:4,color:T.red}}>⚠ Conflito de horário</div>
                      )}
                      {jaAceitou&&(
                        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
                          <span style={{fontSize:10,color:T.green,fontWeight:700}}>✓ Aceito por você</span>
                          <button onClick={async()=>{
                            if(!await confirmDialog('Desistir', 'Desistir deste slot?', {variant:'danger'})) return;
                            try{
                              const { error } = await supabase.from('slots_escala').update({
                                status:'aberto', aceito_por:null, aceito_por_nome:null, aceito_em:null,
                                motivo_cancelamento:'desistência_prestador', cancelado_por:usuario.uid,
                              }).eq('id',sl.id);
                              if(error) throw error;
                              toast('Slot liberado');
                            }catch(e:any){toast(e?.message||'Erro','erro');}
                          }} style={{...S.btn(T.red,true),padding:'2px 6px',fontSize:9}}>Desistir</button>
                        </div>
                      )}
                      {sl.aceitoPor&&!jaAceitou&&(
                        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
                          <span style={{fontSize:10,color:T.dim}}>Aceito: {sl.aceitoPorNome||'—'}</span>
                          {isAdmin&&podeCancelar&&(
                            <button onClick={async()=>{
                              if(!await confirmDialog('Remover prestador', `Remover ${sl.aceitoPorNome||'prestador'} deste slot?`, {variant:'danger'})) return;
                              try{
                                const { error } = await supabase.from('slots_escala').update({
                                  status:'aberto', aceito_por:null, aceito_por_nome:null, aceito_em:null,
                                  motivo_cancelamento:'removido_admin', cancelado_por:usuario.uid,
                                }).eq('id',sl.id);
                                if(error) throw error;
                                toast('Prestador removido do slot');
                              }catch(e:any){toast(e?.message||'Erro','erro');}
                            }} style={{...S.btn(T.red,true),padding:'2px 6px',fontSize:9}}>Remover</button>
                          )}
                        </div>
                      )}
                      {isAdmin&&sl.status!=='Cancelado'&&(
                        <div style={{display:'flex',gap:4,marginTop:4}}>
                          <button onClick={async()=>{
                            const motivo=await promptDialog('Cancelar slot', {placeholder:'Motivo do cancelamento'});
                            if(!motivo) return;
                            try{await cancelarSlotEscala(sl.id,usuario.uid,motivo);toast('Slot cancelado');}
                            catch(e:any){toast(e?.message||'Erro','erro');}
                          }} style={{...S.btn(T.red,true),padding:'2px 6px',fontSize:9}}>Cancelar</button>
                          <button onClick={async()=>{
                            const novaQtd=await promptDialog('Override de vagas', {placeholder:'Nova quantidade', defaultValue:String(sl.qtdPessoas||1)});
                            if(!novaQtd) return;
                            const motivo=await promptDialog('Motivo do override', {placeholder:'Motivo'});
                            if(!motivo) return;
                            try{await overrideSlotEscala(sl.id,{qtdPessoas:Number(novaQtd)},usuario.uid,motivo);toast('Override aplicado');}
                            catch(e:any){toast(e?.message||'Erro','erro');}
                          }} style={{...S.btn(T.orange,true),padding:'2px 6px',fontSize:9}}>Override</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPONIBILIDADE HOJE — banner inline na view admin
// ═══════════════════════════════════════════════════════════════════════════════

function DisponibilidadeHoje({lista}:{lista:Disponibilidade[]}){
  const { pick } = useLang();
  const hojeIdx=new Date().getDay();
  const [aberto,setAberto]=useState(false);
  const dispHoje=useMemo(()=>lista.filter(d=>(d.diasSemana||[]).includes(hojeIdx)),[lista,hojeIdx]);
  const diaLabel=DIAS_SEM[hojeIdx];
  if(dispHoje.length===0) return(
    <div style={{...S.card(T.yellow),marginBottom:12,fontSize:12,color:T.dim}}>
      {pick(TX.nenhumDispHoje)} ({diaLabel})
    </div>
  );
  return(
    <div style={{...S.card(T.green),marginBottom:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>setAberto(a=>!a)}>
        <div style={{fontSize:12,fontWeight:700,color:T.txt}}>
          ✅ {dispHoje.length} {pick(TX.dispHoje)} ({diaLabel})
        </div>
        <span style={{color:T.dim,fontSize:12}}>{aberto?'▲':'▼'}</span>
      </div>
      {aberto&&(
        <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
          {dispHoje.map(d=>(
            <div key={d.id} style={{background:T.card,borderRadius:8,padding:'6px 10px',fontSize:11}}>
              <div style={{fontWeight:600,color:T.txt}}>{d.nome}</div>
              <div style={{color:T.dim,marginTop:2}}>
                <span style={S.chip(d.funcao==='Charger'?T.yellow:T.green)}>{d.funcao}</span>
                {' '}{(d.turnosDisponiveis||[]).join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA DISPONIBILIDADE — prestadores declaram quando podem trabalhar
// ═══════════════════════════════════════════════════════════════════════════════

const CAMPO_ROLES = ['logistica','campo','charger','scalt','promotor'];

function AbaDisponibilidade({usuario,cidade}:AbaProps){
  const { pick } = useLang();
  const isCampo = CAMPO_ROLES.includes(usuario.role);
  const [lista,    setLista   ]=useState<Disponibilidade[]>([]);
  const [busca,    setBusca   ]=useState('');
  const [modal,    setModal   ]=useState(false);
  const [editando, setEditando]=useState<Disponibilidade|null>(null);
  const [form,     setForm    ]=useState<Partial<Disponibilidade>>({
    diasSemana:[1,2,3,4,5],turnosDisponiveis:['T1'],zonasDisponiveis:[],funcao:'Scout',
  });
  const [zonas,    setZonas   ]=useState<string[]>([]);
  const [salvando, setSalvando]=useState(false);
  // self-service: disponibilidade do próprio usuário
  const [minha,    setMinha   ]=useState<Disponibilidade|null>(null);
  const [minhaForm,setMinhaForm]=useState<Partial<Disponibilidade>>({
    diasSemana:[1,2,3,4,5],turnosDisponiveis:['T1'],zonasDisponiveis:[],funcao:'Scout',
  });
  const [salvandoMinha,setSalvandoMinha]=useState(false);

  useEffect(()=>{
    let vivo=true;
    const aplicar=(all:Disponibilidade[])=>{
      if(!vivo)return; setLista(all);
      if(isCampo){ const meu=all.find(d=>d.uid===usuario.uid)||null; setMinha(meu); if(meu) setMinhaForm({...meu}); }
    };
    const run=()=>fetchDisponibilidades(cidade).then(a=>aplicar(a as any)).catch(e=>console.warn('[escala-supa]',e?.message));
    run(); const t=setInterval(run,10000);
    // zonas from supabase
    supabase.from('slots_escala').select('zona').eq('cidade',cidade||'').limit(50).then(({data})=>{
      const set=new Set<string>();(data||[]).forEach((r:any)=>{if(r.zona)set.add(r.zona);});setZonas(Array.from(set).sort());
    });
    return ()=>{vivo=false;clearInterval(t);};
  },[cidade,isCampo,usuario.uid]);

  const salvarMinha=async()=>{
    if(!minhaForm.funcao){toast(pick(TX.selecioneFuncao),'erro');return;}
    setSalvandoMinha(true);
    const payload:Partial<Disponibilidade>={
      ...minhaForm,
      uid:usuario.uid,
      nome:usuario.nome||usuario.email,
      cidade:cidade||'SP',
    };
    try{
      await salvarDisponibilidade(payload);
      toast(pick(TX.dispSalva));
    }catch(e:any){toast(e.message,'erro');}
    finally{setSalvandoMinha(false);}
  };

  const filtrados=useMemo(()=>lista.filter(d=>!busca||d.nome.toLowerCase().includes(busca.toLowerCase())||(d.cnpj||'').includes(busca)),[lista,busca]);

  const salvar=async()=>{
    if(!form.nome?.trim()||!form.funcao){toast(pick(TX.nomeFuncaoObrig),'erro');return;}
    setSalvando(true);
    try{
      await salvarDisponibilidadeForm({ ...form, id: editando?.id, cidade: cidade||'SP' });
      toast(editando?.id?pick(TX.atualizado):pick(TX.cadastrado));
      setModal(false);
    }catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const toggleDia=(d:number)=>setForm(f=>({...f,diasSemana:(f.diasSemana||[]).includes(d)?(f.diasSemana||[]).filter(x=>x!==d):[...(f.diasSemana||[]),d]}));
  const toggleTurno=(t:string)=>setForm(f=>({...f,turnosDisponiveis:(f.turnosDisponiveis||[]).includes(t)?(f.turnosDisponiveis||[]).filter(x=>x!==t):[...(f.turnosDisponiveis||[]),t]}));
  const toggleZona=(z:string)=>setForm(f=>({...f,zonasDisponiveis:(f.zonasDisponiveis||[]).includes(z)?(f.zonasDisponiveis||[]).filter(x=>x!==z):[...(f.zonasDisponiveis||[]),z]}));

  const mToggleDia=(d:number)=>setMinhaForm(f=>({...f,diasSemana:(f.diasSemana||[]).includes(d)?(f.diasSemana||[]).filter(x=>x!==d):[...(f.diasSemana||[]),d]}));
  const mToggleTurno=(t:string)=>setMinhaForm(f=>({...f,turnosDisponiveis:(f.turnosDisponiveis||[]).includes(t)?(f.turnosDisponiveis||[]).filter(x=>x!==t):[...(f.turnosDisponiveis||[]),t]}));
  const mToggleZona=(z:string)=>setMinhaForm(f=>({...f,zonasDisponiveis:(f.zonasDisponiveis||[]).includes(z)?(f.zonasDisponiveis||[]).filter(x=>x!==z):[...(f.zonasDisponiveis||[]),z]}));

  // self-service view (campo roles)
  if(isCampo) return(
    <div style={{maxWidth:560}}>
      <div style={{...S.card(T.bluel),marginBottom:16,fontSize:13,color:T.txt}}>
        <div style={{fontWeight:700,marginBottom:4}}>{pick(TX.minhaDispTitulo)}</div>
        <div style={{fontSize:11,color:T.dim,lineHeight:1.5}}>
          {pick(TX.minhaDispDesc)}
        </div>
      </div>

      {minha&&(
        <div style={{...S.card(T.green),marginBottom:12,fontSize:11,color:T.dim,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontSize:16}}>✅</span>
          <div>
            <b style={{color:T.txt}}>{pick(TX.dispJaCadastrada)}</b>{pick(TX.atualizeAbaixo)}
          </div>
        </div>
      )}

      <div style={{...S.card(),marginBottom:14}}>
        <label style={S.lbl}>{pick(TX.funcao)}</label>
        <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
          {funcoesParaUsuario(usuario.cargoPrestador, usuario.role).map(fn=><button key={fn} onClick={()=>setMinhaForm(f=>({...f,funcao:fn}))} style={{...S.btn(fn==='Charger'?T.yellow:T.green,minhaForm.funcao!==fn),padding:'6px 14px'}}>{fn}</button>)}
        </div>

        <label style={S.lbl}>{pick(TX.diasDisponiveis)}</label>
        <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
          {DIAS_SEM.map((d,i)=>(
            <button key={i} onClick={()=>mToggleDia(i)} style={{...S.btn(T.bluel,!(minhaForm.diasSemana||[]).includes(i)),padding:'8px 12px',fontSize:12}}>{d}</button>
          ))}
        </div>

        <label style={S.lbl}>{pick(TX.turnosDisponiveis)}</label>
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          {TURNOS.map(t=><button key={t} onClick={()=>mToggleTurno(t)} style={{...S.btn(T.purple,!(minhaForm.turnosDisponiveis||[]).includes(t)),padding:'8px 14px'}}>{t}</button>)}
        </div>

        {zonas.length>0&&(
          <>
            <label style={S.lbl}>{pick(TX.zonasPrefOpc)}</label>
            <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
              {zonas.map(z=><button key={z} onClick={()=>mToggleZona(z)} style={{...S.btn(T.orange,!(minhaForm.zonasDisponiveis||[]).includes(z)),padding:'6px 10px',fontSize:11}}>{z}</button>)}
            </div>
          </>
        )}

        <label style={S.lbl}>{pick(TX.obsOpc)}</label>
        <input value={minhaForm.obs||''} onChange={e=>setMinhaForm(f=>({...f,obs:e.target.value}))} style={S.inp} placeholder={pick(TX.obsPlaceholder)}/>

        <button onClick={salvarMinha} disabled={salvandoMinha} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),width:'100%',marginTop:12}}>
          {salvandoMinha?pick(TX.salvando):(minha?pick(TX.atualizarDisp):pick(TX.confirmarDisp))}
        </button>
      </div>
    </div>
  );

  // admin/gestor view
  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder={pick(TX.buscaNomeCnpj)} style={{...S.inp,marginBottom:0,flex:1}}/>
        <button onClick={()=>{setEditando(null);setForm({diasSemana:[1,2,3,4,5],turnosDisponiveis:['T1'],zonasDisponiveis:[],funcao:'Scout'});setModal(true);}} style={{...S.btnG('linear-gradient(135deg,#10b981,#059669)'),fontSize:12}}>{pick(TX.cadastrar)}</button>
      </div>
      <DisponibilidadeHoje lista={lista} />
      <div style={{...S.card(T.bluel),marginBottom:14,fontSize:12,color:T.dim}}>
        <b style={{color:T.txt}}>{pick(TX.comoFuncionaTit)}</b>{pick(TX.comoFuncionaTxt)}
      </div>

      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={S.table}>
          <thead><tr>{[pick(TX.thNome),pick(TX.thFuncao),pick(TX.thDias),pick(TX.thTurnos),pick(TX.thZonas),pick(TX.thAcoes)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtrados.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TX.nenhumaDispCad)}</td></tr>}
            {filtrados.map(d=>(
              <tr key={d.id}>
                <td style={{...S.td,fontWeight:600}}>{d.nome}<div style={{fontSize:10,color:T.dim,fontFamily:'monospace'}}>{d.cnpj}</div></td>
                <td style={S.td}><span style={S.chip(d.funcao==='Charger'?T.yellow:T.green)}>{d.funcao}</span></td>
                <td style={{...S.td,fontSize:11}}>{(d.diasSemana||[]).map(i=>DIAS_SEM[i]).join(', ')}</td>
                <td style={{...S.td,fontSize:11}}>{(d.turnosDisponiveis||[]).join(', ')}</td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{(d.zonasDisponiveis||[]).slice(0,2).join(', ')}{(d.zonasDisponiveis||[]).length>2?'...':''}</td>
                <td style={S.td}><div style={{display:'flex',gap:4}}>
                  <button onClick={()=>{setEditando(d);setForm({...d});setModal(true);}} style={{...S.btn(T.bluel,true),padding:'3px 8px',fontSize:11}}>✏</button>
                  <button onClick={async()=>{if(d.id&&await confirmDialog(pick(TX.removerConfirm), `${pick(TX.removerConfirm)} ${d.nome}?`, {variant:'danger'})){ await delDisponibilidade(d.id); toast(pick(TX.removido));}}} style={{...S.btn(T.red,true),padding:'3px 8px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal&&(
        <div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
          <div style={S.mCard}>
            <div style={S.mHdr}>
              <div style={{fontWeight:700,color:T.txt}}>{editando?pick(TX.editarDisp):pick(TX.cadastrarDisp)}</div>
              <button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div style={{padding:18}}>
              <div style={S.g2}>
                <div><label style={S.lbl}>{pick(TX.nome)} *</label><input value={form.nome||''} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} style={S.inp}/></div>
                <div><label style={S.lbl}>CNPJ</label><input value={form.cnpj||''} onChange={e=>setForm(f=>({...f,cnpj:e.target.value}))} style={S.inp} placeholder="00.000.000/0000-00"/></div>
              </div>
              <label style={S.lbl}>{pick(TX.funcao)}</label>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {funcoesParaUsuario(usuario.cargoPrestador, usuario.role).map(fn=><button key={fn} onClick={()=>setForm(f=>({...f,funcao:fn}))} style={{...S.btn(fn==='Charger'?T.yellow:T.green,form.funcao!==fn),padding:'6px 12px'}}>{fn}</button>)}
              </div>
              <label style={S.lbl}>{pick(TX.diasDisponiveis)}</label>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {DIAS_SEM.map((d,i)=>(
                  <button key={i} onClick={()=>toggleDia(i)} style={{...S.btn(T.bluel,!(form.diasSemana||[]).includes(i)),padding:'6px 10px',fontSize:11}}>{d}</button>
                ))}
              </div>
              <label style={S.lbl}>{pick(TX.turnosDisponiveis)}</label>
              <div style={{display:'flex',gap:6,marginBottom:10}}>
                {TURNOS.map(t=><button key={t} onClick={()=>toggleTurno(t)} style={{...S.btn(T.purple,!(form.turnosDisponiveis||[]).includes(t)),padding:'6px 12px'}}>{t}</button>)}
              </div>
              {zonas.length>0&&(
                <>
                  <label style={S.lbl}>{pick(TX.zonasPref)}</label>
                  <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                    {zonas.map(z=><button key={z} onClick={()=>toggleZona(z)} style={{...S.btn(T.orange,!(form.zonasDisponiveis||[]).includes(z)),padding:'5px 10px',fontSize:11}}>{z}</button>)}
                  </div>
                </>
              )}
              <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',marginTop:4}}>
                {salvando?pick(TX.salvando):editando?pick(TX.salvar):pick(TX.cadastrarBtn)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA RANKING — gamificação, níveis, streaks
// ═══════════════════════════════════════════════════════════════════════════════

function AbaRanking({cidade}:{cidade:string}){
  const { pick, pickNivel } = useLang();
  const [prestadores,setPrestadores]=useState<Prestador[]>([]);
  const [loading,    setLoading    ]=useState(true);
  const [periodo,    setPeriodo    ]=useState<'semana'|'mes'|'total'>('mes');
  const [funcaoFilt, setFuncaoFilt ]=useState('todos');

  useEffect(()=>{
    setLoading(true);
    let vivo=true;
    const run=()=>fetchPrestadores(cidade).then(p=>{ if(vivo){setPrestadores(p as any);setLoading(false);} }).catch(e=>{console.warn('[escala-supa]',e?.message);setLoading(false);});
    run(); const t=setInterval(run,15000);
    return ()=>{vivo=false;clearInterval(t);};
  },[cidade]);

  const filtrados=useMemo(()=>prestadores.filter(p=>funcaoFilt==='todos'||p.funcao===funcaoFilt),[prestadores,funcaoFilt]);

  const top3=filtrados.slice(0,3);
  const resto=filtrados.slice(3);

  const medalha=(i:number)=>i===0?'🥇':i===1?'🥈':i===2?'🥉':'';

  return(
    <div>
      {/* Filtros */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',gap:4}}>
          {(['semana','mes','total'] as const).map(p=>(
            <button key={p} onClick={()=>setPeriodo(p)} style={{...S.btn(T.bluel,periodo!==p),padding:'6px 12px',fontSize:11}}>
              {p==='semana'?pick(TX.rkSemana):p==='mes'?pick(TX.rkMes):pick(TX.rkTotal)}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:4}}>
          {['todos',...FUNCOES_TODAS].map(fn=>(
            <button key={fn} onClick={()=>setFuncaoFilt(fn)}
              style={{...S.btn(fn==='todos'?T.bluel:fn==='Charger'?T.yellow:T.green,funcaoFilt!==fn),padding:'5px 10px',fontSize:11}}>
              {fn==='todos'?pick(TX.rkTodos):fn}
            </button>
          ))}
        </div>
      </div>

      {/* Podium top 3 */}
      {top3.length>0&&(
        <div style={{display:'flex',gap:12,justifyContent:'center',alignItems:'flex-end',marginBottom:20}}>
          {[top3[1],top3[0],top3[2]].filter(Boolean).map((p,idx)=>{
            const posicoes=[1,0,2];const pos=filtrados.indexOf(p);
            const altura=pos===0?120:pos===1?90:75;
            const meta=nivelLabel(p.pontos);
            return(
              <div key={p.id} style={{textAlign:'center',flex:1,maxWidth:140}}>
                <div style={{fontSize:24,marginBottom:4}}>{medalha(pos)}</div>
                <div style={{width:60,height:60,borderRadius:'50%',background:meta.cor+'22',border:`3px solid ${meta.cor}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,margin:'0 auto 6px'}}>{meta.emoji}</div>
                <div style={{fontWeight:700,fontSize:12,color:T.txt,marginBottom:2}}>{p.nome.split(' ')[0]}</div>
                <div style={{fontSize:10,color:T.dim}}>{p.funcao}</div>
                <div style={{fontWeight:800,fontSize:16,color:meta.cor,marginTop:4}}>{p.pontos.toLocaleString()} {pick(TX.pts)}</div>
                <div style={{background:T.card,borderRadius:'0 0 8px 8px',padding:'6px 8px',height:altura,marginTop:6,display:'flex',flexDirection:'column',justifyContent:'center',border:`1px solid ${meta.cor}33`,borderTop:`3px solid ${meta.cor}`}}>
                  <div style={{fontSize:10,color:T.dim}}>🔥 {pick(TX.streak)}: {p.streak}d</div>
                  <div style={{fontSize:10,color:T.dim}}>📋 {pick(TX.rkSlots)}: {p.totalSlots}</div>
                  <div style={{fontSize:10,color:T.dim}}>⭐ {p.avaliacaoMedia?.toFixed(1)||'—'}/5</div>
                  <div style={{...S.chip(meta.cor),marginTop:4,fontSize:9}}>{pickNivel(meta.label)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabela resto */}
      {loading?<div style={{color:T.dim,textAlign:'center',padding:40}}>{pick(TX.carregando)}</div>:(
        <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
          <table style={S.table}>
            <thead><tr>{['#',pick(TX.thPrestador),pick(TX.thNivel),pick(TX.thPontos),pick(TX.thStreak),pick(TX.thSlots),pick(TX.thFaltas),pick(TX.thAvaliacao),pick(TX.thFuncao)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {filtrados.length===0&&<tr><td colSpan={9} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TX.nenhumPrestRk)}</td></tr>}
              {filtrados.map((p,i)=>{
                const meta=nivelLabel(p.pontos);
                return(
                  <tr key={p.id}>
                    <td style={{...S.td,fontWeight:800,color:i<3?T.yellowl:T.dim,fontSize:14}}>{medalha(i)||i+1}</td>
                    <td style={{...S.td,fontWeight:600}}>
                      <div style={{color:T.txt}}>{p.nome}</div>
                      <div style={{fontSize:10,color:T.dim,fontFamily:'monospace'}}>{p.cnpj}</div>
                    </td>
                    <td style={S.td}><span style={S.chip(meta.cor)}>{meta.emoji} {pickNivel(meta.label)}</span></td>
                    <td style={{...S.td,fontWeight:700,color:meta.cor}}>{p.pontos.toLocaleString()}</td>
                    <td style={S.td}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{color:p.streak>=7?T.orange:T.dim}}>🔥</span>
                        <span style={{fontWeight:p.streak>=7?700:400,color:p.streak>=7?T.orange:T.txt}}>{p.streak}d</span>
                        {p.streakMax>0&&<span style={{fontSize:10,color:T.dim}}>(max {p.streakMax})</span>}
                      </div>
                    </td>
                    <td style={S.td}>{p.totalSlots}</td>
                    <td style={{...S.td,color:p.totalFaltas>3?T.red:T.dim}}>{p.totalFaltas}</td>
                    <td style={S.td}>
                      {p.avaliacaoMedia>0?(
                        <div style={{display:'flex',alignItems:'center',gap:3}}>
                          <span style={{color:p.avaliacaoMedia>=4.5?T.green:p.avaliacaoMedia>=3.5?T.yellow:T.red,fontWeight:700}}>
                            {p.avaliacaoMedia.toFixed(1)}
                          </span>
                          <span style={{fontSize:10,color:T.dim}}>/5</span>
                        </div>
                      ):'—'}
                    </td>
                    <td style={S.td}><span style={S.chip(p.funcao==='Charger'?T.yellow:T.green)}>{p.funcao}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda de níveis */}
      <div style={{...S.card(),marginTop:14}}>
        <div style={S.sec}>{pick(TX.niveisPontuacao)}</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
          {[{min:0,max:299,n:1,l:TX.nvIniciante,c:'#64748b',e:'🌱'},{min:300,max:799,n:2,l:TX.nvRegular,c:T.green,e:'🔷'},{min:800,max:1999,n:3,l:TX.nvExperiente,c:T.bluel,e:'⭐'},{min:2000,max:4999,n:4,l:TX.nvEspecialista,c:T.purple,e:'💎'},{min:5000,max:99999,n:5,l:TX.nvLendario,c:T.yellow,e:'👑'}].map(nv=>(
            <div key={nv.n} style={{...S.card(nv.c),padding:'10px 12px'}}>
              <div style={{fontSize:20,marginBottom:4}}>{nv.e}</div>
              <div style={{fontWeight:700,fontSize:12,color:nv.c}}>{pick(nv.l)}</div>
              <div style={{fontSize:10,color:T.dim}}>{nv.min.toLocaleString()}–{nv.max===99999?'∞':nv.max.toLocaleString()} {pick(TX.pts)}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:10,fontSize:11,color:T.dim,lineHeight:1.8}}>
          <b style={{color:T.txt}}>{pick(TX.comoGanhar)}</b><br/>
          ✅ {pick(TX.gpPresenca)}: +{10} {pick(TX.pts)} · ▶ {pick(TX.gpInicioPrazo)}: +{5} {pick(TX.pts)} · ⭐ {pick(TX.gpAvaliacao5)}: +{10} {pick(TX.pts)}<br/>
          🔥 {pick(TX.gpStreakSemanal)}: +{25} {pick(TX.pts)} · 🔥 {pick(TX.gpStreakMensal)}: +{100} {pick(TX.pts)} · 🔴 {pick(TX.gpPontoZerado)}: +{15} {pick(TX.pts)}<br/>
          ❌ {pick(TX.gpFalta)}: -{30} {pick(TX.pts)} · ⏰ {pick(TX.gpAtraso15)}: -{10} {pick(TX.pts)} · ⏰ {pick(TX.gpAtraso30)}: -{20} {pick(TX.pts)} · ✖ {pick(TX.gpCancelTardio)}: -{15} {pick(TX.pts)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA PENALIDADES
// ═══════════════════════════════════════════════════════════════════════════════

function AbaPenalidades({usuario,cidade}:AbaProps){
  const { pick } = useLang();
  const [lista,    setLista   ]=useState<Penalidade[]>([]);
  const [modal,    setModal   ]=useState(false);
  const [form,     setForm    ]=useState<Partial<Penalidade>>({tipo:'falta',pontosDeducao:30,descricao:'',cidade:cidade||'SP'});
  const [prestadores,setPrests]=useState<{id:string;nome:string;cnpj:string}[]>([]);
  const [salvando, setSalvando]=useState(false);

  useEffect(()=>{
    let vivo=true;
    const run=()=>Promise.all([fetchPenalidadesList(cidade),fetchPrestadores(cidade)]).then(([pen,pr])=>{ if(vivo){setLista(pen as any);setPrests(pr as any);} }).catch(e=>console.warn('[escala-supa]',e?.message));
    run(); const t=setInterval(run,15000);
    return ()=>{vivo=false;clearInterval(t);};
  },[cidade]);

  const TIPOS_PEN=[
    {k:'falta',l:TX.penFalta,pts:30,c:T.red},
    {k:'atraso',l:TX.penAtraso,pts:15,c:T.orange},
    {k:'cancelamento_tardio',l:TX.penCancelTardio,pts:15,c:T.yellow},
    {k:'comportamento',l:TX.penComportamento,pts:20,c:T.purple},
  ] as const;

  const salvar=async()=>{
    if(!form.uid||!form.descricao){toast(pick(TX.selPrestDesc),'erro');return;}
    setSalvando(true);
    try{
      await salvarPenalidade(form, usuario.uid, cidade);
      toast(pick(TX.penAplicada));setModal(false);
      setForm({tipo:'falta',pontosDeducao:30,descricao:'',cidade:cidade||'SP'});
    }catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const tipoCor=(t:string)=>TIPOS_PEN.find(x=>x.k===t)?.c||T.dim;
  const tipoLabel=(t:string)=>{const f=TIPOS_PEN.find(x=>x.k===t);return f?pick(f.l):t;};

  return(
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <button onClick={()=>setModal(true)} style={{...S.btnG('linear-gradient(135deg,#ef4444,#dc2626)'),fontSize:12}}>{pick(TX.registrarPen)}</button>
      </div>
      <div style={{overflowX:'auto',background:T.card,borderRadius:12,border:`1px solid ${T.bdr}`}}>
        <table style={S.table}>
          <thead><tr>{[pick(TX.thData),pick(TX.thPrestador),pick(TX.thTipo),pick(TX.thDescricao),pick(TX.thPtsDeduzidos),pick(TX.thPor)].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.length===0&&<tr><td colSpan={6} style={{...S.td,textAlign:'center',padding:40,color:T.dim}}>{pick(TX.nenhumaPen)}</td></tr>}
            {lista.map(p=>(
              <tr key={p.id}>
                <td style={{...S.td,fontFamily:'monospace',fontSize:11}}>{fmtTs(p.criadoEm,true)}</td>
                <td style={{...S.td,fontWeight:600}}>{p.nome}</td>
                <td style={S.td}><span style={S.chip(tipoCor(p.tipo))}>{tipoLabel(p.tipo)}</span></td>
                <td style={{...S.td,fontSize:11,color:T.dim,maxWidth:200}}>{p.descricao}</td>
                <td style={{...S.td,color:T.red,fontWeight:700}}>-{p.pontosDeducao} {pick(TX.pts)}</td>
                <td style={{...S.td,fontSize:11,color:T.dim}}>{p.aplicadoPor||'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal&&(
        <div style={S.modal} onClick={e=>{if(e.target===e.currentTarget)setModal(false);}}>
          <div style={S.mCard}>
            <div style={S.mHdr}><div style={{fontWeight:700,color:T.txt}}>{pick(TX.registrarPenTit)}</div><button onClick={()=>setModal(false)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>✕</button></div>
            <div style={{padding:18}}>
              <label style={S.lbl}>{pick(TX.prestador)} *</label>
              <select value={form.uid||''} onChange={e=>{const p=prestadores.find(x=>x.id===e.target.value);setForm(f=>({...f,uid:e.target.value,nome:p?.nome||'',cnpj:p?.cnpj||''}));}} style={S.inp}>
                <option value="">{pick(TX.selecionar)}</option>
                {prestadores.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <label style={S.lbl}>{pick(TX.tipo)}</label>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {TIPOS_PEN.map(t=>(
                  <button key={t.k} onClick={()=>setForm(f=>({...f,tipo:t.k as any,pontosDeducao:t.pts}))} style={{...S.btn(t.c,form.tipo!==t.k),padding:'6px 12px',fontSize:11}}>{pick(t.l)} (-{t.pts}{pick(TX.pts)})</button>
                ))}
              </div>
              <label style={S.lbl}>{pick(TX.descricao)} *</label>
              <input value={form.descricao||''} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} style={S.inp} placeholder={pick(TX.descPlaceholder)}/>
              <label style={S.lbl}>{pick(TX.pontosDeduzir)}</label>
              <input type="number" min={1} max={200} value={form.pontosDeducao||0} onChange={e=>setForm(f=>({...f,pontosDeducao:parseInt(e.target.value)||0}))} style={S.inp}/>
              <div style={{...S.card(T.red),marginBottom:12,fontSize:12,color:T.dim}}>
                {pick(TX.penAvisoA)}<b style={{color:T.red}}>{form.pontosDeducao} {pick(TX.penAvisoPontos)}</b>{pick(TX.penAvisoB)}
              </div>
              <button onClick={salvar} disabled={salvando} style={{...S.btnG('linear-gradient(135deg,#ef4444,#dc2626)'),width:'100%'}}>
                {salvando?pick(TX.aplicando):pick(TX.aplicarPen)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABA CONFIG TEAMS
// ═══════════════════════════════════════════════════════════════════════════════

const PERFIL_NAMES = ['alta','media','baixa','evento'] as const;
const DIAS_SEMANA_KEYS: {k:string;tx:keyof typeof TX}[] = [
  {k:'0',tx:'dom'},{k:'1',tx:'seg'},{k:'2',tx:'ter'},{k:'3',tx:'qua'},
  {k:'4',tx:'qui'},{k:'5',tx:'sex'},{k:'6',tx:'sab'},
];
const DEFAULT_CARGOS = ['Charger','Scalt','Motorista','Promotor','Fiscal'];

function AbaConfigTeams({cidade}:{cidade:string}){
  const { pick } = useLang();
  const [cfg,setCfg]=useState<EscalaConfig>({
    id:'',cidade:cidade||'SP',diasAntecedencia:3,
    turnosConfig:{
      T1:{horaIni:'07:00',horaFim:'15:00',qtdPadrao:3},
      T2:{horaIni:'15:00',horaFim:'23:00',qtdPadrao:3},
      T0:{horaIni:'23:00',horaFim:'07:00',qtdPadrao:2},
    },
    respeitarPreferencias:true, respeitarFeriados:true, nivelMinimoUrgente:1,
    bonus:{presencaConfirmada:10,inicioNoPrazo:5,avaliacaoExcelente:10,streakSemanal:25,streakMensal:100,pontoZerado:15},
    penalidades:{falta:30,atraso15:10,atraso30:20,cancelamentoTardio:15},
    faixas:[], perfis:{}, mapaDias:{}, overridesData:{}, zonasAtivas:[], gojetCityId:null,
    gojetAjuste:false, feriadoPerfil:'baixa', tetoVagasZona:10, cargos:[...DEFAULT_CARGOS],
  });
  const [feriados,setFeriados]=useState<Feriado[]>([]);
  const [novoFeriado,setNovoFeriado]=useState({data:'',nome:'',nacional:false});
  const [salvando,setSalvando]=useState(false);
  const [perfilTab,setPerfilTab]=useState<string>('alta');
  const [novaZona,setNovaZona]=useState('');
  const [novoCargo,setNovoCargo]=useState('');
  const [syncingZonas,setSyncingZonas]=useState(false);

  const ZONA_MAP:Record<string,string>={'🟥':'Z1 - Vermelha','⬛':'Z2 - Preta','🟧':'Z3 - Laranja','🟦':'Z4 - Azul','🟩':'Z5 - Verde','🟨':'Z6 - Amarela','🏁':'Zona Interlagos'};
  const RE_ZONA=/^([🟥⬛🟧🟦🟩🟨🏁])/u;

  const syncZonasGojet=async()=>{
    const cityId=cfg.gojetCityId?.trim();
    if(!cityId){alert(pick(TX.syncZonasNeedId));return;}
    setSyncingZonas(true);
    try{
      const {data}=await supabase.from('parkings').select('nome').eq('city_id',cityId);
      const found=new Set<string>();
      for(const p of data??[]){
        const m=(p.nome??'').match(RE_ZONA);
        if(m&&ZONA_MAP[m[1]]) found.add(ZONA_MAP[m[1]]);
      }
      if(found.size===0){alert(pick(TX.syncZonasNone));return;}
      const merged=new Set([...(cfg.zonasAtivas||[]),...found]);
      setCfg(c=>({...c,zonasAtivas:[...merged]}));
      alert(`${found.size} ${pick(TX.syncZonasOk)}`);
    }catch(e){console.error('syncZonas',e);}
    finally{setSyncingZonas(false);}
  };

  const cargos = cfg.cargos?.length ? cfg.cargos : DEFAULT_CARGOS;
  const zonas = cfg.zonasAtivas ?? [];

  const recarregarFeriados=()=>fetchEscala(cidade).then(d=>setFeriados(d.feriados as any)).catch(()=>{});
  useEffect(()=>{
    fetchEscala(cidade).then(d=>{ if(d.cfg) setCfg(prev=>({...prev,...d.cfg})); setFeriados(d.feriados as any); }).catch(e=>console.warn('[escala-supa]',e?.message));
  },[cidade]);

  const salvar=async()=>{
    setSalvando(true);
    try{
      await salvarEscalaConfig(cfg, cidade); toast(pick(TX.configSalva));
    }
    catch(e:any){toast(e.message,'erro');}finally{setSalvando(false);}
  };

  const adicionarFeriado=async()=>{
    if(!novoFeriado.data||!novoFeriado.nome){toast(pick(TX.dataNomeObrig),'erro');return;}
    await addFeriado(novoFeriado, cidade); await recarregarFeriados();
    toast(pick(TX.feriadoAdd));setNovoFeriado({data:'',nome:'',nacional:false});
  };

  const N=({label,val,onChange,min=0,max=500}:{label:string;val:number;onChange:(v:number)=>void;min?:number;max?:number})=>(
    <div><label style={S.lbl}>{label}</label><input type="number" min={min} max={max} value={val} onChange={e=>onChange(parseInt(e.target.value)||0)} style={S.inp}/></div>
  );

  // Helpers for faixas
  const addFaixa=()=>{
    const f:FaixaHoraria={id:'',horaIni:'08:00',horaFim:'16:00'};
    setCfg(c=>({...c,faixas:[...(c.faixas||[]),f]}));
  };
  const updFaixa=(i:number,field:'horaIni'|'horaFim',v:string)=>{
    setCfg(c=>{
      const fs=[...(c.faixas||[])];
      fs[i]={...fs[i],[field]:v,id:`${field==='horaIni'?v:fs[i].horaIni}-${field==='horaFim'?v:fs[i].horaFim}`};
      return {...c,faixas:fs};
    });
  };
  const rmFaixa=(i:number)=>setCfg(c=>({...c,faixas:(c.faixas||[]).filter((_,j)=>j!==i)}));

  // Helpers for perfis
  const getPerfilVal=(perfil:string,zona:string,cargo:string):number=>{
    return cfg.perfis?.[perfil]?.[zona]?.[cargo] ?? 0;
  };
  const setPerfilVal=(perfil:string,zona:string,cargo:string,v:number)=>{
    setCfg(c=>{
      const p={...c.perfis};
      if(!p[perfil]) p[perfil]={};
      if(!p[perfil][zona]) p[perfil][zona]={};
      p[perfil]={...p[perfil],[zona]:{...p[perfil][zona],[cargo]:v}};
      return {...c,perfis:p};
    });
  };

  return(
    <div style={{maxWidth:720}}>
      {/* Configuracoes gerais */}
      <div style={{...S.card(T.bluel),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.configTitulo)} {cidade||pick(TX.global)}</div>
        <div style={S.g2}>
          <N label={pick(TX.cfgGerarDias)} val={cfg.diasAntecedencia} onChange={v=>setCfg(c=>({...c,diasAntecedencia:v}))} min={1} max={14}/>
          <N label={pick(TX.cfgNivelMin)} val={cfg.nivelMinimoUrgente} onChange={v=>setCfg(c=>({...c,nivelMinimoUrgente:v}))} min={1} max={5}/>
        </div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:T.txt}}>
            <input type="checkbox" checked={cfg.respeitarPreferencias} onChange={e=>setCfg(c=>({...c,respeitarPreferencias:e.target.checked}))}/>
            {pick(TX.cfgRespeitarPref)}
          </label>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:T.txt}}>
            <input type="checkbox" checked={cfg.respeitarFeriados} onChange={e=>setCfg(c=>({...c,respeitarFeriados:e.target.checked}))}/>
            {pick(TX.cfgMarcarFeriados)}
          </label>
        </div>
      </div>

      {/* 1. Faixas Horárias */}
      <div style={{...S.card(T.purple),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.faixasTit)}</div>
        {(!cfg.faixas||cfg.faixas.length===0) && (
          <div style={{fontSize:12,color:T.dim,marginBottom:10,fontStyle:'italic'}}>{pick(TX.faixaVazia)}</div>
        )}
        {(cfg.faixas||[]).map((f,i)=>(
          <div key={i} style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
            <div style={{flex:1}}><label style={S.lbl}>{pick(TX.horaInicio)}</label><input type="time" value={f.horaIni} onChange={e=>updFaixa(i,'horaIni',e.target.value)} style={S.inp}/></div>
            <div style={{flex:1}}><label style={S.lbl}>{pick(TX.horaFim)}</label><input type="time" value={f.horaFim} onChange={e=>updFaixa(i,'horaFim',e.target.value)} style={S.inp}/></div>
            <div style={{fontSize:10,color:T.dim,fontFamily:'monospace',minWidth:90}}>{f.horaIni}-{f.horaFim}</div>
            <button onClick={()=>rmFaixa(i)} style={{...S.btn(T.red,true),padding:'4px 8px',fontSize:10}}>{pick(TX.remover)}</button>
          </div>
        ))}
        <button onClick={addFaixa} style={{...S.btnG(T.blueg),fontSize:11}}>{pick(TX.addFaixa)}</button>
      </div>

      {/* 2. Perfis de Demanda */}
      <div style={{...S.card(T.blue),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.perfisTit)}</div>
        <div style={{display:'flex',gap:4,marginBottom:12}}>
          {PERFIL_NAMES.map(p=>(
            <button key={p} onClick={()=>setPerfilTab(p)}
              style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${perfilTab===p?T.bluel:T.bdr}`,
                background:perfilTab===p?T.bluel+'22':'transparent',color:perfilTab===p?T.bluel:T.dim,
                fontSize:11,fontWeight:700,cursor:'pointer',textTransform:'capitalize'}}>
              {p}
            </button>
          ))}
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Zona</th>
                {cargos.map(c=><th key={c} style={S.th}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {/* _default row */}
              <tr>
                <td style={{...S.td,fontWeight:700,color:T.bluel,fontSize:11}}>{pick(TX.perfilDefault)}</td>
                {cargos.map(c=>(
                  <td key={c} style={S.td}>
                    <input type="number" min={0} max={50} value={getPerfilVal(perfilTab,'_default',c)}
                      onChange={e=>setPerfilVal(perfilTab,'_default',c,parseInt(e.target.value)||0)}
                      style={{...S.inp,width:56,marginBottom:0,textAlign:'center'}}/>
                  </td>
                ))}
              </tr>
              {/* Zone-specific rows */}
              {zonas.map(z=>(
                <tr key={z}>
                  <td style={{...S.td,fontSize:11,color:T.txt}}>{z}</td>
                  {cargos.map(c=>(
                    <td key={c} style={S.td}>
                      <input type="number" min={0} max={50} value={getPerfilVal(perfilTab,z,c)}
                        onChange={e=>setPerfilVal(perfilTab,z,c,parseInt(e.target.value)||0)}
                        style={{...S.inp,width:56,marginBottom:0,textAlign:'center'}}/>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Mapa de Dias */}
      <div style={{...S.card(T.yellow),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.mapaDiasTit)}</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:8}}>
          {DIAS_SEMANA_KEYS.map(({k,tx})=>(
            <div key={k}>
              <label style={S.lbl}>{pick(TX[tx])}</label>
              <select value={cfg.mapaDias?.[k]||'media'}
                onChange={e=>setCfg(c=>({...c,mapaDias:{...c.mapaDias,[k]:e.target.value}}))}
                style={{...S.inp,marginBottom:0}}>
                {PERFIL_NAMES.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* 4. GoJet & Ajustes (moved up — configure link first to auto-discover zones) */}
      <div style={{...S.card(T.orange),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.gojetTit)}</div>
        <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:T.txt,marginBottom:10}}>
          <input type="checkbox" checked={cfg.gojetAjuste} onChange={e=>setCfg(c=>({...c,gojetAjuste:e.target.checked}))}/>
          {pick(TX.gojetAjuste)}
        </label>
        <div style={S.g2}>
          <div>
            <label style={S.lbl}>{pick(TX.gojetCityId)}</label>
            <div style={{display:'flex',gap:6}}>
              <input value={cfg.gojetCityId||''} onChange={e=>setCfg(c=>({...c,gojetCityId:e.target.value||null}))} style={{...S.inp,flex:1,marginBottom:0}}/>
              <button onClick={syncZonasGojet} disabled={syncingZonas}
                style={{...S.btnG(T.blueg),flexShrink:0,opacity:syncingZonas?0.6:1}}>
                {syncingZonas?'...':pick(TX.syncZonas)}
              </button>
            </div>
          </div>
          <div>
            <label style={S.lbl}>{pick(TX.feriadoPerfil)}</label>
            <select value={cfg.feriadoPerfil||'baixa'} onChange={e=>setCfg(c=>({...c,feriadoPerfil:e.target.value}))} style={S.inp}>
              {PERFIL_NAMES.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <N label={pick(TX.tetoVagasZona)} val={cfg.tetoVagasZona??10} onChange={v=>setCfg(c=>({...c,tetoVagasZona:v}))} min={1} max={100}/>
        </div>
      </div>

      {/* Bonus */}
      <div style={{...S.card(T.green),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.bonusPontuacao)}</div>
        <div style={S.g2}>
          <N label={pick(TX.bnPresenca)} val={cfg.bonus.presencaConfirmada} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,presencaConfirmada:v}}))}/>
          <N label={pick(TX.bnInicioPrazo)} val={cfg.bonus.inicioNoPrazo} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,inicioNoPrazo:v}}))}/>
          <N label={pick(TX.bnAvaliacao5)} val={cfg.bonus.avaliacaoExcelente} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,avaliacaoExcelente:v}}))}/>
          <N label={pick(TX.bnPontoZerado)} val={cfg.bonus.pontoZerado} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,pontoZerado:v}}))}/>
          <N label={pick(TX.bnStreakSemanal)} val={cfg.bonus.streakSemanal} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,streakSemanal:v}}))}/>
          <N label={pick(TX.bnStreakMensal)} val={cfg.bonus.streakMensal} onChange={v=>setCfg(c=>({...c,bonus:{...c.bonus,streakMensal:v}}))}/>
        </div>
      </div>

      {/* Penalidades */}
      {/* 5. Zonas Ativas */}
      <div style={{...S.card(T.green),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.zonasAtivasTit)}</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
          {zonas.map((z,i)=>(
            <span key={z} style={{...S.chip(T.green),display:'flex',alignItems:'center',gap:4}}>
              {z}
              <button onClick={()=>setCfg(c=>({...c,zonasAtivas:c.zonasAtivas.filter((_,j)=>j!==i)}))}
                style={{background:'none',border:'none',color:T.red,cursor:'pointer',fontSize:10,fontWeight:700,padding:0}}>x</button>
            </span>
          ))}
        </div>
        <div style={{display:'flex',gap:6}}>
          <input value={novaZona} onChange={e=>setNovaZona(e.target.value)} placeholder="Z1 - Vermelha" style={{...S.inp,flex:1,marginBottom:0}}/>
          <button onClick={()=>{if(novaZona.trim()){setCfg(c=>({...c,zonasAtivas:[...(c.zonasAtivas||[]),novaZona.trim()]}));setNovaZona('');}}}
            style={{...S.btnG(T.blueg),flexShrink:0}}>{pick(TX.addZona)}</button>
        </div>
      </div>

      {/* 6. Cargos */}
      <div style={{...S.card(T.purple),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.cargosTit)}</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
          {cargos.map((c,i)=>(
            <span key={c} style={{...S.chip(T.purple),display:'flex',alignItems:'center',gap:4}}>
              {c}
              <button onClick={()=>setCfg(prev=>({...prev,cargos:prev.cargos.filter((_,j)=>j!==i)}))}
                style={{background:'none',border:'none',color:T.red,cursor:'pointer',fontSize:10,fontWeight:700,padding:0}}>x</button>
            </span>
          ))}
        </div>
        <div style={{display:'flex',gap:6}}>
          <input value={novoCargo} onChange={e=>setNovoCargo(e.target.value)} placeholder="Cargo" style={{...S.inp,flex:1,marginBottom:0}}/>
          <button onClick={()=>{if(novoCargo.trim()){setCfg(c=>({...c,cargos:[...(c.cargos||[]),novoCargo.trim()]}));setNovoCargo('');}}}
            style={{...S.btnG(T.blueg),flexShrink:0}}>{pick(TX.addCargo)}</button>
        </div>
      </div>

      <div style={{...S.card(T.red),marginBottom:14}}>
        <div style={S.sec}>{pick(TX.penalidadesTit)}</div>
        <div style={S.g2}>
          <N label={pick(TX.pnFalta)} val={cfg.penalidades.falta} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,falta:v}}))}/>
          <N label={pick(TX.pnAtraso15)} val={cfg.penalidades.atraso15} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,atraso15:v}}))}/>
          <N label={pick(TX.pnAtraso30)} val={cfg.penalidades.atraso30} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,atraso30:v}}))}/>
          <N label={pick(TX.pnCancelTardio)} val={cfg.penalidades.cancelamentoTardio} onChange={v=>setCfg(c=>({...c,penalidades:{...c.penalidades,cancelamentoTardio:v}}))}/>
        </div>
      </div>

      <button onClick={salvar} disabled={salvando} style={{...S.btnG(T.blueg),width:'100%',padding:'11px',marginBottom:16}}>{salvando?pick(TX.salvando):pick(TX.salvarConfig)}</button>

      {/* Feriados */}
      <div style={S.card(T.orange)}>
        <div style={S.sec}>{pick(TX.feriadosTit)}</div>
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <input type="date" value={novoFeriado.data} onChange={e=>setNovoFeriado(f=>({...f,data:e.target.value}))} style={{...S.inp,marginBottom:0,flex:1,minWidth:130}}/>
          <input value={novoFeriado.nome} onChange={e=>setNovoFeriado(f=>({...f,nome:e.target.value}))} style={{...S.inp,marginBottom:0,flex:2}} placeholder={pick(TX.nomeFeriado)}/>
          <label style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:T.txt,flexShrink:0}}>
            <input type="checkbox" checked={novoFeriado.nacional} onChange={e=>setNovoFeriado(f=>({...f,nacional:e.target.checked}))}/>{pick(TX.nacional)}
          </label>
          <button onClick={adicionarFeriado} style={{...S.btnG(T.blueg),flexShrink:0}}>{pick(TX.addBtn)}</button>
        </div>
        <div style={{maxHeight:200,overflowY:'auto'}}>
          {feriados.filter(f=>!f.cidade||f.cidade===cidade||f.nacional).map(f=>(
            <div key={f.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`1px solid ${T.bdr2}`}}>
              <span style={{fontFamily:'monospace',fontSize:11,color:T.dim,flexShrink:0}}>{f.data}</span>
              <span style={{flex:1,fontSize:12,color:T.txt}}>{f.nome}</span>
              {f.nacional&&<span style={S.chip(T.orange)}>{pick(TX.nacional)}</span>}
              <button onClick={async()=>{if(f.id){ await delFeriado(f.id);await recarregarFeriados(); }}} style={{...S.btn(T.red,true),padding:'2px 6px',fontSize:10}}>🗑</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
