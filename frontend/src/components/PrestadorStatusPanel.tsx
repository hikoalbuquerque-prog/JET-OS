// PrestadorStatusPanel — shows active/idle prestadores with time tracking
// Uses v_prestador_status view

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const T = {
  title:     { pt: '👷 Prestadores Ativos', en: '👷 Active Workers', es: '👷 Trabajadores Activos', ru: '👷 Активные работники' },
  emTarefa:  { pt: 'Em tarefa', en: 'On task', es: 'En tarea', ru: 'На задаче' },
  ocioso:    { pt: 'Ocioso', en: 'Idle', es: 'Inactivo', ru: 'Свободен' },
  semAcao:   { pt: 'Sem ação', en: 'No action', es: 'Sin acción', ru: 'Без действий' },
  min:       { pt: 'min', en: 'min', es: 'min', ru: 'мин' },
  hora:      { pt: 'h', en: 'h', es: 'h', ru: 'ч' },
  nenhum:    { pt: 'Nenhum prestador ativo', en: 'No active workers', es: 'Ningún trabajador activo', ru: 'Нет активных работников' },
  tarefa:    { pt: 'Tarefa', en: 'Task', es: 'Tarea', ru: 'Задача' },
  ultimaConc:{ pt: 'Última conclusão', en: 'Last completed', es: 'Última conclusión', ru: 'Последнее завершение' },
};
type Lang = 'pt' | 'en' | 'es' | 'ru';

interface PrestadorStatus {
  uid: string;
  nome: string;
  role: string;
  cidade: string;
  tarefa_ativa_id: string | null;
  tarefa_ativa_tipo: string | null;
  bike_id_atual: string | null;
  gojet_verified: boolean | null;
  minutos_na_tarefa: number | null;
  ultima_conclusao: string | null;
  minutos_ocioso: number | null;
  status_prestador: 'em_tarefa' | 'ocioso_curto' | 'ocioso_medio' | 'ocioso_longo' | 'sem_acao';
}

function fmtDuracao(min: number | null, pick: (o: Record<Lang, string>) => string): string {
  if (min == null) return '—';
  if (min < 60) return `${Math.round(min)}${pick(T.min)}`;
  return `${Math.floor(min / 60)}${pick(T.hora)}${Math.round(min % 60)}${pick(T.min)}`;
}

const STATUS_ICON: Record<string, string> = {
  em_tarefa: '🟢',
  ocioso_curto: '🟡',
  ocioso_medio: '🟠',
  ocioso_longo: '🔴',
  sem_acao: '⚫',
};

interface Props {
  cidade?: string;
}

export default function PrestadorStatusPanel({ cidade }: Props) {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;

  const [prestadores, setPrestadores] = useState<PrestadorStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    let q = supabase.from('v_prestador_status').select('*');
    if (cidade) q = q.eq('cidade', cidade);
    const { data } = await q.order('status_prestador');
    setPrestadores((data ?? []) as PrestadorStatus[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [cidade]);

  const emTarefa = prestadores.filter(p => p.status_prestador === 'em_tarefa');
  const ociosos = prestadores.filter(p => p.status_prestador !== 'em_tarefa' && p.status_prestador !== 'sem_acao');
  const semAcao = prestadores.filter(p => p.status_prestador === 'sem_acao');

  const S = {
    container: { background: '#0d1521', borderRadius: 10, padding: 14 } as React.CSSProperties,
    title: { fontSize: 13, fontWeight: 700, color: '#dce8ff', marginBottom: 10 } as React.CSSProperties,
    row: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.05)' } as React.CSSProperties,
    name: { flex: 1, fontSize: 12, fontWeight: 600, color: '#dce8ff' } as React.CSSProperties,
    detail: { fontSize: 10, color: 'rgba(255,255,255,.4)' } as React.CSSProperties,
    badge: (color: string) => ({
      fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
      background: `${color}20`, color,
    }),
    section: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.3)', marginTop: 10, marginBottom: 4 } as React.CSSProperties,
  };

  if (loading) return <div style={{ ...S.container, color: 'rgba(255,255,255,.3)', fontSize: 12 }}>Carregando...</div>;

  if (prestadores.length === 0) {
    return (
      <div style={S.container}>
        <div style={S.title}>{pick(T.title)}</div>
        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
          {pick(T.nenhum)}
        </div>
      </div>
    );
  }

  return (
    <div style={S.container}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={S.title}>{pick(T.title)}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={S.badge('#22c55e')}>🟢 {emTarefa.length}</span>
          <span style={S.badge('#f59e0b')}>🟡🔴 {ociosos.length}</span>
          <span style={S.badge('#6b7280')}>⚫ {semAcao.length}</span>
        </div>
      </div>

      {emTarefa.length > 0 && (
        <>
          <div style={S.section}>{pick(T.emTarefa)} ({emTarefa.length})</div>
          {emTarefa.map(p => (
            <div key={p.uid} style={S.row}>
              <span>{STATUS_ICON[p.status_prestador]}</span>
              <div style={S.name}>{p.nome?.split(' ')[0]}</div>
              {p.tarefa_ativa_tipo && (
                <span style={S.badge('#3b82f6')}>{p.tarefa_ativa_tipo}</span>
              )}
              {p.bike_id_atual && (
                <span style={S.badge('#a78bfa')}>🛴 {p.bike_id_atual}</span>
              )}
              <span style={{ ...S.detail, color: (p.minutos_na_tarefa ?? 0) > 60 ? '#f59e0b' : 'rgba(255,255,255,.4)' }}>
                {fmtDuracao(p.minutos_na_tarefa, pick)}
              </span>
            </div>
          ))}
        </>
      )}

      {ociosos.length > 0 && (
        <>
          <div style={S.section}>{pick(T.ocioso)} ({ociosos.length})</div>
          {ociosos.map(p => (
            <div key={p.uid} style={S.row}>
              <span>{STATUS_ICON[p.status_prestador]}</span>
              <div style={S.name}>{p.nome?.split(' ')[0]}</div>
              <span style={{ ...S.detail, color: (p.minutos_ocioso ?? 0) > 60 ? '#ef4444' : '#f59e0b' }}>
                {fmtDuracao(p.minutos_ocioso, pick)} {pick(T.ocioso).toLowerCase()}
              </span>
            </div>
          ))}
        </>
      )}

      {semAcao.length > 0 && (
        <>
          <div style={S.section}>{pick(T.semAcao)} ({semAcao.length})</div>
          {semAcao.map(p => (
            <div key={p.uid} style={S.row}>
              <span>⚫</span>
              <div style={S.name}>{p.nome?.split(' ')[0]}</div>
              <span style={S.detail}>{pick(T.semAcao)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
