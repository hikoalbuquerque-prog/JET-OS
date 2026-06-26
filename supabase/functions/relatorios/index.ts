import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const sb = () => createClient(URL, SERVICE);

// ── Timezone helper ─────────────────────────────────────────────
function spNow(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  );
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = spNow();
  d.setDate(d.getDate() - 1);
  return fmtDate(d);
}

function lastWeekRange(): { start: string; end: string } {
  const d = spNow();
  const dow = d.getDay(); // 0=Sun
  const endOffset = dow === 0 ? 0 : dow;
  const end = new Date(d);
  end.setDate(d.getDate() - endOffset); // last Sunday
  const start = new Date(end);
  start.setDate(end.getDate() - 6); // previous Monday
  return { start: fmtDate(start), end: fmtDate(end) };
}

function prevPrevWeekRange(
  cur: { start: string; end: string },
): { start: string; end: string } {
  const s = new Date(cur.start);
  s.setDate(s.getDate() - 7);
  const e = new Date(cur.end);
  e.setDate(e.getDate() - 7);
  return { start: fmtDate(s), end: fmtDate(e) };
}

// ── Telegram helpers ────────────────────────────────────────────
async function getTelegramToken(): Promise<string> {
  const env = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (env) return env;
  const { data } = await sb()
    .from("telegram_config")
    .select("bot_token")
    .eq("id", "global")
    .single();
  if (!data?.bot_token) throw new Error("bot_token not configured");
  return data.bot_token;
}

interface TelegramConfig {
  guard_chat_id?: string;
  guard_thread_id?: string;
  perdas_chat_id?: string;
  perdas_thread_id?: string;
}

async function getTelegramConfig(): Promise<TelegramConfig> {
  const { data } = await sb()
    .from("telegram_config")
    .select("guard_chat_id, guard_thread_id, perdas_chat_id, perdas_thread_id")
    .eq("id", "global")
    .single();
  return (data as TelegramConfig) ?? {};
}

async function sendTelegramText(
  chatId: string | number,
  text: string,
  threadId?: string | number,
) {
  const token = await getTelegramToken();
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (threadId) body.message_thread_id = Number(threadId);
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return res.json();
}

async function sendTelegramDocument(
  chatId: string | number,
  document: Uint8Array,
  filename: string,
  caption?: string,
  threadId?: string | number,
) {
  const token = await getTelegramToken();
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("document", new Blob([document]), filename);
  if (caption) fd.append("caption", caption);
  if (threadId) fd.append("message_thread_id", String(threadId));
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendDocument`,
    { method: "POST", body: fd },
  );
  return res.json();
}

// ── Aggregation helpers ─────────────────────────────────────────
interface Ocorrencia {
  id: string;
  tipo?: string;
  status?: string;
  cidade?: string;
  data_registro?: string;
  filial?: string;
  regiao?: string;
  subtipo?: string;
  fotos?: string[];
  descricao?: string;
  [k: string]: unknown;
}

function aggregate(rows: Ocorrencia[]) {
  const totalOcorrencias = rows.length;
  const porTipo: Record<string, number> = {};
  const porStatus: Record<string, number> = {};
  const porCidade: Record<string, number> = {};

  for (const r of rows) {
    const tipo = r.tipo ?? "outro";
    const status = r.status ?? "desconhecido";
    const cidade = r.cidade ?? "desconhecida";
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
    porStatus[status] = (porStatus[status] ?? 0) + 1;
    porCidade[cidade] = (porCidade[cidade] ?? 0) + 1;
  }

  return { totalOcorrencias, porTipo, porStatus, porCidade };
}

function bar(n: number, total: number, width = 6): string {
  const filled = total > 0 ? Math.round((n / total) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : "0%";
}

// ── i18n ────────────────────────────────────────────────────────
const labels: Record<string, Record<string, string>> = {
  pt: {
    title: "Relatório Guard",
    total: "Total",
    criticos: "Críticos",
    apuracao: "Apuração",
    resolvidos: "Resolvidos",
    porTipo: "Por tipo",
    topCidades: "Top cidades",
  },
  en: {
    title: "Guard Report",
    total: "Total",
    criticos: "Critical",
    apuracao: "Under review",
    resolvidos: "Resolved",
    porTipo: "By type",
    topCidades: "Top cities",
  },
  es: {
    title: "Informe Guard",
    total: "Total",
    criticos: "Críticos",
    apuracao: "En revisión",
    resolvidos: "Resueltos",
    porTipo: "Por tipo",
    topCidades: "Top ciudades",
  },
  ru: {
    title: "Отчёт Guard",
    total: "Всего",
    criticos: "Критические",
    apuracao: "На рассмотрении",
    resolvidos: "Решённые",
    porTipo: "По типу",
    topCidades: "Топ городов",
  },
};

function l(lang: string, key: string): string {
  return labels[lang]?.[key] ?? labels["pt"][key] ?? key;
}

// ── Markdown report ─────────────────────────────────────────────
function guardMarkdown(
  date: string,
  agg: ReturnType<typeof aggregate>,
  lang = "pt",
): string {
  const { totalOcorrencias, porTipo, porStatus, porCidade } = agg;
  const criticos =
    (porStatus["aberto"] ?? 0);
  const apuracao = porStatus["apuracao"] ?? 0;
  const resolvidos = porStatus["resolvido"] ?? 0;

  let md = `📊 *${l(lang, "title")} — ${date}*\n`;
  md += `${l(lang, "total")}: ${totalOcorrencias} ocorrências\n`;
  md += `🔴 ${l(lang, "criticos")}: ${criticos} | 🟡 ${l(lang, "apuracao")}: ${apuracao} | 🟢 ${l(lang, "resolvidos")}: ${resolvidos}\n\n`;

  md += `*${l(lang, "porTipo")}:*\n`;
  const sortedTipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
  for (const [tipo, n] of sortedTipos) {
    md += `${tipo}: ${n} ${bar(n, totalOcorrencias)} ${pct(n, totalOcorrencias)}\n`;
  }

  md += `\n*${l(lang, "topCidades")}:*\n`;
  const sortedCidades = Object.entries(porCidade).sort((a, b) => b[1] - a[1]);
  sortedCidades.slice(0, 10).forEach(([cidade, n], i) => {
    md += `${i + 1}. ${cidade} — ${n}\n`;
  });

  return md;
}

// ── HTML report ─────────────────────────────────────────────────
function guardHtml(
  date: string,
  agg: ReturnType<typeof aggregate>,
  rows: Ocorrencia[],
  lang = "pt",
): string {
  const { totalOcorrencias, porTipo, porStatus, porCidade } = agg;

  const maxTipo = Math.max(...Object.values(porTipo), 1);
  const tipoBarsSvg = Object.entries(porTipo)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([tipo, n], i) =>
        `<rect x="0" y="${i * 30}" width="${(n / maxTipo) * 300}" height="22" fill="#e53e3e" rx="3"/>
         <text x="${(n / maxTipo) * 300 + 8}" y="${i * 30 + 16}" font-size="13" fill="#333">${tipo}: ${n}</text>`,
    )
    .join("\n");
  const tipoSvgH = Object.keys(porTipo).length * 30 + 10;

  const statusEntries = Object.entries(porStatus);
  const statusTotal = statusEntries.reduce((s, [, n]) => s + n, 0) || 1;
  const statusColors: Record<string, string> = {
    aberto: "#e53e3e",
    apuracao: "#ecc94b",
    resolvido: "#38a169",
  };
  let cumPct = 0;
  const pieParts = statusEntries
    .map(([st, n]) => {
      const p = (n / statusTotal) * 100;
      const start = cumPct;
      cumPct += p;
      const color = statusColors[st] ?? "#a0aec0";
      return `<circle r="25%" cx="50%" cy="50%" fill="transparent" stroke="${color}" stroke-width="50%" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${-start}" />`;
    })
    .join("\n");

  const cidadeSections = Object.entries(porCidade)
    .sort((a, b) => b[1] - a[1])
    .map(([cidade, n]) => {
      const cidadeRows = rows.filter((r) => r.cidade === cidade);
      const fotosHtml = cidadeRows
        .filter((r) => r.fotos && r.fotos.length > 0)
        .slice(0, 4)
        .map(
          (r) =>
            `<img src="${r.fotos![0]}" style="width:120px;height:80px;object-fit:cover;border-radius:4px;margin:2px"/>`,
        )
        .join("");
      return `<div style="margin-bottom:16px">
        <h3>${cidade} — ${n} ocorrências</h3>
        <div style="display:flex;flex-wrap:wrap">${fotosHtml}</div>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${l(lang, "title")} — ${date}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333}
h1{color:#2d3748}h2{color:#4a5568;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.stats{display:flex;gap:16px;margin:12px 0}.stat{background:#f7fafc;border-radius:8px;padding:12px 20px;text-align:center}
.stat .n{font-size:28px;font-weight:700}.stat .label{font-size:13px;color:#718096}</style></head>
<body>
<h1>📊 ${l(lang, "title")} — ${date}</h1>
<div class="stats">
  <div class="stat"><div class="n">${totalOcorrencias}</div><div class="label">${l(lang, "total")}</div></div>
  <div class="stat" style="border-left:4px solid #e53e3e"><div class="n">${porStatus["aberto"] ?? 0}</div><div class="label">${l(lang, "criticos")}</div></div>
  <div class="stat" style="border-left:4px solid #ecc94b"><div class="n">${porStatus["apuracao"] ?? 0}</div><div class="label">${l(lang, "apuracao")}</div></div>
  <div class="stat" style="border-left:4px solid #38a169"><div class="n">${porStatus["resolvido"] ?? 0}</div><div class="label">${l(lang, "resolvidos")}</div></div>
</div>

<h2>${l(lang, "porTipo")}</h2>
<svg width="500" height="${tipoSvgH}" xmlns="http://www.w3.org/2000/svg">${tipoBarsSvg}</svg>

<h2>Status</h2>
<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
${pieParts}
</svg>
<div style="display:flex;gap:12px;margin:8px 0">${statusEntries.map(([st, n]) => `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:50%;background:${statusColors[st] ?? "#a0aec0"}"></span>${st}: ${n}</span>`).join("")}</div>

<h2>${l(lang, "topCidades")}</h2>
${cidadeSections}
</body></html>`;
}

// ── Perdas helpers ──────────────────────────────────────────────
const FILIAIS: Record<string, { regiao: string; responsavel: string }> = {
  "BRPD-Norte": { regiao: "Norte", responsavel: "Coord. Norte" },
  "BRPD-Centro": { regiao: "Centro", responsavel: "Coord. Centro" },
  "BRPD-Sul": { regiao: "Sul", responsavel: "Coord. Sul" },
};

interface PerdasAgg {
  byFilial: Record<
    string,
    { patins: number; bikes: number; baterias: number }
  >;
  totals: { patins: number; bikes: number; baterias: number };
}

function aggregatePerdas(rows: Ocorrencia[]): PerdasAgg {
  const byFilial: PerdasAgg["byFilial"] = {};
  const totals = { patins: 0, bikes: 0, baterias: 0 };

  for (const r of rows) {
    const filial = r.filial ?? r.regiao ?? "desconhecida";
    if (!byFilial[filial]) byFilial[filial] = { patins: 0, bikes: 0, baterias: 0 };
    const sub = (r.subtipo ?? "").toLowerCase();
    if (sub.includes("patins") || sub.includes("patinete")) {
      byFilial[filial].patins++;
      totals.patins++;
    } else if (sub.includes("bike") || sub.includes("bicicleta")) {
      byFilial[filial].bikes++;
      totals.bikes++;
    } else if (sub.includes("bateria")) {
      byFilial[filial].baterias++;
      totals.baterias++;
    } else {
      // default to patins
      byFilial[filial].patins++;
      totals.patins++;
    }
  }

  return { byFilial, totals };
}

function perdasMarkdown(
  date: string,
  agg: PerdasAgg,
  running?: { acc: PerdasAgg; d7: PerdasAgg },
): string {
  const { byFilial, totals } = agg;
  let md = `📉 *Relatório de Perdas — ${date}*\n`;
  md += `Total 24h: 🛴 ${totals.patins} patins | 🚲 ${totals.bikes} bikes | 🔋 ${totals.baterias} baterias\n\n`;

  if (running) {
    md += `*Acumulado:* 🛴 ${running.acc.totals.patins} | 🚲 ${running.acc.totals.bikes} | 🔋 ${running.acc.totals.baterias}\n`;
    md += `*Últimos 7d:* 🛴 ${running.d7.totals.patins} | 🚲 ${running.d7.totals.bikes} | 🔋 ${running.d7.totals.baterias}\n\n`;
  }

  md += `*Por filial/região:*\n`;
  for (const [filial, counts] of Object.entries(byFilial).sort(
    (a, b) =>
      a[1].patins + a[1].bikes + a[1].baterias >
      b[1].patins + b[1].bikes + b[1].baterias
        ? -1
        : 1,
  )) {
    const info = FILIAIS[filial];
    const resp = info ? ` (${info.responsavel})` : "";
    md += `• ${filial}${resp}: 🛴${counts.patins} 🚲${counts.bikes} 🔋${counts.baterias}\n`;
  }

  return md;
}

// ── Actions ─────────────────────────────────────────────────────

async function guardDiario() {
  const date = yesterday();
  const { data: rows, error } = await sb()
    .from("ocorrencias")
    .select("*")
    .gte("data_registro", `${date}T00:00:00`)
    .lt("data_registro", `${date}T23:59:59.999`);
  if (error) throw error;
  const occ = (rows ?? []) as Ocorrencia[];
  const agg = aggregate(occ);
  const md = guardMarkdown(date, agg);

  const cfg = await getTelegramConfig();
  if (cfg.guard_chat_id) {
    await sendTelegramText(cfg.guard_chat_id, md, cfg.guard_thread_id);
  }

  return { ok: true, totalOcorrencias: agg.totalOcorrencias };
}

async function guardManual(body: { dataStr?: string; lang?: string }) {
  const date = body.dataStr ?? yesterday();
  const lang = body.lang ?? "pt";

  const { data: rows, error } = await sb()
    .from("ocorrencias")
    .select("*")
    .gte("data_registro", `${date}T00:00:00`)
    .lt("data_registro", `${date}T23:59:59.999`);
  if (error) throw error;
  const occ = (rows ?? []) as Ocorrencia[];
  const agg = aggregate(occ);

  const md = guardMarkdown(date, agg, lang);
  const html = guardHtml(date, agg, occ, lang);

  const cfg = await getTelegramConfig();
  if (cfg.guard_chat_id) {
    await sendTelegramText(cfg.guard_chat_id, md, cfg.guard_thread_id);
    await sendTelegramDocument(
      cfg.guard_chat_id,
      new TextEncoder().encode(html),
      `guard_${date}.html`,
      `${l(lang, "title")} — ${date}`,
      cfg.guard_thread_id,
    );
  }

  return { ok: true, totalOcorrencias: agg.totalOcorrencias, data: date, tipo: "guard" };
}

async function guardSemanal() {
  const range = lastWeekRange();
  const prevRange = prevPrevWeekRange(range);

  const [{ data: rows }, { data: prevRows }] = await Promise.all([
    sb()
      .from("ocorrencias")
      .select("*")
      .gte("data_registro", `${range.start}T00:00:00`)
      .lte("data_registro", `${range.end}T23:59:59.999`),
    sb()
      .from("ocorrencias")
      .select("*")
      .gte("data_registro", `${prevRange.start}T00:00:00`)
      .lte("data_registro", `${prevRange.end}T23:59:59.999`),
  ]);

  const occ = (rows ?? []) as Ocorrencia[];
  const prevOcc = (prevRows ?? []) as Ocorrencia[];
  const agg = aggregate(occ);
  const prevAgg = aggregate(prevOcc);

  const delta = prevAgg.totalOcorrencias > 0
    ? Math.round(
        ((agg.totalOcorrencias - prevAgg.totalOcorrencias) /
          prevAgg.totalOcorrencias) *
          100,
      )
    : 0;
  const deltaStr = delta > 0 ? `+${delta}%` : `${delta}%`;

  let md = guardMarkdown(`${range.start} → ${range.end}`, agg);
  md += `\n*Comparativo semana anterior:* ${prevAgg.totalOcorrencias} → ${agg.totalOcorrencias} (${deltaStr})\n`;

  const html = guardHtml(`${range.start} → ${range.end}`, agg, occ);

  const cfg = await getTelegramConfig();
  if (cfg.guard_chat_id) {
    await sendTelegramText(cfg.guard_chat_id, md, cfg.guard_thread_id);
    await sendTelegramDocument(
      cfg.guard_chat_id,
      new TextEncoder().encode(html),
      `guard_semanal_${range.start}_${range.end}.html`,
      `Relatório Guard Semanal — ${range.start} a ${range.end}`,
      cfg.guard_thread_id,
    );
  }

  return { ok: true };
}

async function perdasDiario() {
  const date = yesterday();
  const { data: rows, error } = await sb()
    .from("ocorrencias")
    .select("*")
    .ilike("tipo", "%perda%")
    .gte("data_registro", `${date}T00:00:00`)
    .lt("data_registro", `${date}T23:59:59.999`);
  if (error) throw error;
  const occ = (rows ?? []) as Ocorrencia[];
  const agg = aggregatePerdas(occ);

  // Running totals: accumulative + 7d
  const d7Start = new Date(date);
  d7Start.setDate(d7Start.getDate() - 6);
  const [{ data: accRows }, { data: d7Rows }] = await Promise.all([
    sb().from("ocorrencias").select("*").ilike("tipo", "%perda%"),
    sb()
      .from("ocorrencias")
      .select("*")
      .ilike("tipo", "%perda%")
      .gte("data_registro", `${fmtDate(d7Start)}T00:00:00`)
      .lte("data_registro", `${date}T23:59:59.999`),
  ]);

  const running = {
    acc: aggregatePerdas((accRows ?? []) as Ocorrencia[]),
    d7: aggregatePerdas((d7Rows ?? []) as Ocorrencia[]),
  };

  const md = perdasMarkdown(date, agg, running);

  const cfg = await getTelegramConfig();
  if (cfg.perdas_chat_id) {
    await sendTelegramText(cfg.perdas_chat_id, md, cfg.perdas_thread_id);
  }

  return { ok: true };
}

async function perdasSemanal() {
  const range = lastWeekRange();

  const { data: rows, error } = await sb()
    .from("ocorrencias")
    .select("*")
    .ilike("tipo", "%perda%")
    .gte("data_registro", `${range.start}T00:00:00`)
    .lte("data_registro", `${range.end}T23:59:59.999`);
  if (error) throw error;
  const occ = (rows ?? []) as Ocorrencia[];
  const agg = aggregatePerdas(occ);

  // Running totals
  const d7Start = new Date(range.end);
  d7Start.setDate(d7Start.getDate() - 6);
  const [{ data: accRows }, { data: d7Rows }] = await Promise.all([
    sb().from("ocorrencias").select("*").ilike("tipo", "%perda%"),
    sb()
      .from("ocorrencias")
      .select("*")
      .ilike("tipo", "%perda%")
      .gte("data_registro", `${fmtDate(d7Start)}T00:00:00`)
      .lte("data_registro", `${range.end}T23:59:59.999`),
  ]);

  const running = {
    acc: aggregatePerdas((accRows ?? []) as Ocorrencia[]),
    d7: aggregatePerdas((d7Rows ?? []) as Ocorrencia[]),
  };

  const md = perdasMarkdown(`${range.start} → ${range.end}`, agg, running);

  const cfg = await getTelegramConfig();
  if (cfg.perdas_chat_id) {
    await sendTelegramText(cfg.perdas_chat_id, md, cfg.perdas_thread_id);
  }

  return { ok: true };
}

// ── Serve ───────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { action, ...rest } = await req.json();

    switch (action) {
      case "guard-diario":
        return json(await guardDiario());
      case "guard-manual":
        return json(await guardManual(rest));
      case "guard-semanal":
        return json(await guardSemanal());
      case "perdas-diario":
        return json(await perdasDiario());
      case "perdas-semanal":
        return json(await perdasSemanal());
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
