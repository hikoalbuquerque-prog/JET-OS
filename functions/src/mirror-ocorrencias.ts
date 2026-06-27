// functions/src/mirror-ocorrencias.ts
//
// Espelha (strangler dual-write) cada ocorrência do Firestore para o Supabase em
// create/update/delete (onDocumentWritten) — updates de status/BO também sincronizam,
// para que o analytics migrado (RPC analytics_ocorrencias / PainelRoubos / heatmap) NÃO
// fique stale enquanto o ESCRITOR do Guard ainda grava no Firebase. Ver DEBRIEF Seção 16.
//
// Por que um trigger Firestore (server-to-server) e não dual-write no cliente:
//   - Cobre TODOS os escritores de ocorrência de uma vez (TelaGuard, SlotsModule,
//     slots-schema) sem tocar em cada call site.
//   - Funciona com o app fechado e não depende da sessão Supabase do navegador.
//   - Não renova/rota o refresh token do Supabase no JS (isso quebraria o GPS nativo,
//     que é o ÚNICO autorizado a renovar — ver DEBRIEF Seção 14.5.1).
//
// Auth: usa a service_role (ignora RLS) — server-side only, NUNCA exposta ao cliente.
// Segredos (Secret Manager / env): SUPABASE_URL, SUPABASE_SERVICE_ROLE.
// Se não configurados, a função é no-op (não quebra o deploy enquanto a migração não corta).

import * as functions from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

// Cache uid Firebase -> uuid Supabase (usuarios.firebase_uid). A função pode rodar quente
// por várias invocações; o mapa é pequeno e mudaria raramente.
const uidCache = new Map<string, string | null>();

async function resolverUuidSupabase(firebaseUid: string): Promise<string | null> {
  if (!firebaseUid) return null;
  if (uidCache.has(firebaseUid)) return uidCache.get(firebaseUid)!;
  try {
    const url = `${SUPABASE_URL}/rest/v1/usuarios?select=id&firebase_uid=eq.${encodeURIComponent(firebaseUid)}&limit=1`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    });
    if (!resp.ok) { uidCache.set(firebaseUid, null); return null; }
    const rows = (await resp.json()) as Array<{ id: string }>;
    const uuid = rows[0]?.id ?? null;
    uidCache.set(firebaseUid, uuid);
    return uuid;
  } catch (e) {
    functions.logger.warn('[mirror-ocor] resolverUuid falhou:', e);
    return null;
  }
}

// Aceita os dois esquemas de campo que aparecem nos escritores (TelaGuard usa *_inicial,
// SlotsModule/slots-schema podem usar lat/lng) e normaliza.
function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    if (typeof n === 'number' && isFinite(n)) return n;
  }
  return null;
}

function str(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

export const espelharOcorrenciaSupabase = onDocumentWritten(
  { document: 'ocorrencias/{id}', region: 'southamerica-east1', maxInstances: 10 },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return; // migração não cortada ainda
    const firebaseDocId = event.params.id;
    const hdr = { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` };

    // Deletado no Firestore → remove do Supabase (mantém paridade nas leituras Onda B).
    if (!event.data?.after?.exists) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/ocorrencias?firebase_doc_id=eq.${encodeURIComponent(firebaseDocId)}`,
          { method: 'DELETE', headers: hdr });
      } catch (e) { functions.logger.error('[mirror-ocor] delete:', e); }
      return;
    }

    const d = event.data.after.data();
    if (!d) return;
    const lat = num(d.lat_inicial, d.lat, d.latInicial);
    const lng = num(d.lng_inicial, d.lng, d.lngInicial);

    const registradoPorUid = str(d.registradoPor, d.registrado_por) ?? '';
    const registrado_por   = await resolverUuidSupabase(registradoPorUid);

    const row: Record<string, unknown> = {
      firebase_doc_id: firebaseDocId,
      codigo:          str(d.id, d.codigo),
      tipo:            str(d.tipo),
      prioridade:      str(d.prioridade),
      // status do Firestore vem capitalizado ("Aberto"); o analytics normaliza, mas
      // guardamos lowercase para casar com o default 'aberto' do schema.
      status:          (str(d.status) ?? 'aberto').toLowerCase(),
      ativo_tipo:      str(d.ativo_tipo, d.ativoTipo),
      asset_id:        str(d.asset_id, d.assetId),
      descricao:       str(d.descricao),
      observacao_fechamento: str(d.observacao_fechamento, d.observacaoFechamento),
      // geography(Point,4326) aceita EWKT na inserção via PostgREST.
      geo:             (lat !== null && lng !== null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
      cidade:          str(d.cidade_inicial, d.cidade),
      bairro:          str(d.bairro_inicial, d.bairro),
      endereco:        str(d.endereco_inicial, d.endereco),
      estacao_id:      str(d.estacaoId, d.estacao_id),
      bo_numero:       str(d.bo_numero, d.boNumero),
      bo_url:          str(d.bo_url, d.boUrl),
      foto1_url:       str(d.foto1_url, d.foto1Url),
      foto2_url:       str(d.foto2_url, d.foto2Url),
      cargo:           str(d.cargo),
      origem_registro: str(d.origem_registro, d.origemRegistro),
      turno:           str(d.turno),
      procurando:      d.procurando === true,
      registrado_por,
      registrado_por_nome: str(d.registradoPorNome, d.registrado_por_nome),
      telegram_enviado: d.telegramEnviado === true || d.telegram_enviado === true,
      data_manual:     str(d.dataManual, d.data_manual),
    };

    try {
      // Upsert por firebase_doc_id (único) — idempotente em retries do trigger.
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/ocorrencias?on_conflict=firebase_doc_id`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(row),
        },
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        functions.logger.error(`[mirror-ocor] upsert falhou (${resp.status}):`, body);
        return;
      }
      functions.logger.info(`[mirror-ocor] espelhada ${firebaseDocId} -> Supabase`);
    } catch (e) {
      // Não-fatal: o registro no Firebase já foi feito; o espelho é best-effort.
      functions.logger.error('[mirror-ocor] erro de rede no upsert:', e);
    }
    // NÃO escrever de volta no Firestore: onDocumentWritten re-dispararia (loop).
  },
);
