"use strict";
// functions/src/gps-ingest.ts
// Endpoint de ingestão de GPS para o rastreamento NATIVO em segundo plano (Android).
//
// O serviço nativo do APK coleta o GPS e faz POST direto deste endpoint — sem depender
// do JavaScript do WebView, que o Android congela quando o app é minimizado/fechado.
// Assim o rastreamento continua ao vivo mesmo com o app fechado.
//
// Autenticação: Authorization: Bearer <Firebase ID token>. O uid usado nas gravações
// vem SEMPRE do token verificado (nunca do corpo) — impede falsificação de identidade.
//
// Gravar em gps_logistica dispara o trigger verificarChegadaPonto (gps-alertas.ts),
// então toda a lógica de chegada/atraso/mapa ao vivo continua funcionando igual.
//
// Deploy: export * from './gps-ingest' no index.ts.
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
exports.ingestGps = void 0;
const functions = __importStar(require("firebase-functions"));
const https_1 = require("firebase-functions/v2/https");
const supabase_rest_1 = require("./lib/supabase-rest");
const gps_alertas_1 = require("./gps-alertas");
const MAX_PONTOS = 200;
exports.ingestGps = (0, https_1.onRequest)({ region: 'southamerica-east1', cors: true, memory: '256MiB', maxInstances: 10 }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
    }
    // 1. Autenticação por Firebase ID token
    const authz = String(req.headers.authorization || '');
    const m = authz.match(/^Bearer (.+)$/);
    if (!m) {
        res.status(401).json({ error: 'missing_token' });
        return;
    }
    let uid;
    try {
        const { uid: u } = await (0, supabase_rest_1.verifySupabaseToken)(m[1]);
        uid = u;
    }
    catch {
        res.status(401).json({ error: 'invalid_token' });
        return;
    }
    // 2. Validação do corpo
    const points = Array.isArray(req.body?.points) ? req.body.points : [];
    if (!points.length) {
        res.status(400).json({ error: 'no_points' });
        return;
    }
    if (points.length > MAX_PONTOS) {
        res.status(413).json({ error: 'too_many_points', max: MAX_PONTOS });
        return;
    }
    // 3. Collect points for Supabase bulk insert
    const gpsPoints = [];
    const histPoints = [];
    let written = 0;
    let ultima = null;
    for (const p of points) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number')
            continue;
        const capturedAt = typeof p.capturedAt === 'string' ? p.capturedAt : new Date().toISOString();
        const isMock = p.isMock === true;
        gpsPoints.push({
            uid,
            slot_id: p.slotId ?? null,
            lat: p.lat,
            lng: p.lng,
            accuracy: p.accuracy ?? null,
            speed: p.speed ?? null,
            heading: p.heading ?? null,
            altitude: p.altitude ?? null,
            bateria: p.bateria ?? null,
            captured_at: capturedAt,
            estrategia: p.estrategia ?? 'background_android_native',
            is_mock: isMock,
            criado_em: new Date().toISOString(),
        });
        histPoints.push({
            uid,
            lat: p.lat,
            lng: p.lng,
            accuracy: p.accuracy ?? null,
            captured_at: capturedAt,
            criado_em: new Date().toISOString(),
        });
        written++;
        ultima = p;
    }
    if (!written) {
        res.status(400).json({ error: 'no_valid_points' });
        return;
    }
    try {
        // Insert GPS points
        const okGps = await (0, supabase_rest_1.supabaseInsert)('gps_logistica', gpsPoints);
        if (!okGps) {
            functions.logger.error('[ingestGps] falha ao gravar gps_logistica', { uid });
            res.status(500).json({ error: 'write_failed' });
            return;
        }
        // Insert history points
        await (0, supabase_rest_1.supabaseInsert)('gps_logistica_hist', histPoints);
        // Update user's last position
        if (ultima) {
            await (0, supabase_rest_1.supabaseUpdate)('usuarios', {
                ultima_lat: ultima.lat,
                ultima_lng: ultima.lng,
                ultima_accuracy: ultima.accuracy ?? null,
                ultima_velocidade: ultima.speed ?? null,
                ultima_posicao_em: new Date().toISOString(),
                slot_atual_id: ultima.slotId ?? null,
                ultimo_is_mock: ultima.isMock === true,
            }, `id=eq.${encodeURIComponent(uid)}`);
        }
    }
    catch (e) {
        functions.logger.error('[ingestGps] falha ao gravar:', e?.message, { uid });
        res.status(500).json({ error: 'write_failed' });
        return;
    }
    // Trigger verificação de chegada + teleporte + geofencing (antes era trigger Firestore)
    if (ultima) {
        (0, gps_alertas_1.verificarChegadaPontoFn)(uid, ultima.lat, ultima.lng).catch(e => functions.logger.warn('[ingestGps] verificarChegadaPonto erro:', e));
    }
    res.status(200).json({ ok: true, written });
});
//# sourceMappingURL=gps-ingest.js.map