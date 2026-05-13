// App.tsx — Leaflet + Firebase, seleção de cidade, chunks de render
import { useState, useEffect, useRef, useCallback } from 'react';
import TelaGuard from './TelaGuard';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, User } from 'firebase/auth';
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';

import L from 'leaflet';
import ZonasManager from './ZonasManager';
import { useCidadesExpansao, CidadeExpansaoModal, STATUS_META, type CidadeExpansao } from './CidadesExpansao';
import UsuariosManager from './UsuariosManager';
import DashboardManager from './DashboardManager';
import AnalyticsManager from './AnalyticsManager';
import { POIPanel, POIMapFilter, POIActionsPopup, POI_META } from './components/POIPanel';
import { StreetViewModal } from './components/StreetViewModal';
import { FotoCaptura } from './components/FotoCaptura';
import { CandidatosManager } from './components/CandidatosManager';
import { LocalOperacionalModal, useLocaisOperacionais, TIPO_LOCAL_META } from './components/LocaisOperacionais';
import type { LocalOperacional, TipoLocal } from './components/LocaisOperacionais';
import type { Candidato } from './components/CandidatosManager';
import type { POI } from './components/POIPanel';
import { auth, db, fnGetUsuario, fnAddEstacao, fnGerarStreetView, fnAnalisarCalcada, fnReverseGeocode, fnSolicitarAcesso, fnGerarCroqui } from './lib/firebase';
import 'leaflet/dist/leaflet.css';
import './i18n';
import i18n from './i18n/index';

// Carrega idioma salvo
const savedLang = localStorage.getItem('appLang');
if (savedLang) i18n.changeLanguage(savedLang);

interface Usuario { uid: string; email: string; nome: string; role: string; paises: string[]; }
interface Estacao {
  id: string; codigo: string; lat: number; lng: number;
  cidade: string; bairro: string; endereco: string;
  tipo: string; status: string; pais: string;
  operador?: string;
  larguraFaixa?: number;
  imagens?: { streetView?: string; croqui?: string; foto?: string };
  ia?: { aprovado: boolean; score: number; confianca: string; largura: string; motivo: string };
  croquiStatus: string;
}

// Calcula área de polígono em km² (fórmula de Shoelace com coords geográficas)
function calcAreaKm2(pontos: {lat:number;lng:number}[]): number {
  if (pontos.length < 3) return 0;
  const R = 6371; // raio da Terra em km
  let area = 0;
  const n = pontos.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = pontos[i].lat * Math.PI / 180;
    const lat2 = pontos[j].lat * Math.PI / 180;
    const dLng = (pontos[j].lng - pontos[i].lng) * Math.PI / 180;
    area += (dLng) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

// Point-in-polygon (ray casting)
function pontoNoPoli(lat: number, lng: number, pontos: {lat:number;lng:number}[]): boolean {
  let inside = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const xi = pontos[i].lat, yi = pontos[i].lng;
    const xj = pontos[j].lat, yj = pontos[j].lng;
    if (((yi > lng) !== (yj > lng)) && (lat < (xj-xi)*(lng-yi)/(yj-yi)+xi))
      inside = !inside;
  }
  return inside;
}

// Coordenadas das cidades para centralizar o mapa
const COORDS_CIDADES: Record<string, [number, number]> = {
  'São Paulo':              [-23.5505, -46.6333],
  'Curitiba':               [-25.4284, -49.2733],
  'Rio de Janeiro':         [-22.9068, -43.1729],
  'Belo Horizonte':         [-19.9191, -43.9386],
  'Porto Alegre':           [-30.0346, -51.2177],
  'Fortaleza':              [-3.7172,  -38.5433],
  'Recife':                 [-8.0476,  -34.8770],
  'Salvador':               [-12.9714, -38.5014],
  'Manaus':                 [-3.1190,  -60.0217],
  'Brasília':               [-15.7801, -47.9292],
  'Osasco':                 [-23.5329, -46.7919],
  'Guarulhos':              [-23.4543, -46.5338],
  'Campinas':               [-22.9099, -47.0626],
  'São Bernardo do Campo':  [-23.6939, -46.5650],
  'Ciudad de México':       [19.4326,  -99.1332],
  'Guadalajara':            [20.6597,  -103.3496],
  'Monterrey':              [25.6866,  -100.3161],
  'Puebla':                 [19.0414,  -98.2063],
  'Tijuana':                [32.5149,  -117.0382],
  'León':                   [21.1221,  -101.6822],
  'Mérida':                 [20.9674,  -89.5926],
  'Zapopan':                [20.7214,  -103.3907],
  'San Luis Potosí':        [22.1565,  -100.9855],
  'Aguascalientes':         [21.8853,  -102.2916],
};

// Calcula área de polígono em km² (Shoelace formula)


// Cidades disponíveis por país
const CIDADES: Record<string, string[]> = {
  BR: ['São Paulo','Curitiba','Rio de Janeiro','Belo Horizonte','Porto Alegre','Fortaleza','Recife','Salvador','Manaus','Brasília','Osasco','Guarulhos','Campinas','São Bernardo do Campo'],
  MX: ['Ciudad de México','Guadalajara','Monterrey','Puebla','Tijuana','León','Mérida','Zapopan','San Luis Potosí','Aguascalientes']
};

// ── TELA DE SOLICITAÇÃO DE ACESSO ───────────────────────────────
function TelaSolicitacao({ onVoltar }: { onVoltar: () => void }) {
  const [nome,   setNome]   = useState('');
  const [email,  setEmail]  = useState('');
  const [paises, setPaises] = useState<string[]>(['BR']);
  const [motivo, setMotivo] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [ok,     setOk]     = useState(false);
  const [erro,   setErro]   = useState('');

  const togglePais = (p: string) =>
    setPaises(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const inp: React.CSSProperties = {
    width: '100%', padding: '11px 14px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 10, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paises.length) { setErro('Selecione pelo menos um país.'); return; }
    setBusy(true); setErro('');
    try {
      const { fnSolicitarAcesso: fn } = await import('./lib/firebase');
      await fn()({ nome, email, paises, motivo });
      setOk(true);
    } catch(err: unknown) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar solicitação.');
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter,sans-serif', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <button onClick={onVoltar} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
          fontSize: 13, cursor: 'pointer', marginBottom: 24, padding: 0
        }}>← Voltar ao login</button>

        {ok ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#6ee7b7', marginBottom: 8 }}>
              Solicitação enviada!
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 24 }}>
              Aguarde a aprovação do administrador. Você receberá um e-mail com instruções de acesso.
            </div>
            <button onClick={onVoltar} style={{
              padding: '12px 24px', background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
              border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, cursor: 'pointer'
            }}>Voltar ao login</button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                Solicitar acesso
              </h2>
              <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
                Preencha o formulário e aguarde aprovação do administrador.
              </p>
            </div>
            <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 11, marginBottom: 6 }}>
                  Nome completo *
                </label>
                <input value={nome} onChange={e => setNome(e.target.value)} required style={inp} placeholder="Seu nome" />
              </div>
              <div>
                <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 11, marginBottom: 6 }}>
                  E-mail *
                </label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inp} placeholder="seu@email.com" />
              </div>
              <div>
                <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 11, marginBottom: 8 }}>
                  País(es) de atuação *
                </label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['BR','MX','AR','CO','CL','PE'].map(p => (
                    <button key={p} type="button" onClick={() => togglePais(p)} style={{
                      padding: '6px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                      background: paises.includes(p) ? 'rgba(48,127,226,.25)' : 'rgba(255,255,255,.06)',
                      border: `1px solid ${paises.includes(p) ? 'rgba(48,127,226,.5)' : 'rgba(255,255,255,.1)'}`,
                      color: paises.includes(p) ? '#60a5fa' : 'rgba(255,255,255,.4)'
                    }}>{p}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 11, marginBottom: 6 }}>
                  Motivo / Empresa
                </label>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                  placeholder="Ex: Faço parte da equipe de campo da empresa X"
                  style={{ ...inp, resize: 'vertical' }} />
              </div>
              {erro && (
                <div style={{ padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                  color: '#f87171', fontSize: 13 }}>{erro}</div>
              )}
              <button type="submit" disabled={busy} style={{
                padding: 13,
                background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                border: 'none', borderRadius: 10, color: '#fff',
                fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
              }}>{busy ? 'Enviando...' : 'Enviar solicitação'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── LOGIN ────────────────────────────────────────────────────────
function TelaLogin({ onLogin }: { onLogin: (e: string, s: string) => Promise<string | null> }) {
  const [email,       setEmail]       = useState('');
  const [senha,       setSenha]       = useState('');
  const [erro,        setErro]        = useState('');
  const [busy,        setBusy]        = useState(false);
  const [resetEmail,  setResetEmail]  = useState('');
  const [resetMode,   setResetMode]   = useState(false);
  const [resetOk,     setResetOk]     = useState(false);
  const [solicitando, setSolicitando] = useState(false);

  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box'
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setBusy(true);
    const err = await onLogin(email, senha);
    if (err) { setErro(err); setBusy(false); }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetOk(true);
    } catch {
      setErro('E-mail não encontrado.');
    }
    setBusy(false);
  };

  if (solicitando) return <TelaSolicitacao onVoltar={() => setSolicitando(false)} />;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ width: 360, padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px',
            background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>Jet OS</h1>
        </div>

        {resetMode ? (
          // Modo recuperar senha
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
              Recuperar senha
            </div>
            {resetOk ? (
              <div style={{ padding: '12px 14px', borderRadius: 8, marginBottom: 16,
                background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)',
                color: '#6ee7b7', fontSize: 13 }}>
                Email enviado! Verifique sua caixa de entrada.
              </div>
            ) : (
              <form onSubmit={handleReset}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>
                    Seu e-mail
                  </label>
                  <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                    required style={inp} placeholder="seu@email.com" />
                </div>
                {erro && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                  color: '#f87171', fontSize: 13 }}>{erro}</div>}
                <button type="submit" disabled={busy} style={{
                  width: '100%', padding: 13,
                  background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                  border: 'none', borderRadius: 10, color: '#fff',
                  fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
                }}>{busy ? 'Enviando...' : 'Enviar link'}</button>
              </form>
            )}
            <button onClick={() => { setResetMode(false); setErro(''); setResetOk(false); }} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
              fontSize: 13, cursor: 'pointer', marginTop: 16, padding: 0
            }}>← Voltar ao login</button>
          </div>
        ) : (
          // Modo login normal
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>E-mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inp} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>Senha</label>
              <input type="password" value={senha} onChange={e => setSenha(e.target.value)} required style={inp} />
            </div>
            <div style={{ textAlign: 'right', marginBottom: 20 }}>
              <button type="button" onClick={() => setResetMode(true)} style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
                fontSize: 12, cursor: 'pointer', padding: 0
              }}>Esqueci minha senha</button>
            </div>
            {erro && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14,
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              color: '#f87171', fontSize: 13 }}>{erro}</div>}
            <button type="submit" disabled={busy} style={{
              width: '100%', padding: 14,
              background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
              border: 'none', borderRadius: 10, color: '#fff',
              fontSize: 15, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
            }}>{busy ? 'Entrando...' : 'Entrar'}</button>

            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button type="button" onClick={() => setSolicitando(true)} style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,.35)',
                fontSize: 13, cursor: 'pointer'
              }}>Não tem acesso? Solicitar aqui</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── TOAST ────────────────────────────────────────────────────────
function Toast({ msg, tipo }: { msg: string; tipo: string }) {
  const cores: Record<string, { bg: string; border: string; text: string }> = {
    success: { bg: 'rgba(16,185,129,.15)', border: 'rgba(16,185,129,.3)', text: '#6ee7b7' },
    error:   { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.3)',  text: '#f87171' },
    warn:    { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.3)', text: '#fbbf24' },
    info:    { bg: 'rgba(48,127,226,.15)', border: 'rgba(48,127,226,.3)', text: '#60a5fa' }
  };
  const c = cores[tipo] || cores.info;
  return (
    <div style={{
      position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
      padding: '10px 18px', background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 10, color: c.text, fontSize: 13, fontWeight: 500,
      backdropFilter: 'blur(12px)', zIndex: 500, maxWidth: '90vw', textAlign: 'center'
    }}>{msg}</div>
  );
}

// ── MAPA ─────────────────────────────────────────────────────────
function TelaMapa({ usuario, onLogout }: { usuario: Usuario; onLogout: () => void }) {
  const mapRef      = useRef<HTMLDivElement>(null);
  const leafletRef  = useRef<L.Map | null>(null);
  const layerRef    = useRef<L.LayerGroup | null>(null);

  const [estacoes,      setEstacoes]      = useState<Estacao[]>([]);
  const [cidades,       setCidades]       = useState<string[]>([]);
  const cidade = cidades[0] || ''; // compat — cidade principal
  const [ativa,         setAtiva]         = useState<Estacao | null>(null);
  const [modoAdd,       setModoAdd]       = useState(false);
  const modoAddRef = useRef(false);
  const [pinLatLng,     setPinLatLng]     = useState<{lat:number;lng:number}|null>(null);
  const [drawerAberto,  setDrawerAberto]  = useState(false);
  const [estacaoEdit,   setEstacaoEdit]   = useState<Estacao | null>(null);
  const [cidadeModal,   setCidadeModal]   = useState(false);
  const [toast,         setToast]         = useState<{msg:string;tipo:string}|null>(null);
  const [contagem,      setContagem]      = useState(0);
  const [filtros,       setFiltros]       = useState<Set<string>>(new Set(['PUBLICA','PRIVADA'])); // CONCORRENTE desligado por padrão
  const [cicloviasOn,   setCicloviasOn]   = useState(false);
  const [poligonosOn,   setPoligonosOn]   = useState(false);
  const [zonaEditor,    setZonaEditor]    = useState(false);
  const [zonasModulo,   setZonasModulo]   = useState(false);
  const [usuariosModulo,   setUsuariosModulo]   = useState(false);
  const [dashboardModulo, setDashboardModulo] = useState(false);
  const [analyticsModulo, setAnalyticsModulo] = useState(false);
  const [guardModulo,     setGuardModulo]     = useState(false);
  const [ocorrenciasLayer, setOcorrenciasLayer] = useState<any[]>([]);
  const [showPOILayer, setShowPOILayer]     = useState(false);
  const [poiLayerData, setPoiLayerData]     = useState<POI[]>([]);
  const [poiTiposAtivos, setPoiTiposAtivos] = useState<Set<string>>(new Set());
  const [poiLoading, setPoiLoading]         = useState(false);
  const poiMarkersRef = useRef<any[]>([]);
  const [candidatosLayer, setCandidatosLayer] = useState<Candidato[]>([]);
  // Locais operacionais (hook moved after pais declaration)
  const [showLocaisOp, setShowLocaisOp] = useState(false);
  const [tiposFiltroLocais, setTiposFiltroLocais] = useState<Set<TipoLocal>>(new Set(['BASE_CARGA','CENTRO_SERVICO','DEPOSITO','PONTO_REDISTRIBUICAO']));
  const [localOpModal, setLocalOpModal] = useState<{latLng:{lat:number;lng:number};editando?:LocalOperacional}|null>(null);
  const [modoAddLocal, setModoAddLocal] = useState(false);
  const [satOn, setSatOn] = useState(false);
  const modoAddLocalRef = useRef(false);
  const locaisMarkersRef = useRef<any[]>([]);
  const [candidatoPopup, setCandidatoPopup] = useState<{candidato:Candidato;index:number}|null>(null);
  const [analyticsStationInfo, setAnalyticsStationInfo] = useState<any>(null);
  const [cidadesExpShow, setCidadesExpShow] = useState(false);
  const [cidadeExpModal, setCidadeExpModal] = useState<{editando?:CidadeExpansao;latLng?:{lat:number;lng:number}}|null>(null);
  const cidadesExp = useCidadesExpansao();
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

  const candidatosMarkersRef = useRef<any[]>([]);
  const [fotoCapturaCtx, setFotoCapturaCtx] = useState<{context:'novo'|'existente';lat?:number;lng?:number;estacaoId?:string;estacaoCodigo?:string}|null>(null);
  const [fotoParaDrawer, setFotoParaDrawer] = useState<string>('');
  const [selectedPOI, setSelectedPOI] = useState<any>(null);
  const [streetViewTarget, setStreetViewTarget] = useState<{lat:number;lng:number;nome?:string;estacaoId?:string;estacaoCodigo?:string}|null>(null);
  const [zonaEditando,  setZonaEditando]  = useState<Record<string,unknown> | null>(null);
  const [zonaDrawing,   setZonaDrawing]   = useState(false);
  const [zonaForm,      setZonaForm]      = useState<{coords: [number,number][]} | null>(null);
  const poligonosLayerRef = useRef<L.LayerGroup | null>(null);
  const cicloviasLayerRef = useRef<L.LayerGroup | null>(null);
  const [filtroStatus,  setFiltroStatus]  = useState<string>('TODOS');
  const [raioAtivo,     setRaioAtivo]     = useState(false);
  const [raioMetros,    setRaioMetros]    = useState(100);
  const raioLayerRef  = useRef<L.LayerGroup | null>(null);
  const headerRef     = useRef<HTMLDivElement | null>(null);
  const [headerH,     setHeaderH]     = useState(52);

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

  const pais      = usuario.paises[0] || 'BR';
  const locaisOp = useLocaisOperacionais(cidade, pais);
  const isAdmin   = usuario.role === 'admin';

  const toggleCidade = (c: string) => {
    setCidades(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };
  const limparCidades = () => setCidades([]);
  const isGestor  = ['admin','gestor'].includes(usuario.role);
  const isCampo   = usuario.role === 'campo';

  const showToast = useCallback((msg: string, tipo = 'info') => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3500);
  }, []);

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

  // Firestore — carrega por múltiplas cidades
  useEffect(() => {
    if (!cidades.length) { setEstacoes([]); return; }

    // Para cada cidade, cria um listener
    const unsubs: (() => void)[] = [];
    const porCidade: Record<string, Estacao[]> = {};

    cidades.forEach(c => {
      const q = query(
        collection(db, 'estacoes'),
        where('pais',   '==', pais),
        where('cidade', '==', c)
      );
      const unsub = onSnapshot(q, snap => {
        porCidade[c] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Estacao));
        // Merge de todas as cidades
        const todas = Object.values(porCidade).flat();
        setEstacoes(todas);
      });
      unsubs.push(unsub);
    });

    return () => unsubs.forEach(u => u());
  }, [cidades, pais]);


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
        alert('Desenhe pelo menos 3 pontos antes de fechar.');
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

    getDocs(query(
      collection(db, 'poligonos'),
      where('cidade', 'in', cidades.slice(0,10))
    )).then(snap => {
      // Filtra ativo no cliente para incluir zonas sem campo ativo (legado)
      const activeDocs = { docs: snap.docs.filter(d => d.data().ativo !== false) };
      return activeDocs;
    }).then(snap => {
      snap.docs.forEach(doc => {
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

        poly.on('click', () => {
          // Calcula dados da zona
          const pontos = coords.map(([lat, lng]) => ({ lat, lng }));
          const areaKm2 = calcAreaKm2(pontos);
          const estacoesNaZona = estacoes.filter(e => pontoNoPoli(e.lat, e.lng, pontos));
          const densidadeKm2 = areaKm2 > 0 ? (estacoesNaZona.length / areaKm2).toFixed(1) : '0';

          poly.bindPopup(`
            <div style="font-family:Inter,sans-serif;min-width:180px">
              <b style="font-size:13px">${nome || '(sem nome)'}</b>
              <div style="font-size:11px;color:#666;margin:2px 0">${fase} · ${grupo}</div>
              ${(() => { try { const dt = d.importadoEm || (d.criadoEm?.toDate ? d.criadoEm.toDate().toISOString() : d.criadoEm); if (!dt) return ''; const label = d.importadoEm ? 'Importado' : 'Criado'; return '<div style="font-size:10px;color:#999;margin-top:2px">📅 ' + label + ': ' + new Date(dt).toLocaleDateString('pt-BR') + '</div>'; } catch(e) { return ''; } })()}
              <hr style="border:none;border-top:1px solid #eee;margin:8px 0">
              <div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div><b style="color:#2563eb">${areaKm2.toFixed(2)}</b><br><span style="font-size:10px;color:#888">km²</span></div>
                <div><b style="color:#16a34a">${estacoesNaZona.length}</b><br><span style="font-size:10px;color:#888">estações</span></div>
                <div><b style="color:#7c3aed">${densidadeKm2}</b><br><span style="font-size:10px;color:#888">est/km²</span></div>
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
          <b style="font-size:12px">${nome || fase || 'Zona'}</b>
          ${fase ? `<div style="font-size:10px;color:#888;margin-top:2px">${fase}</div>` : ''}
          <div style="border-top:1px solid #eee;margin:6px 0"></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="color:#666">Área</span>
            <b>${areaKm2 < 1 ? (areaKm2 * 100).toFixed(2) + ' ha' : areaKm2.toFixed(3) + ' km²'}</b>
          </div>
          <div style="font-size:11px;display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="color:#666">Estações</span>
            <b>${estacoesNaZona}</b>
          </div>
          <div style="font-size:11px;display:flex;justify-content:space-between">
            <span style="color:#666">Densidade</span>
            <b>${densidade}/km²</b>
          </div>
        </div>`;

        poly.bindPopup(tooltipHtml, { maxWidth: 200 });
        poly.bindTooltip(nome || fase || 'Zona', {
          permanent: false, direction: 'center',
          className: 'leaflet-zona-tooltip'
        });

        poly.addTo(layer);
      });
    }).catch(() => {});

    // Handlers para botões no popup
    (window as any)._editZona = (id: string) => {
      getDocs(query(collection(db, 'poligonos'), where('cidade', 'in', cidades.slice(0,10)))).then(snap => {
        const d = snap.docs.find(x => x.id === id);
        if (d) setZonaEditando({ id: d.id, ...d.data() });
      });
    };
    (window as any)._deleteZona = async (id: string, nome: string) => {
      if (!confirm('Excluir zona "' + nome + '"?')) return;
      const { doc: fDoc, deleteDoc: fDel } = await import('firebase/firestore');
      await fDel(fDoc(db, 'poligonos', id));
      showToast('Zona excluída', 'success');
      setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 100);
    };
  }, [poligonosOn, cidade]);

  // Pinos de cidade no mapa mundial — busca cidades reais do Firestore
  const cidadePinsRef  = useRef<L.LayerGroup | null>(null);
  const [cidadesReais, setCidadesReais] = useState<{cidade: string; count: number; lat: number; lng: number}[]>([]);

  // Busca cidades com estações do Firestore
  useEffect(() => {
    getDocs(query(
      collection(db, 'estacoes'),
      where('pais', '==', pais)
    )).then(snap => {
      // Agrupa por cidade e calcula centroid
      const mapa: Record<string, {lats: number[]; lngs: number[]; count: number}> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const c = data.cidade;
        if (!c || !data.lat || !data.lng) return;
        if (!mapa[c]) mapa[c] = { lats: [], lngs: [], count: 0 };
        mapa[c].lats.push(data.lat);
        mapa[c].lngs.push(data.lng);
        mapa[c].count++;
      });

      const lista = Object.entries(mapa).map(([cidade, v]) => ({
        cidade,
        count: v.count,
        lat: v.lats.reduce((a,b) => a+b, 0) / v.lats.length,
        lng: v.lngs.reduce((a,b) => a+b, 0) / v.lngs.length
      })).sort((a,b) => b.count - a.count);

      setCidadesReais(lista);
    }).catch(() => {});
  }, [pais]);

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
        padding:5px 12px;border-radius:20px;
        color:white;font-size:11px;font-weight:700;
        border:2px solid white;
        box-shadow:0 3px 12px rgba(48,127,226,.5);
        white-space:nowrap;cursor:pointer;
        display:flex;align-items:center;gap:6px">
        <span>${c.cidade}</span>
        <span style="background:rgba(255,255,255,.25);border-radius:10px;padding:1px 6px;font-size:9px">${c.count}</span>
      </div>`;

      const marker = L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: '', html, iconAnchor: [60, 16] })
      });

      marker.on('click', () => {
        toggleCidade(c.cidade);
        setCidadeModal(false);
      });

      marker.addTo(pinLayer);
    });

  }, [cidade, cidadesReais]);

  // Raio dinâmico ao redor das estações
  useEffect(() => {
    if (raioLayerRef.current) { raioLayerRef.current.clearLayers(); }
    if (!raioAtivo || !leafletRef.current) return;

    const layer = raioLayerRef.current || L.layerGroup().addTo(leafletRef.current);
    raioLayerRef.current = layer;
    layer.clearLayers();

    const estacoesVisiveis = estacoes.filter(e =>
      filtros.has(e.tipo) && (filtroStatus === 'TODOS' || e.status === filtroStatus)
    );

    estacoesVisiveis.forEach(e => {
      L.circle([e.lat, e.lng], {
        radius: raioMetros,
        color: '#60a5fa', fillColor: '#60a5fa',
        fillOpacity: 0.06, weight: 1, opacity: 0.4,
        interactive: false
      }).addTo(layer);
    });
  }, [raioAtivo, raioMetros, estacoes, filtros, filtroStatus]);

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
      filtros.has(e.tipo) &&
      (filtroStatus === 'TODOS' || e.status === filtroStatus)
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

        const cor = e.ia?.aprovado ? '#22c55e'
          : e.tipo === 'CONCORRENTE' ? '#ef4444'
          : e.tipo === 'PRIVADA'     ? '#f59e0b'
          : '#3b82f6';

        const html = `<div style="
          background:${cor};width:18px;height:18px;border-radius:50%;
          border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>`;

        const marker = L.marker([e.lat, e.lng], {
          icon: L.divIcon({ className: '', html, iconSize: [18, 18], iconAnchor: [9, 9] })
        });

        // InfoWindow completo
        marker.bindPopup(() => {
          const d = e as any;

          // Foto ou Street View
          const imgUrl = e.imagens?.foto || e.imagens?.streetView || '';
          const imgHtml = imgUrl
            ? `<img src="${imgUrl}" style="width:100%;height:110px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block"
               onerror="this.style.display='none'">`
            : '';

          const iaHtml = ''; // IA desativada

          // Dados específicos por tipo
          let tipoExtra = '';
          if (e.tipo === 'CONCORRENTE' && d.nomeConcorrente) {
            tipoExtra = `<div style="font-size:11px;color:#ef4444;margin:3px 0">
              🏢 Concorrente: <b>${d.nomeConcorrente}</b></div>`;
          }
          if (e.tipo === 'PRIVADA' && d.privado) {
            const p = d.privado;
            tipoExtra = `<div style="font-size:11px;color:#f59e0b;margin:3px 0;line-height:1.5">
              🏢 ${p.nomeLocal || '—'}<br>
              ${p.nomeAutorizante ? `👤 ${p.nomeAutorizante}${p.cargoAutorizante ? ' · ' + p.cargoAutorizante : ''}` : ''}
              ${p.telefone ? `<br>📞 ${p.telefone}` : ''}
              ${p.email ? `<br>✉️ ${p.email}` : ''}
            </div>`;
          }

          // Dados técnicos
          const tecnico = e.larguraFaixa
            ? `<div style="font-size:11px;color:#888;margin:2px 0">
                Largura: <b style="color:#333">${e.larguraFaixa}m</b></div>` : '';

          // Links de imagens
          const svInlineBtn = `<button onclick="window.dispatchEvent(new CustomEvent('jetOpenSV',{detail:{lat:${e.lat},lng:${e.lng},nome:'${(e.endereco||e.codigo||'').replace(/'/g,"")}',estacaoId:'${e.id}',estacaoCodigo:'${e.codigo||""}'}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
            style="background:#005bff;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;margin-right:4px">🌐 Street View</button>`;
          const fotoBtn = `<button onclick="window.dispatchEvent(new CustomEvent('jetFoto',{detail:{id:'${e.id}',codigo:'${e.codigo||''}',lat:${e.lat},lng:${e.lng}}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
            style="background:#10b981;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">📷 Foto</button>`;
          // Google Maps link opens the location in Maps (not embed)
          const gmapsUrl = `https://www.google.com/maps?q=${e.lat},${e.lng}&cbll=${e.lat},${e.lng}&layer=c`;
          const links = [
            svInlineBtn, fotoBtn,
            `<a href="${gmapsUrl}" target="_blank"
              style="color:#005bff;font-size:10px;text-decoration:none">🗺 Maps</a>`,
            e.imagens?.croqui ? `<a href="${e.imagens.croqui}" target="_blank"
              style="color:#7c3aed;font-size:10px;text-decoration:none">📐 Croqui</a>` : '',
            e.imagens?.foto && e.imagens?.foto !== imgUrl ? `<a href="${e.imagens.foto}" target="_blank"
              style="color:#16a34a;font-size:10px;text-decoration:none">📸 Foto</a>` : ''
          ].filter(Boolean).join(' · ');

          const bairroSubpref = [e.bairro, d.subprefeitura].filter(Boolean).join(' · ');

          // Show foto thumbnail if available
          const thumbHtml = (e.imagens?.foto || e.imagens?.streetView)
            ? `<img src="${e.imagens.foto || e.imagens.streetView}" style="width:100%;height:110px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block" onerror="this.style.display='none'" />`
            : '';

          return `<div style="min-width:220px;max-width:260px;font-family:Inter,sans-serif">${thumbHtml}
            ${imgHtml}
            <div style="font-size:10px;color:#888;margin-bottom:2px">
              ${e.tipo} · ${e.status}${bairroSubpref ? ' · ' + bairroSubpref : ''}
            </div>
            <b style="font-size:13px;color:#0d0d1a;display:block;margin-bottom:1px">
              ${e.endereco || e.bairro || e.codigo}
            </b>
            <div style="font-size:10px;color:#aaa;margin-bottom:4px">${e.codigo}</div>
            ${tipoExtra}
            ${tecnico}
            ${iaHtml}
            ${links ? `<div style="margin:6px 0">${links}</div>` : ''}
            <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
              <button onclick="window._svClick('${e.id}')" style="flex:1;padding:5px;background:#e8f0ff;border:none;border-radius:5px;color:#005bff;font-size:10px;font-weight:600;cursor:pointer">SV</button>

              ${isGestor || e.operador === usuario.email
                ? `<button onclick="window._editClick('${e.id}')" style="flex:1;padding:5px;background:#fff3e0;border:none;border-radius:5px;color:#e65100;font-size:10px;font-weight:600;cursor:pointer">Editar</button>`
                : ''}
              <button onclick="window._croquiClick('${e.id}')" style="flex:1;padding:5px;background:#f3e8ff;border:none;border-radius:5px;color:#7c3aed;font-size:10px;font-weight:600;cursor:pointer">Croqui</button>
              ${isGestor
                ? `<button onclick="window._delClick('${e.id}')" style="flex:1;padding:5px;background:#fde8e8;border:none;border-radius:5px;color:#c62828;font-size:10px;font-weight:600;cursor:pointer">Del</button>`
                : ''}
            </div>
          </div>`;
        }, { maxWidth: 280 });

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
  }, [estacoes, filtros, filtroStatus]);

  // Funções globais para popup buttons
  useEffect(() => {
    (window as any)._croquiClick = async (id: string) => {
      const est = estacoes.find(x => x.id === id);
      if (!est) return;
      if (!confirm(`Gerar croqui para ${est.codigo}?\nIsso pode levar ~30 segundos.`)) return;
      showToast('Gerando croqui...', 'info');
      try {
        const res = await fnGerarCroqui()({ estacaoId: id });
        const d = res.data as { ok: boolean; pdfUrl: string };
        if (d.ok && d.pdfUrl) {
          showToast('Croqui gerado!', 'success');
          window.open(d.pdfUrl, '_blank');
        }
      } catch(e: unknown) {
        showToast('Erro: ' + (e instanceof Error ? e.message : String(e)), 'error');
      }
    };

    (window as any)._svClick = async (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      showToast('Gerando Street View...', 'info');
      const r = await fnGerarStreetView()({ codigo: e.codigo, lat: e.lat, lng: e.lng });
      const d = r.data as { ok: boolean; error?: string };
      showToast(d.ok ? 'Street View salvo!' : (d.error || 'Sem cobertura'), d.ok ? 'success' : 'warn');
    };
    (window as any)._editClick = (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      setEstacaoEdit(e);
      setPinLatLng({ lat: e.lat, lng: e.lng });
      setDrawerAberto(true);
      leafletRef.current?.closePopup();
    };
    (window as any)._delClick = async (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      if (!confirm('Excluir estacao ' + e.codigo + '?')) return;
      try {
        const { doc, deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'estacoes', id));
        // Remove do estado local imediatamente
        setEstacoes(prev => prev.filter((x: any) => x.id !== id));
        leafletRef.current?.closePopup();
        showToast('Estacao excluida', 'success');
      } catch { showToast('Erro ao excluir', 'error'); }
    };
    (window as any)._iaClick = async (id: string) => {
      const e = estacoes.find(x => x.id === id);
      if (!e) return;
      showToast('Analisando...', 'info');
      const r = await fnAnalisarCalcada()({ lat: e.lat, lng: e.lng, codigo: e.codigo });
      const d = r.data as { ok: boolean; resultado?: { aprovado: boolean; larguraEstimada: string }; error?: string };
      if (d.ok && d.resultado) {
        showToast(d.resultado.aprovado ? `Aprovado · ${d.resultado.larguraEstimada}` : 'Reprovado', d.resultado.aprovado ? 'success' : 'warn');
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
      marker.bindTooltip('<b>' + c.nome + '</b><br/>' + m.icon + ' ' + m.label + (c.dataPrevista ? '<br/>📅 ' + c.dataPrevista : '') + (c.responsavel ? '<br/>👤 ' + c.responsavel : ''), { permanent: false });
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
    poiLayerData
      .filter((p: any) => poiTiposAtivos.has(p.tipo))
      .forEach((poi: any) => {
        const meta = (POI_META as any)[poi.tipo] || { icon: '📍', label: poi.tipo, color: '#64748b' };
        const divIcon = L.divIcon({
          html: '<div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">' + meta.icon + '</div>',
          className: '',
          iconSize: [24, 24] as [number, number],
          iconAnchor: [12, 12] as [number, number],
        });
        const m = L.marker([poi.lat, poi.lng], { icon: divIcon });
        m.on('click', () => setSelectedPOI(poi));
        m.addTo(map);
        poiMarkersRef.current.push(m);
      });
  }, [showPOILayer, poiLayerData, poiTiposAtivos]);

  const salvarEstacao = useCallback(async (dados: Record<string, unknown>) => {
    try {
      if (dados.codigo) {
        // Modo edição — atualiza via Firestore direto
        const { doc, updateDoc } = await import('firebase/firestore');
        const { tipo, status, larguraFaixa, observacoes, privado, nomeConcorrente } = dados as any;
        await updateDoc(doc(db, 'estacoes', dados.codigo as string), {
          tipo, status,
          ...(larguraFaixa != null ? { larguraFaixa } : {}),
          ...(observacoes   ? { observacoes }   : {}),
          ...(privado       ? { privado }       : {}),
          ...(nomeConcorrente ? { nomeConcorrente } : {}),
        });
        showToast('Estacao atualizada!', 'success');
      } else {
        const res = await fnAddEstacao()(dados);
        const d = res.data as { ok: boolean; error?: string };
        if (!d.ok) throw new Error(d.error);
        showToast('Estacao adicionada!', 'success');
      }
      setDrawerAberto(false); setPinLatLng(null); setEstacaoEdit(null);
    } catch(e: unknown) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
    }
  }, [showToast]);


  // Edita zona existente
  const editarZona = async (id: string, dados: Record<string,unknown>) => {
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'poligonos', id), {
        ...dados,
        atualizadoEm: new Date()
      });
      setZonaEditando(null);
      setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 150);
    } catch(e: unknown) {
      alert('Erro ao editar zona: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Exclui zona
  const excluirZona = async (id: string) => {
    try {
      const { doc, deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'poligonos', id));
      setZonaEditando(null);
      if (poligonosOn) { setPoligonosOn(false); setTimeout(() => setPoligonosOn(true), 100); }
    } catch(e: unknown) {
      alert('Erro ao excluir zona: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Salva zona no Firestore
  const salvarZona = async (zona: Record<string,unknown>) => {
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      const id = 'ZONA-' + Date.now();
      await setDoc(doc(db, 'poligonos', id), {
        ...zona,
        id,
        criadoEm:     new Date(),
        atualizadoEm: new Date()
      });
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
      alert('Erro ao salvar zona: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', fontFamily: 'Inter,sans-serif' }}>
      {/* MAPA */}
      <div ref={mapRef} id="leaflet-map" style={{ width: '100%', height: '100%' }} />

      {/* Header */}
      <div ref={headerRef} style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'rgba(13,18,30,.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const
      }}>
        <span style={{ color: '#307FE2', fontWeight: 900, fontSize: 16, letterSpacing: -0.5 }}>JET OS</span>
        <button onClick={() => setCidadeModal(true)} style={{
          flex: 1, padding: '6px 12px', background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
          color: cidade ? '#fff' : 'rgba(255,255,255,.4)', fontSize: 13,
          cursor: 'pointer', textAlign: 'left'
        }}>
          {cidades.length > 0 ? `📍 ${cidades.join(' + ')}` : '🌎 Selecionar cidade...'}
        </button>
        {contagem > 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', whiteSpace: 'nowrap' }}>
            {contagem} est.
          </span>
        )}
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', display: 'none' } as React.CSSProperties}>{usuario.nome.split(' ')[0]}</span>
        {isGestor && (
          <button onClick={() => setUsuariosModulo(v => !v)} style={{
            background: usuariosModulo ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${usuariosModulo ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: usuariosModulo ? '#60a5fa' : 'rgba(255,255,255,.5)',
            padding: '4px 10px', fontSize: 11, cursor: 'pointer'
          }}>👥</button>
        )}
        <CandidatosManager
          mapCenter={(() => { const m = leafletRef.current; return m ? { lat: m.getCenter().lat, lng: m.getCenter().lng } : { lat: -23.55, lng: -46.63 }; })()}
          estacoes={estacoes.map((e: any) => ({ id: e.id || e.codigo, lat: e.lat, lng: e.lng, codigo: e.codigo }))}
          ridesAnalytics={(window as any).__jetRides || []}
          drawerAberto={drawerAberto}
          onAbrirDrawer={(lat, lng) => { setPinLatLng({ lat, lng }); setDrawerAberto(true); }}
          onCandidatosChange={setCandidatosLayer}
        />

        <button onClick={async () => {
          setShowPOILayer(v => {
            if (!v && cidade) {
              setPoiLoading(true);
              // busca POIs centrados na cidade atual usando o mapa
              const map = leafletRef.current;
              if (map) {
                const c = map.getCenter();
                // Overpass OSM — gratuito, sem Cloud Function
                const query = buildOverpassQuery(c.lat, c.lng, 3000);
                fetch('https://overpass-api.de/api/interpreter', {
                  method: 'POST',
                  body: 'data=' + encodeURIComponent(query),
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }).then(r => r.json()).then(json => {
                  const pois = parseOverpassElements(json.elements || [], c.lat, c.lng);
                  setPoiLayerData(pois);
                  setPoiTiposAtivos(new Set(pois.map((p: any) => p.tipo)));
                }).catch(() => {
                  showToast('Erro ao buscar POIs (Overpass)', 'error');
                }).finally(() => setPoiLoading(false));
              }
            }
            return !v;
          });
        }} style={{
          background: showPOILayer ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${showPOILayer ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
          borderRadius: 8, color: showPOILayer ? '#10b981' : 'rgba(255,255,255,.5)',
          fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
        }}>📍 POIs{poiLoading ? ' ...' : ''}</button>
        {isGestor && (
          <button onClick={() => setCidadesExpShow(v=>!v)} style={{
            padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:600,
            cursor:'pointer', border:`1px solid ${cidadesExpShow?'rgba(99,102,241,.4)':'rgba(255,255,255,.1)'}`,
            background: cidadesExpShow?'rgba(99,102,241,.1)':'rgba(255,255,255,.06)',
            color: cidadesExpShow?'#818cf8':'rgba(255,255,255,.5)',
          }}>🌍 Expansão{cidadesExp.length>0?` (${cidadesExp.length})`:''}</button>
        )}

        <button onClick={() => setShowLocaisOp(v => !v)} style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'6px 12px', borderRadius:8,
          border:`1px solid ${showLocaisOp?'rgba(52,211,153,.4)':'rgba(255,255,255,.1)'}`,
          background: showLocaisOp?'rgba(52,211,153,.1)':'rgba(255,255,255,.06)',
          color: showLocaisOp?'#34d399':'rgba(255,255,255,.5)',
          cursor:'pointer', fontSize:12, fontWeight:600,
        }}>
          📍 Geo Log{locaisOp.length>0?` (${locaisOp.length})`:''}
        </button>

        <button onClick={() => { setAnalyticsModulo(v => !v); setDashboardModulo(false); }} style={{
          background: analyticsModulo ? 'rgba(61,155,255,.15)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${analyticsModulo ? 'rgba(61,155,255,.3)' : 'rgba(255,255,255,.1)'}`,
          borderRadius: 8, color: analyticsModulo ? '#3d9bff' : 'rgba(255,255,255,.5)',
          fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
        }}>📊 Analytics</button>

        <button onClick={() => setDashboardModulo(v => !v)} style={{
          background: dashboardModulo ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${dashboardModulo ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
          borderRadius: 8, color: dashboardModulo ? '#60a5fa' : 'rgba(255,255,255,.5)',
          padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
        }}>📊 Dash</button>
        {isGestor && (
          <button onClick={() => setGuardModulo(v => !v)} style={{
            background: guardModulo ? 'rgba(167,139,250,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${guardModulo ? 'rgba(167,139,250,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: guardModulo ? '#a78bfa' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>🛡 Guard{ocorrenciasLayer.length > 0 ? ` (${ocorrenciasLayer.length})` : ''}</button>
        )}
        <LangSelector />
        <button onClick={onLogout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 18, cursor: 'pointer' }}>⏻</button>
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
          { k: 'CONCORRENTE', label: 'Conc', cor: '#ef4444' }
        ].map(f => (
          <button key={f.k} onClick={() => setFiltros(prev => {
            const n = new Set(prev);
            if (n.has(f.k)) n.delete(f.k); else n.add(f.k);
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
        {['TODOS','SOLICITADO','APROVADO','CANCELADO'].map(s => (
          <button key={s} onClick={() => setFiltroStatus(s)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
            background: filtroStatus === s ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)',
            color: filtroStatus === s ? '#fff' : 'rgba(255,255,255,.25)',
            outline: filtroStatus === s ? '1px solid rgba(255,255,255,.2)' : '1px solid rgba(255,255,255,.06)'
          }}>{s === 'TODOS' ? 'Todos' : s === 'CANCELADO' ? 'Cancelado' : s.charAt(0) + s.slice(1).toLowerCase()}</button>
        ))}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)', margin: '0 4px', flexShrink: 0 }} />
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)', margin: '0 4px', flexShrink: 0 }} />
        





        {/* Contador */}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,.3)',
          display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {contagem} est.
        </div>
      </div>

      {/* ── FABs de camadas — stack acima do + ─────────────────── */}
      <div style={{
        position: 'fixed', right: 16, bottom: 100, zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        {/* Geo Log add */}
        {showLocaisOp && (
          <button onClick={() => setModoAddLocal(m => !m)}
            title={modoAddLocal ? 'Cancelar' : 'Adicionar Geo Log'}
            style={{ width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: modoAddLocal ? 'rgba(239,68,68,.9)' : 'rgba(52,211,153,.9)',
              color: '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,.4)', transition: 'all .15s',
            }}>
            {modoAddLocal ? '✕' : '📍'}
          </button>
        )}
        {/* Satélite */}
        <button onClick={() => {
          const map = leafletRef.current; if (!map) return;
          if ((map as any)._satLayer) { map.removeLayer((map as any)._satLayer); (map as any)._satLayer = null; setSatOn(false); }
          else { const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{ attribution:'© Esri', maxZoom:19 }); sat.addTo(map); (map as any)._satLayer = sat; setSatOn(true); }
        }} title="Satélite" style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${satOn?'#fbbf24':'rgba(255,255,255,.15)'}`, cursor: 'pointer',
          background: satOn ? 'rgba(251,191,36,.2)' : 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
          color: satOn ? '#fbbf24' : 'rgba(255,255,255,.5)', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        }}>🛰</button>
        {/* Ciclovias */}
        {cidade && (
          <button onClick={() => setCicloviasOn(v => !v)} title="Ciclovias"
            style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${cicloviasOn?'#00e676':'rgba(255,255,255,.15)'}`, cursor: 'pointer',
              background: cicloviasOn ? 'rgba(0,230,118,.2)' : 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
              color: cicloviasOn ? '#00e676' : 'rgba(255,255,255,.5)', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>🚲</button>
        )}
        {/* Zonas */}
        {cidade && (
          <button onClick={() => setPoligonosOn(v => !v)} title="Zonas"
            style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${poligonosOn?'#60a5fa':'rgba(255,255,255,.15)'}`, cursor: 'pointer',
              background: poligonosOn ? 'rgba(96,165,250,.2)' : 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
              color: poligonosOn ? '#60a5fa' : 'rgba(255,255,255,.5)', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>⬡</button>
        )}
        {/* Nova cidade expansão */}
        {isGestor && cidadesExpShow && (
          <button onClick={() => setCidadeExpModal({ latLng: leafletRef.current ? (() => { const c = leafletRef.current!.getCenter(); return {lat:c.lat,lng:c.lng}; })() : {lat:0,lng:0} })}
            title="Adicionar cidade de expansão"
            style={{ width:40, height:40, borderRadius:10, border:'2px solid rgba(99,102,241,.4)',
              cursor:'pointer', background:'rgba(99,102,241,.15)', backdropFilter:'blur(8px)',
              color:'#818cf8', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🌍</button>
        )}

        {/* Gerir zonas — abre ZonasManager com edição de vértices */}
        {isGestor && poligonosOn && (
          <>
            <button onClick={() => setZonasModulo(v => !v)} title="Gerir zonas"
              style={{ width:40, height:40, borderRadius:10,
                border:`2px solid ${zonasModulo?'#c084fc':'rgba(255,255,255,.15)'}`,
                cursor:'pointer',
                background: zonasModulo?'rgba(192,132,252,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)',
                color: zonasModulo?'#c084fc':'rgba(255,255,255,.5)', fontSize:16,
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)',
              }}>⬡</button>
            <button onClick={() => setZonaEditor(v => !v)} title="Desenhar nova zona"
              style={{ width:40, height:40, borderRadius:10,
                border:`2px solid ${zonaEditor?'#c084fc':'rgba(255,255,255,.15)'}`,
                cursor:'pointer',
                background: zonaEditor?'rgba(192,132,252,.25)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)',
                color: zonaEditor?'#c084fc':'rgba(255,255,255,.5)', fontSize:16,
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)',
              }}>✏</button>
          </>
        )}

        {/* Raio */}
        <button onClick={() => setRaioAtivo(v => !v)} title={`Raio ${raioMetros}m`}
          style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${raioAtivo?'#a78bfa':'rgba(255,255,255,.15)'}`, cursor: 'pointer',
            background: raioAtivo ? 'rgba(167,139,250,.2)' : 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
            color: raioAtivo ? '#a78bfa' : 'rgba(255,255,255,.5)', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
          }}>{raioMetros}m</button>
        {raioAtivo && (
          <input type="range" min="50" max="500" step="25" value={raioMetros}
            onChange={e => setRaioMetros(Number(e.target.value))}
            style={{ width: 40, accentColor: '#a78bfa', cursor: 'pointer', writingMode: 'vertical-lr' as any, direction: 'rtl' as any, height: 80 }}
          />
        )}
        {/* Geolocalização */}
        <button onClick={() => navigator.geolocation.getCurrentPosition(p => leafletRef.current?.setView([p.coords.latitude, p.coords.longitude], 15))}
          title="Minha localização"
          style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,.15)', cursor: 'pointer',
            background: 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
            color: 'rgba(255,255,255,.6)', fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
          }}>◎</button>
      </div>

      {/* FAB adicionar */}
      <button onClick={() => { setModoAdd(m => !m); if (!modoAdd) showToast('Toque no mapa para posicionar', 'info'); }}
        style={{ position: 'fixed', right: 16, bottom: 32, width: 56, height: 56,
          borderRadius: '50%', border: 'none', zIndex: 1000, cursor: 'pointer',
          background: modoAdd ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
          boxShadow: '0 4px 24px rgba(48,127,226,.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {modoAdd
          ? <svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          : <svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        }
      </button>

      {/* FAB localização */}
      <button onClick={() => {
        navigator.geolocation.getCurrentPosition(p => {
          leafletRef.current?.setView([p.coords.latitude, p.coords.longitude], 15);
        });
      }} style={{ position: 'fixed', right: 16, bottom: 100, width: 44, height: 44,
        borderRadius: '50%', border: '1px solid rgba(255,255,255,.12)',
        background: 'rgba(13,18,30,.85)', backdropFilter: 'blur(12px)',
        color: 'rgba(255,255,255,.7)', cursor: 'pointer', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06z"/>
        </svg>
      </button>

      {/* Modal seleção de cidade */}
      {cidadeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1100,
          display: 'flex', alignItems: 'flex-end' }} onClick={() => setCidadeModal(false)}>
          <div style={{ width: '100%', background: '#1a1f2e', borderRadius: '16px 16px 0 0',
            padding: '20px', maxHeight: '75vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Selecionar cidades</div>
              {cidades.length > 0 && (
                <button onClick={() => { limparCidades(); setCidadeModal(false); }} style={{
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                  borderRadius: 6, color: '#f87171', fontSize: 11, padding: '3px 10px', cursor: 'pointer'
                }}>Limpar</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: cidades.length > 0 ? 10 : 16 }}>
              Selecione uma ou mais cidades para ver em conjunto
            </div>

            {/* Chips das cidades selecionadas */}
            {cidades.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {cidades.map(c => (
                  <span key={c} onClick={() => toggleCidade(c)} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: 'rgba(48,127,226,.25)', border: '1px solid rgba(48,127,226,.5)',
                    color: '#60a5fa', cursor: 'pointer'
                  }}>📍 {c} ×</span>
                ))}
                <button onClick={() => setCidadeModal(false)} style={{
                  padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: 'linear-gradient(135deg,#1a6fd4,#307FE2)', border: 'none',
                  color: '#fff', cursor: 'pointer'
                }}>Ver mapa</button>
              </div>
            )}

            {/* Cidades com estações */}
            {cidadesReais.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontWeight: 700,
                  letterSpacing: '.08em', marginBottom: 8 }}>COM ESTAÇÕES MAPEADAS</div>
                {cidadesReais.map(c => {
                  const sel = cidades.includes(c.cidade);
                  return (
                    <div key={c.cidade} onClick={() => toggleCidade(c.cidade)}
                      style={{
                        padding: '11px 14px', cursor: 'pointer', borderRadius: 8, marginBottom: 4,
                        background: sel ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${sel ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.06)'}`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 16, height: 16, borderRadius: 4,
                          background: sel ? '#307FE2' : 'rgba(255,255,255,.1)',
                          border: `2px solid ${sel ? '#307FE2' : 'rgba(255,255,255,.2)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, color: '#fff', flexShrink: 0
                        }}>{sel ? '✓' : ''}</div>
                        <span style={{ color: sel ? '#60a5fa' : 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: sel ? 600 : 400 }}>
                          {c.cidade}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 10, color: '#60a5fa', background: 'rgba(48,127,226,.15)',
                        border: '1px solid rgba(48,127,226,.2)', borderRadius: 10, padding: '1px 7px'
                      }}>{c.count} est.</span>
                    </div>
                  );
                })}
              </>
            )}

            {/* Planejamento — gestor/admin */}
            {isGestor && (() => {
              const comEstacoes = new Set(cidadesReais.map(c => c.cidade));
              const paraPlanejar = (CIDADES[pais] || []).filter(c => !comEstacoes.has(c));
              if (!paraPlanejar.length) return null;
              return (
                <>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', fontWeight: 700,
                    letterSpacing: '.08em', marginTop: 16, marginBottom: 8 }}>PLANEJAMENTO (sem estações)</div>
                  {paraPlanejar.map(c => {
                    const sel = cidades.includes(c);
                    return (
                      <div key={c} onClick={() => toggleCidade(c)}
                        style={{
                          padding: '10px 14px', cursor: 'pointer', borderRadius: 8, marginBottom: 4,
                          background: sel ? 'rgba(168,85,247,.15)' : 'rgba(255,255,255,.02)',
                          border: `1px solid ${sel ? 'rgba(168,85,247,.3)' : 'rgba(255,255,255,.04)'}`,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: 4,
                            background: sel ? '#a855f7' : 'rgba(255,255,255,.08)',
                            border: `2px solid ${sel ? '#a855f7' : 'rgba(255,255,255,.15)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, color: '#fff', flexShrink: 0
                          }}>{sel ? '✓' : ''}</div>
                          <span style={{ color: sel ? '#c084fc' : 'rgba(255,255,255,.4)', fontSize: 13 }}>{c}</span>
                        </div>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,.25)' }}>planejamento</span>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* pins de cidade adicionados via useEffect */}

      {/* Drawer adicionar estacao */}
      {drawerAberto && pinLatLng && (
        <DrawerAdd latLng={pinLatLng} cidadeAtual={cidade} pais={pais}
          fotoInicial={fotoParaDrawer}
          estacaoEdit={estacaoEdit}
          onSalvar={salvarEstacao}
          onFechar={() => { setDrawerAberto(false); setPinLatLng(null); setEstacaoEdit(null); setFotoParaDrawer(''); if ((window as any).__pinMarker) { (window as any).__pinMarker.remove(); (window as any).__pinMarker = null; } }} />
      )}

      {/* POI Actions Popup */}
      {selectedPOI && (
        <POIActionsPopup
          poi={selectedPOI}
          estacoes={estacoes.map((e: any) => ({ lat: e.lat, lng: e.lng, codigo: e.codigo, bairro: e.bairro }))}
          onAddEstacao={(lat, lng) => {
            setPinLatLng({ lat, lng });
            setDrawerAberto(true);
            setSelectedPOI(null);
          }}
          onStreetView={(lat, lng, nome) => {
            setStreetViewTarget({ lat, lng, nome });
            setSelectedPOI(null);
          }}
          onClose={() => setSelectedPOI(null)}
        />
      )}

      {/* Modal Cidades Expansão */}
      {cidadeExpModal && (
        <CidadeExpansaoModal
          editando={cidadeExpModal.editando}
          latLng={cidadeExpModal.latLng}
          onFechar={() => setCidadeExpModal(null)}
          showToast={showToast}
        />
      )}

      {/* Analytics station info popup */}
      {analyticsStationInfo && (() => {
        const isHover = analyticsStationInfo._hover;
        const px = analyticsStationInfo._x || 0;
        const py = analyticsStationInfo._y || 0;
        // Offset popup so it doesn't cover the station dot
        const left = Math.min(px + 12, window.innerWidth - 340);
        const top  = Math.min(py - 20, window.innerHeight - 420);
        return (
        <div style={{position:'fixed', zIndex:4000,
          ...(isHover
            ? {left: Math.max(8, left), top: Math.max(8, top), pointerEvents:'none'}
            : {inset:'0',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.6)',backdropFilter:'blur(4px)'})}}
          onClick={isHover ? undefined : ()=>setAnalyticsStationInfo(null)}>
          <div style={{background:'#0c1018',border:'1px solid #1c2535',borderRadius:12,padding:16,width:300,maxWidth:'94vw',boxShadow:'0 8px 32px rgba(0,0,0,.9)'}}
            onClick={e=>e.stopPropagation()}>
            {/* Header */}
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:14}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:'#dce8ff',wordBreak:'break-word' as any,lineHeight:1.3}}>
                  {analyticsStationInfo.endereco && analyticsStationInfo.endereco !== analyticsStationInfo.codigo
                    ? analyticsStationInfo.endereco
                    : analyticsStationInfo.bairro || analyticsStationInfo.codigo}
                </div>
                <div style={{fontSize:10,color:'#4a5a7a',marginTop:3}}>
                  {[analyticsStationInfo.bairro, analyticsStationInfo.codigo].filter(Boolean).join(' · ')}
                </div>
              </div>
              {!analyticsStationInfo._hover && <button onClick={()=>setAnalyticsStationInfo(null)} style={{background:'none',border:'none',color:'#4a5a7a',cursor:'pointer',fontSize:18,flexShrink:0,marginLeft:8}}>✕</button>}
            </div>
            {/* KPIs */}
            {analyticsStationInfo.total > 0 ? (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:12}}>
                {([['Corridas',analyticsStationInfo.total,'#3d9bff'],['Inícios',analyticsStationInfo.starts,'#2ecc71'],['Fins',analyticsStationInfo.ends,'#f5c842']] as [string,number,string][]).map(([l,v,c])=>(
                  <div key={l} style={{background:'rgba(255,255,255,.03)',borderRadius:6,padding:'8px 4px',textAlign:'center',border:'1px solid rgba(255,255,255,.06)'}}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:700,color:c as string}}>{v}</div>
                    <div style={{fontSize:9,color:'#4a5a7a',marginTop:1}}>{l}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{padding:'8px 10px',background:'rgba(255,255,255,.03)',borderRadius:6,border:'1px solid rgba(255,255,255,.06)',fontSize:11,color:'rgba(255,255,255,.3)',textAlign:'center',marginBottom:12}}>
                Sem corridas no período selecionado
              </div>
            )}
            {/* Receita */}
            {analyticsStationInfo.rev>0 && (
              <div style={{padding:'7px 10px',background:'rgba(245,200,66,.06)',borderRadius:6,border:'1px solid rgba(245,200,66,.15)',textAlign:'center',marginBottom:12}}>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:15,fontWeight:700,color:'#f5c842'}}>R${(analyticsStationInfo.rev as number).toFixed(0)}</span>
                <span style={{fontSize:10,color:'#4a5a7a',marginLeft:6}}>receita no período</span>
              </div>
            )}
            {/* Corridas por hora */}
            {analyticsStationInfo.byHour && Object.keys(analyticsStationInfo.byHour).length > 0 && (() => {
              const bh = analyticsStationInfo.byHour as Record<string,number>;
              const max = Math.max(...Array.from({length:24},(_,h)=>bh[String(h)]||0), 1);
              const BAR_H = 44;
              return (
                <div>
                  <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase' as any,letterSpacing:.8,color:'rgba(255,255,255,.25)',marginBottom:6}}>Corridas por hora</div>
                  {/* Chart area */}
                  <div style={{position:'relative',height:BAR_H+16,marginBottom:8}}>
                    {/* Bars */}
                    <div style={{display:'flex',alignItems:'flex-end',gap:1,height:BAR_H,position:'absolute',top:0,left:0,right:0}}>
                      {Array.from({length:24},(_,h)=>{
                        const v = bh[String(h)]||0;
                        const pct = v/max;
                        const barH = Math.max(pct>0?2:0, Math.round(pct*BAR_H));
                        const col = pct>0.7?'#3d9bff':pct>0.4?'rgba(61,155,255,.7)':pct>0.1?'rgba(61,155,255,.4)':'rgba(255,255,255,.08)';
                        return (
                          <div key={h} style={{flex:1,height:'100%',display:'flex',flexDirection:'column' as any,justifyContent:'flex-end'}} title={h+'h: '+v+' corridas'}>
                            <div style={{width:'100%',height:barH,background:col,borderRadius:'2px 2px 0 0',transition:'height .15s'}}/>
                          </div>
                        );
                      })}
                    </div>
                    {/* X-axis labels — aligned under bars */}
                    <div style={{display:'flex',alignItems:'flex-end',gap:1,height:16,position:'absolute',bottom:0,left:0,right:0}}>
                      {Array.from({length:24},(_,h)=>(
                        <div key={h} style={{flex:1,textAlign:'center' as any,fontSize:7,color:'#4a5a7a',lineHeight:'16px'}}>
                          {h%6===0?h+'h':''}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Peak chips */}
                  <div style={{display:'flex',gap:5,flexWrap:'wrap' as any}}>
                    {Array.from({length:24},(_,h)=>({h,v:bh[String(h)]||0}))
                      .sort((a,b)=>b.v-a.v).slice(0,3).filter(x=>x.v>0)
                      .map(({h,v},i)=>(
                        <div key={h} style={{padding:'3px 8px',borderRadius:8,fontSize:9,fontWeight:600,
                          background:i===0?'rgba(61,155,255,.2)':i===1?'rgba(61,155,255,.12)':'rgba(61,155,255,.07)',
                          border:`1px solid ${i===0?'rgba(61,155,255,.5)':'rgba(61,155,255,.2)'}`,
                          color:i===0?'#3d9bff':'rgba(61,155,255,.7)'}}>
                          {h}h · {v} corridas
                        </div>
                      ))
                    }
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        );
      })()}

      {candidatoPopup && (
        <div style={{position:'fixed',inset:'0',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.6)',backdropFilter:'blur(4px)'}}
          onClick={()=>setCandidatoPopup(null)}>
          <div style={{background:'#0c1018',border:'1px solid #1c2535',borderRadius:12,padding:20,width:300,maxWidth:'92vw',boxShadow:'0 20px 60px rgba(0,0,0,.9)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
              <div style={{width:36,height:36,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:700,
                color:candidatoPopup.candidato.score>=70?'#2ecc71':candidatoPopup.candidato.score>=40?'#f5c842':'#ff6b35',
                background:candidatoPopup.candidato.score>=70?'rgba(46,204,113,.15)':candidatoPopup.candidato.score>=40?'rgba(245,200,66,.15)':'rgba(255,107,53,.15)',
                border:'2px solid '+(candidatoPopup.candidato.score>=70?'#2ecc71':candidatoPopup.candidato.score>=40?'#f5c842':'#ff6b35')}}>
                {candidatoPopup.candidato.score}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:'#dce8ff'}}>Candidato #{candidatoPopup.index+1}</div>
                <div style={{fontSize:10,color:'#4a5a7a',fontFamily:"'IBM Plex Mono',monospace"}}>{candidatoPopup.candidato.lat.toFixed(5)}, {candidatoPopup.candidato.lng.toFixed(5)}</div>
              </div>
              <button onClick={()=>setCandidatoPopup(null)} style={{background:'none',border:'none',color:'#4a5a7a',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:14}}>
              {([['Gap JET',candidatoPopup.candidato.distanciaEstacao+'m','#3d9bff'],['Corridas',candidatoPopup.candidato.semAnalytics?'—':String(candidatoPopup.candidato.corridasProximas),'#2ecc71'],['POIs',String(candidatoPopup.candidato.poisProximos.length),'#f5c842']] as [string,string,string][]).map(([l,v,c])=>(
                <div key={l} style={{background:'rgba(255,255,255,.03)',borderRadius:6,padding:'8px 6px',textAlign:'center',border:'1px solid rgba(255,255,255,.06)'}}>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:700,color:c}}>{v}</div>
                  <div style={{fontSize:9,color:'#4a5a7a',marginTop:1}}>{l}</div>
                </div>
              ))}
            </div>
            {candidatoPopup.candidato.poisProximos.length>0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:14}}>
                {candidatoPopup.candidato.poisProximos.map(p=>(
                  <div key={p} style={{padding:'2px 8px',borderRadius:8,background:'rgba(245,200,66,.1)',border:'1px solid rgba(245,200,66,.2)',fontSize:9,color:'#f5c842'}}>{p}</div>
                ))}
              </div>
            )}
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <button onClick={()=>{setPinLatLng({lat:candidatoPopup.candidato.lat,lng:candidatoPopup.candidato.lng});setDrawerAberto(true);setCandidatoPopup(null);}}
                style={{width:'100%',padding:'11px',borderRadius:7,border:'none',background:'linear-gradient(135deg,#1a6fd4,#307FE2)',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                <span style={{fontSize:16}}>📍</span> Adicionar estação aqui
              </button>
              <div style={{display:'flex',gap:5}}>
                <button onClick={()=>{if(leafletRef.current)leafletRef.current.setView([candidatoPopup.candidato.lat,candidatoPopup.candidato.lng],19);setCandidatoPopup(null);}}
                  style={{flex:1,padding:'8px',borderRadius:6,border:'1px solid #1c2535',background:'rgba(255,255,255,.04)',color:'rgba(255,255,255,.5)',fontSize:11,cursor:'pointer'}}>
                  🗺 Ver no mapa
                </button>
                <button onClick={()=>{window.dispatchEvent(new CustomEvent('jetOpenSV',{detail:{lat:candidatoPopup.candidato.lat,lng:candidatoPopup.candidato.lng,nome:'Candidato #'+(candidatoPopup.index+1)}}));setCandidatoPopup(null);}}
                  style={{flex:1,padding:'8px',borderRadius:6,border:'1px solid #1c2535',background:'rgba(255,255,255,.04)',color:'rgba(255,255,255,.5)',fontSize:11,cursor:'pointer'}}>
                  🌐 Street View
                </button>
                <button onClick={()=>navigator.clipboard.writeText(candidatoPopup.candidato.lat.toFixed(6)+', '+candidatoPopup.candidato.lng.toFixed(6))}
                  style={{padding:'8px 10px',borderRadius:6,border:'1px solid #1c2535',background:'rgba(255,255,255,.04)',color:'rgba(255,255,255,.5)',fontSize:11,cursor:'pointer'}}>
                  📋
                </button>
              </div>
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
            const svCtx = streetViewTarget as any;
            setFotoCapturaCtx(svCtx?.estacaoId
              ? { context: 'existente', lat: svCtx.lat, lng: svCtx.lng, estacaoId: svCtx.estacaoId, estacaoCodigo: svCtx.estacaoCodigo }
              : { context: 'novo',      lat: svCtx?.lat, lng: svCtx?.lng }
            );
            setStreetViewTarget(null);
          }}
        />
      )}

      {/* FotoCaptura modal */}
      {fotoCapturaCtx && (
        <FotoCaptura
          context={fotoCapturaCtx.context}
          origem={(fotoCapturaCtx as any).origem || 'campo'}
          lat={fotoCapturaCtx.lat}
          lng={fotoCapturaCtx.lng}
          estacaoId={fotoCapturaCtx.estacaoId}
          estacaoCodigo={fotoCapturaCtx.estacaoCodigo}
          onFotoSalva={(url, ctx) => {
            if (ctx === 'novo') {
              // Abre drawer com foto vinculada
              setFotoParaDrawer(url);
              if (fotoCapturaCtx.lat && fotoCapturaCtx.lng) {
                setPinLatLng({ lat: fotoCapturaCtx.lat!, lng: fotoCapturaCtx.lng! });
                setDrawerAberto(true);
              }
              showToast('Foto salva — complete o cadastro', 'success');
            } else {
              // Estação existente — atualiza no Firestore
              const id = fotoCapturaCtx.estacaoId;
              if (id) {
                import('./lib/firebase').then(({ db }) => {
                  import('firebase/firestore').then(({ doc, updateDoc }) => {
                    updateDoc(doc(db, 'estacoes', id), { 'imagens.foto': url })
                      .then(() => showToast('Foto associada à estação', 'success'))
                      .catch(() => showToast('Erro ao salvar foto', 'error'));
                  });
                });
              }
            }
          }}
          onClose={() => setFotoCapturaCtx(null)}
        />
      )}

      {/* Locais Operacionais filter bar */}
      {showLocaisOp && (
        <div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',zIndex:1000,display:'flex',gap:6,padding:'8px 12px',background:'rgba(8,11,18,.92)',borderRadius:8,border:'1px solid rgba(255,255,255,.1)',alignItems:'center'}}>
          <span style={{fontSize:9,color:'rgba(255,255,255,.3)',textTransform:'uppercase',letterSpacing:.8,paddingRight:4}}>Geo Log</span>
          {(Object.keys(TIPO_LOCAL_META) as TipoLocal[]).map(t => {
            const m = TIPO_LOCAL_META[t];
            const on = tiposFiltroLocais.has(t);
            const cnt = locaisOp.filter(l => l.tipo === t).length;
            return (
              <div key={t} onClick={() => setTiposFiltroLocais(prev => { const n=new Set(prev); n.has(t)?n.delete(t):n.add(t); return n; })}
                style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:6,border:`1px solid ${on?m.color+'66':'rgba(255,255,255,.1)'}`,background:on?m.bgColor:'transparent',color:on?m.color:'rgba(255,255,255,.3)',cursor:'pointer',fontSize:11,fontWeight:on?700:400,transition:'all .12s'}}>
                {m.icon} {m.label} <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10}}>{cnt}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* LocalOperacional Modal */}
      {localOpModal && (
        <LocalOperacionalModal
          latLng={localOpModal.latLng}
          cidade={cidade}
          pais={pais}
          editando={localOpModal.editando}
          onFechar={() => { setLocalOpModal(null); setModoAddLocal(false); }}
          showToast={showToast}
        />
      )}

      {/* POI Filter overlay */}
      {showPOILayer && poiLayerData.length > 0 && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 1000 }}>
          <POIMapFilter tiposAtivos={poiTiposAtivos} onChange={setPoiTiposAtivos} />
        </div>
      )}

      {/* Analytics */}
      {analyticsModulo && (
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

      {/* Guard Overlay — gestor/admin vê ocorrências no mapa */}
      {guardModulo && isGestor && (
        <GuardOverlay
          mapInstance={leafletRef.current}
          onOcorrenciasChange={setOcorrenciasLayer}
          onFechar={() => setGuardModulo(false)}
          cidade={cidade}
        />
      )}

      {/* Dashboard */}
      {dashboardModulo && (
        <DashboardManager
          cidades={cidades}
          pais={pais}
          onFechar={() => setDashboardModulo(false)}
          roleAtual={usuario.role}
        />
      )}

      {/* Painel de usuários — gestor/admin */}
      {usuariosModulo && (
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

      {toast && <Toast msg={toast.msg} tipo={toast.tipo} />}

      {/* CSS Leaflet popup override */}
      <style>{`
        .leaflet-popup-content-wrapper { border-radius: 10px !important; }
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
    </div>
  );
}

// ── DRAWER ADD ───────────────────────────────────────────────────
// ── ASSINATURA VIRTUAL ──────────────────────────────────────────
function PadAssinatura({ onSalvar, onCancelar }: {
  onSalvar: (dataUrl: string) => void;
  onCancelar: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing   = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });

  const getPos = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const start = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current!;
    lastPos.current = getPos(e, canvas);
  };

  const move = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#307FE2';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const end = () => { drawing.current = false; };

  const limpar = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#1a1f2e', borderRadius: 14, padding: 20, width: '100%', maxWidth: 340 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
          Assinatura do autorizante
        </div>
        <canvas ref={canvasRef} width={300} height={150}
          style={{ background: '#fff', borderRadius: 8, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={limpar} style={{ flex: 1, padding: 10,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.6)', fontSize: 12, cursor: 'pointer' }}>
            Limpar
          </button>
          <button onClick={onCancelar} style={{ flex: 1, padding: 10,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 8, color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer' }}>
            Pular
          </button>
          <button onClick={() => onSalvar(canvasRef.current!.toDataURL())} style={{ flex: 1, padding: 10,
            background: 'linear-gradient(135deg,#1a6fd4,#307FE2)', border: 'none',
            borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DRAWER ADD/EDIT ──────────────────────────────────────────────
const CONCORRENTES = ['Tembici','Whoosh','Outro'];

function DrawerAdd({ latLng, cidadeAtual, pais, fotoInicial, onSalvar, onFechar, estacaoEdit }: {
  latLng: {lat:number;lng:number};
  cidadeAtual: string;
  pais: string;
  fotoInicial?: string;
  onSalvar: (d: Record<string, unknown>) => Promise<void>;
  onFechar: () => void;
  estacaoEdit?: Estacao | null;
}) {
  const [tipo,        setTipo]        = useState(estacaoEdit?.tipo      || 'PUBLICA');
  const [status,      setStatus]      = useState(estacaoEdit?.status    || 'SOLICITADO');
  const [largura,     setLargura]     = useState(String(estacaoEdit?.larguraFaixa || ''));
  const [obs,         setObs]         = useState('');
  const [fotoUrl,     setFotoUrl]     = useState(fotoInicial || '');
  const [geo,         setGeo]         = useState<Record<string,string>>({ cidade: cidadeAtual, pais });
  const [geoLoading,  setGeoLoading]  = useState(true);
  const [busy,        setBusy]        = useState(false);

  // Privado
  const [nomeLocal,   setNomeLocal]   = useState('');
  const [nomeAuth,    setNomeAuth]    = useState('');
  const [cargoAuth,   setCargoAuth]   = useState('');
  const [telAuth,     setTelAuth]     = useState('');
  const [emailAuth,   setEmailAuth]   = useState('');
  const [assinatura,  setAssinatura]  = useState('');
  const [showPad,     setShowPad]     = useState(false);

  // Concorrente
  const [nomeConcorrente, setNomeConcorrente] = useState('');
  const [outroConc,       setOutroConc]       = useState('');

  const modoEdicao = !!estacaoEdit;
  const [drawerTab, setDrawerTab] = useState<'form'|'pois'>('form');

  // Geocode reverso — tenta Cloud Function, fallback Nominatim (OSM)
  useEffect(() => {
    setGeoLoading(true);

    const buscarNominatim = () =>
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latLng.lat}&lon=${latLng.lng}&format=json&accept-language=pt-BR`)
        .then(r => r.json())
        .then(d => {
          if (d.address) {
            const a = d.address;
            setGeo({
              endereco:  d.display_name || '',
              bairro:    a.suburb || a.neighbourhood || a.city_district || '',
              cidade:    a.city || a.town || a.municipality || cidadeAtual,
              estado:    a.state || '',
              pais:      a.country_code?.toUpperCase() === 'MX' ? 'MX' : 'BR',
              alcaldia:  a.country_code?.toUpperCase() === 'MX' ? (a.city_district || '') : ''
            });
          }
        });

    fnReverseGeocode()({ lat: latLng.lat, lng: latLng.lng })
      .then(r => {
        const d = r.data as { ok: boolean; geo?: Record<string,string> };
        if (d.ok && d.geo && d.geo.endereco) {
          setGeo(d.geo);
        } else {
          return buscarNominatim();
        }
      })
      .catch(() => buscarNominatim())
      .finally(() => setGeoLoading(false));
  }, [latLng.lat, latLng.lng]);

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6
  };

  const handleSalvar = async () => {
    setBusy(true);
    const privado = tipo === 'PRIVADA' ? {
      nomeLocal, nomeAutorizante: nomeAuth, cargoAutorizante: cargoAuth,
      telefone: telAuth, email: emailAuth,
      assinatura: assinatura || null
    } : null;

    const conc = tipo === 'CONCORRENTE'
      ? (nomeConcorrente === 'Outro' ? outroConc : nomeConcorrente)
      : null;

    await onSalvar({
      lat: latLng.lat, lng: latLng.lng,
      tipo, status,
      larguraFaixa: largura ? parseFloat(largura) : null,
      observacoes:  obs     || null,
      nomeConcorrente: conc,
      privado,
      geo, pais: geo.pais || pais,
      ...(modoEdicao ? { codigo: estacaoEdit!.codigo } : {})
    });
    setBusy(false);
  };

  return (
    <>
      <div style={{ position: 'fixed', top: 0, right: 0, width: 340, height: '100%',
        background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(255,255,255,.08)', zIndex: 450,
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
              {modoEdicao ? 'Editar estacao' : 'Nova estacao'}
            </div>
            {modoEdicao && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>
                {estacaoEdit!.codigo}
              </div>
            )}
          </div>
          {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <button onClick={() => setDrawerTab('form')} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: drawerTab === 'form' ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.06)', color: drawerTab === 'form' ? '#60a5fa' : 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          📋 Formulário
        </button>
        <button onClick={() => setDrawerTab('pois')} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: drawerTab === 'pois' ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.06)', color: drawerTab === 'pois' ? '#10b981' : 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          📍 POIs próximos
        </button>
      </div>
      <button onClick={onFechar} style={{ background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
            color: 'rgba(255,255,255,.5)', width: 30, height: 30, cursor: 'pointer', fontSize: 16 }}>x</button>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20,
          flexDirection: 'column', gap: 16, display: drawerTab === 'form' ? 'flex' : 'none' }}>

          {/* Endereço — geocode automático */}
          <div style={{ padding: 12, borderRadius: 10,
            background: geoLoading ? 'rgba(255,255,255,.03)' : 'rgba(48,127,226,.08)',
            border: `1px solid ${geoLoading ? 'rgba(255,255,255,.06)' : 'rgba(48,127,226,.2)'}`,
            fontSize: 12, color: 'rgba(255,255,255,.6)', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
            {geoLoading ? (
              <span style={{ color: 'rgba(255,255,255,.3)' }}>Buscando endereco...</span>
            ) : (
              <>
                <div style={{ color: '#60a5fa', fontWeight: 600, marginBottom: 3 }}>
                  {geo.cidade}{geo.bairro ? ` · ${geo.bairro}` : ''}
                </div>
                <div>{geo.endereco}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 3 }}>
                  {latLng.lat.toFixed(6)}, {latLng.lng.toFixed(6)}
                </div>
              </>
            )}
          </div>

          {/* Foto vinculada */}
          {fotoUrl && (
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(16,185,129,.3)', position: 'relative' }}>
              <img src={fotoUrl} alt="foto" style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(16,185,129,.9)', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#fff', fontWeight: 600 }}>📷 Foto vinculada</div>
              <button onClick={() => setFotoUrl('')} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}>✕</button>
            </div>
          )}

          {/* Tipo */}
          <div>
            <label style={lbl}>Tipo de estacao</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { k: 'PUBLICA',      label: 'Publica',      cor: '#3b82f6' },
                { k: 'PRIVADA',      label: 'Privada',      cor: '#f59e0b' },
                { k: 'CONCORRENTE',  label: 'Concorrente',  cor: '#ef4444' }
              ].map(t => (
                <button key={t.k} onClick={() => setTipo(t.k)} style={{
                  flex: 1, padding: '9px 4px', borderRadius: 8, fontSize: 10,
                  fontWeight: 600, cursor: 'pointer',
                  background: tipo === t.k ? `${t.cor}22` : 'rgba(255,255,255,.04)',
                  border: `1px solid ${tipo === t.k ? t.cor + '66' : 'rgba(255,255,255,.08)'}`,
                  color: tipo === t.k ? t.cor : 'rgba(255,255,255,.4)'
                }}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label style={lbl}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              style={{ ...inp, appearance: 'none' }}>
              {['SOLICITADO','APROVADO','REPROVADO','INSTALADO','CANCELADO'].map(s =>
                <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Largura faixa */}
          <div>
            <label style={lbl}>Largura da faixa livre (m)</label>
            <input type="number" step="0.1" min="0" value={largura}
              onChange={e => setLargura(e.target.value)}
              placeholder="ex: 3.5" style={inp} />
          </div>

          {/* === CONCORRENTE === */}
          {tipo === 'CONCORRENTE' && (
            <div style={{ padding: 14, borderRadius: 10,
              background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)',
              display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>
                Dados do concorrente
              </div>
              <div>
                <label style={lbl}>Empresa</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CONCORRENTES.map(c => (
                    <button key={c} onClick={() => setNomeConcorrente(c)} style={{
                      padding: '6px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                      background: nomeConcorrente === c ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.04)',
                      border: `1px solid ${nomeConcorrente === c ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.08)'}`,
                      color: nomeConcorrente === c ? '#f87171' : 'rgba(255,255,255,.4)'
                    }}>{c}</button>
                  ))}
                </div>
              </div>
              {nomeConcorrente === 'Outro' && (
                <div>
                  <label style={lbl}>Nome do concorrente</label>
                  <input value={outroConc} onChange={e => setOutroConc(e.target.value)}
                    placeholder="Nome da empresa" style={inp} />
                </div>
              )}
            </div>
          )}

          {/* === PRIVADO === */}
          {tipo === 'PRIVADA' && (
            <div style={{ padding: 14, borderRadius: 10,
              background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)',
              display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>
                Dados do local privado
              </div>
              <div>
                <label style={lbl}>Nome do local</label>
                <input value={nomeLocal} onChange={e => setNomeLocal(e.target.value)}
                  placeholder="ex: Shopping Iguatemi" style={inp} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>
                Autorizante
              </div>
              <div>
                <label style={lbl}>Nome completo</label>
                <input value={nomeAuth} onChange={e => setNomeAuth(e.target.value)}
                  placeholder="Nome do responsavel" style={inp} />
              </div>
              <div>
                <label style={lbl}>Cargo</label>
                <input value={cargoAuth} onChange={e => setCargoAuth(e.target.value)}
                  placeholder="ex: Gerente de operacoes" style={inp} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Telefone</label>
                  <input value={telAuth} onChange={e => setTelAuth(e.target.value)}
                    placeholder="(41) 99999-9999" style={inp} type="tel" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>E-mail</label>
                  <input value={emailAuth} onChange={e => setEmailAuth(e.target.value)}
                    placeholder="email@local.com" style={inp} type="email" />
                </div>
              </div>

              {/* Assinatura */}
              <div>
                <label style={lbl}>Assinatura (opcional)</label>
                {assinatura ? (
                  <div style={{ position: 'relative' }}>
                    <img src={assinatura} style={{ width: '100%', background: '#fff',
                      borderRadius: 8, border: '1px solid rgba(255,255,255,.1)' }} />
                    <button onClick={() => setAssinatura('')} style={{
                      position: 'absolute', top: 6, right: 6,
                      background: 'rgba(239,68,68,.8)', border: 'none', borderRadius: 6,
                      color: '#fff', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
                      Limpar
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setShowPad(true)} style={{
                    width: '100%', padding: 12,
                    background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
                    borderRadius: 8, color: 'rgba(255,255,255,.4)', fontSize: 12, cursor: 'pointer'
                  }}>
                    Assinar aqui
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Observações */}
          <div>
            <label style={lbl}>Observacoes</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)}
              rows={3} placeholder="Informacoes adicionais..."
              style={{ ...inp, resize: 'vertical', minHeight: 72 }} />
          </div>
        </div>

        {/* Footer — sempre visível */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,.06)',
          display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onFechar} style={{ flex: 1, padding: 12,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button disabled={busy} onClick={handleSalvar} style={{ flex: 2, padding: 12,
            background: busy ? 'rgba(48,127,226,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Salvando...' : modoEdicao ? 'Salvar alteracoes' : 'Adicionar estacao'}
          </button>
        </div>

      {/* POI Tab */}
      {drawerTab === 'pois' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <POIPanel
            lat={latLng.lat}
            lng={latLng.lng}
            raio={400}
            onSugerirEndereco={(endereco) => {
              setGeo(g => ({ ...g, endereco }));
              setDrawerTab('form');
            }}
          />
        </div>
      )}

      {showPad && (
        <PadAssinatura
          onSalvar={(dataUrl) => { setAssinatura(dataUrl); setShowPad(false); }}
          onCancelar={() => setShowPad(false)}
        />
      )}
      </div>
    </>
  );
}


// ── MODAL EDITAR ZONA EXISTENTE ─────────────────────────────────
function ZonaEditModal({ zona, onSalvar, onExcluir, onFechar }: {
  zona: Record<string,unknown>;
  onSalvar: (id: string, dados: Record<string,unknown>) => Promise<void>;
  onExcluir: (id: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [nome,       setNome]       = useState(String(zona.nome       || ''));
  const [grupo,      setGrupo]      = useState(String(zona.grupo      || 'Geral'));
  const [fase,       setFase]       = useState(String(zona.fase       || 'Fase 1'));
  const [cor,        setCor]        = useState(String(zona.cor        || '#2563eb'));
  const [prioridade, setPrioridade] = useState(String(zona.prioridade || '1'));
  const [ativo,      setAtivo]      = useState(zona.ativo !== false);
  const [busy,       setBusy]       = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const CORES = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d'];
  const FASES = ['Fase 1','Fase 2','Fase 3','Expansão','Piloto','Concluída'];

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#1a1f2e', borderRadius: 14, padding: 24,
        width: '100%', maxWidth: 340, border: '1px solid rgba(255,255,255,.08)',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc' }}>Editar Zona</div>
          <button onClick={onFechar} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.5)', width: 28, height: 28,
            cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Nome da área</label>
            <input value={nome} onChange={e => setNome(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Grupo</label>
            <input value={grupo} onChange={e => setGrupo(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Fase</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FASES.map(f => (
                <button key={f} onClick={() => setFase(f)} style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
                  background: fase === f ? 'rgba(192,132,252,.2)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${fase === f ? 'rgba(192,132,252,.4)' : 'rgba(255,255,255,.08)'}`,
                  color: fase === f ? '#c084fc' : 'rgba(255,255,255,.4)'
                }}>{f}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Cor</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CORES.map(c => (
                <button key={c} onClick={() => setCor(c)} style={{
                  width: 28, height: 28, borderRadius: '50%', background: c,
                  border: cor === c ? '3px solid white' : '2px solid transparent',
                  cursor: 'pointer'
                }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Prioridade</label>
              <input type="number" min="1" max="10" value={prioridade}
                onChange={e => setPrioridade(e.target.value)} style={{ ...inp, width: 80 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Ativo</label>
              <button onClick={() => setAtivo(v => !v)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                background: ativo ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${ativo ? 'rgba(16,185,129,.4)' : 'rgba(255,255,255,.1)'}`,
                color: ativo ? '#6ee7b7' : 'rgba(255,255,255,.4)'
              }}>{ativo ? 'Sim' : 'Não'}</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)} style={{
              padding: '11px 14px',
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              borderRadius: 10, color: '#f87171', fontSize: 12, cursor: 'pointer'
            }}>🗑</button>
          ) : (
            <button onClick={async () => {
              setBusy(true);
              await onExcluir(zona.id as string);
              setBusy(false);
            }} style={{
              padding: '11px 14px',
              background: 'rgba(239,68,68,.2)', border: '1px solid rgba(239,68,68,.4)',
              borderRadius: 10, color: '#f87171', fontSize: 11, fontWeight: 700, cursor: 'pointer'
            }}>Confirmar exclusão</button>
          )}
          <button onClick={onFechar} style={{
            flex: 1, padding: 11,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer'
          }}>Cancelar</button>
          <button disabled={busy} onClick={async () => {
            setBusy(true);
            await onSalvar(zona.id as string, { nome, grupo, fase, cor, prioridade: parseInt(prioridade)||1, ativo });
            setBusy(false);
          }} style={{
            flex: 2, padding: 11,
            background: busy ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
          }}>{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CRIAR/EDITAR ZONA ─────────────────────────────────────
function ZonaFormModal({ coords, cidade, pais, onSalvar, onCancelar }: {
  coords: [number,number][];
  cidade: string;
  pais: string;
  onSalvar: (zona: Record<string,unknown>) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nome,       setNome]       = useState('');
  const [grupo,      setGrupo]      = useState('Geral');
  const [fase,       setFase]       = useState('Fase 1');
  const [cor,        setCor]        = useState('#2563eb');
  const [prioridade, setPrioridade] = useState('1');
  const [busy,       setBusy]       = useState(false);

  const CORES = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d'];
  const FASES = ['Fase 1','Fase 2','Fase 3','Expansão','Piloto','Concluída'];

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#1a1f2e', borderRadius: 14, padding: 24,
        width: '100%', maxWidth: 340, border: '1px solid rgba(255,255,255,.08)'
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc', marginBottom: 16 }}>
          Nova Zona — {cidade}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 16 }}>
          {coords.length} pontos desenhados
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Nome da área</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="ex: Centro Expandido" style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Grupo</label>
            <input value={grupo} onChange={e => setGrupo(e.target.value)}
              placeholder="ex: Geral, Prioritário" style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Fase</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FASES.map(f => (
                <button key={f} onClick={() => setFase(f)} style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
                  background: fase === f ? 'rgba(192,132,252,.2)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${fase === f ? 'rgba(192,132,252,.4)' : 'rgba(255,255,255,.08)'}`,
                  color: fase === f ? '#c084fc' : 'rgba(255,255,255,.4)'
                }}>{f}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Cor</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {CORES.map(c => (
                <button key={c} onClick={() => setCor(c)} style={{
                  width: 28, height: 28, borderRadius: '50%', background: c,
                  border: cor === c ? '3px solid white' : '2px solid transparent',
                  cursor: 'pointer'
                }} />
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 5 }}>Prioridade (1=alta)</label>
            <input type="number" min="1" max="10" value={prioridade}
              onChange={e => setPrioridade(e.target.value)} style={{ ...inp, width: 80 }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onCancelar} style={{
            flex: 1, padding: 11,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer'
          }}>Cancelar</button>
          <button disabled={busy || !nome} onClick={async () => {
            setBusy(true);
            await onSalvar({
              cidade, pais, nome, grupo, fase, cor,
              prioridade: parseInt(prioridade) || 1,
              ativo: true,
              poligono: coords.map(([lat, lng]) => ({ lat, lng }))
            });
            setBusy(false);
          }} style={{
            flex: 2, padding: 11,
            background: busy || !nome ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy || !nome ? 'not-allowed' : 'pointer'
          }}>
            {busy ? 'Salvando...' : 'Salvar zona'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SELETOR DE IDIOMAS ───────────────────────────────────────────
const LANGS = [
  { code: 'pt', label: 'PT', flag: '🇧🇷' },
  { code: 'es', label: 'ES', flag: '🇲🇽' },
  { code: 'en', label: 'EN', flag: '🇺🇸' },
  { code: 'ru', label: 'RU', flag: '🇷🇺' },
];

function LangSelector() {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState(i18n.language?.slice(0,2) || 'pt');

  const trocar = (code: string) => {
    setLang(code);
    i18n.changeLanguage(code);
    localStorage.setItem('appLang', code);
    setOpen(false);
  };

  const atual = LANGS.find(l => l.code === lang) || LANGS[0];

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
        borderRadius: 8, color: 'rgba(255,255,255,.7)', padding: '4px 8px',
        fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
      }}>
        {atual.flag} {atual.label}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#1a1f2e', border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 8, overflow: 'hidden', zIndex: 1500, minWidth: 80
        }}>
          {LANGS.map(l => (
            <button key={l.code} onClick={() => trocar(l.code)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '8px 12px', border: 'none',
              background: l.code === lang ? 'rgba(96,165,250,.15)' : 'transparent',
              color: l.code === lang ? '#60a5fa' : 'rgba(255,255,255,.7)',
              fontSize: 12, cursor: 'pointer', textAlign: 'left'
            }}>
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── APP PRINCIPAL ────────────────────────────────────────────────
type Tela = 'loading' | 'login' | 'mapa' | 'guard';

// ── EXPORT ZONAS ─────────────────────────────────────────────────
async function exportarZonas(cidade: string, pais: string, formato: 'geojson' | 'csv' | 'wkt', db: any) {
  const { getDocs, collection, query, where } = await import('firebase/firestore');
  const snap = await getDocs(query(collection(db, 'poligonos'), where('cidade', 'in', [cidade])));
  const zonas = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

  let conteudo = '', nomeArquivo = '', tipo = '';

  if (formato === 'geojson') {
    const features = zonas.map(z => ({
      type: 'Feature',
      properties: { id: z.id, nome: z.nome, grupo: z.grupo, fase: z.fase, cor: z.cor, ativo: z.ativo,
        criadoEm: z.criadoEm?.toDate ? z.criadoEm.toDate().toISOString() : z.criadoEm,
        importadoEm: z.importadoEm },
      geometry: {
        type: 'Polygon',
        coordinates: [z.poligono?.map((p: any) => [p.lng, p.lat]) || []]
      }
    }));
    conteudo = JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
    nomeArquivo = `zonas_${cidade}_${new Date().toISOString().split('T')[0]}.geojson`;
    tipo = 'application/geo+json';

  } else if (formato === 'wkt') {
    const rows = ['WKT,nome,grupo,fase,cor,ativo,criadoEm'];
    for (const z of zonas) {
      const pts = (z.poligono || []).map((p: any) => `${p.lng} ${p.lat}`).join(', ');
      const wkt = `"POLYGON ((${pts}))"`;
      const dt = z.criadoEm?.toDate ? z.criadoEm.toDate().toISOString() : (z.importadoEm || '');
      rows.push(`${wkt},"${z.nome||''}","${z.grupo||''}","${z.fase||''}","${z.cor||''}",${z.ativo!==false},"${dt}"`);
    }
    conteudo = rows.join('\n');
    nomeArquivo = `zonas_${cidade}_${new Date().toISOString().split('T')[0]}.wkt.csv`;
    tipo = 'text/csv';

  } else { // csv simples lat,lng por zona
    const rows = ['nome,grupo,fase,lat,lng,ativo'];
    for (const z of zonas) {
      for (const p of (z.poligono || [])) {
        rows.push(`"${z.nome||''}","${z.grupo||''}","${z.fase||''}",${p.lat},${p.lng},${z.ativo!==false}`);
      }
    }
    conteudo = rows.join('\n');
    nomeArquivo = `zonas_${cidade}_pontos_${new Date().toISOString().split('T')[0]}.csv`;
    tipo = 'text/csv';
  }

  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo; a.click();
  URL.revokeObjectURL(url);
}

// ── OVERPASS HELPERS (inline no App) ────────────────────────────
function buildOverpassQuery(lat: number, lng: number, raio: number): string {
  const c = lat + ',' + lng;
  return '[out:json][timeout:25];(node["railway"~"subway_entrance|station"](around:' + raio + ',' + c + ');node["highway"="bus_stop"](around:' + raio + ',' + c + ');node["amenity"~"bus_station|restaurant|cafe|fast_food|bar|bank|pharmacy|hospital|clinic|school|university|police|post_office|cinema|theatre|parking|fuel|charging_station"](around:' + raio + ',' + c + ');node["shop"~"mall|supermarket|convenience|bakery"](around:' + raio + ',' + c + ');node["leisure"~"park|fitness_centre|sports_centre|stadium"](around:' + raio + ',' + c + ');node["tourism"~"hotel|museum|attraction|viewpoint"](around:' + raio + ',' + c + ');way["amenity"~"hospital|university|school|park"](around:' + raio + ',' + c + '););out center qt 300;';
}

function parseOverpassElements(elements: any[], refLat: number, refLng: number): any[] {
  const R = 6371000;
  function dist(la: number, lo: number) {
    const dLat = (la-refLat)*Math.PI/180, dLon = (lo-refLng)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(refLat*Math.PI/180)*Math.cos(la*Math.PI/180)*Math.sin(dLon/2)**2;
    return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
  }
  const tipoMap: Record<string,string> = {
    subway_entrance:'subway_entrance',station:'station',bus_stop:'bus_stop',
    bus_station:'bus_station',restaurant:'restaurant',cafe:'cafe',fast_food:'fast_food',
    bar:'bar',bank:'bank',pharmacy:'pharmacy',hospital:'hospital',clinic:'clinic',
    school:'school',university:'university',police:'police',post_office:'post_office',
    cinema:'cinema',theatre:'theatre',parking:'parking',fuel:'fuel',
    charging_station:'charging_station',mall:'mall',supermarket:'supermarket',
    convenience:'convenience',bakery:'bakery',park:'park',fitness_centre:'fitness_centre',
    sports_centre:'sports_centre',stadium:'stadium',hotel:'hotel',museum:'museum',
    attraction:'tourism',viewpoint:'viewpoint',
  };
  const seen = new Set<string>();
  const result: any[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;
    const tags = el.tags || {};
    const nome = tags.name || tags['name:pt'] || '';
    if (!nome) continue;
    const allVals = Object.values(tags) as string[];
    let tipo = 'outros';
    for (const [k, v] of Object.entries(tipoMap)) {
      if (allVals.includes(k)) { tipo = v; break; }
      if (tags.amenity === k || tags.railway === k || tags.highway === k ||
          tags.shop === k || tags.leisure === k || tags.tourism === k) { tipo = v; break; }
    }
    if (tipo === 'outros') continue;
    const uid = el.type + '-' + el.id;
    if (seen.has(uid)) continue;
    seen.add(uid);
    result.push({ id: uid, nome, tipo, lat, lng, distancia: dist(lat, lng), tags, endereco: tags['addr:street'] || '' });
  }
  return result.sort((a: any, b: any) => a.distancia - b.distancia);
}

export default function App() {
  const [tela,    setTela]    = useState<Tela>('loading');
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        try {
          const res = await fnGetUsuario()({});
          const d = res.data as { ok: boolean; usuario: Usuario };
          if (d.ok) { const u = d.usuario; setUsuario(u); setTela(['guard', 'campo'].includes(u.role) ? 'guard' : 'mapa'); }
          else setTela('login');
        } catch { setTela('login'); }
      } else { setUsuario(null); setTela('login'); }
    });
  }, []);

  const handleLogin = async (email: string, senha: string): Promise<string | null> => {
    try { await signInWithEmailAndPassword(auth, email, senha); return null; }
    catch { return 'E-mail ou senha incorretos.'; }
  };

  if (tela === 'loading') return (
    <div style={{ minHeight: '100vh', background: '#0d1220',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%',
        border: '3px solid rgba(48,127,226,.2)', borderTopColor: '#307FE2',
        animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 13 }}>Carregando...</span>
    </div>
  );

  if (tela === 'login') return <TelaLogin onLogin={handleLogin} />;
  if (tela === 'guard') return <TelaGuard usuario={usuario!} onLogout={() => signOut(auth)} />;
  return <TelaMapa usuario={usuario!} onLogout={() => signOut(auth)} />;
}

// ── GUARD OVERLAY ─────────────────────────────────────────────────
// Painel lateral para gestor/admin ver ocorrências no mapa
import { Timestamp as FsTimestamp } from 'firebase/firestore';

const GUARD_TIPO_COR: Record<string, string> = {
  Roubo:       '#ef4444',
  Tentativa:   '#f97316',
  Vandalismo:  '#eab308',
  Recuperacao: '#22c55e',
  Outro:       '#6b7280',
};

const GUARD_TIPO_EMOJI: Record<string, string> = {
  Roubo:       '🔴',
  Tentativa:   '🟠',
  Vandalismo:  '🟡',
  Recuperacao: '🟢',
  Outro:       '⚪',
};

function GuardOverlay({ mapInstance, onOcorrenciasChange, onFechar, cidade }: {
  mapInstance: L.Map | null;
  onOcorrenciasChange: (list: any[]) => void;
  onFechar: () => void;
  cidade: string;
}) {
  const [ocorrencias, setOcorrencias] = useState<any[]>([]);
  const [filtroTipo,  setFiltroTipo]  = useState<string>('TODOS');
  const [filtroDias,  setFiltroDias]  = useState<number>(1);
  const [selecionada, setSelecionada] = useState<any | null>(null);
  const guardMarkersRef = useRef<L.CircleMarker[]>([]);

  // Carrega ocorrências do Firestore
  useEffect(() => {
    const desde = FsTimestamp.fromDate(new Date(Date.now() - filtroDias * 24 * 60 * 60 * 1000));
    const constraints: any[] = [
      where('criadoEm', '>=', desde),
    ];
    if (cidade) constraints.unshift(where('cidade_inicial', '==', cidade));
    const q = query(collection(db, 'ocorrencias'), ...constraints);
    const unsub = onSnapshot(q, snap => {
      const lista = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const ta = a.criadoEm?.toDate?.()?.getTime() || 0;
          const tb = b.criadoEm?.toDate?.()?.getTime() || 0;
          return tb - ta;
        });
      setOcorrencias(lista);
      onOcorrenciasChange(lista);
    });
    return unsub;
  }, [cidade, filtroDias, onOcorrenciasChange]);

  // Pins Leaflet
  useEffect(() => {
    if (!mapInstance) return;
    guardMarkersRef.current.forEach(m => m.remove());
    guardMarkersRef.current = [];
    const filtradas = filtroTipo === 'TODOS' ? ocorrencias : ocorrencias.filter(o => o.tipo === filtroTipo);
    filtradas.forEach(o => {
      if (!o.lat_inicial || !o.lng_inicial) return;
      const cor = GUARD_TIPO_COR[o.tipo] || '#6b7280';
      const marker = L.circleMarker([o.lat_inicial, o.lng_inicial], {
        radius: 10, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.85,
      }).addTo(mapInstance);
      marker.bindPopup(`
        <div style="font-family:Inter,sans-serif;min-width:180px">
          <div style="font-weight:700;font-size:14px;color:${cor};margin-bottom:4px">
            ${GUARD_TIPO_EMOJI[o.tipo] || '⚪'} ${o.tipo}
          </div>
          <div style="font-size:12px;color:#444;margin-bottom:6px">${o.descricao || ''}</div>
          <div style="font-size:11px;color:#888">
            ${o.asset_id ? `Ativo: ${o.asset_id} · ` : ''}${o.bairro_inicial || o.cidade_inicial || ''}
          </div>
          <div style="font-size:10px;color:#aaa;margin-top:4px">
            ${o.registradoPorNome || ''} · ${o.status}
          </div>
          ${o.foto1_url ? `<img src="${o.foto1_url}" style="width:100%;border-radius:6px;margin-top:8px" />` : ''}
        </div>
      `);
      marker.on('click', () => setSelecionada(o));
      guardMarkersRef.current.push(marker);
    });
    return () => { guardMarkersRef.current.forEach(m => m.remove()); guardMarkersRef.current = []; };
  }, [mapInstance, ocorrencias, filtroTipo]);

  const filtradas = filtroTipo === 'TODOS' ? ocorrencias : ocorrencias.filter(o => o.tipo === filtroTipo);
  const contagens: Record<string, number> = {};
  ocorrencias.forEach(o => { contagens[o.tipo] = (contagens[o.tipo] || 0) + 1; });

  function fmtOc(ts: any): string {
    if (!ts) return '';
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2500,
      width: '100%', maxWidth: 360,
      background: 'rgba(8,13,20,.97)', backdropFilter: 'blur(16px)',
      borderLeft: '1px solid rgba(167,139,250,.15)',
      display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 15 }}>🛡 Guard — Ocorrências</div>
          <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, marginTop: 2 }}>
            {filtradas.length} ocorrência{filtradas.length !== 1 ? 's' : ''} · últimos {filtroDias}d
          </div>
        </div>
        <button onClick={onFechar} style={{
          background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 8, color: 'rgba(255,255,255,.5)', padding: '6px 12px', fontSize: 12, cursor: 'pointer',
        }}>✕</button>
      </div>

      {/* Filtro dias */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.06)',
        display: 'flex', gap: 6, flexShrink: 0 }}>
        {[1, 7, 30].map(d => (
          <button key={d} onClick={() => setFiltroDias(d)} style={{
            flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12,
            background: filtroDias === d ? 'rgba(124,58,237,.2)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${filtroDias === d ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.08)'}` as any,
            color: filtroDias === d ? '#a78bfa' : 'rgba(255,255,255,.4)',
          }}>{d === 1 ? 'Hoje' : `${d}d`}</button>
        ))}
      </div>

      {/* Filtro tipo */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.06)',
        display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' as any, flexShrink: 0 }}>
        <button onClick={() => setFiltroTipo('TODOS')} style={{
          padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
          background: filtroTipo === 'TODOS' ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)',
          color: filtroTipo === 'TODOS' ? '#fff' : 'rgba(255,255,255,.4)',
        }}>Todos ({ocorrencias.length})</button>
        {Object.keys(GUARD_TIPO_COR).map(t => contagens[t] ? (
          <button key={t} onClick={() => setFiltroTipo(t)} style={{
            padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
            background: filtroTipo === t ? `${GUARD_TIPO_COR[t]}20` : 'rgba(255,255,255,.04)',
            color: filtroTipo === t ? GUARD_TIPO_COR[t] : 'rgba(255,255,255,.4)',
            border: `1px solid ${filtroTipo === t ? GUARD_TIPO_COR[t] + '40' : 'rgba(255,255,255,.06)'}` as any,
          }}>{GUARD_TIPO_EMOJI[t]} {t} ({contagens[t]})</button>
        ) : null)}
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtradas.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '48px 24px', color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🛡</div>
            <div style={{ fontSize: 13 }}>Nenhuma ocorrência no período</div>
          </div>
        ) : filtradas.map(o => (
          <div key={o.id}
            onClick={() => { setSelecionada(o); if (mapInstance && o.lat_inicial && o.lng_inicial) mapInstance.setView([o.lat_inicial, o.lng_inicial], 17); }}
            style={{
              padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.05)',
              cursor: 'pointer', background: selecionada?.id === o.id ? 'rgba(124,58,237,.1)' : 'transparent',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{GUARD_TIPO_EMOJI[o.tipo] || '⚪'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ color: GUARD_TIPO_COR[o.tipo] || '#fff', fontWeight: 600, fontSize: 13 }}>{o.tipo}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{o.status}</span>
                </div>
                <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.descricao}</div>
                <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 10, marginTop: 2 }}>
                  {fmtOc(o.criadoEm)} · {o.registradoPorNome} · {o.bairro_inicial || o.cidade_inicial || ''}
                </div>
              </div>
              {o.foto1_url && (
                <img src={o.foto1_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detalhe selecionado */}
      {selecionada && (
        <div style={{ borderTop: '1px solid rgba(167,139,250,.2)', background: 'rgba(124,58,237,.08)',
          padding: '14px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: GUARD_TIPO_COR[selecionada.tipo] || '#fff', fontWeight: 700, fontSize: 14 }}>
              {GUARD_TIPO_EMOJI[selecionada.tipo]} {selecionada.tipo}
            </span>
            <button onClick={() => setSelecionada(null)} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 16, cursor: 'pointer',
            }}>✕</button>
          </div>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, marginBottom: 8 }}>{selecionada.descricao}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
            {([['Ativo', selecionada.asset_id || '—'], ['Prioridade', selecionada.prioridade],
               ['Turno', selecionada.turno], ['Guard', selecionada.registradoPorNome]] as [string,string][]).map(([k, v]) => (
              <div key={k} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>{k}</div>
                <div style={{ color: '#fff', fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          {(selecionada.foto1_url || selecionada.foto2_url) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {[selecionada.foto1_url, selecionada.foto2_url].filter(Boolean).map((url: string, i: number) => (
                <img key={i} src={url} alt="" style={{ flex: 1, height: 80, objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
