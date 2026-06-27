import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { supabase } from '../lib/supabase';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ---------------------------------------------------------------------------
// i18n (pt fonte fiel) — padrão objeto T + pick, sem chaves json
// ---------------------------------------------------------------------------

type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

function useT() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: Tr) => o[lang] ?? o.pt;
  return { lang, pick };
}

const T = {
  // Header / abas
  titulo: { pt: 'Gestão de Pagamentos', en: 'Payment Management', es: 'Gestión de Pagos', ru: 'Управление платежами' },
  fechar: { pt: 'Fechar', en: 'Close', es: 'Cerrar', ru: 'Закрыть' },
  abaNfs: { pt: 'NFs Pendentes', en: 'Pending Invoices', es: 'Facturas Pendientes', ru: 'Ожидающие счета' },
  abaPagamentos: { pt: 'Pagamentos', en: 'Payments', es: 'Pagos', ru: 'Платежи' },
  abaConfig: { pt: 'Configuração', en: 'Settings', es: 'Configuración', ru: 'Настройки' },

  // Status
  stAberto: { pt: 'Aberto', en: 'Open', es: 'Abierto', ru: 'Открыто' },
  stNfEnviada: { pt: 'NF Enviada', en: 'Invoice Sent', es: 'Factura Enviada', ru: 'Счёт отправлен' },
  stNfAprovada: { pt: 'NF Aprovada', en: 'Invoice Approved', es: 'Factura Aprobada', ru: 'Счёт одобрен' },
  stRejeitada: { pt: 'Rejeitada', en: 'Rejected', es: 'Rechazada', ru: 'Отклонено' },
  stPago: { pt: 'Pago', en: 'Paid', es: 'Pagado', ru: 'Оплачено' },

  // Card de pagamento
  periodo: { pt: 'Período', en: 'Period', es: 'Período', ru: 'Период' },
  tarefas: { pt: 'Tarefas', en: 'Tasks', es: 'Tareas', ru: 'Задачи' },
  valorUnitario: { pt: 'Valor Unitário', en: 'Unit Value', es: 'Valor Unitario', ru: 'Цена за единицу' },
  valorTotal: { pt: 'Valor Total', en: 'Total Value', es: 'Valor Total', ru: 'Итоговая сумма' },

  // Comum
  carregando: { pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  salvar: { pt: 'Salvar', en: 'Save', es: 'Guardar', ru: 'Сохранить' },
  salvando: { pt: 'Salvando...', en: 'Saving...', es: 'Guardando...', ru: 'Сохранение...' },
  cancelar: { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  editar: { pt: 'Editar', en: 'Edit', es: 'Editar', ru: 'Редактировать' },
  confirmar: { pt: 'Confirmar', en: 'Confirm', es: 'Confirmar', ru: 'Подтвердить' },
  exportarCsv: { pt: '⬇ Exportar CSV', en: '⬇ Export CSV', es: '⬇ Exportar CSV', ru: '⬇ Экспорт CSV' },

  // Aba NFs Pendentes
  nfsVazio: { pt: 'Nenhuma NF aguardando validação', en: 'No invoices awaiting validation', es: 'Ninguna factura esperando validación', ru: 'Нет счетов, ожидающих проверки' },
  verNf: { pt: 'Ver NF', en: 'View Invoice', es: 'Ver Factura', ru: 'Посмотреть счёт' },
  aprovarNf: { pt: 'Aprovar NF', en: 'Approve Invoice', es: 'Aprobar Factura', ru: 'Одобрить счёт' },
  rejeitar: { pt: 'Rejeitar', en: 'Reject', es: 'Rechazar', ru: 'Отклонить' },
  motivoRejeicao: { pt: 'Motivo da rejeição...', en: 'Reason for rejection...', es: 'Motivo del rechazo...', ru: 'Причина отклонения...' },

  // Aba Pagamentos
  subPendentes: { pt: 'A Pagar', en: 'To Pay', es: 'Por Pagar', ru: 'К оплате' },
  subHistorico: { pt: 'Histórico de Pagos', en: 'Payment History', es: 'Historial de Pagos', ru: 'История платежей' },
  totalAPagar: { pt: 'Total a pagar', en: 'Total to pay', es: 'Total a pagar', ru: 'Итого к оплате' },
  registro: { pt: 'registro', en: 'record', es: 'registro', ru: 'запись' },
  registros: { pt: 'registros', en: 'records', es: 'registros', ru: 'записей' },
  pagamentosVazio: { pt: 'Nenhuma NF aprovada aguardando pagamento', en: 'No approved invoices awaiting payment', es: 'Ninguna factura aprobada esperando pago', ru: 'Нет одобренных счетов, ожидающих оплаты' },
  marcarPago: { pt: 'Marcar como Pago', en: 'Mark as Paid', es: 'Marcar como Pagado', ru: 'Отметить как оплачено' },
  filtrarSemanaAno: { pt: 'Filtrar por semana ou ano...', en: 'Filter by week or year...', es: 'Filtrar por semana o año...', ru: 'Фильтр по неделе или году...' },
  historicoVazio: { pt: 'Nenhum pagamento encontrado', en: 'No payments found', es: 'Ningún pago encontrado', ru: 'Платежи не найдены' },

  // Aba Configuração
  configCarregando: { pt: 'Carregando configurações...', en: 'Loading settings...', es: 'Cargando configuración...', ru: 'Загрузка настроек...' },
  valorPorTarefaCidade: { pt: 'Valor por tarefa por cidade', en: 'Value per task by city', es: 'Valor por tarea por ciudad', ru: 'Цена за задачу по городам' },
  novaCidade: { pt: '+ Nova cidade', en: '+ New city', es: '+ Nueva ciudad', ru: '+ Новый город' },
  nomeCidade: { pt: 'Nome da cidade', en: 'City name', es: 'Nombre de la ciudad', ru: 'Название города' },
  valorMoeda: { pt: 'Valor R$', en: 'Value R$', es: 'Valor R$', ru: 'Сумма R$' },
  porTarefa: { pt: '/ tarefa', en: '/ task', es: '/ tarea', ru: '/ задача' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  usuario: {
    uid: string;
    nome: string;
    role: string;
    cidade?: string;
    cidadesPermitidas?: string[];
  };
  onFechar: () => void;
}

interface PagamentoSemana {
  id: string;
  uid: string;
  nome: string;
  email: string;
  cidade: string;
  cargo: string;
  semana_inicio: Timestamp | null;
  semana_fim: Timestamp | null;
  ano: number;
  semana_iso: number;
  tarefas_count: number;
  valor_unitario: number;
  valor_total: number;
  status: 'aberto' | 'nf_enviada' | 'nf_aprovada' | 'rejeitada' | 'pago';
  nf_url: string | null;
  nf_enviada_em: Timestamp | null;
  nf_validada_em: Timestamp | null;
  pago_em: Timestamp | null;
  nf_validada_por: string;
  motivo_rejeicao: string;
}

interface PagamentoConfig {
  cidade: string;
  valor_por_tarefa: number;
  moeda: string;
  ativo: boolean;
}

type Aba = 'nfs' | 'pagamentos' | 'config';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function fmtSemana(inicio: any, fim: any): string {
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') return v.toDate();
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') return new Date(v);
    return null;
  };

  const fmt = (d: Date) => {
    const dia = DIAS[d.getDay()];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dia} ${dd}/${mm}`;
  };

  const dInicio = toDate(inicio);
  const dFim = toDate(fim);

  if (!dInicio && !dFim) return '—';
  if (!dFim) return fmt(dInicio!);
  if (!dInicio) return fmt(dFim);

  const ano = dFim.getFullYear();
  return `${fmt(dInicio)} – ${fmt(dFim)}/${ano}`;
}

// ---------------------------------------------------------------------------
// Styles (inline, dark theme)
// ---------------------------------------------------------------------------

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    background: '#0d121e',
    border: '1px solid rgba(255,255,255,.10)',
    borderRadius: 12,
    width: '96vw',
    maxWidth: 900,
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,.07)',
  },
  title: {
    color: '#f0f4ff',
    fontWeight: 700,
    fontSize: 18,
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#8896b3',
    fontSize: 20,
    cursor: 'pointer',
    lineHeight: 1,
    padding: '4px 8px',
  },
  tabs: {
    display: 'flex',
    gap: 4,
    padding: '10px 20px 0',
    borderBottom: '1px solid rgba(255,255,255,.07)',
  },
  tab: (active: boolean) => ({
    background: active ? 'rgba(255,255,255,.08)' : 'none',
    border: active ? '1px solid rgba(255,255,255,.15)' : '1px solid transparent',
    borderBottom: active ? '1px solid #0d121e' : '1px solid transparent',
    color: active ? '#f0f4ff' : '#8896b3',
    padding: '8px 18px',
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    marginBottom: -1,
  }),
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
  },
  card: {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 10,
    padding: '14px 18px',
    marginBottom: 12,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: 10,
  },
  badge: (color: string) => ({
    background: color,
    color: '#fff',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
  }),
  label: {
    color: '#8896b3',
    fontSize: 12,
    marginBottom: 2,
  },
  value: {
    color: '#dce6ff',
    fontSize: 14,
    fontWeight: 500,
  },
  btn: (bg: string, fg = '#fff') => ({
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  }),
  input: {
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 6,
    color: '#f0f4ff',
    padding: '6px 10px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  emptyMsg: {
    color: '#8896b3',
    textAlign: 'center' as const,
    padding: '40px 0',
    fontSize: 14,
  },
  subtotal: {
    background: 'rgba(26,111,212,.12)',
    border: '1px solid rgba(26,111,212,.25)',
    borderRadius: 8,
    padding: '10px 16px',
    marginBottom: 16,
    color: '#90bcff',
    fontWeight: 700,
    fontSize: 15,
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: PagamentoSemana['status'] }) {
  const { pick } = useT();
  const MAP: Record<string, [string, string]> = {
    aberto: ['#64748b', pick(T.stAberto)],
    nf_enviada: ['#d97706', pick(T.stNfEnviada)],
    nf_aprovada: ['#059669', pick(T.stNfAprovada)],
    rejeitada: ['#ef4444', pick(T.stRejeitada)],
    pago: ['#1a6fd4', pick(T.stPago)],
  };
  const [color, label] = MAP[status] ?? ['#64748b', status];
  return <span style={S.badge(color)}>{label}</span>;
}

function CardPagamento({
  p,
  acoes,
}: {
  p: PagamentoSemana;
  acoes: React.ReactNode;
}) {
  const { pick } = useT();
  return (
    <div style={S.card}>
      <div style={{ ...S.row, marginBottom: 10 }}>
        <span style={{ color: '#f0f4ff', fontWeight: 700, fontSize: 15 }}>{p.nome}</span>
        <StatusBadge status={p.status} />
        <span style={S.badge('#334155')}>{p.cargo}</span>
        <span style={S.badge('#1e3a5f')}>{p.cidade}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={S.label}>{pick(T.periodo)}</div>
          <div style={S.value}>{fmtSemana(p.semana_inicio, p.semana_fim)}</div>
        </div>
        <div>
          <div style={S.label}>{pick(T.tarefas)}</div>
          <div style={S.value}>{p.tarefas_count}</div>
        </div>
        <div>
          <div style={S.label}>{pick(T.valorUnitario)}</div>
          <div style={S.value}>R$ {p.valor_unitario?.toFixed(2)}</div>
        </div>
        <div>
          <div style={S.label}>{pick(T.valorTotal)}</div>
          <div style={{ ...S.value, color: '#4ade80', fontWeight: 700 }}>R$ {p.valor_total?.toFixed(2)}</div>
        </div>
      </div>
      <div style={{ ...S.row, flexWrap: 'wrap' as const }}>{acoes}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telegram helper
// ---------------------------------------------------------------------------

function chamarNotificarStatusNF(params: {
  uid: string;
  status: 'nf_aprovada' | 'rejeitada' | 'pago';
  valorTotal?: number;
  motivo?: string;
  semana?: string;
}) {
  const fns = getFunctions(undefined, 'southamerica-east1');
  const fn = httpsCallable(fns, 'notificarStatusNF');
  fn(params).catch(() => {});
}

// ---------------------------------------------------------------------------
// Aba NFs Pendentes
// ---------------------------------------------------------------------------

function AbaNFsPendentes({
  usuario,
}: {
  usuario: Props['usuario'];
}) {
  const { pick } = useT();
  const [lista, setLista] = useState<PagamentoSemana[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejeitandoId, setRejeitandoId] = useState<string | null>(null);
  const [motivoMap, setMotivoMap] = useState<Record<string, string>>({});
  const [processando, setProcessando] = useState<string | null>(null);

  const cidadesPermitidas: string[] | null =
    usuario.role === 'admin'
      ? null
      : usuario.cidadesPermitidas?.length
      ? usuario.cidadesPermitidas
      : usuario.cidade
      ? [usuario.cidade]
      : null;

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'pagamentos_semana'),
        where('status', '==', 'nf_enviada'),
        orderBy('nf_enviada_em', 'desc')
      );
      const snap = await getDocs(q);
      let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PagamentoSemana));
      if (cidadesPermitidas) {
        docs = docs.filter((d) => cidadesPermitidas.includes(d.cidade));
      }
      setLista(docs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const aprovar = async (p: PagamentoSemana) => {
    setProcessando(p.id);
    try {
      await updateDoc(doc(db, 'pagamentos_semana', p.id), {
        status: 'nf_aprovada',
        nf_validada_por: usuario.nome,
        nf_validada_em: serverTimestamp(),
      });
      // dual-write Supabase
      supabase.from('pagamentos_semana').update({
        status: 'nf_aprovada',
        nf_validada_por: usuario.nome,
        nf_validada_em: new Date().toISOString(),
      }).eq('id', p.id).then(({ error }) => { if (error) console.error('[PagAdmin] update pagamentos_semana aprovar:', error.message); });
      chamarNotificarStatusNF({
        uid: p.uid,
        status: 'nf_aprovada',
        valorTotal: p.valor_total,
        semana: `${p.semana_iso}/${p.ano}`,
      });
      await carregar();
    } finally {
      setProcessando(null);
    }
  };

  const rejeitar = async (p: PagamentoSemana) => {
    const motivo = motivoMap[p.id] ?? '';
    if (!motivo.trim()) return;
    setProcessando(p.id);
    try {
      await updateDoc(doc(db, 'pagamentos_semana', p.id), {
        status: 'rejeitada',
        motivo_rejeicao: motivo,
        nf_validada_por: usuario.nome,
        nf_validada_em: serverTimestamp(),
      });
      // dual-write Supabase
      supabase.from('pagamentos_semana').update({
        status: 'rejeitada',
        motivo_rejeicao: motivo,
        nf_validada_por: usuario.nome,
        nf_validada_em: new Date().toISOString(),
      }).eq('id', p.id).then(({ error }) => { if (error) console.error('[PagAdmin] update pagamentos_semana rejeitar:', error.message); });
      chamarNotificarStatusNF({
        uid: p.uid,
        status: 'rejeitada',
        motivo,
        semana: `${p.semana_iso}/${p.ano}`,
      });
      setRejeitandoId(null);
      await carregar();
    } finally {
      setProcessando(null);
    }
  };

  if (loading) return <div style={S.emptyMsg}>{pick(T.carregando)}</div>;
  if (!lista.length) return <div style={S.emptyMsg}>{pick(T.nfsVazio)}</div>;

  return (
    <>
      {lista.map((p) => (
        <CardPagamento
          key={p.id}
          p={p}
          acoes={
            <>
              {p.nf_url && (
                <button
                  style={S.btn('#334155')}
                  onClick={() => window.open(p.nf_url!, '_blank')}
                >
                  {pick(T.verNf)}
                </button>
              )}
              <button
                style={S.btn('#059669')}
                disabled={processando === p.id}
                onClick={() => aprovar(p)}
              >
                {pick(T.aprovarNf)}
              </button>
              {rejeitandoId !== p.id ? (
                <button
                  style={S.btn('#ef4444')}
                  onClick={() => setRejeitandoId(p.id)}
                >
                  {pick(T.rejeitar)}
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260 }}>
                  <input
                    style={{ ...S.input, flex: 1 }}
                    placeholder={pick(T.motivoRejeicao)}
                    value={motivoMap[p.id] ?? ''}
                    onChange={(e) => setMotivoMap((m) => ({ ...m, [p.id]: e.target.value }))}
                  />
                  <button
                    style={S.btn('#ef4444')}
                    disabled={processando === p.id}
                    onClick={() => rejeitar(p)}
                  >
                    {pick(T.confirmar)}
                  </button>
                  <button
                    style={S.btn('#334155')}
                    onClick={() => setRejeitandoId(null)}
                  >
                    {pick(T.cancelar)}
                  </button>
                </div>
              )}
            </>
          }
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Pagamentos
// ---------------------------------------------------------------------------

function AbaPagamentos({ usuario }: { usuario: Props['usuario'] }) {
  const { pick } = useT();
  const [aprovados, setAprovados] = useState<PagamentoSemana[]>([]);
  const [pagos, setPagos] = useState<PagamentoSemana[]>([]);
  const [loading, setLoading] = useState(true);
  const [subAba, setSubAba] = useState<'pendentes' | 'historico'>('pendentes');
  const [processando, setProcessando] = useState<string | null>(null);
  const [filtroSemana, setFiltroSemana] = useState('');

  const cidadesPermitidas: string[] | null =
    usuario.role === 'admin'
      ? null
      : usuario.cidadesPermitidas?.length
      ? usuario.cidadesPermitidas
      : usuario.cidade
      ? [usuario.cidade]
      : null;

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [snapAprov, snapPagos] = await Promise.all([
        getDocs(
          query(
            collection(db, 'pagamentos_semana'),
            where('status', '==', 'nf_aprovada'),
            orderBy('nf_validada_em', 'desc')
          )
        ),
        getDocs(
          query(
            collection(db, 'pagamentos_semana'),
            where('status', '==', 'pago'),
            orderBy('pago_em', 'desc'),
            limit(30)
          )
        ),
      ]);

      let docsAprov = snapAprov.docs.map((d) => ({ id: d.id, ...d.data() } as PagamentoSemana));
      let docsPagos = snapPagos.docs.map((d) => ({ id: d.id, ...d.data() } as PagamentoSemana));

      if (cidadesPermitidas) {
        docsAprov = docsAprov.filter((d) => cidadesPermitidas.includes(d.cidade));
        docsPagos = docsPagos.filter((d) => cidadesPermitidas.includes(d.cidade));
      }

      setAprovados(docsAprov);
      setPagos(docsPagos);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const marcarPago = async (p: PagamentoSemana) => {
    setProcessando(p.id);
    try {
      await updateDoc(doc(db, 'pagamentos_semana', p.id), {
        status: 'pago',
        pago_em: serverTimestamp(),
      });
      // dual-write Supabase
      supabase.from('pagamentos_semana').update({
        status: 'pago',
        pago_em: new Date().toISOString(),
      }).eq('id', p.id).then(({ error }) => { if (error) console.error('[PagAdmin] update pagamentos_semana pago:', error.message); });
      chamarNotificarStatusNF({
        uid: p.uid,
        status: 'pago',
        valorTotal: p.valor_total,
        semana: `${p.semana_iso}/${p.ano}`,
      });
      await carregar();
    } finally {
      setProcessando(null);
    }
  };

  const exportCSV = (lista: PagamentoSemana[], nomeArquivo: string) => {
    const fmtTs = (ts: any) => { if (!ts) return ''; const d = ts?.toDate?.() ?? new Date(ts); return d.toLocaleDateString('pt-BR'); };
    const H: Record<string, Tr> = {
      nome: { pt: 'Nome', en: 'Name', es: 'Nombre', ru: 'Имя' },
      email: { pt: 'Email', en: 'Email', es: 'Correo', ru: 'Эл. почта' },
      cidade: { pt: 'Cidade', en: 'City', es: 'Ciudad', ru: 'Город' },
      cargo: { pt: 'Cargo', en: 'Role', es: 'Cargo', ru: 'Должность' },
      semana: { pt: 'Semana', en: 'Week', es: 'Semana', ru: 'Неделя' },
      ano: { pt: 'Ano', en: 'Year', es: 'Año', ru: 'Год' },
      tarefas: { pt: 'Tarefas', en: 'Tasks', es: 'Tareas', ru: 'Задачи' },
      valorUnit: { pt: 'Valor Unit.', en: 'Unit Value', es: 'Valor Unit.', ru: 'Цена за ед.' },
      valorTotal: { pt: 'Valor Total', en: 'Total Value', es: 'Valor Total', ru: 'Итоговая сумма' },
      status: { pt: 'Status', en: 'Status', es: 'Estado', ru: 'Статус' },
      nfEnviadaEm: { pt: 'NF enviada em', en: 'Invoice sent on', es: 'Factura enviada el', ru: 'Счёт отправлен' },
      nfValidadaEm: { pt: 'NF validada em', en: 'Invoice validated on', es: 'Factura validada el', ru: 'Счёт проверен' },
      pagoEm: { pt: 'Pago em', en: 'Paid on', es: 'Pagado el', ru: 'Оплачено' },
    };
    const h = [H.nome,H.email,H.cidade,H.cargo,H.semana,H.ano,H.tarefas,H.valorUnit,H.valorTotal,H.status,H.nfEnviadaEm,H.nfValidadaEm,H.pagoEm].map(pick);
    const rows = lista.map(p => [
      p.nome, p.email, p.cidade, p.cargo,
      p.semana_iso, p.ano, p.tarefas_count,
      p.valor_unitario?.toFixed(2), p.valor_total?.toFixed(2),
      p.status,
      fmtTs(p.nf_enviada_em), fmtTs(p.nf_validada_em), fmtTs(p.pago_em),
    ].map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }).join(','));
    const csv = '﻿' + [h.join(','), ...rows].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = nomeArquivo;
    a.click();
  };

  const subtotal = aprovados.reduce((s, p) => s + (p.valor_total ?? 0), 0);

  const pagosFiltrados = filtroSemana
    ? pagos.filter((p) => String(p.semana_iso).includes(filtroSemana) || String(p.ano).includes(filtroSemana))
    : pagos;

  if (loading) return <div style={S.emptyMsg}>{pick(T.carregando)}</div>;

  return (
    <>
      {/* Sub-abas */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['pendentes', 'historico'] as const).map((a) => (
          <button
            key={a}
            style={{
              ...S.btn(subAba === a ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.03)', '#dce6ff'),
              border: '1px solid rgba(255,255,255,.10)',
              fontSize: 12,
            }}
            onClick={() => setSubAba(a)}
          >
            {a === 'pendentes' ? `${pick(T.subPendentes)} (${aprovados.length})` : pick(T.subHistorico)}
          </button>
        ))}
      </div>

      {subAba === 'pendentes' && (
        <>
          {aprovados.length > 0 && (
            <div style={{ ...S.subtotal, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>{pick(T.totalAPagar)}: R$ {subtotal.toFixed(2)} ({aprovados.length} {aprovados.length !== 1 ? pick(T.registros) : pick(T.registro)})</span>
              <button style={{ ...S.btn('rgba(255,255,255,.08)', '#dce6ff'), fontSize: 11, padding: '6px 12px' }}
                onClick={() => exportCSV(aprovados, `pagamentos_a_pagar_${new Date().toISOString().slice(0,10)}.csv`)}>
                {pick(T.exportarCsv)}
              </button>
            </div>
          )}
          {aprovados.length === 0 ? (
            <div style={S.emptyMsg}>{pick(T.pagamentosVazio)}</div>
          ) : (
            aprovados.map((p) => (
              <CardPagamento
                key={p.id}
                p={p}
                acoes={
                  <button
                    style={S.btn('#1a6fd4')}
                    disabled={processando === p.id}
                    onClick={() => marcarPago(p)}
                  >
                    {pick(T.marcarPago)}
                  </button>
                }
              />
            ))
          )}
        </>
      )}

      {subAba === 'historico' && (
        <>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              style={{ ...S.input, maxWidth: 260 }}
              placeholder={pick(T.filtrarSemanaAno)}
              value={filtroSemana}
              onChange={(e) => setFiltroSemana(e.target.value)}
            />
            {pagosFiltrados.length > 0 && (
              <button style={{ ...S.btn('rgba(255,255,255,.08)', '#dce6ff'), fontSize: 11, padding: '6px 12px' }}
                onClick={() => exportCSV(pagosFiltrados, `historico_pagamentos_${new Date().toISOString().slice(0,10)}.csv`)}>
                {pick(T.exportarCsv)}
              </button>
            )}
          </div>
          {pagosFiltrados.length === 0 ? (
            <div style={S.emptyMsg}>{pick(T.historicoVazio)}</div>
          ) : (
            pagosFiltrados.map((p) => (
              <CardPagamento key={p.id} p={p} acoes={null} />
            ))
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Configuração
// ---------------------------------------------------------------------------

function AbaConfiguracao({ usuario }: { usuario: Props['usuario'] }) {
  const { pick } = useT();
  const [configs, setConfigs] = useState<PagamentoConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [novasCidades, setNovasCidades] = useState<{ nome: string; valor: string }[]>([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [snapConfig, snapEstacoes] = await Promise.all([
        getDocs(collection(db, 'pagamentos_config')),
        getDocs(collection(db, 'estacoes')),
      ]);

      const configMap: Record<string, PagamentoConfig> = {};
      snapConfig.docs.forEach((d) => {
        configMap[d.id] = { cidade: d.id, moeda: 'BRL', ativo: true, ...d.data() } as PagamentoConfig;
      });

      // fallback: cidades das estações não configuradas
      const cidadesEstacoes = new Set<string>();
      snapEstacoes.docs.forEach((d) => {
        const cidade = d.data().cidade;
        if (cidade) cidadesEstacoes.add(cidade);
      });
      cidadesEstacoes.forEach((c) => {
        if (!configMap[c]) {
          configMap[c] = { cidade: c, valor_por_tarefa: 0, moeda: 'BRL', ativo: true };
        }
      });

      setConfigs(Object.values(configMap).sort((a, b) => a.cidade.localeCompare(b.cidade)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (cidade: string) => {
    const valor = parseFloat(editando[cidade] ?? '0');
    if (isNaN(valor)) return;
    setSalvando(cidade);
    try {
      await setDoc(
        doc(db, 'pagamentos_config', cidade),
        { valor_por_tarefa: valor, moeda: 'BRL', ativo: true },
        { merge: true }
      );
      // dual-write Supabase
      supabase.from('pagamentos_config').upsert({
        id: cidade, valor_por_tarefa: valor, moeda: 'BRL', ativo: true,
      }, { onConflict: 'id' }).then(({ error }) => { if (error) console.error('[PagAdmin] upsert pagamentos_config:', error.message); });
      setEditando((e) => { const n = { ...e }; delete n[cidade]; return n; });
      await carregar();
    } finally {
      setSalvando(null);
    }
  };

  const adicionarCidade = async (idx: number) => {
    const { nome, valor } = novasCidades[idx];
    if (!nome.trim() || !valor) return;
    setSalvando(`nova_${idx}`);
    try {
      await setDoc(
        doc(db, 'pagamentos_config', nome.trim()),
        { valor_por_tarefa: parseFloat(valor), moeda: 'BRL', ativo: true },
        { merge: true }
      );
      // dual-write Supabase
      supabase.from('pagamentos_config').upsert({
        id: nome.trim(), valor_por_tarefa: parseFloat(valor), moeda: 'BRL', ativo: true,
      }, { onConflict: 'id' }).then(({ error }) => { if (error) console.error('[PagAdmin] upsert pagamentos_config nova:', error.message); });
      setNovasCidades((arr) => arr.filter((_, i) => i !== idx));
      await carregar();
    } finally {
      setSalvando(null);
    }
  };

  if (loading) return <div style={S.emptyMsg}>{pick(T.configCarregando)}</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#8896b3', fontSize: 13 }}>{pick(T.valorPorTarefaCidade)}</span>
        <button
          style={S.btn('#1a6fd4')}
          onClick={() => setNovasCidades((arr) => [...arr, { nome: '', valor: '' }])}
        >
          {pick(T.novaCidade)}
        </button>
      </div>

      {novasCidades.map((nc, idx) => (
        <div key={idx} style={{ ...S.card, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder={pick(T.nomeCidade)}
            value={nc.nome}
            onChange={(e) =>
              setNovasCidades((arr) =>
                arr.map((x, i) => (i === idx ? { ...x, nome: e.target.value } : x))
              )
            }
          />
          <input
            style={{ ...S.input, width: 110 }}
            type="number"
            step="0.50"
            min="0"
            placeholder={pick(T.valorMoeda)}
            value={nc.valor}
            onChange={(e) =>
              setNovasCidades((arr) =>
                arr.map((x, i) => (i === idx ? { ...x, valor: e.target.value } : x))
              )
            }
          />
          <button
            style={S.btn('#059669')}
            disabled={salvando === `nova_${idx}`}
            onClick={() => adicionarCidade(idx)}
          >
            {pick(T.salvar)}
          </button>
          <button
            style={S.btn('#334155')}
            onClick={() => setNovasCidades((arr) => arr.filter((_, i) => i !== idx))}
          >
            {pick(T.cancelar)}
          </button>
        </div>
      ))}

      {configs.map((c) => (
        <div key={c.cidade} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const }}>
          <span style={{ color: '#dce6ff', fontWeight: 600, flex: 1, minWidth: 120 }}>{c.cidade}</span>
          {editando[c.cidade] !== undefined ? (
            <>
              <input
                style={{ ...S.input, width: 130 }}
                type="number"
                step="0.50"
                min="0"
                value={editando[c.cidade]}
                onChange={(e) => setEditando((ed) => ({ ...ed, [c.cidade]: e.target.value }))}
                autoFocus
              />
              <button
                style={S.btn('#059669')}
                disabled={salvando === c.cidade}
                onClick={() => salvar(c.cidade)}
              >
                {salvando === c.cidade ? pick(T.salvando) : pick(T.salvar)}
              </button>
              <button
                style={S.btn('#334155')}
                onClick={() => setEditando((e) => { const n = { ...e }; delete n[c.cidade]; return n; })}
              >
                {pick(T.cancelar)}
              </button>
            </>
          ) : (
            <>
              <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 15 }}>
                R$ {c.valor_por_tarefa?.toFixed(2) ?? '0,00'} {pick(T.porTarefa)}
              </span>
              <button
                style={S.btn('#334155')}
                onClick={() => setEditando((e) => ({ ...e, [c.cidade]: String(c.valor_por_tarefa ?? 0) }))}
              >
                {pick(T.editar)}
              </button>
            </>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PagamentosAdminPanel({ usuario, onFechar }: Props) {
  const { pick } = useT();
  const [aba, setAba] = useState<Aba>('nfs');

  const podeConfig =
    usuario.role === 'admin' ||
    usuario.role === 'supergestor' ||
    usuario.role === 'gestor';

  const ABAS: { key: Aba; label: string; visivel: boolean }[] = [
    { key: 'nfs', label: pick(T.abaNfs), visivel: true },
    { key: 'pagamentos', label: pick(T.abaPagamentos), visivel: true },
    { key: 'config', label: pick(T.abaConfig), visivel: podeConfig },
  ];

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div style={S.panel}>
        {/* Header */}
        <div style={S.header}>
          <h2 style={S.title}>{pick(T.titulo)}</h2>
          <button style={S.closeBtn} onClick={onFechar} aria-label={pick(T.fechar)}>
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {ABAS.filter((a) => a.visivel).map((a) => (
            <button key={a.key} style={S.tab(aba === a.key)} onClick={() => setAba(a.key)}>
              {a.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={S.body}>
          {aba === 'nfs' && <AbaNFsPendentes usuario={usuario} />}
          {aba === 'pagamentos' && <AbaPagamentos usuario={usuario} />}
          {aba === 'config' && podeConfig && <AbaConfiguracao usuario={usuario} />}
        </div>
      </div>
    </div>
  );
}
