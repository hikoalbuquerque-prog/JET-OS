// functions/src/mirror-onda-b-menores.ts
// Dual-write server-side (strangler) das coleções menores da Onda B Firestore → Supabase:
//   • solicitacoes_prestadores  (lido no UsuariosManager)
//   • turnos_logistica          (lido no GestorLogisticaPanel / aba Presença)
// Cobre todos os escritores sem tocar nos call sites, sem sessão Supabase no cliente e
// sem rotacionar o token do GPS. Mapeamento idêntico ao backfill-wave-b.mjs.
// onDocumentWritten: após-existe → upsert por firebase_id; deletado → delete por firebase_id.
// Segredos (functions/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE. No-op se ausentes.

import * as functions from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim()) ? v : null;
const pais = (p: unknown): string => (typeof p === 'string' && /^[A-Z]{2}$/.test(p)) ? p : 'BR';
// Firestore Timestamp | Date | string → ISO (ou null)
const iso = (v: any): string | null => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const HDR = () => ({ apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` });
async function sbUpsert(tbl: string, row: Record<string, unknown>, tag: string) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?on_conflict=firebase_id`, {
      method: 'POST',
      headers: { ...HDR(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    if (!resp.ok) functions.logger.error(`[${tag}] upsert ${resp.status}:`, await resp.text().catch(() => ''));
  } catch (e) { functions.logger.error(`[${tag}] upsert net:`, e); }
}
async function sbDelete(tbl: string, fid: string, tag: string) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?firebase_id=eq.${encodeURIComponent(fid)}`, { method: 'DELETE', headers: HDR() }); }
  catch (e) { functions.logger.error(`[${tag}] delete:`, e); }
}

// ── Mirror SOLICITAÇÕES DE PRESTADORES ───────────────────────────────────────
export const espelharSolicitacaoPrestadorSupabase = onDocumentWritten(
  { document: 'solicitacoes_prestadores/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('solicitacoes_prestadores', id, 'mirror-solic'); return; }
    const d = after.data() as Record<string, unknown>;
    await sbUpsert('solicitacoes_prestadores', {
      firebase_id: id,
      uid: str(d.uid),
      nome: str(d.nome), email: str(d.email),
      cpf: str(d.cpf_cnpj) ?? str(d.cpf),
      cargo: str(d.cargo), cidade: str(d.cidade),
      status: str(d.status) ?? 'pendente',
      pix_chave: str(d.pix_chave), pix_tipo: str(d.pix_tipo),
      telegram: str(d.telegram), motivo_cadastro: str(d.motivo_cadastro),
      tipo_contrato: str(d.tipo_contrato), pais: pais(d.pais),
      respondido_por: str(d.respondido_por),
      data_resposta: iso(d.data_resposta),
      criado_em: iso(d.data_criacao) ?? undefined,
    }, 'mirror-solic');
  },
);

// ── Mirror TURNOS LOGÍSTICA (foto de início/fim de turno) ────────────────────
export const espelharTurnoLogisticaSupabase = onDocumentWritten(
  { document: 'turnos_logistica/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('turnos_logistica', id, 'mirror-turnolog'); return; }
    const d = after.data() as Record<string, unknown>;
    await sbUpsert('turnos_logistica', {
      firebase_id: id,
      firebase_uid: str(d.uid),
      nome: str(d.nome),
      foto_url: str(d.fotoUrl) ?? str(d.foto_url),
      acao: str(d.acao),
      cidade: str(d.cidade),
      criado_em: iso(d.criadoEm) ?? undefined,
    }, 'mirror-turnolog');
  },
);
