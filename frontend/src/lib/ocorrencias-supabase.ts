// frontend/src/lib/ocorrencias-supabase.ts
// Fase 2 / Onda B — leitura de ocorrências (Guard) do Supabase (dual-run, atrás de flag).
// Lê a view ocorrencias_geo (lat/lng numéricos da coluna geography + firebase_uid
// do registrador, ver migration 0030). A ESCRITA continua no Firestore; o mirror
// (espelharOcorrenciaSupabase) popula a tabela. Read-only enquanto a flag estiver ligada.
// Requer sessão JS autenticada (RLS) — ver supabase.ts / supabase-auth.ts (sessão A).

import { supabase } from './supabase';

// Flag por browser SEM rebuild: `localStorage.setItem('jet_guard_provider','supabase')`
// liga só pra você; `'firebase'` (ou remover) volta ao Firestore.
// (Ou build com VITE_GUARD_PROVIDER=supabase.) Toggle SEPARADO do mapa — módulo de segurança.
export const guardProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_guard_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_GUARD_PROVIDER as string) === 'supabase';
};

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
