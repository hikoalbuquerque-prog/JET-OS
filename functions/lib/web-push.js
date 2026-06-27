"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarPushSubscription = void 0;
exports.enviarPushParaUsuario = enviarPushParaUsuario;
exports.enviarPushParaRole = enviarPushParaRole;
const functions = __importStar(require("firebase-functions"));
const https_1 = require("firebase-functions/v2/https");
const web_push_1 = __importDefault(require("web-push"));
const supabase_rest_1 = require("./lib/supabase-rest");
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:h.albuquerque@jetshr.com.br';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    web_push_1.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
exports.registrarPushSubscription = (0, https_1.onCall)({ region: 'southamerica-east1', maxInstances: 10, cors: true }, async (request) => {
    const { uid, endpoint, p256dh, auth } = request.data ?? {};
    if (!uid || !endpoint || !p256dh || !auth) {
        return { ok: false, error: 'missing_fields' };
    }
    await (0, supabase_rest_1.supabaseInsert)('push_subscriptions', {
        uid, endpoint, p256dh, auth,
        atualizado_em: new Date().toISOString(),
    });
    return { ok: true };
});
async function enviarPushParaUsuario(uid, titulo, corpo, dados) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
        functions.logger.warn('[web-push] VAPID keys não configuradas');
        return 0;
    }
    const subs = await (0, supabase_rest_1.supabaseGet)('push_subscriptions', `select=endpoint,p256dh,auth&uid=eq.${encodeURIComponent(uid)}`);
    if (!subs?.length)
        return 0;
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
            await web_push_1.default.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
            enviados++;
        }
        catch (e) {
            if (e.statusCode === 410 || e.statusCode === 404) {
                functions.logger.info('[web-push] subscription expirada, removendo:', sub.endpoint.slice(0, 50));
            }
            else {
                functions.logger.warn('[web-push] erro ao enviar:', e.statusCode, e.message);
            }
        }
    }
    return enviados;
}
async function enviarPushParaRole(role, titulo, corpo, cidade) {
    const roles = Array.isArray(role) ? role : [role];
    let query = `select=id&role=in.(${roles.join(',')})`;
    if (cidade)
        query += `&cidade=eq.${encodeURIComponent(cidade)}`;
    const usuarios = await (0, supabase_rest_1.supabaseGet)('usuarios', query);
    if (!usuarios?.length)
        return 0;
    let total = 0;
    for (const u of usuarios) {
        total += await enviarPushParaUsuario(u.id, titulo, corpo);
    }
    return total;
}
//# sourceMappingURL=web-push.js.map