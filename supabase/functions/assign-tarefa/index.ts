// Edge Function: assign-tarefa
// Atribui tarefa ao scout mais próximo + calcula rota OSRM
// POST: { tarefa_id } — auto-assign
// POST: { tarefa_id, scout_uid } — manual assign

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OSRM_BASE     = 'https://router.project-osrm.org';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface Coord { lat: number; lng: number }

async function osrmRoute(from: Coord, to: Coord): Promise<{ distance_m: number; duration_s: number; geometry: string } | null> {
  try {
    const url = `${OSRM_BASE}/route/v1/bike/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    const r = data.routes[0];
    return { distance_m: r.distance, duration_s: r.duration, geometry: r.geometry };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  try {
    const { tarefa_id, scout_uid } = await req.json();
    if (!tarefa_id) return json({ error: 'tarefa_id required' }, 400);

    // Fetch tarefa
    const { data: tarefa, error: tErr } = await supabase
      .from('tarefas_logistica')
      .select('*')
      .eq('id', tarefa_id)
      .single();
    if (tErr || !tarefa) return json({ error: 'Tarefa not found' }, 404);
    if (tarefa.status !== 'pendente') return json({ error: 'Tarefa not pendente', status: tarefa.status }, 400);

    let assignee_uid = scout_uid;
    let scout_pos: Coord | null = null;

    if (!assignee_uid) {
      // Auto-assign: find nearest available scout
      if (!tarefa.destino_lat || !tarefa.destino_lng) {
        return json({ error: 'Tarefa sem destino_lat/lng para proximity search' }, 400);
      }

      const { data: scouts, error: sErr } = await supabase
        .rpc('nearest_available_scout', {
          p_cidade: tarefa.cidade,
          p_lat: tarefa.destino_lat,
          p_lng: tarefa.destino_lng,
          p_max_distance_m: 10000,
        });

      if (sErr || !scouts?.length) {
        return json({ error: 'Nenhum scout disponível', detail: sErr?.message }, 404);
      }

      assignee_uid = scouts[0].uid;

      // Get scout position for OSRM
      const { data: scoutUser } = await supabase
        .from('usuarios')
        .select('ultima_pos')
        .eq('id', assignee_uid)
        .single();
      if (scoutUser?.ultima_pos) {
        const coords = scoutUser.ultima_pos as any;
        if (coords?.coordinates) {
          scout_pos = { lng: coords.coordinates[0], lat: coords.coordinates[1] };
        }
      }
    } else {
      // Manual assign: get scout position
      const { data: scoutUser } = await supabase
        .from('usuarios')
        .select('ultima_pos')
        .eq('id', scout_uid)
        .single();
      if (scoutUser?.ultima_pos) {
        const coords = scoutUser.ultima_pos as any;
        if (coords?.coordinates) {
          scout_pos = { lng: coords.coordinates[0], lat: coords.coordinates[1] };
        }
      }
    }

    // Calculate OSRM route if we have both positions
    let rota_osrm: string | null = null;
    let eta_minutos: number | null = null;

    if (scout_pos && tarefa.destino_lat && tarefa.destino_lng) {
      const dest: Coord = { lat: tarefa.destino_lat, lng: tarefa.destino_lng };
      const route = await osrmRoute(scout_pos, dest);
      if (route) {
        rota_osrm = route.geometry;
        eta_minutos = Math.ceil(route.duration_s / 60);
      }
    }

    // F5: Estimate cost (ETA hours × hourly rate)
    let custo_estimado: number | null = null;
    if (eta_minutos) {
      const { data: cfg } = await supabase
        .from('pagamentos_config')
        .select('valor_por_tarefa')
        .eq('id', tarefa.cidade ?? 'default')
        .maybeSingle();
      custo_estimado = cfg?.valor_por_tarefa
        ? Number((cfg.valor_por_tarefa).toFixed(2))
        : null;
    }

    // Update tarefa
    const { error: uErr } = await supabase
      .from('tarefas_logistica')
      .update({
        assignee_uid,
        status: 'em_execucao',
        rota_osrm,
        eta_minutos,
        custo_estimado,
      })
      .eq('id', tarefa_id);

    if (uErr) return json({ error: 'Failed to update tarefa', detail: uErr.message }, 500);

    // Audit log
    await supabase.from('audit_log').insert({
      entidade: 'tarefa',
      entidade_id: tarefa_id,
      acao: 'assign',
      dados: { assignee_uid, auto: !scout_uid, eta_minutos, rota_osrm: !!rota_osrm },
      uid: assignee_uid,
    });

    return json({
      ok: true,
      assignee_uid,
      auto: !scout_uid,
      eta_minutos,
      has_route: !!rota_osrm,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
