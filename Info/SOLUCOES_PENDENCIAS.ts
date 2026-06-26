// PENDÊNCIA 1: OSM via Cloud Function — Mover Overpass para servidor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status: CRÍTICA (429 Rate Limit do browser)
// Solução: Adicionar busca Overpass em functions/src/pois.ts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ADICIONAR ao final de functions/src/pois.ts:

// ─── Cloud Function: buscar POIs OSM via Overpass ────────────────────
export const buscarPOIsOSM = onCall(
  { timeoutSeconds: 120, memory: '256MiB' },
  async (r: any) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Auth necessária');

    const { lat, lng, raioM = 10000, tipos = [] } = r.data as {
      lat: number; lng: number; raioM?: number; tipos?: string[];
    };

    const axios = (await import('axios')).default;
    const overpassEndpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    // Mapeamento: tipos internos → tags Overpass
    const OVERPASS_TAGS: Record<string, string> = {
      subway_entrance: 'station|subway',
      bus_stop: 'highway=bus_stop',
      restaurant: 'amenity=restaurant',
      cafe: 'amenity=cafe',
      bar: 'amenity=bar',
      bank: 'amenity=bank',
      atm: 'amenity=atm',
      pharmacy: 'amenity=pharmacy',
      hospital: 'amenity=hospital',
      clinic: 'amenity=clinic|doctors',
      school: 'amenity=school',
      university: 'amenity=university',
      shopping_mall: 'building=mall',
      supermarket: 'shop=supermarket',
      convenience: 'shop=convenience',
      parking: 'amenity=parking',
      fuel: 'amenity=fuel',
      charging_station: 'amenity=charging_station',
      park: 'leisure=park',
      fitness_centre: 'leisure=fitness_centre',
      cinema: 'amenity=cinema',
      hotel: 'tourism=hotel',
    };

    const graus = raioM / 111320;
    const bbox = {
      south: lat - graus,
      west: lng - graus * 1.3,
      north: lat + graus,
      east: lng + graus * 1.3,
    };

    const bboxStr = bbox.south + ',' + bbox.west + ',' + bbox.north + ',' + bbox.east;

    // Construir query Overpass para tipos solicitados (ou defaults)
    const tiposQuery = tipos.length > 0 ? tipos : [
      'subway_entrance', 'bus_stop', 'restaurant', 'cafe', 'bank',
      'pharmacy', 'hospital', 'school', 'parking', 'supermarket',
    ];

    const nodes: any[] = [];
    const ways: any[] = [];
    const seenIds = new Set<string>();

    for (const tipo of tiposQuery) {
      const tags = OVERPASS_TAGS[tipo] || tipo;
      if (!tags) continue;

      const ql = '[bbox:' + bboxStr + '];(' +
        'node[' + tags + '];' +
        'way[' + tags + '];' +
        ');out geom center;';

      for (const endpoint of overpassEndpoints) {
        try {
          const res = await axios.post(endpoint, 'data=' + encodeURIComponent(ql), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
          });

          if (res.data?.elements) {
            res.data.elements.forEach((elem: any) => {
              const id = elem.type + '_' + elem.id;
              if (seenIds.has(id)) return;
              seenIds.add(id);

              if (elem.type === 'node') {
                nodes.push({ ...elem, tags: elem.tags || {}, tipo });
              } else if (elem.type === 'way') {
                ways.push({ ...elem, tags: elem.tags || {}, tipo });
              }
            });
          }
          break; // sucesso, próximo tipo
        } catch (e) {
          console.warn('[buscarPOIsOSM] ' + endpoint + ' falhou:', e);
        }
      }

      // Aguardar 1s entre tipos para evitar rate limit
      await new Promise(r => setTimeout(r, 1000));
    }

    // Converter para POISalvo
    const poisOSM: any[] = [];
    nodes.forEach((n: any) => {
      if (n.lat && n.lng && n.tags && n.tags.name) {
        poisOSM.push({
          id: 'osm_' + n.id,
          fonte: 'osm',
          nome: n.tags.name || n.tags.ref || 'S/nome',
          tipo: n.tipo,
          tipos_google: [],
          lat: n.lat,
          lng: n.lng,
          endereco: n.tags['addr:street'] || '',
          cidade: '',
          maps_url: 'https://osm.org/node/' + n.id,
          street_view_url: 'https://maps.googleapis.com/maps/api/streetview?size=640x360&location=' + n.lat + ',' + n.lng + '&key=' + (process.env.GMAPS_KEY || ''),
          salvoPor: r.auth.uid,
          salvoEm: admin.firestore.Timestamp.now(),
          cidade_busca: [lat.toFixed(3), lng.toFixed(3), raioM].join('_'),
        });
      }
    });

    ways.forEach((w: any) => {
      if (w.center && w.center.lat && w.center.lon && w.tags && w.tags.name) {
        poisOSM.push({
          id: 'osm_' + w.id,
          fonte: 'osm',
          nome: w.tags.name || w.tags.ref || 'S/nome',
          tipo: w.tipo,
          tipos_google: [],
          lat: w.center.lat,
          lng: w.center.lon,
          endereco: w.tags['addr:street'] || '',
          cidade: '',
          maps_url: 'https://osm.org/way/' + w.id,
          street_view_url: 'https://maps.googleapis.com/maps/api/streetview?size=640x360&location=' + w.center.lat + ',' + w.center.lon + '&key=' + (process.env.GMAPS_KEY || ''),
          salvoPor: r.auth.uid,
          salvoEm: admin.firestore.Timestamp.now(),
          cidade_busca: [lat.toFixed(3), lng.toFixed(3), raioM].join('_'),
        });
      }
    });

    // Salvar em Firestore (batch)
    if (poisOSM.length > 0) {
      const batch = db().batch();
      poisOSM.forEach(poi => {
        const ref = db().collection('pois').doc(poi.id);
        batch.set(ref, poi, { merge: true });
      });
      await batch.commit();
    }

    return { ok: true, total: poisOSM.length, fonte: 'osm', pois: poisOSM };
  }
);

// ─── Atualizar buscarPOIsFn para chamar Overpass + Google em paralelo ───
// SUBSTITUIR a função buscarPOIsFn em functions/src/index.ts:

export const buscarPOIsFn = onCall(
  { timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    getAuth(request); // valida autenticação
    const { lat, lng, raio = 300, tipos = [] } = request.data;

    // Chamar Overpass + Google em paralelo
    const [resultadoOSM, resultadoGoogle] = await Promise.allSettled([
      buscarPOIsOSM({ auth: request.auth, data: { lat, lng, raioM: raio * 1000, tipos } }),
      buscarSalvarPOIsGoogle({ auth: request.auth, data: { lat, lng, raioM: raio * 1000, tipo: tipos?.[0], cidadeBusca: '' } }),
    ]);

    const poisOSM = resultadoOSM.status === 'fulfilled' ? resultadoOSM.value.pois : [];
    const poisGoogle = resultadoGoogle.status === 'fulfilled' ? resultadoGoogle.value.pois : [];

    // Deduplica por localização próxima
    const seenLocs = new Set<string>();
    const tol = 0.0005; // ~50m
    const all: any[] = [];

    [poisOSM, poisGoogle].forEach(lista => {
      lista.forEach((p: any) => {
        const key = Math.round(p.lat / tol) + ',' + Math.round(p.lng / tol);
        if (!seenLocs.has(key)) {
          seenLocs.add(key);
          all.push(p);
        }
      });
    });

    return {
      ok: true,
      total: all.length,
      osm: poisOSM.length,
      google: poisGoogle.length,
      pois: all,
    };
  }
);


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PENDÊNCIA 2: POIs Google — Grid de Pontos para Cobertura 100%
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status: IMPORTANTE (gaps em áreas grandes)
// Solução: Adicionar função helpers + grid em buscarSalvarPOIsGoogle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ADICIONAR ao início de functions/src/pois.ts (antes de buscarSalvarPOIsGoogle):

// Gera grid de pontos ao redor do centro para cobertura 100%
function gerarGridPontos(
  centerLat: number, centerLng: number, raioM: number, pontosPerLado: number = 3
): Array<{ lat: number; lng: number }> {
  const graus = raioM / 111320;
  const pontos: Array<{ lat: number; lng: number }> = [];

  for (let i = -pontosPerLado; i <= pontosPerLado; i++) {
    for (let j = -pontosPerLado; j <= pontosPerLado; j++) {
      const lat = centerLat + (i * graus) / pontosPerLado;
      const lng = centerLng + (j * graus * 1.3) / pontosPerLado;
      pontos.push({ lat, lng });
    }
  }

  return pontos;
}

// MODIFICAR buscarSalvarPOIsGoogle para usar grid:
// Depois de validar inputs, antes de chamar buscarNearbySearch:

export const buscarSalvarPOIsGoogle = onCall(
  { timeoutSeconds: 300, memory: '512MiB' }, // aumentar timeout para grid
  async (r: any) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Auth necessária');

    const { lat, lng, raioM = 10000, tipo, cidadeBusca = '' } = r.data as {
      lat: number; lng: number; raioM?: number; tipo?: string; cidadeBusca?: string;
    };

    const apiKey = process.env.GMAPS_KEY || '';
    if (!apiKey) throw new HttpsError('failed-precondition', 'GMAPS_KEY não configurada');

    // ... [verificar cache como antes] ...

    // ✨ NOVO: gerar grid de pontos (3x3 = 9 pontos) para raios > 5km
    const pontosParaBusca = raioM > 5000
      ? gerarGridPontos(lat, lng, raioM, 3)
      : [{ lat, lng }];

    console.log('[buscarPOIs] Grid: ' + pontosParaBusca.length + ' pontos');

    // ... [resto do código, mas chamar buscarNearbySearch para cada ponto no grid] ...

    const TIPOS_PLACES = tipo ? [tipo] : [
      'transit_station', 'bus_station', 'restaurant', 'cafe', 'bar', 'nightclub',
      'bank', 'pharmacy', 'hospital', 'school', 'university', 'shopping_mall',
      'supermarket', 'gym', 'stadium', 'museum', 'lodging', 'park',
    ];

    // Buscar em cada ponto do grid + tipo em paralelo
    const todasAsBuscas: Promise<any[]>[] = [];
    for (const ponto of pontosParaBusca) {
      for (const t of TIPOS_PLACES) {
        todasAsBuscas.push(
          buscarNearbySearch(ponto.lat, ponto.lng, raioM / 3, t, apiKey)
            .catch(() => [])
        );
      }
    }

    const buscas = await Promise.allSettled(todasAsBuscas);

    // Deduplica por place_id
    const seenIds = new Set<string>();
    const results: any[] = [];
    buscas.forEach(r => {
      if (r.status === 'fulfilled') {
        r.value.forEach((p: any) => {
          if (p.place_id && !seenIds.has(p.place_id)) {
            seenIds.add(p.place_id);
            results.push(p);
          }
        });
      }
    });

    // ... [salvar em Firestore como antes] ...
  }
);


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PENDÊNCIA 3: Relatório Guard — Campo "Procurando"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status: IMPORTANTE (funcionalidade Guard)
// Solução: 1. Adicionar campo ocorrencias.procurando
//          2. Checkbox em DashboardManager.tsx
//          3. Destaque em relatorios.ts (Telegram)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// PASSO 1: Schema Firestore (Adicionar a ocorrencias/{docId})
// procurando: boolean = false
// (feito no DashboardManager ao salvar)

// PASSO 2: DashboardManager.tsx — Adicionar checkbox no formulário
// Localizar: const [ocorrenciaForm, setOcorrenciaForm] = useState({ ... })
// Adicionar: procurando: false

// No JSX do formulário (dentro do modal):
/*
<label style={{ marginTop: '12px' }}>
  <input
    type="checkbox"
    checked={ocorrenciaForm.procurando || false}
    onChange={(e) => setOcorrenciaForm({
      ...ocorrenciaForm,
      procurando: e.target.checked && ocorrenciaForm.tipo === 'roubo'
    })}
    disabled={ocorrenciaForm.tipo !== 'roubo'}
  />
  {' '}Procurando (destaque no relatório Guard)
</label>
*/

// PASSO 3: relatorios.ts — Filtrar e destacar procurando
// Adicionar ao gerarRelatorioGuard():

function gerarRelatorioGuard(dataCustom?: string): Promise<any> {
  // ... código existente ...

  // Filtrar ocorrências de roubo + procurando
  const ocorrenciasProcurando = ocorrenciasRoubos.filter(
    (o: any) => o.procurando === true
  );

  return {
    totalOcorrencias: ocorrenciasRoubos.length,
    procurando: ocorrenciasProcurando.length,
    ocorrencias: ocorrenciasRoubos,
    procurandoList: ocorrenciasProcurando,
  };
}

// Adicionar ao enviarRelatorioTelegram():
/*
const msgProcurando = relatorio.procurandoList && relatorio.procurandoList.length > 0
  ? '🚨 PROCURANDO (' + relatorio.procurandoList.length + '):\n' +
    relatorio.procurandoList.map((o: any) => {
      const emoji = '📍';
      return emoji + ' ' + o.estacaoNome + ' (' + o.bairro + ') - ' + o.descricao;
    }).join('\n')
  : '';

const msgFinal = msgProcurando
  ? msgRelatorio + '\n\n' + msgProcurando
  : msgRelatorio;

// enviar msgFinal ao Telegram
*/


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PENDÊNCIA 4: Bugs Pós-Deploy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status: DINÂMICO
// Monitoramento:
// - Cloud Functions logs: https://console.firebase.google.com/project/jet-os-7/functions/logs
// - Firestore quota + operações
// - Analytics eventos (cliques, submissões)
// - Erros JavaScript (browser console)
//
// Padrão para reportar:
// 1. Screenshot do erro
// 2. Cloud Functions logs (contexto + stack)
// 3. Firestore operações (quota atingida?)
// 4. Versão de browser/SO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Helper para logging em todas as funções:
/*
console.log('[funcName] input:', input);
console.log('[funcName] resultado:', resultado);
console.error('[funcName] erro:', erro);
*/

// Firebase console para monitoramento:
// - Performance: https://console.firebase.google.com/project/jet-os-7/performance
// - Crashlytics: https://console.firebase.google.com/project/jet-os-7/crashlytics
// - Remote Config (A/B testing): https://console.firebase.google.com/project/jet-os-7/config
