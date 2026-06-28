// frontend/src/lib/onda-b-supabase.ts
// Leitura e escrita de solicitacoes_prestadores e turnos_logistica no Supabase.
// Requer sessão JS autenticada (RLS) — ver supabase.ts / supabase-auth.ts.

import { supabase } from './supabase';

export const logisticaProviderSupabase = (): boolean => true;

// ── Solicitações de prestadores (UsuariosManager) ────────────────────────────
// Mapeia snake_case Supabase → shape do app (SolicitacaoPrestador: cpf_cnpj, data_criacao).
function mapSolic(r: any): any {
  return {
    id: r.firebase_id ?? r.id,
    uid: r.uid,
    email: r.email,
    nome: r.nome,
    cargo: r.cargo,
    cpf_cnpj: r.cpf,
    pix_chave: r.pix_chave,
    pix_tipo: r.pix_tipo,
    cidade: r.cidade,
    tipo_contrato: r.tipo_contrato,
    telegram: r.telegram,
    motivo_cadastro: r.motivo_cadastro,
    status: r.status,
    pais: r.pais,
    respondido_por: r.respondido_por,
    data_resposta: r.data_resposta,
    data_criacao: r.criado_em,
  };
}

export async function carregarSolicitacoesPendentesSupabase(): Promise<any[]> {
  const { data, error } = await supabase
    .from('solicitacoes_prestadores')
    .select('*')
    .eq('status', 'pendente');
  if (error) throw error;
  return (data || []).map(mapSolic);
}

// ── Turnos logística (GestorLogisticaPanel / aba Presença) ───────────────────
// Mapeia snake_case → shape do app (TurnoLog: uid, fotoUrl, criadoEm).
function mapTurno(r: any): any {
  return {
    id: r.firebase_id ?? r.id,
    uid: r.firebase_uid,
    nome: r.nome,
    fotoUrl: r.foto_url,
    acao: r.acao,
    cidade: r.cidade,
    criadoEm: r.criado_em,
  };
}

// Turnos de hoje (>= início do dia local passado como ISO).
export async function carregarTurnosLogisticaSupabase(desdeISO: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('turnos_logistica')
    .select('*')
    .gte('criado_em', desdeISO)
    .order('criado_em', { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data || []).map(mapTurno);
}

export const logisticaWriteSupabase = (): boolean => true;

const sW = (...vals: any[]): string | null => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return null;
};

// Solicitação de prestador — CREATE (upsert por firebase_id). Mesmo mapa do mirror.
export async function criarSolicitacaoSupabase(firebaseId: string, d: any): Promise<void> {
  const row: Record<string, unknown> = {
    firebase_id: firebaseId,
    uid: sW(d.uid), nome: sW(d.nome), email: sW(d.email),
    cpf: sW(d.cpf_cnpj, d.cpf), cargo: sW(d.cargo), cidade: sW(d.cidade),
    status: sW(d.status) ?? 'pendente',
    pix_chave: sW(d.pix_chave), pix_tipo: sW(d.pix_tipo),
    telegram: sW(d.telegram), motivo_cadastro: sW(d.motivo_cadastro),
    tipo_contrato: sW(d.tipo_contrato),
    pais: (typeof d.pais === 'string' && /^[A-Z]{2}$/.test(d.pais)) ? d.pais : 'BR',
  };
  const { error } = await supabase.from('solicitacoes_prestadores').upsert(row, { onConflict: 'firebase_id' });
  if (error) throw error;
}

// Solicitação — UPDATE (aprovar/rejeitar) por firebase_id.
export async function atualizarSolicitacaoSupabase(firebaseId: string, patch: any): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.status != null)           row.status = String(patch.status);
  if (patch.respondido_por != null)   row.respondido_por = String(patch.respondido_por);
  if (patch.data_resposta != null)    row.data_resposta = patch.data_resposta;
  if (patch.roleAtribuido != null)    row.role_atribuido = String(patch.roleAtribuido);
  if (patch.motivo_rejeicao != null)  row.motivo_rejeicao = String(patch.motivo_rejeicao);
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from('solicitacoes_prestadores').update(row).eq('firebase_id', firebaseId);
  if (error) throw error;
}

// Turno logística — CREATE (upsert por firebase_id). Mesmo mapa do mirror.
export async function criarTurnoLogisticaSupabase(firebaseId: string, d: any): Promise<void> {
  const row: Record<string, unknown> = {
    firebase_id: firebaseId,
    firebase_uid: sW(d.uid, d.firebase_uid),
    nome: sW(d.nome),
    foto_url: sW(d.fotoUrl, d.foto_url),
    acao: sW(d.acao),
    cidade: sW(d.cidade),
  };
  const { error } = await supabase.from('turnos_logistica').upsert(row, { onConflict: 'firebase_id' });
  if (error) throw error;
}
