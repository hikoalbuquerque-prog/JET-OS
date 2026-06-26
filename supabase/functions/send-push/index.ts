// ============================================================================
// JET OS — Edge Function: send-push (Web Push VAPID)
// Envia notificação push para um ou mais usuários via Web Push API.
// Secrets necessários: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Body: { user_ids: string[], title: string, body: string, url?: string, tag?: string }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:h.albuquerque@jetshr.com.br";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function importCryptoKey(raw: string, usage: "sign" | "verify") {
  const jwk = raw.startsWith("{") ? JSON.parse(raw) : null;
  if (jwk) {
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [usage]);
  }
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", bin,
    { name: "ECDSA", namedCurve: "P-256" }, false, [usage]
  );
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function buildVapidAuth(endpoint: string): Promise<{ authorization: string; cryptoKey: string }> {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ aud, exp, sub: VAPID_SUBJECT })));
  const key = await importCryptoKey(VAPID_PRIVATE, "sign");
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const token = `${header}.${payload}.${base64url(sig)}`;
  return {
    authorization: `vapid t=${token}, k=${VAPID_PUBLIC}`,
    cryptoKey: `p256ecdsa=${VAPID_PUBLIC}`,
  };
}

async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<boolean> {
  try {
    const vapid = await buildVapidAuth(sub.endpoint);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        ...vapid,
        "Content-Type": "application/octet-stream",
        TTL: "86400",
      },
      body: new TextEncoder().encode(payload),
    });
    return res.ok || res.status === 201;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "VAPID keys not configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const { user_ids, title, body: msgBody, url, tag } = body;
  if (!user_ids?.length || !title) return json({ error: "user_ids and title required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("uid", user_ids);

  if (!subs?.length) return json({ ok: true, sent: 0, reason: "no subscriptions" });

  const payload = JSON.stringify({ title, body: msgBody || "", url: url || "/", tag: tag || "jet-notif" });
  const results = await Promise.allSettled(subs.map((s) => sendOne(s, payload)));
  const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;

  return json({ ok: true, sent, total: subs.length });
});
