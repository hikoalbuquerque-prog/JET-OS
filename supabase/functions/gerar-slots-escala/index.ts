// ============================================================================
// JET OS — Edge Function: gerar-slots-escala
// Engine unificada de geração de slots. Lê escala_config por cidade (faixas,
// perfis, mapa_dias, overrides_data, zonas_ativas) e gera em slots_escala.
// Usa dados GoJet ao vivo quando gojet_ajuste=true.
// Idempotente via upsert (cidade, data_slot, turno, tipo, zona).
// Agendar via pg_cron: SELECT net.http_post(...) diário às 21:00 BRT.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// ── Zone stats from parkings table (GoJet live data) ──────────────────────
const ZONA_MAP: Record<string, string> = {
  "🟥": "Z1 - Vermelha",
  "⬛": "Z2 - Preta",
  "🟧": "Z3 - Laranja",
  "🟦": "Z4 - Azul",
  "🟩": "Z5 - Verde",
  "🟨": "Z6 - Amarela",
  "🏁": "Zona Interlagos",
};
const RE_ZONA = /^([🟥⬛🟧🟦🟩🟨🏁])/u;

interface ZonaStat {
  disponiveis: number;
  target: number;
  deficit: number;
  ociosidade: number;
  lowBattery: number;
}

async function statsPorZona(
  admin: any,
  cityId: string
): Promise<Record<string, ZonaStat>> {
  const stats: Record<string, ZonaStat> = {};
  const { data: parkings } = await admin
    .from("parkings")
    .select("nome, bikes_total, bikes_disponiveis, dados")
    .eq("city_id", cityId);

  const { data: bikes } = await admin
    .from("bikes")
    .select("dados, status")
    .eq("city_id", cityId)
    .eq("status", "low_battery");

  // Count low battery bikes per zona (via parking_id → parking.nome → zona)
  const parkingZona: Record<string, string> = {};
  for (const p of parkings ?? []) {
    const m = (p.nome ?? "").match(RE_ZONA);
    if (m) parkingZona[p.dados?.id ?? ""] = ZONA_MAP[m[1]];
  }

  for (const p of parkings ?? []) {
    const m = (p.nome ?? "").match(RE_ZONA);
    const zona = m ? ZONA_MAP[m[1]] : null;
    if (!zona) continue;
    const tgt = Number(p.dados?.target_bikes_count ?? 0);
    const disp = Number(p.bikes_disponiveis ?? p.bikes_total ?? 0);
    const s = (stats[zona] ??= {
      disponiveis: 0,
      target: 0,
      deficit: 0,
      ociosidade: 0,
      lowBattery: 0,
    });
    s.disponiveis += disp;
    s.target += tgt;
    s.deficit += Math.max(0, tgt - disp);
  }

  // Low battery bikes per zona
  for (const b of bikes ?? []) {
    const parkId = b.dados?.parking_id;
    const zona = parkId ? parkingZona[parkId] : null;
    if (zona && stats[zona]) stats[zona].lowBattery++;
  }

  for (const z of Object.values(stats)) {
    z.ociosidade =
      z.target > 0
        ? Math.round(((z.target - z.disponiveis) / z.target) * 100)
        : 0;
  }
  return stats;
}

// ── Holiday check ─────────────────────────────────────────────────────────
async function isFeriado(
  admin: any,
  dataIso: string,
  cidade: string
): Promise<boolean> {
  const { data } = await admin
    .from("feriados")
    .select("id")
    .or(`cidade.eq.${cidade},nacional.eq.true`)
    .eq("data", dataIso)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ── Resolve profile for a given date ──────────────────────────────────────
function resolvePerfilDia(
  cfg: any,
  dataDate: Date,
  dataIso: string,
  feriado: boolean
): string {
  // 1. Override por data específica
  if (cfg.overrides_data?.[dataIso]) return cfg.overrides_data[dataIso];
  // 2. Feriado
  if (feriado) return cfg.feriado_perfil ?? "baixa";
  // 3. Mapa de dias da semana
  const dow = dataDate.getDay();
  return cfg.mapa_dias?.[String(dow)] ?? "media";
}

// ── Get vagas for a zona×cargo from perfil ────────────────────────────────
function vagasDoPerfil(
  perfis: any,
  perfilNome: string,
  zona: string,
  cargo: string
): number {
  const perfil = perfis?.[perfilNome];
  if (!perfil) return 0;
  // Zone-specific override, then _default
  const zonaConfig = perfil[zona] ?? {};
  const defaultConfig = perfil._default ?? {};
  return zonaConfig[cargo] ?? defaultConfig[cargo] ?? 0;
}

// ── GoJet live adjustments ────────────────────────────────────────────────
function ajusteGojet(
  base: number,
  zona: string,
  cargo: string,
  stats: Record<string, ZonaStat>
): number {
  const s = stats[zona];
  if (!s) return base;

  let extra = 0;
  // High deficit → +1 for field roles
  if (s.deficit > 15 && ["Scalt", "Charger", "Motorista"].includes(cargo)) {
    extra += 1;
  }
  // Very high deficit → +2
  if (s.deficit > 30 && ["Scalt", "Charger"].includes(cargo)) {
    extra += 1;
  }
  // Low battery → +1 for Charger
  if (cargo === "Charger" && s.lowBattery > 10) {
    extra += 1;
  }
  // High surplus (negative deficit) → reduce
  if (s.deficit === 0 && s.disponiveis > s.target * 1.3 && base > 1) {
    extra -= 1;
  }

  return Math.max(0, base + extra);
}

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false },
  });

  // Parse body: optional { cidade?, dias_ahead? }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = generate for all cities */
  }
  const diasAhead = body.dias_ahead ?? 1;
  const cidadeFiltro = body.cidade ?? null;

  // Load all city configs (or specific one)
  let query = admin.from("escala_config").select("*");
  if (cidadeFiltro) query = query.eq("cidade", cidadeFiltro);
  const { data: configs, error: cfgErr } = await query;
  if (cfgErr) return json({ error: "load_config", detail: cfgErr.message }, 500);

  const results: any[] = [];

  for (const cfg of configs ?? []) {
    const cidade = cfg.cidade;
    if (cidade === "global" && !cidadeFiltro) continue; // skip global unless explicit

    const faixas = cfg.faixas ?? [];
    const perfis = cfg.perfis ?? {};
    const zonasAtivas = cfg.zonas_ativas ?? [];
    const cargos = cfg.cargos ?? [
      "Charger",
      "Scalt",
      "Motorista",
      "Promotor",
      "Fiscal",
    ];
    const teto = cfg.teto_vagas_zona ?? 10;

    // If no faixas configured → manual mode, skip generation
    if (faixas.length === 0) {
      results.push({ cidade, modo: "manual", slots: 0 });
      continue;
    }

    // GoJet live stats (if enabled)
    let zoneStats: Record<string, ZonaStat> = {};
    if (cfg.gojet_ajuste && cfg.gojet_city_id) {
      zoneStats = await statsPorZona(admin, cfg.gojet_city_id);
    }

    const rows: any[] = [];

    for (let d = 1; d <= diasAhead; d++) {
      const dataDate = new Date(Date.now() + d * 86400_000);
      const dataIso = dataDate.toISOString().slice(0, 10);
      const feriado = await isFeriado(admin, dataIso, cidade);
      const perfilNome = resolvePerfilDia(cfg, dataDate, dataIso, feriado);

      for (const faixa of faixas) {
        const turnoId = faixa.id ?? `${faixa.horaIni}-${faixa.horaFim}`;

        for (const zona of zonasAtivas) {
          for (const cargo of cargos) {
            let vagas = vagasDoPerfil(perfis, perfilNome, zona, cargo);
            if (vagas <= 0) continue;

            // Apply GoJet live adjustments
            if (cfg.gojet_ajuste) {
              vagas = ajusteGojet(vagas, zona, cargo, zoneStats);
            }

            // Apply ceiling
            vagas = Math.min(vagas, teto);
            if (vagas <= 0) continue;

            rows.push({
              turno: turnoId,
              turno_label: `${turnoId} — ${faixa.horaIni} às ${faixa.horaFim}`,
              hora_ini: faixa.horaIni,
              hora_fim: faixa.horaFim,
              zona,
              tipo: cargo,
              qtd_pessoas: vagas,
              status: "Aberto",
              data_slot: dataIso,
              cidade,
              gerado_auto: true,
              feriado,
              criado_por_id: null,
              criado_por_nome: "gerar-slots-escala",
            });
          }
        }
      }
    }

    // Upsert idempotent by (cidade, data_slot, turno, tipo, zona)
    // Need unique constraint — use existing (cidade, data_slot, turno, tipo)
    // Since we now have zona, upsert per batch and handle conflicts
    let ok = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await admin.from("slots_escala").upsert(batch, {
        onConflict: "cidade,data_slot,turno,tipo",
        ignoreDuplicates: false,
      });
      if (error) {
        // If conflict includes zona, insert one by one
        for (const row of batch) {
          const { data: existing } = await admin
            .from("slots_escala")
            .select("id")
            .eq("cidade", row.cidade)
            .eq("data_slot", row.data_slot)
            .eq("turno", row.turno)
            .eq("tipo", row.tipo)
            .eq("zona", row.zona)
            .maybeSingle();
          if (existing) {
            await admin
              .from("slots_escala")
              .update({
                qtd_pessoas: row.qtd_pessoas,
                hora_ini: row.hora_ini,
                hora_fim: row.hora_fim,
                turno_label: row.turno_label,
                feriado: row.feriado,
                gerado_auto: true,
              })
              .eq("id", existing.id);
          } else {
            await admin.from("slots_escala").insert(row);
          }
          ok++;
        }
      } else {
        ok += batch.length;
      }
    }

    results.push({
      cidade,
      perfil: rows[0]
        ? resolvePerfilDia(
            cfg,
            new Date(Date.now() + 86400_000),
            new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
            false
          )
        : "manual",
      slots: rows.length,
      zonas: zonasAtivas.length,
      faixas: faixas.length,
      gojet: cfg.gojet_ajuste ? Object.keys(zoneStats).length + " zonas" : "off",
    });
  }

  return json({ ok: true, results });
});
