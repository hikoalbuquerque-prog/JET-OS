// frontend/src/lib/onda-b-supabase.ts
// Fase 2 / Onda B menores — leitura de solicitacoes_prestadores e turnos_logistica
// do Supabase (dual-run, atrás de flag). Escrita ainda Firestore; mirrors
// (espelharSolicitacaoPrestadorSupabase / espelharTurnoLogisticaSupabase) populam.
// Requer sessão JS autenticada (RLS) — ver supabase.ts / supabase-auth.ts (sessão A).

import { supabase } from './supabase';

// Flag por browser SEM rebuild: `localStorage.setItem('jet_logistica_provider','supabase')`
// liga só pra você; `'firebase'` (ou remover) volta ao Firestore.
// (Ou build com VITE_LOGISTICA_PROVIDER=supabase.)
export const logisticaProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_logistica_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_LOGISTICA_PROVIDER as string) === 'supabase';
};

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
