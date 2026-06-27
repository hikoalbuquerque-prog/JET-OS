import * as functions from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import webpush from 'web-push';
import { supabaseGet, supabaseInsert } from './lib/supabase-rest';

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:h.albuquerque@jetshr.com.br';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export const registrarPushSubscription = onCall(
  { region: 'southamerica-east1', maxInstances: 10, cors: true },
  async (request) => {
    const { uid, endpoint, p256dh, auth } = request.data ?? {};
    if (!uid || !endpoint || !p256dh || !auth) {
      return { ok: false, error: 'missing_fields' };
    }

    await supabaseInsert('push_subscriptions', {
      uid, endpoint, p256dh, auth,
      atualizado_em: new Date().toISOString(),
    });

    return { ok: true };
  }
);

export async function enviarPushParaUsuario(
  uid: string,
  titulo: string,
  corpo: string,
  dados?: Record<string, string>
): Promise<number> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    functions.logger.warn('[web-push] VAPID keys não configuradas');
    return 0;
  }

  const subs = await supabaseGet<{ endpoint: string; p256dh: string; auth: string }>(
    'push_subscriptions',
    `select=endpoint,p256dh,auth&uid=eq.${encodeURIComponent(uid)}`
  );

  if (!subs?.length) return 0;

  const payload = JSON.stringify({
    title: titulo,
    body: corpo,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: dados ?? {},
  });

  let enviados = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      enviados++;
    } catch (e: any) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        functions.logger.info('[web-push] subscription expirada, removendo:', sub.endpoint.slice(0, 50));
      } else {
        functions.logger.warn('[web-push] erro ao enviar:', e.statusCode, e.message);
      }
    }
  }

  return enviados;
}

export async function enviarPushParaRole(
  role: string | string[],
  titulo: string,
  corpo: string,
  cidade?: string
): Promise<number> {
  const roles = Array.isArray(role) ? role : [role];
  let query = `select=id&role=in.(${roles.join(',')})`;
  if (cidade) query += `&cidade=eq.${encodeURIComponent(cidade)}`;

  const usuarios = await supabaseGet<{ id: string }>('usuarios', query);
  if (!usuarios?.length) return 0;

  let total = 0;
  for (const u of usuarios) {
    total += await enviarPushParaUsuario(u.id, titulo, corpo);
  }
  return total;
}
