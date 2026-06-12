// DashboardManager.tsx — Dashboard + Custos API + Exportação/Importação
import { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, where, doc, writeBatch, getDoc, updateDoc, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { useState as useLocalState } from 'react';
import { db, auth } from './lib/firebase';
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

// ── RELATÓRIO DE PARCERIA ─────────────────────────────────────────
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
  // Filtra apenas PRIVADAS por padrão, ordenadas por criadoEm desc
  const [filtroTipo,   setFiltroTipo]   = useState<'TODOS'|'PRIVADA'|'PUBLICA'|'CONCORRENTE'>('PRIVADA');
  const [filtroStatus, setFiltroStatus] = useState<string>('SOLICITADO');
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
      titulo:      'Relatório de Pontos de Parceria',
      cidade:      'Cidade',
      data:        'Data',
      prep:        'Elaborado por',
      empresa:     'JET Scooters',
      tabelaTit:   'Pontos de Parceria Cadastrados',
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
      titulo:      'Informe de Puntos de Asociación',
      cidade:      'Ciudad',
      data:        'Fecha',
      prep:        'Elaborado por',
      empresa:     'JET Scooters',
      tabelaTit:   'Puntos de Asociación Registrados',
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
      titulo:      'Partnership Points Report',
      cidade:      'City',
      data:        'Date',
      prep:        'Prepared by',
      empresa:     'JET Scooters',
      tabelaTit:   'Registered Partnership Points',
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
      APROVADO:'#065f46', SOLICITADO:'#1e40af', INSTALADO:'#4c1d95', REPROVADO:'#991b1b', CANCELADO:'#374151'
    };
    const statusBg2: Record<string,string> = {
      APROVADO:'#d1fae5', SOLICITADO:'#dbeafe', INSTALADO:'#ede9fe', REPROVADO:'#fee2e2', CANCELADO:'#f3f4f6'
    };

    // Colunas respeitam campos selecionados na UI
    const mostrarFoto      = campos.includes('foto');
    const mostrarEndereco  = campos.includes('endereco');
    const mostrarBairro    = campos.includes('bairro') || campos.includes('endereco');
    const mostrarStatus    = campos.includes('status');
    const mostrarDataReg   = campos.includes('criadoEm');
    const mostrarSV        = campos.includes('streetView');
    const mostrarConsultor = campos.includes('consultor');

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
        ? '<a href="' + svUrl + '" target="_blank" style="background:#1a73e8;color:#fff;text-decoration:none;padding:3px 8px;border-radius:5px;font-size:9px;font-weight:600;white-space:nowrap;display:inline-block">🌐 SV</a>'
        : '<span style="color:#d1d5db">—</span>';

      let row = '<tr style="background:' + bgRow + ';page-break-inside:avoid">';
      row += '<td style="padding:5px 6px;text-align:center;font-size:10px;font-weight:700;color:#9ca3af;white-space:nowrap">' + String(i+1).padStart(2,'0') + '</td>';
      if (mostrarFoto)      row += '<td style="padding:4px;width:84px;text-align:center">' + fotoHtml + '</td>';
      row += '<td style="padding:5px 6px;font-size:10px;font-weight:600;color:#111;word-break:break-word;min-width:120px">' + nome + '</td>';
      if (mostrarEndereco)  row += '<td style="padding:5px 6px;font-size:10px;color:#374151;word-break:break-word;min-width:140px">' + end + '</td>';
      if (mostrarBairro)    row += '<td style="padding:5px 6px;font-size:10px;color:#374151;word-break:break-word;min-width:80px">' + bairro + '</td>';
      if (mostrarStatus)    row += '<td style="padding:5px 6px;text-align:center"><span style="background:' + sBg + ';color:' + sCor + ';padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;white-space:nowrap">' + e.status + '</span></td>';
      if (mostrarDataReg)   row += '<td style="padding:5px 6px;font-size:10px;color:#374151;white-space:nowrap">' + fmtD(e.criadoEm) + '</td>';
      if (mostrarSV)        row += '<td style="padding:5px 6px;text-align:center">' + svHtml + '</td>';
      if (mostrarConsultor) row += '<td style="padding:5px 6px;font-size:10px;color:#374151;word-break:break-word">' + (e.consultor || '—') + '</td>';
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
    if (mostrarDataReg)   thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase;white-space:nowrap">' + tr2.dataReg + '</th>';
    if (mostrarSV)        thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase">Street View</th>';
    if (mostrarConsultor) thead += '<th style="padding:7px 6px;font-size:9px;text-transform:uppercase;text-align:left">' + tr2.consultor + '</th>';
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
      + '<h1>' + tr2.titulo.toUpperCase() + '</h1>'
      + '<p class="sub">JET Scooters — ' + cidade + ' | ' + dataHoje
        + ' | ' + estRelatorio.length + ' ' + (estRelatorio.length === 1 ? tr2.estacao : tr2.estacoes) + '</p>'
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
      REPROVADO:'#991b1b', CANCELADO:'#374151'
    };
    const statusBg: Record<string,string> = {
      APROVADO:'#d1fae5', SOLICITADO:'#dbeafe', INSTALADO:'#ede9fe',
      REPROVADO:'#fee2e2', CANCELADO:'#f3f4f6'
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
      '<h1>' + tr.titulo.toUpperCase() + '</h1>' +
      '<p class="subtitle">JET Scooters — ' + cidade + ' | ' + dataHoje + '</p>' +
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
          { k: 'parceria', l: '📋 Relatório Prefeitura' },
          { k: 'suporte',  l: '📊 Suporte JET (Excel)' },
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
          Relatório de Parceria — {cidade}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
          Selecione as estações e gere o PDF no formato de relatório de pontos
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
            {t === 'TODOS' ? 'Todos' : t === 'PRIVADA' ? '🏢 Privadas' : t === 'PUBLICA' ? '🛤 Públicas' : '⚔️ Concorrentes'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['TODOS','SOLICITADO','APROVADO','INSTALADO','REPROVADO','CANCELADO'] as const).map(s => (
          <button key={s} onClick={() => { setFiltroStatus(s); setSelecionadas(new Set()); }}
            style={{ ...inp,
              background: filtroStatus === s ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.04)',
              color: filtroStatus === s ? '#60a5fa' : 'rgba(255,255,255,.4)',
              border: `1px solid ${filtroStatus === s ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.08)'}`,
              fontWeight: filtroStatus === s ? 700 : 400,
            }}>
            {s === 'TODOS' ? 'Todos status' : s}
          </button>
        ))}
      </div>

      {/* Contador + Selecionar tudo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
          {estFiltradas.length} estações · <span style={{ color: '#fbbf24', fontWeight: 600 }}>{selecionadas.size} selecionadas</span>
        </span>
        <button onClick={toggleTudo} style={{ ...inp, padding: '4px 10px' }}>
          {selecionadas.size === estFiltradas.length && estFiltradas.length > 0 ? 'Desmarcar tudo' : 'Selecionar tudo'}
        </button>
      </div>

      {/* Lista de estações */}
      <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid rgba(255,255,255,.08)',
        borderRadius: 8, marginBottom: 12 }}>
        {estFiltradas.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>
            Nenhuma estação com esses filtros
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
        <span>⚙️ {mostrarCampos ? 'Ocultar' : 'Configurar'} campos do relatório</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{campos.length} campos ativos</span>
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
                  background: 'rgba(255,255,255,.02)' }}>{g}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 10px 8px' }}>
                  {CAMPOS_RELATORIO.filter(c => c.grupo === g).map(c => (
                    <button key={c.key} onClick={() => toggle(c.key)} style={{
                      padding: '3px 9px', borderRadius: 16, fontSize: 10, cursor: 'pointer',
                      background: campos.includes(c.key) ? 'rgba(96,165,250,.15)' : 'rgba(255,255,255,.04)',
                      color: campos.includes(c.key) ? '#60a5fa' : 'rgba(255,255,255,.3)',
                      border: `1px solid ${campos.includes(c.key) ? 'rgba(96,165,250,.3)' : 'rgba(255,255,255,.07)'}`,
                    }}>{c.label}</button>
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
          📊 Exportação para Suporte JET
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', lineHeight: 1.5 }}>
          Gera o arquivo Excel (.csv) com <strong style={{ color: '#fff' }}>latitude, longitude e endereço</strong>,
          formatado para importação no sistema JET.
          Cada linha corresponde a uma estação.
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
          }}>{t === 'TODOS' ? 'Todos tipos' : t === 'PRIVADA' ? '🏢 Privadas' : '🛤 Públicas'}</button>
        ))}
        {(['TODOS','SOLICITADO','APROVADO','INSTALADO'] as const).map(s => (
          <button key={s} onClick={() => setFiltroStatus(s)} style={{ ...inp,
            background: filtroStatus === s ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.04)',
            color: filtroStatus === s ? '#22c55e' : 'rgba(255,255,255,.4)',
            border: `1px solid ${filtroStatus === s ? 'rgba(34,197,94,.3)' : 'rgba(255,255,255,.08)'}`,
            fontWeight: filtroStatus === s ? 700 : 400,
          }}>{s === 'TODOS' ? 'Todos status' : s.charAt(0) + s.slice(1).toLowerCase()}</button>
        ))}
      </div>

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        {[
          { l: 'Estações', v: estacoes.length, cor: '#60a5fa' },
          { l: 'Com foto',    v: comFoto, cor: '#22c55e' },
          { l: 'Sem foto',    v: semFoto, cor: semFoto > 0 ? '#f87171' : '#6b7280' },
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
              {(e as any).imagens?.foto ? '✓ link' : '✗ sem foto'}
            </span>
          </div>
        ))}
        {estacoes.length > 3 && (
          <div style={{ padding: '5px 10px', color: 'rgba(255,255,255,.2)', fontSize: 10,
            borderTop: '1px solid rgba(255,255,255,.05)' }}>
            + {estacoes.length - 3} linhas...
          </div>
        )}
      </div>

      {/* Instruções fotos Drive */}
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 14,
        background: 'rgba(234,179,8,.05)', border: '1px solid rgba(234,179,8,.15)' }}>
        <div style={{ color: '#eab308', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
          📁 Sobre o envio das fotos
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.7 }}>
          O JET vincula fotos pelo <strong style={{ color: '#fff' }}>nome do arquivo = endereço da estação</strong>.
          As fotos salvas no sistema já têm URL do Firebase Storage —
          a coluna <code style={{ color: '#eab308' }}>link_foto</code> no CSV aponta diretamente para cada foto.<br/><br/>
          Para enviar em pasta no Drive:
        </div>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 2 }}>
          <li>Baixe as fotos a partir dos links da coluna <code style={{ color: '#eab308' }}>link_foto</code></li>
          <li>Renomeie cada arquivo com o <strong style={{ color: '#fff' }}>endereço completo</strong> da estação correspondente</li>
          <li>Suba a pasta para o Google Drive e compartilhe o link com o suporte JET junto com o CSV</li>
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
            ? 'Nenhuma estação com esses filtros'
            : `📥 Baixar CSV (${estacoes.length} estações)`}
        </button>

        {/* Download fotos automatizado */}
        {comFoto > 0 && (
          <button onClick={baixarFotos} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg,#059669,#10b981)',
            color: '#fff', fontSize: 13, fontWeight: 700,
          }}>
            📷 Baixar {comFoto} foto{comFoto > 1 ? 's' : ''} (nomeadas pelo endereço)
          </button>
        )}
        {comFoto > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', textAlign: 'center', marginTop: -4 }}>
            Cada arquivo será salvo como <em>endereço.jpg</em> — pronto para enviar ao suporte JET
          </div>
        )}
      </div>
    </div>
  );
}

// ── BOTÃO NORMALIZAR ─────────────────────────────────────────────
function ZonasInline({ cidade, pais }: { cidade: string; pais: string }) {
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
    if (!confirm(`Excluir "${zona.nome}"?`)) return;
    const { doc: fDoc, deleteDoc: fDel } = await import('firebase/firestore');
    await fDel(fDoc(db, 'poligonos', zona.id));
    setZonas(prev => prev.filter(z => z.id !== zona.id));
  };

  const filtradas = zonas.filter(z =>
    filtro === 'todos' ? true : filtro === 'ativos' ? z.ativo !== false : z.ativo === false
  ).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  if (loading) return <div style={{ padding: 12, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>Carregando zonas...</div>;
  if (!zonas.length) return <div style={{ padding: 12, fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>Nenhuma zona cadastrada</div>;

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
          }}>{f.charAt(0).toUpperCase()+f.slice(1)} {f==='todos'?`(${zonas.length})`:f==='ativos'?`(${zonas.filter(z=>z.ativo!==false).length})`:`(${zonas.filter(z=>z.ativo===false).length})`}</button>
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
                {z.nome || '(sem nome)'}
              </div>
              {z.ativo === false && (
                <span style={{ fontSize: 8, background: 'rgba(239,68,68,.15)', color: '#f87171',
                  border: '1px solid rgba(239,68,68,.2)', borderRadius: 4, padding: '1px 4px' }}>INATIVA</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginBottom: 4 }}>
              {z.grupo} · {z.fase} · {z.poligono?.length || 0} vértices
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
              }}>{z.ativo !== false ? 'Desativar' : 'Reativar'}</button>
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
  const [rodando,   setRodando]   = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [log,       setLog]       = useState<string[]>([]);
  const [prog,      setProg]      = useState({ normalizados: 0, restantes: 0 });
  const abortRef = useRef(false);

  const iniciar = async () => {
    if (!confirm(`Normalizar bairro/endereço via Nominatim em ${cidade}?\n\nProcessa estações sem bairro, 1 por vez (limite da API gratuita).\nPode levar vários minutos.`)) return;
    setRodando(true); setConcluido(false); abortRef.current = false;
    setLog(['Buscando estações sem bairro...']);

    const { getDocs, collection, query, where, doc, updateDoc } = await import('firebase/firestore');
    const snap = await getDocs(query(
      collection(db, 'estacoes'),
      where('cidade', '==', cidade)
    ));

    const semBairro = snap.docs.filter(d => !d.data().bairro || !d.data().endereco);
    setProg({ normalizados: 0, restantes: semBairro.length });
    setLog([`${semBairro.length} estações sem bairro/endereço`]);

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
    setLog(prev => [...prev, `✓ Concluído: ${ok} normalizados`]);
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
              ? <span style={{ fontSize: 10, color: '#fbbf24' }}>● Rodando...</span>
              : <span style={{ fontSize: 10, color: '#6ee7b7' }}>✓ Concluído</span>
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
            {concluido ? '↻ Normalizar novamente' : '🔧 Normalizar dados faltantes'}
          </button>
        ) : (
          <button onClick={() => abortRef.current = true} style={{
            flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
            color: '#f87171', fontSize: 12, fontWeight: 600
          }}>⏹ Parar</button>
        )}
      </div>
    </div>
  );
}

function AbaCroquisLote({ cidade, pais, total, estacoes }: {
  cidade: string; pais: string; total: number; estacoes: Estacao[];
}) {
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
    if (!alvo.length) { alert('Nenhuma estação para processar com os filtros selecionados.'); return; }
    const fotoAviso = modeLote !== 'semFoto' && semFotoMode === 'pular'
      ? `\n\n⚠ ${semFoto} estações sem foto serão puladas.`
      : modeLote !== 'semFoto' && semFotoMode === 'placeholder'
      ? `\n\n📷 ${semFoto} estações sem foto usarão imagem placeholder.`
      : '';
    if (!confirm(`Gerar ${alvo.length} croquis em ${cidade}?${fotoAviso}\nPode levar vários minutos.`)) return;

    setRodando(true); setConcluido(false); abortRef.current = false;
    setLog([`Iniciando... ${alvo.length} estações`]);
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
        setLog(prev => [...prev, `Lote: +${d.processados} gerados · ${d.erros} erros · ${restantes} restantes`]);
        if (restantes === 0 || d.processados === 0) break;
        await new Promise(r => setTimeout(r, 2000));
      } catch(e: unknown) {
        setLog(prev => [...prev, 'Erro: ' + (e instanceof Error ? e.message : String(e))]);
        break;
      }
    }
    setRodando(false); setConcluido(true);
    setLog(prev => [...prev, `✓ Concluído: ${totalProcessados} gerados, ${totalErros} erros`]);
  };

  const parar = () => { abortRef.current = true; };
  const pct = total > 0 ? Math.round(comCroqui / total * 100) : 0;

  return (
    <>
      {/* Status geral */}
      <div style={{ padding: 14, borderRadius: 10, marginBottom: 12,
        background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#c084fc', fontWeight: 600 }}>Croquis — {cidade}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3 }}>
          <div style={{ height: 6, background: '#a78bfa', borderRadius: 3, width: `${pct}%`, transition: 'width .5s' }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          {[
            { label: 'Total', n: total, cor: '#fff' },
            { label: 'Gerados', n: comCroqui, cor: '#6ee7b7' },
            { label: 'Pendentes', n: semCroqui, cor: '#fbbf24' },
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
            {rodando && <span style={{ fontSize: 10, color: '#fbbf24' }}>● Rodando...</span>}
            {concluido && <span style={{ fontSize: 10, color: '#6ee7b7' }}>✓ Concluído</span>}
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
          textTransform: 'uppercase', letterSpacing: .8, marginBottom: 10 }}>Configurar lote</div>

        {/* Modo */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
          {([['todos','Todos pendentes'],['bairro','Por bairro'],['semFoto','Sem foto']] as const).map(([k,l]) => (
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
            <option value="">Selecione um bairro...</option>
            {bairrosDisp.map(b => (
              <option key={b} value={b}>{b} ({estacoes.filter(e=>e.bairro===b&&(!e.croquiStatus||e.croquiStatus!=='OK')).length} pendentes)</option>
            ))}
          </select>
        )}

        {/* Tratamento de estações sem foto */}
        {modeLote !== 'semFoto' && (
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginBottom: 6 }}>
              {semFoto} estações sem foto — o que fazer?
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {([['pular','Pular elas'],['placeholder','Usar placeholder']] as const).map(([k,l]) => (
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
          {totalAlvo > 0 ? `${totalAlvo} estações serão processadas` : 'Nenhuma estação com esses filtros'}
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
            {concluido ? '↻ Executar novamente' : `📐 Gerar ${semCroqui} croquis`}
          </button>
        ) : (
          <button onClick={parar} style={{
            flex: 1, padding: 13, borderRadius: 10,
            background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)',
            color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer'
          }}>⏹ Parar</button>
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
            {total} estações · {camposSel.length} campos selecionados
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
            {cidade || pais}
          </div>
        </div>
      </div>

      {/* Seletor de campos por grupo */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 700,
          letterSpacing: '.08em', marginBottom: 10 }}>CAMPOS DO RELATÓRIO</div>
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
              {grupo}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 20 }}>
              {CAMPOS_EXPORT.filter(c => c.grupo === grupo).map(campo => (
                <button key={campo.key} onClick={() => toggle(campo.key)} style={{
                  padding: '3px 9px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
                  background: camposSel.includes(campo.key) ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${camposSel.includes(campo.key) ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.08)'}`,
                  color: camposSel.includes(campo.key) ? '#60a5fa' : 'rgba(255,255,255,.35)'
                }}>{campo.label}</button>
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
            <div style={{ fontSize: 13, fontWeight: 600 }}>Exportar CSV</div>
            <div style={{ fontSize: 10, opacity: .7 }}>Excel, Google Sheets · {camposSel.length} campos</div>
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
            <div style={{ fontSize: 13, fontWeight: 600 }}>Exportar JSON</div>
            <div style={{ fontSize: 10, opacity: .7 }}>Backup completo · todos os campos</div>
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
    setImportZonaLog(['📂 Lendo arquivo...']);
    const log = (msg: string) => setImportZonaLog(prev => [...prev, msg]);

    try {
      const ext = file.name.toLowerCase();

      // ── KMZ / KML ─────────────────────────────────────────────
      if (ext.endsWith('.kmz') || ext.endsWith('.kml')) {
        let kmlText = '';
        if (ext.endsWith('.kmz')) {
          const zip = await JSZip.loadAsync(file);
          const kmlFile = Object.keys(zip.files).find(n => n.endsWith('.kml'));
          if (!kmlFile) throw new Error('Nenhum .kml encontrado no KMZ');
          kmlText = await zip.files[kmlFile].async('text');
          log(`✅ KMZ extraído: ${kmlFile}`);
        } else {
          kmlText = await file.text();
          log('✅ KML lido');
        }
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
        const placemarks = Array.from(kmlDoc.querySelectorAll('Placemark'));
        const zonasPMs  = placemarks.filter(pm => pm.querySelector('Polygon'));
        log(`📍 ${zonasPMs.length} zonas encontradas`);

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
          log(`  ✅ ${nome} (${pontos.length} pts)`);
        }
        log(`🎉 ${criadas} zonas importadas!`);

      // ── GeoJSON ────────────────────────────────────────────────
      } else if (ext.endsWith('.geojson') || ext.endsWith('.json')) {
        const text = await file.text();
        const gj = JSON.parse(text);
        const features = gj.type === 'FeatureCollection' ? gj.features
          : gj.type === 'Feature' ? [gj] : [];
        const polys = features.filter((f: any) => f?.geometry?.type === 'Polygon');
        log(`📍 ${polys.length} polígonos encontrados`);
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
          log(`  ✅ ${p.nome || p.name || 'Zona'}`);
        }
        log(`🎉 ${criadas} zonas importadas!`);

      // ── CSV (pontos: nome,grupo,fase,lat,lng,ativo) ────────────
      } else if (ext.endsWith('.csv')) {
        const text = await file.text();
        const linhas = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (linhas.length < 2) throw new Error('CSV vazio ou sem dados');
        log(`📄 ${linhas.length - 1} linhas lidas`);

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
          log(`  ✅ ${z.nome} (${z.pontos.length} pts)`);
        }
        log(`🎉 ${criadas} zonas importadas!`);

      } else {
        throw new Error('Formato não suportado. Use .kmz, .kml, .geojson ou .csv');
      }
    } catch (e: any) {
      log(`❌ Erro: ${e.message}`);
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
        <div style={secTitle}>📍 Estações — {estacoes.length} total</div>

        {/* Ordenação */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.4)', flexShrink:0 }}>Ordenar por</span>
          {(['bairro','codigo','status'] as const).map(k=>(
            <button key={k} onClick={()=>setOrdenarPor(k)} style={{
              padding:'3px 10px', borderRadius:10, border:'none', cursor:'pointer', fontSize:10, fontWeight:600,
              background: ordenarPor===k?'rgba(61,155,255,.2)':'rgba(255,255,255,.06)',
              color: ordenarPor===k?'#3d9bff':'rgba(255,255,255,.4)',
              outline: ordenarPor===k?'1px solid rgba(61,155,255,.4)':'1px solid rgba(255,255,255,.08)',
            }}>{k.charAt(0).toUpperCase()+k.slice(1)}</button>
          ))}
        </div>

        {/* Seletor de campos */}
        <button onClick={()=>setShowCampos(v=>!v)} style={{
          width:'100%', padding:'8px', borderRadius:8, cursor:'pointer', marginBottom:8,
          background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)',
          color:'rgba(255,255,255,.5)', fontSize:11, textAlign:'left',
        }}>
          {showCampos ? '▲' : '▼'} Campos a exportar ({camposSel.length} selecionados)
        </button>

        {showCampos && (
          <div style={{ marginBottom:10, padding:10, background:'rgba(255,255,255,.03)',
            borderRadius:8, border:'1px solid rgba(255,255,255,.06)' }}>
            {grupos.map(g=>(
              <div key={g} style={{ marginBottom:8 }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', fontWeight:700,
                  textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{g}</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {CAMPOS_EXPORT.filter(c=>c.grupo===g).map(c=>(
                    <div key={c.key} onClick={()=>toggleCampo(c.key)}
                      style={{ padding:'2px 8px', borderRadius:8, cursor:'pointer', fontSize:10,
                        background: camposSel.includes(c.key)?'rgba(61,155,255,.2)':'rgba(255,255,255,.04)',
                        color: camposSel.includes(c.key)?'#3d9bff':'rgba(255,255,255,.35)',
                        border: `1px solid ${camposSel.includes(c.key)?'rgba(61,155,255,.4)':'rgba(255,255,255,.08)'}`,
                      }}>{c.label}</div>
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
            }}>{importFile ? `📁 ${importFile.name}` : '⬆ Importar CSV / JSON / XLSX Urent'}</button>
            {importFile && (importFile.name.endsWith('.xlsx') || importFile.name.endsWith('.xls')) && !importResult && (
              <div style={{ padding:'8px 10px', borderRadius:6, marginBottom:6,
                background:'rgba(167,139,250,.08)', border:'1px solid rgba(167,139,250,.2)',
                fontSize:10, color:'rgba(167,139,250,.8)', lineHeight:1.6 }}>
                <strong>📊 XLSX Urent detectado</strong><br/>
                A importação irá:<br/>
                ✓ Importar estações de qualquer país<br/>
                ✓ Ignorar zonas de restrição e bloqueio<br/>
                ✓ Importar estações inativas como CANCELADO<br/>
                ✓ Completar bairro/cidade via geocode reverso<br/>
                ⚠ Pode levar alguns minutos (1 req/seg no Nominatim)
              </div>
            )}
            {importFile && !importResult && (
              <button onClick={handleImportar} disabled={importando} style={{
                width:'100%', padding:9, background: importando?'rgba(48,127,226,.3)':'linear-gradient(135deg,#1a6fd4,#307FE2)',
                border:'none', borderRadius:8, color:'#fff', fontSize:12, fontWeight:600,
                cursor: importando?'not-allowed':'pointer', marginBottom:6,
              }}>{importando?'Importando...':'Iniciar importação'}</button>
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
        <div style={secTitle}>⬡ Zonas</div>
        <div style={{ padding:'8px 10px', marginBottom:8, borderRadius:6,
          background:'rgba(192,132,252,.08)', border:'1px solid rgba(192,132,252,.2)',
          fontSize:11, color:'rgba(255,255,255,.5)', lineHeight:1.5 }}>
          Para criar zonas manualmente: ative ⬡ Zonas no mapa e clique em <b style={{color:'#c084fc'}}>✏</b> no stack de FABs à direita.
        </div>

        {/* Exportar */}
        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Exportar</div>
        <div style={{ display:'flex', gap:5, marginBottom:12 }}>
          <button onClick={()=>exportZonas('geojson')} style={btn('rgba(99,102,241,.8)')}>⬇ GeoJSON</button>
          <button onClick={()=>exportZonas('wkt')}     style={btn('rgba(48,127,226,.8)')}>⬇ WKT</button>
          <button onClick={()=>exportZonas('csv')}     style={btn('rgba(16,185,129,.8)')}>⬇ CSV</button>
        </div>

        {/* Importar */}
        <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Importar</div>
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
            {importandoZona ? '⏳ Importando...' : '⬆ KMZ / KML'}
          </button>
          <button
            onClick={() => importZonaRef.current?.click()}
            disabled={importandoZona}
            style={btn(importandoZona ? 'rgba(99,102,241,.4)' : 'rgba(99,102,241,.8)')}
          >
            {importandoZona ? '⏳ Importando...' : '⬆ GeoJSON'}
          </button>
          <button
            onClick={() => importZonaRef.current?.click()}
            disabled={importandoZona}
            style={btn(importandoZona ? 'rgba(16,185,129,.4)' : 'rgba(16,185,129,.8)')}
          >
            {importandoZona ? '⏳ Importando...' : '⬆ CSV'}
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
        setResultado({ ok:false, msg:'✗ Preencha o Token do Bot e o Chat ID' });
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

      setResultado({ ok:true, msg:'✓ Configuração salva! Token e Chat ID registrados.' });
    } catch(e:any) {
      setResultado({ ok:false, msg:'✗ Erro ao salvar: '+e.message });
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
      const fn = httpsCallable(getFunctions(getApp(), 'southamerica-east1'), fnName);
      const res = await fn({ tipo, periodo, lang: reportLang }) as any;
      const d = res.data as any;
      const total = d.totalOcorrencias ?? d.total ?? 0;
      setResultado({ ok:true, msg:`✓ ${label} enviado${total ? ` — ${total} registros` : ''}` });
    } catch(e:any) {
      setResultado({ ok:false, msg:`✗ Erro ao enviar: ${(e as any).message || String(e)}` });
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
        <div style={{ fontSize:13, fontWeight:700, color:'#a78bfa' }}>📬 Relatórios Automáticos</div>
        <div style={{ fontSize:10, color:'#4a5a7a', marginTop:3 }}>
          Diário às 7h · Semanal às 7h toda segunda · Firebase Functions
        </div>
      </div>

      {/* Config Telegram — apenas admin */}
      {isAdmin && (
      <div style={sec}>
        <div style={hdr}>⚙️ Configuração Telegram</div>
        <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:8, lineHeight:1.7 }}>
          Token do bot (@BotFather) e Chat ID do grupo/canal de destino.
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
          {salvando ? '⏳ Salvando...' : '💾 Salvar configuração'}
        </button>
      </div>
      )}

      {/* Config Notificações Telegram — apenas admin */}
      {isAdmin && (
      <div style={sec}>
        <div style={hdr}>🔔 Notificações Telegram em tempo real</div>
        <GuardNotifConfig />
      </div>
      )}

      {/* Deploy instruções */}
      <div style={{ ...sec, background:'rgba(251,191,36,.04)' }}>
        <div style={hdr}>🚀 Ativar agendamento automático</div>
        <div style={{ fontSize:9, color:'rgba(255,255,255,.45)', lineHeight:1.8 }}>
          Execute uma vez para ativar os 4 triggers:<br/>
          <code style={{ color:'#fbbf24', background:'rgba(0,0,0,.3)', padding:'1px 5px', borderRadius:3 }}>
            cd functions && npm run build
          </code><br/>
          <code style={{ color:'#fbbf24', background:'rgba(0,0,0,.3)', padding:'1px 5px', borderRadius:3 }}>
            firebase deploy --only functions
          </code><br/><br/>
          <span style={{ color:'#4a5a7a' }}>Triggers criados:</span><br/>
          • Guard diário — 7h, seg a sáb<br/>
          • Guard semanal — 7h, toda segunda<br/>
          • Perdas diário — 7h, seg a sáb<br/>
          • Perdas semanal — 7h, toda segunda
        </div>
      </div>

      {/* Envio manual Guard */}
      <div style={sec}>
        <div style={hdr}>🛡 Relatório Guard — Envio manual</div>
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
          { tipo:'guard', periodo:'ontem',  label:'📅 Guard Diário (ontem)',      cor:'#a78bfa' },
          { tipo:'guard', periodo:'semana', label:'📆 Guard Semanal (sem. ant.)', cor:'#818cf8' },
        ].map(({ tipo, periodo, label, cor }) => (
          <button key={label}
            disabled={!!enviando}
            onClick={() => chamarFunction(tipo, periodo, label)}
            style={{ ...btn, background:'rgba(167,139,250,.08)', border:`1px solid rgba(167,139,250,.2)`, color:cor }}>
            {enviando === label ? '⏳ Enviando...' : label}
          </button>
        ))}
      </div>

      {/* Envio manual Perdas */}
      <div style={sec}>
        <div style={hdr}>💸 Relatório Perdas — Envio manual</div>
        {[
          { tipo:'perdas', periodo:'ontem',  label:'📅 Perdas Diário (ontem)',      cor:'#f87171' },
          { tipo:'perdas', periodo:'semana', label:'📆 Perdas Semanal (sem. ant.)', cor:'#fca5a5' },
        ].map(({ tipo, periodo, label, cor }) => (
          <button key={label}
            disabled={!!enviando}
            onClick={() => chamarFunction(tipo, periodo, label)}
            style={{ ...btn, background:'rgba(239,68,68,.08)', border:`1px solid rgba(239,68,68,.2)`, color:cor }}>
            {enviando === label ? '⏳ Enviando...' : label}
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
        <div style={hdr}>📋 Histórico de Alterações</div>
        <GuardHistorico />
      </div>

      {/* Exportar Excel */}
      <div style={sec}>
        <div style={hdr}>📊 Exportar Guard para Excel</div>
        <GuardExportExcel />
      </div>

      {/* Auditoria de incidente */}
      {isAdmin && (
      <div style={sec}>
        <div style={hdr}>🔍 Auditoria de Incidente</div>
        <GuardAuditoriaPanel />
      </div>
      )}

      {/* Export CSV Ocorrências */}
      <div style={sec}>
        <div style={hdr}>⬇ Exportar Ocorrências (CSV)</div>
        <GuardExportCSV />
      </div>

      {/* Nota */}
      <div style={{ margin:'12px 16px 20px', padding:'10px 14px', borderRadius:8,
        background:'rgba(59,130,246,.04)', border:'1px solid rgba(59,130,246,.12)',
        fontSize:9, color:'rgba(255,255,255,.35)', lineHeight:1.8 }}>
        O PDF é gerado server-side e enviado como arquivo .html diretamente no Telegram.
        O Telegram renderiza o HTML na visualização do arquivo.
        Para PDF nativo, adicione <code style={{color:'#60a5fa'}}>puppeteer</code> nas functions.
      </div>
    </div>
  );
}

// ── Export CSV de Ocorrências Guard ──────────────────────────────────────────
function GuardExportCSV() {
  const [periodo,   setPeriodo]   = useLocalState<'7d'|'30d'|'90d'|'todos'>('30d');
  const [exportando, setExportando] = useLocalState(false);

  const exportar = async () => {
    setExportando(true);
    try {
      const desde = periodo === 'todos' ? new Date(0) :
        periodo === '7d'  ? new Date(Date.now() - 7  * 86400000) :
        periodo === '30d' ? new Date(Date.now() - 30 * 86400000) :
                            new Date(Date.now() - 90 * 86400000);

      const snap = await getDocs(query(
        collection(db, 'ocorrencias'),
        orderBy('criadoEm', 'desc'),
        limit(2000),
      ));

      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(o => {
          if (periodo === 'todos') return true;
          const d = o.criadoEm?.toDate?.() ?? new Date(0);
          return d >= desde;
        });

      const h = ['ID','Tipo','Status','Descrição','Local','Cidade','Patinete',
                 'Lat','Lng','Criado em','Criado por','Resolvido em','Recuperado'];
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
      alert('Erro ao exportar: ' + e.message);
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
        }}>{p === 'todos' ? 'Tudo' : p}</button>
      ))}
      <button onClick={exportar} disabled={exportando} style={{
        padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'rgba(59,130,246,.8)', color: '#fff', fontSize: 11, fontWeight: 700,
        opacity: exportando ? 0.6 : 1,
      }}>
        {exportando ? '⏳ Exportando...' : '⬇ Baixar CSV'}
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
      setMsg('✓ Configuração salva!');
    } catch(e:any) { setMsg('✗ Erro: ' + e.message); }
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
        Envio imediato no Telegram quando um incidente é registrado no app.
        Usa o mesmo bot configurado acima.
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
            {cfg.ativo ? '🔔 Notificações ATIVAS' : '🔕 Notificações desativadas'}
          </div>
          <div style={{ fontSize:9, color:'#4a5a7a' }}>
            Alertas em tempo real para novos incidentes
          </div>
        </div>
      </label>

      {/* Chat ID alternativo */}
      <label style={{ fontSize:9, color:'#4a5a7a', marginBottom:3, display:'block' }}>
        Chat ID para notificações (deixe vazio para usar o mesmo dos relatórios)
      </label>
      <input value={cfg.chatIdNotif} onChange={e=>setCfg(c=>({...c,chatIdNotif:e.target.value}))}
        placeholder="-100123456789 (opcional)" style={inp}/>

      {/* Tipos de evento */}
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:6, marginTop:4 }}>
        Notificar quando:
      </div>
      {chk('roubos',    '🔴 Novo Roubo ou Furto registrado', '#ef4444')}
      {chk('vandalismo','🟡 Novo Vandalismo registrado',       '#f59e0b')}
      {chk('criticos',  '⚠️ Incidente com prioridade Alta/Crítica', '#f97316')}
      {chk('procurando','🔍 Ativo marcado como Procurando',   '#ef4444')}

      {/* Prioridade mínima */}
      <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3, marginTop:8 }}>
        Prioridade mínima para notificar
      </div>
      <select value={cfg.minPrioridade} onChange={e=>setCfg(c=>({...c,minPrioridade:e.target.value}))}
        style={{...inp, cursor:'pointer', marginBottom:12}}>
        <option value="Baixa">Todas (incluir Baixa)</option>
        <option value="Média">Média ou superior</option>
        <option value="Alta">Apenas Alta/Crítica</option>
      </select>

      <button onClick={salvar} disabled={salvando}
        style={{ width:'100%', padding:'10px', borderRadius:8, cursor:'pointer',
          background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.3)',
          color:'#a78bfa', fontSize:12, fontWeight:600 }}>
        {salvando ? '⏳ Salvando...' : '💾 Salvar configuração'}
      </button>

      {msg && (
        <div style={{ marginTop:8, padding:'7px 12px', borderRadius:8, fontSize:11,
          background: msg.startsWith('✓') ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
          color: msg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{msg}</div>
      )}

      <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8, fontSize:9,
        color:'rgba(255,255,255,.3)', background:'rgba(255,255,255,.03)',
        border:'1px solid rgba(255,255,255,.06)', lineHeight:1.7 }}>
        <strong style={{color:'rgba(255,255,255,.5)'}}>Como funciona:</strong><br/>
        A Cloud Function <code style={{color:'#60a5fa'}}>relatorioGuardDiarioFn</code> monitora novos
        documentos na coleção <code style={{color:'#60a5fa'}}>ocorrencias</code> e envia alertas
        instantâneos conforme os filtros acima.
        Para ativar o trigger em tempo real, adicione um
        <code style={{color:'#60a5fa'}}> onDocumentCreated</code> nas Cloud Functions.
      </div>
    </div>
  );
}

// ── Histórico de Alterações de Incidentes ─────────────────────────────
function GuardHistorico() {
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
        Digite o ID do incidente (JET-SEC-...) para ver todas as edições registradas.
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
              Nenhuma alteração registrada para este incidente.
            </div>
          ) : it._erro ? (
            <div key={i} style={{ fontSize:10, color:'#f87171' }}>Erro: {it._erro}</div>
          ) : (
            <div key={it.id} style={{ padding:'8px 10px', marginBottom:6, borderRadius:8,
              background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:10, color:'#a78bfa', fontWeight:600 }}>
                  ✏️ {it.alteradoPor || 'Sistema'}
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
                  Motivo: {it.motivo}
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

      // Buscar ocorrências com filtros
      let q: any = collection(db, 'ocorrencias');
      const snap = await getDocs(q);
      let docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];

      // Filtrar client-side
      if (filtros.tipo)   docs = docs.filter(d => d.tipo   === filtros.tipo);
      if (filtros.status) docs = docs.filter(d => d.status === filtros.status);
      if (filtros.cidade) docs = docs.filter(d => (d.cidade_inicial||'').toLowerCase().includes(filtros.cidade.toLowerCase()));
      if (filtros.de || filtros.ate) {
        docs = docs.filter(d => {
          const ts = d.criadoEm?.toDate?.() ? d.criadoEm.toDate()
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
          'ID':            d.id || '',
          'Data':          ts ? ts.toLocaleDateString('pt-BR') : '',
          'Hora':          ts ? ts.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '',
          'Tipo':          d.tipo || '',
          'Status':        d.status || '',
          'Prioridade':    d.prioridade || '',
          'Ativo Tipo':    d.ativo_tipo || '',
          'Asset ID':      d.asset_id || '',
          'Cidade':        d.cidade_inicial || '',
          'Bairro':        d.bairro_inicial || '',
          'Endereço':      d.endereco_inicial || '',
          'Responsável':   d.responsavel || '',
          'Descrição':     d.descricao || '',
          'Observação':    d.observacao_fechamento || '',
          'Resultado':     d.resultado || '',
          'Procurando':    d.procurando ? 'Sim' : '',
          'Lat':           d.lat_inicial || '',
          'Lng':           d.lng_inicial || '',
        };
      });

      const wb = w.XLSX.utils.book_new();
      const ws = w.XLSX.utils.json_to_sheet(rows);

      // Largura automática das colunas
      const colWidths = Object.keys(rows[0] || {}).map(k => ({
        wch: Math.max(k.length, ...rows.map((r: any) => String(r[k]||'').length).slice(0,50))
      }));
      ws['!cols'] = colWidths;

      w.XLSX.utils.book_append_sheet(wb, ws, 'Guard');

      // Segunda aba — resumo por cidade
      const porCidade: Record<string,number> = {};
      docs.forEach(d => { const c = d.cidade_inicial||'Desconhecida'; porCidade[c]=(porCidade[c]||0)+1; });
      const resumo = Object.entries(porCidade).sort((a,b)=>b[1]-a[1])
        .map(([c,n])=>({'Cidade':c,'Total':n}));
      const ws2 = w.XLSX.utils.json_to_sheet(resumo);
      w.XLSX.utils.book_append_sheet(wb, ws2, 'Resumo por Cidade');

      const data = new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
      w.XLSX.writeFile(wb, `guard_export_${data}.xlsx`);
    } catch(e:any) {
      alert('Erro ao exportar: ' + e.message);
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
        Filtros opcionais — deixe em branco para exportar tudo
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
        <select value={filtros.tipo} onChange={e=>setFiltros(f=>({...f,tipo:e.target.value}))} style={sel}>
          <option value=''>Todos os tipos</option>
          {['Roubo','Furto','Vandalismo','Tentativa','Alarme','Recuperacao'].map(t=>(
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={filtros.status} onChange={e=>setFiltros(f=>({...f,status:e.target.value}))} style={sel}>
          <option value=''>Todos os status</option>
          {['Aberto','Em apuracao','Encerrado','Recuperado'].map(s=>(
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <input value={filtros.cidade} onChange={e=>setFiltros(f=>({...f,cidade:e.target.value}))}
        placeholder='Filtrar por cidade...' style={inp}/>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
        <div>
          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>De</div>
          <input type='date' value={filtros.de} onChange={e=>setFiltros(f=>({...f,de:e.target.value}))} style={inp}/>
        </div>
        <div>
          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Até</div>
          <input type='date' value={filtros.ate} onChange={e=>setFiltros(f=>({...f,ate:e.target.value}))} style={inp}/>
        </div>
      </div>
      <button onClick={exportar} disabled={carregando}
        style={{ width:'100%', padding:'10px', borderRadius:8, cursor:'pointer',
          background:'rgba(34,197,94,.1)', border:'1px solid rgba(34,197,94,.3)',
          color:'#4ade80', fontSize:12, fontWeight:600 }}>
        {carregando ? '⏳ Gerando...' : '📊 Exportar Excel (.xlsx)'}
      </button>
    </div>
  );
}

// ── Auditoria de Incidente — alterar data/campos ───────────────────────
function GuardAuditoriaPanel() {
  const [busca,    setBusca]    = useState('');
  const [ocorr,    setOcorr]    = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg,      setMsg]      = useState('');
  const [form,     setForm]     = useState<any>({});

  const buscarIncidente = async () => {
    if (!busca.trim()) return;
    setOcorr(null); setMsg('');
    try {
      // Busca por ID exato ou asset_id
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
      setMsg('Incidente não encontrado: ' + busca);
    } catch(e:any) { setMsg('Erro: ' + e.message); }
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
      setMsg('✓ Incidente auditado e salvo com sucesso!');
    } catch(e:any) { setMsg('Erro ao salvar: ' + e.message); }
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
        Busque por ID do incidente (JET-SEC-...) ou Asset ID para editar data, tipo, status e outros campos.
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:10 }}>
        <input value={busca} onChange={e=>setBusca(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&buscarIncidente()}
          placeholder='ID ou Asset ID...' style={{...inp, marginBottom:0, flex:1}}/>
        <button onClick={buscarIncidente}
          style={{ padding:'6px 12px', borderRadius:6, cursor:'pointer',
            background:'rgba(99,102,241,.15)', border:'1px solid rgba(99,102,241,.3)',
            color:'#818cf8', fontSize:11, fontWeight:600, whiteSpace:'nowrap' as const }}>
          🔍 Buscar
        </button>
      </div>

      {ocorr && (
        <div style={{ background:'rgba(255,255,255,.03)', borderRadius:10,
          border:'1px solid rgba(255,255,255,.08)', padding:'12px' }}>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, marginBottom:10 }}>
            ✏️ Editando: {ocorr.id}
          </div>

          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>📅 Data do incidente</div>
          <input type='datetime-local' style={inp}
            defaultValue={fmtDateInput(ocorr.created_at || ocorr.criadoEm)}
            onChange={e=>setForm((f:any)=>({...f,created_at_edit:e.target.value}))}/>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Tipo</div>
              <select value={form.tipo||''} onChange={e=>setForm((f:any)=>({...f,tipo:e.target.value}))}
                style={{...inp, cursor:'pointer'}}>
                {['Roubo','Furto','Vandalismo','Tentativa','Alarme','Recuperacao'].map(t=>(
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Status</div>
              <select value={form.status||''} onChange={e=>setForm((f:any)=>({...f,status:e.target.value}))}
                style={{...inp, cursor:'pointer'}}>
                {['Aberto','Em apuracao','Encerrado','Recuperado'].map(s=>(
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Asset ID</div>
              <input value={form.asset_id||''} onChange={e=>setForm((f:any)=>({...f,asset_id:e.target.value}))} style={inp}/>
            </div>
            <div>
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Responsável</div>
              <input value={form.responsavel||''} onChange={e=>setForm((f:any)=>({...f,responsavel:e.target.value}))} style={inp}/>
            </div>
          </div>

          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Cidade</div>
          <input value={form.cidade_inicial||''} onChange={e=>setForm((f:any)=>({...f,cidade_inicial:e.target.value}))} style={inp}/>

          <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:3 }}>Observação de auditoria</div>
          <textarea value={form.observacao_fechamento||''} rows={2}
            onChange={e=>setForm((f:any)=>({...f,observacao_fechamento:e.target.value}))}
            style={{...inp, resize:'vertical' as const}}/>

          <button onClick={salvarAuditoria} disabled={salvando}
            style={{ width:'100%', padding:'10px', borderRadius:8, cursor:'pointer', marginTop:4,
              background:'rgba(167,139,250,.1)', border:'1px solid rgba(167,139,250,.3)',
              color:'#a78bfa', fontSize:12, fontWeight:600 }}>
            {salvando ? '⏳ Salvando...' : '💾 Salvar auditoria'}
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
        const snapUs = await getDocs(collection(db,'usuarios'));
        setUsuarios(snapUs.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch(e) { console.error(e); }
      setLoading(false);
    };
    carregarDados();
  }, []);

  const aprovar = async (sol: any, role: string) => {
    try {
      const senhaGerada = gerarSenha();
      // Chama CF para aprovar e criar usuário Firebase Auth
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const { getApp } = await import('firebase/app');
      const fnAprovar = httpsCallable(getFunctions(getApp(), 'southamerica-east1'), 'aprovarSolicitacaoFn');
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
      alert('Erro ao aprovar: ' + e.message);
    }
  };

  const alterarRole = async (uid: string, novoRole: string) => {
    try {
      await updateDoc(doc(collection(db,'usuarios'), uid), { role: novoRole });
      setUsuarios(u => u.map(x => x.id === uid ? { ...x, role: novoRole } : x));
    } catch(e:any) { alert('Erro: ' + e.message); }
  };

  const copiarWhats = (email: string, senha: string) => {
    const txt = `Olá! Seu acesso ao JET OS foi aprovado.

E-mail: ${email}
Senha: ${senha}

Acesse: https://jet-os-7.web.app

Recomendamos trocar a senha após o primeiro acesso.`;
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
              ✅ Usuário aprovado!
            </div>
            <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:16 }}>
              Copie as credenciais e envie pelo WhatsApp.
            </div>

            <div style={{ background:'rgba(255,255,255,.04)', borderRadius:10,
              padding:'12px 14px', marginBottom:14,
              border:'1px solid rgba(255,255,255,.08)' }}>
              <div style={{ fontSize:10, color:'#4a5a7a', marginBottom:4 }}>E-mail</div>
              <div style={{ fontSize:13, color:'#dce8ff', fontWeight:600 }}>{senhaTemp.email}</div>
              <div style={{ fontSize:10, color:'#4a5a7a', marginTop:10, marginBottom:4 }}>Senha temporária</div>
              <div style={{ fontSize:20, color:'#fbbf24', fontWeight:800,
                fontFamily:'monospace', letterSpacing:2 }}>{senhaTemp.senha}</div>
            </div>

            <button onClick={() => copiarWhats(senhaTemp.email, senhaTemp.senha)}
              style={{ width:'100%', padding:'11px', borderRadius:10, cursor:'pointer',
                background: copiado ? 'rgba(74,222,128,.15)' : 'rgba(37,211,102,.15)',
                border: `1px solid ${copiado ? 'rgba(74,222,128,.4)' : 'rgba(37,211,102,.3)'}`,
                color: copiado ? '#4ade80' : '#25d366',
                fontSize:13, fontWeight:700, marginBottom:8 }}>
              {copiado ? '✓ Copiado!' : '📱 Copiar mensagem para WhatsApp'}
            </button>

            <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:12, textAlign:'center' }}>
              O usuário deverá trocar a senha após o primeiro acesso.
            </div>

            <button onClick={() => setSenhaTemp(null)}
              style={{ width:'100%', padding:'9px', borderRadius:10, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Abas */}
      <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
        {([['pendentes','⏳ Pendentes',solicitacoes.length],['ativos','✅ Ativos',usuarios.length]] as any[]).map(([k,l,n]) => (
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
        <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>Carregando...</div>
      )}

      {/* Solicitações pendentes */}
      {aba === 'pendentes' && !loading && (
        <div>
          {solicitacoes.length === 0 ? (
            <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>
              Nenhuma solicitação pendente.
            </div>
          ) : solicitacoes.map(sol => (
            <div key={sol.id} style={{ ...sec }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff', marginBottom:2 }}>{sol.nome || sol.email}</div>
              <div style={{ fontSize:10, color:'#4a5a7a', marginBottom:8 }}>{sol.email} · {sol.cargo || ''} · {sol.empresa || ''}</div>
              {sol.motivo && <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', marginBottom:10,
                padding:'6px 10px', background:'rgba(255,255,255,.03)', borderRadius:6 }}>{sol.motivo}</div>}
              <div style={{ fontSize:9, color:'#4a5a7a', marginBottom:6 }}>Aprovar como:</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
                {[['campo','Campo'],['guard','Guard'],['gestor_seg','Gest. Seg'],['gestor','Gestor']].map(([r,l]) => (
                  <button key={r} onClick={() => aprovar(sol, r)}
                    style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                      background:`${(ROLE_CORES[r]||'#f97316')}15`, border:`1px solid ${(ROLE_CORES[r]||'#f97316')}40`,
                      color: ROLE_CORES[r]||'#f97316' }}>
                    ✓ {l}
                  </button>
                ))}
                <button onClick={async () => {
                  await updateDoc(doc(collection(db,'solicitacoes'),sol.id),{status:'rejeitada'});
                  setSolicitacoes(s => s.filter(x => x.id !== sol.id));
                }} style={{ padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:11,
                  background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', color:'#f87171' }}>
                  ✗ Rejeitar
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
              placeholder="🔍 Buscar por nome ou e-mail..."
              style={{ flex:1, minWidth:140, padding:'7px 10px', borderRadius:8,
                border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.05)',
                color:'#dce8ff', fontSize:11, outline:'none' }}
            />
            <select value={filtroRole} onChange={e => setFiltroRole(e.target.value)}
              style={{ padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,.1)',
                background:'#111722', color:'#dce8ff', fontSize:11, cursor:'pointer' }}>
              <option value="todos">Todos os roles</option>
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
                  {filtrados.length} usuário{filtrados.length !== 1 ? 's' : ''} encontrado{filtrados.length !== 1 ? 's' : ''}
                </div>
                {filtrados.length === 0 ? (
                  <div style={{ padding:20, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>
                    Nenhum usuário encontrado.
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
                        🏙 {u.cidadesPermitidas?.length ? u.cidadesPermitidas.length + ' cid.' : 'Cidades'}
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
  const [periodo, setPeriodo] = useState<'dia'|'semana'|'mes'|'ano'|'custom'>('mes');
  const [customDe, setCustomDe] = useState('');
  const [customAte, setCustomAte] = useState('');

  const filtradas = cidade ? estacoes.filter(e => e.cidade === cidade) : estacoes;

  // Contagem por tipo
  const porTipo = [
    { label:'Pública',      cor:'#3b82f6', count: filtradas.filter(e=>e.tipo==='PUBLICA').length },
    { label:'Privada',      cor:'#a78bfa', count: filtradas.filter(e=>e.tipo==='PRIVADA').length },
    { label:'Concorrente',  cor:'#f97316', count: filtradas.filter(e=>e.tipo==='CONCORRENTE').length },
  ];
  const total = filtradas.length;

  // Contagem por status
  const porStatus = [
    { label:'Solicitado',  cor:'#fbbf24', count: filtradas.filter(e=>e.status==='SOLICITADO').length },
    { label:'Aprovado',    cor:'#60a5fa', count: filtradas.filter(e=>e.status==='APROVADO').length },
    { label:'Instalado',   cor:'#4ade80', count: filtradas.filter(e=>e.status==='INSTALADO').length },
    { label:'Reprovado',   cor:'#f87171', count: filtradas.filter(e=>e.status==='REPROVADO').length },
    { label:'Cancelado',   cor:'#6b7280', count: filtradas.filter(e=>e.status==='CANCELADO').length },
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
        📊 Análise de Estações {cidade ? `— ${cidade}` : '— Todas as cidades'}
      </div>

      {/* Seletor de período */}
      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' as const }}>
        {([['dia','Diário'],['semana','Semanal'],['mes','Mensal'],['ano','Anual'],['custom','Personalizado']] as const).map(([k,l]) => (
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
          <span style={{ color:'#4a5a7a', fontSize:12 }}>até</span>
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
        <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.5)', marginBottom:10 }}>Por tipo</div>
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
        <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.5)', marginBottom:10 }}>Por status</div>
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
              Evolução por status no período
            </div>
            <div style={{ fontSize:9, color:'#4a5a7a' }}>
              Total: {filtradas.length} estações
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
      alert('Erro: ' + e.message);
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
          🏙 Cidades permitidas
        </div>
        <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:16 }}>
          {usuario.nome || usuario.email}
        </div>

        {cidadesReais.length === 0 ? (
          <div style={{ color:'#4a5a7a', fontSize:12, marginBottom:16 }}>
            Carregando cidades...
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
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            style={{ flex:2, padding:'8px', borderRadius:8, border:'none',
              background: salvando ? 'rgba(59,130,246,.4)' : '#3b82f6',
              color:'#fff', fontSize:12, fontWeight:700, cursor: salvando ? 'not-allowed' : 'pointer' }}>
            {salvando ? '⏳ Salvando...' : `💾 Salvar (${selecionadas.length} cidades)`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardManager({ cidades, pais, onFechar, roleAtual }: Props) {
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

  // Carrega estações da cidade
  useEffect(() => {
    setCarregando(true);
    // Busca por cidade sem filtrar pais (campo pais pode estar errado nas estações importadas)
    const q = cidades.length === 1
      ? query(collection(db, 'estacoes'), where('cidade','==',cidades[0]))
      : cidades.length > 1
        ? query(collection(db, 'estacoes'), where('cidade','in',cidades.slice(0,10)))
        : query(collection(db, 'estacoes'));
    getDocs(q).then(snap => {
      setEstacoes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Estacao)));
      setCarregando(false);
    }).catch(() => setCarregando(false));
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
    setImportLog(['Lendo XLSX...']);
    const { validos, ignorados } = await parseXlsxUrent(file);

    setImportLog(prev => [...prev,
      `Encontradas: ${validos.length + ignorados.length} entradas`,
      `Válidas: ${validos.length}`,
      `Ignoradas: ${ignorados.length} (${ignorados.slice(0,3).map(i => i.motivo).join('; ')}${ignorados.length > 3 ? '...' : ''})`,
    ]);

    if (validos.length === 0) {
      setImportResult({ total: ignorados.length, novos: 0, atualizados: 0, ignorados: ignorados.length, erros: ignorados.map(i => i.nome + ': ' + i.motivo) });
      return;
    }

    // Para cada entrada válida: geocode reverso para obter bairro/cidade
    setImportLog(prev => [...prev, 'Normalizando endereços via geocode...']);
    let novos = 0, atualizados = 0, erros: string[] = [];

    const { doc: fsDoc, setDoc: fSetDoc, getDoc: fGetDoc, collection: fCol, serverTimestamp: fTs } = await import('firebase/firestore');
    const { db: fdb } = await import('./lib/firebase');

    for (let i = 0; i < validos.length; i++) {
      const v = validos[i];
      setImportLog(prev => { const n = [...prev]; n[n.length-1] = `Processando ${i+1}/${validos.length}: ${v.nome.slice(0,40)}...`; return n; });

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
    setImportLog(prev => [...prev, '✓ Importação XLSX concluída — ' + novos + ' novas, ' + atualizados + ' atualizadas']);
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
      setImportLog(prev => [...prev, '✓ Importação concluída']);
    } catch(e: unknown) {
      setImportLog(prev => [...prev, '✗ Erro: ' + (e instanceof Error ? e.message : String(e))]);
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
      if (!isGestor) { alert('Apenas gestores podem usar essa função'); return; }
      if (paraProcesar.length === 0) { alert('Selecione estações para atualizar'); return; }
      
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
            Atualizar Status em Massa
          </h3>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 16 }}>
            Selecione o status de origem e destino. Todas as estações com o status de origem serão atualizadas.
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
                  ✅ {resultado.total} estações mudadas de <strong>{resultado.statusOrigem}</strong> para <strong>{resultado.statusDestino}</strong>
                </>
              ) : (
                <>❌ Erro: {resultado.erro}</>
              )}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6, fontWeight: 600 }}>
              De (Status Origem):
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
              Para (Status Destino):
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
                  Estações ({filtradas.length} com status {statusOrigem}):
                </label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <button onClick={() => setModoSelecao('todas')} style={{
                    flex: 1, padding: '6px', fontSize: 10, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: modoSelecao === 'todas' ? '#60a5fa' : 'rgba(255,255,255,.08)',
                    color: modoSelecao === 'todas' ? '#fff' : 'rgba(255,255,255,.4)'
                  }}>Todas ({filtradas.length})</button>
                  <button onClick={() => setModoSelecao('selecionadas')} style={{
                    flex: 1, padding: '6px', fontSize: 10, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: modoSelecao === 'selecionadas' ? '#60a5fa' : 'rgba(255,255,255,.08)',
                    color: modoSelecao === 'selecionadas' ? '#fff' : 'rgba(255,255,255,.4)'
                  }}>Selecionadas ({selecionadas.size})</button>
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
                        {est.codigo} - {est.endereco || est.cidade || '(sem endereço)'}
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
              ℹ️ Nenhuma estação com status "{statusOrigem}"
            </div>
          )}

          <button onClick={handleAtualizar} disabled={atualizando || statusOrigem === statusDestino || paraProcesar.length === 0} style={{
            width: '100%', padding: '10px', borderRadius: 6, border: 'none',
            background: (statusOrigem === statusDestino || paraProcesar.length === 0) ? 'rgba(255,255,255,.1)' : 'linear-gradient(135deg,#10b981,#34d399)',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: (statusOrigem === statusDestino || paraProcesar.length === 0) ? 'not-allowed' : 'pointer',
            opacity: atualizando ? 0.6 : 1
          }}>
            {atualizando ? '⏳ Atualizando...' : `⚡ Atualizar ${paraProcesar.length} estação${paraProcesar.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    );
  };

  const inp: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6
  };

  const ABAS_ALL = [
    { k: 'dashboard', label: '📊 Stats',          show: isGestor },
    { k: 'exportar',  label: '↕ Dados',            show: isGestor },
    { k: 'croquis',   label: '📐 Croquis',          show: isGestor },
    { k: 'fotos',     label: '📸 Fotos',             show: isGestor },
    { k: 'atualizar-status', label: '⚡ Status em massa', show: isGestor },
    { k: 'relatorio', label: '📋 Relatório',        show: isGestor },
    { k: 'guard',     label: '🛡 Guard',            show: isGestor || isGestorSeg },
    { k: 'usuarios',  label: '👥 Usuários',          show: isAdmin  || isGestorSeg },
    { k: 'configuracoes', label: '⚙️ Config',       show: isAdmin  },
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
          {cidades.length > 0 ? cidades.join(' + ') : 'Todas as cidades'}
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
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,.3)' }}>Carregando...</div>
          ) : (
            <>
              {/* Cards principais */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <StatCard label="Total"      valor={total}     cor="#60a5fa" />
                <StatCard label="Instaladas" valor={instaladas} cor="#6ee7b7" sub={`${pct(instaladas,total)}%`} />
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
                  letterSpacing: '.06em', marginBottom: 12 }}>POR TIPO</div>
                {[
                  { label: 'Públicas',     n: publicas, cor: '#3b82f6' },
                  { label: 'Privadas',     n: privadas, cor: '#f59e0b' },
                  { label: 'Concorrentes', n: concorr,  cor: '#ef4444' }
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
                  letterSpacing: '.06em', marginBottom: 12 }}>POR STATUS</div>
                {[
                  { label: 'Solicitadas', n: solicitadas, cor: '#60a5fa' },
                  { label: 'Aprovadas',   n: aprovadas,   cor: '#6ee7b7' },
                  { label: 'Canceladas',  n: estacoes.filter(e=>e.status==='CANCELADO'||e.status==='REPROVADO').length, cor: '#f87171' }
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
                  letterSpacing: '.06em', marginBottom: 12 }}>COBERTURA DE DADOS</div>
                {[
                  { label: 'Com Street View', n: comSV,     cor: '#fbbf24' },
                  { label: 'Com foto',         n: comFoto,   cor: '#f472b6' },
                  { label: 'Com croqui',       n: comCroqui, cor: '#34d399' },
                  { label: 'IA analisada',     n: iaAprovadas + estacoes.filter(e => e.ia && !e.ia.aprovado).length, cor: '#a78bfa' }
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
                    letterSpacing: '.06em', marginBottom: 12 }}>TOP BAIRROS</div>
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
              🌍 Expansão — {cidadesExp.length} cidades
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
                    {c.mercadoEst && <div style={{ fontSize:10, color:m.cor, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{c.mercadoEst.toLocaleString()}/mês</div>}
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
            Selecione uma cidade acima para gerar o relatório completo da cidade
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
              <b style={{ color: '#fbbf24' }}>Importação inteligente:</b> registros com o mesmo
              código são atualizados. Novos são criados. Dados existentes são preservados
              quando o campo estiver vazio no arquivo.
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
              {importFile ? `📁 ${importFile.name}` : '📁 Selecionar arquivo CSV ou JSON'}
            </button>

            {importFile && !importResult && (
              <button onClick={handleImportar} disabled={importando} style={{
                width: '100%', padding: 12,
                background: importando ? 'rgba(48,127,226,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                border: 'none', borderRadius: 10, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: importando ? 'not-allowed' : 'pointer',
                marginBottom: 12
              }}>{importando ? 'Importando...' : 'Iniciar importação'}</button>
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
                  ✓ Importação concluída
                </div>
                {[
                  { label: 'Total processados', n: importResult.total,      cor: '#fff' },
                  { label: 'Novos criados',      n: importResult.novos,      cor: '#6ee7b7' },
                  { label: 'Atualizados',        n: importResult.atualizados,cor: '#60a5fa' },
                  { label: 'Ignorados',          n: importResult.ignorados,  cor: '#fbbf24' }
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{item.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: item.cor }}>{item.n}</span>
                  </div>
                ))}
                {importResult.erros.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ fontSize: 11, color: '#f87171', cursor: 'pointer' }}>
                      {importResult.erros.length} erros (clique para ver)
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
                  }}>Nova importação</button>
              </div>
            )}

            {/* Botão template */}
            <button onClick={baixarTemplate} style={{
              width: '100%', padding: '10px 14px', marginBottom: 12, borderRadius: 10,
              background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.2)',
              color: '#c084fc', fontSize: 12, cursor: 'pointer'
            }}>⬇️ Baixar template CSV com todos os campos</button>

            {/* Guia de campos */}
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', cursor: 'pointer' }}>
                Campos aceitos no CSV/JSON
              </summary>
              <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,.3)',
                background: 'rgba(255,255,255,.02)', padding: 10, borderRadius: 8 }}>
                <b style={{ color: 'rgba(255,255,255,.5)' }}>Obrigatórios:</b> codigo, lat, lng<br/>
                <b style={{ color: 'rgba(255,255,255,.5)' }}>Opcionais:</b> cidade, bairro, tipo (PUBLICA/PRIVADA/CONCORRENTE),
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
    if (!alvo.length) { alert('Nenhuma estação com esses filtros.'); return; }
    if (fonte === 'mapillary' && !mapillaryTok) {
      alert('Informe o token Mapillary (gratuito em mapillary.com/dashboard/developers).');
      return;
    }
    if (!confirm(`Atualizar foto de ${alvo.length} estações via ${FONTES.find(f=>f.k===fonte)?.label}?`)) return;

    setRodando(true); abortRef.current = false;
    setLog([]); setProgresso({ ok:0, erro:0, total: alvo.length });
    let ok = 0, erro = 0;

    const { doc, updateDoc } = await import('firebase/firestore');

    for (let i = 0; i < alvo.length && !abortRef.current; i++) {
      const e = alvo[i];
      const url = buildUrl(e);
      if (!url) {
        erro++;
        setLog(prev => [...prev, { msg: `${e.codigo||e.id}: sem coordenadas`, ok: false }]);
        setProgresso({ ok, erro, total: alvo.length });
        continue;
      }

      try {
        // Para Street View, verificar se existe imagem antes de salvar
        if (fonte === 'streetview') {
          const temFoto = await checkStreetView(e.lat, e.lng);
          if (!temFoto) {
            erro++;
            setLog(prev => [...prev, { msg: `${e.codigo||e.id}: sem cobertura Street View`, ok: false }]);
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
        setLog(prev => [...prev, { msg: `${e.codigo||e.id} (${e.bairro||''}): foto salva`, ok: true }]);
      } catch (err: any) {
        erro++;
        setLog(prev => [...prev, { msg: `${e.codigo||e.id}: erro — ${err.message}`, ok: false }]);
      }

      setProgresso({ ok, erro, total: alvo.length });
      // Respeitar rate limit das APIs
      await new Promise(r => setTimeout(r, fonte === 'streetview' ? 300 : 100));
    }

    setRodando(false);
    setLog(prev => [...prev, { msg: `Concluído: ${ok} atualizadas, ${erro} erros`, ok: true }]);
  };

  const parar = () => { abortRef.current = true; };

  const secTitle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: 'rgba(255,255,255,.25)', marginBottom: 8,
  };

  if (!isGestor) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,.3)', fontSize: 12 }}>
      Apenas gestores e admins podem atualizar fotos em lote.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Fonte */}
      <div>
        <div style={secTitle}>Fonte da foto</div>
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
                  {f.label}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Token Mapillary */}
        {fonte === 'mapillary' && (
          <div style={{ marginTop: 8 }}>
            <input value={mapillaryTok} onChange={e => setMapillaryTok(e.target.value)}
              placeholder="Token Mapillary (mapillary.com/dashboard/developers)"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 7,
                background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                color: '#fff', fontSize: 11, outline: 'none' }} />
          </div>
        )}

        {fonte === 'manual' && (
          <div style={{ padding: 10, borderRadius: 7, background: 'rgba(167,139,250,.08)',
            border: '1px solid rgba(167,139,250,.2)', fontSize: 11, color: 'rgba(255,255,255,.4)',
            marginTop: 8, lineHeight: 1.5 }}>
            No modo manual, clique na estação no mapa → botão 📷 Foto → selecione a imagem.<br/>
            Use as opções abaixo para filtrar quais estações ver no mapa.
          </div>
        )}
      </div>

      {/* Filtros */}
      {fonte !== 'manual' && (
        <div>
          <div style={secTitle}>Filtros</div>

          {/* Apenas vazias */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: 12, color: 'rgba(255,255,255,.6)', marginBottom: 8 }}>
            <input type="checkbox" checked={apenasVazias}
              onChange={e => setApenasVazias(e.target.checked)} />
            Apenas estações sem foto Street View
          </label>

          {/* Status */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 4 }}>Status</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {['todos', 'SOLICITADO', 'APROVADO', 'CANCELADO'].map(s => (
                <button key={s} onClick={() => setFiltroStatus(s)} style={{
                  padding: '3px 9px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600,
                  background: filtroStatus === s ? 'rgba(61,155,255,.2)' : 'rgba(255,255,255,.04)',
                  color: filtroStatus === s ? '#3d9bff' : 'rgba(255,255,255,.35)',
                  outline: filtroStatus === s ? '1px solid rgba(61,155,255,.3)' : '1px solid rgba(255,255,255,.06)',
                }}>{s === 'todos' ? 'Todos' : s}</button>
              ))}
            </div>
          </div>

          {/* Bairro */}
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 4 }}>Bairro</div>
            <select value={filtroBairro} onChange={e => setFiltroBairro(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 7,
                background: '#111722', border: '1px solid rgba(255,255,255,.1)',
                color: '#dce8ff', fontSize: 11 }}>
              <option value="">Todos os bairros</option>
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
              ? `${alvo.length} estações serão atualizadas`
              : 'Nenhuma estação com esses filtros'}
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
            <span>✅ {progresso.ok} atualizadas</span>
            <span>❌ {progresso.erro} erros</span>
            <span>⏳ {progresso.total - progresso.ok - progresso.erro} restantes</span>
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
              📸 Iniciar atualização ({alvo.length})
            </button>
          ) : (
            <button onClick={parar} style={{
              flex: 1, padding: '12px', borderRadius: 10,
              border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)',
              color: '#f87171', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>⏹ Parar</button>
          )}
        </div>
      )}
    </div>
  );
}
