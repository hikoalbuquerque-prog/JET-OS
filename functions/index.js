// relatorio_telegram_firestore.js
// Cloud Function (Node.js) que replica o relatório diário do JET Guard
// lendo do Firestore ao invés do Google Sheets.
// Mantém o mesmo formato de mensagem e envia pelo mesmo bot Telegram.
//
// Deploy:
//   firebase deploy --only functions:sendDailyGuardReport
//
// Ou adicione este arquivo ao seu projeto de functions existente.

'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const https      = require('https');

// ── CONFIG ────────────────────────────────────────────────────────
// Lê de variáveis de ambiente — defina em functions/.env.guard
function getCfg() {
  return {
    botToken:  cfg.bot_token  || process.env.GUARD_BOT_TOKEN  || '8634177750:AAH58aVDNnQBTvXZxPiuBBbQoBvLTQ25_KA',
    chatId:    cfg.chat_id    || process.env.GUARD_CHAT_ID    || '-1003838241500',
    threadId:  process.env.GUARD_THREAD_ID || '',
    timezone:  'America/Sao_Paulo',
    horaEnvio: 7,
  };
}

// ── TELEGRAM ──────────────────────────────────────────────────────
function telegramRequest(method, payload) {
  const cfg  = getCfg();
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${cfg.botToken}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendMessage(text) {
  const cfg = getCfg();
  const payload = {
    chat_id:    cfg.chatId,
    text,
    parse_mode: 'HTML',
  };
  if (cfg.threadId) payload.message_thread_id = parseInt(cfg.threadId, 10);
  return telegramRequest('sendMessage', payload);
}

// ── HELPERS ───────────────────────────────────────────────────────
function fmtDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

function yesterday(tz) {
  const now   = new Date();
  // início de ontem 00:00
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  // fim de ontem 23:59:59
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function emoji(tipo) {
  const m = { Roubo:'🔴', Tentativa:'🟠', Vandalismo:'🟡', Recuperacao:'🟢', Outro:'⚪' };
  return m[tipo] || '⚪';
}

// ── BUILDER DA MENSAGEM ───────────────────────────────────────────
function buildMessage(ocorrencias, period) {
  const total     = ocorrencias.length;
  const abertos   = ocorrencias.filter(o => /aberto|apurac/i.test(o.status)).length;
  const encerrados= ocorrencias.filter(o => /encerr|recuper/i.test(o.status)).length;
  const criticos  = ocorrencias.filter(o => o.prioridade === 'Critica').length;

  // Agrupa por tipo
  const porTipo = {};
  ocorrencias.forEach(o => {
    porTipo[o.tipo] = (porTipo[o.tipo] || 0) + 1;
  });

  // Agrupa por cidade
  const porCidade = {};
  ocorrencias.forEach(o => {
    const c = o.cidade_inicial || 'Sem cidade';
    porCidade[c] = (porCidade[c] || 0) + 1;
  });
  const topCidades = Object.entries(porCidade)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Alertas automáticos
  const alertas = [];
  if (criticos > 0)       alertas.push(`⚠️ <b>${criticos} ocorrência(s) crítica(s)</b> no período.`);
  if (abertos > 0)        alertas.push(`🔓 ${abertos} ocorrência(s) ainda abertas/em apuração.`);
  if (total === 0)        alertas.push('✅ Nenhuma ocorrência registrada no período.');
  if (topCidades.length && topCidades[0][1] / Math.max(total, 1) > 0.5)
    alertas.push(`📍 Mais de 50% das ocorrências em <b>${topCidades[0][0]}</b>.`);

  const dataLabel = fmtDate(period.start);

  let msg = '';
  msg += `🛡 <b>JET Guard · Relatório Diário</b>\n`;
  msg += `📅 ${dataLabel}\n\n`;

  msg += `<b>📊 Resumo do dia</b>\n`;
  msg += `• Total: <b>${total}</b>\n`;
  msg += `• Abertos / Em apuração: <b>${abertos}</b>\n`;
  msg += `• Encerrados / Recuperados: <b>${encerrados}</b>\n`;
  msg += `• Críticos: <b>${criticos}</b>\n\n`;

  if (Object.keys(porTipo).length) {
    msg += `<b>📋 Por tipo</b>\n`;
    Object.entries(porTipo).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
      msg += `${emoji(t)} ${t}: <b>${c}</b>\n`;
    });
    msg += '\n';
  }

  if (topCidades.length) {
    msg += `<b>📍 Por cidade</b>\n`;
    topCidades.forEach(([cidade, count], i) => {
      msg += `${i + 1}. ${cidade}: <b>${count}</b>\n`;
    });
    msg += '\n';
  }

  if (alertas.length) {
    msg += `<b>🚨 Alertas</b>\n`;
    alertas.forEach(a => msg += `${a}\n`);
    msg += '\n';
  }

  // Últimas ocorrências (máx 5 críticas)
  const recentes = ocorrencias
    .filter(o => o.prioridade === 'Critica' || /aberto/i.test(o.status))
    .slice(0, 5);

  if (recentes.length) {
    msg += `<b>🔴 Ocorrências críticas / abertas</b>\n`;
    recentes.forEach((o, i) => {
      msg += `${i + 1}. ${emoji(o.tipo)} <b>${o.tipo}</b>`;
      if (o.asset_id) msg += ` · ${o.asset_id}`;
      if (o.bairro_inicial || o.cidade_inicial) msg += `\n   📍 ${[o.bairro_inicial, o.cidade_inicial].filter(Boolean).join(', ')}`;
      if (o.registradoPorNome) msg += `\n   👤 ${o.registradoPorNome}`;
      msg += '\n\n';
    });
  }

  msg += `<i>JET Guard · Gerado automaticamente</i>`;
  return msg;
}

// ── CLOUD FUNCTION ────────────────────────────────────────────────
exports.sendDailyGuardReport = functions
  .region('southamerica-east1')  // São Paulo
  .pubsub
  .schedule('0 7 * * *')         // Todos os dias às 7h
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const cfg = getCfg();
    if (!cfg.botToken || !cfg.chatId) {
      console.error('Telegram não configurado. Use firebase functions:config:set guard.bot_token=... guard.chat_id=...');
      return null;
    }

    const db     = admin.firestore();
    const period = yesterday('America/Sao_Paulo');

    console.log(`Buscando ocorrências de ${period.start.toISOString()} até ${period.end.toISOString()}`);

    const snap = await db.collection('ocorrencias')
      .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(period.start))
      .where('criadoEm', '<=', admin.firestore.Timestamp.fromDate(period.end))
      .orderBy('criadoEm', 'desc')
      .get();

    const ocorrencias = snap.docs.map(d => d.data());
    console.log(`${ocorrencias.length} ocorrências encontradas`);

    const message = buildMessage(ocorrencias, period);
    await sendMessage(message);
    console.log('Relatório enviado com sucesso');

    return null;
  });

// ── FUNÇÃO MANUAL (para testar) ───────────────────────────────────
exports.testGuardReport = functions
  .region('southamerica-east1')
  .https.onCall(async (data, context) => {
    // Apenas admin pode chamar
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

    const db     = admin.firestore();
    const period = yesterday('America/Sao_Paulo');

    const snap = await db.collection('ocorrencias')
      .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(period.start))
      .where('criadoEm', '<=', admin.firestore.Timestamp.fromDate(period.end))
      .orderBy('criadoEm', 'desc')
      .get();

    const ocorrencias = snap.docs.map(d => d.data());
    const message     = buildMessage(ocorrencias, period);
    await sendMessage(message);

    return { ok: true, total: ocorrencias.length };
  });