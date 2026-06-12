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

// Cloud Functions
export const fnGerarCroqui          = () => httpsCallable(fns, 'gerarCroquiFn');
export const fnGerarStreetView      = () => httpsCallable(fns, 'gerarStreetViewFn');
export const fnAnalisarCalcada      = () => httpsCallable(fns, 'analisarCalcadaFn');
export const fnAddEstacao           = () => httpsCallable(fns, 'addEstacaoFn');
export const fnBuscarPOIs           = () => httpsCallable(fns, 'buscarPOIsFn');
export const fnGeocodeForward       = () => httpsCallable(fns, 'geocodeForwardFn');
export const fnGetUsuario           = () => httpsCallable(fns, 'getUsuario');
export const fnGerarCroquisLote     = () => httpsCallable(fns, 'gerarCroquisLoteFn');
export const fnSvEstatisticas       = () => httpsCallable(fns, 'svEstatisticasFn');
export const fnAceitarSlot          = () => httpsCallable(fns, 'aceitarSlot');
export const fnNotificarOcorrencia  = () => httpsCallable(fns, 'notificarOcorrencia');
export const fnNotificarTarefa      = () => httpsCallable(fns, 'notificarTarefa');
export const fnRegistrarTelegramId  = () => httpsCallable(fns, 'registrarTelegramChatId');
export const fnUpdatePrestadorPosition = () => httpsCallable(fns, 'updatePrestadorPositionFn');
export const fnGerarSlotsManual        = () => httpsCallable(fns, 'gerarSlotsManualFn');
export const fnScraperGoJetManual      = () => httpsCallable(fns, 'scraperGoJetManual');
export const fnExportarHistoricoParking = () => httpsCallable(fns, 'exportarHistoricoParking');

if (typeof window !== 'undefined') {
  (window as any).__fnNotificarOcorrencia = httpsCallable(fns, 'notificarOcorrencia');
}
