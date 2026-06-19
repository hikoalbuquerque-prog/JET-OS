// ============================================================================
// JET OS — Edge Function: gerar-slots (porte de _gerarSlots / gerarSlotsAgendado)
// Gera os slots do dia seguinte a partir de slot_config (global + overrides),
// 1 linha por vaga, em public.slots. Idempotente via external_key (re-rodar no
// mesmo dia não duplica). Agendar via pg_cron às 00:00 UTC (= 21:00 SP), igual
// ao Cloud Function original.
//
// v1: vagas = override ?? vagasBase. Os MULTIPLICADORES por dados GoLet ao vivo
// (ociosidade/déficit/bateria por zona) ficam como TODO — exigem mapear parkings
// -> zonas via polígonos; a geração base já é fiel ao gerador atual.
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

// zona detectada pelo emoji no início do nome do parking (igual calcularStatsZonas).
const ZONA_MAP: Record<string, string> = {
  "🟥": "Z1 - Vermelha", "⬛": "Z2 - Preta", "🟧": "Z3 - Laranja",
  "🟦": "Z4 - Azul", "🟩": "Z5 - Verde", "🟨": "Z6 - Amarela", "🏁": "Zona Interlagos",
};
const RE_ZONA = /^([🟥⬛🟧🟦🟩🟨🏁])/u;

// stats por zona a partir da tabela parkings (disponiveis/target/deficit/ociosidade%).
async function statsPorZona(admin: any, cityId: string): Promise<Record<string, any>> {
  const stats: Record<string, any> = {};
  const { data } = await admin.from("parkings").select("nome, bikes_total, dados").eq("city_id", cityId);
  for (const p of data ?? []) {
    const m = (p.nome ?? "").match(RE_ZONA);
    const zona = m ? ZONA_MAP[m[1]] : null;
    if (!zona) continue;
    const tgt = Number(p.dados?.target_bikes_count ?? 0);
    const disp = Number(p.bikes_total ?? 0);
    const s = (stats[zona] ??= { disponiveis: 0, target: 0, deficit: 0, ociosidade: 0 });
    s.disponiveis += disp; s.target += tgt; s.deficit += Math.max(0, tgt - disp);
  }
  for (const z of Object.values(stats) as any[]) {
    z.ociosidade = z.target > 0 ? Math.round(((z.target - z.disponiveis) / z.target) * 100) : 0;
  }
  return stats;
}

const TURNOS: Record<string, { inicio: string; fim: string }> = {
  T0: { inicio: "23:00", fim: "07:00" },   // vira o dia
  T1: { inicio: "10:00", fim: "15:00" },
  T2: { inicio: "15:00", fim: "23:00" },
};
const addDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  const { data: cfgRow } = await admin.from("slot_config").select("dados").eq("id", "global").maybeSingle();
  if (!cfgRow?.dados) return json({ error: "slot_config_global_ausente" }, 400);
  const cfg = cfgRow.dados as any;
  const { data: ovRow } = await admin.from("slot_config").select("dados").eq("id", "overrides").maybeSingle();
  const overrides = (ovRow?.dados ?? {}) as Record<string, any>;

  const amanha = addDias(new Date(), 1);          // mesmo cálculo do Cloud Function
  const dataStr = ymd(amanha);

  // multiplicadores ao vivo: stats por zona da tabela parkings (do scrape-gojet)
  const stats = cfg.cityIdGoJet ? await statsPorZona(admin, cfg.cityIdGoJet) : {};
  const mul = cfg.multiplicadores;

  const rows: any[] = [];
  for (const z of cfg.zonas ?? []) {
    if (!z.ativo) continue;
    const chave = `${z.zona}_${z.turno}`;
    if (overrides[chave]?.ativo === false) continue;

    let vagas = Number(overrides[chave]?.vagasBase ?? z.vagasBase ?? 0);
    const snap = stats[z.zona];
    if (snap && mul) {
      if (snap.ociosidade > mul.limiarOciosidade) vagas += mul.ociosidadeAlta;
      if (snap.deficit > mul.limiarDeficit) vagas += mul.deficitAlto;
      if (z.cargo === "charger") vagas += mul.bateriasBaixa;
    }

    const t = TURNOS[z.turno];
    if (!t) continue;
    const inicio = `${dataStr}T${t.inicio}:00-03:00`;
    const fim = z.turno === "T0"
      ? `${ymd(addDias(amanha, 1))}T${t.fim}:00-03:00`
      : `${dataStr}T${t.fim}:00-03:00`;
    const titulo = `${z.cargo === "charger" ? "Charger" : "Scalt"} — ${z.zona} ${z.turno}`;

    for (let i = 0; i < vagas; i++) {
      rows.push({
        external_key: `gen_${cfg.cidade}_${z.zona}_${z.turno}_${dataStr}_${i}`,
        cidade: cfg.cidade, tipo: z.cargo, inicio, fim, vagas: 1, status: "aberto",
        config: {
          titulo, zona_origem: z.zona, turno: z.turno, pais: cfg.pais,
          cargo: z.cargo, gerado_automatico: true, criado_por: "scheduler",
        },
      });
    }
  }

  let ok = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const { error } = await admin.from("slots").upsert(part, { onConflict: "external_key", ignoreDuplicates: true });
    if (error) return json({ error: "insert_slots", detail: error.message, geradosAntes: ok }, 500);
    ok += part.length;
  }

  return json({ ok: true, data: dataStr, slots_gerados: rows.length });
});
