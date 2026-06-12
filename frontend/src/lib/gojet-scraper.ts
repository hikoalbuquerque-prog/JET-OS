// frontend/src/lib/gojet-scraper.ts
// Scraping direto da API GoJet pelo browser (sem proxy).
// Funciona porque a API tem CORS aberto (access-control-allow-origin: *).
// Usado pelo botão "Atualizar agora" no GoJetOverlay.

import {
  collection, doc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

const GOJET_BASE = 'https://logistic.gojet.app/api/v0/urent';
const LIMIT = 1000;
const PARKING_CHUNK = 3000;
const BIKE_CHUNK    = 2000;

async function fetchAllPages<T>(endpoint: string, cityId: string): Promise<T[]> {
  let page = 1;
  let all: T[] = [];
  let totalPages = 1;

  do {
    const url = `${GOJET_BASE}/${endpoint}?city_id=${cityId}&page=${page}&limit=${LIMIT}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`GoJet ${endpoint} p${page}: HTTP ${res.status}`);
    const data = await res.json();
    const items: T[] = data.entries ?? data.items ?? data.data ?? (Array.isArray(data) ? data : []);
    all = all.concat(items);
    totalPages = data.total_pages ?? 1;
    page++;
  } while (page <= totalPages && page <= 50);

  return all;
}

async function salvarNoFirestore(
  parkings: any[], bikes: any[], cityId: string, cidade: string
): Promise<void> {
  const now = serverTimestamp();
  const col = collection(db, 'gojet_snapshots');
  const docId      = `latest_${cityId}`;
  const docIdBikes = `bikes_latest_${cityId}`;

  // ── Parkings ────────────────────────────────────────────────────────────────
  if (parkings.length <= PARKING_CHUNK) {
    await setDoc(doc(col, docId), { parkings, cityId, cidade, total: parkings.length, savedAt: now });
  } else {
    const totalChunks = Math.ceil(parkings.length / PARKING_CHUNK);
    for (let i = 0, chunk = 0; i < parkings.length; i += PARKING_CHUNK, chunk++) {
      await setDoc(doc(col, `${docId}_chunk${chunk}`), {
        parkings: parkings.slice(i, i + PARKING_CHUNK),
        chunk, totalChunks, cityId, cidade, savedAt: now,
      });
    }
    await setDoc(doc(col, docId), { chunked: true, totalChunks, cityId, cidade, total: parkings.length, savedAt: now });
  }

  // ── Bikes ────────────────────────────────────────────────────────────────────
  if (bikes.length <= BIKE_CHUNK) {
    await setDoc(doc(col, docIdBikes), { bikes, cityId, cidade, total: bikes.length, savedAt: now });
  } else {
    const totalChunks = Math.ceil(bikes.length / BIKE_CHUNK);
    for (let i = 0, chunk = 0; i < bikes.length; i += BIKE_CHUNK, chunk++) {
      await setDoc(doc(col, `${docIdBikes}_chunk${chunk}`), {
        bikes: bikes.slice(i, i + BIKE_CHUNK),
        chunk, totalChunks, cityId, cidade, savedAt: now,
      });
    }
    await setDoc(doc(col, docIdBikes), { chunked: true, totalChunks, cityId, cidade, total: bikes.length, savedAt: now });
  }

  // ── Legacy (compatibilidade) ─────────────────────────────────────────────────
  await setDoc(doc(col, 'latest'), {
    parkings: parkings.slice(0, PARKING_CHUNK), cityId, cidade,
    total: parkings.length, hasMore: parkings.length > PARKING_CHUNK, savedAt: now,
  });
  await setDoc(doc(col, 'bikes_latest'), {
    bikes: bikes.slice(0, BIKE_CHUNK), cityId, cidade,
    total: bikes.length, hasMore: bikes.length > BIKE_CHUNK, savedAt: now,
  });
}

export async function scraperGoJetBrowser(cityId: string, cidade: string): Promise<{
  totalParkings: number; totalBikes: number;
}> {
  const [parkings, bikes] = await Promise.all([
    fetchAllPages<any>('parkings', cityId),
    fetchAllPages<any>('bikes',    cityId),
  ]);

  await salvarNoFirestore(parkings, bikes, cityId, cidade);

  return { totalParkings: parkings.length, totalBikes: bikes.length };
}
