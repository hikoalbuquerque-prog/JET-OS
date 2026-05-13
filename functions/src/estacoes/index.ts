// src/estacoes/index.ts
import * as admin from 'firebase-admin';
import axios from 'axios';
import { db, validarLatLng, limparNulos, gerarCodigo, normalizarLargura, logEvento, erroResponse, okResponse } from '../utils';
import { fetchStreetViewCascata } from '../streetview';
import { analisarCalcadaIA } from '../ia';

// ── GEOCODE REVERSO ──────────────────────────────────────────────

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

// ── NORMALIZAÇÃO AUTOMÁTICA ──────────────────────────────────────
// Tabela bairro → subprefeitura SP (principais)
const SUBPREF_SP: Record<string, string> = {
  // Centro
  'Sé': 'Sé', 'República': 'Sé', 'Bela Vista': 'Sé', 'Consolação': 'Sé',
  'Liberdade': 'Sé', 'Santa Cecília': 'Sé', 'Bom Retiro': 'Sé',
  // Pinheiros
  'Pinheiros': 'Pinheiros', 'Alto de Pinheiros': 'Pinheiros',
  'Itaim Bibi': 'Pinheiros', 'Jardim Paulista': 'Pinheiros',
  // Vila Mariana
  'Vila Mariana': 'Vila Mariana', 'Moema': 'Vila Mariana',
  'Saúde': 'Vila Mariana', 'Cursino': 'Vila Mariana', 'Ipiranga': 'Vila Mariana',
  // Lapa
  'Lapa': 'Lapa', 'Vila Leopoldina': 'Lapa', 'Jaguaré': 'Lapa',
  'Perdizes': 'Lapa', 'Vila Romana': 'Lapa',
  // Butantã
  'Butantã': 'Butantã', 'Morumbi': 'Butantã', 'Raposo Tavares': 'Butantã',
  // Santo Amaro
  'Santo Amaro': 'Santo Amaro', 'Campo Limpo': 'Campo Limpo',
  'Vila Andrade': 'Santo Amaro',
  // Santana/Tucuruvi
  'Santana': 'Santana/Tucuruvi', 'Tucuruvi': 'Santana/Tucuruvi',
  'Mandaqui': 'Santana/Tucuruvi',
  // Aricanduva
  'Aricanduva': 'Aricanduva', 'Vila Formosa': 'Aricanduva',
  // Penha
  'Penha': 'Penha', 'Ermelino Matarazzo': 'Penha', 'Vila Prudente': 'Vila Prudente',
  // Mooca
  'Mooca': 'Mooca', 'Belém': 'Mooca', 'Brás': 'Mooca', 'Pari': 'Mooca',
  // Jabaquara
  'Jabaquara': 'Jabaquara',
  // Campos Elíseos
  'Campos Elíseos': 'Sé',
  // Vila Guilherme
  'Vila Guilherme': 'Vila Maria/Vila Guilherme',
  'Vila Maria': 'Vila Maria/Vila Guilherme',
  // Outras
  'Brooklin': 'Santo Amaro', 'Jardins': 'Pinheiros',
  'Vila Olímpia': 'Pinheiros', 'Vila Madalena': 'Pinheiros',
};

function inferirSubprefSP(bairro: string): string {
  if (!bairro) return '';
  // Match exato
  if (SUBPREF_SP[bairro]) return SUBPREF_SP[bairro];
  // Match parcial
  for (const [key, val] of Object.entries(SUBPREF_SP)) {
    if (bairro.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(bairro.toLowerCase())) {
      return val;
    }
  }
  return '';
}

export async function normalizarEstacoes(
  cidade: string, pais: string,
  uid: string, email: string,
  loteSize = 20
) {
  // Busca estações — se cidade vazia, busca todas do país
  let q = db().collection('estacoes').where('pais', '==', pais) as any;
  if (cidade) q = q.where('cidade', '==', cidade);
  const snap = await q.get();

  const todosSemDados = snap.docs.filter((d: admin.firestore.QueryDocumentSnapshot) => {
    const data = d.data();
    return !data.bairro || !data.endereco || (data.cidade === 'São Paulo' && !data.subprefeitura);
  });

  const semDados = todosSemDados.slice(0, loteSize);
  const restantes = Math.max(0, todosSemDados.length - semDados.length);

  if (!semDados.length) {
    return okResponse({ normalizados: 0, restantes: 0, mensagem: 'Todos os dados já estão preenchidos.' });
  }

  let normalizados = 0;
  const erros: string[] = [];
  const GMAPS_KEY = process.env.GMAPS_KEY || '';

  for (const docSnap of semDados) {
    const data = docSnap.data();
    const { lat, lng } = data;
    if (!lat || !lng) continue;

    try {
      // Geocode reverso via Nominatim (gratuito)
      let bairro   = data.bairro   || '';
      let endereco = data.endereco || '';
      let subpref  = data.subprefeitura || '';

      // Tenta Nominatim primeiro
      const nomResp = await axios.get(
        'https://nominatim.openstreetmap.org/reverse',
        {
          params: { lat, lon: lng, format: 'json', 'accept-language': 'pt-BR' },
          headers: { 'User-Agent': 'AppEstacoes/1.0' },
          timeout: 8000
        }
      );

      if (nomResp.data?.address) {
        const a = nomResp.data.address;
        if (!bairro) {
          bairro = a.suburb || a.neighbourhood || a.city_district || a.quarter || '';
        }
        if (!endereco) {
          endereco = nomResp.data.display_name || '';
        }
      }

      // Se ainda sem bairro, tenta Google Geocoding
      if (!bairro && GMAPS_KEY) {
        const gResp = await axios.get(
          'https://maps.googleapis.com/maps/api/geocode/json',
          { params: { latlng: `${lat},${lng}`, key: GMAPS_KEY }, timeout: 8000 }
        );
        const comps = gResp.data?.results?.[0]?.address_components || [];
        const getBairro = (type: string) =>
          comps.find((c: any) => c.types.includes(type))?.long_name || '';
        bairro = getBairro('sublocality_level_1') || getBairro('neighborhood') || '';
        if (!endereco) endereco = gResp.data?.results?.[0]?.formatted_address || '';
      }

      // Infere subprefeitura SP
      if (cidade === 'São Paulo' && bairro && !subpref) {
        subpref = inferirSubprefSP(bairro);
      }

      // Atualiza apenas campos que estavam vazios
      const update: Record<string, string> = {};
      if (bairro   && !data.bairro)          update.bairro          = bairro;
      if (endereco && !data.endereco)         update.endereco        = endereco;
      if (subpref  && !data.subprefeitura)    update.subprefeitura   = subpref;

      if (Object.keys(update).length > 0) {
        await docSnap.ref.update({
          ...update,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        });
        normalizados++;
      }

      // Delay para não sobrecarregar Nominatim (1 req/seg)
      await new Promise(r => setTimeout(r, 1100));

    } catch(e) {
      erros.push(`${data.codigo}: ${(e as Error).message}`);
    }
  }

  await logEvento({
    tipo: 'NORMALIZACAO', uid, email,
    descricao: `Normalização ${cidade}: ${normalizados} estações atualizadas`,
    meta: { semDados: semDados.length, normalizados, erros: erros.length }
  });

  return okResponse({
    normalizados,
    semDados: semDados.length,
    restantes,
    erros: erros.slice(0, 10)
  });
}

// ── BUSCAR POIs PRÓXIMOS ─────────────────────────────────────────
// Usa Google Places API (Nearby Search) — server-side para proteger a chave

const POI_TYPES = [
  'subway_station',
  'bus_station',
  'train_station',
  'shopping_mall',
  'supermarket',
  'university',
  'school',
  'hospital',
  'park',
  'restaurant',
  'cafe',
  'gym',
  'bank',
  'pharmacy',
];

export async function buscarPOIs(
  lat: number,
  lng: number,
  raio: number = 300,
  tipos?: string[]
): Promise<{ ok: boolean; pois?: object[]; error?: string }> {
  if (!GMAPS_KEY) return { ok: false, error: 'GMAPS_KEY não configurada.' };
  if (!validarLatLng(lat, lng)) return { ok: false, error: 'Coordenadas inválidas.' };

  const tiposFiltro = (tipos && tipos.length) ? tipos : POI_TYPES;

  try {
    // Faz uma busca por tipo em paralelo (máx 5 por vez para não estourar quota)
    const resultados: object[] = [];
    const vistos = new Set<string>();

    // Nearby Search aceita 1 tipo por vez — fazemos em lotes
    const lote1 = tiposFiltro.slice(0, 5);
    const lote2 = tiposFiltro.slice(5, 10);
    const lote3 = tiposFiltro.slice(10);

    for (const lote of [lote1, lote2, lote3]) {
      if (!lote.length) continue;
      const promessas = lote.map(tipo =>
        axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
          params: {
            location: `${lat},${lng}`,
            radius: raio,
            type: tipo,
            language: 'pt-BR',
            key: GMAPS_KEY,
          },
          timeout: 6000,
        }).then(r => ({ tipo, results: r.data?.results || [] }))
          .catch(() => ({ tipo, results: [] }))
      );
      const respostas = await Promise.all(promessas);
      for (const { tipo, results } of respostas) {
        for (const p of results) {
          if (vistos.has(p.place_id)) continue;
          vistos.add(p.place_id);
          resultados.push({
            id:        p.place_id,
            nome:      p.name,
            tipo:      tipo,
            tipos:     p.types || [],
            lat:       p.geometry?.location?.lat,
            lng:       p.geometry?.location?.lng,
            endereco:  p.vicinity || '',
            rating:    p.rating || null,
            aberto:    p.opening_hours?.open_now ?? null,
            distancia: calcDistancia(lat, lng, p.geometry?.location?.lat, p.geometry?.location?.lng),
          });
        }
      }
    }

    // Ordena por distância
    resultados.sort((a: any, b: any) => (a.distancia || 0) - (b.distancia || 0));

    return { ok: true, pois: resultados.slice(0, 40) };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Erro ao buscar POIs.' };
  }
}

function calcDistancia(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
