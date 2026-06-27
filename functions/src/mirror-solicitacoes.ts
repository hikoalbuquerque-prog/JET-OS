// functions/src/mirror-solicitacoes.ts
// Dual-write server-side (strangler) da coleção "solicitacoes" Firestore → Supabase.
// Esta é a coleção de SOLICITAÇÕES DE ACESSO (auth/index.ts), NÃO a de prestadores
// (solicitacoes_prestadores, já espelhada em mirror-onda-b-menores.ts).
// Campos: email, nome, paises, motivo, roleDesejado, status, resolvidoEm/Por, roleAtribuido.
// onDocumentWritten: após-existe → upsert por firebase_id; deletado → delete por firebase_id.
// Segredos (functions/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE. No-op se ausentes.

import * as functions from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim()) ? v : null;
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

// ── Mirror SOLICITAÇÕES DE ACESSO ───────────────────────────────────────────
export const espelharSolicitacaoSupabase = onDocumentWritten(
  { document: 'solicitacoes/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('solicitacoes', id, 'mirror-solic-acesso'); return; }
    const d = after.data() as Record<string, unknown>;

    // paises: string[] no Firestore → postgres text[]
    const paises = Array.isArray(d.paises)
      ? (d.paises as string[]).filter(p => typeof p === 'string')
      : ['BR'];

    await sbUpsert('solicitacoes', {
      firebase_id:    id,
      email:          str(d.email),
      nome:           str(d.nome),
      paises:         `{${paises.join(',')}}`,   // PostgREST text[] literal
      motivo:         str(d.motivo),
      role_desejado:  str(d.roleDesejado) ?? 'campo',
      status:         str(d.status) ?? 'PENDENTE',
      resolvido_em:   iso(d.resolvidoEm),
      resolvido_por:  str(d.resolvidoPor),
      role_atribuido: str(d.roleAtribuido),
      criado_em:      iso(d.criadoEm) ?? undefined,
    }, 'mirror-solic-acesso');
  },
);
