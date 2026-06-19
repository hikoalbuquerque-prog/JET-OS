import * as admin from 'firebase-admin';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomBytes } from 'crypto';

// functions/src/telegram-vinculo.ts
// Cloud Functions para vincular Telegram ao usuário JET OS
// Adicionar ao index.ts: export * from './telegram-vinculo';
//
// FLUXO COMPLETO:
//   1. Usuário abre bot → /start
//   2. Bot chama webhook /telegramWebhook com o chat_id e user_id do Telegram
//   3. Webhook gera código 6 dígitos e salva em telegram_vinculos/{codigo}
//   4. Bot responde ao usuário com o código
//   5. Usuário digita código no JET OS
//   6. validarVinculoTelegram verifica, salva telegramChatId no usuário, deleta código




const db = admin.firestore();

// ─── FUNCTION: telegramWebhook (onRequest — chamado pelo bot) ─────────────────
// Configurar no BotFather:
//   https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://southamerica-east1-jet-os-1.cloudfunctions.net/telegramWebhook

export const telegramWebhook = onRequest((req, res) => {
    (async () => {
      try {
        const update = req.body;

        // Só processa mensagens de texto
        const msg = update?.message;
        if (!msg?.text) { res.json({ ok: true }); return; }

        const chatId   = String(msg.chat.id);
        const text     = msg.text.trim();
        const firstName = msg.from?.first_name ?? 'usuário';

        // Busca token do bot
        const cfgSnap = await db.collection('telegram_config').doc('global').get();
        const botToken = cfgSnap.data()?.botToken ?? '';
        if (!botToken) { res.json({ ok: true }); return; }

        const sendMsg = async (txt: string) => {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: 'HTML' }),
          });
        };

        if (text === '/start' || text.startsWith('/start ')) {
          // ── Deep-link 1-toque: /start <token> (token de 32 hex gerado pelo app,
          // já ligado ao uid via iniciarVinculoTelegram). Vincula DIRETO, sem código. ──
          const param = text.startsWith('/start ') ? text.slice(7).trim() : '';
          if (/^[a-f0-9]{32}$/.test(param)) {
            const tokRef  = db.collection('telegram_vinculos').doc(param);
            const tokSnap = await tokRef.get();
            const tok     = tokSnap.data();
            const valido  = tokSnap.exists && tok?.uid && !tok.usado
              && tok.expiraEm?.toDate?.() > new Date();
            if (!valido) {
              await sendMsg(`⚠️ Link de vinculação inválido ou expirado.\nGere um novo no JET OS ("Vincular com 1 toque").`);
              res.json({ ok: true }); return;
            }
            // Conflito: este Telegram já está em OUTRA conta?
            const jaQ = await db.collection('usuarios')
              .where('telegramChatId', '==', chatId).limit(1).get();
            if (!jaQ.empty && jaQ.docs[0].id !== tok!.uid) {
              await sendMsg(`⚠️ Este Telegram já está vinculado a outra conta JET OS.\nEnvie /desvincular antes de vincular a uma nova conta.`);
              res.json({ ok: true }); return;
            }
            await db.collection('usuarios').doc(tok!.uid).update({
              telegramChatId:      chatId,
              telegramVinculadoEm: admin.firestore.FieldValue.serverTimestamp(),
              telegramModo:        'deeplink',
              atualizadoEm:        admin.firestore.FieldValue.serverTimestamp(),
            });
            await tokRef.delete();
            const uSnap = await db.collection('usuarios').doc(tok!.uid).get();
            await sendMsg(`✅ Conta vinculada com sucesso, <b>${uSnap.data()?.nome ?? firstName}</b>!\n\nVocê já pode fechar esta conversa — as notificações do JET OS chegam aqui.`);
            res.json({ ok: true }); return;
          }

          // ── Fluxo legado (sem token): gera código de 6 dígitos p/ digitar no app ──
          const codigo = String(Math.floor(100000 + Math.random() * 900000));
          const expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

          await db.collection('telegram_vinculos').doc(codigo).set({
            chatId,
            firstName,
            expiraEm: admin.firestore.Timestamp.fromDate(expiraEm),
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
            usado: false,
          });

          await sendMsg(
            `👋 Olá, <b>${firstName}</b>!\n\n`
            + `Seu código de vinculação JET OS:\n\n`
            + `<code>${codigo}</code>\n\n`
            + `⏱ Válido por 10 minutos.\n`
            + `Digite este código no JET OS para confirmar.`
          );

        } else if (text === '/status') {
          // Verifica se o chatId já está vinculado a algum usuário
          const q = await db.collection('usuarios')
            .where('telegramChatId', '==', chatId)
            .limit(1).get();

          if (!q.empty) {
            const u = q.docs[0].data();
            await sendMsg(`✅ Você está vinculado como <b>${u.nome}</b> (${u.role})`);
          } else {
            await sendMsg(`❌ Nenhuma conta JET OS vinculada a este Telegram.\nAbra o JET OS e use o botão de vincular.`);
          }

        } else if (text === '/desvincular') {
          const q = await db.collection('usuarios')
            .where('telegramChatId', '==', chatId)
            .limit(1).get();

          if (!q.empty) {
            await db.collection('usuarios').doc(q.docs[0].id).update({
              telegramChatId: null,
              telegramVinculadoEm: null,
            });
            await sendMsg(`✅ Conta desvinculada. Para vincular novamente, envie /start.`);
          } else {
            await sendMsg(`Nenhuma conta vinculada encontrada.`);
          }

        } else {
          await sendMsg(
            `Comandos disponíveis:\n`
            + `/start — gerar código de vinculação\n`
            + `/status — verificar conta vinculada\n`
            + `/desvincular — remover vinculação`
          );
        }

        res.json({ ok: true });
      } catch (e) {
        console.error('[telegramWebhook]', e);
        res.json({ ok: true }); // sempre 200 para o Telegram não retentar
      }
    })();
  });

// ─── FUNCTION: validarVinculoTelegram (onCall — chamado pelo app) ─────────────

export const validarVinculoTelegram = onCall({ region:'southamerica-east1', cors:true }, async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária');
    }

    const { codigo } = request.data;
    if (!codigo || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
      throw new HttpsError('invalid-argument', 'Código inválido');
    }

    const vinculoRef = db.collection('telegram_vinculos').doc(codigo);
    const vinculoSnap = await vinculoRef.get();

    if (!vinculoSnap.exists) {
      throw new HttpsError('not-found', 'Código não encontrado');
    }

    const vinculo = vinculoSnap.data()!;

    // Verifica se já foi usado
    if (vinculo.usado) {
      throw new HttpsError('already-exists', 'Código já utilizado');
    }

    // Verifica expiração
    const expiraEm: admin.firestore.Timestamp = vinculo.expiraEm;
    if (expiraEm.toDate() < new Date()) {
      await vinculoRef.delete();
      throw new HttpsError('deadline-exceeded', 'Código expirado. Envie /start novamente.');
    }

    const chatId = vinculo.chatId;
    const uid    = request.auth!.uid;

    // Verifica se esse chatId já está vinculado a OUTRO usuário
    const q = await db.collection('usuarios')
      .where('telegramChatId', '==', chatId)
      .limit(1).get();

    if (!q.empty && q.docs[0].id !== uid) {
      throw new HttpsError(
        'already-exists',
        'Este Telegram já está vinculado a outra conta JET OS'
      );
    }

    // Tudo ok — salva no usuário e marca código como usado
    await Promise.all([
      db.collection('usuarios').doc(uid).update({
        telegramChatId:      chatId,
        telegramVinculadoEm: admin.firestore.FieldValue.serverTimestamp(),
        telegramModo:        'codigo',
        atualizadoEm:        admin.firestore.FieldValue.serverTimestamp(),
      }),
      vinculoRef.update({ usado: true }),
    ]);

    // Notifica no próprio Telegram que vinculou
    const cfgSnap = await db.collection('telegram_config').doc('global').get();
    const botToken = cfgSnap.data()?.botToken ?? '';
    const userSnap = await db.collection('usuarios').doc(uid).get();
    const userName = userSnap.data()?.nome ?? 'usuário';

    if (botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `✅ Conta vinculada com sucesso!\n\n<b>${userName}</b>\nVocê receberá notificações do JET OS aqui.`,
          parse_mode: 'HTML',
        }),
      });
    }

    // Deleta o código (já usado)
    await vinculoRef.delete();

    return { sucesso: true, chatId };
  });

// ─── FUNCTION: iniciarVinculoTelegram (onCall — deep-link 1-toque) ────────────
// O app (autenticado) gera um token ligado ao uid e devolve o deep-link
// t.me/<bot>?start=<token>. O usuário toca → Telegram manda /start <token> →
// telegramWebhook vincula direto (sem digitar código, sem voltar ao app).
export const iniciarVinculoTelegram = onCall({ region: 'southamerica-east1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária');
  const uid = request.auth.uid;

  const token    = randomBytes(16).toString('hex'); // 32 hex, não-adivinhável
  const expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await db.collection('telegram_vinculos').doc(token).set({
    uid,
    modo:     'deeplink',
    expiraEm: admin.firestore.Timestamp.fromDate(expiraEm),
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    usado:    false,
  });

  const cfgSnap     = await db.collection('telegram_config').doc('global').get();
  const botUsername = String(cfgSnap.data()?.botUsername ?? '').replace(/^@/, '');
  const deepLink    = botUsername ? `https://t.me/${botUsername}?start=${token}` : '';

  return { token, deepLink, botUsername };
});

// ─── FUNCTION: notificarAprovacaoPrestador (onCall — chamado pelo app) ────────

export const notificarAprovacaoPrestador = onCall({ region: 'southamerica-east1', cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Autenticação necessária');
  }

  const { uid, aprovado, motivo } = request.data as { uid: string; aprovado: boolean; motivo?: string };

  // Busca o doc do usuário
  const usuarioSnap = await db.collection('usuarios').doc(uid).get();
  const usuario = usuarioSnap.data();
  const chatId = usuario?.telegramChatId;

  if (!chatId) {
    return { enviado: false, motivo: 'sem_chatid' };
  }

  // Busca o botToken
  const cfgSnap = await db.collection('telegram_config').doc('global').get();
  const botToken = cfgSnap.data()?.botToken ?? '';

  const texto = aprovado
    ? `🎉 Seu cadastro no JET OS foi <b>aprovado</b>!\n\nVocê já pode acessar o aplicativo com seu e-mail e senha cadastrados.\n\nBem-vindo(a) à equipe! 🚀`
    : `❌ Seu cadastro no JET OS não foi aprovado.\n\nMotivo: ${motivo ?? ''}\n\nEm caso de dúvidas, entre em contato com seu gestor.`;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
  });

  return { enviado: true };
});

// ─── FUNCTION: notificarStatusNF (onCall — chamado pelo app) ────────────────

export const notificarStatusNF = onCall({ region: 'southamerica-east1', cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Autenticação necessária');
  }

  const { uid, status, valorTotal, motivo, semana } = request.data as {
    uid: string;
    status: 'nf_aprovada' | 'rejeitada' | 'pago';
    valorTotal?: number;
    motivo?: string;
    semana?: string;
  };

  const usuarioSnap = await db.collection('usuarios').doc(uid).get();
  const chatId = usuarioSnap.data()?.telegramChatId;

  if (!chatId) {
    return { enviado: false };
  }

  const cfgSnap = await db.collection('telegram_config').doc('global').get();
  const botToken = cfgSnap.data()?.botToken ?? '';
  if (!botToken) return { enviado: false };

  let texto = '';
  if (status === 'nf_aprovada') {
    texto =
      `✅ Sua Nota Fiscal foi <b>aprovada</b>! Aguardando processamento do pagamento.\n\n` +
      `Semana: ${semana ?? '—'}\nValor: R$ ${valorTotal?.toFixed(2) ?? '—'}`;
  } else if (status === 'rejeitada') {
    texto =
      `❌ Sua Nota Fiscal foi <b>rejeitada</b>.\n\nMotivo: ${motivo ?? ''}\n\n` +
      `Envie uma nova NF corrigida no aplicativo.`;
  } else if (status === 'pago') {
    texto =
      `💰 Pagamento <b>realizado</b>! R$ ${valorTotal?.toFixed(2) ?? '—'} para a semana ${semana ?? '—'}. Obrigado!`;
  }

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
  });

  return { enviado: true };
});

// ─── FUNCTION: notificarTarefaAtribuida (onCall — chamado pelo app ao atribuir) ─

export const notificarTarefaAtribuida = onCall({ region: 'southamerica-east1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária');

  const { assigneeUid, titulo, kind, parkingNome, cidade } = request.data as {
    assigneeUid: string; tarefaId?: string; titulo: string;
    kind: string; parkingNome?: string; cidade?: string;
  };

  const usuarioSnap = await db.collection('usuarios').doc(assigneeUid).get();
  const chatId = usuarioSnap.data()?.telegramChatId;
  if (!chatId) return { enviado: false, motivo: 'sem_chatid' };

  const cfgSnap = await db.collection('telegram_config').doc('global').get();
  const botToken = cfgSnap.data()?.botToken ?? '';
  if (!botToken) return { enviado: false, motivo: 'sem_token' };

  const kindLabel: Record<string, string> = {
    PONTO: '📍 Encher ponto', PATINETE: '🛴 Mover patinete',
    ORGANIZACAO: '🧹 Organizar', CARGA_BATERIA: '🔋 Bateria baixa',
  };
  const { tarefaId } = request.data as { tarefaId?: string };
  const deepLink = tarefaId ? `\n\n🔗 <a href="https://jet-os-1.web.app/?tarefa=${tarefaId}">Abrir tarefa no JET OS</a>` : '\n\nAbra o JET OS para ver os detalhes e iniciar a execução.';
  const texto = [
    `📦 <b>Nova tarefa atribuída a você!</b>`,
    ``,
    `🏷 <b>Tipo:</b> ${kindLabel[kind] ?? kind}`,
    `📋 <b>Tarefa:</b> ${titulo}`,
    parkingNome ? `📍 <b>Ponto:</b> ${parkingNome}` : null,
    cidade ? `🏙 <b>Cidade:</b> ${cidade}` : null,
    deepLink,
  ].filter(Boolean).join('\n');

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
  });

  return { enviado: true };
});

// ─── ADICIONAR AO index.ts ──────────────────────────────────────────────────
// export * from './telegram-vinculo';

// ─── CONFIGURAR WEBHOOK do bot ───────────────────────────────────────────────
// Após deploy, executar UMA VEZ no browser ou curl:
//
// curl "https://api.telegram.org/bot{SEU_TOKEN}/setWebhook?url=https://southamerica-east1-jet-os-1.cloudfunctions.net/telegramWebhook"
//
// Resposta esperada: {"ok":true,"result":true,"description":"Webhook was set"}
//
// Para verificar: curl "https://api.telegram.org/bot{SEU_TOKEN}/getWebhookInfo"
