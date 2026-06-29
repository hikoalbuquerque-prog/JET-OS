// BikeSwapDialog — allows scout to swap bike during active task
// Reasons: alugada, defeito, bateria, manual
// Logs to bike_swap_log + updates tarefas_logistica.bike_id_atual

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const T = {
  title:    { pt: 'Trocar Bike', en: 'Swap Bike', es: 'Cambiar Bike', ru: 'Замена байка' },
  current:  { pt: 'Bike atual', en: 'Current bike', es: 'Bike actual', ru: 'Текущий байк' },
  newBike:  { pt: 'Nova bike', en: 'New bike', es: 'Nueva bike', ru: 'Новый байк' },
  reason:   { pt: 'Motivo', en: 'Reason', es: 'Motivo', ru: 'Причина' },
  alugada:  { pt: 'Alugada', en: 'Rented', es: 'Alquilada', ru: 'Арендован' },
  defeito:  { pt: 'Defeito', en: 'Defective', es: 'Defectuoso', ru: 'Дефект' },
  bateria:  { pt: 'Bateria baixa', en: 'Low battery', es: 'Batería baja', ru: 'Низкий заряд' },
  manual:   { pt: 'Outro', en: 'Other', es: 'Otro', ru: 'Другое' },
  confirm:  { pt: 'Confirmar troca', en: 'Confirm swap', es: 'Confirmar cambio', ru: 'Подтвердить' },
  cancel:   { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  success:  { pt: 'Bike trocada!', en: 'Bike swapped!', es: '¡Bike cambiada!', ru: 'Байк заменён!' },
  error:    { pt: 'Erro ao trocar', en: 'Swap failed', es: 'Error al cambiar', ru: 'Ошибка замены' },
};
type Lang = 'pt' | 'en' | 'es' | 'ru';

interface Props {
  tarefaId: string;
  bikeIdAtual: string;
  scoutUid: string;
  onClose: () => void;
  onSwapped?: (newBikeId: string) => void;
}

const MOTIVOS = ['alugada', 'defeito', 'bateria', 'manual'] as const;

export default function BikeSwapDialog({ tarefaId, bikeIdAtual, scoutUid, onClose, onSwapped }: Props) {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const pick = (o: Record<Lang, string>) => o[lang] ?? o.pt;

  const [newBikeId, setNewBikeId] = useState('');
  const [motivo, setMotivo] = useState<typeof MOTIVOS[number]>('alugada');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const doSwap = async () => {
    if (!newBikeId.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      // Validate new bike (offline-tolerant)
      let validation: any = null;
      try {
        const res = await supabase.functions.invoke('validar-bike', {
          body: { tarefa_id: tarefaId, bike_id: newBikeId.trim() },
        });
        validation = res.data;
      } catch {
        // Offline: skip validation, queue the swap
        const { enqueue } = await import('../lib/offline-queue');
        enqueue(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validar-bike`,
          'POST',
          { tarefa_id: tarefaId, bike_id: newBikeId.trim() },
          { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        );
      }

      if (validation && !validation.valido) {
        setMsg(`${pick(T.error)}: ${validation.motivo} — ${validation.detalhes?.msg || ''}`);
        setBusy(false);
        return;
      }

      // Log swap
      try {
        await supabase.from('bike_swap_log').insert({
          tarefa_id: tarefaId,
          uid_scout: scoutUid,
          bike_id_old: bikeIdAtual,
          bike_id_new: newBikeId.trim(),
          motivo,
        });
      } catch {
        const { enqueue } = await import('../lib/offline-queue');
        enqueue(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/bike_swap_log`,
          'POST',
          { tarefa_id: tarefaId, uid_scout: scoutUid, bike_id_old: bikeIdAtual, bike_id_new: newBikeId.trim(), motivo },
          { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        );
      }

      // Update task
      await supabase.from('tarefas_logistica').update({
        bike_id_atual: newBikeId.trim(),
      }).eq('id', tarefaId);

      setMsg(pick(T.success));
      onSwapped?.(newBikeId.trim());
      setTimeout(onClose, 1000);
    } catch (e: any) {
      setMsg(`${pick(T.error)}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const S = {
    overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    dialog: { background: '#111827', borderRadius: 12, padding: 20, width: 340, maxWidth: '90vw', border: '1px solid rgba(255,255,255,.1)' },
    title: { fontSize: 15, fontWeight: 700, color: '#dce8ff', marginBottom: 16 },
    lbl: { fontSize: 11, color: 'rgba(255,255,255,.4)', display: 'block' as const, marginBottom: 4 },
    inp: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 13, boxSizing: 'border-box' as const, outline: 'none' },
    select: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: '#0d1521', color: '#fff', fontSize: 12, colorScheme: 'dark' as const },
    row: { marginBottom: 12 },
    btns: { display: 'flex', gap: 8, marginTop: 16 },
    btn: (primary: boolean) => ({
      flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
      cursor: busy ? 'wait' : 'pointer',
      background: primary ? '#10b981' : 'rgba(255,255,255,.08)',
      color: primary ? '#fff' : 'rgba(255,255,255,.5)',
      opacity: (primary && !newBikeId.trim()) ? 0.5 : 1,
    }),
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={e => e.stopPropagation()}>
        <div style={S.title}>{pick(T.title)}</div>

        <div style={S.row}>
          <label style={S.lbl}>{pick(T.current)}</label>
          <div style={{ ...S.inp, background: 'rgba(239,68,68,.08)', color: '#f87171' }}>{bikeIdAtual}</div>
        </div>

        <div style={S.row}>
          <label style={S.lbl}>{pick(T.newBike)}</label>
          <input
            style={S.inp}
            value={newBikeId}
            onChange={e => setNewBikeId(e.target.value)}
            placeholder="Ex: 12345"
            autoFocus
          />
        </div>

        <div style={S.row}>
          <label style={S.lbl}>{pick(T.reason)}</label>
          <select style={S.select} value={motivo} onChange={e => setMotivo(e.target.value as any)}>
            {MOTIVOS.map(m => (
              <option key={m} value={m}>{pick(T[m])}</option>
            ))}
          </select>
        </div>

        {msg && (
          <div style={{ fontSize: 12, color: msg.includes('!') && !msg.includes('Erro') ? '#10b981' : '#ef4444', marginBottom: 8 }}>
            {msg}
          </div>
        )}

        <div style={S.btns}>
          <button style={S.btn(false)} onClick={onClose}>{pick(T.cancel)}</button>
          <button style={S.btn(true)} onClick={doSwap} disabled={busy || !newBikeId.trim()}>
            {busy ? '⏳' : pick(T.confirm)}
          </button>
        </div>
      </div>
    </div>
  );
}
