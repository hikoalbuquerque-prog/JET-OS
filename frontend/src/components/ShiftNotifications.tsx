// ShiftNotifications.tsx — Listener de turnos em tempo real
// Para gestores: mostra toast quando worker registra entrada/saída
// Para workers: mostra status do próprio turno em tempo real

import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export type TurnoAcao = 'entrada' | 'saida';

export interface TurnoEvento {
  id: string;
  uid: string;
  nome: string;
  acao: TurnoAcao;
  funcao: string;
  turno: string;
  cidade: string;
  registradoEm: any;
}

interface Props {
  cidade: string;
  isGestor: boolean;
  userUid: string;
  onEvento: (ev: TurnoEvento) => void;
}

/** Hook que escuta a coleção turnos e dispara callback em novos eventos */
export function useShiftNotifications({ cidade, isGestor, userUid, onEvento }: Props) {
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cidade) return;

    // ── Supabase: polling a cada 10s ──
    const mountedAt = new Date().toISOString();
    let cancelled = false;

    const poll = async () => {
      try {
        let q = supabase
          .from('turnos_logistica')
          .select('*')
          .gt('criado_em', mountedAt)
          .order('criado_em', { ascending: false })
          .limit(1);

        if (isGestor) {
          q = q.eq('cidade', cidade);
        } else {
          q = q.eq('firebase_uid', userUid);
        }

        const { data, error } = await q;
        if (error || cancelled || !data?.length) return;

        const row = data[0];
        const rowId = row.id ?? row.firebase_id;
        if (rowId === lastSeenRef.current) return;
        lastSeenRef.current = rowId;

        onEvento({
          id: row.firebase_id ?? row.id,
          uid: row.firebase_uid ?? '',
          nome: row.nome ?? '',
          acao: (row.acao === 'inicio' ? 'entrada' : row.acao === 'fim' ? 'saida' : row.acao) as TurnoAcao,
          funcao: row.funcao ?? '',
          turno: row.turno ?? '',
          cidade: row.cidade ?? '',
          registradoEm: row.criado_em ? { toDate: () => new Date(row.criado_em) } : null,
        });
      } catch (e) {
        console.error('[ShiftNotif] supabase poll error:', e);
      }
    };

    const timer = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [cidade, isGestor, userUid, onEvento]);
}

/** Formata mensagem de toast para o evento */
export function formatTurnoToast(ev: TurnoEvento): string {
  const emoji = ev.acao === 'entrada' ? '▶' : '⏹';
  const hora = ev.registradoEm?.toDate
    ? new Date(ev.registradoEm.toDate()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
  return `${emoji} ${ev.nome} — ${ev.acao} (${ev.funcao} · ${ev.turno})${hora ? ' · ' + hora : ''}`;
}
