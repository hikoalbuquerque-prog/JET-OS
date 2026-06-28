// frontend/src/lib/ocorrencias-supabase.ts
// Leitura e escrita de ocorrências (Guard) no Supabase.
// Lê a view ocorrencias_geo (lat/lng numéricos da coluna geography).
// Requer sessão JS autenticada (RLS) — ver supabase.ts / supabase-auth.ts.

import { supabase } from './supabase';

export const guardProviderSupabase = (): boolean => true;

// O mirror grava status em lowercase; o app exibe valores capitalizados
// (STATUS_COR['Aberto'] etc). Restaura os valores canônicos conhecidos.
const STATUS_CANON: Record<string, string> = {
  'aberto': 'Aberto',
  'em apuração': 'Em apuração',
  'em apuracao': 'Em apuração',
  'recuperado': 'Recuperado',
  'encerrado': 'Encerrado',
};
function canonStatus(s: any): any {
  if (typeof s !== 'string') return s;
  return STATUS_CANON[s.toLowerCase()] ?? s;
}

// Mapeia uma linha de ocorrencias_geo (snake_case Supabase) p/ o shape que o app usa
// (mistura camelCase/snake_case do Firestore — ver interface Ocorrencia em TelaGuard).
function mapRow(r: any): any {
  return {
    id: r.firebase_doc_id ?? r.id,
    codigo: r.codigo,
    tipo: r.tipo,
    prioridade: r.prioridade,
    status: canonStatus(r.status),
    ativo_tipo: r.ativo_tipo,
    asset_id: r.asset_id,
    descricao: r.descricao,
    observacao_fechamento: r.observacao_fechamento,
    lat_inicial: r.lat,
    lng_inicial: r.lng,
    lat: r.lat,
    lng: r.lng,
    cidade_inicial: r.cidade,
    cidade: r.cidade,
    bairro_inicial: r.bairro,
    bairro: r.bairro,
    endereco_inicial: r.endereco,
    endereco: r.endereco,
    estacaoId: r.estacao_id,
    bo_numero: r.bo_numero,
    bo_url: r.bo_url,
    foto1_url: r.foto1_url,
    foto2_url: r.foto2_url,
    cargo: r.cargo,
    origem_registro: r.origem_registro,
    turno: r.turno,
    procurando: r.procurando,
    registradoPor: r.registrado_por_uid ?? r.registrado_por,
    registradoPorNome: r.registrado_por_nome,
    telegramEnviado: r.telegram_enviado,
    dataManual: r.data_manual,
    // criadoEm: ISO string; o app aceita string em fmtData (new Date(...)).
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
}

// Carrega as ocorrências registradas por um usuário desde `desdeISO` (default: 24h).
// Usado pelo registrador no TelaGuard (substitui o onSnapshot por registradoPor+criadoEm).
// A RLS já restringe a "as minhas" p/ guard não-gestor; filtramos por uid p/ paridade exata.
export async function carregarMinhasOcorrenciasSupabase(
  firebaseUid: string,
  desdeISO?: string,
): Promise<any[]> {
  const desde = desdeISO ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('ocorrencias_geo')
    .select('*')
    .eq('registrado_por_uid', firebaseUid)
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

// Carrega ocorrências com filtros opcionais (gestor — PainelRoubos/GuardDashboard/etc).
export async function carregarOcorrenciasSupabase(opts?: {
  cidade?: string;
  cidades?: string[];
  status?: string;
  desdeISO?: string;
  limit?: number;
}): Promise<any[]> {
  let q = supabase.from('ocorrencias_geo').select('*');
  if (opts?.cidade) q = q.eq('cidade', opts.cidade);
  const cs = (opts?.cidades || []).map(c => c.trim()).filter(Boolean);
  if (cs.length) q = q.in('cidade', cs.slice(0, 30));
  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.desdeISO) q = q.gte('criado_em', opts.desdeISO);
  q = q.order('criado_em', { ascending: false });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapRow);
}

export const guardWriteSupabase = (): boolean => true;

const numW = (v: any): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return (typeof n === 'number' && isFinite(n)) ? n : null;
};
const strW = (...vals: any[]): string | null => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return null;
};

// Traduz um doc/patch camelCase (Firestore) → colunas snake_case da tabela ocorrencias.
// Mesmo mapeamento do mirror (functions/src/mirror-ocorrencias.ts) p/ não divergir.
function mapParaSupabase(d: any): Record<string, unknown> {
  const lat = numW(d.lat_inicial ?? d.lat ?? d.latInicial);
  const lng = numW(d.lng_inicial ?? d.lng ?? d.lngInicial);
  const row: Record<string, unknown> = {
    codigo:          strW(d.id, d.codigo),
    tipo:            strW(d.tipo),
    prioridade:      strW(d.prioridade),
    ativo_tipo:      strW(d.ativo_tipo, d.ativoTipo),
    asset_id:        strW(d.asset_id, d.assetId),
    descricao:       strW(d.descricao),
    observacao_fechamento: strW(d.observacao_fechamento, d.observacaoFechamento),
    cidade:          strW(d.cidade_inicial, d.cidade),
    bairro:          strW(d.bairro_inicial, d.bairro),
    endereco:        strW(d.endereco_inicial, d.endereco),
    estacao_id:      strW(d.estacaoId, d.estacao_id),
    bo_numero:       strW(d.bo_numero, d.boNumero),
    bo_url:          strW(d.bo_url, d.boUrl),
    foto1_url:       strW(d.foto1_url, d.foto1Url),
    foto2_url:       strW(d.foto2_url, d.foto2Url),
    cargo:           strW(d.cargo),
    origem_registro: strW(d.origem_registro, d.origemRegistro),
    turno:           strW(d.turno),
    registrado_por_nome: strW(d.registradoPorNome, d.registrado_por_nome),
    data_manual:     strW(d.dataManual, d.data_manual),
  };
  if (d.status != null) row.status = String(d.status).toLowerCase();
  if (d.procurando != null) row.procurando = d.procurando === true;
  if (lat !== null && lng !== null) row.geo = `SRID=4326;POINT(${lng} ${lat})`;
  // remove chaves nulas p/ não sobrescrever colunas existentes num update
  for (const k of Object.keys(row)) if (row[k] == null) delete row[k];
  return row;
}

async function meuUuidSupabase(): Promise<string | null> {
  try { const { data } = await supabase.auth.getUser(); return data.user?.id ?? null; }
  catch { return null; }
}

// CREATE — espelha a ocorrência recém-criada no Firestore (firebaseDocId) para o Supabase
// sob a sessão A. registrado_por = uuid do próprio (auth.uid()) p/ casar com a RLS.
export async function criarOcorrenciaSupabase(firebaseDocId: string, dados: any): Promise<void> {
  const row = mapParaSupabase(dados);
  row.firebase_doc_id = firebaseDocId;
  row.registrado_por = await meuUuidSupabase();
  if (!row.status) row.status = 'aberto';
  const { error } = await supabase.from('ocorrencias').upsert(row, { onConflict: 'firebase_doc_id' });
  if (error) throw error;
}

// UPDATE — atualiza por firebase_doc_id (status/BO/fotos/etc).
export async function atualizarOcorrenciaSupabase(firebaseDocId: string, patch: any): Promise<void> {
  const row = mapParaSupabase(patch);
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from('ocorrencias').update(row).eq('firebase_doc_id', firebaseDocId);
  if (error) throw error;
}

// DELETE — remove por firebase_doc_id.
export async function deletarOcorrenciaSupabase(firebaseDocId: string): Promise<void> {
  const { error } = await supabase.from('ocorrencias').delete().eq('firebase_doc_id', firebaseDocId);
  if (error) throw error;
}

// Busca pontual por código (id humano) e, se não achar, por asset_id.
// Usado no auditor do DashboardManager (substitui os getDocs por where('id'/'asset_id')).
export async function buscarOcorrenciaSupabase(termo: string): Promise<any | null> {
  const t = (termo || '').trim();
  if (!t) return null;
  const porCodigo = await supabase.from('ocorrencias_geo').select('*').eq('codigo', t).limit(1);
  if (porCodigo.error) throw porCodigo.error;
  if (porCodigo.data?.length) return mapRow(porCodigo.data[0]);
  const porAsset = await supabase.from('ocorrencias_geo').select('*').eq('asset_id', t).limit(1);
  if (porAsset.error) throw porAsset.error;
  if (porAsset.data?.length) return mapRow(porAsset.data[0]);
  return null;
}
