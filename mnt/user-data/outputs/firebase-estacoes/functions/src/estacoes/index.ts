// src/estacoes/index.ts
import * as admin from 'firebase-admin';
import { db, validarLatLng, limparNulos, gerarCodigo, normalizarLargura, logEvento, erroResponse, okResponse } from '../utils';
import { fetchStreetViewCascata } from '../streetview';
import { analisarCalcadaIA } from '../ia';

// ── GEOCODE REVERSO ──────────────────────────────────────────────
import axios from 'axios';

const GMAPS_KEY = process.env.GMAPS_KEY || '';

async function reverseGeocode(lat: number, lng: number) {
  try {
    const resp = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params: { latlng: `${lat},${lng}`, key: GMAPS_KEY }, timeout: 8000 }
    );

    const results = resp.data?.results || [];
    if (!results.length) return null;

    const comps = results[0].address_components || [];
    const get = (type: string) =>
      comps.find((c: {types: string[]; long_name: string}) => c.types.includes(type))?.long_name || '';

    const paisCode = get('country');
    return {
      endereco:  results[0].formatted_address || '',
      bairro:    get('sublocality_level_1') || get('neighborhood') || get('sublocality') || '',
      cidade:    get('locality') || get('administrative_area_level_2') || '',
      estado:    get('administrative_area_level_1') || '',
      pais:      paisCode === 'MX' ? 'MX' : 'BR',
      alcaldia:  paisCode === 'MX' ? (get('administrative_area_level_2') || '') : ''
    };
  } catch { return null; }
}

// ── ADD ESTAÇÃO ──────────────────────────────────────────────────
export async function addEstacao(
  payload: Record<string, unknown>,
  uid: string,
  email: string
) {
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);

  if (!validarLatLng(lat, lng)) {
    return erroResponse('Lat/Lng inválidos.');
  }

  const tipo = String(payload.tipo || 'PUBLICA').toUpperCase();
  const pais = String(payload.pais || 'BR').toUpperCase();

  // Geocode reverso se endereço não informado
  let geo = payload.geo as Record<string, string> | null;
  if (!geo?.cidade) {
    geo = await reverseGeocode(lat, lng);
  }

  const cidade  = String(geo?.cidade || payload.cidade || '');
  const bairro  = String(geo?.bairro || payload.bairro || '');
  const endereco = String(geo?.endereco || payload.endereco || '');

  const codigo = gerarCodigo(cidade, tipo);

  // IA dados
  const iaPayload = payload.calcadaIA as Record<string, unknown> | null;
  const ia = iaPayload ? {
    largura:    String(iaPayload.largura   || ''),
    score:      Number(iaPayload.score     || 0),
    aprovado:   iaPayload.aprovado         === true,
    confianca:  String(iaPayload.confianca || 'baixa'),
    motivo:     String(iaPayload.motivo    || ''),
    analisadoEm: admin.firestore.FieldValue.serverTimestamp()
  } : null;

  // Largura faixa normalizada
  const larguraFaixa = normalizarLargura(payload.larguraFaixa);

  const doc = limparNulos({
    id:            codigo,
    codigo,
    pais,
    cidade,
    bairro,
    subprefeitura: String(payload.subprefeitura || geo?.estado || ''),
    endereco,
    lat,
    lng,
    tipo,
    status:        String(payload.status || 'SOLICITADO'),
    larguraFaixa,
    dimensoes:     String(payload.dimensoes || '') || null,
    croquiStatus:     'PENDENTE',
    croquiTentativas: 0,
    ia,
    imagens:       {},
    operador:      email,
    origem:        'PWA_CAMPO',
    criadoEm:      admin.firestore.FieldValue.serverTimestamp(),
    atualizadoEm:  admin.firestore.FieldValue.serverTimestamp()
  });

  await db().collection('estacoes').doc(codigo).set(doc);

  await logEvento({
    tipo: 'ADD_MAPA', estacaoId: codigo,
    uid, email,
    descricao: `Estação adicionada: ${endereco}`
  });

  return okResponse({ estacao: { codigo, cidade, bairro, lat, lng, endereco, tipo, pais } });
}

// ── GERAR STREET VIEW ────────────────────────────────────────────
export async function gerarStreetView(
  codigo: string, lat: number, lng: number,
  uid: string, email: string
) {
  if (!codigo || !validarLatLng(lat, lng)) {
    return erroResponse('Parâmetros inválidos.');
  }

  const result = await fetchStreetViewCascata(lat, lng, codigo);
  if (!result) {
    return erroResponse('Street View não disponível neste ponto.');
  }

  // Grava URL na estação
  await db().collection('estacoes').doc(codigo).update({
    'imagens.streetView': result.url,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  await logEvento({
    tipo: 'SV_GERADO', estacaoId: codigo,
    uid, email,
    descricao: `Street View gerado via ${result.fonte}`,
    meta: { fonte: result.fonte, url: result.url }
  });

  return okResponse({ url: result.url, fonte: result.fonte });
}

// ── ANALISAR CALÇADA IA ──────────────────────────────────────────
export async function analisarCalcada(
  codigo: string | null,
  lat: number, lng: number,
  uid: string, email: string
) {
  if (!validarLatLng(lat, lng)) {
    return erroResponse('Lat/Lng inválidos.');
  }

  const result = await analisarCalcadaIA({ lat, lng });
  if (!result.ok || !result.resultado) {
    return erroResponse(result.error || 'Falha na análise IA.');
  }

  // Se tem código, grava resultado na estação
  if (codigo) {
    const r = result.resultado;
    await db().collection('estacoes').doc(codigo).update({
      'ia.largura':    r.larguraEstimada,
      'ia.score':      r.score,
      'ia.aprovado':   r.aprovado,
      'ia.confianca':  r.confianca,
      'ia.motivo':     r.motivoCodigo,
      'ia.analisadoEm': admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm:    admin.firestore.FieldValue.serverTimestamp()
    });

    await logEvento({
      tipo: 'IA_ANALISADA', estacaoId: codigo,
      uid, email,
      descricao: `IA: ${r.motivoCodigo} score=${r.score}`,
      meta: { resultado: r }
    });
  }

  return okResponse({ resultado: result.resultado });
}

// ── GET ESTAÇÕES ─────────────────────────────────────────────────
export async function getEstacoes(cidade?: string, pais?: string) {
  let query: admin.firestore.Query = db().collection('estacoes');

  if (pais)   query = query.where('pais', '==', pais);
  if (cidade) query = query.where('cidade', '==', cidade);

  const snap = await query.get();
  const estacoes = snap.docs.map(d => d.data());

  return okResponse({ estacoes });
}

// ── EDITAR ESTAÇÃO ───────────────────────────────────────────────
export async function editarEstacao(
  codigo: string,
  campos: Record<string, unknown>,
  uid: string, email: string
) {
  const ref = db().collection('estacoes').doc(codigo);
  const doc = await ref.get();
  if (!doc.exists) return erroResponse('Estação não encontrada.');

  const update = limparNulos({
    ...campos,
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  await ref.update(update);
  await logEvento({
    tipo: 'EDIT', estacaoId: codigo,
    uid, email,
    descricao: `Estação editada: ${Object.keys(campos).join(', ')}`
  });

  return okResponse({ codigo });
}

// ── EXCLUIR ESTAÇÃO ──────────────────────────────────────────────
export async function excluirEstacao(
  codigo: string, uid: string, email: string
) {
  const ref = db().collection('estacoes').doc(codigo);
  const doc = await ref.get();
  if (!doc.exists) return erroResponse('Estação não encontrada.');

  await ref.delete();
  await logEvento({
    tipo: 'DELETE', estacaoId: codigo,
    uid, email,
    descricao: `Estação excluída: ${codigo}`
  });

  return okResponse({ codigo });
}
