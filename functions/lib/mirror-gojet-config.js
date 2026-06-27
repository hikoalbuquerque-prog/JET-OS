"use strict";
// functions/src/mirror-gojet-config.ts
// Dual-write server-side (strangler) da coleção "gojet_config" Firestore → Supabase.
// Tabela: public.gojet_config (cidade PK, city_id, ativo).
// Doc ID no Firestore = nome da cidade = chave primária no Supabase.
// onDocumentWritten: após-existe → upsert por cidade; deletado → delete por cidade.
// Segredos (functions/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE. No-op se ausentes.
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
exports.espelharGojetConfigSupabase = void 0;
const functions = __importStar(require("firebase-functions"));
const firestore_1 = require("firebase-functions/v2/firestore");
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';
const HDR = () => ({ apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` });
exports.espelharGojetConfigSupabase = (0, firestore_1.onDocumentWritten)({ document: 'gojet_config/{cidade}', region: 'southamerica-east1', maxInstances: 10 }, async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
        return;
    const cidade = event.params.cidade;
    const after = event.data?.after;
    // Deletado no Firestore → remove do Supabase
    if (!after?.exists) {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/gojet_config?cidade=eq.${encodeURIComponent(cidade)}`, { method: 'DELETE', headers: HDR() });
        }
        catch (e) {
            functions.logger.error('[mirror-gojet-config] delete:', e);
        }
        return;
    }
    const d = after.data();
    const cityId = typeof d.cityId === 'string' ? d.cityId.trim() : '';
    if (!cityId) {
        functions.logger.warn(`[mirror-gojet-config] ${cidade} sem cityId — pulado`);
        return;
    }
    const row = {
        cidade,
        city_id: cityId,
        ativo: d.ativo !== false,
    };
    try {
        // Upsert by cidade (PK) — PostgREST on_conflict on PK
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/gojet_config?on_conflict=cidade`, {
            method: 'POST',
            headers: { ...HDR(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(row),
        });
        if (!resp.ok)
            functions.logger.error(`[mirror-gojet-config] upsert ${resp.status}:`, await resp.text().catch(() => ''));
    }
    catch (e) {
        functions.logger.error('[mirror-gojet-config] upsert net:', e);
    }
});
//# sourceMappingURL=mirror-gojet-config.js.map