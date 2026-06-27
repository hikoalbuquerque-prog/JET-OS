import * as admin from 'firebase-admin';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAppSetting } from './config-supabase';

// functions/src/slots.ts
// Cloud Functions para módulo Slots + Logística + Telegram
// Adicionar ao index.ts: export * from './slots';
//
// Requer no Firebase Functions config (ou Secret Manager):
//   firebase functions:config:set telegram.bot_token="SEU_TOKEN"
// OU via Secret Manager (recomendado prod):
//   defineSecret('TELEGRAM_BOT_TOKEN') no index.ts




const db = admin.firestore();

// ─── CORS helper (mesmo padrão do index.ts existente) ────────────────────────

function addCORS(res: any) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

// ─── Helpers Telegram ────────────────────────────────────────────────────────

interface TelegramTarget {
  chatId: string;
  threadId?: number | null;
}

async function getBotToken(): Promise<string> {
  try {
    // Supabase config_telegram (where DashboardManager saves)
    const supaCfg = await getAppSetting<Record<string, any>>('config_telegram');
    const cfgToken = String(supaCfg?.bot_token || supaCfg?.botToken || '').trim();
    if (cfgToken) return cfgToken;

    // Supabase app_settings/telegram (legacy key)
    const supa = await getAppSetting<Record<string, any>>('telegram');
    const supaToken = String(supa?.bot_token || supa?.botToken || '').trim();
    if (supaToken) return supaToken;

    // Supabase telegram_config table
    const { getTelegramConfigSupa } = await import('./telegram-supabase');
    const tgCfg = await getTelegramConfigSupa('global');
    return String(tgCfg?.bot_token || '').trim();
  } catch {
    return '';
  }
}

async function sendTelegram(
  token: string,
  target: TelegramTarget,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<boolean> {
  if (!token || !target.chatId) return false;
  try {
    const body: any = {
      chat_id: target.chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    };
    if (target.threadId) {
      body.message_thread_id = target.threadId;
    }
    const resp = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const json = await resp.json() as any;
    if (!json.ok) {
      console.error('[telegram] sendMessage error:', json.description);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[telegram] fetch error:', e);
    return false;
  }
}

// ─── Roteamento inteligente ───────────────────────────────────────────────────

interface CidadeGrupo {
  chatId: string;
  nome: string;
  topicos: Record<string, number>;
}

interface CidadeConfig {
  grupos: Record<string, CidadeGrupo>;
  gestores: Array<{ uid: string; nome: string; cargo: string; nivel: string }>;
}

interface ConfigGlobal {
  botToken:    string;
  guardChatId?: string;
  diretoria:   Array<{ uid: string; nome: string }>;
  regionais:   Array<{ uid: string; nome: string; regioes?: string[] }>;
}

// Mapeia cargo para grupo e tópico
const CARGO_PARA_GRUPO: Record<string, { grupo: string; topico: string }> = {
  charger:   { grupo: 'logistica', topico: 'charger' },
  scalt:     { grupo: 'logistica', topico: 'scalt' },
  promotor:  { grupo: 'promo',     topico: 'promotor' },
  fiscal:    { grupo: 'promo',     topico: 'fiscal' },
  seguranca: { grupo: 'seguranca', topico: 'seguranca' },
};

async function getConfig(): Promise<{ global: ConfigGlobal; cidades: Record<string, CidadeConfig> }> {
  // Supabase telegram_config table
  let supaTgCfg: Record<string, any> | null = null;
  try {
    const { getTelegramConfigSupa } = await import('./telegram-supabase');
    supaTgCfg = await getTelegramConfigSupa('global');
  } catch { /* fallback */ }

  const [supaCfgTelegram, supaTelegram] = await Promise.all([
    getAppSetting<Record<string, any>>('config_telegram'),
    getAppSetting<Record<string, any>>('telegram'),
  ]);

  // Prioridade: Supabase telegram_config → app_settings/config_telegram → app_settings/telegram
  const botToken = (
    supaTgCfg?.bot_token ||
    supaCfgTelegram?.bot_token || supaCfgTelegram?.botToken ||
    supaTelegram?.bot_token || supaTelegram?.botToken || '') as string;

  const guardChatId = (
    supaTgCfg?.guard_chat_id || supaTgCfg?.relatorios_chat_id ||
    supaCfgTelegram?.chat_id || supaCfgTelegram?.relatoriosChatId ||
    supaTelegram?.relatorios_chat_id || supaTelegram?.relatoriosChatId || supaTelegram?.chat_id || '') as string;

  const globalCfg: ConfigGlobal = {
    botToken,
    diretoria: supaTgCfg?.diretoria ?? [],
    regionais: supaTgCfg?.regionais ?? [],
    guardChatId,
  };

  // Cidades from Supabase telegram_config
  const cidadesSupa = (supaTgCfg?.cidades && typeof supaTgCfg.cidades === 'object')
    ? supaTgCfg.cidades as Record<string, CidadeConfig>
    : {};

  return {
    global: globalCfg,
    cidades: cidadesSupa,
  };
}

function cidadeParaChave(cidade: string): string {
  return cidade
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

// Envia para um cargo específico na cidade (tópico do cargo)
async function notificarCargo(
  token: string,
  cidadeConfig: CidadeConfig,
  cargo: string,
  texto: string
) {
  const mapeamento = CARGO_PARA_GRUPO[cargo];
  if (!mapeamento) return;
  const grupo = cidadeConfig.grupos[mapeamento.grupo];
  if (!grupo?.chatId) return;
  const threadId = grupo.topicos[mapeamento.topico] ?? null;
  await sendTelegram(token, { chatId: grupo.chatId, threadId }, texto);
}

// Envia para o tópico de alertas da cidade
async function notificarAlertas(
  token: string,
  cidadeConfig: CidadeConfig,
  texto: string
) {
  for (const grupo of Object.values(cidadeConfig.grupos)) {
    if (!grupo.chatId) continue;
    const threadId = grupo.topicos['alertas'] ?? null;
    await sendTelegram(token, { chatId: grupo.chatId, threadId }, texto);
    break; // só envia no primeiro grupo que tiver alertas
  }
}

// Envia para líderes e gerentes da cidade
async function notificarGestoresCidade(
  token: string,
  cidadeConfig: CidadeConfig,
  texto: string,
  nivel?: string
) {
  const gestores = nivel
    ? cidadeConfig.gestores.filter(g => g.nivel === nivel)
    : cidadeConfig.gestores;

  for (const g of gestores) {
    // Tenta enviar DM via chat_id guardado no doc do usuário
    const userDoc = await db.collection('usuarios').doc(g.uid).get();
    const telegramChatId = userDoc.data()?.telegramChatId;
    if (telegramChatId) {
      await sendTelegram(token, { chatId: telegramChatId }, texto);
    }
  }
}

// Envia para diretoria e regionais (alertas críticos)
async function notificarDiretoria(
  token: string,
  globalCfg: ConfigGlobal,
  texto: string
) {
  const todos = [...globalCfg.diretoria, ...globalCfg.regionais];
  for (const g of todos) {
    const userDoc = await db.collection('usuarios').doc(g.uid).get();
    const telegramChatId = userDoc.data()?.telegramChatId;
    if (telegramChatId) {
      await sendTelegram(token, { chatId: telegramChatId }, texto);
    }
  }
}

// ─── FUNCTION: aceitarSlot (onCall — autenticado) ────────────────────────────

export const aceitarSlot = onCall(async (request) => {
    // Verificação de autenticação
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária');
    }

    const { slotId } = request.data;
    if (!slotId || typeof slotId !== 'string') {
      throw new HttpsError('invalid-argument', 'slotId é obrigatório');
    }

    const uid = request.auth!.uid;
    const slotRef = db.collection('slots').doc(slotId);
    const userRef = db.collection('usuarios').doc(uid);

    // Busca dados do operador
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'Usuário não encontrado');
    }
    const userData = userSnap.data()!;

    // Verifica se é prestador ativo
    if (userData.statusPrestador !== 'ativo') {
      throw new HttpsError('permission-denied', 'Prestador inativo');
    }

    // Transação atômica — garante que só um operador aceita
    let slotData: any;
    try {
      await db.runTransaction(async tx => {
        const slotSnap = await tx.get(slotRef);
        if (!slotSnap.exists) {
          throw new HttpsError('not-found', 'Slot não encontrado');
        }

        slotData = slotSnap.data()!;

        if (slotData.status !== 'aberto') {
          throw new HttpsError(
            'failed-precondition',
            slotData.status === 'aceito'
              ? 'Este slot já foi aceito por outro operador'
              : `Slot não está disponível (status: ${slotData.status})`
          );
        }

        // Verifica se o cargo bate
        if (slotData.cargo !== userData.cargoPrestador) {
          throw new HttpsError(
            'permission-denied',
            `Este slot é para ${slotData.cargo}, seu cargo é ${userData.cargoPrestador}`
          );
        }

        // Escreve atomicamente
        tx.update(slotRef, {
          status: 'aceito',
          aceitoPor: uid,
          aceitoPorNome: userData.nome,
          aceitoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(userRef, {
          slotAtualId: slotId,
          ultimaAtividade: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (e: any) {
      // Re-throw HttpsError direto
      if (e instanceof HttpsError) throw e;
      console.error('[aceitarSlot] transaction error:', e);
      throw new HttpsError('internal', 'Erro ao aceitar slot');
    }

    // Telegram — não bloqueia a resposta
    setImmediate(async () => {
      try {
        const { global: globalCfg, cidades } = await getConfig();
        if (!globalCfg.botToken) return;

        const cidadeKey = cidadeParaChave(slotData.cidade);
        const cidadeCfg = cidades[cidadeKey];
        if (!cidadeCfg) return;

        const emoji = slotData.cargo === 'charger' ? '⚡'
          : slotData.cargo === 'scalt' ? '📦'
          : slotData.cargo === 'promotor' ? '📢'
          : slotData.cargo === 'fiscal' ? '🔍'
          : slotData.cargo === 'seguranca' ? '🛡' : '👤';

        const texto = `${emoji} <b>Slot aceito</b>\n\n`
          + `👤 ${userData.nome}\n`
          + `📋 ${slotData.titulo}\n`
          + `🏙 ${slotData.cidade}\n`
          + `⏰ ${new Date(slotData.turnoInicio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
          + ` → ${new Date(slotData.turnoFim).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

        // 1. Tópico do cargo
        await notificarCargo(globalCfg.botToken, cidadeCfg, slotData.cargo, texto);

        // 2. Líderes da cidade (DM)
        await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto, 'lider');

      } catch (e) {
        console.error('[aceitarSlot] telegram error:', e);
      }
    });

    return { sucesso: true, slotId };
  });

// ─── FUNCTION: notificarOcorrencia (onCall) ───────────────────────────────────

export const notificarOcorrencia = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária');
    }

    const { ocorrenciaId, statusAtualizado } = request.data;
    if (!ocorrenciaId) {
      throw new HttpsError('invalid-argument', 'ocorrenciaId obrigatório');
    }

    const ocSnap = await db.collection('ocorrencias').doc(ocorrenciaId).get();
    if (!ocSnap.exists) {
      throw new HttpsError('not-found', 'Ocorrência não encontrada');
    }

    const oc = ocSnap.data()!;
    const { global: globalCfg, cidades } = await getConfig();
    if (!globalCfg.botToken) return { enviado: false, motivo: 'bot_token_ausente' };

    const cidadeRaw = oc.cidade || (oc as any).cidade_inicial || '';
    const cidadeKey = cidadeParaChave(cidadeRaw);
    const cidadeCfg = cidades[cidadeKey];

    const tipoLabel: Record<string, string> = {
      // Keys módulo Slots (lowercase)
      roubo:                  '🚨 ROUBO',
      vandalismo:             '🔨 Vandalismo',
      patinete_danificado:    '🛴 Patinete danificado',
      ponto_bloqueado:        '🚧 Ponto bloqueado',
      usuario_infrator:       '⚠️ Usuário infrator',
      outro:                  '📝 Ocorrência',
      // Keys Guard (capitalizadas)
      Roubo:                  '🚨 ROUBO',
      Tentativa:              '🟠 Tentativa de roubo',
      Vandalismo:             '🟡 Vandalismo',
      Recuperacao:            '🟢 Recuperação',
      Outro:                  '📝 Ocorrência',
    };

    // Urgente: roubos/tentativas, procurados, OU quando status muda para Recuperado
    const statusFinal = statusAtualizado || oc.status;
    const isRecuperado = statusFinal === 'Recuperado' && statusAtualizado;
    const urgente = ['Roubo','roubo','Tentativa','tentativa'].includes(oc.tipo)
      || !!oc.procurando || isRecuperado;
    const tipoEmoji = tipoLabel[oc.tipo] ?? '📝 Ocorrência';

    const assetInfo = [oc.asset_id, oc.ativo_tipo, oc.patineteId]
      .filter(Boolean).join(' · ');

    const texto = [
      isRecuperado ? '✅ *RECUPERADO*' : (urgente ? '🚨 *ALERTA URGENTE*' : ''),
      '',
      `${tipoEmoji}`,
      '',
      `👤 *${oc.registradoPorNome || 'Guard'}*${oc.turno ? ' · ' + oc.turno : ''}`,
      `🏙 ${cidadeRaw}${oc.bairro_inicial ? ' / ' + oc.bairro_inicial : ''}`,
      assetInfo ? `🛴 ${assetInfo}` : '',
      oc.procurando && oc.procurando !== 'false'
        ? `\n🔍 *PROCURANDO:* ${typeof oc.procurando === 'string' ? oc.procurando : 'Em aberto'}`
        : '',
      oc.bo_numero ? `📋 BO: ${oc.bo_numero}` : '',
      '',
      oc.descricao ? `_${String(oc.descricao).slice(0, 300)}_` : '',
      '',
      `🕐 ${new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}`,
      `🆔 ${ocorrenciaId}`,
    ].filter(l => l !== '').join('\n');

    let enviouAlgum = false;

    // 1. Envia para cidade configurada (sistema hierárquico)
    if (cidadeCfg) {
      if (urgente) {
        await notificarAlertas(globalCfg.botToken, cidadeCfg, texto);
        await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto);
        await notificarDiretoria(globalCfg.botToken, globalCfg, texto);
      } else {
        const cargoOcorrencia = oc.cargo || 'seguranca';
        await notificarCargo(globalCfg.botToken, cidadeCfg, cargoOcorrencia, texto);
      }
      enviouAlgum = true;
    }

    // 2. Fallback: sempre envia Roubo/Tentativa/Procurado para grupo Guard Reports
    // (config/telegram chat_id) independente de cidade configurada
    const guardChatId = (globalCfg as any).guardChatId;
    if (urgente && guardChatId && globalCfg.botToken) {
      try {
        await sendTelegram(globalCfg.botToken, { chatId: guardChatId, threadId: null }, texto);
        enviouAlgum = true;
        console.log('[notificar] Alerta enviado para Guard Reports:', guardChatId);
      } catch (e: any) {
        console.error('[notificar] Erro Guard Reports:', e.message);
      }
    }

    if (!enviouAlgum) {
      console.warn('[notificar] Sem destino configurado para', cidadeRaw);
    }

    // Marca como enviado
    await db.collection('ocorrencias').doc(ocorrenciaId).update({
      telegramEnviado: true,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { enviado: true, urgente };
  });

// ─── FUNCTION: notificarTarefa (onCall) ──────────────────────────────────────

export const notificarTarefa = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária');
    }

    const { tarefaId, evento } = request.data;
    // evento: 'concluida' | 'rejeitada' | 'iniciada'
    if (!tarefaId || !evento) {
      throw new HttpsError('invalid-argument', 'tarefaId e evento obrigatórios');
    }

    const tSnap = await db.collection('tarefas').doc(tarefaId).get();
    if (!tSnap.exists) {
      throw new HttpsError('not-found', 'Tarefa não encontrada');
    }

    const t = tSnap.data()!;
    const { global: globalCfg, cidades } = await getConfig();
    if (!globalCfg.botToken) return { enviado: false };

    const cidadeKey = cidadeParaChave(t.cidade);
    const cidadeCfg = cidades[cidadeKey];
    if (!cidadeCfg) return { enviado: false, motivo: 'cidade_sem_config' };

    const eventoLabel: Record<string, string> = {
      concluida:  '✅ Tarefa concluída',
      rejeitada:  '❌ Tarefa rejeitada',
      iniciada:   '▶️ Tarefa iniciada',
    };

    const texto = `${eventoLabel[evento] ?? '📋 Tarefa atualizada'}\n\n`
      + `📋 ${t.titulo}\n`
      + `👤 ${t.assigneeNome ?? 'Sem operador'}\n`
      + `🏙 ${t.cidade}\n`
      + (t.motivoRejeicao ? `💬 Motivo: ${t.motivoRejeicao}\n` : '')
      + (t.estacao ? `📍 ${t.estacao.nome}\n` : '');

    // Conclui/rejeita: notifica líder e gerente
    if (evento === 'concluida' || evento === 'rejeitada') {
      await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto);
    } else {
      // Iniciada: só líder
      await notificarGestoresCidade(globalCfg.botToken, cidadeCfg, texto, 'lider');
    }

    return { enviado: true };
  });

// ─── FUNCTION: testarTelegram (onRequest — admin only) ────────────────────────

export const testarTelegram = onRequest((req, res) => {
    addCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    (async () => {
      try {
        // Verifica token Firebase do caller
        const auth = req.headers.authorization;
        if (!auth?.startsWith('Bearer ')) {
          res.status(401).json({ erro: 'Não autorizado' });
          return;
        }
        const token = auth.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(token);

        // Verifica se é admin
        const userDoc = await db.collection('usuarios').doc(decoded.uid).get();
        if (!['admin', 'gestor'].includes(userDoc.data()?.role)) {
          res.status(403).json({ erro: 'Permissão negada' });
          return;
        }

        const { chatId, topicId } = req.body;
        const botToken = await getBotToken();

        if (!botToken) {
          res.status(400).json({ erro: 'Bot token não configurado' });
          return;
        }

        const ok = await sendTelegram(
          botToken,
          { chatId, threadId: topicId ?? null },
          '✅ <b>JET OS</b> — Teste de notificação\n\nConfiguração funcionando corretamente.'
        );

        res.json({ enviado: ok });
      } catch (e: any) {
        console.error('[testarTelegram]', e);
        res.status(500).json({ erro: e.message });
      }
    })();
  });

// ─── FUNCTION: registrarTelegramChatId (onCall) ──────────────────────────────
// Operador chama essa função após iniciar conversa com o bot
// O bot envia /start e o app salva o chatId do operador para DMs

export const registrarTelegramChatId = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária');
    }

    const { telegramChatId } = request.data;
    if (!telegramChatId) {
      throw new HttpsError('invalid-argument', 'telegramChatId obrigatório');
    }

    await db.collection('usuarios').doc(request.auth!.uid).update({
      telegramChatId: String(telegramChatId),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { sucesso: true };
  });
