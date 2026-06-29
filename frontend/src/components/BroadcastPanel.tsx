import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const T = {
  titulo:      { pt: 'Enviar Comunicado', en: 'Send Broadcast', es: 'Enviar Comunicado', ru: 'Отправить рассылку' },
  tituloField: { pt: 'Título', en: 'Title', es: 'Título', ru: 'Заголовок' },
  corpo:       { pt: 'Mensagem', en: 'Message', es: 'Mensaje', ru: 'Сообщение' },
  tipo:        { pt: 'Tipo', en: 'Type', es: 'Tipo', ru: 'Тип' },
  segmentacao: { pt: 'Segmentação', en: 'Targeting', es: 'Segmentación', ru: 'Сегментация' },
  todosPaises: { pt: 'Todos os países', en: 'All countries', es: 'Todos los países', ru: 'Все страны' },
  todasCidades:{ pt: 'Todas as cidades', en: 'All cities', es: 'Todas las ciudades', ru: 'Все города' },
  todosRoles:  { pt: 'Todos os cargos', en: 'All roles', es: 'Todos los cargos', ru: 'Все роли' },
  enviar:      { pt: '📡 Enviar Comunicado', en: '📡 Send Broadcast', es: '📡 Enviar Comunicado', ru: '📡 Отправить' },
  enviando:    { pt: '⏳ Enviando...', en: '⏳ Sending...', es: '⏳ Enviando...', ru: '⏳ Отправка...' },
  enviado:     { pt: '✅ Comunicado enviado!', en: '✅ Broadcast sent!', es: '✅ Comunicado enviado!', ru: '✅ Рассылка отправлена!' },
  erro:        { pt: '❌ Erro ao enviar', en: '❌ Error sending', es: '❌ Error al enviar', ru: '❌ Ошибка отправки' },
  historico:   { pt: 'Histórico', en: 'History', es: 'Historial', ru: 'История' },
  nenhum:      { pt: 'Nenhum comunicado enviado ainda.', en: 'No broadcasts sent yet.', es: 'Ningún comunicado enviado aún.', ru: 'Рассылок пока нет.' },
  destinatarios:{ pt: 'destinatários', en: 'recipients', es: 'destinatarios', ru: 'получателей' },
  pushEnviado: { pt: 'Push enviado', en: 'Push sent', es: 'Push enviado', ru: 'Push отправлен' },
  info:        { pt: '📢 Informação', en: '📢 Info', es: '📢 Información', ru: '📢 Информация' },
  alerta:      { pt: '⚠️ Alerta', en: '⚠️ Alert', es: '⚠️ Alerta', ru: '⚠️ Предупреждение' },
  novidade:    { pt: '🆕 Novidade', en: '🆕 News', es: '🆕 Novedad', ru: '🆕 Новость' },
  manutencao:  { pt: '🔧 Manutenção', en: '🔧 Maintenance', es: '🔧 Mantenimiento', ru: '🔧 Обслуживание' },
};

const TIPOS = ['info', 'alerta', 'novidade', 'manutencao'] as const;

const ROLES_DISPONIVEIS = [
  { value: 'admin', label: 'Admin' },
  { value: 'supergestor', label: 'Supergestor' },
  { value: 'gestor', label: 'Gestor' },
  { value: 'gestor_seg', label: 'Gest. Seg.' },
  { value: 'gestor_log', label: 'Gest. Log.' },
  { value: 'guard', label: 'Guard' },
  { value: 'campo', label: 'Campo' },
  { value: 'logistica', label: 'Logística' },
  { value: 'promotor', label: 'Promotor' },
  { value: 'viewer', label: 'Viewer' },
];

interface Props {
  autorUid?: string;
  autorNome?: string;
}

export default function BroadcastPanel({ autorUid, autorNome }: Props) {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru';
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [tipo, setTipo] = useState<string>('info');
  const [cidades, setCidades] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [cidadesDisp, setCidadesDisp] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [historico, setHistorico] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('estacoes').select('cidade').then(({ data }) => {
      const set = new Set<string>();
      (data || []).forEach((d: any) => { if (d.cidade) set.add(d.cidade.trim()); });
      setCidadesDisp(Array.from(set).sort());
    });
    carregarHistorico();
  }, []);

  const carregarHistorico = useCallback(async () => {
    const { data } = await supabase.from('broadcasts').select('*').order('enviado_em', { ascending: false }).limit(20);
    if (data) setHistorico(data);
  }, []);

  const toggleArr = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];

  const enviar = async () => {
    if (!titulo.trim() || !corpo.trim()) return;
    setEnviando(true); setFeedback('');
    try {
      const { data: bc, error: bcErr } = await supabase.from('broadcasts').insert({
        titulo: titulo.trim(),
        corpo: corpo.trim(),
        tipo,
        cidades: cidades.length > 0 ? cidades : [],
        roles: roles.length > 0 ? roles : [],
        autor_uid: autorUid,
        autor_nome: autorNome,
      }).select('id').single();
      if (bcErr) throw bcErr;

      // Buscar usuários alvo
      let query = supabase.from('usuarios').select('uid, role, cidade');
      if (roles.length > 0) query = query.in('role', roles);

      const { data: usuarios } = await query;
      const alvos = (usuarios || []).filter((u: any) => {
        if (cidades.length > 0 && u.cidade && !cidades.includes(u.cidade)) return false;
        return true;
      });

      // Inserir notificações para cada alvo
      if (alvos.length > 0) {
        const notifs = alvos.map((u: any) => ({
          uid: u.uid,
          titulo: titulo.trim(),
          mensagem: corpo.trim(),
          corpo: corpo.trim(),
          tipo,
          broadcast_id: bc.id,
          ts: new Date().toISOString(),
        }));
        await supabase.from('notificacoes_app').insert(notifs);
      }

      // Também inserir uma notificação global (uid=null) como fallback
      await supabase.from('notificacoes_app').insert({
        uid: null,
        titulo: titulo.trim(),
        mensagem: corpo.trim(),
        corpo: corpo.trim(),
        tipo,
        broadcast_id: bc.id,
        ts: new Date().toISOString(),
      });

      setFeedback(`${pick(T.enviado)} (${alvos.length} ${pick(T.destinatarios)})`);
      setTitulo(''); setCorpo(''); setCidades([]); setRoles([]);
      carregarHistorico();
    } catch (e: any) {
      setFeedback(pick(T.erro) + ': ' + (e.message || ''));
    } finally {
      setEnviando(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: '#fff',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  const chip = (ativo: boolean): React.CSSProperties => ({
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: ativo ? 700 : 400,
    borderStyle: 'solid', borderWidth: 1,
    borderColor: ativo ? 'rgba(99,102,241,.6)' : 'rgba(255,255,255,.1)',
    background: ativo ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.04)',
    color: ativo ? '#a5b4fc' : 'rgba(255,255,255,.5)',
  });

  const tipoLabel = (t: string) => {
    const map: Record<string, typeof T.info> = { info: T.info, alerta: T.alerta, novidade: T.novidade, manutencao: T.manutencao };
    return pick(map[t] || T.info);
  };

  return (
    <div>
      {/* Formulário */}
      <div style={{ background: 'rgba(99,102,241,.05)', border: '1px solid rgba(99,102,241,.15)',
        borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#a5b4fc', marginBottom: 14 }}>
          {pick(T.titulo)}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>{pick(T.tituloField)}</div>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} style={inp}
            placeholder={pick(T.tituloField)} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>{pick(T.corpo)}</div>
          <textarea value={corpo} onChange={e => setCorpo(e.target.value)} rows={3}
            style={{ ...inp, resize: 'vertical' as const, fontFamily: 'inherit' }}
            placeholder={pick(T.corpo)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 6 }}>{pick(T.tipo)}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TIPOS.map(t => (
              <button key={t} onClick={() => setTipo(t)} style={chip(tipo === t)}>
                {tipoLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 6 }}>
            {pick(T.segmentacao)} — {pick(T.todasCidades)}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {cidadesDisp.map(c => (
              <button key={c} onClick={() => setCidades(toggleArr(cidades, c))} style={chip(cidades.includes(c))}>
                {c}
              </button>
            ))}
          </div>
          {cidades.length === 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
              {pick(T.todasCidades)}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 6 }}>
            {pick(T.segmentacao)} — {pick(T.todosRoles)}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ROLES_DISPONIVEIS.map(r => (
              <button key={r.value} onClick={() => setRoles(toggleArr(roles, r.value))} style={chip(roles.includes(r.value))}>
                {r.label}
              </button>
            ))}
          </div>
          {roles.length === 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
              {pick(T.todosRoles)}
            </div>
          )}
        </div>

        {feedback && (
          <div style={{ fontSize: 12, marginBottom: 10, padding: '8px 12px', borderRadius: 8,
            background: feedback.includes('✅') ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
            border: `1px solid ${feedback.includes('✅') ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
            color: feedback.includes('✅') ? '#6ee7b7' : '#f87171' }}>
            {feedback}
          </div>
        )}

        <button onClick={enviar} disabled={enviando || !titulo.trim() || !corpo.trim()}
          style={{
            width: '100%', padding: '10px 18px', borderRadius: 8,
            borderStyle: 'none', borderWidth: 0,
            background: enviando ? 'rgba(99,102,241,.5)' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
            color: '#fff', fontWeight: 700, fontSize: 13,
            cursor: enviando ? 'not-allowed' : 'pointer',
            opacity: (!titulo.trim() || !corpo.trim()) ? 0.5 : 1,
          }}>
          {enviando ? pick(T.enviando) : pick(T.enviar)}
        </button>
      </div>

      {/* Histórico */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff', marginBottom: 10 }}>
        {pick(T.historico)}
      </div>
      {historico.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 12 }}>{pick(T.nenhum)}</div>
      ) : historico.map(b => (
        <div key={b.id} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
          borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#dce8ff' }}>{b.titulo}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>
              {new Date(b.enviado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>{b.corpo}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, background: 'rgba(99,102,241,.15)', color: '#a5b4fc',
              padding: '2px 6px', borderRadius: 4 }}>{tipoLabel(b.tipo)}</span>
            {b.cidades?.length > 0 && (
              <span style={{ fontSize: 9, background: 'rgba(16,185,129,.15)', color: '#6ee7b7',
                padding: '2px 6px', borderRadius: 4 }}>{b.cidades.join(', ')}</span>
            )}
            {b.roles?.length > 0 && (
              <span style={{ fontSize: 9, background: 'rgba(251,191,36,.15)', color: '#fbbf24',
                padding: '2px 6px', borderRadius: 4 }}>{b.roles.join(', ')}</span>
            )}
            {b.autor_nome && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,.3)' }}>por {b.autor_nome}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
