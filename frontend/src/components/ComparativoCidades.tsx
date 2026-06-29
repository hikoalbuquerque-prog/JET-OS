import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { fetchGojetSnapshot } from '../lib/analytics-supabase';

type Lang = 'pt' | 'en' | 'es' | 'ru';
const T = {
  titulo:    { pt: '🌎 Comparativo entre cidades', en: '🌎 City comparison', es: '🌎 Comparativo entre ciudades', ru: '🌎 Сравнение городов' },
  cidade:    { pt: 'Cidade', en: 'City', es: 'Ciudad', ru: 'Город' },
  pontos:    { pt: 'Pontos', en: 'Points', es: 'Puntos', ru: 'Точек' },
  bikes:     { pt: 'Bikes', en: 'Bikes', es: 'Bikes', ru: 'Байков' },
  vazios:    { pt: 'Vazios', en: 'Empty', es: 'Vacíos', ru: 'Пустые' },
  excesso:   { pt: 'Excesso', en: 'Excess', es: 'Exceso', ru: 'Избыток' },
  tarefas:   { pt: 'Tarefas', en: 'Tasks', es: 'Tareas', ru: 'Задачи' },
  scouts:    { pt: 'Scouts', en: 'Scouts', es: 'Scouts', ru: 'Скауты' },
  carregando:{ pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  pctVazio:  { pt: '% vazio', en: '% empty', es: '% vacío', ru: '% пусто' },
};

interface CidadeKPI {
  cidade: string;
  pontos: number;
  bikes: number;
  vazios: number;
  excesso: number;
  pctVazio: number;
  tarefasHoje: number;
  scoutsAtivos: number;
}

export default function ComparativoCidades() {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'pt').slice(0, 2) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;

  const [kpis, setKpis] = useState<CidadeKPI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Get active cities
      const { data: cidades } = await supabase
        .from('cidade_config')
        .select('nome')
        .eq('ativo', true);

      if (!cidades?.length) { setLoading(false); return; }

      const today = new Date().toISOString().slice(0, 10);
      const results: CidadeKPI[] = [];

      for (const c of cidades) {
        const cidade = c.nome;
        try {
          const [snap, tRes, pRes] = await Promise.all([
            fetchGojetSnapshot(cidade),
            supabase.from('tarefas_logistica')
              .select('id', { count: 'exact', head: true })
              .eq('cidade', cidade)
              .gte('criado_em', `${today}T00:00:00`),
            supabase.from('v_prestador_status')
              .select('status_prestador')
              .eq('cidade', cidade),
          ]);

          const parkings = (snap.parkings ?? []).filter((p: any) => Number.isFinite(p.latitude));
          // Build bike counts
          const bikesRes = await supabase.from('bikes').select('dados').limit(3000);
          const bikesList = (bikesRes.data ?? []).map((r: any) => r.dados ?? {});
          const bikeCountPerParking: Record<string, number> = {};
          for (const b of bikesList) {
            if (b.parking_id) bikeCountPerParking[b.parking_id] = (bikeCountPerParking[b.parking_id] ?? 0) + 1;
          }

          const totalBikes = Object.values(bikeCountPerParking).reduce((s, v) => s + v, 0);
          const pontos = parkings.length;
          let vazios = 0, excesso = 0;
          for (const p of parkings) {
            const count = bikeCountPerParking[p.id] ?? 0;
            if (count === 0) vazios++;
            const target = p.target_bikes_count ?? 3;
            if (count > target) excesso++;
          }

          const scoutsAtivos = (pRes.data ?? []).filter((p: any) => p.status_prestador === 'em_tarefa').length;

          results.push({
            cidade,
            pontos,
            bikes: totalBikes,
            vazios,
            excesso,
            pctVazio: pontos > 0 ? Math.round(vazios / pontos * 100) : 0,
            tarefasHoje: tRes.count ?? 0,
            scoutsAtivos,
          });
        } catch (e) {
          console.error(`Comparativo ${cidade}:`, e);
        }
      }

      setKpis(results.sort((a, b) => b.pontos - a.pontos));
      setLoading(false);
    })();
  }, []);

  const S = {
    table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 } as React.CSSProperties,
    th: { padding: '8px 10px', textAlign: 'left' as const, color: 'rgba(255,255,255,.3)', borderBottom: '1px solid rgba(255,255,255,.08)', fontSize: 10, fontWeight: 600 } as React.CSSProperties,
    td: { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,.04)', color: '#dce8ff' } as React.CSSProperties,
    tdNum: { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,.04)', color: '#dce8ff', textAlign: 'right' as const, fontFamily: 'monospace' } as React.CSSProperties,
  };

  // Best/worst highlighting
  const maxVazio = Math.max(...kpis.map(k => k.pctVazio), 0);

  if (loading) return <div style={{ color: 'rgba(255,255,255,.3)', padding: 30, textAlign: 'center' }}>{pick(T.carregando)}</div>;
  if (!kpis.length) return null;

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#dce8ff', marginBottom: 14 }}>{pick(T.titulo)}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>{pick(T.cidade)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.pontos)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.bikes)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.vazios)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.pctVazio)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.excesso)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.tarefas)}</th>
              <th style={{ ...S.th, textAlign: 'right' }}>{pick(T.scouts)}</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map(k => (
              <tr key={k.cidade}>
                <td style={{ ...S.td, fontWeight: 700 }}>{k.cidade}</td>
                <td style={S.tdNum}>{k.pontos}</td>
                <td style={S.tdNum}>{k.bikes}</td>
                <td style={{ ...S.tdNum, color: k.vazios > 0 ? '#ef4444' : 'rgba(255,255,255,.2)' }}>{k.vazios || '—'}</td>
                <td style={S.tdNum}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
                      <div style={{ width: `${maxVazio > 0 ? (k.pctVazio / maxVazio * 100) : 0}%`, height: 4, borderRadius: 2,
                        background: k.pctVazio > 30 ? '#ef4444' : k.pctVazio > 15 ? '#f59e0b' : '#22c55e' }} />
                    </div>
                    <span style={{ color: k.pctVazio > 30 ? '#ef4444' : k.pctVazio > 15 ? '#f59e0b' : '#22c55e' }}>{k.pctVazio}%</span>
                  </div>
                </td>
                <td style={{ ...S.tdNum, color: k.excesso > 0 ? '#f59e0b' : 'rgba(255,255,255,.2)' }}>{k.excesso || '—'}</td>
                <td style={S.tdNum}>{k.tarefasHoje}</td>
                <td style={{ ...S.tdNum, color: k.scoutsAtivos > 0 ? '#22c55e' : 'rgba(255,255,255,.2)' }}>{k.scoutsAtivos || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
