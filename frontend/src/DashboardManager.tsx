// DashboardManager.tsx — Dashboard + Custos API + Exportação/Importação
import { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, where, doc, writeBatch, getDoc } from 'firebase/firestore';
import { db, fnSvEstatisticas, fnGerarCroquisLote } from './lib/firebase';
import { useCidadesExpansao, STATUS_META, type CidadeExpansao } from './CidadesExpansao';


interface Estacao {
  id: string; codigo: string; cidade: string; bairro: string;
  tipo: string; status: string; pais: string;
  subprefeitura?: string;
  endereco?: string;
  tpu?: string;
  croquiGeradoEm?: any;
  lat: number; lng: number; larguraFaixa?: number;
  operador?: string; criadoEm?: any;
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

    // Normaliza lat/lng
    const lat = parseFloat(getNome(row, 'lat', 'latitude', 'Latitude', 'LAT'));
    const lng = parseFloat(getNome(row, 'lng', 'longitude', 'Longitude', 'LNG', 'lon'));
    const codigo = String(getNome(row, 'codigo', 'Codigo', 'CodigoEstacao', 'code', 'id') || '').trim();

    // Validações
    if (isNaN(lat) || isNaN(lng)) {
      result.erros.push(`Linha ${i + 2}: lat/lng inválidos (${row.lat}, ${row.lng})`);
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
    const status = String(getNome(row, 'status', 'StatusEstacao', 'Status') || 'SOLICITADO').toUpperCase();
    const cidade = String(getNome(row, 'cidade', 'Cidade') || '');
    const bairro = String(getNome(row, 'bairro', 'Bairro') || '');

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
      // Atualiza apenas campos não-vazios, preserva dados existentes
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

// ── RELATÓRIO PREFEITURA ─────────────────────────────────────────
const CAMPOS_RELATORIO = [
  { key: 'codigo',      label: 'Código',       default: true  },
  { key: 'endereco',    label: 'Endereço',      default: true  },
  { key: 'tipo',        label: 'Tipo',          default: true  },
  { key: 'status',      label: 'Status',        default: true  },
  { key: 'larguraFaixa',label: 'Largura (m)',   default: true  },
  { key: 'ia_aprovado', label: 'IA Aprovado',   default: true  },
  { key: 'ia_score',    label: 'IA Score',      default: false },
  { key: 'croqui',      label: 'Link Croqui',   default: true  },
  { key: 'foto',        label: 'Link Foto',     default: false },
  { key: 'streetView',  label: 'Link SV',       default: false },
  { key: 'operador',    label: 'Operador',       default: false },
  { key: 'lat',         label: 'Latitude',      default: false },
  { key: 'lng',         label: 'Longitude',     default: false },
];

function getValRelatorio(e: Estacao, key: string): string {
  const m: Record<string, string> = {
    codigo:      e.codigo || '',
    endereco:    (e as any).endereco || '',
    tipo:        e.tipo || '',
    status:      e.status || '',
    larguraFaixa: e.larguraFaixa ? String(e.larguraFaixa) : '',
    ia_aprovado: e.ia?.aprovado != null ? (e.ia.aprovado ? 'SIM' : 'NAO') : '',
    ia_score:    e.ia?.score ? String(e.ia.score) : '',
    croqui:      e.imagens?.croqui || '',
    foto:        e.imagens?.foto || '',
    streetView:  e.imagens?.streetView || '',
    operador:    e.operador || '',
    lat:         String(e.lat || ''),
    lng:         String(e.lng || ''),
  };
  return m[key] ?? '';
}

function RelatorioManager({ estacoes, cidade, pais, total }: {
  estacoes: Estacao[]; cidade: string; pais: string; total: number;
}) {
  const [campos, setCampos]   = useState<string[]>(CAMPOS_RELATORIO.filter(c => c.default).map(c => c.key));
  const [formato, setFormato] = useState<'csv'|'excel'|'pdf'>('csv');
  const [gerando, setGerando] = useState(false);

  const toggle = (key: string) =>
    setCampos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  // Agrupa por bairro
  const porBairro: Record<string, Estacao[]> = {};
  estacoes.forEach(e => {
    const b = e.bairro || 'Sem bairro';
    if (!porBairro[b]) porBairro[b] = [];
    porBairro[b].push(e);
  });
  const bairrosOrdenados = Object.entries(porBairro).sort((a,b) => b[1].length - a[1].length);

  const gerarCSV = () => {
    setGerando(true);
    const linhas: string[] = [];
    const sep = formato === 'excel' ? ';' : ',';
    const header = ['Bairro', ...campos.map(k => CAMPOS_RELATORIO.find(c=>c.key===k)?.label || k)];
    linhas.push(header.join(sep));

    bairrosOrdenados.forEach(([bairro, ests]) => {
      ests.forEach(e => {
        const linha = [bairro, ...campos.map(k => `"${getValRelatorio(e,k).replace(/"/g,'""')}"`)]
        linhas.push(linha.join(sep));
      });
    });

    const bom = '\uFEFF';
    const blob = new Blob([bom + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `relatorio_${cidade.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.${formato === 'excel' ? 'csv' : 'csv'}`;
    a.click();
    URL.revokeObjectURL(url);
    setGerando(false);
  };

  const gerarPDF = () => {
    setGerando(true);
    const camposRel = CAMPOS_RELATORIO.filter(c => campos.includes(c.key));
    const headers = ['Bairro', ...camposRel.map(c => c.label)];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Relatório ${cidade}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#222}
  h1{color:#1a6fd4;font-size:16px;margin:0 0 4px}
  h2{color:#555;font-size:12px;margin:14px 0 6px;border-bottom:1px solid #eee;padding-bottom:3px}
  table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:12px}
  th{background:#1a6fd4;color:#fff;padding:5px 6px;text-align:left;font-size:10px}
  td{padding:4px 6px;border-bottom:1px solid #f0f0f0}
  tr:nth-child(even){background:#f9f9f9}
  .bairro{background:#e0e7ff;font-weight:700;color:#3730a3;font-size:11px}
  .badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700}
  .APROVADO{background:#d1fae5;color:#065f46}
  .SOLICITADO{background:#dbeafe;color:#1e40af}
  .CANCELADO,.REPROVADO{background:#fee2e2;color:#991b1b}
  @media print{button{display:none}body{padding:8px}}
</style></head><body>
<h1>Relatório — ${cidade}</h1>
<p style="font-size:10px;color:#888">Gerado em ${new Date().toLocaleString('pt-BR')} · ${total} estações</p>
<table>
  <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
  ${bairrosOrdenados.map(([bairro, ests]) => [
    `<tr><td class="bairro" colspan="${headers.length}">📍 ${bairro} (${ests.length} estações)</td></tr>`,
    ...ests.map(e => `<tr>${['', ...campos].map((k, i) => {
      if (i === 0) return '';
      const v = getValRelatorio(e, k);
      const isStatus = k === 'status';
      return isStatus ? `<td><span class="badge ${v}">${v}</span></td>` : `<td>${v}</td>`;
    }).filter((_,i)=>i>0).join('')}</tr>`)
  ].join('')).join('')}
</table>
</body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=700');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
    setGerando(false);
  };

  return (
    <>
      <div style={{ padding: 12, borderRadius: 8, marginBottom: 14,
        background: 'rgba(96,165,250,.06)', border: '1px solid rgba(96,165,250,.15)' }}>
        <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600, marginBottom: 2 }}>
          Relatório — {cidade}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
          {total} estações · {bairrosOrdenados.length} bairros · organizado por bairro
        </div>
      </div>

      {/* Preview por bairro */}
      <div style={{ marginBottom: 14, maxHeight: 140, overflowY: 'auto',
        border: '1px solid rgba(255,255,255,.06)', borderRadius: 8 }}>
        {bairrosOrdenados.slice(0,5).map(([b, ests]) => (
          <div key={b} style={{ display: 'flex', justifyContent: 'space-between',
            padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,.04)',
            fontSize: 11 }}>
            <span style={{ color: 'rgba(255,255,255,.6)' }}>{b}</span>
            <span style={{ color: '#60a5fa', fontWeight: 600 }}>{ests.length} est.</span>
          </div>
        ))}
        {bairrosOrdenados.length > 5 && (
          <div style={{ padding: '6px 10px', fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
            + {bairrosOrdenados.length - 5} bairros...
          </div>
        )}
      </div>

      {/* Campos */}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 700,
        letterSpacing: '.08em', marginBottom: 8 }}>CAMPOS</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {CAMPOS_RELATORIO.map(c => (
          <button key={c.key} onClick={() => toggle(c.key)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
            background: campos.includes(c.key) ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${campos.includes(c.key) ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.08)'}`,
            color: campos.includes(c.key) ? '#60a5fa' : 'rgba(255,255,255,.35)'
          }}>{c.label}</button>
        ))}
      </div>

      {/* Formato */}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 700,
        letterSpacing: '.08em', marginBottom: 8 }}>FORMATO</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([['csv','CSV padrão'],['excel','CSV Excel'],['pdf','📕 PDF']] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFormato(f)} style={{
            flex: 1, padding: '8px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
            background: formato === f ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${formato === f ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.08)'}`,
            color: formato === f ? '#60a5fa' : 'rgba(255,255,255,.4)'
          }}>{label}</button>
        ))}
      </div>

      <button onClick={formato === 'pdf' ? gerarPDF : gerarCSV} disabled={gerando || !campos.length || !total} style={{
        width: '100%', padding: 13, borderRadius: 10,
        background: gerando || !campos.length ? 'rgba(255,255,255,.04)'
          : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
        border: 'none', color: gerando ? 'rgba(255,255,255,.3)' : '#fff',
        fontSize: 13, fontWeight: 600, cursor: gerando ? 'not-allowed' : 'pointer'
      }}>
        {gerando ? 'Gerando...' : `📋 Gerar relatório (${total} estações)`}
      </button>
    </>
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
      where('cidade', '==', cidade),
      where('pais', '==', pais)
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
        const d = res.data as { ok: boolean; processados: number; erros: number; restantes: number };
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
            <input ref={fileRef} type="file" accept=".csv,.json" style={{display:'none'}}
              onChange={e=>{setImportFile(e.target.files?.[0]||null);}} />
            <button onClick={()=>fileRef.current?.click()} style={{
              width:'100%', padding:'9px', borderRadius:8, cursor:'pointer',
              background:'rgba(255,255,255,.04)', border:'1px dashed rgba(255,255,255,.15)',
              color:'rgba(255,255,255,.5)', fontSize:11, marginBottom:6,
            }}>{importFile?`📁 ${importFile.name}`:'⬆ Importar CSV / JSON'}</button>
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
          Para criar zonas: ative ⬡ Zonas no mapa e clique em <b style={{color:'#c084fc'}}>✏</b> no stack de FABs à direita.
        </div>
        <div style={{ display:'flex', gap:5, marginBottom:8 }}>
          <button onClick={()=>exportZonas('geojson')} style={btn('rgba(99,102,241,.8)')}>⬇ GeoJSON</button>
          <button onClick={()=>exportZonas('wkt')}     style={btn('rgba(48,127,226,.8)')}>⬇ WKT</button>
          <button onClick={()=>exportZonas('csv')}     style={btn('rgba(16,185,129,.8)')}>⬇ CSV</button>
        </div>
        <ZonasInline cidade={cidade} pais={pais} />
      </div>
    </div>
  );
}


export default function DashboardManager({ cidades, pais, onFechar, roleAtual }: Props) {
  const cidade = cidades[0] || '';
  const cidadesExp = useCidadesExpansao();
  const [aba,          setAba]          = useState<'dashboard'|'exportar'|'importar'|'relatorio'|'croquis'|'fotos'>('dashboard');
  const [estacoes,     setEstacoes]     = useState<Estacao[]>([]);
  const [carregando,   setCarregando]   = useState(true);
  const [svStats,      setSvStats]      = useState<any>(null);
  const [svCarregando, setSvCarregando] = useState(false);
  const [importFile,   setImportFile]   = useState<File | null>(null);
  const [importando,   setImportando]   = useState(false);
  const [importLog,    setImportLog]    = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ResultadoImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin  = roleAtual === 'admin';
  const isGestor = ['admin','gestor'].includes(roleAtual);

  // Carrega estações da cidade
  useEffect(() => {
    setCarregando(true);
    const q = cidades.length === 1
      ? query(collection(db, 'estacoes'), where('pais','==',pais), where('cidade','==',cidades[0]))
      : cidades.length > 1
        ? query(collection(db, 'estacoes'), where('pais','==',pais), where('cidade','in',cidades.slice(0,10)))
        : query(collection(db, 'estacoes'), where('pais','==',pais));
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
      setSvStats((res.data as any));
    } catch { /* silencioso */ }
    setSvCarregando(false);
  };

  useEffect(() => {
  }, [aba]);

  const handleImportar = async () => {
    if (!importFile) return;
    setImportando(true);
    setImportLog([]);
    setImportResult(null);
    try {
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

  const inp: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 6
  };

  const ABAS = [
    { k: 'dashboard', label: '📊 Stats' },
    { k: 'exportar',  label: '↕ Dados' },
    { k: 'croquis',   label: '📐 Croquis' },
    { k: 'fotos',     label: '📸 Fotos' },
    { k: 'relatorio', label: '📋 Relatório' },
  ] as const;

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
                  getDocs(query(collection(db, 'estacoes'), where('pais','==',pais), ...(cidade ? [where('cidade','==',cidade)] : [])))
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

        {/* ── RELATÓRIO PREFEITURA ── */}
        {aba === 'relatorio' && cidade && (
          <RelatorioManager estacoes={estacoes} cidade={cidade} pais={pais} total={total} />
        )}
        {aba === 'relatorio' && !cidade && (
          <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
            Selecione uma cidade para gerar o relatório
          </div>
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
