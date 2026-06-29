// O2: Daily fraud pattern detection
// Runs via pg_cron daily. Checks audit_log + tarefas for anomalies.
// Does NOT block scouts — only creates alerts for gestor review.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TELEGRAM_ADMIN_CHAT = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

interface FraudAlert {
  scout_uid: string;
  scout_nome: string;
  tipo: string;
  detalhes: Record<string, any>;
}

async function checkSpeedFraud(): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];
  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();

  const { data: tarefas } = await supabase
    .from('tarefas_logistica')
    .select('assignee_uid, criado_em, concluido_em, kind, titulo, cidade')
    .eq('status', 'concluida')
    .gte('concluido_em', yesterday)
    .not('assignee_uid', 'is', null);

  if (!tarefas?.length) return alerts;

  // Group by scout
  const byScout = new Map<string, any[]>();
  for (const t of tarefas) {
    const list = byScout.get(t.assignee_uid) ?? [];
    list.push(t);
    byScout.set(t.assignee_uid, list);
  }

  for (const [uid, tasks] of byScout) {
    const fastTasks = tasks.filter(t => {
      if (!t.criado_em || !t.concluido_em) return false;
      const mins = (new Date(t.concluido_em).getTime() - new Date(t.criado_em).getTime()) / 60000;
      return mins < 5 && mins >= 0;
    });

    // Flag if >50% of tasks completed in <5min (min 3 tasks)
    if (tasks.length >= 3 && fastTasks.length / tasks.length > 0.5) {
      const { data: user } = await supabase
        .from('usuarios')
        .select('nome')
        .eq('id', uid)
        .single();

      alerts.push({
        scout_uid: uid,
        scout_nome: user?.nome ?? uid,
        tipo: 'velocidade_suspeita',
        detalhes: {
          total_tarefas: tasks.length,
          tarefas_rapidas: fastTasks.length,
          pct_rapidas: Math.round(fastTasks.length / tasks.length * 100),
          msg: `${fastTasks.length}/${tasks.length} tarefas concluídas em <5min`,
        },
      });
    }
  }

  return alerts;
}

async function checkSwapAbuse(): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];
  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();

  const { data: swaps } = await supabase
    .from('bike_swap_log')
    .select('uid_scout, criado_em')
    .gte('criado_em', yesterday);

  if (!swaps?.length) return alerts;

  const byScout = new Map<string, number>();
  for (const s of swaps) {
    byScout.set(s.uid_scout, (byScout.get(s.uid_scout) ?? 0) + 1);
  }

  for (const [uid, count] of byScout) {
    if (count > 3) {
      const { data: user } = await supabase
        .from('usuarios')
        .select('nome')
        .eq('id', uid)
        .single();

      alerts.push({
        scout_uid: uid,
        scout_nome: user?.nome ?? uid,
        tipo: 'swap_excessivo',
        detalhes: {
          swaps_24h: count,
          msg: `${count} bike swaps nas últimas 24h (limite: 3)`,
        },
      });
    }
  }

  return alerts;
}

async function checkGpsStatic(): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];
  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();

  // Scouts who completed tasks but GPS hasn't moved
  const { data: tarefas } = await supabase
    .from('tarefas_logistica')
    .select('assignee_uid, concluido_em, destino_lat, destino_lng')
    .eq('status', 'concluida')
    .gte('concluido_em', yesterday)
    .not('assignee_uid', 'is', null)
    .not('destino_lat', 'is', null);

  if (!tarefas?.length) return alerts;

  const scouts = [...new Set(tarefas.map(t => t.assignee_uid))];

  for (const uid of scouts) {
    const { data: user } = await supabase
      .from('usuarios')
      .select('nome, ultima_pos')
      .eq('id', uid)
      .single();

    if (!user?.ultima_pos) continue;

    const pos = user.ultima_pos as any;
    const lat = pos.coordinates?.[1] ?? pos.lat ?? pos.latitude;
    const lng = pos.coordinates?.[0] ?? pos.lng ?? pos.longitude;
    if (!lat || !lng) continue;

    // Check if scout GPS is far from ALL their completed task destinations
    const scoutTasks = tarefas.filter(t => t.assignee_uid === uid);
    const allFar = scoutTasks.every(t => {
      const dlat = (t.destino_lat - lat) * 111000;
      const dlng = (t.destino_lng - lng) * 111000 * Math.cos(lat * Math.PI / 180);
      return Math.sqrt(dlat * dlat + dlng * dlng) > 2000; // >2km from every task
    });

    if (allFar && scoutTasks.length >= 2) {
      alerts.push({
        scout_uid: uid,
        scout_nome: user.nome ?? uid,
        tipo: 'gps_estatico',
        detalhes: {
          tarefas_concluidas: scoutTasks.length,
          gps_atual: { lat, lng },
          msg: `GPS parado a >2km de todas as ${scoutTasks.length} tarefas concluídas`,
        },
      });
    }
  }

  return alerts;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const [speed, swaps, gps] = await Promise.all([
      checkSpeedFraud(),
      checkSwapAbuse(),
      checkGpsStatic(),
    ]);

    const allAlerts = [...speed, ...swaps, ...gps];

    // Dedup: check if alert already exists for this scout+tipo in last 24h
    const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: existing } = await supabase
      .from('audit_log')
      .select('entidade_id, acao')
      .eq('entidade', 'fraude_suspeita')
      .gte('criado_em', yesterday);
    const alreadyAlerted = new Set(
      (existing ?? []).map((e: any) => `${e.entidade_id}:${e.acao}`)
    );

    let newAlerts = 0;
    for (const alert of allAlerts) {
      const key = `${alert.scout_uid}:${alert.tipo}`;
      if (alreadyAlerted.has(key)) continue;

      await supabase.from('audit_log').insert({
        entidade: 'fraude_suspeita',
        entidade_id: alert.scout_uid,
        acao: alert.tipo,
        dados: {
          scout_nome: alert.scout_nome,
          ...alert.detalhes,
        },
      });

      // Telegram alert
      if (TELEGRAM_BOT && TELEGRAM_ADMIN_CHAT) {
        const msg = `🚨 Fraude suspeita: ${alert.scout_nome}\nTipo: ${alert.tipo}\n${alert.detalhes.msg}`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text: msg }),
        }).catch(() => {});
      }

      newAlerts++;
    }

    return json({
      ok: true,
      checked: { speed: speed.length, swaps: swaps.length, gps: gps.length },
      new_alerts: newAlerts,
      total_candidates: allAlerts.length,
    });
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
