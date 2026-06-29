// O1: Handoff entre turnos
// Called by scout 15min before shift end, or by cron at shift boundaries
// POST: { tarefa_id, decisao: 'finalizar' | 'passar' }

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
    const { tarefa_id, decisao, scout_uid } = await req.json();
    if (!tarefa_id || !decisao) return json({ error: 'tarefa_id and decisao required' }, 400);

    const { data: tarefa, error: tErr } = await supabase
      .from('tarefas_logistica')
      .select('*')
      .eq('id', tarefa_id)
      .single();

    if (tErr || !tarefa) return json({ error: 'Tarefa not found' }, 404);
    if (tarefa.status !== 'em_execucao') return json({ error: 'Tarefa not em_execucao' }, 400);

    if (decisao === 'finalizar') {
      // Overtime: scout continues, extend SLA +30min
      const newDue = tarefa.due_at
        ? new Date(new Date(tarefa.due_at).getTime() + 30 * 60000).toISOString()
        : null;

      await supabase.from('tarefas_logistica').update({
        overtime: true,
        due_at: newDue,
      }).eq('id', tarefa_id);

      await supabase.from('audit_log').insert({
        entidade: 'tarefa',
        entidade_id: tarefa_id,
        acao: 'turno_handoff',
        dados: {
          decisao: 'finalizar',
          scout_uid: scout_uid || tarefa.assignee_uid,
          overtime: true,
          due_at_extendido: newDue,
        },
      });

      return json({ ok: true, decisao: 'finalizar', overtime: true });

    } else if (decisao === 'passar') {
      // Re-assign to nearest scout in next shift
      const { data: scouts } = await supabase.rpc('nearest_available_scout', {
        p_cidade: tarefa.cidade,
        p_lat: tarefa.destino_lat || tarefa.parking_lat,
        p_lng: tarefa.destino_lng || tarefa.parking_lng,
        p_max_distance_m: 15000,
      });

      if (!scouts?.length) {
        return json({ error: 'Nenhum scout do próximo turno disponível', ok: false }, 404);
      }

      const newScout = scouts.find((s: any) => s.uid !== tarefa.assignee_uid) ?? scouts[0];

      await supabase.from('tarefas_logistica').update({
        assignee_uid: newScout.uid,
        handoff_count: (tarefa.handoff_count ?? 0) + 1,
      }).eq('id', tarefa_id);

      await supabase.from('audit_log').insert({
        entidade: 'tarefa',
        entidade_id: tarefa_id,
        acao: 'turno_handoff',
        dados: {
          decisao: 'passar',
          scout_anterior: scout_uid || tarefa.assignee_uid,
          scout_novo: newScout.uid,
          handoff_count: (tarefa.handoff_count ?? 0) + 1,
        },
      });

      // Push notification to new scout
      const { data: newUser } = await supabase
        .from('usuarios')
        .select('fcm_token, nome')
        .eq('id', newScout.uid)
        .single();

      if (newUser?.fcm_token) {
        await supabase.functions.invoke('send-push', {
          body: {
            token: newUser.fcm_token,
            title: '🔄 Tarefa recebida (handoff)',
            body: `${tarefa.titulo || 'Tarefa'} passada do turno anterior`,
            data: { type: 'handoff', tarefa_id },
          },
        }).catch(() => {});
      }

      return json({ ok: true, decisao: 'passar', novo_scout: newScout.uid });
    }

    return json({ error: 'decisao must be finalizar or passar' }, 400);
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
