// Offline queue — stores failed API calls in localStorage, replays when online

const QUEUE_KEY = 'jet_offline_queue';

interface QueueItem {
  id: string;
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  createdAt: number;
  retries: number;
}

function getQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch { return []; }
}

function saveQueue(q: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function enqueue(url: string, method: string, body: any, headers: Record<string, string> = {}) {
  const q = getQueue();
  q.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url, method,
    body: JSON.stringify(body),
    headers,
    createdAt: Date.now(),
    retries: 0,
  });
  saveQueue(q);
}

export function queueSize(): number {
  return getQueue().length;
}

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  const q = getQueue();
  if (!q.length) return { ok: 0, failed: 0 };

  let ok = 0;
  const remaining: QueueItem[] = [];

  for (const item of q) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        body: item.body,
        headers: { 'Content-Type': 'application/json', ...item.headers },
      });
      if (res.ok || res.status === 409) {
        ok++;
      } else if (item.retries < 5) {
        remaining.push({ ...item, retries: item.retries + 1 });
      }
    } catch {
      if (item.retries < 5) {
        remaining.push({ ...item, retries: item.retries + 1 });
      }
    }
  }

  saveQueue(remaining);
  return { ok, failed: remaining.length };
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}

// Auto-flush when back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setTimeout(() => flushQueue(), 2000);
  });
}
