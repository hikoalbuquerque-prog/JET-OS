// gps-queue.ts — Fila offline de pontos GPS para envio posterior
// Portado do V2 gps-queue.ts — usa localStorage (web) em vez de Capacitor Preferences
// Funciona em PWA + app nativo (Capacitor Preferences é overlay do localStorage no nativo)

export interface QueuedPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  capturedAt: string; // ISO
  uid: string;
  attempts: number;
}

const STORAGE_KEY  = 'jet:gps-queue-v1';
const MAX_QUEUE    = 1000;
const MAX_ATTEMPTS = 5;

function load(): QueuedPoint[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch { return []; }
}

function save(q: QueuedPoint[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(q)); } catch { /* storage full */ }
}

/** Adiciona ponto que falhou ao enviar */
export function enqueuePoint(p: Omit<QueuedPoint, 'attempts'>): void {
  const q = load();
  if (q.length >= MAX_QUEUE) q.shift(); // descarta mais antigo
  q.push({ ...p, attempts: 0 });
  save(q);
}

/** Retorna quantos pontos estão na fila */
export function queueSize(): number {
  return load().length;
}

/** Tenta enviar pontos da fila. sendFn deve retornar true se enviou com sucesso. */
export async function drainQueue(
  sendFn: (p: QueuedPoint) => Promise<boolean>,
  batchSize = 20,
): Promise<{ sent: number; failed: number; queueLeft: number }> {
  let q = load();
  if (q.length === 0) return { sent: 0, failed: 0, queueLeft: 0 };

  const batch = q.slice(0, batchSize);
  const remaining = q.slice(batchSize);
  const keep: QueuedPoint[] = [...remaining];
  let sent = 0, failed = 0;

  for (const point of batch) {
    try {
      const ok = await sendFn(point);
      if (ok) { sent++; }
      else {
        point.attempts++;
        if (point.attempts < MAX_ATTEMPTS) keep.push(point);
        else failed++; // descarta após MAX_ATTEMPTS
      }
    } catch {
      point.attempts++;
      if (point.attempts < MAX_ATTEMPTS) keep.push(point);
      else failed++;
    }
  }

  save(keep);
  return { sent, failed, queueLeft: keep.length };
}

/** Limpa toda a fila (usar somente em logout) */
export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}
