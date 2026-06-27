// functions/src/mirror-tarefas.ts
// Dual-write server-side (strangler) das coleções de TAREFAS Firestore → Supabase:
//   • tarefas           (tarefas operacionais/monitor — schema 0036)
//   • tarefas_logistica  (tarefas GoJet/logística — schema 0001)
// Cobre todos os escritores (automacao.ts, automacao-tarefas.ts, automacao-gojet-scraper.ts,
// gps-alertas.ts, slots.ts) sem tocar nos call sites.
// onDocumentWritten: após-existe → upsert por firebase_id; deletado → delete por firebase_id.
// Segredos (functions/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE. No-op se ausentes.

import * as functions from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim()) ? v : null;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return (typeof n === 'number' && isFinite(n)) ? n : null;
};
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

// ── Cache uid Firebase -> uuid Supabase (usuarios.firebase_uid) ─────────────
const uidCache = new Map<string, string | null>();
async function resolverUuid(firebaseUid: string): Promise<string | null> {
  if (!firebaseUid) return null;
  if (uidCache.has(firebaseUid)) return uidCache.get(firebaseUid)!;
  try {
    const url = `${SUPABASE_URL}/rest/v1/usuarios?select=id&firebase_uid=eq.${encodeURIComponent(firebaseUid)}&limit=1`;
    const resp = await fetch(url, { headers: HDR() });
    if (!resp.ok) { uidCache.set(firebaseUid, null); return null; }
    const rows = (await resp.json()) as Array<{ id: string }>;
    const uuid = rows[0]?.id ?? null;
    uidCache.set(firebaseUid, uuid);
    return uuid;
  } catch (e) {
    functions.logger.warn('[mirror-tarefa] resolverUuid falhou:', e);
    return null;
  }
}

// ── Mirror TAREFAS (operacionais/monitor) ───────────────────────────────────
// Supabase schema (0036): id text PK, tipo, estacao_id, cidade, status, prioridade,
//   descricao, dados jsonb, criado_por, atribuido_a, criado_em, atualizado_em
// + firebase_id text UNIQUE (migration 0059)
export const espelharTarefaSupabase = onDocumentWritten(
  { document: 'tarefas/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('tarefas', id, 'mirror-tarefa'); return; }
    const d = after.data() as Record<string, unknown>;

    // Flatten estacao sub-object into dados jsonb and estacao_id
    const estacao = d.estacao as Record<string, unknown> | undefined;

    await sbUpsert('tarefas', {
      firebase_id:   id,
      tipo:          str(d.tipo),
      titulo:        str(d.titulo),
      estacao_id:    str(estacao?.id as unknown) ?? str(d.estacaoId) ?? str(d.estacao_id),
      cidade:        str(d.cidade),
      status:        str(d.status) ?? 'pendente',
      prioridade:    str(d.prioridade) ?? 'normal',
      descricao:     str(d.descricao),
      dados:         d.estacao ? JSON.stringify(d.estacao) : null,
      criado_por:    str(d.criadoPor) ?? str(d.criado_por),
      atribuido_a:   str(d.assigneeUid) ?? str(d.atribuido_a),
      cargo:         str(d.cargo),
      tipo_slot:     str(d.tipoSlot),
      slot_id:       str(d.slotId),
      assignee_uid:  str(d.assigneeUid),
      assignee_nome: str(d.assigneeNome),
      qtd_alvo:      num(d.qtdAlvo),
      qtd_concluida: num(d.qtdConcluida) ?? 0,
      rota_ordem:    num(d.rotaOrdem),
      estacao:       estacao ? JSON.stringify(estacao) : null,
      criado_em:     iso(d.criadoEm) ?? undefined,
      atualizado_em: iso(d.atualizadoEm) ?? undefined,
    }, 'mirror-tarefa');
  },
);

// ── Mirror TAREFAS_LOGISTICA ────────────────────────────────────────────────
// Supabase schema (0001): id uuid PK, kind tarefa_kind, titulo, descricao,
//   assignee_uid uuid FK→usuarios, criado_por uuid FK→usuarios,
//   status tarefa_status, geo geography, cidade, foto_conclusao_url,
//   criado_em, concluido_em, cancelado_em
// + firebase_id text UNIQUE (migration 0059)
export const espelharTarefaLogisticaSupabase = onDocumentWritten(
  { document: 'tarefas_logistica/{id}', region: 'southamerica-east1' },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const id = event.params.id;
    const after = event.data?.after;
    if (!after?.exists) { await sbDelete('tarefas_logistica', id, 'mirror-tarefa-log'); return; }
    const d = after.data() as Record<string, unknown>;

    // Resolve assignee Firebase UID → Supabase UUID
    const assigneeFirebaseUid = str(d.assigneeUid);
    const assignee_uid = assigneeFirebaseUid ? await resolverUuid(assigneeFirebaseUid) : null;

    // Resolve criador Firebase UID → Supabase UUID (pode ser 'system')
    const criadoPorStr = str(d.criadoPor) ?? str(d.criado_por);
    const criado_por = (criadoPorStr && criadoPorStr !== 'system') ? await resolverUuid(criadoPorStr) : null;

    // Geo: tarefas_logistica podem ter parkingLat/parkingLng
    const lat = num(d.parkingLat) ?? num(d.lat);
    const lng = num(d.parkingLng) ?? num(d.lng);

    await sbUpsert('tarefas_logistica', {
      firebase_id:       id,
      kind:              str(d.kind) ?? 'PONTO',
      titulo:            str(d.titulo),
      descricao:         str(d.descricao),
      assignee_uid,
      criado_por,
      status:            str(d.status) ?? 'pendente',
      geo:               (lat !== null && lng !== null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
      cidade:            str(d.cidade),
      pais:              str(d.pais) ?? 'BR',
      foto_conclusao_url: str(d.fotoConclusaoUrl) ?? str(d.foto_conclusao_url),
      parking_id:        str(d.parkingId),
      parking_nome:      str(d.parkingNome),
      parking_lat:       num(d.parkingLat),
      parking_lng:       num(d.parkingLng),
      target_count:      num(d.targetCount),
      delivered_count:   num(d.deliveredCount) ?? 0,
      assignee_nome:     str(d.assigneeNome),
      prioridade:        num(d.prioridade),
      gerado_por_gojet:  d.geradoPorGoJet === true,
      slot_id:           str(d.slotId),
      check_in_gps:      d.checkInGPS === true,
      atualizado_em:     iso(d.atualizadoEm) ?? undefined,
      criado_em:         iso(d.criadoEm) ?? undefined,
      concluido_em:      iso(d.concluidoEm),
      cancelado_em:      iso(d.canceladoEm),
    }, 'mirror-tarefa-log');
  },
);
