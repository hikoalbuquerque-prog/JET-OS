// O4: Intelligent redistribution — auto-generate rebalancing tasks
// Runs via cron every 30 minutes. Checks parking drain patterns and
// creates preventive rebalancing tasks before parkings hit zero.

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
    // Get active cities
    const { data: cidades } = await supabase
      .from('cidade_config')
      .select('nome')
      .eq('ativo', true);

    if (!cidades?.length) return json({ ok: true, message: 'No active cities', tasks: 0 });

    let totalCreated = 0;

    for (const c of cidades) {
      const cidade = c.nome;

      // O5: Check demand prediction — find parkings expected to empty this hour
      const now = new Date();
      const dow = now.getDay();
      const nextHour = (now.getHours() + 1) % 24;

      const { data: predictions } = await supabase
        .from('v_demanda_por_hora')
        .select('parking_id, avg_bikes, stddev_bikes, amostras')
        .eq('city_id', cidade)
        .eq('dia_semana', dow)
        .eq('hora_dia', nextHour)
        .lt('avg_bikes', 1.5) // historically low
        .gte('amostras', 4); // enough data

      // O4: Get current bike counts for these parkings
      if (!predictions?.length) continue;

      const parkingIds = predictions.map(p => p.parking_id);

      // Get current bikes per parking
      const { data: bikes } = await supabase
        .from('bikes')
        .select('dados')
        .limit(3000);

      const bikeCountPerParking: Record<string, number> = {};
      for (const b of (bikes ?? [])) {
        const d = b.dados;
        if (d?.parking_id) {
          bikeCountPerParking[d.parking_id] = (bikeCountPerParking[d.parking_id] ?? 0) + 1;
        }
      }

      // Get parkings with excess bikes (potential sources)
      const { data: parkingsData } = await supabase
        .from('parkings')
        .select('dados')
        .limit(500);

      const parkingTargets: Record<string, { target: number; lat: number; lng: number; name: string }> = {};
      for (const p of (parkingsData ?? [])) {
        const d = p.dados;
        if (d?.id) {
          parkingTargets[d.id] = {
            target: d.target_bikes_count ?? 3,
            lat: d.latitude,
            lng: d.longitude,
            name: d.name ?? d.id,
          };
        }
      }

      // Check if rebalancing task already exists (avoid duplicates)
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: existingTasks } = await supabase
        .from('tarefas_logistica')
        .select('titulo')
        .eq('cidade', cidade)
        .in('status', ['pendente', 'em_execucao'])
        .gte('criado_em', `${todayStr}T00:00:00`)
        .like('titulo', '%Rebalanceamento preventivo%');

      const existingTitles = new Set((existingTasks ?? []).map(t => t.titulo));

      for (const pred of predictions) {
        const currentCount = bikeCountPerParking[pred.parking_id] ?? 0;
        const target = parkingTargets[pred.parking_id];
        if (!target) continue;

        // Only create task if parking currently has bikes but is predicted to empty
        if (currentCount <= 1 || currentCount >= (target.target || 3)) continue;

        const titulo = `Rebalanceamento preventivo: ${target.name}`;
        if (existingTitles.has(titulo)) continue;

        // Find nearest parking with excess bikes
        let bestSource: { id: string; name: string; excess: number; dist: number } | null = null;
        for (const [pid, info] of Object.entries(parkingTargets)) {
          if (pid === pred.parking_id) continue;
          const count = bikeCountPerParking[pid] ?? 0;
          const excess = count - (info.target || 3);
          if (excess < 2) continue;

          const dlat = (info.lat - target.lat) * 111000;
          const dlng = (info.lng - target.lng) * 111000 * Math.cos(target.lat * Math.PI / 180);
          const dist = Math.sqrt(dlat * dlat + dlng * dlng);

          if (!bestSource || dist < bestSource.dist) {
            bestSource = { id: pid, name: info.name, excess, dist };
          }
        }

        if (!bestSource || bestSource.dist > 5000) continue; // skip if no source within 5km

        const descricao = `Previsão: ${target.name} tende a esvaziar na próxima hora (média histórica: ${pred.avg_bikes} bikes). ` +
          `Fonte sugerida: ${bestSource.name} (${bestSource.excess} excesso, ${Math.round(bestSource.dist)}m).`;

        await supabase.from('tarefas_logistica').insert({
          cidade,
          kind: 'ORGANIZACAO',
          titulo,
          descricao,
          status: 'pendente',
          destino_lat: target.lat,
          destino_lng: target.lng,
          parking_lat: target.lat,
          parking_lng: target.lng,
        });

        totalCreated++;
      }
    }

    return json({ ok: true, tasks_created: totalCreated });
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
