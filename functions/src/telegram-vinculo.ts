import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomBytes } from 'crypto';
import { supaAdmin } from './lib/supabase-admin';
import { supabaseGet, supabaseGetOne, supabaseInsert, supabaseUpdate } from './lib/supabase-rest';

// functions/src/telegram-vinculo.ts
// Cloud Functions para vincular Telegram ao usuário JET OS
// Migrado para Supabase (telegram_vinculos, usuarios, telegram_config).

async function getBotTokenSupa(): Promise<string> {
  const { data } = await supaAdmin().from('telegram_config').select('bot_token').eq('id', 'global').maybeSingle();
  return data?.bot_token ?? '';
}

async function getChatIdSupa(firebaseUid: string): Promise<string | null> {
  const { data } = await supaAdmin().from('usuarios').select('telegram_chat_id').eq('firebase_uid', firebaseUid).maybeSingle();
  return data?.telegram_chat_id ?? null;
}


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

        // Busca token do bot — Supabase
        const botRow = await supabaseGetOne<any>('telegram_config', 'select=bot_token&id=eq.global');
        const botToken = botRow?.bot_token ?? '';
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
            const tok = await supabaseGetOne<any>('telegram_vinculos', `select=*&id=eq.${param}`);
            const valido = tok && tok.uid && !tok.usado
              && new Date(tok.expira_em) > new Date();
            if (!valido) {
              await sendMsg(`⚠️ Link de vinculação inválido ou expirado.\nGere um novo no JET OS ("Vincular com 1 toque").`);
              res.json({ ok: true }); return;
            }
            // Conflito: este Telegram já está em OUTRA conta?
            const jaQ = await supabaseGet<any>('usuarios', `select=id,uid&telegram_chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);
            if (jaQ && jaQ.length > 0 && jaQ[0].uid !== tok.uid) {
              await sendMsg(`⚠️ Este Telegram já está vinculado a outra conta JET OS.\nEnvie /desvincular antes de vincular a uma nova conta.`);
              res.json({ ok: true }); return;
            }
            const now = new Date().toISOString();
            await supabaseUpdate('usuarios', {
              telegram_chat_id:      chatId,
              telegram_vinculado_em: now,
              telegram_modo:         'deeplink',
              atualizado_em:         now,
            }, `uid=eq.${encodeURIComponent(tok.uid)}`);
            await supabaseUpdate('telegram_vinculos', { usado: true }, `id=eq.${param}`);
            const uRow = await supabaseGetOne<any>('usuarios', `select=nome&uid=eq.${encodeURIComponent(tok.uid)}`);
            await sendMsg(`✅ Conta vinculada com sucesso, <b>${uRow?.nome ?? firstName}</b>!\n\nVocê já pode fechar esta conversa — as notificações do JET OS chegam aqui.`);
            res.json({ ok: true }); return;
          }

          // ── Fluxo legado (sem token): gera código de 6 dígitos p/ digitar no app ──
          const codigo = String(Math.floor(100000 + Math.random() * 900000));
          const expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

          await supabaseInsert('telegram_vinculos', {
            id: codigo,
            chat_id: chatId,
            first_name: firstName,
            expira_em: expiraEm.toISOString(),
            criado_em: new Date().toISOString(),
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
          const qRows = await supabaseGet<any>('usuarios', `select=nome,role&telegram_chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);

          if (qRows && qRows.length > 0) {
            const u = qRows[0];
            await sendMsg(`✅ Você está vinculado como <b>${u.nome}</b> (${u.role})`);
          } else {
            await sendMsg(`❌ Nenhuma conta JET OS vinculada a este Telegram.\nAbra o JET OS e use o botão de vincular.`);
          }

        } else if (text === '/desvincular') {
          const qRows = await supabaseGet<any>('usuarios', `select=id,uid&telegram_chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);

          if (qRows && qRows.length > 0) {
            await supabaseUpdate('usuarios', {
              telegram_chat_id: null,
              telegram_vinculado_em: null,
            }, `id=eq.${encodeURIComponent(qRows[0].id)}`);
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

export const validarVinculoTelegram = onCall({ region:'southamerica-east1', maxInstances:10, cors:true }, async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária');
    }

    const { codigo } = request.data;
    if (!codigo || typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
      throw new HttpsError('invalid-argument', 'Código inválido');
    }

    const vinculo = await supabaseGetOne<any>('telegram_vinculos', `select=*&id=eq.${encodeURIComponent(codigo)}`);

    if (!vinculo) {
      throw new HttpsError('not-found', 'Código não encontrado');
    }

    // Verifica se já foi usado
    if (vinculo.usado) {
      throw new HttpsError('already-exists', 'Código já utilizado');
    }

    // Verifica expiração
    if (new Date(vinculo.expira_em) < new Date()) {
      await supabaseUpdate('telegram_vinculos', { usado: true }, `id=eq.${encodeURIComponent(codigo)}`);
      throw new HttpsError('deadline-exceeded', 'Código expirado. Envie /start novamente.');
    }

    const chatId = vinculo.chat_id;
    const uid    = request.auth!.uid;

    // Verifica se esse chatId já está vinculado a OUTRO usuário
    const qRows = await supabaseGet<any>('usuarios', `select=id,uid&telegram_chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);

    if (qRows && qRows.length > 0 && qRows[0].uid !== uid) {
      throw new HttpsError(
        'already-exists',
        'Este Telegram já está vinculado a outra conta JET OS'
      );
    }

    // Tudo ok — salva no usuário e marca código como usado
    const now = new Date().toISOString();
    await Promise.all([
      supabaseUpdate('usuarios', {
        telegram_chat_id:      chatId,
        telegram_vinculado_em: now,
        telegram_modo:         'codigo',
        atualizado_em:         now,
      }, `uid=eq.${encodeURIComponent(uid)}`),
      supabaseUpdate('telegram_vinculos', { usado: true }, `id=eq.${encodeURIComponent(codigo)}`),
    ]);

    // Notifica no próprio Telegram que vinculou
    const botTokenRow = await supabaseGetOne<any>('telegram_config', 'select=bot_token&id=eq.global');
    const botToken = botTokenRow?.bot_token ?? '';
    const userRow = await supabaseGetOne<any>('usuarios', `select=nome&uid=eq.${encodeURIComponent(uid)}`);
    const userName = userRow?.nome ?? 'usuário';

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

    return { sucesso: true, chatId };
  });

// ─── FUNCTION: iniciarVinculoTelegram (onCall — deep-link 1-toque) ────────────
// O app (autenticado) gera um token ligado ao uid e devolve o deep-link
// t.me/<bot>?start=<token>. O usuário toca → Telegram manda /start <token> →
// telegramWebhook vincula direto (sem digitar código, sem voltar ao app).
export const iniciarVinculoTelegram = onCall({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária');
  const uid = request.auth.uid;

  const token    = randomBytes(16).toString('hex'); // 32 hex, não-adivinhável
  const expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await supabaseInsert('telegram_vinculos', {
    id:        token,
    uid,
    modo:      'deeplink',
    expira_em: expiraEm.toISOString(),
    criado_em: new Date().toISOString(),
    usado:     false,
  });

  // Busca botUsername do Supabase
  const cfgRow = await supabaseGetOne<any>('telegram_config', 'select=bot_username&id=eq.global');
  const botUsername = String(cfgRow?.bot_username || '').replace(/^@/, '');
  const deepLink    = botUsername ? `https://t.me/${botUsername}?start=${token}` : '';

  return { token, deepLink, botUsername };
});

// ─── FUNCTION: notificarAprovacaoPrestador (onCall — chamado pelo app) ────────

export const notificarAprovacaoPrestador = onCall({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Autenticação necessária');
  }

  const { uid, aprovado, motivo } = request.data as { uid: string; aprovado: boolean; motivo?: string };

  const chatId = await getChatIdSupa(uid);
  if (!chatId) return { enviado: false, motivo: 'sem_chatid' };

  const botToken = await getBotTokenSupa();

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

export const notificarStatusNF = onCall({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
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

  const chatId = await getChatIdSupa(uid);
  if (!chatId) return { enviado: false };

  const botToken = await getBotTokenSupa();
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

export const notificarTarefaAtribuida = onCall({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária');

  const { assigneeUid, titulo, kind, parkingNome, cidade } = request.data as {
    assigneeUid: string; tarefaId?: string; titulo: string;
    kind: string; parkingNome?: string; cidade?: string;
  };

  const chatId = await getChatIdSupa(assigneeUid);
  if (!chatId) return { enviado: false, motivo: 'sem_chatid' };

  const botToken = await getBotTokenSupa();
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
