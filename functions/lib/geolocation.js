"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePrestadorPosition = updatePrestadorPosition;
// functions/src/geolocation.ts — firebase-functions v2
const https_1 = require("firebase-functions/v2/https");
const supabase_rest_1 = require("./lib/supabase-rest");
async function updatePrestadorPosition(data, context) {
    try {
        const { uid, latitude, longitude, slotId } = data;
        if (!uid || !latitude || !longitude || !slotId)
            throw new Error('Dados incompletos');
        const position = { lat: latitude, lng: longitude };
        await (0, supabase_rest_1.supabaseUpsert)('slot_prestadores', {
            slot_id: slotId,
            uid,
            position,
            timestamp: new Date().toISOString(),
        }, 'slot_id,uid');
        const slot = await (0, supabase_rest_1.supabaseGetOne)('slots', `select=*&id=eq.${encodeURIComponent(slotId)}`);
        if (!slot?.poligonoPontos)
            return { success: true };
        const dentroDaZona = estaEntroPol(position, slot.poligonoPontos);
        const prestData = await (0, supabase_rest_1.supabaseGetOne)('slot_prestadores', `select=*&slot_id=eq.${encodeURIComponent(slotId)}&uid=eq.${encodeURIComponent(uid)}`);
        if (prestData?.dentroDaZona !== dentroDaZona) {
            await (0, supabase_rest_1.supabaseUpdate)('slot_prestadores', {
                dentroDaZona,
                mudouEstadoEm: new Date().toISOString(),
            }, `slot_id=eq.${encodeURIComponent(slotId)}&uid=eq.${encodeURIComponent(uid)}`);
            if (!dentroDaZona && prestData?.dentroDaZona) {
                console.log(`Prestador ${uid} SAIU da zona ${slot.zone}`);
            }
        }
        return { success: true, dentroDaZona };
    }
    catch (error) {
        console.error('Erro ao atualizar posição:', error);
        throw new https_1.HttpsError('internal', error.message);
    }
}
function estaEntroPol(ponto, poligono) {
    let dentro = false;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
        const p1 = poligono[i];
        const p2 = poligono[j];
        if (p1.lng > ponto.lng !== p2.lng > ponto.lng &&
            ponto.lat < ((p2.lat - p1.lat) * (ponto.lng - p1.lng)) / (p2.lng - p1.lng) + p1.lat)
            dentro = !dentro;
    }
    return dentro;
}
//# sourceMappingURL=geolocation.js.map