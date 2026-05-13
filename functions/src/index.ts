// src/index.ts — entrada de todas as Cloud Functions
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';

// Inicializa Firebase Admin uma vez
admin.initializeApp();

// Região São Paulo para todas as funções
setGlobalOptions({ region: 'southamerica-east1' });

// Imports das funções de negócio
import { addEstacao, gerarStreetView, getEstacoes, editarEstacao, excluirEstacao, normalizarEstacoes, buscarPOIs } from './estacoes';
import { gerarCroqui, gerarCroquisLote } from './croquis';
import { getUsuario, solicitarAcesso, aprovarSolicitacao, listarSolicitacoesPendentes, listarUsuarios } from './auth';
import { svGetEstatisticas } from './streetview';

// ── HELPER: extrai uid e email do contexto auth ──────────────────
function getAuth(context: { auth?: { uid: string; token: { email?: string } } }) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
  return { uid: context.auth.uid, email: context.auth.token.email || '' };
}

async function checkRole(uid: string, roles: string[]): Promise<void> {
  const doc = await admin.firestore().collection('usuarios').doc(uid).get();
  if (!doc.exists || !roles.includes(doc.data()!.role)) {
    throw new HttpsError('permission-denied', 'Permissão negada.');
  }
}

// ── ESTAÇÕES ─────────────────────────────────────────────────────

export const addEstacaoFn = onCall(async (request) => {
  const { uid, email } = getAuth(request);
  return addEstacao(request.data, uid, email);
});

export const editarEstacaoFn = onCall(async (request) => {
  const { uid, email } = getAuth(request);
  return editarEstacao(request.data.codigo, request.data.campos, uid, email);
});

export const excluirEstacaoFn = onCall(async (request) => {
  const { uid, email } = getAuth(request);
  await checkRole(uid, ['gestor', 'admin']);
  return excluirEstacao(request.data.codigo, uid, email);
});

export const getEstacoesFn = onCall(async (request) => {
  getAuth(request);
  return getEstacoes(request.data?.cidade, request.data?.pais);
});

// ── STREET VIEW ──────────────────────────────────────────────────

export const gerarStreetViewFn = onCall(
  { timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    const { uid, email } = getAuth(request);
    return gerarStreetView(
      request.data.codigo,
      Number(request.data.lat),
      Number(request.data.lng),
      uid, email
    );
  }
);

export const svEstatisticasFn = onCall(async (request) => {
  getAuth(request);
  return svGetEstatisticas();
});

// ── IA ───────────────────────────────────────────────────────────

// // DESATIVADO — Gemini desligado para controle de custos
export const analisarCalcadaFn = onCall(async () => ({ ok: false, desativado: true, msg: 'Análise IA desativada' }));

// ── AUTH ─────────────────────────────────────────────────────────

export const getUsuarioFn = onCall(async (request) => {
  const { uid } = getAuth(request);
  return getUsuario(uid);
});

export const solicitarAcessoFn = onCall(async (request) => {
  return solicitarAcesso(request.data);
});

export const aprovarSolicitacaoFn = onCall(async (request) => {
  const { uid, email } = getAuth(request);
  await checkRole(uid, ['gestor', 'admin']);
  return aprovarSolicitacao(request.data.solicitacaoId, uid, email);
});

export const listarSolicitacoesFn = onCall(async (request) => {
  const { uid } = getAuth(request);
  await checkRole(uid, ['gestor', 'admin']);
  return listarSolicitacoesPendentes();
});

export const listarUsuariosFn = onCall(async (request) => {
  const { uid } = getAuth(request);
  await checkRole(uid, ['admin']);
  return listarUsuarios();
});

// ── CROQUIS ──────────────────────────────────────────────────────
export const gerarCroquiFn = onCall(
  { timeoutSeconds: 300, memory: '512MiB', cors: ['https://jet-os-7.web.app', 'http://localhost:5173'] },
  async (request: any) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    if (!process.env.OAUTH_REFRESH_TOKEN) {
      throw new HttpsError('failed-precondition', 'OAUTH_REFRESH_TOKEN não configurado. Configure via firebase functions:secrets:set OAUTH_REFRESH_TOKEN');
    }
    return gerarCroqui(request.data.estacaoId, uid, email);
  }
);

// ── CROQUIS EM LOTE ──────────────────────────────────────────────
export const gerarCroquisLoteFn = onCall(
  { timeoutSeconds: 540, memory: '1GiB' },
  async (request: any) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    const { cidade, pais, loteSize = 20 } = request.data;
    return gerarCroquisLote(cidade, pais, loteSize, uid, email);
  }
);

// ── NORMALIZAÇÃO ─────────────────────────────────────────────────
export const normalizarEstacoesFn = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    const { uid, email } = getAuth(request);
    await checkRole(uid, ['gestor', 'admin']);
    const { cidade, pais, loteSize = 20 } = request.data;
    return normalizarEstacoes(cidade, pais, uid, email, loteSize);
  }
);

// ── GEOCODE REVERSO ──────────────────────────────────────────────
export const reverseGeocodeFn = onCall(async (request) => {
  getAuth(request);
  const axios = (await import('axios')).default;
  const GMAPS_KEY = process.env.GMAPS_KEY || '';
  const { lat, lng } = request.data;

  const resp = await axios.get(
    'https://maps.googleapis.com/maps/api/geocode/json',
    { params: { latlng: `${lat},${lng}`, key: GMAPS_KEY } }
  );

  const results = resp.data?.results || [];
  if (!results.length) return { ok: false, error: 'Sem resultados.' };

  const comps = results[0].address_components || [];
  const get = (type: string) =>
    comps.find((c: { types: string[]; long_name: string }) =>
      c.types.includes(type))?.long_name || '';

  const pais = get('country') === 'MX' ? 'MX' : 'BR';
  return {
    ok: true,
    geo: {
      endereco:  results[0].formatted_address || '',
      bairro:    get('sublocality_level_1') || get('neighborhood') || '',
      cidade:    get('locality') || get('administrative_area_level_2') || '',
      estado:    get('administrative_area_level_1') || '',
      pais,
      alcaldia:  pais === 'MX' ? get('administrative_area_level_2') : ''
    }
  };
});

// ── POIs ────────────────────────────────────────────────────────
export const buscarPOIsFn = onCall(async (request) => {
  getAuth(request); // valida autenticação
  const { lat, lng, raio, tipos } = request.data;
  return buscarPOIs(Number(lat), Number(lng), Number(raio) || 300, tipos);
});

