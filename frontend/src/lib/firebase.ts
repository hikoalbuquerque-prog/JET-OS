// src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app, 'southamerica-east1');

// ── CLOUD FUNCTIONS ──────────────────────────────────────────────
export const fnAddEstacao         = () => httpsCallable(functions, 'addEstacaoFn');
export const fnEditarEstacao      = () => httpsCallable(functions, 'editarEstacaoFn');
export const fnExcluirEstacao     = () => httpsCallable(functions, 'excluirEstacaoFn');
export const fnGetEstacoes        = () => httpsCallable(functions, 'getEstacoesFn');
export const fnGerarStreetView    = () => httpsCallable(functions, 'gerarStreetViewFn');
export const fnAnalisarCalcada    = () => httpsCallable(functions, 'analisarCalcadaFn');
export const fnSvEstatisticas     = () => httpsCallable(functions, 'svEstatisticasFn');
export const fnGetUsuario         = () => httpsCallable(functions, 'getUsuarioFn');
export const fnReverseGeocode     = () => httpsCallable(functions, 'reverseGeocodeFn');
export const fnSolicitarAcesso    = () => httpsCallable(functions, 'solicitarAcessoFn');
export const fnAprovarSolicitacao = () => httpsCallable(functions, 'aprovarSolicitacaoFn');
export const fnListarSolicitacoes = () => httpsCallable(functions, 'listarSolicitacoesFn');
export const fnListarUsuarios      = () => httpsCallable(functions, 'listarUsuariosFn');
export const fnNormalizarEstacoes  = () => httpsCallable(functions, 'normalizarEstacoesFn');
export const fnGerarCroqui        = () => httpsCallable(functions, 'gerarCroquiFn');
export const fnBuscarPOIs          = () => httpsCallable(functions, 'buscarPOIsFn');
export const fnGerarCroquisLote   = () => httpsCallable(functions, 'gerarCroquisLoteFn');
