// functions/src/geolocation.ts — firebase-functions v2
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export async function updatePrestadorPosition(data: any, context: any) {
  try {
    const { uid, latitude, longitude, slotId } = data;
    if (!uid || !latitude || !longitude || !slotId) throw new Error('Dados incompletos');

    const position = { lat: latitude, lng: longitude };

    await db.collection('slots').doc(slotId)
      .collection('prestadores').doc(uid)
      .set({ position, timestamp: new Date(), uid }, { merge: true });

    const slotSnap = await db.collection('slots').doc(slotId).get();
    const slot = slotSnap.data();
    if (!slot?.poligonoPontos) return { success: true };

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
  } catch (error: any) {
    console.error('Erro ao atualizar posição:', error);
    throw new HttpsError('internal', error.message);
  }
}

function estaEntroPol(ponto: any, poligono: any[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const p1 = poligono[i];
    const p2 = poligono[j];
    if (
      p1.lng > ponto.lng !== p2.lng > ponto.lng &&
      ponto.lat < ((p2.lat - p1.lat) * (ponto.lng - p1.lng)) / (p2.lng - p1.lng) + p1.lat
    ) dentro = !dentro;
  }
  return dentro;
}
