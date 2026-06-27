// ============================================================================
// JET OS — Edge Function: automacao
// Accoes: gerar-slots | limpeza-snapshots | gerar-tarefas-monitor
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const sb = () => createClient(SUPABASE_URL, SERVICE);

// ---------------------------------------------------------------------------
// GoJet fetch helper with cookie-jar & pagination
// ---------------------------------------------------------------------------
const GOJET_BASE = Deno.env.get("GOJET_PROXY_URL") || "https://logistic.gojet.app/api/v0/urent";
const PAGE_SIZE = 500;
const MAX_PAGES = 50;

async function gojetFetchAll(kind: "parkings" | "bikes"): Promise<any[]> {
  const all: any[] = [];
  let cookie = "";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${GOJET_BASE}/${kind}?page_number=${page}&page_size=${PAGE_SIZE}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (cookie) headers["Cookie"] = cookie;

    const res = await fetch(url, { headers });
    // capture AWSALB sticky cookie
    const sc = res.headers.get("set-cookie");
    if (sc) {
      const m = sc.match(/AWSALB[^;]*/);
      if (m) cookie = m[0];
    }

    const body = await res.json();
    const items = Array.isArray(body) ? body : body?.data ?? body?.items ?? [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Zona helpers
// ---------------------------------------------------------------------------
const ZONA_MAP: Record<string, string> = {
  "\u{1F7E5}": "Z1 - Vermelha",
  "⬛": "Z2 - Preta",
  "\u{1F7E7}": "Z3 - Laranja",
  "\u{1F7E6}": "Z4 - Azul",
  "\u{1F7E9}": "Z5 - Verde",
  "\u{1F7E8}": "Z6 - Amarela",
  "\u{1F3C1}": "Zona Interlagos",
};
const RE_ZONA = /^([\u{1F7E5}⬛\u{1F7E7}\u{1F7E6}\u{1F7E9}\u{1F7E8}\u{1F3C1}])/u;

function detectZona(name: string): string | null {
  const m = name.match(RE_ZONA);
  return m ? ZONA_MAP[m[1]] ?? null : null;
}

// Shift determination
function currentShift(now: Date): { turno: string; inicio: string; fim: string } {
  const h = now.getHours();
  if (h >= 6 && h < 14) return { turno: "T0", inicio: "06:00", fim: "14:00" };
  if (h >= 14 && h < 22) return { turno: "T1", inicio: "14:00", fim: "22:00" };
  return { turno: "T2", inicio: "22:00", fim: "06:00" };
}

// ---------------------------------------------------------------------------
// ACTION: gerar-slots (daily 21:00 or manual)
// ---------------------------------------------------------------------------
async function gerarSlots(): Promise<Response> {
  const admin = sb();
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  // 1. Read slot_config
  const { data: globalCfg } = await admin.from("slot_config").select("*").eq("id", "global").single();
  const { data: overrides } = await admin.from("slot_config").select("*").neq("id", "global");

  const vagasBase = globalCfg?.vagas_por_turno ?? 3;
  const turnos = ["T0", "T1", "T2"];
  const turnoHoras: Record<string, { inicio: string; fim: string }> = {
    T0: { inicio: "06:00", fim: "14:00" },
    T1: { inicio: "14:00", fim: "22:00" },
    T2: { inicio: "22:00", fim: "06:00" },
  };

  // 2. Read estacoes with tipoMonitor M1/M2/M3
  const { data: estacoes } = await admin
    .from("estacoes")
    .select("*")
    .in("tipo_monitor", ["M1", "M2", "M3"]);

  // 3. Fetch GoJet live data
  let parkings: any[] = [];
  let bikes: any[] = [];
  try {
    parkings = await gojetFetchAll("parkings");
    bikes = await gojetFetchAll("bikes");
  } catch (e) {
    console.error("GoJet fetch failed, using base vagas:", e);
  }

  // 4. Calculate zone stats
  const zonaStats: Record<string, { disponiveis: number; target: number; deficit: number; ociosidade: number }> = {};
  for (const p of parkings) {
    const zona = detectZona(p.name ?? p.nome ?? "");
    if (!zona) continue;
    const tgt = Number(p.target_bikes_count ?? 0);
    const disp = Number(p.available_bikes_count ?? p.bikes_total ?? 0);
    const s = (zonaStats[zona] ??= { disponiveis: 0, target: 0, deficit: 0, ociosidade: 0 });
    s.disponiveis += disp;
    s.target += tgt;
    s.deficit += Math.max(0, tgt - disp);
  }
  for (const z of Object.values(zonaStats)) {
    z.ociosidade = z.target > 0 ? Math.round(((z.target - z.disponiveis) / z.target) * 100) : 0;
  }

  // 5. Generate slots per zone/shift with multiplicators
  const slotsToInsert: any[] = [];
  const cities = [...new Set((estacoes ?? []).map((e: any) => e.cidade).filter(Boolean))];
  const cityOverrides = new Map((overrides ?? []).map((o: any) => [o.cidade ?? o.id, o]));

  for (const cidade of cities) {
    for (const turno of turnos) {
      const override = cityOverrides.get(cidade);
      let vagas = override?.vagas_por_turno ?? vagasBase;

      // Apply zone-based multiplicators
      const cidadeEstacoes = (estacoes ?? []).filter((e: any) => e.cidade === cidade);
      const zonas = [...new Set(cidadeEstacoes.map((e: any) => detectZona(e.nome ?? "")).filter(Boolean))];

      for (const zona of zonas) {
        const zs = zonaStats[zona!];
        let mult = 1.0;
        if (zs) {
          if (zs.ociosidade > 50) mult = 1.5;
          else if (zs.ociosidade > 30) mult = 1.2;
          else if (zs.ociosidade < 10) mult = 0.8;
        }
        const vagasZona = Math.max(1, Math.round(vagas * mult));

        for (let i = 0; i < vagasZona; i++) {
          const externalKey = `${dateStr}_${cidade}_${zona}_${turno}_${i}`;
          slotsToInsert.push({
            data: dateStr,
            cidade,
            zona,
            turno,
            hora_inicio: turnoHoras[turno].inicio,
            hora_fim: turnoHoras[turno].fim,
            status: "aberto",
            external_key: externalKey,
            criado_em: now.toISOString(),
          });
        }
      }
    }
  }

  // 6. Insert (upsert by external_key for idempotency)
  let created = 0;
  if (slotsToInsert.length > 0) {
    const { data: inserted, error } = await admin
      .from("slots")
      .upsert(slotsToInsert, { onConflict: "external_key", ignoreDuplicates: true });
    if (error) {
      console.error("Insert slots error:", error);
      return json({ ok: false, error: error.message }, 500);
    }
    created = slotsToInsert.length;
  }

  // 7. Log
  await admin.from("logs_automacao").insert({
    tipo: "gerar-slots",
    detalhes: { data: dateStr, created, zonas: Object.keys(zonaStats).length, parkings: parkings.length },
    criado_em: now.toISOString(),
  });

  return json({ ok: true, created });
}

// ---------------------------------------------------------------------------
// ACTION: limpeza-snapshots (daily 03:00)
// ---------------------------------------------------------------------------
async function limpezaSnapshots(): Promise<Response> {
  const admin = sb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error, count } = await admin
    .from("gojet_snapshots")
    .delete()
    .lt("criado_em", cutoff)
    .select("id", { count: "exact", head: true });

  if (error) return json({ ok: false, error: error.message }, 500);

  const deleted = count ?? 0;
  return json({ ok: true, deleted });
}

// ---------------------------------------------------------------------------
// ACTION: gerar-tarefas-monitor
// ---------------------------------------------------------------------------
async function gerarTarefasMonitor(): Promise<Response> {
  const admin = sb();
  const now = new Date();
  const shift = currentShift(now);

  // Read estacoes with monitor types
  const { data: estacoes } = await admin
    .from("estacoes")
    .select("*")
    .in("tipo_monitor", ["M1", "M2", "M3"]);

  // Read current GoJet snapshot
  const { data: snap } = await admin
    .from("gojet_snapshots")
    .select("*")
    .eq("id", "latest_parkings")
    .single();

  const parkingsData: any[] = snap?.data ?? [];
  const parkingsMap = new Map(parkingsData.map((p: any) => [String(p.id ?? p.parking_id), p]));

  // Read open tasks to dedup
  const { data: openTasks } = await admin
    .from("tarefas")
    .select("estacao_id, tipo")
    .in("status", ["aberto", "em_andamento"]);

  const openSet = new Set((openTasks ?? []).map((t: any) => `${t.estacao_id}_${t.tipo}`));

  const tarefas: any[] = [];

  for (const est of estacoes ?? []) {
    const parkingId = String(est.gojet_parking_id ?? est.parking_id ?? "");
    const parking = parkingsMap.get(parkingId);
    const bikesCount = Number(parking?.available_bikes_count ?? parking?.bikes_total ?? 0);
    const minBikes = Number(est.min_bikes ?? 0);
    const maxBikes = Number(est.max_bikes ?? 999);

    // M1: zero-fill stations
    if (est.tipo_monitor === "M1" && bikesCount === 0) {
      const key = `${est.id}_zero_fill`;
      if (!openSet.has(key)) {
        tarefas.push({
          estacao_id: est.id,
          tipo: "zero_fill",
          prioridade: "alta",
          turno: shift.turno,
          descricao: `Estacao ${est.nome} com 0 bikes (M1)`,
          status: "aberto",
          criado_em: now.toISOString(),
        });
        openSet.add(key);
      }
    }

    // M2: bike count outside min/max per shift
    if (est.tipo_monitor === "M2") {
      if (bikesCount < minBikes) {
        const key = `${est.id}_abaixo_min`;
        if (!openSet.has(key)) {
          tarefas.push({
            estacao_id: est.id,
            tipo: "abaixo_min",
            prioridade: "media",
            turno: shift.turno,
            descricao: `Estacao ${est.nome}: ${bikesCount} bikes (min ${minBikes}) (M2)`,
            status: "aberto",
            criado_em: now.toISOString(),
          });
          openSet.add(key);
        }
      }
      if (bikesCount > maxBikes) {
        const key = `${est.id}_acima_max`;
        if (!openSet.has(key)) {
          tarefas.push({
            estacao_id: est.id,
            tipo: "acima_max",
            prioridade: "media",
            turno: shift.turno,
            descricao: `Estacao ${est.nome}: ${bikesCount} bikes (max ${maxBikes}) (M2)`,
            status: "aberto",
            criado_em: now.toISOString(),
          });
          openSet.add(key);
        }
      }
    }

    // M3: promoter not covering station
    if (est.tipo_monitor === "M3") {
      // Check if a worker is assigned to this station in current shift
      const { data: assigned } = await admin
        .from("slots")
        .select("id")
        .eq("estacao_id", est.id)
        .eq("turno", shift.turno)
        .eq("data", now.toISOString().slice(0, 10))
        .in("status", ["aceito", "em_andamento"])
        .limit(1);

      if (!assigned || assigned.length === 0) {
        const key = `${est.id}_sem_promotor`;
        if (!openSet.has(key)) {
          tarefas.push({
            estacao_id: est.id,
            tipo: "sem_promotor",
            prioridade: "alta",
            turno: shift.turno,
            descricao: `Estacao ${est.nome}: sem promotor no turno ${shift.turno} (M3)`,
            status: "aberto",
            criado_em: now.toISOString(),
          });
          openSet.add(key);
        }
      }
    }
  }

  // Insert tasks
  let created = 0;
  if (tarefas.length > 0) {
    const { error } = await admin.from("tarefas").insert(tarefas);
    if (error) return json({ ok: false, error: error.message }, 500);
    created = tarefas.length;
  }

  return json({ ok: true, created });
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
      case "gerar-slots":
        return await gerarSlots();
      case "limpeza-snapshots":
        return await limpezaSnapshots();
      case "gerar-tarefas-monitor":
        return await gerarTarefasMonitor();
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("automacao error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
