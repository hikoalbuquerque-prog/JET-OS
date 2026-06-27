// functions/src/automacao-gojet-scraper.ts
// scraperGoJet — busca TODOS os parkings e bikes da API GoJet com paginação completa
// Substitui a versão em automacao.ts que tinha limit=1000 sem paginar
//
// Copie este arquivo para functions/src/ e no automacao.ts substitua a função scraperGoJet
// por: export { scraperGoJet } from './automacao-gojet-scraper';
//
// OU copie o conteúdo da função diretamente no automacao.ts existente.

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import axios from 'axios';
import { supabaseGet, supabaseUpsert, supabaseConfigured } from './lib/supabase-rest';
import { getAppSetting } from './config-supabase';

// Se GOJET_PROXY_URL estiver definido, usa Vercel proxy (evita bloqueio Cloudflare no GCP)
// Exemplo: https://gojet-proxy.vercel.app/api/gojet
// Sem proxy: https://logistic.gojet.app/api/v0/urent
const VERCEL_PROXY = process.env.GOJET_PROXY_URL ?? '';
const BASE_URL = VERCEL_PROXY || 'https://logistic.gojet.app/api/v0/urent';
const USE_PROXY = !!VERCEL_PROXY;
const LIMIT_PER_PAGE = 500; // conservador para evitar timeout

// ── Helper: busca TODAS as páginas de um endpoint ────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Origin': 'https://map.gojet.app',
  'Referer': 'https://map.gojet.app/',
  'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
};

async function fetchAllPages<T>(
  endpoint: string,
  cityId: string,
  extraParams: Record<string, string> = {}
): Promise<T[]> {
  let page = 1;
  let allItems: T[] = [];
  let totalPages = 1;
  let awsalbCookie = '';

  do {
    const params = new URLSearchParams({
      city_id: cityId,
      page: String(page),
      limit: String(LIMIT_PER_PAGE),
      ...extraParams,
      ...(USE_PROXY ? { path: endpoint } : {}),
    });

    // Proxy: GET /api/gojet?path=parkings&city_id=...
    // Direto: GET /parkings?city_id=...
    const url = USE_PROXY
      ? `${BASE_URL}?${params}`
      : `${BASE_URL}/${endpoint}?${params}`;
    const res = await axios.get(url, {
      timeout: 30000,
      headers: {
        ...BROWSER_HEADERS,
        ...(awsalbCookie ? { Cookie: awsalbCookie } : {}),
      },
    });

    // Captura cookie AWSALB para requests seguintes (sticky session)
    const setCookie = res.headers['set-cookie'];
    if (setCookie && page === 1) {
      awsalbCookie = setCookie
        .map((c: string) => c.split(';')[0])
        .join('; ');
    }
    const data = res.data;

    // A API pode retornar dados em diferentes formatos
    const items: T[] = data.entries ?? data.items ?? data.data ?? (Array.isArray(data) ? data : []);
    allItems = allItems.concat(items);

    // Detectar total de páginas em vários formatos
    totalPages = data.total_pages ?? data.totalPages ?? data.meta?.total_pages ?? 1;

    console.log(`[gojet] ${endpoint} página ${page}/${totalPages} → ${items.length} itens`);
    page++;
  } while (page <= totalPages && page <= 50); // limite de segurança: 50 páginas = 25.000 itens

  return allItems;
}

// ── Coleta de uma cidade ──────────────────────────────────────────────────────

async function coletarCidade(cityId: string, cidadeNome: string): Promise<{
  parkings: any[];
  bikes: any[];
  cityId: string;
  cidade: string;
}> {
  console.log(`[gojet] Coletando ${cidadeNome} (${cityId})...`);

  const [parkings, bikes] = await Promise.all([
    fetchAllPages<any>('parkings', cityId),
    fetchAllPages<any>('bikes',    cityId),
  ]);

  console.log(`[gojet] ${cidadeNome}: ${parkings.length} parkings, ${bikes.length} bikes`);

  return { parkings, bikes, cityId, cidade: cidadeNome };
}

// ── Salva snapshot no Firestore ───────────────────────────────────────────────

async function salvarSnapshot(dados: {
  parkings: any[];
  bikes: any[];
  cityId: string;
  cidade: string;
}): Promise<void> {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Firestore tem limite de 1MB por documento
  // Se parkings > 3000 ou bikes > 5000, salvar em chunks separados
  const PARKING_CHUNK = 3000;
  const BIKE_CHUNK    = 2000;

  const docId = `latest_${dados.cityId}`;
  const docIdBikes = `bikes_latest_${dados.cityId}`;

  // Snapshot de parkings
  if (dados.parkings.length <= PARKING_CHUNK) {
    await db.collection('gojet_snapshots').doc(docId).set({
      parkings: dados.parkings,
      cityId:   dados.cityId,
      cidade:   dados.cidade,
      total:    dados.parkings.length,
      savedAt:  now,
    });
  } else {
    // Divide em múltiplos documentos
    let chunk = 0;
    for (let i = 0; i < dados.parkings.length; i += PARKING_CHUNK) {
      await db.collection('gojet_snapshots').doc(`${docId}_chunk${chunk}`).set({
        parkings: dados.parkings.slice(i, i + PARKING_CHUNK),
        chunk, totalChunks: Math.ceil(dados.parkings.length / PARKING_CHUNK),
        cityId: dados.cityId, cidade: dados.cidade, savedAt: now,
      });
      chunk++;
    }
    // Índice do snapshot
    await db.collection('gojet_snapshots').doc(docId).set({
      chunked: true, totalChunks: chunk,
      cityId: dados.cityId, cidade: dados.cidade,
      total: dados.parkings.length, savedAt: now,
    });
  }

  // Snapshot de bikes
  if (dados.bikes.length <= BIKE_CHUNK) {
    await db.collection('gojet_snapshots').doc(docIdBikes).set({
      bikes:   dados.bikes,
      cityId:  dados.cityId,
      cidade:  dados.cidade,
      total:   dados.bikes.length,
      savedAt: now,
    });
  } else {
    let chunk = 0;
    for (let i = 0; i < dados.bikes.length; i += BIKE_CHUNK) {
      await db.collection('gojet_snapshots').doc(`${docIdBikes}_chunk${chunk}`).set({
        bikes: dados.bikes.slice(i, i + BIKE_CHUNK),
        chunk, totalChunks: Math.ceil(dados.bikes.length / BIKE_CHUNK),
        cityId: dados.cityId, cidade: dados.cidade, savedAt: now,
      });
      chunk++;
    }
    await db.collection('gojet_snapshots').doc(docIdBikes).set({
      chunked: true, totalChunks: chunk,
      cityId: dados.cityId, cidade: dados.cidade,
      total: dados.bikes.length, savedAt: now,
    });
  }

  // Mantém também os snapshots "legacy" (latest / bikes_latest) para compatibilidade
  // com GoJetOverlay que ainda lê esses documentos
  await db.collection('gojet_snapshots').doc('latest').set({
    parkings: dados.parkings.slice(0, PARKING_CHUNK), // até o limite do doc
    cityId:   dados.cityId,
    cidade:   dados.cidade,
    total:    dados.parkings.length,
    hasMore:  dados.parkings.length > PARKING_CHUNK,
    savedAt:  now,
  });

  await db.collection('gojet_snapshots').doc('bikes_latest').set({
    bikes:   dados.bikes.slice(0, BIKE_CHUNK),
    cityId:  dados.cityId,
    cidade:  dados.cidade,
    total:   dados.bikes.length,
    hasMore: dados.bikes.length > BIKE_CHUNK,
    savedAt: now,
  });

  console.log(`[gojet] Snapshot salvo: ${dados.parkings.length} parkings, ${dados.bikes.length} bikes`);

  // Dual-write to Supabase gojet_snapshots
  if (supabaseConfigured()) {
    try {
      await supabaseUpsert('gojet_snapshots', {
        id: dados.cityId,
        cidade: dados.cidade,
        city_id: dados.cityId,
        parkings: dados.parkings,
        bikes_total: dados.bikes.length,
        parkings_total: dados.parkings.length,
        atualizado_em: new Date().toISOString(),
      }, 'id');
    } catch (e: any) {
      console.warn('[gojet] Supabase dual-write failed:', e.message);
    }
  }
}

// ── Classificação de bike (server-side, sem dependência do frontend) ──────────

function classifyBikeServer(b: any): string {
  if (b.disabled || b.service_mode) return 'maintenance';
  if (b.booked)   return 'reserved';
  if (b.ordered)  return 'renting';
  const pct = b.battery_percent;
  if (pct !== undefined && pct !== null && pct < 0.2) return 'low_battery';
  return 'available';
}

function distMetrosServer(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ── Gera tarefas de monitor automaticamente após cada snapshot ─────────────────

async function gerarTarefasMonitorAuto(
  dados: { parkings: any[]; bikes: any[]; cityId: string; cidade: string },
  db: admin.firestore.Firestore
): Promise<void> {
  // Lê configuração de monitores para a cidade — Supabase-first
  let monitorCfg: any = null;
  try {
    const sbCfg = await getAppSetting('monitor_config_' + dados.cidade);
    if (sbCfg) monitorCfg = typeof sbCfg === 'string' ? JSON.parse(sbCfg) : sbCfg;
  } catch (_) { /* ignore */ }
  if (!monitorCfg) return; // sem config = feature desativada para esta cidade

  const niveisAtivos = (['M1','M2','M3'] as const).filter(m => monitorCfg[m]?.ativo);
  if (niveisAtivos.length === 0) return;

  // Carrega estações M1/M2/M3 — Supabase-first
  let estacoes: Array<{id: string; tipoMonitor: string; lat: number; lng: number}> = [];
  const sbEst = await supabaseGet<any>('estacoes', 'select=id,tipo_monitor,lat,lng&tipo_monitor=in.(M1,M2,M3)');
  if (sbEst && sbEst.length > 0) {
    estacoes = sbEst
      .map((e: any) => ({
        id: e.id,
        tipoMonitor: e.tipo_monitor as string,
        lat: (e.lat ?? 0) as number,
        lng: (e.lng ?? 0) as number,
      }))
      .filter((e: any) => e.lat && e.lng);
  }

  if (estacoes.length === 0) return;

  // Calcula disponíveis por parking
  const availPorP: Record<string, number> = {};
  for (const b of dados.bikes) {
    if (!b.parking_id) continue;
    if (classifyBikeServer(b) === 'available') {
      availPorP[b.parking_id] = (availPorP[b.parking_id] ?? 0) + 1;
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  let criadas = 0;
  const MAX_TASKS_PER_RUN = 50; // segurança: evita flood de tarefas

  for (const p of dados.parkings) {
    if (criadas >= MAX_TASKS_PER_RUN) break;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;

    // Proximidade: estação mais próxima dentro do raio
    let closest: typeof estacoes[0] | null = null;
    let closestDist = Infinity;
    for (const e of estacoes) {
      const cfg = monitorCfg[e.tipoMonitor];
      const raio = cfg?.raioBusca ?? 150;
      const d = distMetrosServer(p.latitude, p.longitude, e.lat, e.lng);
      if (d < closestDist && d <= raio) { closest = e; closestDist = d; }
    }
    if (!closest) continue;

    const cfg = monitorCfg[closest.tipoMonitor];
    if (!cfg?.ativo) continue;

    const avail  = availPorP[p.id] ?? 0;
    const target = p.target_bikes_count ?? 0;
    if (target === 0) continue;
    if ((avail / target) * 100 >= cfg.thresholdPct) continue;

    // Dedup: não criar se já existe tarefa aberta recente (independente de quando foi criada)
    const existente = await db.collection('tarefas_logistica')
      .where('parkingId', '==', p.id)
      .where('status', '==', 'aberto')
      .where('criadoPor', '==', 'monitor_auto')
      .limit(1)
      .get();
    if (!existente.empty) continue;

    const deficit = target - avail;
    const titulo  = (cfg.titulo || '{mLevel} - {parkingName}')
      .replace('{parkingName}', p.name || p.id)
      .replace('{mLevel}', closest.tipoMonitor);

    await db.collection('tarefas_logistica').add({
      cidade: dados.cidade,
      tipo: cfg.tipoTarefa || 'redistribuicao',
      titulo,
      descricao: `Ponto ${p.name} (${closest.tipoMonitor}) com ${avail}/${target} disponíveis. Déficit: ${deficit} patinetes.`,
      status: 'aberto',
      prioridade: cfg.prioridade || 'media',
      parkingId: p.id,
      parkingNome: p.name,
      parkingLat: p.latitude,
      parkingLng: p.longitude,
      monitorLevel: closest.tipoMonitor,
      estacaoId: closest.id,
      availableCount: avail,
      targetCount: target,
      deficit,
      criadoPor: 'monitor_auto',
      criadoEm: now,
      atualizadoEm: now,
    });
    criadas++;
  }

  if (criadas > 0) {
    console.log(`[gojet] Monitor auto: ${criadas} tarefas criadas para ${dados.cidade}`);
  }
}

// ── scraperGoJet — scheduler a cada 5min ─────────────────────────────────────

export const scraperGoJet = onSchedule(
  {
    schedule:       'every 15 minutes',
    timeZone:       'America/Sao_Paulo',
    region:         'southamerica-east1',
    timeoutSeconds: 540,   // 9min — paginação pode ser lenta
    memory:         '512MiB',
    maxInstances:   10,
  },
  async () => {
    const db = admin.firestore();

    // Lê cidades configuradas — Supabase-first
    let cidades: Array<{cidade: string; cityId: string}> = [];
    const sbCfg = await supabaseGet<any>('gojet_config', 'select=cidade,city_id&ativo=eq.true');
    if (sbCfg && sbCfg.length > 0) {
      cidades = sbCfg.map((r: any) => ({ cidade: r.cidade, cityId: r.city_id })).filter((c: any) => c.cityId);
    }
    if (cidades.length === 0) {
      console.warn('[gojet] Nenhuma cidade configurada em gojet_config (Supabase)');
      return;
    }

    console.log(`[gojet] ${cidades.length} cidades configuradas: ${cidades.map(c => c.cidade).join(', ')}`);

    // Processa em lotes de 3 para não sobrecarregar a API
    for (let i = 0; i < cidades.length; i += 3) {
      const lote = cidades.slice(i, i + 3);
      await Promise.all(lote.map(async ({ cidade, cityId }) => {
        try {
          const dados = await coletarCidade(cityId, cidade);
          await salvarSnapshot(dados);
          // Gera tarefas de monitor automaticamente (se monitor_config configurado)
          await gerarTarefasMonitorAuto(dados, db).catch(e =>
            console.error(`[gojet] Monitor auto erro em ${cidade}:`, e.message)
          );
        } catch (e: any) {
          console.error(`[gojet] Erro em ${cidade}:`, e.message);
          // Não falha o scraper inteiro por uma cidade
        }
      }));
    }

    console.log('[gojet] Scraper concluído');
  }
);

// ── scraperGoJetManual — callable para botão "Atualizar agora" ───────────────

export const scraperGoJetManual = onCall(
  { region: 'southamerica-east1', timeoutSeconds: 300, memory: '512MiB', maxInstances: 10 },
  async (request) => {
    const { cityId, cidade } = (request.data || {}) as { cityId?: string; cidade?: string };

    if (cityId && cidade) {
      // Cidade específica
      const dados = await coletarCidade(cityId, cidade);
      await salvarSnapshot(dados);
      return { ok: true, parkings: dados.parkings.length, bikes: dados.bikes.length };
    }

    // Todas as cidades — Supabase-only
    let cidadesManual: Array<{cidade: string; cityId: string}> = [];
    const sbCfgM = await supabaseGet<any>('gojet_config', 'select=cidade,city_id&ativo=eq.true');
    if (sbCfgM && sbCfgM.length > 0) {
      cidadesManual = sbCfgM.map((r: any) => ({ cidade: r.cidade, cityId: r.city_id })).filter((c: any) => c.cityId);
    }
    if (cidadesManual.length === 0) {
      return { ok: true, resultados: { erro: 'Nenhuma cidade configurada em gojet_config (Supabase)' } };
    }
    const resultados: Record<string, any> = {};

    for (const { cidade: cNome, cityId: cId } of cidadesManual) {
      if (!cId) continue;
      try {
        const dados = await coletarCidade(cId, cNome);
        await salvarSnapshot(dados);
        resultados[cNome] = { parkings: dados.parkings.length, bikes: dados.bikes.length };
      } catch (e: any) {
        resultados[cNome] = { erro: e.message };
      }
    }

    return { ok: true, resultados };
  }
);
