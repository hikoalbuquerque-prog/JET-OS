// functions/src/gps-historico.ts
// Grava pontos GPS no histórico (gps_logistica_hist) para anti-fraude
// Trigger: onDocumentWritten em gps_logistica/{uid}
// O documento gps_logistica/{uid} é o ponto ATUAL (sobrescrito a cada ping)
// gps_logistica_hist/{uid}/pontos/{timestamp} armazena o histórico completo
//
// IMPORTANTE: O frontend também deve gravar em gps_logistica_hist ao enviar GPS.
// Ver patch App.tsx / TarefasLogisticaModule.tsx ao final deste arquivo.

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── Trigger: novo ponto GPS → salva no histórico ────────────────────────────

export const gravarGpsHistorico = functions.firestore.onDocumentWritten(
  { document: 'gps_logistica/{uid}', region: 'southamerica-east1' },
  async (event) => {
    const uid = event.params.uid;
    const after = event.data?.after;
    if (!after?.exists) return; // documento deletado

    const data = after.data();
    if (!data?.lat || !data?.lng) return;

    const ponto = {
      uid,
      lat:         data.lat,
      lng:         data.lng,
      nome:        data.nome || '',
      cidade:      data.cidade || '',
      tarefaAtual: data.tarefaAtual || null,
      criadoEm:    data.criadoEm || admin.firestore.FieldValue.serverTimestamp(),
      gravadoEm:   admin.firestore.FieldValue.serverTimestamp(),
    };

    // Salva em subcoleção por uid para não virar uma coleção gigante flat
    await db
      .collection('gps_logistica_hist')
      .doc(uid)
      .collection('pontos')
      .add(ponto);

    // Limpeza automática: manter só últimas 24h de histórico por uid
    // (evita crescimento infinito — roda a cada 100 pontos aprox)
    if (Math.random() < 0.01) {
      const limite24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const velhos = await db
        .collection('gps_logistica_hist')
        .doc(uid)
        .collection('pontos')
        .where('criadoEm', '<', admin.firestore.Timestamp.fromDate(limite24h))
        .limit(200)
        .get();
      const batch = db.batch();
      velhos.docs.forEach(d => batch.delete(d.ref));
      if (!velhos.empty) await batch.commit();
    }
  }
);

// ─── Callable: buscar histórico de um operador (para anti-fraude) ────────────

export const buscarGpsHistorico = functions.https.onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const { uid, horas = 8 } = request.data as { uid: string; horas?: number };

    if (!uid) return { ok: false, erro: 'uid obrigatório' };

    const desde = new Date(Date.now() - horas * 60 * 60 * 1000);

    const snap = await db
      .collection('gps_logistica_hist')
      .doc(uid)
      .collection('pontos')
      .where('criadoEm', '>=', admin.firestore.Timestamp.fromDate(desde))
      .orderBy('criadoEm', 'asc')
      .limit(500)
      .get();

    const pontos = snap.docs.map(d => {
      const data = d.data();
      return {
        lat:      data.lat,
        lng:      data.lng,
        criadoEm: data.criadoEm?.toMillis?.() ?? null,
        cidade:   data.cidade || '',
      };
    });

    // Calcular distâncias entre pontos consecutivos para detectar anomalias
    const analise = [];
    for (let i = 1; i < pontos.length; i++) {
      const p1 = pontos[i - 1];
      const p2 = pontos[i];
      const km = distKm(p1.lat, p1.lng, p2.lat, p2.lng);
      const dtMs = (p2.criadoEm || 0) - (p1.criadoEm || 0);
      const dtMin = dtMs / 60000;
      const kmh = dtMin > 0 ? km / (dtMin / 60) : 0;

      analise.push({
        idx: i,
        lat: p2.lat, lng: p2.lng,
        criadoEm: p2.criadoEm,
        distKm: Math.round(km * 1000) / 1000,
        intervaloMin: Math.round(dtMin * 10) / 10,
        velocidadeKmh: Math.round(kmh),
        anomalia: km > 2 && dtMin < 5, // > 2km em < 5min = suspeito
      });
    }

    const anomalias = analise.filter(a => a.anomalia);

    return {
      ok: true,
      pontos,
      analise,
      anomalias,
      totalPontos: pontos.length,
      temAnomalias: anomalias.length > 0,
    };
  }
);

function distKm(la1: number, ln1: number, la2: number, ln2: number): number {
  const R = 6371;
  const dL = (la2 - la1) * Math.PI / 180;
  const dN = (ln2 - ln1) * Math.PI / 180;
  const a = Math.sin(dL / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/*
──────────────────────────────────────────────────────────────────────────────
PATCH: TarefasLogisticaModule.tsx — gravar GPS também em gps_logistica_hist

No arquivo frontend/src/components/TarefasLogisticaModule.tsx,
na função startGPSTracking (ou onde você chama setDoc/updateDoc em gps_logistica),
adicione também uma gravação na subcoleção:

import { addDoc, collection as fsCol } from 'firebase/firestore';

// Dentro do watchPosition callback, após o setDoc/updateDoc existente:
await addDoc(fsCol(db, 'gps_logistica_hist', uid, 'pontos'), {
  uid,
  lat, lng,
  nome: usuario.nome || '',
  cidade: usuario.cidade || '',
  criadoEm: serverTimestamp(),
});

Isso garante que o histórico seja gravado mesmo se a Cloud Function
estiver em cold start.
──────────────────────────────────────────────────────────────────────────────
*/
