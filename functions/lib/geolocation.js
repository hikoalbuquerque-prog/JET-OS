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
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePrestadorPosition = updatePrestadorPosition;
// functions/src/geolocation.ts — firebase-functions v2
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
async function updatePrestadorPosition(data, context) {
    try {
        const { uid, latitude, longitude, slotId } = data;
        if (!uid || !latitude || !longitude || !slotId)
            throw new Error('Dados incompletos');
        const position = { lat: latitude, lng: longitude };
        await db.collection('slots').doc(slotId)
            .collection('prestadores').doc(uid)
            .set({ position, timestamp: new Date(), uid }, { merge: true });
        const slotSnap = await db.collection('slots').doc(slotId).get();
        const slot = slotSnap.data();
        if (!slot?.poligonoPontos)
            return { success: true };
        const dentroDaZona = estaEntroPol(position, slot.poligonoPontos);
        const prestSnap = await db.collection('slots').doc(slotId)
            .collection('prestadores').doc(uid).get();
        const prestData = prestSnap.data();
        if (prestData?.dentroDaZona !== dentroDaZona) {
            await db.collection('slots').doc(slotId)
                .collection('prestadores').doc(uid)
                .update({ dentroDaZona, mudouEstadoEm: new Date() });
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