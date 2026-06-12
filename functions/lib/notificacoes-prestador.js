"use strict";
// functions/src/notificacoes-prestador.ts
// Notifica gestores via Telegram quando nova solicitação de prestador chega
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificarGestorNovaSolicitacao = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const db = admin.firestore();
const ROLES_GESTORES = ['admin', 'gestor', 'supergestor', 'gestor_log'];
exports.notificarGestorNovaSolicitacao = (0, firestore_1.onDocumentCreated)({ document: 'solicitacoes_prestadores/{docId}', region: 'southamerica-east1' }, async (event) => {
    try {
        const data = event.data?.data();
        if (!data)
            return;
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
        if (gestoresSnap.empty)
            return;
        const mensagem = `📋 <b>Nova solicitação de prestador</b>\n\n` +
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
            }
            catch (e) {
                console.error('[notificarGestorNovaSolicitacao] Falha ao enviar para', u.telegramChatId, e);
            }
        });
        await Promise.all(envios);
        console.log(`[notificarGestorNovaSolicitacao] Notificação enviada para ${envios.length} gestores`);
    }
    catch (e) {
        console.error('[notificarGestorNovaSolicitacao] Erro geral:', e);
    }
});
//# sourceMappingURL=notificacoes-prestador.js.map