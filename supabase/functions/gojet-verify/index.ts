// ============================================================================
// JET OS — Edge Function: gojet-verify
// Cron (5min): verifica pós-entrega se bikes foram depositadas no parking.
// Dual mode: GoJet API (bikes count) ou foto+GPS (fallback).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOJET_BASE = "https://logistic.gojet.app/api/v0";
const TELEGRAM_BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_ADMIN_CHAT = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "";

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

const sb = () => createClient(SUPABASE_URL, SERVICE);

async function gojetGet(path: string): Promise<any> {
  const res = await fetch(`${GOJET_BASE}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "JetOS/1.0" },
  });
  if (!res.ok) throw new Error(`GoJet ${path}: HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`GoJet ${path}: invalid JSON`); }
}

async function telegramAlert(msg: string) {
  if (!TELEGRAM_BOT || !TELEGRAM_ADMIN_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text: msg, parse_mode: "HTML" }),
  }).catch(() => {});
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = sb();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Get pending verifications (created > 5min ago)
    const { data: pending } = await admin
      .from("gojet_verify_queue")
      .select("*")
      .eq("status", "pendente")
      .lt("criado_em", fiveMinAgo)
      .order("criado_em");

    if (!pending || pending.length === 0) {
      return json({ ok: true, processed: 0, msg: "No pending verifications" });
    }

    let verified = 0;
    let failed = 0;
    let retried = 0;

    for (const item of pending) {
      try {
        // Try GoJet API first
        let bikesNow: number | null = null;
        try {
          const parkings = await gojetGet(`/urent/parkings?id=${item.parking_id}`);
          if (Array.isArray(parkings) && parkings.length > 0) {
            bikesNow = parkings[0].available_bikes_count ?? parkings[0].bikes_count ?? null;
          }
        } catch {
          // GoJet API unavailable — try snapshot fallback
          const { data: snap } = await admin
            .from("gojet_snapshots")
            .select("bikes_count")
            .eq("parking_id", item.parking_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          bikesNow = snap?.bikes_count ?? null;
        }

        if (bikesNow !== null) {
          await admin.from("gojet_verify_queue").update({
            bikes_count_after: bikesNow,
          }).eq("id", item.id);
        }

        const improved = bikesNow !== null &&
          item.bikes_count_before !== null &&
          bikesNow > item.bikes_count_before;

        if (improved) {
          // Success
          await admin.from("gojet_verify_queue").update({
            status: "ok",
            verificado_em: new Date().toISOString(),
          }).eq("id", item.id);

          if (item.tarefa_id) {
            await admin.from("tarefas_logistica").update({
              gojet_verified: true,
              gojet_verified_at: new Date().toISOString(),
            }).eq("id", item.tarefa_id);
          }

          verified++;
        } else if (item.tentativas >= item.max_tentativas - 1) {
          // Max retries — fail
          await admin.from("gojet_verify_queue").update({
            status: "fail",
            tentativas: item.tentativas + 1,
            verificado_em: new Date().toISOString(),
          }).eq("id", item.id);

          if (item.tarefa_id) {
            await admin.from("tarefas_logistica").update({
              gojet_verified: false,
              gojet_verified_at: new Date().toISOString(),
              verificacao_tentativas: item.tentativas + 1,
            }).eq("id", item.tarefa_id);
          }

          await telegramAlert(
            `❌ <b>Verificação falhou:</b> Parking <code>${item.parking_id}</code>\nBikes antes: ${item.bikes_count_before ?? '?'}, depois: ${bikesNow ?? '?'}\nTentativas: ${item.tentativas + 1}/${item.max_tentativas}\nTarefa: ${item.tarefa_id ?? 'N/A'}`
          );

          failed++;
        } else {
          // Retry
          await admin.from("gojet_verify_queue").update({
            tentativas: item.tentativas + 1,
          }).eq("id", item.id);
          retried++;
        }
      } catch (e: any) {
        console.error(`gojet-verify item ${item.id} error:`, e.message);
        // Don't fail the whole batch
        await admin.from("gojet_verify_queue").update({
          tentativas: item.tentativas + 1,
        }).eq("id", item.id);
        retried++;
      }
    }

    // Audit
    await admin.from("audit_log").insert({
      entidade: "sistema",
      entidade_id: "gojet-verify",
      acao: "verificar",
      dados: { total: pending.length, verified, failed, retried },
    });

    return json({ ok: true, processed: pending.length, verified, failed, retried });
  } catch (e: any) {
    console.error("gojet-verify error:", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
