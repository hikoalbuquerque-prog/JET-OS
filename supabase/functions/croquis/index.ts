import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OAUTH_CLIENT_ID = Deno.env.get("OAUTH_CLIENT_ID")!;
const OAUTH_CLIENT_SECRET = Deno.env.get("OAUTH_CLIENT_SECRET")!;
const OAUTH_REFRESH_TOKEN = Deno.env.get("OAUTH_REFRESH_TOKEN")!;

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

// ---------------------------------------------------------------------------
// Google OAuth2 access token via refresh token
// ---------------------------------------------------------------------------
async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`OAuth token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// Helper: Google API request
// ---------------------------------------------------------------------------
async function gapi(token: string, url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  return res;
}

// ---------------------------------------------------------------------------
// Core: gerar croqui para uma estação
// ---------------------------------------------------------------------------
async function gerarCroqui(estacaoId: string) {
  const supabase = sb();

  // 1. Read station
  let { data: estacao, error } = await supabase
    .from("estacoes")
    .select("*")
    .or(`firebase_doc_id.eq.${estacaoId},codigo.eq.${estacaoId}`)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar estação: ${error.message}`);
  if (!estacao) throw new Error(`Estação não encontrada: ${estacaoId}`);

  const token = await getAccessToken();

  // 2. Find template in Google Drive
  const searchUrl =
    `https://www.googleapis.com/drive/v3/files?q=name%3D'JET_CROQUI_TEMPLATE'+and+mimeType%3D'application%2Fvnd.google-apps.presentation'&fields=files(id,name)`;
  const searchRes = await gapi(token, searchUrl);
  const searchData = await searchRes.json();
  if (!searchData.files?.length) throw new Error("Template JET_CROQUI_TEMPLATE não encontrado no Drive");
  const templateId = searchData.files[0].id;

  // 3. Copy template
  const copyRes = await gapi(token, `https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name: `Croqui_${estacao.codigo}` }),
  });
  if (!copyRes.ok) throw new Error(`Erro ao copiar template: ${copyRes.status}`);
  const copyData = await copyRes.json();
  const copyId = copyData.id as string;

  try {
    // 4. Get presentation to inspect (optional, ensures it exists)
    const presRes = await gapi(token, `https://slides.googleapis.com/v1/presentations/${copyId}`);
    if (!presRes.ok) throw new Error(`Erro ao obter apresentação: ${presRes.status}`);

    // 5. Build batchUpdate requests
    const replacements: Record<string, string> = {
      "{{CODIGO}}": estacao.codigo ?? "",
      "{{CIDADE}}": estacao.cidade ?? "",
      "{{BAIRRO}}": estacao.bairro ?? "",
      "{{ENDERECO}}": estacao.endereco ?? "",
      "{{TIPO}}": estacao.tipo ?? "",
      "{{LARGURA}}": String(estacao.largura ?? ""),
      "{{DIMENSOES}}": estacao.dimensoes ?? "",
      "{{STATUS}}": estacao.status ?? "",
      "{{DATA}}": estacao.created_at
        ? new Date(estacao.created_at).toLocaleDateString("pt-BR")
        : new Date().toLocaleDateString("pt-BR"),
      "{{LATITUDE}}": String(estacao.latitude ?? ""),
      "{{LONGITUDE}}": String(estacao.longitude ?? ""),
    };

    const requests: unknown[] = [];

    // Text replacements
    for (const [placeholder, value] of Object.entries(replacements)) {
      requests.push({
        replaceAllText: {
          containsText: { text: placeholder, matchCase: true },
          replaceText: value,
        },
      });
    }

    // Image replacements
    const imagens = estacao.imagens ?? {};
    const imageMap: Record<string, string> = {
      "{{FOTO}}": imagens.foto,
      "{{SATELITE}}": imagens.satelite,
      "{{MAPA}}": imagens.mapa,
    };
    for (const [placeholder, url] of Object.entries(imageMap)) {
      if (url) {
        requests.push({
          replaceAllShapesWithImage: {
            imageUrl: url,
            imageReplaceMethod: "CENTER_INSIDE",
            containsText: { text: placeholder, matchCase: true },
          },
        });
      }
    }

    // 6. Execute batchUpdate
    if (requests.length > 0) {
      const batchRes = await gapi(
        token,
        `https://slides.googleapis.com/v1/presentations/${copyId}:batchUpdate`,
        { method: "POST", body: JSON.stringify({ requests }) },
      );
      if (!batchRes.ok) {
        const errText = await batchRes.text();
        throw new Error(`Erro no batchUpdate: ${batchRes.status} ${errText}`);
      }
    }

    // 7. Export as PDF
    const pdfRes = await gapi(
      token,
      `https://www.googleapis.com/drive/v3/files/${copyId}/export?mimeType=application/pdf`,
    );
    if (!pdfRes.ok) throw new Error(`Erro ao exportar PDF: ${pdfRes.status}`);
    const pdfBuffer = new Uint8Array(await pdfRes.arrayBuffer());

    // 8. Upload PDF to Supabase Storage
    const storagePath = `croquis/${estacao.codigo}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("uploads")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Erro ao fazer upload do PDF: ${uploadErr.message}`);

    // 9. Get public URL
    const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(storagePath);
    const pdfUrl = urlData.publicUrl;

    // 10. Update estação
    const { error: updateErr } = await supabase
      .from("estacoes")
      .update({
        imagens_croqui: pdfUrl,
        croqui_status: "OK",
        croqui_gerado_em: new Date().toISOString(),
      })
      .eq("id", estacao.id);
    if (updateErr) throw new Error(`Erro ao atualizar estação: ${updateErr.message}`);

    // 11. Delete the Google Drive copy
    await gapi(token, `https://www.googleapis.com/drive/v3/files/${copyId}`, { method: "DELETE" });

    return { ok: true, pdfUrl, pdfId: copyId };
  } catch (err) {
    // Clean up Drive copy on error
    try {
      await gapi(token, `https://www.googleapis.com/drive/v3/files/${copyId}`, { method: "DELETE" });
    } catch (_) { /* ignore cleanup error */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const { action } = body;

    // ---- gerar ----
    if (action === "gerar") {
      const { estacaoId } = body;
      if (!estacaoId) return json({ error: "estacaoId obrigatório" }, 400);
      const result = await gerarCroqui(estacaoId);
      return json(result);
    }

    // ---- gerar-lote ----
    if (action === "gerar-lote") {
      const { cidade, pais, loteSize = 10 } = body;
      if (!cidade) return json({ error: "cidade obrigatória" }, 400);

      const supabase = sb();
      let query = supabase
        .from("estacoes")
        .select("firebase_doc_id, codigo")
        .eq("cidade", cidade)
        .or("croqui_status.is.null,croqui_status.in.(PENDENTE,ERRO)")
        .limit(loteSize);

      if (pais) query = query.eq("pais", pais);

      const { data: estacoes, error } = await query;
      if (error) return json({ error: error.message }, 500);
      if (!estacoes?.length) return json({ ok: true, processados: 0, erros: 0, restantes: 0, detalhes: [] });

      // Count remaining
      let countQuery = supabase
        .from("estacoes")
        .select("id", { count: "exact", head: true })
        .eq("cidade", cidade)
        .or("croqui_status.is.null,croqui_status.in.(PENDENTE,ERRO)");
      if (pais) countQuery = countQuery.eq("pais", pais);
      const { count: totalPendentes } = await countQuery;

      const detalhes: { codigo: string; status: string; url?: string; erro?: string }[] = [];
      let processados = 0;
      let erros = 0;

      for (const est of estacoes) {
        const id = est.firebase_doc_id || est.codigo;
        try {
          const result = await gerarCroqui(id);
          detalhes.push({ codigo: est.codigo, status: "OK", url: result.pdfUrl });
          processados++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          detalhes.push({ codigo: est.codigo, status: "ERRO", erro: msg });
          erros++;
          // Mark error in DB
          await supabase
            .from("estacoes")
            .update({ croqui_status: "ERRO" })
            .or(`firebase_doc_id.eq.${id},codigo.eq.${id}`);
        }
      }

      const restantes = Math.max(0, (totalPendentes ?? 0) - estacoes.length);

      return json({ ok: true, processados, erros, restantes, detalhes });
    }

    return json({ error: `action desconhecida: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
