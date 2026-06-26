// frontend/src/components/BugReportsPanel.tsx
// Painel de gestão dos reports de bug/erro (admin/gestor). Lê bug_reports em tempo
// real, filtra por status e permite marcar como resolvido. RLS no firestore.rules.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, orderBy, limit, onSnapshot, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

const T = {
  titulo: { pt: '🐞 Reports de bug/erro', en: '🐞 Bug/error reports', es: '🐞 Reportes de bug/error', ru: '🐞 Отчёты об ошибках' },
  fechar: { pt: 'Fechar', en: 'Close', es: 'Cerrar', ru: 'Закрыть' },
  semReports: { pt: 'Nenhum report', en: 'No reports', es: 'Ningún reporte', ru: 'Нет отчётов' },
  marcarResolvido: { pt: '✓ Marcar resolvido', en: '✓ Mark resolved', es: '✓ Marcar resuelto', ru: '✓ Отметить решённым' },
  reabrir: { pt: '↩ Reabrir', en: '↩ Reopen', es: '↩ Reabrir', ru: '↩ Открыть снова' },
  erroPadrao: { pt: 'Erro', en: 'Error', es: 'Error', ru: 'Ошибка' },
};

const FILTRO_LABEL = {
  aberto: { pt: 'aberto', en: 'open', es: 'abierto', ru: 'открытые' },
  resolvido: { pt: 'resolvido', en: 'resolved', es: 'resuelto', ru: 'решённые' },
  todos: { pt: 'todos', en: 'all', es: 'todos', ru: 'все' },
};

const STATUS_LABEL: Record<string, { pt: string; en: string; es: string; ru: string }> = {
  aberto: { pt: 'aberto', en: 'open', es: 'abierto', ru: 'открыт' },
  resolvido: { pt: 'resolvido', en: 'resolved', es: 'resuelto', ru: 'решён' },
};

interface Report {
  id: string;
  tipo: 'manual' | 'auto';
  descricao: string;
  fotoUrl?: string | null;
  erro?: { mensagem?: string; stack?: string; origem?: string } | null;
  status: string;
  nome?: string; email?: string; role?: string;
  contexto?: Record<string, any>;
  criadoEmTs?: number;
}

const fmt = (ts?: number) => ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

export default function BugReportsPanel({ onFechar }: { onFechar: () => void }) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const resumo = (nAbertos: number, total: number) => ({
    pt: `${nAbertos} aberto(s) · ${total} no total`,
    en: `${nAbertos} open · ${total} total`,
    es: `${nAbertos} abierto(s) · ${total} en total`,
    ru: `${nAbertos} открыт. · ${total} всего`,
  }[lang]);

  const [reports, setReports] = useState<Report[]>([]);
  const [filtro, setFiltro] = useState<'aberto' | 'resolvido' | 'todos'>('aberto');
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'bug_reports'), orderBy('criadoEmTs', 'desc'), limit(150));
    return onSnapshot(q, snap => {
      setReports(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }, []);

  const resolver = async (id: string, novo: string) => {
    await updateDoc(doc(db, 'bug_reports', id), { status: novo, resolvidoEm: serverTimestamp() });
  };

  const visiveis = reports.filter(r => filtro === 'todos' ? true : (r.status || 'aberto') === filtro);
  const nAbertos = reports.filter(r => (r.status || 'aberto') === 'aberto').length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.7)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px 14px', overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onFechar()}>
      <div style={{ width: '100%', maxWidth: 640, background: '#0d1521', borderRadius: 16,
        border: '1px solid rgba(255,255,255,.1)', maxHeight: 'calc(100vh - 40px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter,sans-serif' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#dce8ff' }}>{pick(T.titulo)}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
              {resumo(nAbertos, reports.length)}
            </div>
          </div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
            fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
          {(['aberto', 'resolvido', 'todos'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)} style={{
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, textTransform: 'capitalize',
              background: filtro === f ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${filtro === f ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.08)'}`,
              color: filtro === f ? '#60a5fa' : 'rgba(255,255,255,.5)', fontWeight: filtro === f ? 700 : 400 }}>
              {pick(FILTRO_LABEL[f])}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {visiveis.length === 0 && (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.3)', fontSize: 13, padding: '32px 0' }}>
              {pick(T.semReports)} {filtro !== 'todos' ? `(${pick(FILTRO_LABEL[filtro])})` : ''}.
            </div>
          )}
          {visiveis.map(r => {
            const exp = aberto === r.id;
            return (
              <div key={r.id} style={{ marginBottom: 8, borderRadius: 10,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
                <div onClick={() => setAberto(exp ? null : r.id)} style={{ padding: '10px 12px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{r.tipo === 'auto' ? '⚠️' : '✍️'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: '#dce8ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.tipo === 'auto' ? (r.erro?.mensagem || pick(T.erroPadrao)) : r.descricao}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>
                      {r.nome || r.email || '—'} · {r.role || '?'} · {fmt(r.criadoEmTs)}
                    </div>
                  </div>
                  <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20,
                    background: (r.status || 'aberto') === 'aberto' ? 'rgba(239,68,68,.18)' : 'rgba(34,197,94,.18)',
                    color: (r.status || 'aberto') === 'aberto' ? '#f87171' : '#4ade80' }}>
                    {pick(STATUS_LABEL[r.status || 'aberto'] ?? STATUS_LABEL.aberto)}
                  </span>
                </div>
                {exp && (
                  <div style={{ padding: '0 12px 12px', fontSize: 12, color: 'rgba(255,255,255,.6)', lineHeight: 1.5 }}>
                    {r.tipo === 'auto' && r.descricao !== '(erro automático)' && <p>{r.descricao}</p>}
                    {r.tipo === 'manual' && <p style={{ whiteSpace: 'pre-wrap' }}>{r.descricao}</p>}
                    {r.fotoUrl && (
                      <a href={r.fotoUrl} target="_blank" rel="noreferrer">
                        <img src={r.fotoUrl} alt="anexo" style={{ maxWidth: 160, borderRadius: 8, margin: '6px 0' }} />
                      </a>
                    )}
                    {r.erro && (
                      <pre style={{ background: 'rgba(0,0,0,.35)', padding: 8, borderRadius: 6, fontSize: 10.5,
                        overflowX: 'auto', color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
                        {r.erro.mensagem}{r.erro.origem ? `\n@ ${r.erro.origem}` : ''}{r.erro.stack ? `\n\n${r.erro.stack}` : ''}
                      </pre>
                    )}
                    {r.contexto && (
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
                        v{r.contexto.appVersao} · {r.contexto.plataforma} · {r.contexto.viewport} ·{' '}
                        <span style={{ wordBreak: 'break-all' }}>{r.contexto.url}</span>
                      </div>
                    )}
                    <div style={{ marginTop: 10 }}>
                      {(r.status || 'aberto') === 'aberto'
                        ? <button onClick={() => resolver(r.id, 'resolvido')} style={btn('#22c55e')}>{pick(T.marcarResolvido)}</button>
                        : <button onClick={() => resolver(r.id, 'aberto')} style={btn('#6b7280')}>{pick(T.reabrir)}</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const btn = (cor: string): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 8, border: `1px solid ${cor}55`,
  background: `${cor}1a`, color: cor, fontSize: 12, fontWeight: 700, cursor: 'pointer',
});
