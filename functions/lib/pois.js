"use strict";
// functions/src/pois.ts
// POIs do Google Places — busca, salva no Firestore com cache e Street View
// Deploy: firebase deploy --only functions
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletarPOI = exports.carregarPOIsSalvos = exports.buscarSalvarPOIsGoogle = void 0;
exports.buscarPOIsOSMInterno = buscarPOIsOSMInterno;
exports.buscarPOIsGoogleInterno = buscarPOIsGoogleInterno;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const axios_1 = __importDefault(require("axios"));
const db = () => admin.firestore();
// ─── mapeamento de tipos Google → categoria interna ──────────────────
const TIPO_MAP = {
    subway_station: 'subway_entrance', train_station: 'station',
    bus_station: 'bus_station', transit_station: 'bus_stop',
    restaurant: 'restaurant', cafe: 'cafe', bar: 'bar',
    food: 'restaurant', meal_takeaway: 'fast_food', fast_food: 'fast_food',
    bank: 'bank', atm: 'bank',
    pharmacy: 'pharmacy', hospital: 'hospital', doctor: 'clinic', health: 'clinic',
    school: 'school', university: 'university',
    police: 'police', post_office: 'post_office',
    movie_theater: 'cinema', performing_arts_theater: 'theatre',
    parking: 'parking', gas_station: 'fuel', electric_vehicle_charging_station: 'charging_station',
    shopping_mall: 'mall', supermarket: 'supermarket', convenience_store: 'convenience',
    bakery: 'bakery', grocery_or_supermarket: 'supermarket',
    park: 'park', gym: 'fitness_centre', stadium: 'stadium',
    lodging: 'hotel', museum: 'museum', tourist_attraction: 'attraction',
    point_of_interest: 'attraction', establishment: 'outros',
};
function normalizarTipo(types) {
    for (const t of types) {
        if (TIPO_MAP[t] && TIPO_MAP[t] !== 'outros')
            return TIPO_MAP[t];
    }
    return 'outros';
}
// ─── gerar URL da foto Places ─────────────────────────────────────────
function fotoUrl(photoRef, apiKey, maxWidth = 400) {
    return 'https://maps.googleapis.com/maps/api/place/photo'
        + '?maxwidth=' + maxWidth
        + '&photo_reference=' + photoRef
        + '&key=' + apiKey;
}
// ─── gerar URL Static Street View ────────────────────────────────────
function streetViewUrl(lat, lng, apiKey) {
    return 'https://maps.googleapis.com/maps/api/streetview'
        + '?size=640x360&location=' + lat + ',' + lng
        + '&fov=90&heading=0&pitch=0&key=' + apiKey;
}
// ─── Nearby Search do Places API ─────────────────────────────────────
async function buscarNearbySearch(lat, lng, raioM, tipo, apiKey) {
    const params = {
        location: lat + ',' + lng,
        radius: String(raioM),
        key: apiKey,
    };
    if (tipo)
        params.type = tipo;
    else
        params.keyword = 'ponto de interesse';
    const results = [];
    let pageToken;
    for (let page = 0; page < 3; page++) {
        if (pageToken) {
            params.pagetoken = pageToken;
            await new Promise(r => setTimeout(r, 2000)); // API exige delay entre páginas
        }
        const res = await axios_1.default.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params });
        const data = res.data;
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            throw new https_1.HttpsError('internal', 'Places API: ' + data.status);
        }
        results.push(...(data.results || []));
        pageToken = data.next_page_token;
        if (!pageToken)
            break;
    }
    return results;
}
// ─── Helpers internos chamáveis por outras Cloud Functions ───────────
// (não são onCall — são funções TypeScript normais)
async function buscarPOIsOSMInterno(lat, lng, raioM) {
    const https = await Promise.resolve().then(() => __importStar(require('https')));
    const raio = Math.min(raioM, 8000); // máx 8km para evitar timeout
    const c = lat + ',' + lng;
    const r = String(raio);
    const query = '[out:json][timeout:45];('
        + 'node["railway"~"subway_entrance|station|tram_stop"](around:' + r + ',' + c + ');'
        + 'node["highway"~"bus_stop|crossing"](around:' + r + ',' + c + ');'
        + 'node["amenity"~"bus_station|restaurant|cafe|fast_food|bar|pub|nightclub|pharmacy|hospital|clinic|bank|atm|school|university|police|post_office|cinema|theatre|parking|fuel|charging_station|place_of_worship"](around:' + r + ',' + c + ');'
        + 'node["shop"~"mall|supermarket|convenience|bakery|clothes|electronics"](around:' + r + ',' + c + ');'
        + 'node["leisure"~"park|fitness_centre|sports_centre|stadium|swimming_pool|playground"](around:' + r + ',' + c + ');'
        + 'node["tourism"~"hotel|hostel|museum|attraction|viewpoint"](around:' + r + ',' + c + ');'
        + ');out center qt 400;';
    const body = 'data=' + encodeURIComponent(query);
    const endpoints = [
        'overpass-api.de',
        'overpass.kumi.systems',
    ];
    for (const host of endpoints) {
        try {
            const json = await new Promise((resolve, reject) => {
                const req = https.request({ hostname: host, path: '/api/interpreter', method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body) } }, (res) => {
                    if (res.statusCode === 429 || res.statusCode >= 500) {
                        res.resume();
                        reject(new Error('HTTP ' + res.statusCode));
                        return;
                    }
                    let data = '';
                    res.on('data', (d) => data += d);
                    res.on('end', () => { try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        reject(new Error('JSON parse'));
                    } });
                });
                req.on('error', reject);
                req.setTimeout(40000, () => { req.destroy(); reject(new Error('timeout')); });
                req.write(body);
                req.end();
            });
            if (!json.elements)
                continue;
            const tipoMap = {
                subway_entrance: 'subway_entrance', station: 'station', tram_stop: 'station',
                bus_stop: 'bus_stop', bus_station: 'bus_station', crossing: 'faixa_pedestre',
                restaurant: 'restaurant', cafe: 'cafe', fast_food: 'fast_food', bar: 'bar',
                pub: 'bar', nightclub: 'balada', pharmacy: 'pharmacy', hospital: 'hospital',
                clinic: 'clinic', bank: 'bank', atm: 'bank', school: 'school',
                university: 'university', police: 'police', post_office: 'post_office',
                cinema: 'cinema', theatre: 'theatre', parking: 'parking', fuel: 'fuel',
                charging_station: 'charging_station', place_of_worship: 'religioso',
                mall: 'mall', supermarket: 'supermarket', convenience: 'convenience',
                bakery: 'bakery', clothes: 'shopping', electronics: 'shopping',
                park: 'park', fitness_centre: 'fitness_centre', sports_centre: 'fitness_centre',
                stadium: 'stadium', swimming_pool: 'fitness_centre', playground: 'park',
                hotel: 'hotel', hostel: 'hotel', museum: 'museum', attraction: 'attraction',
                viewpoint: 'viewpoint',
            };
            const seen = new Set();
            const result = [];
            for (const el of json.elements) {
                const elLat = el.lat ?? el.center?.lat;
                const elLng = el.lon ?? el.center?.lon;
                if (!elLat || !elLng)
                    continue;
                const tags = el.tags || {};
                const nome = tags.name || tags['name:pt'] || '';
                if (!nome)
                    continue;
                let tipo = '';
                for (const [k, v] of Object.entries(tipoMap)) {
                    if (tags.amenity === k || tags.railway === k || tags.highway === k ||
                        tags.shop === k || tags.leisure === k || tags.tourism === k) {
                        tipo = v;
                        break;
                    }
                }
                if (!tipo)
                    continue;
                const uid = el.type + '-' + el.id;
                if (seen.has(uid))
                    continue;
                seen.add(uid);
                result.push({ id: uid, fonte: 'osm', nome, tipo, lat: elLat, lng: elLng,
                    endereco: tags['addr:street'] || '' });
            }
            return result;
        }
        catch {
            continue;
        }
    }
    return [];
}
async function buscarPOIsGoogleInterno(lat, lng, raioM, tipoFiltro) {
    const apiKey = process.env.GMAPS_KEY || '';
    if (!apiKey)
        return [];
    const TIPOS = tipoFiltro ? [tipoFiltro] : [
        'transit_station', 'restaurant', 'cafe', 'bar', 'nightclub',
        'bank', 'pharmacy', 'hospital', 'school', 'university',
        'shopping_mall', 'supermarket', 'gym', 'museum', 'lodging', 'park',
    ];
    const buscas = await Promise.allSettled(TIPOS.map(t => buscarNearbySearch(lat, lng, raioM, t, apiKey)));
    const seen = new Set();
    const result = [];
    buscas.forEach(r => {
        if (r.status === 'fulfilled') {
            r.value.forEach((p) => {
                if (p.place_id && !seen.has(p.place_id)) {
                    seen.add(p.place_id);
                    const tipos = p.types || [];
                    result.push({
                        id: p.place_id, fonte: 'google',
                        nome: p.name || '',
                        tipo: normalizarTipo(tipos),
                        lat: p.geometry?.location?.lat || 0,
                        lng: p.geometry?.location?.lng || 0,
                        endereco: p.vicinity || '',
                        rating: p.rating,
                    });
                }
            });
        }
    });
    return result;
}
// ─── Cloud Function: buscar e salvar POIs do Google ──────────────────
exports.buscarSalvarPOIsGoogle = (0, https_1.onCall)({ timeoutSeconds: 120, memory: '256MiB' }, async (r) => {
    if (!r.auth)
        throw new https_1.HttpsError('unauthenticated', 'Auth necessária');
    const { lat, lng, raioM = 10000, tipo, cidadeBusca = '' } = r.data;
    const apiKey = process.env.GMAPS_KEY || '';
    if (!apiKey)
        throw new https_1.HttpsError('failed-precondition', 'GMAPS_KEY não configurada');
    // ── verificar cache: se já buscamos essa área recentemente, retornar do Firestore ──
    const cacheKey = [lat.toFixed(3), lng.toFixed(3), raioM, tipo || 'all'].join('_');
    const cacheRef = db().collection('pois_cache').doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
        const cacheData = cacheSnap.data();
        const age = Date.now() - cacheData.ts;
        if (age < 10 * 24 * 60 * 60 * 1000) { // 10 dias
            // Retornar POIs do Firestore em vez de chamar a API
            const snap = await db().collection('pois')
                .where('cidade_busca', '==', cacheKey)
                .limit(200)
                .get();
            const pois = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return { ok: true, total: pois.length, fonte: 'cache', pois };
        }
    }
    // ── Grid de pontos para cobertura ~99% da área ───────────────────────
    const TIPOS_PLACES = tipo ? [tipo] : [
        'transit_station', 'bus_station', 'restaurant', 'cafe', 'bar', 'nightclub',
        'bank', 'pharmacy', 'hospital', 'school', 'university', 'shopping_mall',
        'supermarket', 'gym', 'stadium', 'museum', 'lodging', 'park',
    ];
    // Grid 3x3 para raios > 5km, 1 ponto para raios menores
    const pontosGrid = [];
    if (raioM > 5000) {
        const passo = (raioM * 0.6) / 111320; // ~60% do raio em graus
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                pontosGrid.push({
                    lat: lat + dy * passo,
                    lng: lng + dx * passo / Math.cos(lat * Math.PI / 180),
                });
            }
        }
    }
    else {
        pontosGrid.push({ lat, lng });
    }
    const raioGrid = raioM > 5000 ? Math.round(raioM * 0.65) : raioM;
    // Buscar em cada ponto do grid × cada tipo (em paralelo com limite)
    const seenIds = new Set();
    const results = [];
    for (const ponto of pontosGrid) {
        const buscas = await Promise.allSettled(TIPOS_PLACES.map(t => buscarNearbySearch(ponto.lat, ponto.lng, raioGrid, t, apiKey)));
        buscas.forEach(r => {
            if (r.status === 'fulfilled') {
                r.value.forEach((p) => {
                    if (p.place_id && !seenIds.has(p.place_id)) {
                        seenIds.add(p.place_id);
                        results.push(p);
                    }
                });
            }
        });
    }
    // ── salvar no Firestore (batch) ───────────────────────────────────
    const batch = db().batch();
    const poisSalvos = [];
    for (const place of results) {
        const placeId = place.place_id;
        if (!placeId)
            continue;
        const tipos = place.types || [];
        const tipoNorm = normalizarTipo(tipos);
        if (tipoNorm === 'outros' && !tipo)
            continue; // filtrar genéricos
        const photoRef = place.photos?.[0]?.photo_reference;
        // Montar objeto removendo campos undefined (Firestore não aceita undefined)
        const poiRaw = {
            id: placeId,
            fonte: 'google',
            nome: place.name || '',
            tipo: tipoNorm,
            tipos_google: tipos,
            lat: place.geometry?.location?.lat || 0,
            lng: place.geometry?.location?.lng || 0,
            endereco: place.vicinity || '',
            cidade: cidadeBusca,
            maps_url: 'https://www.google.com/maps/place/?q=place_id:' + placeId,
            salvoPor: r.auth.uid,
            salvoEm: admin.firestore.Timestamp.now(),
            cidade_busca: cacheKey,
            street_view_url: streetViewUrl(place.geometry?.location?.lat, place.geometry?.location?.lng, apiKey),
        };
        // Campos opcionais — só adicionar se não forem undefined
        if (place.rating !== undefined)
            poiRaw.rating = place.rating;
        if (place.user_ratings_total !== undefined)
            poiRaw.total_ratings = place.user_ratings_total;
        if (place.opening_hours?.open_now !== undefined)
            poiRaw.aberto_agora = place.opening_hours.open_now;
        if (photoRef)
            poiRaw.foto_ref = photoRef;
        if (photoRef)
            poiRaw.foto_url = fotoUrl(photoRef, apiKey);
        const poi = poiRaw;
        const ref = db().collection('pois').doc(placeId);
        batch.set(ref, poi, { merge: true });
        poisSalvos.push(poi);
    }
    await batch.commit();
    // Atualizar cache
    const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    await cacheRef.set({ ts: Date.now(), total: poisSalvos.length, expiresAt, cidadeBusca: cacheKey });
    return { ok: true, total: poisSalvos.length, fonte: 'google', pois: poisSalvos };
});
// ─── Cloud Function: carregar POIs salvos do Firestore ───────────────
exports.carregarPOIsSalvos = (0, https_1.onCall)({ timeoutSeconds: 30, memory: '256MiB' }, async (r) => {
    if (!r.auth)
        throw new https_1.HttpsError('unauthenticated', 'Auth necessária');
    const { lat, lng, raioM = 10000, tipo } = r.data;
    // Carregar todos e filtrar client-side — evita índice composto no Firestore
    // Para volumes maiores, considerar geohash no futuro
    let q = db().collection('pois');
    if (tipo)
        q = q.where('tipo', '==', tipo);
    const snap = await q.limit(500).get();
    const graus = raioM / 111320;
    const pois = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => {
        const dLat = Math.abs((p.lat || 0) - lat);
        const dLng = Math.abs((p.lng || 0) - lng);
        return dLat <= graus && dLng <= graus * 1.3;
    });
    return { ok: true, total: pois.length, pois };
});
// ─── Cloud Function: deletar POI salvo ───────────────────────────────
exports.deletarPOI = (0, https_1.onCall)({ timeoutSeconds: 15, memory: '128MiB' }, async (r) => {
    if (!r.auth)
        throw new https_1.HttpsError('unauthenticated', 'Auth necessária');
    const { poiId } = r.data;
    await db().collection('pois').doc(poiId).delete();
    return { ok: true };
});
//# sourceMappingURL=pois.js.map