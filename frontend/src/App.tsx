// App.tsx — Leaflet + Firebase, seleção de cidade, chunks de render
import { useState, useEffect, useRef, useCallback, CSSProperties, startTransition } from 'react';
import TelaGuard from './TelaGuard';
import GuiaPanel from './GuiaPanel';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential, User } from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  orderBy,
  getDoc
} from 'firebase/firestore';  // ✅ CORRETO
import { uploadComRetry } from './lib/uploadUtils';

import L from 'leaflet';
import ZonasManager from './ZonasManager';
import { useCidadesExpansao, CidadeExpansaoModal, STATUS_META, type CidadeExpansao } from './CidadesExpansao';
import UsuariosManager from './UsuariosManager';
import DashboardManager from './DashboardManager';
import SlotsModule from './SlotsModule';
import PainelConfiguracoes from './components/PainelConfiguracoes';
import AndroidPermissionGate from './components/AndroidPermissionGate';
import MonitorPanel from './MonitorPanel';
import TelegramVinculo, { useTelegramVinculado } from './TelegramVinculo';
import TelaPrestadorPerfil from './TelaPrestadorPerfil';
import AnalyticsManager from './AnalyticsManager';
import { POIPanel, POIMapFilter, POIActionsPopup, POI_META } from './components/POIPanel';
import { StreetViewModal } from './components/StreetViewModal';
import { FotoCaptura } from './components/FotoCaptura';
import { FotoMedidas } from './components/FotoMedidas';
import { CandidatosManager } from './components/CandidatosManager';
import LocaisFinanceiro, { LocalOperacionalModal, useLocaisOperacionais, TIPO_LOCAL_META } from './components/LocaisFinanceiro';
import { GoJetOverlay } from './components/GoJetOverlay';
import GoJetDashboard from './components/GoJetDashboard';
import GestorLogisticaPanel from './components/GestorLogisticaPanel';
import PagamentosModule from './components/PagamentosModule';
import PagamentosAdminPanel from './components/PagamentosAdminPanel';
import SlotsTeamsModule from './components/SlotsTeamsModule';
import LiveWorkersPanel from './components/LiveWorkersPanel';
import PainelRoubos from './components/PainelRoubos';
import GuardDashboard from './components/GuardDashboard';
import PainelControlePerdasSeg from './components/PainelControlePerdasSeg';
import TarefasLogisticaModule from './components/TarefasLogisticaModule';
import TurnoRegistro from './components/TurnoRegistro';
import GoJetAnalyticsPanel from './components/GoJetAnalyticsPanel';
import UpdateBanner from './components/UpdateBanner';
import { useShiftNotifications, formatTurnoToast } from './components/ShiftNotifications';
import type { LocalOperacional, TipoLocal } from './components/LocaisFinanceiro';
import type { Candidato } from './components/CandidatosManager';
import type { POI } from './components/POIPanel';
import { auth, db } from './lib/firebase';
import 'leaflet/dist/leaflet.css';
import './i18n';
import i18n from './i18n/index';
import { fnGerarCroqui, fnGerarStreetView, fnAnalisarCalcada, fnBuscarPOIs, fnGeocodeForward } from './lib/firebase';

// Converte URL do Drive para URL direta de imagem
// Fotos do Google Drive retornam 403/CORS — filtrar antes de renderizar
function sanitizarFotoUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.includes('drive.google.com')) return null;
  if (url.includes('lh3.googleusercontent.com')) return null;
  return url;
}

function fixDriveUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/\/d\/([^/?]+)/);
  if (m && url.includes('drive.google.com')) {
    return 'https://drive.google.com/uc?export=view&id=' + m[1];
  }
  return url;
}
import { useTranslation } from 'react-i18next';

// Carrega idioma salvo
const savedLang = localStorage.getItem('appLang');
if (savedLang) i18n.changeLanguage(savedLang);

interface Usuario {
  uid: string
  email: string
  nome: string
  role: string
  paises: string[]
  cidadesPermitidas?: string[]
  cidadesGerenciaLog?: string[]
  cargoPrestador?: string
  tipoCadastro?: string
  statusPrestador?: string
  cidade?: string
}
interface Estacao {
  id: string; codigo: string; lat: number; lng: number;
  cidade: string; bairro: string; endereco: string;
  tipo: string; status: string; pais: string;
  operador?: string;
  consultor?: string;
  larguraFaixa?: number;
  imagens?: { streetView?: string; croqui?: string; foto?: string };
  ia?: { aprovado: boolean; score: number; confianca: string; largura: string; motivo: string };
  croquiStatus: string;
  privado?: {
    nomeLocal?: string; nomeAutorizante?: string; cargoAutorizante?: string;
    telefone?: string; email?: string; assinatura?: string;
  };
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
// TelaSolicitacao COMPLETA E CORRIGIDA - COPIAR E COLAR NO App.tsx
// Substitua a função TelaSolicitacao inteira por esta

function TelaSolicitacao({ onVoltar }: { onVoltar: () => void }) {
  const [nome,   setNome]   = useState('');
  const [email,  setEmail]  = useState('');
  const [senha,  setSenha]  = useState('');
  const [paises, setPaises] = useState<string[]>(['BR']);
  const [cidade, setCidade] = useState('');
  const [roleDesejado, setRoleDesejado] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok,   setOk]   = useState(false);
  const [erro, setErro] = useState('');
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'estacoes'));
        const set = new Set<string>();
        snap.docs.forEach(d => {
          const c = d.data().cidade;
          if (c && typeof c === 'string') set.add(c.trim());
        });
        const lista = Array.from(set).sort();
        setCidadesDisponiveis(lista.length > 0 ? lista : CIDADES['BR']);
      } catch {
        setCidadesDisponiveis(CIDADES['BR']);
      }
    })();
  }, []);

  // Campos prestador
  const [cpfCnpj,       setCpfCnpj]       = useState('');
  const [chavePix,      setChavePix]      = useState('');
  const [tipoChavePix,  setTipoChavePix]  = useState('CPF');
  const [dataNasc,      setDataNasc]      = useState('');
  const [tipoContrato,  setTipoContrato]  = useState('');
  const [telegramNum,   setTelegramNum]   = useState('');
  const [motivo,        setMotivo]        = useState('');

  const ROLES_INTERNOS = [
    { k:'campo',  l:'Campo',  d:'Cadastrar estações e ocorrências', cor:'#3b82f6' },
    { k:'guard',  l:'Guard',  d:'Ocorrências Guard',                 cor:'#a78bfa' },
    { k:'gestor', l:'Gestor', d:'Gestão completa da operação',       cor:'#fbbf24' },
    { k:'viewer', l:'Viewer', d:'Visualização do mapa',              cor:'#6b7280' },
  ];

  const ROLES_PRESTADOR = [
    { k:'logistica',  l:'Ag. Logística', d:'Charger / Scalt — movimentação de patinetes', cor:'#10b981' },
    { k:'promotor',   l:'Promotor',       d:'Equipe de vendas e ativação',                  cor:'#f59e0b' },
    { k:'fiscal',     l:'Fiscal',         d:'Fiscalização e orientação de clientes',         cor:'#f97316' },
    { k:'seguranca',  l:'Segurança',      d:'Equipe de segurança (CLT)',                    cor:'#ef4444' },
  ];

  const CONTRATOS_MEI  = ['MEI - JET','MEI - TopDoer','MEI - Outro'];
  const CONTRATOS_CLT  = ['CLT'];
  const CONTRATOS_ALL  = roleDesejado === 'seguranca' ? CONTRATOS_CLT : [...CONTRATOS_MEI, ...CONTRATOS_CLT];

  const isPrestador = ROLES_PRESTADOR.some(r => r.k === roleDesejado);
  const isCLT       = tipoContrato === 'CLT';

  const togglePais = (p: string) =>
    setPaises(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#fff', fontSize: 13, outline: 'none',
  };
  const lbl: React.CSSProperties = {
    display: 'block', color: 'rgba(255,255,255,.45)', fontSize: 10,
    fontWeight: 600, marginBottom: 5, letterSpacing: '.05em',
  };
  const sec: React.CSSProperties = {
    padding: '12px 14px', borderRadius: 10,
    background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
  };

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!roleDesejado)   { setErro('Selecione um cargo.'); return; }
    if (!paises.length)  { setErro('Selecione pelo menos um país.'); return; }
    if (!nome.trim())    { setErro('Nome é obrigatório.'); return; }
    if (!email.trim())   { setErro('Email é obrigatório.'); return; }
    if (!senha.trim())   { setErro('Senha é obrigatória.'); return; }
    if (isPrestador && !cidade.trim()) { setErro('Informe a cidade de atuação.'); return; }
    if (isPrestador && !cpfCnpj.trim()) { setErro('Informe CPF ou CNPJ.'); return; }
    if (isPrestador && !tipoContrato)   { setErro('Selecione o tipo de contrato.'); return; }
    if (isPrestador && !telegramNum.trim()) { setErro('Informe o número do Telegram.'); return; }
    if (isPrestador && !isCLT && !chavePix.trim()) { setErro('Informe a chave Pix.'); return; }
    
    setBusy(true);
    setErro('');
    
    try {
      // 1. Criar usuário em Auth
      const userCred = await createUserWithEmailAndPassword(auth, email, senha);
      const uid = userCred.user.uid;

      // 2. Criar documento em usuarios
      await setDoc(doc(db, 'usuarios', uid), {
        uid,
        email,
        nome,
        role: isPrestador ? 'prestador_pendente' : roleDesejado,
        paises,
        pais: paises[0] || 'BR',
        tipoCadastro: isPrestador ? 'prestador' : 'interno',
        cargoPrestador: isPrestador ? roleDesejado : null,
        statusPrestador: isPrestador ? 'pendente_aprovacao' : null,
        ...(isPrestador ? {
          cpf_cnpj: cpfCnpj.trim(),
          pix_chave: chavePix.trim(),
          pix_tipo: tipoChavePix,
          tipo_contrato: tipoContrato,
          cidade: cidade,
        } : {}),
        data_criacao: new Date()
      });

      // 3. SE É PRESTADOR - SALVAR SOLICITAÇÃO
      if (isPrestador) {
        await addDoc(collection(db, 'solicitacoes_prestadores'), {
          uid,
          email,
          nome,
          cargo: roleDesejado,
          cpf_cnpj: cpfCnpj.trim(),
          pix_chave: chavePix.trim(),
          pix_tipo: tipoChavePix,
          cidade,
          tipo_contrato: tipoContrato,
          telegram: telegramNum.trim(),
          motivo_cadastro: motivo.trim() || '',
          status: 'pendente',
          data_criacao: new Date(),
          pais: paises[0] || 'BR'
        });
      }

      setOk(true);
    } catch(err: unknown) {
      console.error('Erro ao enviar:', err);
      setErro(err instanceof Error ? err.message : 'Erro ao enviar solicitação.');
    }
    setBusy(false);
  };

  return (
    <div style={{ 
      background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      fontFamily: 'Inter,sans-serif', 
      minHeight: '100vh',
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch' as any
    }}>
      <div style={{ width: '100%', maxWidth: 420, paddingBottom: 40, marginLeft: 'auto', marginRight: 'auto', paddingLeft: 20, paddingRight: 20, paddingTop: 20 }}>
        <button onClick={onVoltar} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
          fontSize: 13, cursor: 'pointer', marginBottom: 24, padding: 0
        }}>← Voltar ao login</button>

        {ok ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#6ee7b7', marginBottom: 8 }}>
              {isPrestador ? 'Cadastro enviado!' : 'Solicitação enviada!'}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 8, lineHeight: 1.6 }}>
              {isPrestador
                ? 'Aguarde a aprovação do administrador. Você receberá um e-mail com as próximas instruções.'
                : 'Aguarde a aprovação do administrador. Você receberá um e-mail com instruções de acesso.'}
            </div>
            <button onClick={onVoltar} style={{
              padding: '12px 24px', marginTop: 16,
              background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
              border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, cursor: 'pointer'
            }}>Voltar ao login</button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                Solicitar acesso
              </h2>
              <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
                Selecione seu cargo para ver os campos necessários.
              </p>
            </div>

            <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── CARGO ── */}
              <div style={sec}>
                <label style={lbl}>SELECIONE SEU CARGO *</label>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 6, fontWeight: 600 }}>
                    EQUIPE OPERACIONAL
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    {ROLES_INTERNOS.map(r => (
                      <button key={r.k} type="button" onClick={() => setRoleDesejado(r.k)}
                        style={{ padding: '8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          background: roleDesejado===r.k ? r.cor+'22' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${roleDesejado===r.k ? r.cor+'55' : 'rgba(255,255,255,.08)'}`,
                          color: roleDesejado===r.k ? r.cor : 'rgba(255,255,255,.4)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{r.l}</div>
                        <div style={{ fontSize: 9, marginTop: 2, lineHeight: 1.3, opacity: .8 }}>{r.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 6, fontWeight: 600 }}>
                    PRESTADOR DE SERVIÇO
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    {ROLES_PRESTADOR.map(r => (
                      <button key={r.k} type="button" onClick={() => setRoleDesejado(r.k)}
                        style={{ padding: '8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          background: roleDesejado===r.k ? r.cor+'22' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${roleDesejado===r.k ? r.cor+'55' : 'rgba(255,255,255,.08)'}`,
                          color: roleDesejado===r.k ? r.cor : 'rgba(255,255,255,.4)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{r.l}</div>
                        <div style={{ fontSize: 9, marginTop: 2, lineHeight: 1.3, opacity: .8 }}>{r.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── DADOS BASE (todos) ── */}
              {roleDesejado && (
                <div style={sec}>
                  <label style={lbl}>INFORMAÇÕES BÁSICAS</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={lbl}>Nome completo *</label>
                      <input value={nome} onChange={e=>setNome(e.target.value)} required style={inp} placeholder="Seu nome"/>
                    </div>
                    <div>
                      <label style={lbl}>E-mail *</label>
                      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={inp} placeholder="seu@email.com"/>
                    </div>
                    <div>
                      <label style={lbl}>Senha *</label>
                      <input type="password" value={senha} onChange={e=>setSenha(e.target.value)} required style={inp} placeholder="Mínimo 8 caracteres"/>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
                        Mínimo 8 caracteres, 1 maiúscula e 1 número
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── DADOS PRESTADOR ── */}
              {isPrestador && (
                <div style={sec}>
                  <label style={lbl}>INFORMAÇÕES DO PRESTADOR</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    
                    {/* Cidade */}
                    <div>
                      <label style={lbl}>Cidade de atuação *</label>
                      <select value={cidade} onChange={e=>setCidade(e.target.value)} required
                        style={{ ...inp, cursor: 'pointer', appearance: 'none' as any }}>
                        <option value="">Selecione a cidade...</option>
                        {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {cidadesDisponiveis.length === 0 && (
                        <div style={{ fontSize: 10, color: '#4a5a7a', marginTop: 4 }}>Carregando cidades...</div>
                      )}
                    </div>

                    {/* Tipo contrato */}
                    <div>
                      <label style={lbl}>Tipo de contrato *</label>
                      <select value={tipoContrato} onChange={e=>setTipoContrato(e.target.value)} required
                        style={{ ...inp, cursor: 'pointer' }}>
                        <option value="">Selecione...</option>
                        {CONTRATOS_ALL.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* CPF/CNPJ + Data nasc */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lbl}>CPF ou CNPJ *</label>
                        <input value={cpfCnpj} onChange={e=>setCpfCnpj(e.target.value)} required style={inp} placeholder="000.000.000-00"/>
                      </div>
                      <div>
                        <label style={lbl}>Data de nascimento *</label>
                        <input type="date" value={dataNasc} onChange={e=>setDataNasc(e.target.value)} required style={{ ...inp, colorScheme: 'dark' as any }}/>
                      </div>
                    </div>

                    {/* Pix — só para MEI */}
                    {!isCLT && (
                      <div>
                        <label style={lbl}>Chave Pix *</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select value={tipoChavePix} onChange={e=>setTipoChavePix(e.target.value)}
                            style={{ ...inp, width: 'auto', cursor: 'pointer', paddingRight: 8 }}>
                            {['CPF','CNPJ','E-mail','Telefone','Aleatória'].map(t => <option key={t}>{t}</option>)}
                          </select>
                          <input value={chavePix} onChange={e=>setChavePix(e.target.value)}
                            style={{ ...inp, flex: 1 }} placeholder="Sua chave Pix"/>
                        </div>
                      </div>
                    )}

                    {/* Telegram */}
                    <div>
                      <label style={lbl}>Número Telegram *</label>
                      <input value={telegramNum} onChange={e=>setTelegramNum(e.target.value)} required
                        style={inp} placeholder="+55 81 99999-9999"/>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
                        Após aprovação, você receberá instruções para conectar o Telegram.
                      </div>
                    </div>

                    {/* CLT — aviso período de experiência */}
                    {isCLT && (
                      <div style={{ padding: '8px 12px', borderRadius: 8,
                        background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)' }}>
                        <div style={{ fontSize: 10, color: '#f87171', fontWeight: 600, marginBottom: 3 }}>
                          Contrato CLT
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', lineHeight: 1.5 }}>
                          O gestor responsável acompanhará seu período de experiência e agendará o treinamento presencial.
                          A renovação ou desligamento será sinalizado antes do fim do período.
                        </div>
                      </div>
                    )}

                    <div>
                      <label style={lbl}>Observação (opcional)</label>
                      <textarea value={motivo} onChange={e=>setMotivo(e.target.value)} rows={2}
                        style={{ ...inp, resize: 'none' as const }}
                        placeholder="Alguma informação adicional relevante..."/>
                    </div>
                  </div>
                </div>
              )}

              {/* ── DADOS INTERNO (não prestador) ── */}
              {roleDesejado && !isPrestador && (
                <div style={sec}>
                  <label style={lbl}>INFORMAÇÕES ADICIONAIS</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={lbl}>País(es) de atuação *</label>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                        {['BR','MX','AR','CO','CL','PE'].map(p => (
                          <button key={p} type="button" onClick={() => togglePais(p)} style={{
                            padding: '5px 11px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                            background: paises.includes(p) ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.05)',
                            border: `1px solid ${paises.includes(p) ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.1)'}`,
                            color: paises.includes(p) ? '#60a5fa' : 'rgba(255,255,255,.4)'
                          }}>{p}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={lbl}>Empresa / Motivo (opcional)</label>
                      <textarea value={motivo} onChange={e=>setMotivo(e.target.value)} rows={2}
                        style={{ ...inp, resize: 'none' as const }}
                        placeholder="Ex: Faço parte da equipe de campo da empresa X"/>
                    </div>
                  </div>
                </div>
              )}

              {erro && (
                <div style={{ padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                  color: '#f87171', fontSize: 12 }}>{erro}</div>
              )}

              {roleDesejado && (
                <button type="submit" disabled={busy} style={{
                  padding: 13,
                  background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                  border: 'none', borderRadius: 10, color: '#fff',
                  fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
                }}>{busy ? 'Enviando...' : isPrestador ? 'Enviar cadastro de prestador' : 'Enviar solicitação'}</button>
              )}
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
  const [verSenha,    setVerSenha]    = useState(false);
  const [senhaFocada, setSenhaFocada] = useState(false);

  // Requisitos de senha
  const requisitos = [
    { label: 'Mínimo 8 caracteres', ok: senha.length >= 8 },
    { label: 'Uma letra maiúscula',  ok: /[A-Z]/.test(senha) },
    { label: 'Um número',            ok: /[0-9]/.test(senha) },
  ];
  const senhaValida = requisitos.every(r => r.ok);

  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setBusy(true);
    const err = await onLogin(email, senha);
    if (err) { setErro(err); setBusy(false); }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
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
            <div style={{ marginBottom: 20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <label style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>Senha</label>
                <button type="button" onClick={() => setResetMode(true)} style={{
                  background: 'none', border: 'none', color: 'rgba(255,255,255,.35)',
                  fontSize: 11, cursor: 'pointer', padding: 0
                }}>Esqueci minha senha</button>
              </div>
              <div style={{ position:'relative' }}>
                <input
                  type={verSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  onFocus={() => setSenhaFocada(true)}
                  onBlur={() => setSenhaFocada(false)}
                  required
                  style={{ ...inp, paddingRight: 44 }}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setVerSenha(v => !v)}
                  style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', padding:4,
                    color:'rgba(255,255,255,.4)', fontSize:16, lineHeight:1 }}>
                  {verSenha ? '🙈' : '👁'}
                </button>
              </div>
              {/* Requisitos de senha — aparecem ao focar */}
              {senhaFocada && senha.length > 0 && (
                <div style={{ marginTop:8, padding:'8px 12px', borderRadius:8,
                  background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.06)' }}>
                  {requisitos.map(r => (
                    <div key={r.label} style={{ display:'flex', alignItems:'center', gap:6,
                      fontSize:11, color: r.ok ? '#4ade80' : 'rgba(255,255,255,.35)',
                      marginBottom:2 }}>
                      <span>{r.ok ? '✓' : '○'}</span>
                      <span>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}
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
// ── Skeleton loading ───────────────────────────────────────────────
function Skeleton({ w = '100%', h = 14, r = 6, mb = 8 }: { w?: string|number; h?: number; r?: number; mb?: number }) {
  return (
    <div style={{ width: w, height: h, borderRadius: r, marginBottom: mb,
      background: 'linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.05) 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,.06)' }}>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <Skeleton w={8} h={8} r={50} mb={0} />
        <div style={{ flex:1 }}>
          <Skeleton w="60%" h={11} r={4} mb={5} />
          <Skeleton w="40%" h={9} r={4} mb={0} />
        </div>
        <Skeleton w={32} h={18} r={8} mb={0} />
      </div>
    </div>
  );
}


function Toast({ msg, tipo, acao }: { msg: string; tipo: string; acao?: { label:string; fn:()=>void } }) {
  const META: Record<string, { bg:string; border:string; text:string; icon:string }> = {
    success: { bg:'rgba(16,185,129,.18)', border:'rgba(16,185,129,.4)', text:'#6ee7b7', icon:'✓' },
    error:   { bg:'rgba(239,68,68,.18)',  border:'rgba(239,68,68,.4)',  text:'#f87171', icon:'✕' },
    warn:    { bg:'rgba(245,158,11,.18)', border:'rgba(245,158,11,.4)', text:'#fbbf24', icon:'⚠' },
    info:    { bg:'rgba(48,127,226,.18)', border:'rgba(48,127,226,.4)', text:'#60a5fa', icon:'ℹ' },
  };
  const c = META[tipo] || META.info;
  return (
    <div style={{
      position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
      display:'flex', alignItems:'center', gap:10,
      padding:'11px 16px', background:c.bg,
      border:`1px solid ${c.border}`, borderRadius:12,
      backdropFilter:'blur(16px)', zIndex:9000,
      maxWidth:'min(92vw,420px)', boxShadow:'0 4px 24px rgba(0,0,0,.5)',
      animation:'toast-in .2s ease',
    }}>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
      <span style={{ fontSize:16, lineHeight:1 }}>{c.icon}</span>
      <span style={{ color:c.text, fontSize:13, fontWeight:500, flex:1 }}>{msg}</span>
      {acao && (
        <button onClick={acao.fn} style={{
          background:'rgba(255,255,255,.12)', border:'none', borderRadius:7,
          color:c.text, fontSize:11, fontWeight:700, padding:'4px 10px', cursor:'pointer',
          whiteSpace:'nowrap' as const,
        }}>{acao.label}</button>
      )}
    </div>
  );
}

// ── MAPA ─────────────────────────────────────────────────────────

// ── DocPublicoModal ───────────────────────────────────────────────
function DocPublicoModal({ estacaoId, cidade, docAtual, onFechar, onSalvo }: {
  estacaoId: string; cidade: string; docAtual: any;
  onFechar: () => void; onSalvo: () => void;
}) {
  const [tpuUrl,  setTpuUrl]  = useState(docAtual.tpu        || '');
  const [autUrl,  setAutUrl]  = useState(docAtual.autorizacao || '');
  const [obs,     setObs]     = useState(docAtual.obs         || '');
  const [tpuFile, setTpuFile] = useState<File|null>(null);
  const [autFile, setAutFile] = useState<File|null>(null);
  const [busy,    setBusy]    = useState(false);

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 11px', borderRadius:8, boxSizing:'border-box' as const,
    border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.05)',
    color:'#dce8ff', fontSize:12, outline:'none',
  };

  const uploadFile = async (file: File, path: string): Promise<string> => {
    return uploadComRetry(file, path);
  };

  const salvar = async () => {
    setBusy(true);
    try {
      let finalTpu = tpuUrl;
      let finalAut = autUrl;
      if (tpuFile) finalTpu = await uploadFile(tpuFile, `docPublico/${estacaoId}/tpu_${Date.now()}.${tpuFile.name.split('.').pop()}`);
      if (autFile) finalAut = await uploadFile(autFile, `docPublico/${estacaoId}/aut_${Date.now()}.${autFile.name.split('.').pop()}`);
      await updateDoc(doc(db, 'estacoes', estacaoId), {
        docPublico: { tpu: finalTpu, autorizacao: finalAut, obs, atualizadoEm: new Date().toISOString() }
      });
      onSalvo();
    } catch(e: any) { alert('Erro ao salvar: ' + e.message); }
    setBusy(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1300, background:'rgba(0,0,0,.65)',
      backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onFechar()}>
      <div style={{ width:'100%', maxWidth:420, background:'#0d1521',
        border:'1px solid rgba(21,101,192,.3)', borderRadius:16, padding:20, fontFamily:'Inter,sans-serif' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#60a5fa' }}>📄 Documentos Públicos</div>
            <div style={{ fontSize:10, color:'#4a5a7a', marginTop:2 }}>{cidade} · {estacaoId}</div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        {[
          { label:'🏛 TPU', url:tpuUrl, setUrl:setTpuUrl, file:tpuFile, setFile:setTpuFile, path:'tpu' },
          { label:'✅ Autorização', url:autUrl, setUrl:setAutUrl, file:autFile, setFile:setAutFile, path:'aut' },
        ].map(item => (
          <div key={item.label} style={{ marginBottom:14 }}>
            <label style={{ fontSize:11, color:'#93c5fd', display:'block', marginBottom:5, fontWeight:600 }}>{item.label}</label>
            {item.url && <a href={item.url} target="_blank" rel="noreferrer" style={{ display:'block', fontSize:11, color:'#60a5fa', marginBottom:6, textDecoration:'none' }}>📎 Documento atual ↗</a>}
            <input type="text" value={item.url} onChange={e=>item.setUrl(e.target.value)} placeholder="URL do documento" style={inp} />
            <div style={{ marginTop:6 }}>
              <label style={{ fontSize:10, color:'#4a5a7a', cursor:'pointer', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', borderRadius:6, padding:'5px 10px', display:'inline-block' }}>
                📤 Upload
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:'none' }} onChange={e=>item.setFile(e.target.files?.[0]||null)} />
              </label>
              {item.file && <span style={{ fontSize:10, color:'#4ade80', marginLeft:8 }}>✓ {item.file.name}</span>}
            </div>
          </div>
        ))}
        <div style={{ marginBottom:18 }}>
          <label style={{ fontSize:11, color:'#93c5fd', display:'block', marginBottom:5, fontWeight:600 }}>📝 Observação</label>
          <input type="text" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Ex: Validade 2025..." style={inp} />
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onFechar} style={{ flex:1, padding:'10px', borderRadius:10, cursor:'pointer', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', color:'rgba(255,255,255,.5)', fontSize:12 }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'10px', borderRadius:10, cursor:busy?'not-allowed':'pointer', background:busy?'rgba(21,101,192,.3)':'linear-gradient(135deg,#1565c0,#1976d2)', border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
            {busy?'Salvando...':'💾 Salvar documentos'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── NovaOcorrenciaInline ──────────────────────────────────────────
function NovaOcorrenciaInline({ usuario, onSucesso }: { usuario: Usuario; onSucesso: () => void }) {
  const [toast, setToast] = useState('');
  const showToastLocal = (msg: string) => { setToast(msg); setTimeout(()=>setToast(''), 3000); };
  return (
    <div style={{ position:'relative' }}>
      {toast && (
        <div style={{ position:'sticky', top:0, zIndex:10, margin:'8px 16px',
          background:'rgba(74,222,128,.15)', border:'1px solid rgba(74,222,128,.3)',
          borderRadius:8, padding:'8px 12px', color:'#4ade80', fontSize:12, textAlign:'center' }}>
          {toast}
        </div>
      )}
      <TelaGuardFormWrapper usuario={usuario} showToast={showToastLocal} onSucesso={onSucesso} />
    </div>
  );
}

function TelaGuardFormWrapper({ usuario, showToast, onSucesso }: {
  usuario: Usuario; showToast: (msg:string)=>void; onSucesso: ()=>void;
}) {
  const [Comp, setComp] = useState<React.ComponentType<any>|null>(null);
  useEffect(() => {
    import('./TelaGuard').then(m => setComp(() => m.FormNovaOcorrenciaExport||null));
  }, []);
  if (!Comp) return <div style={{ padding:32, textAlign:'center', color:'#4a5a7a' }}>Carregando...</div>;
  return <Comp usuario={usuario} showToast={showToast} onSucesso={onSucesso} />;
}


function TelaMapa({ usuario, onLogout }: { usuario: Usuario; onLogout: () => void }) {
  const { t } = useTranslation();
  const [kpis, setKpis] = useState({ ativas: 0, ocAbertas: 0, procurando: 0, roubos: 0 });
  const [notifList, setNotifList] = useState<Array<{id:string;msg:string;tipo:string;ts:number}>>([]);
  const [showNotif, setShowNotif] = useState(false);
  const isGestorApp    = ['admin','gestor','gestor_seg'].includes(usuario.role);
  const isLogisticaApp = ['admin','gestor','supergestor','logistica','campo','gestor_log'].includes(usuario.role);

  // FCM push notification token registration
  useEffect(() => {
    if (!usuario?.uid) return;
    (async () => {
      try {
        const { getMessaging, getToken } = await import('firebase/messaging');
        const { getApp } = await import('firebase/app');
        const messaging = getMessaging(getApp());
        const token = await getToken(messaging, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        });
        if (token) {
          const { doc: fDoc, setDoc: fSetDoc } = await import('firebase/firestore');
          await fSetDoc(fDoc(db, 'fcm_tokens', usuario.uid), {
            token, uid: usuario.uid, plataforma: 'web',
            atualizadoEm: new Date().toISOString(),
          });
        }
      } catch { /* FCM não disponível no browser atual */ }
    })();
  }, [usuario?.uid]);

  // Notificações em tempo real (últimas 50)
  useEffect(() => {
    // Sem orderBy para evitar permission-denied (sem índice criado)
    return onSnapshot(collection(db,'notificacoes_app'), snap => {
      const sorted = snap.docs
        .map(d => ({ id:d.id, ...d.data() } as any))
        .sort((a:any,b:any) => (b.ts||0) - (a.ts||0))
        .slice(0, 50);
      setNotifList(sorted);
    });
  }, []);

  const mapRef      = useRef<HTMLDivElement>(null);
  const leafletRef  = useRef<L.Map | null>(null);
  const layerRef    = useRef<L.LayerGroup | null>(null);

  const [estacoes,      setEstacoes]      = useState<Estacao[]>([]);
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
      console.log('[viewer] cidadesPermitidas =>', norm);
      console.log('[viewer] vai buscar estações por cidades:', norm);
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
  const [mapMode,       setMapMode]       = useState<'dark'|'light'>('dark');

  const [buscaCidade,   setBuscaCidade]   = useState('');
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
  const [turnoRegistro,   setTurnoRegistro  ]   = useState(false);
  const [gestorLogistica, setGestorLogistica]   = useState(false);
  const [pagamentosOpen,  setPagamentosOpen]    = useState(false);
  const [pagamentosAdminOpen, setPagamentosAdminOpen] = useState(false);
  const [tarefasLogistica, setTarefasLogistica] = useState(false);

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
    const unsub = onSnapshot(
      collection(db, 'ocorrencias'),
      snap => {
        const todas = snap.docs.map(d => d.data());
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
      },
      err => console.warn('[KPI ocorrencias]', err.code, err.message)
    );
    return () => unsub();
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
  const [zonaEditando,  setZonaEditando]  = useState<Record<string,unknown> | null>(null);
  const [zonaDrawing,   setZonaDrawing]   = useState(false);
  const [zonaForm,      setZonaForm]      = useState<{coords: [number,number][]} | null>(null);
  const poligonosLayerRef = useRef<L.LayerGroup | null>(null);
  const cicloviasLayerRef = useRef<L.LayerGroup | null>(null);
  const [filtrosStatus, setFiltrosStatus] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('jet_filtros_status'); return s ? new Set(JSON.parse(s)) : new Set(['NEGOCIACAO','SOLICITADO','APROVADO','INSTALADO','REPROVADO','CANCELADO']); }
    catch { return new Set(['NEGOCIACAO','SOLICITADO','APROVADO','INSTALADO','REPROVADO','CANCELADO']); }
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
            const { doc: fsDoc, updateDoc, collection: col } = await import('firebase/firestore');
            await updateDoc(fsDoc(col(db, 'estacoes'), id), { 'imagens.foto': url });
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

  // Firestore — carrega estações das cidades selecionadas
  useEffect(() => {
    if (!cidades.length) { setEstacoes([]); return; }

    const unsubs: (() => void)[] = [];
    const porCidade: Record<string, Estacao[]> = {};
    let cancelled = false;
    const merge = () => { if (!cancelled) setEstacoes(Object.values(porCidade).flat()); };

    // Raio de busca por coordenadas quando nome não bate (~50km)
    const dentroRaio = (lat: number, lng: number, cLat: number, cLng: number) => {
      const dlat = lat - cLat, dlng = lng - cLng;
      return (dlat * dlat + dlng * dlng) < 0.25; // ~0.5 grau ~ 50km
    };

    cidades.forEach(c => {
      const cTrim = c.trim();
      const q = query(collection(db, 'estacoes'), where('cidade', '==', cTrim));
      const unsub = onSnapshot(q, snap => {
        if (snap.docs.length > 0) {
          porCidade[cTrim] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Estacao));
          merge();
        } else {
          // Fallback: busca por coordenadas geográficas da cidade
          const coords = COORDS_CIDADES[cTrim];
          if (coords) {
            const [cLat, cLng] = coords;
            getDocs(collection(db, 'estacoes')).then(allSnap => {
              if (cancelled) return;
              const match = allSnap.docs.filter(d => {
                const { lat, lng } = d.data();
                return dentroRaio(Number(lat || 0), Number(lng || 0), cLat, cLng);
              });
              porCidade[cTrim] = match.map(d => ({ id: d.id, ...d.data() } as Estacao));
              merge();
            }).catch(() => {});
          } else {
            // Sem coordenadas: filtra por nome parcial
            getDocs(collection(db, 'estacoes')).then(allSnap => {
              if (cancelled) return;
              const cLow = cTrim.toLowerCase();
              const match = allSnap.docs.filter(d => {
                const v = (d.data().cidade || '').toLowerCase();
                return v.includes(cLow) || cLow.includes(v);
              });
              porCidade[cTrim] = match.map(d => ({ id: d.id, ...d.data() } as Estacao));
              merge();
            }).catch(() => {});
          }
        }
      });
      unsubs.push(unsub);
    });

    return () => { cancelled = true; unsubs.forEach(u => u()); };
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
  const [modoCluster, setModoCluster] = useState(true); // true=cluster por cidade, false=pins individuais
  const [ocorrCidades, setOcorrCidades] = useState<{cidade:string;count:number;lat:number;lng:number;tipos:Record<string,number>}[]>([]);
  const ocorrCidadesRef = useRef<L.LayerGroup|null>(null);

  // Busca cidades com estações — TODOS os países do usuário
  const paisesDoUsuario = usuario.paises || ['BR'];
  useEffect(() => {
    getDocs(collection(db, 'estacoes')).then(snap => {
      const mapa: Record<string, {lats: number[]; lngs: number[]; count: number; pais: string}> = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const c = data.cidade;
        if (!c || !data.lat || !data.lng) return;
        const lat = data.lat as number;
        const lng = data.lng as number;
        // Detectar país pela coordenada (ignora campo pais que pode estar errado)
        let coordPais = data.pais || 'BR';
        if (lat > 14 && lat < 33 && lng > -118 && lng < -86) coordPais = 'MX';
        else if (lat > -35 && lat < 5 && lng > -75 && lng < -30) coordPais = 'BR';
        // Incluir se for país do usuário (ou admin vê tudo)
        const userIsAdmin = ['admin','gestor'].includes(usuario.role);
        if (!userIsAdmin && !paisesDoUsuario.includes(coordPais)) return;
        if (!mapa[c]) mapa[c] = { lats: [], lngs: [], count: 0, pais: coordPais };
        mapa[c].lats.push(lat);
        mapa[c].lngs.push(lng);
        mapa[c].count++;
      });
      const lista = Object.entries(mapa).map(([cidade, v]) => ({
        cidade, count: v.count, pais: v.pais,
        lat: v.lats.reduce((a,b)=>a+b,0)/v.lats.length,
        lng: v.lngs.reduce((a,b)=>a+b,0)/v.lngs.length
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
        <div><strong>${d.count}</strong> ocorrência${d.count>1?'s':''}</div>
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
            SOLICITADO: '#93c5fd', // azul claro
            NEGOCIACAO: '#fbbf24', // âmbar/ouro
            APROVADO:   '#3b82f6', // azul médio
            INSTALADO:  '#1d4ed8', // azul forte
            REPROVADO:  '#7f1d1d', // vermelho escuro
            CANCELADO:  '#475569', // cinza azulado
          },
          PRIVADA: {
            SOLICITADO: '#fde68a', // âmbar claro
            NEGOCIACAO: '#f59e0b', // laranja/âmbar
            APROVADO:   '#f59e0b', // laranja médio
            INSTALADO:  '#b45309', // laranja/marrom forte
            REPROVADO:  '#991b1b', // vermelho escuro
            CANCELADO:  '#57534e', // cinza quente
          },
          CONCORRENTE: {
            SOLICITADO: '#fca5a5', // vermelho claro
            NEGOCIACAO: '#f97316', // laranja vermelho
            APROVADO:   '#ef4444', // vermelho médio
            INSTALADO:  '#b91c1c', // vermelho forte
            REPROVADO:  '#450a0a', // vermelho muito escuro
            CANCELADO:  '#6b7280', // cinza
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

        // InfoWindow completo
        marker.bindPopup(() => {
          const d = e as any;

          // Foto ou Street View
    const imgUrl = sanitizarFotoUrl(e.imagens?.foto || (e as any).foto || (e as any).fotoUrl) ||
     e.imagens?.streetView || '';
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

          // Documentos públicos (TPU / Autorização Prefeitura) — editável direto no popup
          const docPublico = d.docPublico || {};
          const docHtml = (e.cidade === 'São Paulo' || e.tipo === 'PUBLICA')
            ? `<div id="jet-doc-${e.id}" style="background:#e8f4fd;border:1px solid #b3d9f5;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:11px">
                <div style="font-weight:700;color:#1565c0;margin-bottom:5px">📄 Documentos Públicos</div>
                ${docPublico.tpu ? `<div style="color:#1976d2;margin:2px 0">🏛 TPU: <a href="${docPublico.tpu}" target="_blank" style="color:#1976d2;font-weight:600">Visualizar ↗</a></div>` : '<div style="color:#90a4ae;font-size:10px">🏛 TPU: não cadastrado</div>'}
                ${docPublico.autorizacao ? `<div style="color:#1976d2;margin:2px 0">✅ Autorização: <a href="${docPublico.autorizacao}" target="_blank" style="color:#1976d2;font-weight:600">Visualizar ↗</a></div>` : '<div style="color:#90a4ae;font-size:10px">✅ Autorização: não cadastrada</div>'}
                ${docPublico.obs ? `<div style="color:#555;font-size:10px;margin-top:3px">📝 ${docPublico.obs}</div>` : ''}
                <button onclick="window.dispatchEvent(new CustomEvent('jetEditDocPublico',{detail:{id:'${e.id}',cidade:'${e.cidade}',docPublico:${JSON.stringify(docPublico)}}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
                  style="margin-top:6px;width:100%;padding:4px;background:#1565c0;color:#fff;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer">
                  ✏️ ${docPublico.tpu || docPublico.autorizacao ? 'Atualizar documentos' : 'Adicionar documentos'}
                </button>
              </div>`
            : '';
          if (e.tipo === 'PRIVADA') {
            // privado pode estar em d.privado (Firestore subcampo)
            const p = d.privado || {};
            const temDados = p.nomeLocal || p.nomeAutorizante || p.telefone || p.email;
            tipoExtra = `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:8px 10px;margin:6px 0;font-size:11px;line-height:1.6">
              <div style="font-weight:700;color:#e65100;margin-bottom:4px">🏢 ${p.nomeLocal || '(nome não preenchido)'}</div>
              ${p.nomeAutorizante ? `<div style="color:#555">👤 ${p.nomeAutorizante}${p.cargoAutorizante ? ' &middot; ' + p.cargoAutorizante : ''}</div>` : ''}
              ${p.telefone ? `<div style="color:#555">📞 ${p.telefone}</div>` : ''}
              ${p.email    ? `<div style="color:#555">✉️ ${p.email}</div>`    : ''}
              ${d.consultor ? `<div style="color:#555">👷 ${d.consultor}</div>` : ''}
              ${!temDados ? '<div style="color:#e65100;font-size:10px">⚠ Dados do estabelecimento não registrados — clique em Editar</div>' : ''}
            </div>`;
          }

          // Dados técnicos
          const tecnico = e.larguraFaixa
            ? `<div style="font-size:11px;color:#888;margin:2px 0">
                Largura: <b style="color:#333">${e.larguraFaixa}m</b></div>` : '';


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
            style="background:#005bff;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;margin-right:4px">🌐 Street View</button>`;
          const fotoBtn = `<button onclick="window.dispatchEvent(new CustomEvent('jetFoto',{detail:{id:'${e.id}',codigo:'${e.codigo||''}',lat:${e.lat},lng:${e.lng}}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
            style="background:#10b981;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">📷 Foto</button>`;
          // Google Maps link opens the location in Maps (not embed)
          const gmapsUrl = `https://www.google.com/maps?q=${e.lat},${e.lng}&cbll=${e.lat},${e.lng}&layer=c`;
          const medirBtn = e.imagens?.foto
            ? `<button onclick="window.dispatchEvent(new CustomEvent('jetMedirFoto',{detail:{id:'${e.id}',fotoUrl:'${e.imagens.foto}'}}));this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button').click()"
                style="background:#1d4ed8;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">📐 Medir</button>`
            : '';
          const links = [
            svInlineBtn, fotoBtn, medirBtn,
            `<a href="${gmapsUrl}" target="_blank"
              style="color:#005bff;font-size:10px;text-decoration:none">🗺 Maps</a>`,
            e.imagens?.croqui ? `<a href="${e.imagens.croqui}" target="_blank"
              style="color:#7c3aed;font-size:10px;text-decoration:none">📐 Croqui</a>` : '',
            e.imagens?.foto && e.imagens?.foto !== imgUrl ? `<a href="${e.imagens.foto}" target="_blank"
              style="color:#16a34a;font-size:10px;text-decoration:none">📸 Foto</a>` : ''
          ].filter(Boolean).join(' · ');

          const bairroSubpref = [e.bairro, d.subprefeitura].filter(Boolean).join(' · ');

          // Foto — verificar múltiplos campos possíveis
const fotoSrc = sanitizarFotoUrl(e.imagens?.foto || (e as any).foto || (e as any).fotoUrl) ||
     e.imagens?.streetView || '';
          const thumbHtml = fotoSrc
            ? `<div style="position:relative;margin-bottom:8px;border-radius:8px;overflow:hidden;cursor:pointer"
                onclick="window.dispatchEvent(new CustomEvent('jetOpenFoto',{detail:{url:'${fotoSrc}'}}))">
                <img src="${fotoSrc}"
                  style="width:100%;height:140px;object-fit:cover;display:block"
                  onerror="this.parentElement.style.display='none'" />
                <div style="position:absolute;bottom:0;left:0;right:0;padding:5px 8px;
                  background:linear-gradient(transparent,rgba(0,0,0,.7));
                  font-size:9px;color:#fff;font-weight:600">🔍 Toque para ampliar</div>
              </div>`
            : `<div style="background:#f0f4f8;border-radius:8px;height:60px;display:flex;align-items:center;
                justify-content:center;margin-bottom:8px;cursor:pointer;border:2px dashed #cbd5e1"
                onclick="window.dispatchEvent(new CustomEvent('jetFoto',{detail:{id:'${e.id}',codigo:'${e.codigo||''}',lat:${e.lat},lng:${e.lng}}}));document.querySelector('.leaflet-popup-close-button')?.click()">
                <span style="font-size:11px;color:#64748b;font-weight:600">📷 Adicionar foto</span>
              </div>`;

          return `<div style="min-width:220px;max-width:260px;font-family:Inter,sans-serif">
            ${docHtml}
            ${thumbHtml}
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
                ? `<button onclick="window._editClick('${e.id}')" style="flex:1;padding:5px;background:#fff3e0;border:none;border-radius:5px;color:#e65100;font-size:10px;font-weight:600;cursor:pointer">Editar</button>`
                : ''}
              <button onclick="window._croquiClick('${e.id}')" style="flex:1;padding:5px;background:#f3e8ff;border:none;border-radius:5px;color:#7c3aed;font-size:10px;font-weight:600;cursor:pointer">Croqui</button>
              ${isGestor
                ? `<button onclick="window._delClick('${e.id}')" style="flex:1;padding:5px;background:#fde8e8;border:none;border-radius:5px;color:#c62828;font-size:10px;font-weight:600;cursor:pointer">Del</button>`
                : ''}
              ${isSuperGestor
                ? `<button onclick="window._monitorClick('${e.id}')" style="flex:1;padding:5px;background:${(e as any).tipoMonitor ? '#052e16' : '#f0fdf4'};border:1px solid ${(e as any).tipoMonitor ? '#16a34a' : '#86efac'};border-radius:5px;color:${(e as any).tipoMonitor ? '#4ade80' : '#15803d'};font-size:10px;font-weight:700;cursor:pointer">${(e as any).tipoMonitor ?? 'Monitor'}</button>`
                : ''}
              ${isLogisticaApp
                ? `<button onclick="window._tarefaEstacaoClick('${e.id}','${(e.endereco||e.codigo||'').replace(/'/g,'')}',${e.lat},${e.lng})" style="width:100%;margin-top:4px;padding:7px;background:#3b82f6;border:none;border-radius:5px;color:#fff;font-size:11px;font-weight:700;cursor:pointer">📦 + Criar tarefa</button>`
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
      if (!confirm(`Gerar croqui para ${est.codigo}?\nIsso pode levar ~30 segundos.`)) return;
      showToast('Gerando croqui...', 'info');
      try {
        const res = await fnGerarCroqui()({ estacaoId: id });
        const d = (res.data || res) as unknown as { ok: boolean; pdfUrl: string };
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
      const d = (r.data || r) as { ok: boolean; error?: string };
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
          const { doc: fsDoc, updateDoc } = await import('firebase/firestore');
          await updateDoc(fsDoc(db, 'estacoes', codigo), { lat: ev.latlng.lat, lng: ev.latlng.lng });
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
         const { doc, updateDoc, collection: col, query: fsQ, where: fsW, getDocs, addDoc } = await import('firebase/firestore');     
                                                                                                                                      
         if (dados.codigo) {                                                                                                          
           // ── MODO EDIÇÃO ──────────────────────────────────────────────                                                           
           const { id, tipo, status, larguraFaixa, observacoes, privado, nomeConcorrente, lat, lng, cidade, bairro, endereco,         
      consultor, fotoUrl } = dados as any;                                                                                             
                                                                                                                                      
           const patch: Record<string, any> = {                                                                                       
            tipo, status, lat, lng, cidade, bairro, endereco,                                                                        
            consultor: consultor || null,                                                                                            
            ...(larguraFaixa != null ? { larguraFaixa } : {}),                                                                       
            ...(observacoes        ? { observacoes }        : {}),                                                                   
            ...(privado            ? { privado }            : {}),                                                                   
            ...(nomeConcorrente    ? { nomeConcorrente }    : {}),                                                                   
            ...(fotoUrl ? { 'imagens.foto': fotoUrl } : {}), // ✅ Salva no caminho correto                                           
            ultimoEditor: usuario.uid,                                                                                               
            ultimoEditorNome: (usuario as any).nome || usuario.email,                                                                
            atualizadoEm: new Date().toISOString()                                                                                   
          };                                                                                                                         
                                                                                                                                     
          let updated = false;                                                                                                       
          // 1. Tenta pelo docId real                                                                                                
          if (id) {                                                                                                                  
            try {                                                                                                                    
              await updateDoc(doc(db, 'estacoes', id), patch);                                                                       
              updated = true;                                                                                                        
            } catch (e) { console.error("Erro updateDoc ID:", e); }                                                                  
          }                                                                                                                          
                                                                                                                                     
          // 2. Fallback pelo codigo (se o ID falhar)                                                                                
          if (!updated) {                                                                                                            
            const snap = await getDocs(fsQ(col(db, 'estacoes'), fsW('codigo', '==', dados.codigo)));                                 
            if (!snap.empty) {                                                                                                       
              await updateDoc(snap.docs[0].ref, patch);                                                                              
              updated = true;                                                                                                        
            }                                                                                                                        
          }                                                                                                                          
                                                                                                                                    
          if (!updated) throw new Error('Documento não encontrado: ' + dados.codigo);                                                
                                                                                                                                     
          // ✅ Atualiza o estado local para o mapa refletir a mudança na hora                                                        
          setEstacoes(prev => prev.map(e => e.codigo === dados.codigo ? { ...e, ...patch, imagens: { ...e.imagens, foto: fotoUrl ||  
      e.imagens?.foto } } : e));                                                                                                       
                                                                                                                                     
          showToast('Estação atualizada!', 'success');                                                                               
     // Dentro de salvarEstacao, no bloco do else (Nova Estação):                                       
     } else {                                                                                           
       // ── NOVA ESTAÇÃO ─────────────────────────────────────────────                                 
       const { addDoc, collection: col } = await import('firebase/firestore');                          
                                                                                                        
       const cidadeAbrev = ((dados.cidade as string) || 'SP').toUpperCase().slice(0, 2);                
       const ts = Date.now().toString().slice(-6);                                                      
       const codigoGerado = `${cidadeAbrev}-${ts}`;                                                     
       const cidadeNorm = ((dados.cidade as string) || '').trim();                                      
                                                                                                       
      // Criamos uma cópia dos dados e REMOVEMOS o id para não dar erro de undefined                   
      const dadosParaSalvar = { ...dados };                                                            
      delete dadosParaSalvar.id; // ✅ Remove o campo id que está vindo como undefined                  
                                                                                                       
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
                                                                                                       
      const docRef = await addDoc(col(db, 'estacoes'), novaEstacao);                                   
                                                                                                       
      setEstacoes((prev: any[]) => [...prev, { id: docRef.id, ...novaEstacao }]);                      
      showToast('Estação adicionada!', 'success');                                                     
    }                                                                                                  
                                                                                                                            
        setDrawerAberto(false); setPinLatLng(null); setEstacaoEdit(null);                                                            
      } catch(e: unknown) {                                                                                                          
        showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');                                                       
      }                                                                                                                              
    }, [usuario, db, showToast]);                                                                                                    


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
        <button onClick={() => isViewer ? null : setCidadeModal(true)} style={{
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
        {isGestorApp && (
                  <button onClick={() => setUsuariosModulo(v => !v)} style={{
                    background: usuariosModulo ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
                    border: `1px solid ${usuariosModulo ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.1)'}`,
                    borderRadius: 8, color: usuariosModulo ? '#60a5fa' : 'rgba(255,255,255,.5)',
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer'
                  }}>👥</button>
                )}
                {usuario.role === 'admin' && (
                  <button onClick={() => setPainelConfig(v => !v)} style={{
                    background: painelConfig ? 'rgba(99,102,241,.15)' : 'rgba(255,255,255,.06)',
                    border: `1px solid ${painelConfig ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.1)'}`,
                    borderRadius: 8, color: painelConfig ? '#818cf8' : 'rgba(255,255,255,.5)',
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer'
                  }}>⚙️</button>
                )}
                        <div style={{ flex: 1 }} />
        <button onClick={() => setGuiaModulo(v => !v)}
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
          <button onClick={() => setShowNotif(v => !v)}
            style={{ width:30, height:30, borderRadius:'50%', cursor:'pointer',
              background: showNotif?'rgba(251,191,36,.2)':'rgba(255,255,255,.06)',
              border:`1px solid ${showNotif?'rgba(251,191,36,.4)':'rgba(255,255,255,.08)'}`,
              color: showNotif?'#fbbf24':'rgba(255,255,255,.5)',
              fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>
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
          <button onClick={() => setShowPerfilPrestador(true)} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            color: 'rgba(255,255,255,.6)', borderRadius: 8, width: 34, height: 34,
            fontSize: 16, cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>👤</button>
        )}
        <button onClick={onLogout} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}>⏻</button>
      </div>
      {/* KPIs para gestor/admin */}
      {isGestorApp && (
        <div style={{ padding:'3px 12px', background:'rgba(0,0,0,.25)',
          borderTop:'1px solid rgba(255,255,255,.04)',
          display:'flex', gap:16, alignItems:'center', flexShrink:0, overflowX:'auto',
          scrollbarWidth:'none' as const }}>
          <div style={{ fontSize:10, color:'#4a5a7a', whiteSpace:'nowrap' as const }}>
            🏢 Ativas: <b style={{ color:'#4ade80' }}>
              {estacoes.filter((e:any)=>
                e.status==='INSTALADO' &&
                (cidades.length===0 || cidades.includes(e.cidade))
              ).length}
            </b>
          </div>
          <div style={{ fontSize:10, color:'#4a5a7a', whiteSpace:'nowrap' as const }}>
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
            <button onClick={() => { setAnalyticsModulo(v => !v); setDashboardModulo(false); }} style={{
              background: analyticsModulo ? 'rgba(61,155,255,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${analyticsModulo ? 'rgba(61,155,255,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: analyticsModulo ? '#3d9bff' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>📊 Analytics</button>
          )}

          <button onClick={() => setDashboardModulo(v => !v)} style={{
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
            <button onClick={() => setGuardDash(v => !v)} style={{
              background: guardDash ? 'rgba(192,132,252,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${guardDash ? 'rgba(192,132,252,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: guardDash ? '#c084fc' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>📊 Guard Dash</button>
          )}

          <button onClick={() => setPainelRoubos(v => !v)} style={{
            background: painelRoubos ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${painelRoubos ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: painelRoubos ? '#ef4444' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>🔴 Roubos</button>
          <button onClick={() => setPainelPerdas(v => !v)} style={{
            background: painelPerdas ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${painelPerdas ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: painelPerdas ? '#ef4444' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>📊 Perdas</button>
        </>}

        {(isGestorLog || isPrestadorLogistica) && (
          <>
          {isGestorApp && (
            <button onClick={() => setShowWorkers(v => !v)} style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              background: showWorkers ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${showWorkers ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
              color: showWorkers ? '#10b981' : 'rgba(255,255,255,.5)',
              fontSize: 12, fontWeight: 600,
            }}>👥 Campo</button>
          )}
          {isLogisticaApp && (
            <button
              onClick={() => { setTarefasLogistica(v => !v); setParkingParaTarefa(null); }}
              style={{
                padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tarefasLogistica ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
                color: tarefasLogistica ? '#10b981' : 'rgba(255,255,255,.5)',
                fontSize: 12, fontWeight: 600,
              }}>
              📦 Tarefas
            </button>
          )}
          <button onClick={() => { setSlotsModulo(v => !v); setDashboardModulo(false); }} style={{
            background: slotsModulo? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
            border: `1px solid ${slotsModulo? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
            borderRadius: 8, color: slotsModulo? '#10b981' : 'rgba(255,255,255,.5)',
            fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>📦 Slots</button>
          {isGestorLog && (
            <button onClick={() => setGestorLogistica(v => !v)} style={{
              background: gestorLogistica ? 'rgba(26,111,212,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${gestorLogistica ? 'rgba(26,111,212,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: gestorLogistica ? '#307FE2' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>🚚 Gestor Log.</button>
          )}
          {/* Pagamentos — prestadores veem seus ganhos; gestores/admin veem painel de validação */}
          {isPrestadorLogistica && (
            <button onClick={() => setPagamentosOpen(true)} style={{
              background: pagamentosOpen ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.06)',
              border: `1px solid ${pagamentosOpen ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'}`,
              borderRadius: 8, color: pagamentosOpen ? '#10b981' : 'rgba(255,255,255,.5)',
              fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
            }}>💰 Pagamentos</button>
          )}
          {isGestorLog && (
            <button onClick={() => setPagamentosAdminOpen(true)} style={{
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
      {!isViewer && <div style={{
        position: 'fixed', right: 16, bottom: 100, zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        {/* FAB Locais Logísticos — principal */}
        {isGestor && (
          <>
            {/* Sub-botões expandidos quando showLocaisOp=true */}
            {showLocaisOp && (
              <>
                {/* Add pin no mapa */}
                <button onClick={() => setModoAddLocal(m => !m)}
                  title={modoAddLocal ? t('fab.cancelAction') : t('fab.addLocalMap')}
                  style={{ width:40, height:40, borderRadius:10, border:'none', cursor:'pointer',
                    background: modoAddLocal?'rgba(239,68,68,.9)':'rgba(52,211,153,.9)',
                    color:'#fff', fontSize:18, display:'flex', alignItems:'center',
                    justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)', transition:'all .15s' }}>
                  {modoAddLocal ? '✕' : '📍'}
                </button>
                {/* Abrir painel financeiro */}
                <button onClick={() => setFinanceiro(v => !v)} title={t('fab.financial')}
                  style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                    border:`2px solid ${financeiro?'rgba(74,222,128,.5)':'rgba(255,255,255,.2)'}`,
                    background: financeiro?'rgba(74,222,128,.2)':'rgba(13,18,30,.85)',
                    backdropFilter:'blur(8px)',
                    color: financeiro?'#4ade80':'rgba(255,255,255,.6)',
                    fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
                  💳
                </button>
              </>
            )}
            {/* Botão principal 🏭 — toggle locais no mapa */}
            <button
              onClick={() => {
                setShowLocaisOp(v => !v);
                if (showLocaisOp) { setFinanceiro(false); setModoAddLocal(false); }
              }}
              title={t('fab.locais')}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${showLocaisOp?'rgba(52,211,153,.5)':'rgba(255,255,255,.15)'}`,
                background: showLocaisOp?'rgba(52,211,153,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)',
                color: showLocaisOp?'#34d399':'rgba(255,255,255,.5)',
                fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
              🏭
            </button>
          </>
        )}

        {/* FAB POIs — expande 3 sub-botões */}
        {showPOIsFab && (
          <>

            {/* POIs Google — DESATIVADO */}
            {false && (
            <button title={t('fab.poisGoogle')}
              onClick={async () => {
                if (poiGoogleDados.length > 0) { setShowPoiFilterPanel(v => !v); return; }
                const map = leafletRef.current; if (!map) return;
                const c = map.getCenter();
                const zoom = map.getZoom();
                const raioKm = zoom >= 14 ? 2 : zoom >= 12 ? 4 : 6;
                setPoiLoading(true);
                try {
                  // DESATIVADO: POIs Google
                  // const res = await fnBuscarPOIs()({ lat: c.lat, lng: c.lng, raio: raioKm, useGrid: zoom < 13 }) as any;
                  setPoiGoogleDados([]);
                  // DESATIVADO: POIs Google
                  // if (!resultado.length) showToast('Nenhum POI Google encontrado nesta área', 'info');
                  // else { showToast(`${resultado.length} POIs Google encontrados`, 'success'); setShowPoiFilterPanel(true); }
                } catch(e:any) { showToast('Erro POIs Google: ' + (e as any).message, 'error'); }
                setPoiLoading(false);
              }}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${poiGoogleDados.length>0?'rgba(251,191,36,.4)':'rgba(255,255,255,.15)'}`,
                background: poiGoogleDados.length>0 ? 'rgba(251,191,36,.2)' : 'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: poiGoogleDados.length>0 ? '#fbbf24' : 'rgba(255,255,255,.5)',
                fontSize:15, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
              {poiLoading ? '⏳' : '🗺'}
            </button>
            )}

            {/* Pt. Candidatos FAB */}
            <button title={t('fab.candidates')}
              onClick={() => setCandidatosModulo(v => !v)}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${candidatosModulo?'rgba(251,191,36,.4)':'rgba(255,255,255,.15)'}`,
                background: candidatosModulo ? 'rgba(251,191,36,.2)' : 'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: candidatosModulo ? '#fbbf24' : 'rgba(255,255,255,.5)',
                fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
              🎯
            </button>
            {/* POIs OSM */}
            <button title={t('fab.poisOsm')}
              onClick={async () => {
                if (showPOILayer) {
                  // Desligar OSM
                  setShowPOILayer(false);
                  setPoiLayerData([]);
                  setPoiTiposAtivos(null);
                  setShowPoiFilterPanel(false);
                  if (osmMoveHandlerRef.current) {
                    leafletRef.current?.off('moveend', osmMoveHandlerRef.current);
                    osmMoveHandlerRef.current = null;
                  }
                  return;
                }
                const novoEstado = true;
                setShowPOILayer(novoEstado);
                const map = leafletRef.current; if (!map) return;
                if (novoEstado) {
                  let osmDebounceTimer: ReturnType<typeof setTimeout> | null = null;
                  const buscarOSM = () => {
                    if (osmDebounceTimer) clearTimeout(osmDebounceTimer);
                    osmDebounceTimer = setTimeout(async () => {
                      const c = map.getCenter(); const zoom = map.getZoom();
                      const raioKm = zoom >= 14 ? 2 : zoom >= 12 ? 4 : 6;
                      setPoiLoading(true);
                      try {
                        // DESATIVADO: POIs Google
                        // const res = await fnBuscarPOIs()({ lat: c.lat, lng: c.lng, raio: raioKm, useGrid: zoom < 13 }) as any;
                        setPoiLayerData([]);
                      } catch(e:any) { showToast('Erro POIs: ' + e.message, 'error'); }
                      finally { setPoiLoading(false); }
                    }, 1500);
                  };
                  if (osmMoveHandlerRef.current) map.off('moveend', osmMoveHandlerRef.current);
                  osmMoveHandlerRef.current = buscarOSM;
                  map.on('moveend', buscarOSM);
                  buscarOSM();
                } else {
                  if (osmMoveHandlerRef.current) { map.off('moveend', osmMoveHandlerRef.current); osmMoveHandlerRef.current = null; }
                  setPoiLayerData([]);
                }
              }}
              style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
                border:`2px solid ${showPOILayer?'rgba(16,185,129,.4)':'rgba(255,255,255,.15)'}`,
                background: showPOILayer ? 'rgba(16,185,129,.2)' : 'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)', color: showPOILayer ? '#10b981' : 'rgba(255,255,255,.5)',
                fontSize:15, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>
              📍
            </button>
          </>
        )}

        {/* FAB POIs — só gestor/campo */}
        {isGestor && <button onClick={() => setShowPOIsFab(v => !v)} title={t('fab.pois')}
          style={{ width:40, height:40, borderRadius:10, cursor:'pointer',
            border:`2px solid ${showPOIsFab||showPOILayer||poiGoogleDados.length>0?'rgba(16,185,129,.5)':'rgba(255,255,255,.15)'}`,
            background: showPOIsFab||showPOILayer||poiGoogleDados.length>0 ? 'rgba(16,185,129,.2)' : 'rgba(13,18,30,.85)',
            backdropFilter:'blur(8px)',
            color: showPOIsFab||showPOILayer||poiGoogleDados.length>0 ? '#10b981' : 'rgba(255,255,255,.5)',
            fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 2px 8px rgba(0,0,0,.4)',
          }}>
          {showPOIsFab ? '✕' : '🔍'}
        </button>}

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

        {/* GoJet ao vivo */}
        {(isGestorApp || isCampo || isLogisticaApp) && (
          <button title="GoJet ao vivo" onClick={() => setShowGoJetLayer(v => !v)}
            style={{ width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
              border: `2px solid ${showGoJetLayer ? 'rgba(16,185,129,.5)' : 'rgba(255,255,255,.15)'}`,
              background: showGoJetLayer ? 'rgba(16,185,129,.2)' : 'rgba(13,18,30,.85)',
              backdropFilter: 'blur(8px)',
              color: showGoJetLayer ? '#10b981' : 'rgba(255,255,255,.5)',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>🛴</button>
        )}

        {/* GoJet Dashboard */}
        {isGestor && (
          <button title="GoJet Dashboard" onClick={() => setGojetDash(v => !v)}
            style={{ width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
              border: `2px solid ${gojetDash ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.15)'}`,
              background: gojetDash ? 'rgba(59,130,246,.2)' : 'rgba(13,18,30,.85)',
              backdropFilter: 'blur(8px)',
              color: gojetDash ? '#60a5fa' : 'rgba(255,255,255,.5)',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>📊</button>
        )}

        {/* GoJet Analytics — breakdown zonas/patinetes */}
        {isGestor && (
          <button title="Analytics GoJet" onClick={() => setGojetAnalytics(v => !v)}
            style={{ width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
              border: `2px solid ${gojetAnalytics ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.15)'}`,
              background: gojetAnalytics ? 'rgba(167,139,250,.2)' : 'rgba(13,18,30,.85)',
              backdropFilter: 'blur(8px)',
              color: gojetAnalytics ? '#a78bfa' : 'rgba(255,255,255,.5)',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>📈</button>
        )}

        {/* Turno — registro entrada/saída */}
        {(usuario?.role === 'campo' || usuario?.role === 'logistica' || usuario?.role === 'motorista' || isGestorApp) && (
          <button title="Registro de Turno" onClick={() => setTurnoRegistro(v => !v)}
            style={{ width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
              border: `2px solid ${turnoRegistro ? 'rgba(34,197,94,.5)' : 'rgba(255,255,255,.15)'}`,
              background: turnoRegistro ? 'rgba(34,197,94,.2)' : 'rgba(13,18,30,.85)',
              backdropFilter: 'blur(8px)',
              color: turnoRegistro ? '#22c55e' : 'rgba(255,255,255,.5)',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>⏱</button>
        )}

        {/* Ciclovias */}
        {cidade && (
          <button onClick={() => setCicloviasOn(v => !v)} title={t('fab.cycleways')}
            style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${cicloviasOn?'#00e676':'rgba(255,255,255,.15)'}`, cursor: 'pointer',
              background: cicloviasOn ? 'rgba(0,230,118,.2)' : 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
              color: cicloviasOn ? '#00e676' : 'rgba(255,255,255,.5)', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>🚲</button>
        )}
        {/* Zonas — guard visualiza, gestor edita (botões edição abaixo são isGestor) */}
        {cidade && (isGestorApp || isCampo || isLogisticaApp) && (
          <button onClick={() => setPoligonosOn(v => !v)} title={t('fab.zones')}
            style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${poligonosOn?'#60a5fa':'rgba(255,255,255,.15)'}`, cursor: 'pointer',
              background: poligonosOn ? 'rgba(96,165,250,.2)' : 'rgba(13,18,30,.85)', backdropFilter: 'blur(8px)',
              color: poligonosOn ? '#60a5fa' : 'rgba(255,255,255,.5)', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
            }}>⬡</button>
        )}
        {/* Nova cidade expansão */}
        {isGestor && cidadesExpShow && (
          <button onClick={() => setCidadeExpModal({ latLng: leafletRef.current ? (() => { const c = leafletRef.current!.getCenter(); return {lat:c.lat,lng:c.lng}; })() : {lat:0,lng:0} })}
            title={t('fab.addExpCity')}
            style={{ width:40, height:40, borderRadius:10, border:'2px solid rgba(99,102,241,.4)',
              cursor:'pointer', background:'rgba(99,102,241,.15)', backdropFilter:'blur(8px)',
              color:'#818cf8', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>🌍</button>
        )}

        {/* Gerir zonas — abre ZonasManager com edição de vértices */}
        {isGestor && poligonosOn && (
          <>
            <button onClick={() => setZonasModulo(v => !v)} title={t('fab.manageZones')}
              style={{ width:40, height:40, borderRadius:10,
                border:`2px solid ${zonasModulo?'#c084fc':'rgba(255,255,255,.15)'}`,
                cursor:'pointer',
                background: zonasModulo?'rgba(192,132,252,.2)':'rgba(13,18,30,.85)',
                backdropFilter:'blur(8px)',
                color: zonasModulo?'#c084fc':'rgba(255,255,255,.5)', fontSize:16,
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 2px 8px rgba(0,0,0,.4)',
              }}>⬡</button>
            <button onClick={() => setZonaEditor(v => !v)} title={t('fab.drawZone')}
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
        <button onClick={() => setRaioAtivo(v => !v)} title={t('fab.radius').replace('{n}', String(raioMetros))}
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
        {/* Guard FAB — gestor_seg tem destaque maior */}
        {(isGestorApp || isCampo || isLogisticaApp) && (
          <button onClick={() => setNovaOcorrencia(v => !v)}
            title={t('fab.guard')}
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
        }} title={t('fab.myLocation')}
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



      {/* Botão Satélite */}
      <button
        onClick={() => {
          const map = leafletRef.current;
          if (!map) return;
          const sat = (window as any).__satLayer;
          if (sat) {
            map.removeLayer(sat);
            delete (window as any).__satLayer;
          } else {
            // Camada satélite Google (s=satélite, y=satélite+rótulos, h=híbrido)
            const satTile = L.tileLayer(
              'https://mt0.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',
              { attribution:'© Google Maps', maxZoom:21, opacity:1 }
            );
            satTile.addTo(map);
            (window as any).__satLayer = satTile;
          }
          // força re-render
          setMapMode(m => m);
        }}
        style={{ position:'fixed', bottom:20, left:'50%',
          transform:`translateX(calc(-50% + ${(typeof window!=='undefined' && (window as any).__satLayer) ? '0px' : '60px'}))`,
          zIndex:1000, padding:'7px 14px', borderRadius:20,
          background:'rgba(13,18,30,.9)', border:'1px solid rgba(16,185,129,.3)',
          color:'#34d399', fontSize:11, fontWeight:600, cursor:'pointer',
          backdropFilter:'blur(8px)', display:'flex', alignItems:'center', gap:5 }}>
        🛰 {(typeof window!=='undefined' && (window as any).__satLayer) ? '✓ Satélite' : 'Satélite'}
      </button>

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
        title={t('fab.addStation')}
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
            <div style={{ position:'relative', marginBottom:12, flexShrink:0 }}>
              <input
                value={buscaCidade}
                onChange={e => setBuscaCidade(e.target.value)}
                placeholder={t('cities.search')}
                autoFocus
                style={{ width:'100%', padding:'9px 12px', borderRadius:10, boxSizing:'border-box',
                  border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.06)',
                  color:'#fff', fontSize:13, outline:'none' }}
              />
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
                // Cidades com estações
                const comEst = cidadesVisiveis
                  .filter(c => !busca || c.cidade.toLowerCase().includes(busca))
                  .sort((a,b) => a.cidade.localeCompare(b.cidade));
                // Cidades sem estações (planejamento) — só gestor — todos os países
                const todosPaisesUser = usuario.paises || ['BR'];
                const semEst = isGestor
                  ? todosPaisesUser.flatMap((p: string) =>
                      (CIDADES[p] || [])
                        .filter((c: string) => !cidadesReais.find(r => r.cidade === c))
                        .filter((c: string) => !busca || c.toLowerCase().includes(busca))
                        .map((c: string) => ({ cidade: c, pais: p }))
                    ).sort((a: any, b: any) => a.cidade.localeCompare(b.cidade))
                  : [];
                if (!comEst.length && !semEst.length) {
                  return <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>Nenhuma cidade encontrada</div>;
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
                      <div style={{ fontSize:12, color:'#4a5a7a', padding:'8px 0', marginBottom:8 }}>{t('cities.noStations')}</div>
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
          onClick={e => e.target===e.currentTarget && setFotoCapturaCtx(null)}>
          <div style={{ width:'100%', maxWidth:400, background:'#0d1521',
            borderRadius:'16px 16px 0 0', padding:20, fontFamily:'Inter,sans-serif' }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#dce8ff', marginBottom:4 }}>📷 Foto da estação</div>
            <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:16 }}>Selecione uma foto para esta estação</div>
            <div style={{ display:'flex', gap:8 }}>
              <label style={{ flex:1, padding:'14px', borderRadius:10, cursor:'pointer', textAlign:'center',
                background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)', color:'#34d399',
                fontSize:13, fontWeight:600, display:'block' }}>
                📷 Câmera
                <input type="file" accept="image/*" capture="environment" style={{ display:'none' }}
                  onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const id = fotoCapturaCtx.estacaoId!;
                    try {
                      const url = await uploadComRetry(file, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
                      const { doc: fsDoc, updateDoc } = await import('firebase/firestore');
                      await updateDoc(fsDoc(db, 'estacoes', id), { 'imagens.foto': url });
                      showToast('Foto salva!', 'success');
                    } catch (err:any) { showToast('Erro: ' + err.message, 'error'); }
                    setFotoCapturaCtx(null);
                  }} />
              </label>
              <label style={{ flex:1, padding:'14px', borderRadius:10, cursor:'pointer', textAlign:'center',
                background:'rgba(59,130,246,.1)', border:'1px solid rgba(59,130,246,.3)', color:'#60a5fa',
                fontSize:13, fontWeight:600, display:'block' }}>
                🖼 Galeria
                <input type="file" accept="image/*" style={{ display:'none' }}
                  onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const id = fotoCapturaCtx.estacaoId!;
                    try {
                      const url = await uploadComRetry(file, 'estacoes/fotos/' + id + '_' + Date.now() + '.jpg');
                      const { doc: fsDoc, updateDoc } = await import('firebase/firestore');
                      await updateDoc(fsDoc(db, 'estacoes', id), { 'imagens.foto': url });
                      showToast('Foto salva!', 'success');
                    } catch (err:any) { showToast('Erro: ' + err.message, 'error'); }
                    setFotoCapturaCtx(null);
                  }} />
              </label>
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
          usuario={{ uid: usuario.uid, nome: usuario.nome, email: usuario.email, role: usuario.role, cidade }}
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
      {painelConfig && usuario.role === 'admin' && (
        <PainelConfiguracoes onFechar={() => setPainelConfig(false)} cidadeAtual={cidade} />
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

// Botão de foto inline no DrawerAdd — câmera ou galeria
function FotoBotaoDrawer({ lat, lng, onFotoSalva }: {
  lat: number; lng: number;
  onFotoSalva: (url: string, file?: File) => void;
}) {
  const { t } = useTranslation();
  const [loading,  setLoading]  = useState(false);
  const [preview,  setPreview]  = useState<{base64:string; file:File} | null>(null);
  const [showUrl,  setShowUrl]  = useState(false);
  const [urlVal,   setUrlVal]   = useState('');
  const inputRef   = useRef<HTMLInputElement>(null);
  const inputGalRef = useRef<HTMLInputElement>(null);

  // Upload de base64 (após edição de medidas ou direto)
  const uploadBase64 = async (base64: string, file?: File) => {
    setLoading(true);
    setPreview(null);
    try {
      const ext  = file?.name.split('.').pop() || 'jpg';
      const path = 'estacoes/fotos/' + Date.now() + '_' + Math.random().toString(36).slice(-4) + '.' + ext;
      const fetchRes = await fetch(base64);
      const blob     = await fetchRes.blob();
      const url = await uploadComRetry(blob, path);
      onFotoSalva(url, file);
    } catch (err) {
      console.error('[FotoBotao] upload error:', err);
      alert('Erro ao enviar foto. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Lê arquivo e converte para base64 imediatamente — antes de qualquer upload
  const processarArquivo = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      // Mostrar preview com opção de medir ou salvar direto
      setPreview({ base64, file });
    };
    reader.onerror = () => alert('Erro ao ler foto. Tente novamente.');
    reader.readAsDataURL(file);
  };

  const btn: React.CSSProperties = {
    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12,
    background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
    color: 'rgba(255,255,255,.5)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  };

  // Preview local com opções: Salvar direto | Medir área | Refazer
  if (preview) {
    return (
      <div>
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.15)', marginBottom: 8 }}>
          <img src={preview.base64} alt="preview"
            style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setPreview(null)}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              color: 'rgba(255,255,255,.4)' }}>
            🔄 Refazer
          </button>
          <button type="button" onClick={() => {
            // Abrir editor de medidas com base64 local — sem Firebase, sem CORS
            window.dispatchEvent(new CustomEvent('jetAbrirMedidas', {
              detail: { base64: preview.base64, file: preview.file,
                onSalvar: (b64: string) => uploadBase64(b64, preview.file) }
            }));
          }}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.3)',
              color: '#60a5fa', fontWeight: 600 }}>
            📐 Medir área
          </button>
          <button type="button" onClick={() => uploadBase64(preview.base64, preview.file)}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)',
              color: '#4ade80', fontWeight: 600 }}>
            ✓ Salvar
          </button>
        </div>
      </div>
    );
  }

  const confirmarUrl = () => {
    const u = urlVal.trim();
    if (!u.startsWith('http')) return;
    onFotoSalva(u);
    setShowUrl(false);
    setUrlVal('');
  };

  if (showUrl) return (
    <div>
      <input autoFocus value={urlVal}
        onChange={e => setUrlVal(e.target.value)}
        onPaste={e => setTimeout(() => { if ((e.target as HTMLInputElement).value.startsWith('http')) confirmarUrl(); }, 80)}
        onKeyDown={e => { if (e.key === 'Enter') confirmarUrl(); }}
        placeholder="Cole a URL da imagem (http://...)"
        style={{ width: '100%', padding: '9px 10px', borderRadius: 8, boxSizing: 'border-box' as const,
          background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)',
          color: '#dce8ff', fontSize: 12, outline: 'none', marginBottom: 6 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => { setShowUrl(false); setUrlVal(''); }}
          style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.4)' }}>
          Cancelar
        </button>
        <button type="button" onClick={confirmarUrl}
          style={{ flex: 2, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
            background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.3)',
            color: '#4ade80', fontWeight: 600 }}>
          ✓ Usar URL
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={e => { const f=e.target.files?.[0]; if(f) processarArquivo(f); e.target.value=''; }} />
      <input ref={inputGalRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={e => { const f=e.target.files?.[0]; if(f) processarArquivo(f); e.target.value=''; }} />
      {loading ? (
        <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: '#60a5fa',
          background: 'rgba(96,165,250,.08)', borderRadius: 8, border: '1px solid rgba(96,165,250,.2)' }}>
          ⏳ Enviando foto...
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => inputRef.current?.click()}    style={btn} type="button">{`📷 ${t('drawer.camera')}`}</button>
          <button onClick={() => inputGalRef.current?.click()} style={btn} type="button">{`🖼 ${t('drawer.gallery')}`}</button>
          <button onClick={() => setShowUrl(true)}             style={btn} type="button">🔗 URL</button>
        </div>
      )}
    </div>
  );
}

// ── Helper reverseGeocode via Nominatim ──────────────────────────────
async function reverseGeocode(lat: number, lng: number): Promise<Record<string,string> | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt-BR`
    );
    const d = await r.json();
    if (d.address) {
      const a = d.address;
      return {
        endereco: d.display_name || '',
        bairro:   a.suburb || a.neighbourhood || a.city_district || '',
        cidade:   a.city || a.town || a.county || '',
        estado:   a.state || '',
        pais:     a.country_code?.toUpperCase() || 'BR',
      };
    }
  } catch {}
  return null;
}


// ── GeoInputField — 1 campo para coordenada completa ─────────────────
// Aceita: "-8.063116, -34.872091" ou "-8.063116,-34.872091" ou "POINT(-34.87 -8.06)"
function GeoInputField({ onCoordChange, mapaLocRef, markerLocRef }: {
  onCoordChange: (lat:number, lng:number, geo?:Record<string,string>) => void;
  mapaLocRef: React.MutableRefObject<any>;
  markerLocRef: React.MutableRefObject<any>;
}) {
  const [val, setVal] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);

  const parseGeo = (s: string): {lat:number;lng:number} | null => {
    // Tentar vários formatos
    const nums = s.replace(/[^0-9.,-]/g,' ').trim().split(/[\s,;]+/).filter(Boolean);
    if (nums.length >= 2) {
      const a = parseFloat(nums[0]), b = parseFloat(nums[1]);
      if (!isNaN(a) && !isNaN(b)) {
        // Detectar lat/lng pela magnitude (lat Brasil: -35 a -3, lng: -75 a -30)
        if (a >= -35 && a <= -3 && b >= -75 && b <= -30) return {lat:a, lng:b};
        if (b >= -35 && b <= -3 && a >= -75 && a <= -30) return {lat:b, lng:a};
        // Fora do Brasil mas válidos
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return {lat:a, lng:b};
      }
    }
    return null;
  };

  const aplicar = async () => {
    const coords = parseGeo(val);
    if (!coords) { setErro('Formato inválido. Ex: -8.063116, -34.872091'); setOk(false); return; }
    setErro('');
    try {
      const res = await reverseGeocode(coords.lat, coords.lng) as any;
      const d = res.data as any;
      onCoordChange(coords.lat, coords.lng, d.ok ? d.geo : undefined);
    } catch {
      onCoordChange(coords.lat, coords.lng, undefined);
    }
    if (mapaLocRef.current && markerLocRef.current) {
      mapaLocRef.current.setView([coords.lat, coords.lng], 17);
      markerLocRef.current.setLatLng([coords.lat, coords.lng]);
    }
    setOk(true);
  };

  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:4 }}>
        Cole as coordenadas completas (ex: <code style={{color:'#60a5fa'}}>-8.063116, -34.872091</code>)
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <input
          value={val}
          onChange={e => { setVal(e.target.value); setOk(false); setErro(''); }}
          onKeyDown={e => e.key==='Enter' && aplicar()}
          placeholder="-8.063116, -34.872091"
          style={{ flex:1, padding:'8px 10px', borderRadius:8,
            border:`1px solid ${erro?'rgba(239,68,68,.4)':ok?'rgba(74,222,128,.4)':'rgba(255,255,255,.1)'}`,
            background:'rgba(255,255,255,.06)', color:'#fff', fontSize:12, outline:'none' }}
        />
        <button type="button" onClick={aplicar}
          style={{ padding:'8px 12px', borderRadius:8, cursor:'pointer', border:'none',
            background:'rgba(96,165,250,.2)', color:'#60a5fa', fontSize:12, fontWeight:700 }}>
          ✓
        </button>
      </div>
      {erro && <div style={{ fontSize:9, color:'#f87171', marginTop:3 }}>{erro}</div>}
      {ok   && <div style={{ fontSize:9, color:'#4ade80', marginTop:3 }}>✓ Localização aplicada</div>}
    </div>
  );
}


// ── DrawerLocSelector — GPS / Mapa / Busca para DrawerAdd ────────────
function DrawerLocSelector({
  latLng, geo, geoLoading, modoLoc, setModoLoc, showMapaLoc, setShowMapaLoc,
  buscaLocEnd, setBuscaLocEnd, buscandoLocEnd, setBuscandoLocEnd,
  mapContainerRef, mapaLocRef, markerLocRef, onCoordChange,
}: {
  latLng: {lat:number;lng:number};
  geo: Record<string,string>;
  geoLoading: boolean;
  modoLoc: string; setModoLoc: (v:any)=>void;
  showMapaLoc: boolean; setShowMapaLoc: (v:boolean)=>void;
  buscaLocEnd: string; setBuscaLocEnd: (v:string)=>void;
  buscandoLocEnd: boolean; setBuscandoLocEnd: (v:boolean)=>void;
  mapContainerRef: React.RefObject<HTMLDivElement>;
  mapaLocRef: React.MutableRefObject<any>;
  markerLocRef: React.MutableRefObject<any>;
  onCoordChange: (lat:number, lng:number, geo?:Record<string,string>) => void;
}) {
  const { t } = useTranslation();
  // Inicializar mapa quando aberto
  useEffect(() => {
    if (!showMapaLoc || !mapContainerRef.current || mapaLocRef.current) return;
    setTimeout(() => {
      if (!mapContainerRef.current) return;
      const map = L.map(mapContainerRef.current, { center:[latLng.lat,latLng.lng], zoom:16, zoomControl:true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { attribution:'©CartoDB', maxZoom:19 }).addTo(map);
      const marker = L.marker([latLng.lat,latLng.lng],{draggable:true}).addTo(map);
      markerLocRef.current = marker;
      marker.on('dragend', async () => {
        const ll = marker.getLatLng();
        try {
          const res = await reverseGeocode(ll.lat, ll.lng) as any;
          const d = res.data as any;
          onCoordChange(ll.lat, ll.lng, d.ok ? d.geo : undefined);
        } catch { onCoordChange(ll.lat, ll.lng, undefined); }
      });
      map.on('click', async (e:L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        try {
          const res = await reverseGeocode(e.latlng.lat, e.latlng.lng) as any;
          const d = res.data as any;
          onCoordChange(e.latlng.lat, e.latlng.lng, d.ok ? d.geo : undefined);
        } catch { onCoordChange(e.latlng.lat, e.latlng.lng, undefined); }
      });
      mapaLocRef.current = map;
    }, 100);
  }, [showMapaLoc]);

  const buscarEndereco = async () => {
    if (!buscaLocEnd.trim()) return;
    setBuscandoLocEnd(true);
    try {
      const res = await fnGeocodeForward()({ address: buscaLocEnd }) as any;
      const d = res.data as any;
      if (d.ok) {
        onCoordChange(d.lat, d.lng, d.geo);
        if (mapaLocRef.current && markerLocRef.current) {
          mapaLocRef.current.setView([d.lat, d.lng], 17);
          markerLocRef.current.setLatLng([d.lat, d.lng]);
        }
      } else {
        alert('Endereço não encontrado. Tente ser mais específico.');
      }
    } catch (e: any) {
      alert('Erro ao buscar endereço: ' + e.message);
    }
    setBuscandoLocEnd(false);
  };

  const capturarGPS = () => {
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      try {
        const res = await reverseGeocode(lat, lng) as any;
        const d = res.data as any;
        onCoordChange(lat, lng, d.ok ? d.geo : undefined);
      } catch {
        onCoordChange(lat, lng, undefined);
      }
      if (mapaLocRef.current && markerLocRef.current) {
        mapaLocRef.current.setView([lat,lng],17);
        markerLocRef.current.setLatLng([lat,lng]);
      }
    }, () => alert('GPS indisponível'));
  };

  const inp: React.CSSProperties = {
    flex:1, padding:'8px 10px', borderRadius:8,
    border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.06)',
    color:'#fff', fontSize:12, outline:'none',
  };

  return (
    <div>
      {/* Botões modo */}
      <div style={{ display:'flex', gap:5, marginBottom:8 }}>
        {[
          { key:'gps',   icon:'📡', label:t('drawer.gps') },
          { key:'mapa',  icon:'🗺',  label:t('drawer.map') },
          { key:'busca', icon:'🔍', label:t('drawer.address') },
          { key:'geo',   icon:'🌐', label:t('drawer.geo') },
        ].map(m => (
          <button key={m.key} type="button" onClick={() => {
            setModoLoc(m.key);
            if (m.key==='mapa') setShowMapaLoc(true); else setShowMapaLoc(false);
            if (m.key==='gps') capturarGPS();
            if (m.key==='geo') setBuscaLocEnd('');
          }} style={{
            flex:1, padding:'7px 4px', borderRadius:8, cursor:'pointer', fontSize:11,
            background: modoLoc===m.key ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.05)',
            border: `1px solid ${modoLoc===m.key ? 'rgba(96,165,250,.4)' : 'rgba(255,255,255,.08)'}`,
            color: modoLoc===m.key ? '#60a5fa' : 'rgba(255,255,255,.45)',
            fontWeight: modoLoc===m.key ? 700 : 400,
          }}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Busca de endereço */}
      {modoLoc === 'busca' && (
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>
          <input value={buscaLocEnd} onChange={e=>setBuscaLocEnd(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&buscarEndereco()}
            placeholder={t('drawer.addressSearch')} style={inp} />
          <button type="button" onClick={buscarEndereco} disabled={buscandoLocEnd}
            style={{ padding:'8px 12px', borderRadius:8, cursor:'pointer', border:'none',
              background:'rgba(96,165,250,.2)', color:'#60a5fa', fontSize:12, fontWeight:700 }}>
            {buscandoLocEnd?'⏳':'🔍'}
          </button>
        </div>
      )}

      {/* Geo — 1 campo para coordenada completa "-8.063116, -34.872091" */}
      {modoLoc === 'geo' && (
        <GeoInputField
          onCoordChange={onCoordChange}
          mapaLocRef={mapaLocRef}
          markerLocRef={markerLocRef}
        />
      )}

      {/* Mapa inline */}
      {showMapaLoc && (
        <div style={{ borderRadius:10, overflow:'hidden', marginBottom:8,
          border:'1px solid rgba(96,165,250,.2)' }}>
          <div style={{ padding:'5px 10px', background:'rgba(96,165,250,.1)',
            fontSize:10, color:'#60a5fa' }}>
            Toque no mapa ou arraste o pin para ajustar
          </div>
          <div ref={mapContainerRef} style={{ width:'100%', height:220 }} />
        </div>
      )}

      {/* Coords atuais */}
      <div style={{ fontSize:9, color:'rgba(255,255,255,.25)', marginBottom:4 }}>
        📍 {latLng.lat.toFixed(6)}, {latLng.lng.toFixed(6)}
        {geoLoading && <span style={{marginLeft:6,color:'#4a5a7a'}}>· geocodificando...</span>}
      </div>
    </div>
  );
}


function DrawerAdd({ latLng, cidadeAtual, pais, fotoInicial, onSalvar, onFechar, estacaoEdit, onMedirFoto, topOffset = 52 }: {
  latLng: {lat:number;lng:number};
  cidadeAtual: string;
  pais: string;
  fotoInicial?: string;
  onSalvar: (d: Record<string, unknown>) => Promise<void>;
  onFechar: () => void;
  estacaoEdit?: Estacao | null;
  onMedirFoto?: (fotoUrl: string, fotoFile?: File) => void;
  topOffset?: number;
}) {
  const { t } = useTranslation();
  const [tipo,        setTipo]        = useState(estacaoEdit?.tipo      || 'PUBLICA');
  const [status,      setStatus]      = useState(estacaoEdit?.status    || 'SOLICITADO');
  const [largura,     setLargura]     = useState(String(estacaoEdit?.larguraFaixa || ''));
  const [obs,         setObs]         = useState('');
  const [consultor,   setConsultor]   = useState((estacaoEdit as any)?.consultor || '');
  const [fotoUrl,     setFotoUrl]     = useState(fotoInicial || '');
  const [fotoFileRef, setFotoFileRef] = useState<File | undefined>(undefined);

  // Escutar resultado do FotoMedidas (evento global)
  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail as string;
      setFotoUrl(url);
    };
    window.addEventListener('jetFotoMedida', handler);
    return () => window.removeEventListener('jetFotoMedida', handler);
  }, []);
  const [geo,         setGeo]         = useState<Record<string,string>>({ cidade: cidadeAtual, pais });
  const [geoLoading,  setGeoLoading]  = useState(true);
  // LocSelector — modo de localização
  const [modoLoc,     setModoLoc]     = useState<'gps'|'mapa'|'busca'>('gps');
  const [showMapaLoc, setShowMapaLoc] = useState(false);
  const [buscaLocEnd, setBuscaLocEnd] = useState('');
  const [buscandoLocEnd, setBuscandoLocEnd] = useState(false);
  const [coordAtual,  setCoordAtual]  = useState({ lat: latLng.lat, lng: latLng.lng });
  const mapaLocRef2   = useRef<any>(null);
  const markerLocRef2 = useRef<any>(null);
  const mapContainerRef2 = useRef<HTMLDivElement>(null);
  const [busy,        setBusy]        = useState(false);

  // Privado
  const [nomeLocal,   setNomeLocal]   = useState(estacaoEdit?.privado?.nomeLocal        || '');
  const [nomeAuth,    setNomeAuth]    = useState(estacaoEdit?.privado?.nomeAutorizante  || '');
  const [cargoAuth,   setCargoAuth]   = useState(estacaoEdit?.privado?.cargoAutorizante || '');
  const [telAuth,     setTelAuth]     = useState(estacaoEdit?.privado?.telefone         || '');
  const [emailAuth,   setEmailAuth]   = useState(estacaoEdit?.privado?.email            || '');
  const [assinatura,  setAssinatura]  = useState(estacaoEdit?.privado?.assinatura       || '');
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

    reverseGeocode(latLng.lat, latLng.lng)
      .then(r => {
        const d = (r?.data || r) as unknown as { ok: boolean; geo?: Record<string,string> };
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
                                                                                                       
      // Criamos o objeto base                                                                         
      const payload: Record<string, any> = {                                                           
        lat: coordAtual.lat,                                                                           
        lng: coordAtual.lng,                                                                           
        cidade: geo.cidade || cidadeAtual || '',                                                       
        bairro: geo.bairro || '',                                                                      
        endereco: geo.endereco || '',                                                                  
        tipo,                                                                                          
        status,                                                                                        
        larguraFaixa: largura ? parseFloat(largura) : null,                                            
        observacoes:  obs     || null,                                                                 
        nomeConcorrente: conc,                                                                         
        privado,                                                                                       
        geo,                                                                                           
        pais: geo.pais || pais,
      consultor: consultor.trim() || null,                                                           
      fotoUrl:   fotoUrl || null,                                                                    
      };                                                                                               
                                                                                                       
      // ✅ SÓ ADICIONA O ID SE FOR EDIÇÃO                                                              
      if (estacaoEdit?.id) {                                                                           
        payload.id = estacaoEdit.id;                                                                   
      }                                                                                                
                                                                                                       
      if (modoEdicao) {                                                                                
        payload.codigo = estacaoEdit!.codigo;                                                          
      }                                                                                                
                                                                                                       
      await onSalvar(payload);                                                                         
      setBusy(false);                                                                                  
    };                                                                                                                          

  return (
    <>
      <div style={{ position: 'fixed', top: topOffset, right: 0,
        width: typeof window !== 'undefined' && window.innerWidth <= 480 ? '100%' : 400,
        height: 'calc(100% - ' + topOffset + 'px)',
        background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(255,255,255,.08)',
        zIndex: typeof window !== 'undefined' && window.innerWidth <= 480 ? 1050 : 450,
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif',
        overflowY: 'auto', scrollbarWidth: 'thin' as const }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
              {modoEdicao ? t('drawer.editStation') : t('drawer.addStation')}
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

          {/* LocSelector — GPS / Mapa / Busca */}
          <DrawerLocSelector
            latLng={coordAtual}
            geo={geo}
            geoLoading={geoLoading}
            modoLoc={modoLoc}
            setModoLoc={setModoLoc}
            showMapaLoc={showMapaLoc}
            setShowMapaLoc={setShowMapaLoc}
            buscaLocEnd={buscaLocEnd}
            setBuscaLocEnd={setBuscaLocEnd}
            buscandoLocEnd={buscandoLocEnd}
            setBuscandoLocEnd={setBuscandoLocEnd}
            mapContainerRef={mapContainerRef2}
            mapaLocRef={mapaLocRef2}
            markerLocRef={markerLocRef2}
            onCoordChange={(lat, lng, geoData) => {
              setCoordAtual({ lat, lng });
              if (geoData) setGeo(geoData);
            }}
          />
          {/* Endereço geocodificado (leitura) */}
          {!geoLoading && !showMapaLoc && (
          <div style={{ padding: '8px 12px', borderRadius: 8,
            background: 'rgba(48,127,226,.06)', border: '1px solid rgba(48,127,226,.15)',
            fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            {geo.cidade}{geo.bairro ? ` · ${geo.bairro}` : ''}
            {geo.endereco ? <div style={{ marginTop:2, fontSize:10, color:'rgba(255,255,255,.35)' }}>{geo.endereco}</div> : null}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
                    {coordAtual.lat.toFixed(6)}, {coordAtual.lng.toFixed(6)}
                  </span>
                  {modoEdicao && (
                    <button
                      onClick={() => {
                        // Emite evento para o mapa entrar em modo de reposicionamento do pin
                        window.dispatchEvent(new CustomEvent('jetReposicionarPin', {
                          detail: { lat: coordAtual.lat, lng: coordAtual.lng, codigo: estacaoEdit!.codigo }
                        }));
                      }}
                      style={{
                        background: 'rgba(96,165,250,.15)', border: '1px solid rgba(96,165,250,.3)',
                        borderRadius: 6, color: '#60a5fa', fontSize: 10, cursor: 'pointer',
                        padding: '3px 8px', fontWeight: 600,
                      }}
                    >📍 Ajustar pin</button>
                  )}
                </div>
            </div>
          )}

          {/* Foto do local */}
          <div>
            <label style={lbl}>{t('drawer.photo')}</label>
            {fotoUrl ? (
              <div>
                <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(16,185,129,.3)', position: 'relative' }}>
                  <img src={fotoUrl} alt="foto" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(16,185,129,.9)', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#fff', fontWeight: 600 }}>📷 Foto salva</div>
                  <button onClick={() => { setFotoUrl(''); setFotoFileRef(undefined); }}
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}>✕</button>
                </div>
                {/* Botão medir — aparece abaixo da foto */}
                {onMedirFoto && (
                  <button onClick={async () => {
                    // fotoUrl já é base64 se veio da câmera via novo fluxo
                    if (fotoUrl.startsWith('data:') || fotoUrl.startsWith('blob:')) {
                      onMedirFoto(fotoUrl, undefined); return;
                    }
                    // URL remota (foto já salva): converter para base64 via fetch
                    try {
                      const r = await fetch(fotoUrl);
                      const b = await r.blob();
                      const base64 = await new Promise<string>((res, rej) => {
                        const rd = new FileReader(); rd.onload=()=>res(rd.result as string); rd.onerror=rej; rd.readAsDataURL(b);
                      });
                      onMedirFoto(base64, undefined);
                    } catch { onMedirFoto(fotoUrl, undefined); }
                  }}
                    style={{ width: '100%', marginTop: 6, padding: '8px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.25)',
                      color: '#60a5fa', fontSize: 11, fontWeight: 600, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    📐 Marcar área com medidas
                  </button>
                )}
              </div>
            ) : (
              <FotoBotaoDrawer
                lat={latLng.lat} lng={latLng.lng}
                onFotoSalva={(url: string, file?: File) => { setFotoUrl(url); setFotoFileRef(file); }}
              />
            )}
          </div>

          {/* Tipo */}
          <div>
            <label style={lbl}>{t('drawer.stationType')}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { k: 'PUBLICA',      label: t('drawer.public'),      cor: '#3b82f6' },
                { k: 'PRIVADA',      label: t('drawer.private'),      cor: '#f59e0b' },
                { k: 'CONCORRENTE',  label: t('drawer.competitor'),  cor: '#ef4444' }
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
            <label style={lbl}>{t('drawer.status')}</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              style={{ ...inp, appearance: 'none',
                background: 'rgba(255,255,255,.06)',
                color: status === 'INSTALADO'  ? '#93c5fd' :
                       status === 'APROVADO'   ? '#60a5fa' :
                       status === 'NEGOCIACAO' ? '#fbbf24' :
                       status === 'SOLICITADO' ? '#bfdbfe' :
                       status === 'REPROVADO'  ? '#fca5a5' :
                       status === 'CANCELADO'  ? '#94a3b8' : '#fff',
              }}>
              {[
                { v: 'SOLICITADO', l: t('filters.requested') },
                { v: 'NEGOCIACAO', l: t('filters.negotiation') },
                { v: 'APROVADO',   l: t('filters.approved')   },
                { v: 'INSTALADO',  l: t('filters.installed')  },
                { v: 'REPROVADO',  l: t('filters.rejected')  },
                { v: 'CANCELADO',  l: t('filters.cancelled')  },
              ].map(s => <option key={s.v} value={s.v} style={{ background: '#0d1220', color: '#fff' }}>{s.l}</option>)}
            </select>
          </div>

          {/* Consultor de campo */}
          <div>
            <label style={lbl}>{t('drawer.consultant')}</label>
            <input value={consultor} onChange={e => setConsultor(e.target.value)}
              placeholder={t('drawer.consultantPlaceholder')} style={inp} />
          </div>

          {/* Largura faixa */}
          <div>
            <label style={lbl}>{t('drawer.laneWidth')}</label>
            <input type="number" step="0.1" min="0" value={largura}
              onChange={e => setLargura(e.target.value)}
              placeholder={t('drawer.laneWidthPlaceholder')} style={inp} />
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
            <label style={lbl}>{t('drawer.observations')}</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)}
              rows={3} placeholder={t('drawer.obsPlaceholder')}
              style={{ ...inp, resize: 'vertical', minHeight: 72 }} />
          </div>
        </div>

        {/* Footer — sempre visível */}
        <div style={{ padding: '16px 20px',
          paddingBottom: typeof window !== 'undefined' && window.innerWidth <= 480 ? 24 : 16,
          borderTop: '1px solid rgba(255,255,255,.06)',
          display: 'flex', gap: 8, flexShrink: 0,
          background: 'rgba(13,18,30,.97)' }}>
          <button onClick={onFechar} style={{ flex: 1, padding: 12,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 10, color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button disabled={busy} onClick={handleSalvar} style={{ flex: 2, padding: 12,
            background: busy ? 'rgba(48,127,226,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? t('drawer.saving') : modoEdicao ? t('drawer.saveChanges') : t('drawer.addStation')}
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
  const { t } = useTranslation();
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
          }}>{t('drawer.cancel')}</button>
          <button disabled={busy} onClick={async () => {
            setBusy(true);
            await onSalvar(zona.id as string, { nome, grupo, fase, cor, prioridade: parseInt(prioridade)||1, ativo });
            setBusy(false);
          }} style={{
            flex: 2, padding: 11,
            background: busy ? 'rgba(168,85,247,.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
          }}>{busy ? t('drawer.saving') : 'Salvar'}</button>
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
  const { t } = useTranslation();
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
          }}>{t('drawer.cancel')}</button>
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
            {busy ? t('drawer.saving') : 'Salvar zona'}
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
          position: 'fixed', top: 'auto', right: 12, marginTop: 4,
          background: '#1a1f2e', border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 8, overflow: 'hidden', zIndex: 2000, minWidth: 90,
          boxShadow: '0 4px 20px rgba(0,0,0,.6)'
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
type Tela = 'loading' | 'login' | 'mapa' | 'guard' | 'trocar-senha' | 'prestador-pendente';

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
  const r = String(raio);
  // Cobertura ampla: transporte, gastronomia, saúde, educação, lazer, comércio, pedestres
  return '[out:json][timeout:30];('
    // Transporte
    + 'node["railway"~"subway_entrance|station|tram_stop"](around:' + r + ',' + c + ');'
    + 'node["highway"~"bus_stop|crossing|traffic_signals"](around:' + r + ',' + c + ');'
    + 'node["amenity"~"bus_station|ferry_terminal|taxi"](around:' + r + ',' + c + ');'
    // Gastronomia e vida noturna
    + 'node["amenity"~"restaurant|cafe|fast_food|bar|pub|nightclub|food_court|ice_cream|bakery"](around:' + r + ',' + c + ');'
    // Saúde
    + 'node["amenity"~"pharmacy|hospital|clinic|dentist|veterinary|doctors"](around:' + r + ',' + c + ');'
    // Educação
    + 'node["amenity"~"school|university|college|kindergarten|library"](around:' + r + ',' + c + ');'
    // Financeiro
    + 'node["amenity"~"bank|atm|money_transfer"](around:' + r + ',' + c + ');'
    // Serviços públicos
    + 'node["amenity"~"police|fire_station|post_office|townhall|courthouse|embassy"](around:' + r + ',' + c + ');'
    // Lazer e esporte
    + 'node["leisure"~"park|fitness_centre|sports_centre|stadium|swimming_pool|playground|dance"](around:' + r + ',' + c + ');'
    + 'node["amenity"~"cinema|theatre|arts_centre|casino|gambling|stripclub"](around:' + r + ',' + c + ');'
    // Comércio
    + 'node["shop"~"mall|supermarket|convenience|bakery|clothes|electronics|hairdresser|beauty|hardware"](around:' + r + ',' + c + ');'
    // Turismo e hospedagem
    + 'node["tourism"~"hotel|hostel|motel|museum|attraction|viewpoint|information"](around:' + r + ',' + c + ');'
    // Infraestrutura
    + 'node["amenity"~"parking|fuel|charging_station|bicycle_parking|car_wash"](around:' + r + ',' + c + ');'
    + 'node["amenity"~"recycling|waste_basket|drinking_water|shower|toilets"](around:' + r + ',' + c + ');'
    // Religioso
    + 'node["amenity"~"place_of_worship"](around:' + r + ',' + c + ');'
    // Ways (áreas grandes)
    + 'way["amenity"~"hospital|university|school|park|cinema|stadium"](around:' + r + ',' + c + ');'
    + ');out center qt 600;';
}

function parseOverpassElements(elements: any[], refLat: number, refLng: number): any[] {
  const R = 6371000;
  function dist(la: number, lo: number) {
    const dLat = (la-refLat)*Math.PI/180, dLon = (lo-refLng)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(refLat*Math.PI/180)*Math.cos(la*Math.PI/180)*Math.sin(dLon/2)**2;
    return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
  }
  const tipoMap: Record<string,string> = {
    // Transporte
    subway_entrance:'subway_entrance',station:'station',tram_stop:'station',
    bus_stop:'bus_stop',bus_station:'bus_station',ferry_terminal:'station',taxi:'taxi',
    crossing:'faixa_pedestre',traffic_signals:'semaforo',
    // Gastronomia
    restaurant:'restaurant',cafe:'cafe',fast_food:'fast_food',bar:'bar',pub:'bar',
    nightclub:'balada',food_court:'restaurant',ice_cream:'cafe',bakery:'bakery',
    // Saúde
    pharmacy:'pharmacy',hospital:'hospital',clinic:'clinic',dentist:'clinic',
    veterinary:'veterinary',doctors:'clinic',
    // Educação
    school:'school',university:'university',college:'university',
    kindergarten:'school',library:'library',
    // Financeiro
    bank:'bank',atm:'bank',money_transfer:'bank',
    // Serviços públicos
    police:'police',fire_station:'police',post_office:'post_office',
    townhall:'governo',courthouse:'governo',embassy:'governo',
    // Lazer
    park:'park',fitness_centre:'fitness_centre',sports_centre:'fitness_centre',
    stadium:'stadium',swimming_pool:'fitness_centre',playground:'park',
    dance:'balada',cinema:'cinema',theatre:'theatre',arts_centre:'theatre',
    casino:'entretenimento',gambling:'entretenimento',stripclub:'balada',
    // Comércio
    mall:'mall',supermarket:'supermarket',convenience:'convenience',
    clothes:'shopping',electronics:'shopping',hairdresser:'servicos',
    beauty:'servicos',hardware:'shopping',
    // Turismo
    hotel:'hotel',hostel:'hotel',motel:'hotel',museum:'museum',
    attraction:'attraction',viewpoint:'viewpoint',information:'attraction',
    // Infraestrutura
    parking:'parking',fuel:'fuel',charging_station:'charging_station',
    bicycle_parking:'parking',car_wash:'servicos',
    // Religioso
    place_of_worship:'religioso',
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

// ── Modal de detalhe de POI Google (igual ao padrão estações) ───────────
function POIGoogleDetalheModal({ poi, onFechar }: { poi: any; onFechar: () => void }) {
  const [svFull, setSvFull] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const copiarCoords = () => {
    navigator.clipboard.writeText(poi.lat + ', ' + poi.lng).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 2000);
    });
  };

  const overlay: CSSProperties = {
    position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:9999,
    display:'flex',alignItems:'center',justifyContent:'center',padding:16,
  };
  const card: CSSProperties = {
    background:'#0d1521',border:'1px solid rgba(255,255,255,.1)',borderRadius:16,
    width:'100%',maxWidth:420,maxHeight:'90vh',overflowY:'auto',
    scrollbarWidth:'thin',scrollbarColor:'#1c2535 transparent',
  };
  const row: CSSProperties = { display:'flex',gap:8,padding:'8px 16px' };
  const lbl: CSSProperties = { fontSize:9,color:'#4a5a7a',textTransform:'uppercase',letterSpacing:.5,fontWeight:700 };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={card}>

        {/* Header */}
        <div style={{ padding:'14px 16px 10px',borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:14,fontWeight:700,color:'#dce8ff',marginBottom:2 }}>{poi.nome}</div>
              <div style={{ fontSize:10,color:'#fbbf24',fontWeight:600 }}>{poi.tipo}</div>
            </div>
            <button onClick={onFechar} style={{ background:'none',border:'none',color:'#4a5a7a',fontSize:18,cursor:'pointer',padding:0 }}>✕</button>
          </div>
          {poi.endereco && <div style={{ fontSize:10,color:'#4a5a7a',marginTop:4 }}>{poi.endereco}</div>}
          {poi.rating && (
            <div style={{ fontSize:10,color:'#fbbf24',marginTop:4 }}>
              {'★'.repeat(Math.round(poi.rating))}{'☆'.repeat(5-Math.round(poi.rating))}
              {' '}{poi.rating.toFixed(1)} ({poi.total_ratings} avaliações)
            </div>
          )}
        </div>

        {/* Street View */}
        {poi.street_view_url && (
          <div style={{ position:'relative',cursor:'pointer' }} onClick={() => setSvFull(true)}>
            <img src={poi.street_view_url} alt="Street View"
              style={{ width:'100%',height:160,objectFit:'cover',display:'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
            <div style={{
              position:'absolute',bottom:6,right:8,background:'rgba(0,0,0,.6)',
              borderRadius:6,padding:'2px 7px',fontSize:9,color:'#fff',
            }}>🌐 Street View — clique para ampliar</div>
          </div>
        )}

        {/* Foto do lugar */}
        {poi.foto_url && (
          <img src={poi.foto_url} alt={poi.nome}
            style={{ width:'100%',height:120,objectFit:'cover',display:'block' }}
            onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
        )}

        {/* Ações */}
        <div style={{ ...row, paddingTop:12, flexWrap:'wrap' as const, gap:6 }}>
          {[
            { label:'🗺 Ver no Maps',    cor:'#3b82f6', action: () => window.open(poi.maps_url,'_blank') },
            { label: copiado ? '✓ Copiado!' : '📋 Copiar coords', cor:'#10b981', action: copiarCoords },
            { label:'🌐 Street View',    cor:'#a78bfa', action: () => setSvFull(true) },
          ].map(({ label, cor, action }) => (
            <button key={label} onClick={action} style={{
              background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.1)',
              borderRadius:8,color:cor,fontSize:11,fontWeight:600,
              padding:'6px 12px',cursor:'pointer',
            }}>{label}</button>
          ))}
        </div>

        {/* Coordenadas */}
        <div style={{ padding:'8px 16px 14px' }}>
          <div style={lbl}>Coordenadas</div>
          <div style={{ fontSize:11,color:'#9fb3c8',fontFamily:'monospace',marginTop:3 }}>
            {poi.lat.toFixed(6)}, {poi.lng.toFixed(6)}
          </div>
          {poi.salvoEm?.toDate && (
            <div style={{ fontSize:9,color:'#4a5a7a',marginTop:6 }}>
              Salvo em: {poi.salvoEm.toDate().toLocaleDateString('pt-BR')}
              {poi.fonte === 'google' ? ' · Google Places' : ' · OSM'}
            </div>
          )}
        </div>
      </div>

      {/* Street View fullscreen */}
      {svFull && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.95)',zIndex:10000,
          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}
          onClick={() => setSvFull(false)}>
          <img src={poi.street_view_url} alt="Street View"
            style={{ maxWidth:'95vw',maxHeight:'85vh',borderRadius:12,objectFit:'contain' }}/>
          <div style={{ color:'rgba(255,255,255,.4)',fontSize:11,marginTop:10 }}>
            Clique para fechar · {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Filtros dos POIs Google ───────────────────────────────────────────
const POI_GOOGLE_LABEL: Record<string,string> = {
  restaurant:'🍽 Restaurante', cafe:'☕ Café', bar:'🍺 Bar', nightclub:'🎵 Balada',
  fast_food:'🍔 Fast Food', bakery:'🥐 Padaria', ice_cream:'🍦 Sorveteria',
  transit_station:'🚇 Metrô/Trem', bus_station:'🚌 Ônibus', taxi:'🚕 Táxi',
  lodging:'🏨 Hotel', hostel:'🛏 Hostel', hotel:'🏨 Hotel',
  shopping_mall:'🛍 Shopping', supermarket:'🛒 Mercado', convenience:'🏪 Conveniência',
  pharmacy:'💊 Farmácia', hospital:'🏥 Hospital', clinic:'🏥 Clínica',
  dentist:'🦷 Dentista', veterinary:'🐾 Veterinário',
  bank:'🏦 Banco', atm:'💳 ATM',
  university:'🎓 Universidade', school:'📚 Escola', library:'📖 Biblioteca',
  park:'🌳 Parque', gym:'💪 Academia', stadium:'🏟 Estádio', swimming_pool:'🏊 Piscina',
  museum:'🏛 Museu', cinema:'🎬 Cinema', theatre:'🎭 Teatro', attraction:'⭐ Atração',
  police:'👮 Polícia', post_office:'📮 Correios', townhall:'🏛 Prefeitura',
  parking:'🅿 Estacionamento', fuel:'⛽ Posto', charging_station:'🔌 Recarga',
  place_of_worship:'⛪ Igreja', beauty:'💅 Beleza', hairdresser:'💈 Barbearia',
  clothes:'👔 Roupa', electronics:'📱 Eletrônico', outros:'📍 Outros',
};

function POIGoogleFiltros({ dados, tiposAtivos, onChange, bottom }: {
  dados: any[]; tiposAtivos: Set<string>;
  onChange: (s: Set<string>) => void; bottom: number;
}) {
  const tipos = Array.from(new Set(dados.map((p: any) => p.tipo))).sort() as string[];
  const visiveis = tiposAtivos.size > 0 ? dados.filter((p: any) => tiposAtivos.has(p.tipo)).length : dados.length;

  return (
    <div style={{ position:'fixed', bottom, left:'50%', transform:'translateX(-50%)',
      zIndex:1000, width:'min(96vw, 720px)' }}>
      <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:'8px 12px',
        background:'rgba(8,13,24,.97)', borderRadius:12,
        border:'1px solid rgba(251,191,36,.35)',
        boxShadow:'0 4px 24px rgba(0,0,0,.85)', backdropFilter:'blur(12px)',
        maxHeight:170, overflowY:'auto', scrollbarWidth:'thin',
        scrollbarColor:'#1c2535 transparent' }}>
        <div style={{ width:'100%', display:'flex', alignItems:'center',
          justifyContent:'space-between', marginBottom:4 }}>
          <span style={{ fontSize:10, color:'#fbbf24', fontWeight:700 }}>
            🗺 POIs Google — {visiveis} visíveis
          </span>
          <button onClick={() => onChange(new Set())}
            style={{ padding:'2px 10px', borderRadius:8, fontSize:9, cursor:'pointer',
              background:'rgba(251,191,36,.15)', border:'1px solid rgba(251,191,36,.4)',
              color:'#fbbf24', fontWeight:600 }}>
            Todos ({dados.length})
          </button>
        </div>
        {tipos.map(t => {
          const count = dados.filter((p: any) => p.tipo === t).length;
          const ativo = tiposAtivos.has(t);
          const label = POI_GOOGLE_LABEL[t] || ('📍 ' + t);
          return (
            <button key={t} onClick={() => onChange((() => {
              const s = new Set(tiposAtivos); s.has(t) ? s.delete(t) : s.add(t); return s;
            })())} style={{ padding:'3px 10px', borderRadius:10, fontSize:10, cursor:'pointer',
              background: ativo ? 'rgba(251,191,36,.2)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${ativo ? '#fbbf24' : 'rgba(255,255,255,.1)'}`,
              color: ativo ? '#fff' : 'rgba(255,255,255,.5)',
              fontWeight: ativo ? 700 : 400, whiteSpace:'nowrap' }}>
              {label} <span style={{ opacity:.65, fontSize:9 }}>({count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ── Tela Trocar Senha — aparece no primeiro acesso ──────────────────
function TelaTrocarSenha({ onConcluido, onLogout }: {
  onConcluido: () => void;
  onLogout: () => void;
}) {
  const [senhaAtual,  setSenhaAtual]  = useState('');
  const [novaSenha,   setNovaSenha]   = useState('');
  const [confirmar,   setConfirmar]   = useState('');
  const [busy,        setBusy]        = useState(false);
  const [erro,        setErro]        = useState('');
  const [verAtual,    setVerAtual]    = useState(false);
  const [verNova,     setVerNova]     = useState(false);
  const [verConf,     setVerConf]     = useState(false);

  const requisitos = [
    { label: 'Mínimo 8 caracteres',  ok: novaSenha.length >= 8 },
    { label: 'Uma letra maiúscula',   ok: /[A-Z]/.test(novaSenha) },
    { label: 'Um número',             ok: /[0-9]/.test(novaSenha) },
    { label: 'Diferente da atual',    ok: novaSenha !== senhaAtual && novaSenha.length > 0 },
    { label: 'Confirmação confere',   ok: novaSenha === confirmar && confirmar.length > 0 },
  ];
  const senhaValida = requisitos.every(r => r.ok);

  const handleTrocar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senhaValida) { setErro('Corrija os requisitos antes de continuar.'); return; }
    setBusy(true); setErro('');
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('Sessão inválida.');

      // Re-autenticar com senha atual antes de trocar
      const cred = EmailAuthProvider.credential(user.email, senhaAtual);
      await reauthenticateWithCredential(user, cred);

      // Trocar senha
      await updatePassword(user, novaSenha);

      // Remover flag senhaTemporaria do Firestore
      const { doc: fsDoc, updateDoc, collection: col } = await import('firebase/firestore');
      await updateDoc(fsDoc(col(db, 'usuarios'), user.uid), { senhaTemporaria: false });

      onConcluido();
    } catch (err: any) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErro('Senha atual incorreta. Use a senha temporária recebida pelo WhatsApp.');
      } else {
        setErro(err.message || 'Erro ao trocar a senha.');
      }
    }
    setBusy(false);
  };

  const inp: React.CSSProperties = {
    flex: 1, padding: '11px 40px 11px 14px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 10, color: '#fff', fontSize: 13, outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };

  const CampoSenha = ({ label, value, onChange, ver, setVer, placeholder = '••••••••' }: {
    label: string; value: string; onChange: (v: string) => void;
    ver: boolean; setVer: (v: boolean) => void; placeholder?: string;
  }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input type={ver ? 'text' : 'password'} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder} style={inp} required />
        <button type="button" onClick={() => setVer(!ver)}
          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,.4)', fontSize: 16, padding: 4, lineHeight: 1 }}>
          {ver ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter,sans-serif', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 14px',
            background: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24 }}>🔐</div>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: 0 }}>
            Crie sua senha
          </h1>
          <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginTop: 6 }}>
            Primeiro acesso — defina uma senha pessoal segura
          </p>
        </div>

        {/* Aviso sobre senha temporária */}
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 20,
          background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.2)' }}>
          <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.6 }}>
            💡 Use a senha temporária recebida pelo WhatsApp no campo "Senha atual".
            Após confirmar, ela será substituída pela sua senha pessoal.
          </div>
        </div>

        <form onSubmit={handleTrocar}>
          <CampoSenha label="Senha atual (temporária)" value={senhaAtual}
            onChange={setSenhaAtual} ver={verAtual} setVer={setVerAtual}
            placeholder="Senha recebida pelo WhatsApp" />

          <CampoSenha label="Nova senha" value={novaSenha}
            onChange={setNovaSenha} ver={verNova} setVer={setVerNova} />

          {/* Requisitos em tempo real */}
          {novaSenha.length > 0 && (
            <div style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14,
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
              {requisitos.map(r => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 7,
                  fontSize: 11, color: r.ok ? '#4ade80' : 'rgba(255,255,255,.3)',
                  marginBottom: 3, transition: 'color .2s' }}>
                  <span style={{ fontSize: 10 }}>{r.ok ? '✓' : '○'}</span>
                  {r.label}
                </div>
              ))}
            </div>
          )}

          <CampoSenha label="Confirmar nova senha" value={confirmar}
            onChange={setConfirmar} ver={verConf} setVer={setVerConf} />

          {erro && (
            <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14,
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              color: '#f87171', fontSize: 13 }}>{erro}</div>
          )}

          <button type="submit" disabled={busy || !senhaValida}
            style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none',
              background: senhaValida && !busy
                ? 'linear-gradient(135deg,#7c3aed,#a78bfa)'
                : 'rgba(124,58,237,.25)',
              color: senhaValida ? '#fff' : 'rgba(255,255,255,.4)',
              fontSize: 15, fontWeight: 600,
              cursor: senhaValida && !busy ? 'pointer' : 'not-allowed',
              transition: 'all .2s' }}>
            {busy ? '⏳ Salvando...' : '🔐 Definir minha senha'}
          </button>
        </form>

        <button onClick={onLogout}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.25)',
            fontSize: 12, cursor: 'pointer', marginTop: 16, width: '100%', padding: 8 }}>
          ← Sair e fazer login novamente
        </button>
      </div>
    </div>
  );
}


// ── SPLASH SCREEN ──────────────────────────────────────────────────
function SplashScreen() {
  return (
    <div style={{ position:'fixed', inset:0, background:'linear-gradient(135deg,#060d1a,#0d1f35)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      fontFamily:'Inter,sans-serif', zIndex:9999 }}>
      <style>{`
        @keyframes hexPulse { 0%,100%{opacity:.3;transform:scale(.95)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes dotPulse { 0%,80%,100%{opacity:0} 40%{opacity:1} }
      `}</style>
      {/* Hexágono animado */}
      <div style={{ position:'relative', width:120, height:120, marginBottom:32 }}>
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ animation:'hexPulse 2s ease-in-out infinite' }}>
          <polygon points="60,8 104,32 104,80 60,104 16,80 16,32"
            fill="none" stroke="url(#splashGrad)" strokeWidth="3"/>
          <defs>
            <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e7fd8"/>
              <stop offset="100%" stopColor="#0ab4f5"/>
            </linearGradient>
          </defs>
          <polygon points="60,20 94,38 94,76 60,94 26,76 26,38"
            fill="none" stroke="#1e7fd8" strokeWidth="1" opacity="0.3"/>
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center' }}>
          <div style={{ fontSize:28, fontWeight:900, color:'#fff', letterSpacing:-1, lineHeight:1 }}>JET</div>
          <div style={{ width:40, height:2, background:'linear-gradient(90deg,#1e7fd8,#0ab4f5)',
            borderRadius:1, margin:'4px 0' }} />
          <div style={{ fontSize:14, fontWeight:700, color:'#1e7fd8', letterSpacing:6 }}>OS</div>
        </div>
      </div>
      {/* Nome */}
      <div style={{ animation:'fadeUp .6s .3s both', textAlign:'center' }}>
        <div style={{ fontSize:11, color:'rgba(255,255,255,.3)', letterSpacing:4,
          textTransform:'uppercase', marginBottom:4 }}>Operational System</div>
      </div>
      {/* Loading dots */}
      <div style={{ display:'flex', gap:6, marginTop:32, animation:'fadeUp .6s .5s both' }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#1e7fd8',
            animation:`dotPulse 1.4s ${i*0.2}s ease-in-out infinite` }} />
        ))}
      </div>
    </div>
  );
}

// ── ONBOARDING WIZARD ───────────────────────────────────────────────
function OnboardingWizard({ usuario, onConcluir }: { usuario: Usuario; onConcluir: () => void }) {
  const { t, i18n } = useTranslation();
  const [passo, setPasso] = useState(0);

  const PASSOS = [
    {
      icone: '🌍',
      titulo: { pt:'Escolha seu idioma', en:'Choose your language', es:'Elige tu idioma', ru:'Выберите язык' },
      desc:   { pt:'O JET OS está disponível em 4 idiomas. Você pode trocar a qualquer momento no botão de bandeira no header.', en:'JET OS is available in 4 languages. You can change it anytime using the flag button in the header.', es:'JET OS está disponible en 4 idiomas. Puedes cambiarlo en cualquier momento con el botón de bandera.', ru:'JET OS доступен на 4 языках. Вы можете изменить его в любое время с помощью кнопки флага в шапке.' },
      conteudo: () => (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[['pt','🇧🇷 Português'],['en','🇺🇸 English'],['es','🇲🇽 Español'],['ru','🇷🇺 Русский']].map(([c,l]) => (
            <button key={c} onClick={() => { i18n.changeLanguage(c); localStorage.setItem('appLang', c); }}
              style={{ padding:'12px', borderRadius:10, cursor:'pointer', fontSize:13,
                background: i18n.language.slice(0,2)===c ? 'rgba(26,111,212,.2)' : 'rgba(255,255,255,.05)',
                border:`1px solid ${i18n.language.slice(0,2)===c ? 'rgba(26,111,212,.5)' : 'rgba(255,255,255,.1)'}`,
                color: i18n.language.slice(0,2)===c ? '#60a5fa' : 'rgba(255,255,255,.6)',
                fontWeight: i18n.language.slice(0,2)===c ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      ),
    },
    {
      icone: '🗺',
      titulo: { pt:'Navegando no mapa', en:'Navigating the map', es:'Navegando el mapa', ru:'Навигация по карте' },
      desc:   { pt:'Selecione uma cidade no header para ver as estações. Use os filtros de TIPO e STATUS para refinar a visão. Clique em qualquer estação para ver detalhes.', en:'Select a city in the header to see stations. Use TYPE and STATUS filters to refine the view. Click any station for details.', es:'Selecciona una ciudad en el encabezado para ver las estaciones. Usa los filtros TIPO y ESTADO.', ru:'Выберите город в шапке для просмотра станций. Используйте фильтры ТИП и СТАТУС.' },
      conteudo: () => (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { ic:'➕', c:'#3b82f6', t:'Adicionar estação', d:'FAB azul → clique no mapa → preencha os dados' },
            { ic:'🔍', c:'#10b981', t:'POIs', d:'Pontos de interesse OSM e Google para escolher locais' },
            { ic:'🎯', c:'#f59e0b', t:'Candidatos', d:'Sugestões automáticas de melhores locais' },
            { ic:'🏭', c:'#8b5cf6', t:'Locais & Financeiro', d:'Bases de carga, contratos e pagamentos' },
          ].map(item => (
            <div key={item.t} style={{ display:'flex', gap:10, padding:'8px 10px', borderRadius:8,
              background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.06)' }}>
              <div style={{ width:32, height:32, borderRadius:8, background:item.c+'22',
                border:'1px solid '+item.c+'44', display:'flex', alignItems:'center',
                justifyContent:'center', fontSize:16, flexShrink:0 }}>{item.ic}</div>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff' }}>{item.t}</div>
                <div style={{ fontSize:10, color:'#4a5a7a' }}>{item.d}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icone: '🛡',
      titulo: { pt:'Guard — segurança em campo', en:'Guard — field security', es:'Guard — seguridad en campo', ru:'Guard — безопасность в поле' },
      desc:   { pt:'O FAB roxo 🛡 abre o registro de ocorrências. Registre roubos, vandalismos e recuperações. O gestor recebe alertas automáticos no Telegram.', en:'The purple 🛡 FAB opens incident registration. Register thefts, vandalism and recoveries. Managers receive automatic Telegram alerts.', es:'El FAB morado 🛡 abre el registro de incidencias. El gestor recibe alertas automáticas en Telegram.', ru:'Фиолетовый FAB 🛡 открывает регистрацию инцидентов. Менеджер получает автоматические уведомления в Telegram.' },
      conteudo: () => (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[
            { emoji:'🔴', t:'Roubo', c:'#ef4444', d:'Dispara alerta urgente no Telegram com destaque' },
            { emoji:'🟠', t:'Tentativa', c:'#f97316', d:'Registro de tentativa de furto' },
            { emoji:'🟡', t:'Vandalismo', c:'#eab308', d:'Danos ao patrimônio' },
            { emoji:'🟢', t:'Recuperação', c:'#22c55e', d:'Ativo recuperado com sucesso' },
          ].map(item => (
            <div key={item.t} style={{ display:'flex', gap:8, padding:'8px 10px', borderRadius:8,
              background:item.c+'10', border:'1px solid '+item.c+'25', alignItems:'center' }}>
              <span style={{ fontSize:20 }}>{item.emoji}</span>
              <div>
                <span style={{ fontSize:12, fontWeight:600, color:item.c }}>{item.t}</span>
                <span style={{ fontSize:10, color:'#4a5a7a', marginLeft:8 }}>{item.d}</span>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icone: '✅',
      titulo: { pt:'Pronto para começar!', en:'Ready to start!', es:'¡Listo para empezar!', ru:'Готово к работе!' },
      desc:   { pt:`Bem-vindo ao JET OS, ${(usuario as any).nome || usuario.email}! Acesse o Guia (✦ Guia no header) a qualquer momento para instruções detalhadas sobre cada funcionalidade.`, en:`Welcome to JET OS, ${(usuario as any).nome || usuario.email}! Access the Guide (✦ Guide in the header) anytime for detailed instructions.`, es:`¡Bienvenido a JET OS, ${(usuario as any).nome || usuario.email}! Accede a la Guía en el encabezado en cualquier momento.`, ru:`Добро пожаловать в JET OS, ${(usuario as any).nome || usuario.email}! Откройте Руководство в шапке для подробных инструкций.` },
      conteudo: () => (
        <div style={{ textAlign:'center', padding:'16px 0' }}>
          <div style={{ fontSize:64, marginBottom:12 }}>🚀</div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', lineHeight:1.6 }}>
            Versão {usuario.role === 'admin' ? 'Admin' : usuario.role === 'gestor' ? 'Gestor' : 'Campo'} ativa.<br/>
            Todas as funcionalidades estão disponíveis para o seu perfil.
          </div>
        </div>
      ),
    },
  ];

  const lang = i18n.language?.slice(0,2) as 'pt'|'en'|'es'|'ru' || 'pt';
  const passoAtual = PASSOS[passo];

  return (
    <div style={{ position:'fixed', inset:0, zIndex:2000,
      background:'rgba(0,0,0,.75)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'100%', maxWidth:480, background:'#0a0f1e',
        border:'1px solid rgba(99,102,241,.2)', borderRadius:20,
        fontFamily:'Inter,sans-serif', overflow:'hidden' }}>
        {/* Progress bar */}
        <div style={{ height:3, background:'rgba(255,255,255,.06)' }}>
          <div style={{ height:'100%', background:'linear-gradient(90deg,#1e7fd8,#0ab4f5)',
            width:`${((passo+1)/PASSOS.length)*100}%`, transition:'width .3s' }} />
        </div>
        {/* Header */}
        <div style={{ padding:'20px 24px 0', display:'flex', justifyContent:'space-between',
          alignItems:'center' }}>
          <div style={{ fontSize:10, color:'#4a5a7a', fontWeight:600, letterSpacing:'.08em' }}>
            {passo+1} / {PASSOS.length}
          </div>
          <button onClick={onConcluir}
            style={{ background:'none', border:'none', color:'rgba(255,255,255,.3)',
              cursor:'pointer', fontSize:12 }}>
            Pular
          </button>
        </div>
        {/* Conteúdo */}
        <div style={{ padding:'16px 24px 24px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>{passoAtual.icone}</div>
          <h2 style={{ color:'#dce8ff', fontSize:18, fontWeight:800, marginBottom:8 }}>
            {passoAtual.titulo[lang] || passoAtual.titulo.pt}
          </h2>
          <p style={{ color:'rgba(255,255,255,.45)', fontSize:12, lineHeight:1.7, marginBottom:20 }}>
            {passoAtual.desc[lang] || passoAtual.desc.pt}
          </p>
          {passoAtual.conteudo()}
        </div>
        {/* Navegação */}
        <div style={{ padding:'12px 24px 20px', display:'flex', gap:8,
          borderTop:'1px solid rgba(255,255,255,.06)' }}>
          {passo > 0 && (
            <button onClick={() => setPasso(p => p-1)}
              style={{ flex:1, padding:'11px', borderRadius:12, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>
              ← Anterior
            </button>
          )}
          {passo < PASSOS.length - 1 ? (
            <button onClick={() => setPasso(p => p+1)}
              style={{ flex:2, padding:'11px', borderRadius:12, cursor:'pointer',
                background:'linear-gradient(135deg,#1a6fd4,#0ab4f5)',
                border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
              Próximo →
            </button>
          ) : (
            <button onClick={onConcluir}
              style={{ flex:2, padding:'11px', borderRadius:12, cursor:'pointer',
                background:'linear-gradient(135deg,#10b981,#059669)',
                border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
              ✓ Começar a usar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CENTRAL DE NOTIFICAÇÕES ────────────────────────────────────────
function CentralNotificacoes({ notifs, onFechar }: {
  notifs: Array<{id:string;msg:string;tipo:string;ts:number;lida?:boolean}>;
  onFechar: () => void;
}) {
  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000)   return 'agora';
    if (diff < 3600000) return Math.floor(diff/60000) + 'min';
    if (diff < 86400000)return Math.floor(diff/3600000) + 'h';
    return d.toLocaleDateString('pt-BR');
  };
  const corTipo: Record<string,string> = {
    roubo:'#ef4444', guard:'#a78bfa', sistema:'#60a5fa', info:'#6b7280'
  };
  return (
    <div style={{ position:'fixed', top:48, right:12, zIndex:1500, width:300,
      maxHeight:'70vh', background:'#0a0f1e', borderRadius:14,
      border:'1px solid rgba(255,255,255,.1)', boxShadow:'0 8px 32px rgba(0,0,0,.7)',
      display:'flex', flexDirection:'column', fontFamily:'Inter,sans-serif',
      overflow:'hidden' }}>
      <div style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,.07)',
        display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>🔔 Notificações</div>
        <button onClick={onFechar}
          style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)',
            cursor:'pointer', fontSize:18 }}>✕</button>
      </div>
      <div style={{ overflowY:'auto', flex:1, scrollbarWidth:'thin' as const }}>
        {notifs.length === 0 ? (
          <div style={{ padding:24, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>
            Nenhuma notificação
          </div>
        ) : notifs.map(n => (
          <div key={n.id} style={{ padding:'10px 14px',
            borderBottom:'1px solid rgba(255,255,255,.04)',
            background: n.lida ? 'transparent' : 'rgba(26,111,212,.06)',
            borderLeft:`3px solid ${corTipo[n.tipo]||'#4a5a7a'}` }}>
            <div style={{ fontSize:11, color:'#dce8ff', lineHeight:1.5 }}>{n.msg}</div>
            <div style={{ fontSize:9, color:'#4a5a7a', marginTop:3 }}>{fmtTs(n.ts)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TelaPrestadorPendente({ usuario, onLogout }: { usuario: Usuario; onLogout: () => void }) {
  const { vinculado } = useTelegramVinculado(usuario.uid);
  return (
    <div style={{ minHeight:'100dvh', background:'#0d121e', display:'flex', alignItems:'center',
      justifyContent:'center', fontFamily:'Inter,sans-serif', padding:24 }}>
      <div style={{ maxWidth:380, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⏳</div>
        <div style={{ fontSize:20, fontWeight:700, color:'#dce8ff', marginBottom:8 }}>
          Cadastro em análise
        </div>
        <div style={{ fontSize:14, color:'#4a5a7a', lineHeight:1.6, marginBottom:24 }}>
          Seu cadastro como prestador de serviço foi recebido e está sendo analisado pela equipe JET.
          Você receberá um contato em breve para confirmar seu acesso.
        </div>
        <div style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)',
          borderRadius:10, padding:'12px 16px', marginBottom:24, textAlign:'left' }}>
          <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:4 }}>Cadastrado como</div>
          <div style={{ fontSize:13, color:'#dce8ff', fontWeight:600 }}>{usuario.nome}</div>
          <div style={{ fontSize:11, color:'#4a5a7a' }}>{usuario.email}</div>
          {usuario.cargoPrestador && (
            <div style={{ fontSize:11, color:'#60a5fa', marginTop:4 }}>{usuario.cargoPrestador}</div>
          )}
        </div>
        {vinculado === true && (
          <div style={{ display:'inline-flex', alignItems:'center', gap:6,
            background:'rgba(16,185,129,.15)', border:'1px solid rgba(16,185,129,.4)',
            borderRadius:20, padding:'6px 14px', marginBottom:24,
            fontSize:12, color:'#10b981', fontWeight:600 }}>
            ✓ Telegram vinculado
          </div>
        )}
        {vinculado === false && (
          <div style={{ marginBottom:24, textAlign:'left' }}>
            <div style={{ fontSize:12, color:'#4a5a7a', marginBottom:12, lineHeight:1.5 }}>
              Vincule seu Telegram enquanto aguarda a aprovação. Você será notificado assim que seu cadastro for analisado.
            </div>
            <TelegramVinculo usuario={usuario} modo="inline" onVinculado={() => {}} />
          </div>
        )}
        <button onClick={onLogout} style={{ background:'rgba(255,255,255,.06)',
          border:'1px solid rgba(255,255,255,.1)', color:'rgba(255,255,255,.5)',
          borderRadius:8, padding:'10px 20px', cursor:'pointer', fontSize:13 }}>
          Sair
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [tela,       setTela]       = useState<Tela>('loading');
  const [usuario,    setUsuario]    = useState<Usuario | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [permGateOk, setPermGateOk] = useState(false);

  useEffect(() => {
    // Listener para navegação para Guard via FAB
    const onNavGuard = () => setTela('guard');
    window.addEventListener('jetNavGuard', onNavGuard);

    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        try {
          const docRef = doc(db, 'usuarios', user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const u: Usuario = {
              uid: user.uid,
              email: user.email || '',
              nome: data.nome || '',
              role: data.role || 'viewer',
              paises: data.paises || [],
              cidadesPermitidas: data.cidadesPermitidas,
              cidadesGerenciaLog: data.cidadesGerenciaLog,
              cargoPrestador: data.cargoPrestador,
              tipoCadastro: data.tipoCadastro,
              statusPrestador: data.statusPrestador,
              cidade: data.cidade,
            };
            // Se usuario foi criado com senha temporária, forçar troca
              if (data.senhaTemporaria) {
                            setUsuario(u);
                            setTela('trocar-senha');
                          } else {
                            setUsuario(u);
                            // Log de acesso
              if (u.uid && u.email) {
                import('firebase/firestore').then(({ addDoc, collection: col }) => {
                  import('./lib/firebase').then(({ db: dbI }) => {
                    addDoc(col(dbI, 'logs_acesso'), {
                      uid:        u.uid || 'unknown',
                      email:      u.email || 'unknown',
                      nome:       u.nome || 'unknown',
                      role:       u.role || 'viewer',
                      ts:         Date.now(),
                      userAgent:  navigator.userAgent.slice(0, 200),
                      plataforma: navigator.platform,
                      idioma:     navigator.language,
                      online:     navigator.onLine,
                    }).catch((err: any) => console.error('Log erro:', err));
                  });
                });
              }
              // Verificar se é primeiro acesso
              const jaViu = localStorage.getItem('jet_onboarding_' + u.uid);
              if (!jaViu) setOnboarding(true);
              // Prestador aguardando aprovação → tela de espera
              if (u.role === 'prestador_pendente' || (u.tipoCadastro === 'prestador' && u.statusPrestador === 'pendente')) {
                setTela('prestador-pendente');
              } else if (u.role === 'guard') {
                setTela('guard');
              } else {
                console.log('[auth] role:', u.role, '→ tela: mapa');
                setTela('mapa');
              }
            }
          } else {
            console.error('Usuário não encontrado no Firestore');
            setUsuario(null);
            setTela('login');
          }
        } catch (e: any) {
          console.error('[auth] erro:', e);
          setUsuario(null);
          setTela('login');
        }
      } else {
        setUsuario(null);
        setTela('login');
      }
              
    });
    return () => {
      unsub();
      window.removeEventListener('jetNavGuard', onNavGuard as EventListener);
    };
  }, []);

  const handleLogin = async (email: string, senha: string): Promise<string | null> => {
    try { await signInWithEmailAndPassword(auth, email, senha); return null; }
    catch { return 'E-mail ou senha incorretos.'; }
  };

  if (tela === 'loading') return <SplashScreen />;

  if (tela === 'login') return <TelaLogin onLogin={handleLogin} />;

  if (tela === 'prestador-pendente' && usuario) return <TelaPrestadorPendente usuario={usuario} onLogout={() => signOut(auth)} />;

  // Permission gate — Android APK, antes de mostrar qualquer tela de app
  if (usuario && (tela === 'mapa' || tela === 'guard') && !permGateOk) return (
    <AndroidPermissionGate role={usuario.role} onReady={() => setPermGateOk(true)} />
  );

  // Onboarding — sobreposto ao mapa
  if (onboarding && usuario && tela === 'mapa') return (
    <>
      <TelaMapa usuario={usuario!} onLogout={() => signOut(auth)} />
      <OnboardingWizard
        usuario={usuario}
        onConcluir={() => {
          localStorage.setItem('jet_onboarding_' + usuario.uid, '1');
          setOnboarding(false);
        }}
      />
    </>
  );
  // Segurança: só role==='guard' fica na TelaGuard
  if (tela === 'guard' && usuario && usuario.role !== 'guard') {
    console.warn('[auth] role', usuario.role, 'tentou acessar TelaGuard — redirecionando para mapa');
    setTimeout(() => setTela('mapa'), 0);
    return null;
  }
  if (tela === 'guard') return <TelaGuard usuario={usuario!} onLogout={() => signOut(auth)} onVoltarMapa={() => setTela('mapa')} />;
  if (tela === 'trocar-senha') return (
    <TelaTrocarSenha
      onConcluido={() => setTela(usuario?.role === 'guard' ? 'guard' : 'mapa')}
      onLogout={() => { signOut(auth); setTela('login'); }}
    />
  );
  return <TelaMapa usuario={usuario!} onLogout={() => signOut(auth)} />;
}

// ── GUARD OVERLAY ─────────────────────────────────────────────────
// Painel lateral — todos os roles podem ver e editar ocorrências no mapa
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
const GUARD_STATUS_COR: Record<string, string> = {
  'Aberto':      '#ef4444',
  'Em apuração': '#f97316',
  'Recuperado':  '#22c55e',
  'Encerrado':   '#6b7280',
};

// ── Gráfico tempo real do Guard ──────────────────────────────────────
function GuardTrendChart({ ocorrencias }: { ocorrencias: any[] }) {
  const [periodoAtivo, setPeriodoAtivo] = useState<string>('7d');

  const agora = new Date();
  const ini = (dias: number) => new Date(agora.getTime() - dias * 86400000);
  const isHoje  = (d: Date) => d.toDateString() === agora.toDateString();
  const isOntem = (d: Date) => {
    const o = new Date(agora); o.setDate(o.getDate()-1);
    return d.toDateString() === o.toDateString();
  };

  const getTs = (o: any): Date | null => {
    const ts = (o.criadoEm as any)?.toDate?.() ? (o.criadoEm as any).toDate()
             : o.created_at ? new Date(o.created_at) : null;
    return ts && !isNaN(ts.getTime()) ? ts : null;
  };

  // Dados por período
  const PERIODOS = [
    { key:'hoje',  label:'Hoje',   filter: (o:any) => { const t=getTs(o); return t?isHoje(t):false; } },
    { key:'ontem', label:'Ontem',  filter: (o:any) => { const t=getTs(o); return t?isOntem(t):false; } },
    { key:'7d',    label:'7 dias', filter: (o:any) => { const t=getTs(o); return t?t>=ini(7):false; } },
    { key:'30d',   label:'30d',    filter: (o:any) => { const t=getTs(o); return t?t>=ini(30):false; } },
    { key:'total', label:'Total',  filter: () => true },
  ];

  const TIPOS_SERIES = [
    { key:'Roubo',      cor:'#ef4444' },
    { key:'Vandalismo', cor:'#f59e0b' },
    { key:'Tentativa',  cor:'#f97316' },
    { key:'Recuperacao',cor:'#4ade80' },
    { key:'Furto',      cor:'#fb923c' },
    { key:'Alarme',     cor:'#60a5fa' },
  ];

  // Calcular dados do período ativo
  const pAtivo = PERIODOS.find(p => p.key === periodoAtivo) || PERIODOS[4];
  const filtrados = ocorrencias.filter(pAtivo.filter);
  const total = filtrados.length;

  // Totais por tipo
  const porTipo: Record<string,number> = {};
  filtrados.forEach(o => { porTipo[o.tipo] = (porTipo[o.tipo]||0)+1; });

  // Gráfico de barras por tipo SVG
  const maxV = Math.max(...TIPOS_SERIES.map(s => porTipo[s.key]||0), 1);
  const W = 300; const H = 80; const PL = 8; const PR = 8; const PT = 8; const PB = 22;
  const CW = W-PL-PR; const CH = H-PT-PB;
  const BW = Math.floor(CW / TIPOS_SERIES.length) - 3;

  return (
    <div style={{ borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
      {/* Abas de período */}
      <div style={{ display:'flex', padding:'6px 12px', gap:4 }}>
        {PERIODOS.map(p => (
          <button key={p.key} onClick={() => setPeriodoAtivo(p.key)} style={{
            flex:1, padding:'4px 2px', borderRadius:6, cursor:'pointer', fontSize:9, fontWeight:600,
            background: periodoAtivo===p.key ? 'rgba(167,139,250,.2)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${periodoAtivo===p.key ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.08)'}`,
            color: periodoAtivo===p.key ? '#a78bfa' : 'rgba(255,255,255,.35)',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Total do período */}
      <div style={{ display:'flex', alignItems:'baseline', gap:6, padding:'0 12px 6px' }}>
        <span style={{ fontSize:24, fontWeight:800, color:'#dce8ff', lineHeight:1 }}>{total}</span>
        <span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>ocorrências · {pAtivo.label}</span>
        {porTipo['Roubo'] > 0 && (
          <span style={{ fontSize:10, color:'#ef4444', marginLeft:'auto', fontWeight:700 }}>
            🔴 {porTipo['Roubo']} roubos
          </span>
        )}
      </div>

      {/* Gráfico SVG */}
      {total > 0 && (
        <div style={{ padding:'0 12px 8px' }}>
          <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>
            {TIPOS_SERIES.map((s, i) => {
              const v = porTipo[s.key] || 0;
              const bh = v > 0 ? Math.max(4, Math.round((v/maxV)*CH)) : 0;
              const x = PL + i * (BW+3);
              const y = PT + CH - bh;
              return (
                <g key={s.key}>
                  {/* Barra */}
                  {bh > 0 && (
                    <rect x={x} y={y} width={BW} height={bh}
                      fill={s.cor} rx={3} opacity={0.9}/>
                  )}
                  {/* Valor */}
                  {v > 0 && (
                    <text x={x+BW/2} y={bh > 14 ? y+11 : y-3}
                      textAnchor="middle" fill={bh>14?'#fff':s.cor}
                      fontSize={8} fontWeight="700">{v}</text>
                  )}
                  {/* Label */}
                  <text x={x+BW/2} y={H-4} textAnchor="middle"
                    fill="rgba(255,255,255,.3)" fontSize={7}>
                    {s.key.slice(0,4)}
                  </text>
                </g>
              );
            })}
            {/* Linha base */}
            <line x1={PL} x2={W-PR} y1={PT+CH} y2={PT+CH}
              stroke="rgba(255,255,255,.08)" strokeWidth={1}/>
          </svg>
        </div>
      )}

      {total === 0 && (
        <div style={{ padding:'4px 12px 12px', fontSize:10, color:'rgba(255,255,255,.2)' }}>
          Nenhuma ocorrência no período
        </div>
      )}
    </div>
  );
}


// ── Gráfico comparativo: todos os 5 períodos ao mesmo tempo ──────────
function GuardComparativoChart({ ocorrencias }: { ocorrencias: any[] }) {
  const agora = new Date();
  const ini = (dias: number) => new Date(agora.getTime() - dias * 86400000);
  const isHoje  = (d: Date) => d.toDateString() === agora.toDateString();
  const isOntem = (d: Date) => { const o = new Date(agora); o.setDate(o.getDate()-1); return d.toDateString() === o.toDateString(); };

  const getTs = (o: any): Date | null => {
    const ts = (o.criadoEm as any)?.toDate?.() ? (o.criadoEm as any).toDate()
             : o.created_at ? new Date(o.created_at) : null;
    return ts && !isNaN(ts.getTime()) ? ts : null;
  };

  const PERIODOS = [
    { key:'hoje',  label:'Hoje',  cor:'#a78bfa', filter: (o:any) => { const t=getTs(o); return t?isHoje(t):false; } },
    { key:'ontem', label:'Ontem', cor:'#60a5fa', filter: (o:any) => { const t=getTs(o); return t?isOntem(t):false; } },
    { key:'7d',    label:'7d',    cor:'#34d399', filter: (o:any) => { const t=getTs(o); return t?t>=ini(7):false; } },
    { key:'30d',   label:'30d',   cor:'#fbbf24', filter: (o:any) => { const t=getTs(o); return t?t>=ini(30):false; } },
    { key:'total', label:'Total', cor:'#f87171', filter: () => true },
  ];

  // Total por período
  const totais = PERIODOS.map(p => ({
    ...p,
    total: ocorrencias.filter(p.filter).length,
  }));

  const maxTotal = Math.max(...totais.map(p => p.total), 1);

  // Tipos de incidente por período
  const TIPOS = ['Roubo','Vandalismo','Tentativa','Recuperacao','Furto','Alarme'];
  const CORES_TIPO: Record<string,string> = {
    Roubo:'#ef4444', Vandalismo:'#f59e0b', Tentativa:'#f97316',
    Recuperacao:'#4ade80', Furto:'#fb923c', Alarme:'#60a5fa',
  };

  const dadosPorPeriodo = PERIODOS.map(p => {
    const ocs = ocorrencias.filter(p.filter);
    const porTipo: Record<string,number> = {};
    TIPOS.forEach(t => { porTipo[t] = ocs.filter(o => o.tipo === t).length; });
    return { ...p, total: ocs.length, porTipo };
  });

  // SVG: barras agrupadas — eixo X = período, grupos de tipo dentro
  const W = 308; const H = 110;
  const PL = 28; const PR = 8; const PT = 12; const PB = 24;
  const CW = W - PL - PR; const CH = H - PT - PB;
  const GRP_W = Math.floor(CW / PERIODOS.length);
  const BAR_W = Math.max(3, Math.floor((GRP_W - 4) / TIPOS.length) - 1);

  // Grades horizontais
  const grades = [0.25, 0.5, 0.75, 1.0];

  return (
    <div style={{ borderBottom:'1px solid rgba(255,255,255,.06)',
      padding:'8px 12px 10px', flexShrink:0 }}>

      {/* Título */}
      <div style={{ fontSize:9, color:'rgba(255,255,255,.3)',
        marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight:600, color:'rgba(255,255,255,.5)' }}>📊 Visão geral comparativa</span>
        <span style={{ fontSize:8 }}>todos os períodos</span>
      </div>

      {/* Totais rápidos por período */}
      <div style={{ display:'flex', gap:3, marginBottom:8 }}>
        {totais.map(p => (
          <div key={p.key} style={{ flex:1, textAlign:'center',
            background:`${p.cor}15`, border:`1px solid ${p.cor}40`,
            borderRadius:6, padding:'3px 2px' }}>
            <div style={{ fontSize:13, fontWeight:800, color:p.cor, lineHeight:1 }}>{p.total}</div>
            <div style={{ fontSize:7, color:'rgba(255,255,255,.3)', marginTop:1 }}>{p.label}</div>
          </div>
        ))}
      </div>

      {/* Gráfico barras agrupadas SVG */}
      <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>

        {/* Grade */}
        {grades.map(f => {
          const y = PT + CH*(1-f);
          const v = Math.round(maxTotal*f);
          return (
            <g key={f}>
              <line x1={PL} x2={W-PR} y1={y} y2={y}
                stroke="rgba(255,255,255,.06)" strokeWidth={1}/>
              <text x={PL-3} y={y+3} textAnchor="end"
                fill="rgba(255,255,255,.2)" fontSize={6}>{v}</text>
            </g>
          );
        })}

        {/* Linha base */}
        <line x1={PL} x2={W-PR} y1={PT+CH} y2={PT+CH}
          stroke="rgba(255,255,255,.12)" strokeWidth={1}/>

        {/* Grupos por período */}
        {dadosPorPeriodo.map((p, pi) => {
          const gx = PL + pi * GRP_W;
          return (
            <g key={p.key}>
              {/* Barras por tipo */}
              {TIPOS.map((t, ti) => {
                const v = p.porTipo[t] || 0;
                const bh = v > 0 ? Math.max(3, Math.round((v/maxTotal)*CH)) : 0;
                const x = gx + ti * (BAR_W + 1) + 2;
                const y = PT + CH - bh;
                const cor = CORES_TIPO[t] || '#888';
                return (
                  <g key={t}>
                    {bh > 0 && (
                      <rect x={x} y={y} width={BAR_W} height={bh}
                        fill={cor} rx={2} opacity={0.85}/>
                    )}
                    {bh > 10 && v > 0 && (
                      <text x={x+BAR_W/2} y={y+8} textAnchor="middle"
                        fill="#fff" fontSize={6} fontWeight="700">{v}</text>
                    )}
                    {bh > 0 && bh <= 10 && (
                      <text x={x+BAR_W/2} y={y-2} textAnchor="middle"
                        fill={cor} fontSize={6}>{v}</text>
                    )}
                  </g>
                );
              })}
              {/* Label período */}
              <text x={gx + GRP_W/2} y={H-6} textAnchor="middle"
                fill={p.cor} fontSize={8} fontWeight="600">{p.label}</text>
              {/* Total do período acima do grupo */}
              {p.total > 0 && (
                <text x={gx + GRP_W/2} y={PT-2} textAnchor="middle"
                  fill={p.cor} fontSize={7} fontWeight="700">{p.total}</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legenda de tipos */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'3px 8px', marginTop:4 }}>
        {TIPOS.map(t => (
          <div key={t} style={{ display:'flex', alignItems:'center', gap:3 }}>
            <div style={{ width:6, height:6, borderRadius:1, background:CORES_TIPO[t] }}/>
            <span style={{ fontSize:7, color:'rgba(255,255,255,.3)' }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Modal editar ocorrência (guard, campo, gestor, admin) ──────────
function GuardEditModal({ ocorrencia, usuario, onFechar, onSalvo }: {
  ocorrencia: any;
  usuario: { uid: string; role: string; nome?: string; email?: string };
  onFechar: () => void;
  onSalvo:  () => void;
}) {
  const TIPOS_G   = ['Roubo','Tentativa','Vandalismo','Recuperacao','Outro'];
  const STATUS_G  = ['Aberto','Em apuração','Recuperado','Encerrado'];
  const ATIVOS_G  = ['Patinete','Bicicleta','Bateria'];
  const TURNOS_G  = [['shiftMorning','Manhã (06–14h)'],['shiftAfternoon','Tarde (14–22h)'],['shiftNight','Noite (22–06h)']];

  const isGestorModal = ['gestor','admin'].includes(usuario.role);
  const { t } = useTranslation();

  const [tipo,        setTipo]        = useState(ocorrencia.tipo || 'Outro');
  const [status,      setStatus]      = useState(ocorrencia.status || 'Aberto');
  const [assetId,     setAssetId]     = useState(ocorrencia.asset_id || '');
  const [ativoTipo,   setAtivoTipo]   = useState(ocorrencia.ativo_tipo || 'Patinete');
  const [descricao,   setDescricao]   = useState(ocorrencia.descricao || '');
  const [turno,       setTurno]       = useState(ocorrencia.turno || 'shiftMorning');
  const [procurando,  setProcurando]  = useState(ocorrencia.procurando || '');
  const [danoPct,     setDanoPct]     = useState<string>(String(ocorrencia.danoPct ?? ''));
  const [danoValor,   setDanoValor]   = useState<string>(String(ocorrencia.danoValor ?? ''));
  const [estacaoId,   setEstacaoId]   = useState(ocorrencia.estacaoId || '');
  const [obs,         setObs]         = useState(ocorrencia.observacao_fechamento || '');
  const [boNum,       setBoNum]       = useState(ocorrencia.bo_numero || '');
  const [boPreview,   setBoPreview]   = useState(ocorrencia.bo_url || '');
  const [boFile,      setBoFile]      = useState<File|null>(null);
  const [lat,         setLat]         = useState(String(ocorrencia.lat_inicial || ''));
  const [lng,         setLng]         = useState(String(ocorrencia.lng_inicial || ''));
  const [endereco,    setEndereco]    = useState(ocorrencia.endereco_inicial || '');
  const [bairro,      setBairro]      = useState(ocorrencia.bairro_inicial || '');
  const [cidade,      setCidade]      = useState(ocorrencia.cidade_inicial || '');
  const [showLoc,     setShowLoc]     = useState(false);
  const [showMapPick, setShowMapPick] = useState(false);
  const toDateStr = (ts: any) => {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toISOString().slice(0,16);
    } catch { return ''; }
  };
  const [dataOcorr,   setDataOcorr]   = useState(toDateStr(ocorrencia.criadoEm));
  const [busy,        setBusy]        = useState(false);
  const [erro,        setErro]        = useState('');
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const boRef    = useRef<HTMLInputElement>(null);
  const boGalRef = useRef<HTMLInputElement>(null);

  const handleBoFile = (f: File) => {
    setBoFile(f);
    const r = new FileReader();
    r.onload = e => setBoPreview((e.target?.result as string)||'');
    r.readAsDataURL(f);
  };

  const buscarGPS = () => {
    navigator.geolocation.getCurrentPosition(p => {
      setLat(p.coords.latitude.toFixed(6));
      setLng(p.coords.longitude.toFixed(6));
    }, () => setErro('GPS indisponível'));
  };

  // Mini mapa de seleção de localização
  const miniMapRef = useRef<any>(null);
  useEffect(() => {
    if (!showMapPick) {
      if (miniMapRef.current) { miniMapRef.current.remove(); miniMapRef.current = null; }
      return;
    }
    const initLat = parseFloat(lat) || ocorrencia.lat_inicial || -23.5505;
    const initLng = parseFloat(lng) || ocorrencia.lng_inicial || -46.6333;
    setTimeout(() => {
      const el = document.getElementById('guard-edit-map');
      if (!el || miniMapRef.current) return;
      const m = L.map(el, { zoomControl: true }).setView([initLat, initLng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution:'© OSM' }).addTo(m);
      (el as any)._leafletMap = m;
      miniMapRef.current = m;
    }, 50);
    return () => {
      if (miniMapRef.current) { miniMapRef.current.remove(); miniMapRef.current = null; }
    };
  }, [showMapPick]);

  const salvar = async () => {
    if ((status==='Encerrado'||status==='Recuperado') && !obs.trim()) {
      setErro('Adicione observação de fechamento.'); return;
    }
    setBusy(true); setErro('');
    try {
      let boUrl = ocorrencia.bo_url || '';
      if (boFile) {
        const ext = boFile.name.split('.').pop()||'jpg';
        boUrl = await uploadComRetry(boFile, 'ocorrencias/bo_'+ocorrencia.id+'.'+ext);
      }
      const patch: any = {
        tipo, status, asset_id: assetId.trim(), ativo_tipo: ativoTipo,
        descricao: descricao.trim(), turno, procurando: procurando.trim(),
        estacaoId: estacaoId.trim(), observacao_fechamento: obs.trim(),
        bo_numero: boNum.trim(), bo_url: boUrl,
        ultimoEditor: usuario.uid,
        updated_at: FsTimestamp.fromDate(new Date()),
        ...(dataOcorr ? { dataManual: dataOcorr } : {}),
        ...(tipo === 'Vandalismo' ? {
          danoPct:   danoPct.trim()   !== '' ? Number(danoPct)                     : null,
          danoValor: danoValor.trim() !== '' ? Number(danoValor.replace(',', '.')) : null,
        } : {}),
      };
      const latNum = parseFloat(String(lat).replace(',','.'));
      const lngNum = parseFloat(String(lng).replace(',','.'));
      if (!isNaN(latNum) && !isNaN(lngNum) && Math.abs(latNum) > 0.001 && Math.abs(lngNum) > 0.001) {
        patch.lat_inicial = latNum;
        patch.lng_inicial = lngNum;
        console.log('[guard edit] salvando loc:', latNum, lngNum);
      } else {
        console.warn('[guard edit] loc inválida, não salva:', lat, lng);
      }
      if (endereco)   patch.endereco_inicial = endereco.trim();
      if (bairro)     patch.bairro_inicial   = bairro.trim();
      if (cidade)     patch.cidade_inicial   = cidade.trim();
      await updateDoc(doc(db,'ocorrencias',ocorrencia.id), patch);
      onSalvo();
    } catch(e:any) { setErro('Erro: '+(e?.message||'tente novamente')); }
    setBusy(false);
  };

  const excluirConfirmado = async () => {
    const docId = String(ocorrencia?.docId || ocorrencia?.firestoreId || '').trim();
    if (!docId) { setErro('ID não encontrado: ' + JSON.stringify(ocorrencia?.id)); return; }
    setBusy(true);
    setErro('');
    setConfirmarExcluir(false);
    try {
      const { deleteDoc: delFn } = await import('firebase/firestore');
      await delFn(doc(db, 'ocorrencias', docId));
      console.log('[excluir ocorrencia] OK deletado do Firestore:', docId);
      onFechar();
      onSalvo();
    } catch(e:any) {
      console.error('[excluir]', e?.code, e?.message);
      setErro((e?.code || 'erro') + ': ' + (e?.message || String(e)));
      setBusy(false);
    }
  };

  const excluir = () => setConfirmarExcluir(true);

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 11px', boxSizing:'border-box' as const,
    background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.09)',
    borderRadius:9, color:'#fff', fontSize:12, outline:'none',
  };
  const lbl: React.CSSProperties = {
    fontSize:9, color:'rgba(255,255,255,.4)', fontWeight:700,
    letterSpacing:'.07em', display:'block', marginBottom:4, textTransform:'uppercase' as const,
  };
  const corTipo: Record<string,string> = {
    Roubo:'#ef4444',Tentativa:'#f97316',Vandalismo:'#eab308',Recuperacao:'#22c55e',Outro:'#6b7280'
  };
  const emojiTipo: Record<string,string> = {
    Roubo:'🔴',Tentativa:'🟠',Vandalismo:'🟡',Recuperacao:'🟢',Outro:'⚪'
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:5000,
      display:'flex', alignItems: window.innerWidth > 500 ? 'center' : 'flex-end',
      background:'rgba(0,0,0,.75)', fontFamily:'Inter,sans-serif' }}
      onClick={e => e.target===e.currentTarget && onFechar()}>
      <div style={{ width:'100%', maxWidth: window.innerWidth <= 500 ? '100vw' : 700, margin:'0 auto',
        background:'#0d1220', borderRadius:'18px 18px 0 0',
        border:'1px solid rgba(167,139,250,.2)',
        maxHeight:'92vh', display:'flex', flexDirection:'column',
        position:'relative' }}>

        {/* Header fixo */}
        <div style={{ padding:'16px 18px', borderBottom:'1px solid rgba(255,255,255,.07)',
          flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:'#a78bfa', fontWeight:700, fontSize:15 }}>✏️ Editar ocorrência</div>
            <div style={{ color:'rgba(255,255,255,.3)', fontSize:10, marginTop:2 }}>ID: {ocorrencia.id}</div>
          </div>
          <button onClick={onFechar}
            style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        {/* Scroll interno */}
        <div style={{ overflowY:'auto', flex:1, padding:'16px 18px',
          scrollbarWidth:'thin' as const, scrollbarColor:'#1c2535 transparent' }}>

          {/* Tipo */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Tipo de ocorrência</label>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' as const }}>
              {TIPOS_G.map(tp => (
                <button key={tp} onClick={()=>setTipo(tp)}
                  style={{ padding:'5px 9px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                    background: tipo===tp ? (corTipo[tp]||'#6b7280')+'22' : 'rgba(255,255,255,.04)',
                    border:`1px solid ${tipo===tp ? (corTipo[tp]||'#6b7280')+'55' : 'rgba(255,255,255,.08)'}`,
                    color: tipo===tp ? (corTipo[tp]||'#6b7280') : 'rgba(255,255,255,.4)' }}>
                  {emojiTipo[tp]||'⚪'} {tp}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Status</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
              {STATUS_G.map(s => {
                const cor = s==='Encerrado'?'#4ade80':s==='Recuperado'?'#34d399':s==='Em apuração'?'#fbbf24':'#f87171';
                return (
                  <button key={s} onClick={()=>setStatus(s)}
                    style={{ padding:'8px', borderRadius:9, cursor:'pointer', fontSize:11, fontWeight:600,
                      background: status===s ? cor+'18' : 'rgba(255,255,255,.04)',
                      border:`1px solid ${status===s ? cor+'44' : 'rgba(255,255,255,.08)'}`,
                      color: status===s ? cor : 'rgba(255,255,255,.4)' }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ativo */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
            <div>
              <label style={lbl}>Tipo de ativo</label>
              <select value={ativoTipo} onChange={e=>setAtivoTipo(e.target.value)}
                style={{ ...inp, cursor:'pointer' }}>
                {ATIVOS_G.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>ID / Placa</label>
              <input value={assetId} onChange={e=>setAssetId(e.target.value)} placeholder="JET-001234" style={inp}/>
            </div>
          </div>

          {/* Procurando */}
          {(tipo==='Roubo'||tipo==='Tentativa') && (
            <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:9,
              background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.15)' }}>
              <label style={{ ...lbl, color:'#f87171' }}>Procurando</label>
              <input value={procurando} onChange={e=>setProcurando(e.target.value)}
                placeholder="Descrição do ativo..." style={{ ...inp, borderColor:'rgba(239,68,68,.2)' }}/>
            </div>
          )}

          {/* Dano da oficina — só Vandalismo */}
          {tipo === 'Vandalismo' && (
            <div style={{ marginBottom:12, padding:'12px 14px', borderRadius:9,
              background:'rgba(234,179,8,.05)', border:'1px solid rgba(234,179,8,.2)' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#fbbf24',
                textTransform:'uppercase', letterSpacing:'.8px', marginBottom:10 }}>
                🔧 Avaliação da oficina
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div>
                  <label style={{ ...lbl, color:'#fbbf24' }}>% Dano</label>
                  <div style={{ position:'relative' }}>
                    <input type="number" min="0" max="100" step="1"
                      value={danoPct} onChange={e=>setDanoPct(e.target.value)}
                      placeholder="0"
                      style={{ ...inp, borderColor:'rgba(234,179,8,.25)', paddingRight:28 }}/>
                    <span style={{ position:'absolute', right:10, top:'50%',
                      transform:'translateY(-50%)', color:'rgba(255,255,255,.4)',
                      fontSize:12, pointerEvents:'none' as const }}>%</span>
                  </div>
                  {danoPct && !isNaN(Number(danoPct)) && (
                    <div style={{ marginTop:4, height:4, background:'rgba(255,255,255,.08)', borderRadius:2 }}>
                      <div style={{ height:4, borderRadius:2, transition:'width .3s',
                        width:`${Math.min(100,Number(danoPct))}%`,
                        background: Number(danoPct)>=75?'#ef4444':Number(danoPct)>=40?'#f97316':'#fbbf24' }}/>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ ...lbl, color:'#fbbf24' }}>Valor R$</label>
                  <div style={{ position:'relative' }}>
                    <span style={{ position:'absolute', left:10, top:'50%',
                      transform:'translateY(-50%)', color:'rgba(255,255,255,.4)',
                      fontSize:12, pointerEvents:'none' as const }}>R$</span>
                    <input type="number" min="0" step="0.01"
                      value={danoValor} onChange={e=>setDanoValor(e.target.value)}
                      placeholder="0,00"
                      style={{ ...inp, borderColor:'rgba(234,179,8,.25)', paddingLeft:30 }}/>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Descrição */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Descrição</label>
            <textarea value={descricao} onChange={e=>setDescricao(e.target.value)}
              rows={2} style={{ ...inp, resize:'none' as const }}/>
          </div>

          {/* Turno + Estação */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
            <div>
              <label style={lbl}>Turno</label>
              <select value={turno} onChange={e=>setTurno(e.target.value)} style={{ ...inp, cursor:'pointer' }}>
                {TURNOS_G.map(([k,l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>ID da estação</label>
              <input value={estacaoId} onChange={e=>setEstacaoId(e.target.value)} placeholder="Opcional" style={inp}/>
            </div>
          </div>

          {/* Data/hora */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Data / hora da ocorrência</label>
            <input type="datetime-local" value={dataOcorr}
              onChange={e=>setDataOcorr(e.target.value)}
              style={{ ...inp, colorScheme:'dark' as any }}/>
            <div style={{ fontSize:9, color:'rgba(255,255,255,.25)', marginTop:3 }}>
              A data original é preservada nos logs. Esta é a data manual do fato.
            </div>
          </div>

          {/* Localização */}
          <div style={{ marginBottom:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
              <label style={{ ...lbl, marginBottom:0 }}>Localização</label>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' as const }}>
                <button onClick={()=>setShowMapPick(v=>!v)}
                  style={{ fontSize:9, padding:'3px 7px', borderRadius:5, cursor:'pointer',
                    background: showMapPick?'rgba(16,185,129,.2)':'rgba(255,255,255,.06)',
                    border:`1px solid ${showMapPick?'rgba(16,185,129,.4)':'rgba(255,255,255,.1)'}`,
                    color: showMapPick?'#34d399':'rgba(255,255,255,.5)' }}>
                  🗺 Mapa
                </button>
                <button onClick={buscarGPS}
                  style={{ fontSize:9, padding:'3px 7px', borderRadius:5, cursor:'pointer',
                    background:'rgba(59,130,246,.15)', border:'1px solid rgba(59,130,246,.3)', color:'#60a5fa' }}>
                  📡 GPS
                </button>
                <button onClick={()=>setShowLoc(v=>!v)}
                  style={{ fontSize:9, padding:'3px 7px', borderRadius:5, cursor:'pointer',
                    background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                    color:'rgba(255,255,255,.5)' }}>
                  {showLoc?'▲':'▼'} Editar
                </button>
              </div>
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginBottom:5 }}>
              📍 {[endereco||ocorrencia.endereco_inicial, bairro||ocorrencia.bairro_inicial, cidade||ocorrencia.cidade_inicial].filter(Boolean).join(' · ')||'Não informado'}
              {lat && lng && <span style={{ color:'rgba(255,255,255,.2)', marginLeft:6 }}>({parseFloat(lat).toFixed(4)}, {parseFloat(lng).toFixed(4)})</span>}
            </div>
            {showMapPick && (
              <div style={{ borderRadius:10, overflow:'hidden', marginBottom:8, position:'relative', height:200 }}>
                <div id="guard-edit-map" style={{ width:'100%', height:'100%' }} />
                <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
                  fontSize:24, pointerEvents:'none', filter:'drop-shadow(0 2px 4px rgba(0,0,0,.8))' }}>📍</div>
                <div style={{ position:'absolute', bottom:6, left:0, right:0, textAlign:'center',
                  fontSize:9, color:'rgba(255,255,255,.6)', pointerEvents:'none' }}>
                  Mova o mapa para posicionar o pin
                </div>
                <button onClick={()=>{
                  if (miniMapRef.current) {
                    const c = miniMapRef.current.getCenter();
                    setLat(String(c.lat.toFixed(6)));
                    setLng(String(c.lng.toFixed(6)));
                    // Reverter geocode
                    fetch('https://nominatim.openstreetmap.org/reverse?lat='+c.lat+'&lon='+c.lng+'&format=json')
                      .then(r=>r.json())
                      .then(j=>{
                        if (j.address) {
                          setEndereco((j.address.road||'') + (j.address.house_number?' '+j.address.house_number:''));
                          setBairro(j.address.suburb||j.address.neighbourhood||j.address.city_district||'');
                          setCidade(j.address.city||j.address.town||j.address.municipality||'');
                        }
                      }).catch(()=>{});
                    setShowMapPick(false);
                  } else {
                    setErro('Mapa não carregado. Tente novamente.');
                  }
                }} style={{ position:'absolute', bottom:6, right:6,
                  background:'rgba(16,185,129,.9)', border:'none', color:'#fff',
                  borderRadius:8, padding:'5px 10px', cursor:'pointer', fontSize:11, fontWeight:700 }}>
                  ✓ Confirmar
                </button>
              </div>
            )}
            {showLoc && (
              <div style={{ display:'flex', flexDirection:'column', gap:7, padding:'10px',
                borderRadius:9, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                  <div><label style={lbl}>Latitude</label>
                    <input value={lat} onChange={e=>setLat(e.target.value)} placeholder="-8.063" style={inp}/></div>
                  <div><label style={lbl}>Longitude</label>
                    <input value={lng} onChange={e=>setLng(e.target.value)} placeholder="-34.87" style={inp}/></div>
                </div>
                <div><label style={lbl}>{t('drawer.address')}</label>
                  <input value={endereco} onChange={e=>setEndereco(e.target.value)} style={inp}/></div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                  <div><label style={lbl}>Bairro</label>
                    <input value={bairro} onChange={e=>setBairro(e.target.value)} style={inp}/></div>
                  <div><label style={lbl}>Cidade</label>
                    <input value={cidade} onChange={e=>setCidade(e.target.value)} style={inp}/></div>
                </div>
              </div>
            )}
          </div>

          {/* Observação fechamento */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Observação de fechamento</label>
            <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={2}
              style={{ ...inp, resize:'none' as const }}
              placeholder={status==='Encerrado'||status==='Recuperado' ? 'Obrigatório para encerrar' : 'Opcional'}/>
          </div>

          {/* BO */}
          <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:9,
            background:'rgba(234,179,8,.05)', border:'1px solid rgba(234,179,8,.15)' }}>
            <label style={{ ...lbl, color:'#fbbf24' }}>Boletim de Ocorrência</label>
            <input value={boNum} onChange={e=>setBoNum(e.target.value)}
              placeholder="Número do BO" style={{ ...inp, marginBottom:8, borderColor:'rgba(234,179,8,.2)' }}/>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={()=>boRef.current?.click()}
                style={{ flex:1, padding:'7px', borderRadius:7, cursor:'pointer', fontSize:10,
                  background:'rgba(234,179,8,.1)', border:'1px solid rgba(234,179,8,.2)', color:'#fbbf24' }}>
                📷 Câmera
              </button>
              <button onClick={()=>boGalRef.current?.click()}
                style={{ flex:1, padding:'7px', borderRadius:7, cursor:'pointer', fontSize:10,
                  background:'rgba(234,179,8,.1)', border:'1px solid rgba(234,179,8,.2)', color:'#fbbf24' }}>
                🖼 Galeria
              </button>
            </div>
            <input ref={boRef}    type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e=>{ if(e.target.files?.[0]) handleBoFile(e.target.files[0]); }}/>
            <input ref={boGalRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>{ if(e.target.files?.[0]) handleBoFile(e.target.files[0]); }}/>
            {boPreview && <img src={boPreview} alt="BO" style={{ width:'100%', borderRadius:8, marginTop:8, maxHeight:100, objectFit:'cover' }}/>}
            {ocorrencia.bo_url && !boFile && (
              <a href={ocorrencia.bo_url} target="_blank" rel="noreferrer"
                style={{ display:'block', fontSize:10, color:'#fbbf24', marginTop:6 }}>
                📋 Ver BO atual ↗
              </a>
            )}
          </div>

          {erro && <div style={{ color:'#f87171', fontSize:11, marginBottom:8 }}>{erro}</div>}
        </div>

        {/* Modal confirmação exclusão */}
        {confirmarExcluir && (
          <div style={{ position:'absolute', inset:0, zIndex:10, background:'rgba(0,0,0,.85)',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            borderRadius:'0 0 18px 18px', padding:24, gap:12 }}>
            <div style={{ fontSize:32 }}>🗑</div>
            <div style={{ fontSize:14, fontWeight:700, color:'#f87171', textAlign:'center' }}>
              Excluir permanentemente?
            </div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.45)', textAlign:'center', lineHeight:1.5 }}>
              Esta ação não pode ser desfeita.<br/>
              ID: <b style={{ color:'#dce8ff' }}>{ocorrencia?.id}</b>
            </div>
            <div style={{ display:'flex', gap:8, width:'100%' }}>
              <button onClick={() => setConfirmarExcluir(false)}
                style={{ flex:1, padding:'11px', borderRadius:10, cursor:'pointer',
                  background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.15)',
                  color:'rgba(255,255,255,.6)', fontSize:13 }}>
                Cancelar
              </button>
              <button onClick={excluirConfirmado} disabled={busy}
                style={{ flex:1, padding:'11px', borderRadius:10, cursor:'pointer',
                  background:'#dc2626', border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
                {busy ? 'Excluindo...' : '✓ Confirmar'}
              </button>
            </div>
          </div>
        )}

        {/* Footer fixo */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid rgba(255,255,255,.07)', flexShrink:0 }}>
          {isGestorModal && (
            <button onClick={excluir} disabled={busy}
              style={{ width:'100%', padding:'9px', borderRadius:9, cursor:'pointer', marginBottom:8,
                background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)',
                color:'#f87171', fontSize:12, fontWeight:600 }}>
              🗑 Excluir ocorrência permanentemente
            </button>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onFechar}
              style={{ flex:1, padding:'11px', borderRadius:10, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>Cancelar</button>
            <button onClick={salvar} disabled={busy}
              style={{ flex:2, padding:'11px', borderRadius:10, cursor:busy?'not-allowed':'pointer',
                background:busy?'rgba(124,58,237,.3)':'linear-gradient(135deg,#7c3aed,#a78bfa)',
                border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
              {busy?'Salvando...':'💾 Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function GuardOverlay({ mapInstance, onOcorrenciasChange, onFechar, cidade, usuario }: {
  mapInstance: L.Map | null;
  onOcorrenciasChange: (list: any[]) => void;
  onFechar: () => void;
  cidade: string;
  usuario: { uid: string; role: string };
}) {
  const { t } = useTranslation();
  const [ocorrencias,   setOcorrencias]   = useState<any[]>([]);
  const [filtroTipo,    setFiltroTipo]    = useState<string>('TODOS');
  const [buscaAtivo,    setBuscaAtivo]    = useState<string>('');
  const [filtroCidade,  setFiltroCidade]  = useState<string>('');
  const [filtroDias,    setFiltroDias]    = useState<number>(0); // 0 = Total (padrão)
  const [customDe,      setCustomDe]      = useState<string>('');
  const [customAte,     setCustomAte]     = useState<string>('');
  const [modoCustom,    setModoCustom]    = useState<boolean>(false);
  const [showHeat,      setShowHeat]      = useState<boolean>(false);
  const [selecionada,   setSelecionada]   = useState<any | null>(null);
  const [editModal,     setEditModal]     = useState<any | null>(null);
  const guardMarkersRef = useRef<L.CircleMarker[]>([]);
  const heatLayerRef    = useRef<any>(null);

  useEffect(() => {
    let ativo = true;
    // Calcula janela de tempo — custom ou dias fixos
    let desdeMs: number;
    let ateMs: number;
    if (modoCustom && customDe) {
      desdeMs = new Date(customDe + 'T00:00:00').getTime();
      ateMs   = customAte ? new Date(customAte + 'T23:59:59').getTime() : Date.now() + 86400000;
    } else if (filtroDias === 0) {
      // Total: sem limite de data — inclui tudo
      desdeMs = 0;
      ateMs   = 9999999999999; // ano ~2286
    } else {
      desdeMs = Date.now() - filtroDias * 24 * 60 * 60 * 1000;
      ateMs   = Date.now() + 300000; // +5min para cobrir serverTimestamp do servidor
    }
    const q = query(collection(db, 'ocorrencias'));
    const unsub = onSnapshot(q,
      snap => {
        if (!ativo) return;
        const lista = snap.docs
          .map(d => ({ docId: d.id, ...d.data(), id: d.id }))
          .filter((o: any) => {
            // Modo Total: inclui TUDO sem filtro de data
            if (filtroDias === 0 && !modoCustom) return true;
            const ts = o.criadoEm || o.created_at;
            if (!ts) return true; // sem timestamp = inclui sempre
            const ms = ts?.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
            if (isNaN(ms)) return true;
            return ms >= desdeMs && ms <= ateMs;
          })
          .map((o: any) => {
            // Aceitar lat/lng com vírgula (importados do XLSX) ou ponto
            const parseLoc = (v: any) => {
              if (typeof v === 'number') return v;
              const s = String(v ?? '').replace(',', '.');
              const n = parseFloat(s);
              return isNaN(n) ? 0 : n;
            };
            return {
              ...o,
              lat_inicial: parseLoc(o.lat_inicial ?? o.lat ?? o.latitude),
              lng_inicial: parseLoc(o.lng_inicial ?? o.lng ?? o.longitude),
              // Normalizar tipo — dados importados podem ter variações
              tipo: (() => {
                const t = String(o.tipo || '').trim();
                const tl = t.toLowerCase();
                if (tl === 'roubo' || tl === 'furto') return 'Roubo';
                if (tl === 'vandalismo') return 'Vandalismo';
                if (tl === 'tentativa') return 'Tentativa';
                if (tl === 'recuperacao' || tl === 'recuperação') return 'Recuperacao';
                if (tl === 'alarme') return 'Alarme';
                return t || 'Outro';
              })(),
            };
          })
          .sort((a: any, b: any) =>
            (b.criadoEm?.toDate?.()?.getTime() || 0) - (a.criadoEm?.toDate?.()?.getTime() || 0));
        setOcorrencias(lista);
        onOcorrenciasChange(lista);
      },
      err => { console.error('[GuardOverlay] Firestore error:', err.code, err.message); }
    );
    return () => { ativo = false; unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidade, filtroDias, modoCustom, customDe, customAte]);

  useEffect(() => {
    if (!mapInstance) return;
    // Remove markers antigos
    guardMarkersRef.current.forEach(m => m.remove());
    guardMarkersRef.current = [];
    // Remove heatmap antigo
    if (heatLayerRef.current) { (mapInstance as any).removeLayer(heatLayerRef.current); heatLayerRef.current = null; }

    const filtradas = filtroTipo === 'TODOS' ? ocorrencias : ocorrencias.filter(o => o.tipo === filtroTipo);

    // ── Heatmap: carregar leaflet.heat dinamicamente se não estiver disponível
    if (showHeat) {
      const pts = filtradas
        .filter(o => o.lat_inicial && o.lng_inicial)
        .map(o => [Number(o.lat_inicial), Number(o.lng_inicial), 1.0]);

      const renderHeat = () => {
        if (pts.length && (L as any).heatLayer) {
          if (heatLayerRef.current) { (mapInstance as any).removeLayer(heatLayerRef.current); }
          heatLayerRef.current = (L as any).heatLayer(pts, {
            radius: 40, blur: 30, maxZoom: 17, max: 1.0,
            gradient: { 0.0: '#22c55e', 0.4: '#eab308', 0.6: '#f97316', 1.0: '#ef4444' },
          }).addTo(mapInstance);
        }
      };

      if ((L as any).heatLayer) {
        renderHeat();
      } else {
        // Carregar leaflet.heat dinamicamente
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js';
        script.onload = renderHeat;
        document.head.appendChild(script);
      }
    }

    // Scatter markers — ocultos no modo heatmap para não poluir
    filtradas.forEach(o => {
      const oLat = Number(o.lat_inicial ?? o.lat ?? o.latitude ?? 0);
      const oLng = Number(o.lng_inicial ?? o.lng ?? o.longitude ?? 0);
      if (!oLat || !oLng) return;
      const cor = GUARD_TIPO_COR[o.tipo] || '#6b7280';
      const marker = L.circleMarker([oLat, oLng], {
        radius: showHeat ? 4 : 10,
        color: cor, weight: showHeat ? 1 : 2,
        fillColor: cor,
        fillOpacity: showHeat ? 0.25 : 0.85,
      }).addTo(mapInstance);
      marker.bindPopup(
        '<div style="font-family:Inter,sans-serif;min-width:180px">' +
          '<div style="font-weight:700;font-size:14px;color:' + cor + ';margin-bottom:4px">' +
            (GUARD_TIPO_EMOJI[o.tipo] || '⚪') + ' ' + o.tipo +
          '</div>' +
          '<div style="font-size:12px;color:#444;margin-bottom:6px">' + (o.descricao || '') + '</div>' +
          '<div style="font-size:11px;color:#888">' +
            (o.asset_id ? 'Ativo: ' + o.asset_id + ' · ' : '') +
            (o.bairro_inicial || o.cidade_inicial || '') +
          '</div>' +
          '<div style="font-size:10px;color:#aaa;margin-top:4px">' +
            (o.registradoPorNome || '') + ' · ' + o.status +
            (o.bo_numero ? ' · BO ' + o.bo_numero : '') +
          '</div>' +
        '</div>'
      );
      marker.on('click', () => setSelecionada({ ...o, lat_inicial: oLat, lng_inicial: oLng }));
      guardMarkersRef.current.push(marker);
    });
    return () => {
      guardMarkersRef.current.forEach(m => m.remove());
      guardMarkersRef.current = [];
      if (heatLayerRef.current) { (mapInstance as any).removeLayer(heatLayerRef.current); heatLayerRef.current = null; }
    };
  }, [mapInstance, ocorrencias, filtroTipo, showHeat]);

  // Cidades únicas para chips
  const cidadesUnicas = [...new Set(
    ocorrencias.map(o => (o as any).cidade_inicial).filter(Boolean) as string[]
  )].sort().slice(0, 12);

  const filtradas = ocorrencias
    .filter(o => filtroTipo === 'TODOS' || o.tipo === filtroTipo)
    .filter(o => !filtroCidade || (o as any).cidade_inicial === filtroCidade)
    .filter(o => !buscaAtivo.trim() ||
      (o.asset_id || '').toLowerCase().includes(buscaAtivo.trim().toLowerCase()) ||
      (o.id || '').toLowerCase().includes(buscaAtivo.trim().toLowerCase())
    );
  const contagens: Record<string, number> = {};
  ocorrencias.forEach(o => { contagens[o.tipo] = (contagens[o.tipo] || 0) + 1; });

  // KPIs em tempo real
  const kpiAbertos    = ocorrencias.filter(o => o.status === 'Aberto' || o.status === 'Em apuracao').length;
  const kpiCriticos   = ocorrencias.filter(o => o.prioridade === 'Alta' || o.prioridade === 'Critica').length;
  const kpiProcurando = ocorrencias.filter(o => o.procurando === true).length;
  const kpiRoubos     = ocorrencias.filter(o => o.tipo === 'Roubo' || o.tipo === 'Furto').length;
  const kpiRecuperado = ocorrencias.filter(o => o.status === 'Recuperado').length;

  function fmtOc(ts: any): string {
    if (!ts) return '';
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <>
      <div
        onTouchStart={(ev) => { (ev.currentTarget as any)._tx = ev.touches[0].clientX; }}
        onTouchEnd={(ev) => {
          const dx = ev.changedTouches[0].clientX - ((ev.currentTarget as any)._tx || 0);
          if (dx > 60) onFechar();
        }}
        style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2500,
        width: '100%', maxWidth: window.innerWidth <= 500 ? '100vw' : 520,
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
              {filtradas.length} ocorrência{filtradas.length !== 1 ? 's' : ''} ·{' '}
              {modoCustom && customDe ? customDe + (customAte ? ' → ' + customAte : '') :
               filtroDias === 0 ? 'total' : filtroDias === 1 ? 'hoje' : 'últimos ' + filtroDias + 'd'}
            </div>
          </div>
          <button onClick={onFechar} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.5)', padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* KPIs em tempo real */}
        <div style={{ display:'flex', gap:6, padding:'10px 12px',
          borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0, flexWrap:'wrap' }}>
          {[
            { label:'Abertos',    v: kpiAbertos,    cor:'#60a5fa', bg:'rgba(96,165,250,.1)'  },
            { label:'Críticos',   v: kpiCriticos,   cor:'#f97316', bg:'rgba(249,115,22,.1)'  },
            { label:'Procurando', v: kpiProcurando, cor:'#ef4444', bg:'rgba(239,68,68,.12)', bold: kpiProcurando > 0 },
            { label:'Roubos',     v: kpiRoubos,     cor:'#f87171', bg:'rgba(248,113,113,.08)' },
            { label:'Recuperado', v: kpiRecuperado, cor:'#4ade80', bg:'rgba(74,222,128,.08)'  },
          ].map(k => (
            <div key={k.label} style={{ flex:'1 1 auto', minWidth:56,
              background: k.bg, border:`1px solid ${k.cor}30`,
              borderRadius:8, padding:'6px 8px', textAlign:'center' }}>
              <div style={{ fontSize:16, fontWeight:800, color: k.cor,
                animation: k.bold ? 'pulse-kpi 1.5s infinite' : 'none' }}>{k.v}</div>
              <div style={{ fontSize:8, color:'rgba(255,255,255,.4)', marginTop:1 }}>{k.label}</div>
            </div>
          ))}
        </div>
        <style>{`@keyframes pulse-kpi{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

        {/* Filtro período */}
        <div style={{ flexShrink: 0 }}>
          {/* Botões rápidos */}
          <div style={{ padding: '8px 12px', display: 'flex', gap: 5, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            {([
              { label: 'Hoje',   d: 1  },
              { label: 'Ontem',  d: 2  },
              { label: '7d',     d: 7  },
              { label: '30d',    d: 30 },
              { label: 'Total',  d: 0  },
            ] as {label:string;d:number}[]).map(({ label, d }) => (
              <button key={d} onClick={() => { setFiltroDias(d); setModoCustom(false); }} style={{
                flex: 1, padding: '5px 0', borderRadius: 7, cursor: 'pointer', fontSize: 11,
                background: !modoCustom && filtroDias === d ? 'rgba(124,58,237,.25)' : 'rgba(255,255,255,.04)',
                border: '1px solid ' + (!modoCustom && filtroDias === d ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.08)'),
                color: !modoCustom && filtroDias === d ? '#a78bfa' : 'rgba(255,255,255,.35)',
                fontWeight: !modoCustom && filtroDias === d ? 700 : 400,
              }}>{label}</button>
            ))}
            <button onClick={() => setModoCustom(v => !v)} style={{
              padding: '5px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 11,
              background: modoCustom ? 'rgba(124,58,237,.25)' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (modoCustom ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.08)'),
              color: modoCustom ? '#a78bfa' : 'rgba(255,255,255,.35)',
            }}>📅</button>
          </div>
          {/* Custom date range */}
          {modoCustom && (
            <div style={{ padding: '8px 12px', display: 'flex', gap: 6, alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(124,58,237,.05)' }}>
              <input type="date" value={customDe} onChange={e => setCustomDe(e.target.value)} style={{
                flex: 1, padding: '5px 8px', borderRadius: 7, fontSize: 11,
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                color: '#fff', outline: 'none',
              }} />
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 11 }}>→</span>
              <input type="date" value={customAte} onChange={e => setCustomAte(e.target.value)} style={{
                flex: 1, padding: '5px 8px', borderRadius: 7, fontSize: 11,
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                color: '#fff', outline: 'none',
              }} />
            </div>
          )}
          {/* Gráfico tempo real — Hoje / Ontem / 7d / 30d / Total */}
          <GuardTrendChart ocorrencias={ocorrencias} />

          {/* Gráfico comparativo — todos os períodos lado a lado */}
          <GuardComparativoChart ocorrencias={ocorrencias} />

          {/* Toggle heatmap */}
          <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <button onClick={() => setShowHeat(v => !v)} style={{
              padding: '4px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 11,
              background: showHeat ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (showHeat ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.08)'),
              color: showHeat ? '#f87171' : 'rgba(255,255,255,.35)',
            }}>🔥 Heatmap</button>
            <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 10 }}>
              {showHeat ? 'Mapa de calor ativo' : 'Ver concentração no mapa'}
            </span>
          </div>
        </div>

        {/* Busca por ativo */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
          <input
            value={buscaAtivo}
            onChange={e => setBuscaAtivo(e.target.value)}
            placeholder="🔍 Buscar ativo (S.123456, 283-649...)"
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
              color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const }}
          />
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
              background: filtroTipo === t ? GUARD_TIPO_COR[t] + '20' : 'rgba(255,255,255,.04)',
              color: filtroTipo === t ? GUARD_TIPO_COR[t] : 'rgba(255,255,255,.4)',
              border: '1px solid ' + (filtroTipo === t ? GUARD_TIPO_COR[t] + '40' : 'rgba(255,255,255,.06)'),
            }}>{GUARD_TIPO_EMOJI[t]} {t} ({contagens[t]})</button>
          ) : null)}
        </div>

        {/* Chips de cidade */}
        {cidadesUnicas.length > 1 && (
          <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,.06)',
            display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none' as any, flexShrink: 0 }}>
            <button onClick={() => setFiltroCidade('')} style={{
              padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 10, whiteSpace: 'nowrap', fontWeight: 600,
              background: !filtroCidade ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.04)',
              color: !filtroCidade ? '#fff' : 'rgba(255,255,255,.35)',
            }}>🌎 Todas</button>
            {cidadesUnicas.map(c => (
              <button key={c} onClick={() => setFiltroCidade(c === filtroCidade ? '' : c)} style={{
                padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                fontSize: 10, whiteSpace: 'nowrap', fontWeight: 600,
                border: `1px solid ${filtroCidade === c ? 'rgba(96,165,250,.5)' : 'rgba(255,255,255,.07)'}`,
                background: filtroCidade === c ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.03)',
                color: filtroCidade === c ? '#60a5fa' : 'rgba(255,255,255,.4)',
              }}>{c}</button>
            ))}
          </div>
        )}

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any, scrollbarWidth: 'thin' as const }}>
          {filtradas.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '48px 24px', color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛡</div>
              <div style={{ fontSize: 13 }}>Nenhuma ocorrência no período</div>
            </div>
          ) : filtradas.map(o => (
            <div key={o.id}
              onClick={() => {
                setSelecionada(o);
                const cLat = Number(o.lat_inicial ?? o.lat ?? 0); const cLng = Number(o.lng_inicial ?? o.lng ?? 0);
                  if (mapInstance && cLat && cLng) mapInstance.setView([cLat, cLng], 17);
              }}
              style={{
                padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.05)',
                cursor: 'pointer',
                background: selecionada?.id === o.id ? 'rgba(124,58,237,.1)' : 'transparent',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{GUARD_TIPO_EMOJI[o.tipo] || '⚪'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ color: GUARD_TIPO_COR[o.tipo] || '#fff', fontWeight: 600, fontSize: 13 }}>{o.tipo}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: (GUARD_STATUS_COR[o.status] || '#fff') + '15',
                      color: GUARD_STATUS_COR[o.status] || '#fff',
                    }}>{o.status}</span>
                    {o.bo_numero && <span style={{ fontSize: 10, color: '#eab308' }}>📋</span>}
                    {o.procurando && <span style={{ fontSize: 10, color: '#ef4444', fontWeight:700 }}>🔍</span>}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.descricao}</div>
                  <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 10, marginTop: 2 }}>
                    {fmtOc(o.criadoEm)} · {o.registradoPorNome} · {o.bairro_inicial || o.cidade_inicial || ''}
                  </div>
                </div>
                {(() => { const safe = sanitizarFotoUrl(o.foto1_url); return safe ? (
                  <img
                    src={safe}
                    alt=""
                    style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0,
                      border: '1px solid rgba(255,255,255,.1)' }}
                    onError={ev => { ev.currentTarget.style.display = 'none'; }}
                  />
                ) : null; })()}
              </div>
            </div>
          ))}
        </div>

        {/* Detalhe selecionado */}
        {selecionada && (
          <div style={{ borderTop: '1px solid rgba(167,139,250,.2)', background: 'rgba(124,58,237,.08)',
            padding: '14px 16px', overflowY: 'auto', maxHeight: '50vh',
            WebkitOverflowScrolling: 'touch' as any,
            scrollbarWidth: 'thin' as const }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: GUARD_TIPO_COR[selecionada.tipo] || '#fff', fontWeight: 700, fontSize: 14 }}>
                {GUARD_TIPO_EMOJI[selecionada.tipo]} {selecionada.tipo}
              </span>
              <button onClick={() => setSelecionada(null)} style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 16, cursor: 'pointer',
              }}>✕</button>
            </div>
            <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, marginBottom: 8 }}>{selecionada.descricao}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, marginBottom: 8 }}>
              {([
                ['Ativo',      selecionada.asset_id || '—'],
                ['Prioridade', selecionada.prioridade || '—'],
                ['Turno',      selecionada.turno],
                ['Guard',      selecionada.registradoPorNome],
                [t('drawer.status'),     selecionada.status],
                ['BO',         selecionada.bo_numero || '—'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>{k}</div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            {selecionada.observacao_fechamento && (
              <div style={{
                background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.15)',
                borderRadius: 8, padding: '8px 10px', marginBottom: 8,
              }}>
                <div style={{ color: '#22c55e', fontSize: 10, marginBottom: 3 }}>Observação</div>
                <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12 }}>{selecionada.observacao_fechamento}</div>
              </div>
            )}
            {[selecionada.foto1_url, selecionada.foto2_url].some(u => sanitizarFotoUrl(u)) && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[selecionada.foto1_url, selecionada.foto2_url].map((url: string|undefined, i: number) => {
                  const safe = sanitizarFotoUrl(url);
                  if (!safe) return null;
                  return (
                    <a key={i} href={safe} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                      <img src={safe} alt=""
                        style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 8 }}
                        onError={ev => { ev.currentTarget.style.display = 'none'; }} />
                    </a>
                  );
                })}
              </div>
            )}
            {selecionada.bo_url && (
              <a href={selecionada.bo_url} target="_blank" rel="noreferrer" style={{
                display: 'block', color: '#eab308', fontSize: 12, marginBottom: 8, textDecoration: 'none',
              }}>📋 Ver imagem do Boletim ↗</a>
            )}
            <button onClick={() => setEditModal(selecionada)} style={{
              width: '100%', padding: '9px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(124,58,237,.2)', border: '1px solid rgba(124,58,237,.4)',
              color: '#a78bfa', fontSize: 13, fontWeight: 600,
            }}>✏️ Editar / Resolver</button>
          </div>
        )}
      </div>

      {editModal && (
        <GuardEditModal
          ocorrencia={editModal}
          usuario={usuario}
          onFechar={() => setEditModal(null)}
          onSalvo={() => { setEditModal(null); setSelecionada(null); }}
        />
      )}
    </>
  );
}
