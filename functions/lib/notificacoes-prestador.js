"use strict";
// functions/src/notificacoes-prestador.ts
// Notifica gestores via Telegram quando nova solicitação de prestador chega.
// Convertido de trigger Firestore para função exportável chamada inline.
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificarGestorNovaSolicitacao = notificarGestorNovaSolicitacao;
const supabase_admin_1 = require("./lib/supabase-admin");
const web_push_1 = require("./web-push");
const ROLES_GESTORES = ['admin', 'gestor', 'supergestor', 'gestor_log'];
async function notificarGestorNovaSolicitacao(solicitacao) {
    try {
        const { nome = '—', cargo = '—', cidade = '—', email = '—' } = solicitacao;
        const supa = (0, supabase_admin_1.supaAdmin)();
        const { data: cfg } = await supa.from('telegram_config').select('bot_token').eq('id', 'global').maybeSingle();
        const botToken = cfg?.bot_token ?? '';
        if (!botToken) {
            console.warn('[notificarGestorNovaSolicitacao] botToken não configurado');
            return;
        }
        const { data: gestores } = await supa.from('usuarios')
            .select('telegram_chat_id')
            .in('role', ROLES_GESTORES)
            .not('telegram_chat_id', 'is', null);
        if (!gestores?.length)
            return;
        const mensagem = `📋 <b>Nova solicitação de prestador</b>\n\n` +
            `Nome: ${nome}\n` +
            `Cargo: ${cargo}\n` +
            `Cidade: ${cidade}\n` +
            `Email: ${email}\n\n` +
            `Acesse o painel de usuários para aprovar ou rejeitar.`;
        const envios = gestores.map(async (u) => {
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: u.telegram_chat_id,
                        text: mensagem,
                        parse_mode: 'HTML',
                    }),
                });
            }
            catch (e) {
                console.error('[notificarGestorNovaSolicitacao] Falha ao enviar para', u.telegram_chat_id, e);
            }
        });
        await Promise.all(envios);
        (0, web_push_1.enviarPushParaRole)(ROLES_GESTORES, '📋 Nova solicitação', `${nome} — ${cargo} (${cidade})`).catch(() => { });
        console.log(`[notificarGestorNovaSolicitacao] Notificação enviada para ${envios.length} gestores`);
    }
    catch (e) {
        console.error('[notificarGestorNovaSolicitacao] Erro geral:', e);
    }
}
//# sourceMappingURL=notificacoes-prestador.js.map