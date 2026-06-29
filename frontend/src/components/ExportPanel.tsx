import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

type Lang = 'pt' | 'en' | 'es' | 'ru';
const T = {
  titulo:  { pt: '📤 Exportar dados', en: '📤 Export data', es: '📤 Exportar datos', ru: '📤 Экспорт данных' },
  snap:    { pt: 'Snapshots (parking atual)', en: 'Snapshots (current parkings)', es: 'Snapshots (parkings actual)', ru: 'Снимки (текущие парковки)' },
  tarefas: { pt: 'Tarefas (hoje)', en: 'Tasks (today)', es: 'Tareas (hoy)', ru: 'Задачи (сегодня)' },
  tarefas7:{ pt: 'Tarefas (7 dias)', en: 'Tasks (7 days)', es: 'Tareas (7 días)', ru: 'Задачи (7 дней)' },
  prest:   { pt: 'Prestadores (status)', en: 'Workers (status)', es: 'Prestadores (estado)', ru: 'Работники (статус)' },
  eventos: { pt: 'Eventos especiais', en: 'Special events', es: 'Eventos especiales', ru: 'Спецсобытия' },
  csv:     { pt: 'CSV', en: 'CSV', es: 'CSV', ru: 'CSV' },
  baixando:{ pt: 'Baixando...', en: 'Downloading...', es: 'Descargando...', ru: 'Загрузка...' },
};

interface Props { cidade: string }

function toCsv(rows: any[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.join(',');
  const lines = rows.map(r => keys.map(k => {
    const v = r[k];
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
  return [header, ...lines].join('\n');
}

function download(filename: string, content: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPanel({ cidade }: Props) {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'pt').slice(0, 2) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;
  const [busy, setBusy] = useState('');

  const exportar = async (tipo: string) => {
    setBusy(tipo);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      let data: any[] = [];
      let filename = '';

      switch (tipo) {
        case 'snap': {
          const { data: d } = await supabase.from('gojet_snapshots')
            .select('parking_id, parking_name, cidade, zone_name, bikes_count, target, available_bikes_count, created_at')
            .eq('cidade', cidade).order('created_at', { ascending: false }).limit(5000);
          data = d ?? []; filename = `snapshots_${cidade}_${today}.csv`;
          break;
        }
        case 'tarefas': {
          const { data: d } = await supabase.from('tarefas_logistica')
            .select('id, kind, titulo, status, prioridade, assignee_uid, cidade, parking_nome, criado_em, concluido_em, eta_minutos')
            .eq('cidade', cidade).gte('criado_em', `${today}T00:00:00`);
          data = d ?? []; filename = `tarefas_hoje_${cidade}_${today}.csv`;
          break;
        }
        case 'tarefas7': {
          const { data: d } = await supabase.from('tarefas_logistica')
            .select('id, kind, titulo, status, prioridade, assignee_uid, cidade, parking_nome, criado_em, concluido_em, eta_minutos')
            .eq('cidade', cidade).gte('criado_em', `${sevenDaysAgo}T00:00:00`);
          data = d ?? []; filename = `tarefas_7d_${cidade}_${today}.csv`;
          break;
        }
        case 'prest': {
          const { data: d } = await supabase.from('v_prestador_status')
            .select('uid, nome, cidade, status_prestador, minutos_na_tarefa, minutos_ocioso, tarefa_ativa_tipo, bike_id_atual')
            .eq('cidade', cidade);
          data = d ?? []; filename = `prestadores_${cidade}_${today}.csv`;
          break;
        }
        case 'eventos': {
          const { data: d } = await supabase.from('pontos_especiais')
            .select('id, tipo, nome, parking_id, data_inicio, data_fim, config, ativo')
            .eq('cidade_id', cidade);
          data = d ?? []; filename = `eventos_especiais_${cidade}_${today}.csv`;
          break;
        }
      }

      if (data.length) {
        download(filename, toCsv(data));
      }
    } catch (e) { console.error(e); }
    setBusy('');
  };

  const S = {
    btn: { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '12px 16px',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 6 } as React.CSSProperties,
    label: { fontSize: 12, color: '#dce8ff', fontWeight: 600 } as React.CSSProperties,
    badge: { fontSize: 10, background: 'rgba(59,130,246,.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: 6, fontWeight: 700 } as React.CSSProperties,
  };

  const items = [
    { key: 'snap', label: T.snap },
    { key: 'tarefas', label: T.tarefas },
    { key: 'tarefas7', label: T.tarefas7 },
    { key: 'prest', label: T.prest },
    { key: 'eventos', label: T.eventos },
  ];

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#dce8ff', marginBottom: 14 }}>{pick(T.titulo)}</div>
      {items.map(it => (
        <button key={it.key} onClick={() => exportar(it.key)} disabled={busy === it.key} style={S.btn}>
          <span style={S.label}>{pick(it.label)}</span>
          <span style={S.badge}>{busy === it.key ? pick(T.baixando) : pick(T.csv)}</span>
        </button>
      ))}
    </div>
  );
}
