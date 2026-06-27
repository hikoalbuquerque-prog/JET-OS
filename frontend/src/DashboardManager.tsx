// DashboardManager.tsx — Dashboard + Custos API + Exportação/Importação
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, query, where, doc, writeBatch, getDoc, updateDoc, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { useState as useLocalState } from 'react';
import { db, auth } from './lib/firebase';
import { guardProviderSupabase, carregarOcorrenciasSupabase, buscarOcorrenciaSupabase, guardWriteSupabase, atualizarOcorrenciaSupabase } from './lib/ocorrencias-supabase';
import { mapaProviderSupabase, carregarEstacoesSupabase } from './lib/estacoes-supabase';
import { usuariosReadSupabase, fetchUsuarios } from './lib/usuarios-supabase';
import JSZip from 'jszip';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import { useCidadesExpansao, STATUS_META, type CidadeExpansao } from './CidadesExpansao';
import { fnGerarCroquisLote, fnSvEstatisticas } from './lib/firebase';                              
import GoJetCidadesPanel from './components/GoJetCidadesPanel';

interface Estacao {
  id: string; codigo: string; cidade: string; bairro: string;
  tipo: string; status: string; pais: string;
  subprefeitura?: string;
  endereco?: string;
  tpu?: string;
  croquiGeradoEm?: any;
  lat: number; lng: number; larguraFaixa?: number;
  operador?: string; criadoEm?: any; consultor?: string;
  privado?: { nomeLocal?:string; nomeAutorizante?:string; cargoAutorizante?:string; telefone?:string; email?:string; };
  ia?: { aprovado: boolean; score: number; confianca: string; largura: string };
  imagens?: { streetView?: string; croqui?: string; foto?: string };
  croquiStatus?: string;
}

interface Props {
  cidades: string[];
  pais: string;
  onFechar: () => void;
  roleAtual: string;
}

// ── HELPERS ──────────────────────────────────────────────────────
function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

// ── i18n (padrão TermosUsoGate: objetos {pt,en,es,ru} + seletor, sem chaves json) ──
type Lang = 'pt' | 'en' | 'es' | 'ru';
type TL = { pt: string; en: string; es: string; ru: string };
function useLang() {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: TL) => o[lang] ?? o.pt;
  return { lang, pick };
}

function BarraProgresso({ valor, total, cor }: { valor: number; total: number; cor: string }) {
  return (
    <div style={{ height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        height: '100%', borderRadius: 3, background: cor,
        width: `${pct(valor, total)}%`, transition: 'width .5s'
      }} />
    </div>
  );
}

function StatCard({ label, valor, sub, cor }: { label: string; valor: string|number; sub?: string; cor: string }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: `${cor}0f`, border: `1px solid ${cor}25`,
      flex: 1, minWidth: 100
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── EXPORTAÇÃO ────────────────────────────────────────────────────
interface CampoExport { key: string; label: string; grupo: string; default: boolean; }

const CAMPOS_EXPORT: CampoExport[] = [
  { key: 'codigo',       label: 'Código',           grupo: 'Identificação',  default: true  },
  { key: 'cidade',       label: 'Cidade',            grupo: 'Identificação',  default: true  },
  { key: 'bairro',       label: 'Bairro',            grupo: 'Identificação',  default: true  },
  { key: 'tipo',         label: 'Tipo',              grupo: 'Classificação',  default: true  },
  { key: 'status',       label: 'Status',            grupo: 'Classificação',  default: true  },
  { key: 'pais',         label: 'País',              grupo: 'Classificação',  default: false },
  { key: 'lat',          label: 'Latitude',          grupo: 'Localização',    default: true  },
  { key: 'lng',          label: 'Longitude',         grupo: 'Localização',    default: true  },
  { key: 'endereco',     label: 'Endereço',          grupo: 'Localização',    default: true  },
  { key: 'larguraFaixa', label: 'Largura Faixa (m)', grupo: 'Dados técnicos', default: true  },
  { key: 'operador',     label: 'Operador',          grupo: 'Dados técnicos', default: false },
  { key: 'consultor',    label: 'Consultor campo',   grupo: 'Dados técnicos', default: true  },
  { key: 'privado.nomeLocal',        label: 'Nome do local',     grupo: 'Privado', default: true  },
  { key: 'privado.nomeAutorizante',  label: 'Autorizante',       grupo: 'Privado', default: true  },
  { key: 'privado.cargoAutorizante', label: 'Cargo',             grupo: 'Privado', default: false },
  { key: 'privado.telefone',         label: 'Telefone parceiro', grupo: 'Privado', default: true  },
  { key: 'privado.email',            label: 'E-mail parceiro',   grupo: 'Privado', default: false },
  { key: 'ia_aprovado',  label: 'IA Aprovado',       grupo: 'IA',             default: true  },
  { key: 'ia_score',     label: 'IA Score',          grupo: 'IA',             default: true  },
  { key: 'ia_confianca', label: 'IA Confiança',      grupo: 'IA',             default: false },
  { key: 'ia_largura',   label: 'IA Largura Est.',   grupo: 'IA',             default: true  },
  { key: 'croquiStatus', label: 'Status Croqui',     grupo: 'Imagens',        default: false },
  { key: 'streetView',   label: 'URL Street View',   grupo: 'Imagens',        default: false },
  { key: 'foto',         label: 'URL Foto',          grupo: 'Imagens',        default: false },
  { key: 'criadoEm',     label: 'Data Criação',      grupo: 'Datas',          default: false },
];

function getValorCampo(e: Estacao, key: string): string {
  const v: Record<string, unknown> = {
    codigo: e.codigo, cidade: e.cidade, bairro: e.bairro,
    tipo: e.tipo, status: e.status, pais: e.pais,
    lat: e.lat, lng: e.lng, endereco: (e as any).endereco || '',
    larguraFaixa: e.larguraFaixa || '',
    operador: e.operador || '',
    ia_aprovado: e.ia?.aprovado != null ? (e.ia.aprovado ? 'SIM' : 'NAO') : '',
    ia_score: e.ia?.score ?? '',
    ia_confianca: e.ia?.confianca || '',
    ia_largura: e.ia?.largura || '',
    croquiStatus: e.croquiStatus || '',
    streetView: e.imagens?.streetView || '',
    foto: e.imagens?.foto || '',
    criadoEm: (e as any).criadoEm?.seconds
      ? new Date((e as any).criadoEm.seconds * 1000).toLocaleDateString('pt-BR')
      : ''
  };
  return String(v[key] ?? '');
}

function baixarCSV(estacoes: Estacao[], cidade: string, camposSel?: string[]) {
  const campos = camposSel || CAMPOS_EXPORT.filter(c => c.default).map(c => c.key);
  const linhas = [
    campos.map(k => CAMPOS_EXPORT.find(c => c.key === k)?.label || k).join(','),
    ...estacoes.map(e =>
      campos.map(k => `"${getValorCampo(e, k).replace(/"/g, '""')}"`).join(',')
    )
  ];
  const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `estacoes_${cidade.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function baixarJSON(estacoes: Estacao[], cidade: string) {
  const blob = new Blob([JSON.stringify(estacoes, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `estacoes_${cidade.replace(/\s/g,'_')}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── IMPORTAÇÃO INTELIGENTE ────────────────────────────────────────
interface ResultadoImport {
  total: number; novos: number; atualizados: number;
  ignorados: number; erros: string[];
}


// ── PARSER XLSX URENT (estações exportadas do sistema Urent/JET) ──────────────
// Formato: Наименование=endereço, Координаты="lat, lng", Зоны использования=zonas, Неактивна=inativa
// Regras de filtragem inteligente aplicadas antes de retornar os dados

// Zonas VÁLIDAS — estações de parada real
const ZONAS_VALIDAS = [
  'зона город',    // zona cidade
  'зона пляж',     // zona praia
  'zona cidade',   // alias PT
  'зона центр',    // zona centro
  'zona',          // genérico
];

// Zonas INVÁLIDAS — restrições, bloqueios, velocidade
const ZONAS_INVALIDAS_KEYWORDS = [
  'ограничение',   // restrição de velocidade
  'запрет',        // proibição
  'блокировка',    // bloqueio
  'slow',          // zona lenta
  'no-parking',
  'restricao',
  'bloqueio',
  'restricção',
  'velocidade',
  'proibido',
  'paine',         // outra cidade/país
  'novo hamburgo', // RS — fora do alvo
];

// Nomes genéricos sem endereço — ignorar
const NOMES_GENERICOS = [
  'recife', 'city', 'cidade', 'test', 'teste', 'zona', 'area', 'área',
  'station', 'estação', 'park', 'parque',
];

function isZonaValida(zona: string): boolean {
  if (!zona || zona.trim() === '') return true; // sem zona = aceitar
  const z = zona.toLowerCase();
  // Se contém keyword inválida → rejeitar
  if (ZONAS_INVALIDAS_KEYWORDS.some(k => z.includes(k))) return false;
  // Se é explicitamente válida → aceitar
  if (ZONAS_VALIDAS.some(v => z.includes(v))) return true;
  // Zona desconhecida mas não inválida → aceitar (conservador)
  return true;
}

function isNomeValido(nome: string): boolean {
  if (!nome || nome.trim().length < 4) return false;
  const n = nome.toLowerCase().trim();
  // Nome muito genérico (só 1 palavra e é genérica) → rejeitar
  const palavras = n.split(/[\s,]+/).filter(Boolean);
  if (palavras.length === 1 && NOMES_GENERICOS.includes(palavras[0])) return false;
  return true;
}

function isCoordBrasil(lat: number, lng: number): boolean {
  // Brasil: lat -33.8 a -4.5, lng -73.9 a -34.8
  return lat >= -33.9 && lat <= -4.4 && lng >= -74.0 && lng <= -34.7;
}

async function parseXlsxUrent(file: File): Promise<{
  validos: {nome:string; lat:number; lng:number; zonas:string; inativa:boolean}[];
  ignorados: {nome:string; motivo:string}[];
}> {
  // Carregar SheetJS via CDN se necessário
  const w = window as any;
  if (!w.XLSX) {
    await new Promise<void>(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
  }

  const buf  = await file.arrayBuffer();
  const wb   = w.XLSX.read(buf, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw: any[] = w.XLSX.utils.sheet_to_json(ws, { defval: '' });

  const validos:   {nome:string; lat:number; lng:number; zonas:string; inativa:boolean}[] = [];
  const ignorados: {nome:string; motivo:string}[] = [];

  for (const row of raw) {
    // Detectar colunas (russo ou inglês)
    const nome   = String(row['Наименование'] || row['Name']        || row['nome'] || '').trim();
    const coords = String(row['Координаты']   || row['Coordinates'] || row['coords'] || '').trim();
    const zonas  = String(row['Зоны использования'] || row['Zones'] || row['zonas'] || '').trim();
    const inativa = String(row['Неактивна']   || row['Inactive']    || row['inativa'] || 'false').toLowerCase() === 'true';

    // Validar nome
    if (!isNomeValido(nome)) { ignorados.push({ nome: nome || '(sem nome)', motivo: 'Nome genérico ou inválido' }); continue; }

    // Validar zonas
    if (!isZonaValida(zonas)) { ignorados.push({ nome, motivo: 'Zona de restrição: ' + zonas }); continue; }

    // Parsear coordenadas "lat, lng"
    const partes = coords.split(',');
    if (partes.length < 2) { ignorados.push({ nome, motivo: 'Coordenadas inválidas: ' + coords }); continue; }
    const lat = parseFloat(partes[0].trim());
    const lng = parseFloat(partes[1].trim());
    if (isNaN(lat) || isNaN(lng)) { ignorados.push({ nome, motivo: 'Coordenadas não numéricas' }); continue; }

    validos.push({ nome, lat, lng, zonas, inativa });
  }

  return { validos, ignorados };
}

async function importarEstacoes(
  arquivo: File,
  pais: string,
  onProgress: (msg: string) => void
): Promise<ResultadoImport> {
  const texto = await arquivo.text();
  const result: ResultadoImport = { total: 0, novos: 0, atualizados: 0, ignorados: 0, erros: [] };

  let dados: any[] = [];

  // Detecta formato
  if (arquivo.name.endsWith('.json')) {
    try { dados = JSON.parse(texto); }
    catch { result.erros.push('JSON inválido'); return result; }
  } else {
    // CSV — parse manual
    const linhas = texto.split('\n').filter(l => l.trim());
    if (linhas.length < 2) { result.erros.push('CSV vazio'); return result; }

    const header = linhas[0].split(',').map(h =>
      h.trim().replace(/^"|"$/g, '').toLowerCase()
        .replace('endereço', 'endereco')
        .replace('código', 'codigo')
    );

    dados = linhas.slice(1).map(linha => {
      const vals = linha.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
      const obj: any = {};
      header.forEach((h, i) => {
        obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim();
      });
      return obj;
    });
  }

  result.total = dados.length;
  onProgress(`Processando ${dados.length} registros...`);

  // Campos obrigatórios mínimos
  const CAMPOS_OBRIGATORIOS = ['lat', 'lng', 'codigo'];

  // Normaliza campo lat/lng de várias fontes
  const getNome = (obj: any, ...keys: string[]) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== '') return obj[k];
    }
    return '';
  };

  const BATCH_SIZE = 400;
  let batch = writeBatch(db);
  let ops = 0;

  for (let i = 0; i < dados.length; i++) {
    const row = dados[i];

    // Normaliza lat/lng - suporta coordenadas juntas no formato "-27.001, -48.630"
    let lat = parseFloat(getNome(row, 'lat', 'latitude', 'Latitude', 'LAT'));
    let lng = parseFloat(getNome(row, 'lng', 'longitude', 'Longitude', 'LNG', 'lon'));
    
    // Se lat/lng estão vazios, tenta campo de coordenadas juntas (ex: "Координаты")
    if (isNaN(lat) || isNaN(lng)) {
      const coordStr = getNome(row, 'координаты', 'Координаты', 'coordinates', 'Coordinates', 'coords', 'Coords');
      if (coordStr && coordStr.includes(',')) {
        const [latStr, lngStr] = coordStr.split(',').map((s: string) => s.trim());
        lat = parseFloat(latStr);
        lng = parseFloat(lngStr);
      }
    }
    
    const codigo = String(getNome(row, 'codigo', 'Codigo', 'CodigoEstacao', 'code', 'id', 'name', 'Name', 'Наименование') || '').trim();
    
    // Verificar se estação está ativa ou não ANTES de validar
    // Procura em múltiplos nomes de campo (case-insensitive matching)
    const checkField = (fieldNames: string[]): string => {
      const rowKeys = Object.keys(row);
      for (const fname of fieldNames) {
        const fnameLower = fname.toLowerCase();
        for (const rkey of rowKeys) {
          if (rkey.toLowerCase() === fnameLower) {
            const val = (row as any)[rkey];
            return String(val || '').toLowerCase();
          }
        }
      }
      return '';
    };
    
    const ativaValue = checkField(['ativa', 'ativo', 'active', 'неактивна']);
    // Se campo explicitamente diz que está inativo (true/sim/1), marcar como inativo
    const estaInativa = ['true', '1', 'sim', 'yes', 'verdadeiro'].includes(ativaValue);

    // Validações
    if (isNaN(lat) || isNaN(lng)) {
      result.erros.push(`Linha ${i + 2}: lat/lng inválidos (${row.lat || row.coordinate}, ${row.lng})`);
      result.ignorados++;
      continue;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      result.erros.push(`Linha ${i + 2}: coordenadas fora do range (${lat}, ${lng})`);
      result.ignorados++;
      continue;
    }
    if (!codigo) {
      result.erros.push(`Linha ${i + 2}: código ausente`);
      result.ignorados++;
      continue;
    }

    const docRef = doc(db, 'estacoes', codigo);
    const existente = await getDoc(docRef);

    const tipo   = String(getNome(row, 'tipo', 'TipoEstacao') || 'PUBLICA').toUpperCase();
    let status = String(getNome(row, 'status', 'StatusEstacao', 'Status') || 'SOLICITADO').toUpperCase();
    const cidade = String(getNome(row, 'cidade', 'Cidade') || '');
    const bairro = String(getNome(row, 'bairro', 'Bairro') || '');
    
    // Se estação está inativa, importar como CANCELADO
    if (estaInativa && status !== 'CANCELADO') {
      console.log(`[IMPORT] Linha ${i + 2}: ${codigo} está INATIVA → convertendo para CANCELADO`);
      status = 'CANCELADO';
    }

    const docData: any = {
      id: codigo, codigo, lat, lng,
      tipo:    ['PUBLICA','PRIVADA','CONCORRENTE'].includes(tipo) ? tipo : 'PUBLICA',
      status:  ['SOLICITADO','APROVADO','REPROVADO','INSTALADO','CANCELADO'].includes(status) ? status : 'SOLICITADO',
      cidade, bairro, pais,
      endereco:      String(getNome(row, 'endereco', 'Endereco', 'endereço') || ''),
      larguraFaixa:  parseFloat(getNome(row, 'largurafaixa', 'largura_faixa', 'Largura')) || null,
      croquiStatus:  String(getNome(row, 'croquistatus', 'CroquiStatus') || 'PENDENTE'),
      origem:        'IMPORTACAO',
      atualizadoEm:  new Date()
    };

    // Remove nulos
    Object.keys(docData).forEach(k => {
      if (docData[k] === null || docData[k] === '') delete docData[k];
    });

    if (existente.exists()) {
      // Atualiza coordenadas e status, preserva dados existentes
      batch.update(docRef, docData);
      result.atualizados++;
    } else {
      batch.set(docRef, { ...docData, criadoEm: new Date() });
      result.novos++;
    }

    ops++;
    if (ops >= BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
      onProgress(`Salvando... ${i + 1}/${dados.length}`);
    }
  }

  if (ops > 0) await batch.commit();
  return result;
}

// ── RELATÓRIO DE ESTAÇÕES ─────────────────────────────────────────

const JET_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="54" height="54"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#060d1a"/><stop offset="100%" style="stop-color:#0d1f35"/></linearGradient><linearGradient id="hx" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1e7fd8"/><stop offset="100%" style="stop-color:#0ab4f5"/></linearGradient></defs><rect width="512" height="512" rx="96" fill="url(#bg)"/><polygon points="256,72 424,166 424,346 256,440 88,346 88,166" fill="none" stroke="url(#hx)" stroke-width="5" opacity=".9"/><text x="256" y="280" font-family="Arial Black,Impact,Arial,sans-serif" font-size="160" font-weight="900" fill="#fff" text-anchor="middle" letter-spacing="-6">JET</text></svg>`;

interface CampoRelatorio { key: string; label: string; grupo: string; default: boolean; }

const CAMPOS_RELATORIO: CampoRelatorio[] = [
  // Identificação
  { key: 'codigo',                    label: 'Código',            grupo: 'Identificação', default: true  },
  { key: 'criadoEm',                  label: 'Cadastrado em',     grupo: 'Identificação', default: true  },
  { key: 'consultor',                 label: 'Consultor campo',   grupo: 'Identificação', default: true  },
  // Localização
  { key: 'endereco',                  label: 'Endereço',          grupo: 'Localização',   default: true  },
  { key: 'lat',                       label: 'Latitude',          grupo: 'Localização',   default: true  },
  { key: 'lng',                       label: 'Longitude',         grupo: 'Localização',   default: true  },
  // Classificação
  { key: 'tipo',                      label: 'Tipo',              grupo: 'Classificação', default: false },
  { key: 'status',                    label: 'Status',            grupo: 'Classificação', default: true  },
  { key: 'larguraFaixa',             label: 'Largura faixa (m)', grupo: 'Classificação', default: true  },
  // Dados do estabelecimento privado
  { key: 'privado.nomeLocal',         label: 'Nome do local',     grupo: 'Estabelecimento', default: true  },
  { key: 'privado.nomeAutorizante',   label: 'Autorizante',       grupo: 'Estabelecimento', default: true  },
  { key: 'privado.cargoAutorizante',  label: 'Cargo',             grupo: 'Estabelecimento', default: true  },
  { key: 'privado.telefone',          label: 'Telefone parceiro', grupo: 'Estabelecimento', default: true  },
  { key: 'privado.email',             label: 'E-mail parceiro',   grupo: 'Estabelecimento', default: true  },
  // Operacional
  { key: 'operador',                  label: 'Operador',          grupo: 'Operacional',   default: false },
  { key: 'ia_aprovado',               label: 'IA Aprovado',       grupo: 'Operacional',   default: false },
  { key: 'ia_score',                  label: 'IA Score',          grupo: 'Operacional',   default: false },
  { key: 'croqui',                    label: 'Link Croqui',       grupo: 'Operacional',   default: false },
  { key: 'foto',                      label: 'Link Foto',         grupo: 'Operacional',   default: false },
  { key: 'streetView',                label: 'Link Street View',  grupo: 'Operacional',   default: false },
];

function fmtDataRel(ts: any, comHora = false): string {
  if (!ts) return '';
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (comHora) {
      return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }
    return d.toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function getValRelatorio(e: Estacao, key: string): string {
  const m: Record<string, string> = {
    codigo:       e.codigo || '',
    criadoEm:     fmtDataRel((e as any).criadoEm, true),
    consultor:    (e as any).consultor || '',
    endereco:     (e as any).endereco  || '',
    lat:          e.lat ? String(e.lat) : '',
    lng:          e.lng ? String(e.lng) : '',
    tipo:         e.tipo   || '',
    status:       e.status || '',
    larguraFaixa: e.larguraFaixa ? String(e.larguraFaixa) + 'm' : '',
    'privado.nomeLocal':        (e as any).privado?.nomeLocal        || '',
    'privado.nomeAutorizante':  (e as any).privado?.nomeAutorizante  || '',
    'privado.cargoAutorizante': (e as any).privado?.cargoAutorizante || '',
    'privado.telefone':         (e as any).privado?.telefone         || '',
    'privado.email':            (e as any).privado?.email            || '',
    operador:     (e as any).operador  || '',
    ia_aprovado:  e.ia?.aprovado != null ? (e.ia.aprovado ? 'SIM' : 'NÃO') : '',
    ia_score:     e.ia?.score ? String(e.ia.score) : '',
    croqui:       e.imagens?.croqui    || '',
    foto:         e.imagens?.foto      || '',
    streetView:   (() => {
      // Preferir gerar URL do Google Maps Street View a partir das coords
      if (e.lat && e.lng) {
        return 'https://www.google.com/maps?q=' + e.lat + ',' + e.lng
          + '&cbll=' + e.lat + ',' + e.lng + '&layer=c';
      }
      return e.imagens?.streetView || '';
    })(),
  };
  return m[key] ?? '';
}

// ── Helper: abre janela, aguarda imagens e imprime ────────────────
function abrirJanelaImpressao(html: string, nomeArquivo: string) {
  // Download direto como HTML — sem popup, sem print dialog
  const nome = nomeArquivo.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim() + '.html';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

function RelatorioManager({ estacoes, cidade, pais, total }: {
  estacoes: Estacao[]; cidade: string; pais: string; total: number;
}) {
  const { pick } = useLang();
  const T = {
    abaPrefeitura: { pt:'📋 Relatório Prefeitura', en:'📋 City Hall Report', es:'📋 Informe Ayuntamiento', ru:'📋 Отчёт мэрии' },
    abaSuporte:    { pt:'📊 Suporte JET (Excel)', en:'📊 JET Support (Excel)', es:'📊 Soporte JET (Excel)', ru:'📊 Поддержка JET (Excel)' },
    headerTitulo:  { pt:'Relatório de Estações', en:'Stations Report', es:'Informe de Estaciones', ru:'Отчёт о станциях' },
    headerSub:     { pt:'Selecione as estações e gere o PDF no formato de relatório de pontos', en:'Select the stations and generate the PDF in the points report format', es:'Seleccione las estaciones y genere el PDF en formato de informe de puntos', ru:'Выберите станции и создайте PDF в формате отчёта о точках' },
    todos:         { pt:'Todos', en:'All', es:'Todos', ru:'Все' },
    privadas:      { pt:'🏢 Privadas', en:'🏢 Private', es:'🏢 Privadas', ru:'🏢 Частные' },
    publicas:      { pt:'🛤 Públicas', en:'🛤 Public', es:'🛤 Públicas', ru:'🛤 Публичные' },
    concorrentes:  { pt:'⚔️ Concorrentes', en:'⚔️ Competitors', es:'⚔️ Competidores', ru:'⚔️ Конкуренты' },
    todosStatus:   { pt:'Todos status', en:'All statuses', es:'Todos los estados', ru:'Все статусы' },
    estacoesCnt:   { pt:'estações', en:'stations', es:'estaciones', ru:'станций' },
    selecionadas:  { pt:'selecionadas', en:'selected', es:'seleccionadas', ru:'выбрано' },
    desmarcarTudo: { pt:'Desmarcar tudo', en:'Deselect all', es:'Deseleccionar todo', ru:'Снять выделение' },
    selecionarTudo:{ pt:'Selecionar tudo', en:'Select all', es:'Seleccionar todo', ru:'Выбрать всё' },
    nenhumaFiltro: { pt:'Nenhuma estação com esses filtros', en:'No station matches these filters', es:'Ninguna estación con estos filtros', ru:'Нет станций по этим фильтрам' },
    ocultar:       { pt:'Ocultar', en:'Hide', es:'Ocultar', ru:'Скрыть' },
    configurar:    { pt:'Configurar', en:'Configure', es:'Configurar', ru:'Настроить' },
    camposRelat:   { pt:'campos do relatório', en:'report fields', es:'campos del informe', ru:'поля отчёта' },
    camposAtivos:  { pt:'campos ativos', en:'active fields', es:'campos activos', ru:'активных полей' },
  };
  // Tradução dos rótulos de grupo/campo do relatório (somente exibição; chaves internas inalteradas)
  const grupoLabels: Record<string, TL> = {
    'Identificação':  { pt:'Identificação', en:'Identification', es:'Identificación', ru:'Идентификация' },
    'Localização':    { pt:'Localização', en:'Location', es:'Ubicación', ru:'Местоположение' },
    'Classificação':  { pt:'Classificação', en:'Classification', es:'Clasificación', ru:'Классификация' },
    'Estabelecimento':{ pt:'Estabelecimento', en:'Establishment', es:'Establecimiento', ru:'Заведение' },
    'Operacional':    { pt:'Operacional', en:'Operational', es:'Operacional', ru:'Операционные' },
  };
  const campoLabels: Record<string, TL> = {
    codigo:        { pt:'Código', en:'Code', es:'Código', ru:'Код' },
    criadoEm:      { pt:'Cadastrado em', en:'Registered on', es:'Registrado el', ru:'Зарегистрировано' },
    consultor:     { pt:'Consultor campo', en:'Field consultant', es:'Consultor de campo', ru:'Полевой консультант' },
    endereco:      { pt:'Endereço', en:'Address', es:'Dirección', ru:'Адрес' },
    lat:           { pt:'Latitude', en:'Latitude', es:'Latitud', ru:'Широта' },
    lng:           { pt:'Longitude', en:'Longitude', es:'Longitud', ru:'Долгота' },
    tipo:          { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
    status:        { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    larguraFaixa:  { pt:'Largura faixa (m)', en:'Lane width (m)', es:'Ancho de carril (m)', ru:'Ширина полосы (м)' },
    'privado.nomeLocal':        { pt:'Nome do local', en:'Location name', es:'Nombre del local', ru:'Название места' },
    'privado.nomeAutorizante':  { pt:'Autorizante', en:'Authorizer', es:'Autorizante', ru:'Уполномоченный' },
    'privado.cargoAutorizante': { pt:'Cargo', en:'Position', es:'Cargo', ru:'Должность' },
    'privado.telefone':         { pt:'Telefone parceiro', en:'Partner phone', es:'Teléfono socio', ru:'Телефон партнёра' },
    'privado.email':            { pt:'E-mail parceiro', en:'Partner email', es:'Correo socio', ru:'Эл. почта партнёра' },
    operador:      { pt:'Operador', en:'Operator', es:'Operador', ru:'Оператор' },
    ia_aprovado:   { pt:'IA Aprovado', en:'AI Approved', es:'IA Aprobado', ru:'ИИ одобрено' },
    ia_score:      { pt:'IA Score', en:'AI Score', es:'Puntuación IA', ru:'Оценка ИИ' },
    croqui:        { pt:'Link Croqui', en:'Sketch link', es:'Enlace croquis', ru:'Ссылка на эскиз' },
    foto:          { pt:'Link Foto', en:'Photo link', es:'Enlace foto', ru:'Ссылка на фото' },
    streetView:    { pt:'Link Street View', en:'Street View link', es:'Enlace Street View', ru:'Ссылка Street View' },
  };
  const labelGrupo = (g: string) => grupoLabels[g] ? pick(grupoLabels[g]) : g;
  const labelCampo = (k: string, fallback: string) => campoLabels[k] ? pick(campoLabels[k]) : fallback;
  // Filtra apenas PRIVADAS por padrão, ordenadas por criadoEm desc
  const [filtroTipo,   setFiltroTipo]   = useState<'TODOS'|'PRIVADA'|'PUBLICA'|'CONCORRENTE'>('PRIVADA');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [gerando,      setGerando]      = useState(false);
  const [idiomaRelat,  setIdiomaRelat]  = useState<'pt-BR'|'es'|'en'>('pt-BR');
  const [modoRelat,    setModoRelat]    = useState<'normal'|'compacto'>('normal');
  const [campos,       setCampos]       = useState<string[]>(
    CAMPOS_RELATORIO.filter(c => c.default).map(c => c.key)
  );
  const [mostrarCampos, setMostrarCampos] = useState(false);

  const toggle = (key: string) =>
    setCampos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  // Filtragem e ordenação
  const estFiltradas = estacoes
    .filter(e => filtroTipo === 'TODOS' || e.tipo === filtroTipo)
    .filter(e => filtroStatus === 'TODOS' || e.status === filtroStatus)
    .sort((a, b) => {
      const ta = a.criadoEm?.toDate?.()?.getTime() || new Date(a.criadoEm || 0).getTime();
      const tb = b.criadoEm?.toDate?.()?.getTime() || new Date(b.criadoEm || 0).getTime();
      return tb - ta; // mais recente primeiro
    });

  // Selecionar/desmarcar tudo
  const toggleTudo = () => {
    if (selecionadas.size === estFiltradas.length) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set(estFiltradas.map(e => e.id)));
    }
  };

  const toggleItem = (id: string) =>
    setSelecionadas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const estRelatorio = estFiltradas.filter(e => selecionadas.has(e.id));

  const fmtData = (ts: any, comHora = true) => {
    if (!ts) return '';
    try {
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      if (comHora) {
        return d.toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      }
      return d.toLocaleDateString('pt-BR');
    } catch { return ''; }
  };

  // ── Traduções do relatório ────────────────────────────────────
  const i18nRelat: Record<string, Record<string,string>> = {
    'pt-BR': {
      titulo:      'Relatório de Estações',
      cidade:      'Cidade',
      data:        'Data',
      prep:        'Elaborado por',
      empresa:     'JET Scooters',
      tabelaTit:   'Estações Cadastradas',
      codigo:      'Código',
      endereco:    'Endereço',
      bairro:      'Bairro',
      status:      'Status',
      tipo:        'Tipo',
      largura:     'Largura (m)',
      consultor:   'Consultor',
      dataReg:     'Data Registro',
      local:       'Nome Local',
      autorizante: 'Responsável',
      total:       'Total de pontos',
      rodape:      'Documento gerado automaticamente pelo sistema JET OS',
      modoNormal:  'Normal',
      modoCompact: 'Compacto',
      selIdioma:   'Idioma do relatório:',
      selModo:     'Modo:',
      btnGerar:    'Gerar PDF',
      btnGerando:  'Gerando PDF...',
      btnSel:      'Selecione estações para gerar',
      estacao:     'estação',
      estacoes:    'estações',
      dadosEst:    'Dados do estabelecimento',
      svLabel:     'Abrir Street View',
      fotoLabel:   'Ver Foto',
      croquiLabel: 'Ver Croqui',
      nomeLocal:   'Local',
    },
    'es': {
      titulo:      'Informe de Estaciones',
      cidade:      'Ciudad',
      data:        'Fecha',
      prep:        'Elaborado por',
      empresa:     'JET Scooters',
      tabelaTit:   'Estaciones Registradas',
      codigo:      'Código',
      endereco:    'Dirección',
      bairro:      'Barrio',
      status:      'Estado',
      tipo:        'Tipo',
      largura:     'Ancho (m)',
      consultor:   'Consultor',
      dataReg:     'Fecha Registro',
      local:       'Nombre Local',
      autorizante: 'Responsable',
      total:       'Total de puntos',
      rodape:      'Documento generado automáticamente por el sistema JET OS',
      modoNormal:  'Normal',
      modoCompact: 'Compacto',
      selIdioma:   'Idioma del informe:',
      selModo:     'Modo:',
      btnGerar:    'Generar PDF',
      btnGerando:  'Generando PDF...',
      btnSel:      'Seleccione estaciones para generar',
      estacao:     'estación',
      estacoes:    'estaciones',
      dadosEst:    'Datos del establecimiento',
      svLabel:     'Abrir Street View',
      fotoLabel:   'Ver Foto',
      croquiLabel: 'Ver Croquis',
      nomeLocal:   'Local',
    },
    'en': {
      titulo:      'Stations Report',
      cidade:      'City',
      data:        'Date',
      prep:        'Prepared by',
      empresa:     'JET Scooters',
      tabelaTit:   'Registered Stations',
      codigo:      'Code',
      endereco:    'Address',
      bairro:      'Neighborhood',
      status:      'Status',
      tipo:        'Type',
      largura:     'Width (m)',
      consultor:   'Consultant',
      dataReg:     'Registration Date',
      local:       'Location Name',
      autorizante: 'Responsible',
      total:       'Total points',
      rodape:      'Document automatically generated by JET OS system',
      modoNormal:  'Normal',
      modoCompact: 'Compact',
      selIdioma:   'Report language:',
      selModo:     'Mode:',
      btnGerar:    'Generate PDF',
      btnGerando:  'Generating PDF...',
      btnSel:      'Select stations to generate',
      estacao:     'station',
      estacoes:    'stations',
      dadosEst:    'Establishment data',
      svLabel:     'Open Street View',
      fotoLabel:   'View Photo',
      croquiLabel: 'View Sketch',
      nomeLocal:   'Location',
    },
  };
  const tr = i18nRelat[idiomaRelat] || i18nRelat['pt-BR'];

  // ── Gerar PDF Compacto (tabela estilo planilha) ──────────────
  const gerarPDFCompacto = () => {
    const locale = idiomaRelat === 'pt-BR' ? 'pt-BR' : idiomaRelat === 'es' ? 'es-MX' : 'en-US';
    const tr2 = i18nRelat[idiomaRelat] || i18nRelat['pt-BR'];
    const dataHoje = new Date().toLocaleDateString(locale, { day:'2-digit', month:'long', year:'numeric' });
    const statusCor2: Record<string,string> = {
      APROVADO:'#065f46', SOLICITADO:'#1e40af', INSTALADO:'#4c1d95', REPROVADO:'#991b1b', CANCELADO:'#374151',
      ATIVO:'#15803d', PLANEJADO:'#0369a1', NEGOCIACAO:'#92400e'
    };
    const statusBg2: Record<string,string> = {
      APROVADO:'#d1fae5', SOLICITADO:'#dbeafe', INSTALADO:'#ede9fe', REPROVADO:'#fee2e2', CANCELADO:'#f3f4f6',
      ATIVO:'#dcfce7', PLANEJADO:'#e0f2fe', NEGOCIACAO:'#fef3c7'
    };

    // Colunas respeitam campos selecionados na UI
    const mostrarFoto      = campos.includes('foto');
    const mostrarEndereco  = campos.includes('endereco');
    const mostrarBairro    = campos.includes('bairro') || campos.includes('endereco');
    const mostrarStatus    = campos.includes('status');
    const mostrarSV        = campos.includes('streetView');

    const fmtD = (ts: any) => {
      if (!ts) return '';
      try {
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString(locale, { day:'2-digit', month:'2-digit', year:'numeric' });
      } catch { return ''; }
    };

    const rows = estRelatorio.map((e, i) => {
      const priv   = (e as any).privado || {};
      const nome   = priv.nomeLocal || (e as any).endereco || e.codigo || (tr2.nomeLocal + ' #' + (i+1));
      const end    = (e as any).endereco || '';
      const bairro = (e as any).bairro  || '';
      const fotoUrl = (e as any).imagens?.foto || (e as any).foto_url
        || (e as any).fotoUrl || (e as any).foto1_url || '';
      const svUrl   = (e as any).imagens?.streetView || (e as any).street_view_url
        || (e as any).streetViewUrl || (e as any).sv_url || (e as any).svUrl || '';
      const sBg  = statusBg2[e.status] || '#f3f4f6';
      const sCor = statusCor2[e.status] || '#374151';
      const bgRow = i % 2 === 0 ? '#ffffff' : '#f9fafb';

      // Foto miniatura — object-fit:cover, fallback simples
      const fotoHtml = fotoUrl
        ? '<a href="' + fotoUrl + '" target="_blank" style="display:block;width:72px;height:60px;border-radius:4px;border:1px solid #e5e7eb;background:#f3f4f6;overflow:hidden">'
          + '<img src="' + fotoUrl + '" width="72" height="60" style="object-fit:cover;object-position:top center;display:block;width:72px;height:60px" /></a>'
        : '<span style="color:#d1d5db;font-size:18px">—</span>';

      const svHtml = svUrl
        ? '<a href="' + svUrl + '" target="_blank" style="color:#1a73e8;text-decoration:none;font-size:9px;font-weight:600;white-space:nowrap">🌐 ' + tr2.svLabel + '</a>'
        : '<span style="color:#d1d5db">—</span>';

      const croquiUrl = (e as any).imagens?.croqui || (e as any).croqui_url || (e as any).croquiUrl || '';
      const croquiHtml = croquiUrl
        ? '<a href="' + croquiUrl + '" target="_blank" style="color:#1a73e8;text-decoration:none;font-size:9px;font-weight:600;white-space:nowrap">📐 ' + tr2.croquiLabel + '</a>'
        : '<span style="color:#d1d5db">—</span>';

      const latStr = e.lat != null ? String(Number(e.lat).toFixed(6)) : '—';
      const lngStr = e.lng != null ? String(Number(e.lng).toFixed(6)) : '—';

      let row = '<tr style="background:' + bgRow + ';page-break-inside:avoid">';
      row += '<td style="padding:5px 6px;text-align:center;font-size:10px;font-weight:700;color:#9ca3af;white-space:nowrap">' + String(i+1).padStart(2,'0') + '</td>';
      if (mostrarFoto)      row += '<td style="padding:4px;width:84px;text-align:center">' + fotoHtml + '</td>';
      row += '<td style="padding:5px 6px;font-size:10px;font-weight:600;color:#111;word-break:break-word;min-width:120px">' + nome + '</td>';
      if (mostrarEndereco)  row += '<td style="padding:5px 6px;font-size:10px;color:#374151;word-break:break-word;min-width:140px">' + end + '</td>';
      if (mostrarBairro)    row += '<td style="padding:5px 6px;font-size:10px;color:#374151;word-break:break-word;min-width:80px">' + bairro + '</td>';
      if (mostrarStatus)    row += '<td style="padding:5px 6px;text-align:center"><span style="background:' + sBg + ';color:' + sCor + ';padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;white-space:nowrap">' + e.status + '</span></td>';
      row += '<td style="padding:5px 6px;font-size:10px;color:#374151;white-space:nowrap">' + latStr + '</td>';
      row += '<td style="padding:5px 6px;font-size:10px;color:#374151;white-space:nowrap">' + lngStr + '</td>';
      if (mostrarSV)        row += '<td style="padding:5px 6px;text-align:center">' + svHtml + '</td>';
      row += '<td style="padding:5px 6px;text-align:center">' + croquiHtml + '</td>';
      row += '</tr>';
      return row;
    }).join('');

    let thead = '<tr style="background:#1e3a5f;color:#fff">';
    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">#</th>';
    if (mostrarFoto)      thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">📷</th>';
    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase;text-align:left">' + tr2.nomeLocal + '</th>';
    if (mostrarEndereco)  thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase;text-align:left">' + tr2.endereco + '</th>';
    if (mostrarBairro)    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase;text-align:left">' + tr2.bairro + '</th>';
    if (mostrarStatus)    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">' + tr2.status + '</th>';
    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">Lat</th>';
    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">Lng</th>';
    if (mostrarSV)        thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">Street View</th>';
    thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">' + tr2.croquiLabel + '</th>';
    thead += '</tr>';

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
      + '<title>' + tr2.titulo + ' — ' + cidade + '</title>'
      + '<style>'
      + '*{box-sizing:border-box}'
      + 'body{font-family:Arial,sans-serif;color:#111;padding:16px;margin:0;font-size:11px}'
      + 'h1{font-size:18px;font-weight:700;text-align:center;margin:0 0 3px}'
      + '.sub{text-align:center;color:#6b7280;font-size:11px;margin-bottom:14px}'
      + 'table{width:100%;border-collapse:collapse}'
      + 'td,th{border:1px solid #e5e7eb;vertical-align:middle}'
      + 'tr{page-break-inside:avoid}'
      + '.foot{text-align:center;font-size:9px;color:#9ca3af;margin-top:14px}'
      + '.printbar{position:fixed;top:10px;right:10px;z-index:9999}'
      + '@media print{.printbar{display:none}body{padding:8px}}'
      + '</style></head><body>'
      + '<div class="printbar"><button onclick="window.print()" style="padding:8px 18px;background:#1a6fd4;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)">🖨 Imprimir / Salvar PDF</button></div>'
      + '<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px">'
      + JET_LOGO_SVG
      + '<div><h1 style="margin:0">' + tr2.titulo.toUpperCase() + '</h1>'
      + '<p class="sub" style="margin:0">' + cidade + ' | ' + dataHoje
        + ' | ' + estRelatorio.length + ' ' + (estRelatorio.length === 1 ? tr2.estacao : tr2.estacoes) + '</p></div></div>'
      + '<table><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table>'
      + '<p class="foot">' + tr2.rodape + ' | ' + new Date().getFullYear() + '</p>'
      + '</body></html>';

    abrirJanelaImpressao(html, tr2.titulo + ' — ' + cidade + ' — Compacto');
    setGerando(false);
  }

  // ── Gerar PDF — Normal ou Compacto ──────────────────────────
  const gerarPDF = () => {
    if (estRelatorio.length === 0) return;
    setGerando(true);
    if (modoRelat === 'compacto') { gerarPDFCompacto(); return; }

    const locale = idiomaRelat === 'pt-BR' ? 'pt-BR' : idiomaRelat === 'es' ? 'es-MX' : 'en-US';
    const dataHoje = new Date().toLocaleDateString(locale, {
      day: '2-digit', month: 'long', year: 'numeric'
    });

    // Campos ativos — usados para construir a tabela de dados de cada card
    const camposAtivos = CAMPOS_RELATORIO.filter(c => campos.includes(c.key));

    const statusCor: Record<string,string> = {
      APROVADO:'#065f46', SOLICITADO:'#1e40af', INSTALADO:'#4c1d95',
      REPROVADO:'#991b1b', CANCELADO:'#374151',
      ATIVO:'#15803d', PLANEJADO:'#0369a1', NEGOCIACAO:'#92400e'
    };
    const statusBg: Record<string,string> = {
      APROVADO:'#d1fae5', SOLICITADO:'#dbeafe', INSTALADO:'#ede9fe',
      REPROVADO:'#fee2e2', CANCELADO:'#f3f4f6',
      ATIVO:'#dcfce7', PLANEJADO:'#e0f2fe', NEGOCIACAO:'#fef3c7'
    };

    const cards = estRelatorio.map((e, i) => {
      const priv      = (e as any).privado || {};
      const nomeLocal = priv.nomeLocal || (e as any).endereco || e.codigo || ('Estação #' + (i+1));
      // Street View — procura em todos os campos possíveis
      const svUrl = (e as any).imagens?.streetView
        || (e as any).street_view_url
        || (e as any).streetViewUrl
        || (e as any).sv_url
        || '';
      const fotoUrl = (e as any).imagens?.foto
        || (e as any).foto_url
        || (e as any).fotoUrl
        || '';
      // Exibe SV como imagem se for URL da Static API, senão como link
      const svIsImg = svUrl.includes('maps.googleapis.com/maps/api/streetview')
        || svUrl.includes('streetviewpixels');
      const fotos = [svIsImg ? svUrl : '', fotoUrl].filter(Boolean);
      // URL do SV para link clicável no campo operacional
      const svLinkUrl = svUrl;

      // fotos processadas abaixo após separar thumb e extras

      // Separa campos em grupos para o PDF
      const grupoIdent    = camposAtivos.filter(c => ['codigo','criadoEm','consultor','status','tipo','larguraFaixa'].includes(c.key));
      const grupoLoc      = camposAtivos.filter(c => ['endereco','lat','lng'].includes(c.key));
      const grupoPriv     = camposAtivos.filter(c => c.key.startsWith('privado.'));
      const grupoOp       = camposAtivos.filter(c => ['operador','ia_aprovado','ia_score','croqui','foto','streetView'].includes(c.key));

      const renderLinhas = (lista: CampoRelatorio[]) =>
        lista.map(c => {
          const v = getValRelatorio(e, c.key);
          if (!v) return '';
          const isLink = c.key === 'croqui' || c.key === 'foto' || c.key === 'streetView';
          let cell = '';
          if (c.key === 'streetView' && v) {
            // Street View: botão estilo profissional abrindo Google Maps
            cell = '<a href="' + v + '" target="_blank" '
              + 'style="display:inline-flex;align-items:center;gap:5px;'
              + 'background:#1a73e8;color:#fff;text-decoration:none;'
              + 'padding:5px 12px;border-radius:6px;font-size:10px;font-weight:600">'
              + '🌐 ' + tr.svLabel
              + '</a>';
          } else if (c.key === 'foto' && v) {
            cell = '<a href="' + v + '" target="_blank" '
              + 'style="display:inline-flex;align-items:center;gap:5px;'
              + 'background:#16a34a;color:#fff;text-decoration:none;'
              + 'padding:5px 12px;border-radius:6px;font-size:10px;font-weight:600">'
              + '📷 ' + tr.fotoLabel
              + '</a>';
          } else if (c.key === 'croqui' && v) {
            cell = '<a href="' + v + '" target="_blank" '
              + 'style="display:inline-flex;align-items:center;gap:5px;'
              + 'background:#7c3aed;color:#fff;text-decoration:none;'
              + 'padding:5px 12px;border-radius:6px;font-size:10px;font-weight:600">'
              + '📐 ' + tr.croquiLabel
              + '</a>';
          } else if (isLink && v) {
            cell = '<a href="' + v + '" target="_blank" '
              + 'style="color:#1d4ed8;font-size:10px">Ver ↗</a>';
          } else {
            cell = '<span style="font-size:11px">' + v + '</span>';
          }
          return '<tr style="border-bottom:1px solid #f3f4f6"><td style="color:#9ca3af;font-size:9px;padding:4px 8px 4px 0;width:40%;white-space:nowrap">' + c.label.toUpperCase() + '</td><td style="padding:4px 0;font-size:11px">' + cell + '</td></tr>';
        }).join('');

      // Foto principal (primeira foto disponível)
      const fotoThumb = fotos[0] || '';
      const fotosExtras = fotos.slice(1);

      const fotosExtrasHtml = fotosExtras.length
        ? '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
            fotosExtras.map((u: string) =>
              '<img src="' + u + '" style="flex:1;min-width:200px;max-width:48%;max-height:420px;object-fit:contain;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb"/>'
            ).join('') +
          '</div>'
        : '';

      return '<div style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:24px;overflow:hidden;page-break-inside:avoid;break-inside:avoid">' +
        // Cabeçalho
        '<div style="background:' + (e.tipo === 'PRIVADA' ? '#1e3a5f' : '#1a3a2e') + ';padding:12px 16px;display:flex;justify-content:space-between;align-items:center">' +
          '<div style="color:#fff;font-size:14px;font-weight:700">#' + String(i+1).padStart(2,'0') + ' ' + nomeLocal + '</div>' +
          '<span style="background:' + (statusBg[e.status] || '#f3f4f6') + ';color:' + (statusCor[e.status] || '#374151') + ';padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">' +
            (e.status === 'APROVADO' ? '✓ APROVADO' : e.status) +
          '</span>' +
        '</div>' +
        // Corpo em 2 colunas
        '<div style="padding:12px 16px">' +
          '<table style="width:100%;border-collapse:collapse">' +
            '<tr>' +
              // Coluna esquerda: endereço + dados do estabelecimento com foto ao lado
              '<td style="width:52%;vertical-align:top;padding-right:16px">' +
                (grupoLoc.length ? '<table style="width:100%;border-collapse:collapse;margin-bottom:8px">' + renderLinhas(grupoLoc) + '</table>' : '') +
                (grupoPriv.length ? (
                  '<div style="background:#fff8e6;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:8px">' +
                    '<div style="font-size:9px;color:#92400e;text-transform:uppercase;font-weight:700;margin-bottom:8px">' + tr.dadosEst + '</div>' +
                    // Dados + foto lado a lado dentro da caixa amarela
                    '<table style="width:100%;border-collapse:collapse"><tr>' +
                      '<td style="vertical-align:top;padding-right:10px">' +
                        '<table style="width:100%;border-collapse:collapse">' + renderLinhas(grupoPriv) + '</table>' +
                      '</td>' +
                      (fotoThumb ? (
                        '<td style="vertical-align:top;width:380px;min-width:320px">' +
                          '<img src="' + fotoThumb + '" style="width:100%;height:420px;object-fit:contain;background:#f8f9fa;border-radius:8px;border:1px solid #fde68a;display:block"/>' +
                        '</td>'
                      ) : '') +
                    '</tr></table>' +
                  '</div>'
                ) : (
                  // Se não tem dados privados mas tem foto, exibir foto aqui
                  fotoThumb ? '<img src="' + fotoThumb + '" style="width:100%;max-height:420px;object-fit:contain;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:8px"/>' : ''
                )) +
              '</td>' +
              // Coluna direita: código, datas, consultor, operacional
              '<td style="width:48%;vertical-align:top">' +
                (grupoIdent.length ? '<table style="width:100%;border-collapse:collapse;margin-bottom:8px">' + renderLinhas(grupoIdent) + '</table>' : '') +
                (grupoOp.length ? '<table style="width:100%;border-collapse:collapse">' + renderLinhas(grupoOp) + '</table>' : '') +
                // Foto só aparece na coluna esquerda — não duplicar aqui
              '</td>' +
            '</tr>' +
          '</table>' +
          // Fotos extras abaixo
          fotosExtrasHtml +
        '</div>' +
      '</div>';
    }).join('');

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>' + tr.titulo + ' — ' + cidade + '</title>' +
      '<style>' +
        '*{box-sizing:border-box}' +
        'body{font-family:Arial,sans-serif;color:#111;padding:20px;max-width:900px;margin:0 auto;font-size:12px}' +
        'h1{font-size:22px;font-weight:700;text-align:center;margin:0 0 4px}' +
        '.subtitle{text-align:center;color:#6b7280;font-size:12px;margin-bottom:20px}' +
        'hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0}' +
        '.footer{text-align:center;font-size:10px;color:#9ca3af;margin-top:20px}' +
        '.printbar{position:fixed;top:10px;right:10px;z-index:9999}' +
        '@media print{.printbar{display:none}body{padding:12px}.card-est{page-break-inside:avoid;break-inside:avoid}}' +
      '</style></head><body>' +
      '<div class="printbar"><button onclick="window.print()" style="padding:8px 18px;background:#1a6fd4;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)">🖨 Imprimir / Salvar PDF</button></div>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px">' +
      JET_LOGO_SVG +
      '<div><h1 style="margin:0">' + tr.titulo.toUpperCase() + '</h1>' +
      '<p class="subtitle" style="margin:0">JET Scooters — ' + cidade + ' | ' + dataHoje + '</p></div></div>' +
      '<hr/>' +
      cards +
      '<hr/>' +
      '<p class="footer">' + tr.rodape + ' | ' + new Date().getFullYear() + '</p>' +
      '</body></html>';

    abrirJanelaImpressao(html, tr.titulo + ' — ' + cidade);
    setGerando(false);
  };

  const inp: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
    border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.06)',
    color: '#fff', outline: 'none'
  };

  // ── Exportação CSV para suporte JET ────────────────────────
  const exportarSuporteJET = () => {
    if (estFiltradas.length === 0) return;
    const sep    = ';';
    const nl     = String.fromCharCode(10);
    const header = ['latitude','longitude','endereco','link_foto'].join(sep);
    const linhas = estFiltradas.map(e => {
      const lat  = e.lat ? String(e.lat) : "";
      const lng  = e.lng ? String(e.lng) : "";
      const end  = ((e as any).endereco || "").replace(/;/g, ",");
      const foto = (e as any).imagens?.foto || "";
      return [lat, lng, '"' + end + '"', '"' + foto + '"'].join(sep);
    });
    const bom  = "\uFEFF";
    const csv  = bom + [header, ...linhas].join(nl);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = 'JET_suporte_' + cidade.replace(/[^a-zA-Z0-9]/g,'_') + '_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const [abaRel, setAbaRel] = useState<'parceria'|'suporte'>('parceria');

  return (
    <>
      {/* Abas */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 8, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,.08)' }}>
        {([
          { k: 'parceria', l: pick(T.abaPrefeitura) },
          { k: 'suporte',  l: pick(T.abaSuporte) },
        ] as {k:'parceria'|'suporte';l:string}[]).map(a => (
          <button key={a.k} onClick={() => setAbaRel(a.k)} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: abaRel === a.k ? 'rgba(245,158,11,.15)' : 'rgba(255,255,255,.03)',
            color: abaRel === a.k ? '#fbbf24' : 'rgba(255,255,255,.35)',
            borderBottom: abaRel === a.k ? '2px solid #f59e0b' : '2px solid transparent',
          }}>{a.l}</button>
        ))}
      </div>

      {/* ── ABA SUPORTE JET ── */}
      {abaRel === 'suporte' && (
        <SuporteJETPanel
          estacoes={estFiltradas}
          cidade={cidade}
          filtroTipo={filtroTipo}
          setFiltroTipo={setFiltroTipo}
          filtroStatus={filtroStatus}
          setFiltroStatus={setFiltroStatus}
          exportarCSV={exportarSuporteJET}
        />
      )}

      {/* ── ABA PARCERIA (original) ── */}
      {abaRel === 'parceria' && <>

      {/* Header */}
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 12,
        background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)' }}>
        <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 600, marginBottom: 2 }}>
          {pick(T.headerTitulo)} — {cidade}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
          {pick(T.headerSub)}
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {(['TODOS','PRIVADA','PUBLICA','CONCORRENTE'] as const).map(t => (
          <button key={t} onClick={() => { setFiltroTipo(t); setSelecionadas(new Set()); }}
            style={{ ...inp,
              background: filtroTipo === t ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.04)',
              color: filtroTipo === t ? '#fbbf24' : 'rgba(255,255,255,.4)',
              border: `1px solid ${filtroTipo === t ? 'rgba(245,158,11,.4)' : 'rgba(255,255,255,.08)'}`,
              fontWeight: filtroTipo === t ? 700 : 400,
            }}>
            {t === 'TODOS' ? pick(T.todos) : t === 'PRIVADA' ? pick(T.privadas) : t === 'PUBLICA' ? pick(T.publicas) : pick(T.concorrentes)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['TODOS','ATIVO','PLANEJADO','NEGOCIACAO','SOLICITADO','APROVADO','INSTALADO','REPROVADO','CANCELADO'] as const).map(s => (
          <button key={s} onClick={() => { setFiltroStatus(s); setSelecionadas(new Set()); }}
            style={{ ...inp,
              background: filtroStatus === s ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.04)',
              color: filtroStatus === s ? '#60a5fa' : 'rgba(255,255,255,.4)',
              border: `1px solid ${filtroStatus === s ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.08)'}`,
              fontWeight: filtroStatus === s ? 700 : 400,
            }}>
            {s === 'TODOS' ? pick(T.todosStatus) : s}
          </button>
        ))}
      </div>

      {/* Contador + Selecionar tudo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
          {estFiltradas.length} {pick(T.estacoesCnt)} · <span style={{ color: '#fbbf24', fontWeight: 600 }}>{selecionadas.size} {pick(T.selecionadas)}</span>
        </span>
        <button onClick={toggleTudo} style={{ ...inp, padding: '4px 10px' }}>
          {selecionadas.size === estFiltradas.length && estFiltradas.length > 0 ? pick(T.desmarcarTudo) : pick(T.selecionarTudo)}
        </button>
      </div>

      {/* Lista de estações */}
      <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid rgba(255,255,255,.08)',
        borderRadius: 8, marginBottom: 12 }}>
        {estFiltradas.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>
            {pick(T.nenhumaFiltro)}
          </div>
        ) : estFiltradas.map(e => {
          const sel = selecionadas.has(e.id);
          const priv = e.privado || ({} as any);
          const nome = priv.nomeLocal || e.endereco || e.bairro || e.codigo;
          return (
            <div key={e.id} onClick={() => toggleItem(e.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer',
                background: sel ? 'rgba(245,158,11,.07)' : 'transparent',
                transition: 'background .15s' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                background: sel ? '#f59e0b' : 'rgba(255,255,255,.08)',
                border: `1.5px solid ${sel ? '#f59e0b' : 'rgba(255,255,255,.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {sel && <span style={{ fontSize: 10, color: '#000', fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: sel ? '#fbbf24' : '#dce8ff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nome}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 1 }}>
                  {e.codigo} · {e.bairro}{e.consultor ? ` · 👤 ${e.consultor}` : ''}
                  {fmtData(e.criadoEm) && (
                    <span style={{ marginLeft: 4, color: 'rgba(255,255,255,.2)', fontSize: 9 }}>
                      🕐 {fmtData(e.criadoEm)}
                    </span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, flexShrink: 0,
                background: e.status === 'APROVADO' ? 'rgba(34,197,94,.15)' :
                            e.status === 'SOLICITADO' ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.06)',
                color: e.status === 'APROVADO' ? '#22c55e' :
                       e.status === 'SOLICITADO' ? '#60a5fa' : 'rgba(255,255,255,.4)',
              }}>{e.status}</span>
            </div>
          );
        })}
      </div>

      {/* Toggle campos agrupados */}
      <button onClick={() => setMostrarCampos(v => !v)} style={{ ...inp, width: '100%',
        marginBottom: 8, padding: '7px 10px', textAlign: 'left', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between' }}>
        <span>⚙️ {mostrarCampos ? pick(T.ocultar) : pick(T.configurar)} {pick(T.camposRelat)}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{campos.length} {pick(T.camposAtivos)}</span>
      </button>
      {mostrarCampos && (() => {
        const grupos = Array.from(new Set(CAMPOS_RELATORIO.map(c => c.grupo)));
        return (
          <div style={{ marginBottom: 12, background: 'rgba(255,255,255,.02)', borderRadius: 10,
            border: '1px solid rgba(255,255,255,.07)', overflow: 'hidden' }}>
            {grupos.map(g => (
              <div key={g} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <div style={{ padding: '6px 10px', fontSize: 9, color: 'rgba(255,255,255,.3)',
                  textTransform: 'uppercase', letterSpacing: .6, fontWeight: 600,
                  background: 'rgba(255,255,255,.02)' }}>{labelGrupo(g)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 10px 8px' }}>
                  {CAMPOS_RELATORIO.filter(c => c.grupo === g).map(c => (
                    <button key={c.key} onClick={() => toggle(c.key)} style={{
                      padding: '3px 9px', borderRadius: 16, fontSize: 10, cursor: 'pointer',
                      background: campos.includes(c.key) ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.04)',
                      color: campos.includes(c.key) ? '#60a5fa' : 'rgba(255,255,255,.3)',
                      border: `1px solid ${campos.includes(c.key) ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.07)'}`,
                    }}>{labelCampo(c.key, c.label)}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Seletores de idioma e modo */}
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap', alignItems:'flex-start' }}>
        {/* Idioma */}
        <div style={{ flex:1, minWidth:180 }}>
          <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', marginBottom:4, textTransform:'uppercase', letterSpacing:.6 }}>
            {tr.selIdioma}
          </div>
          <div style={{ display:'flex', gap:5 }}>
            {([['pt-BR','🇧🇷 PT-BR'],['es','🇲🇽 ES'],['en','🇺🇸 EN']] as const).map(([k,l]) => (
              <button key={k} onClick={() => setIdiomaRelat(k)}
                style={{ flex:1, padding:'5px 4px', borderRadius:7, cursor:'pointer', fontSize:10,
                  background: idiomaRelat===k ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.04)',
                  border:`1px solid ${idiomaRelat===k ? 'rgba(59,130,246,.4)' : 'rgba(255,255,255,.08)'}`,
                  color: idiomaRelat===k ? '#60a5fa' : 'rgba(255,255,255,.4)',
                  fontWeight: idiomaRelat===k ? 700 : 400 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {/* Modo */}
        <div style={{ flex:1, minWidth:140 }}>
          <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', marginBottom:4, textTransform:'uppercase', letterSpacing:.6 }}>
            {tr.selModo}
          </div>
          <div style={{ display:'flex', gap:5 }}>
            {([['normal','📄 ' + tr.modoNormal],['compacto','📊 ' + tr.modoCompact]] as const).map(([k,l]) => (
              <button key={k} onClick={() => setModoRelat(k as 'normal'|'compacto')}
                style={{ flex:1, padding:'5px 4px', borderRadius:7, cursor:'pointer', fontSize:10,
                  background: modoRelat===k ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.04)',
                  border:`1px solid ${modoRelat===k ? 'rgba(245,158,11,.4)' : 'rgba(255,255,255,.08)'}`,
                  color: modoRelat===k ? '#fbbf24' : 'rgba(255,255,255,.4)',
                  fontWeight: modoRelat===k ? 700 : 400 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={gerarPDF}
        disabled={gerando || estRelatorio.length === 0}
        style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none',
          cursor: estRelatorio.length === 0 || gerando ? 'not-allowed' : 'pointer',
          background: estRelatorio.length === 0 ? 'rgba(255,255,255,.06)' :
            modoRelat === 'compacto'
              ? 'linear-gradient(135deg,#0ea5e9,#0284c7)'
              : 'linear-gradient(135deg,#f59e0b,#d97706)',
          color: estRelatorio.length === 0 ? 'rgba(255,255,255,.3)' : '#000',
          fontSize: 13, fontWeight: 700,
          opacity: gerando ? .6 : 1,
        }}>
        {gerando ? tr.btnGerando :
          estRelatorio.length === 0 ? tr.btnSel :
          (modoRelat === 'compacto' ? '📊' : '📋') + ' ' + tr.btnGerar + ' (' + estRelatorio.length + ' ' + (estRelatorio.length === 1 ? tr.estacao : tr.estacoes) + ') ⬇'}
      </button>
    </> /* fim aba parceria */}
    </> /* fim RelatorioManager */
  );
}

// ── SUPORTE JET PANEL ────────────────────────────────────────────
// Exporta CSV com lat/lng/endereço + orienta sobre envio de fotos
function SuporteJETPanel({ estacoes, cidade, filtroTipo, setFiltroTipo, filtroStatus, setFiltroStatus, exportarCSV }: {
  estacoes: Estacao[];
  cidade: string;
  filtroTipo: string;
  setFiltroTipo: (v: any) => void;
  filtroStatus: string;
  setFiltroStatus: (v: string) => void;
  exportarCSV: () => void;
}) {
  const { pick } = useLang();
  const T = {
    headerTit: { pt:'📊 Exportação para Suporte JET', en:'📊 Export for JET Support', es:'📊 Exportación para Soporte JET', ru:'📊 Экспорт для поддержки JET' },
    headerDescA: { pt:'Gera o arquivo Excel (.csv) com ', en:'Generates the Excel file (.csv) with ', es:'Genera el archivo Excel (.csv) con ', ru:'Создаёт файл Excel (.csv) с ' },
    headerStrong:{ pt:'latitude, longitude e endereço', en:'latitude, longitude and address', es:'latitud, longitud y dirección', ru:'широтой, долготой и адресом' },
    headerDescB: { pt:', formatado para importação no sistema JET. Cada linha corresponde a uma estação.', en:', formatted for import into the JET system. Each row corresponds to one station.', es:', formateado para importación en el sistema JET. Cada fila corresponde a una estación.', ru:', отформатировано для импорта в систему JET. Каждая строка соответствует одной станции.' },
    todosTipos:  { pt:'Todos tipos', en:'All types', es:'Todos los tipos', ru:'Все типы' },
    privadas:    { pt:'🏢 Privadas', en:'🏢 Private', es:'🏢 Privadas', ru:'🏢 Частные' },
    publicas:    { pt:'🛤 Públicas', en:'🛤 Public', es:'🛤 Públicas', ru:'🛤 Публичные' },
    todosStatus: { pt:'Todos status', en:'All statuses', es:'Todos los estados', ru:'Все статусы' },
    estacoes:    { pt:'Estações', en:'Stations', es:'Estaciones', ru:'Станции' },
    comFoto:     { pt:'Com foto', en:'With photo', es:'Con foto', ru:'С фото' },
    semFoto:     { pt:'Sem foto', en:'No photo', es:'Sin foto', ru:'Без фото' },
    semFotoTxt:  { pt:'✗ sem foto', en:'✗ no photo', es:'✗ sin foto', ru:'✗ нет фото' },
    temFotoTxt:  { pt:'✓ link', en:'✓ link', es:'✓ enlace', ru:'✓ ссылка' },
    linhas:      { pt:'linhas...', en:'rows...', es:'filas...', ru:'строк...' },
    sobreFotosTit:{ pt:'📁 Sobre o envio das fotos', en:'📁 About sending the photos', es:'📁 Sobre el envío de fotos', ru:'📁 Об отправке фотографий' },
    sobreFotosP1a:{ pt:'O JET vincula fotos pelo ', en:'JET links photos by the ', es:'JET vincula fotos por el ', ru:'JET связывает фото по ' },
    sobreFotosStrong:{ pt:'nome do arquivo = endereço da estação', en:'file name = station address', es:'nombre del archivo = dirección de la estación', ru:'имя файла = адрес станции' },
    sobreFotosP1b:{ pt:'. As fotos salvas no sistema já têm URL do Firebase Storage — a coluna ', en:'. Photos saved in the system already have a Firebase Storage URL — the column ', es:'. Las fotos guardadas en el sistema ya tienen URL de Firebase Storage — la columna ', ru:'. Сохранённые в системе фото уже имеют URL Firebase Storage — столбец ' },
    sobreFotosP1c:{ pt:' no CSV aponta diretamente para cada foto.', en:' in the CSV points directly to each photo.', es:' en el CSV apunta directamente a cada foto.', ru:' в CSV указывает напрямую на каждое фото.' },
    paraDrive:   { pt:'Para enviar em pasta no Drive:', en:'To send in a Drive folder:', es:'Para enviar en una carpeta de Drive:', ru:'Чтобы отправить в папке Drive:' },
    passo1a:     { pt:'Baixe as fotos a partir dos links da coluna ', en:'Download the photos from the links in the column ', es:'Descargue las fotos desde los enlaces de la columna ', ru:'Скачайте фото по ссылкам из столбца ' },
    passo2a:     { pt:'Renomeie cada arquivo com o ', en:'Rename each file with the ', es:'Renombre cada archivo con la ', ru:'Переименуйте каждый файл, указав ' },
    passo2strong:{ pt:'endereço completo', en:'full address', es:'dirección completa', ru:'полный адрес' },
    passo2b:     { pt:' da estação correspondente', en:' of the corresponding station', es:' de la estación correspondiente', ru:' соответствующей станции' },
    passo3:      { pt:'Suba a pasta para o Google Drive e compartilhe o link com o suporte JET junto com o CSV', en:'Upload the folder to Google Drive and share the link with JET support along with the CSV', es:'Suba la carpeta a Google Drive y comparta el enlace con el soporte JET junto con el CSV', ru:'Загрузите папку в Google Drive и поделитесь ссылкой со службой поддержки JET вместе с CSV' },
    nenhumaFiltro:{ pt:'Nenhuma estação com esses filtros', en:'No station matches these filters', es:'Ninguna estación con estos filtros', ru:'Нет станций по этим фильтрам' },
    baixarCsv:   { pt:'📥 Baixar CSV', en:'📥 Download CSV', es:'📥 Descargar CSV', ru:'📥 Скачать CSV' },
    estacoesCnt: { pt:'estações', en:'stations', es:'estaciones', ru:'станций' },
    baixar:      { pt:'📷 Baixar', en:'📷 Download', es:'📷 Descargar', ru:'📷 Скачать' },
    fotoSing:    { pt:'foto', en:'photo', es:'foto', ru:'фото' },
    fotoPlur:    { pt:'fotos', en:'photos', es:'fotos', ru:'фото' },
    nomeadas:    { pt:'(nomeadas pelo endereço)', en:'(named by address)', es:'(nombradas por dirección)', ru:'(названы по адресу)' },
    cadaArqA:    { pt:'Cada arquivo será salvo como ', en:'Each file will be saved as ', es:'Cada archivo se guardará como ', ru:'Каждый файл будет сохранён как ' },
    cadaArqB:    { pt:' — pronto para enviar ao suporte JET', en:' — ready to send to JET support', es:' — listo para enviar al soporte JET', ru:' — готов к отправке в поддержку JET' },
  };
  const comFoto = estacoes.filter(e => (e as any).imagens?.foto).length;
  const semFoto = estacoes.length - comFoto;

  // Baixa cada foto com nome = endereço da estação
  // Usa fetch + blob para forçar download com nome correto (contorna header Content-Disposition)
  const baixarFotos = async () => {
    const comFotoList = estacoes.filter(e => (e as any).imagens?.foto);
    for (let i = 0; i < comFotoList.length; i++) {
      const e    = comFotoList[i];
      const url  = (e as any).imagens!.foto as string;
      const end  = ((e as any).endereco || e.bairro || e.codigo || String(i+1))
        .replace(/[<>:"/\\|?*]/g, '_')  // remove chars inválidos em nome de arquivo
        .slice(0, 120);                   // limita tamanho
      try {
        const resp = await fetch(url, { mode: 'cors' });
        const blob = await resp.blob();
        const ext  = blob.type.includes('png') ? 'png' : 'jpg';
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = end + '.' + ext;
        a.click();
        URL.revokeObjectURL(objUrl);
        // Pequena pausa para não sobrecarregar o browser
        await new Promise(r => setTimeout(r, 400));
      } catch {
        console.warn('Erro ao baixar foto de:', e.codigo);
      }
    }
  };

  const inp: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
    border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.06)', color: '#fff', outline: 'none',
  };

  return (
    <div>
      {/* Header */}
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 12,
        background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.2)' }}>
        <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600, marginBottom: 4 }}>
          {pick(T.headerTit)}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', lineHeight: 1.5 }}>
          {pick(T.headerDescA)}<strong style={{ color: '#fff' }}>{pick(T.headerStrong)}</strong>{pick(T.headerDescB)}
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['TODOS','PRIVADA','PUBLICA'] as const).map(t => (
          <button key={t} onClick={() => setFiltroTipo(t)} style={{ ...inp,
            background: filtroTipo === t ? 'rgba(59,130,246,.15)' : 'rgba(255,255,255,.04)',
            color: filtroTipo === t ? '#60a5fa' : 'rgba(255,255,255,.4)',
            border: `1px solid ${filtroTipo === t ? 'rgba(59,130,246,.35)' : 'rgba(255,255,255,.08)'}`,
            fontWeight: filtroTipo === t ? 700 : 400,
          }}>{t === 'TODOS' ? pick(T.todosTipos) : t === 'PRIVADA' ? pick(T.privadas) : pick(T.publicas)}</button>
        ))}
        {(['TODOS','SOLICITADO','APROVADO','INSTALADO'] as const).map(s => (
          <button key={s} onClick={() => setFiltroStatus(s)} style={{ ...inp,
            background: filtroStatus === s ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.04)',
            color: filtroStatus === s ? '#22c55e' : 'rgba(255,255,255,.4)',
            border: `1px solid ${filtroStatus === s ? 'rgba(34,197,94,.3)' : 'rgba(255,255,255,.08)'}`,
            fontWeight: filtroStatus === s ? 700 : 400,
          }}>{s === 'TODOS' ? pick(T.todosStatus) : s.charAt(0) + s.slice(1).toLowerCase()}</button>
        ))}
      </div>

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        {[
          { l: pick(T.estacoes), v: estacoes.length, cor: '#60a5fa' },
          { l: pick(T.comFoto),    v: comFoto, cor: '#22c55e' },
          { l: pick(T.semFoto),    v: semFoto, cor: semFoto > 0 ? '#f87171' : '#6b7280' },
        ].map(k => (
          <div key={k.l} style={{ padding: '8px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', marginBottom: 2 }}>{k.l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.cor, fontFamily: "'IBM Plex Mono',monospace" }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Preview das colunas */}
      <div style={{ marginBottom: 14, borderRadius: 8, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,.07)', fontSize: 10 }}>
        <div style={{ background: 'rgba(59,130,246,.12)', padding: '6px 10px',
          display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 1.5fr', gap: 8,
          color: '#60a5fa', fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>
          <span>latitude</span><span>longitude</span><span>endereco</span><span>link_foto</span>
        </div>
        {estacoes.slice(0, 3).map(e => (
          <div key={(e as any).id} style={{ padding: '5px 10px',
            display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 1.5fr', gap: 8,
            borderTop: '1px solid rgba(255,255,255,.05)',
            color: 'rgba(255,255,255,.5)', fontFamily: "'IBM Plex Mono',monospace" }}>
            <span>{e.lat?.toFixed(6)}</span>
            <span>{e.lng?.toFixed(6)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(e as any).endereco || e.bairro || '—'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: (e as any).imagens?.foto ? '#22c55e' : '#f87171' }}>
              {(e as any).imagens?.foto ? pick(T.temFotoTxt) : pick(T.semFotoTxt)}
            </span>
          </div>
        ))}
        {estacoes.length > 3 && (
          <div style={{ padding: '5px 10px', color: 'rgba(255,255,255,.2)', fontSize: 10,
            borderTop: '1px solid rgba(255,255,255,.05)' }}>
            + {estacoes.length - 3} {pick(T.linhas)}
          </div>
        )}
      </div>

      {/* Instruções fotos Drive */}
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 14,
        background: 'rgba(234,179,8,.05)', border: '1px solid rgba(234,179,8,.15)' }}>
        <div style={{ color: '#eab308', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
          {pick(T.sobreFotosTit)}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.7 }}>
          {pick(T.sobreFotosP1a)}<strong style={{ color: '#fff' }}>{pick(T.sobreFotosStrong)}</strong>{pick(T.sobreFotosP1b)}<code style={{ color: '#eab308' }}>link_foto</code>{pick(T.sobreFotosP1c)}<br/><br/>
          {pick(T.paraDrive)}
        </div>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 2 }}>
          <li>{pick(T.passo1a)}<code style={{ color: '#eab308' }}>link_foto</code></li>
          <li>{pick(T.passo2a)}<strong style={{ color: '#fff' }}>{pick(T.passo2strong)}</strong>{pick(T.passo2b)}</li>
          <li>{pick(T.passo3)}</li>
        </ol>
      </div>

      {/* Botões de ação */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* CSV */}
        <button onClick={exportarCSV} disabled={estacoes.length === 0} style={{
          width: '100%', padding: '12px', borderRadius: 10, border: 'none',
          cursor: estacoes.length === 0 ? 'not-allowed' : 'pointer',
          background: estacoes.length === 0
            ? 'rgba(255,255,255,.06)'
            : 'linear-gradient(135deg,#1d4ed8,#2563eb)',
          color: estacoes.length === 0 ? 'rgba(255,255,255,.3)' : '#fff',
          fontSize: 13, fontWeight: 700,
        }}>
          {estacoes.length === 0
            ? pick(T.nenhumaFiltro)
            : `${pick(T.baixarCsv)} (${estacoes.length} ${pick(T.estacoesCnt)})`}
        </button>

        {/* Download fotos automatizado */}
        {comFoto > 0 && (
          <button onClick={baixarFotos} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg,#059669,#10b981)',
            color: '#fff', fontSize: 13, fontWeight: 700,
          }}>
            {pick(T.baixar)} {comFoto} {comFoto > 1 ? pick(T.fotoPlur) : pick(T.fotoSing)} {pick(T.nomeadas)}
          </button>
        )}
        {comFoto > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', textAlign: 'center', marginTop: -4 }}>
            {pick(T.cadaArqA)}<em>endereço.jpg</em>{pick(T.cadaArqB)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── BOTÃO NORMALIZAR ─────────────────────────────────────────────
function ZonasInline({ cidade, pais }: { cidade: string; pais: string }) {
  const { pick } = useLang();
  const T = {
    excluirConfirm:{ pt:'Excluir', en:'Delete', es:'Eliminar', ru:'Удалить' },
    carregando:    { pt:'Carregando zonas...', en:'Loading zones...', es:'Cargando zonas...', ru:'Загрузка зон...' },
    nenhuma:       { pt:'Nenhuma zona cadastrada', en:'No zones registered', es:'Ninguna zona registrada', ru:'Зоны не зарегистрированы' },
    todos:         { pt:'Todos', en:'All', es:'Todos', ru:'Все' },
    ativos:        { pt:'Ativos', en:'Active', es:'Activos', ru:'Активные' },
    inativos:      { pt:'Inativos', en:'Inactive', es:'Inactivos', ru:'Неактивные' },
    semNome:       { pt:'(sem nome)', en:'(no name)', es:'(sin nombre)', ru:'(без названия)' },
    inativaTag:    { pt:'INATIVA', en:'INACTIVE', es:'INACTIVA', ru:'НЕАКТИВНА' },
    vertices:      { pt:'vértices', en:'vertices', es:'vértices', ru:'вершин' },
    desativar:     { pt:'Desativar', en:'Deactivate', es:'Desactivar', ru:'Деактивировать' },
    reativar:      { pt:'Reativar', en:'Reactivate', es:'Reactivar', ru:'Активировать' },
  };
  const filtroLabels: Record<'todos'|'ativos'|'inativos', TL> = { todos: T.todos, ativos: T.ativos, inativos: T.inativos };
  const [zonas, setZonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'todos'|'ativos'|'inativos'>('todos');

  useEffect(() => {
    if (!cidade) return;
    import('firebase/firestore').then(({ getDocs, collection, query, where, updateDoc, doc, deleteDoc }) => {
      getDocs(query(collection(db, 'poligonos'), where('cidade', 'in', [cidade]))).then(snap => {
        setZonas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      });
    });
  }, [cidade]);

  const toggle = async (zona: any) => {
    const { doc: fDoc, updateDoc: fUpd } = await import('firebase/firestore');
    await fUpd(fDoc(db, 'poligonos', zona.id), { ativo: !zona.ativo, atualizadoEm: new Date() });
    setZonas(prev => prev.map(z => z.id === zona.id ? { ...z, ativo: !zona.ativo } : z));
  };

  const excluir = async (zona: any) => {
    if (!confirm(`${pick(T.excluirConfirm)} "${zona.nome}"?`)) return;
    const { doc: fDoc, deleteDoc: fDel } = await import('firebase/firestore');
    await fDel(fDoc(db, 'poligonos', zona.id));
    setZonas(prev => prev.filter(z => z.id !== zona.id));
  };

  const filtradas = zonas.filter(z =>
    filtro === 'todos' ? true : filtro === 'ativos' ? z.ativo !== false : z.ativo === false
  ).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  if (loading) return <div style={{ padding: 12, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{pick(T.carregando)}</div>;
  if (!zonas.length) return <div style={{ padding: 12, fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>{pick(T.nenhuma)}</div>;

  return (
    <div>
      {/* Filtro */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
        {(['todos','ativos','inativos'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            flex: 1, padding: '4px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600,
            background: filtro === f ? 'rgba(99,102,241,.2)' : 'rgba(255,255,255,.04)',
            color: filtro === f ? '#818cf8' : 'rgba(255,255,255,.35)',
            outline: filtro === f ? '1px solid rgba(99,102,241,.3)' : '1px solid rgba(255,255,255,.08)',
          }}>{pick(filtroLabels[f])} {f==='todos'?`(${zonas.length})`:f==='ativos'?`(${zonas.filter(z=>z.ativo!==false).length})`:`(${zonas.filter(z=>z.ativo===false).length})`}</button>
        ))}
      </div>

      {/* Lista */}
      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {filtradas.map(z => (
          <div key={z.id} style={{
            padding: '8px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,.03)',
            border: `1px solid ${z.ativo !== false ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.03)'}`,
            opacity: z.ativo !== false ? 1 : 0.55,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: z.cor || '#2563eb', flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#dce8ff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {z.nome || pick(T.semNome)}
              </div>
              {z.ativo === false && (
                <span style={{ fontSize: 8, background: 'rgba(239,68,68,.15)', color: '#f87171',
                  border: '1px solid rgba(239,68,68,.2)', borderRadius: 4, padding: '1px 4px' }}>{pick(T.inativaTag)}</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginBottom: 4 }}>
              {z.grupo} · {z.fase} · {z.poligono?.length || 0} {pick(T.vertices)}
              {(z.criadoEm || z.importadoEm) && (
                <span style={{ marginLeft: 6, color: 'rgba(255,255,255,.2)' }}>
                  · 📅 {(() => { try { const dt = z.importadoEm || (z.criadoEm?.toDate ? z.criadoEm.toDate() : z.criadoEm); return new Date(dt).toLocaleDateString('pt-BR'); } catch { return ''; } })()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => toggle(z)} style={{
                flex: 1, padding: '4px 6px', borderRadius: 5, border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600,
                background: z.ativo !== false ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)',
                color: z.ativo !== false ? '#f87171' : '#6ee7b7',
              }}>{z.ativo !== false ? pick(T.desativar) : pick(T.reativar)}</button>
              <button onClick={() => excluir(z)} style={{
                padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,.2)',
                background: 'rgba(239,68,68,.06)', color: '#f87171', cursor: 'pointer', fontSize: 10,
              }}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NORMALIZAR (client-side via Nominatim) ────────────────────────
function NormalizarBtn({ cidade, pais, onDone }: { cidade: string; pais: string; onDone: () => void }) {
  const { pick } = useLang();
  const T = {
    confirmA: { pt:'Normalizar bairro/endereço via Nominatim em', en:'Normalize neighborhood/address via Nominatim in', es:'Normalizar barrio/dirección vía Nominatim en', ru:'Нормализовать район/адрес через Nominatim в' },
    confirmB: { pt:'Processa estações sem bairro, 1 por vez (limite da API gratuita).\nPode levar vários minutos.', en:'Processes stations without a neighborhood, 1 at a time (free API limit).\nMay take several minutes.', es:'Procesa estaciones sin barrio, 1 a la vez (límite de la API gratuita).\nPuede tardar varios minutos.', ru:'Обрабатывает станции без района, по одной (лимит бесплатного API).\nМожет занять несколько минут.' },
    buscando: { pt:'Buscando estações sem bairro...', en:'Searching stations without a neighborhood...', es:'Buscando estaciones sin barrio...', ru:'Поиск станций без района...' },
    semBairro:{ pt:'estações sem bairro/endereço', en:'stations without neighborhood/address', es:'estaciones sin barrio/dirección', ru:'станций без района/адреса' },
    concluido:{ pt:'✓ Concluído:', en:'✓ Done:', es:'✓ Completado:', ru:'✓ Готово:' },
    normalizados:{ pt:'normalizados', en:'normalized', es:'normalizados', ru:'нормализовано' },
    rodando:  { pt:'● Rodando...', en:'● Running...', es:'● Ejecutando...', ru:'● Выполняется...' },
    concluidoTag:{ pt:'✓ Concluído', en:'✓ Done', es:'✓ Completado', ru:'✓ Готово' },
    novamente:{ pt:'↻ Normalizar novamente', en:'↻ Normalize again', es:'↻ Normalizar de nuevo', ru:'↻ Нормализовать снова' },
    normalizar:{ pt:'🔧 Normalizar dados faltantes', en:'🔧 Normalize missing data', es:'🔧 Normalizar datos faltantes', ru:'🔧 Нормализовать недостающие данные' },
    parar:    { pt:'⏹ Parar', en:'⏹ Stop', es:'⏹ Detener', ru:'⏹ Стоп' },
  };
  const [rodando,   setRodando]   = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [log,       setLog]       = useState<string[]>([]);
  const [prog,      setProg]      = useState({ normalizados: 0, restantes: 0 });
  const abortRef = useRef(false);

  const iniciar = async () => {
    if (!confirm(`${pick(T.confirmA)} ${cidade}?\n\n${pick(T.confirmB)}`)) return;
    setRodando(true); setConcluido(false); abortRef.current = false;
    setLog([pick(T.buscando)]);

    const { getDocs, collection, query, where, doc, updateDoc } = await import('firebase/firestore');
    const snap = await getDocs(query(
      collection(db, 'estacoes'),
      where('cidade', '==', cidade)
    ));

    const semBairro = snap.docs.filter(d => !d.data().bairro || !d.data().endereco);
    setProg({ normalizados: 0, restantes: semBairro.length });
    setLog([`${semBairro.length} ${pick(T.semBairro)}`]);

    let ok = 0;
    for (let i = 0; i < semBairro.length && !abortRef.current; i++) {
      const docSnap = semBairro[i];
      const { lat, lng } = docSnap.data();
      if (!lat || !lng) continue;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt-BR`, {
          headers: { 'User-Agent': 'JetOS/1.0' }
        });
        const data = await r.json();
        const addr = data.address || {};
        const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.district || '';
        const endereco = [addr.road, addr.house_number].filter(Boolean).join(', ') || data.display_name?.split(',')[0] || '';
        if (bairro || endereco) {
          await updateDoc(doc(db, 'estacoes', docSnap.id), {
            ...(bairro   ? { bairro }   : {}),
            ...(endereco ? { endereco } : {}),
          });
          ok++;
          setProg({ normalizados: ok, restantes: semBairro.length - i - 1 });
          setLog(prev => [...prev, `✓ ${docSnap.data().codigo || docSnap.id}: ${bairro || endereco}`]);
        }
        // Respeita limite Nominatim: 1 req/seg
        await new Promise(res => setTimeout(res, 1100));
      } catch (e: any) {
        setLog(prev => [...prev, `✗ ${docSnap.id}: ${e.message}`]);
      }
    }
    setRodando(false); setConcluido(true);
    setLog(prev => [...prev, `${pick(T.concluido)} ${ok} ${pick(T.normalizados)}`]);
    if (ok > 0) onDone();
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {(rodando || concluido) && (
        <div style={{ padding: 10, borderRadius: 8, marginBottom: 8,
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
              ✓ {prog.normalizados} · ⏳ {prog.restantes}
            </span>
            {rodando
              ? <span style={{ fontSize: 10, color: '#fbbf24' }}>{pick(T.rodando)}</span>
              : <span style={{ fontSize: 10, color: '#6ee7b7' }}>{pick(T.concluidoTag)}</span>
            }
          </div>
          <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 10,
            color: 'rgba(255,255,255,.4)', fontFamily: 'monospace' }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {!rodando ? (
          <button onClick={iniciar} style={{
            flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(96,165,250,.08)', border: '1px solid rgba(96,165,250,.2)',
            color: '#60a5fa', fontSize: 12, fontWeight: 600
          }}>
            {concluido ? pick(T.novamente) : pick(T.normalizar)}
          </button>
        ) : (
          <button onClick={() => abortRef.current = true} style={{
            flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
            color: '#f87171', fontSize: 12, fontWeight: 600
          }}>{pick(T.parar)}</button>
        )}
      </div>
    </div>
  );
}

function AbaCroquisLote({ cidade, pais, total, estacoes }: {
  cidade: string; pais: string; total: number; estacoes: Estacao[];
}) {
  const { pick } = useLang();
  const T = {
    nenhumaProc: { pt:'Nenhuma estação para processar com os filtros selecionados.', en:'No station to process with the selected filters.', es:'Ninguna estación para procesar con los filtros seleccionados.', ru:'Нет станций для обработки с выбранными фильтрами.' },
    avisoPular:  { pt:'estações sem foto serão puladas.', en:'stations without a photo will be skipped.', es:'estaciones sin foto serán omitidas.', ru:'станций без фото будут пропущены.' },
    avisoPlace:  { pt:'estações sem foto usarão imagem placeholder.', en:'stations without a photo will use a placeholder image.', es:'estaciones sin foto usarán imagen de marcador.', ru:'станций без фото будут использовать изображение-заполнитель.' },
    confirmGerarA:{ pt:'Gerar', en:'Generate', es:'Generar', ru:'Сгенерировать' },
    confirmGerarB:{ pt:'croquis em', en:'sketches in', es:'croquis en', ru:'эскизов в' },
    confirmMin:  { pt:'Pode levar vários minutos.', en:'May take several minutes.', es:'Puede tardar varios minutos.', ru:'Может занять несколько минут.' },
    iniciando:   { pt:'Iniciando...', en:'Starting...', es:'Iniciando...', ru:'Запуск...' },
    estacoes:    { pt:'estações', en:'stations', es:'estaciones', ru:'станций' },
    loteA:       { pt:'Lote: +', en:'Batch: +', es:'Lote: +', ru:'Партия: +' },
    loteGerados: { pt:'gerados ·', en:'generated ·', es:'generados ·', ru:'сгенерировано ·' },
    loteErros:   { pt:'erros ·', en:'errors ·', es:'errores ·', ru:'ошибок ·' },
    loteRest:    { pt:'restantes', en:'remaining', es:'restantes', ru:'осталось' },
    erro:        { pt:'Erro:', en:'Error:', es:'Error:', ru:'Ошибка:' },
    concluidoA:  { pt:'✓ Concluído:', en:'✓ Done:', es:'✓ Completado:', ru:'✓ Готово:' },
    concluidoGer:{ pt:'gerados,', en:'generated,', es:'generados,', ru:'сгенерировано,' },
    concluidoErr:{ pt:'erros', en:'errors', es:'errores', ru:'ошибок' },
    croquisTit:  { pt:'Croquis', en:'Sketches', es:'Croquis', ru:'Эскизы' },
    cardTotal:   { pt:'Total', en:'Total', es:'Total', ru:'Всего' },
    cardGerados: { pt:'Gerados', en:'Generated', es:'Generados', ru:'Сгенерировано' },
    cardPend:    { pt:'Pendentes', en:'Pending', es:'Pendientes', ru:'Ожидают' },
    rodando:     { pt:'● Rodando...', en:'● Running...', es:'● Ejecutando...', ru:'● Выполняется...' },
    concluidoTag:{ pt:'✓ Concluído', en:'✓ Done', es:'✓ Completado', ru:'✓ Готово' },
    configLote:  { pt:'Configurar lote', en:'Configure batch', es:'Configurar lote', ru:'Настроить партию' },
    modoTodos:   { pt:'Todos pendentes', en:'All pending', es:'Todos pendientes', ru:'Все ожидающие' },
    modoBairro:  { pt:'Por bairro', en:'By neighborhood', es:'Por barrio', ru:'По району' },
    modoSemFoto: { pt:'Sem foto', en:'No photo', es:'Sin foto', ru:'Без фото' },
    selBairro:   { pt:'Selecione um bairro...', en:'Select a neighborhood...', es:'Seleccione un barrio...', ru:'Выберите район...' },
    pendentes:   { pt:'pendentes', en:'pending', es:'pendientes', ru:'ожидают' },
    semFotoPerg: { pt:'estações sem foto — o que fazer?', en:'stations without a photo — what to do?', es:'estaciones sin foto — ¿qué hacer?', ru:'станций без фото — что делать?' },
    pularElas:   { pt:'Pular elas', en:'Skip them', es:'Omitirlas', ru:'Пропустить их' },
    usarPlace:   { pt:'Usar placeholder', en:'Use placeholder', es:'Usar marcador', ru:'Использовать заполнитель' },
    seraoProc:   { pt:'estações serão processadas', en:'stations will be processed', es:'estaciones serán procesadas', ru:'станций будет обработано' },
    nenhumaFiltro:{ pt:'Nenhuma estação com esses filtros', en:'No station matches these filters', es:'Ninguna estación con estos filtros', ru:'Нет станций по этим фильтрам' },
    execNovamente:{ pt:'↻ Executar novamente', en:'↻ Run again', es:'↻ Ejecutar de nuevo', ru:'↻ Запустить снова' },
    gerarCroquis:{ pt:'📐 Gerar', en:'📐 Generate', es:'📐 Generar', ru:'📐 Сгенерировать' },
    croquisWord: { pt:'croquis', en:'sketches', es:'croquis', ru:'эскизов' },
    parar:       { pt:'⏹ Parar', en:'⏹ Stop', es:'⏹ Detener', ru:'⏹ Стоп' },
  };
  const semCroqui  = estacoes.filter(e => !e.croquiStatus || e.croquiStatus === 'PENDENTE' || e.croquiStatus === 'ERRO').length;
  const comCroqui  = estacoes.filter(e => e.croquiStatus === 'OK').length;
  const semFoto    = estacoes.filter(e => !e.imagens?.foto && !e.imagens?.streetView).length;

  // Bairros disponíveis
  const bairrosDisp = [...new Set(estacoes
    .filter(e => !e.croquiStatus || e.croquiStatus !== 'OK')
    .map(e => e.bairro).filter(Boolean))].sort() as string[];

  const [rodando,    setRodando]    = useState(false);
  const [progresso,  setProgresso]  = useState({ processados: 0, erros: 0, restantes: semCroqui });
  const [log,        setLog]        = useState<string[]>([]);
  const [concluido,  setConcluido]  = useState(false);
  const [modeLote,   setModeLote]   = useState<'todos'|'bairro'|'semFoto'>('todos');
  const [bairroSel,  setBairroSel]  = useState('');
  const [semFotoMode,setSemFotoMode]= useState<'pular'|'placeholder'>('pular');
  const abortRef = useRef(false);

  const getAlvo = () => {
    if (modeLote === 'bairro' && bairroSel) {
      return estacoes.filter(e => e.bairro === bairroSel && (!e.croquiStatus || e.croquiStatus !== 'OK'));
    }
    if (modeLote === 'semFoto') {
      return estacoes.filter(e => !e.imagens?.foto && !e.imagens?.streetView && (!e.croquiStatus || e.croquiStatus !== 'OK'));
    }
    return estacoes.filter(e => !e.croquiStatus || e.croquiStatus !== 'OK');
  };

  const totalAlvo = getAlvo().length;

  const iniciar = async () => {
    if (!cidade) return;
    const alvo = getAlvo();
    if (!alvo.length) { alert(pick(T.nenhumaProc)); return; }
    const fotoAviso = modeLote !== 'semFoto' && semFotoMode === 'pular'
      ? `\n\n⚠ ${semFoto} ${pick(T.avisoPular)}`
      : modeLote !== 'semFoto' && semFotoMode === 'placeholder'
      ? `\n\n📷 ${semFoto} ${pick(T.avisoPlace)}`
      : '';
    if (!confirm(`${pick(T.confirmGerarA)} ${alvo.length} ${pick(T.confirmGerarB)} ${cidade}?${fotoAviso}\n${pick(T.confirmMin)}`)) return;

    setRodando(true); setConcluido(false); abortRef.current = false;
    setLog([`${pick(T.iniciando)} ${alvo.length} ${pick(T.estacoes)}`]);
    setProgresso({ processados: 0, erros: 0, restantes: alvo.length });

    let totalProcessados = 0; let totalErros = 0; let restantes = alvo.length;

    while (restantes > 0 && !abortRef.current) {
      try {
        const res = await fnGerarCroquisLote()({
          cidade, pais, loteSize: 20,
          bairro: modeLote === 'bairro' ? bairroSel : undefined,
          apenasComFoto: modeLote === 'semFoto' ? false : semFotoMode === 'pular',
          fotoPlaceholder: semFotoMode === 'placeholder',
        });
        const d = (res.data || res) as { ok: boolean; processados: number; erros: number; restantes: number };
        totalProcessados += d.processados || 0;
        totalErros += d.erros || 0;
        restantes = d.restantes ?? 0;
        setProgresso({ processados: totalProcessados, erros: totalErros, restantes });
        setLog(prev => [...prev, `${pick(T.loteA)}${d.processados} ${pick(T.loteGerados)} ${d.erros} ${pick(T.loteErros)} ${restantes} ${pick(T.loteRest)}`]);
        if (restantes === 0 || d.processados === 0) break;
        await new Promise(r => setTimeout(r, 2000));
      } catch(e: unknown) {
        setLog(prev => [...prev, pick(T.erro) + ' ' + (e instanceof Error ? e.message : String(e))]);
        break;
      }
    }
    setRodando(false); setConcluido(true);
    setLog(prev => [...prev, `${pick(T.concluidoA)} ${totalProcessados} ${pick(T.concluidoGer)} ${totalErros} ${pick(T.concluidoErr)}`]);
  };

  const parar = () => { abortRef.current = true; };
  const pct = total > 0 ? Math.round(comCroqui / total * 100) : 0;

  return (
    <>
      {/* Status geral */}
      <div style={{ padding: 14, borderRadius: 10, marginBottom: 12,
        background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#c084fc', fontWeight: 600 }}>{pick(T.croquisTit)} — {cidade}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3 }}>
          <div style={{ height: 6, background: '#a78bfa', borderRadius: 3, width: `${pct}%`, transition: 'width .5s' }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          {[
            { label: pick(T.cardTotal), n: total, cor: '#fff' },
            { label: pick(T.cardGerados), n: comCroqui, cor: '#6ee7b7' },
            { label: pick(T.cardPend), n: semCroqui, cor: '#fbbf24' },
          ].map(item => (
            <div key={item.label} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: item.cor }}>{item.n}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progresso durante execução */}
      {(rodando || concluido) && (
        <div style={{ padding: 12, borderRadius: 8, marginBottom: 12,
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>
              ✓ {progresso.processados} · ✗ {progresso.erros} · ⏳ {progresso.restantes}
            </span>
            {rodando && <span style={{ fontSize: 10, color: '#fbbf24' }}>{pick(T.rodando)}</span>}
            {concluido && <span style={{ fontSize: 10, color: '#6ee7b7' }}>{pick(T.concluidoTag)}</span>}
          </div>
          <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 10,
            color: 'rgba(255,255,255,.4)', fontFamily: 'monospace' }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* Filtros de lote */}
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 12,
        background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: .8, marginBottom: 10 }}>{pick(T.configLote)}</div>

        {/* Modo */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
          {([['todos',pick(T.modoTodos)],['bairro',pick(T.modoBairro)],['semFoto',pick(T.modoSemFoto)]] as const).map(([k,l]) => (
            <button key={k} onClick={() => setModeLote(k)} style={{
              flex: 1, padding: '5px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600,
              background: modeLote === k ? 'rgba(167,139,250,.25)' : 'rgba(255,255,255,.04)',
              color: modeLote === k ? '#c084fc' : 'rgba(255,255,255,.4)',
              outline: modeLote === k ? '1px solid rgba(167,139,250,.4)' : '1px solid rgba(255,255,255,.08)',
            }}>{l}</button>
          ))}
        </div>

        {/* Seletor de bairro */}
        {modeLote === 'bairro' && (
          <select value={bairroSel} onChange={e => setBairroSel(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, marginBottom: 10,
              background: '#111722', border: '1px solid rgba(255,255,255,.1)',
              color: '#dce8ff', fontSize: 12 }}>
            <option value="">{pick(T.selBairro)}</option>
            {bairrosDisp.map(b => (
              <option key={b} value={b}>{b} ({estacoes.filter(e=>e.bairro===b&&(!e.croquiStatus||e.croquiStatus!=='OK')).length} {pick(T.pendentes)})</option>
            ))}
          </select>
        )}

        {/* Tratamento de estações sem foto */}
        {modeLote !== 'semFoto' && (
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginBottom: 6 }}>
              {semFoto} {pick(T.semFotoPerg)}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {([['pular',pick(T.pularElas)],['placeholder',pick(T.usarPlace)]] as const).map(([k,l]) => (
                <button key={k} onClick={() => setSemFotoMode(k)} style={{
                  flex: 1, padding: '5px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600,
                  background: semFotoMode === k ? 'rgba(245,200,66,.15)' : 'rgba(255,255,255,.04)',
                  color: semFotoMode === k ? '#f5c842' : 'rgba(255,255,255,.35)',
                  outline: semFotoMode === k ? '1px solid rgba(245,200,66,.3)' : '1px solid rgba(255,255,255,.08)',
                }}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {/* Total do alvo */}
        <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,.5)', textAlign: 'center' }}>
          {totalAlvo > 0 ? `${totalAlvo} ${pick(T.seraoProc)}` : pick(T.nenhumaFiltro)}
        </div>
      </div>

      {/* Botões */}
      <div style={{ display: 'flex', gap: 8 }}>
        {!rodando ? (
          <button onClick={iniciar} disabled={!semCroqui || !cidade} style={{
            flex: 1, padding: 13, borderRadius: 10,
            background: semCroqui && cidade
              ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
              : 'rgba(255,255,255,.04)',
            border: 'none', color: semCroqui ? '#fff' : 'rgba(255,255,255,.3)',
            fontSize: 13, fontWeight: 600, cursor: semCroqui ? 'pointer' : 'not-allowed'
          }}>
            {concluido ? pick(T.execNovamente) : `${pick(T.gerarCroquis)} ${semCroqui} ${pick(T.croquisWord)}`}
          </button>
        ) : (
          <button onClick={parar} style={{
            flex: 1, padding: 13, borderRadius: 10,
            background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)',
            color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer'
          }}>{pick(T.parar)}</button>
        )}
      </div>
    </>
  );
}

// ── TEMPLATE CSV ─────────────────────────────────────────────────
function baixarTemplate() {
  const campos = [
    // Obrigatórios
    'codigo', 'lat', 'lng',
    // Identificação
    'cidade', 'bairro', 'subprefeitura', 'endereco', 'localizacao',
    // Classificação
    'tipo', 'status', 'pais',
    // Técnicos
    'larguraFaixa', 'capacidade', 'dimensoes', 'areaTotal', 'condicao', 'faixaMinima',
    // TPU
    'tpu',
    // Imagens
    'imagens.foto', 'imagens.streetView', 'imagens.croqui', 'imagens.satelite', 'imagens.mapa',
    // Privado
    'privado.nomeLocal', 'privado.nomeAutorizante', 'privado.cargoAutorizante',
    'privado.telefone', 'privado.email', 'privado.documento', 'privado.dataAutorizacao',
    // Concorrente
    'nomeConcorrente',
    // IA
    'ia.aprovado', 'ia.score', 'ia.largura', 'ia.confianca',
    // Status croqui
    'croquiStatus', 'operador'
  ];

  // Linha de exemplo
  const exemplo = [
    'EST-001', '-23.5614', '-46.6558',
    'São Paulo', 'Pinheiros', 'Pinheiros', 'Rua dos Pinheiros, 100', '-23.5614,-46.6558',
    'PUBLICA', 'APROVADO', 'BR',
    '2.5', '10', '1.25x0.75', '0.94', 'Calçada regular', '1.20',
    'https://link-tpu.com/EST-001',
    'https://drive.google.com/.../foto.jpg', '', '', '', '',
    '', '', '', '', '', '', '',
    '',
    '', '', '', '',
    'PENDENTE', 'campo@empresa.com'
  ];

  const header = campos.join(',');
  const row    = exemplo.map(v => `"${v}"`).join(',');
  const notas  = [
    '# TEMPLATE DE IMPORTAÇÃO — App Estações',
    '# Campos obrigatórios: codigo, lat, lng',
    '# tipo: PUBLICA | PRIVADA | CONCORRENTE',
    '# status: SOLICITADO | APROVADO | REPROVADO | INSTALADO | CANCELADO',
    '# croquiStatus: PENDENTE | OK | ERRO',
    '# Remova esta linha e a de notas antes de importar',
    header,
    row
  ].join('\n');

  const blob = new Blob(['\uFEFF' + notas], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'template_importacao_estacoes.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── ABA EXPORTAR ─────────────────────────────────────────────────
function AbaExportar({ estacoes, cidade, pais, total }: {
  estacoes: Estacao[]; cidade: string; pais: string; total: number;
}) {
  const { pick } = useLang();
  const T = {
    estacoesCampos:{ pt:'campos selecionados', en:'selected fields', es:'campos seleccionados', ru:'выбрано полей' },
    estacoes:    { pt:'estações ·', en:'stations ·', es:'estaciones ·', ru:'станций ·' },
    camposRelat: { pt:'CAMPOS DO RELATÓRIO', en:'REPORT FIELDS', es:'CAMPOS DEL INFORME', ru:'ПОЛЯ ОТЧЁТА' },
    exportarCsv: { pt:'Exportar CSV', en:'Export CSV', es:'Exportar CSV', ru:'Экспорт CSV' },
    csvSub:      { pt:'Excel, Google Sheets ·', en:'Excel, Google Sheets ·', es:'Excel, Google Sheets ·', ru:'Excel, Google Sheets ·' },
    camposWord:  { pt:'campos', en:'fields', es:'campos', ru:'полей' },
    exportarJson:{ pt:'Exportar JSON', en:'Export JSON', es:'Exportar JSON', ru:'Экспорт JSON' },
    jsonSub:     { pt:'Backup completo · todos os campos', en:'Full backup · all fields', es:'Copia completa · todos los campos', ru:'Полная копия · все поля' },
  };
  const grupoLabels: Record<string, TL> = {
    'Identificação':  { pt:'Identificação', en:'Identification', es:'Identificación', ru:'Идентификация' },
    'Classificação':  { pt:'Classificação', en:'Classification', es:'Clasificación', ru:'Классификация' },
    'Localização':    { pt:'Localização', en:'Location', es:'Ubicación', ru:'Местоположение' },
    'Dados técnicos': { pt:'Dados técnicos', en:'Technical data', es:'Datos técnicos', ru:'Технические данные' },
    'Privado':        { pt:'Privado', en:'Private', es:'Privado', ru:'Частное' },
    'IA':             { pt:'IA', en:'AI', es:'IA', ru:'ИИ' },
    'Imagens':        { pt:'Imagens', en:'Images', es:'Imágenes', ru:'Изображения' },
    'Datas':          { pt:'Datas', en:'Dates', es:'Fechas', ru:'Даты' },
  };
  const campoLabels: Record<string, TL> = {
    codigo:        { pt:'Código', en:'Code', es:'Código', ru:'Код' },
    cidade:        { pt:'Cidade', en:'City', es:'Ciudad', ru:'Город' },
    bairro:        { pt:'Bairro', en:'Neighborhood', es:'Barrio', ru:'Район' },
    tipo:          { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
    status:        { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    pais:          { pt:'País', en:'Country', es:'País', ru:'Страна' },
    lat:           { pt:'Latitude', en:'Latitude', es:'Latitud', ru:'Широта' },
    lng:           { pt:'Longitude', en:'Longitude', es:'Longitud', ru:'Долгота' },
    endereco:      { pt:'Endereço', en:'Address', es:'Dirección', ru:'Адрес' },
    larguraFaixa:  { pt:'Largura Faixa (m)', en:'Lane Width (m)', es:'Ancho de Carril (m)', ru:'Ширина полосы (м)' },
    operador:      { pt:'Operador', en:'Operator', es:'Operador', ru:'Оператор' },
    consultor:     { pt:'Consultor campo', en:'Field consultant', es:'Consultor de campo', ru:'Полевой консультант' },
    'privado.nomeLocal':        { pt:'Nome do local', en:'Location name', es:'Nombre del local', ru:'Название места' },
    'privado.nomeAutorizante':  { pt:'Autorizante', en:'Authorizer', es:'Autorizante', ru:'Уполномоченный' },
    'privado.cargoAutorizante': { pt:'Cargo', en:'Position', es:'Cargo', ru:'Должность' },
    'privado.telefone':         { pt:'Telefone parceiro', en:'Partner phone', es:'Teléfono socio', ru:'Телефон партнёра' },
    'privado.email':            { pt:'E-mail parceiro', en:'Partner email', es:'Correo socio', ru:'Эл. почта партнёра' },
    ia_aprovado:   { pt:'IA Aprovado', en:'AI Approved', es:'IA Aprobado', ru:'ИИ одобрено' },
    ia_score:      { pt:'IA Score', en:'AI Score', es:'Puntuación IA', ru:'Оценка ИИ' },
    ia_confianca:  { pt:'IA Confiança', en:'AI Confidence', es:'Confianza IA', ru:'Уверенность ИИ' },
    ia_largura:    { pt:'IA Largura Est.', en:'AI Est. Width', es:'Ancho Est. IA', ru:'Оценка ширины ИИ' },
    croquiStatus:  { pt:'Status Croqui', en:'Sketch Status', es:'Estado Croquis', ru:'Статус эскиза' },
    streetView:    { pt:'URL Street View', en:'Street View URL', es:'URL Street View', ru:'URL Street View' },
    foto:          { pt:'URL Foto', en:'Photo URL', es:'URL Foto', ru:'URL Фото' },
    criadoEm:      { pt:'Data Criação', en:'Creation Date', es:'Fecha de Creación', ru:'Дата создания' },
  };
  const labelGrupo = (g: string) => grupoLabels[g] ? pick(grupoLabels[g]) : g;
  const labelCampo = (k: string, fb: string) => campoLabels[k] ? pick(campoLabels[k]) : fb;
  const defaultCampos = CAMPOS_EXPORT.filter(c => c.default).map(c => c.key);
  const [camposSel, setCamposSel] = useState<string[]>(defaultCampos);

  const grupos: string[] = [...new Set(CAMPOS_EXPORT.map((c: CampoExport) => c.grupo))];

  const toggle = (key: string) =>
    setCamposSel(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const toggleGrupo = (grupo: string) => {
    const keys = CAMPOS_EXPORT.filter(c => c.grupo === grupo).map(c => c.key);
    const todosSel = keys.every(k => camposSel.includes(k));
    setCamposSel(prev => todosSel
      ? prev.filter(k => !keys.includes(k))
      : [...new Set([...prev, ...keys])]
    );
  };

  return (
    <>
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 14,
        background: 'rgba(96,165,250,.06)', border: '1px solid rgba(96,165,250,.15)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600 }}>
            {total} {pick(T.estacoes)} {camposSel.length} {pick(T.estacoesCampos)}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
            {cidade || pais}
          </div>
        </div>
      </div>

      {/* Seletor de campos por grupo */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 700,
          letterSpacing: '.08em', marginBottom: 10 }}>{pick(T.camposRelat)}</div>
        {grupos.map(grupo => (
          <div key={grupo} style={{ marginBottom: 10 }}>
            <div onClick={() => toggleGrupo(grupo)} style={{
              fontSize: 11, color: 'rgba(255,255,255,.5)', fontWeight: 700,
              cursor: 'pointer', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3,
                background: CAMPOS_EXPORT.filter(c=>c.grupo===grupo).every(c=>camposSel.includes(c.key))
                  ? '#307FE2' : 'rgba(255,255,255,.1)',
                border: '1px solid rgba(255,255,255,.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: '#fff'
              }}>
                {CAMPOS_EXPORT.filter(c=>c.grupo===grupo).every(c=>camposSel.includes(c.key)) ? '✓' : ''}
              </div>
              {labelGrupo(grupo)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 20 }}>
              {CAMPOS_EXPORT.filter(c => c.grupo === grupo).map(campo => (
                <button key={campo.key} onClick={() => toggle(campo.key)} style={{
                  padding: '3px 9px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
                  background: camposSel.includes(campo.key) ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${camposSel.includes(campo.key) ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.08)'}`,
                  color: camposSel.includes(campo.key) ? '#60a5fa' : 'rgba(255,255,255,.35)'
                }}>{labelCampo(campo.key, campo.label)}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => baixarCSV(estacoes, cidade || pais, camposSel)}
          disabled={!total || !camposSel.length} style={{
          padding: '13px 16px', borderRadius: 10,
          cursor: total && camposSel.length ? 'pointer' : 'not-allowed',
          background: total ? 'rgba(96,165,250,.1)' : 'rgba(255,255,255,.03)',
          border: `1px solid ${total ? 'rgba(96,165,250,.25)' : 'rgba(255,255,255,.06)'}`,
          color: total ? '#60a5fa' : 'rgba(255,255,255,.2)',
          display: 'flex', alignItems: 'center', gap: 12
        }}>
          <span style={{ fontSize: 22 }}>📊</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{pick(T.exportarCsv)}</div>
            <div style={{ fontSize: 10, opacity: .7 }}>{pick(T.csvSub)} {camposSel.length} {pick(T.camposWord)}</div>
          </div>
        </button>

        <button onClick={() => baixarJSON(estacoes, cidade || pais)}
          disabled={!total} style={{
          padding: '13px 16px', borderRadius: 10,
          cursor: total ? 'pointer' : 'not-allowed',
          background: total ? 'rgba(168,85,247,.1)' : 'rgba(255,255,255,.03)',
          border: `1px solid ${total ? 'rgba(168,85,247,.25)' : 'rgba(255,255,255,.06)'}`,
          color: total ? '#c084fc' : 'rgba(255,255,255,.2)',
          display: 'flex', alignItems: 'center', gap: 12
        }}>
          <span style={{ fontSize: 22 }}>🗂️</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{pick(T.exportarJson)}</div>
            <div style={{ fontSize: 10, opacity: .7 }}>{pick(T.jsonSub)}</div>
          </div>
        </button>
      </div>
    </>
  );
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────────
function AbaDados({ estacoes, cidade, pais, total, isGestor,
  importFile, setImportFile, importando, importResult, importLog, fileRef, handleImportar
}: {
  estacoes: Estacao[]; cidade: string; pais: string; total: number; isGestor: boolean;
  importFile: File|null; setImportFile: (f:File|null)=>void;
  importando: boolean; importResult: any; importLog: string[];
  fileRef: React.RefObject<HTMLInputElement>; handleImportar: ()=>void;
}) {
  const { pick } = useLang();
  const T = {
    estTotal:    { pt:'📍 Estações —', en:'📍 Stations —', es:'📍 Estaciones —', ru:'📍 Станции —' },
    totalWord:   { pt:'total', en:'total', es:'total', ru:'всего' },
    ordenarPor:  { pt:'Ordenar por', en:'Sort by', es:'Ordenar por', ru:'Сортировать по' },
    ordBairro:   { pt:'Bairro', en:'Neighborhood', es:'Barrio', ru:'Район' },
    ordCodigo:   { pt:'Código', en:'Code', es:'Código', ru:'Код' },
    ordStatus:   { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    camposExp:   { pt:'Campos a exportar', en:'Fields to export', es:'Campos a exportar', ru:'Поля для экспорта' },
    selecionados:{ pt:'selecionados', en:'selected', es:'seleccionados', ru:'выбрано' },
    importarFile:{ pt:'⬆ Importar CSV / JSON / XLSX Urent', en:'⬆ Import CSV / JSON / XLSX Urent', es:'⬆ Importar CSV / JSON / XLSX Urent', ru:'⬆ Импорт CSV / JSON / XLSX Urent' },
    xlsxDetTit:  { pt:'📊 XLSX Urent detectado', en:'📊 Urent XLSX detected', es:'📊 XLSX Urent detectado', ru:'📊 Обнаружен XLSX Urent' },
    xlsxIra:     { pt:'A importação irá:', en:'The import will:', es:'La importación va a:', ru:'Импорт выполнит:' },
    xlsx1:       { pt:'✓ Importar estações de qualquer país', en:'✓ Import stations from any country', es:'✓ Importar estaciones de cualquier país', ru:'✓ Импортировать станции из любой страны' },
    xlsx2:       { pt:'✓ Ignorar zonas de restrição e bloqueio', en:'✓ Ignore restriction and block zones', es:'✓ Ignorar zonas de restricción y bloqueo', ru:'✓ Игнорировать зоны ограничений и блокировок' },
    xlsx3:       { pt:'✓ Importar estações inativas como CANCELADO', en:'✓ Import inactive stations as CANCELLED', es:'✓ Importar estaciones inactivas como CANCELADO', ru:'✓ Импортировать неактивные станции как ОТМЕНЕНО' },
    xlsx4:       { pt:'✓ Completar bairro/cidade via geocode reverso', en:'✓ Fill neighborhood/city via reverse geocode', es:'✓ Completar barrio/ciudad vía geocodificación inversa', ru:'✓ Заполнить район/город через обратное геокодирование' },
    xlsx5:       { pt:'⚠ Pode levar alguns minutos (1 req/seg no Nominatim)', en:'⚠ May take a few minutes (1 req/sec on Nominatim)', es:'⚠ Puede tardar unos minutos (1 req/seg en Nominatim)', ru:'⚠ Может занять несколько минут (1 запрос/сек в Nominatim)' },
    importando:  { pt:'Importando...', en:'Importing...', es:'Importando...', ru:'Импорт...' },
    iniciarImp:  { pt:'Iniciar importação', en:'Start import', es:'Iniciar importación', ru:'Начать импорт' },
    zonas:       { pt:'⬡ Zonas', en:'⬡ Zones', es:'⬡ Zonas', ru:'⬡ Зоны' },
    zonasAjudaA: { pt:'Para criar zonas manualmente: ative ⬡ Zonas no mapa e clique em', en:'To create zones manually: enable ⬡ Zones on the map and click', es:'Para crear zonas manualmente: active ⬡ Zonas en el mapa y haga clic en', ru:'Чтобы создать зоны вручную: включите ⬡ Зоны на карте и нажмите' },
    zonasAjudaB: { pt:'no stack de FABs à direita.', en:'in the FAB stack on the right.', es:'en la pila de FABs a la derecha.', ru:'в стопке FAB справа.' },
    exportar:    { pt:'Exportar', en:'Export', es:'Exportar', ru:'Экспорт' },
    importar:    { pt:'Importar', en:'Import', es:'Importar', ru:'Импорт' },
    impProgresso:{ pt:'⏳ Importando...', en:'⏳ Importing...', es:'⏳ Importando...', ru:'⏳ Импорт...' },
    // logs de importação de zonas
    lendoArq:    { pt:'📂 Lendo arquivo...', en:'📂 Reading file...', es:'📂 Leyendo archivo...', ru:'📂 Чтение файла...' },
    semKml:      { pt:'Nenhum .kml encontrado no KMZ', en:'No .kml found in KMZ', es:'Ningún .kml encontrado en el KMZ', ru:'Файл .kml не найден в KMZ' },
    kmzExtraido: { pt:'✅ KMZ extraído:', en:'✅ KMZ extracted:', es:'✅ KMZ extraído:', ru:'✅ KMZ извлечён:' },
    kmlLido:     { pt:'✅ KML lido', en:'✅ KML read', es:'✅ KML leído', ru:'✅ KML прочитан' },
    zonasEnc:    { pt:'zonas encontradas', en:'zones found', es:'zonas encontradas', ru:'зон найдено' },
    zonaImport:  { pt:'Zona importada', en:'Imported zone', es:'Zona importada', ru:'Импортированная зона' },
    pts:         { pt:'pts', en:'pts', es:'pts', ru:'тчк' },
    zonasImportadas:{ pt:'zonas importadas!', en:'zones imported!', es:'zonas importadas!', ru:'зон импортировано!' },
    poligonosEnc:{ pt:'polígonos encontrados', en:'polygons found', es:'polígonos encontrados', ru:'полигонов найдено' },
    zona:        { pt:'Zona', en:'Zone', es:'Zona', ru:'Зона' },
    csvVazio:    { pt:'CSV vazio ou sem dados', en:'Empty CSV or no data', es:'CSV vacío o sin datos', ru:'Пустой CSV или нет данных' },
    linhasLidas: { pt:'linhas lidas', en:'rows read', es:'filas leídas', ru:'строк прочитано' },
    formatoNS:   { pt:'Formato não suportado. Use .kmz, .kml, .geojson ou .csv', en:'Unsupported format. Use .kmz, .kml, .geojson or .csv', es:'Formato no soportado. Use .kmz, .kml, .geojson o .csv', ru:'Неподдерживаемый формат. Используйте .kmz, .kml, .geojson или .csv' },
    erroLog:     { pt:'❌ Erro:', en:'❌ Error:', es:'❌ Error:', ru:'❌ Ошибка:' },
  };
  const ordLabels: Record<'bairro'|'codigo'|'status', TL> = { bairro: T.ordBairro, codigo: T.ordCodigo, status: T.ordStatus };
  const grupoLabels: Record<string, TL> = {
    'ID':      { pt:'ID', en:'ID', es:'ID', ru:'ID' },
    'Local':   { pt:'Local', en:'Location', es:'Ubicación', ru:'Место' },
    'Geo':     { pt:'Geo', en:'Geo', es:'Geo', ru:'Гео' },
    'Técnico': { pt:'Técnico', en:'Technical', es:'Técnico', ru:'Технические' },
    'IA':      { pt:'IA', en:'AI', es:'IA', ru:'ИИ' },
    'Links':   { pt:'Links', en:'Links', es:'Enlaces', ru:'Ссылки' },
    'Datas':   { pt:'Datas', en:'Dates', es:'Fechas', ru:'Даты' },
  };
  const campoLabels: Record<string, TL> = {
    codigo:      { pt:'Código', en:'Code', es:'Código', ru:'Код' },
    tipo:        { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
    status:      { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    endereco:    { pt:'Endereço', en:'Address', es:'Dirección', ru:'Адрес' },
    bairro:      { pt:'Bairro', en:'Neighborhood', es:'Barrio', ru:'Район' },
    cidade:      { pt:'Cidade', en:'City', es:'Ciudad', ru:'Город' },
    pais:        { pt:'País', en:'Country', es:'País', ru:'Страна' },
    lat:         { pt:'Latitude', en:'Latitude', es:'Latitud', ru:'Широта' },
    lng:         { pt:'Longitude', en:'Longitude', es:'Longitud', ru:'Долгота' },
    larguraFaixa:{ pt:'Largura Faixa (m)', en:'Lane Width (m)', es:'Ancho de Carril (m)', ru:'Ширина полосы (м)' },
    ia_score:    { pt:'IA Score', en:'AI Score', es:'Puntuación IA', ru:'Оценка ИИ' },
    ia_aprovado: { pt:'IA Aprovado', en:'AI Approved', es:'IA Aprobado', ru:'ИИ одобрено' },
    link_estacao:{ pt:'Link Estação', en:'Station Link', es:'Enlace Estación', ru:'Ссылка станции' },
    link_croqui: { pt:'Link Croqui', en:'Sketch Link', es:'Enlace Croquis', ru:'Ссылка эскиза' },
    link_foto:   { pt:'Link Foto', en:'Photo Link', es:'Enlace Foto', ru:'Ссылка фото' },
    link_sv:     { pt:'Link Street View', en:'Street View Link', es:'Enlace Street View', ru:'Ссылка Street View' },
    criadoEm:    { pt:'Data Criação', en:'Creation Date', es:'Fecha de Creación', ru:'Дата создания' },
  };
  const labelGrupo = (g: string) => grupoLabels[g] ? pick(grupoLabels[g]) : g;
  const labelCampo = (k: string, fb: string) => campoLabels[k] ? pick(campoLabels[k]) : fb;
  const CAMPOS_EXPORT = [
    { key: 'codigo',       label: 'Código',          grupo: 'ID',       default: true  },
    { key: 'tipo',         label: 'Tipo',             grupo: 'ID',       default: true  },
    { key: 'status',       label: 'Status',           grupo: 'ID',       default: true  },
    { key: 'endereco',     label: 'Endereço',         grupo: 'Local',    default: true  },
    { key: 'bairro',       label: 'Bairro',           grupo: 'Local',    default: true  },
    { key: 'cidade',       label: 'Cidade',           grupo: 'Local',    default: true  },
    { key: 'pais',         label: 'País',             grupo: 'Local',    default: false },
    { key: 'lat',          label: 'Latitude',         grupo: 'Geo',      default: true  },
    { key: 'lng',          label: 'Longitude',        grupo: 'Geo',      default: true  },
    { key: 'larguraFaixa', label: 'Largura Faixa (m)',grupo: 'Técnico',  default: false },
    { key: 'ia_score',     label: 'IA Score',         grupo: 'IA',       default: false },
    { key: 'ia_aprovado',  label: 'IA Aprovado',      grupo: 'IA',       default: false },
    { key: 'link_estacao', label: 'Link Estação',     grupo: 'Links',    default: false },
    { key: 'link_croqui',  label: 'Link Croqui',      grupo: 'Links',    default: true  },
    { key: 'link_foto',    label: 'Link Foto',        grupo: 'Links',    default: false },
    { key: 'link_sv',      label: 'Link Street View', grupo: 'Links',    default: false },
    { key: 'criadoEm',     label: 'Data Criação',     grupo: 'Datas',    default: false },
  ] as { key: string; label: string; grupo: string; default: boolean }[];

  const [camposSel, setCamposSel] = useState<string[]>(
    CAMPOS_EXPORT.filter(c => c.default).map(c => c.key)
  );
  const [ordenarPor, setOrdenarPor] = useState<'bairro'|'codigo'|'status'>('bairro');
  const [showCampos, setShowCampos] = useState(false);

  const grupos = [...new Set(CAMPOS_EXPORT.map(c => c.grupo))];
  const toggleCampo = (k: string) => setCamposSel(p => p.includes(k) ? p.filter(x=>x!==k) : [...p,k]);

  const getValor = (e: Estacao, k: string): string => {
    if (k === 'link_estacao') return e.id ? `https://jet-os-7.web.app/?est=${e.id}` : '';
    if (k === 'link_croqui')  return (e as any).imagens?.croqui || '';
    if (k === 'link_foto')    return (e as any).imagens?.foto || '';
    if (k === 'link_sv')      return (e as any).imagens?.streetView || '';
    if (k === 'ia_score')     return String((e as any).ia?.score || '');
    if (k === 'ia_aprovado')  return String((e as any).ia?.aprovado ?? '');
    if (k === 'criadoEm') {
      const dt = (e as any).criadoEm;
      if (!dt) return '';
      try { return new Date(dt?.toDate ? dt.toDate() : dt).toLocaleDateString('pt-BR'); } catch { return ''; }
    }
    return String((e as any)[k] || '');
  };

  const sortEstacoes = (arr: Estacao[]) => {
    return [...arr].sort((a,b) => {
      const va = getValor(a, ordenarPor), vb = getValor(b, ordenarPor);
      return va.localeCompare(vb, 'pt-BR');
    });
  };

  const exportCSV = () => {
    const sorted = sortEstacoes(estacoes);
    const header = camposSel.map(k => CAMPOS_EXPORT.find(c=>c.key===k)?.label || k).join(',');
    const rows = sorted.map(e => camposSel.map(k => `"${getValor(e,k).replace(/"/g,'""')}"`).join(','));
    const blob = new Blob(['﻿' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `estacoes_${cidade}_${ordenarPor}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const exportJSON = () => {
    const sorted = sortEstacoes(estacoes);
    const data = sorted.map(e => Object.fromEntries(camposSel.map(k => [k, getValor(e,k)])));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `estacoes_${cidade}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const exportPDF = async () => {
    const sorted = sortEstacoes(estacoes);
    const { getDocs, collection, query, where } = await import('firebase/firestore');
    const snap = await getDocs(query(collection(db, 'poligonos'), where('cidade', 'in', [cidade])));
    const zonas = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const headers = camposSel.map(k => CAMPOS_EXPORT.find(c=>c.key===k)?.label||k);
    const rows = sorted.map(e => camposSel.map(k => getValor(e,k)));
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Relatório ${cidade}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#222}
  h1{color:#1a6fd4;font-size:16px;margin:0 0 4px}
  h2{color:#555;font-size:12px;margin:14px 0 6px;border-bottom:1px solid #eee;padding-bottom:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}
  th{background:#1a6fd4;color:#fff;padding:5px 6px;text-align:left}
  td{padding:4px 6px;border-bottom:1px solid #f0f0f0}
  tr:nth-child(even){background:#f9f9f9}
  .badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700}
  .APROVADO{background:#d1fae5;color:#065f46}.SOLICITADO{background:#dbeafe;color:#1e40af}
  .CANCELADO,.REPROVADO{background:#fee2e2;color:#991b1b}
  @media print{button{display:none}}
</style></head><body>
<h1>Relatório — ${cidade}</h1>
<p style="font-size:10px;color:#888">Gerado em ${new Date().toLocaleString('pt-BR')} · ${sorted.length} estações · Ordem: ${ordenarPor}</p>
<h2>Estações</h2>
<table><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr>
${rows.map(r=>`<tr>${r.map((v,i)=>headers[i]==='Status'?`<td><span class="badge ${v}">${v}</span></td>`:`<td>${v}</td>`).join('')}</tr>`).join('')}
</table>
${zonas.length>0?`<h2>Zonas (${zonas.filter(z=>z.ativo!==false).length} ativas de ${zonas.length})</h2>
<table><tr><th>Nome</th><th>Grupo</th><th>Fase</th><th>Vértices</th><th>Status</th></tr>
${zonas.map(z=>`<tr><td>${z.nome||''}</td><td>${z.grupo||''}</td><td>${z.fase||''}</td><td>${z.poligono?.length||0}</td><td>${z.ativo!==false?'Ativa':'Inativa'}</td></tr>`).join('')}
</table>`:''}
</body></html>`;
    const w = window.open('','_blank','width=1000,height=700');
    if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),500); }
  };

  const exportZonas = async (fmt: 'geojson'|'wkt'|'csv') => {
    const { getDocs, collection, query, where } = await import('firebase/firestore');
    const snap = await getDocs(query(collection(db, 'poligonos'), where('cidade', 'in', [cidade])));
    const zonas = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    let content2 = '', fname = '';
    if (fmt === 'geojson') {
      // Close the polygon ring (first point = last point for valid GeoJSON)
      const toRing = (pts: any[]) => {
        if (!pts.length) return [];
        const ring = pts.map((p:any) => [p.lng, p.lat]);
        // Close ring if not already closed
        if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
          ring.push(ring[0]);
        }
        return ring;
      };
      content2 = JSON.stringify({ type:'FeatureCollection', features: zonas.map(z=>({
        type:'Feature',
        properties:{ id:z.id, nome:z.nome||'', grupo:z.grupo||'', fase:z.fase||'',
          cor:z.cor||'', ativo:z.ativo!==false, prioridade:z.prioridade||1 },
        geometry:{ type:'Polygon', coordinates:[toRing(z.poligono||[])] }
      })).filter(f => f.geometry.coordinates[0].length >= 4) },null,2);
      fname = `zonas_${cidade}_${new Date().toISOString().split('T')[0]}.geojson`;
    } else if (fmt==='wkt') {
      const rows = ['WKT,nome,grupo,fase,cor,ativo'];
      zonas.forEach(z=>{
        const pts = (z.poligono||[]);
        if (pts.length < 3) return;
        // Close ring for valid WKT
        const coords = [...pts, pts[0]].map((p:any) => `${p.lng} ${p.lat}`).join(', ');
        rows.push(`"POLYGON ((${coords}))","${z.nome||''}","${z.grupo||''}","${z.fase||''}","${z.cor||''}",${z.ativo!==false}`);
      });
      content2 = rows.join('\n'); fname = `zonas_${cidade}_${new Date().toISOString().split('T')[0]}.wkt.csv`;
    } else {
      const rows = ['nome,grupo,fase,lat,lng,ativo'];
      zonas.forEach(z=>(z.poligono||[]).forEach((p:any)=>rows.push(`"${z.nome||''}","${z.grupo||''}","${z.fase||''}",${p.lat},${p.lng},${z.ativo!==false}`)));
      content2 = rows.join('\n'); fname = `zonas_${cidade}_pontos_${new Date().toISOString().split('T')[0]}.csv`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content2],{type:'text/plain'}));
    a.download = fname; a.click();
  };

  const [importandoZona, setImportandoZona] = useState(false);
  const [importZonaLog, setImportZonaLog] = useState<string[]>([]);
  const importZonaRef = useRef<HTMLInputElement>(null);

  const importarZonas = async (file: File) => {
    setImportandoZona(true);
    setImportZonaLog([pick(T.lendoArq)]);
    const log = (msg: string) => setImportZonaLog(prev => [...prev, msg]);

    try {
      const ext = file.name.toLowerCase();

      // ── KMZ / KML ─────────────────────────────────────────────
      if (ext.endsWith('.kmz') || ext.endsWith('.kml')) {
        let kmlText = '';
        if (ext.endsWith('.kmz')) {
          const zip = await JSZip.loadAsync(file);
          const kmlFile = Object.keys(zip.files).find(n => n.endsWith('.kml'));
          if (!kmlFile) throw new Error(pick(T.semKml));
          kmlText = await zip.files[kmlFile].async('text');
          log(`${pick(T.kmzExtraido)} ${kmlFile}`);
        } else {
          kmlText = await file.text();
          log(pick(T.kmlLido));
        }
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
        const placemarks = Array.from(kmlDoc.querySelectorAll('Placemark'));
        const zonasPMs  = placemarks.filter(pm => pm.querySelector('Polygon'));
        log(`📍 ${zonasPMs.length} ${pick(T.zonasEnc)}`);

        const styles: Record<string, string> = {};
        kmlDoc.querySelectorAll('Style').forEach(s => {
          const id = s.getAttribute('id') ?? '';
          const cor = s.querySelector('PolyStyle > color')?.textContent ?? '';
          if (id && cor && cor.length === 8) {
            const r = cor.slice(6,8), g = cor.slice(4,6), b = cor.slice(2,4);
            styles[id] = `#${r}${g}${b}`;
          }
        });

        let criadas = 0;
        for (const pm of zonasPMs) {
          const nome = pm.querySelector('name')?.textContent?.trim() ?? 'Zona importada';
          const styleUrl = pm.querySelector('styleUrl')?.textContent?.trim().replace('#','') ?? '';
          const cor = styles[styleUrl + '-normal'] ?? styles[styleUrl] ?? '#7c3aed';
          const coordsEl = pm.querySelector('Polygon coordinates, outerBoundaryIs coordinates');
          if (!coordsEl?.textContent) continue;
          const pontos = coordsEl.textContent.trim().split(/\s+/).map(c => {
            const [lng, lat] = c.split(',').map(Number);
            return { lat, lng };
          }).filter(p => isFinite(p.lat) && isFinite(p.lng));
          if (pontos.length < 3) continue;
          await addDoc(collection(db, 'poligonos'), {
            nome, cidade, pais, cor,
            grupo: 'importado', fase: 'operacao', prioridade: 1, ativo: true,
            poligono: pontos, criadoEm: serverTimestamp(), importadoDe: file.name,
          });
          criadas++;
          log(`  ✅ ${nome} (${pontos.length} ${pick(T.pts)})`);
        }
        log(`🎉 ${criadas} ${pick(T.zonasImportadas)}`);

      // ── GeoJSON ────────────────────────────────────────────────
      } else if (ext.endsWith('.geojson') || ext.endsWith('.json')) {
        const text = await file.text();
        const gj = JSON.parse(text);
        const features = gj.type === 'FeatureCollection' ? gj.features
          : gj.type === 'Feature' ? [gj] : [];
        const polys = features.filter((f: any) => f?.geometry?.type === 'Polygon');
        log(`📍 ${polys.length} ${pick(T.poligonosEnc)}`);
        let criadas = 0;
        for (const f of polys) {
          const p = f.properties ?? {};
          const ring = f.geometry.coordinates[0] as [number,number][];
          const pontos = ring.map(([lng, lat]) => ({ lat, lng }))
            .filter(pt => isFinite(pt.lat) && isFinite(pt.lng));
          if (pontos.length < 3) continue;
          await addDoc(collection(db, 'poligonos'), {
            nome: p.nome || p.name || 'Zona importada', cidade, pais,
            cor: p.cor || p.color || '#7c3aed',
            grupo: p.grupo || 'importado', fase: p.fase || 'operacao',
            prioridade: p.prioridade || 1, ativo: p.ativo !== false,
            poligono: pontos, criadoEm: serverTimestamp(), importadoDe: file.name,
          });
          criadas++;
          log(`  ✅ ${p.nome || p.name || pick(T.zona)}`);
        }
        log(`🎉 ${criadas} ${pick(T.zonasImportadas)}`);

      // ── CSV (pontos: nome,grupo,fase,lat,lng,ativo) ────────────
      } else if (ext.endsWith('.csv')) {
        const text = await file.text();
        const linhas = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (linhas.length < 2) throw new Error(pick(T.csvVazio));
        log(`📄 ${linhas.length - 1} ${pick(T.linhasLidas)}`);

        // Agrupa linhas pelo nome da zona
        const grupos: Record<string, { nome: string; grupo: string; fase: string; ativo: boolean; pontos: {lat:number;lng:number}[] }> = {};
        for (const linha of linhas.slice(1)) {
          const cols = linha.split(',').map(c => c.replace(/^"|"$/g, '').trim());
          const [nome, grp, fase, latStr, lngStr, ativoStr] = cols;
          const lat = parseFloat(latStr), lng = parseFloat(lngStr);
          if (!nome || !isFinite(lat) || !isFinite(lng)) continue;
          if (!grupos[nome]) grupos[nome] = { nome, grupo: grp || 'importado', fase: fase || 'operacao', ativo: ativoStr !== 'false', pontos: [] };
          grupos[nome].pontos.push({ lat, lng });
        }
        let criadas = 0;
        for (const z of Object.values(grupos)) {
          if (z.pontos.length < 3) continue;
          await addDoc(collection(db, 'poligonos'), {
            nome: z.nome, cidade, pais, cor: '#7c3aed',
            grupo: z.grupo, fase: z.fase, prioridade: 1, ativo: z.ativo,
            poligono: z.pontos, criadoEm: serverTimestamp(), importadoDe: file.name,
          });
          criadas++;
          log(`  ✅ ${z.nome} (${z.pontos.length} ${pick(T.pts)})`);
        }
        log(`🎉 ${criadas} ${pick(T.zonasImportadas)}`);

      } else {
        throw new Error(pick(T.formatoNS));
      }
    } catch (e: any) {
      log(`${pick(T.erroLog)} ${e.message}`);
    } finally {
      setImportandoZona(false);
    }
  };

  const sec: React.CSSProperties = { padding:'12px 0', borderBottom:'1px solid rgba(255,255,255,.06)', marginBottom:4 };
  const secTitle: React.CSSProperties = { fontSize:9, fontWeight:700, letterSpacing:1, textTransform:'uppercase', color:'rgba(255,255,255,.25)', marginBottom:10 };
  const btn = (cor: string): React.CSSProperties => ({ flex:1, padding:'9px 8px', borderRadius:8, border:'none', cursor:'pointer', background:cor, color:'#fff', fontSize:11, fontWeight:700 });

  return (
    <div>
      {/* ── ESTAÇÕES ── */}
      <div style={sec}>
        <div style={secTitle}>{pick(T.estTotal)} {estacoes.length} {pick(T.totalWord)}</div>

        {/* Ordenação */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.4)', flexShrink:0 }}>{pick(T.ordenarPor)}</span>
          {(['bairro','codigo','status'] as const).map(k=>(
            <button key={k} onClick={()=>setOrdenarPor(k)} style={{
              padding:'3px 10px', borderRadius:10, border:'none', cursor:'pointer', fontSize:10, fontWeight:600,
              background: ordenarPor===k?'rgba(61,155,255,.2)':'rgba(255,255,255,.06)',
              color: ordenarPor===k?'#3d9bff':'rgba(255,255,255,.4)',
              outline: ordenarPor===k?'1px solid rgba(61,155,255,.4)':'1px solid rgba(255,255,255,.08)',
            }}>{pick(ordLabels[k])}</button>
          ))}
        </div>

        {/* Seletor de campos */}
        <button onClick={()=>setShowCampos(v=>!v)} style={{
          width:'100%', padding:'8px', borderRadius:8, cursor:'pointer', marginBottom:8,
          background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)',
          color:'rgba(255,255,255,.5)', fontSize:11, textAlign:'left',
        }}>
          {showCampos ? '▲' : '▼'} {pick(T.camposExp)} ({camposSel.length} {pick(T.selecionados)})
        </button>

        {showCampos && (
          <div style={{ marginBottom:10, padding:10, background:'rgba(255,255,255,.03)',
            borderRadius:8, border:'1px solid rgba(255,255,255,.06)' }}>
            {grupos.map(g=>(
              <div key={g} style={{ marginBottom:8 }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', fontWeight:700,
                  textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{labelGrupo(g)}</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {CAMPOS_EXPORT.filter(c=>c.grupo===g).map(c=>(
                    <div key={c.key} onClick={()=>toggleCampo(c.key)}
                      style={{ padding:'2px 8px', borderRadius:8, cursor:'pointer', fontSize:10,
                        background: camposSel.includes(c.key)?'rgba(61,155,255,.2)':'rgba(255,255,255,.04)',
                        color: camposSel.includes(c.key)?'#3d9bff':'rgba(255,255,255,.35)',
                        border: `1px solid ${camposSel.includes(c.key)?'rgba(61,155,255,.4)':'rgba(255,255,255,.08)'}`,
                      }}>{labelCampo(c.key, c.label)}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:'flex', gap:6, marginBottom:10 }}>
          <button onClick={exportCSV} style={btn('rgba(48,127,226,.8)')}>⬇ CSV</button>
          <button onClick={exportJSON} style={btn('rgba(99,102,241,.8)')}>⬇ JSON</button>
          <button onClick={exportPDF} style={btn('rgba(239,68,68,.8)')}>⬇ PDF</button>
        </div>

        {/* Import */}
        {isGestor && (
          <>
            <input ref={fileRef} type="file" accept=".csv,.json,.xlsx,.xls" style={{display:'none'}}
              onChange={e=>{setImportFile(e.target.files?.[0]||null);}} />
            <button onClick={()=>fileRef.current?.click()} style={{
              width:'100%', padding:'9px', borderRadius:8, cursor:'pointer',
              background:'rgba(255,255,255,.04)', border:'1px dashed rgba(255,255,255,.15)',
              color:'rgba(255,255,255,.5)', fontSize:11, marginBottom:6,
            }}>{importFile ? `📁 ${importFile.name}` : pick(T.importarFile)}</button>
            {importFile && (importFile.name.endsWith('.xlsx') || importFile.name.endsWith('.xls')) && !importResult && (
              <div style={{ padding:'8px 10px', borderRadius:6, marginBottom:6,
                background:'rgba(167,139,250,.08)', border:'1px solid rgba(167,139,250,.2)',
                fontSize:10, color:'rgba(167,139,250,.8)', lineHeight:1.6 }}>
                <strong>{pick(T.xlsxDetTit)}</strong><br/>
                {pick(T.xlsxIra)}<br/>
                {pick(T.xlsx1)}<br/>
                {pick(T.xlsx2)}<br/>
                {pick(T.xlsx3)}<br/>
                {pick(T.xlsx4)}<br/>
                {pick(T.xlsx5)}
              </div>
            )}
            {importFile && !importResult && (
              <button onClick={handleImportar} disabled={importando} style={{
                width:'100%', padding:9, background: importando?'rgba(48,127,226,.3)':'linear-gradient(135deg,#1a6fd4,#307FE2)',
                border:'none', borderRadius:8, color:'#fff', fontSize:12, fontWeight:600,
                cursor: importando?'not-allowed':'pointer', marginBottom:6,
              }}>{importando?pick(T.importando):pick(T.iniciarImp)}</button>
            )}
            {importLog.length>0 && (
              <div style={{maxHeight:80,overflowY:'auto',background:'rgba(0,0,0,.2)',
                borderRadius:6,padding:8,fontSize:10,fontFamily:'monospace',color:'#6ee7b7'}}>
                {importLog.map((l,i)=><div key={i}>{l}</div>)}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── ZONAS ── */}
      <div style={sec}>
        <div style={secTitle}>{pick(T.zonas)}</div>
        <div style={{ padding:'8px 10px', marginBottom:8, borderRadius:6,
          background:'rgba(192,132,252,.08)', border:'1px solid rgba(192,132,252,.2)',
          fontSize:11, color:'rgba(255,255,255,.5)', lineHeight:1.5 }}>
          {pick(T.zonasAjudaA)} <b style={{color:'#c084fc'}}>✏</b> {pick(T.zonasAjudaB)}
        </div>

        {/* Exportar */}
        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{pick(T.exportar)}</div>
        <div style={{ display:'flex', gap:5, marginBottom:12 }}>
          <button onClick={()=>exportZonas('geojson')} style={btn('rgba(99,102,241,.8)')}>⬇ GeoJSON</button>
          <button onClick={()=>exportZonas('wkt')}     style={btn('rgba(48,127,226,.8)')}>⬇ WKT</button>
          <button onClick={()=>exportZonas('csv')}     style={btn('rgba(16,185,129,.8)')}>⬇ CSV</button>
        </div>

        {/* Importar */}
        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{pick(T.importar)}</div>
        <input
          ref={importZonaRef} type="file"
          accept=".kmz,.kml,.geojson,.json,.csv"
          style={{ display:'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importarZonas(f); e.target.value = ''; }}
        />
        <div style={{ display:'flex', gap:5, marginBottom:8 }}>
          <button
            onClick={() => importZonaRef.current?.click()}
            disabled={importandoZona}
            style={btn(importandoZona ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.8)')}
          >
            {importandoZona ? pick(T.impProgresso) : '⬆ KMZ / KML'}
          </button>
          <button
            onClick={() => importZonaRef.current?.click()}
            disabled={importandoZona}
            style={btn(importandoZona ? 'rgba(99,102,241,.4)' : 'rgba(99,102,241,.8)')}
          >
            {importandoZona ? pick(T.impProgresso) : '⬆ GeoJSON'}
          </button>
          <button
            onClick={() => importZonaRef.current?.click()}
            disabled={importandoZona}
            style={btn(importandoZona ? 'rgba(16,185,129,.4)' : 'rgba(16,185,129,.8)')}
          >
            {importandoZona ? pick(T.impProgresso) : '⬆ CSV'}
          </button>
        </div>
        {importZonaLog.length > 0 && (
          <div style={{ background:'rgba(0,0,0,.3)', borderRadius:6, padding:'8px 10px',
            fontSize:10, color:'rgba(255,255,255,.6)', maxHeight:120, overflowY:'auto',
            fontFamily:'monospace', lineHeight:1.7, marginBottom:8 }}>
            {importZonaLog.map((l,i) => <div key={i}>{l}</div>)}
          </div>
        )}

        <ZonasInline cidade={cidade} pais={pais} />
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════
// PAINEL DE RELATÓRIOS GUARD — Firebase Callable + Telegram automático
// ═══════════════════════════════════════════════════════════════════
function GuardRelatoriosPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const { pick } = useLang();
  const T = {
    preencha:   { pt:'✗ Preencha o Token do Bot e o Chat ID', en:'✗ Fill in the Bot Token and Chat ID', es:'✗ Complete el Token del Bot y el Chat ID', ru:'✗ Заполните Token бота и Chat ID' },
    configSalva:{ pt:'✓ Configuração salva! Token e Chat ID registrados.', en:'✓ Configuration saved! Token and Chat ID registered.', es:'✓ ¡Configuración guardada! Token y Chat ID registrados.', ru:'✓ Конфигурация сохранена! Token и Chat ID зарегистрированы.' },
    erroSalvar: { pt:'✗ Erro ao salvar:', en:'✗ Error saving:', es:'✗ Error al guardar:', ru:'✗ Ошибка сохранения:' },
    enviado:    { pt:'enviado', en:'sent', es:'enviado', ru:'отправлено' },
    registros:  { pt:'registros', en:'records', es:'registros', ru:'записей' },
    erroEnviar: { pt:'✗ Erro ao enviar:', en:'✗ Error sending:', es:'✗ Error al enviar:', ru:'✗ Ошибка отправки:' },
    relatAuto:  { pt:'📬 Relatórios Automáticos', en:'📬 Automatic Reports', es:'📬 Informes Automáticos', ru:'📬 Автоматические отчёты' },
    relatAutoSub:{ pt:'Diário às 7h · Semanal às 7h toda segunda · Firebase Functions', en:'Daily at 7am · Weekly at 7am every Monday · Firebase Functions', es:'Diario a las 7h · Semanal a las 7h cada lunes · Firebase Functions', ru:'Ежедневно в 7:00 · Еженедельно в 7:00 по понедельникам · Firebase Functions' },
    cfgTelegram:{ pt:'⚙️ Configuração Telegram', en:'⚙️ Telegram Configuration', es:'⚙️ Configuración de Telegram', ru:'⚙️ Настройка Telegram' },
    cfgTelegramSub:{ pt:'Token do bot (@BotFather) e Chat ID do grupo/canal de destino.', en:'Bot token (@BotFather) and Chat ID of the target group/channel.', es:'Token del bot (@BotFather) y Chat ID del grupo/canal de destino.', ru:'Token бота (@BotFather) и Chat ID целевой группы/канала.' },
    salvando:   { pt:'⏳ Salvando...', en:'⏳ Saving...', es:'⏳ Guardando...', ru:'⏳ Сохранение...' },
    salvarCfg:  { pt:'💾 Salvar configuração', en:'💾 Save configuration', es:'💾 Guardar configuración', ru:'💾 Сохранить конфигурацию' },
    notifRT:    { pt:'🔔 Notificações Telegram em tempo real', en:'🔔 Real-time Telegram notifications', es:'🔔 Notificaciones de Telegram en tiempo real', ru:'🔔 Уведомления Telegram в реальном времени' },
    ativarAgend:{ pt:'🚀 Ativar agendamento automático', en:'🚀 Enable automatic scheduling', es:'🚀 Activar programación automática', ru:'🚀 Включить автоматическое расписание' },
    execUmaVez: { pt:'Execute uma vez para ativar os 4 triggers:', en:'Run once to enable the 4 triggers:', es:'Ejecute una vez para activar los 4 disparadores:', ru:'Запустите один раз, чтобы включить 4 триггера:' },
    triggersCriados:{ pt:'Triggers criados:', en:'Triggers created:', es:'Disparadores creados:', ru:'Созданные триггеры:' },
    trigGuardD: { pt:'• Guard diário — 7h, seg a sáb', en:'• Daily Guard — 7am, Mon to Sat', es:'• Guard diario — 7h, lun a sáb', ru:'• Guard ежедневно — 7:00, пн–сб' },
    trigGuardS: { pt:'• Guard semanal — 7h, toda segunda', en:'• Weekly Guard — 7am, every Monday', es:'• Guard semanal — 7h, cada lunes', ru:'• Guard еженедельно — 7:00, по понедельникам' },
    trigPerdasD:{ pt:'• Perdas diário — 7h, seg a sáb', en:'• Daily Losses — 7am, Mon to Sat', es:'• Pérdidas diario — 7h, lun a sáb', ru:'• Потери ежедневно — 7:00, пн–сб' },
    trigPerdasS:{ pt:'• Perdas semanal — 7h, toda segunda', en:'• Weekly Losses — 7am, every Monday', es:'• Pérdidas semanal — 7h, cada lunes', ru:'• Потери еженедельно — 7:00, по понедельникам' },
    guardManual:{ pt:'🛡 Relatório Guard — Envio manual', en:'🛡 Guard Report — Manual send', es:'🛡 Informe Guard — Envío manual', ru:'🛡 Отчёт Guard — Ручная отправка' },
    perdasManual:{ pt:'💸 Relatório Perdas — Envio manual', en:'💸 Losses Report — Manual send', es:'💸 Informe Pérdidas — Envío manual', ru:'💸 Отчёт Потери — Ручная отправка' },
    guardDiario:{ pt:'📅 Guard Diário (ontem)', en:'📅 Daily Guard (yesterday)', es:'📅 Guard Diario (ayer)', ru:'📅 Guard ежедневный (вчера)' },
    guardSemanal:{ pt:'📆 Guard Semanal (sem. ant.)', en:'📆 Weekly Guard (last week)', es:'📆 Guard Semanal (sem. ant.)', ru:'📆 Guard еженедельный (пр. нед.)' },
    perdasDiario:{ pt:'📅 Perdas Diário (ontem)', en:'📅 Daily Losses (yesterday)', es:'📅 Pérdidas Diario (ayer)', ru:'📅 Потери ежедневно (вчера)' },
    perdasSemanal:{ pt:'📆 Perdas Semanal (sem. ant.)', en:'📆 Weekly Losses (last week)', es:'📆 Pérdidas Semanal (sem. ant.)', ru:'📆 Потери еженедельно (пр. нед.)' },
    enviando:   { pt:'⏳ Enviando...', en:'⏳ Sending...', es:'⏳ Enviando...', ru:'⏳ Отправка...' },
    histAlt:    { pt:'📋 Histórico de Alterações', en:'📋 Change History', es:'📋 Historial de Cambios', ru:'📋 История изменений' },
    expExcel:   { pt:'📊 Exportar Guard para Excel', en:'📊 Export Guard to Excel', es:'📊 Exportar Guard a Excel', ru:'📊 Экспорт Guard в Excel' },
    auditoria:  { pt:'🔍 Auditoria de Incidente', en:'🔍 Incident Audit', es:'🔍 Auditoría de Incidente', ru:'🔍 Аудит инцидента' },
    expCsv:     { pt:'⬇ Exportar Ocorrências (CSV)', en:'⬇ Export Incidents (CSV)', es:'⬇ Exportar Incidencias (CSV)', ru:'⬇ Экспорт инцидентов (CSV)' },
    notaPdfA:   { pt:'O PDF é gerado server-side e enviado como arquivo .html diretamente no Telegram. O Telegram renderiza o HTML na visualização do arquivo. Para PDF nativo, adicione ', en:'The PDF is generated server-side and sent as an .html file directly on Telegram. Telegram renders the HTML in the file preview. For native PDF, add ', es:'El PDF se genera del lado del servidor y se envía como archivo .html directamente en Telegram. Telegram renderiza el HTML en la vista del archivo. Para PDF nativo, agregue ', ru:'PDF создаётся на стороне сервера и отправляется как файл .html прямо в Telegram. Telegram отображает HTML в предпросмотре файла. Для нативного PDF добавьте ' },
    notaPdfB:   { pt:' nas functions.', en:' to the functions.', es:' en las functions.', ru:' в functions.' },
  };
  const [enviando,    setEnviando]    = useState<string|null>(null);
  const [resultado,   setResultado]   = useState<{ok:boolean;msg:string}|null>(null);
  const [config,      setConfig]      = useState({ token:'', chatId:'' });
  const [salvando,    setSalvando]    = useState(false);
  const [reportLang,  setReportLang]  = useState('pt');

  // Carregar config salva no Firestore
  useEffect(() => {
    // Tenta carregar de config/telegram primeiro, depois telegram_config/global
    import('firebase/firestore').then(({ getDoc, doc: fDoc }) => {
      getDoc(fDoc(db, 'config', 'telegram')).then(snap => {
        if (snap.exists()) {
          const d = snap.data();
          const token  = d.bot_token || d.botToken || '';
          const chatId = d.chat_id   || d.relatoriosChatId || d.chatId || '';
          if (token || chatId) { setConfig({ token, chatId }); return; }
        }
        // Fallback: telegram_config/global
        return getDoc(fDoc(db, 'telegram_config', 'global')).then(snap2 => {
          if (snap2.exists()) {
            const d = snap2.data();
            setConfig({
              token:  d.botToken || d.bot_token || '',
              chatId: d.relatoriosChatId || d.chat_id || d.chatId || '',
            });
          }
        });
      }).catch(() => {});
    });
  }, []);

  const salvarConfig = async () => {
    setSalvando(true);
    try {
      const { setDoc, doc: fDoc } = await import('firebase/firestore');
      const token  = config.token.trim();
      const chatId = config.chatId.trim();

      if (!token || !chatId) {
        setResultado({ ok:false, msg: pick(T.preencha) });
        setSalvando(false); return;
      }

      // Salva nos dois caminhos que a Cloud Function verifica
      const payload = {
        bot_token:        token,
        chat_id:          chatId,
        botToken:         token,          // alias novo
        relatoriosChatId: chatId,         // alias novo
        tipo:             'telegram',
        updatedAt:        new Date().toISOString(),
      };

      await Promise.all([
        setDoc(fDoc(db, 'config', 'telegram'), payload, { merge: true }),
        setDoc(fDoc(db, 'telegram_config', 'global'), payload, { merge: true }),
      ]);

      setResultado({ ok:true, msg: pick(T.configSalva) });
    } catch(e:any) {
      setResultado({ ok:false, msg: pick(T.erroSalvar) + ' ' + e.message });
    }
    setSalvando(false);
  };

  const chamarFunction = async (tipo: string, periodo: string, label: string) => {
    setEnviando(label);
    setResultado(null);
    try {
      // relatorioGuardManualFn está deployada e funcionando
      // Passa tipo e periodo — a function ignora o que não conhece (só usa dataStr)
      const fnName = 'relatorioGuardManualFn';
      const { functionsProviderSupabase, getEdgeCallable } = await import('./lib/edge-functions');
      let fn: any;
      if (functionsProviderSupabase()) {
        const edge = getEdgeCallable(fnName);
        fn = edge ? edge() : httpsCallable(getFunctions(getApp(), 'southamerica-east1'), fnName);
      } else {
        fn = httpsCallable(getFunctions(getApp(), 'southamerica-east1'), fnName);
      }
      const res = await fn({ tipo, periodo, lang: reportLang }) as any;
      const d = res.data as any;
      const total = d.totalOcorrencias ?? d.total ?? 0;
      setResultado({ ok:true, msg:`✓ ${label} ${pick(T.enviado)}${total ? ` — ${total} ${pick(T.registros)}` : ''}` });
    } catch(e:any) {
      setResultado({ ok:false, msg:`${pick(T.erroEnviar)} ${(e as any).message || String(e)}` });
    }
    setEnviando(null);
  };

  const btn: React.CSSProperties = {
    width:'100%', padding:'10px 14px', borderRadius:8, cursor:'pointer',
    fontSize:11, fontWeight:600, textAlign:'left' as const,
    display:'flex', alignItems:'center', gap:8, marginBottom:6,
  };
  const sec: React.CSSProperties = { padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,.06)' };
  const hdr: React.CSSProperties = { fontSize:9, color:'#4a5a7a', textTransform:'uppercase' as const, letterSpacing:.5, marginBottom:8, fontWeight:700 };

  return (
    <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'thin' as const, scrollbarColor:'#1c2535 transparent', display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.06)', background:'rgba(167,139,250,.05)' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#a78bfa' }}>{pick(T.relatAuto)}</div>
        <div style={{ fontSize:10, color:'#4a5a7a', marginTop:3 }}>
          {pick(T.relatAutoSub)}
        </div>
      </div>

      {/* Config Telegram — apenas admin */}
      {isAdmin && (
      <div style={sec}>
        <div style={hdr}>{pick(T.cfgTelegram)}</div>
        <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:8, lineHeight:1.7 }}>
          {pick(T.cfgTelegramSub)}
        </div>
        <label style={{ fontSize:9, color:'#4a5a7a', marginBottom:3, display:'block' }}>BOT TOKEN</label>
        <input value={config.token} onChange={e => setConfig(c=>({...c,token:e.target.value}))}
          placeholder="123456:ABC-..."
          style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid #1c2535',
            background:'#111722', color:'#dce8ff', fontSize:10, boxSizing:'border-box', marginBottom:8 }}/>
        <label style={{ fontSize:9, color:'#4a5a7a', marginBottom:3, display:'block' }}>CHAT ID</label>
        <input value={config.chatId} onChange={e => setConfig(c=>({...c,chatId:e.target.value}))}
          placeholder="-100123456789"
          style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid #1c2535',
            background:'#111722', color:'#dce8ff', fontSize:10, boxSizing:'border-box', marginBottom:10 }}/>
        <button onClick={salvarConfig} disabled={salvando}
          style={{ ...btn, marginBottom:0, background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.3)', color:'#a78bfa' }}>
          {salvando ? pick(T.salvando) : pick(T.salvarCfg)}
        </button>
      </div>
      )}

      {/* Config Notificações Telegram — apenas admin */}
      {isAdmin && (
      <div style={sec}>
        <div style={hdr}>{pick(T.notifRT)}</div>
        <GuardNotifConfig />
      </div>
      )}

      {/* Deploy instruções */}
      <div style={{ ...sec, background:'rgba(251,191,36,.04)' }}>
        <div style={hdr}>{pick(T.ativarAgend)}</div>
        <div style={{ fontSize:9, color:'rgba(255,255,255,.45)', lineHeight:1.8 }}>
          {pick(T.execUmaVez)}<br/>
          <code style={{ color:'#fbbf24', background:'rgba(0,0,0,.3)', padding:'1px 5px', borderRadius:3 }}>
            cd functions && npm run build
          </code><br/>
          <code style={{ color:'#fbbf24', background:'rgba(0,0,0,.3)', padding:'1px 5px', borderRadius:3 }}>
            firebase deploy --only functions
          </code><br/><br/>
          <span style={{ color:'#4a5a7a' }}>{pick(T.triggersCriados)}</span><br/>
          {pick(T.trigGuardD)}<br/>
          {pick(T.trigGuardS)}<br/>
          {pick(T.trigPerdasD)}<br/>
          {pick(T.trigPerdasS)}
        </div>
      </div>

      {/* Envio manual Guard */}
      <div style={sec}>
        <div style={hdr}>{pick(T.guardManual)}</div>
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>
          {(['pt','en','es','ru'] as const).map(l => (
            <button key={l} onClick={() => setReportLang(l)} style={{
              padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700,
              background: reportLang===l ? '#a78bfa' : 'rgba(255,255,255,.08)',
              color: reportLang===l ? '#fff' : 'rgba(255,255,255,.4)',
              border: `1px solid ${reportLang===l ? '#a78bfa' : 'rgba(255,255,255,.1)'}`,
              cursor:'pointer'
            }}>{l.toUpperCase()}</button>
          ))}
        </div>
        {[
          { tipo:'guard', periodo:'ontem',  label:pick(T.guardDiario),  cor:'#a78bfa' },
          { tipo:'guard', periodo:'semana', label:pick(T.guardSemanal), cor:'#818cf8' },
        ].map(({ tipo, periodo, label, cor }) => (
          <button key={label}
            disabled={!!enviando}
            onClick={() => chamarFunction(tipo, periodo, label)}
            style={{ ...btn, background:'rgba(167,139,250,.08)', border:`1px solid rgba(167,139,250,.2)`, color:cor }}>
            {enviando === label ? pick(T.enviando) : label}
          </button>
        ))}
      </div>

      {/* Envio manual Perdas */}
      <div style={sec}>
        <div style={hdr}>{pick(T.perdasManual)}</div>
        {[
          { tipo:'perdas', periodo:'ontem',  label:pick(T.perdasDiario),  cor:'#f87171' },
          { tipo:'perdas', periodo:'semana', label:pick(T.perdasSemanal), cor:'#fca5a5' },
        ].map(({ tipo, periodo, label, cor }) => (
          <button key={label}
            disabled={!!enviando}
            onClick={() => chamarFunction(tipo, periodo, label)}
            style={{ ...btn, background:'rgba(239,68,68,.08)', border:`1px solid rgba(239,68,68,.2)`, color:cor }}>
            {enviando === label ? pick(T.enviando) : label}
          </button>
        ))}
      </div>

      {/* Resultado */}
      {resultado && (
        <div style={{ margin:'12px 16px', padding:'10px 14px', borderRadius:8,
          background: resultado.ok?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)',
          border:`1px solid ${resultado.ok?'rgba(34,197,94,.25)':'rgba(239,68,68,.25)'}`,
          fontSize:11, color:resultado.ok?'#4ade80':'#f87171', lineHeight:1.5 }}>
          {resultado.msg}
        </div>
      )}

      {/* Histórico de alterações — gestor e admin */}
      <div style={sec}>
        <div style={hdr}>{pick(T.histAlt)}</div>
        <GuardHistorico />
      </div>

      {/* Exportar Excel */}
      <div style={sec}>
        <div style={hdr}>{pick(T.expExcel)}</div>
        <GuardExportExcel />
      </div>

      {/* Auditoria de incidente */}
      {isAdmin && (
      <div style={sec}>
        <div style={hdr}>{pick(T.auditoria)}</div>
        <GuardAuditoriaPanel />
      </div>
      )}

      {/* Export CSV Ocorrências */}
      <div style={sec}>
        <div style={hdr}>{pick(T.expCsv)}</div>
        <GuardExportCSV />
      </div>

      {/* Nota */}
      <div style={{ margin:'12px 16px 20px', padding:'10px 14px', borderRadius:8,
        background:'rgba(59,130,246,.04)', border:'1px solid rgba(59,130,246,.12)',
        fontSize:9, color:'rgba(255,255,255,.35)', lineHeight:1.8 }}>
        {pick(T.notaPdfA)}<code style={{color:'#60a5fa'}}>puppeteer</code>{pick(T.notaPdfB)}
      </div>
    </div>
  );
}

// ── Export CSV de Ocorrências Guard ──────────────────────────────────────────
function GuardExportCSV() {
  const { pick } = useLang();
  const T = {
    cID:        { pt:'ID', en:'ID', es:'ID', ru:'ID' },
    cTipo:      { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
    cStatus:    { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    cDescricao: { pt:'Descrição', en:'Description', es:'Descripción', ru:'Описание' },
    cLocal:     { pt:'Local', en:'Location', es:'Lugar', ru:'Место' },
    cCidade:    { pt:'Cidade', en:'City', es:'Ciudad', ru:'Город' },
    cPatinete:  { pt:'Patinete', en:'Scooter', es:'Patinete', ru:'Самокат' },
    cLat:       { pt:'Lat', en:'Lat', es:'Lat', ru:'Шир' },
    cLng:       { pt:'Lng', en:'Lng', es:'Lng', ru:'Долг' },
    cCriadoEm:  { pt:'Criado em', en:'Created at', es:'Creado el', ru:'Создано' },
    cCriadoPor: { pt:'Criado por', en:'Created by', es:'Creado por', ru:'Создал' },
    cResolvido: { pt:'Resolvido em', en:'Resolved at', es:'Resuelto el', ru:'Решено' },
    cRecuperado:{ pt:'Recuperado', en:'Recovered', es:'Recuperado', ru:'Восстановлено' },
    erroExport: { pt:'Erro ao exportar:', en:'Error exporting:', es:'Error al exportar:', ru:'Ошибка экспорта:' },
    tudo:       { pt:'Tudo', en:'All', es:'Todo', ru:'Всё' },
    exportando: { pt:'⏳ Exportando...', en:'⏳ Exporting...', es:'⏳ Exportando...', ru:'⏳ Экспорт...' },
    baixarCsv:  { pt:'⬇ Baixar CSV', en:'⬇ Download CSV', es:'⬇ Descargar CSV', ru:'⬇ Скачать CSV' },
  };
  const [periodo,   setPeriodo]   = useLocalState<'7d'|'30d'|'90d'|'todos'>('30d');
  const [exportando, setExportando] = useLocalState(false);

  const exportar = async () => {
    setExportando(true);
    try {
      const desde = periodo === 'todos' ? new Date(0) :
        periodo === '7d'  ? new Date(Date.now() - 7  * 86400000) :
        periodo === '30d' ? new Date(Date.now() - 30 * 86400000) :
                            new Date(Date.now() - 90 * 86400000);

      // Fase 2 / Onda B — leitura do Supabase atrás de flag (read-only).
      const baseDocs: any[] = guardProviderSupabase()
        ? await carregarOcorrenciasSupabase({ limit: 2000 })
        : (await getDocs(query(
            collection(db, 'ocorrencias'),
            orderBy('criadoEm', 'desc'),
            limit(2000),
          ))).docs.map(d => ({ id: d.id, ...d.data() } as any));

      const docs = baseDocs
        .filter(o => {
          if (periodo === 'todos') return true;
          const d = o.criadoEm?.toDate?.() ?? (o.criadoEm ? new Date(o.criadoEm) : new Date(0));
          return d >= desde;
        });

      const h = [pick(T.cID),pick(T.cTipo),pick(T.cStatus),pick(T.cDescricao),pick(T.cLocal),pick(T.cCidade),pick(T.cPatinete),
                 pick(T.cLat),pick(T.cLng),pick(T.cCriadoEm),pick(T.cCriadoPor),pick(T.cResolvido),pick(T.cRecuperado)];
      const rows = docs.map((o: any) => {
        const fmtD = (ts: any) => {
          if (!ts) return '';
          const d = ts?.toDate?.() ?? new Date(ts);
          return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric',
            hour:'2-digit', minute:'2-digit' });
        };
        const esc = (v: any) => {
          const s = String(v ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        };
        return [
          o.id, o.tipo, o.status ?? '', o.descricao ?? '', o.local ?? '',
          o.cidade ?? '', o.bikeIdentifier ?? '',
          o.lat ?? '', o.lng ?? '',
          fmtD(o.criadoEm), o.criadoPorNome ?? '',
          fmtD(o.resolvidoEm ?? o.fechadoEm), o.recuperado ? 'Sim' : '',
        ].map(esc).join(',');
      });

      const csv = '\uFEFF' + [h.join(','), ...rows].join('\n');
      const a   = document.createElement('a');
      a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `ocorrencias_guard_${periodo}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
    } catch (e: any) {
      alert(pick(T.erroExport) + ' ' + e.message);
    } finally {
      setExportando(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
      {(['7d','30d','90d','todos'] as const).map(p => (
        <button key={p} onClick={() => setPeriodo(p)} style={{
          padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 600,
          background: periodo === p ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.06)',
          color: periodo === p ? '#60a5fa' : 'rgba(255,255,255,.4)',
        }}>{p === 'todos' ? pick(T.tudo) : p}</button>
      ))}
      <button onClick={exportar} disabled={exportando} style={{
        padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'rgba(59,130,246,.8)', color: '#fff', fontSize: 11, fontWeight: 700,
        opacity: exportando ? 0.6 : 1,
      }}>
        {exportando ? pick(T.exportando) : pick(T.baixarCsv)}
      </button>
    </div>
  );
}

// ── Config Notificações Telegram em tempo real ────────────────────────
// Salva no Firestore config/notif_guard — lido pela Cloud Function ao receber novo incidente
function GuardNotifConfig() {
  const [cfg, setCfg] = useState({
    ativo:        false,
    roubos:       true,
    vandalismo:   false,
    criticos:     true,
    procurando:   true,
    chatIdNotif:  '',
    minPrioridade:'Média',
  });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const { pick } = useLang();
  const T = {
    cfgSalva:   { pt:'✓ Configuração salva!', en:'✓ Configuration saved!', es:'✓ ¡Configuración guardada!', ru:'✓ Конфигурация сохранена!' },
    erro:       { pt:'✗ Erro:', en:'✗ Error:', es:'✗ Error:', ru:'✗ Ошибка:' },
    intro:      { pt:'Envio imediato no Telegram quando um incidente é registrado no app. Usa o mesmo bot configurado acima.', en:'Immediate Telegram message when an incident is recorded in the app. Uses the same bot configured above.', es:'Envío inmediato en Telegram cuando se registra un incidente en la app. Usa el mismo bot configurado arriba.', ru:'Мгновенная отправка в Telegram при регистрации инцидента в приложении. Использует тот же бот, что настроен выше.' },
    notifAtivas:{ pt:'🔔 Notificações ATIVAS', en:'🔔 Notifications ON', es:'🔔 Notificaciones ACTIVAS', ru:'🔔 Уведомления ВКЛ' },
    notifDesat: { pt:'🔕 Notificações desativadas', en:'🔕 Notifications off', es:'🔕 Notificaciones desactivadas', ru:'🔕 Уведомления выкл' },
    alertasRT:  { pt:'Alertas em tempo real para novos incidentes', en:'Real-time alerts for new incidents', es:'Alertas en tiempo real para nuevos incidentes', ru:'Оповещения в реальном времени о новых инцидентах' },
    chatIdLabel:{ pt:'Chat ID para notificações (deixe vazio para usar o mesmo dos relatórios)', en:'Chat ID for notifications (leave empty to use the same as reports)', es:'Chat ID para notificaciones (déjelo vacío para usar el mismo de los informes)', ru:'Chat ID для уведомлений (оставьте пустым, чтобы использовать тот же, что для отчётов)' },
    chatIdPh:   { pt:'-100123456789 (opcional)', en:'-100123456789 (optional)', es:'-100123456789 (opcional)', ru:'-100123456789 (необязательно)' },
    notificarQuando:{ pt:'Notificar quando:', en:'Notify when:', es:'Notificar cuando:', ru:'Уведомлять, когда:' },
    chkRoubos:  { pt:'🔴 Novo Roubo ou Furto registrado', en:'🔴 New Robbery or Theft recorded', es:'🔴 Nuevo Robo o Hurto registrado', ru:'🔴 Зарегистрирован новый грабёж или кража' },
    chkVand:    { pt:'🟡 Novo Vandalismo registrado', en:'🟡 New Vandalism recorded', es:'🟡 Nuevo Vandalismo registrado', ru:'🟡 Зарегистрирован новый вандализм' },
    chkCrit:    { pt:'⚠️ Incidente com prioridade Alta/Crítica', en:'⚠️ Incident with High/Critical priority', es:'⚠️ Incidente con prioridad Alta/Crítica', ru:'⚠️ Инцидент с высоким/критическим приоритетом' },
    chkProc:    { pt:'🔍 Ativo marcado como Procurando', en:'🔍 Asset marked as Searching', es:'🔍 Activo marcado como Buscando', ru:'🔍 Актив отмечен как «В поиске»' },
    prioMin:    { pt:'Prioridade mínima para notificar', en:'Minimum priority to notify', es:'Prioridad mínima para notificar', ru:'Минимальный приоритет для уведомления' },
    optTodas:   { pt:'Todas (incluir Baixa)', en:'All (include Low)', es:'Todas (incluir Baja)', ru:'Все (включая низкий)' },
    optMedia:   { pt:'Média ou superior', en:'Medium or higher', es:'Media o superior', ru:'Средний или выше' },
    optAlta:    { pt:'Apenas Alta/Crítica', en:'High/Critical only', es:'Solo Alta/Crítica', ru:'Только высокий/критический' },
    salvando:   { pt:'⏳ Salvando...', en:'⏳ Saving...', es:'⏳ Guardando...', ru:'⏳ Сохранение...' },
    salvarCfg:  { pt:'💾 Salvar configuração', en:'💾 Save configuration', es:'💾 Guardar configuración', ru:'💾 Сохранить конфигурацию' },
    comoTit:    { pt:'Como funciona:', en:'How it works:', es:'Cómo funciona:', ru:'Как это работает:' },
    comoA:      { pt:'A Cloud Function ', en:'The Cloud Function ', es:'La Cloud Function ', ru:'Cloud Function ' },
    comoB:      { pt:' monitora novos documentos na coleção ', en:' monitors new documents in the collection ', es:' monitorea nuevos documentos en la colección ', ru:' отслеживает новые документы в коллекции ' },
    comoC:      { pt:' e envia alertas instantâneos conforme os filtros acima. Para ativar o trigger em tempo real, adicione um', en:' and sends instant alerts according to the filters above. To enable the real-time trigger, add an', es:' y envía alertas instantáneas según los filtros anteriores. Para activar el disparador en tiempo real, agregue un', ru:' и отправляет мгновенные оповещения согласно фильтрам выше. Чтобы включить триггер реального времени, добавьте', },
    comoD:      { pt:' nas Cloud Functions.', en:' to the Cloud Functions.', es:' en las Cloud Functions.', ru:' в Cloud Functions.' },
  };

  useEffect(() => {
    getDocs(query(collection(db,'config'), where('tipo','==','notif_guard'))).then(snap => {
      if (!snap.empty) setCfg(c => ({ ...c, ...snap.docs[0].data() }));
    }).catch(() => {});
  }, []);

  const salvar = async () => {
    setSalvando(true); setMsg('');
    try {
      const batch = writeBatch(db);
      const ref = doc(collection(db,'config'),'notif_guard');
      batch.set(ref, { tipo:'notif_guard', ...cfg, updatedAt: new Date().toISOString() }, { merge:true });
      await batch.commit();
      setMsg(pick(T.cfgSalva));
    } catch(e:any) { setMsg(pick(T.erro) + ' ' + e.message); }
    setSalvando(false);
  };

  const inp: React.CSSProperties = {
    width:'100%', padding:'6px 10px', borderRadius:6, border:'1px solid #1c2535',
    background:'#111722', color:'#dce8ff', fontSize:10, boxSizing:'border-box' as const, marginBottom:8,
  };
  const chk = (key: keyof typeof cfg, label: string, cor='#a78bfa') => (
    <label key={key} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0',
      cursor:'pointer', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
      <input type="checkbox" checked={!!cfg[key]}
        onChange={e => setCfg(c => ({ ...c, [key]: e.target.checked }))}
        style={{ accentColor: cor, width:15, height:15 }}/>
      <span style={{ fontSize:10, color: cfg[key] ? '#dce8ff' : '#4a5a7a' }}>{label}</span>
    </label>
  );

  return (
    <div>
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:10, lineHeight:1.7 }}>
        {pick(T.intro)}
      </div>

      {/* Ativar/desativar */}
      <label style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
        borderRadius:8, cursor:'pointer', marginBottom:10,
        background: cfg.ativo ? 'rgba(167,139,250,.1)' : 'rgba(255,255,255,.04)',
        border: `1px solid ${cfg.ativo ? 'rgba(167,139,250,.4)' : 'rgba(255,255,255,.08)'}` }}>
        <input type="checkbox" checked={cfg.ativo}
          onChange={e => setCfg(c=>({...c, ativo: e.target.checked}))}
          style={{ accentColor:'#a78bfa', width:16, height:16 }}/>
        <div>
          <div style={{ fontSize:11, fontWeight:700, color: cfg.ativo ? '#a78bfa' : 'rgba(255,255,255,.5)' }}>
            {cfg.ativo ? pick(T.notifAtivas) : pick(T.notifDesat)}
          </div>
          <div style={{ fontSize:9, color:'#4a5a7a' }}>
            {pick(T.alertasRT)}
          </div>
        </div>
      </label>

      {/* Chat ID alternativo */}
      <label style={{ fontSize:9, color:'#4a5a7a', marginBottom:3, display:'block' }}>
        {pick(T.chatIdLabel)}
      </label>
      <input value={cfg.chatIdNotif} onChange={e=>setCfg(c=>({...c,chatIdNotif:e.target.value}))}
        placeholder={pick(T.chatIdPh)} style={inp}/>

      {/* Tipos de evento */}
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:6, marginTop:4 }}>
        {pick(T.notificarQuando)}
      </div>
      {chk('roubos',    pick(T.chkRoubos), '#ef4444')}
      {chk('vandalismo',pick(T.chkVand),   '#f59e0b')}
      {chk('criticos',  pick(T.chkCrit), '#f97316')}
      {chk('procurando',pick(T.chkProc),   '#ef4444')}

      {/* Prioridade mínima */}
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3, marginTop:8 }}>
        {pick(T.prioMin)}
      </div>
      <select value={cfg.minPrioridade} onChange={e=>setCfg(c=>({...c,minPrioridade:e.target.value}))}
        style={{...inp, cursor:'pointer', marginBottom:12}}>
        <option value="Baixa">{pick(T.optTodas)}</option>
        <option value="Média">{pick(T.optMedia)}</option>
        <option value="Alta">{pick(T.optAlta)}</option>
      </select>

      <button onClick={salvar} disabled={salvando}
        style={{ width:'100%', padding:'10px', borderRadius:8, cursor:'pointer',
          background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.3)',
          color:'#a78bfa', fontSize:12, fontWeight:600 }}>
        {salvando ? pick(T.salvando) : pick(T.salvarCfg)}
      </button>

      {msg && (
        <div style={{ marginTop:8, padding:'7px 12px', borderRadius:8, fontSize:11,
          background: msg.startsWith('✓') ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
          color: msg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{msg}</div>
      )}

      <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8, fontSize:9,
        color:'rgba(255,255,255,.3)', background:'rgba(255,255,255,.03)',
        border:'1px solid rgba(255,255,255,.06)', lineHeight:1.7 }}>
        <strong style={{color:'rgba(255,255,255,.5)'}}>{pick(T.comoTit)}</strong><br/>
        {pick(T.comoA)}<code style={{color:'#60a5fa'}}>relatorioGuardDiarioFn</code>{pick(T.comoB)}<code style={{color:'#60a5fa'}}>ocorrencias</code>{pick(T.comoC)}
        <code style={{color:'#60a5fa'}}> onDocumentCreated</code>{pick(T.comoD)}
      </div>
    </div>
  );
}

// ── Histórico de Alterações de Incidentes ─────────────────────────────
function GuardHistorico() {
  const { pick } = useLang();
  const T = {
    intro:    { pt:'Digite o ID do incidente (JET-SEC-...) para ver todas as edições registradas.', en:'Enter the incident ID (JET-SEC-...) to see all recorded edits.', es:'Ingrese el ID del incidente (JET-SEC-...) para ver todas las ediciones registradas.', ru:'Введите ID инцидента (JET-SEC-...), чтобы увидеть все зарегистрированные изменения.' },
    vazio:    { pt:'Nenhuma alteração registrada para este incidente.', en:'No changes recorded for this incident.', es:'Ningún cambio registrado para este incidente.', ru:'Для этого инцидента нет записанных изменений.' },
    erro:     { pt:'Erro:', en:'Error:', es:'Error:', ru:'Ошибка:' },
    sistema:  { pt:'Sistema', en:'System', es:'Sistema', ru:'Система' },
    motivo:   { pt:'Motivo:', en:'Reason:', es:'Motivo:', ru:'Причина:' },
  };
  const [busca,   setBusca]   = useState('');
  const [itens,   setItens]   = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const buscarHistorico = async () => {
    if (!busca.trim()) return;
    setLoading(true); setItens([]);
    try {
      // Buscar no histórico (coleção ocorrencias_historico)
      const q = query(
        collection(db, 'ocorrencias_historico'),
        where('incidenteId', '==', busca.trim())
      );
      const snap = await getDocs(q);
      const lista = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const da = a.alteradoEm ? new Date(a.alteradoEm).getTime() : 0;
          const db_ = b.alteradoEm ? new Date(b.alteradoEm).getTime() : 0;
          return db_ - da;
        });
      setItens(lista);
      if (lista.length === 0) setItens([{ _vazio: true }]);
    } catch(e:any) {
      setItens([{ _erro: e.message }]);
    }
    setLoading(false);
  };

  const fmtDt = (v: any) => {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return v; }
  };

  return (
    <div>
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:8 }}>
        {pick(T.intro)}
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <input value={busca} onChange={e=>setBusca(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&buscarHistorico()}
          placeholder='JET-SEC-...'
          style={{ flex:1, padding:'6px 10px', borderRadius:6, border:'1px solid #1c2535',
            background:'#111722', color:'#dce8ff', fontSize:10 }}/>
        <button onClick={buscarHistorico} disabled={loading}
          style={{ padding:'6px 12px', borderRadius:6, cursor:'pointer',
            background:'rgba(99,102,241,.15)', border:'1px solid rgba(99,102,241,.3)',
            color:'#818cf8', fontSize:11, fontWeight:600, whiteSpace:'nowrap' as const }}>
          {loading ? '⏳' : '🔍'}
        </button>
      </div>

      {itens.length > 0 && (
        <div style={{ marginTop:10 }}>
          {itens.map((it, i) => it._vazio ? (
            <div key={i} style={{ fontSize:10, color:'#4a5a7a', padding:'8px 0' }}>
              {pick(T.vazio)}
            </div>
          ) : it._erro ? (
            <div key={i} style={{ fontSize:10, color:'#f87171' }}>{pick(T.erro)} {it._erro}</div>
          ) : (
            <div key={it.id} style={{ padding:'8px 10px', marginBottom:6, borderRadius:8,
              background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:10, color:'#a78bfa', fontWeight:600 }}>
                  ✏️ {it.alteradoPor || pick(T.sistema)}
                </span>
                <span style={{ fontSize:9, color:'#4a5a7a' }}>{fmtDt(it.alteradoEm)}</span>
              </div>
              {it.campos && Object.entries(it.campos).map(([k, v]: any) => (
                <div key={k} style={{ fontSize:9, color:'rgba(255,255,255,.5)', lineHeight:1.6 }}>
                  <span style={{ color:'#60a5fa' }}>{k}:</span>{' '}
                  <span style={{ color:'#94a3b8', textDecoration:'line-through' }}>{String(v.de||'—')}</span>
                  {' → '}
                  <span style={{ color:'#dce8ff' }}>{String(v.para||'—')}</span>
                </div>
              ))}
              {it.motivo && (
                <div style={{ fontSize:9, color:'#fbbf24', marginTop:4 }}>
                  {pick(T.motivo)} {it.motivo}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Exportar Guard para Excel ──────────────────────────────────────────
function GuardExportExcel() {
  const { pick } = useLang();
  const T = {
    erroExport: { pt:'Erro ao exportar:', en:'Error exporting:', es:'Error al exportar:', ru:'Ошибка экспорта:' },
    sheetGuard: { pt:'Guard', en:'Guard', es:'Guard', ru:'Guard' },
    sheetResumo:{ pt:'Resumo por Cidade', en:'Summary by City', es:'Resumen por Ciudad', ru:'Сводка по городам' },
    desconhecida:{ pt:'Desconhecida', en:'Unknown', es:'Desconocida', ru:'Неизвестно' },
    introFiltros:{ pt:'Filtros opcionais — deixe em branco para exportar tudo', en:'Optional filters — leave blank to export everything', es:'Filtros opcionales — deje en blanco para exportar todo', ru:'Необязательные фильтры — оставьте пустыми для экспорта всего' },
    todosTipos: { pt:'Todos os tipos', en:'All types', es:'Todos los tipos', ru:'Все типы' },
    todosStatus:{ pt:'Todos os status', en:'All statuses', es:'Todos los estados', ru:'Все статусы' },
    filtrarCidade:{ pt:'Filtrar por cidade...', en:'Filter by city...', es:'Filtrar por ciudad...', ru:'Фильтр по городу...' },
    de:         { pt:'De', en:'From', es:'Desde', ru:'С' },
    ate:        { pt:'Até', en:'To', es:'Hasta', ru:'По' },
    gerando:    { pt:'⏳ Gerando...', en:'⏳ Generating...', es:'⏳ Generando...', ru:'⏳ Создание...' },
    expExcel:   { pt:'📊 Exportar Excel (.xlsx)', en:'📊 Export Excel (.xlsx)', es:'📊 Exportar Excel (.xlsx)', ru:'📊 Экспорт Excel (.xlsx)' },
    // cabeçalhos da planilha
    hID:        { pt:'ID', en:'ID', es:'ID', ru:'ID' },
    hData:      { pt:'Data', en:'Date', es:'Fecha', ru:'Дата' },
    hHora:      { pt:'Hora', en:'Time', es:'Hora', ru:'Время' },
    hTipo:      { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
    hStatus:    { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    hPrioridade:{ pt:'Prioridade', en:'Priority', es:'Prioridad', ru:'Приоритет' },
    hAtivoTipo: { pt:'Ativo Tipo', en:'Asset Type', es:'Tipo de Activo', ru:'Тип актива' },
    hAssetId:   { pt:'Asset ID', en:'Asset ID', es:'Asset ID', ru:'Asset ID' },
    hCidade:    { pt:'Cidade', en:'City', es:'Ciudad', ru:'Город' },
    hBairro:    { pt:'Bairro', en:'Neighborhood', es:'Barrio', ru:'Район' },
    hEndereco:  { pt:'Endereço', en:'Address', es:'Dirección', ru:'Адрес' },
    hResponsavel:{ pt:'Responsável', en:'Responsible', es:'Responsable', ru:'Ответственный' },
    hDescricao: { pt:'Descrição', en:'Description', es:'Descripción', ru:'Описание' },
    hObservacao:{ pt:'Observação', en:'Note', es:'Observación', ru:'Примечание' },
    hResultado: { pt:'Resultado', en:'Result', es:'Resultado', ru:'Результат' },
    hProcurando:{ pt:'Procurando', en:'Searching', es:'Buscando', ru:'В поиске' },
    hLat:       { pt:'Lat', en:'Lat', es:'Lat', ru:'Шир' },
    hLng:       { pt:'Lng', en:'Lng', es:'Lng', ru:'Долг' },
    colTotal:   { pt:'Total', en:'Total', es:'Total', ru:'Всего' },
  };
  const [carregando, setCarregando] = useState(false);
  const [filtros, setFiltros] = useState({
    tipo:   '',
    status: '',
    cidade: '',
    de:     '',
    ate:    '',
  });

  const exportar = async () => {
    setCarregando(true);
    try {
      // Carregar SheetJS
      const w = window as any;
      if (!w.XLSX) {
        await new Promise<void>((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = () => res(); s.onerror = () => rej(new Error('SheetJS falhou'));
          document.head.appendChild(s);
        });
      }

      // Buscar ocorrências com filtros — Fase 2 / Onda B: Supabase atrás de flag (read-only).
      let docs: any[] = guardProviderSupabase()
        ? await carregarOcorrenciasSupabase({ limit: 10000 })
        : (await getDocs(collection(db, 'ocorrencias'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      // Filtrar client-side
      if (filtros.tipo)   docs = docs.filter(d => d.tipo   === filtros.tipo);
      if (filtros.status) docs = docs.filter(d => d.status === filtros.status);
      if (filtros.cidade) docs = docs.filter(d => (d.cidade_inicial||'').toLowerCase().includes(filtros.cidade.toLowerCase()));
      if (filtros.de || filtros.ate) {
        docs = docs.filter(d => {
          const ts = d.criadoEm?.toDate?.() ? d.criadoEm.toDate()
            : d.criadoEm ? new Date(d.criadoEm)
            : d.created_at ? new Date(d.created_at) : null;
          if (!ts) return true;
          if (filtros.de  && ts < new Date(filtros.de))  return false;
          if (filtros.ate && ts > new Date(filtros.ate + 'T23:59:59')) return false;
          return true;
        });
      }

      // Montar linhas
      const rows = docs.map(d => {
        const ts = d.criadoEm?.toDate?.() ? d.criadoEm.toDate()
          : d.created_at ? new Date(d.created_at) : null;
        return {
          [pick(T.hID)]:         d.id || '',
          [pick(T.hData)]:       ts ? ts.toLocaleDateString('pt-BR') : '',
          [pick(T.hHora)]:       ts ? ts.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '',
          [pick(T.hTipo)]:       d.tipo || '',
          [pick(T.hStatus)]:     d.status || '',
          [pick(T.hPrioridade)]: d.prioridade || '',
          [pick(T.hAtivoTipo)]:  d.ativo_tipo || '',
          [pick(T.hAssetId)]:    d.asset_id || '',
          [pick(T.hCidade)]:     d.cidade_inicial || '',
          [pick(T.hBairro)]:     d.bairro_inicial || '',
          [pick(T.hEndereco)]:   d.endereco_inicial || '',
          [pick(T.hResponsavel)]:d.responsavel || '',
          [pick(T.hDescricao)]:  d.descricao || '',
          [pick(T.hObservacao)]: d.observacao_fechamento || '',
          [pick(T.hResultado)]:  d.resultado || '',
          [pick(T.hProcurando)]: d.procurando ? 'Sim' : '',
          [pick(T.hLat)]:        d.lat_inicial || '',
          [pick(T.hLng)]:        d.lng_inicial || '',
        };
      });

      const wb = w.XLSX.utils.book_new();
      const ws = w.XLSX.utils.json_to_sheet(rows);

      // Largura automática das colunas
      const colWidths = Object.keys(rows[0] || {}).map(k => ({
        wch: Math.max(k.length, ...rows.map((r: any) => String(r[k]||'').length).slice(0,50))
      }));
      ws['!cols'] = colWidths;

      w.XLSX.utils.book_append_sheet(wb, ws, pick(T.sheetGuard));

      // Segunda aba — resumo por cidade
      const porCidade: Record<string,number> = {};
      docs.forEach(d => { const c = d.cidade_inicial||pick(T.desconhecida); porCidade[c]=(porCidade[c]||0)+1; });
      const resumo = Object.entries(porCidade).sort((a,b)=>b[1]-a[1])
        .map(([c,n])=>({[pick(T.hCidade)]:c,[pick(T.colTotal)]:n}));
      const ws2 = w.XLSX.utils.json_to_sheet(resumo);
      w.XLSX.utils.book_append_sheet(wb, ws2, pick(T.sheetResumo));

      const data = new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
      w.XLSX.writeFile(wb, `guard_export_${data}.xlsx`);
    } catch(e:any) {
      alert(pick(T.erroExport) + ' ' + e.message);
    }
    setCarregando(false);
  };

  const inp: React.CSSProperties = {
    width:'100%', padding:'6px 10px', borderRadius:6, border:'1px solid #1c2535',
    background:'#111722', color:'#dce8ff', fontSize:10, boxSizing:'border-box' as const, marginBottom:8,
  };
  const sel: React.CSSProperties = { ...inp, cursor:'pointer' };

  return (
    <div>
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:8 }}>
        {pick(T.introFiltros)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
        <select value={filtros.tipo} onChange={e=>setFiltros(f=>({...f,tipo:e.target.value}))} style={sel}>
          <option value=''>{pick(T.todosTipos)}</option>
          {['Roubo','Furto','Vandalismo','Tentativa','Alarme','Recuperacao'].map(t=>(
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={filtros.status} onChange={e=>setFiltros(f=>({...f,status:e.target.value}))} style={sel}>
          <option value=''>{pick(T.todosStatus)}</option>
          {['Aberto','Em apuracao','Encerrado','Recuperado'].map(s=>(
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <input value={filtros.cidade} onChange={e=>setFiltros(f=>({...f,cidade:e.target.value}))}
        placeholder={pick(T.filtrarCidade)} style={inp}/>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
        <div>
          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.de)}</div>
          <input type='date' value={filtros.de} onChange={e=>setFiltros(f=>({...f,de:e.target.value}))} style={inp}/>
        </div>
        <div>
          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.ate)}</div>
          <input type='date' value={filtros.ate} onChange={e=>setFiltros(f=>({...f,ate:e.target.value}))} style={inp}/>
        </div>
      </div>
      <button onClick={exportar} disabled={carregando}
        style={{ width:'100%', padding:'10px', borderRadius:8, cursor:'pointer',
          background:'rgba(34,197,94,.1)', border:'1px solid rgba(34,197,94,.3)',
          color:'#4ade80', fontSize:12, fontWeight:600 }}>
        {carregando ? pick(T.gerando) : pick(T.expExcel)}
      </button>
    </div>
  );
}

// ── Auditoria de Incidente — alterar data/campos ───────────────────────
function GuardAuditoriaPanel() {
  const { pick } = useLang();
  const T = {
    naoEnc:    { pt:'Incidente não encontrado:', en:'Incident not found:', es:'Incidente no encontrado:', ru:'Инцидент не найден:' },
    erro:      { pt:'Erro:', en:'Error:', es:'Error:', ru:'Ошибка:' },
    salvoOk:   { pt:'✓ Incidente auditado e salvo com sucesso!', en:'✓ Incident audited and saved successfully!', es:'✓ ¡Incidente auditado y guardado con éxito!', ru:'✓ Инцидент проверен и успешно сохранён!' },
    erroSalvar:{ pt:'Erro ao salvar:', en:'Error saving:', es:'Error al guardar:', ru:'Ошибка сохранения:' },
    intro:     { pt:'Busque por ID do incidente (JET-SEC-...) ou Asset ID para editar data, tipo, status e outros campos.', en:'Search by incident ID (JET-SEC-...) or Asset ID to edit date, type, status and other fields.', es:'Busque por ID del incidente (JET-SEC-...) o Asset ID para editar fecha, tipo, estado y otros campos.', ru:'Найдите по ID инцидента (JET-SEC-...) или Asset ID, чтобы изменить дату, тип, статус и другие поля.' },
    idPh:      { pt:'ID ou Asset ID...', en:'ID or Asset ID...', es:'ID o Asset ID...', ru:'ID или Asset ID...' },
    buscar:    { pt:'🔍 Buscar', en:'🔍 Search', es:'🔍 Buscar', ru:'🔍 Поиск' },
    editando:  { pt:'✏️ Editando:', en:'✏️ Editing:', es:'✏️ Editando:', ru:'✏️ Редактирование:' },
    dataInc:   { pt:'📅 Data do incidente', en:'📅 Incident date', es:'📅 Fecha del incidente', ru:'📅 Дата инцидента' },
    tipo:      { pt:'Tipo', en:'Type', es:'Tipo', ru:'Тип' },
    status:    { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    assetId:   { pt:'Asset ID', en:'Asset ID', es:'Asset ID', ru:'Asset ID' },
    responsavel:{ pt:'Responsável', en:'Responsible', es:'Responsable', ru:'Ответственный' },
    cidade:    { pt:'Cidade', en:'City', es:'Ciudad', ru:'Город' },
    obsAudit:  { pt:'Observação de auditoria', en:'Audit note', es:'Observación de auditoría', ru:'Примечание аудита' },
    salvando:  { pt:'⏳ Salvando...', en:'⏳ Saving...', es:'⏳ Guardando...', ru:'⏳ Сохранение...' },
    salvarAudit:{ pt:'💾 Salvar auditoria', en:'💾 Save audit', es:'💾 Guardar auditoría', ru:'💾 Сохранить аудит' },
  };
  // Rótulos de exibição (valor interno PT inalterado — só o texto exibido muda)
  const tipoLabels: Record<string, TL> = {
    'Roubo':       { pt:'Roubo', en:'Robbery', es:'Robo', ru:'Грабёж' },
    'Furto':       { pt:'Furto', en:'Theft', es:'Hurto', ru:'Кража' },
    'Vandalismo':  { pt:'Vandalismo', en:'Vandalism', es:'Vandalismo', ru:'Вандализм' },
    'Tentativa':   { pt:'Tentativa', en:'Attempt', es:'Intento', ru:'Попытка' },
    'Alarme':      { pt:'Alarme', en:'Alarm', es:'Alarma', ru:'Тревога' },
    'Recuperacao': { pt:'Recuperação', en:'Recovery', es:'Recuperación', ru:'Восстановление' },
  };
  const statusLabels: Record<string, TL> = {
    'Aberto':       { pt:'Aberto', en:'Open', es:'Abierto', ru:'Открыто' },
    'Em apuracao':  { pt:'Em apuração', en:'Under investigation', es:'En investigación', ru:'На расследовании' },
    'Encerrado':    { pt:'Encerrado', en:'Closed', es:'Cerrado', ru:'Закрыто' },
    'Recuperado':   { pt:'Recuperado', en:'Recovered', es:'Recuperado', ru:'Восстановлено' },
  };
  const [busca,    setBusca]    = useState('');
  const [ocorr,    setOcorr]    = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg,      setMsg]      = useState('');
  const [form,     setForm]     = useState<any>({});

  const buscarIncidente = async () => {
    if (!busca.trim()) return;
    setOcorr(null); setMsg('');
    try {
      // Busca por ID exato ou asset_id — Fase 2 / Onda B: Supabase atrás de flag (read-only).
      if (guardProviderSupabase()) {
        const d = await buscarOcorrenciaSupabase(busca.trim());
        if (d) { setOcorr(d); setForm(d); return; }
        setMsg(pick(T.naoEnc) + ' ' + busca);
        return;
      }
      const snapId = await getDocs(query(collection(db,'ocorrencias'), where('id','==',busca.trim())));
      if (!snapId.empty) {
        const d = { id: snapId.docs[0].id, ...snapId.docs[0].data() };
        setOcorr(d); setForm(d); return;
      }
      const snapAsset = await getDocs(query(collection(db,'ocorrencias'), where('asset_id','==',busca.trim())));
      if (!snapAsset.empty) {
        const d = { id: snapAsset.docs[0].id, ...snapAsset.docs[0].data() };
        setOcorr(d); setForm(d); return;
      }
      setMsg(pick(T.naoEnc) + ' ' + busca);
    } catch(e:any) { setMsg(pick(T.erro) + ' ' + e.message); }
  };

  const salvarAuditoria = async () => {
    if (!ocorr) return;
    setSalvando(true); setMsg('');
    try {
      const ref = doc(collection(db,'ocorrencias'), ocorr.id);
      await updateDoc(ref, {
        tipo:          form.tipo,
        status:        form.status,
        prioridade:    form.prioridade,
        asset_id:      form.asset_id,
        descricao:     form.descricao,
        responsavel:   form.responsavel,
        cidade_inicial: form.cidade_inicial,
        bairro_inicial: form.bairro_inicial,
        // Data auditada — salva como string ISO para manter padrão
        created_at:    form.created_at_edit
          ? new Date(form.created_at_edit).toISOString()
          : (ocorr.created_at || null),
        auditado:      true,
        auditadoEm:    new Date().toISOString(),
        observacao_fechamento: form.observacao_fechamento,
      });
      if (guardWriteSupabase()) atualizarOcorrenciaSupabase(ocorr.id, {
        tipo: form.tipo, status: form.status, prioridade: form.prioridade, asset_id: form.asset_id,
        descricao: form.descricao, cidade_inicial: form.cidade_inicial, bairro_inicial: form.bairro_inicial,
        observacao_fechamento: form.observacao_fechamento,
      }).catch(err => console.error('[guard-write] update Supabase:', err));
      setMsg(pick(T.salvoOk));
    } catch(e:any) { setMsg(pick(T.erroSalvar) + ' ' + e.message); }
    setSalvando(false);
  };

  const inp: React.CSSProperties = {
    width:'100%', padding:'6px 10px', borderRadius:6, border:'1px solid #1c2535',
    background:'#111722', color:'#dce8ff', fontSize:10, boxSizing:'border-box' as const, marginBottom:6,
  };

  const fmtDateInput = (v: any) => {
    if (!v) return '';
    try { return new Date(v instanceof Object && v.toDate ? v.toDate() : v).toISOString().slice(0,16); }
    catch { return ''; }
  };

  return (
    <div>
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:8 }}>
        {pick(T.intro)}
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:10 }}>
        <input value={busca} onChange={e=>setBusca(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&buscarIncidente()}
          placeholder={pick(T.idPh)} style={{...inp, marginBottom:0, flex:1}}/>
        <button onClick={buscarIncidente}
          style={{ padding:'6px 12px', borderRadius:6, cursor:'pointer',
            background:'rgba(99,102,241,.15)', border:'1px solid rgba(99,102,241,.3)',
            color:'#818cf8', fontSize:11, fontWeight:600, whiteSpace:'nowrap' as const }}>
          {pick(T.buscar)}
        </button>
      </div>

      {ocorr && (
        <div style={{ background:'rgba(255,255,255,.03)', borderRadius:10,
          border:'1px solid rgba(255,255,255,.08)', padding:'12px' }}>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, marginBottom:10 }}>
            {pick(T.editando)} {ocorr.id}
          </div>

          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.dataInc)}</div>
          <input type='datetime-local' style={inp}
            defaultValue={fmtDateInput(ocorr.created_at || ocorr.criadoEm)}
            onChange={e=>setForm((f:any)=>({...f,created_at_edit:e.target.value}))}/>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.tipo)}</div>
              <select value={form.tipo||''} onChange={e=>setForm((f:any)=>({...f,tipo:e.target.value}))}
                style={{...inp, cursor:'pointer'}}>
                {['Roubo','Furto','Vandalismo','Tentativa','Alarme','Recuperacao'].map(t=>(
                  <option key={t} value={t}>{tipoLabels[t] ? pick(tipoLabels[t]) : t}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.status)}</div>
              <select value={form.status||''} onChange={e=>setForm((f:any)=>({...f,status:e.target.value}))}
                style={{...inp, cursor:'pointer'}}>
                {['Aberto','Em apuracao','Encerrado','Recuperado'].map(s=>(
                  <option key={s} value={s}>{statusLabels[s] ? pick(statusLabels[s]) : s}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.assetId)}</div>
              <input value={form.asset_id||''} onChange={e=>setForm((f:any)=>({...f,asset_id:e.target.value}))} style={inp}/>
            </div>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.responsavel)}</div>
              <input value={form.responsavel||''} onChange={e=>setForm((f:any)=>({...f,responsavel:e.target.value}))} style={inp}/>
            </div>
          </div>

          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.cidade)}</div>
          <input value={form.cidade_inicial||''} onChange={e=>setForm((f:any)=>({...f,cidade_inicial:e.target.value}))} style={inp}/>

          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>{pick(T.obsAudit)}</div>
          <textarea value={form.observacao_fechamento||''} rows={2}
            onChange={e=>setForm((f:any)=>({...f,observacao_fechamento:e.target.value}))}
            style={{...inp, resize:'vertical' as const}}/>

          <button onClick={salvarAuditoria} disabled={salvando}
            style={{ width:'100%', padding:'10px', borderRadius:8, cursor:'pointer', marginTop:4,
              background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.3)',
              color:'#a78bfa', fontSize:12, fontWeight:600 }}>
            {salvando ? pick(T.salvando) : pick(T.salvarAudit)}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ marginTop:8, padding:'8px 12px', borderRadius:8,
          background: msg.startsWith('✓') ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
          border: `1px solid ${msg.startsWith('✓') ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'}`,
          fontSize:11, color: msg.startsWith('✓') ? '#4ade80' : '#f87171' }}>
          {msg}
        </div>
      )}
    </div>
  );
}



// ── Painel de Usuários — aprovação + senha temporária ─────────────────
function UsuariosPanel() {
  const { pick } = useLang();
  const T = {
    whats:     { pt:'Olá! Seu acesso ao JET OS foi aprovado.\n\nE-mail: {EMAIL}\nSenha: {SENHA}\n\nAcesse: https://jet-os-7.web.app\n\nRecomendamos trocar a senha após o primeiro acesso.', en:'Hi! Your access to JET OS has been approved.\n\nEmail: {EMAIL}\nPassword: {SENHA}\n\nAccess: https://jet-os-7.web.app\n\nWe recommend changing your password after your first login.', es:'¡Hola! Su acceso a JET OS fue aprobado.\n\nCorreo: {EMAIL}\nContraseña: {SENHA}\n\nAcceda: https://jet-os-7.web.app\n\nRecomendamos cambiar la contraseña después del primer acceso.', ru:'Здравствуйте! Ваш доступ к JET OS одобрен.\n\nЭл. почта: {EMAIL}\nПароль: {SENHA}\n\nВход: https://jet-os-7.web.app\n\nРекомендуем сменить пароль после первого входа.' },
    erroAprovar:{ pt:'Erro ao aprovar:', en:'Error approving:', es:'Error al aprobar:', ru:'Ошибка одобрения:' },
    erro:      { pt:'Erro:', en:'Error:', es:'Error:', ru:'Ошибка:' },
    usuarioAprovado:{ pt:'✅ Usuário aprovado!', en:'✅ User approved!', es:'✅ ¡Usuario aprobado!', ru:'✅ Пользователь одобрен!' },
    copieCred: { pt:'Copie as credenciais e envie pelo WhatsApp.', en:'Copy the credentials and send via WhatsApp.', es:'Copie las credenciales y envíelas por WhatsApp.', ru:'Скопируйте учётные данные и отправьте через WhatsApp.' },
    email:     { pt:'E-mail', en:'Email', es:'Correo', ru:'Эл. почта' },
    senhaTemp: { pt:'Senha temporária', en:'Temporary password', es:'Contraseña temporal', ru:'Временный пароль' },
    copiado:   { pt:'✓ Copiado!', en:'✓ Copied!', es:'✓ ¡Copiado!', ru:'✓ Скопировано!' },
    copiarWhats:{ pt:'📱 Copiar mensagem para WhatsApp', en:'📱 Copy message for WhatsApp', es:'📱 Copiar mensaje para WhatsApp', ru:'📱 Скопировать сообщение для WhatsApp' },
    deveTrocar:{ pt:'O usuário deverá trocar a senha após o primeiro acesso.', en:'The user must change the password after the first login.', es:'El usuario deberá cambiar la contraseña después del primer acceso.', ru:'Пользователь должен сменить пароль после первого входа.' },
    fechar:    { pt:'Fechar', en:'Close', es:'Cerrar', ru:'Закрыть' },
    abaPend:   { pt:'⏳ Pendentes', en:'⏳ Pending', es:'⏳ Pendientes', ru:'⏳ Ожидают' },
    abaAtivos: { pt:'✅ Ativos', en:'✅ Active', es:'✅ Activos', ru:'✅ Активные' },
    carregando:{ pt:'Carregando...', en:'Loading...', es:'Cargando...', ru:'Загрузка...' },
    nenhumaPend:{ pt:'Nenhuma solicitação pendente.', en:'No pending requests.', es:'Ninguna solicitud pendiente.', ru:'Нет ожидающих заявок.' },
    aprovarComo:{ pt:'Aprovar como:', en:'Approve as:', es:'Aprobar como:', ru:'Одобрить как:' },
    rCampo:    { pt:'Campo', en:'Field', es:'Campo', ru:'Поле' },
    rGuard:    { pt:'Guard', en:'Guard', es:'Guard', ru:'Guard' },
    rGestSeg:  { pt:'Gest. Seg', en:'Sec. Mgr', es:'Ges. Seg', ru:'Менедж. без.' },
    rGestor:   { pt:'Gestor', en:'Manager', es:'Gestor', ru:'Менеджер' },
    rejeitar:  { pt:'✗ Rejeitar', en:'✗ Reject', es:'✗ Rechazar', ru:'✗ Отклонить' },
    buscarPh:  { pt:'🔍 Buscar por nome ou e-mail...', en:'🔍 Search by name or email...', es:'🔍 Buscar por nombre o correo...', ru:'🔍 Поиск по имени или эл. почте...' },
    todosRoles:{ pt:'Todos os roles', en:'All roles', es:'Todos los roles', ru:'Все роли' },
    usuarioEnc:{ pt:'usuário', en:'user', es:'usuario', ru:'пользователь' },
    usuariosEnc:{ pt:'usuários', en:'users', es:'usuarios', ru:'пользователей' },
    encontrado:{ pt:'encontrado', en:'found', es:'encontrado', ru:'найден' },
    encontrados:{ pt:'encontrados', en:'found', es:'encontrados', ru:'найдено' },
    nenhumUsuario:{ pt:'Nenhum usuário encontrado.', en:'No user found.', es:'Ningún usuario encontrado.', ru:'Пользователи не найдены.' },
    cidadesBtn:{ pt:'Cidades', en:'Cities', es:'Ciudades', ru:'Города' },
    cidAbrev:  { pt:'cid.', en:'cit.', es:'ciud.', ru:'гор.' },
  };
  const roleAprovarLabels: Record<string, TL> = { campo: T.rCampo, guard: T.rGuard, gestor_seg: T.rGestSeg, gestor: T.rGestor };
  const [solicitacoes, setSolicitacoes] = useState<any[]>([]);
  const [usuarios,     setUsuarios]     = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [senhaTemp,    setSenhaTemp]    = useState<{uid:string;email:string;senha:string}|null>(null);
  const [copiado,      setCopiado]      = useState(false);
  const [aba,          setAbaU]         = useState<'pendentes'|'ativos'>('pendentes');
  const [busca,        setBusca]        = useState('');
  const [filtroRole,   setFiltroRole]   = useState('todos');
  const [cidadeViewerModal, setCidadeViewerModal] = useState<any | null>(null);

  // Gera senha temporária forte
  const gerarSenha = () => {
    const letras  = 'abcdefghjkmnpqrstuvwxyz';
    const maiusc  = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const nums    = '23456789';
    const especiais = '@#$!';
    let s = '';
    s += maiusc[Math.floor(Math.random()*maiusc.length)];
    s += nums[Math.floor(Math.random()*nums.length)];
    s += especiais[Math.floor(Math.random()*especiais.length)];
    for (let i = 0; i < 6; i++) s += letras[Math.floor(Math.random()*letras.length)];
    return s.split('').sort(() => Math.random()-.5).join('');
  };

  useEffect(() => {
    const carregarDados = async () => {
      setLoading(true);
      try {
        // Solicitações pendentes
        const snapSol = await getDocs(query(
          collection(db,'solicitacoes'), where('status','==','pendente')
        ));
        setSolicitacoes(snapSol.docs.map(d => ({ id: d.id, ...d.data() })));
        // Usuários ativos
        if (usuariosReadSupabase()) {
          const users = await fetchUsuarios();
          setUsuarios(users.map(u => ({ ...u, id: u.uid })));
        } else {
          const snapUs = await getDocs(collection(db,'usuarios'));
          setUsuarios(snapUs.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch(e) { console.error(e); }
      setLoading(false);
    };
    carregarDados();
  }, []);

  const aprovar = async (sol: any, role: string) => {
    try {
      const senhaGerada = gerarSenha();
      // Chama CF para aprovar e criar usuário Firebase Auth
      const { functionsProviderSupabase, getEdgeCallable } = await import('./lib/edge-functions');
      let fnAprovar: any;
      if (functionsProviderSupabase()) {
        const edge = getEdgeCallable('aprovarSolicitacaoFn');
        fnAprovar = edge ? edge() : null;
      }
      if (!fnAprovar) {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const { getApp } = await import('firebase/app');
        fnAprovar = httpsCallable(getFunctions(getApp(), 'southamerica-east1'), 'aprovarSolicitacaoFn');
      }
      const res = await fnAprovar({ solicitacaoId: sol.id, role, senhaTemporaria: senhaGerada }) as any;
      const uid = res.data?.uid || sol.id;

      // Marcar senhaTemporaria: true para forçar troca no primeiro acesso
      try {
        const { doc: fsDoc, updateDoc, collection: col } = await import('firebase/firestore');
        await updateDoc(fsDoc(col(db,'usuarios'), uid), { senhaTemporaria: true, role });
      } catch { /* ignora se o doc ainda não existe */ }

      setSenhaTemp({ uid, email: sol.email, senha: senhaGerada });
      setSolicitacoes(s => s.filter(x => x.id !== sol.id));
    } catch(e:any) {
      alert(pick(T.erroAprovar) + ' ' + e.message);
    }
  };

  const alterarRole = async (uid: string, novoRole: string) => {
    try {
      await updateDoc(doc(collection(db,'usuarios'), uid), { role: novoRole });
      setUsuarios(u => u.map(x => x.id === uid ? { ...x, role: novoRole } : x));
    } catch(e:any) { alert(pick(T.erro) + ' ' + e.message); }
  };

  const copiarWhats = (email: string, senha: string) => {
    const txt = pick(T.whats).replace('{EMAIL}', email).replace('{SENHA}', senha);
    navigator.clipboard.writeText(txt).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2500); });
  };

  const sec: React.CSSProperties = { padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,.06)' };
  const hdr: React.CSSProperties = { fontSize:9, color:'#4a5a7a', textTransform:'uppercase' as const, letterSpacing:.5, marginBottom:8, fontWeight:700 };
  const ROLE_CORES: Record<string,string> = { admin:'#f87171', gestor:'#fbbf24', campo:'#60a5fa', guard:'#a78bfa', viewer:'#3b82f6', supergestor:'#f59e0b', gestor_seg:'#f97316' };

  return (
    <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:'#1c2535 transparent' }}>

      {/* Modal cidades viewer */}
      {cidadeViewerModal && (
        <CidadeViewerModal
          usuario={cidadeViewerModal}
cidadesDisponiveis={[...new Set<string>(
  (window as any).__jetCidadesReais || ['São Paulo']
)]}
          onFechar={() => setCidadeViewerModal(null)}
          onSalvo={(novasCidades: string[]) => {
            setUsuarios(u => u.map(x =>
              x.id === cidadeViewerModal.id
                ? { ...x, cidadesPermitidas: novasCidades }
                : x
            ));
            setCidadeViewerModal(null);
          }}
        />
      )}

      {/* Modal senha temporária */}
      {senhaTemp && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.8)', zIndex:9999,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#0d1521', border:'1px solid rgba(255,255,255,.1)',
            borderRadius:16, padding:24, width:'100%', maxWidth:380 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#4ade80', marginBottom:4 }}>
              {pick(T.usuarioAprovado)}
            </div>
            <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:16 }}>
              {pick(T.copieCred)}
            </div>

            <div style={{ background:'rgba(255,255,255,.04)', borderRadius:10,
              padding:'12px 14px', marginBottom:14,
              border:'1px solid rgba(255,255,255,.08)' }}>
              <div style={{ fontSize:10, color:'#4a5a7a', marginBottom:4 }}>{pick(T.email)}</div>
              <div style={{ fontSize:13, color:'#dce8ff', fontWeight:600 }}>{senhaTemp.email}</div>
              <div style={{ fontSize:10, color:'#4a5a7a', marginTop:10, marginBottom:4 }}>{pick(T.senhaTemp)}</div>
              <div style={{ fontSize:20, color:'#fbbf24', fontWeight:800,
                fontFamily:'monospace', letterSpacing:2 }}>{senhaTemp.senha}</div>
            </div>

            <button onClick={() => copiarWhats(senhaTemp.email, senhaTemp.senha)}
              style={{ width:'100%', padding:'11px', borderRadius:10, cursor:'pointer',
                background: copiado ? 'rgba(74,222,128,.15)' : 'rgba(37,211,102,.15)',
                border: `1px solid ${copiado ? 'rgba(74,222,128,.4)' : 'rgba(37,211,102,.3)'}`,
                color: copiado ? '#4ade80' : '#25d366',
                fontSize:13, fontWeight:700, marginBottom:8 }}>
              {copiado ? pick(T.copiado) : pick(T.copiarWhats)}
            </button>

            <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:12, textAlign:'center' }}>
              {pick(T.deveTrocar)}
            </div>

            <button onClick={() => setSenhaTemp(null)}
              style={{ width:'100%', padding:'9px', borderRadius:10, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>
              {pick(T.fechar)}
            </button>
          </div>
        </div>
      )}

      {/* Abas */}
      <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
        {([['pendentes',pick(T.abaPend),solicitacoes.length],['ativos',pick(T.abaAtivos),usuarios.length]] as any[]).map(([k,l,n]) => (
          <button key={k} onClick={() => setAbaU(k)}
            style={{ flex:1, padding:'10px 8px', border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
              background:'transparent', borderBottom:`2px solid ${aba===k?'#60a5fa':'transparent'}`,
              color: aba===k ? '#60a5fa' : 'rgba(255,255,255,.4)' }}>
            {l} {n > 0 && <span style={{ fontSize:9, background:'rgba(96,165,250,.2)',
              padding:'1px 5px', borderRadius:8, marginLeft:4 }}>{n}</span>}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>{pick(T.carregando)}</div>
      )}

      {/* Solicitações pendentes */}
      {aba === 'pendentes' && !loading && (
        <div>
          {solicitacoes.length === 0 ? (
            <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>
              {pick(T.nenhumaPend)}
            </div>
          ) : solicitacoes.map(sol => (
            <div key={sol.id} style={{ ...sec }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff', marginBottom:2 }}>{sol.nome || sol.email}</div>
              <div style={{ fontSize:10, color:'#4a5a7a', marginBottom:8 }}>{sol.email} · {sol.cargo || ''} · {sol.empresa || ''}</div>
              {sol.motivo && <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', marginBottom:10,
                padding:'6px 10px', background:'rgba(255,255,255,.03)', borderRadius:6 }}>{sol.motivo}</div>}
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:6 }}>{pick(T.aprovarComo)}</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                {['campo','guard','gestor_seg','gestor'].map((r) => (
                  <button key={r} onClick={() => aprovar(sol, r)}
                    style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                      background:`${(ROLE_CORES[r]||'#f97316')}15`, border:`1px solid ${(ROLE_CORES[r]||'#f97316')}40`,
                      color: ROLE_CORES[r]||'#f97316' }}>
                    ✓ {pick(roleAprovarLabels[r])}
                  </button>
                ))}
                <button onClick={async () => {
                  await updateDoc(doc(collection(db,'solicitacoes'),sol.id),{status:'rejeitada'});
                  setSolicitacoes(s => s.filter(x => x.id !== sol.id));
                }} style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:11,
                  background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', color:'#f87171' }}>
                  {pick(T.rejeitar)}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Usuários ativos */}
      {aba === 'ativos' && !loading && (
        <div>
          {/* Busca + filtro de role */}
          <div style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,.06)',
            display:'flex', gap:8, flexWrap:'wrap' as const }}>
            <input
              value={busca} onChange={e => setBusca(e.target.value)}
              placeholder={pick(T.buscarPh)}
              style={{ flex:1, minWidth:140, padding:'7px 10px', borderRadius:8,
                border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.05)',
                color:'#dce8ff', fontSize:11, outline:'none' }}
            />
            <select value={filtroRole} onChange={e => setFiltroRole(e.target.value)}
              style={{ padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,.1)',
                background:'#111722', color:'#dce8ff', fontSize:11, cursor:'pointer' }}>
              <option value="todos">{pick(T.todosRoles)}</option>
              {['viewer','campo','guard','gestor','supergestor','admin'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {/* Contador */}
          {(() => {
            const filtrados = usuarios
              .filter(u => filtroRole === 'todos' || u.role === filtroRole)
              .filter(u => {
                if (!busca.trim()) return true;
                const b = busca.toLowerCase();
                return (u.nome||'').toLowerCase().includes(b) || (u.email||'').toLowerCase().includes(b);
              })
              .sort((a,b) => (a.email||'').localeCompare(b.email||''));
            return (
              <>
                <div style={{ padding:'4px 12px', fontSize:9, color:'#4a5a7a' }}>
                  {filtrados.length} {filtrados.length !== 1 ? pick(T.usuariosEnc) : pick(T.usuarioEnc)} {filtrados.length !== 1 ? pick(T.encontrados) : pick(T.encontrado)}
                </div>
                {filtrados.length === 0 ? (
                  <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>
                    {pick(T.nenhumUsuario)}
                  </div>
                ) : filtrados.map(u => (
                  <div key={u.id} style={{ ...sec, display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'#dce8ff',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>
                        {u.nome || u.email}
                      </div>
                      <div style={{ fontSize:9, color:'#4a5a7a' }}>{u.email}</div>
                    </div>
                    <div style={{ fontSize:9, padding:'2px 7px', borderRadius:6,
                      background:`${ROLE_CORES[u.role] || '#4a5a7a'}20`,
                      border:`1px solid ${ROLE_CORES[u.role] || '#4a5a7a'}40`,
                      color: ROLE_CORES[u.role] || '#4a5a7a', fontWeight:700, flexShrink:0 }}>
                      {u.role || 'viewer'}
                    </div>
                    <select value={u.role || 'viewer'} onChange={e => alterarRole(u.id, e.target.value)}
                      style={{ padding:'4px 6px', borderRadius:6, border:'1px solid #1c2535',
                        background:'#111722', color:'rgba(255,255,255,.5)',
                        fontSize:10, cursor:'pointer' }}>
                      {['viewer','campo','guard','gestor_seg','gestor','supergestor','admin'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {/* Cidades viewer */}
                    {(u.role === 'viewer') && (
                      <button
                        onClick={() => setCidadeViewerModal(u)}
                        style={{ padding:'4px 8px', borderRadius:6, border:'1px solid rgba(59,130,246,.3)',
                          background:'rgba(59,130,246,.1)', color:'#60a5fa',
                          fontSize:10, cursor:'pointer', whiteSpace:'nowrap' as const }}>
                        🏙 {u.cidadesPermitidas?.length ? u.cidadesPermitidas.length + ' ' + pick(T.cidAbrev) : pick(T.cidadesBtn)}
                      </button>
                    )}
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}


// ── GRÁFICO DE ESTAÇÕES ──────────────────────────────────────────
function GraficoEstacoes({ estacoes, cidade }: { estacoes: any[]; cidade: string }) {
  const { pick } = useLang();
  const T = {
    tPublica:    { pt:'Pública', en:'Public', es:'Pública', ru:'Публичная' },
    tPrivada:    { pt:'Privada', en:'Private', es:'Privada', ru:'Частная' },
    tConcorrente:{ pt:'Concorrente', en:'Competitor', es:'Competidor', ru:'Конкурент' },
    sSolicitado: { pt:'Solicitado', en:'Requested', es:'Solicitado', ru:'Запрошено' },
    sAprovado:   { pt:'Aprovado', en:'Approved', es:'Aprobado', ru:'Одобрено' },
    sInstalado:  { pt:'Instalado', en:'Installed', es:'Instalado', ru:'Установлено' },
    sReprovado:  { pt:'Reprovado', en:'Rejected', es:'Rechazado', ru:'Отклонено' },
    sCancelado:  { pt:'Cancelado', en:'Cancelled', es:'Cancelado', ru:'Отменено' },
    analiseTit:  { pt:'📊 Análise de Estações', en:'📊 Station Analysis', es:'📊 Análisis de Estaciones', ru:'📊 Анализ станций' },
    todasCidades:{ pt:'— Todas as cidades', en:'— All cities', es:'— Todas las ciudades', ru:'— Все города' },
    pDia:        { pt:'Diário', en:'Daily', es:'Diario', ru:'Ежедневно' },
    pSemana:     { pt:'Semanal', en:'Weekly', es:'Semanal', ru:'Еженедельно' },
    pMes:        { pt:'Mensal', en:'Monthly', es:'Mensual', ru:'Ежемесячно' },
    pAno:        { pt:'Anual', en:'Annual', es:'Anual', ru:'Ежегодно' },
    pCustom:     { pt:'Personalizado', en:'Custom', es:'Personalizado', ru:'Свой период' },
    ate:         { pt:'até', en:'to', es:'hasta', ru:'по' },
    porTipo:     { pt:'Por tipo', en:'By type', es:'Por tipo', ru:'По типу' },
    porStatus:   { pt:'Por status', en:'By status', es:'Por estado', ru:'По статусу' },
    evolucao:    { pt:'Evolução por status no período', en:'Status evolution over the period', es:'Evolución por estado en el período', ru:'Динамика по статусу за период' },
    totalLabel:  { pt:'Total:', en:'Total:', es:'Total:', ru:'Всего:' },
    estacoes:    { pt:'estações', en:'stations', es:'estaciones', ru:'станций' },
  };
  const [periodo, setPeriodo] = useState<'dia'|'semana'|'mes'|'ano'|'custom'>('mes');
  const [customDe, setCustomDe] = useState('');
  const [customAte, setCustomAte] = useState('');

  const filtradas = cidade ? estacoes.filter(e => e.cidade === cidade) : estacoes;

  // Contagem por tipo
  const porTipo = [
    { label:pick(T.tPublica),      cor:'#3b82f6', count: filtradas.filter(e=>e.tipo==='PUBLICA').length },
    { label:pick(T.tPrivada),      cor:'#a78bfa', count: filtradas.filter(e=>e.tipo==='PRIVADA').length },
    { label:pick(T.tConcorrente),  cor:'#f97316', count: filtradas.filter(e=>e.tipo==='CONCORRENTE').length },
  ];
  const total = filtradas.length;

  // Contagem por status
  const porStatus = [
    { label:pick(T.sSolicitado),  cor:'#fbbf24', count: filtradas.filter(e=>e.status==='SOLICITADO').length },
    { label:pick(T.sAprovado),    cor:'#60a5fa', count: filtradas.filter(e=>e.status==='APROVADO').length },
    { label:pick(T.sInstalado),   cor:'#4ade80', count: filtradas.filter(e=>e.status==='INSTALADO').length },
    { label:pick(T.sReprovado),   cor:'#f87171', count: filtradas.filter(e=>e.status==='REPROVADO').length },
    { label:pick(T.sCancelado),   cor:'#6b7280', count: filtradas.filter(e=>e.status==='CANCELADO').length },
  ];

  // Série temporal — agrupar por período
  const agora = new Date();
  const getDataEstacao = (e: any): Date | null => {
    try {
      if (e.criadoEm?.toDate) return e.criadoEm.toDate();
      if (e.criadoEm) return new Date(e.criadoEm);
      if (e.importadoEm) return new Date(e.importadoEm);
    } catch {}
    return null;
  };

  const getLabel = (d: Date) => {
    if (periodo === 'dia') return d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit'});
    if (periodo === 'semana') {
      const start = new Date(d); start.setDate(d.getDate() - d.getDay());
      return start.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    }
    if (periodo === 'mes') return d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
    return String(d.getFullYear());
  };

  const getDaysBack = () => {
    if (periodo==='dia')    return 14;
    if (periodo==='semana') return 84;
    if (periodo==='mes')    return 365;
    return 365*3;
  };

  const limite = new Date(agora.getTime() - getDaysBack()*86400000);
  const comData = filtradas
    .map(e => ({ e, d: getDataEstacao(e) }))
    .filter(x => x.d && x.d >= limite);

  const grupos: Record<string,number> = {};
  comData.forEach(({ d }) => {
    const k = getLabel(d!);
    grupos[k] = (grupos[k]||0) + 1;
  });
  const serie = Object.entries(grupos).slice(-20);
  const maxVal = Math.max(...serie.map(([,v])=>v), 1);

  const card: React.CSSProperties = {
    background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)',
    borderRadius:12, padding:'14px 16px',
  };

  return (
    <div style={{ padding:'16px', fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff', marginBottom:16 }}>
        {pick(T.analiseTit)} {cidade ? `— ${cidade}` : pick(T.todasCidades)}
      </div>

      {/* Seletor de período */}
      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' as const }}>
        {([['dia',pick(T.pDia)],['semana',pick(T.pSemana)],['mes',pick(T.pMes)],['ano',pick(T.pAno)],['custom',pick(T.pCustom)]] as const).map(([k,l]) => (
          <button key={k} onClick={()=>setPeriodo(k)}
            style={{ padding:'5px 10px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
              background: periodo===k?'rgba(59,130,246,.2)':'rgba(255,255,255,.04)',
              border:`1px solid ${periodo===k?'rgba(59,130,246,.5)':'rgba(255,255,255,.08)'}`,
              color: periodo===k?'#60a5fa':'rgba(255,255,255,.4)' }}>
            {l}
          </button>
        ))}
      </div>
      {periodo==='custom' && (
        <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
          <input type="date" value={customDe} onChange={e=>setCustomDe(e.target.value)}
            style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,.05)',
              border:'1px solid rgba(255,255,255,.1)', color:'#dce8ff', fontSize:12, colorScheme:'dark' as any }}/>
          <span style={{ color:'#4a5a7a', fontSize:12 }}>{pick(T.ate)}</span>
          <input type="date" value={customAte} onChange={e=>setCustomAte(e.target.value)}
            style={{ padding:'6px 10px', borderRadius:8, background:'rgba(255,255,255,.05)',
              border:'1px solid rgba(255,255,255,.1)', color:'#dce8ff', fontSize:12, colorScheme:'dark' as any }}/>
        </div>
      )}

      {/* Cards resumo */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:16 }}>
        {porTipo.map(t => (
          <div key={t.label} style={{ ...card, textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:900, color:t.cor }}>{t.count}</div>
            <div style={{ fontSize:10, color:'#4a5a7a', marginTop:2 }}>{t.label}</div>
            <div style={{ fontSize:9, color:'rgba(255,255,255,.2)' }}>
              {total ? Math.round(t.count/total*100) : 0}%
            </div>
          </div>
        ))}
      </div>

      {/* Barras por tipo */}
      <div style={{ ...card, marginBottom:12 }}>
        <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.5)', marginBottom:10 }}>{pick(T.porTipo)}</div>
        {porTipo.map(t => (
          <div key={t.label} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ fontSize:11, color:'#dce8ff' }}>{t.label}</span>
              <span style={{ fontSize:11, color:t.cor, fontWeight:700 }}>{t.count}</span>
            </div>
            <div style={{ height:6, borderRadius:3, background:'rgba(255,255,255,.06)' }}>
              <div style={{ height:'100%', borderRadius:3, background:t.cor,
                width: total ? `${(t.count/total)*100}%` : '0%', transition:'width .4s' }}/>
            </div>
          </div>
        ))}
      </div>

      {/* Barras por status */}
      <div style={{ ...card, marginBottom:12 }}>
        <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.5)', marginBottom:10 }}>{pick(T.porStatus)}</div>
        {porStatus.filter(s=>s.count>0).map(s => (
          <div key={s.label} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ fontSize:11, color:'#dce8ff' }}>{s.label}</span>
              <span style={{ fontSize:11, color:s.cor, fontWeight:700 }}>{s.count}</span>
            </div>
            <div style={{ height:6, borderRadius:3, background:'rgba(255,255,255,.06)' }}>
              <div style={{ height:'100%', borderRadius:3, background:s.cor,
                width: total ? `${(s.count/total)*100}%` : '0%', transition:'width .4s' }}/>
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico de linhas — todos os status por período */}
      {serie.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.5)' }}>
              {pick(T.evolucao)}
            </div>
            <div style={{ fontSize:9, color:'#4a5a7a' }}>
              {pick(T.totalLabel)} {filtradas.length} {pick(T.estacoes)}
            </div>
          </div>

          {/* Legenda */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' as const, marginBottom:10 }}>
            {porStatus.map(s => (
              <div key={s.label} style={{ display:'flex', alignItems:'center', gap:4, fontSize:9 }}>
                <div style={{ width:12, height:3, borderRadius:2, background:s.cor }}/>
                <span style={{ color:'rgba(255,255,255,.5)' }}>{s.label} ({s.count})</span>
              </div>
            ))}
          </div>

          {/* SVG linha chart */}
          {(() => {
            const STATUS_LIST = [
              { key:'SOLICITADO', cor:'#fbbf24' },
              { key:'APROVADO',   cor:'#60a5fa' },
              { key:'INSTALADO',  cor:'#4ade80' },
              { key:'REPROVADO',  cor:'#f87171' },
              { key:'CANCELADO',  cor:'#6b7280' },
            ];
            // Agrupar por período e status
            const gruposPorStatus: Record<string, Record<string,number>> = {};
            STATUS_LIST.forEach(s => { gruposPorStatus[s.key] = {}; });
            comData.forEach(({ e, d }) => {
              const k = getLabel(d!);
              const st = (e?.status || '').toUpperCase();
              if (gruposPorStatus[st]) {
                gruposPorStatus[st][k] = (gruposPorStatus[st][k]||0) + 1;
              }
            });
            const labels = serie.map(([l])=>l);
            const W = 480, H = 120, PAD = 24;
            const allVals = STATUS_LIST.flatMap(s => labels.map(l => gruposPorStatus[s.key][l]||0));
            const maxV = Math.max(...allVals, 1);
            const xStep = labels.length > 1 ? (W - PAD*2) / (labels.length-1) : W - PAD*2;
            const getY = (v: number) => H - PAD - ((v/maxV) * (H - PAD*2));
            const getX = (i: number) => PAD + i * xStep;
            return (
              <div style={{ overflowX:'auto' }}>
                <svg width={Math.max(W, labels.length*40)} height={H+20}
                  style={{ display:'block', width:'100%' }}>
                  {/* Grid */}
                  {[0,.25,.5,.75,1].map(f => (
                    <line key={f}
                      x1={PAD} y1={getY(maxV*f)}
                      x2={W-PAD} y2={getY(maxV*f)}
                      stroke="rgba(255,255,255,.05)" strokeWidth={1}/>
                  ))}
                  {/* Linhas por status */}
                  {STATUS_LIST.map(s => {
                    const vals = labels.map(l => gruposPorStatus[s.key][l]||0);
                    if (vals.every(v=>v===0)) return null;
                    const pts = vals.map((v,i) => `${getX(i)},${getY(v)}`).join(' ');
                    return (
                      <g key={s.key}>
                        <polyline
                          points={pts}
                          fill="none" stroke={s.cor} strokeWidth={2}
                          strokeLinejoin="round" strokeLinecap="round"
                          opacity={0.85}/>
                        {vals.map((v,i) => v > 0 && (
                          <circle key={i} cx={getX(i)} cy={getY(v)} r={3}
                            fill={s.cor} opacity={0.9}/>
                        ))}
                      </g>
                    );
                  })}
                  {/* Eixo X labels */}
                  {labels.map((l,i) => (
                    <text key={l} x={getX(i)} y={H+14} textAnchor="middle"
                      fill="rgba(255,255,255,.25)" fontSize={7}>{l}</text>
                  ))}
                  {/* Eixo Y labels */}
                  {[0, Math.round(maxV/2), maxV].map(v => (
                    <text key={v} x={PAD-3} y={getY(v)+3} textAnchor="end"
                      fill="rgba(255,255,255,.25)" fontSize={7}>{v}</text>
                  ))}
                </svg>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}


// ── CidadeViewerModal ─────────────────────────────────────────────────────────
function CidadeViewerModal({ usuario, cidadesDisponiveis, onFechar, onSalvo }: {
  usuario: any;
  cidadesDisponiveis: string[];
  onFechar: () => void;
  onSalvo: (cidades: string[]) => void;
}) {
  const { pick } = useLang();
  const T = {
    erro:        { pt:'Erro:', en:'Error:', es:'Error:', ru:'Ошибка:' },
    titulo:      { pt:'🏙 Cidades permitidas', en:'🏙 Allowed cities', es:'🏙 Ciudades permitidas', ru:'🏙 Разрешённые города' },
    carregando:  { pt:'Carregando cidades...', en:'Loading cities...', es:'Cargando ciudades...', ru:'Загрузка городов...' },
    cancelar:    { pt:'Cancelar', en:'Cancel', es:'Cancelar', ru:'Отмена' },
    salvando:    { pt:'⏳ Salvando...', en:'⏳ Saving...', es:'⏳ Guardando...', ru:'⏳ Сохранение...' },
    salvar:      { pt:'💾 Salvar', en:'💾 Save', es:'💾 Guardar', ru:'💾 Сохранить' },
    cidades:     { pt:'cidades', en:'cities', es:'ciudades', ru:'городов' },
  };
  const [selecionadas, setSelecionadas] = useState<string[]>(usuario.cidadesPermitidas || []);
  const [salvando, setSalvando] = useState(false);
  const [cidadesReais, setCidadesReais] = useState<string[]>(cidadesDisponiveis);

  // Busca cidades reais do Firestore
  useEffect(() => {
    getDocs(collection(db, 'estacoes')).then(snap => {
      const set = new Set<string>();
      snap.docs.forEach(d => {
        const c = d.data().cidade;
        if (c) set.add(c.trim());
      });
      const lista = Array.from(set).sort();
      if (lista.length > 0) setCidadesReais(lista);
    }).catch(() => {});
  }, []);

  const toggle = (cidade: string) => {
    setSelecionadas(prev =>
      prev.includes(cidade) ? prev.filter(c => c !== cidade) : [...prev, cidade]
    );
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      await updateDoc(doc(collection(db, 'usuarios'), usuario.id), {
        cidadesPermitidas: selecionadas
      });
      onSalvo(selecionadas);
    } catch(e: any) {
      alert(pick(T.erro) + ' ' + e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#0d1521', border:'1px solid rgba(59,130,246,.2)',
        borderRadius:16, padding:24, width:'100%', maxWidth:400 }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#60a5fa', marginBottom:4 }}>
          {pick(T.titulo)}
        </div>
        <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:16 }}>
          {usuario.nome || usuario.email}
        </div>

        {cidadesReais.length === 0 ? (
          <div style={{ color:'#4a5a7a', fontSize:12, marginBottom:16 }}>
            {pick(T.carregando)}
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:16,
            maxHeight:300, overflowY:'auto' }}>
            {cidadesReais.map(cidade => (
              <label key={cidade} style={{ display:'flex', alignItems:'center', gap:8,
                cursor:'pointer', padding:'6px 8px', borderRadius:6,
                background: selecionadas.includes(cidade) ? 'rgba(59,130,246,.15)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${selecionadas.includes(cidade) ? 'rgba(59,130,246,.3)' : 'rgba(255,255,255,.06)'}` }}>
                <input type="checkbox"
                  checked={selecionadas.includes(cidade)}
                  onChange={() => toggle(cidade)}
                  style={{ accentColor:'#3b82f6', cursor:'pointer' }}
                />
                <span style={{ fontSize:12, color: selecionadas.includes(cidade) ? '#60a5fa' : 'rgba(255,255,255,.6)' }}>
                  {cidade}
                </span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onFechar}
            style={{ flex:1, padding:'8px', borderRadius:8, border:'1px solid rgba(255,255,255,.1)',
              background:'rgba(255,255,255,.05)', color:'rgba(255,255,255,.5)',
              fontSize:12, cursor:'pointer' }}>
            {pick(T.cancelar)}
          </button>
          <button onClick={salvar} disabled={salvando}
            style={{ flex:2, padding:'8px', borderRadius:8, border:'none',
              background: salvando ? 'rgba(59,130,246,.4)' : '#3b82f6',
              color:'#fff', fontSize:12, fontWeight:700, cursor: salvando ? 'not-allowed' : 'pointer' }}>
            {salvando ? pick(T.salvando) : `${pick(T.salvar)} (${selecionadas.length} ${pick(T.cidades)})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardManager({ cidades, pais, onFechar, roleAtual }: Props) {
  const { pick } = useLang();
  const T = {
    // logs de importação XLSX
    lendoXlsx:   { pt:'Lendo XLSX...', en:'Reading XLSX...', es:'Leyendo XLSX...', ru:'Чтение XLSX...' },
    encontradas: { pt:'Encontradas:', en:'Found:', es:'Encontradas:', ru:'Найдено:' },
    entradas:    { pt:'entradas', en:'entries', es:'entradas', ru:'записей' },
    validas:     { pt:'Válidas:', en:'Valid:', es:'Válidas:', ru:'Действительные:' },
    ignoradas:   { pt:'Ignoradas:', en:'Ignored:', es:'Ignoradas:', ru:'Пропущено:' },
    normalizando:{ pt:'Normalizando endereços via geocode...', en:'Normalizing addresses via geocode...', es:'Normalizando direcciones vía geocode...', ru:'Нормализация адресов через геокодирование...' },
    processando: { pt:'Processando', en:'Processing', es:'Procesando', ru:'Обработка' },
    impXlsxOk:   { pt:'✓ Importação XLSX concluída —', en:'✓ XLSX import complete —', es:'✓ Importación XLSX completada —', ru:'✓ Импорт XLSX завершён —' },
    novas:       { pt:'novas,', en:'new,', es:'nuevas,', ru:'новых,' },
    atualizadas: { pt:'atualizadas', en:'updated', es:'actualizadas', ru:'обновлено' },
    impConcl:    { pt:'✓ Importação concluída', en:'✓ Import complete', es:'✓ Importación completada', ru:'✓ Импорт завершён' },
    impErro:     { pt:'✗ Erro:', en:'✗ Error:', es:'✗ Error:', ru:'✗ Ошибка:' },
    // tabs
    tStats:      { pt:'📊 Stats', en:'📊 Stats', es:'📊 Stats', ru:'📊 Статистика' },
    tDados:      { pt:'↕ Dados', en:'↕ Data', es:'↕ Datos', ru:'↕ Данные' },
    tCroquis:    { pt:'📐 Croquis', en:'📐 Sketches', es:'📐 Croquis', ru:'📐 Эскизы' },
    tFotos:      { pt:'📸 Fotos', en:'📸 Photos', es:'📸 Fotos', ru:'📸 Фото' },
    tStatusMassa:{ pt:'⚡ Status em massa', en:'⚡ Bulk Status', es:'⚡ Estado masivo', ru:'⚡ Массовый статус' },
    tRelatorio:  { pt:'📋 Relatório', en:'📋 Report', es:'📋 Informe', ru:'📋 Отчёт' },
    tGuard:      { pt:'🛡 Guard', en:'🛡 Guard', es:'🛡 Guard', ru:'🛡 Guard' },
    tUsuarios:   { pt:'👥 Usuários', en:'👥 Users', es:'👥 Usuarios', ru:'👥 Пользователи' },
    tConfig:     { pt:'⚙️ Config', en:'⚙️ Config', es:'⚙️ Config', ru:'⚙️ Настройки' },
    todasCidades:{ pt:'Todas as cidades', en:'All cities', es:'Todas las ciudades', ru:'Все города' },
    carregando:  { pt:'Carregando...', en:'Loading...', es:'Cargando...', ru:'Загрузка...' },
    cTotal:      { pt:'Total', en:'Total', es:'Total', ru:'Всего' },
    cInstaladas: { pt:'Instaladas', en:'Installed', es:'Instaladas', ru:'Установлено' },
    porTipo:     { pt:'POR TIPO', en:'BY TYPE', es:'POR TIPO', ru:'ПО ТИПУ' },
    publicas:    { pt:'Públicas', en:'Public', es:'Públicas', ru:'Публичные' },
    privadas:    { pt:'Privadas', en:'Private', es:'Privadas', ru:'Частные' },
    concorrentes:{ pt:'Concorrentes', en:'Competitors', es:'Competidores', ru:'Конкуренты' },
    porStatus:   { pt:'POR STATUS', en:'BY STATUS', es:'POR ESTADO', ru:'ПО СТАТУСУ' },
    solicitadas: { pt:'Solicitadas', en:'Requested', es:'Solicitadas', ru:'Запрошено' },
    aprovadas:   { pt:'Aprovadas', en:'Approved', es:'Aprobadas', ru:'Одобрено' },
    canceladas:  { pt:'Canceladas', en:'Cancelled', es:'Canceladas', ru:'Отменено' },
    cobertura:   { pt:'COBERTURA DE DADOS', en:'DATA COVERAGE', es:'COBERTURA DE DATOS', ru:'ПОКРЫТИЕ ДАННЫХ' },
    comSV:       { pt:'Com Street View', en:'With Street View', es:'Con Street View', ru:'Со Street View' },
    comFoto:     { pt:'Com foto', en:'With photo', es:'Con foto', ru:'С фото' },
    comCroqui:   { pt:'Com croqui', en:'With sketch', es:'Con croquis', ru:'С эскизом' },
    iaAnalisada: { pt:'IA analisada', en:'AI analyzed', es:'IA analizada', ru:'Проанализировано ИИ' },
    topBairros:  { pt:'TOP BAIRROS', en:'TOP NEIGHBORHOODS', es:'TOP BARRIOS', ru:'ТОП РАЙОНОВ' },
    expansao:    { pt:'🌍 Expansão —', en:'🌍 Expansion —', es:'🌍 Expansión —', ru:'🌍 Расширение —' },
    cidadesWord: { pt:'cidades', en:'cities', es:'ciudades', ru:'городов' },
    mes:         { pt:'/mês', en:'/mo', es:'/mes', ru:'/мес' },
    selCidadeRel:{ pt:'Selecione uma cidade acima para gerar o relatório completo da cidade', en:'Select a city above to generate the full city report', es:'Seleccione una ciudad arriba para generar el informe completo de la ciudad', ru:'Выберите город выше, чтобы создать полный отчёт по городу' },
    impInteligente:{ pt:'Importação inteligente:', en:'Smart import:', es:'Importación inteligente:', ru:'Умный импорт:' },
    impInteligenteTxt:{ pt:' registros com o mesmo código são atualizados. Novos são criados. Dados existentes são preservados quando o campo estiver vazio no arquivo.', en:' records with the same code are updated. New ones are created. Existing data is preserved when the field is empty in the file.', es:' los registros con el mismo código se actualizan. Los nuevos se crean. Los datos existentes se preservan cuando el campo está vacío en el archivo.', ru:' записи с тем же кодом обновляются. Новые создаются. Существующие данные сохраняются, если поле в файле пустое.' },
    selArquivo:  { pt:'📁 Selecionar arquivo CSV ou JSON', en:'📁 Select CSV or JSON file', es:'📁 Seleccionar archivo CSV o JSON', ru:'📁 Выбрать файл CSV или JSON' },
    importando:  { pt:'Importando...', en:'Importing...', es:'Importando...', ru:'Импорт...' },
    iniciarImp:  { pt:'Iniciar importação', en:'Start import', es:'Iniciar importación', ru:'Начать импорт' },
    impConclTit: { pt:'✓ Importação concluída', en:'✓ Import complete', es:'✓ Importación completada', ru:'✓ Импорт завершён' },
    totalProc:   { pt:'Total processados', en:'Total processed', es:'Total procesados', ru:'Всего обработано' },
    novosCriados:{ pt:'Novos criados', en:'New created', es:'Nuevos creados', ru:'Создано новых' },
    atualizadosLbl:{ pt:'Atualizados', en:'Updated', es:'Actualizados', ru:'Обновлено' },
    ignoradosLbl:{ pt:'Ignorados', en:'Ignored', es:'Ignorados', ru:'Пропущено' },
    errosClique: { pt:'erros (clique para ver)', en:'errors (click to view)', es:'errores (clic para ver)', ru:'ошибок (нажмите для просмотра)' },
    novaImp:     { pt:'Nova importação', en:'New import', es:'Nueva importación', ru:'Новый импорт' },
    baixarTpl:   { pt:'⬇️ Baixar template CSV com todos os campos', en:'⬇️ Download CSV template with all fields', es:'⬇️ Descargar plantilla CSV con todos los campos', ru:'⬇️ Скачать шаблон CSV со всеми полями' },
    camposAceitos:{ pt:'Campos aceitos no CSV/JSON', en:'Accepted fields in CSV/JSON', es:'Campos aceptados en CSV/JSON', ru:'Принимаемые поля в CSV/JSON' },
    obrigatorios:{ pt:'Obrigatórios:', en:'Required:', es:'Obligatorios:', ru:'Обязательные:' },
    opcionais:   { pt:'Opcionais:', en:'Optional:', es:'Opcionales:', ru:'Необязательные:' },
    // AbaAtualizarStatus
    asApenasGestores:{ pt:'Apenas gestores podem usar essa função', en:'Only managers can use this function', es:'Solo gestores pueden usar esta función', ru:'Эту функцию могут использовать только менеджеры' },
    asSelecione: { pt:'Selecione estações para atualizar', en:'Select stations to update', es:'Seleccione estaciones para actualizar', ru:'Выберите станции для обновления' },
    asTitulo:    { pt:'Atualizar Status em Massa', en:'Bulk Status Update', es:'Actualizar Estado en Masa', ru:'Массовое обновление статуса' },
    asDesc:      { pt:'Selecione o status de origem e destino. Todas as estações com o status de origem serão atualizadas.', en:'Select the source and target status. All stations with the source status will be updated.', es:'Seleccione el estado de origen y destino. Todas las estaciones con el estado de origen serán actualizadas.', ru:'Выберите исходный и целевой статус. Все станции с исходным статусом будут обновлены.' },
    asEstacoesMud:{ pt:'estações mudadas de', en:'stations changed from', es:'estaciones cambiadas de', ru:'станций изменено с' },
    asPara:      { pt:'para', en:'to', es:'a', ru:'на' },
    asErro:      { pt:'❌ Erro:', en:'❌ Error:', es:'❌ Error:', ru:'❌ Ошибка:' },
    asDeOrigem:  { pt:'De (Status Origem):', en:'From (Source Status):', es:'De (Estado Origen):', ru:'Из (исходный статус):' },
    asParaDestino:{ pt:'Para (Status Destino):', en:'To (Target Status):', es:'A (Estado Destino):', ru:'В (целевой статус):' },
    asEstacoesCom:{ pt:'Estações', en:'Stations', es:'Estaciones', ru:'Станции' },
    asComStatus: { pt:'com status', en:'with status', es:'con estado', ru:'со статусом' },
    asTodas:     { pt:'Todas', en:'All', es:'Todas', ru:'Все' },
    asSelecionadas:{ pt:'Selecionadas', en:'Selected', es:'Seleccionadas', ru:'Выбранные' },
    asSemEndereco:{ pt:'(sem endereço)', en:'(no address)', es:'(sin dirección)', ru:'(без адреса)' },
    asNenhumaStatus:{ pt:'ℹ️ Nenhuma estação com status', en:'ℹ️ No station with status', es:'ℹ️ Ninguna estación con estado', ru:'ℹ️ Нет станций со статусом' },
    asAtualizando:{ pt:'⏳ Atualizando...', en:'⏳ Updating...', es:'⏳ Actualizando...', ru:'⏳ Обновление...' },
    asAtualizar: { pt:'⚡ Atualizar', en:'⚡ Update', es:'⚡ Actualizar', ru:'⚡ Обновить' },
    asEstacaoSing:{ pt:'estação', en:'station', es:'estación', ru:'станцию' },
    asEstacaoPlur:{ pt:'estações', en:'stations', es:'estaciones', ru:'станций' },
  };
  const cidade = cidades[0] || '';
  const cidadesExp = useCidadesExpansao();
  const [aba,          setAba]          = useState<'dashboard'|'exportar'|'importar'|'relatorio'|'croquis'|'fotos'|'guard'|'usuarios'|'atualizar-status'|'configuracoes'>('dashboard');
  const [estacoes,     setEstacoes]     = useState<Estacao[]>([]);
  const [carregando,   setCarregando]   = useState(true);
  const [svStats,      setSvStats]      = useState<any>(null);
  const [svCarregando, setSvCarregando] = useState(false);
  const [importFile,   setImportFile]   = useState<File | null>(null);
  const [importando,   setImportando]   = useState(false);
  const [importLog,    setImportLog]    = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ResultadoImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin     = roleAtual === 'admin';
  const isGestor    = ['admin','gestor'].includes(roleAtual);
  const isGestorSeg = ['admin','gestor','gestor_seg'].includes(roleAtual);

  // Carrega estações da cidade (Firestore + Supabase quando ativo)
  useEffect(() => {
    setCarregando(true);
    const q = cidades.length === 1
      ? query(collection(db, 'estacoes'), where('cidade','==',cidades[0]))
      : cidades.length > 1
        ? query(collection(db, 'estacoes'), where('cidade','in',cidades.slice(0,10)))
        : query(collection(db, 'estacoes'));
    const pFirestore = getDocs(q).then(snap =>
      snap.docs.map(d => ({ id: d.id, ...d.data() } as Estacao))
    ).catch(() => [] as Estacao[]);
    const pSupabase = mapaProviderSupabase() && cidades.length
      ? Promise.all(cidades.map(c => carregarEstacoesSupabase(c).catch(() => []))).then(arrs => arrs.flat() as Estacao[])
      : Promise.resolve([] as Estacao[]);
    Promise.all([pFirestore, pSupabase]).then(([fs, sb]) => {
      const ids = new Set(fs.map(e => e.id));
      setEstacoes([...fs, ...sb.filter(e => !ids.has(e.id))]);
      setCarregando(false);
    });
  }, [cidades, pais]);

  // Calcula stats
  const total     = estacoes.length;
  const publicas  = estacoes.filter(e => e.tipo === 'PUBLICA').length;
  const privadas  = estacoes.filter(e => e.tipo === 'PRIVADA').length;
  const concorr   = estacoes.filter(e => e.tipo === 'CONCORRENTE').length;
  const instaladas = estacoes.filter(e => e.status === 'INSTALADO').length;
  const aprovadas  = estacoes.filter(e => e.status === 'APROVADO').length;
  const solicitadas = estacoes.filter(e => e.status === 'SOLICITADO').length;
  const iaAprovadas = estacoes.filter(e => e.ia?.aprovado).length;
  const comSV      = estacoes.filter(e => e.imagens?.streetView).length;
  const comFoto    = estacoes.filter(e => e.imagens?.foto).length;
  const comCroqui  = estacoes.filter(e => e.croquiStatus === 'OK').length;

  // Agrupa por bairro e subprefeitura
  const porBairro: Record<string,number> = {};
  const porSubpref: Record<string,number> = {};
  estacoes.forEach(e => {
    if (e.bairro) porBairro[e.bairro] = (porBairro[e.bairro]||0) + 1;
    if (e.subprefeitura) porSubpref[e.subprefeitura] = (porSubpref[e.subprefeitura]||0) + 1;
  });
  const topBairros  = Object.entries(porBairro).sort((a,b) => b[1]-a[1]).slice(0,8);
  const topSubprefs = Object.entries(porSubpref).sort((a,b) => b[1]-a[1]).slice(0,8);
  const isSP = cidade.toLowerCase().includes('paulo');

  const carregarCustos = async () => {
    setSvCarregando(true);
    try {
      const res = await fnSvEstatisticas()({});
      setSvStats(((res.data || res) as any));
    } catch { /* silencioso */ }
    setSvCarregando(false);
  };

  useEffect(() => {
  }, [aba]);

  // Handler XLSX Urent — normaliza geocode e salva no Firestore
  const handleImportarXlsxUrent = async (file: File) => {
    setImportLog([pick(T.lendoXlsx)]);
    const { validos, ignorados } = await parseXlsxUrent(file);

    setImportLog(prev => [...prev,
      `${pick(T.encontradas)} ${validos.length + ignorados.length} ${pick(T.entradas)}`,
      `${pick(T.validas)} ${validos.length}`,
      `${pick(T.ignoradas)} ${ignorados.length} (${ignorados.slice(0,3).map(i => i.motivo).join('; ')}${ignorados.length > 3 ? '...' : ''})`,
    ]);

    if (validos.length === 0) {
      setImportResult({ total: ignorados.length, novos: 0, atualizados: 0, ignorados: ignorados.length, erros: ignorados.map(i => i.nome + ': ' + i.motivo) });
      return;
    }

    // Para cada entrada válida: geocode reverso para obter bairro/cidade
    setImportLog(prev => [...prev, pick(T.normalizando)]);
    let novos = 0, atualizados = 0, erros: string[] = [];

    const { doc: fsDoc, setDoc: fSetDoc, getDoc: fGetDoc, collection: fCol, serverTimestamp: fTs } = await import('firebase/firestore');
    const { db: fdb } = await import('./lib/firebase');

    for (let i = 0; i < validos.length; i++) {
      const v = validos[i];
      setImportLog(prev => { const n = [...prev]; n[n.length-1] = `${pick(T.processando)} ${i+1}/${validos.length}: ${v.nome.slice(0,40)}...`; return n; });

      try {
        // Geocode reverso para bairro/cidade
        let bairro = '', cidadeGeo = '', estado = '', cep = '';
        try {
          const resp = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + v.lat + '&lon=' + v.lng + '&accept-language=pt-BR',
            { headers: { 'User-Agent': 'JetOS/1.0' } }
          );
          const geo = await resp.json();
          const addr = geo.address || {};
          bairro    = addr.suburb || addr.neighbourhood || addr.quarter || addr.district || '';
          cidadeGeo = addr.city  || addr.town || addr.municipality || addr.county || '';
          estado    = addr.state || '';
          cep       = addr.postcode || '';
        } catch { /* geocode falhou — usa dados do nome */ }

        // Extrair cidade do nome se geocode falhou
        if (!cidadeGeo) {
          const m = v.nome.match(/,\s*([^,]+)\s*-\s*PE/);
          cidadeGeo = m ? m[1].trim() : pais === 'BR' ? 'Recife' : '';
        }

        // Gerar código único baseado em lat/lng
        const codigoBase = (cidadeGeo || 'UNK').substring(0,3).toUpperCase().replace(/[^A-Z]/g, 'X');
        const hash = Math.abs(Math.round(v.lat * 1e5) ^ Math.round(v.lng * 1e5)).toString(36).toUpperCase().slice(0, 6);
        const codigo = codigoBase + '-IMP-' + hash;

        // Verificar se já existe (por lat/lng próximos — raio 20m)
        // Simplificado: checar pelo codigo
        const docRef = fsDoc(fdb, 'estacoes', codigo);
        const snap   = await fGetDoc(docRef);

        const dados: Record<string, any> = {
          codigo, lat: v.lat, lng: v.lng,
          endereco:  v.nome,
          bairro:    bairro    || '',
          cidade:    cidadeGeo || '',
          estado:    estado    || '',
          cep:       cep       || '',
          pais:      pais,
          tipo:      'PUBLICA',
          status:    v.inativa ? 'CANCELADO' : 'SOLICITADO',
          zonaUrent: v.zonas,
          importadoEm: fTs(),
          importadoDe: 'urent_xlsx',
        };

        if (snap.exists()) {
          // Atualizar só campos de geo se estiver vazio
          const existing = snap.data();
          const patch: Record<string, any> = {};
          if (!existing.bairro  && bairro)    patch.bairro    = bairro;
          if (!existing.cidade  && cidadeGeo) patch.cidade    = cidadeGeo;
          if (!existing.cep     && cep)       patch.cep       = cep;
          if (Object.keys(patch).length > 0) {
            await fSetDoc(docRef, patch, { merge: true });
            atualizados++;
          }
        } else {
          await fSetDoc(docRef, dados);
          novos++;
        }

        // Delay para não sobrecarregar Nominatim (1 req/seg)
        await new Promise(r => setTimeout(r, 1100));
      } catch (err: any) {
        erros.push(v.nome.slice(0,40) + ': ' + (err?.message || 'erro'));
      }
    }

    setImportResult({ total: validos.length + ignorados.length, novos, atualizados, ignorados: ignorados.length, erros });
    setImportLog(prev => [...prev, pick(T.impXlsxOk) + ' ' + novos + ' ' + pick(T.novas) + ' ' + atualizados + ' ' + pick(T.atualizadas)]);
  };

  const handleImportar = async () => {
    if (!importFile) return;
    setImportando(true);
    setImportLog([]);
    setImportResult(null);
    try {
      // Detectar XLSX Urent — rota separada com parser inteligente
      const isXlsx = importFile.name.toLowerCase().endsWith('.xlsx') || importFile.name.toLowerCase().endsWith('.xls');
      if (isXlsx) {
        await handleImportarXlsxUrent(importFile);
        setImportando(false);
        return;
      }
      const result = await importarEstacoes(
        importFile, pais,
        msg => setImportLog(prev => [...prev, msg])
      );
      setImportResult(result);
      setImportLog(prev => [...prev, pick(T.impConcl)]);
    } catch(e: unknown) {
      setImportLog(prev => [...prev, pick(T.impErro) + ' ' + (e instanceof Error ? e.message : String(e))]);
    }
    setImportando(false);
  };

  // ── COMPONENTE: ABA ATUALIZAR STATUS EM MASSA ──
  const AbaAtualizarStatus = ({ estacoes, cidade, isGestor }: any) => {
    const [statusOrigem, setStatusOrigem] = useState('SOLICITADO');
    const [statusDestino, setStatusDestino] = useState('INSTALADO');
    const [atualizando, setAtualizando] = useState(false);
    const [resultado, setResultado] = useState<any>(null);
    const [modoSelecao, setModoSelecao] = useState<'todas'|'selecionadas'>('todas');
    const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

    const filtradas = estacoes.filter((e: any) => e.status === statusOrigem);
    const paraProcesar = modoSelecao === 'todas' ? filtradas : filtradas.filter((e: any) => selecionadas.has(e.codigo));

    const toggleSelecao = (codigo: string) => {
      const nova = new Set(selecionadas);
      if (nova.has(codigo)) nova.delete(codigo);
      else nova.add(codigo);
      setSelecionadas(nova);
    };

    const handleAtualizar = async () => {
      if (!isGestor) { alert(pick(T.asApenasGestores)); return; }
      if (paraProcesar.length === 0) { alert(pick(T.asSelecione)); return; }
      
      setAtualizando(true);
      setResultado(null);

      try {
        const batch = writeBatch(db);
        for (const est of paraProcesar) {
          const docRef = doc(db, 'estacoes', est.codigo);
          batch.update(docRef, { status: statusDestino, atualizadoEm: new Date() });
        }
        
        await batch.commit();
        setResultado({
          sucesso: true,
          total: paraProcesar.length,
          statusOrigem,
          statusDestino
        });
        setSelecionadas(new Set());
      } catch (err: any) {
        setResultado({ sucesso: false, erro: err.message });
      } finally {
        setAtualizando(false);
      }
    };

    const statusOpcoes = ['SOLICITADO', 'APROVADO', 'REPROVADO', 'INSTALADO', 'CANCELADO'];

    return (
      <div style={{ padding: '16px 20px' }}>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
            {pick(T.asTitulo)}
          </h3>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 16 }}>
            {pick(T.asDesc)}
          </p>

          {resultado && (
            <div style={{
              padding: 12, borderRadius: 8, marginBottom: 16,
              background: resultado.sucesso ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
              border: `1px solid ${resultado.sucesso ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
              color: resultado.sucesso ? '#6ee7b7' : '#f87171',
              fontSize: 12
            }}>
              {resultado.sucesso ? (
                <>
                  ✅ {resultado.total} {pick(T.asEstacoesMud)} <strong>{resultado.statusOrigem}</strong> {pick(T.asPara)} <strong>{resultado.statusDestino}</strong>
                </>
              ) : (
                <>{pick(T.asErro)} {resultado.erro}</>
              )}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6, fontWeight: 600 }}>
              {pick(T.asDeOrigem)}
            </label>
            <select value={statusOrigem} onChange={(e) => setStatusOrigem(e.target.value)} style={{
              width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12
            }}>
              {statusOpcoes.map(s => <option key={s} value={s} style={{ background: '#0d1220' }}>{s}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6, fontWeight: 600 }}>
              {pick(T.asParaDestino)}
            </label>
            <select value={statusDestino} onChange={(e) => setStatusDestino(e.target.value)} style={{
              width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12
            }}>
              {statusOpcoes.map(s => <option key={s} value={s} style={{ background: '#0d1220' }}>{s}</option>)}
            </select>
          </div>

          {filtradas.length > 0 && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6, fontWeight: 600 }}>
                  {pick(T.asEstacoesCom)} ({filtradas.length} {pick(T.asComStatus)} {statusOrigem}):
                </label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <button onClick={() => setModoSelecao('todas')} style={{
                    flex: 1, padding: '6px', fontSize: 10, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: modoSelecao === 'todas' ? '#60a5fa' : 'rgba(255,255,255,.08)',
                    color: modoSelecao === 'todas' ? '#fff' : 'rgba(255,255,255,.4)'
                  }}>{pick(T.asTodas)} ({filtradas.length})</button>
                  <button onClick={() => setModoSelecao('selecionadas')} style={{
                    flex: 1, padding: '6px', fontSize: 10, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: modoSelecao === 'selecionadas' ? '#60a5fa' : 'rgba(255,255,255,.08)',
                    color: modoSelecao === 'selecionadas' ? '#fff' : 'rgba(255,255,255,.4)'
                  }}>{pick(T.asSelecionadas)} ({selecionadas.size})</button>
                </div>
              </div>

              {modoSelecao === 'selecionadas' && (
                <div style={{
                  maxHeight: 200, overflowY: 'auto', padding: 8, background: 'rgba(255,255,255,.02)',
                  border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, marginBottom: 12
                }}>
                  {filtradas.map((est: any) => (
                    <div key={est.codigo} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
                      borderBottom: '1px solid rgba(255,255,255,.04)'
                    }}>
                      <input type="checkbox" checked={selecionadas.has(est.codigo)}
                        onChange={() => toggleSelecao(est.codigo)}
                        style={{ cursor: 'pointer' }} />
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,.7)', flex: 1 }}>
                        {est.codigo} - {est.endereco || est.cidade || pick(T.asSemEndereco)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {filtradas.length === 0 && (
            <div style={{
              padding: 12, borderRadius: 6, background: 'rgba(99,102,241,.1)',
              border: '1px solid rgba(99,102,241,.2)', color: '#a5b4fc', fontSize: 11,
              marginBottom: 16
            }}>
              {pick(T.asNenhumaStatus)} "{statusOrigem}"
            </div>
          )}

          <button onClick={handleAtualizar} disabled={atualizando || statusOrigem === statusDestino || paraProcesar.length === 0} style={{
            width: '100%', padding: '10px', borderRadius: 6, border: 'none',
            background: (statusOrigem === statusDestino || paraProcesar.length === 0) ? 'rgba(255,255,255,.1)' : 'linear-gradient(135deg,#10b981,#34d399)',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: (statusOrigem === statusDestino || paraProcesar.length === 0) ? 'not-allowed' : 'pointer',
            opacity: atualizando ? 0.6 : 1
          }}>
            {atualizando ? pick(T.asAtualizando) : `${pick(T.asAtualizar)} ${paraProcesar.length} ${paraProcesar.length !== 1 ? pick(T.asEstacaoPlur) : pick(T.asEstacaoSing)}`}
          </button>
        </div>
      </div>
    );
  };

  const inp: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6
  };

  const ABAS_ALL = [
    { k: 'dashboard', label: pick(T.tStats),       show: isGestor },
    { k: 'exportar',  label: pick(T.tDados),       show: isGestor },
    { k: 'croquis',   label: pick(T.tCroquis),     show: isGestor },
    { k: 'fotos',     label: pick(T.tFotos),       show: isGestor },
    { k: 'atualizar-status', label: pick(T.tStatusMassa), show: isGestor },
    { k: 'relatorio', label: pick(T.tRelatorio),   show: isGestor },
    { k: 'guard',     label: pick(T.tGuard),       show: isGestor || isGestorSeg },
    { k: 'usuarios',  label: pick(T.tUsuarios),    show: isAdmin  || isGestorSeg },
    { k: 'configuracoes', label: pick(T.tConfig),  show: isAdmin  },
  ] as const;
  const ABAS = ABAS_ALL.filter(a => a.show);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: 380, height: '100%',
      background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
      borderRight: '1px solid rgba(255,255,255,.08)', zIndex: 1200,
      display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif'
    }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.06)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
          {cidades.length > 0 ? cidades.join(' + ') : pick(T.todasCidades)}
        </div>
        <button onClick={onFechar} style={{
          marginLeft: 'auto', background: 'rgba(255,255,255,.06)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
          color: 'rgba(255,255,255,.5)', width: 28, height: 28, cursor: 'pointer', fontSize: 14
        }}>×</button>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
        {ABAS.map(a => (
          <button key={a.k} onClick={() => setAba(a.k as any)} style={{
            flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer', fontSize: 10,
            background: aba === a.k ? 'rgba(255,255,255,.06)' : 'transparent',
            borderBottom: `2px solid ${aba === a.k ? '#60a5fa' : 'transparent'}`,
            color: aba === a.k ? '#60a5fa' : 'rgba(255,255,255,.4)', fontWeight: 600
          }}>{a.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* ── DASHBOARD ── */}
        {aba === 'dashboard' && (
          carregando ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)' }}>{pick(T.carregando)}</div>
          ) : (
            <>
              {/* Cards principais */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <StatCard label={pick(T.cTotal)}      valor={total}     cor="#60a5fa" />
                <StatCard label={pick(T.cInstaladas)} valor={instaladas} cor="#6ee7b7" sub={`${pct(instaladas,total)}%`} />
                <StatCard label="IA ✓"       valor={iaAprovadas} cor="#a78bfa" sub={`${pct(iaAprovadas,total)}%`} />
              </div>

              {/* Botão normalizar dados */}
              {isGestor && cidade && (
                <NormalizarBtn cidade={cidade} pais={pais} onDone={() => {
                  // Recarrega estações
                  setCarregando(true);
                  getDocs(query(collection(db, 'estacoes'), ...(cidade ? [where('cidade','==',cidade)] : [])))
                    .then(snap => { setEstacoes(snap.docs.map(d => ({id:d.id,...d.data()} as Estacao))); setCarregando(false); })
                    .catch(() => setCarregando(false));
                }} />
              )}

              {/* Por tipo */}
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.06)', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', fontWeight: 700,
                  letterSpacing: '.06em', marginBottom: 12 }}>{pick(T.porTipo)}</div>
                {[
                  { label: pick(T.publicas),     n: publicas, cor: '#3b82f6' },
                  { label: pick(T.privadas),     n: privadas, cor: '#f59e0b' },
                  { label: pick(T.concorrentes), n: concorr,  cor: '#ef4444' }
                ].map(item => (
                  <div key={item.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{item.label}</span>
                      <span style={{ fontSize: 12, color: item.cor, fontWeight: 600 }}>
                        {item.n} <span style={{ color: 'rgba(255,255,255,.3)', fontWeight: 400 }}>({pct(item.n,total)}%)</span>
                      </span>
                    </div>
                    <BarraProgresso valor={item.n} total={total} cor={item.cor} />
                  </div>
                ))}
              </div>

              {/* Por status */}
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.06)', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', fontWeight: 700,
                  letterSpacing: '.06em', marginBottom: 12 }}>{pick(T.porStatus)}</div>
                {[
                  { label: pick(T.solicitadas), n: solicitadas, cor: '#60a5fa' },
                  { label: pick(T.aprovadas),   n: aprovadas,   cor: '#6ee7b7' },
                  { label: pick(T.canceladas),  n: estacoes.filter(e=>e.status==='CANCELADO'||e.status==='REPROVADO').length, cor: '#f87171' }
                ].map(item => (
                  <div key={item.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{item.label}</span>
                      <span style={{ fontSize: 12, color: item.cor, fontWeight: 600 }}>
                        {item.n} <span style={{ color: 'rgba(255,255,255,.3)', fontWeight: 400 }}>({pct(item.n,total)}%)</span>
                      </span>
                    </div>
                    <BarraProgresso valor={item.n} total={total} cor={item.cor} />
                  </div>
                ))}
              </div>

              {/* Cobertura de dados */}
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.06)', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', fontWeight: 700,
                  letterSpacing: '.06em', marginBottom: 12 }}>{pick(T.cobertura)}</div>
                {[
                  { label: pick(T.comSV),     n: comSV,     cor: '#fbbf24' },
                  { label: pick(T.comFoto),    n: comFoto,   cor: '#f472b6' },
                  { label: pick(T.comCroqui),  n: comCroqui, cor: '#34d399' },
                  { label: pick(T.iaAnalisada),n: iaAprovadas + estacoes.filter(e => e.ia && !e.ia.aprovado).length, cor: '#a78bfa' }
                ].map(item => (
                  <div key={item.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{item.label}</span>
                      <span style={{ fontSize: 12, color: item.cor, fontWeight: 600 }}>
                        {item.n}/{total} <span style={{ color: 'rgba(255,255,255,.3)', fontWeight: 400 }}>({pct(item.n,total)}%)</span>
                      </span>
                    </div>
                    <BarraProgresso valor={item.n} total={total} cor={item.cor} />
                  </div>
                ))}
              </div>

              {/* Top bairros — só com cidade específica */}
              {cidades.length === 1 && topBairros.length > 0 && (
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,.03)',
                  border: '1px solid rgba(255,255,255,.06)' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', fontWeight: 700,
                    letterSpacing: '.06em', marginBottom: 12 }}>{pick(T.topBairros)}</div>
                  {topBairros.map(([bairro, n]) => (
                    <div key={bairro} style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        maxWidth: '75%' }}>{bairro}</span>
                      <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600,
                        flexShrink: 0 }}>{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}

        {/* ── DADOS (Export + Import + Zonas + Relatório) ── */}
        {aba === 'exportar' && (
          <AbaDados estacoes={estacoes} cidade={cidade} pais={pais} total={total}
            isGestor={isGestor}
            importFile={importFile} setImportFile={setImportFile}
            importando={importando} importResult={importResult} importLog={importLog}
            fileRef={fileRef} handleImportar={handleImportar} />
        )}

        {/* ── EXPANSÃO ── */}
        {aba === 'dashboard' && cidadesExp.length > 0 && (
          <div style={{ margin:'0 -16px', padding:'12px 16px', borderTop:'1px solid rgba(255,255,255,.06)', marginTop:8 }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:1, textTransform:'uppercase' as any, color:'rgba(255,255,255,.25)', marginBottom:10 }}>
              {pick(T.expansao)} {cidadesExp.length} {pick(T.cidadesWord)}
            </div>
            <div style={{ display:'flex', flexDirection:'column' as any, gap:5 }}>
              {cidadesExp.map(c => {
                const m = STATUS_META[c.status];
                return (
                  <div key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:7, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.05)' }}>
                    <span style={{ fontSize:14 }}>{m.icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff', whiteSpace:'nowrap' as any, overflow:'hidden', textOverflow:'ellipsis' }}>{c.nome}</div>
                      <div style={{ fontSize:9, color:'rgba(255,255,255,.3)' }}>{m.label}{c.dataPrevista ? ' · 📅 ' + c.dataPrevista : ''}</div>
                    </div>
                    {c.mercadoEst && <div style={{ fontSize:10, color:m.cor, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{c.mercadoEst.toLocaleString()}{pick(T.mes)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CROQUIS EM LOTE ── */}
        {aba === 'croquis' && <AbaCroquisLote cidade={cidade} pais={pais} total={total} estacoes={estacoes} />}

        {/* ── FOTOS EM LOTE ── */}
        {aba === 'fotos' && <AbaFotos estacoes={estacoes} cidade={cidade} isGestor={isGestor} />}

        {/* ── ATUALIZAR STATUS EM MASSA ── */}
        {aba === 'atualizar-status' && <AbaAtualizarStatus estacoes={estacoes} cidade={cidade} isGestor={isGestor} />}

        {/* ── RELATÓRIO PREFEITURA ── */}
        {aba === 'relatorio' && (
          <GraficoEstacoes estacoes={estacoes} cidade={cidade} />
        )}
        {aba === 'relatorio' && cidade && (
          <RelatorioManager estacoes={estacoes} cidade={cidade} pais={pais} total={total} />
        )}
        {aba === 'relatorio' && !cidade && (
          <div style={{ padding:'0 24px 24px', textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
            {pick(T.selCidadeRel)}
          </div>
        )}

        {/* ── GUARD RELATÓRIOS ── */}
        {aba === 'guard' && (isGestor || isGestorSeg) && <GuardRelatoriosPanel isAdmin={roleAtual === 'admin'} />}
        {aba === 'usuarios' && (isAdmin || isGestorSeg) && <UsuariosPanel />}

	{/* ── CONFIGURAÇÕES ── */}                                                                 
	{aba === 'configuracoes' && (                                                               
                    <GoJetCidadesPanel />                                                                     
                )} 

        {/* ── IMPORTAR ── */}
        {aba === 'importar' && isGestor && (
          <>
            <div style={{ padding: 12, borderRadius: 8, marginBottom: 14,
              background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)',
              fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
              <b style={{ color: '#fbbf24' }}>{pick(T.impInteligente)}</b>{pick(T.impInteligenteTxt)}
            </div>

            {/* Upload */}
            <input ref={fileRef} type="file" accept=".csv,.json"
              onChange={e => { setImportFile(e.target.files?.[0] || null); setImportResult(null); setImportLog([]); }}
              style={{ display: 'none' }} />

            <button onClick={() => fileRef.current?.click()} style={{
              width: '100%', padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
              background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.15)',
              color: 'rgba(255,255,255,.5)', fontSize: 13, marginBottom: 12
            }}>
              {importFile ? `📁 ${importFile.name}` : pick(T.selArquivo)}
            </button>

            {importFile && !importResult && (
              <button onClick={handleImportar} disabled={importando} style={{
                width: '100%', padding: 12,
                background: importando ? 'rgba(48,127,226,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                border: 'none', borderRadius: 10, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: importando ? 'not-allowed' : 'pointer',
                marginBottom: 12
              }}>{importando ? pick(T.importando) : pick(T.iniciarImp)}</button>
            )}

            {/* Log */}
            {importLog.length > 0 && (
              <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.06)', marginBottom: 12,
                maxHeight: 120, overflowY: 'auto', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
                {importLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}

            {/* Resultado */}
            {importResult && (
              <div style={{ padding: 14, borderRadius: 10,
                background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7', marginBottom: 10 }}>
                  {pick(T.impConclTit)}
                </div>
                {[
                  { label: pick(T.totalProc), n: importResult.total,      cor: '#fff' },
                  { label: pick(T.novosCriados),      n: importResult.novos,      cor: '#6ee7b7' },
                  { label: pick(T.atualizadosLbl),        n: importResult.atualizados,cor: '#60a5fa' },
                  { label: pick(T.ignoradosLbl),          n: importResult.ignorados,  cor: '#fbbf24' }
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{item.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: item.cor }}>{item.n}</span>
                  </div>
                ))}
                {importResult.erros.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ fontSize: 11, color: '#f87171', cursor: 'pointer' }}>
                      {importResult.erros.length} {pick(T.errosClique)}
                    </summary>
                    <div style={{ marginTop: 8, fontSize: 10, color: '#f87171', maxHeight: 100, overflowY: 'auto' }}>
                      {importResult.erros.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  </details>
                )}
                <button onClick={() => { setImportFile(null); setImportResult(null); setImportLog([]); if(fileRef.current) fileRef.current.value=''; }}
                  style={{ width: '100%', marginTop: 10, padding: 8,
                    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                    borderRadius: 8, color: 'rgba(255,255,255,.5)', fontSize: 11, cursor: 'pointer'
                  }}>{pick(T.novaImp)}</button>
              </div>
            )}

            {/* Botão template */}
            <button onClick={baixarTemplate} style={{
              width: '100%', padding: '10px 14px', marginBottom: 12, borderRadius: 10,
              background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.2)',
              color: '#c084fc', fontSize: 12, cursor: 'pointer'
            }}>{pick(T.baixarTpl)}</button>

            {/* Guia de campos */}
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', cursor: 'pointer' }}>
                {pick(T.camposAceitos)}
              </summary>
              <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,.3)',
                background: 'rgba(255,255,255,.02)', padding: 10, borderRadius: 8 }}>
                <b style={{ color: 'rgba(255,255,255,.5)' }}>{pick(T.obrigatorios)}</b> codigo, lat, lng<br/>
                <b style={{ color: 'rgba(255,255,255,.5)' }}>{pick(T.opcionais)}</b> cidade, bairro, tipo (PUBLICA/PRIVADA/CONCORRENTE),
                status (SOLICITADO/APROVADO/REPROVADO/INSTALADO),
                larguraFaixa, endereco, croquiStatus
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

// ── ABA FOTOS EM LOTE ─────────────────────────────────────────────
type FonteFoto = 'streetview' | 'mapillary' | 'kartaview' | 'manual';

const FONTES: { k: FonteFoto; label: string; desc: string; cor: string }[] = [
  { k: 'streetview', label: '🗺 Street View',  desc: 'URL embed gratuita (sem API key)',       cor: '#3d9bff' },
  { k: 'mapillary',  label: '📡 Mapillary',    desc: 'Fotos colaborativas — requer token free', cor: '#2ecc71' },
  { k: 'kartaview',  label: '🛣 KartaView',    desc: 'OpenStreetCam, sem API key',              cor: '#f5c842' },
  { k: 'manual',     label: '📷 Manual',       desc: 'Upload individual por estação',           cor: '#a78bfa' },
];

function AbaFotos({ estacoes, cidade, isGestor }: {
  estacoes: Estacao[]; cidade: string; isGestor: boolean;
}) {
  const { pick } = useLang();
  const T = {
    fonteLabels: {
      streetview: { pt:'🗺 Street View', en:'🗺 Street View', es:'🗺 Street View', ru:'🗺 Street View' } as TL,
      mapillary:  { pt:'📡 Mapillary', en:'📡 Mapillary', es:'📡 Mapillary', ru:'📡 Mapillary' } as TL,
      kartaview:  { pt:'🛣 KartaView', en:'🛣 KartaView', es:'🛣 KartaView', ru:'🛣 KartaView' } as TL,
      manual:     { pt:'📷 Manual', en:'📷 Manual', es:'📷 Manual', ru:'📷 Вручную' } as TL,
    } as Record<FonteFoto, TL>,
    fonteDesc: {
      streetview: { pt:'URL embed gratuita (sem API key)', en:'Free embed URL (no API key)', es:'URL de inserción gratuita (sin API key)', ru:'Бесплатный embed URL (без API-ключа)' } as TL,
      mapillary:  { pt:'Fotos colaborativas — requer token free', en:'Crowdsourced photos — requires free token', es:'Fotos colaborativas — requiere token gratis', ru:'Совместные фото — нужен бесплатный токен' } as TL,
      kartaview:  { pt:'OpenStreetCam, sem API key', en:'OpenStreetCam, no API key', es:'OpenStreetCam, sin API key', ru:'OpenStreetCam, без API-ключа' } as TL,
      manual:     { pt:'Upload individual por estação', en:'Individual upload per station', es:'Carga individual por estación', ru:'Индивидуальная загрузка для станции' } as TL,
    } as Record<FonteFoto, TL>,
    semCoords:   { pt:'sem coordenadas', en:'no coordinates', es:'sin coordenadas', ru:'нет координат' },
    semCobertura:{ pt:'sem cobertura Street View', en:'no Street View coverage', es:'sin cobertura Street View', ru:'нет покрытия Street View' },
    fotoSalva:   { pt:'foto salva', en:'photo saved', es:'foto guardada', ru:'фото сохранено' },
    erroTrace:   { pt:'erro —', en:'error —', es:'error —', ru:'ошибка —' },
    concluidoA:  { pt:'Concluído:', en:'Done:', es:'Completado:', ru:'Готово:' },
    concluidoAtual:{ pt:'atualizadas,', en:'updated,', es:'actualizadas,', ru:'обновлено,' },
    concluidoErr:{ pt:'erros', en:'errors', es:'errores', ru:'ошибок' },
    alertNenhuma:{ pt:'Nenhuma estação com esses filtros.', en:'No station matches these filters.', es:'Ninguna estación con estos filtros.', ru:'Нет станций по этим фильтрам.' },
    alertToken:  { pt:'Informe o token Mapillary (gratuito em mapillary.com/dashboard/developers).', en:'Enter the Mapillary token (free at mapillary.com/dashboard/developers).', es:'Ingrese el token de Mapillary (gratis en mapillary.com/dashboard/developers).', ru:'Введите токен Mapillary (бесплатно на mapillary.com/dashboard/developers).' },
    confirmA:    { pt:'Atualizar foto de', en:'Update photo of', es:'Actualizar foto de', ru:'Обновить фото' },
    confirmB:    { pt:'estações via', en:'stations via', es:'estaciones vía', ru:'станций через' },
    apenasGestores:{ pt:'Apenas gestores e admins podem atualizar fotos em lote.', en:'Only managers and admins can update photos in bulk.', es:'Solo gestores y admins pueden actualizar fotos en lote.', ru:'Только менеджеры и админы могут массово обновлять фото.' },
    fonteFoto:   { pt:'Fonte da foto', en:'Photo source', es:'Fuente de la foto', ru:'Источник фото' },
    tokenPh:     { pt:'Token Mapillary (mapillary.com/dashboard/developers)', en:'Mapillary token (mapillary.com/dashboard/developers)', es:'Token Mapillary (mapillary.com/dashboard/developers)', ru:'Токен Mapillary (mapillary.com/dashboard/developers)' },
    manualInfoA: { pt:'No modo manual, clique na estação no mapa → botão 📷 Foto → selecione a imagem.', en:'In manual mode, click the station on the map → 📷 Photo button → select the image.', es:'En modo manual, haga clic en la estación en el mapa → botón 📷 Foto → seleccione la imagen.', ru:'В ручном режиме нажмите станцию на карте → кнопка 📷 Фото → выберите изображение.' },
    manualInfoB: { pt:'Use as opções abaixo para filtrar quais estações ver no mapa.', en:'Use the options below to filter which stations to see on the map.', es:'Use las opciones abajo para filtrar qué estaciones ver en el mapa.', ru:'Используйте параметры ниже, чтобы отфильтровать станции на карте.' },
    filtros:     { pt:'Filtros', en:'Filters', es:'Filtros', ru:'Фильтры' },
    apenasVazias:{ pt:'Apenas estações sem foto Street View', en:'Only stations without a Street View photo', es:'Solo estaciones sin foto de Street View', ru:'Только станции без фото Street View' },
    status:      { pt:'Status', en:'Status', es:'Estado', ru:'Статус' },
    todos:       { pt:'Todos', en:'All', es:'Todos', ru:'Все' },
    bairro:      { pt:'Bairro', en:'Neighborhood', es:'Barrio', ru:'Район' },
    todosBairros:{ pt:'Todos os bairros', en:'All neighborhoods', es:'Todos los barrios', ru:'Все районы' },
    seraoAtual:  { pt:'estações serão atualizadas', en:'stations will be updated', es:'estaciones serán actualizadas', ru:'станций будет обновлено' },
    nenhumaFiltro:{ pt:'Nenhuma estação com esses filtros', en:'No station matches these filters', es:'Ninguna estación con estos filtros', ru:'Нет станций по этим фильтрам' },
    atualizadas: { pt:'atualizadas', en:'updated', es:'actualizadas', ru:'обновлено' },
    erros:       { pt:'erros', en:'errors', es:'errores', ru:'ошибок' },
    restantes:   { pt:'restantes', en:'remaining', es:'restantes', ru:'осталось' },
    iniciarAtual:{ pt:'📸 Iniciar atualização', en:'📸 Start update', es:'📸 Iniciar actualización', ru:'📸 Начать обновление' },
    parar:       { pt:'⏹ Parar', en:'⏹ Stop', es:'⏹ Detener', ru:'⏹ Стоп' },
  };
  const [fonte,        setFonte]        = useState<FonteFoto>('streetview');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');
  const [filtroBairro, setFiltroBairro] = useState<string>('');
  const [apenasVazias, setApenasVazias] = useState(true);
  const [mapillaryTok, setMapillaryTok] = useState('');
  const [rodando,      setRodando]      = useState(false);
  const [log,          setLog]          = useState<{msg:string;ok:boolean}[]>([]);
  const [progresso,    setProgresso]    = useState({ ok:0, erro:0, total:0 });
  const abortRef = useRef(false);

  const bairros = [...new Set(estacoes.map(e => e.bairro).filter(Boolean))].sort() as string[];

  const getAlvo = () => {
    let lista = [...estacoes];
    if (apenasVazias) lista = lista.filter(e => !e.imagens?.streetView);
    if (filtroStatus !== 'todos') lista = lista.filter(e => e.status === filtroStatus);
    if (filtroBairro) lista = lista.filter(e => e.bairro === filtroBairro);
    return lista;
  };

  const alvo = getAlvo();

  // ── Geração de URL por fonte ──────────────────────────────────
  const buildUrl = (e: Estacao): string | null => {
    if (!e.lat || !e.lng) return null;
    if (fonte === 'streetview') {
      // Street View Static API — retorna imagem real, não embed
      // 600x400, gratuito até 25k req/mês
      return 'https://maps.googleapis.com/maps/api/streetview?size=600x400&location=' + e.lat + ',' + e.lng + '&fov=90&pitch=0&key=AIzaSyAn5EzET8D7KXfln-1NKny0OlBq3oxSVlU';
    }
    if (fonte === 'mapillary') {
      return `https://www.mapillary.com/embed?image_key=closest&lat=${e.lat}&lng=${e.lng}&client_id=${mapillaryTok || 'MLY|YOUR_TOKEN'}`;
    }
    if (fonte === 'kartaview') {
      return `https://kartaview.org/map/@${e.lat},${e.lng},17z`;
    }
    return null;
  };

  // ── Verifica se URL de Street View tem imagem real ────────────
  const checkStreetView = async (lat: number, lng: number): Promise<boolean> => {
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=AIzaSyAn5EzET8D7KXfln-1NKny0OlBq3oxSVlU`
      );
      const d = await r.json();
      return d.status === 'OK';
    } catch { return true; } // assume OK se falhar
  };

  const iniciar = async () => {
    if (!alvo.length) { alert(pick(T.alertNenhuma)); return; }
    if (fonte === 'mapillary' && !mapillaryTok) {
      alert(pick(T.alertToken));
      return;
    }
    if (!confirm(`${pick(T.confirmA)} ${alvo.length} ${pick(T.confirmB)} ${pick(T.fonteLabels[fonte])}?`)) return;

    setRodando(true); abortRef.current = false;
    setLog([]); setProgresso({ ok:0, erro:0, total: alvo.length });
    let ok = 0, erro = 0;

    const { doc, updateDoc } = await import('firebase/firestore');

    for (let i = 0; i < alvo.length && !abortRef.current; i++) {
      const e = alvo[i];
      const url = buildUrl(e);
      if (!url) {
        erro++;
        setLog(prev => [...prev, { msg: `${e.codigo||e.id}: ${pick(T.semCoords)}`, ok: false }]);
        setProgresso({ ok, erro, total: alvo.length });
        continue;
      }

      try {
        // Para Street View, verificar se existe imagem antes de salvar
        if (fonte === 'streetview') {
          const temFoto = await checkStreetView(e.lat, e.lng);
          if (!temFoto) {
            erro++;
            setLog(prev => [...prev, { msg: `${e.codigo||e.id}: ${pick(T.semCobertura)}`, ok: false }]);
            setProgresso({ ok, erro, total: alvo.length });
            await new Promise(r => setTimeout(r, 200));
            continue;
          }
        }

        await updateDoc(doc(db, 'estacoes', e.id), {
          'imagens.streetView': url,  // URL da imagem estática (exibível diretamente)
          'imagens.foto': url,        // Também salva como foto para aparecer no InfoWindow
        });
        ok++;
        setLog(prev => [...prev, { msg: `${e.codigo||e.id} (${e.bairro||''}): ${pick(T.fotoSalva)}`, ok: true }]);
      } catch (err: any) {
        erro++;
        setLog(prev => [...prev, { msg: `${e.codigo||e.id}: ${pick(T.erroTrace)} ${err.message}`, ok: false }]);
      }

      setProgresso({ ok, erro, total: alvo.length });
      // Respeitar rate limit das APIs
      await new Promise(r => setTimeout(r, fonte === 'streetview' ? 300 : 100));
    }

    setRodando(false);
    setLog(prev => [...prev, { msg: `${pick(T.concluidoA)} ${ok} ${pick(T.concluidoAtual)} ${erro} ${pick(T.concluidoErr)}`, ok: true }]);
  };

  const parar = () => { abortRef.current = true; };

  const secTitle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: 'rgba(255,255,255,.25)', marginBottom: 8,
  };

  if (!isGestor) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,.3)', fontSize: 12 }}>
      {pick(T.apenasGestores)}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Fonte */}
      <div>
        <div style={secTitle}>{pick(T.fonteFoto)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {FONTES.map(f => (
            <div key={f.k} onClick={() => setFonte(f.k)} style={{
              padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
              background: fonte === f.k ? `${f.cor}15` : 'rgba(255,255,255,.03)',
              border: `1px solid ${fonte === f.k ? f.cor + '44' : 'rgba(255,255,255,.06)'}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%',
                background: fonte === f.k ? f.cor : 'rgba(255,255,255,.2)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: fonte === f.k ? f.cor : 'rgba(255,255,255,.6)' }}>
                  {pick(T.fonteLabels[f.k])}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{pick(T.fonteDesc[f.k])}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Token Mapillary */}
        {fonte === 'mapillary' && (
          <div style={{ marginTop: 8 }}>
            <input value={mapillaryTok} onChange={e => setMapillaryTok(e.target.value)}
              placeholder={pick(T.tokenPh)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 7,
                background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                color: '#fff', fontSize: 11, outline: 'none' }} />
          </div>
        )}

        {fonte === 'manual' && (
          <div style={{ padding: 10, borderRadius: 7, background: 'rgba(167,139,250,.08)',
            border: '1px solid rgba(167,139,250,.2)', fontSize: 11, color: 'rgba(255,255,255,.4)',
            marginTop: 8, lineHeight: 1.5 }}>
            {pick(T.manualInfoA)}<br/>
            {pick(T.manualInfoB)}
          </div>
        )}
      </div>

      {/* Filtros */}
      {fonte !== 'manual' && (
        <div>
          <div style={secTitle}>{pick(T.filtros)}</div>

          {/* Apenas vazias */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: 12, color: 'rgba(255,255,255,.6)', marginBottom: 8 }}>
            <input type="checkbox" checked={apenasVazias}
              onChange={e => setApenasVazias(e.target.checked)} />
            {pick(T.apenasVazias)}
          </label>

          {/* Status */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 4 }}>{pick(T.status)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {['todos', 'SOLICITADO', 'APROVADO', 'CANCELADO'].map(s => (
                <button key={s} onClick={() => setFiltroStatus(s)} style={{
                  padding: '3px 9px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600,
                  background: filtroStatus === s ? 'rgba(61,155,255,.2)' : 'rgba(255,255,255,.04)',
                  color: filtroStatus === s ? '#3d9bff' : 'rgba(255,255,255,.35)',
                  outline: filtroStatus === s ? '1px solid rgba(61,155,255,.3)' : '1px solid rgba(255,255,255,.06)',
                }}>{s === 'todos' ? pick(T.todos) : s}</button>
              ))}
            </div>
          </div>

          {/* Bairro */}
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 4 }}>{pick(T.bairro)}</div>
            <select value={filtroBairro} onChange={e => setFiltroBairro(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 7,
                background: '#111722', border: '1px solid rgba(255,255,255,.1)',
                color: '#dce8ff', fontSize: 11 }}>
              <option value="">{pick(T.todosBairros)}</option>
              {bairros.map(b => (
                <option key={b} value={b}>{b} ({estacoes.filter(e=>e.bairro===b&&(!apenasVazias||!e.imagens?.streetView)).length})</option>
              ))}
            </select>
          </div>

          {/* Contador */}
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)',
            fontSize: 11, color: 'rgba(255,255,255,.5)', textAlign: 'center' }}>
            {alvo.length > 0
              ? `${alvo.length} ${pick(T.seraoAtual)}`
              : pick(T.nenhumaFiltro)}
          </div>
        </div>
      )}

      {/* Progresso */}
      {(rodando || progresso.ok + progresso.erro > 0) && (
        <div style={{ padding: 12, borderRadius: 8,
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
          {/* Barra */}
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginBottom: 8 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: 'linear-gradient(90deg,#3d9bff,#2ecc71)',
              width: `${progresso.total > 0 ? ((progresso.ok + progresso.erro) / progresso.total * 100) : 0}%`,
              transition: 'width .3s',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10,
            color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
            <span>✅ {progresso.ok} {pick(T.atualizadas)}</span>
            <span>❌ {progresso.erro} {pick(T.erros)}</span>
            <span>⏳ {progresso.total - progresso.ok - progresso.erro} {pick(T.restantes)}</span>
          </div>
          {/* Log */}
          <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[...log].reverse().map((l, i) => (
              <div key={i} style={{ fontSize: 10, fontFamily: 'monospace',
                color: l.ok ? '#6ee7b7' : '#f87171' }}>
                {l.ok ? '✓' : '✗'} {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Botões */}
      {fonte !== 'manual' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {!rodando ? (
            <button onClick={iniciar} disabled={alvo.length === 0} style={{
              flex: 1, padding: '12px', borderRadius: 10, border: 'none',
              cursor: alvo.length === 0 ? 'not-allowed' : 'pointer',
              background: alvo.length === 0 ? 'rgba(255,255,255,.04)'
                : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
              color: alvo.length === 0 ? 'rgba(255,255,255,.2)' : '#fff',
              fontSize: 13, fontWeight: 700,
            }}>
              {pick(T.iniciarAtual)} ({alvo.length})
            </button>
          ) : (
            <button onClick={parar} style={{
              flex: 1, padding: '12px', borderRadius: 10,
              border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)',
              color: '#f87171', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>{pick(T.parar)}</button>
          )}
        </div>
      )}
    </div>
  );
}
