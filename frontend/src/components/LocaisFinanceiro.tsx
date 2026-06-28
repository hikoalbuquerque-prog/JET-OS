// src/components/LocaisFinanceiro.tsx
// Locais operacionais (Base de Carga, CS, Depósito, Redistribuição) + Gestão Financeira

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { carregarLocaisSupabase } from '../lib/estacoes-supabase';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem } from '../lib/imageUtils';
import { supabase } from '../lib/supabase';
import { showToastGlobal } from './ui/ToastQueue';

// ── i18n (padrão TermosUsoGate: objeto { pt, en, es, ru }, sem json) ─────────
type Lang = 'pt' | 'en' | 'es' | 'ru';
type L = { pt: string; en: string; es: string; ru: string };

const T = {
  // Modal cadastro/edição do local
  editarLocal:        { pt:'Editar local',            en:'Edit location',          es:'Editar local',            ru:'Редактировать объект' },
  novoLocal:          { pt:'Novo local operacional',  en:'New operational site',   es:'Nuevo local operativo',   ru:'Новый рабочий объект' },
  tipoDeLocal:        { pt:'Tipo de local',           en:'Site type',              es:'Tipo de local',           ru:'Тип объекта' },
  nomeReq:            { pt:'Nome *',                   en:'Name *',                 es:'Nombre *',                ru:'Название *' },
  exNome:             { pt:'Ex: ',                     en:'E.g.: ',                 es:'Ej.: ',                   ru:'Напр.: ' },
  centroSuf:          { pt:' Centro',                  en:' Center',                es:' Centro',                 ru:' центр' },
  endereco:           { pt:'Endereço',                 en:'Address',                es:'Dirección',               ru:'Адрес' },
  fotoDoLocal:        { pt:'Foto do local',            en:'Site photo',             es:'Foto del local',          ru:'Фото объекта' },
  alterarFoto:        { pt:'Alterar foto',             en:'Change photo',           es:'Cambiar foto',            ru:'Изменить фото' },
  adicionarFoto:      { pt:'Adicionar foto',           en:'Add photo',              es:'Añadir foto',             ru:'Добавить фото' },
  capacidadePat:      { pt:'Capacidade (pat.)',        en:'Capacity (units)',       es:'Capacidad (unid.)',       ru:'Вместимость (ед.)' },
  horario:            { pt:'Horário',                  en:'Hours',                  es:'Horario',                 ru:'Часы работы' },
  responsavel:        { pt:'Responsável',              en:'Manager',                es:'Responsable',             ru:'Ответственный' },
  telefone:           { pt:'Telefone',                 en:'Phone',                  es:'Teléfono',                ru:'Телефон' },
  observacoes:        { pt:'Observações',              en:'Notes',                  es:'Observaciones',           ru:'Примечания' },
  localAtivo:         { pt:'Local ativo',              en:'Active site',            es:'Local activo',            ru:'Объект активен' },
  cancelar:           { pt:'Cancelar',                 en:'Cancel',                 es:'Cancelar',                ru:'Отмена' },
  salvar:             { pt:'Salvar',                   en:'Save',                   es:'Guardar',                 ru:'Сохранить' },
  adicionar:          { pt:'Adicionar',                en:'Add',                    es:'Añadir',                  ru:'Добавить' },
  salvando:           { pt:'Salvando...',              en:'Saving...',              es:'Guardando...',            ru:'Сохранение...' },
  informeNome:        { pt:'Informe o nome do local',  en:'Enter the site name',    es:'Indique el nombre del local', ru:'Укажите название объекта' },
  localAtualizado:    { pt:'Local atualizado',         en:'Site updated',           es:'Local actualizado',       ru:'Объект обновлён' },
  localAdicionado:    { pt:'Local adicionado',         en:'Site added',             es:'Local añadido',           ru:'Объект добавлен' },
  localRemovido:      { pt:'Local removido',           en:'Site removed',           es:'Local eliminado',         ru:'Объект удалён' },
  erro:               { pt:'Erro: ',                   en:'Error: ',                es:'Error: ',                 ru:'Ошибка: ' },
  excluirConfirmA:    { pt:'Excluir "',                en:'Delete "',               es:'¿Eliminar "',             ru:'Удалить «' },
  excluirConfirmB:    { pt:'"?',                       en:'"?',                     es:'"?',                      ru:'»?' },

  // Painel principal
  tituloPainel:       { pt:'Locais & Financeiro',      en:'Sites & Finance',        es:'Locales y Finanzas',      ru:'Объекты и финансы' },
  localSingular:      { pt:'local',                    en:'site',                   es:'local',                   ru:'объект' },
  localPlural:        { pt:'locais',                   en:'sites',                  es:'locales',                 ru:'объектов' },
  abaLocais:          { pt:'Locais',                   en:'Sites',                  es:'Locales',                 ru:'Объекты' },
  abaFinanceiro:      { pt:'Financeiro',               en:'Finance',                es:'Finanzas',                ru:'Финансы' },
  abaRelatorio:       { pt:'Relatório',                en:'Report',                 es:'Informe',                 ru:'Отчёт' },
  cliqueMapa:         { pt:'Clique no mapa (FAB 📍) para adicionar locais', en:'Tap the map (FAB 📍) to add sites', es:'Toca el mapa (FAB 📍) para añadir locales', ru:'Нажмите на карту (FAB 📍), чтобы добавить объекты' },
  un:                 { pt:'un.',                      en:'units',                  es:'unid.',                   ru:'ед.' },
  novoPagamento:      { pt:'Novo pagamento',           en:'New payment',            es:'Nuevo pago',              ru:'Новый платёж' },
  financeiroBtn:      { pt:'Financeiro',               en:'Finance',                es:'Finanzas',                ru:'Финансы' },
  contrato:           { pt:'Contrato',                 en:'Contract',               es:'Contrato',                ru:'Договор' },
  adicioneLocalMapa:  { pt:'Adicione um local no mapa primeiro', en:'Add a site on the map first', es:'Añade primero un local en el mapa', ru:'Сначала добавьте объект на карту' },
  maisPagamento:      { pt:'+ Pagamento',              en:'+ Payment',              es:'+ Pago',                  ru:'+ Платёж' },
  pago:               { pt:'Pago',                     en:'Paid',                   es:'Pagado',                  ru:'Оплачено' },
  pendente:           { pt:'Pendente',                 en:'Pending',                es:'Pendiente',               ru:'В ожидании' },
  atrasado:           { pt:'Atrasado',                 en:'Overdue',                es:'Vencido',                 ru:'Просрочено' },
  contratosCab:       { pt:'CONTRATOS',                en:'CONTRACTS',              es:'CONTRATOS',               ru:'ДОГОВОРЫ' },
  contratoAluguel:    { pt:'Contrato de Aluguel',      en:'Lease Contract',         es:'Contrato de Alquiler',    ru:'Договор аренды' },
  porMes:             { pt:'/mês · dia ',              en:'/mo · day ',             es:'/mes · día ',             ru:'/мес · день ' },
  ate:                { pt:' até ',                    en:' to ',                   es:' hasta ',                 ru:' до ' },
  pagamentosCab:      { pt:'PAGAMENTOS · ',            en:'PAYMENTS · ',            es:'PAGOS · ',                ru:'ПЛАТЕЖИ · ' },
  nenhumPagEm:        { pt:'Nenhum pagamento em ',     en:'No payments in ',        es:'Sin pagos en ',           ru:'Нет платежей за ' },
  vence:              { pt:'Vence: ',                  en:'Due: ',                  es:'Vence: ',                 ru:'Срок: ' },
  todosLocais:        { pt:'Todos os locais · ',       en:'All sites · ',           es:'Todos los locales · ',    ru:'Все объекты · ' },
  nenhumLocalCad:     { pt:'Nenhum local cadastrado',  en:'No sites registered',    es:'Ningún local registrado', ru:'Нет зарегистрированных объектов' },
  pagoSuf:            { pt:' pago',                    en:' paid',                  es:' pagado',                 ru:' оплачено' },

  // Modal pagamento
  editarPagamento:    { pt:'Editar pagamento',         en:'Edit payment',           es:'Editar pago',             ru:'Редактировать платёж' },
  novoPagamentoTit:   { pt:'Novo pagamento',           en:'New payment',            es:'Nuevo pago',              ru:'Новый платёж' },
  tipo:               { pt:'Tipo',                     en:'Type',                   es:'Tipo',                    ru:'Тип' },
  medicaoRelogio:     { pt:'Medição do relógio',       en:'Meter reading',          es:'Lectura del medidor',     ru:'Показания счётчика' },
  anteriorKwh:        { pt:'Anterior (kWh)',           en:'Previous (kWh)',         es:'Anterior (kWh)',          ru:'Предыдущее (кВт·ч)' },
  atualKwh:           { pt:'Atual (kWh)',              en:'Current (kWh)',          es:'Actual (kWh)',            ru:'Текущее (кВт·ч)' },
  tarifaKwh:          { pt:'Tarifa (R$/kWh)',          en:'Rate (R$/kWh)',          es:'Tarifa (R$/kWh)',         ru:'Тариф (R$/кВт·ч)' },
  consumo:            { pt:'Consumo: ',                en:'Consumption: ',          es:'Consumo: ',               ru:'Потребление: ' },
  estimado:           { pt:'Estimado: ',               en:'Estimated: ',            es:'Estimado: ',              ru:'Оценка: ' },
  descricao:          { pt:'Descrição',                en:'Description',            es:'Descripción',             ru:'Описание' },
  valorRS:            { pt:'Valor (R$)',               en:'Amount (R$)',            es:'Importe (R$)',            ru:'Сумма (R$)' },
  competencia:        { pt:'Competência',              en:'Period',                 es:'Período',                 ru:'Период' },
  vencimento:         { pt:'Vencimento',               en:'Due date',               es:'Vencimiento',             ru:'Срок оплаты' },
  dataPagamento:      { pt:'Data pagamento',           en:'Payment date',           es:'Fecha de pago',           ru:'Дата оплаты' },
  status:             { pt:'Status',                   en:'Status',                 es:'Estado',                  ru:'Статус' },
  observacao:         { pt:'Observação',               en:'Note',                   es:'Observación',             ru:'Примечание' },
  comprovanteNf:      { pt:'Comprovante / Nota fiscal', en:'Receipt / Invoice',     es:'Comprobante / Factura',   ru:'Квитанция / Счёт-фактура' },
  substituirArquivo:  { pt:'Substituir arquivo',       en:'Replace file',           es:'Reemplazar archivo',      ru:'Заменить файл' },
  uploadArquivoTxt:   { pt:'Upload arquivo',           en:'Upload file',            es:'Subir archivo',           ru:'Загрузить файл' },
  ver:                { pt:'Ver ↗',                    en:'View ↗',                 es:'Ver ↗',                   ru:'Открыть ↗' },
  salvarPagamento:    { pt:'Salvar pagamento',         en:'Save payment',           es:'Guardar pago',            ru:'Сохранить платёж' },

  // Modal contrato
  contratoAluguelTit: { pt:'Contrato de Aluguel',      en:'Lease Contract',         es:'Contrato de Alquiler',    ru:'Договор аренды' },
  valorMensalReq:     { pt:'Valor mensal (R$) *',      en:'Monthly amount (R$) *',  es:'Importe mensual (R$) *',  ru:'Ежемесячная сумма (R$) *' },
  diaVencto:          { pt:'Dia vencto.',              en:'Due day',                es:'Día vencto.',             ru:'День оплаты' },
  inicioReq:          { pt:'Início *',                 en:'Start *',                es:'Inicio *',                ru:'Начало *' },
  fim:                { pt:'Fim',                       en:'End',                    es:'Fin',                     ru:'Конец' },
  proprietarioLocador:{ pt:'Proprietário / Locador',   en:'Owner / Lessor',         es:'Propietario / Arrendador', ru:'Владелец / Арендодатель' },
  telefoneEmail:      { pt:'Telefone/Email',           en:'Phone/Email',            es:'Teléfono/Email',          ru:'Телефон/Эл. почта' },
  indexador:          { pt:'Indexador',                en:'Index',                  es:'Indexador',               ru:'Индексация' },
  fixo:               { pt:'Fixo',                     en:'Fixed',                  es:'Fijo',                    ru:'Фикс.' },
  outro:              { pt:'Outro',                     en:'Other',                  es:'Otro',                    ru:'Другое' },
  contratoDigitalizado:{ pt:'Contrato digitalizado',   en:'Scanned contract',       es:'Contrato digitalizado',   ru:'Скан договора' },
  uploadPdf:          { pt:'Upload (PDF)',             en:'Upload (PDF)',           es:'Subir (PDF)',             ru:'Загрузить (PDF)' },
  salvarContrato:     { pt:'Salvar contrato',          en:'Save contract',          es:'Guardar contrato',        ru:'Сохранить договор' },
  preenchaValorInicio:{ pt:'Preencha valor e data de início', en:'Fill in amount and start date', es:'Complete importe y fecha de inicio', ru:'Заполните сумму и дату начала' },
} satisfies Record<string, L>;

// Rótulos traduzíveis dos tipos/status (icons/cores ficam nos *_META; só o texto muda)
const TIPO_LOCAL_LABEL: Record<TipoLocal, L> = {
  BASE_CARGA:           { pt:'Base de Carga',     en:'Charging Base',        es:'Base de Carga',        ru:'База зарядки' },
  CENTRO_SERVICO:       { pt:'Centro de Serviço', en:'Service Center',       es:'Centro de Servicio',   ru:'Сервисный центр' },
  DEPOSITO:             { pt:'Depósito',          en:'Warehouse',            es:'Depósito',             ru:'Склад' },
  PONTO_REDISTRIBUICAO: { pt:'Redistribuição',    en:'Redistribution',       es:'Redistribución',       ru:'Перераспределение' },
};

const TIPO_PAG_LABEL: Record<TipoPagamento, L> = {
  ALUGUEL:    { pt:'Aluguel',    en:'Rent',         es:'Alquiler',     ru:'Аренда' },
  ENERGIA:    { pt:'Energia',    en:'Electricity',  es:'Energía',      ru:'Электроэнергия' },
  AGUA:       { pt:'Água',       en:'Water',        es:'Agua',         ru:'Вода' },
  INTERNET:   { pt:'Internet',   en:'Internet',     es:'Internet',     ru:'Интернет' },
  CONDOMINIO: { pt:'Condomínio', en:'HOA fees',     es:'Comunidad',    ru:'Коммунальные' },
  IPTU:       { pt:'IPTU',       en:'Property tax', es:'Impuesto predial', ru:'Налог на недвижимость' },
  SEGURO:     { pt:'Seguro',     en:'Insurance',    es:'Seguro',       ru:'Страховка' },
  MANUTENCAO: { pt:'Manutenção', en:'Maintenance',  es:'Mantenimiento', ru:'Обслуживание' },
  OUTRO:      { pt:'Outro',      en:'Other',        es:'Otro',         ru:'Другое' },
};

const STATUS_PAG_LABEL: Record<StatusPagamento, L> = {
  PAGO:      { pt:'Pago',      en:'Paid',      es:'Pagado',    ru:'Оплачено' },
  PENDENTE:  { pt:'Pendente',  en:'Pending',   es:'Pendiente', ru:'В ожидании' },
  ATRASADO:  { pt:'Atrasado',  en:'Overdue',   es:'Vencido',   ru:'Просрочено' },
  CANCELADO: { pt:'Cancelado', en:'Cancelled', es:'Cancelado', ru:'Отменено' },
};

// ── TIPOS ──────────────────────────────────────────────────────────────────
export type TipoLocal =
  | 'BASE_CARGA' | 'CENTRO_SERVICO' | 'DEPOSITO' | 'PONTO_REDISTRIBUICAO';

export interface LocalOperacional {
  id: string;
  tipo: TipoLocal;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  cidade: string;
  pais: string;
  capacidade?: number;
  responsavel?: string;
  telefone?: string;
  horario?: string;
  obs?: string;
  foto?: string;
  ativo: boolean;
  criadoEm?: any;
  atualizadoEm?: any;
}

export type TipoPagamento =
  'ALUGUEL' | 'ENERGIA' | 'AGUA' | 'INTERNET' |
  'CONDOMINIO' | 'IPTU' | 'SEGURO' | 'MANUTENCAO' | 'OUTRO';
export type StatusPagamento = 'PAGO' | 'PENDENTE' | 'ATRASADO' | 'CANCELADO';

interface Contrato {
  id: string; localId: string;
  valor: number; diaVencimento: number;
  dataInicio: string; dataFim?: string;
  proprietario?: string; contatoProprietario?: string;
  indexador?: string; status: string;
  observacao?: string; docUrl?: string; criadoEm?: string;
}

interface Pagamento {
  id: string; localId: string; contratoId?: string;
  tipo: TipoPagamento; descricao: string; valor: number;
  competencia: string; dataPagamento?: string; dataVencimento: string;
  status: StatusPagamento; comprovanteUrl?: string;
  leituraAnterior?: number; leituraAtual?: number; tarifaKwh?: number;
  observacao?: string; criadoEm?: string;
}

// ── METAS ──────────────────────────────────────────────────────────────────
export const TIPO_LOCAL_META: Record<TipoLocal, {
  icon: string; label: string; color: string; bgColor: string;
}> = {
  BASE_CARGA:           { icon:'⚡', label:'Base de Carga',     color:'#facc15', bgColor:'rgba(250,204,21,.15)' },
  CENTRO_SERVICO:       { icon:'🔧', label:'Centro de Serviço', color:'#60a5fa', bgColor:'rgba(96,165,250,.15)' },
  DEPOSITO:             { icon:'🏭', label:'Depósito',          color:'#a78bfa', bgColor:'rgba(167,139,250,.15)' },
  PONTO_REDISTRIBUICAO: { icon:'🔄', label:'Redistribuição',    color:'#34d399', bgColor:'rgba(52,211,153,.15)'  },
};

const TIPO_PAG_META: Record<TipoPagamento, { label:string; icon:string; cor:string }> = {
  ALUGUEL:    { label:'Aluguel',    icon:'🏠', cor:'#3b82f6' },
  ENERGIA:    { label:'Energia',    icon:'⚡', cor:'#f59e0b' },
  AGUA:       { label:'Água',       icon:'💧', cor:'#06b6d4' },
  INTERNET:   { label:'Internet',   icon:'🌐', cor:'#6366f1' },
  CONDOMINIO: { label:'Condomínio', icon:'🏢', cor:'#8b5cf6' },
  IPTU:       { label:'IPTU',       icon:'📋', cor:'#ef4444' },
  SEGURO:     { label:'Seguro',     icon:'🛡', cor:'#10b981' },
  MANUTENCAO: { label:'Manutenção', icon:'🔧', cor:'#f97316' },
  OUTRO:      { label:'Outro',      icon:'📌', cor:'#6b7280' },
};

const STATUS_PAG: Record<StatusPagamento, { label:string; cor:string; bg:string }> = {
  PAGO:      { label:'Pago',      cor:'#4ade80', bg:'rgba(74,222,128,.15)'  },
  PENDENTE:  { label:'Pendente',  cor:'#fbbf24', bg:'rgba(251,191,36,.15)' },
  ATRASADO:  { label:'Atrasado',  cor:'#f87171', bg:'rgba(248,113,113,.15)' },
  CANCELADO: { label:'Cancelado', cor:'#6b7280', bg:'rgba(107,114,128,.15)' },
};

// ── HOOKS ──────────────────────────────────────────────────────────────────
export function useLocaisOperacionais(cidade: string, pais: string) {
  const [locais, setLocais] = useState<LocalOperacional[]>([]);
  useEffect(() => {
    if (!cidade) return;
    let vivo = true;
    carregarLocaisSupabase().then(rows => {
      if (vivo) setLocais(rows.filter((r: any) => r.cidade === cidade) as LocalOperacional[]);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [cidade, pais]);
  return locais;
}

function useContratos(localId: string | null) {
  const [data, setData] = useState<Contrato[]>([]);
  useEffect(() => {
    if (!localId) { setData([]); return; }
    supabase.from('contratos_locais').select('*').eq('local_id', localId)
      .then(({ data: rows }) => setData((rows ?? []).map((r: any) => ({
        id: r.id, localId: r.local_id, valor: r.valor, diaVencimento: r.dia_vencimento,
        dataInicio: r.data_inicio, dataFim: r.data_fim, proprietario: r.proprietario,
        contatoProprietario: r.contato_proprietario, indexador: r.indexador,
        status: r.status, observacao: r.observacao, docUrl: r.doc_url, criadoEm: r.criado_em,
      }))));
  }, [localId]);
  return data;
}

function usePagamentos(localId: string | null) {
  const [data, setData] = useState<Pagamento[]>([]);
  useEffect(() => {
    if (!localId) { setData([]); return; }
    supabase.from('pagamentos_locais').select('*').eq('local_id', localId)
      .order('data_vencimento', { ascending: false })
      .then(({ data: rows }) => setData((rows ?? []).map((r: any) => ({
        id: r.id, localId: r.local_id, contratoId: r.contrato_id,
        tipo: r.tipo, descricao: r.descricao, valor: r.valor,
        competencia: r.competencia, dataPagamento: r.data_pagamento,
        dataVencimento: r.data_vencimento, status: r.status,
        comprovanteUrl: r.comprovante_url, leituraAnterior: r.leitura_anterior,
        leituraAtual: r.leitura_atual, tarifaKwh: r.tarifa_kwh,
        observacao: r.observacao, criadoEm: r.criado_em,
      }))));
  }, [localId]);
  return data;
}

async function uploadArquivo(file: File, path: string): Promise<string> {
  return uploadComRetry(file, path);
}

// ── MODAL CADASTRO/EDIÇÃO DO LOCAL (original mantido) ──────────────────────
export function LocalOperacionalModal({
  latLng, cidade, pais, editando, onFechar, showToast,
}: {
  latLng: { lat:number; lng:number };
  cidade: string; pais: string;
  editando?: LocalOperacional | null;
  onFechar: () => void;
  showToast: (msg:string, type?:string) => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;

  const [tipo,        setTipo]        = useState<TipoLocal>(editando?.tipo      || 'BASE_CARGA');
  const [nome,        setNome]        = useState(editando?.nome        || '');
  const [endereco,    setEndereco]    = useState(editando?.endereco    || '');
  const [capacidade,  setCapacidade]  = useState(String(editando?.capacidade || ''));
  const [responsavel, setResponsavel] = useState(editando?.responsavel || '');
  const [telefone,    setTelefone]    = useState(editando?.telefone    || '');
  const [horario,     setHorario]     = useState(editando?.horario     || '');
  const [obs,         setObs]         = useState(editando?.obs         || '');
  const [foto,        setFoto]        = useState(editando?.foto        || '');
  const [fotoPreview, setFotoPreview] = useState(editando?.foto        || '');
  const [ativo,       setAtivo]       = useState(editando?.ativo ?? true);
  const [busy,        setBusy]        = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editando?.endereco || endereco) return;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latLng.lat}&lon=${latLng.lng}&format=json&accept-language=pt-BR`)
      .then(r => r.json()).then(d => { if (d.display_name) setEndereco(d.display_name); }).catch(() => {});
  }, []);

  // Compressão HEIC-safe (ver lib/imageUtils). Converte HEIC→JPEG antes de comprimir,
  // evitando o bug de foto "quebrada" (HEIC enviado como .jpg que o WebView não renderiza).
  const handleFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const compressed = await comprimirImagem(file);
      const reader = new FileReader();
      reader.onload = ev => { const b64 = ev.target?.result as string; setFoto(b64); setFotoPreview(b64); };
      reader.readAsDataURL(compressed);
    } catch (err) {
      console.error('[LocaisFin] compressão falhou:', err);
    }
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast(pick(T.informeNome), 'error'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const id = editando ? editando.id : crypto.randomUUID();
      const row: Record<string,any> = {
        id, tipo, nome: nome.trim(), endereco, lat: latLng.lat, lng: latLng.lng,
        cidade, pais, ativo, atualizado_em: now,
        capacidade: capacidade ? Number(capacidade) : null,
        responsavel: responsavel || null, telefone: telefone || null,
        horario: horario || null, obs: obs || null, foto: foto || null,
      };
      if (!editando) row.criado_em = now;
      const { error } = await supabase.from('locais_operacionais').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      showToast(editando ? pick(T.localAtualizado) : pick(T.localAdicionado), 'success');
      onFechar();
    } catch(e:any) { showToast(pick(T.erro) + e.message, 'error'); }
    setBusy(false);
  };

  const excluir = async () => {
    if (!editando || !confirm(`${pick(T.excluirConfirmA)}${editando.nome}${pick(T.excluirConfirmB)}`)) return;
    const { error } = await supabase.from('locais_operacionais').delete().eq('id', editando.id);
    if (error) { showToast(pick(T.erro) + error.message, 'error'); return; }
    showToast(pick(T.localRemovido), 'success');
    onFechar();
  };

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 12px',
    background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
    borderRadius:8, color:'#fff', fontSize:13, outline:'none', fontFamily:'inherit',
  };
  const lbl: React.CSSProperties = { fontSize:11, color:'rgba(255,255,255,.5)', marginBottom:4, display:'block' };

  return (
    <div style={{ position:'fixed', right:0, top:0, bottom:0, width:420,
      background:'rgba(13,18,30,.97)', backdropFilter:'blur(16px)',
      borderLeft:'1px solid rgba(255,255,255,.08)', zIndex:500,
      display:'flex', flexDirection:'column', overflowY:'auto' }}>

      <div style={{ padding:'16px 20px', borderBottom:'1px solid rgba(255,255,255,.06)',
        display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>
            {editando ? pick(T.editarLocal) : pick(T.novoLocal)}
          </div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,.4)', marginTop:2 }}>
            {latLng.lat.toFixed(5)}, {latLng.lng.toFixed(5)}
          </div>
        </div>
        <button onClick={onFechar} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', cursor:'pointer', fontSize:20 }}>✕</button>
      </div>

      <div style={{ flex:1, padding:'16px 20px', display:'flex', flexDirection:'column', gap:14, overflowY:'auto' }}>
        {/* Tipo */}
        <div>
          <label style={lbl}>{pick(T.tipoDeLocal)}</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {(Object.keys(TIPO_LOCAL_META) as TipoLocal[]).map(t => {
              const m = TIPO_LOCAL_META[t];
              return (
                <button key={t} onClick={() => setTipo(t)} style={{
                  padding:'10px 8px', borderRadius:8, cursor:'pointer',
                  border:`1px solid ${tipo===t ? m.color+'88':'rgba(255,255,255,.08)'}`,
                  background: tipo===t ? m.bgColor : 'rgba(255,255,255,.03)',
                  color: tipo===t ? m.color : 'rgba(255,255,255,.4)',
                  fontSize:12, fontWeight: tipo===t ? 700 : 400,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}>
                  <span style={{ fontSize:16 }}>{m.icon}</span> {pick(TIPO_LOCAL_LABEL[t])}
                </button>
              );
            })}
          </div>
        </div>

        <div><label style={lbl}>{pick(T.nomeReq)}</label>
          <input value={nome} onChange={e=>setNome(e.target.value)}
            placeholder={`${pick(T.exNome)}${pick(TIPO_LOCAL_LABEL[tipo])}${pick(T.centroSuf)}`} style={inp} /></div>

        <div><label style={lbl}>{pick(T.endereco)}</label>
          <input value={endereco} onChange={e=>setEndereco(e.target.value)} style={inp} /></div>

        {/* Foto */}
        <div>
          <label style={lbl}>{pick(T.fotoDoLocal)}</label>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFotoChange} style={{ display:'none' }} />
          {fotoPreview && (
            <div style={{ marginBottom:10, borderRadius:8, overflow:'hidden', border:'1px solid rgba(255,255,255,.1)' }}>
              <img src={fotoPreview} alt="Preview" style={{ width:'100%', height:180, objectFit:'cover' }} />
            </div>
          )}
          <button onClick={() => fileInputRef.current?.click()} style={{
            width:'100%', padding:'10px 12px', background:'rgba(96,165,250,.1)',
            border:'1px solid rgba(96,165,250,.3)', borderRadius:8, color:'#60a5fa',
            fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>📷 {fotoPreview ? pick(T.alterarFoto) : pick(T.adicionarFoto)}</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div><label style={lbl}>{pick(T.capacidadePat)}</label>
            <input type="number" value={capacidade} onChange={e=>setCapacidade(e.target.value)} placeholder="50" style={inp} /></div>
          <div><label style={lbl}>{pick(T.horario)}</label>
            <input value={horario} onChange={e=>setHorario(e.target.value)} placeholder="08:00–18:00" style={inp} /></div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div><label style={lbl}>{pick(T.responsavel)}</label>
            <input value={responsavel} onChange={e=>setResponsavel(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>{pick(T.telefone)}</label>
            <input value={telefone} onChange={e=>setTelefone(e.target.value)} style={inp} /></div>
        </div>
        <div><label style={lbl}>{pick(T.observacoes)}</label>
          <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={3}
            style={{ ...inp, resize:'vertical', minHeight:72 }} /></div>

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <input type="checkbox" checked={ativo} onChange={e=>setAtivo(e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }} />
          <label style={{ fontSize:13, color:'rgba(255,255,255,.6)', cursor:'pointer' }} onClick={() => setAtivo(v=>!v)}>{pick(T.localAtivo)}</label>
        </div>
      </div>

      <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,.06)', display:'flex', gap:8, flexShrink:0 }}>
        {editando && (
          <button onClick={excluir} style={{ padding:'11px 14px', borderRadius:10,
            border:'1px solid rgba(239,68,68,.3)', background:'rgba(239,68,68,.08)',
            color:'#ef4444', cursor:'pointer', fontSize:13 }}>🗑</button>
        )}
        <button onClick={onFechar} style={{ flex:1, padding:'11px', borderRadius:10,
          border:'1px solid rgba(255,255,255,.08)', background:'rgba(255,255,255,.04)',
          color:'rgba(255,255,255,.5)', fontSize:13, cursor:'pointer' }}>{pick(T.cancelar)}</button>
        <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'11px', borderRadius:10, border:'none',
          background: busy?'rgba(96,165,250,.3)':'linear-gradient(135deg,#1a6fd4,#307FE2)',
          color:'#fff', fontSize:13, fontWeight:700, cursor: busy?'not-allowed':'pointer' }}>
          {busy ? pick(T.salvando) : editando ? pick(T.salvar) : pick(T.adicionar)}
        </button>
      </div>
    </div>
  );
}

// ── PAINEL FINANCEIRO ──────────────────────────────────────────────────────
interface FinanceiroProps {
  cidade: string; pais: string;
  onFechar: () => void;
  roleUsuario: string;
}

export default function LocaisFinanceiro({ cidade, pais, onFechar, roleUsuario }: FinanceiroProps) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;

  const locais   = useLocaisOperacionais(cidade, pais);
  const isGestor = ['admin','gestor'].includes(roleUsuario);

  const [aba,        setAba]        = useState<'locais'|'financeiro'|'relatorio'>('locais');
  const [localSel,   setLocalSel]   = useState<LocalOperacional|null>(null);
  const [novoPag,    setNovoPag]    = useState(false);
  const [editPag,    setEditPag]    = useState<Pagamento|null>(null);
  const [novoContr,  setNovoContr]  = useState(false);
  const [mesAtual,   setMesAtual]   = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  const contratos  = useContratos(localSel?.id || null);
  const pagamentos = usePagamentos(localSel?.id || null);
  const pagsFilt   = pagamentos.filter(p => p.competencia === mesAtual);

  const totalPago     = pagsFilt.filter(p=>p.status==='PAGO').reduce((s,p)=>s+p.valor,0);
  const totalPendente = pagsFilt.filter(p=>p.status==='PENDENTE').reduce((s,p)=>s+p.valor,0);
  const totalAtrasado = pagsFilt.filter(p=>p.status==='ATRASADO').reduce((s,p)=>s+p.valor,0);
  const fmtBRL = (v:number) => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

  const inp2: React.CSSProperties = {
    padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,.1)',
    background:'rgba(255,255,255,.05)', color:'#dce8ff', fontSize:11, outline:'none',
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1200, background:'rgba(0,0,0,.6)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={e => e.target===e.currentTarget && onFechar()}>
      <div style={{ width:'100%', maxWidth:560, height:'90vh', background:'#0a0f1e',
        borderRadius:'16px 16px 0 0', display:'flex', flexDirection:'column',
        fontFamily:'Inter,sans-serif', border:'1px solid rgba(255,255,255,.08)', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'13px 18px', borderBottom:'1px solid rgba(255,255,255,.07)',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#dce8ff' }}>🏭 {pick(T.tituloPainel)}</div>
            <div style={{ fontSize:10, color:'#7a8ba8', marginTop:2 }}>
              {cidade} · {locais.length} {locais.length!==1?pick(T.localPlural):pick(T.localSingular)}
            </div>
          </div>
          <button onClick={onFechar}
            style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        {/* Abas */}
        <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
          {([['locais','🏭 '+pick(T.abaLocais)],['financeiro','💳 '+pick(T.abaFinanceiro)],['relatorio','📊 '+pick(T.abaRelatorio)]] as [string,string][]).map(([k,l])=>(
            <button key={k} onClick={()=>setAba(k as any)} style={{
              flex:1, padding:'10px', border:'none', cursor:'pointer', background:'transparent',
              fontSize:12, fontWeight:600,
              color: aba===k?'#60a5fa':'rgba(255,255,255,.4)',
              borderBottom:`2px solid ${aba===k?'#60a5fa':'transparent'}` }}>
              {l}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'thin' as const }}>

          {/* ABA LOCAIS */}
          {aba==='locais' && (
            <div>
              {locais.filter(l=>l.ativo).length===0 ? (
                <div style={{ padding:32, textAlign:'center', color:'#7a8ba8' }}>
                  <div style={{ fontSize:36, marginBottom:10 }}>🏭</div>
                  <div style={{ fontSize:13 }}>{pick(T.cliqueMapa)}</div>
                </div>
              ) : locais.filter(l=>l.ativo).map(local=>{
                const m   = TIPO_LOCAL_META[local.tipo];
                const sel = localSel?.id===local.id;
                return (
                  <div key={local.id} onClick={()=>setLocalSel(sel?null:local)}
                    style={{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.04)',
                      cursor:'pointer', transition:'background .15s',
                      background: sel?'rgba(59,130,246,.08)':'transparent',
                      borderLeft:`3px solid ${sel?'#60a5fa':'transparent'}` }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                        <div style={{ width:38, height:38, borderRadius:10, flexShrink:0,
                          background:m.bgColor, border:`1.5px solid ${m.color}44`,
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>
                          {m.icon}
                        </div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>{local.nome}</div>
                          <div style={{ fontSize:10, color:'#7a8ba8', marginTop:2 }}>
                            {pick(TIPO_LOCAL_LABEL[local.tipo])}{local.responsavel ? ' · '+local.responsavel : ''}
                          </div>
                          {local.endereco && (
                            <div style={{ fontSize:10, color:'rgba(255,255,255,.25)', marginTop:1,
                              maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>
                              📍 {local.endereco}
                            </div>
                          )}
                        </div>
                      </div>
                      {local.capacidade ? (
                        <div style={{ fontSize:10, color:m.color, background:m.bgColor,
                          padding:'3px 8px', borderRadius:10, flexShrink:0 }}>
                          {local.capacidade} {pick(T.un)}
                        </div>
                      ) : null}
                    </div>

                    {/* Foto thumbnail */}
                    {sel && local.foto && (
                      <img src={(() => {
                        const u = local.foto || '';
                        const m = u.match(/\/d\/([^/?]+)/);
                        return m && u.includes('drive.google.com')
                          ? 'https://drive.google.com/uc?export=view&id=' + m[1]
                          : u;
                      })()} alt={local.nome}
                        style={{ width:'100%', height:120, objectFit:'cover', borderRadius:8, marginTop:10 }} />
                    )}

                    {/* Ações rápidas quando selecionado */}
                    {sel && (
                      <div style={{ display:'flex', gap:6, marginTop:10 }}>
                        <button onClick={e=>{e.stopPropagation();setAba('financeiro');setNovoPag(true);}}
                          style={{ flex:1, padding:'7px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                            background:'rgba(74,222,128,.1)', border:'1px solid rgba(74,222,128,.2)', color:'#4ade80' }}>
                          💳 {pick(T.novoPagamento)}
                        </button>
                        <button onClick={e=>{e.stopPropagation();setAba('financeiro');}}
                          style={{ flex:1, padding:'7px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                            background:'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.2)', color:'#60a5fa' }}>
                          📋 {pick(T.financeiroBtn)}
                        </button>
                        {isGestor && (
                          <button onClick={e=>{e.stopPropagation();setAba('financeiro');setNovoContr(true);}}
                            style={{ flex:1, padding:'7px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                              background:'rgba(139,92,246,.1)', border:'1px solid rgba(139,92,246,.2)', color:'#a78bfa' }}>
                            📄 {pick(T.contrato)}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ABA FINANCEIRO */}
          {aba==='financeiro' && (
            <div>
              {/* Chips de locais */}
              <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,.06)',
                display:'flex', gap:6, overflowX:'auto', scrollbarWidth:'none' as const }}>
                {locais.filter(l=>l.ativo).map(l=>(
                  <button key={l.id} onClick={()=>setLocalSel(l)}
                    style={{ flexShrink:0, padding:'5px 12px', borderRadius:20, cursor:'pointer', fontSize:11, fontWeight:600,
                      background: localSel?.id===l.id?'rgba(59,130,246,.2)':'rgba(255,255,255,.05)',
                      border:`1px solid ${localSel?.id===l.id?'rgba(59,130,246,.4)':'rgba(255,255,255,.08)'}`,
                      color: localSel?.id===l.id?'#60a5fa':'rgba(255,255,255,.5)' }}>
                    {TIPO_LOCAL_META[l.tipo].icon} {l.nome}
                  </button>
                ))}
                {locais.filter(l=>l.ativo).length===0 && (
                  <div style={{ fontSize:11, color:'#7a8ba8' }}>{pick(T.adicioneLocalMapa)}</div>
                )}
              </div>

              {localSel && (
                <>
                  {/* Controles de mês */}
                  <div style={{ padding:'10px 14px', display:'flex', gap:8, alignItems:'center',
                    borderBottom:'1px solid rgba(255,255,255,.06)' }}>
                    <input type="month" value={mesAtual} onChange={e=>setMesAtual(e.target.value)} style={inp2} />
                    <div style={{ flex:1 }} />
                    {isGestor && (
                      <button onClick={()=>setNovoPag(true)}
                        style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                          background:'rgba(74,222,128,.15)', border:'1px solid rgba(74,222,128,.3)', color:'#4ade80' }}>
                        {pick(T.maisPagamento)}
                      </button>
                    )}
                  </div>

                  {/* Totais */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, padding:'12px 14px' }}>
                    {[
                      { label:pick(T.pago),     v:totalPago,     c:'#4ade80' },
                      { label:pick(T.pendente), v:totalPendente, c:'#fbbf24' },
                      { label:pick(T.atrasado), v:totalAtrasado, c:'#f87171' },
                    ].map(({label,v,c})=>(
                      <div key={label} style={{ background:'rgba(255,255,255,.04)', borderRadius:10,
                        padding:'10px 12px', border:'1px solid rgba(255,255,255,.06)' }}>
                        <div style={{ fontSize:10, color:'#7a8ba8', marginBottom:4 }}>{label}</div>
                        <div style={{ fontSize:12, fontWeight:700, color:c }}>{fmtBRL(v)}</div>
                      </div>
                    ))}
                  </div>

                  {/* Contratos */}
                  {contratos.length>0 && (
                    <div style={{ padding:'0 14px 12px' }}>
                      <div style={{ fontSize:10, color:'#7a8ba8', fontWeight:600, letterSpacing:'.06em', marginBottom:6 }}>📄 {pick(T.contratosCab)}</div>
                      {contratos.map(c=>(
                        <div key={c.id} style={{ padding:'10px 12px', borderRadius:8, marginBottom:6,
                          background:'rgba(139,92,246,.08)', border:'1px solid rgba(139,92,246,.2)',
                          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div>
                            <div style={{ fontSize:12, fontWeight:600, color:'#c4b5fd' }}>🏠 {pick(T.contratoAluguel)}</div>
                            <div style={{ fontSize:10, color:'#7a8ba8', marginTop:2 }}>
                              {fmtBRL(c.valor)}{pick(T.porMes)}{c.diaVencimento}
                              {c.proprietario ? ' · '+c.proprietario : ''}
                              {c.indexador ? ' · '+c.indexador : ''}
                            </div>
                            <div style={{ fontSize:10, color:'#7a8ba8' }}>
                              {c.dataInicio}{c.dataFim?pick(T.ate)+c.dataFim:''}
                            </div>
                          </div>
                          {c.docUrl && (
                            <a href={c.docUrl} target="_blank" rel="noreferrer"
                              style={{ padding:'4px 8px', borderRadius:6, fontSize:11,
                                background:'rgba(139,92,246,.15)', border:'1px solid rgba(139,92,246,.3)',
                                color:'#a78bfa', textDecoration:'none' }}>📎</a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pagamentos */}
                  <div style={{ padding:'0 14px 24px' }}>
                    <div style={{ fontSize:10, color:'#7a8ba8', fontWeight:600, letterSpacing:'.06em', marginBottom:8 }}>
                      💳 {pick(T.pagamentosCab)}{mesAtual}
                    </div>
                    {pagsFilt.length===0 ? (
                      <div style={{ padding:20, textAlign:'center', color:'#7a8ba8', fontSize:12 }}>
                        {pick(T.nenhumPagEm)}{mesAtual}
                      </div>
                    ) : pagsFilt.map(p=>{
                      const tm = TIPO_PAG_META[p.tipo];
                      const sm = STATUS_PAG[p.status];
                      return (
                        <div key={p.id} style={{ padding:'11px 12px', borderRadius:10, marginBottom:8,
                          background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)',
                          display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:36, height:36, borderRadius:8, flexShrink:0,
                            background:tm.cor+'1a', border:'1px solid '+tm.cor+'33',
                            display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>
                            {tm.icon}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff' }}>
                              {p.descricao||pick(TIPO_PAG_LABEL[p.tipo])}
                            </div>
                            <div style={{ fontSize:10, color:'#7a8ba8', marginTop:1 }}>
                              {pick(T.vence)}{p.dataVencimento}
                              {p.leituraAtual&&p.leituraAnterior ? ` · ${p.leituraAtual-p.leituraAnterior} kWh` : ''}
                            </div>
                          </div>
                          <div style={{ flexShrink:0, textAlign:'right' }}>
                            <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>{fmtBRL(p.valor)}</div>
                            <div style={{ fontSize:10, padding:'2px 8px', borderRadius:10, marginTop:3,
                              background:sm.bg, color:sm.cor, fontWeight:600 }}>{pick(STATUS_PAG_LABEL[p.status])}</div>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                            {p.comprovanteUrl && (
                              <a href={p.comprovanteUrl} target="_blank" rel="noreferrer"
                                style={{ padding:'3px 6px', borderRadius:5, fontSize:10,
                                  background:'rgba(255,255,255,.06)', color:'#60a5fa',
                                  textDecoration:'none', border:'1px solid rgba(255,255,255,.1)' }}>📎</a>
                            )}
                            {isGestor && (
                              <button onClick={()=>setEditPag(p)}
                                style={{ padding:'3px 6px', borderRadius:5, fontSize:10, cursor:'pointer',
                                  background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                                  color:'rgba(255,255,255,.5)' }}>✏️</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ABA RELATÓRIO */}
          {aba==='relatorio' && (
            <div style={{ padding:16 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:14 }}>
                <input type="month" value={mesAtual} onChange={e=>setMesAtual(e.target.value)} style={inp2} />
                <div style={{ fontSize:11, color:'#7a8ba8' }}>{pick(T.todosLocais)}{cidade}</div>
              </div>
              {locais.filter(l=>l.ativo).length===0 ? (
                <div style={{ textAlign:'center', color:'#7a8ba8', fontSize:12, padding:32 }}>{pick(T.nenhumLocalCad)}</div>
              ) : locais.filter(l=>l.ativo).map(local=>(
                <ResumoLocalRow key={local.id} local={local} mesAtual={mesAtual} fmtBRL={fmtBRL} />
              ))}
            </div>
          )}
        </div>
      </div>

      {novoPag && localSel && (
        <ModalPagamento localId={localSel.id} mesAtual={mesAtual}
          onFechar={()=>setNovoPag(false)} />
      )}
      {editPag && (
        <ModalPagamento localId={editPag.localId} mesAtual={mesAtual}
          editando={editPag} onFechar={()=>setEditPag(null)} />
      )}
      {novoContr && localSel && (
        <ModalContrato localId={localSel.id} onFechar={()=>setNovoContr(false)} />
      )}
    </div>
  );
}

// ── RESUMO LOCAL ───────────────────────────────────────────────────────────
function ResumoLocalRow({ local, mesAtual, fmtBRL }: {
  local: LocalOperacional; mesAtual: string; fmtBRL:(v:number)=>string;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;

  const pags  = usePagamentos(local.id);
  const pFilt = pags.filter(p=>p.competencia===mesAtual);
  const total = pFilt.reduce((s,p)=>s+p.valor,0);
  const pago  = pFilt.filter(p=>p.status==='PAGO').reduce((s,p)=>s+p.valor,0);
  const m     = TIPO_LOCAL_META[local.tipo];
  return (
    <div style={{ padding:'12px 14px', borderRadius:10, marginBottom:10,
      background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>{m.icon}</span>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'#dce8ff' }}>{local.nome}</div>
            <div style={{ fontSize:10, color:'#7a8ba8' }}>{pick(TIPO_LOCAL_LABEL[local.tipo])}</div>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>{fmtBRL(total)}</div>
          <div style={{ fontSize:10, color:'#4ade80' }}>{fmtBRL(pago)}{pick(T.pagoSuf)}</div>
        </div>
      </div>
      <div style={{ display:'flex', gap:4, flexWrap:'wrap' as const }}>
        {(Object.keys(TIPO_PAG_META) as TipoPagamento[]).map(tipo=>{
          const v = pFilt.filter(p=>p.tipo===tipo).reduce((s,p)=>s+p.valor,0);
          if (!v) return null;
          const mt = TIPO_PAG_META[tipo];
          return (
            <div key={tipo} style={{ padding:'2px 8px', borderRadius:10, fontSize:10,
              background:mt.cor+'18', border:'1px solid '+mt.cor+'30', color:mt.cor }}>
              {mt.icon} {fmtBRL(v)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MODAL PAGAMENTO ────────────────────────────────────────────────────────
function ModalPagamento({ localId, mesAtual, editando, onFechar }:{
  localId:string; mesAtual:string; editando?:Pagamento|null; onFechar:()=>void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;

  const [tipo,       setTipo]       = useState<TipoPagamento>(editando?.tipo||'ALUGUEL');
  const [descricao,  setDescricao]  = useState(editando?.descricao||'');
  const [valor,      setValor]      = useState(String(editando?.valor||''));
  const [comp,       setComp]       = useState(editando?.competencia||mesAtual);
  const [venc,       setVenc]       = useState(editando?.dataVencimento||'');
  const [pago,       setPago]       = useState(editando?.dataPagamento||'');
  const [status,     setStatus]     = useState<StatusPagamento>(editando?.status||'PENDENTE');
  const [obs,        setObs]        = useState(editando?.observacao||'');
  const [leitAnt,    setLeitAnt]    = useState(String(editando?.leituraAnterior||''));
  const [leitAt,     setLeitAt]     = useState(String(editando?.leituraAtual||''));
  const [tarifa,     setTarifa]     = useState(String(editando?.tarifaKwh||''));
  const [compFile,   setCompFile]   = useState<File|null>(null);
  const [busy,       setBusy]       = useState(false);

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 11px', borderRadius:8, boxSizing:'border-box',
    border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.05)',
    color:'#dce8ff', fontSize:12, outline:'none',
  };

  const kwh   = tipo==='ENERGIA'&&leitAt&&leitAnt ? (Number(leitAt)-Number(leitAnt)) : 0;
  const vCalc = kwh>0&&tarifa ? kwh*Number(tarifa) : null;

  const salvar = async () => {
    setBusy(true);
    try {
      let comprovanteUrl = editando?.comprovanteUrl||'';
      if (compFile) comprovanteUrl = await uploadArquivo(compFile, `comprovantes/${localId}/${comp}_${tipo}_${Date.now()}.${compFile.name.split('.').pop()}`);
      const id = editando ? editando.id : crypto.randomUUID();
      const supaRow = {
        id,
        local_id: localId, tipo, descricao: descricao || TIPO_PAG_META[tipo].label,
        valor: vCalc !== null ? vCalc : Number(valor),
        competencia: comp, data_vencimento: venc,
        data_pagamento: pago || null, status, observacao: obs, comprovante_url: comprovanteUrl,
        leitura_anterior: leitAnt ? Number(leitAnt) : null,
        leitura_atual: leitAt ? Number(leitAt) : null,
        tarifa_kwh: tarifa ? Number(tarifa) : null,
        criado_em: editando?.criadoEm || new Date().toISOString(),
      };
      const { error } = await supabase.from('pagamentos_locais').upsert(supaRow, { onConflict: 'id' });
      if (error) throw error;
      onFechar();
    } catch(e:any) { showToastGlobal(pick(T.erro)+e.message, 'erro'); }
    setBusy(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1400, background:'rgba(0,0,0,.75)',
      display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={e=>e.target===e.currentTarget&&onFechar()}>
      <div style={{ width:'100%', maxWidth:480, background:'#0d1521',
        border:'1px solid rgba(255,255,255,.08)', borderRadius:'16px 16px 0 0',
        padding:20, maxHeight:'88vh', overflowY:'auto' }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#dce8ff', marginBottom:14 }}>
          {editando?'✏️ '+pick(T.editarPagamento):'💳 '+pick(T.novoPagamentoTit)}
        </div>

        {/* Tipo */}
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:10, color:'#7a8ba8', marginBottom:6 }}>{pick(T.tipo)}</div>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' as const }}>
            {(Object.keys(TIPO_PAG_META) as TipoPagamento[]).map(k=>{
              const m=TIPO_PAG_META[k];
              return (
                <button key={k} onClick={()=>setTipo(k)}
                  style={{ padding:'5px 9px', borderRadius:7, cursor:'pointer', fontSize:11,
                    background: tipo===k?m.cor+'22':'rgba(255,255,255,.04)',
                    border:`1px solid ${tipo===k?m.cor+'44':'rgba(255,255,255,.08)'}`,
                    color: tipo===k?m.cor:'rgba(255,255,255,.5)', fontWeight:tipo===k?600:400 }}>
                  {m.icon} {pick(TIPO_PAG_LABEL[k])}
                </button>
              );
            })}
          </div>
        </div>

        {/* Leituras de energia */}
        {tipo==='ENERGIA' && (
          <div style={{ background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.2)',
            borderRadius:10, padding:'12px', marginBottom:12 }}>
            <div style={{ fontSize:11, color:'#fbbf24', fontWeight:600, marginBottom:8 }}>⚡ {pick(T.medicaoRelogio)}</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              <div>
                <label style={{ fontSize:9, color:'#7a8ba8', display:'block', marginBottom:3 }}>{pick(T.anteriorKwh)}</label>
                <input value={leitAnt} onChange={e=>setLeitAnt(e.target.value)} type="number" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:9, color:'#7a8ba8', display:'block', marginBottom:3 }}>{pick(T.atualKwh)}</label>
                <input value={leitAt}  onChange={e=>setLeitAt(e.target.value)}  type="number" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:9, color:'#7a8ba8', display:'block', marginBottom:3 }}>{pick(T.tarifaKwh)}</label>
                <input value={tarifa}  onChange={e=>setTarifa(e.target.value)}  type="number" step="0.01" style={inp} />
              </div>
            </div>
            {kwh>0 && (
              <div style={{ marginTop:8, fontSize:11, color:'#fbbf24' }}>
                {pick(T.consumo)}<b>{kwh} kWh</b>
                {vCalc!==null && <> · {pick(T.estimado)}<b>R$ {vCalc.toFixed(2)}</b></>}
              </div>
            )}
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.descricao)}</label>
            <input value={descricao} onChange={e=>setDescricao(e.target.value)} placeholder={pick(TIPO_PAG_LABEL[tipo])} style={inp} /></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.valorRS)}</label>
              <input value={vCalc!==null?vCalc.toFixed(2):valor} onChange={e=>setValor(e.target.value)}
                type="number" step="0.01" readOnly={vCalc!==null} style={{ ...inp, opacity:vCalc!==null?0.7:1 }} /></div>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.competencia)}</label>
              <input value={comp} onChange={e=>setComp(e.target.value)} type="month" style={inp} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.vencimento)}</label>
              <input value={venc} onChange={e=>setVenc(e.target.value)} type="date" style={inp} /></div>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.dataPagamento)}</label>
              <input value={pago} onChange={e=>setPago(e.target.value)} type="date" style={inp} /></div>
          </div>
          <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.status)}</label>
            <select value={status} onChange={e=>setStatus(e.target.value as StatusPagamento)} style={{ ...inp, cursor:'pointer' }}>
              {(Object.keys(STATUS_PAG) as StatusPagamento[]).map(k=>(
                <option key={k} value={k}>{pick(STATUS_PAG_LABEL[k])}</option>
              ))}
            </select></div>
          <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.observacao)}</label>
            <input value={obs} onChange={e=>setObs(e.target.value)} style={inp} /></div>
          <div>
            <label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:6 }}>📎 {pick(T.comprovanteNf)}</label>
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
              padding:'7px 14px', borderRadius:8, background:'rgba(255,255,255,.06)',
              border:'1px solid rgba(255,255,255,.1)', color:'rgba(255,255,255,.6)', fontSize:11 }}>
              📤 {compFile?compFile.name:(editando?.comprovanteUrl?pick(T.substituirArquivo):pick(T.uploadArquivoTxt))}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:'none' }}
                onChange={e=>setCompFile(e.target.files?.[0]||null)} />
            </label>
            {editando?.comprovanteUrl&&!compFile && (
              <a href={editando.comprovanteUrl} target="_blank" rel="noreferrer"
                style={{ marginLeft:8, fontSize:11, color:'#60a5fa' }}>{pick(T.ver)}</a>
            )}
          </div>
        </div>

        <div style={{ display:'flex', gap:8, marginTop:16 }}>
          <button onClick={onFechar} style={{ flex:1, padding:'10px', borderRadius:10, cursor:'pointer',
            background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
            color:'rgba(255,255,255,.5)', fontSize:12 }}>{pick(T.cancelar)}</button>
          <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'10px', borderRadius:10,
            cursor:busy?'not-allowed':'pointer',
            background:busy?'rgba(74,222,128,.3)':'linear-gradient(135deg,#065f46,#059669)',
            border:'none', color:'#fff', fontSize:12, fontWeight:700 }}>
            {busy?pick(T.salvando):'💾 '+pick(T.salvarPagamento)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CONTRATO ─────────────────────────────────────────────────────────
function ModalContrato({ localId, onFechar }:{ localId:string; onFechar:()=>void }) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;

  const [valor,        setValor]        = useState('');
  const [dia,          setDia]          = useState('5');
  const [dataInicio,   setDataInicio]   = useState('');
  const [dataFim,      setDataFim]      = useState('');
  const [proprietario, setProprietario] = useState('');
  const [contato,      setContato]      = useState('');
  const [indexador,    setIndexador]    = useState('IGPM');
  const [obs,          setObs]          = useState('');
  const [docFile,      setDocFile]      = useState<File|null>(null);
  const [busy,         setBusy]         = useState(false);

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 11px', borderRadius:8, boxSizing:'border-box',
    border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.05)',
    color:'#dce8ff', fontSize:12, outline:'none',
  };

  const salvar = async () => {
    if (!valor||!dataInicio) { showToastGlobal(pick(T.preenchaValorInicio), 'warn'); return; }
    setBusy(true);
    try {
      let docUrl = '';
      if (docFile) docUrl = await uploadArquivo(docFile, `contratos/${localId}/${Date.now()}_contrato.${docFile.name.split('.').pop()}`);
      const { error } = await supabase.from('contratos_locais').upsert({
        id: crypto.randomUUID(), local_id: localId, tipo: 'ALUGUEL', valor: Number(valor),
        dia_vencimento: Number(dia), data_inicio: dataInicio, data_fim: dataFim || null,
        proprietario: proprietario || null, contato_proprietario: contato || null,
        indexador, status: 'ATIVO', observacao: obs || null, doc_url: docUrl || null,
        criado_em: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      onFechar();
    } catch(e:any) { showToastGlobal(pick(T.erro)+e.message, 'erro'); }
    setBusy(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1400, background:'rgba(0,0,0,.75)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onFechar()}>
      <div style={{ width:'100%', maxWidth:440, background:'#0d1521',
        border:'1px solid rgba(139,92,246,.2)', borderRadius:16, padding:20,
        maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#c4b5fd', marginBottom:16 }}>📄 {pick(T.contratoAluguelTit)}</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:8 }}>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.valorMensalReq)}</label>
              <input value={valor} onChange={e=>setValor(e.target.value)} type="number" step="0.01" style={{ ...inp, width:'100%' }} /></div>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.diaVencto)}</label>
              <input value={dia} onChange={e=>setDia(e.target.value)} type="number" min="1" max="31" style={{ ...inp, width:'100%' }} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.inicioReq)}</label>
              <input value={dataInicio} onChange={e=>setDataInicio(e.target.value)} type="date" style={{ ...inp, width:'100%' }} /></div>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.fim)}</label>
              <input value={dataFim} onChange={e=>setDataFim(e.target.value)} type="date" style={{ ...inp, width:'100%' }} /></div>
          </div>
          <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.proprietarioLocador)}</label>
            <input value={proprietario} onChange={e=>setProprietario(e.target.value)} style={inp} /></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.telefoneEmail)}</label>
              <input value={contato} onChange={e=>setContato(e.target.value)} style={{ ...inp, width:'100%' }} /></div>
            <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.indexador)}</label>
              <select value={indexador} onChange={e=>setIndexador(e.target.value)} style={{ ...inp, width:'100%', cursor:'pointer' }}>
                {['IGPM','IPCA','INPC','IVAR','Fixo','Outro'].map(i=>(
                  <option key={i} value={i}>{i==='Fixo'?pick(T.fixo):i==='Outro'?pick(T.outro):i}</option>
                ))}
              </select></div>
          </div>
          <div><label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:4 }}>{pick(T.observacoes)}</label>
            <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={2}
              style={{ ...inp, resize:'none' }} /></div>
          <div>
            <label style={{ fontSize:10, color:'#7a8ba8', display:'block', marginBottom:6 }}>📎 {pick(T.contratoDigitalizado)}</label>
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
              padding:'7px 14px', borderRadius:8, background:'rgba(139,92,246,.08)',
              border:'1px solid rgba(139,92,246,.2)', color:'#a78bfa', fontSize:11 }}>
              📤 {docFile?docFile.name:pick(T.uploadPdf)}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:'none' }}
                onChange={e=>setDocFile(e.target.files?.[0]||null)} />
            </label>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:16 }}>
          <button onClick={onFechar} style={{ flex:1, padding:'10px', borderRadius:10, cursor:'pointer',
            background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
            color:'rgba(255,255,255,.5)', fontSize:12 }}>{pick(T.cancelar)}</button>
          <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'10px', borderRadius:10,
            cursor:busy?'not-allowed':'pointer',
            background:busy?'rgba(139,92,246,.3)':'linear-gradient(135deg,#5b21b6,#7c3aed)',
            border:'none', color:'#fff', fontSize:12, fontWeight:700 }}>
            {busy?pick(T.salvando):'💾 '+pick(T.salvarContrato)}
          </button>
        </div>
      </div>
    </div>
  );
}
