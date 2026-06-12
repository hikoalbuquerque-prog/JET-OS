import React, { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uploadComRetry } from '../lib/uploadUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  usuario: {
    uid: string;
    nome: string;
    email: string;
    role: string;
    cargoPrestador?: string;
    cidade?: string;
    tipoCadastro?: string;
  };
  onFechar: () => void;
}

type StatusPagamento = 'aberto' | 'nf_enviada' | 'nf_aprovada' | 'rejeitada' | 'pago';

interface PagamentoSemana {
  id: string;
  uid: string;
  nome: string;
  email: string;
  cidade: string;
  cargo: string;
  semana_inicio: Timestamp;
  semana_fim: Timestamp;
  ano: number;
  semana_iso: number;
  tarefas_count: number;
  valor_unitario: number;
  valor_total: number;
  status: StatusPagamento;
  nf_url: string | null;
  nf_enviada_em: Timestamp | null;
  nf_validada_por: string | null;
  motivo_rejeicao: string | null;
  pago_em: Timestamp | null;
  criadoEm: Timestamp;
  atualizadoEm: Timestamp;
}

interface TarefaLogistica {
  id: string;
  titulo: string;
  concluidoEm: Timestamp;
}

interface ISOWeekInfo {
  ano: number;
  semana: number;
  inicio: Date;
  fim: Date;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getISOWeekInfo(date: Date): ISOWeekInfo {
  // Monday of the current week
  const dayOfWeek = date.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const diffToMonday = (dayOfWeek + 6) % 7;
  const inicio = new Date(date);
  inicio.setDate(date.getDate() - diffToMonday);
  inicio.setHours(0, 0, 0, 0);

  // Sunday (end of week)
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + 6);
  fim.setHours(23, 59, 59, 999);

  // ISO week number
  const thursday = new Date(inicio);
  thursday.setDate(inicio.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const weekNumber =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7
    );

  return { ano: thursday.getFullYear(), semana: weekNumber, inicio, fim };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatDateFull(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timestampToDate(ts: Timestamp): Date {
  return ts.toDate();
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<StatusPagamento, { label: string; bg: string; color: string }> = {
  aberto:      { label: 'Aberto',                         bg: 'rgba(255,255,255,.08)', color: '#94a3b8' },
  nf_enviada:  { label: 'NF em análise',                  bg: 'rgba(251,191,36,.15)',  color: '#fbbf24' },
  nf_aprovada: { label: 'NF aprovada – aguardando pagamento', bg: 'rgba(96,165,250,.15)', color: '#60a5fa' },
  rejeitada:   { label: 'NF rejeitada',                   bg: 'rgba(239,68,68,.15)',   color: '#ef4444' },
  pago:        { label: 'Pago ✓',                         bg: 'rgba(74,222,128,.15)',  color: '#4ade80' },
};

function StatusChip({ status }: { status: StatusPagamento }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.color}44`,
        letterSpacing: '.3px',
      }}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Upload NF button
// ---------------------------------------------------------------------------

interface UploadNFProps {
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
}

function UploadNFButton({ onUpload, uploading }: UploadNFProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await onUpload(file);
    // Reset so the same file can be re-selected if needed
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={uploading}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{
          padding: '8px 18px',
          borderRadius: 8,
          border: 'none',
          background: uploading ? 'rgba(96,165,250,.3)' : '#60a5fa',
          color: '#0d121e',
          fontWeight: 700,
          fontSize: 13,
          cursor: uploading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          transition: 'opacity .2s',
        }}
      >
        {uploading ? (
          <>
            <Spinner />
            Enviando NF...
          </>
        ) : (
          'Enviar Nota Fiscal'
        )}
      </button>
    </>
  );
}

function Spinner() {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        border: '2px solid rgba(13,18,30,.4)',
        borderTopColor: '#0d121e',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'jet-spin .7s linear infinite',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PagamentosModule({ usuario, onFechar }: Props) {
  const [aba, setAba] = useState<'atual' | 'historico'>('atual');

  // --- Semana atual state ---
  const [weekInfo, setWeekInfo] = useState<ISOWeekInfo | null>(null);
  const [tarefas, setTarefas] = useState<TarefaLogistica[]>([]);
  const [valorUnitario, setValorUnitario] = useState<number>(3.5);
  const [registroSemana, setRegistroSemana] = useState<PagamentoSemana | null>(null);
  const [loadingAtual, setLoadingAtual] = useState(true);
  const [errorAtual, setErrorAtual] = useState<string | null>(null);
  const [uploadingNF, setUploadingNF] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // --- Histórico state ---
  const [historico, setHistorico] = useState<PagamentoSemana[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [uploadingHistoricoId, setUploadingHistoricoId] = useState<string | null>(null);

  const cidade = usuario.cidade ?? 'default';
  const cargo = usuario.cargoPrestador ?? usuario.role ?? '';

  // ---------------------------------------------------------------------------
  // Load semana atual
  // ---------------------------------------------------------------------------

  const loadSemanaAtual = useCallback(async () => {
    setLoadingAtual(true);
    setErrorAtual(null);
    try {
      const info = getISOWeekInfo(new Date());
      setWeekInfo(info);

      const inicioTs = Timestamp.fromDate(info.inicio);
      const fimTs = Timestamp.fromDate(info.fim);

      // Tarefas concluídas na semana
      const tarefasQ = query(
        collection(db, 'tarefas_logistica'),
        where('assigneeUid', '==', usuario.uid),
        where('status', '==', 'concluida'),
        where('concluidoEm', '>=', inicioTs),
        where('concluidoEm', '<=', fimTs)
      );
      const tarefasSnap = await getDocs(tarefasQ);
      const tarefasList: TarefaLogistica[] = tarefasSnap.docs.map((d) => ({
        id: d.id,
        titulo: d.data().titulo ?? '(sem título)',
        concluidoEm: d.data().concluidoEm,
      }));
      setTarefas(tarefasList);

      // Configuração de pagamento da cidade
      const configRef = doc(db, 'pagamentos_config', cidade);
      const configSnap = await getDoc(configRef);
      const valorUni =
        configSnap.exists() && configSnap.data().ativo !== false
          ? (configSnap.data().valor_por_tarefa ?? 3.5)
          : 3.5;
      setValorUnitario(valorUni);

      // Registro da semana atual
      const semanaPadded = String(info.semana).padStart(2, '0');
      const docId = `${usuario.uid}_${info.ano}W${semanaPadded}`;
      const regRef = doc(db, 'pagamentos_semana', docId);
      const regSnap = await getDoc(regRef);
      if (regSnap.exists()) {
        setRegistroSemana({ id: regSnap.id, ...regSnap.data() } as PagamentoSemana);
      } else {
        setRegistroSemana(null);
      }
    } catch (e: any) {
      setErrorAtual(e?.message ?? 'Erro ao carregar dados');
    } finally {
      setLoadingAtual(false);
    }
  }, [usuario.uid, cidade]);

  useEffect(() => {
    loadSemanaAtual();
  }, [loadSemanaAtual]);

  // ---------------------------------------------------------------------------
  // Load histórico
  // ---------------------------------------------------------------------------

  const loadHistorico = useCallback(async () => {
    setLoadingHistorico(true);
    try {
      const q = query(
        collection(db, 'pagamentos_semana'),
        where('uid', '==', usuario.uid),
        orderBy('semana_inicio', 'desc'),
        limit(20)
      );
      const snap = await getDocs(q);
      setHistorico(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PagamentoSemana)));
    } catch {
      // silently ignore
    } finally {
      setLoadingHistorico(false);
    }
  }, [usuario.uid]);

  useEffect(() => {
    if (aba === 'historico') loadHistorico();
  }, [aba, loadHistorico]);

  // ---------------------------------------------------------------------------
  // Upload NF helper
  // ---------------------------------------------------------------------------

  const uploadNF = async (
    file: File,
    info: ISOWeekInfo,
    count: number,
    valorUni: number,
    docId: string,
    existingRegistro: PagamentoSemana | null
  ): Promise<void> => {
    const ext = file.name.split('.').pop() ?? 'pdf';
    const semanaPadded = String(info.semana).padStart(2, '0');
    const storagePath = `notas_fiscais/${usuario.uid}/${info.ano}W${semanaPadded}.${ext}`;
    const nfUrl = await uploadComRetry(file, storagePath);

    const regRef = doc(db, 'pagamentos_semana', docId);

    if (existingRegistro) {
      await updateDoc(regRef, {
        nf_url: nfUrl,
        nf_enviada_em: serverTimestamp(),
        status: 'nf_enviada',
        atualizadoEm: serverTimestamp(),
      });
    } else {
      const inicioTs = Timestamp.fromDate(info.inicio);
      const fimTs = Timestamp.fromDate(info.fim);
      await setDoc(regRef, {
        uid: usuario.uid,
        nome: usuario.nome,
        email: usuario.email,
        cidade,
        cargo,
        semana_inicio: inicioTs,
        semana_fim: fimTs,
        ano: info.ano,
        semana_iso: info.semana,
        tarefas_count: count,
        valor_unitario: valorUni,
        valor_total: count * valorUni,
        status: 'nf_enviada',
        nf_url: nfUrl,
        nf_enviada_em: serverTimestamp(),
        nf_validada_por: null,
        motivo_rejeicao: null,
        pago_em: null,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Handle upload – semana atual
  // ---------------------------------------------------------------------------

  const handleUploadAtual = async (file: File) => {
    if (!weekInfo) return;
    setUploadingNF(true);
    setUploadSuccess(false);
    try {
      const semanaPadded = String(weekInfo.semana).padStart(2, '0');
      const docId = `${usuario.uid}_${weekInfo.ano}W${semanaPadded}`;
      await uploadNF(file, weekInfo, tarefas.length, valorUnitario, docId, registroSemana);
      setUploadSuccess(true);
      await loadSemanaAtual();
    } catch (e: any) {
      alert('Erro ao enviar NF: ' + (e?.message ?? 'tente novamente'));
    } finally {
      setUploadingNF(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handle upload – histórico
  // ---------------------------------------------------------------------------

  const handleUploadHistorico = async (file: File, reg: PagamentoSemana) => {
    setUploadingHistoricoId(reg.id);
    try {
      const info: ISOWeekInfo = {
        ano: reg.ano,
        semana: reg.semana_iso,
        inicio: timestampToDate(reg.semana_inicio),
        fim: timestampToDate(reg.semana_fim),
      };
      await uploadNF(file, info, reg.tarefas_count, reg.valor_unitario, reg.id, reg);
      await loadHistorico();
    } catch (e: any) {
      alert('Erro ao enviar NF: ' + (e?.message ?? 'tente novamente'));
    } finally {
      setUploadingHistoricoId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived: is current week closed?
  // ---------------------------------------------------------------------------

  const semanaEncerrada = weekInfo ? new Date() > weekInfo.fim : false;
  const podeEnviarNFAtual =
    semanaEncerrada &&
    (!registroSemana || registroSemana.status === 'aberto' || registroSemana.status === 'rejeitada');

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const cardStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 12,
    padding: '16px 20px',
    marginBottom: 12,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '.8px',
    marginBottom: 4,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 22,
    fontWeight: 700,
    color: '#e2e8f0',
  };

  // ---------------------------------------------------------------------------
  // Aba Semana Atual
  // ---------------------------------------------------------------------------

  const renderSemanaAtual = () => {
    if (loadingAtual) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
          <Spinner /> Carregando...
        </div>
      );
    }
    if (errorAtual) {
      return (
        <div style={{ color: '#ef4444', padding: '20px 0', fontSize: 14 }}>
          Erro: {errorAtual}
          <button
            onClick={loadSemanaAtual}
            style={{ marginLeft: 12, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    if (!weekInfo) return null;

    const valorTotal = tarefas.length * valorUnitario;

    return (
      <div>
        {/* Period */}
        <div style={cardStyle}>
          <div style={labelStyle}>Período</div>
          <div style={{ fontSize: 15, color: '#cbd5e1', fontWeight: 600 }}>
            Seg {formatDate(weekInfo.inicio)} – Dom {formatDateFull(weekInfo.fim)}
          </div>
          {!semanaEncerrada && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              Semana ainda em andamento — o envio de NF será liberado ao encerrar.
            </div>
          )}
        </div>

        {/* Tasks count */}
        <div style={cardStyle}>
          <div style={labelStyle}>Tarefas concluídas esta semana</div>
          <div style={valueStyle}>{tarefas.length}</div>
          {tarefas.length > 0 && (
            <ul
              style={{
                marginTop: 12,
                paddingLeft: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {tarefas.map((t) => (
                <li
                  key={t.id}
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ color: '#4ade80', fontSize: 10 }}>●</span>
                  {t.titulo}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
                    {t.concluidoEm ? formatDateFull(timestampToDate(t.concluidoEm)) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Estimated value */}
        <div style={cardStyle}>
          <div style={labelStyle}>Valor estimado</div>
          <div style={valueStyle}>R$ {formatCurrency(valorTotal)}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            {tarefas.length} × R$ {formatCurrency(valorUnitario)} por tarefa
          </div>
        </div>

        {/* NF status / upload */}
        {registroSemana && registroSemana.status !== 'aberto' ? (
          <div style={{ ...cardStyle, borderColor: STATUS_CONFIG[registroSemana.status].color + '44' }}>
            <div style={labelStyle}>Status do pagamento</div>
            <div style={{ marginBottom: 10 }}>
              <StatusChip status={registroSemana.status} />
            </div>
            {registroSemana.status === 'pago' && registroSemana.pago_em && (
              <div style={{ fontSize: 13, color: '#4ade80' }}>
                Pago em {formatDateFull(timestampToDate(registroSemana.pago_em))}
              </div>
            )}
            {registroSemana.status === 'rejeitada' && registroSemana.motivo_rejeicao && (
              <div style={{ fontSize: 13, color: '#ef4444', marginTop: 4 }}>
                Motivo: {registroSemana.motivo_rejeicao}
              </div>
            )}
            {registroSemana.nf_url && (
              <a
                href={registroSemana.nf_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#60a5fa', marginTop: 8, display: 'inline-block' }}
              >
                Ver NF enviada ↗
              </a>
            )}
            {registroSemana.status === 'rejeitada' && (
              <div style={{ marginTop: 12 }}>
                <UploadNFButton onUpload={handleUploadAtual} uploading={uploadingNF} />
              </div>
            )}
          </div>
        ) : podeEnviarNFAtual ? (
          <div style={cardStyle}>
            <div style={labelStyle}>Nota Fiscal</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
              Semana encerrada. Envie sua Nota Fiscal para receber o pagamento.
            </div>
            {uploadSuccess && (
              <div style={{ fontSize: 13, color: '#4ade80', marginBottom: 10 }}>
                NF enviada com sucesso!
              </div>
            )}
            <UploadNFButton onUpload={handleUploadAtual} uploading={uploadingNF} />
          </div>
        ) : null}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Aba Histórico
  // ---------------------------------------------------------------------------

  const renderHistorico = () => {
    if (loadingHistorico) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
          <Spinner /> Carregando histórico...
        </div>
      );
    }
    if (historico.length === 0) {
      return (
        <div style={{ color: '#64748b', fontSize: 14, padding: '20px 0' }}>
          Nenhum registro encontrado.
        </div>
      );
    }

    return (
      <div>
        {historico.map((reg) => {
          const inicio = timestampToDate(reg.semana_inicio);
          const fim = timestampToDate(reg.semana_fim);
          const encerrada = new Date() > fim;
          const podeEnviar =
            encerrada &&
            (reg.status === 'aberto' || reg.status === 'rejeitada') &&
            !reg.nf_url;

          return (
            <div key={reg.id} style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                    Seg {formatDate(inicio)} – Dom {formatDateFull(fim)}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Semana {reg.semana_iso}/{reg.ano}
                  </div>
                </div>
                <StatusChip status={reg.status} />
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  fontSize: 13,
                  color: '#94a3b8',
                  marginBottom: 10,
                }}
              >
                <span>
                  <span style={{ color: '#64748b', fontSize: 11 }}>TAREFAS </span>
                  <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{reg.tarefas_count}</span>
                </span>
                <span>
                  <span style={{ color: '#64748b', fontSize: 11 }}>VALOR </span>
                  <span style={{ fontWeight: 700, color: '#4ade80' }}>R$ {formatCurrency(reg.valor_total)}</span>
                </span>
              </div>

              {reg.status === 'pago' && reg.pago_em && (
                <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 8 }}>
                  Pago em {formatDateFull(timestampToDate(reg.pago_em))}
                </div>
              )}
              {reg.status === 'rejeitada' && reg.motivo_rejeicao && (
                <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>
                  Motivo rejeição: {reg.motivo_rejeicao}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {reg.nf_url && (
                  <a
                    href={reg.nf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: '#60a5fa' }}
                  >
                    Ver NF ↗
                  </a>
                )}
                {podeEnviar && (
                  <UploadNFButton
                    onUpload={(file) => handleUploadHistorico(file, reg)}
                    uploading={uploadingHistoricoId === reg.id}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Keyframes injection */}
      <style>{`
        @keyframes jet-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onFechar}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.6)',
          zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1001,
          width: 'min(96vw, 540px)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#0d121e',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,.09)',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid rgba(255,255,255,.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Meus Pagamentos</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {usuario.nome} · {cidade}
            </div>
          </div>
          <button
            onClick={onFechar}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: 22,
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0 4px',
            }}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,.07)',
            flexShrink: 0,
          }}
        >
          {(['atual', 'historico'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setAba(tab)}
              style={{
                flex: 1,
                padding: '11px 0',
                background: 'none',
                border: 'none',
                borderBottom: aba === tab ? '2px solid #60a5fa' : '2px solid transparent',
                color: aba === tab ? '#60a5fa' : '#64748b',
                fontWeight: aba === tab ? 700 : 400,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'color .15s',
              }}
            >
              {tab === 'atual' ? 'Semana Atual' : 'Histórico'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px', flex: 1 }}>
          {aba === 'atual' ? renderSemanaAtual() : renderHistorico()}
        </div>
      </div>
    </>
  );
}
