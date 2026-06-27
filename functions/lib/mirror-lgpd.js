"use strict";
// functions/src/mirror-lgpd.ts
// Dual-write server-side: Firestore consentimentos_lgpd -> Supabase public.consentimentos_lgpd
// Documentos sao IMUTAVEIS no Firestore (create-only, sem update/delete), mas o mirror
// trata todos os eventos por seguranca (onDocumentWritten).
//
// Campos Firestore: uid, email, nome, role, versao, aceito_em, dispositivo, idioma
// Mapeados 1:1 para snake_case (ja sao snake_case no Firestore).
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
exports.espelharConsentimentoLgpdSupabase = void 0;
const functions = __importStar(require("firebase-functions"));
const firestore_1 = require("firebase-functions/v2/firestore");
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';
const str = (v) => (typeof v === 'string' && v.trim()) ? v : null;
exports.espelharConsentimentoLgpdSupabase = (0, firestore_1.onDocumentWritten)({ document: 'consentimentos_lgpd/{id}', region: 'southamerica-east1', maxInstances: 10 }, async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
        return;
    const id = event.params.id;
    const hdr = {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    };
    const after = event.data?.after;
    // Deletado no Firestore -> remove do Supabase (nao deveria acontecer, mas trata)
    if (!after?.exists) {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/consentimentos_lgpd?uid=eq.${encodeURIComponent(id.split('_v')[0])}&versao=eq.${encodeURIComponent(id.split('_v')[1] || '1')}`, { method: 'DELETE', headers: hdr });
        }
        catch (e) {
            functions.logger.error('[mirror-lgpd] delete:', e);
        }
        return;
    }
    const d = after.data();
    // Mapear versao: pode ser string "1.0" ou number 1
    let versao = 1;
    if (typeof d.versao === 'number')
        versao = d.versao;
    else if (typeof d.versao === 'string')
        versao = parseInt(d.versao, 10) || 1;
    // aceito_em: Firestore Timestamp -> ISO string
    let aceito_em = null;
    if (d.aceito_em && typeof d.aceito_em.toDate === 'function') {
        aceito_em = d.aceito_em.toDate().toISOString();
    }
    else if (typeof d.aceito_em === 'string') {
        aceito_em = d.aceito_em;
    }
    const row = {
        uid: str(d.uid),
        email: str(d.email),
        nome: str(d.nome),
        role: str(d.role),
        versao,
        aceito_em: aceito_em ?? new Date().toISOString(),
        dispositivo: str(d.dispositivo),
        idioma: str(d.idioma),
    };
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/consentimentos_lgpd?on_conflict=uid,versao`, {
            method: 'POST',
            headers: {
                ...hdr,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(row),
        });
        if (!resp.ok) {
            functions.logger.error(`[mirror-lgpd] upsert ${resp.status}:`, await resp.text().catch(() => ''));
        }
    }
    catch (e) {
        functions.logger.error('[mirror-lgpd] upsert net:', e);
    }
});
//# sourceMappingURL=mirror-lgpd.js.map