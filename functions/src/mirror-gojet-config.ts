// functions/src/mirror-gojet-config.ts
// Dual-write server-side (strangler) da coleção "gojet_config" Firestore → Supabase.
// Tabela: public.gojet_config (cidade PK, city_id, ativo).
// Doc ID no Firestore = nome da cidade = chave primária no Supabase.
// onDocumentWritten: após-existe → upsert por cidade; deletado → delete por cidade.
// Segredos (functions/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE. No-op se ausentes.

import * as functions from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const SUPABASE_URL          = process.env.SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';

const HDR = () => ({ apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` });

export const espelharGojetConfigSupabase = onDocumentWritten(
  { document: 'gojet_config/{cidade}', region: 'southamerica-east1', maxInstances: 10 },
  async (event) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return;
    const cidade = event.params.cidade;
    const after = event.data?.after;

    // Deletado no Firestore → remove do Supabase
    if (!after?.exists) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/gojet_config?cidade=eq.${encodeURIComponent(cidade)}`,
          { method: 'DELETE', headers: HDR() });
      } catch (e) { functions.logger.error('[mirror-gojet-config] delete:', e); }
      return;
    }

    const d = after.data() as Record<string, unknown>;
    const cityId = typeof d.cityId === 'string' ? d.cityId.trim() : '';
    if (!cityId) { functions.logger.warn(`[mirror-gojet-config] ${cidade} sem cityId — pulado`); return; }

    const row = {
      cidade,
      city_id: cityId,
      ativo:   d.ativo !== false,
    };

    try {
      // Upsert by cidade (PK) — PostgREST on_conflict on PK
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/gojet_config?on_conflict=cidade`, {
        method: 'POST',
        headers: { ...HDR(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      if (!resp.ok) functions.logger.error(`[mirror-gojet-config] upsert ${resp.status}:`, await resp.text().catch(() => ''));
    } catch (e) { functions.logger.error('[mirror-gojet-config] upsert net:', e); }
  },
);
