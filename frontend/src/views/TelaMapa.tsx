// TelaMapa.tsx — Main map component extracted from App.tsx
import { useState, useEffect, useRef, useCallback, CSSProperties, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { fnGerarCroqui, fnGerarStreetView, fnAnalisarCalcada, fnBuscarPOIs } from '../lib/edge-functions';
import { carregarOcorrenciasSupabase } from '../lib/ocorrencias-supabase';
import L from 'leaflet';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem, capturarFotoNativa } from '../lib/imageUtils';
import { isAndroidNative } from '../lib/gps-native';
import { carregarEstacoesSupabase, carregarZonasSupabase } from '../lib/estacoes-supabase';
import { supabase } from '../lib/supabase';
import ZonasManager from '../ZonasManager';
import { useCidadesExpansao, CidadeExpansaoModal, STATUS_META, type CidadeExpansao } from '../CidadesExpansao';
import { showToastGlobal } from '../components/ui/ToastQueue';
import UsuariosManager from '../UsuariosManager';
import DashboardManager from '../DashboardManager';
import PainelConfiguracoes from '../components/PainelConfiguracoes';
import MonitorPanel from '../MonitorPanel';
import TelegramVinculo, { useTelegramVinculado } from '../TelegramVinculo';
import TelaPrestadorPerfil from '../TelaPrestadorPerfil';
import AnalyticsManager from '../AnalyticsManager';
import { POIPanel, POIMapFilter, POIActionsPopup, POI_META } from '../components/POIPanel';
import { StreetViewModal } from '../components/StreetViewModal';
import { FotoCaptura } from '../components/FotoCaptura';
import { FotoMedidas } from '../components/FotoMedidas';
import { CandidatosManager } from '../components/CandidatosManager';
import LocaisFinanceiro, { LocalOperacionalModal, useLocaisOperacionais, TIPO_LOCAL_META } from '../components/LocaisFinanceiro';
import { GoJetOverlay } from '../components/GoJetOverlay';
import { buscarCityId as buscarCityIdSupabase } from '../lib/cidade-config';
import GoJetDashboard from '../components/GoJetDashboard';
import GestorLogisticaPanel from '../components/GestorLogisticaPanel';
import PagamentosModule from '../components/PagamentosModule';
import PagamentosAdminPanel from '../components/PagamentosAdminPanel';
import SlotsTeamsModule from '../components/SlotsTeamsModule';
import LiveWorkersPanel from '../components/LiveWorkersPanel';
import PainelRoubos from '../components/PainelRoubos';
import GuardDashboard from '../components/GuardDashboard';
import PainelControlePerdasSeg from '../components/PainelControlePerdasSeg';
import TarefasLogisticaModule from '../components/TarefasLogisticaModule';
import TurnoRegistro from '../components/TurnoRegistro';
import GoJetAnalyticsPanel from '../components/GoJetAnalyticsPanel';
import ShiftPanel from '../components/ShiftPanel';
import UpdateBanner from '../components/UpdateBanner';
import { useShiftNotifications, formatTurnoToast } from '../components/ShiftNotifications';
import type { LocalOperacional, TipoLocal } from '../components/LocaisFinanceiro';
import type { Candidato } from '../components/CandidatosManager';
import type { POI } from '../components/POIPanel';
import GuiaPanel from '../GuiaPanel';
import { DrawerAdd, ZonaEditModal, ZonaFormModal, LangSelector } from '../components/MapaHelpers';
import { Toast, CentralNotificacoes, NovaOcorrenciaInline, GuardOverlay } from '../components/AppShell';
import type { Usuario, Estacao } from '../lib/app-utils';
import { COORDS_CIDADES, CIDADES, calcAreaKm2, pontoNoPoli, sanitizarFotoUrl, fixDriveUrl } from '../lib/app-utils';
import { DocPublicoModal } from '../components/AppShell';

// Compressão HEIC-safe (ver lib/imageUtils). Converte HEIC→JPEG antes de comprimir,
// evitando o bug de foto "quebrada" (HEIC enviado como .jpg que o WebView não renderiza).
async function comprimir(file: File, maxW = 1280, q = 0.82): Promise<File> {
  try {
    return await comprimirImagem(file, maxW, q);
  } catch (e) {
    console.warn('[comprimir] falha ao processar imagem, enviando original', e);
    return file;
  }
}

function TelaMapa({ usuario, onLogout }: { usuario: Usuario; onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const [kpis, setKpis] = useState({ ativas: 0, ocAbertas: 0, procurando: 0, roubos: 0 });
  const [notifList, setNotifList] = useState<Array<{id:string;msg:string;tipo:string;ts:number}>>([]);
  const [showNotif, setShowNotif] = useState(false);

  if (!usuario) return null;

  const isGestorApp    = ['admin','gestor','gestor_seg'].includes(usuario.role);
  const isLogisticaApp = ['admin','gestor','supergestor','logistica','campo','gestor_log'].includes(usuario.role);

  // Web Push subscription registration (substitui FCM)
  useEffect(() => {
    if (!usuario?.uid) return;
    (async () => {
      try {
        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
        if (!vapidKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        const reg = await navigator.serviceWorker.register('/push-sw.js');
        await navigator.serviceWorker.ready;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });
        const json = sub.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          const { error: pushErr } = await supabase.from('push_subscriptions').upsert({
            uid: session.user.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            atualizado_em: new Date().toISOString(),
          }, { onConflict: 'uid,endpoint' });
          if (pushErr) console.error('[push-sub] upsert error:', pushErr);
        }
      } catch (e) { console.warn('[push-sub] failed:', e); }
    })();
  }, [usuario?.uid]);

  // Notificações — Supabase
  useEffect(() => {
    if (!usuario?.uid) return;
    const mapNotifs = (data: any[]) => (data || []).map((n: any) => ({
      id: String(n.id), msg: n.mensagem || n.corpo || n.titulo || '', tipo: n.tipo || 'info',
      ts: n.ts ? new Date(n.ts).getTime() : (n.criado_em ? new Date(n.criado_em).getTime() : Date.now()),
      lida: !!n.lida,
    }));
    const fetchNotifs = () => supabase.from('notificacoes_app').select('*')
      .or(`uid.eq.${usuario.uid},uid.is.null`)
      .order('ts', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setNotifList(mapNotifs(data)); });
    fetchNotifs();
    const chan = supabase.channel('notif-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes_app' }, () => fetchNotifs())
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  }, [usuario?.uid]);

  const mapRef      = useRef<HTMLDivElement>(null);
  const leafletRef  = useRef<L.Map | null>(null);
  const layerRef    = useRef<L.LayerGroup | null>(null);

  const [estacoes,      setEstacoes]      = useState<Estacao[]>([]);
  const estacoesRef = useRef<Estacao[]>([]);
  estacoesRef.current = estacoes;
  const [cidades,       setCidades]       = useState<string[]>([]);
  const cidade = cidades[0] || ''; // compat — cidade principal

  // Viewer com cidades restritas — aplica na montagem e sempre que usuario mudar
  useEffect(() => {
    if (!usuario) return;
    if (usuario.role === 'viewer' && usuario.cidadesPermitidas && usuario.cidadesPermitidas.length > 0) {
      // Normalizar: trim + capitalizar primeira letra de cada palavra
      const norm = usuario.cidadesPermitidas
        .map((c: string) => c.trim())
        .filter(Boolean);
      setCidades(norm);
    }
  }, [usuario?.uid, usuario?.cidadesPermitidas?.join(',')]);
  const [ativa,         setAtiva]         = useState<Estacao | null>(null);
  const [modoAdd,       setModoAdd]       = useState(false);
  const modoAddRef = useRef(false);
  const [pinLatLng,     setPinLatLng]     = useState<{lat:number;lng:number}|null>(null);
  const [drawerAberto,  setDrawerAberto]  = useState(false);
  const [estacaoEdit,   setEstacaoEdit]   = useState<Estacao | null>(null);
  const [hoverPin,      setHoverPin]      = useState<{e:Estacao;x:number;y:number}|null>(null);
  const [cidadeModal,   setCidadeModal]   = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mapMode,       setMapMode]       = useState<'dark'|'light'>('dark');

  const [buscaCidade,   setBuscaCidade]   = useState('');
  const [filtroPais,    setFiltroPais]    = useState(() => localStorage.getItem('jet_filtro_pais') || 'TODOS');
  const [toast, setToast] = useState<{msg:string;tipo:string;acao?:{label:string;fn:()=>void}}|null>(null);
  const [contagem,      setContagem]      = useState(0);
  const [filtros, setFiltros] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('jet_filtros_tipo'); return s ? new Set(JSON.parse(s)) : new Set(['PUBLICA','PRIVADA']); }
    catch { return new Set(['PUBLICA','PRIVADA']); }
  });
  const [cicloviasOn,   setCicloviasOn]   = useState(false);
  const [poligonosOn,   setPoligonosOn]   = useState(false);
  const [zonaEditor,    setZonaEditor]    = useState(false);
  const [zonasModulo,   setZonasModulo]   = useState(false);
  const [usuariosModulo,   setUsuariosModulo]   = useState(false);
  const [dashboardModulo, setDashboardModulo] = useState(false);
  const [analyticsModulo, setAnalyticsModulo] = useState(false);
  const [guardModulo,     setGuardModulo]     = useState(false);
  const [guardDash,       setGuardDash]       = useState(false);
  const [novaOcorrencia,  setNovaOcorrencia]  = useState(false);
  const [guiaModulo,      setGuiaModulo]      = useState(false);
  const [logisticaModulo, setLogisticaModulo] = useState(false);
  const [monitorPanel, setMonitorPanel] = useState<{
    estacao: any;
    posicao: { x: number; y: number };
  } | null>(null);

  const isSuperGestor = ['admin', 'supergestor'].includes(usuario.role);
  const [slotsModulo, setSlotsModulo] = useState(false);
  const [painelConfig,    setPainelConfig]    = useState(false);
  const [showTgBanner,    setShowTgBanner]    = useState(false);
  const [showPerfilPrestador, setShowPerfilPrestador] = useState(false);
  const [ocorrenciasLayer, setOcorrenciasLayer] = useState<any[]>([]);
  const { vinculado: tgVinculado } = useTelegramVinculado(usuario?.uid ?? '');
  // Auto-show Telegram modal para prestadores sem vínculo no primeiro acesso
  useEffect(() => {
    if (usuario?.tipoCadastro === 'prestador' && tgVinculado === false) {
      setShowTgBanner(true);
    }
  }, [usuario?.tipoCadastro, tgVinculado]);
  const [showPOILayer, setShowPOILayer]     = useState(false);
  const [showGoJetLayer, setShowGoJetLayer]    = useState(false);
  const [gojetDash,       setGojetDash      ]   = useState(false);
  const [gojetAnalytics,  setGojetAnalytics ]   = useState(false);

  useEffect(() => {
    if (!cidade) return;
    buscarCityIdSupabase(cidade).then(cid => {
      if (cid) setShowGoJetLayer(true);
    }).catch(() => {});
  }, [cidade]);

  const [turnoRegistro,   setTurnoRegistro  ]   = useState(false);
  const [gestorLogistica, setGestorLogistica]   = useState(false);
  const [pagamentosOpen,  setPagamentosOpen]    = useState(false);
  const [pagamentosAdminOpen, setPagamentosAdminOpen] = useState(false);
  const [tarefasLogistica, setTarefasLogistica] = useState(false);
  const [shiftPanel,      setShiftPanel     ] = useState(false);

  const [tarefaDeepLinkId, setTarefaDeepLinkId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('tarefa')
  );

  // Capacitor deep link listener — abre tarefa ao tocar no link do Telegram
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const handle = await CapApp.addListener('appUrlOpen', (data: { url: string }) => {
          const url = new URL(data.url);
          const id = url.searchParams.get('tarefa') ?? url.pathname.split('/').pop() ?? null;
          if (id) setTarefaDeepLinkId(id);
        });
        cleanup = () => handle.remove();
      } catch { /* web */ }
    })();
    return () => cleanup?.();
  }, []);

  // Auto-abrir tarefas se chegou via deep link
  useEffect(() => {
    if (tarefaDeepLinkId) setTarefasLogistica(true);
  }, [tarefaDeepLinkId]);
  const [showWorkers,    setShowWorkers]    = useState(false);
  const [painelRoubos,   setPainelRoubos]   = useState(false);
  const [painelPerdas,   setPainelPerdas]   = useState(false);
  const [parkingParaTarefa, setParkingParaTarefa] = useState<{
    id: string; nome: string; lat: number; lng: number; target?: number; disponivel?: number;
  } | null>(null);
  const [modoSelecionarDestino, setModoSelecionarDestino] = useState(false);
  const destinoCallbackRef = useRef<((p: any) => void) | null>(null);
  const [poiLayerData, setPoiLayerData]     = useState<POI[]>([]);
  const [poiTiposAtivos, setPoiTiposAtivos]   = useState<Set<string> | null>(null);
  const [showPoiFilterPanel, setShowPoiFilterPanel] = useState(false);
  const [poiLoading, setPoiLoading]         = useState(false);
  const poiMarkersRef = useRef<any[]>([]);
  const osmMoveHandlerRef = useRef<(() => void) | null>(null);
  const [candidatosLayer, setCandidatosLayer] = useState<Candidato[]>([]);
  // Locais operacionais (hook moved after pais declaration)
  const [showLocaisOp,    setShowLocaisOp]    = useState(false);
  const [financeiro,      setFinanceiro]      = useState(false);
  const [tiposFiltroLocais, setTiposFiltroLocais] = useState<Set<TipoLocal>>(new Set(['BASE_CARGA','CENTRO_SERVICO','DEPOSITO','PONTO_REDISTRIBUICAO']));
  const [localOpModal, setLocalOpModal] = useState<{latLng:{lat:number;lng:number};editando?:LocalOperacional}|null>(null);
  const [modoAddLocal, setModoAddLocal] = useState(false);
  const [satOn,       setSatOn]       = useState(false);
  const [showPOIsFab,       setShowPOIsFab]       = useState(false);
  const [candidatosModulo,  setCandidatosModulo]  = useState(false);
  const modoAddLocalRef = useRef(false);
  const locaisMarkersRef = useRef<any[]>([]);
  const [candidatoPopup, setCandidatoPopup] = useState<{candidato:Candidato;index:number}|null>(null);
  const [analyticsStationInfo, setAnalyticsStationInfo] = useState<any>(null);
  const [cidadesExpShow, setCidadesExpShow] = useState(false);
  const [cidadeExpModal, setCidadeExpModal] = useState<{editando?:CidadeExpansao;latLng?:{lat:number;lng:number}}|null>(null);
  const cidadesExp = useCidadesExpansao();

  // ── Modal mutual exclusivity ──────────────────────────────────
  // Opening one overlay panel closes all others to prevent UI clutter.
  const closeAllPanels = useCallback(() => {
    setShowNotif(false);
    setUsuariosModulo(false);
    setPainelConfig(false);
    setGuiaModulo(false);
    setDashboardModulo(false);
    setAnalyticsModulo(false);
    setSlotsModulo(false);
    setTurnoRegistro(false);
    setGojetAnalytics(false);
    setGojetDash(false);
    setFinanceiro(false);
    setShowPerfilPrestador(false);
    setCidadeModal(false);
    setGuardModulo(false);
    setGuardDash(false);
    setLogisticaModulo(false);
    setGestorLogistica(false);
    setPagamentosOpen(false);
    setPagamentosAdminOpen(false);
    setShiftPanel(false);
    setShowWorkers(false);
    setPainelRoubos(false);
    setPainelPerdas(false);
    setTarefasLogistica(false);
    setCandidatosModulo(false);
    setZonasModulo(false);
    setCidadesExpShow(false);
    setNovaOcorrencia(false);
  }, []);

  const openPanel = useCallback((setter: (v: boolean) => void) => {
    closeAllPanels();
    setter(true);
  }, [closeAllPanels]);
  // ──────────────────────────────────────────────────────────────

  const analyticsHoverRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  // Dedicated stable listener for analytics station hover
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) { setAnalyticsStationInfo(null); return; }
      setAnalyticsStationInfo(d);
      if (d._hover) {
        if (analyticsHoverRef.current) clearTimeout(analyticsHoverRef.current);
        analyticsHoverRef.current = setTimeout(() => setAnalyticsStationInfo((c: any) => c?._hover ? null : c), 5000);
      }
    };
    window.addEventListener('jetAnalyticsStation', handler);
    return () => {
      window.removeEventListener('jetAnalyticsStation', handler);
      if (analyticsHoverRef.current) clearTimeout(analyticsHoverRef.current);
    };
  }, []); // empty deps — handler uses functional setState, no stale closure

  // ── KPIs ocorrências em tempo real ─────────────────────────────────
  useEffect(() => {
    if (!isGestorApp) return;
    const processar = (todas: any[]) => {
      const filtradas = cidade
        ? todas.filter(d => (d.cidade_inicial||'').toLowerCase().includes(cidade.toLowerCase()))
        : todas;
      const abertas = filtradas.filter(d => {
        const s = (d.status||'').toLowerCase();
        return s === 'aberto' || s === 'em apuração' || s === 'em apuracao';
      });
      const procurando = filtradas.filter(d => {
        const p = d.procurando;
        return p && String(p).trim().length > 0 && p !== 'false';
      }).length;
      const roubos = filtradas.filter(d => d.tipo === 'Roubo').length;
      setKpis(prev => ({ ...prev, ocAbertas: abertas.length, procurando, roubos }));
    };
    let vivo = true;
    carregarOcorrenciasSupabase({ limit: 5000 })
      .then(rows => { if (vivo) processar(rows); })
      .catch(err => console.warn('[KPI ocorrencias] Supabase', err));
    return () => { vivo = false; };
  }, [isGestorApp, cidade]);

  // Pins de ocorrências: apenas quando GuardOverlay está aberto (gerenciado pelo próprio componente)

  const candidatosMarkersRef = useRef<any[]>([]);
  const [fotoCapturaCtx, setFotoCapturaCtx] = useState<{context:'novo'|'existente';lat?:number;lng?:number;estacaoId?:string;estacaoCodigo?:string}|null>(null);
  const [fotoMedidasCtx, setFotoMedidasCtx] = useState<{fotoUrl:string; fotoFile?:File|null; onSalvar:(url:string)=>void} | null>(null);
  const [fotoParaDrawer, setFotoParaDrawer] = useState<string>('');
  const [selectedPOI, setSelectedPOI] = useState<any>(null);
  const [poiDetalhe, setPoiDetalhe]   = useState<any>(null);  // POI salvo do Google em detalhe
  const [poiGoogleCarregando, setPoiGoogleCarregando] = useState(false);
  const [poiGoogleDados, setPoiGoogleDados] = useState<any[]>([]);
  const [poiGoogleTiposAtivos, setPoiGoogleTiposAtivos] = useState<Set<string> | null>(null);
  const [streetViewTarget, setStreetViewTarget] = useState<{lat:number;lng:number;nome?:string;estacaoId?:string;estacaoCodigo?:string}|null>(null);
  const [svPreview, setSvPreview] = useState<{id:string;url:string;fonte:string}|null>(null);
  const [svBatchRunning, setSvBatchRunning] = useState(false);
  const [medirFila, setMedirFila] = useState<{lista: any[]; idx: number} | null>(null);
  const [showToolsFab, setShowToolsFab] = useState(false);
  const [showCamadasFab, setShowCamadasFab] = useState(false);
  const [zonaEditando,  setZonaEditando]  = useState<Record<string,unknown> | null>(null);
  const [zonaDrawing,   setZonaDrawing]   = useState(false);
  const [zonaForm,      setZonaForm]      = useState<{coords: [number,number][]} | null>(null);
  const poligonosLayerRef = useRef<L.LayerGroup | null>(null);
  const cicloviasLayerRef = useRef<L.LayerGroup | null>(null);
  const [filtrosStatus, setFiltrosStatus] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('jet_filtros_status'); return s ? new Set(JSON.parse(s)) : new Set(['ATIVO','PLANEJADO','NEGOCIACAO','SOLICITADO','APROVADO','INSTALADO','REPROVADO','CANCELADO']); }
    catch { return new Set(['ATIVO','PLANEJADO','NEGOCIACAO','SOLICITADO','APROVADO','INSTALADO','REPROVADO','CANCELADO']); }
  });
  const [raioAtivo,     setRaioAtivo]     = useState(false);
  const [raioMetros,    setRaioMetros]    = useState(100);
  const raioLayerRef  = useRef<L.LayerGroup | null>(null);
  const headerRef     = useRef<HTMLDivElement | null>(null);
  const [headerH,     setHeaderH]     = useState(52);

  // Guard / Gestor_seg / Prestadores: filtros restritos a INSTALADO
  const isGuardSeg = ['guard','gestor_seg'].includes(usuario?.role ?? '') || usuario?.tipoCadastro === 'prestador';
  useEffect(() => {
    if (!isGuardSeg) return;
    setFiltros(new Set(['PUBLICA','PRIVADA']));
    setFiltrosStatus(new Set(['INSTALADO']));
  }, [isGuardSeg]);
  useEffect(() => {
    if (usuario?.role === 'gestor_seg') setGuardModulo(true);
  }, [usuario?.role]);

  // Mede altura real do header para posicionar filtros corretamente no mobile
  useEffect(() => {
    if (!headerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height;
      if (h) setHeaderH(Math.round(h) + 1);
    });
    obs.observe(headerRef.current);
    return () => obs.disconnect();
  }, []);

  const pais      = usuario.paises[0] || 'BR'; // país principal para ações de criação
  const paisesUser = usuario.paises || ['BR']; // todos os países do usuário
  const locaisOp = useLocaisOperacionais(cidade, pais);
  const isAdmin   = usuario.role === 'admin';
  const isViewer  = usuario.role === 'viewer';

  const toggleCidade = (c: string) => {
    // Viewer não pode mudar cidades
    if (usuario && usuario.role === 'viewer' && usuario.cidadesPermitidas && usuario.cidadesPermitidas.length > 0) return;
    setCidades(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };
  const limparCidades = () => setCidades([]);
  const isGestor     = ['admin','gestor'].includes(usuario.role);
  const isGestorLog  = ['admin','gestor','gestor_log'].includes(usuario.role);
  const isCampo      = ['campo', 'guard', 'promotor'].includes(usuario.role);
  const isPrestadorLogistica = usuario.tipoCadastro === 'prestador' && usuario.cargoPrestador === 'logistica';

  const showToast = useCallback((msg: string, tipo = 'info', acao?: {label:string;fn:()=>void}) => {
    setToast({ msg, tipo, acao });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Notificações de turno — gestores recebem toast quando worker registra entrada/saída
  useShiftNotifications({
    cidade,
    isGestor,
    userUid: usuario?.uid ?? '',
    onEvento: useCallback((ev) => {
      showToast(formatTurnoToast(ev), 'info');
    }, [showToast]),
  });

  // Listener jetAbrirMedidas — câmera abre medidas diretamente (base64 local)
  useEffect(() => {
    const handler = (ev: Event) => {
      const { base64, onSalvar } = (ev as CustomEvent).detail as {
        base64: string; file: File; onSalvar: (b64: string) => void;
      };
      setFotoMedidasCtx({
        fotoUrl: base64,
        fotoFile: null,
        onSalvar,
      });
    };
    window.addEventListener('jetAbrirMedidas', handler);
    return () => window.removeEventListener('jetAbrirMedidas', handler);
  }, []);

  // ── PWA Shortcuts — ler parâmetros da URL ──────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shortcut = params.get('shortcut');
    if (!shortcut) return;
    // Limpar param da URL sem reload
    window.history.replaceState({}, '', '/');
    if (shortcut === 'add-station') {
      setTimeout(() => { setModoAdd(true); showToast(t('map.tapToPosition'), 'info'); }, 800);
    } else if (shortcut === 'new-incident') {
      setTimeout(() => { setNovaOcorrencia(true); }, 800);
    } else if (shortcut === 'my-location') {
      setTimeout(() => {
        navigator.geolocation.getCurrentPosition(p => {
          leafletRef.current?.setView([p.coords.latitude, p.coords.longitude], 16);
        });
      }, 800);
    }
  }, []);

  // ── Estado para modal de documentos públicos ──────────────────
  const [docPublicoModal, setDocPublicoModal] = useState<{
    id: string; cidade: string; docPublico: any;
  } | null>(null);

  // Listener jetEditDocPublico — abrir modal de doc público
  useEffect(() => {
    const handler = (ev: Event) => {
      const d = (ev as CustomEvent).detail;
      setDocPublicoModal({ id: d.id, cidade: d.cidade, docPublico: d.docPublico || {} });
    };
    window.addEventListener('jetEditDocPublico', handler);
    return () => window.removeEventListener('jetEditDocPublico', handler);
  }, []);

  // Listener jetAddNaLocalizacao — add estação na localização atual
  useEffect(() => {
    const onAddNaLoc = (ev: Event) => {
      const { lat, lng } = (ev as CustomEvent).detail as { lat: number; lng: number };
      setPinLatLng({ lat, lng });
      setDrawerAberto(true);
    };
    window.addEventListener('jetAddNaLocalizacao', onAddNaLoc);
    return () => window.removeEventListener('jetAddNaLocalizacao', onAddNaLoc);
  }, []);

  // Lightbox — abrir foto em tela cheia
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      if (url) setLightboxUrl(url);
    };
    window.addEventListener('jetOpenFoto', handler);
    return () => window.removeEventListener('jetOpenFoto', handler);
  }, []);

  // Listener jetMedirFoto — medir foto de estação existente (via popup do mapa)
  useEffect(() => {
    const handler = (ev: Event) => {
      const { id, fotoUrl: fu } = (ev as CustomEvent).detail as { id: string; fotoUrl: string };
      setFotoMedidasCtx({
        fotoUrl: fu,
        fotoFile: null,
        onSalvar: async (base64Anotado: string) => {
          try {
            const fetchRes = await fetch(base64Anotado);
            const blob = await fetchRes.blob();
            const url = await uploadComRetry(blob, 'estacoes/fotos/' + Date.now() + '_medida.jpg');
            // Tenta Supabase primeiro (estações de Curitiba só existem lá)
            // Busca imagens atuais para merge (não perder croqui)
            const { data: rows } = await supabase
              .from('estacoes')
              .select('id,imagens')
              .or(`id.eq.${id},firebase_id.eq.${id}`)
              .limit(1);
            const row = rows?.[0];
            const { error: supErr } = row
              ? await supabase
                  .from('estacoes')
                  .update({ imagens: { ...(row.imagens || {}), foto: url } })
                  .eq('id', row.id)
              : { error: { message: 'not found' } } as any;
            const updateLocal = (matchId: string, newUrl: string) => {
              const est = estacoesRef.current.find((e: any) => e.id === matchId || e.id === id);
              if (est) (est as any).imagens = { ...((est as any).imagens || {}), foto: newUrl };
            };
            if (!supErr) {
              updateLocal(row?.id ?? id, url);
              showToast('Foto com medidas salva!', 'success');
              return;
            }
            // Fallback Supabase
            await supabase.from('estacoes').update({ imagens: { ...((estacoesRef.current.find(x => x.id === id) as any)?.imagens || {}), foto: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
            updateLocal(id, url);
            showToast('Foto com medidas salva!', 'success');
          } catch (err: any) {
            showToast('Erro ao salvar: ' + err.message, 'error');
          }
        }
      });
    };
    window.addEventListener('jetMedirFoto', handler);
    return () => window.removeEventListener('jetMedirFoto', handler);
  }, [showToast, setFotoMedidasCtx]);

  // Inicializa Leaflet
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      preferCanvas: true,
      center: [-23.5614, -46.6558],
      zoom: 13
    });

    // Tiles escuros — CartoDB Dark
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OSM © CartoDB',
      maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    layerRef.current  = layer;
    leafletRef.current = map;

    // Click no mapa para adicionar local operacional
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!modoAddLocalRef.current) return;
      setLocalOpModal({ latLng: { lat: e.latlng.lat, lng: e.latlng.lng } });
      setModoAddLocal(false);
      modoAddLocalRef.current = false;
      map.getContainer().style.cursor = '';
    });

    // Click no mapa para adicionar estação
    map.on('click', (e) => {
      if (!modoAddRef.current) return;
      // Remove pin anterior se existir
      if ((window as any).__pinMarker) { (window as any).__pinMarker.remove(); }
      const pinIcon = L.divIcon({
        html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">📍</div>',
        className: '', iconSize: [28,36] as [number,number], iconAnchor: [14,36] as [number,number],
      });
      (window as any).__pinMarker = L.marker([e.latlng.lat, e.latlng.lng], { icon: pinIcon }).addTo(map);
      // Reset geocode ao mudar posição — força novo reverse geocode no DrawerAdd
      setFotoParaDrawer('');
      setPinLatLng(null); // reset primeiro para forçar re-render do DrawerAdd
      setTimeout(() => setPinLatLng({ lat: e.latlng.lat, lng: e.latlng.lng }), 0);
      setDrawerAberto(true);
      setModoAdd(false);
      modoAddRef.current = false;
    });

    return () => { /* mapa persiste durante toda a sessão */ };
  }, []);

  // Sync modoAddLocal ref
  useEffect(() => {
    modoAddLocalRef.current = modoAddLocal;
    const map = leafletRef.current;
    if (!map) return;
    map.getContainer().style.cursor = modoAddLocal ? 'crosshair' : '';
    if (modoAddLocal) showToast('Clique no mapa para posicionar o local', 'info');
  }, [modoAddLocal]);

  // Mantém ref sincronizada com state
  useEffect(() => {
    modoAddRef.current = modoAdd;
    const map = leafletRef.current;
    if (!map) return;
    map.getContainer().style.cursor = modoAdd ? 'crosshair' : '';
  }, [modoAdd]);

  // Centraliza mapa ao selecionar cidade
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !cidade) return;
    const coords = COORDS_CIDADES[cidade];
    if (coords) map.setView(coords, 13);
  }, [cidade]);

  // Carrega estações das cidades selecionadas (Supabase)
  useEffect(() => {
    if (!cidades.length) { setEstacoes([]); return; }

    const porCidade: Record<string, Estacao[]> = {};
    let cancelled = false;
    const merge = () => { if (!cancelled) setEstacoes(Object.values(porCidade).flat()); };

    cidades.forEach(c => {
      const cTrim = c.trim();
      carregarEstacoesSupabase(cTrim).then(rows => {
        if (cancelled) return;
        porCidade[cTrim] = rows as Estacao[];
        merge();
      }).catch(e => console.warn('[estacoes-supabase] falha ao carregar', cTrim, e?.message));
    });

    return () => { cancelled = true; };
  }, [JSON.stringify(cidades)]);


  // Toggle ciclovias — busca via Overpass API (OpenStreetMap)
  const [cicloviasLoading, setCicloviasLoading] = useState(false);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    if (cicloviasLayerRef.current) {
      cicloviasLayerRef.current.remove();
      cicloviasLayerRef.current = null;
    }

    if (!cicloviasOn || !cidades.length) return;

    const coords = COORDS_CIDADES[cidades[0]];
    if (!coords) return;

    setCicloviasLoading(true);

    const [lat, lng] = coords;
    const delta = 0.12; // ~13km
    const bbox = `${lat - delta},${lng - delta},${lat + delta},${lng + delta}`;

    const query = `[out:json][timeout:25];
      (
        way["highway"="cycleway"](${bbox});
        way["bicycle"="designated"](${bbox});
        way["cycleway"~"lane|track|shared_lane"](${bbox});
      );
      out geom;`;

    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    })
      .then(r => r.json())
      .then(data => {
        const layer = L.layerGroup().addTo(map);
        cicloviasLayerRef.current = layer;

        (data.elements || []).forEach((el: any) => {
          if (el.type !== 'way' || !el.geometry) return;
          const latlngs = el.geometry.map((p: any) => [p.lat, p.lon] as [number, number]);
          if (latlngs.length < 2) return;
          L.polyline(latlngs, {
            color: '#00e676', weight: 3, opacity: 0.75, smoothFactor: 1
          }).addTo(layer);
        });
      })
      .catch(() => {})
      .finally(() => setCicloviasLoading(false));
  }, [cicloviasOn, cidade]);

  // Editor de zonas — click-to-draw
  const zonaDrawRef    = useRef<L.Polygon | null>(null);
  const zonaPointsRef  = useRef<[number,number][]>([]);
  const zonaTempLayer  = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    if (!zonaEditor) {
      // Sai do modo de desenho
      map.getContainer().style.cursor = modoAddRef.current ? 'crosshair' : '';
      if (zonaTempLayer.current) { zonaTempLayer.current.clearLayers(); }
      zonaPointsRef.current = [];
      if (zonaDrawRef.current) { zonaDrawRef.current.remove(); zonaDrawRef.current = null; }
      return;
    }

    // Entra no modo de desenho
    map.getContainer().style.cursor = 'crosshair';
    const tempLayer = L.layerGroup().addTo(map);
    zonaTempLayer.current = tempLayer;
    zonaPointsRef.current = [];

    const onClick = (e: L.LeafletMouseEvent) => {
      if (!zonaEditor) return;
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
      zonaPointsRef.current = [...zonaPointsRef.current, pt];

      // Atualiza preview do polígono
      if (zonaDrawRef.current) zonaDrawRef.current.remove();
      if (zonaPointsRef.current.length >= 2) {
        zonaDrawRef.current = L.polygon(zonaPointsRef.current, {
          color: '#c084fc', fillColor: '#c084fc',
          fillOpacity: 0.15, weight: 2, dashArray: '6,4'
        }).addTo(tempLayer);
      }

      // Marcador no ponto
      L.circleMarker(pt, {
        radius: 5, color: '#c084fc', fillColor: '#c084fc', fillOpacity: 1, weight: 2
      }).addTo(tempLayer);
    };

    const onDblClick = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      const pts = zonaPointsRef.current;
      if (pts.length < 3) {
        showToastGlobal('Desenhe pelo menos 3 pontos antes de fechar.', 'warn');
        return;
      }
      // Finaliza — abre formulário
      setZonaForm({ coords: pts });
      setZonaEditor(false);
      setZonaDrawing(false);
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.getContainer().style.cursor = '';
    };
  }, [zonaEditor]);

  // Toggle polígonos de mapeamento (Firestore)
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    if (poligonosLayerRef.current) {
      poligonosLayerRef.current.remove();
      poligonosLayerRef.current = null;
    }

    if (!poligonosOn || !cidades.length) return;

    const layer = L.layerGroup().addTo(map);
    poligonosLayerRef.current = layer;

    carregarZonasSupabase(cidades).then(rows => ({ docs: rows.map((r: any) => ({ id: r.id, data: () => r })) }))
    .then((snap: any) => {
      // Filtra ativo no cliente para incluir zonas sem campo ativo (legado)
      const activeDocs = { docs: snap.docs.filter((d: any) => d.data().ativo !== false) };
      return activeDocs;
    }).then((snap: any) => {
      snap.docs.forEach((doc: any) => {
        const d = doc.data();
        const pontos = d.poligono || d.Poligono || d.POLIGONO || '';
        if (!pontos) return;

        // Parse: [{lat,lng}] ou "lat,lng|lat,lng"
        let coords: [number, number][] = [];
        if (Array.isArray(pontos)) {
          coords = pontos
            .filter((p: any) => p.lat && p.lng)
            .map((p: any) => [Number(p.lat), Number(p.lng)]);
        } else {
          const sep = String(pontos).includes('|') ? '|' : ';';
          coords = String(pontos).split(sep)
            .map((p: string) => {
              const pts = p.split(',');
              return [parseFloat(pts[0]), parseFloat(pts[1])] as [number, number];
            })
            .filter(([la, lo]) => !isNaN(la) && !isNaN(lo));
        }

        if (coords.length < 3) return;

        const cor   = d.cor   || d.Cor   || '#2563eb';
        const nome  = d.nome  || d.Nome  || d['Nome Área'] || '';
        const fase  = d.fase  || d.Fase  || '';
        const grupo = d.grupo || d.Grupo || 'Geral';

        const poly = L.polygon(coords, {
          color: cor,
          fillColor: cor,
          fillOpacity: 0.12,
          weight: 2,
          opacity: 0.8
        });

        poly.on('click', (ev: any) => {
          if (modoAddRef.current) {
            // Em modoAdd, propagar clique para o mapa
            const latlng = ev.latlng;
            map.fire('click', { latlng, originalEvent: ev.originalEvent, layerPoint: ev.layerPoint, containerPoint: ev.containerPoint });
            return;
          }
          if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev);
          // Calcula dados da zona
          const pontos = coords.map(([lat, lng]) => ({ lat, lng }));
          const areaKm2 = calcAreaKm2(pontos);
          const estacoesNaZona = estacoes.filter(e => pontoNoPoli(e.lat, e.lng, pontos));
          const densidadeKm2 = areaKm2 > 0 ? (estacoesNaZona.length / areaKm2).toFixed(1) : '0';

          poly.bindPopup(`
            <div style="font-family:Inter,sans-serif;min-width:180px">
              <b style="font-size:13px">${nome || t('zone.noName')}</b>
              <div style="font-size:11px;color:#666;margin:2px 0">${fase} · ${grupo}</div>
              ${(() => { try { const dt = d.importadoEm || (d.criadoEm?.toDate ? d.criadoEm.toDate().toISOString() : d.criadoEm); if (!dt) return ''; const label = d.importadoEm ? t('zone.imported') : t('zone.created'); return '<div style="font-size:10px;color:#999;margin-top:2px">📅 ' + label + ': ' + new Date(dt).toLocaleDateString('pt-BR') + '</div>'; } catch(e) { return ''; } })()}
              <hr style="border:none;border-top:1px solid #eee;margin:8px 0">
              <div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div><b style="color:#2563eb">${areaKm2.toFixed(2)}</b><br><span style="font-size:10px;color:#888">km²</span></div>
                <div><b style="color:#16a34a">${estacoesNaZona.length}</b><br><span style="font-size:10px;color:#888">${t('zone.stations')}</span></div>
                <div><b style="color:#7c3aed">${densidadeKm2}</b><br><span style="font-size:10px;color:#888">${t('zone.stPerKm2')}</span></div>
                <div><b style="color:#0891b2">${estacoesNaZona.filter(e=>e.ia?.aprovado).length}</b><br><span style="font-size:10px;color:#888">IA ✓</span></div>
              </div>
            </div>
          `, { maxWidth: 220 }).openPopup();
        });

        // Calcula área e estações dentro do polígono
        const areaKm2 = calcAreaKm2(coords.map(([lat,lng]) => ({lat, lng})));
        const estacoesNaZona = estacoes.filter(e =>
          pontoNoPoli(e.lat, e.lng, coords.map(([lat,lng]) => ({lat,lng})))
        ).length;
        const densidade = areaKm2 > 0 ? (estacoesNaZona / areaKm2).toFixed(2) : '—';

        const tooltipHtml = `<div style="font-family:Inter,sans-serif;min-width:160px">
          <b style="font-size:12px">${nome || fase || t('zone.noName')}</b>
          ${fase ? `<div style="font-size:10px;color:#888;margin-top:2px">${fase}</div>` : ''}
          <div style="border-top:1px solid #eee;margin:6px 0"></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="color:#666">${t('zone.area')}</span>
            <b>${areaKm2 < 1 ? (areaKm2 * 100).toFixed(2) + ' ha' : areaKm2.toFixed(3) + ' km²'}</b>
          </div>
          <div style="font-size:11px;display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="color:#666">${t('zone.stations')}</span>
            <b>${estacoesNaZona}</b>
          </div>
          <div style="font-size:11px;display:flex;justify-content:space-between">
            <span style="color:#666">${t('zone.density')}</span>
            <b>${densidade}/km²</b>
          </div>
        </div>`;

        poly.bindPopup(tooltipHtml, { maxWidth: 200 });
        poly.bindTooltip(nome || fase || t('zone.noName'), {
          permanent: false, direction: 'center',
          className: 'leaflet-zona-tooltip'
        });

        poly.addTo(layer);
      });
    }).catch(() => {});

    // Handlers para botões no popup
    (window as any)._editZona = async (id: string) => {
      const { data } = await supabase.from('poligonos').select('*').or(`id.eq.${id},firebase_id.eq.${id}`).limit(1).single();
      if (data) setZonaEditando(data);
    };
    (window as any)._deleteZona = async (id: string, nome: string) => {
      if (!confirm('Excluir zona "' + nome + '"?')) return;
      const { error } = await supabase.from('poligonos').delete().or(`id.eq.${id},firebase_id.eq.${id}`);
      if (error) throw error;
      showToast('Zona excluída', 'success');
      setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 100);
    };
  }, [poligonosOn, cidade]);

  // Pinos de cidade no mapa mundial — busca cidades reais do Supabase
  const cidadePinsRef  = useRef<L.LayerGroup | null>(null);
  const [cidadesReais, setCidadesReais] = useState<{cidade: string; count: number; lat: number; lng: number; pais: string}[]>([]);
  const [modoCluster, setModoCluster] = useState(true); // true=cluster por cidade, false=pins individuais
  const [ocorrCidades, setOcorrCidades] = useState<{cidade:string;count:number;lat:number;lng:number;tipos:Record<string,number>}[]>([]);
  const ocorrCidadesRef = useRef<L.LayerGroup|null>(null);

  // Busca cidades com estações — Supabase
  const paisesDoUsuario = usuario.paises || ['BR'];
  useEffect(() => { (async () => {
    const userIsAdmin = ['admin','gestor'].includes(usuario.role);
    const buildMapa = (mapa: Record<string, {lats: number[]; lngs: number[]; count: number; pais: string}>, rows: {cidade:string;lat:number;lng:number;pais?:string}[]) => {
      for (const r of rows) {
        const c = r.cidade;
        if (!c || !r.lat || !r.lng) continue;
        const paisExplicito = typeof r.pais === 'string' && /^[A-Z]{2}$/.test(r.pais);
        let coordPais = paisExplicito ? r.pais! : 'BR';
        if (!paisExplicito) {
          if (r.lat > 14 && r.lat < 33 && r.lng > -118 && r.lng < -86) coordPais = 'MX';
          else if (r.lat > -56 && r.lat < -17 && r.lng > -76 && r.lng < -65) coordPais = 'CL';
          else if (r.lat > -5 && r.lat < 14 && r.lng > -80 && r.lng < -66) coordPais = 'CO';
          else coordPais = 'BR';
        }
        if (!userIsAdmin && !paisesDoUsuario.includes(coordPais)) continue;
        if (!mapa[c]) mapa[c] = { lats: [], lngs: [], count: 0, pais: coordPais };
        mapa[c].lats.push(r.lat);
        mapa[c].lngs.push(r.lng);
        mapa[c].count++;
      }
    };
    const mapaToLista = (mapa: Record<string, {lats: number[]; lngs: number[]; count: number; pais: string}>) =>
      Object.entries(mapa).map(([cidade, v]) => ({
        cidade, count: v.count, pais: v.pais,
        lat: v.lats.reduce((a,b)=>a+b,0)/v.lats.length,
        lng: v.lngs.reduce((a,b)=>a+b,0)/v.lngs.length
      })).sort((a,b) => b.count - a.count);

    const mapa: Record<string, {lats: number[]; lngs: number[]; count: number; pais: string}> = {};

    // Supabase: cidades agrupadas via RPC (evita limite de 1000 rows do PostgREST)
    const supaProm = (async () => {
      const { data, error } = await supabase.rpc('cidades_estacoes');
      if (data) {
        for (const r of data as any[]) {
          if (!r.cidade || !r.lat || !r.lng) continue;
          const p = r.pais || 'BR';
          if (!userIsAdmin && !paisesDoUsuario.includes(p)) continue;
          mapa[r.cidade] = { lats: [r.lat], lngs: [r.lng], count: r.count, pais: p };
        }
      }
    })().catch((e) => { console.error('[TelaMapa] Supabase catch:', e); });

    await supaProm;
    setCidadesReais(mapaToLista(mapa));
  })(); }, [pais]);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;

    if (cidadePinsRef.current) {
      cidadePinsRef.current.remove();
      cidadePinsRef.current = null;
    }

    if (cidades.length > 0) {
      // Centraliza em todas as cidades selecionadas
      const pontos = cidades
        .map(c => cidadesReais.find(r => r.cidade === c) || (COORDS_CIDADES[c] ? { lat: COORDS_CIDADES[c][0], lng: COORDS_CIDADES[c][1] } : null))
        .filter(Boolean) as {lat: number; lng: number}[];
      if (pontos.length === 1) {
        map.setView([pontos[0].lat, pontos[0].lng], 13);
      } else if (pontos.length > 1) {
        map.fitBounds(L.latLngBounds(pontos.map(p => [p.lat, p.lng] as [number,number])), { padding: [60,60] });
      }
      return;
    }

    if (!cidadesReais.length) return;

    // Sem cidade — mostra pins das cidades com estações reais
    const pinLayer = L.layerGroup().addTo(map);
    cidadePinsRef.current = pinLayer;

    // Ajusta zoom para mostrar todas as cidades
    const bounds = L.latLngBounds(cidadesReais.map(c => [c.lat, c.lng] as [number,number]));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 10 });

    cidadesReais.forEach(c => {
      const html = `<div style="
        background:linear-gradient(135deg,#1a6fd4,#307FE2);
        padding:3px 8px;border-radius:14px;
        color:white;font-size:9px;font-weight:700;
        border:1.5px solid rgba(255,255,255,.7);
        box-shadow:0 2px 8px rgba(48,127,226,.5);
        white-space:nowrap;cursor:pointer;
        display:flex;align-items:center;gap:4px">
        <span>${c.cidade}</span>
        <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:1px 5px;font-size:8px">${c.count}</span>
      </div>`;

      const marker = L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: '', html, iconAnchor: [30, 10] })
      });

      marker.on('click', () => {
        toggleCidade(c.cidade);
        setCidadeModal(false);
      });

      marker.addTo(pinLayer);
    });

  }, [cidade, cidadesReais]);

  // ── Cluster de ocorrências por cidade no mapa ──────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    // Limpar layer anterior
    if (ocorrCidadesRef.current) { ocorrCidadesRef.current.remove(); ocorrCidadesRef.current = null; }
    if (!ocorrenciasLayer.length) return;

    // Agrupa por cidade usando coordenadas das próprias ocorrências
    const agg: Record<string, {count:number;lat:number;lng:number;tipos:Record<string,number>}> = {};
    ocorrenciasLayer.forEach((o: any) => {
      const c = (o.cidade_inicial || 'Desconhecida').trim();
      const lat = Number(o.lat_inicial); const lng = Number(o.lng_inicial);
      if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) return;
      if (!agg[c]) agg[c] = { count:0, lat:0, lng:0, tipos:{} };
      agg[c].count++; agg[c].lat += lat; agg[c].lng += lng;
      const t = String(o.tipo || 'Outro');
      agg[c].tipos[t] = (agg[c].tipos[t] || 0) + 1;
    });

    const layer = L.layerGroup().addTo(map);
    ocorrCidadesRef.current = layer;

    Object.entries(agg).forEach(([cidade, d]) => {
      const lat = d.lat / d.count; const lng = d.lng / d.count;
      // Cor dominante pelo tipo
      const domTipo = Object.entries(d.tipos).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Outro';
      const cor = domTipo === 'Roubo' ? '#ef4444' : domTipo === 'Vandalismo' ? '#f59e0b' : domTipo === 'Tentativa' ? '#f97316' : '#6ee7b7';

      // Pílula igual ao pin de cidade — mesma estrutura: "NomeCidade (⚠ N)"
      const html = `<div style="
        background:linear-gradient(135deg,${cor}dd,${cor});
        padding:3px 8px;border-radius:14px;
        color:white;font-size:9px;font-weight:700;
        border:1.5px solid rgba(255,255,255,.55);
        box-shadow:0 2px 8px ${cor}66;
        white-space:nowrap;cursor:pointer;
        display:flex;align-items:center;gap:4px">
        <span>${cidade}</span>
        <span style="background:rgba(0,0,0,.25);border-radius:8px;padding:1px 5px;font-size:8px;display:flex;align-items:center;gap:2px">
          <span style="font-size:8px">⚠</span>${d.count}
        </span>
      </div>`;

      // Posicionar logo abaixo do pin de cidade (que usa iconAnchor [30,10])
      // iconAnchor Y negativo = desloca para baixo do ponto de referência
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({ className:'', html, iconAnchor:[30, -16] }),
        zIndexOffset: -200
      });

      const tipLines = Object.entries(d.tipos)
        .sort((a,b) => b[1]-a[1])
        .map(([t,n]) => `<div>${t}: <strong>${n}</strong></div>`).join('');
      marker.bindPopup(`<div style="font-family:Arial;font-size:12px;min-width:160px;">
        <div style="font-weight:700;color:${cor};margin-bottom:6px;">${cidade}</div>
        <div><strong>${d.count}</strong> ${d.count>1?t('popup.occurrences'):t('popup.occurrence')}</div>
        ${tipLines}</div>`);

      marker.addTo(layer);
    });

    setOcorrCidades(Object.entries(agg).map(([cidade,d]) => ({
      cidade, count:d.count, lat:d.lat/d.count, lng:d.lng/d.count, tipos:d.tipos
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocorrenciasLayer]);

  // ── Markers dos POIs Google no mapa ───────────────────────────────────
  const poiGoogleMarkersRef = useRef<L.LayerGroup|null>(null);
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    // Limpar layer anterior completamente
    if (poiGoogleMarkersRef.current) {
      poiGoogleMarkersRef.current.clearLayers();
      poiGoogleMarkersRef.current.remove();
      poiGoogleMarkersRef.current = null;
    }
    if (!poiGoogleDados.length) return;

    const layer = L.layerGroup().addTo(map);
    poiGoogleMarkersRef.current = layer;

    const dadosFiltrados = poiGoogleTiposAtivos === null
      ? poiGoogleDados
      : poiGoogleTiposAtivos.size > 0
        ? poiGoogleDados.filter((p: any) => poiGoogleTiposAtivos!.has(p.tipo))
        : []; // Set vazio = nenhum visível

    dadosFiltrados.forEach((poi: any) => {
      if (!poi.lat || !poi.lng) return;
      // Ícone por tipo
      const TIPO_ICON: Record<string,string> = {
        restaurant:'🍽',cafe:'☕',bar:'🍺',nightclub:'🎵',fast_food:'🍔',
        transit_station:'🚇',bus_station:'🚌',lodging:'🏨',hotel:'🏨',
        shopping_mall:'🛍',supermarket:'🛒',pharmacy:'💊',hospital:'🏥',
        university:'🎓',school:'📚',bank:'🏦',park:'🌳',gym:'💪',
        museum:'🏛',stadium:'🏟',attraction:'⭐',
      };
      const icone = TIPO_ICON[poi.tipo] || '📍';
      const nome  = poi.nome.length > 18 ? poi.nome.slice(0,16)+'…' : poi.nome;
      // Pílula: fundo escuro sólido, emoji grande, texto branco nítido
      const html = '<div style="'
        + 'background:#0d1521;'
        + 'padding:4px 9px 4px 6px;border-radius:20px;'
        + 'border:1.5px solid #fbbf24;'
        + 'box-shadow:0 2px 10px rgba(0,0,0,.8);'
        + 'white-space:nowrap;cursor:pointer;'
        + 'display:flex;align-items:center;gap:5px">'
        + '<span style="font-size:14px;line-height:1">' + icone + '</span>'
        + '<span style="color:#fff;font-size:10px;font-weight:600">' + nome + '</span>'
        + '</div>';

      const marker = L.marker([poi.lat, poi.lng], {
        icon: L.divIcon({ className:'', html, iconAnchor:[40, 10] }),
        zIndexOffset: 50,
      });
      marker.on('click', () => {
        // Abrir drawer de add estação na localização do POI
        setPinLatLng({ lat: poi.lat, lng: poi.lng });
        setDrawerAberto(true);
        showToast('📍 ' + (poi.nome || 'POI selecionado'), 'info');
      });
      marker.addTo(layer);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiGoogleDados, poiGoogleTiposAtivos]);

  // Trocar tile layer dark/light
  useEffect(() => {
    const map = leafletRef.current; if (!map) return;
    const tileUrl = mapMode === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    if ((map as any)._mainTile) map.removeLayer((map as any)._mainTile);
    const tile = L.tileLayer(tileUrl, { attribution:'©CartoDB', maxZoom:19 });
    tile.addTo(map);
    (map as any)._mainTile = tile;
  }, [mapMode]);

  // Raio dinâmico ao redor das estações
  useEffect(() => {
    if (raioLayerRef.current) { raioLayerRef.current.clearLayers(); }
    if (!raioAtivo || !leafletRef.current) return;

    if (!raioLayerRef.current) {
      raioLayerRef.current = L.layerGroup().addTo(leafletRef.current);
    }
    const layer = raioLayerRef.current;
    raioLayerRef.current = layer;
    layer.clearLayers();

    // Modo cluster: esconde pins individuais (mostra só clusters por cidade)
    // Modo pins: mostra todos os pins individuais
    // Raio mostra sempre baseado nas estações filtradas (independente do cluster)
    const estacoesVisiveis = estacoes.filter(e => filtros.has(e.tipo) && filtrosStatus.has(e.status));

    estacoesVisiveis.forEach(e => {
      L.circle([e.lat, e.lng], {
        radius: raioMetros,
        color: '#60a5fa', fillColor: '#60a5fa',
        fillOpacity: 0.06, weight: 1, opacity: 0.4,
        interactive: false
      }).addTo(layer);
    });
  }, [raioAtivo, raioMetros, estacoes, filtros, filtrosStatus]);

  // Limpa markers ao trocar cidade
  useEffect(() => {
    layerRef.current?.clearLayers();
  }, [cidade]);

  // Renderiza markers em chunks — sem travar
  useEffect(() => {
    const layer = layerRef.current;
    const map   = leafletRef.current;
    if (!layer || !map || !estacoes.length) return;

    let cancelado = false;

    layer.clearLayers();

    // Aplica filtros
    const estacosFiltradas = estacoes.filter(e =>
      filtros.has(e.tipo) && filtrosStatus.has(e.status)
    );
    setContagem(estacosFiltradas.length);

    if (!estacosFiltradas.length) return () => { cancelado = true; };

    const CHUNK = 50;
    let i = 0;

    const addChunk = () => {
      if (cancelado) return; // para se useEffect foi limpo
      const fim = Math.min(i + CHUNK, estacosFiltradas.length);
      for (; i < fim; i++) {
        const e = estacosFiltradas[i];
        if (!e.lat || !e.lng) continue;

        // Paleta tipo × status — variação de tons para identificação rápida
        const COR_PIN: Record<string, Record<string, string>> = {
          PUBLICA: {
            ATIVO:      '#10b981', // verde esmeralda (fase 1 Curitiba)
            PLANEJADO:  '#8b5cf6', // roxo
            SOLICITADO: '#93c5fd', // azul claro
            NEGOCIACAO: '#fbbf24', // âmbar/ouro
            APROVADO:   '#3b82f6', // azul médio
            INSTALADO:  '#1d4ed8', // azul forte
            REPROVADO:  '#7f1d1d', // vermelho escuro
            CANCELADO:  '#475569', // cinza azulado
          },
          PRIVADA: {
            ATIVO:      '#059669',
            PLANEJADO:  '#7c3aed',
            SOLICITADO: '#fde68a',
            NEGOCIACAO: '#f59e0b',
            APROVADO:   '#f59e0b',
            INSTALADO:  '#b45309',
            REPROVADO:  '#991b1b',
            CANCELADO:  '#57534e',
          },
          CONCORRENTE: {
            ATIVO:      '#047857',
            PLANEJADO:  '#6d28d9',
            SOLICITADO: '#fca5a5',
            NEGOCIACAO: '#f97316',
            APROVADO:   '#ef4444',
            INSTALADO:  '#b91c1c',
            REPROVADO:  '#450a0a',
            CANCELADO:  '#6b7280',
          },
        };
        const cor = e.ia?.aprovado
          ? '#22c55e'
          : (COR_PIN[e.tipo]?.[e.status] || COR_PIN['PUBLICA']['SOLICITADO']);

        // Tamanho e opacidade também variam: Instalado=maior, Cancelado=menor+opaco
        const pinSize  = e.status === 'INSTALADO' ? 11
                       : e.status === 'APROVADO'  ?  9
                       : e.status === 'NEGOCIACAO' ? 8.5
                       : e.status === 'SOLICITADO' ? 8
                       : 7; // reprovado/cancelado menor
        const opacity  = (e.status === 'REPROVADO' || e.status === 'CANCELADO') ? '.5' : '1';

        const html = `<div style="
          background:${cor};width:${pinSize}px;height:${pinSize}px;border-radius:50%;
          border:1.5px solid rgba(255,255,255,${opacity});box-shadow:0 1px 4px rgba(0,0,0,.5);
          opacity:${opacity}"></div>`;

        const marker = L.marker([e.lat, e.lng], {
          icon: L.divIcon({ className: '', html, iconSize: [pinSize, pinSize], iconAnchor: [Math.floor(pinSize/2), Math.floor(pinSize/2)] })
        });
        (marker as any)._jet_id = e.id;

        // InfoWindow completo
        marker.bindPopup(() => {
          const d = e as any;

          // Foto ou Street View
    const rawFoto = e.imagens?.foto || (e as any).foto || (e as any).fotoUrl || '';
    const imgUrl = sanitizarFotoUrl(rawFoto) || fixDriveUrl(rawFoto) || e.imagens?.streetView || '';
          const imgHtml = imgUrl
            ? `<img src="${imgUrl}" referrerpolicy="no-referrer" style="width:100%;height:110px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block"
               onerror="this.style.height='0px'">`
            : '';

          const iaHtml = ''; // IA desativada

          // Dados específicos por tipo
          let tipoExtra = '';
          if (e.tipo === 'CONCORRENTE' && d.nomeConcorrente) {
            tipoExtra = `<div style="font-size:11px;color:#ef4444;margin:3px 0">
              🏢 ${t('popup.competitor')}: <b>${d.nomeConcorrente}</b></div>`;
          }

          // Documentos públicos (TPU / Autorização Prefeitura) — editável direto no popup
          const docPublico = d.docPublico || {};
          const docHtml = (e.cidade === 'São Paulo' || e.tipo === 'PUBLICA')
            ? `<div id="jet-doc-${e.id}" style="background:#e8f4fd;border:1px solid #b3d9f5;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:11px">
                <div style="font-weight:700;color:#1565c0;margin-bottom:5px">📄 ${t('popup.publicDocs')}</div>
                ${docPublico.tpu ? `<div style="color:#1976d2;margin:2px 0">🏛 TPU: <a href="${docPublico.tpu}" target="_blank" style="color:#1976d2;font-weight:600">${t('popup.view')} ↗</a></div>` : `<div style="color:#90a4ae;font-size:10px">🏛 ${t('popup.tpuNotRegistered')}</div>`}
                ${docPublico.autorizacao ? `<div style="color:#1976d2;margin:2px 0">✅ Autorização: <a href="${docPublico.autorizacao}" target="_blank" style="color:#1976d2;font-weight:600">${t('popup.view')} ↗</a></div>` : `<div style="color:#90a4ae;font-size:10px">✅ ${t('popup.authNotRegistered')}</div>`}
                ${docPublico.obs ? `<div style="color:#555;font-size:10px;margin-top:3px">📝 ${docPublico.obs}</div>` : ''}
                <button onclick="window.dispatchEvent(new CustomEvent('jetEditDocPublico',{detail:{id:'${e.id}',cidade:'${e.cidade}',docPublico:${JSON.stringify(docPublico)}}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
                  style="margin-top:6px;width:100%;padding:4px;background:#1565c0;color:#fff;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer">
                  ✏️ ${docPublico.tpu || docPublico.autorizacao ? t('popup.updateDocs') : t('popup.addDocs')}
                </button>
              </div>`
            : '';
          if (e.tipo === 'PRIVADA') {
            // privado pode estar em d.privado (Firestore subcampo)
            const p = d.privado || {};
            const temDados = p.nomeLocal || p.nomeAutorizante || p.telefone || p.email;
            tipoExtra = `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:8px 10px;margin:6px 0;font-size:11px;line-height:1.6">
              <div style="font-weight:700;color:#e65100;margin-bottom:4px">🏢 ${p.nomeLocal || t('popup.nameNotFilled')}</div>
              ${p.nomeAutorizante ? `<div style="color:#555">👤 ${p.nomeAutorizante}${p.cargoAutorizante ? ' &middot; ' + p.cargoAutorizante : ''}</div>` : ''}
              ${p.telefone ? `<div style="color:#555">📞 ${p.telefone}</div>` : ''}
              ${p.email    ? `<div style="color:#555">✉️ ${p.email}</div>`    : ''}
              ${d.consultor ? `<div style="color:#555">👷 ${d.consultor}</div>` : ''}
              ${!temDados ? `<div style="color:#e65100;font-size:10px">⚠ ${t('popup.dataNotRegistered')}</div>` : ''}
            </div>`;
          }

          // Dados técnicos
          const tecnico = e.larguraFaixa
            ? `<div style="font-size:11px;color:#888;margin:2px 0">
                ${t('popup.width')}: <b style="color:#333">${e.larguraFaixa}m</b></div>` : '';


          // Data/hora de cadastro + consultor
          const fmtTs = (ts: any) => {
            if (!ts) return '';
            try {
              const dt = ts?.toDate ? ts.toDate() : new Date(ts);
              return dt.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
            } catch { return ''; }
          };
          const dtCadastro    = fmtTs((e as any).criadoEm);
          const consultorText = (e as any).consultor || '';
          const metaParts     = [
            dtCadastro    ? '🕐 ' + dtCadastro    : '',
            consultorText ? '👤 ' + consultorText : '',
          ].filter(Boolean);
          const metaHtml = metaParts.length
            ? `<div style="font-size:10px;color:#aaa;margin:3px 0">${metaParts.join(' · ')}</div>`
            : '';

          // Links de imagens
          const svInlineBtn = `<button onclick="window.dispatchEvent(new CustomEvent('jetOpenSV',{detail:{lat:${e.lat},lng:${e.lng},nome:'${(e.endereco||e.codigo||'').replace(/'/g,"")}',estacaoId:'${e.id}',estacaoCodigo:'${e.codigo||""}'}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
            style="background:#005bff;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;margin-right:4px">🌐 ${t('popup.streetView')}</button>`;
          const fotoBtn = `<button onclick="window.dispatchEvent(new CustomEvent('jetFoto',{detail:{id:'${e.id}',codigo:'${e.codigo||''}',lat:${e.lat},lng:${e.lng}}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
            style="background:#10b981;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">📷 ${t('popup.photo')}</button>`;
          // Google Maps link opens the location in Maps (not embed)
          const gmapsUrl = `https://www.google.com/maps?q=${e.lat},${e.lng}&cbll=${e.lat},${e.lng}&layer=c`;
          const medirFotoUrl = fixDriveUrl(e.imagens?.foto || '') || e.imagens?.foto || e.imagens?.streetView || '';
          const medirBtn = medirFotoUrl
            ? `<button onclick="window.dispatchEvent(new CustomEvent('jetMedirFoto',{detail:{id:'${e.id}',fotoUrl:'${medirFotoUrl}'}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
                style="background:#1d4ed8;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">📐 ${t('popup.measure')}</button>`
            : '';
          const links = [
            svInlineBtn, fotoBtn, medirBtn,
            `<a href="${gmapsUrl}" target="_blank"
              style="color:#005bff;font-size:10px;text-decoration:none">🗺 ${t('popup.maps')}</a>`,
            e.imagens?.croqui ? `<a href="${e.imagens.croqui}" target="_blank"
              style="color:#7c3aed;font-size:10px;text-decoration:none">📐 ${t('popup.croqui')}</a>` : '',
            e.imagens?.foto && e.imagens?.foto !== imgUrl ? `<a href="${e.imagens.foto}" target="_blank"
              style="color:#16a34a;font-size:10px;text-decoration:none">📸 ${t('popup.photo')}</a>` : ''
          ].filter(Boolean).join(' · ');

          const bairroSubpref = [e.bairro, d.subprefeitura].filter(Boolean).join(' · ');

          // Foto — verificar múltiplos campos possíveis
const rawFoto2 = e.imagens?.foto || (e as any).foto || (e as any).fotoUrl || '';
const fotoReal = sanitizarFotoUrl(rawFoto2) || fixDriveUrl(rawFoto2) || '';
const fotoSrc = fotoReal || e.imagens?.streetView || '';
const isSvFoto = !fotoReal && !!e.imagens?.streetView;
          const thumbHtml = fotoSrc
            ? `<div style="position:relative;margin-bottom:8px;border-radius:8px;overflow:hidden;cursor:pointer"
                onclick="window.dispatchEvent(new CustomEvent('jetOpenFoto',{detail:{url:'${fotoSrc}'}}))">
                <img src="${fotoSrc}" referrerpolicy="no-referrer"
                  style="width:100%;height:140px;object-fit:cover;display:block"
                  onerror="this.style.height='0px'" />
                ${isSvFoto ? `<div style="position:absolute;top:6px;left:6px;background:rgba(0,91,255,.85);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px">🌐 SV</div>` : ''}
                <div style="position:absolute;bottom:0;left:0;right:0;padding:5px 8px;
                  background:linear-gradient(transparent,rgba(0,0,0,.7));
                  font-size:9px;color:#fff;font-weight:600">${isSvFoto ? '📷 ' + t('popup.tapZoomReplace') : '🔍 ' + t('popup.tapZoom')}</div>
              </div>`
            : `<div style="background:#f0f4f8;border-radius:8px;height:60px;display:flex;align-items:center;
                justify-content:center;margin-bottom:8px;cursor:pointer;border:2px dashed #cbd5e1"
                onclick="window.dispatchEvent(new CustomEvent('jetFoto',{detail:{id:'${e.id}',codigo:'${e.codigo||''}',lat:${e.lat},lng:${e.lng}}}));document.querySelector('.leaflet-popup-close-button')?.click()">
                <span style="font-size:11px;color:#64748b;font-weight:600">📷 ${t('popup.addPhoto')}</span>
              </div>`;

          const croquiSrc = e.imagens?.croqui ? fixDriveUrl(e.imagens.croqui) : '';
          const croquiThumb = croquiSrc
            ? `<div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;cursor:pointer;background:#f8f5ff;border:1px solid #e9e0ff;border-radius:6px;padding:4px 6px"
                onclick="window.dispatchEvent(new CustomEvent('jetOpenFoto',{detail:{url:'${croquiSrc}'}}))">
                <img src="${croquiSrc}" referrerpolicy="no-referrer"
                  style="width:48px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0"
                  onerror="this.parentElement.style.display='none'" />
                <span style="font-size:10px;color:#7c3aed;font-weight:600">📐 ${t('popup.croqui')}</span>
              </div>`
            : '';

          const svSrc = !fotoSrc && e.imagens?.streetView ? e.imagens.streetView : '';
          const svThumb = svSrc
            ? `<div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;cursor:pointer;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:4px 6px"
                onclick="window.dispatchEvent(new CustomEvent('jetOpenFoto',{detail:{url:'${svSrc}'}}))">
                <img src="${svSrc}" referrerpolicy="no-referrer"
                  style="width:48px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0"
                  onerror="this.parentElement.style.display='none'" />
                <span style="font-size:10px;color:#005bff;font-weight:600">🌐 ${t('popup.streetView')}</span>
              </div>`
            : '';

          return `<div style="min-width:220px;max-width:260px;font-family:Inter,sans-serif">
            ${docHtml}
            ${thumbHtml}
            ${svThumb}
            ${croquiThumb}
            <div style="font-size:10px;color:#888;margin-bottom:2px">
              ${e.tipo} · ${e.status}${bairroSubpref ? ' · ' + bairroSubpref : ''}
            </div>
            <b style="font-size:13px;color:#0d0d1a;display:block;margin-bottom:1px">
              ${e.endereco || e.bairro || e.codigo}
            </b>
            <div style="font-size:10px;color:#aaa;margin-bottom:4px">${e.codigo}</div>
            ${tipoExtra}
            ${tecnico}
            ${metaHtml}
            ${iaHtml}
            ${links ? `<div style="margin:6px 0">${links}</div>` : ''}
            <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
              <button onclick="window._svClick('${e.id}')" style="flex:1;padding:5px;background:#e8f0ff;border:none;border-radius:5px;color:#005bff;font-size:10px;font-weight:600;cursor:pointer">SV</button>

              ${isGestor || e.operador === usuario.email
                ? `<button onclick="window._editClick('${e.id}')" style="flex:1;padding:5px;background:#fff3e0;border:none;border-radius:5px;color:#e65100;font-size:10px;font-weight:600;cursor:pointer">${t('popup.edit')}</button>`
                : ''}
              <button onclick="window._croquiClick('${e.id}')" style="flex:1;padding:5px;background:#f3e8ff;border:none;border-radius:5px;color:#7c3aed;font-size:10px;font-weight:600;cursor:pointer">${t('popup.croqui')}</button>
              ${isGestor
                ? `<button onclick="window._delClick('${e.id}')" style="flex:1;padding:5px;background:#fde8e8;border:none;border-radius:5px;color:#c62828;font-size:10px;font-weight:600;cursor:pointer">${t('popup.del')}</button>`
                : ''}
              ${isSuperGestor
                ? `<button onclick="window._monitorClick('${e.id}')" style="flex:1;padding:5px;background:${(e as any).tipoMonitor ? '#052e16' : '#f0fdf4'};border:1px solid ${(e as any).tipoMonitor ? '#16a34a' : '#86efac'};border-radius:5px;color:${(e as any).tipoMonitor ? '#4ade80' : '#15803d'};font-size:10px;font-weight:700;cursor:pointer">${(e as any).tipoMonitor ?? t('popup.monitor')}</button>`
                : ''}
              ${isLogisticaApp
                ? `<button onclick="window._tarefaEstacaoClick('${e.id}','${(e.endereco||e.codigo||'').replace(/'/g,'')}',${e.lat},${e.lng})" style="width:100%;margin-top:4px;padding:7px;background:#3b82f6;border:none;border-radius:5px;color:#fff;font-size:11px;font-weight:700;cursor:pointer">📦 ${t('popup.createTask')}</button>`
                : ''}
            </div>
          </div>`;
        }, { maxWidth: 280 });

        // Mini-preview ao hover
        marker.on('mouseover', (ev: any) => {
          const rect = (leafletRef.current?.getContainer() as HTMLElement)?.getBoundingClientRect();
          const pt = ev.originalEvent;
          setHoverPin({ e, x: pt.clientX - (rect?.left||0), y: pt.clientY - (rect?.top||0) });
        });
        marker.on('mouseout', () => setHoverPin(null));

        marker.addTo(layer);
      }
      if (i < estacosFiltradas.length) setTimeout(addChunk, 10);
    };

    addChunk();

    // Centraliza no primeiro lote
    if (estacosFiltradas.length > 0 && estacosFiltradas[0].lat) {
      const bounds = estacosFiltradas
        .filter(e => e.lat && e.lng)
        .map(e => [e.lat, e.lng] as [number, number]);
      if (bounds.length === 1) {
        map.setView(bounds[0], 15);
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    }

    return () => { cancelado = true; };
  }, [estacoes, filtros, filtrosStatus]);

  // Funções globais para popup buttons
  useEffect(() => {
    (window as any)._croquiClick = async (id: string) => {
      const est = estacoes.find(x => x.id === id);
      if (!est) return;
      if (!confirm(t('popup.croquiConfirm', { codigo: est.codigo }))) return;
      showToast(t('popup.croquiGenerating'), 'info');
      try {
        const res = await fnGerarCroqui()({ estacaoId: id });
        const d = (res.data || res) as unknown as { ok: boolean; pdfUrl: string };
        if (d.ok && d.pdfUrl) {
          showToast(t('popup.croquiDone'), 'success');
          window.open(d.pdfUrl, '_blank');
        }
      } catch(e: unknown) {
        showToast('Erro: ' + (e instanceof Error ? e.message : String(e)), 'error');
      }
    };

    (window as any)._svClick = async (id: string) => {
      const e = estacoesRef.current.find(x => x.id === id);
      if (!e) return;
      leafletRef.current?.closePopup();
      showToast(t('sv.generating'), 'info');
      try {
        const r = await fnGerarStreetView()({ codigo: e.codigo, lat: e.lat, lng: e.lng });
        const d = (r.data || r) as { url?: string; fonte?: string; error?: string };
        if (d.url) {
          setSvPreview({ id, url: d.url, fonte: d.fonte || 'SV' });
        } else {
          showToast(d.error || t('sv.noCoverage'), 'warn');
        }
      } catch (err: unknown) {
        showToast('Erro: ' + (err instanceof Error ? err.message : String(err)), 'error');
      }
    };
    (window as any)._svSaveFn = async (id: string, url: string) => {
      const e = estacoesRef.current.find(x => x.id === id);
      if (!e) return;
      const { error: supErr } = await supabase.from('estacoes').update({ imagens: { ...((e as any).imagens || {}), streetView: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
      if (!supErr) {
        const est = estacoesRef.current.find((x: any) => x.id === id);
        if (est) (est as any).imagens = { ...((est as any).imagens || {}), streetView: url };
      }
      leafletRef.current?.eachLayer((layer: any) => {
        if (layer._jet_id === id && layer.getPopup?.()) layer.openPopup();
      });
      showToast(t('sv.saved'), 'success');
    };
    (window as any)._svBatch = async () => {
      const map = leafletRef.current;
      if (!map) return;
      const bounds = map.getBounds();
      const semFoto = estacoesRef.current.filter((e: any) => {
        if (!filtros.has(e.tipo) || !filtrosStatus.has(e.status)) return false;
        if (e.imagens?.foto || e.imagens?.streetView) return false;
        return bounds.contains([e.lat, e.lng]);
      });
      if (!semFoto.length) { showToast(t('sv.batchDone', { ok: 0, fail: 0 }), 'info'); return; }
      if (!confirm(t('sv.batchConfirm', { count: semFoto.length }))) return;
      setSvBatchRunning(true);
      let ok = 0, fail = 0;
      for (const e of semFoto) {
        try {
          const r = await fnGerarStreetView()({ codigo: e.codigo, lat: e.lat, lng: e.lng });
          const d = (r.data || r) as { url?: string; fonte?: string };
          if (d.url) {
            await supabase.from('estacoes').update({ imagens: { ...((e as any).imagens || {}), streetView: d.url } }).or(`id.eq.${e.id},firebase_id.eq.${e.id}`);
            (e as any).imagens = { ...((e as any).imagens || {}), streetView: d.url };
            ok++;
          } else { fail++; }
        } catch { fail++; }
        if ((ok + fail) % 5 === 0) showToast(t('sv.batchProgress', { ok, fail, remaining: semFoto.length - ok - fail }), 'info');
      }
      setSvBatchRunning(false);
      showToast(t('sv.batchDone', { ok, fail }), ok > 0 ? 'success' : 'warn');
    };
    (window as any)._svMedirCombo = async () => {
      const map = leafletRef.current;
      if (!map) return;
      const bounds = map.getBounds();
      const semFoto = estacoesRef.current.filter((e: any) => {
        if (!filtros.has(e.tipo) || !filtrosStatus.has(e.status)) return false;
        if (e.imagens?.foto || e.imagens?.streetView) return false;
        return bounds.contains([e.lat, e.lng]);
      });
      const semMedida = estacoesRef.current.filter((e: any) => {
        if (!filtros.has(e.tipo) || !filtrosStatus.has(e.status)) return false;
        const fotoUrl = e.imagens?.foto || e.imagens?.streetView || '';
        if (!fotoUrl) return false;
        if (typeof fotoUrl === 'string' && fotoUrl.includes('_medida')) return false;
        return bounds.contains([e.lat, e.lng]);
      });
      if (!semFoto.length && !semMedida.length) { showToast(t('medir.batchEmpty'), 'info'); return; }
      if (!confirm(t('sv.comboConfirm', { svCount: semFoto.length, medirCount: semFoto.length + semMedida.length }))) return;
      // Step 1: Generate SVs
      if (semFoto.length) {
        setSvBatchRunning(true);
        let ok = 0, fail = 0;
        for (const e of semFoto) {
          try {
            const r = await fnGerarStreetView()({ codigo: e.codigo, lat: e.lat, lng: e.lng });
            const d = (r.data || r) as { url?: string; fonte?: string };
            if (d.url) {
              await supabase.from('estacoes').update({ imagens: { ...((e as any).imagens || {}), streetView: d.url } }).or(`id.eq.${e.id},firebase_id.eq.${e.id}`);
              (e as any).imagens = { ...((e as any).imagens || {}), streetView: d.url };
              ok++;
            } else { fail++; }
          } catch { fail++; }
          if ((ok + fail) % 5 === 0) showToast(t('sv.batchProgress', { ok, fail, remaining: semFoto.length - ok - fail }), 'info');
        }
        setSvBatchRunning(false);
        showToast(t('sv.comboDone', { ok }), 'success');
      }
      // Step 2: Open measurement queue
      setTimeout(() => (window as any)._medirBatch?.(), 500);
    };
    (window as any)._medirBatch = () => {
      const map = leafletRef.current;
      if (!map) return;
      const bounds = map.getBounds();
      const semMedida = estacoesRef.current.filter((e: any) => {
        if (!filtros.has(e.tipo) || !filtrosStatus.has(e.status)) return false;
        const fotoUrl = e.imagens?.foto || e.imagens?.streetView || '';
        if (!fotoUrl) return false;
        if (typeof fotoUrl === 'string' && fotoUrl.includes('_medida')) return false;
        return bounds.contains([e.lat, e.lng]);
      });
      if (!semMedida.length) { showToast(t('medir.batchEmpty'), 'info'); return; }
      leafletRef.current?.closePopup();
      setMedirFila({ lista: semMedida, idx: 0 });
    };
    (window as any)._editClick = (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      setEstacaoEdit(e);
      setPinLatLng({ lat: e.lat, lng: e.lng });
      setDrawerAberto(true);
      leafletRef.current?.closePopup();
    };
    (window as any)._monitorClick = (id: string) => {
      const est = estacoes.find((x: any) => x.id === id);
      if (!est) return;
      leafletRef.current?.closePopup();
      const mapContainer = leafletRef.current?.getContainer();
      const rect = mapContainer?.getBoundingClientRect();
      const cx = (rect?.left ?? 0) + (rect?.width ?? 600) / 2;
      const cy = (rect?.top ?? 0) + (rect?.height ?? 400) / 2;
      setMonitorPanel({ estacao: est, posicao: { x: cx, y: cy } });
    };

    // Tarefa rápida a partir de estação do mapa JET OS
    (window as any)._tarefaEstacaoClick = (
      id: string, nome: string, lat: number, lng: number
    ) => {
      leafletRef.current?.closePopup();
      // Abre TarefasLogisticaModule com o ponto pré-selecionado
      setParkingParaTarefa({ id, nome, lat, lng, target: undefined, disponivel: undefined });
      setTarefasLogistica(true);
    };
    (window as any)._delClick = async (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      if (!confirm(t('popup.deleteConfirm', { codigo: e.codigo }))) return;
      try {
        const { error } = await supabase.from('estacoes').delete().or(`id.eq.${id},firebase_id.eq.${id}`);
        if (error) throw error;
        setEstacoes(prev => prev.filter((x: any) => x.id !== id));
        leafletRef.current?.closePopup();
        showToast(t('popup.deleted'), 'success');
      } catch { showToast(t('popup.deleteError'), 'error'); }
    };
    (window as any)._iaClick = async (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      showToast(t('popup.analyzing'), 'info');
      const r = await fnAnalisarCalcada()({ lat: e.lat, lng: e.lng, codigo: e.codigo });
      const d = (r.data || r) as { ok: boolean; resultado?: { aprovado: boolean; larguraEstimada: string }; error?: string };
      if (d.ok && d.resultado) {
        showToast(d.resultado.aprovado ? `Aprovado · ${d.resultado.larguraEstimada}` : t('filters.rejected'), d.resultado.aprovado ? 'success' : 'warn');
      } else showToast(d.error || 'Erro', 'error');
    };
  }, [estacoes, showToast]);

  // ── STREET VIEW EVENT LISTENER ──────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.lat && detail?.lng) {
        setStreetViewTarget({ lat: detail.lat, lng: detail.lng, nome: detail.nome, estacaoId: detail.estacaoId, estacaoCodigo: detail.estacaoCodigo });
      }
    };
    const analyticsStationHandler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) { setAnalyticsStationInfo(null); return; }
      setAnalyticsStationInfo(d);
      if (d._hover) {
        if (analyticsHoverRef.current) clearTimeout(analyticsHoverRef.current);
        analyticsHoverRef.current = setTimeout(() => setAnalyticsStationInfo((cur: any) => cur?._hover ? null : cur), 4000);
      }
    };
    window.addEventListener('jetAnalyticsStation', analyticsStationHandler);
    const candidatoHandler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.candidato) setCandidatoPopup({ candidato: d.candidato, index: d.index });
    };
    window.addEventListener('jetCandidatoClick', candidatoHandler);
    const flyHandler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.lat && leafletRef.current) leafletRef.current.setView([d.lat, d.lng], d.zoom||17);
    };
    window.addEventListener('jetFlyTo', flyHandler);
    const jetMapFocusHandler = (e: Event) => {
      const { lat, lng } = (e as CustomEvent).detail;
      if (leafletRef.current) {
        leafletRef.current.setView([lat, lng], 17);
        setTarefasLogistica(false);
      }
    };
    window.addEventListener('jetMapFocus', jetMapFocusHandler);

    // Reposicionar pin de estação existente
    const reposHandler = (e: Event) => {
      const { lat, lng, codigo } = (e as CustomEvent).detail;
      const map = leafletRef.current;
      if (!map) return;
      showToast('Clique no mapa para reposicionar o pin — ' + codigo, 'info');
      if ((window as any).__reposHandler) map.off('click', (window as any).__reposHandler);
      (window as any).__reposHandler = async (ev: any) => {
        map.off('click', (window as any).__reposHandler);
        (window as any).__reposHandler = null;
        try {
          const { error } = await supabase.from('estacoes').update({ lat: ev.latlng.lat, lng: ev.latlng.lng }).or(`codigo.eq.${codigo},firebase_id.eq.${codigo}`);
          if (error) throw error;
          setEstacoes((prev: any[]) => prev.map((s: any) =>
            s.codigo === codigo ? { ...s, lat: ev.latlng.lat, lng: ev.latlng.lng } : s
          ));
          showToast('Pin reposicionado!', 'success');
        } catch { showToast('Erro ao reposicionar', 'error'); }
      };
      map.on('click', (window as any).__reposHandler);
    };
    window.addEventListener('jetReposicionarPin', reposHandler);
    window.addEventListener('jetOpenSV', handler);
    const fotoHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        setFotoCapturaCtx({ context: 'existente', lat: detail.lat, lng: detail.lng, estacaoId: detail.id, estacaoCodigo: detail.codigo });
      }
    };
    window.addEventListener('jetFoto', fotoHandler);
    return () => {
      window.removeEventListener('jetAnalyticsStation', analyticsStationHandler);
      if (analyticsHoverRef.current) clearTimeout(analyticsHoverRef.current);
      window.removeEventListener('jetCandidatoClick', candidatoHandler);
      window.removeEventListener('jetFlyTo', flyHandler);
      window.removeEventListener('jetMapFocus', jetMapFocusHandler);
      window.removeEventListener('jetReposicionarPin', reposHandler);
      window.removeEventListener('jetOpenSV', handler);
      window.removeEventListener('jetFoto', fotoHandler);
    };
  }, []);

  // ── RENDERIZA CANDIDATOS NO MAPA ────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    candidatosMarkersRef.current.forEach((m: any) => m.remove());
    candidatosMarkersRef.current = [];
    if (!candidatosLayer.length) return;
    candidatosLayer.forEach((c, i) => {
      const color = c.score >= 70 ? '#2ecc71' : c.score >= 40 ? '#f5c842' : '#ff6b35';
      const icon = L.divIcon({
        html: '<div style="width:28px;height:28px;border-radius:50%;background:' + color + '22;border:2px solid ' + color + ';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:' + color + ';font-family:monospace">' + c.score + '</div>',
        className: '', iconSize: [28, 28] as [number,number], iconAnchor: [14, 14] as [number,number],
      });
      const capturedC = c;
      const capturedI = i;
      const m = L.marker([c.lat, c.lng], { icon, zIndexOffset: 500 });
      m.on('click', () => {
        setCandidatoPopup({ candidato: capturedC, index: capturedI });
      });
      m.addTo(map);
      candidatosMarkersRef.current.push(m);
    });
  }, [candidatosLayer]);

  // ── RENDERIZA CIDADES EXPANSÃO NO MAPA ─────────────────────────
  const cidadesExpMarkersRef = useRef<any[]>([]);
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    cidadesExpMarkersRef.current.forEach((m:any) => m.remove());
    cidadesExpMarkersRef.current = [];
    if (!cidadesExpShow) return;
    cidadesExp.forEach(c => {
      const m = STATUS_META[c.status];
      const html = '<div style="background:' + m.cor + ';border:3px solid #fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.7)">' + m.icon + '</div>';
      const icon = L.divIcon({ className:'', html, iconSize:[26,26], iconAnchor:[13,13] });
      const marker = L.marker([c.lat, c.lng], { icon }).addTo(map);
      const lbl = m.label[(i18n.language||'pt').slice(0,2) as 'pt'|'en'|'es'|'ru'] ?? m.label.pt;
      marker.bindTooltip('<b>' + c.nome + '</b><br/>' + m.icon + ' ' + lbl + (c.dataPrevista ? '<br/>📅 ' + c.dataPrevista : '') + (c.responsavel ? '<br/>👤 ' + c.responsavel : ''), { permanent: false });
      marker.on('click', () => setCidadeExpModal({ editando: c }));
      cidadesExpMarkersRef.current.push(marker);
    });
  }, [cidadesExpShow, cidadesExp]);

  // ── RENDERIZA LOCAIS OPERACIONAIS NO MAPA ──────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    locaisMarkersRef.current.forEach((m: any) => m.remove());
    locaisMarkersRef.current = [];
    if (!showLocaisOp) return;
    locaisOp
      .filter(l => l.ativo && tiposFiltroLocais.has(l.tipo))
      .forEach(local => {
        const meta = TIPO_LOCAL_META[local.tipo];
        const icon = L.divIcon({
          html: '<div style="width:32px;height:32px;border-radius:8px;background:' + meta.bgColor + ';border:2px solid ' + meta.color + ';display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.6)">' + meta.icon + '</div>',
          className: '', iconSize: [32,32] as [number,number], iconAnchor: [16,16] as [number,number],
        });
        const m = L.marker([local.lat, local.lng], { icon, zIndexOffset: 600 });
        m.on('click', () => setLocalOpModal({ latLng: { lat: local.lat, lng: local.lng }, editando: local }));
        m.addTo(map);
        locaisMarkersRef.current.push(m);
      });
  }, [showLocaisOp, locaisOp, tiposFiltroLocais]);

  // ── RENDERIZA POIs NO MAPA ─────────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    poiMarkersRef.current.forEach((m: any) => m.remove());
    poiMarkersRef.current = [];
    if (!showPOILayer || !poiLayerData.length) return;
    // null = todos visíveis; Set com items = filtrar; Set vazio = nenhum visível
    const osmFiltrados = poiTiposAtivos === null
      ? poiLayerData
      : poiTiposAtivos.size > 0
        ? poiLayerData.filter((p: any) => poiTiposAtivos.has(p.tipo))
        : [];

    osmFiltrados.forEach((poi: any) => {
        const meta = (POI_META as any)[poi.tipo] || { icon: '📍', label: poi.tipo, color: '#64748b' };
        const divIcon = L.divIcon({
          html: '<div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">' + meta.icon + '</div>',
          className: '',
          iconSize: [24, 24] as [number, number],
          iconAnchor: [12, 12] as [number, number],
        });
        const m = L.marker([poi.lat, poi.lng], { icon: divIcon });
        m.on('click', () => {
          setPinLatLng({ lat: poi.lat, lng: poi.lng });
          setDrawerAberto(true);
          showToast('📍 ' + (poi.nome || poi.tipo || 'POI'), 'info');
        });
        m.addTo(map);
        poiMarkersRef.current.push(m);
      });
  }, [showPOILayer, poiLayerData, poiTiposAtivos]);


    const salvarEstacao = useCallback(async (dados: Record<string, unknown>) => {
      try {
        if (dados.codigo) {
          // ── MODO EDIÇÃO ──
          const { id, tipo, status, larguraFaixa, observacoes, privado, nomeConcorrente, lat, lng, cidade, bairro, endereco,
            consultor, fotoUrl } = dados as any;

          const patch: Record<string, any> = {
            tipo, status, lat, lng, cidade, bairro, endereco,
            consultor: consultor || null,
            ...(larguraFaixa != null ? { larguraFaixa } : {}),
            ...(observacoes        ? { observacoes }        : {}),
            ...(privado            ? { privado }            : {}),
            ...(nomeConcorrente    ? { nomeConcorrente }    : {}),
            ...(fotoUrl ? { imagens: { foto: fotoUrl } } : {}),
            ultimoEditor: usuario.uid,
            ultimoEditorNome: (usuario as any).nome || usuario.email,
            atualizadoEm: new Date().toISOString()
          };

          const { error } = await supabase.from('estacoes').update(patch).or(`id.eq.${id},firebase_id.eq.${id},codigo.eq.${dados.codigo}`);
          if (error) throw error;

          setEstacoes(prev => prev.map(e => e.codigo === dados.codigo ? { ...e, ...patch, imagens: { ...e.imagens, foto: fotoUrl || e.imagens?.foto } } : e));
          showToast('Estação atualizada!', 'success');
        } else {
          // ── NOVA ESTAÇÃO ──
          const cidadeAbrev = ((dados.cidade as string) || 'SP').toUpperCase().slice(0, 2);
          const ts = Date.now().toString().slice(-6);
          const codigoGerado = `${cidadeAbrev}-${ts}`;
          const cidadeNorm = ((dados.cidade as string) || '').trim();

          const dadosParaSalvar = { ...dados };
          delete dadosParaSalvar.id;

          const novaEstacao = {
            ...dadosParaSalvar,
            cidade:        cidadeNorm,
            codigo:        codigoGerado,
            status:        (dados.status as string)  || 'NEGOCIACAO',
            tipo:          (dados.tipo as string)    || 'PUBLICA',
            criadoEm:      new Date().toISOString(),
            criadoPor:     usuario.uid,
            criadoPorNome: (usuario as any).nome || usuario.email,
            imagens: dados.fotoUrl ? { foto: dados.fotoUrl } : {}
          };

          const { data, error } = await supabase.from('estacoes').insert(novaEstacao).select('id').single();
          if (error) throw error;

          setEstacoes((prev: any[]) => [...prev, { id: data.id, ...novaEstacao }]);
          showToast('Estação adicionada!', 'success');
        }

        setDrawerAberto(false); setPinLatLng(null); setEstacaoEdit(null);
      } catch(e: unknown) {
        showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
      }
    }, [usuario, showToast]);                                                                                                    


  // Edita zona existente
  const editarZona = async (id: string, dados: Record<string,unknown>) => {
    try {
      const { error } = await supabase.from('poligonos').update({
        ...dados,
        atualizadoEm: new Date().toISOString()
      }).or(`id.eq.${id},firebase_id.eq.${id}`);
      if (error) throw error;
      setZonaEditando(null);
      setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 150);
    } catch(e: unknown) {
      showToastGlobal('Erro ao editar zona: ' + (e instanceof Error ? e.message : String(e)), 'erro');
    }
  };

  // Exclui zona
  const excluirZona = async (id: string) => {
    try {
      const { error } = await supabase.from('poligonos').delete().or(`id.eq.${id},firebase_id.eq.${id}`);
      if (error) throw error;
      setZonaEditando(null);
      if (poligonosOn) { setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 100); }
    } catch(e: unknown) {
      showToastGlobal('Erro ao excluir zona: ' + (e instanceof Error ? e.message : String(e)), 'erro');
    }
  };

  // Salva zona no Firestore
  const salvarZona = async (zona: Record<string,unknown>) => {
    try {
      const id = 'ZONA-' + Date.now();
      const { error } = await supabase.from('poligonos').insert({
        ...zona,
        id,
        criadoEm:     new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
      });
      if (error) throw error;
      setZonaForm(null);
      // Limpa layer temporário
      if (zonaTempLayer.current) zonaTempLayer.current.clearLayers();
      zonaPointsRef.current = [];
      if (zonaDrawRef.current) { zonaDrawRef.current.remove(); zonaDrawRef.current = null; }
      // Recarrega polígonos se estiver ativo
      if (poligonosOn) {
        setPoligonosOn(false);
        setTimeout(() => setPoligonosOn(true), 100);
      }
    } catch(e: unknown) {
      showToastGlobal('Erro ao salvar zona: ' + (e instanceof Error ? e.message : String(e)), 'erro');
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', fontFamily: 'Inter,sans-serif' }}>
      {/* MAPA */}
      <div ref={mapRef} id="leaflet-map" style={{ width: '100%', height: '100%' }} />

      {/* Header — 2 linhas fixas */}
      <div ref={headerRef} style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'visible',
      }}>
      {/* Linha 1: identidade + cidade + ações principais */}
      <div style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
        overflowX: 'auto', scrollbarWidth: 'none' as const, flexWrap: 'nowrap' as const }}>
        <span style={{ color: '#307FE2', fontWeight: 900, fontSize: 16, letterSpacing: -0.5 }}>JET OS</span>
        <button onClick={() => isViewer ? null : openPanel(setCidadeModal)} style={{
          flex: 1, padding: '6px 12px', background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
          color: cidade ? '#fff' : 'rgba(255,255,255,.4)', fontSize: 13,
          cursor: isViewer ? 'default' : 'pointer', textAlign: 'left'
        }}>
          {cidades.length > 0 ? `📍 ${cidades.join(' + ')}` : t('nav.selectCity')}
        </button>
        {contagem > 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', whiteSpace: 'nowrap' }}>
            {contagem} est.
          </span>
        )}
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', display: 'none' } as React.CSSProperties}>{usuario.nome.split(' ')[0]}</span>
        {/* Hamburger button — visible only on mobile via CSS */}
        <button
          className="jet-mobile-menu-btn"
          onClick={() => setMobileMenuOpen(v => !v)}
          style={{ display: 'none', alignItems: 'center', justifyContent: 'center',
            background: mobileMenuOpen ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${mobileMenuOpen ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: mobileMenuOpen ? '#60a5fa' : 'rgba(255,255,255,.5)',
            padding: '4px 10px', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}
          aria-label="Menu"
        >☰</button>
        {/* Desktop-only header buttons — hidden on mobile */}
        <div className="jet-header-desktop" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' as const }}>
        {isGestorApp && (
                  <button onClick={() => usuariosModulo ? setUsuariosModulo(false) : openPanel(setUsuariosModulo)} style={{
                    background: usuariosModulo ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
                    border: `1px solid ${usuariosModulo ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
                    borderRadius: 8, color: usuariosModulo ? '#60a5fa' : 'rgba(255,255,255,.5)',
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer'
                  }} aria-label="Usuários">👥</button>
                )}
                {usuario.role === 'admin' && (
                  <button onClick={() => painelConfig ? setPainelConfig(false) : openPanel(setPainelConfig)} style={{
                    background: painelConfig ? 'rgba(99,102,241,.15)' : 'rgba(255,255,255,.06)',
                    border: `1px solid ${painelConfig ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.1)'}`,
                    borderRadius: 8, color: painelConfig ? '#818cf8' : 'rgba(255,255,255,.5)',
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer'
                  }} aria-label="Configurações">⚙️</button>
                )}
                        <div style={{ flex: 1 }} />
        <button onClick={() => guiaModulo ? setGuiaModulo(false) : openPanel(setGuiaModulo)}
          style={{ background: guiaModulo?'rgba(99,102,241,.15)':'rgba(255,255,255,.06)',
            border:`1px solid ${guiaModulo?'rgba(99,102,241,.4)':'rgba(255,255,255,.1)'}`,
            borderRadius:8, color: guiaModulo?'#818cf8':'rgba(255,255,255,.5)',
            padding:'4px 11px', fontSize:11, cursor:'pointer', fontWeight:600,
            flexShrink:0 }}>
          {t('nav.guide')}
        </button>
        <LangSelector />
        {/* Sino de notificações */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <button onClick={() => showNotif ? setShowNotif(false) : openPanel(setShowNotif)}
            style={{ width:36, height:36, borderRadius:'50%', cursor:'pointer',
              background: showNotif?'rgba(251,191,36,.2)':'rgba(255,255,255,.06)',
              border:`1px solid ${showNotif?'rgba(251,191,36,.4)':'rgba(255,255,255,.08)'}`,
              color: showNotif?'#fbbf24':'rgba(255,255,255,.5)',
              fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}
            aria-label="Notificações">
            🔔
          </button>
          {notifList.filter((n:any) => !n.lida).length > 0 && (
            <div style={{ position:'absolute', top:-3, right:-3, width:14, height:14,
              background:'#ef4444', borderRadius:'50%', fontSize:8, fontWeight:700,
              color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
              pointerEvents:'none' }}>
              {Math.min(notifList.filter((n:any) => !n.lida).length, 9)}
            </div>
          )}
        </div>
        {usuario.tipoCadastro === 'prestador' && (
          <button onClick={() => openPanel(setShowPerfilPrestador)} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            color: 'rgba(255,255,255,.6)', borderRadius: 8, width: 34, height: 34,
            fontSize: 16, cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} aria-label="Perfil">👤</button>
        )}
        <button onClick={onLogout} aria-label="Sair" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}>⏻</button>
        </div>{/* end jet-header-desktop */}
      </div>
      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div style={{
          background: 'rgba(13,18,30,.98)', borderTop: '1px solid rgba(255,255,255,.06)',
          padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {isGestorApp && (
            <button onClick={() => { setMobileMenuOpen(false); usuariosModulo ? setUsuariosModulo(false) : openPanel(setUsuariosModulo); }} style={{
              background: usuariosModulo ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${usuariosModulo ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: usuariosModulo ? '#60a5fa' : 'rgba(255,255,255,.5)',
              padding: '8px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left'
            }}>👥 Usuários</button>
          )}
          {usuario.role === 'admin' && (
            <button onClick={() => { setMobileMenuOpen(false); painelConfig ? setPainelConfig(false) : openPanel(setPainelConfig); }} style={{
              background: painelConfig ? 'rgba(99,102,241,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${painelConfig ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: painelConfig ? '#818cf8' : 'rgba(255,255,255,.5)',
              padding: '8px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left'
            }}>⚙️ Configurações</button>
          )}
          <button onClick={() => { setMobileMenuOpen(false); guiaModulo ? setGuiaModulo(false) : openPanel(setGuiaModulo); }} style={{
            background: guiaModulo ? 'rgba(99,102,241,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${guiaModulo ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: guiaModulo ? '#818cf8' : 'rgba(255,255,255,.5)',
            padding: '8px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left', fontWeight: 600
          }}>📖 {t('nav.guide')}</button>
          <div style={{ padding: '4px 0' }}><LangSelector /></div>
          <button onClick={() => { setMobileMenuOpen(false); showNotif ? setShowNotif(false) : openPanel(setShowNotif); }} style={{
            background: showNotif ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${showNotif ? 'rgba(251,191,36,.4)' : 'rgba(255,255,255,.08)'}`,
            borderRadius: 8, color: showNotif ? '#fbbf24' : 'rgba(255,255,255,.5)',
            padding: '8px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left'
          }}>🔔 Notificações{notifList.filter((n:any) => !n.lida).length > 0 && ` (${Math.min(notifList.filter((n:any) => !n.lida).length, 9)})`}</button>
          {usuario.tipoCadastro === 'prestador' && (
            <button onClick={() => { setMobileMenuOpen(false); openPanel(setShowPerfilPrestador); }} style={{
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 8, color: 'rgba(255,255,255,.6)',
              padding: '8px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left'
            }}>👤 Perfil</button>
          )}
          <button onClick={() => { setMobileMenuOpen(false); onLogout(); }} style={{
            background: 'none', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 8, color: 'rgba(255,255,255,.3)',
            padding: '8px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left'
          }}>⏻ Sair</button>
        </div>
      )}
      {/* KPIs para gestor/admin */}
      {isGestorApp && (
        <div style={{ padding:'3px 12px', background:'rgba(0,0,0,.25)',
          borderTop:'1px solid rgba(255,255,255,.04)',
          display:'flex', gap:16, alignItems:'center', flexShrink:0, overflowX:'auto',
          scrollbarWidth:'none' as const }}>
          <div style={{ fontSize:10, color:'#7a8ba8', whiteSpace:'nowrap' as const }}>
            🏢 Ativas: <b style={{ color:'#4ade80' }}>
              {estacoes.filter((e:any)=>
                e.status==='INSTALADO' &&
                (cidades.length===0 || cidades.includes(e.cidade))
              ).length}
            </b>
          </div>
          <div style={{ fontSize:10, color:'#7a8ba8', whiteSpace:'nowrap' as const }}>
            🛡 Ocorrências: <b style={{ color: kpis.ocAbertas>0?'#fbbf24':'#4ade80' }}>{kpis.ocAbertas}</b>
          </div>
          {kpis.roubos > 0 && (
            <div style={{ fontSize:10, padding:'1px 8px', borderRadius:6,
              background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
              color:'#f87171', whiteSpace:'nowrap' as const, fontWeight:700 }}>
              🔴 Roubos: {kpis.roubos}
            </div>
          )}
          {kpis.procurando > 0 && (
            <div style={{ fontSize:10, padding:'1px 8px', borderRadius:6,
              background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.25)',
              color:'#f87171', whiteSpace:'nowrap' as const, fontWeight:700 }}>
              🔎 Procurando: {kpis.procurando}
            </div>
          )}
        </div>
      )}

      {/* Linha 2: ferramentas do mapa */}
      <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5,
        overflowX: 'auto', scrollbarWidth: 'none' as const, flexWrap: 'nowrap' as const,
        borderTop: '1px solid rgba(255,255,255,.04)' }}>
        {/* CandidatosManager — controlado pelo FAB */}
        <div>
          <CandidatosManager
            hideButton={true}
            topOffset={headerH}
            mapCenter={(() => { const m = leafletRef.current; return m ? { lat: m.getCenter().lat, lng: m.getCenter().lng } : { lat: -23.55, lng: -46.63 }; })()}
            estacoes={estacoes.map((e: any) => ({ id: e.id || e.codigo, lat: e.lat, lng: e.lng, codigo: e.codigo }))}
            ridesAnalytics={(window as any).__jetRides || []}
            drawerAberto={drawerAberto}
            onAbrirDrawer={(lat, lng) => { setPinLatLng({ lat, lng }); setDrawerAberto(true); }}
            onCandidatosChange={setCandidatosLayer}
            forceOpen={candidatosModulo}
          />
        </div>


        {isGestorApp && <>
          {isGestor && (
            <button onClick={() => analyticsModulo ? setAnalyticsModulo(false) : openPanel(setAnalyticsModulo)} style={{
              background: analyticsModulo ? 'rgba(61,155,255,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${analyticsModulo ? 'rgba(61,155,255,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: analyticsModulo ? '#3d9bff' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>📊 Analytics</button>
          )}

          <button onClick={() => dashboardModulo ? setDashboardModulo(false) : openPanel(setDashboardModulo)} style={{
            background: dashboardModulo ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${dashboardModulo ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: dashboardModulo ? '#60a5fa' : 'rgba(255,255,255,.5)',
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
          }}>📊 Dash</button>

          <button onClick={() => {
            setGuardModulo(v => {
              if (v) setOcorrenciasLayer([]); // limpa ao fechar
              return !v;
            });
          }} style={{
            background: guardModulo ? 'rgba(167,139,250,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${guardModulo ? 'rgba(167,139,250,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: guardModulo ? '#a78bfa' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>🛡 Guard{ocorrenciasLayer.length > 0 ? ` (${ocorrenciasLayer.length})` : ''}</button>
          {isGestorApp && (
            <button onClick={() => guardDash ? setGuardDash(false) : openPanel(setGuardDash)} style={{
              background: guardDash ? 'rgba(192,132,252,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${guardDash ? 'rgba(192,132,252,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: guardDash ? '#c084fc' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>📊 Guard Dash</button>
          )}

          <button onClick={() => painelRoubos ? setPainelRoubos(false) : openPanel(setPainelRoubos)} style={{
            background: painelRoubos ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${painelRoubos ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: painelRoubos ? '#ef4444' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>🔴 Roubos</button>
          <button onClick={() => painelPerdas ? setPainelPerdas(false) : openPanel(setPainelPerdas)} style={{
            background: painelPerdas ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${painelPerdas ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: painelPerdas ? '#ef4444' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>📊 Perdas</button>
        </>}

        {(isGestorLog || isPrestadorLogistica) && (
          <>
          {isGestorApp && (
            <button onClick={() => showWorkers ? setShowWorkers(false) : openPanel(setShowWorkers)} style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              background: showWorkers ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${showWorkers ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
              color: showWorkers ? '#10b981' : 'rgba(255,255,255,.5)',
              fontSize: 12, fontWeight: 600,
            }}>👥 Campo</button>
          )}
          {isLogisticaApp && (
            <button
              onClick={() => { if (tarefasLogistica) { setTarefasLogistica(false); } else { openPanel(setTarefasLogistica); } setParkingParaTarefa(null); }}
              style={{
                padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tarefasLogistica ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
                color: tarefasLogistica ? '#10b981' : 'rgba(255,255,255,.5)',
                fontSize: 12, fontWeight: 600,
              }}>
              📦 Tarefas
            </button>
          )}
          <button onClick={() => slotsModulo ? setSlotsModulo(false) : openPanel(setSlotsModulo)} style={{
            background: slotsModulo? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${slotsModulo? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: slotsModulo? '#10b981' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>📦 Slots</button>
          {isGestorLog && (
            <button onClick={() => gestorLogistica ? setGestorLogistica(false) : openPanel(setGestorLogistica)} style={{
              background: gestorLogistica ? 'rgba(26,111,212,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${gestorLogistica ? 'rgba(26,111,212,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: gestorLogistica ? '#307FE2' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>🚚 Gestor Log.</button>
          )}
          {/* Pagamentos — prestadores veem seus ganhos; gestores/admin veem painel de validação */}
          {isPrestadorLogistica && (
            <button onClick={() => openPanel(setPagamentosOpen)} style={{
              background: pagamentosOpen ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${pagamentosOpen ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: pagamentosOpen ? '#10b981' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>💰 Pagamentos</button>
          )}
          {isGestorLog && (
            <button onClick={() => openPanel(setPagamentosAdminOpen)} style={{
              background: pagamentosAdminOpen ? 'rgba(245,158,11,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${pagamentosAdminOpen ? 'rgba(245,158,11,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: pagamentosAdminOpen ? '#f59e0b' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>💳 NFs</button>
          )}
          </>
        )}
      </div>
      </div>

      {/* Barra de filtros */}
      <div style={{
        position: 'fixed', top: headerH, left: 0, right: 0, zIndex: 999,
        background: 'rgba(13,18,30,.92)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4,
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {/* Grupo: Tipo */}
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', textTransform: 'uppercase', letterSpacing: .8, whiteSpace: 'nowrap', paddingRight: 2 }}>Tipo</span>
        {[
          { k: 'PUBLICA',     label: 'Pub',  cor: '#3b82f6' },
          { k: 'PRIVADA',     label: 'Priv', cor: '#f59e0b' },
          ...(!isGuardSeg ? [{ k: 'CONCORRENTE', label: 'Conc', cor: '#ef4444' }] : [])
        ].map(f => (
          <button key={f.k} onClick={() => setFiltros(prev => {
            const n = new Set(prev);
            if (n.has(f.k)) n.delete(f.k); else n.add(f.k);
            try { localStorage.setItem('jet_filtros_tipo', JSON.stringify([...n])); } catch {}
            return n;
          })} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
            background: filtros.has(f.k) ? `${f.cor}33` : 'rgba(255,255,255,.06)',
            color: filtros.has(f.k) ? f.cor : 'rgba(255,255,255,.25)',
            outline: filtros.has(f.k) ? `1px solid ${f.cor}66` : '1px solid rgba(255,255,255,.08)'
          }}>{f.label}</button>
        ))}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)', margin: '0 4px', flexShrink: 0 }} />

        {/* Grupo: Status */}
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', textTransform: 'uppercase', letterSpacing: .8, whiteSpace: 'nowrap', paddingRight: 2 }}>Status</span>
        {/* Seleção múltipla de status — todos por padrão */}
        {([
          { k: 'ATIVO',      label: 'Ativo',                 cor: '#10b981' },
          { k: 'PLANEJADO',  label: 'Planejado',             cor: '#8b5cf6' },
          { k: 'NEGOCIACAO', label: t('filters.negotiation'), cor: '#fbbf24' },
          { k: 'SOLICITADO', label: t('filters.requested'), cor: '#93c5fd' },
          { k: 'APROVADO',   label: t('filters.approved'),   cor: '#3b82f6' },
          { k: 'INSTALADO',  label: t('filters.installed'),  cor: '#1d4ed8' },
          { k: 'REPROVADO',  label: t('filters.rejected'),  cor: '#7f1d1d' },
          { k: 'CANCELADO',  label: t('filters.cancelled'),  cor: '#475569' },
        ] as {k:string;label:string;cor:string}[]).filter(s => !isGuardSeg || s.k === 'INSTALADO').map(s => {
          const ativo = filtrosStatus.has(s.k);
          return (
            <button key={s.k} onClick={() => setFiltrosStatus(prev => {
              const n = new Set(prev);
              if (n.has(s.k)) { n.delete(s.k); } else { n.add(s.k); }
              try { localStorage.setItem('jet_filtros_status', JSON.stringify([...n])); } catch {}
              return n;
            })} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
              background: ativo ? s.cor + '25' : 'rgba(255,255,255,.04)',
              color: ativo ? s.cor : 'rgba(255,255,255,.3)',
              outline: ativo ? `1px solid ${s.cor}55` : '1px solid rgba(255,255,255,.07)',
            }}>{s.label}</button>
          );
        })}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)', margin: '0 4px', flexShrink: 0 }} />
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)', margin: '0 4px', flexShrink: 0 }} />
        





        {/* Contador */}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,.3)',
          display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {contagem} est.
        </div>
      </div>

      {/* ── FABs de camadas — ocultos para viewer ───────────── */}
      {!isViewer && <div className="jet-fab-group" style={{
        position: 'fixed', right: 16, bottom: 100, zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        {/* ═══ 1. FERRAMENTAS (🛠) — Locais + POIs + SV tools ═══ */}
        {isGestor && showToolsFab && (
          <>
            {/* Locais sub-group */}
            <button onClick={() => setModoAddLocal(m => !m)}
              title={modoAddLocal ? t('fab.cancelAction') : t('fab.addLocalMap')} aria-label={modoAddLocal ? t('fab.cancelAction') : t('fab.addLocalMap')}
              style={{ width:40, height:40, borderRadius:10, border:'none', cursor:'pointer',
                background: modoAddLocal?'rgba(239,68,68,.9)':'rgba(52,211,153,.9)',
                color:'#fff', fontSize:18, display:'flex', alignItems:'center',
                justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)', transition:'all .15s' }}>
              {modoAddLocal ? '✕' : '📍'}
            </button>
            <button onClick={() => financeiro ? setFinanceiro(false) : openPanel(setFinanceiro)} title={t('fab.financial')} aria-label={t('fab.financial')}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${financeiro?'rgba(74,222,128,.5)':'rgba(255,255,255,.2)'}`,
                background: financeiro?'rgba(74,222,128,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: financeiro?'#4ade80':'rgba(255,255,255,.6)',
                fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>💳</button>
            <button onClick={() => {
                setShowLocaisOp(v => !v);
                if (showLocaisOp) { setFinanceiro(false); setModoAddLocal(false); }
              }} title={t('fab.locais')} aria-label={t('fab.locais')}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${showLocaisOp?'rgba(52,211,153,.5)':'rgba(255,255,255,.2)'}`,
                background: showLocaisOp?'rgba(52,211,153,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: showLocaisOp?'#34d399':'rgba(255,255,255,.5)',
                fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🏭</button>
            {/* POIs */}
            <button title={t('fab.candidates')} aria-label={t('fab.candidates')}
              onClick={() => candidatosModulo ? setCandidatosModulo(false) : openPanel(setCandidatosModulo)}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${candidatosModulo?'rgba(251,191,36,.4)':'rgba(255,255,255,.2)'}`,
                background: candidatosModulo ? 'rgba(251,191,36,.2)' : 'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: candidatosModulo ? '#fbbf24' : 'rgba(255,255,255,.5)',
                fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🎯</button>
            <button title={t('fab.poisOsm')} aria-label={t('fab.poisOsm')}
              onClick={async () => {
                if (showPOILayer) {
                  setShowPOILayer(false); setPoiLayerData([]); setPoiTiposAtivos(null); setShowPoiFilterPanel(false);
                  if (osmMoveHandlerRef.current) { leafletRef.current?.off('moveend', osmMoveHandlerRef.current); osmMoveHandlerRef.current = null; }
                  return;
                }
                setShowPOILayer(true);
                const map = leafletRef.current; if (!map) return;
                let osmDebounceTimer: ReturnType<typeof setTimeout> | null = null;
                const buscarOSM = () => {
                  if (osmDebounceTimer) clearTimeout(osmDebounceTimer);
                  osmDebounceTimer = setTimeout(async () => {
                    setPoiLoading(true);
                    try { setPoiLayerData([]); } catch(e:any) { showToast('Erro POIs: ' + e.message, 'error'); }
                    finally { setPoiLoading(false); }
                  }, 1500);
                };
                if (osmMoveHandlerRef.current) map.off('moveend', osmMoveHandlerRef.current);
                osmMoveHandlerRef.current = buscarOSM; map.on('moveend', buscarOSM); buscarOSM();
              }}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${showPOILayer?'rgba(16,185,129,.4)':'rgba(255,255,255,.2)'}`,
                background: showPOILayer ? 'rgba(16,185,129,.2)' : 'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: showPOILayer ? '#10b981' : 'rgba(255,255,255,.5)',
                fontSize:15, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>📍</button>
            {/* SV tools */}
            <button onClick={() => { (window as any)._svMedirCombo?.(); setShowToolsFab(false); }}
              title={t('fab.svCombo')} aria-label={t('fab.svCombo')}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:'2px solid rgba(59,130,246,.4)', background:'rgba(59,130,246,.15)',
                backdropFilter:'blur(8px)', color:'#60a5fa',
                fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>⚡</button>
            <button onClick={() => { (window as any)._svBatch?.(); setShowToolsFab(false); }}
              title={t('fab.svBatch')} aria-label={t('fab.svBatch')} disabled={svBatchRunning}
              style={{ width:40, height:40, borderRadius:10, cursor: svBatchRunning ? 'wait' : 'pointer',
                border:`2px solid ${svBatchRunning?'rgba(0,91,255,.5)':'rgba(255,255,255,.2)'}`,
                background: svBatchRunning ? 'rgba(0,91,255,.2)' : 'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', opacity: svBatchRunning ? 0.7 : 1,
                color: svBatchRunning ? '#60a5fa' : 'rgba(255,255,255,.5)',
                fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>{svBatchRunning ? '⏳' : '🌐'}</button>
            <button onClick={() => { (window as any)._medirBatch?.(); setShowToolsFab(false); }}
              title={t('fab.medirBatch')} aria-label={t('fab.medirBatch')}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:'2px solid rgba(255,255,255,.2)', background:'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color:'rgba(255,255,255,.5)',
                fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>📐</button>
          </>
        )}
        {isGestor && <button onClick={() => { setShowToolsFab(v => !v); if (showToolsFab) { setModoAddLocal(false); } }}
          title={t('fab.tools')} aria-label={t('fab.tools')}
          style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
            border:`2px solid ${showToolsFab?'rgba(59,130,246,.5)':'rgba(255,255,255,.15)'}`,
            background: showToolsFab ? 'rgba(59,130,246,.2)' : 'rgba(13,18,30,.85)',
            backdropFilter:'blur(8px)',
            color: showToolsFab ? '#60a5fa' : 'rgba(255,255,255,.5)',
            fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
          {showToolsFab ? '✕' : '🛠'}
        </button>}

        {/* ═══ 2. CAMADAS (🗺) — Satélite, Ciclovias, Zonas, Raio ═══ */}
        {showCamadasFab && (
          <>
            <button onClick={() => {
              const map = leafletRef.current; if (!map) return;
              if ((map as any)._satLayer) { map.removeLayer((map as any)._satLayer); (map as any)._satLayer = null; setSatOn(false); }
              else { const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{ attribution:'© Esri', maxZoom:19 }); sat.addTo(map); (map as any)._satLayer = sat; setSatOn(true); }
            }} title={t('fab.satelite')} aria-label={t('fab.satelite')} style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
              border:`2px solid ${satOn?'#fbbf24':'rgba(255,255,255,.2)'}`,
              background: satOn ? 'rgba(251,191,36,.2)' : 'rgba(13,18,30,.85)', backdropFilter:'blur(8px)',
              color: satOn ? '#fbbf24' : 'rgba(255,255,255,.5)', fontSize:16,
              display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🛰</button>
            {cidade && <button onClick={() => setCicloviasOn(v => !v)} title={t('fab.cycleways')} aria-label={t('fab.cycleways')}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${cicloviasOn?'#00e676':'rgba(255,255,255,.2)'}`,
                background: cicloviasOn ? 'rgba(0,230,118,.2)' : 'rgba(13,18,30,.85)', backdropFilter:'blur(8px)',
                color: cicloviasOn ? '#00e676' : 'rgba(255,255,255,.5)', fontSize:16,
                display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🚲</button>}
            {cidade && (isGestorApp || isCampo || isLogisticaApp) && (
              <button onClick={() => setPoligonosOn(v => !v)} title={t('fab.zones')} aria-label={t('fab.zones')}
                style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                  border:`2px solid ${poligonosOn?'#60a5fa':'rgba(255,255,255,.2)'}`,
                  background: poligonosOn ? 'rgba(96,165,250,.2)' : 'rgba(13,18,30,.85)', backdropFilter:'blur(8px)',
                  color: poligonosOn ? '#60a5fa' : 'rgba(255,255,255,.5)', fontSize:16,
                  display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>⬡</button>
            )}
            {isGestor && poligonosOn && (
              <>
                <button onClick={() => zonasModulo ? setZonasModulo(false) : openPanel(setZonasModulo)} title={t('fab.manageZones')} aria-label={t('fab.manageZones')}
                  style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                    border:`2px solid ${zonasModulo?'#c084fc':'rgba(255,255,255,.2)'}`,
                    background: zonasModulo?'rgba(192,132,252,.2)':'rgba(13,18,30,.85)',
                    backdropFilter:'blur(8px)', color: zonasModulo?'#c084fc':'rgba(255,255,255,.5)', fontSize:16,
                    display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>⬡</button>
                <button onClick={() => setZonaEditor(v => !v)} title={t('fab.drawZone')} aria-label={t('fab.drawZone')}
                  style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                    border:`2px solid ${zonaEditor?'#c084fc':'rgba(255,255,255,.2)'}`,
                    background: zonaEditor?'rgba(192,132,252,.25)':'rgba(13,18,30,.85)',
                    backdropFilter:'blur(8px)', color: zonaEditor?'#c084fc':'rgba(255,255,255,.5)', fontSize:16,
                    display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>✏</button>
              </>
            )}
            <button onClick={() => setRaioAtivo(v => !v)} title={t('fab.radius').replace('{n}', String(raioMetros))} aria-label={t('fab.radius').replace('{n}', String(raioMetros))}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${raioAtivo?'#a78bfa':'rgba(255,255,255,.2)'}`,
                background: raioAtivo ? 'rgba(167,139,250,.2)' : 'rgba(13,18,30,.85)', backdropFilter:'blur(8px)',
                color: raioAtivo ? '#a78bfa' : 'rgba(255,255,255,.5)', fontSize:13, fontWeight:700,
                display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>{raioMetros}m</button>
            {raioAtivo && (
              <input type="range" min="50" max="500" step="25" value={raioMetros}
                onChange={e => setRaioMetros(Number(e.target.value))}
                style={{ width:40, accentColor:'#a78bfa', cursor:'pointer', writingMode:'vertical-lr' as any, direction:'rtl' as any, height:80 }}/>
            )}
          </>
        )}
        <button onClick={() => setShowCamadasFab(v => !v)}
          title={t('fab.camadas')} aria-label={t('fab.camadas')}
          style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
            border:`2px solid ${showCamadasFab||satOn||cicloviasOn||poligonosOn?'rgba(251,191,36,.5)':'rgba(255,255,255,.15)'}`,
            background: showCamadasFab||satOn||cicloviasOn||poligonosOn ? 'rgba(251,191,36,.2)' : 'rgba(13,18,30,.85)',
            backdropFilter:'blur(8px)',
            color: showCamadasFab||satOn||cicloviasOn||poligonosOn ? '#fbbf24' : 'rgba(255,255,255,.5)',
            fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
          {showCamadasFab ? '✕' : '🗺'}
        </button>

        {/* ═══ 3. GOJET (🛴) — já agrupado ═══ */}
        {(isGestorApp || isCampo || isLogisticaApp) && showGoJetLayer && isGestor && (
          <>
            <button title={t('fab.gojetAnalytics')} aria-label={t('fab.gojetAnalytics')} onClick={() => gojetAnalytics ? setGojetAnalytics(false) : openPanel(setGojetAnalytics)}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${gojetAnalytics?'rgba(167,139,250,.5)':'rgba(255,255,255,.2)'}`,
                background: gojetAnalytics?'rgba(167,139,250,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: gojetAnalytics?'#a78bfa':'rgba(255,255,255,.5)',
                fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>📈</button>
            <button title={t('fab.gojetDash')} aria-label={t('fab.gojetDash')} onClick={() => gojetDash ? setGojetDash(false) : openPanel(setGojetDash)}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${gojetDash?'rgba(59,130,246,.5)':'rgba(255,255,255,.2)'}`,
                background: gojetDash?'rgba(59,130,246,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: gojetDash?'#60a5fa':'rgba(255,255,255,.5)',
                fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>📊</button>
            <button title={t('fab.shifts')} aria-label={t('fab.shifts')} onClick={() => shiftPanel ? setShiftPanel(false) : openPanel(setShiftPanel)}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${shiftPanel?'rgba(34,197,94,.5)':'rgba(255,255,255,.2)'}`,
                background: shiftPanel?'rgba(34,197,94,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: shiftPanel?'#22c55e':'rgba(255,255,255,.5)',
                fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>⏱</button>
          </>
        )}
        {(isGestorApp || isCampo || isLogisticaApp) && (
          <button title={t('fab.gojet')} aria-label={t('fab.gojet')} onClick={() => setShowGoJetLayer(v => !v)}
            style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
              border:`2px solid ${showGoJetLayer?'rgba(16,185,129,.5)':'rgba(255,255,255,.15)'}`,
              background: showGoJetLayer?'rgba(16,185,129,.2)':'rgba(13,18,30,.85)',
              backdropFilter:'blur(8px)', color: showGoJetLayer?'#10b981':'rgba(255,255,255,.5)',
              fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🛴</button>
        )}

        {/* ═══ 4. TURNO (⏱) — standalone ═══ */}
        {(usuario?.role === 'campo' || usuario?.role === 'logistica' || usuario?.role === 'motorista' || isGestorApp) && (
          <button title={t('fab.turno')} aria-label={t('fab.turno')} onClick={() => turnoRegistro ? setTurnoRegistro(false) : openPanel(setTurnoRegistro)}
            style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
              border:`2px solid ${turnoRegistro ? 'rgba(34,197,94,.5)' : 'rgba(255,255,255,.15)'}`,
              background: turnoRegistro ? 'rgba(34,197,94,.2)' : 'rgba(13,18,30,.85)',
              backdropFilter:'blur(8px)', color: turnoRegistro ? '#22c55e' : 'rgba(255,255,255,.5)',
              fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>⏱</button>
        )}

        {/* ═══ Expansão cidade (contextual) ═══ */}
        {isGestor && cidadesExpShow && (
          <button onClick={() => setCidadeExpModal({ latLng: leafletRef.current ? (() => { const c = leafletRef.current!.getCenter(); return {lat:c.lat,lng:c.lng}; })() : {lat:0,lng:0} })}
            title={t('fab.addExpCity')} aria-label={t('fab.addExpCity')}
            style={{ width:40, height:40, borderRadius:10, border:'2px solid rgba(99,102,241,.4)',
              cursor:'pointer', background:'rgba(99,102,241,.15)', backdropFilter:'blur(8px)',
              color:'#818cf8', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🌍</button>
        )}
        {/* Guard FAB — gestor_seg tem destaque maior */}
        {(isGestorApp || isCampo || isLogisticaApp) && (
          <button onClick={() => novaOcorrencia ? setNovaOcorrencia(false) : openPanel(setNovaOcorrencia)}
            title={t('fab.guard')} aria-label={t('fab.guard')}
            style={{
              width:  usuario.role === 'gestor_seg' ? 52 : 40,
              height: usuario.role === 'gestor_seg' ? 52 : 40,
              borderRadius:'50%', cursor:'pointer',
              border: novaOcorrencia
                ? '2px solid rgba(167,139,250,.8)'
                : usuario.role === 'gestor_seg'
                  ? '2px solid rgba(167,139,250,.6)'
                  : '1px solid rgba(167,139,250,.4)',
              background: novaOcorrencia
                ? 'rgba(167,139,250,.3)'
                : usuario.role === 'gestor_seg'
                  ? 'linear-gradient(135deg,rgba(124,58,237,.7),rgba(167,139,250,.4))'
                  : 'rgba(13,18,30,.85)',
              backdropFilter:'blur(8px)',
              color:'#a78bfa',
              fontSize: usuario.role === 'gestor_seg' ? 22 : 18,
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow: usuario.role === 'gestor_seg'
                ? '0 4px 20px rgba(124,58,237,.5)'
                : '0 2px 8px rgba(0,0,0,.4)',
              transition:'all .15s',
            }}>
            🛡
          </button>
        )}
        {/* Minha localização */}
        <button onClick={() => {
          const map = leafletRef.current; if (!map) return;
          navigator.geolocation.getCurrentPosition(async p => {
            const lat = p.coords.latitude, lng = p.coords.longitude;
            map.setView([lat, lng], 16);
            (map as any)._userLocMarker?.remove();
            const html = '<div style="position:relative;width:20px;height:20px">'
              + '<div style="position:absolute;inset:0;border-radius:50%;background:#3b82f6;opacity:.35;animation:pulse 1.5s infinite"></div>'
              + '<div style="position:absolute;inset:4px;border-radius:50%;background:#3b82f6;border:2.5px solid #fff;box-shadow:0 0 8px #3b82f6"></div>'
              + '</div><style>@keyframes pulse{0%,100%{transform:scale(1);opacity:.35}50%{transform:scale(1.8);opacity:.1}}</style>';
            // Detectar cidade mais próxima e selecionar automaticamente
            const cidadeProxima = cidadesReais.find(c => {
              const dlat = c.lat - lat, dlng = c.lng - lng;
              return Math.sqrt(dlat*dlat + dlng*dlng) * 111 < 10;
            });
            if (cidadeProxima && !cidades.includes(cidadeProxima.cidade)) {
              toggleCidade(cidadeProxima.cidade);
              showToast(t('map.cityDetected') + ': ' + cidadeProxima.cidade, 'success');
            }
            const popupHtml = '<b style="color:#3b82f6">&#128205; ' + t('map.youAreHere') + '</b>'
              + '<br><span style="font-size:11px;color:#888">' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '</span>'
              + '<br><button onclick="window.dispatchEvent(new CustomEvent(\'jetAddNaLocalizacao\',{detail:{lat:' + lat + ',lng:' + lng + '}}))" '
              + 'style="margin-top:6px;width:100%;padding:5px 8px;background:#1a6fd4;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">'
              + t('popup.addStationHere') + '</button>';
            const mk = L.marker([lat,lng],{icon:L.divIcon({className:'',html,iconSize:[20,20],iconAnchor:[10,10]}),zIndexOffset:500}).addTo(map);
            mk.bindPopup(popupHtml).openPopup();
            (map as any)._userLocMarker = mk;
            // Salvar coords para o botão flutuante React
            // Disparar evento global para abrir drawer fora do contexto do Leaflet
            window.dispatchEvent(new CustomEvent('jetAddNaLocalizacao', { detail: { lat, lng } }));
          }, () => showToast(t('map.locationUnavailable'),'error'));
        }} title={t('fab.myLocation')} aria-label={t('fab.myLocation')}
          style={{ width:40, height:40, borderRadius:'50%', cursor:'pointer',
            border:'1px solid rgba(59,130,246,.4)',
            background:'rgba(13,18,30,.85)', backdropFilter:'blur(8px)',
            color:'#60a5fa', fontSize:16,
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06z"/>
          </svg>
        </button>
      </div>}



      {/* Botão Dark/Light — centro inferior */}
      <button onClick={() => setMapMode(m => m === 'dark' ? 'light' : 'dark')}
        style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
          zIndex:1000, display:'flex', alignItems:'center', gap:6,
          padding:'7px 16px', borderRadius:20,
          background: mapMode==='dark' ? 'rgba(13,18,30,.9)' : 'rgba(255,255,255,.9)',
          border: mapMode==='dark' ? '1px solid rgba(255,255,255,.15)' : '1px solid rgba(0,0,0,.15)',
          color: mapMode==='dark' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.7)',
          cursor:'pointer', fontSize:12, fontWeight:600,
          backdropFilter:'blur(8px)', boxShadow:'0 2px 10px rgba(0,0,0,.3)' }}>
        {mapMode==='dark' ? t('nav.lightMode') : t('nav.darkMode')}
      </button>

      {/* FAB adicionar — só gestor/campo, não gestor_seg */}
      {isGestor && <button onClick={() => { setModoAdd(m => !m); if (!modoAdd) showToast(t('map.tapToPosition'), 'info'); }}
        title={t('fab.addStation')} aria-label={t('fab.addStation')}
        style={{ position: 'fixed', right: 16, bottom: 32, width: 56, height: 56,
          borderRadius: '50%', border: 'none', zIndex: 1000, cursor: 'pointer',
          background: modoAdd ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
          boxShadow: '0 4px 24px rgba(48,127,226,.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {modoAdd
          ? <svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          : <svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        }
      </button>}





      {/* Modal seleção de cidade */}
      {cidadeModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1100,
          display:'flex', alignItems:'flex-end' }} onClick={() => { setCidadeModal(false); setBuscaCidade(''); }}>
          <div style={{ width:'100%', background:'#1a1f2e', borderRadius:'16px 16px 0 0',
            padding:'20px', maxHeight:'80vh', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexShrink:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>📍 {t('cities.title')}</div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {cidades.length > 0 && (
                  <button onClick={() => { limparCidades(); setCidadeModal(false); }}
                    style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)',
                      borderRadius:6, color:'#f87171', fontSize:11, padding:'3px 10px', cursor:'pointer' }}>
                    {t('cities.clear')}
                  </button>
                )}
                <button onClick={() => { setCidadeModal(false); setBuscaCidade(''); }}
                  style={{ background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                    borderRadius:6, color:'rgba(255,255,255,.5)', fontSize:11, padding:'3px 10px', cursor:'pointer' }}>
                  ✕
                </button>
              </div>
            </div>

            {/* Campo de busca com autocomplete */}
            <div style={{ display:'flex', gap:8, marginBottom:12, flexShrink:0 }}>
              <input
                value={buscaCidade}
                onChange={e => setBuscaCidade(e.target.value)}
                placeholder={t('cities.search')}
                autoFocus
                style={{ flex:1, padding:'9px 12px', borderRadius:10, boxSizing:'border-box',
                  border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.06)',
                  color:'#fff', fontSize:13, outline:'none' }}
              />
              <select value={filtroPais} onChange={e => { const v = e.target.value; setFiltroPais(v); localStorage.setItem('jet_filtro_pais', v); }}
                style={{ padding:'9px 10px', borderRadius:10, border:'1px solid rgba(255,255,255,.15)',
                  background:'rgba(255,255,255,.06)', color:'#fff', fontSize:12, outline:'none',
                  cursor:'pointer', minWidth:90 }}>
                <option value="TODOS" style={{background:'#131a2e'}}>🌎 Todos</option>
                {(() => {
                  const FLAG: Record<string,string> = { BR:'🇧🇷', MX:'🇲🇽', AR:'🇦🇷', CO:'🇨🇴', CL:'🇨🇱', PE:'🇵🇪' };
                  const NOME: Record<string,string> = { BR:'Brasil', MX:'México', AR:'Argentina', CO:'Colômbia', CL:'Chile', PE:'Peru' };
                  const paises = Array.from(new Set(cidadesReais.map(c => c.pais).filter(Boolean)))
                    .sort((a,b) => a === 'BR' ? -1 : b === 'BR' ? 1 : a.localeCompare(b));
                  return paises.map(p => <option key={p} value={p} style={{background:'#131a2e'}}>{FLAG[p]||'🌍'} {NOME[p]||p}</option>);
                })()}
              </select>
            </div>

            {/* Chips selecionadas */}
            {cidades.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12, flexShrink:0 }}>
                {cidades.map(c => (
                  <span key={c} onClick={() => toggleCidade(c)}
                    style={{ padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:600,
                      background:'rgba(48,127,226,.25)', border:'1px solid rgba(48,127,226,.5)',
                      color:'#60a5fa', cursor:'pointer' }}>
                    📍 {c} ×
                  </span>
                ))}
                <button onClick={() => setCidadeModal(false)}
                  style={{ padding:'4px 14px', borderRadius:20, fontSize:11, fontWeight:600,
                    background:'linear-gradient(135deg,#1a6fd4,#307FE2)', border:'none',
                    color:'#fff', cursor:'pointer' }}>
                  {t('cities.viewMap')}
                </button>
              </div>
            )}

            {/* Lista com scroll — agrupada por país */}
            <div style={{ overflowY:'auto', flex:1, scrollbarWidth:'thin' as const }}>
              {(() => {
                const busca = buscaCidade.toLowerCase().trim();
                // Viewer: mostrar apenas cidades permitidas
                const cidadesVisiveis = isViewer && usuario.cidadesPermitidas?.length
                  ? cidadesReais.filter(c => usuario.cidadesPermitidas!.includes(c.cidade))
                  : cidadesReais;
                const fp = filtroPais;
                // Cidades com estações
                const comEst = cidadesVisiveis
                  .filter(c => !busca || c.cidade.toLowerCase().includes(busca))
                  .filter(c => fp === 'TODOS' || c.pais === fp)
                  .sort((a,b) => a.cidade.localeCompare(b.cidade));
                // Cidades sem estações (planejamento) — só gestor — todos os países
                const todosPaisesUser = usuario.paises || ['BR'];
                const semEst = isGestor
                  ? todosPaisesUser
                      .filter((p: string) => fp === 'TODOS' || p === fp)
                      .flatMap((p: string) =>
                      (CIDADES[p] || [])
                        .filter((c: string) => !cidadesReais.find(r => r.cidade === c))
                        .filter((c: string) => !busca || c.toLowerCase().includes(busca))
                        .map((c: string) => ({ cidade: c, pais: p }))
                    ).sort((a: any, b: any) => a.cidade.localeCompare(b.cidade))
                  : [];
                if (!comEst.length && !semEst.length) {
                  return <div style={{ padding:20, textAlign:'center', color:'#7a8ba8', fontSize:12 }}>Nenhuma cidade encontrada</div>;
                }
                // Agrupar comEst por país
                const FLAG: Record<string,string> = { BR:'🇧🇷', MX:'🇲🇽', AR:'🇦🇷', CO:'🇨🇴', CL:'🇨🇱', PE:'🇵🇪' };
                const NOME_PAIS: Record<string,string> = { BR:'Brasil', MX:'México', AR:'Argentina', CO:'Colômbia', CL:'Chile', PE:'Peru' };
                // BR primeiro, depois resto ordenado
                const paisesCom = Array.from(new Set(comEst.map((c: any) => c.pais)))
                  .sort((a: any, b: any) => a === 'BR' ? -1 : b === 'BR' ? 1 : a.localeCompare(b));
                return (
                  <>
                    {comEst.length === 0 && (
                      <div style={{ fontSize:12, color:'#7a8ba8', padding:'8px 0', marginBottom:8 }}>{t('cities.noStations')}</div>
                    )}
                    {paisesCom.map((p: any) => (
                      <div key={p}>
                        <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', fontWeight:700,
                          letterSpacing:'.08em', margin:'6px 0 4px', padding:'0 2px' }}>
                          {FLAG[p]||'🌍'} {NOME_PAIS[p]||p}
                        </div>
                        {comEst.filter((c: any) => c.pais === p).map((c: any) => {
                          const sel = cidades.includes(c.cidade);
                          return (
                            <div key={c.cidade} onClick={() => toggleCidade(c.cidade)}
                          style={{ padding:'11px 14px', cursor:'pointer', borderRadius:8, marginBottom:4,
                            background: sel ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.04)',
                            border:`1px solid ${sel?'rgba(48,127,226,.4)':'rgba(255,255,255,.06)'}`,
                            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ width:16, height:16, borderRadius:4, flexShrink:0,
                              background: sel?'#307FE2':'rgba(255,255,255,.1)',
                              border:`2px solid ${sel?'#307FE2':'rgba(255,255,255,.2)'}`,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              fontSize:10, color:'#fff' }}>{sel?'✓':''}</div>
                            <span style={{ color: sel?'#60a5fa':'rgba(255,255,255,.8)', fontSize:13, fontWeight: sel?600:400 }}>
                              {c.cidade}
                            </span>
                          </div>
                          <span style={{ fontSize:10, color:'#60a5fa', background:'rgba(48,127,226,.15)',
                            border:'1px solid rgba(48,127,226,.2)', borderRadius:10, padding:'1px 7px' }}>
                            {c.count} est.
                          </span>
                        </div>
                      );
                        })}
                      </div>
                    ))}
                    {semEst.length > 0 && (
                      <>
                        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', fontWeight:700,
                          letterSpacing:'.08em', marginTop:16, marginBottom:8 }}>
                          {t('cities.planning')}
                        </div>
                        {semEst.map((item: any) => {
                          const c = typeof item === 'string' ? item : item.cidade;
                          const p = typeof item === 'string' ? pais : item.pais;
                          const sel = cidades.includes(c);
                          return (
                            <div key={c + p} onClick={() => toggleCidade(c)}
                              style={{ padding:'10px 14px', cursor:'pointer', borderRadius:8, marginBottom:4,
                                background: sel?'rgba(168,85,247,.15)':'rgba(255,255,255,.02)',
                                border:`1px solid ${sel?'rgba(168,85,247,.3)':'rgba(255,255,255,.04)'}`,
                                display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                <div style={{ width:16, height:16, borderRadius:4, flexShrink:0,
                                  background: sel?'#a855f7':'rgba(255,255,255,.08)',
                                  border:`2px solid ${sel?'#a855f7':'rgba(255,255,255,.15)'}`,
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  fontSize:10, color:'#fff' }}>{sel?'✓':''}</div>
                                <span style={{ color: sel?'#c084fc':'rgba(255,255,255,.4)', fontSize:12 }}>
                                  {c}
                                </span>
                              </div>
                              <span style={{ fontSize:9, color:'rgba(255,255,255,.25)' }}>planejamento</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Analytics */}
      {analyticsModulo && isGestor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px',
            background: '#0c1018', borderBottom: '1px solid #1c2535' }}>
            <button onClick={() => setAnalyticsModulo(false)}
              style={{ background: 'none', border: '1px solid #1c2535', color: '#dce8ff',
                padding: '4px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>
              ✕ Fechar Analytics
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <AnalyticsManager usuario={usuario} showToast={showToast} />
          </div>
        </div>
      )}

      {/* Guard Overlay — todos os roles veem ocorrências no mapa */}
      {guardModulo && isGestorApp && (
        <GuardOverlay
          mapInstance={leafletRef.current}
          onOcorrenciasChange={setOcorrenciasLayer}
          onFechar={() => setGuardModulo(false)}
          cidade={''}
          usuario={usuario!}
        />
      )}

      {/* Modal nova ocorrência — FAB Guard para campo/gestor */}
      {novaOcorrencia && (
        <div style={{ position:'fixed', inset:0, zIndex:1200,
          background:'rgba(0,0,0,.6)', backdropFilter:'blur(4px)',
          display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => e.target===e.currentTarget && setNovaOcorrencia(false)}>
          <div style={{ width:'100%', maxWidth:480, maxHeight:'92vh',
            background:'#080d14', borderRadius:'20px 20px 0 0',
            overflowY:'auto', scrollbarWidth:'thin' as const }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'16px 18px 0', borderBottom:'1px solid rgba(255,255,255,.06)', paddingBottom:12, flexShrink:0 }}>
              <div style={{ color:'#a78bfa', fontWeight:700, fontSize:15 }}>🛡 Nova ocorrência</div>
              <button onClick={() => setNovaOcorrencia(false)}
                style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:22, cursor:'pointer' }}>✕</button>
            </div>
            <NovaOcorrenciaInline
              usuario={usuario!}
              onSucesso={() => setNovaOcorrencia(false)}
            />
          </div>
        </div>
      )}

      {/* Dashboard */}
      {dashboardModulo && isGestorApp && (
        <DashboardManager
          cidades={cidades}
          pais={pais}
          onFechar={() => setDashboardModulo(false)}
          roleAtual={usuario.role}
        />
      )}

      {/* Painel de usuários — gestor/admin */}


      {financeiro && (
        <LocaisFinanceiro
          cidade={cidade}
          pais={pais}
          onFechar={() => setFinanceiro(false)}
          roleUsuario={usuario.role}
        />
      )}

      {/* Modal cadastro/edição de local (abre ao clicar no pin do mapa) */}
      {localOpModal && (
        <LocalOperacionalModal
          latLng={localOpModal.latLng}
          cidade={cidade}
          pais={pais}
          editando={localOpModal.editando}
          onFechar={() => setLocalOpModal(null)}
          showToast={showToast}
        />
      )}

      {/* Modal câmera para foto de estação existente */}
      {fotoCapturaCtx?.context === 'existente' && fotoCapturaCtx.estacaoId && (
        <div style={{ position:'fixed', inset:0, zIndex:1800, background:'rgba(0,0,0,.8)',
          display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => e.target===e.currentTarget && setFotoCapturaCtx(null)}
          tabIndex={-1} ref={el => el?.focus()}
          onPaste={async (ev) => {
            const items = ev.clipboardData?.items;
            if (!items) return;
            let file: File | null = null;
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) { file = item.getAsFile(); break; }
            }
            if (!file) return;
            ev.preventDefault();
            const id = fotoCapturaCtx.estacaoId!;
            try {
              showToast('Colando imagem...', 'info');
              const comp = await comprimir(file);
              const url = await uploadComRetry(comp, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
              await supabase.from('estacoes').update({ imagens: { ...((estacoesRef.current.find(x => x.id === id) as any)?.imagens || {}), foto: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
              const est = estacoesRef.current.find((x: any) => x.id === id);
              if (est) (est as any).imagens = { ...((est as any).imagens || {}), foto: url };
              showToast('Foto colada e salva!', 'success');
              setFotoCapturaCtx(null);
            } catch (err: any) { showToast('Erro ao colar: ' + err.message, 'error'); }
          }}>
          <div style={{ width:'100%', maxWidth:400, background:'#0d1521',
            borderRadius:'16px 16px 0 0', padding:20, fontFamily:'Inter,sans-serif' }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#dce8ff', marginBottom:4 }}>📷 Foto da estação</div>
            <div style={{ fontSize:11, color:'#7a8ba8', marginBottom:16 }}>Selecione uma foto para esta estação</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <label style={{ flex:1, minWidth:80, padding:'14px', borderRadius:10, cursor:'pointer', textAlign:'center',
                background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)', color:'#34d399',
                fontSize:13, fontWeight:600, display:'block' }}
                onClick={async (ev) => {
                  if (isAndroidNative()) {
                    ev.preventDefault();
                    let file: File | null = null;
                    try { file = await capturarFotoNativa(); } catch {}
                    if (file) {
                      const id = fotoCapturaCtx.estacaoId!;
                      try {
                        const comp = await comprimir(file);
                        const url = await uploadComRetry(comp, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
                        await supabase.from('estacoes').update({ imagens: { ...((estacoesRef.current.find(x => x.id === id) as any)?.imagens || {}), foto: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
                        const est = estacoesRef.current.find((x: any) => x.id === id);
                        if (est) (est as any).imagens = { ...((est as any).imagens || {}), foto: url };
                        showToast('Foto salva!', 'success');
                      } catch (err:any) { showToast('Erro: ' + err.message, 'error'); }
                      setFotoCapturaCtx(null);
                    }
                  }
                }}>
                📷 Câmera
                <input type="file" accept="image/*" capture="environment" style={{ display:'none' }}
                  onChange={async ev2 => {
                    const file = ev2.target.files?.[0]; if (!file) return;
                    const id = fotoCapturaCtx.estacaoId!;
                    try {
                      const comp = await comprimir(file);
                      const url = await uploadComRetry(comp, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
                      await supabase.from('estacoes').update({ imagens: { ...((estacoesRef.current.find(x => x.id === id) as any)?.imagens || {}), foto: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
                      const est = estacoesRef.current.find((x: any) => x.id === id);
                      if (est) (est as any).imagens = { ...((est as any).imagens || {}), foto: url };
                      showToast('Foto salva!', 'success');
                    } catch (err:any) { showToast('Erro: ' + err.message, 'error'); }
                    setFotoCapturaCtx(null);
                  }} />
              </label>
              <label style={{ flex:1, minWidth:80, padding:'14px', borderRadius:10, cursor:'pointer', textAlign:'center',
                background:'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.3)', color:'#60a5fa',
                fontSize:13, fontWeight:600, display:'block' }}>
                🖼 Galeria
                <input type="file" accept="image/*" style={{ display:'none' }}
                  onChange={async ev2 => {
                    const file = ev2.target.files?.[0]; if (!file) return;
                    const id = fotoCapturaCtx.estacaoId!;
                    try {
                      const comp = await comprimir(file);
                      const url = await uploadComRetry(comp, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
                      await supabase.from('estacoes').update({ imagens: { ...((estacoesRef.current.find(x => x.id === id) as any)?.imagens || {}), foto: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
                      const est = estacoesRef.current.find((x: any) => x.id === id);
                      if (est) (est as any).imagens = { ...((est as any).imagens || {}), foto: url };
                      showToast('Foto salva!', 'success');
                    } catch (err:any) { showToast('Erro: ' + err.message, 'error'); }
                    setFotoCapturaCtx(null);
                  }} />
              </label>
              <button style={{ flex:1, minWidth:80, padding:'14px', borderRadius:10, cursor:'pointer', textAlign:'center',
                background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.3)', color:'#f5c842',
                fontSize:13, fontWeight:600 }}
                onClick={async () => {
                  try {
                    const items = await navigator.clipboard.read();
                    let blob: Blob | null = null;
                    for (const item of items) {
                      const imgType = item.types.find(t => t.startsWith('image/'));
                      if (imgType) { blob = await item.getType(imgType); break; }
                    }
                    if (!blob) { showToast('Nenhuma imagem no clipboard. Copie a imagem primeiro (Print/Ctrl+C).', 'warn'); return; }
                    const file = new File([blob], 'paste.jpg', { type: blob.type });
                    const id = fotoCapturaCtx.estacaoId!;
                    const comp = await comprimir(file);
                    const url = await uploadComRetry(comp, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
                    await supabase.from('estacoes').update({ imagens: { ...((estacoesRef.current.find(x => x.id === id) as any)?.imagens || {}), foto: url } }).or(`id.eq.${id},firebase_id.eq.${id}`);
                    const est = estacoesRef.current.find((x: any) => x.id === id);
                    if (est) (est as any).imagens = { ...((est as any).imagens || {}), foto: url };
                    showToast('Foto colada e salva!', 'success');
                    setFotoCapturaCtx(null);
                  } catch (err: any) { showToast('Erro ao colar: ' + err.message, 'error'); }
                }}>
                📋 Colar
              </button>
            </div>
            <div style={{ fontSize:10, color:'#7a8ba8', marginTop:8, textAlign:'center' }}>
              Dica: tire print (Win+Shift+S), depois clique em 📋 Colar
            </div>
            <button onClick={() => setFotoCapturaCtx(null)}
              style={{ width:'100%', marginTop:10, padding:'10px', borderRadius:10, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Editor de medidas em foto */}
      {fotoMedidasCtx && (
        <div style={{ position:'fixed', inset:0, zIndex:2000, background:'#0d1220' }}>
          <FotoMedidas
            fotoUrl={fotoMedidasCtx.fotoUrl}
            fotoFile={fotoMedidasCtx.fotoFile ?? null}
            onSalvar={(base64) => {
              fotoMedidasCtx.onSalvar(base64);
              setFotoMedidasCtx(null);
            }}
            onCancelar={() => setFotoMedidasCtx(null)}
          />
        </div>
      )}

      {/* Medir em lote — carrossel */}
      {medirFila && medirFila.idx < medirFila.lista.length && (() => {
        const est = medirFila.lista[medirFila.idx];
        const fotoUrl = fixDriveUrl(est.imagens?.foto || '') || est.imagens?.foto || est.imagens?.streetView || '';
        const isSv = !est.imagens?.foto && !!est.imagens?.streetView;
        const total = medirFila.lista.length;
        const atual = medirFila.idx + 1;
        const salvarMedida = async (base64Anotado: string) => {
          try {
            const fetchRes = await fetch(base64Anotado);
            const blob = await fetchRes.blob();
            const url = await uploadComRetry(blob, 'estacoes/fotos/' + Date.now() + '_medida.jpg');
            const { data: rows } = await supabase.from('estacoes').select('id,imagens').or(`id.eq.${est.id},firebase_id.eq.${est.id}`).limit(1);
            const row = rows?.[0];
            if (row) {
              await supabase.from('estacoes').update({ imagens: { ...(row.imagens || {}), foto: url } }).eq('id', row.id);
              const local = estacoesRef.current.find((e: any) => e.id === row.id || e.id === est.id);
              if (local) (local as any).imagens = { ...((local as any).imagens || {}), foto: url };
            }
            showToast(t('medir.saved', { current: atual, total }), 'success');
          } catch (err: any) { showToast('Erro: ' + err.message, 'error'); }
          setMedirFila(prev => prev ? { ...prev, idx: prev.idx + 1 } : null);
        };
        return (
          <div style={{ position:'fixed', inset:0, zIndex:2000, background:'#0d1220', display:'flex', flexDirection:'column' }}
            tabIndex={-1} ref={el => el?.focus()}
            onKeyDown={ev => {
              if (ev.key === 'Escape') { setMedirFila(null); ev.preventDefault(); }
              if (ev.key === 'ArrowRight') { setMedirFila(prev => prev ? { ...prev, idx: prev.idx + 1 } : null); ev.preventDefault(); }
            }}>
            {/* Header da fila */}
            <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:10, padding:'8px 16px',
              background:'#131a2b', borderBottom:'1px solid #1c2535' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>
                  📐 {t('medir.batch')} — {atual}/{total}
                </div>
                <div style={{ fontSize:11, color:'#7a8ba8' }}>
                  {est.codigo} · {est.endereco || est.bairro || ''}
                  {isSv ? ' · 🌐 SV' : ''}
                </div>
              </div>
              <div style={{ background:'#1c2535', borderRadius:8, padding:'4px 10px', fontSize:11, color:'#60a5fa', fontWeight:600 }}>
                {atual}/{total}
              </div>
              <div style={{ fontSize:9, color:'#7a8ba8', display:'flex', gap:4 }}>
                <kbd style={{ background:'#1c2535', padding:'1px 4px', borderRadius:3, fontSize:9 }}>→</kbd> {t('medir.kbSkip')}
                <kbd style={{ background:'#1c2535', padding:'1px 4px', borderRadius:3, fontSize:9 }}>Esc</kbd> {t('medir.kbStop')}
              </div>
              <button onClick={() => setMedirFila(prev => prev ? { ...prev, idx: prev.idx + 1 } : null)}
                style={{ padding:'6px 12px', borderRadius:6, border:'none', cursor:'pointer',
                  background:'rgba(251,191,36,.15)', color:'#fbbf24', fontSize:11, fontWeight:600 }}>
                {t('medir.skip')} ⏭
              </button>
              <button onClick={() => setMedirFila(null)}
                style={{ padding:'6px 12px', borderRadius:6, border:'none', cursor:'pointer',
                  background:'rgba(239,68,68,.15)', color:'#ef4444', fontSize:11, fontWeight:600 }}>
                {t('medir.stop')} ✕
              </button>
            </div>
            {/* Barra de progresso */}
            <div style={{ height:3, background:'#1c2535', flexShrink:0 }}>
              <div style={{ height:'100%', background:'#3b82f6', width:`${(atual/total)*100}%`, transition:'width .3s' }} />
            </div>
            {/* Editor */}
            <div style={{ flex:1, overflow:'hidden' }}>
              <FotoMedidas
                key={est.id}
                fotoUrl={fotoUrl}
                fotoFile={null}
                onSalvar={salvarMedida}
                onCancelar={() => setMedirFila(prev => prev ? { ...prev, idx: prev.idx + 1 } : null)}
              />
            </div>
          </div>
        );
      })()}

      {/* Conclusão do lote */}
      {medirFila && medirFila.idx >= medirFila.lista.length && (
        <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,.85)',
          display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setMedirFila(null)}>
          <div style={{ background:'#0d1521', borderRadius:12, padding:24, textAlign:'center', maxWidth:320 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
            <div style={{ fontSize:16, fontWeight:700, color:'#dce8ff', marginBottom:8 }}>{t('medir.done')}</div>
            <div style={{ fontSize:12, color:'#7a8ba8', marginBottom:16 }}>
              {t('medir.doneDesc', { count: medirFila.lista.length })}
            </div>
            <button onClick={() => setMedirFila(null)}
              style={{ padding:'10px 24px', borderRadius:8, border:'none', cursor:'pointer',
                background:'rgba(16,185,129,.15)', color:'#34d399', fontSize:13, fontWeight:600 }}>
              {t('medir.backToMap')}
            </button>
          </div>
        </div>
      )}

      {/* SV Preview — mostra imagem gerada antes de salvar */}
      {svPreview && (
        <div style={{ position:'fixed', inset:0, zIndex:2500, background:'rgba(0,0,0,.85)', backdropFilter:'blur(6px)',
          display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) setSvPreview(null); }}>
          <div style={{ background:'#0d1521', borderRadius:12, padding:16, maxWidth:380, width:'90vw',
            boxShadow:'0 24px 80px rgba(0,0,0,.9)', border:'1px solid #1c2535' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff', marginBottom:8 }}>
              🌐 {t('sv.preview')} <span style={{ fontSize:10, fontWeight:400, color:'#7a8ba8', marginLeft:6 }}>({svPreview.fonte})</span>
            </div>
            <img src={svPreview.url} referrerPolicy="no-referrer"
              style={{ width:'100%', borderRadius:8, marginBottom:12, maxHeight:240, objectFit:'cover' }} />
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={async () => {
                await (window as any)._svSaveFn?.(svPreview.id, svPreview.url);
                setSvPreview(null);
              }} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', cursor:'pointer',
                background:'rgba(16,185,129,.15)', color:'#34d399', fontSize:12, fontWeight:600 }}>
                ✅ {t('sv.save')}
              </button>
              <button onClick={async () => {
                await (window as any)._svSaveFn?.(svPreview.id, svPreview.url);
                const medirUrl = svPreview.url;
                const medirId = svPreview.id;
                setSvPreview(null);
                window.dispatchEvent(new CustomEvent('jetMedirFoto', { detail: { id: medirId, fotoUrl: medirUrl } }));
              }} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', cursor:'pointer',
                background:'rgba(29,78,216,.15)', color:'#60a5fa', fontSize:12, fontWeight:600 }}>
                📐 {t('sv.saveAndMeasure')}
              </button>
              <button onClick={() => setSvPreview(null)}
                style={{ flex:'0 0 100%', padding:'8px', borderRadius:8, cursor:'pointer',
                  background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                  color:'rgba(255,255,255,.4)', fontSize:11 }}>
                {t('sv.discard')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Street View Modal */}
      {streetViewTarget && (
        <StreetViewModal
          lat={streetViewTarget.lat}
          lng={streetViewTarget.lng}
          nome={streetViewTarget.nome}
          onClose={() => setStreetViewTarget(null)}
          onCapturarFoto={() => {
            setFotoCapturaCtx({ context: 'existente', lat: streetViewTarget.lat, lng: streetViewTarget.lng, estacaoId: streetViewTarget.estacaoId, estacaoCodigo: streetViewTarget.estacaoCodigo });
            setStreetViewTarget(null);
          }}
        />
      )}

      {/* Painel de filtros POI */}
      {showPoiFilterPanel && (showPOILayer || poiGoogleDados.length > 0) && (
        <div
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          style={{ position:'fixed', left:12, bottom:110, zIndex:1100,
            background:'#0d1521', border:'1px solid rgba(255,255,255,.12)',
            borderRadius:14, padding:'12px 14px', width:260,
            fontFamily:'Inter,sans-serif', boxShadow:'0 4px 24px rgba(0,0,0,.7)',
            maxHeight:'60vh', display:'flex', flexDirection:'column' }}>

          {/* Header */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            marginBottom:10, flexShrink:0 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#dce8ff' }}>🔍 Filtrar POIs</div>
            <button onClick={() => setShowPoiFilterPanel(false)}
              style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)',
                cursor:'pointer', fontSize:16, lineHeight:1 }}>✕</button>
          </div>

          {/* Conteúdo scrollável */}
          <div style={{ overflowY:'auto', flex:1, scrollbarWidth:'thin' as const,
            scrollbarColor:'#1c2535 transparent' }}>

            {/* OSM */}
            {showPOILayer && poiLayerData.length > 0 && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:9, color:'#34d399', fontWeight:700,
                  letterSpacing:'.08em', marginBottom:6 }}>
                  📍 OSM · {poiLayerData.length} pontos
                </div>
                <div style={{ display:'flex', flexWrap:'wrap' as const, gap:4 }}>
                  {Array.from(new Set(poiLayerData.map((p:any) => p.tipo))).sort().map((tipo:any) => {
                    const ativo = poiTiposAtivos === null || poiTiposAtivos.has(tipo);
                    const count = poiLayerData.filter((p:any) => p.tipo === tipo).length;
                    return (
                      <button key={tipo} onClick={() => setPoiTiposAtivos(prev => {
                        // Se prev é null (todos), criar set com todos e remover este
                        const base = prev === null
                          ? new Set(poiLayerData.map((p:any) => p.tipo))
                          : new Set(prev);
                        if (base.has(tipo)) base.delete(tipo); else base.add(tipo);
                        // Se todos selecionados, voltar a null
                        const todosOsm = new Set(poiLayerData.map((p:any) => p.tipo));
                        if (base.size === todosOsm.size) return null;
                        return base;
                      })} style={{ padding:'3px 8px', borderRadius:8, cursor:'pointer', fontSize:10,
                        background: ativo ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.04)',
                        border:`1px solid ${ativo ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.08)'}`,
                        color: ativo ? '#34d399' : 'rgba(255,255,255,.4)',
                        fontWeight: ativo ? 600 : 400 }}>
                        {tipo} ({count})
                      </button>
                    );
                  })}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:6 }}>
                  <button onClick={() => setPoiTiposAtivos(null)}
                    style={{ fontSize:9, color:'#34d399', background:'none', border:'none',
                      cursor:'pointer', padding:0 }}>Todos</button>
                  <button onClick={() => setPoiTiposAtivos(new Set<string>())}
                    style={{ fontSize:9, color:'#f87171', background:'none', border:'none',
                      cursor:'pointer', padding:0 }}>Nenhum</button>
                </div>
              </div>
            )}

            {/* Google */}
            {/* DESATIVADO: Painel POIs Google
            {poiGoogleDados.length > 0 && (
              <div>
                <div style={{ fontSize:9, color:'#fbbf24', fontWeight:700,
                  letterSpacing:'.08em', marginBottom:6 }}>
                  🗺 GOOGLE · {poiGoogleDados.length} pontos
                </div>
                <div style={{ display:'flex', flexWrap:'wrap' as const, gap:4, marginBottom:8 }}>
                  {Array.from(new Set(poiGoogleDados.map((p:any) => p.tipo || 'poi'))).sort().map((tipo:any) => {
                    const ativo = poiGoogleTiposAtivos === null || poiGoogleTiposAtivos.has(tipo);
                    const count = poiGoogleDados.filter((p:any) => (p.tipo || 'poi') === tipo).length;
                    return (
                      <button key={tipo} onClick={() => setPoiGoogleTiposAtivos(prev => {
                        const base = prev === null
                          ? new Set(poiGoogleDados.map((p:any) => p.tipo || 'poi'))
                          : new Set(prev);
                        if (base.has(tipo)) base.delete(tipo); else base.add(tipo);
                        const todos = new Set(poiGoogleDados.map((p:any) => p.tipo || 'poi'));
                        return base.size === todos.size ? null : base;
                      })} style={{ padding:'3px 8px', borderRadius:8, cursor:'pointer', fontSize:10,
                        background: ativo ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.04)',
                        border:`1px solid ${ativo ? 'rgba(251,191,36,.4)' : 'rgba(255,255,255,.08)'}`,
                        color: ativo ? '#fbbf24' : 'rgba(255,255,255,.4)',
                        fontWeight: ativo ? 600 : 400 }}>
                        {tipo} ({count})
                      </button>
                    );
                  })}
                </div>
                <div style={{ display:'flex', gap:8, marginBottom:6 }}>
                  <button onClick={() => setPoiGoogleTiposAtivos(null)}
                    style={{ fontSize:9, color:'#fbbf24', background:'none', border:'none',
                      cursor:'pointer', padding:0 }}>Todos</button>
                  <button onClick={() => setPoiGoogleTiposAtivos(
                    new Set(poiGoogleDados.map((p:any) => p.tipo || 'poi'))
                  )}
                    style={{ fontSize:9, color:'#f87171', background:'none', border:'none',
                      cursor:'pointer', padding:0 }}>Nenhum</button>
                </div>
                <button onClick={() => { setPoiGoogleDados([]); setPoiGoogleTiposAtivos(new Set()); }}
                  style={{ width:'100%', padding:'5px', borderRadius:6, cursor:'pointer',
                    background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
                    color:'#f87171', fontSize:10 }}>
                  Limpar POIs Google
                </button>
              </div>
            )}
            */}
          </div>
        </div>
      )}

      {/* Central de Notificações */}
      {showNotif && (
        <div onClick={() => setShowNotif(false)} style={{ position:'fixed', inset:0, zIndex:1499 }}>
          <div onClick={e => e.stopPropagation()}>
            <CentralNotificacoes
              notifs={notifList}
              onFechar={() => setShowNotif(false)}
            />
          </div>
        </div>
      )}

      {/* Lightbox — foto em tela cheia */}
      {lightboxUrl && (
        <div onClick={() => setLightboxUrl(null)}
          style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,.92)',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexDirection:'column', gap:12, cursor:'zoom-out' }}>
          <img src={lightboxUrl} alt="Foto"
            style={{ maxWidth:'96vw', maxHeight:'86vh', objectFit:'contain', borderRadius:8 }} />
          <div style={{ fontSize:11, color:'rgba(255,255,255,.5)' }}>Toque para fechar</div>
        </div>
      )}

      {guiaModulo && (
        <GuiaPanel role={usuario.role} onFechar={() => setGuiaModulo(false)} />
      )}

      {/* Modal documentos públicos */}
      {docPublicoModal && (
        <DocPublicoModal
          estacaoId={docPublicoModal.id}
          cidade={docPublicoModal.cidade}
          docAtual={docPublicoModal.docPublico}
          onFechar={() => setDocPublicoModal(null)}
          onSalvo={() => setDocPublicoModal(null)}
        />
      )}

      {usuariosModulo && isGestorApp && (
        <UsuariosManager
          onFechar={() => setUsuariosModulo(false)}
          roleAtual={usuario.role}
          paisesAtual={usuario.paises}
        />
      )}

      {/* Módulo completo de zonas */}
      {zonasModulo && (
        <ZonasManager
          cidade={cidade}
          pais={pais}
          mapInstance={leafletRef.current}
          onFechar={() => setZonasModulo(false)}
          onMapRefresh={() => { setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 150); }}
        />
      )}

      {/* Módulo Slots + Tarefas + Logística */}
      {showWorkers && usuario && (
        <LiveWorkersPanel
          mapa={leafletRef.current}
          visivel={showWorkers}
          cidade={cidade}
          usuario={{ uid: usuario.uid, role: usuario.role }}
        />
      )}

      {guardDash && isGestorApp && (
        <GuardDashboard
          visivel={guardDash}
          onFechar={() => setGuardDash(false)}
          roleUsuario={usuario?.role}
        />
      )}

      {painelPerdas && ['admin','gestor','gestor_seg'].includes(usuario?.role||'') && (
        <PainelControlePerdasSeg
          visivel={painelPerdas}
          onFechar={() => setPainelPerdas(false)}
          roleUsuario={usuario?.role}
        />
      )}

      {painelRoubos && (
        <PainelRoubos
          visivel={painelRoubos}
          onFechar={() => setPainelRoubos(false)}
          mapa={leafletRef.current}
          cidade={cidade}
          roleUsuario={usuario?.role}
        />
      )}

      {tarefasLogistica && usuario && (
        <TarefasLogisticaModule
          usuario={{ uid: usuario.uid, nome: (usuario as any).nome, email: usuario.email, role: usuario.role }}
          cidade={cidade}
          pais={pais}
          parkingInicial={parkingParaTarefa}
          tarefaAbertaId={tarefaDeepLinkId}
          onFechar={() => { setTarefasLogistica(false); setParkingParaTarefa(null); setModoSelecionarDestino(false); setTarefaDeepLinkId(null); }}
          onSelecionarDestino={(tarefaId, cb) => {
            destinoCallbackRef.current = cb;
            setModoSelecionarDestino(true);
            setTarefasLogistica(false);
          }}
        />
      )}

      {slotsModulo && (isGestorLog || isPrestadorLogistica) && (
        <SlotsTeamsModule
          usuario={{ uid: usuario.uid, nome: usuario.nome, email: usuario.email, role: usuario.role, cidade, cargoPrestador: usuario.cargoPrestador }}
          cidade={cidade}
          onFechar={() => setSlotsModulo(false)}
        />
      )}

      {/* Pagamentos — prestador */}
      {pagamentosOpen && isPrestadorLogistica && (
        <PagamentosModule
          usuario={{ uid: usuario.uid, nome: usuario.nome, email: usuario.email, role: usuario.role, cargoPrestador: usuario.cargoPrestador, cidade, tipoCadastro: usuario.tipoCadastro }}
          onFechar={() => setPagamentosOpen(false)}
        />
      )}

      {/* Pagamentos — admin/gestor */}
      {pagamentosAdminOpen && isGestorLog && (
        <PagamentosAdminPanel
          usuario={{ uid: usuario.uid, nome: usuario.nome, role: usuario.role, cidade, cidadesPermitidas: usuario.cidadesPermitidas }}
          onFechar={() => setPagamentosAdminOpen(false)}
        />
      )}

      {/* Gestor Logística */}
      {gestorLogistica && isGestorLog && (
        <GestorLogisticaPanel
          usuario={{
            uid: usuario.uid,
            nome: usuario.nome,
            email: usuario.email,
            role: usuario.role,
            cidadesGerenciaLog: usuario.cidadesGerenciaLog,
          }}
          cidade={cidade}
          onFechar={() => setGestorLogistica(false)}
        />
      )}

      {/* Painel de configurações unificado — admin */}
      {painelConfig && ['admin', 'supergestor', 'gestor'].includes(usuario.role) && (
        <PainelConfiguracoes onFechar={() => setPainelConfig(false)} cidadeAtual={cidade} autorUid={usuario.uid} autorNome={usuario.nome} />
      )}

      {/* Perfil do prestador */}
      {showPerfilPrestador && usuario?.tipoCadastro === 'prestador' && (
        <TelaPrestadorPerfil
          usuario={usuario}
          onFechar={() => setShowPerfilPrestador(false)}
          onLogout={() => { setShowPerfilPrestador(false); onLogout(); }}
        />
      )}

      {/* Modal Telegram — prestadores sem vínculo (bloqueante no 1º acesso) */}
      {showTgBanner && usuario?.tipoCadastro === 'prestador' && tgVinculado === false && (
        <TelegramVinculo
          usuario={usuario}
          modo="modal"
          onFechar={() => setShowTgBanner(false)}
          onVinculado={() => setShowTgBanner(false)}
        />
      )}
      {monitorPanel && isSuperGestor && (
        <MonitorPanel
          estacao={monitorPanel.estacao}
          posicao={monitorPanel.posicao}
          onFechar={() => setMonitorPanel(null)}
          onSalvo={(id, tipo, cfg) => {
            setEstacoes((prev: any[]) => prev.map(e =>
              e.id === id ? { ...e, tipoMonitor: tipo, monitorConfig: cfg } : e
            ));
            setMonitorPanel(null);
          }}
        />
      )}

      {/* GoJet Dashboard */}
      {gojetDash && isGestor && (
        <GoJetDashboard
          visivel={gojetDash}
          onFechar={() => setGojetDash(false)}
          cidade={cidade}
        />
      )}

      {/* Shift Panel — gestor visualiza todos os turnos */}
      {shiftPanel && isGestor && (
        <ShiftPanel
          visivel={shiftPanel}
          onFechar={() => setShiftPanel(false)}
          cidade={cidade}
        />
      )}

      {/* GoJet Analytics — breakdown por zona, pontos, bikes */}
      {gojetAnalytics && isGestor && (
        <GoJetAnalyticsPanel
          visivel={gojetAnalytics}
          onFechar={() => setGojetAnalytics(false)}
          cidade={cidade}
        />
      )}

      {/* Turno Registro — entrada/saída CLT */}
      {turnoRegistro && usuario && (
        <TurnoRegistro
          uid={usuario.uid}
          nome={usuario.nome ?? usuario.email ?? ''}
          cidade={cidade}
          role={usuario.role ?? ''}
          visivel={turnoRegistro}
          onFechar={() => setTurnoRegistro(false)}
        />
      )}

      {/* OTA Update Banner */}
      <UpdateBanner />

      {/* GoJet overlay — patinetes ao vivo */}
      <GoJetOverlay
        mapa={leafletRef.current}
        visivel={showGoJetLayer}
        cidade={cidade}
        onTarefaRapida={isGestorApp ? (p) => {
          if (modoSelecionarDestino && destinoCallbackRef.current) {
            // Modo de seleção de destino ativo: passa o parking para o callback
            destinoCallbackRef.current(p);
            destinoCallbackRef.current = null;
            setModoSelecionarDestino(false);
            setTarefasLogistica(true);
          } else {
            // Criar tarefa nova
            setParkingParaTarefa({
              id: p.id, nome: p.name,
              lat: p.latitude, lng: p.longitude,
              target: p.target_bikes_count,
              disponivel: p.availableCount,
            });
            setTarefasLogistica(true);
          }
        } : undefined}
        isAdmin={isGestor}
        gestorUid={usuario?.uid}
        gestorNome={usuario?.nome}
      />

      {/* Banner modo seleção destino */}
      {modoSelecionarDestino && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          zIndex: 5000, background: '#f97316', color: '#fff',
          borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 20px rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          🎯 Clique em um ponto P no mapa GoJet para definir o novo destino
          <button onClick={() => {
            setModoSelecionarDestino(false);
            destinoCallbackRef.current = null;
            setTarefasLogistica(true);
          }} style={{ background: 'rgba(0,0,0,.2)', border: 'none', color: '#fff',
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
            Cancelar
          </button>
        </div>
      )}

      {/* Modal editar zona existente */}
      {zonaEditando && (
        <ZonaEditModal
          zona={zonaEditando}
          onSalvar={editarZona}
          onExcluir={excluirZona}
          onFechar={() => setZonaEditando(null)}
        />
      )}

      {/* Dica modo desenho */}
      {zonaEditor && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(168,85,247,.9)', borderRadius: 10, padding: '8px 16px',
          color: '#fff', fontSize: 12, fontWeight: 600, zIndex: 1000,
          backdropFilter: 'blur(8px)'
        }}>
          Clique para adicionar pontos · Duplo clique para fechar a zona
        </div>
      )}

      {/* Modal formulário de zona */}
      {zonaForm && (
        <ZonaFormModal
          coords={zonaForm.coords}
          cidade={cidade}
          pais={pais}
          onSalvar={salvarZona}
          onCancelar={() => {
            setZonaForm(null);
            if (zonaTempLayer.current) zonaTempLayer.current.clearLayers();
            zonaPointsRef.current = [];
          }}
        />
      )}

      {toast && <Toast msg={toast.msg} tipo={toast.tipo} acao={toast.acao} />}

      {/* CSS Leaflet popup override */}
      <style>{`
        /* ── MOBILE / TOUCH ── */
        * { -webkit-tap-highlight-color: transparent; }
        input, button { font-size: 16px; }
        ::-webkit-scrollbar { display: none; }
        @media (max-width: 500px) {
          .jet-modulo {
            position: fixed !important;
            top: 52px !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            max-width: 100vw !important;
            max-height: calc(100vh - 52px) !important;
            border-radius: 0 !important;
          }
        }

        .leaflet-popup-content-wrapper { border-radius: 10px !important; }
        /* Reduzir tamanho dos clusters do markercluster */
        .leaflet-marker-cluster { transition: transform .15s; }
        .leaflet-marker-cluster div {
          width: 26px !important; height: 26px !important;
          margin: 2px 0 0 2px !important;
          font-size: 10px !important; font-weight: 700 !important;
          line-height: 26px !important;
        }
        .leaflet-marker-cluster-small,
        .leaflet-marker-cluster-medium,
        .leaflet-marker-cluster-large {
          width: 30px !important; height: 30px !important;
        }
        .leaflet-popup-content { margin: 12px 14px !important; }
        .leaflet-container { font-family: Inter, sans-serif !important; }
        .leaflet-top, .leaflet-bottom { z-index: 900 !important; }
        .leaflet-pane { z-index: 400 !important; }
        .leaflet-tile-pane { z-index: 200 !important; }
        .leaflet-overlay-pane { z-index: 400 !important; }
        .leaflet-marker-pane { z-index: 600 !important; }
        .leaflet-tooltip-pane { z-index: 650 !important; }
        .leaflet-popup-pane { z-index: 700 !important; }
        .leaflet-map-pane { z-index: 0 !important; }
        .leaflet-zona-tooltip { background: rgba(13,18,30,.9); border: 1px solid rgba(192,132,252,.3); color: #c084fc; font-size: 11px; font-weight: 600; border-radius: 6px; padding: 3px 8px; }
        .leaflet-zona-tooltip::before { display: none; }
      `}</style>

      {/* ── DrawerAdd ── */}
      {drawerAberto && pinLatLng && (
        <DrawerAdd
          latLng={pinLatLng}
          cidadeAtual={cidade}
          pais={pais}
          topOffset={headerH}
          fotoInicial={fotoParaDrawer}
          estacaoEdit={estacaoEdit}
          onSalvar={salvarEstacao}
          onMedirFoto={(fotoUrl, fotoFile) => setFotoMedidasCtx({
            fotoUrl,
            fotoFile,
            onSalvar: async (base64Anotado: string) => {
              try {
                const res  = await fetch(base64Anotado);
                const blob = await res.blob();
                const url  = await uploadComRetry(blob, 'estacoes/fotos/' + Date.now() + '_medida.jpg');
                window.dispatchEvent(new CustomEvent('jetFotoMedida', { detail: url }));
              } catch {
                window.dispatchEvent(new CustomEvent('jetFotoMedida', { detail: base64Anotado }));
              }
              setFotoMedidasCtx(null);
            }
          })}
          onFechar={() => {
            setDrawerAberto(false);
            setPinLatLng(null);
            setEstacaoEdit(null);
            setFotoParaDrawer('');
            if ((window as any).__pinMarker) {
              (window as any).__pinMarker.remove();
              (window as any).__pinMarker = null;
            }
          }}
        />
      )}
    </div>
  );
}

// ── DRAWER ADD ───────────────────────────────────────────────────
// ── ASSINATURA VIRTUAL ──────────────────────────────────────────

export default TelaMapa;

