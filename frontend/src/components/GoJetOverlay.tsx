// frontend/src/components/GoJetOverlay.tsx
// GoJet overlay completo — JET OS V2
//
// Features:
//   🅿 Parkings coloridos por status (toggle independente de bikes)
//   🛴 Bikes individuais com bateria (toggle independente)
//   🏪 Mini-dashboard lateral esquerdo (legenda + stats)
//   🔍 Filtros inteligentes: zerados | abaixo target | excesso | fora de ponto
//   🎯 Cruzamento com estações M1/M2/M3 do JET OS
//   ⭐ Destaque de proximidade parking ↔ estação monitor
//   🔗 Criar tarefa rápida ao clicar no parking

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { doc, getDoc, getDocs, collection, query, where, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { fnScraperGoJetManual } from '../lib/firebase';
import L from 'leaflet';
import { classifyBike as classifyBikeShared, BIKE_STATUS_HEX } from '../lib/bike-classify';
import { colorForParking, PARKING_COLOR_HEX } from '../lib/parking-colors';
import AdminBikeActionsLazy from './AdminBikeActions';
import { EventoGoJetPanel } from './EventoGoJetPanel';
import { MonitorConfigPanel } from './MonitorConfigPanel';

// Detecta APK Capacitor — no nativo o CORS bloqueia fetch direto
function isNativeApp(): boolean {
  const cap = (window as any).Capacitor;
  return !!(cap?.isNativePlatform?.());
}

// Cache de estações no módulo — evita getDocs repetido entre mounts
let _estacoesCache: EstacaoMonitor[] | null = null;
let _estacoesCacheTs = 0;
const ESTACOES_TTL = 5 * 60_000; // 5 min

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface GoJetParking {
  id: string;
  name: string;
  monitor?: boolean;
  bikes_count?: number;
  target_bikes_count?: number;
  latitude: number;
  longitude: number;
  availableCount?: number;
  rentingCount?: number;
  // Enriquecido localmente
  monitorLevel?: 'M1' | 'M2' | 'M3' | null; // nível da estação JET OS mais próxima
  estacaoId?: string | null;
  distanciaEstacao?: number | null; // metros
}

interface GoJetBike {
  id: string;
  identifier?: string;
  name?: string;
  model?: string;
  business_status?: string;
  business_sub_status?: string;
  disabled?: boolean;
  ordered?: boolean;
  booked?: boolean;
  service_mode?: boolean;
  battery_percent?: number;
  battery_customer_percent?: number;
  status_since?: number;   // timestamp ms quando entrou no status atual (calculado localmente)
  parking_id?: string | null;
  location_lat: number;
  location_lng: number;
  last_order_at?: string;
}

interface MonitorLevelConfig {
  ativo: boolean;
  thresholdPct: number;       // gera tarefa quando disponível < X% do target
  tipoTarefa: string;         // 'redistribuicao' | 'recarga' | 'manutencao'
  titulo: string;             // '{mLevel} - {parkingName}'
  prioridade: 'alta' | 'media' | 'baixa';
  raioBusca: number;          // metros (padrão 150)
  deduplicarHoras: number;    // não recriar se tarefa aberta < N horas
}

interface MonitorConfig {
  M1?: MonitorLevelConfig;
  M2?: MonitorLevelConfig;
  M3?: MonitorLevelConfig;
}

interface ViolacaoMonitor {
  parking: GoJetParking;
  cfg: MonitorLevelConfig;
  deficit: number;
  pctDisp: number;
}

interface EstacaoMonitor {
  id: string;
  tipoMonitor: 'M1' | 'M2' | 'M3';
  lat: number;
  lng: number;
  nome?: string;
  codigo?: string;
  // Campos para pontos temporários de evento
  temporario?: boolean;
  eventoId?: string;
  eventoNome?: string;
  eventoFim?: Date;
  targetBikes?: number;
}

type BikeStatus = 'available' | 'renting' | 'reserved' | 'maintenance' | 'low_battery' | 'oficina' | 'apreendidos';

// Filtros de visualização
type FiltroParking = 'todos' | 'zerados' | 'abaixo_target' | 'no_target' | 'excesso';
type FiltroBike    = 'todos' | 'fora_ponto' | 'bateria_baixa' | 'disponiveis';
type ViewLayer     = 'parkings' | 'bikes' | 'ambos';

interface Props {
  mapa: L.Map | null;
  visivel: boolean;
  cidade?: string;
  onTarefaRapida?: (parking: GoJetParking) => void;
  isAdmin?: boolean;
  gestorUid?: string;
  gestorNome?: string;
}

// ─── bike-classify — usa lib compartilhada ────────────────────────────────────

function classifyBike(b: GoJetBike): BikeStatus {
  return classifyBikeShared(b) as BikeStatus;
}

const BIKE_COR: Record<BikeStatus, string> = BIKE_STATUS_HEX as Record<BikeStatus, string>;

// ─── Timer helpers ───────────────────────────────────────────────────────────

function fmtTempo(ms: number): string {
  const min  = Math.floor(ms / 60000);
  if (min < 60)  return `${min}m`;
  const hr   = Math.floor(min / 60);
  const rm   = min % 60;
  if (hr < 24)   return rm > 0 ? `${hr}h${rm}m` : `${hr}h`;
  const dias = Math.floor(hr / 24);
  const rh   = hr % 24;
  return rh > 0 ? `${dias}d${rh}h` : `${dias}d`;
}

function corTempo(ms: number, status: BikeStatus): string {
  const hr = ms / 3600000;
  if (status === 'maintenance') {
    if (hr > 48) return '#ef4444';  // vermelho — mais de 2 dias
    if (hr > 12) return '#f97316';  // laranja — mais de 12h
    return '#fbbf24';               // amarelo — recente
  }
  // low_battery
  if (hr > 24) return '#ef4444';
  if (hr > 6)  return '#f97316';
  return '#fbbf24';
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function distMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ─── Cores parkings — usa lib compartilhada ───────────────────────────────────

const COR_MAP: Record<string, { bg: string; borda: string; texto: string }> = {
  red:    { bg:'#7f1d1d', borda:'#ef4444', texto:'#fca5a5' },
  orange: { bg:'#78350f', borda:'#f59e0b', texto:'#fde68a' },
  yellow: { bg:'#422006', borda:'#d97706', texto:'#fde68a' },
  blue:   { bg:'#172554', borda:'#3b82f6', texto:'#93c5fd' },
  green:  { bg:'#052e16', borda:'#22c55e', texto:'#86efac' },
  gray:   { bg:'#1e293b', borda:'#475569', texto:'#94a3b8' },
};

function corParking(avail: number, target: number, monitor?: boolean): { bg: string; borda: string; texto: string } {
  const cor = colorForParking({ monitor, availableCount: avail, target_bikes_count: target });
  return COR_MAP[cor] ?? COR_MAP.gray;
}

const M_COR: Record<string, string> = { M1:'#10b981', M2:'#3b82f6', M3:'#f59e0b' };

const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  M1: { ativo: true,  thresholdPct: 30, tipoTarefa: 'redistribuicao', titulo: '{mLevel} - {parkingName}', prioridade: 'alta',  raioBusca: 150, deduplicarHoras: 4 },
  M2: { ativo: true,  thresholdPct: 40, tipoTarefa: 'redistribuicao', titulo: '{mLevel} - {parkingName}', prioridade: 'media', raioBusca: 150, deduplicarHoras: 4 },
  M3: { ativo: false, thresholdPct: 50, tipoTarefa: 'recarga',        titulo: '{mLevel} - {parkingName}', prioridade: 'baixa', raioBusca: 200, deduplicarHoras: 8 },
};

// Encontra a estação vinculada a um parking (para checar se é temporária)
const _estacoesPorId: Map<string, EstacaoMonitor> = new Map();

function iconParking(p: GoJetParking, estacaoInfo?: EstacaoMonitor | null): L.DivIcon {
  const total  = p.bikes_count    ?? 0;
  const avail  = p.availableCount ?? 0;
  const target = p.target_bikes_count ?? 0;
  const cor    = corParking(avail, target, p.monitor);
  const isMonitor  = p.monitor === true;
  const mLevel     = p.monitorLevel;
  const isEvento   = estacaoInfo?.temporario === true;
  const mCorBorder = mLevel ? (isEvento ? '#f59e0b' : M_COR[mLevel]) : null;
  const badge      = isEvento ? 'EV' : mLevel;
  const badgeBg    = isEvento ? '#d97706' : mCorBorder;
  const pulse      = isEvento ? `
    @keyframes ev-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,.5)} 50%{box-shadow:0 0 0 4px rgba(217,119,6,0)} }
    animation:ev-pulse 2s infinite;` : '';
  return L.divIcon({
    className: '', iconSize: [18, 18], iconAnchor: [9, 9],
    html: `<style>${pulse ? `#pk-${p.id}{${pulse}}` : ''}</style>
    <div id="pk-${p.id}" style="
      width:18px;height:18px;position:relative;
      border-radius:${isMonitor ? '50%' : '4px'};
      background:${cor.bg};
      border:${isEvento ? `1.5px dashed #f59e0b` : mCorBorder ? `1.5px solid ${mCorBorder}` : `1px solid ${cor.borda}`};
      display:flex;align-items:center;justify-content:center;
      font-size:7px;font-weight:800;color:${cor.texto};
      box-shadow:0 1px 3px rgba(0,0,0,.6);
      font-family:Inter,sans-serif;
    ">${total}${badge ? `<span style="position:absolute;top:-4px;right:-4px;background:${badgeBg};color:#fff;border-radius:3px;padding:0 2px;font-size:6px;font-weight:700">${badge}</span>` : ''}</div>`,
  });
}

function iconBike(b: GoJetBike, agora = Date.now()): L.DivIcon {
  const status  = classifyBike(b);
  const cor     = BIKE_COR[status];
  const pct     = b.battery_percent;
  const hasBatt = pct !== undefined && pct !== null;
  const showTimer = (status === 'maintenance' || status === 'low_battery') && b.status_since;
  const tempoMs   = showTimer ? agora - (b.status_since ?? agora) : 0;
  const tempoStr  = showTimer ? fmtTempo(tempoMs) : '';
  const timerCor  = showTimer ? corTempo(tempoMs, status) : '#fff';

  const h = showTimer ? 30 : hasBatt ? 19 : 12;
  return L.divIcon({
    className: '', iconSize: [28, h], iconAnchor: [14, h / 2],
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">
      <div style="width:12px;height:12px;border-radius:50%;background:${cor};border:1.5px solid rgba(0,0,0,.35);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>
      ${hasBatt ? `<div style="height:3px;width:12px;background:rgba(255,255,255,.15);border-radius:2px"><div style="height:3px;width:${Math.round((pct??0)*100)}%;background:${(pct??0)<0.2?'#ef4444':(pct??0)<0.4?'#f97316':'#22c55e'};border-radius:2px"></div></div>` : ''}
      ${showTimer ? `<div style="background:rgba(0,0,0,.75);color:${timerCor};font-size:8px;font-weight:700;padding:1px 3px;border-radius:3px;white-space:nowrap;line-height:1.2">${tempoStr}</div>` : ''}
    </div>`,
  });
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function GoJetOverlay({ mapa, visivel, cidade, onTarefaRapida, isAdmin, gestorUid, gestorNome }: Props) {
  const parkingLayerRef = useRef<L.LayerGroup | null>(null);
  const bikeLayerRef    = useRef<L.LayerGroup | null>(null);

  const [parkings,      setParkings]      = useState<GoJetParking[]>([]);
  const [bikes,         setBikes]         = useState<GoJetBike[]>([]);
  const [estacoes,      setEstacoes]      = useState<EstacaoMonitor[]>([]);
  const [atualizadoEm,  setAtualizadoEm]  = useState<Date | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [erro,          setErro]          = useState<string | null>(null);
  const [cityId,        setCityId]        = useState('');

  // Layers ativos (independentes)
  const [showParkings, setShowParkings] = useState(true);
  const [showBikes,    setShowBikes]    = useState(false);
  const [tickAgora,    setTickAgora]    = useState(() => Date.now());
  const statusSinceRef = useRef<Record<string, { status: string; since: number }>>({});

  // Filtros
  const [filtroPark, setFiltroPark] = useState<FiltroParking>('todos');
  const [filtroBike, setFiltroBike] = useState<FiltroBike>('todos');
  const [somenteMonitor, setSomenteMonitor] = useState(false);
  const [apenasComVinculo, setApenasComVinculo] = useState(false);

  // Admin bike actions
  const [adminAction, setAdminAction] = useState<{
    modo: 'trazer_bike'|'organizar'|'mover_bike';
    parkingAlvo?: GoJetParking;
    bikeAlvo?: GoJetBike;
  } | null>(null);

  // Eventos GoJet panel
  const [showEventosPanel, setShowEventosPanel] = useState(false);

  // Monitor config
  const [monitorConfig, setMonitorConfig]     = useState<MonitorConfig | null>(null);
  const [violacoesModal, setViolacoesModal]   = useState<ViolacaoMonitor[] | null>(null);
  const [criandoTarefas, setCriandoTarefas]   = useState(false);
  const [tarefasCriadas, setTarefasCriadas]   = useState<number | null>(null);
  const [showConfigMonitor, setShowConfigMonitor] = useState(false);

  // UI
  const [dashAberto, setDashAberto] = useState(false);

  // ── Buscar estações M1/M2/M3 do JET OS + pontos temporários de evento ────────
  useEffect(() => {
    if (!visivel) return;
    const agora = Date.now();

    async function carregarEstacoes() {
      // Query 1: estações permanentes M1/M2/M3 (cache 5 min — mesmas para toda BR)
      let permanentes: EstacaoMonitor[] = [];
      if (_estacoesCache && agora - _estacoesCacheTs < ESTACOES_TTL) {
        permanentes = _estacoesCache;
      } else {
        const snap = await getDocs(query(collection(db, 'estacoes'),
          where('tipoMonitor', 'in', ['M1','M2','M3'])
        ));
        permanentes = snap.docs
          .filter(d => !d.data().temporario)
          .map(d => {
            const x = d.data();
            return {
              id: d.id, tipoMonitor: x.tipoMonitor,
              lat: x.lat ?? x.latitude ?? 0, lng: x.lng ?? x.longitude ?? 0,
              nome: x.nome ?? x.name, codigo: x.codigo,
            };
          }).filter(e => e.lat && e.lng);
        _estacoesCache = permanentes;
        _estacoesCacheTs = Date.now();
      }

      // Query 2: pontos temporários de evento — filtrado por cidade (escala BR)
      let temporarias: EstacaoMonitor[] = [];
      if (cidade) {
        const tempSnap = await getDocs(query(collection(db, 'estacoes'),
          where('temporario', '==', true),
          where('cidade', '==', cidade),
        ));
        const now = new Date();
        temporarias = tempSnap.docs
          .filter(d => {
            const fim = d.data().eventoFim?.toDate?.();
            return fim && fim > now;
          })
          .map(d => {
            const x = d.data();
            return {
              id: d.id, tipoMonitor: 'M3' as const,
              lat: x.lat ?? 0, lng: x.lng ?? 0,
              nome: x.eventoNome ?? x.nome,
              temporario: true,
              eventoId: x.eventoId,
              eventoNome: x.eventoNome,
              eventoFim: x.eventoFim?.toDate?.(),
              targetBikes: x.targetBikes,
            };
          }).filter(e => e.lat && e.lng);
      }

      setEstacoes([...permanentes, ...temporarias]);
    }

    carregarEstacoes().catch(() => {});
  }, [visivel, cidade]);

  // Busca cityId — reseta ao trocar cidade para não usar cityId da cidade anterior
  useEffect(() => {
    setCityId('');
    setParkings([]); setBikes([]);
    setErro(null); setAtualizadoEm(null);
    if (!cidade) return;
    import('firebase/firestore').then(({ doc: fDoc, getDoc }) =>
      getDoc(fDoc(db, 'gojet_config', cidade)).then(snap => {
        if (snap.exists() && snap.data().cityId) {
          setCityId(snap.data().cityId);
        } else {
          setErro(`GoJet não configurado para "${cidade}". Adicione um doc em gojet_config/${cidade} com campo cityId.`);
        }
      }).catch(() => setErro('Erro ao buscar config GoJet'))
    );
  }, [cidade]);

  // ── Carrega snapshot do Firestore (scraper já fez paginação completa) ─────────
  const estacoesRef = useRef<EstacaoMonitor[]>([]);
  useEffect(() => { estacoesRef.current = estacoes; }, [estacoes]);

  // Lê doc do Firestore montando chunks se necessário
  async function lerSnapshotDoc(docId: string, campo: string): Promise<any[]> {
    const snap = await getDoc(doc(db, 'gojet_snapshots', docId));
    if (!snap.exists()) return [];
    const data = snap.data()!;
    if (!data.chunked) return data[campo] ?? [];
    // Lê todos os chunks em paralelo
    const chunkDocs = await Promise.all(
      Array.from({ length: data.totalChunks as number }, (_, i) =>
        getDoc(doc(db, 'gojet_snapshots', `${docId}_chunk${i}`))
      )
    );
    return chunkDocs.flatMap(c => (c.exists() ? (c.data()![campo] ?? []) : []));
  }

  const [snapshotIdade, setSnapshotIdade] = useState<number | null>(null); // minutos
  const [atualizandoScraper, setAtualizandoScraper] = useState(false);

  const carregarSnapshot = useCallback(async () => {
    if (!cityId) return;
    setLoading(true); setErro(null);
    try {
      const snapId      = `latest_${cityId}`;
      const bikesSnapId = `bikes_latest_${cityId}`;

      // Lê parkings e bikes em paralelo, com suporte a chunks
      const [parkingList, bikeList, pMetaSnap] = await Promise.all([
        lerSnapshotDoc(snapId, 'parkings'),
        lerSnapshotDoc(bikesSnapId, 'bikes'),
        getDoc(doc(db, 'gojet_snapshots', snapId)),
      ]);

      if (parkingList.length === 0 && bikeList.length === 0) {
        setErro('Snapshot ainda não existe para esta cidade. Clique em "Atualizar agora" para gerar.');
        return;
      }

      // Calcula idade do snapshot
      const savedAt = pMetaSnap.exists()
        ? (pMetaSnap.data()?.savedAt?.toMillis?.() ?? pMetaSnap.data()?.atualizadoEm?.toMillis?.() ?? null)
        : null;
      if (savedAt) setSnapshotIdade(Math.round((Date.now() - savedAt) / 60000));

      // Contagens por parking
      const totalPorP:   Record<string, number> = {};
      const availPorP:   Record<string, number> = {};
      const rentingPorP: Record<string, number> = {};
      for (const b of bikeList) {
        if (!b.parking_id) continue;
        totalPorP[b.parking_id]   = (totalPorP[b.parking_id]   ?? 0) + 1;
        const s = classifyBike(b);
        if (s === 'available') availPorP[b.parking_id]   = (availPorP[b.parking_id]   ?? 0) + 1;
        if (s === 'renting')   rentingPorP[b.parking_id] = (rentingPorP[b.parking_id] ?? 0) + 1;
      }

      // Enriquece parkings com contagens + vínculo M1/M2/M3
      const enriched: GoJetParking[] = (parkingList as GoJetParking[])
        .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map(p => {
          let closest: EstacaoMonitor | null = null;
          let closestDist = Infinity;
          for (const e of estacoesRef.current) {
            const d = distMetros(p.latitude, p.longitude, e.lat, e.lng);
            if (d < closestDist && d <= 150) { closest = e; closestDist = d; }
          }
          return {
            ...p,
            bikes_count:      totalPorP[p.id]   ?? p.bikes_count ?? 0,
            availableCount:   availPorP[p.id]   ?? 0,
            rentingCount:     rentingPorP[p.id] ?? 0,
            monitorLevel:     closest?.tipoMonitor ?? null,
            estacaoId:        closest?.id ?? null,
            distanciaEstacao: closest ? closestDist : null,
          };
        });

      const bikesValidos: GoJetBike[] = (bikeList as GoJetBike[]).filter(b =>
        Number.isFinite(b.location_lat) && Number.isFinite(b.location_lng)
      );

      setParkings(enriched);

      const agora = Date.now();
      const enrichedBikes: GoJetBike[] = bikesValidos.map(b => {
        const status = classifyBike(b);
        const prev   = statusSinceRef.current[b.id];
        if (!prev || prev.status !== status) {
          statusSinceRef.current[b.id] = { status, since: agora };
        }
        return { ...b, status_since: statusSinceRef.current[b.id]?.since ?? agora };
      });
      setBikes(enrichedBikes);
      setAtualizadoEm(new Date());

    } catch (e: any) { setErro(e.message ?? 'Erro ao ler snapshot GoJet'); }
    finally { setLoading(false); }
  }, [cityId]);

  // Força atualização: fetch direto da GoJet API pelo browser (sem proxy, sem Cloud Function)
  const forcarAtualizacao = useCallback(async () => {
    if (!cityId || !cidade) return;
    setAtualizandoScraper(true); setErro(null);
    try {
      const { scraperGoJetBrowser } = await import('../lib/gojet-scraper');
      await scraperGoJetBrowser(cityId, cidade);
      await carregarSnapshot();
    } catch (e: any) {
      setErro('Erro ao atualizar: ' + (e.message ?? ''));
    } finally {
      setAtualizandoScraper(false);
    }
  }, [cityId, cidade, carregarSnapshot]);

  // Carrega configuração de monitor para a cidade atual
  useEffect(() => {
    if (!cidade || !visivel) return;
    getDoc(doc(db, 'monitor_config', cidade)).then(snap => {
      if (snap.exists()) setMonitorConfig(snap.data() as MonitorConfig);
      else setMonitorConfig(DEFAULT_MONITOR_CONFIG);
    }).catch(() => setMonitorConfig(DEFAULT_MONITOR_CONFIG));
  }, [cidade, visivel]);

  // Verifica parkings que violam thresholds dos monitores
  const verificarViolacoes = useCallback((): ViolacaoMonitor[] => {
    if (!monitorConfig) return [];
    const violacoes: ViolacaoMonitor[] = [];
    for (const p of parkings) {
      if (!p.monitorLevel) continue;
      const cfg = monitorConfig[p.monitorLevel];
      if (!cfg?.ativo) continue;
      const avail  = p.availableCount ?? 0;
      const target = p.target_bikes_count ?? 0;
      if (target === 0) continue;
      const pctDisp = (avail / target) * 100;
      if (pctDisp < cfg.thresholdPct) {
        violacoes.push({ parking: p, cfg, deficit: target - avail, pctDisp: Math.round(pctDisp) });
      }
    }
    // Ordena por prioridade: M1 > M2 > M3 e maior déficit primeiro
    const PRIORIDADE_ORDEM = ['alta', 'media', 'baixa'];
    return violacoes.sort((a, b) => {
      const pa = PRIORIDADE_ORDEM.indexOf(a.cfg.prioridade);
      const pb = PRIORIDADE_ORDEM.indexOf(b.cfg.prioridade);
      if (pa !== pb) return pa - pb;
      return b.deficit - a.deficit;
    });
  }, [parkings, monitorConfig]);

  const criarTarefasMonitor = useCallback(async (violacoes: ViolacaoMonitor[]) => {
    if (!cidade || violacoes.length === 0) return 0;
    setCriandoTarefas(true);
    let criadas = 0;
    try {
      const col = collection(db, 'tarefas_logistica');
      for (const { parking: p, cfg, deficit } of violacoes) {
        const avail  = p.availableCount ?? 0;
        const target = p.target_bikes_count ?? 0;
        const titulo = cfg.titulo
          .replace('{mLevel}', p.monitorLevel!)
          .replace('{parkingName}', p.name || p.id);
        await addDoc(col, {
          cidade,
          tipo: cfg.tipoTarefa,
          titulo,
          descricao: `Ponto ${p.name} (${p.monitorLevel}) com ${avail}/${target} disponíveis. Déficit: ${deficit} patinetes.`,
          status: 'aberto',
          prioridade: cfg.prioridade,
          parkingId: p.id,
          parkingNome: p.name,
          parkingLat: p.latitude,
          parkingLng: p.longitude,
          monitorLevel: p.monitorLevel,
          estacaoId: p.estacaoId ?? null,
          availableCount: avail,
          targetCount: target,
          deficit,
          criadoPor: 'monitor_manual',
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        });
        criadas++;
      }
      setTarefasCriadas(criadas);
      setTimeout(() => setTarefasCriadas(null), 4000);
    } catch (e: any) {
      setErro('Erro ao criar tarefas: ' + (e.message ?? ''));
    } finally {
      setCriandoTarefas(false);
    }
    return criadas;
  }, [cidade]);

  useEffect(() => {
    if (!visivel || !cityId) return;
    carregarSnapshot();
    // Recarrega do Firestore a cada 5 min (o scraper já atualizou o snapshot)
    const t = setInterval(carregarSnapshot, 5 * 60_000);
    return () => clearInterval(t);
  }, [visivel, cityId, carregarSnapshot]);

  // ── Parkings filtrados ────────────────────────────────────────────────────

  const parkingsFiltrados = useMemo(() => parkings.filter(p => {
    if (somenteMonitor && !p.monitor) return false;
    if (apenasComVinculo && !p.monitorLevel) return false;
    const avail  = p.availableCount ?? 0;
    const total  = p.bikes_count    ?? 0;
    const target = p.target_bikes_count ?? 0;
    switch (filtroPark) {
      case 'zerados':        return avail === 0;
      case 'abaixo_target':  return target > 0 && avail < target;
      case 'no_target':      return target > 0 && avail >= target && avail < target * 1.2;
      case 'excesso':        return target > 0 && avail >= target * 1.2;
      default:               return true;
    }
  }), [parkings, filtroPark, somenteMonitor, apenasComVinculo]);

  const bikesFiltrados = useMemo(() => bikes.filter(b => {
    const s = classifyBike(b);
    switch (filtroBike) {
      case 'fora_ponto':    return !b.parking_id;
      case 'bateria_baixa': return s === 'low_battery';
      case 'disponiveis':   return s === 'available';
      default:              return true;
    }
  }), [bikes, filtroBike]);

  // ── Markers: criados UMA VEZ, filtro via show/hide (sem recriar) ───────────
  const parkingMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const bikeMarkersRef    = useRef<Map<string, L.Marker>>(new Map());
  // Ref para bikes — lido no popup de parking sem criar dependência que recria markers
  const bikesRef = useRef<GoJetBike[]>([]);
  useEffect(() => { bikesRef.current = bikes; }, [bikes]);

  // Cria/atualiza markers de parkings quando DADOS mudam
  useEffect(() => {
    if (!mapa || !visivel) return;
    // Criar layer desacoplado do mapa — adiciona ao mapa só depois de popular
    if (!parkingLayerRef.current) {
      parkingLayerRef.current = L.layerGroup();
    }
    const layer    = parkingLayerRef.current;
    const existing = parkingMarkersRef.current;
    const newIds   = new Set(parkings.map(p => p.id));
    const isNew    = existing.size === 0 && parkings.length > 0;

    // Remove obsoletos
    for (const [id, m] of existing) {
      if (!newIds.has(id)) { layer.removeLayer(m); existing.delete(id); }
    }

    // Indexa estações por id para popup de evento
    for (const e of estacoesRef.current) _estacoesPorId.set(e.id, e);

    for (const p of parkings) {
      const estInfo = p.estacaoId ? (_estacoesPorId.get(p.estacaoId) ?? null) : null;
      if (existing.has(p.id)) {
        existing.get(p.id)!.setIcon(iconParking(p, estInfo)); // atualiza contagem
      } else {
        const avail   = p.availableCount ?? 0;
        const total   = p.bikes_count    ?? 0;
        const target  = p.target_bikes_count ?? 0;
        const deficit = Math.max(0, target - avail);
        const cor     = corParking(avail, target);
        const mLevel  = p.monitorLevel;
        const isEvento = estInfo?.temporario === true;
        const marker  = L.marker([p.latitude, p.longitude], {
          icon: iconParking(p, estInfo),
          zIndexOffset: isEvento ? 300 : mLevel ? 200 : p.monitor ? 100 : 0,
        });
        marker.bindPopup(() => {
          // Bikes neste ponto — lidos de bikesRef no momento do clique (sempre frescos)
          const bikesNoPonto = bikesRef.current.filter(b => b.parking_id === p.id);
          const statusLabel: Record<string, string> = {
            available: 'Disponível', renting: 'Aluguel', reserved: 'Reservado',
            low_battery: 'Bat. baixa', maintenance: 'Manutenção', workshop: 'Oficina',
          };

          const bikesHtml = bikesNoPonto.length === 0
            ? '<div style="font-size:10px;color:#9ca3af;margin-top:4px">Nenhum patinete neste ponto</div>'
            : bikesNoPonto.slice(0, 20).map(b => {
                const st  = classifyBike(b);
                const cor = BIKE_COR[st];
                const pct = b.battery_percent;
                const pctN = pct !== undefined ? Math.round(pct * 100) : null;
                const bCor = pctN !== null ? (pctN < 20 ? '#ef4444' : pctN < 40 ? '#f97316' : '#22c55e') : '#94a3b8';
                return `
                  <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f1f5f9">
                    <div style="width:8px;height:8px;border-radius:50%;background:${cor};flex-shrink:0"></div>
                    <div style="flex:1;min-width:0">
                      <div style="font-size:11px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.identifier || b.id.slice(-6)}</div>
                      <div style="font-size:9px;color:${cor}">${statusLabel[st] ?? st}</div>
                    </div>
                    ${pctN !== null ? `
                      <div style="flex-shrink:0;text-align:right">
                        <div style="font-size:10px;font-weight:700;color:${bCor}">${pctN}%</div>
                        <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin-top:1px">
                          <div style="height:4px;width:${pctN}%;background:${bCor};border-radius:2px"></div>
                        </div>
                      </div>` : ''}
                  </div>`;
              }).join('')
            + (bikesNoPonto.length > 20 ? `<div style="font-size:9px;color:#94a3b8;margin-top:4px;text-align:center">+${bikesNoPonto.length - 20} mais</div>` : '');

          const div = document.createElement('div');
          div.style.cssText = 'font-family:Inter,sans-serif;min-width:220px;max-width:260px;font-size:12px';
          div.innerHTML = `
            <div style="font-weight:700;font-size:13px;color:#0d0d1a;margin-bottom:6px;padding-right:16px">
              ${p.monitor ? '📍' : 'P'} ${p.name || p.id}
              ${mLevel ? `<span style="background:${M_COR[mLevel]};color:#fff;border-radius:4px;padding:1px 5px;font-size:9px;margin-left:4px">${mLevel}</span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px">
              <div style="background:#f0fdf4;border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:16px;font-weight:800;color:#16a34a">${total}</div>
                <div style="font-size:8px;color:#6b7280">total</div>
              </div>
              <div style="background:#f0f9ff;border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:16px;font-weight:800;color:#0369a1">${avail}</div>
                <div style="font-size:8px;color:#6b7280">disponíveis</div>
              </div>
              <div style="background:#fafafa;border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:16px;font-weight:800;color:#374151">${target || '—'}</div>
                <div style="font-size:8px;color:#6b7280">target</div>
              </div>
            </div>
            ${deficit > 0 ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:4px 8px;border-radius:4px;font-size:10px;color:#dc2626;margin-bottom:6px">⚠️ Faltam ${deficit} patinete${deficit > 1 ? 's' : ''}</div>` : ''}
            ${p.distanciaEstacao != null && !isEvento ? `<div style="font-size:10px;color:#7c3aed;margin-bottom:6px">🏪 Estação ${mLevel} a ${Math.round(p.distanciaEstacao)}m</div>` : ''}
            ${isEvento && estInfo?.eventoNome ? (() => {
              const fim = estInfo.eventoFim;
              const diff = fim ? fim.getTime() - Date.now() : 0;
              const horas = Math.floor(diff / 3600000);
              const mins  = Math.floor((diff % 3600000) / 60000);
              const tempoStr = diff <= 0 ? 'Encerrado' : horas > 0 ? `${horas}h${mins}m restantes` : `${mins}m restantes`;
              const corTempo2 = diff <= 0 ? '#ef4444' : diff < 3600000 ? '#f97316' : '#f59e0b';
              return `<div style="background:rgba(217,119,6,.12);border-left:3px solid #f59e0b;padding:6px 8px;border-radius:4px;margin-bottom:6px">
                <div style="font-size:10px;font-weight:700;color:#fbbf24">📅 Evento: ${estInfo.eventoNome}</div>
                <div style="font-size:9px;color:${corTempo2};margin-top:2px">⏱ ${tempoStr}</div>
                ${estInfo.targetBikes ? `<div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:1px">Target evento: ${estInfo.targetBikes} bikes</div>` : ''}
              </div>`;
            })() : ''}
            <div style="font-size:10px;font-weight:700;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px">
              🛴 Patinetes neste ponto (${bikesNoPonto.length})
            </div>
            <div style="max-height:180px;overflow-y:auto;scrollbar-width:thin">${bikesHtml}</div>
            ${onTarefaRapida ? `<button id="btn-t-${p.id}" style="width:100%;padding:7px;border:none;border-radius:6px;background:${cor.borda};color:#fff;font-size:11px;font-weight:700;cursor:pointer;margin-top:8px;margin-bottom:4px">+ Criar tarefa</button>` : ''}
            ${isAdmin && deficit > 0 ? `<button id="btn-admin-${p.id}" style="width:100%;padding:7px;border:none;border-radius:6px;background:#7c3aed;color:#fff;font-size:11px;font-weight:700;cursor:pointer">🚚 Trazer bike (admin)</button>` : ''}
          `;
          if (onTarefaRapida) {
            setTimeout(() => {
              document.getElementById(`btn-t-${p.id}`)?.addEventListener('click', () => {
                mapa.closePopup(); onTarefaRapida(p);
              });
            }, 0);
          }
          if (isAdmin && deficit > 0) {
            setTimeout(() => {
              document.getElementById(`btn-admin-${p.id}`)?.addEventListener('click', () => {
                mapa.closePopup();
                setAdminAction({ modo: 'trazer_bike', parkingAlvo: p });
              });
            }, 0);
          }
          return div;
        }, { maxWidth: 270 });
        layer.addLayer(marker);
        existing.set(p.id, marker);
      }
    }
    // Na carga inicial, adiciona layer ao mapa de uma vez (batch)
    if (isNew && !mapa.hasLayer(layer)) layer.addTo(mapa);
    return () => {
      if (parkingLayerRef.current) { mapa.removeLayer(parkingLayerRef.current); parkingLayerRef.current = null; parkingMarkersRef.current.clear(); }
    };
  }, [mapa, visivel, parkings, onTarefaRapida]);

  // Canvas renderer compartilhado para bikes — sem DOM por marker (muito mais rápido)
  const canvasRendererRef = useRef<L.Canvas | null>(null);

  // Cria/atualiza markers de bikes quando DADOS mudam
  useEffect(() => {
    if (!mapa || !visivel) return;
    if (!canvasRendererRef.current) canvasRendererRef.current = L.canvas({ padding: 0.5 });
    if (!bikeLayerRef.current) bikeLayerRef.current = L.layerGroup();
    const layer    = bikeLayerRef.current;
    const existing = bikeMarkersRef.current;
    const renderer = canvasRendererRef.current;
    const newIds   = new Set(bikes.map(b => b.id));

    // Remove obsoletos
    for (const [id, m] of existing) {
      if (!newIds.has(id)) { layer.removeLayer(m); existing.delete(id); }
    }

    // Novos bikes — circleMarker canvas (zero DOM por marker)
    const toAdd: L.CircleMarker[] = [];
    for (const b of bikes) {
      if (existing.has(b.id)) {
        // Apenas atualiza cor se status mudou — sem recriar
        const status = classifyBike(b);
        const cm = existing.get(b.id) as unknown as L.CircleMarker;
        cm.setStyle({ fillColor: BIKE_COR[status], color: BIKE_COR[status] });
      } else {
        const status = classifyBike(b);
        const cor    = BIKE_COR[status];
        const pct    = b.battery_percent;
        const pctN   = pct !== undefined ? Math.round(pct * 100) : null;
        const bCor   = pctN !== null ? (pctN < 20 ? '#ef4444' : pctN < 40 ? '#f97316' : '#22c55e') : '#6b7280';
        const cm = L.circleMarker([b.location_lat, b.location_lng], {
          renderer,
          radius: 5,
          fillColor: cor,
          color: cor,
          fillOpacity: 0.85,
          weight: 1,
        });
        cm.bindPopup(`
          <div style="font-family:Inter,sans-serif;font-size:12px;min-width:160px">
            <div style="font-weight:700;color:#0d0d1a;margin-bottom:6px;font-size:13px">🛴 ${b.identifier ?? b.id.slice(0, 8)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <div style="width:10px;height:10px;border-radius:50%;background:${cor};flex-shrink:0"></div>
              <span style="color:#374151;font-weight:600">${status === 'available' ? 'Disponível' : status === 'renting' ? 'Em aluguel' : status === 'reserved' ? 'Reservado' : status === 'low_battery' ? 'Bateria baixa' : 'Manutenção'}</span>
            </div>
            ${pctN !== null ? `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:2px"><span>🔋 Bateria</span><span style="color:${bCor};font-weight:700">${pctN}%</span></div><div style="height:6px;background:#e5e7eb;border-radius:3px"><div style="height:6px;width:${pctN}%;background:${bCor};border-radius:3px"></div></div></div>` : ''}
            ${b.model ? `<div style="font-size:10px;color:#9ca3af">${b.model}</div>` : ''}
            ${b.parking_id ? '<div style="font-size:10px;color:#6b7280;margin-top:2px">📍 Em ponto</div>' : '<div style="font-size:10px;color:#f97316;margin-top:2px">⚠️ Fora de ponto</div>'}
          </div>
        `, { maxWidth: 200 });
        toAdd.push(cm);
        existing.set(b.id, cm as unknown as L.Marker);
      }
    }
    // Batch-add ao layer de uma vez
    toAdd.forEach(cm => layer.addLayer(cm));

    return () => {
      if (bikeLayerRef.current) { mapa.removeLayer(bikeLayerRef.current); bikeLayerRef.current = null; bikeMarkersRef.current.clear(); }
    };
  }, [mapa, visivel, bikes]);

  // Filtro: show/hide markers individualmente — NÃO recria nada
  useEffect(() => {
    if (!parkingLayerRef.current || !mapa) return;
    const visSet = new Set(parkingsFiltrados.map(p => p.id));
    if (showParkings) {
      if (!mapa.hasLayer(parkingLayerRef.current)) parkingLayerRef.current.addTo(mapa);
      for (const [id, m] of parkingMarkersRef.current) {
        const display = visSet.has(id) ? '' : 'none';
        const el     = (m as any)._icon   as HTMLElement | undefined;
        const shadow = (m as any)._shadow as HTMLElement | undefined;
        if (el)     el.style.display     = display;
        if (shadow) shadow.style.display = display;
      }
    } else {
      if (mapa.hasLayer(parkingLayerRef.current)) mapa.removeLayer(parkingLayerRef.current);
    }
  }, [mapa, showParkings, parkingsFiltrados]);

  useEffect(() => {
    if (!bikeLayerRef.current || !mapa) return;
    const visSet = new Set(bikesFiltrados.map(b => b.id));
    if (showBikes) {
      if (!mapa.hasLayer(bikeLayerRef.current)) bikeLayerRef.current.addTo(mapa);
      for (const [id, m] of bikeMarkersRef.current) {
        const display = visSet.has(id) ? '' : 'none';
        const el     = (m as any)._icon   as HTMLElement | undefined;
        const shadow = (m as any)._shadow as HTMLElement | undefined;
        if (el)     el.style.display     = display;
        if (shadow) shadow.style.display = display;
      }
    } else {
      if (mapa.hasLayer(bikeLayerRef.current)) mapa.removeLayer(bikeLayerRef.current);
    }
  }, [mapa, showBikes, bikesFiltrados]);

  // tickAgora mantido por compatibilidade com iconBike, mas não mais atualiza markers em loop
  useEffect(() => { void tickAgora; }, []);

  if (!visivel) return null;

  // Cidade ainda não configurada — mostra aviso flutuante
  if (!cityId && !loading) {
    return (
      <div style={{
        position: 'fixed', left: '50%', bottom: 120, transform: 'translateX(-50%)',
        zIndex: 900, pointerEvents: 'auto',
        background: 'rgba(13,18,30,.95)', border: '1px solid rgba(251,191,36,.3)',
        borderRadius: 12, padding: '12px 16px', maxWidth: 300, backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 20px rgba(0,0,0,.5)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>
          🛴 GoJet não configurado
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.5 }}>
          {erro ?? `Adicione o doc gojet_config/${cidade ?? '?'} com o campo cityId no Firestore para ativar o mapa ao vivo.`}
        </div>
      </div>
    );
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalDisp   = parkings.reduce((s, p) => s + (p.availableCount ?? 0), 0);
  const totalFisico = parkings.reduce((s, p) => s + (p.bikes_count    ?? 0), 0);
  const zerados     = parkings.filter(p => (p.availableCount ?? 0) === 0).length;
  const comVinculo  = parkings.filter(p => p.monitorLevel).length;

  const statsBikes = bikes.reduce((acc, b) => {
    const s = classifyBike(b);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const foraPonto = bikes.filter(b => !b.parking_id).length;

  return (
    <>
      {/* ── Mini-dashboard lateral ESQUERDO ──────────────────────────────── */}
      <div style={{
        position: 'fixed', left: 10, bottom: 100, zIndex: 800,
        display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none',
      }}>
        {/* Toggle dashboard */}
        <button
          onClick={() => setDashAberto(v => !v)}
          style={{
            pointerEvents: 'auto', width: 36, height: 36, borderRadius: 8,
            background: dashAberto ? 'rgba(59,130,246,.3)' : 'rgba(13,18,30,.9)',
            color: dashAberto ? '#60a5fa' : 'rgba(255,255,255,.5)', fontSize: 16, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.1)',
          }}>
          {dashAberto ? '✕' : '📊'}
        </button>

        {dashAberto && (
          <div style={{
            pointerEvents: 'auto',
            background: 'rgba(13,18,30,.95)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 10, padding: '10px 12px', backdropFilter: 'blur(8px)',
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180,
          }}>
            {/* Parkings stats */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)',
                letterSpacing: 1, marginBottom: 5 }}>PONTOS ({parkings.length})</div>
              {[
                { cor: '#ef4444', label: 'Zerados', val: zerados },
                { cor: '#f59e0b', label: 'Abaixo target', val: parkings.filter(p => { const t = p.target_bikes_count??0; return t>0 && (p.availableCount??0)<t; }).length - zerados },
                { cor: '#3b82f6', label: 'No target', val: parkings.filter(p => { const t=p.target_bikes_count??0; const a=p.availableCount??0; return t>0&&a>=t&&a<t*1.2; }).length },
                { cor: '#22c55e', label: 'Excesso', val: parkings.filter(p => { const t=p.target_bikes_count??0; return t>0&&(p.availableCount??0)>=t*1.2; }).length },
                { cor: '#10b981', label: `Vinculados M1/M2/M3`, val: comVinculo },
              ].map(({ cor, label, val }) => val > 0 ? (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: cor }} />
                    <span style={{ color: 'rgba(255,255,255,.55)' }}>{label}</span>
                  </div>
                  <span style={{ color: cor, fontWeight: 700 }}>{val}</span>
                </div>
              ) : null)}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />

            {/* Bikes stats */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)',
                letterSpacing: 1, marginBottom: 5 }}>PATINETES ({bikes.length})</div>
              {([
                ['available',   '🟢', 'Disponível'],
                ['low_battery', '🟠', 'Bat. baixa'],
                ['renting',     '🟡', 'Em aluguel'],
                ['reserved',    '⚫', 'Reservado'],
                ['maintenance', '🔴', 'Manutenção'],
              ] as const).map(([s, emoji, label]) => (statsBikes[s]??0) > 0 ? (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                  <span>{emoji} <span style={{ color: 'rgba(255,255,255,.55)' }}>{label}</span></span>
                  <span style={{ color: 'rgba(255,255,255,.65)', fontWeight: 700 }}>{statsBikes[s]??0}</span>
                </div>
              ) : null)}
              <div style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', fontSize: 10, marginTop: 4, paddingTop: 4,
                borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ color: '#f97316' }}>⚠️ Fora de ponto</span>
                <span style={{ color: '#f97316', fontWeight: 700 }}>{foraPonto}</span>
              </div>
            </div>

            {/* Estações vinculadas */}
            {estacoes.length > 0 && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)',
                    letterSpacing: 1, marginBottom: 5 }}>ESTAÇÕES MONITOR</div>
                  {(['M1','M2','M3'] as const).map(m => {
                    const n = estacoes.filter(e => e.tipoMonitor === m).length;
                    return n > 0 ? (
                      <div key={m} style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                        <span style={{ color: M_COR[m], fontWeight: 700 }}>{m}</span>
                        <span style={{ color: 'rgba(255,255,255,.55)' }}>{n} est. · {parkings.filter(p=>p.monitorLevel===m).length} pts</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </>
            )}

            {/* Idade do snapshot */}
            {(() => {
              const idade = snapshotIdade;
              const cor = loading ? '#6b7280' : idade === null ? '#6b7280' : idade < 6 ? '#22c55e' : idade < 15 ? '#f59e0b' : '#ef4444';
              const label = loading ? '⏳ Carregando...'
                : idade === null ? '— sem dado'
                : idade < 1 ? '✓ agora'
                : `snapshot ${idade}min atrás`;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 9, color: cor, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: cor }} />
                    {label}
                  </div>
                  <button
                    onClick={forcarAtualizacao}
                    disabled={atualizandoScraper || loading}
                    style={{
                      fontSize: 9, padding: '3px 8px', borderRadius: 6, border: 'none',
                      background: 'rgba(167,139,250,.15)', color: '#a78bfa',
                      cursor: atualizandoScraper ? 'wait' : 'pointer', fontWeight: 700,
                    }}>
                    {atualizandoScraper ? '⏳ Atualizando...' : '🔄 Atualizar agora'}
                  </button>
                </div>
              );
            })()}

            {/* Gerar Tarefas de Monitor */}
            {parkings.some(p => p.monitorLevel) && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)', letterSpacing: 1 }}>MONITOR DE TAREFAS</div>
                  {tarefasCriadas !== null && (
                    <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 700 }}>✓ {tarefasCriadas} tarefa{tarefasCriadas !== 1 ? 's' : ''} criada{tarefasCriadas !== 1 ? 's' : ''}!</div>
                  )}
                  <button
                    onClick={() => setViolacoesModal(verificarViolacoes())}
                    disabled={criandoTarefas}
                    style={{
                      fontSize: 9, padding: '4px 8px', borderRadius: 6, border: 'none',
                      background: 'rgba(16,185,129,.2)', color: '#10b981',
                      cursor: 'pointer', fontWeight: 700,
                    }}>
                    🎯 Gerar Tarefas
                  </button>
                  <button
                    onClick={() => setShowConfigMonitor(v => !v)}
                    style={{
                      fontSize: 9, padding: '3px 8px', borderRadius: 6, border: 'none',
                      background: showConfigMonitor ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.05)',
                      color: showConfigMonitor ? '#fbbf24' : 'rgba(255,255,255,.35)',
                      cursor: 'pointer', fontWeight: 700,
                    }}>
                    ⚙️ Config Monitores
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Barra de controles centralizada (inferior) ────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 56, left: '50%', transform: 'translateX(-50%)',
        zIndex: 900, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}>
        {/* Filtros avançados */}
        <div style={{
          display: 'flex', gap: 5, background: 'rgba(13,18,30,.9)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '3px 6px',
          backdropFilter: 'blur(8px)', flexWrap: 'wrap', justifyContent: 'center',
          maxWidth: '90vw',
        }}>
          {/* Filtros parking */}
          {showParkings && ([
            { k: 'todos',        l: 'Todos' },
            { k: 'zerados',      l: '🔴 Zerados' },
            { k: 'abaixo_target',l: '🟡 < target' },
            { k: 'no_target',    l: '🔵 No target' },
            { k: 'excesso',      l: '🟢 Excesso' },
          ] as const).map(opt => (
            <button key={opt.k} onClick={() => setFiltroPark(opt.k)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: filtroPark === opt.k ? 'rgba(59,130,246,.3)' : 'transparent',
              color: filtroPark === opt.k ? '#60a5fa' : 'rgba(255,255,255,.45)',
            }}>{opt.l}</button>
          ))}

          {showParkings && <div style={{ width: 1, background: 'rgba(255,255,255,.1)', margin: '3px 0' }} />}

          {/* Toggle monitor */}
          {showParkings && (
            <button onClick={() => setSomenteMonitor(v => !v)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: somenteMonitor ? 'rgba(16,185,129,.25)' : 'transparent',
              color: somenteMonitor ? '#10b981' : 'rgba(255,255,255,.45)',
            }}>⭐ Monitor</button>
          )}

          {/* Toggle só vinculados */}
          {showParkings && estacoes.length > 0 && (
            <button onClick={() => setApenasComVinculo(v => !v)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: apenasComVinculo ? 'rgba(124,58,237,.25)' : 'transparent',
              color: apenasComVinculo ? '#a78bfa' : 'rgba(255,255,255,.45)',
            }}>🔗 M1/M2/M3</button>
          )}

          {/* Eventos temporários */}
          {cidade && (
            <button onClick={() => setShowEventosPanel(v => !v)} style={{
              padding: '4px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: showEventosPanel ? 'rgba(217,119,6,.25)' : 'transparent',
              color: showEventosPanel ? '#f59e0b' : 'rgba(255,255,255,.45)',
            }}>
              📅 Eventos
              {estacoes.filter(e => e.temporario).length > 0
                ? ` (${estacoes.filter(e => e.temporario).length})` : ''}
            </button>
          )}
        </div>

        {/* Layer toggles + filtro bikes */}
        <div style={{
          display: 'flex', gap: 5, background: 'rgba(13,18,30,.9)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '3px 6px',
          backdropFilter: 'blur(8px)',
        }}>
          <button onClick={() => setShowParkings(v => !v)} style={{
            padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700,
            background: showParkings ? 'rgba(59,130,246,.25)' : 'transparent',
            color: showParkings ? '#60a5fa' : 'rgba(255,255,255,.45)',
          }}>🅿️ Pontos {showParkings ? `(${parkingsFiltrados.length})` : ''}</button>

          <button onClick={() => setShowBikes(v => !v)} style={{
            padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700,
            background: showBikes ? 'rgba(16,185,129,.25)' : 'transparent',
            color: showBikes ? '#10b981' : 'rgba(255,255,255,.45)',
          }}>🛴 Patinetes {showBikes ? `(${bikesFiltrados.length})` : `(${bikes.length})`}</button>

          {/* Filtros bikes */}
          {showBikes && ([
            { k: 'todos',        l: 'Todos' },
            { k: 'fora_ponto',   l: '⚠️ Fora ponto' },
            { k: 'bateria_baixa',l: '🟠 Bat. baixa' },
            { k: 'disponiveis',  l: '🟢 Disp.' },
          ] as const).map(opt => (
            <button key={opt.k} onClick={() => setFiltroBike(opt.k)} style={{
              padding: '5px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
              background: filtroBike === opt.k ? 'rgba(16,185,129,.25)' : 'transparent',
              color: filtroBike === opt.k ? '#10b981' : 'rgba(255,255,255,.4)',
            }}>{opt.l}</button>
          ))}
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div style={{ position:'fixed', bottom:110, left:10, zIndex:800,
          background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)',
          borderRadius:8, padding:'5px 10px', fontSize:10, color:'#ef4444',
          display:'flex', flexDirection:'column', gap:6, maxWidth:240 }}>
          <span>⚠️ {erro}</span>
          {cityId && (
            <button
              onClick={forcarAtualizacao}
              disabled={atualizandoScraper || loading}
              style={{
                fontSize:10, padding:'4px 10px', borderRadius:6, border:'none',
                background:'rgba(239,68,68,.3)', color:'#fca5a5',
                cursor: atualizandoScraper ? 'wait' : 'pointer', fontWeight:700,
              }}>
              {atualizandoScraper ? '⏳ Atualizando...' : '🔄 Atualizar agora'}
            </button>
          )}
        </div>
      )}

      {/* ── Modal de Violações de Monitor ─────────────────────────────────── */}
      {violacoesModal !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: '#0d1218', border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 14, padding: 20, maxWidth: 480, width: '100%',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#f0f4ff' }}>
                🎯 Gerar Tarefas de Monitor
              </div>
              <button onClick={() => setViolacoesModal(null)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>

            {violacoesModal.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,.5)', fontSize: 13 }}>
                ✅ Todos os pontos monitorados estão acima dos thresholds configurados.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>
                  {violacoesModal.length} ponto{violacoesModal.length > 1 ? 's' : ''} abaixo do threshold — serão criadas tarefas em <strong style={{ color: '#f0f4ff' }}>tarefas_logistica</strong>.
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {violacoesModal.map(({ parking: p, cfg, deficit, pctDisp }) => (
                    <div key={p.id} style={{
                      background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '8px 10px',
                      border: `1px solid ${M_COR[p.monitorLevel!]}33`,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{
                        background: M_COR[p.monitorLevel!], color: '#fff',
                        borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 800, flexShrink: 0,
                      }}>{p.monitorLevel}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#f0f4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.id}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }}>
                          {p.availableCount ?? 0}/{p.target_bikes_count ?? 0} disp. ({pctDisp}% — mín. {cfg.thresholdPct}%)
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444' }}>-{deficit}</div>
                        <div style={{ fontSize: 8, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase' }}>{cfg.prioridade}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setViolacoesModal(null); }}
                    style={{
                      flex: 1, padding: '9px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
                      background: 'transparent', color: 'rgba(255,255,255,.5)', fontSize: 12, cursor: 'pointer', fontWeight: 700,
                    }}>Cancelar</button>
                  <button
                    onClick={async () => {
                      const criadas = await criarTarefasMonitor(violacoesModal);
                      if (criadas > 0) setViolacoesModal(null);
                    }}
                    disabled={criandoTarefas}
                    style={{
                      flex: 2, padding: '9px', borderRadius: 8, border: 'none',
                      background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12,
                      cursor: criandoTarefas ? 'wait' : 'pointer', fontWeight: 800,
                    }}>
                    {criandoTarefas ? '⏳ Criando...' : `✓ Criar ${violacoesModal.length} tarefa${violacoesModal.length > 1 ? 's' : ''}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Painel de Config dos Monitores ────────────────────────────────── */}
      {showConfigMonitor && cidade && (
        <MonitorConfigPanel
          cidade={cidade}
          onFechar={() => setShowConfigMonitor(false)}
        />
      )}

      {/* ── Painel de Eventos GoJet ───────────────────────────────────────── */}
      {showEventosPanel && cidade && (
        <EventoGoJetPanel
          cidade={cidade}
          parkings={parkings}
          mapa={mapa}
          onFechar={() => setShowEventosPanel(false)}
          onEstacaoCriada={() => {
            // Invalida cache para recarregar estações com o novo ponto temporário
            _estacoesCacheTs = 0;
            carregarSnapshot();
          }}
        />
      )}

      {/* Admin bike actions modal */}
      {adminAction && isAdmin && gestorUid && (
        <AdminBikeActionsLazy
          modo={adminAction.modo}
          cidade={cidade ?? ''}
          gestorUid={gestorUid}
          gestorNome={gestorNome ?? ''}
          parkingAlvo={adminAction.parkingAlvo as any}
          bikeAlvo={adminAction.bikeAlvo as any}
          parkings={parkings as any}
          bikes={bikes as any}
          onFechar={() => setAdminAction(null)}
          onCriado={() => setAdminAction(null)}
        />
      )}
    </>
  );
}
