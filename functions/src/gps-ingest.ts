// functions/src/gps-ingest.ts
// Endpoint de ingestão de GPS para o rastreamento NATIVO em segundo plano (Android).
//
// O serviço nativo do APK coleta o GPS e faz POST direto deste endpoint — sem depender
// do JavaScript do WebView, que o Android congela quando o app é minimizado/fechado.
// Assim o rastreamento continua ao vivo mesmo com o app fechado.
//
// Autenticação: Authorization: Bearer <Firebase ID token>. O uid usado nas gravações
// vem SEMPRE do token verificado (nunca do corpo) — impede falsificação de identidade.
//
// Gravar em gps_logistica dispara o trigger verificarChegadaPonto (gps-alertas.ts),
// então toda a lógica de chegada/atraso/mapa ao vivo continua funcionando igual.
//
// Deploy: export * from './gps-ingest' no index.ts.

import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { supabaseInsert, supabaseUpdate, verifySupabaseToken } from './lib/supabase-rest';
import { verificarChegadaPontoFn } from './gps-alertas';

const MAX_PONTOS = 200;

interface PontoIn {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  bateria?: number | null;
  capturedAt?: string;
  slotId?: string | null;
  isMock?: boolean;
  estrategia?: string;
}

export const ingestGps = onRequest(
  { region: 'southamerica-east1', cors: true, memory: '256MiB', maxInstances: 10 },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

    // 1. Autenticação por Firebase ID token
    const authz = String(req.headers.authorization || '');
    const m = authz.match(/^Bearer (.+)$/);
    if (!m) { res.status(401).json({ error: 'missing_token' }); return; }

    let uid: string;
    try {
      const { uid: u } = await verifySupabaseToken(m[1]);
      uid = u;
    } catch {
      res.status(401).json({ error: 'invalid_token' }); return;
    }

    // 2. Validação do corpo
    const points: PontoIn[] = Array.isArray(req.body?.points) ? req.body.points : [];
    if (!points.length) { res.status(400).json({ error: 'no_points' }); return; }
    if (points.length > MAX_PONTOS) { res.status(413).json({ error: 'too_many_points', max: MAX_PONTOS }); return; }

    // 3. Collect points for Supabase bulk insert
    const gpsPoints: any[] = [];
    const histPoints: any[] = [];
    let written = 0;
    let ultima: PontoIn | null = null;

    for (const p of points) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;

      const capturedAt = typeof p.capturedAt === 'string' ? p.capturedAt : new Date().toISOString();
      const isMock = p.isMock === true;

      gpsPoints.push({
        uid,
        slot_id:     p.slotId ?? null,
        lat:        p.lat,
        lng:        p.lng,
        accuracy:   p.accuracy ?? null,
        speed:      p.speed ?? null,
        heading:    p.heading ?? null,
        altitude:   p.altitude ?? null,
        bateria:    p.bateria ?? null,
        captured_at: capturedAt,
        estrategia: p.estrategia ?? 'background_android_native',
        is_mock:    isMock,
        criado_em:  new Date().toISOString(),
      });

      histPoints.push({
        uid,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy ?? null,
        captured_at: capturedAt,
        criado_em: new Date().toISOString(),
      });

      written++;
      ultima = p;
    }

    if (!written) { res.status(400).json({ error: 'no_valid_points' }); return; }

    try {
      // Insert GPS points
      const okGps = await supabaseInsert('gps_logistica', gpsPoints);
      if (!okGps) {
        functions.logger.error('[ingestGps] falha ao gravar gps_logistica', { uid });
        res.status(500).json({ error: 'write_failed' }); return;
      }

      // Insert history points
      await supabaseInsert('gps_logistica_hist', histPoints);

      // Update user's last position
      if (ultima) {
        await supabaseUpdate('usuarios', {
          ultima_lat:         ultima.lat,
          ultima_lng:         ultima.lng,
          ultima_accuracy:    ultima.accuracy ?? null,
          ultima_velocidade:  ultima.speed ?? null,
          ultima_posicao_em:  new Date().toISOString(),
          slot_atual_id:      ultima.slotId ?? null,
          ultimo_is_mock:     ultima.isMock === true,
        }, `id=eq.${encodeURIComponent(uid)}`);
      }
    } catch (e: any) {
      functions.logger.error('[ingestGps] falha ao gravar:', e?.message, { uid });
      res.status(500).json({ error: 'write_failed' }); return;
    }

    // Trigger verificação de chegada + teleporte + geofencing (antes era trigger Firestore)
    if (ultima) {
      verificarChegadaPontoFn(uid, ultima.lat, ultima.lng).catch(e =>
        functions.logger.warn('[ingestGps] verificarChegadaPonto erro:', e)
      );
    }

    res.status(200).json({ ok: true, written });
  }
);
