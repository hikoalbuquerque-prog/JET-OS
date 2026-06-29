// Edge Function: push-pre-turno
// Runs via cron 30min before each shift start
// Sends push notification to scouts assigned to that city with task summary

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // Find shifts starting in the next 30-35 minutes
    const { data: turnos } = await supabase
      .from('v_proximo_turno')
      .select('cidade, turno, inicio')
      .lt('tempo_ate_inicio', '00:35:00')
      .gt('tempo_ate_inicio', '00:25:00');

    if (!turnos?.length) {
      return json({ ok: true, message: 'No shifts starting soon', sent: 0 });
    }

    let totalSent = 0;

    for (const turno of turnos) {
      const cidade = turno.cidade === '_default' ? null : turno.cidade;

      // Count pending tasks for this city
      let q = supabase.from('tarefas_logistica')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente');
      if (cidade) q = q.eq('cidade', cidade);
      const { count: pendingCount } = await q;

      // Get scouts for this city
      let sq = supabase.from('usuarios')
        .select('id, nome, fcm_token')
        .in('role', ['campo', 'prestador'])
        .not('fcm_token', 'is', null);
      if (cidade) sq = sq.eq('cidade', cidade);
      const { data: scouts } = await sq;

      if (!scouts?.length) continue;

      // Send push via send-push Edge Function
      for (const scout of scouts) {
        if (!scout.fcm_token) continue;
        try {
          await supabase.functions.invoke('send-push', {
            body: {
              token: scout.fcm_token,
              title: `🕐 Turno ${turno.turno} em 30min`,
              body: `${pendingCount ?? 0} tarefas na fila${cidade ? ` · ${cidade}` : ''}`,
              data: { type: 'pre_turno', turno: turno.turno, cidade: cidade || '' },
            },
          });
          totalSent++;
        } catch (e) {
          console.error(`Push failed for ${scout.nome}:`, e);
        }
      }
    }

    return json({ ok: true, sent: totalSent, turnos: turnos.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
