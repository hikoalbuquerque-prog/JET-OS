// functions/src/notificacoes-prestador.ts
// Notifica gestores via Telegram quando nova solicitação de prestador chega

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

const db = admin.firestore();

const ROLES_GESTORES = ['admin', 'gestor', 'supergestor', 'gestor_log'];

export const notificarGestorNovaSolicitacao = onDocumentCreated(
  { document: 'solicitacoes_prestadores/{docId}', region: 'southamerica-east1' },
  async (event) => {
    try {
      const data = event.data?.data();
      if (!data) return;

      const { nome = '—', cargo = '—', cidade = '—', email = '—' } = data;

      // Buscar botToken
      const cfgSnap = await db.collection('telegram_config').doc('global').get();
      const botToken = cfgSnap.data()?.botToken ?? '';
      if (!botToken) {
        console.warn('[notificarGestorNovaSolicitacao] botToken não configurado');
        return;
      }

      // Buscar todos os gestores/admins
      const gestoresSnap = await db.collection('usuarios')
        .where('role', 'in', ROLES_GESTORES)
        .get();

      if (gestoresSnap.empty) return;

      const mensagem =
        `📋 <b>Nova solicitação de prestador</b>\n\n` +
        `Nome: ${nome}\n` +
        `Cargo: ${cargo}\n` +
        `Cidade: ${cidade}\n` +
        `Email: ${email}\n\n` +
        `Acesse o painel de usuários para aprovar ou rejeitar.`;

      const envios = gestoresSnap.docs
        .map(d => d.data())
        .filter(u => u.telegramChatId)
        .map(async (u) => {
          try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: u.telegramChatId,
                text: mensagem,
                parse_mode: 'HTML',
              }),
            });
          } catch (e) {
            console.error('[notificarGestorNovaSolicitacao] Falha ao enviar para', u.telegramChatId, e);
          }
        });

      await Promise.all(envios);
      console.log(`[notificarGestorNovaSolicitacao] Notificação enviada para ${envios.length} gestores`);
    } catch (e) {
      console.error('[notificarGestorNovaSolicitacao] Erro geral:', e);
    }
  }
);
