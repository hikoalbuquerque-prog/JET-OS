import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

type Lang = 'pt' | 'en' | 'es' | 'ru';
const T = {
  titulo:     { pt: '📅 Calendário de Operações', en: '📅 Operations Calendar', es: '📅 Calendario de Operaciones', ru: '📅 Календарь операций' },
  novo:       { pt: '+ Novo evento', en: '+ New event', es: '+ Nuevo evento', ru: '+ Новое событие' },
  nome:       { pt: 'Nome', en: 'Name', es: 'Nombre', ru: 'Название' },
  tipo:       { pt: 'Tipo', en: 'Type', es: 'Tipo', ru: 'Тип' },
  feriado:    { pt: 'Feriado', en: 'Holiday', es: 'Feriado', ru: 'Праздник' },
  evento:     { pt: 'Evento', en: 'Event', es: 'Evento', ru: 'Событие' },
  manutencao: { pt: 'Manutenção', en: 'Maintenance', es: 'Mantenimiento', ru: 'Обслуживание' },
  sazonalidade:{ pt: 'Sazonalidade', en: 'Seasonality', es: 'Temporada', ru: 'Сезонность' },
  ponto:      { pt: 'Ponto (parking)', en: 'Point (parking)', es: 'Punto (parking)', ru: 'Точка (parking)' },
  inicio:     { pt: 'Início', en: 'Start', es: 'Inicio', ru: 'Начало' },
  fim:        { pt: 'Fim', en: 'End', es: 'Fin', ru: 'Конец' },
  salvar:     { pt: 'Salvar', en: 'Save', es: 'Guardar', ru: 'Сохранить' },
  cancelar:   { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  excluir:    { pt: 'Excluir', en: 'Delete', es: 'Eliminar', ru: 'Удалить' },
  todos:      { pt: 'Todos os pontos', en: 'All points', es: 'Todos los puntos', ru: 'Все точки' },
  metaOverride:{ pt: 'Meta override', en: 'Target override', es: 'Meta override', ru: 'Переопределение цели' },
  ativo:      { pt: 'Ativo', en: 'Active', es: 'Activo', ru: 'Активный' },
  inativo:    { pt: 'Inativo', en: 'Inactive', es: 'Inactivo', ru: 'Неактивный' },
  hoje:       { pt: 'Hoje', en: 'Today', es: 'Hoy', ru: 'Сегодня' },
  semEventos: { pt: 'Nenhum evento cadastrado', en: 'No events', es: 'Sin eventos', ru: 'Нет событий' },
};

const TIPOS = ['feriado', 'evento', 'manutencao', 'sazonalidade'] as const;
const TIPO_ICON: Record<string, string> = { feriado: '🎉', evento: '🎪', manutencao: '🔧', sazonalidade: '🌤️' };
const TIPO_COR: Record<string, string> = { feriado: '#ef4444', evento: '#8b5cf6', manutencao: '#f59e0b', sazonalidade: '#06b6d4' };

interface PontoEspecial {
  id: number;
  parking_id: string;
  cidade_id: string;
  tipo: string;
  nome: string | null;
  data_inicio: string;
  data_fim: string | null;
  config: any;
  ativo: boolean;
  criado_em: string;
}

interface Props {
  cidade: string;
  usuario: { uid: string; role: string };
}

export default function CalendarioOpsEspeciais({ cidade, usuario }: Props) {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'pt').slice(0, 2) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;

  const [eventos, setEventos] = useState<PontoEspecial[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ nome: '', tipo: 'evento', parking_id: '__all__', data_inicio: '', data_fim: '', meta_override: '', ativo: true });
  const [busy, setBusy] = useState(false);
  const [mesAtual, setMesAtual] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });

  const fetchEventos = useCallback(async () => {
    const { data } = await supabase.from('pontos_especiais')
      .select('*')
      .eq('cidade_id', cidade)
      .order('data_inicio', { ascending: false })
      .limit(200);
    setEventos((data ?? []) as PontoEspecial[]);
  }, [cidade]);

  useEffect(() => { fetchEventos(); }, [fetchEventos]);

  const abrirForm = (ev?: PontoEspecial) => {
    if (ev) {
      setEditId(ev.id);
      setForm({
        nome: ev.nome || '', tipo: ev.tipo, parking_id: ev.parking_id || '__all__',
        data_inicio: ev.data_inicio, data_fim: ev.data_fim || '',
        meta_override: ev.config?.meta_override?.toString() || '', ativo: ev.ativo,
      });
    } else {
      setEditId(null);
      setForm({ nome: '', tipo: 'evento', parking_id: '__all__', data_inicio: '', data_fim: '', meta_override: '', ativo: true });
    }
    setShowForm(true);
  };

  const salvar = async () => {
    setBusy(true);
    const payload = {
      cidade_id: cidade,
      parking_id: form.parking_id === '__all__' ? '__all__' : form.parking_id,
      tipo: form.tipo,
      nome: form.nome || null,
      data_inicio: form.data_inicio,
      data_fim: form.data_fim || null,
      config: form.meta_override ? { meta_override: parseInt(form.meta_override) } : {},
      ativo: form.ativo,
      criado_por: usuario.uid,
    };

    if (editId) {
      await supabase.from('pontos_especiais').update(payload).eq('id', editId);
    } else {
      await supabase.from('pontos_especiais').insert(payload);
    }
    setShowForm(false);
    await fetchEventos();
    setBusy(false);
  };

  const excluir = async (id: number) => {
    await supabase.from('pontos_especiais').delete().eq('id', id);
    fetchEventos();
  };

  // Calendar grid
  const [ano, mes] = mesAtual.split('-').map(Number);
  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const hoje = new Date().toISOString().slice(0, 10);

  const eventosPorDia = useMemo(() => {
    const map: Record<string, PontoEspecial[]> = {};
    for (const ev of eventos) {
      const start = ev.data_inicio;
      const end = ev.data_fim || ev.data_inicio;
      const s = new Date(start);
      const e = new Date(end);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(ev);
      }
    }
    return map;
  }, [eventos]);

  const proximoMes = () => {
    const d = new Date(ano, mes, 1);
    setMesAtual(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const mesAnterior = () => {
    const d = new Date(ano, mes - 2, 1);
    setMesAtual(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const S = {
    card: { background: '#111827', borderRadius: 10, padding: 14, marginBottom: 10 } as React.CSSProperties,
    btn: (c: string) => ({ background: c, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }),
    ghost: { background: 'transparent', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.5)', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer' } as React.CSSProperties,
    inp: { background: '#0d1117', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '8px 12px', color: '#dce8ff', fontSize: 12, width: '100%' } as React.CSSProperties,
    lbl: { fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.35)', marginBottom: 4, textTransform: 'uppercase' as const } as React.CSSProperties,
  };

  const mesesNome = lang === 'en'
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#dce8ff' }}>{pick(T.titulo)}</div>
        <button onClick={() => abrirForm()} style={S.btn('#3b82f6')}>{pick(T.novo)}</button>
      </div>

      {/* Calendar header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button onClick={mesAnterior} style={S.ghost}>◀</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#dce8ff' }}>{mesesNome[mes - 1]} {ano}</span>
        <button onClick={proximoMes} style={S.ghost}>▶</button>
      </div>

      {/* Calendar grid */}
      <div style={{ ...S.card, padding: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {['D','S','T','Q','Q','S','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,.25)', padding: 4 }}>{d}</div>
          ))}
          {Array.from({ length: primeiroDia }, (_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: diasNoMes }, (_, i) => {
            const dia = i + 1;
            const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
            const evs = eventosPorDia[dateStr] || [];
            const isHoje = dateStr === hoje;
            return (
              <div key={dia} style={{
                padding: 4, minHeight: 36, borderRadius: 6, cursor: evs.length ? 'pointer' : 'default',
                background: isHoje ? 'rgba(59,130,246,.15)' : evs.length ? 'rgba(255,255,255,.03)' : 'transparent',
                border: isHoje ? '1px solid rgba(59,130,246,.3)' : '1px solid transparent',
              }}>
                <div style={{ fontSize: 10, color: isHoje ? '#60a5fa' : 'rgba(255,255,255,.5)', fontWeight: isHoje ? 700 : 400 }}>{dia}</div>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
                  {evs.slice(0, 3).map((ev, j) => (
                    <div key={j} title={ev.nome || ev.tipo}
                      style={{ width: 6, height: 6, borderRadius: '50%', background: TIPO_COR[ev.tipo] || '#6b7280' }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, marginTop: 4 }}>
        {TIPOS.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: TIPO_COR[t] }} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>{pick(T[t])}</span>
          </div>
        ))}
      </div>

      {/* Events list */}
      {eventos.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 12, textAlign: 'center', padding: 20 }}>{pick(T.semEventos)}</div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {eventos.map(ev => {
            const ativo = ev.ativo && (!ev.data_fim || ev.data_fim >= hoje) && ev.data_inicio <= hoje;
            return (
              <div key={ev.id} onClick={() => abrirForm(ev)} style={{
                ...S.card, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                opacity: ev.data_fim && ev.data_fim < hoje ? 0.4 : 1,
                borderLeft: `3px solid ${TIPO_COR[ev.tipo] || '#6b7280'}`,
              }}>
                <span style={{ fontSize: 16 }}>{TIPO_ICON[ev.tipo] || '📌'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#dce8ff' }}>
                    {ev.nome || ev.tipo}
                    {ativo && <span style={{ fontSize: 8, background: 'rgba(34,197,94,.15)', color: '#22c55e', padding: '1px 4px', borderRadius: 3, marginLeft: 6 }}>{pick(T.ativo)}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                    {ev.data_inicio}{ev.data_fim ? ` → ${ev.data_fim}` : ''}
                    {ev.parking_id !== '__all__' && <span> · {ev.parking_id}</span>}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); excluir(ev.id); }}
                  style={{ ...S.ghost, padding: '4px 8px', fontSize: 10, color: '#ef4444' }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1f2e', borderRadius: 14, padding: 24, width: 380, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#dce8ff', marginBottom: 16 }}>
              {editId ? '✏️' : '➕'} {pick(T.titulo)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={S.lbl}>{pick(T.nome)}</div>
                <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} style={S.inp} />
              </div>
              <div>
                <div style={S.lbl}>{pick(T.tipo)}</div>
                <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={S.inp}>
                  {TIPOS.map(t => <option key={t} value={t}>{TIPO_ICON[t]} {pick(T[t])}</option>)}
                </select>
              </div>
              <div>
                <div style={S.lbl}>{pick(T.ponto)}</div>
                <input value={form.parking_id} onChange={e => setForm({ ...form, parking_id: e.target.value })}
                  placeholder={pick(T.todos)} style={S.inp} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.lbl}>{pick(T.inicio)}</div>
                  <input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} style={S.inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={S.lbl}>{pick(T.fim)}</div>
                  <input type="date" value={form.data_fim} onChange={e => setForm({ ...form, data_fim: e.target.value })} style={S.inp} />
                </div>
              </div>
              <div>
                <div style={S.lbl}>{pick(T.metaOverride)}</div>
                <input type="number" value={form.meta_override} onChange={e => setForm({ ...form, meta_override: e.target.value })}
                  placeholder="—" style={S.inp} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#dce8ff', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
                {pick(T.ativo)}
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowForm(false)} style={{ ...S.ghost, flex: 1 }}>{pick(T.cancelar)}</button>
              <button disabled={busy || !form.data_inicio} onClick={salvar}
                style={{ ...S.btn('#3b82f6'), flex: 2, opacity: !form.data_inicio ? 0.4 : 1 }}>
                {busy ? '...' : pick(T.salvar)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
