import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAPS_KEY = Deno.env.get("GMAPS_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_KEY")!;

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

function pointInPolygon(
  lat: number,
  lng: number,
  polygon: { lat: number; lng: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    if (
      (yi > lng) !== (yj > lng) &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

// ── Reverse geocode helper ──────────────────────────────────────────────
async function reverseGeocode(lat: number, lng: number) {
  const r = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GMAPS_KEY}&language=pt`,
  );
  const data = await r.json();
  if (!data.results?.length) return { cidade: "", bairro: "", endereco: "" };
  const comps = data.results[0].address_components as {
    long_name: string;
    types: string[];
  }[];
  const cidade =
    comps.find((c) => c.types.includes("administrative_area_level_2"))
      ?.long_name ||
    comps.find((c) => c.types.includes("locality"))?.long_name ||
    "";
  const bairro =
    comps.find((c) => c.types.includes("sublocality_level_1"))?.long_name || "";
  const endereco = data.results[0].formatted_address || "";
  return { cidade, bairro, endereco };
}

// ── Cidade prefix for codigo ────────────────────────────────────────────
function cidadePrefix(cidade: string): string {
  return cidade
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .substring(0, 3)
    .toUpperCase();
}

// ── Action: add ─────────────────────────────────────────────────────────
async function handleAdd(body: Record<string, unknown>) {
  const { lat, lng, tipo, pais, larguraFaixa, dimensoes, status, calcadaIA, subprefeitura } = body as {
    lat: number;
    lng: number;
    tipo?: string;
    pais?: string;
    larguraFaixa?: number;
    dimensoes?: string;
    status?: string;
    calcadaIA?: unknown;
    subprefeitura?: string;
    cidade?: string;
    bairro?: string;
    endereco?: string;
  };

  let cidade = body.cidade as string | undefined;
  let bairro = body.bairro as string | undefined;
  let endereco = body.endereco as string | undefined;

  if (!cidade) {
    const geo = await reverseGeocode(lat, lng);
    cidade = geo.cidade;
    bairro = bairro || geo.bairro;
    endereco = endereco || geo.endereco;
  }

  const paisCode = (pais || "BR").toUpperCase();
  const prefix = cidadePrefix(cidade || "UNK");

  // Next sequence for this cidade
  const client = sb();
  const { count } = await client
    .from("estacoes")
    .select("id", { count: "exact", head: true })
    .eq("cidade", cidade);
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const codigo = `${paisCode}${prefix}${seq}`;

  const now = new Date().toISOString();
  const row = {
    codigo,
    pais: paisCode,
    cidade: cidade || null,
    bairro: bairro || null,
    subprefeitura: subprefeitura || null,
    endereco: endereco || null,
    lat,
    lng,
    tipo: tipo || "PUBLICA",
    status: status || "ATIVO",
    largura_faixa: larguraFaixa ?? null,
    dimensoes: dimensoes || null,
    croqui_status: "PENDENTE",
    croqui_tentativas: 0,
    origem: "PWA_CAMPO",
    criado_em: now,
    atualizado_em: now,
  };

  const { data, error } = await client.from("estacoes").insert(row).select().single();
  if (error) return json({ ok: false, error: error.message }, 400);

  return json({
    ok: true,
    estacao: {
      codigo,
      cidade,
      bairro,
      lat,
      lng,
      endereco,
      tipo: row.tipo,
      pais: paisCode,
    },
  });
}

// ── Action: analisar-calcada ────────────────────────────────────────────
async function handleAnalisarCalcada(body: Record<string, unknown>) {
  const { lat, lng, codigo } = body as {
    lat: number;
    lng: number;
    codigo?: string;
  };

  // Fetch 3 street view images at different headings
  const headings = [45, 180, 315];
  const images: { base64: string; mimeType: string }[] = [];

  for (const heading of headings) {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&heading=${heading}&source=outdoor&key=${GMAPS_KEY}`,
    );
    const buf = await r.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    images.push({ base64, mimeType: "image/jpeg" });
  }

  // Call Gemini
  const geminiBody = {
    systemInstruction: {
      parts: [
        {
          text: `Voce e um analista de infraestrutura urbana especializado em micromobilidade. Analise as imagens de Street View para avaliar se a calcada/local e adequado para instalacao de uma estacao de bicicletas/patinetes compartilhados. Considere: largura da calcada (minimo 2m livre para pedestres), obstrucoes, inclinacao, fluxo de pedestres, proximidade de pontos de interesse. Responda SOMENTE com JSON valido (sem markdown): { "aprovado": boolean, "larguraEstimada": "Xm", "observacoes": "texto", "confianca": "alta"|"media"|"baixa", "score": 0-40, "motivoCodigo": "CALCADA_OK"|"SEM_CALCADA"|"CALCADA_ESTREITA"|"ESTACIONAMENTO"|"OBSTRUCAO"|"DECLIVE"|"AREA_COMERCIAL"|"SEM_IMAGEM" }`,
        },
      ],
    },
    contents: [
      {
        parts: [
          ...images.map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.base64 },
          })),
          {
            text: `Analise estas 3 imagens do Google Street View (angulos 45, 180, 315 graus) do ponto ${lat},${lng}. Avalie a viabilidade da calcada para instalacao de estacao de micromobilidade.`,
          },
        ],
      },
    ],
  };

  const geminiResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    },
  );
  const geminiData = await geminiResp.json();

  // Parse Gemini response
  let resultado: Record<string, unknown>;
  try {
    const text =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    // Extract JSON from possible markdown fences
    const match = text.match(/\{[\s\S]*\}/);
    resultado = JSON.parse(match ? match[0] : text);
  } catch {
    resultado = {
      aprovado: false,
      larguraEstimada: "N/A",
      observacoes: "Falha ao interpretar resposta da IA",
      confianca: "baixa",
      score: 0,
      motivoCodigo: "SEM_IMAGEM",
    };
  }

  // Update estacao if codigo provided
  if (codigo) {
    const client = sb();
    await client
      .from("estacoes")
      .update({
        ia_largura: resultado.larguraEstimada,
        ia_score: resultado.score,
        ia_aprovado: resultado.aprovado,
        ia_confianca: resultado.confianca,
        ia_motivo: resultado.motivoCodigo,
        ia_analisado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      .eq("codigo", codigo);
  }

  return json({
    ok: true,
    resultado: {
      ...resultado,
      imagensAnalisadas: 3,
    },
  });
}

// ── Action: geocode-forward ─────────────────────────────────────────────
async function handleGeocodeForward(body: Record<string, unknown>) {
  const { endereco, pais } = body as { endereco: string; pais?: string };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(endereco)}&key=${GMAPS_KEY}&language=pt${pais ? "&components=country:" + pais : ""}`;
  const r = await fetch(url);
  const data = await r.json();
  return json({ ok: true, results: data.results });
}

// ── Action: update-position ─────────────────────────────────────────────
async function handleUpdatePosition(body: Record<string, unknown>) {
  const { uid, latitude, longitude, slotId } = body as {
    uid: string;
    latitude: number;
    longitude: number;
    slotId: string;
  };

  const client = sb();

  // Read slot polygon
  const { data: slot, error: slotErr } = await client
    .from("slots")
    .select("poligono")
    .eq("id", slotId)
    .single();

  if (slotErr || !slot) return json({ success: false, error: "Slot nao encontrado" }, 404);

  const polygon = (slot.poligono as { lat: number; lng: number }[]) || [];
  const dentroDaZona = polygon.length >= 3
    ? pointInPolygon(latitude, longitude, polygon)
    : false;

  const now = new Date().toISOString();

  // Check previous state
  const { data: prev } = await client
    .from("slots_prestadores")
    .select("dentro_da_zona")
    .eq("slot_id", slotId)
    .eq("uid", uid)
    .maybeSingle();

  const mudouEstado = prev ? prev.dentro_da_zona !== dentroDaZona : true;

  const upsertRow: Record<string, unknown> = {
    slot_id: slotId,
    uid,
    lat: latitude,
    lng: longitude,
    timestamp: now,
    dentro_da_zona: dentroDaZona,
  };
  if (mudouEstado) upsertRow.mudou_estado_em = now;

  await client
    .from("slots_prestadores")
    .upsert(upsertRow, { onConflict: "slot_id,uid" });

  return json({ success: true, dentroDaZona });
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "add":
        return await handleAdd(body);
      case "analisar-calcada":
        return await handleAnalisarCalcada(body);
      case "geocode-forward":
        return await handleGeocodeForward(body);
      case "update-position":
        return await handleUpdatePosition(body);
      default:
        return json({ ok: false, error: `Acao desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
