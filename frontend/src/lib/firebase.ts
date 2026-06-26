import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  CACHE_SIZE_UNLIMITED,
} from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyAPBQfV2wq4GD6AZxqmzTZ_rvFHjbWepMk",
  authDomain: "jet-os-1.firebaseapp.com",
  projectId: "jet-os-1",
  databaseURL: "https://jet-os-1-default-rtdb.firebaseio.com/",
  storageBucket: "jet-os-1.firebasestorage.app",
  messagingSenderId: "727065543526",
  appId: "1:727065543526:web:ac0d6831f4350f08d07ea7"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const storage = getStorage(app);

// Firestore com persistência offline (IndexedDB multi-tab)
// Elimina o erro "client is offline" no onAuthStateChanged
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    tabManager: persistentSingleTabManager({}),
  }),
});

const fns = getFunctions(app, 'southamerica-east1');

import { functionsProviderSupabase, getEdgeCallable } from './edge-functions';

function fn(name: string): () => any {
  return () => {
    if (functionsProviderSupabase()) {
      const edge = getEdgeCallable(name);
      if (edge) return edge();
    }
    return httpsCallable(fns, name);
  };
}

// Cloud Functions → Edge Functions (atrás de flag jet_functions_provider)
export const fnGerarCroqui             = fn('gerarCroquiFn');
export const fnGerarStreetView         = fn('gerarStreetViewFn');
export const fnAnalisarCalcada         = fn('analisarCalcadaFn');
export const fnAddEstacao              = fn('addEstacaoFn');
export const fnBuscarPOIs              = fn('buscarPOIsFn');
export const fnGeocodeForward          = fn('geocodeForwardFn');
export const fnGetUsuario              = fn('getUsuario');
export const fnGerarCroquisLote        = fn('gerarCroquisLoteFn');
export const fnSvEstatisticas          = fn('svEstatisticasFn');
export const fnAceitarSlot             = fn('aceitarSlot');
export const fnNotificarOcorrencia     = fn('notificarOcorrencia');
export const fnNotificarTarefa         = fn('notificarTarefa');
export const fnRegistrarTelegramId     = fn('registrarTelegramChatId');
export const fnUpdatePrestadorPosition = fn('updatePrestadorPositionFn');
export const fnGerarSlotsManual        = fn('gerarSlotsManualFn');
export const fnScraperGoJetManual      = fn('scraperGoJetManual');
export const fnExportarHistoricoParking = fn('exportarHistoricoParking');

if (typeof window !== 'undefined') {
  (window as any).__fnNotificarOcorrencia = httpsCallable(fns, 'notificarOcorrencia');
}
