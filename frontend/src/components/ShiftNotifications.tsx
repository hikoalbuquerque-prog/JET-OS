// ShiftNotifications.tsx — Listener de turnos em tempo real
// Para gestores: mostra toast quando worker registra entrada/saída
// Para workers: mostra status do próprio turno em tempo real

import { useEffect, useCallback } from 'react';
import {
  collection, query, where, orderBy, limit, onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

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
  useEffect(() => {
    if (!cidade) return;

    // Gestores veem todos da cidade; workers veem só os próprios
    const q = isGestor
      ? query(
          collection(db, 'turnos'),
          where('cidade', '==', cidade),
          orderBy('registradoEm', 'desc'),
          limit(1),
        )
      : query(
          collection(db, 'turnos'),
          where('uid', '==', userUid),
          orderBy('registradoEm', 'desc'),
          limit(1),
        );

    // Guarda o timestamp de quando o listener foi montado
    const mountedAt = Date.now();
    let primeiraLeitura = true;

    return onSnapshot(q, snap => {
      // Ignora a leitura inicial (dados já existentes)
      if (primeiraLeitura) { primeiraLeitura = false; return; }

      snap.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const data = change.doc.data();
        const ts = data.registradoEm?.toMillis?.() ?? 0;
        // Só notifica eventos gerados após o mount
        if (ts < mountedAt - 5000) return;
        onEvento({ id: change.doc.id, ...data } as TurnoEvento);
      });
    });
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
