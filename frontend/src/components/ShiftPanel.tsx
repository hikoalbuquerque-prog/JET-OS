// frontend/src/components/ShiftPanel.tsx
// Painel de turnos (shift_records) — registro e visualização T0/T1/T2

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const TXT: Record<string, Tr> = {
  titulo:      { pt:'Turnos', en:'Shifts', es:'Turnos', ru:'Смены' },
  registrar:   { pt:'Registrar', en:'Register', es:'Registrar', ru:'Регистрация' },
  inicio:      { pt:'Início', en:'Start', es:'Inicio', ru:'Начало' },
  intervalo:   { pt:'Intervalo', en:'Break', es:'Descanso', ru:'Перерыв' },
  retorno:     { pt:'Retorno', en:'Return', es:'Retorno', ru:'Возврат' },
  fim:         { pt:'Fim', en:'End', es:'Fin', ru:'Конец' },
  funcao:      { pt:'Função', en:'Role', es:'Función', ru:'Роль' },
  zona:        { pt:'Zona', en:'Zone', es:'Zona', ru:'Зона' },
  turno:       { pt:'Turno', en:'Shift', es:'Turno', ru:'Смена' },
  nomeWorker:  { pt:'Nome', en:'Name', es:'Nombre', ru:'Имя' },
  acao:        { pt:'Ação', en:'Action', es:'Acción', ru:'Действие' },
  horario:     { pt:'Horário', en:'Time', es:'Hora', ru:'Время' },
  status:      { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
  aberto:      { pt:'Em turno', en:'On shift', es:'En turno', ru:'На смене' },
  fechado:     { pt:'Fora', en:'Off', es:'Fuera', ru:'Не на смене' },
  pausado:     { pt:'Em pausa', en:'On break', es:'En pausa', ru:'На перерыве' },
  hoje:        { pt:'Hoje', en:'Today', es:'Hoy', ru:'Сегодня' },
  semRegistros:{ pt:'Nenhum registro hoje', en:'No records today', es:'Sin registros hoy', ru:'Нет записей сегодня' },
  total:       { pt:'Total no turno', en:'Total on shift', es:'Total en turno', ru:'Всего на смене' },
  fechar:      { pt:'Fechar', en:'Close', es:'Cerrar', ru:'Закрыть' },
};

const FUNCOES = ['Aux Scout', 'Aux Charger', 'Aux Operacional', 'Monitor', 'Supervisor'];
const TURNOS = ['T0', 'T1', 'T2'] as const;
const ACTION_COR: Record<string, string> = {
  inicio: '#22c55e', intervalo: '#f59e0b', retorno: '#3b82f6', fim: '#ef4444',
};

interface ShiftRecord {
  id: number;
  user_id: string;
  nome: string;
  action: string;
  funcao: string;
  zonas: string[];
  turno: string;
  lat?: number;
  lng?: number;
  registered_at: string;
}

interface Props {
  visivel: boolean;
  onFechar: () => void;
  cidade?: string;
}

const T = {
  bg:'rgba(13,18,30,1)', card:'rgba(22,28,40,.95)',
  bdr:'rgba(255,255,255,.08)', txt:'#e2e8f0', dim:'#64748b',
};

export default function ShiftPanel({ visivel, onFechar, cidade }: Props) {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const t = (k: keyof typeof TXT) => TXT[k][lang] ?? TXT[k].pt;

  const [records, setRecords] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visivel) return;
    setLoading(true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    (async () => {
      const { data } = await supabase
        .from('shift_records')
        .select('*')
        .gte('registered_at', today.toISOString())
        .order('registered_at', { ascending: false });
      setRecords(data ?? []);
      setLoading(false);
    })();
  }, [visivel]);

  const stats = useMemo(() => {
    const byUser = new Map<string, ShiftRecord[]>();
    for (const r of records) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    }

    const workers: { uid: string; nome: string; turno: string; funcao: string; status: string; lastAt: string; zonas: string[] }[] = [];
    for (const [uid, recs] of byUser) {
      const sorted = [...recs].sort((a, b) => new Date(b.registered_at).getTime() - new Date(a.registered_at).getTime());
      const last = sorted[0];
      const status = last.action === 'inicio' || last.action === 'retorno'
        ? 'aberto'
        : last.action === 'intervalo' ? 'pausado' : 'fechado';
      workers.push({
        uid, nome: last.nome, turno: last.turno,
        funcao: last.funcao, status, lastAt: last.registered_at,
        zonas: last.zonas,
      });
    }

    const abertos = workers.filter(w => w.status === 'aberto').length;
    const pausados = workers.filter(w => w.status === 'pausado').length;
    return { workers, abertos, pausados, total: workers.length };
  }, [records]);

  if (!visivel) return null;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:4800, background:'rgba(0,0,0,.7)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background:T.bg, border:`1px solid ${T.bdr}`, borderRadius:16, width:'100%', maxWidth:800, maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:"'Inter',-apple-system,sans-serif" }}>

        {/* Header */}
        <div style={{ background:'rgba(13,18,30,.97)', borderBottom:`1px solid ${T.bdr}`, padding:'12px 18px', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#1a6fd4,#307FE2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>⏱</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:15, color:T.txt }}>{t('titulo')} — {t('hoje')}</div>
            <div style={{ fontSize:11, color:T.dim }}>
              {stats.total} workers · {stats.abertos} {t('aberto')} · {stats.pausados} {t('pausado')}
            </div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:`1px solid ${T.bdr}`, borderRadius:8, color:T.dim, cursor:'pointer', padding:'6px 12px', fontSize:12 }}>✕ {t('fechar')}</button>
        </div>

        {/* KPIs */}
        <div style={{ display:'flex', gap:8, padding:'12px 16px', flexWrap:'wrap' }}>
          {[
            { n: stats.abertos, l: `🟢 ${t('aberto')}`, c: '#22c55e' },
            { n: stats.pausados, l: `🟡 ${t('pausado')}`, c: '#f59e0b' },
            { n: stats.total - stats.abertos - stats.pausados, l: `🔴 ${t('fechado')}`, c: '#ef4444' },
          ].map(({ n, l, c }) => (
            <div key={l} style={{ flex:1, minWidth:80, background:T.card, border:`1px solid ${c}22`, borderTop:`2px solid ${c}`, borderRadius:12, padding:'10px 12px' }}>
              <div style={{ fontSize:24, fontWeight:800, color:c, lineHeight:1 }}>{n}</div>
              <div style={{ fontSize:10, color:T.dim, marginTop:2, textTransform:'uppercase', letterSpacing:'0.4px' }}>{l}</div>
            </div>
          ))}
          {TURNOS.map(turno => {
            const n = stats.workers.filter(w => w.turno === turno && w.status === 'aberto').length;
            return (
              <div key={turno} style={{ flex:1, minWidth:60, background:T.card, border:`1px solid ${T.bdr}`, borderTop:`2px solid #3b82f6`, borderRadius:12, padding:'10px 12px' }}>
                <div style={{ fontSize:24, fontWeight:800, color:'#3b82f6', lineHeight:1 }}>{n}</div>
                <div style={{ fontSize:10, color:T.dim, marginTop:2, textTransform:'uppercase', letterSpacing:'0.4px' }}>{turno}</div>
              </div>
            );
          })}
        </div>

        {/* Tabela de workers */}
        <div style={{ flex:1, overflowY:'auto', padding:'0 16px 16px' }}>
          {stats.workers.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:T.dim }}>{loading ? '...' : t('semRegistros')}</div>
          ) : (
            <div style={{ overflowX:'auto', background:T.card, borderRadius:12, border:`1px solid ${T.bdr}` }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
                <thead>
                  <tr>
                    {[t('status'), t('nomeWorker'), t('turno'), t('funcao'), t('zona'), t('horario')].map(h => (
                      <th key={h} style={{ padding:'8px 10px', fontSize:10, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase', color:T.dim, borderBottom:`1px solid ${T.bdr}`, textAlign:'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.workers
                    .sort((a, b) => {
                      const ord: Record<string, number> = { aberto: 0, pausado: 1, fechado: 2 };
                      return (ord[a.status] ?? 9) - (ord[b.status] ?? 9);
                    })
                    .map(w => {
                      const cor = w.status === 'aberto' ? '#22c55e' : w.status === 'pausado' ? '#f59e0b' : '#ef4444';
                      const lastTime = new Date(w.lastAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                      return (
                        <tr key={w.uid}>
                          <td style={{ padding:'8px 10px', fontSize:12, borderBottom:`1px solid rgba(255,255,255,.04)` }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700, background:`${cor}18`, color:cor, border:`1px solid ${cor}33` }}>
                              ● {t(w.status as any)}
                            </span>
                          </td>
                          <td style={{ padding:'8px 10px', fontSize:12, fontWeight:600, color:T.txt, borderBottom:`1px solid rgba(255,255,255,.04)` }}>{w.nome}</td>
                          <td style={{ padding:'8px 10px', fontSize:12, color:'#3b82f6', fontWeight:700, borderBottom:`1px solid rgba(255,255,255,.04)` }}>{w.turno}</td>
                          <td style={{ padding:'8px 10px', fontSize:12, color:T.dim, borderBottom:`1px solid rgba(255,255,255,.04)` }}>{w.funcao}</td>
                          <td style={{ padding:'8px 10px', fontSize:11, color:T.dim, borderBottom:`1px solid rgba(255,255,255,.04)` }}>{w.zonas?.join(', ') || '—'}</td>
                          <td style={{ padding:'8px 10px', fontSize:11, color:T.dim, borderBottom:`1px solid rgba(255,255,255,.04)` }}>{lastTime}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Histórico de ações */}
          {records.length > 0 && (
            <div style={{ marginTop:12, background:T.card, borderRadius:12, border:`1px solid ${T.bdr}`, padding:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:'uppercase', letterSpacing:'1px', marginBottom:8 }}>
                📋 Histórico ({records.length})
              </div>
              <div style={{ maxHeight:200, overflowY:'auto' }}>
                {records.slice(0, 50).map(r => {
                  const time = new Date(r.registered_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
                  const cor = ACTION_COR[r.action] ?? T.dim;
                  return (
                    <div key={r.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, marginBottom:4, padding:'3px 0', borderBottom:`1px solid rgba(255,255,255,.03)` }}>
                      <span style={{ color:cor, fontWeight:700, minWidth:70 }}>{r.action.toUpperCase()}</span>
                      <span style={{ color:T.txt, flex:1 }}>{r.nome}</span>
                      <span style={{ color:'#3b82f6', fontWeight:600, minWidth:24 }}>{r.turno}</span>
                      <span style={{ color:T.dim }}>{r.funcao}</span>
                      <span style={{ color:T.dim, minWidth:60, textAlign:'right' }}>{time}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
