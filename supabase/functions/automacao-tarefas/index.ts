// ============================================================================
// JET OS — Edge Function: automacao-tarefas
// Accoes: gerar-tarefas-gojet | gerar-tarefas-agendado | gerar-slots-inteligente
//         gerar-slots-manual | escalar-slots-sla | salvar-historico-parking
//         exportar-historico-parking | notificar-tarefa | notificar-turno
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENWEATHER_API_KEY = Deno.env.get("OPENWEATHER_API_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const sb = () => createClient(SUPABASE_URL, SERVICE);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentShift(now: Date): { turno: string; inicio: string; fim: string } {
  const h = now.getHours();
  if (h >= 6 && h < 14) return { turno: "T0", inicio: "06:00", fim: "14:00" };
  if (h >= 14 && h < 22) return { turno: "T1", inicio: "14:00", fim: "22:00" };
  return { turno: "T2", inicio: "22:00", fim: "06:00" };
}

async function sendTelegram(chatId: string | number, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("TELEGRAM_BOT_TOKEN not set, skipping notification");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Telegram send failed:", e);
  }
}

async function getWeather(lat: number, lon: number): Promise<{ isHeavyRain: boolean; isLightRain: boolean; description: string }> {
  if (!OPENWEATHER_API_KEY) {
    return { isHeavyRain: false, isLightRain: false, description: "no_api_key" };
  }
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
    );
    const data = await res.json();
    const main = data.weather?.[0]?.main?.toLowerCase() ?? "";
    const desc = data.weather?.[0]?.description ?? "";
    const rainMm = data.rain?.["1h"] ?? 0;

    const isHeavyRain = main === "thunderstorm" || rainMm > 7;
    const isLightRain = (main === "rain" || main === "drizzle") && !isHeavyRain;

    return { isHeavyRain, isLightRain, description: desc };
  } catch (e) {
    console.error("Weather fetch failed:", e);
    return { isHeavyRain: false, isLightRain: false, description: "error" };
  }
}

// Read all gojet_snapshots chunks for a given prefix
async function readSnapshotChunks(admin: any, prefix: string): Promise<any[]> {
  const { data: rows } = await admin
    .from("gojet_snapshots")
    .select("id, data")
    .like("id", `${prefix}%`)
    .order("id");

  const all: any[] = [];
  for (const row of rows ?? []) {
    if (Array.isArray(row.data)) all.push(...row.data);
  }
  return all;
}

// ---------------------------------------------------------------------------
// ACTION: gerar-tarefas-gojet (manual from snapshot)
// ---------------------------------------------------------------------------
async function gerarTarefasGojet(body: any): Promise<Response> {
  const admin = sb();
  const now = new Date();
  const snapshotId = body.snapshotId ?? "latest_parkings";
  const cidadeFiltro = body.cidade;

  // Read snapshot
  let parkings = await readSnapshotChunks(admin, snapshotId.replace(/_\d+$/, ""));
  if (parkings.length === 0) {
    // Try single row
    const { data } = await admin.from("gojet_snapshots").select("data").eq("id", snapshotId).single();
    parkings = data?.data ?? [];
  }

  if (cidadeFiltro) {
    parkings = parkings.filter((p: any) => String(p.city_id ?? p.cidade) === String(cidadeFiltro));
  }

  // Find anomalies
  const anomalies: any[] = [];
  for (const p of parkings) {
    const available = Number(p.available_bikes_count ?? 0);
    const total = Number(p.total_slots ?? p.capacity ?? 0);
    const name = p.name ?? p.nome ?? "";
    const pid = String(p.id ?? p.parking_id);

    // Zero bikes
    if (available === 0 && total > 0) {
      anomalies.push({ parkingId: pid, nome: name, tipo: "zero_fill", prioridade: "alta", cidade: p.city_id ?? cidadeFiltro, descricao: `${name}: 0 bikes disponiveis` });
    }
    // Too many bikes (>90% capacity)
    if (total > 0 && available > total * 0.9) {
      anomalies.push({ parkingId: pid, nome: name, tipo: "excesso", prioridade: "media", cidade: p.city_id ?? cidadeFiltro, descricao: `${name}: ${available}/${total} bikes (excesso)` });
    }
    // Battery issues — check via bikes snapshot
    // (handled separately if bikes data is available)
  }

  // Read bikes snapshot for battery issues
  const bikesData = await readSnapshotChunks(admin, "latest_bikes");
  const parkingBatteryIssues = new Map<string, number>();
  for (const b of bikesData) {
    if (typeof b.battery_percent === "number" && b.battery_percent < 0.15) {
      const pid = String(b.parking_id ?? "");
      if (pid) parkingBatteryIssues.set(pid, (parkingBatteryIssues.get(pid) ?? 0) + 1);
    }
  }
  for (const [pid, count] of parkingBatteryIssues) {
    if (count >= 3) {
      const parking = parkings.find((p: any) => String(p.id ?? p.parking_id) === pid);
      if (parking) {
        anomalies.push({
          parkingId: pid,
          nome: parking.name ?? parking.nome ?? pid,
          tipo: "bateria_baixa",
          prioridade: "media",
          cidade: parking.city_id ?? cidadeFiltro,
          descricao: `${parking.name ?? parking.nome}: ${count} bikes com bateria <15%`,
        });
      }
    }
  }

  // Dedup against open tasks
  if (anomalies.length === 0) return json({ ok: true, created: 0 });

  const parkingIds = [...new Set(anomalies.map((a) => a.parkingId))];
  const { data: openTasks } = await admin
    .from("tarefas_logistica")
    .select("parking_id, tipo")
    .in("status", ["aberto", "em_andamento"])
    .in("parking_id", parkingIds);

  const openSet = new Set((openTasks ?? []).map((t: any) => `${t.parking_id}_${t.tipo}`));

  const toInsert = anomalies
    .filter((a) => !openSet.has(`${a.parkingId}_${a.tipo}`))
    .map((a) => ({
      parking_id: a.parkingId,
      nome_parking: a.nome,
      tipo: a.tipo,
      prioridade: a.prioridade,
      cidade: a.cidade,
      status: "aberto",
      descricao: a.descricao,
      criado_em: now.toISOString(),
    }));

  let created = 0;
  if (toInsert.length > 0) {
    const { error } = await admin.from("tarefas_logistica").insert(toInsert);
    if (error) return json({ ok: false, error: error.message }, 500);
    created = toInsert.length;
  }

  return json({ ok: true, created });
}

// ---------------------------------------------------------------------------
// ACTION: gerar-tarefas-agendado (hourly — all cities with monitor_config)
// ---------------------------------------------------------------------------
async function gerarTarefasAgendado(): Promise<Response> {
  const admin = sb();
  const { data: configs } = await admin
    .from("monitor_config")
    .select("cidade, city_id")
    .eq("ativo", true);

  let totalCreated = 0;

  for (const cfg of configs ?? []) {
    const cidade = cfg.cidade ?? cfg.city_id;
    if (!cidade) continue;

    const res = await gerarTarefasGojet({ cidade });
    const result = await res.json();
    totalCreated += result.created ?? 0;
  }

  return json({ ok: true, created: totalCreated });
}

// ---------------------------------------------------------------------------
// ACTION: gerar-slots-inteligente (every 15min)
// ---------------------------------------------------------------------------
async function gerarSlotsInteligente(): Promise<Response> {
  const admin = sb();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const shift = currentShift(now);

  // Read config per city
  const { data: configs } = await admin.from("config_auto_slots").select("*").eq("ativo", true);
  if (!configs || configs.length === 0) return json({ ok: true, slots: 0, message: "no active configs" });

  let totalSlots = 0;

  for (const cfg of configs) {
    const cidade = cfg.cidade;
    const lat = cfg.lat ?? -23.55;
    const lon = cfg.lon ?? -46.63;

    // Weather check
    const weather = await getWeather(lat, lon);
    if (weather.isHeavyRain) {
      console.log(`Heavy rain in ${cidade}, suspending slot generation`);
      await admin.from("log_slots_auto").insert({
        cidade,
        acao: "suspendido",
        motivo: `Chuva forte: ${weather.description}`,
        criado_em: now.toISOString(),
      });
      continue;
    }
    const weatherMult = weather.isLightRain ? 0.7 : 1.0;

    // Read current GoJet data for this city
    const parkings = await readSnapshotChunks(admin, "latest_parkings");
    const cityParkings = parkings.filter(
      (p: any) => String(p.city_id ?? "") === String(cidade)
    );

    // Calculate needed slots by cargo
    const cargos = cfg.cargos ?? ["promoter", "logistica"];
    const vagasPorCargo = cfg.vagas_por_cargo ?? 3;

    // Read current slots for today/shift
    const { data: existingSlots } = await admin
      .from("slots")
      .select("id, cargo, uid_prestador")
      .eq("data", dateStr)
      .eq("turno", shift.turno)
      .eq("cidade", cidade);

    const existingByCargo = new Map<string, number>();
    for (const s of existingSlots ?? []) {
      const c = s.cargo ?? "promoter";
      existingByCargo.set(c, (existingByCargo.get(c) ?? 0) + 1);
    }

    // Read available workers
    const { data: workers } = await admin
      .from("prestadores")
      .select("uid, nome, cargo, cidade")
      .eq("cidade", cidade)
      .eq("ativo", true);

    const workersByCargo = new Map<string, any[]>();
    for (const w of workers ?? []) {
      const c = w.cargo ?? "promoter";
      const list = workersByCargo.get(c) ?? [];
      list.push(w);
      workersByCargo.set(c, list);
    }

    // Track round-robin index per cargo
    const rrIndex = new Map<string, number>();

    const slotsToInsert: any[] = [];
    const tarefasToInsert: any[] = [];

    for (const cargo of cargos) {
      // Calculate demand based on GoJet data
      let needed = vagasPorCargo;
      if (cityParkings.length > 0) {
        const totalStations = cityParkings.length;
        const zeroStations = cityParkings.filter(
          (p: any) => Number(p.available_bikes_count ?? 0) === 0
        ).length;
        // More zero stations = more slots needed
        const demandMult = 1 + (zeroStations / Math.max(totalStations, 1)) * 2;
        needed = Math.max(1, Math.round(vagasPorCargo * demandMult * weatherMult));
      } else {
        needed = Math.max(1, Math.round(vagasPorCargo * weatherMult));
      }

      const existing = existingByCargo.get(cargo) ?? 0;
      const toCreate = Math.max(0, needed - existing);

      const pool = workersByCargo.get(cargo) ?? [];
      let idx = rrIndex.get(cargo) ?? 0;

      // Get already-assigned UIDs for today/shift to avoid double booking
      const { data: assignedToday } = await admin
        .from("slots")
        .select("uid_prestador")
        .eq("data", dateStr)
        .eq("turno", shift.turno)
        .not("uid_prestador", "is", null);

      const assignedSet = new Set((assignedToday ?? []).map((s: any) => s.uid_prestador));

      for (let i = 0; i < toCreate; i++) {
        // Round-robin assign from available pool
        let assignedUid: string | null = null;
        let assignedNome: string | null = null;

        if (pool.length > 0) {
          // Try to find an unassigned worker
          let attempts = 0;
          while (attempts < pool.length) {
            const worker = pool[idx % pool.length];
            idx++;
            if (!assignedSet.has(worker.uid)) {
              assignedUid = worker.uid;
              assignedNome = worker.nome;
              assignedSet.add(worker.uid);
              break;
            }
            attempts++;
          }
        }

        const externalKey = `auto_${dateStr}_${cidade}_${cargo}_${shift.turno}_${i}_${Date.now()}`;
        slotsToInsert.push({
          data: dateStr,
          cidade,
          cargo,
          turno: shift.turno,
          hora_inicio: shift.inicio,
          hora_fim: shift.fim,
          status: assignedUid ? "atribuido" : "aberto",
          uid_prestador: assignedUid,
          nome_prestador: assignedNome,
          external_key: externalKey,
          origem: "auto",
          criado_em: now.toISOString(),
        });

        // Create sub-task for assigned worker
        if (assignedUid) {
          tarefasToInsert.push({
            tipo: "slot_auto",
            cidade,
            uid_prestador: assignedUid,
            turno: shift.turno,
            data: dateStr,
            status: "aberto",
            descricao: `Slot auto-gerado: ${cargo} turno ${shift.turno}`,
            criado_em: now.toISOString(),
          });
        }
      }

      rrIndex.set(cargo, idx);
    }

    // Insert slots
    if (slotsToInsert.length > 0) {
      const { error } = await admin
        .from("slots")
        .upsert(slotsToInsert, { onConflict: "external_key", ignoreDuplicates: true });
      if (error) console.error(`Slots insert error for ${cidade}:`, error);
      totalSlots += slotsToInsert.length;
    }

    // Insert sub-tasks
    if (tarefasToInsert.length > 0) {
      await admin.from("tarefas").insert(tarefasToInsert);
    }

    // Log
    await admin.from("log_slots_auto").insert({
      cidade,
      acao: "gerado",
      turno: shift.turno,
      slots_criados: slotsToInsert.length,
      clima: weather.description,
      weather_mult: weatherMult,
      criado_em: now.toISOString(),
    });
  }

  return json({ ok: true, slots: totalSlots });
}

// ---------------------------------------------------------------------------
// ACTION: escalar-slots-sla (every 5min)
// ---------------------------------------------------------------------------
async function escalarSlotsSla(): Promise<Response> {
  const admin = sb();
  const now = new Date();

  // Read slots that are accepted and in progress
  const { data: slots } = await admin
    .from("slots")
    .select("*")
    .eq("status", "aceito")
    .not("hora_inicio_real", "is", null);

  let escalated = 0;

  for (const slot of slots ?? []) {
    const startedAt = new Date(slot.hora_inicio_real ?? slot.updated_at ?? slot.criado_em);
    const slaDuration = slot.sla_minutos ?? 60; // default 60min SLA
    const elapsed = (now.getTime() - startedAt.getTime()) / 60000; // minutes

    if (elapsed < slaDuration) continue; // SLA not exceeded

    const slaMultiple = Math.floor(elapsed / slaDuration);

    if (slaMultiple >= 3) {
      // 3x SLA: urgent escalation to diretoria
      await admin.from("monitor_alertas").insert({
        tipo: "sla_critico",
        slot_id: slot.id,
        cidade: slot.cidade,
        turno: slot.turno,
        uid_prestador: slot.uid_prestador,
        mensagem: `URGENTE: Slot ${slot.id} excedeu 3x o SLA (${Math.round(elapsed)}min / ${slaDuration}min)`,
        nivel: "diretoria",
        criado_em: now.toISOString(),
      });

      // Notify diretoria via Telegram
      const { data: gestores } = await admin
        .from("usuarios")
        .select("telegram_chat_id")
        .eq("role", "diretoria")
        .not("telegram_chat_id", "is", null);

      for (const g of gestores ?? []) {
        await sendTelegram(
          g.telegram_chat_id,
          `\u{1F6A8} <b>URGENTE SLA 3x</b>\nSlot: ${slot.id}\nCidade: ${slot.cidade}\nTurno: ${slot.turno}\nTempo: ${Math.round(elapsed)}min (SLA: ${slaDuration}min)`
        );
      }

      escalated++;
    } else if (slaMultiple >= 1) {
      // 1x SLA: alert monitor + Telegram to gestor
      // Check if we already alerted for this level
      const { data: existingAlert } = await admin
        .from("monitor_alertas")
        .select("id")
        .eq("slot_id", slot.id)
        .eq("tipo", "sla_alerta")
        .limit(1);

      if (!existingAlert || existingAlert.length === 0) {
        await admin.from("monitor_alertas").insert({
          tipo: "sla_alerta",
          slot_id: slot.id,
          cidade: slot.cidade,
          turno: slot.turno,
          uid_prestador: slot.uid_prestador,
          mensagem: `Slot ${slot.id} excedeu SLA (${Math.round(elapsed)}min / ${slaDuration}min)`,
          nivel: "gestor",
          criado_em: now.toISOString(),
        });

        // Notify gestores via Telegram
        const { data: gestores } = await admin
          .from("usuarios")
          .select("telegram_chat_id")
          .eq("role", "gestor")
          .eq("cidade", slot.cidade)
          .not("telegram_chat_id", "is", null);

        for (const g of gestores ?? []) {
          await sendTelegram(
            g.telegram_chat_id,
            `⚠️ <b>Alerta SLA</b>\nSlot: ${slot.id}\nCidade: ${slot.cidade}\nTurno: ${slot.turno}\nTempo: ${Math.round(elapsed)}min (SLA: ${slaDuration}min)`
          );
        }

        escalated++;
      }
    }
  }

  return json({ ok: true, escalated });
}

// ---------------------------------------------------------------------------
// ACTION: notificar-tarefa
// ---------------------------------------------------------------------------
async function notificarTarefa(body: any): Promise<Response> {
  const admin = sb();
  const { tarefaId, uid } = body;

  if (!tarefaId) return json({ error: "tarefaId required" }, 400);

  // Read tarefa
  const { data: tarefa, error } = await admin
    .from("tarefas_logistica")
    .select("*")
    .eq("id", tarefaId)
    .single();

  if (error || !tarefa) return json({ error: "Tarefa not found" }, 404);

  // Get user telegram chat_id
  const targetUid = uid ?? tarefa.uid_prestador;
  if (!targetUid) return json({ error: "No target uid" }, 400);

  const { data: user } = await admin
    .from("usuarios")
    .select("telegram_chat_id, nome, fcm_token")
    .eq("uid", targetUid)
    .single();

  if (!user) return json({ error: "User not found" }, 404);

  const msg = `\u{1F4CB} <b>Nova Tarefa</b>\nTipo: ${tarefa.tipo}\nPrioridade: ${tarefa.prioridade ?? "normal"}\nLocal: ${tarefa.nome_parking ?? tarefa.descricao ?? ""}\nStatus: ${tarefa.status}`;

  // Send Telegram
  if (user.telegram_chat_id) {
    await sendTelegram(user.telegram_chat_id, msg);
  }

  // Optional FCM push
  if (user.fcm_token) {
    try {
      // FCM via Supabase — just log for now, actual FCM requires server key
      console.log(`FCM push would go to ${user.fcm_token} for tarefa ${tarefaId}`);
    } catch (e) {
      console.error("FCM error:", e);
    }
  }

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// ACTION: notificar-turno
// ---------------------------------------------------------------------------
async function notificarTurno(body: any): Promise<Response> {
  const admin = sb();
  const { turnoId, uid, tipo } = body;

  if (!turnoId || !uid || !tipo) return json({ error: "turnoId, uid, tipo required" }, 400);

  // Read turno
  const { data: turno } = await admin
    .from("turnos_logistica")
    .select("*")
    .eq("id", turnoId)
    .single();

  // Read user
  const { data: user } = await admin
    .from("usuarios")
    .select("nome, cidade")
    .eq("uid", uid)
    .single();

  const nomeUser = user?.nome ?? uid;
  const cidade = user?.cidade ?? turno?.cidade ?? "";

  // Log the turno event
  await admin.from("logs_automacao").insert({
    tipo: `turno_${tipo}`,
    detalhes: { turnoId, uid, nome: nomeUser, cidade, tipo },
    criado_em: new Date().toISOString(),
  });

  // Notify gestores if relevant (entrada/saida)
  if (tipo === "entrada" || tipo === "saida") {
    const { data: gestores } = await admin
      .from("usuarios")
      .select("telegram_chat_id")
      .eq("role", "gestor")
      .eq("cidade", cidade)
      .not("telegram_chat_id", "is", null);

    const emoji = tipo === "entrada" ? "\u{1F7E2}" : "\u{1F534}";
    const msg = `${emoji} <b>Turno ${tipo}</b>\nPrestador: ${nomeUser}\nCidade: ${cidade}\nHora: ${new Date().toLocaleTimeString("pt-BR")}`;

    for (const g of gestores ?? []) {
      await sendTelegram(g.telegram_chat_id, msg);
    }
  }

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// ACTION: salvar-historico-parking (daily 23:55)
// ---------------------------------------------------------------------------
async function salvarHistoricoParking(): Promise<Response> {
  const admin = sb();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // Read today's snapshots
  const parkings = await readSnapshotChunks(admin, "latest_parkings");
  const bikes = await readSnapshotChunks(admin, "latest_bikes");

  if (parkings.length === 0) return json({ ok: true, message: "no parkings data" });

  // Aggregate stats
  const pontosTotal = parkings.length;
  const bikesDisponiveis = parkings.reduce(
    (sum: number, p: any) => sum + Number(p.available_bikes_count ?? 0),
    0
  );
  const bikesTotal = bikes.length;
  const monitoresTotal = parkings.filter(
    (p: any) => Number(p.available_bikes_count ?? 0) > 0
  ).length;
  const eficienciaPct =
    pontosTotal > 0 ? Math.round((monitoresTotal / pontosTotal) * 100) : 0;

  // Aggregate per city
  const byCidade = new Map<string, { pontos: number; bikes: number; monitores: number }>();
  for (const p of parkings) {
    const city = String(p.city_id ?? "unknown");
    const s = byCidade.get(city) ?? { pontos: 0, bikes: 0, monitores: 0 };
    s.pontos++;
    const avail = Number(p.available_bikes_count ?? 0);
    s.bikes += avail;
    if (avail > 0) s.monitores++;
    byCidade.set(city, s);
  }

  // Insert aggregated history
  const rows = [];

  // Global row
  rows.push({
    data: dateStr,
    cidade: "_global",
    pontos_total: pontosTotal,
    monitores_total: monitoresTotal,
    bikes_disponiveis: bikesDisponiveis,
    bikes_total: bikesTotal,
    eficiencia_pct: eficienciaPct,
    criado_em: now.toISOString(),
  });

  // Per-city rows
  for (const [city, stats] of byCidade) {
    const eff = stats.pontos > 0 ? Math.round((stats.monitores / stats.pontos) * 100) : 0;
    rows.push({
      data: dateStr,
      cidade: city,
      pontos_total: stats.pontos,
      monitores_total: stats.monitores,
      bikes_disponiveis: stats.bikes,
      bikes_total: 0, // bikes are not city-scoped in snapshot
      eficiencia_pct: eff,
      criado_em: now.toISOString(),
    });
  }

  const { error } = await admin
    .from("parking_history")
    .upsert(rows, { onConflict: "data,cidade", ignoreDuplicates: false });

  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// ACTION: exportar-historico-parking (callable)
// ---------------------------------------------------------------------------
async function exportarHistoricoParking(body: any): Promise<Response> {
  const admin = sb();
  const dias = body.dias ?? 7;
  const cidade = body.cidade;

  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let query = admin
    .from("parking_history")
    .select("*")
    .gte("data", cutoff)
    .order("data", { ascending: true });

  if (cidade) {
    query = query.eq("cidade", cidade);
  }

  const { data, error } = await query;
  if (error) return json({ ok: false, error: error.message }, 500);

  // Aggregate summary
  const records = data ?? [];
  const summary = {
    dias,
    cidade: cidade ?? "todas",
    registros: records.length,
    media_bikes: records.length > 0
      ? Math.round(records.reduce((s: number, r: any) => s + (r.bikes_disponiveis ?? 0), 0) / records.length)
      : 0,
    media_eficiencia: records.length > 0
      ? Math.round(records.reduce((s: number, r: any) => s + (r.eficiencia_pct ?? 0), 0) / records.length)
      : 0,
  };

  return json({ ok: true, summary, data: records });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "";

    switch (action) {
      case "gerar-tarefas-gojet":
        return await gerarTarefasGojet(body);
      case "gerar-tarefas-agendado":
        return await gerarTarefasAgendado();
      case "gerar-slots-inteligente":
        return await gerarSlotsInteligente();
      case "gerar-slots-manual":
        return await gerarSlotsInteligente();
      case "escalar-slots-sla":
        return await escalarSlotsSla();
      case "salvar-historico-parking":
        return await salvarHistoricoParking();
      case "exportar-historico-parking":
        return await exportarHistoricoParking(body);
      case "notificar-tarefa":
        return await notificarTarefa(body);
      case "notificar-turno":
        return await notificarTurno(body);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("automacao-tarefas error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
