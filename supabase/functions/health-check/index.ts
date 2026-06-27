const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((_req) => {
  if (_req.method === "OPTIONS") return new Response(null, { headers: cors });

  return new Response(
    JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
    {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    },
  );
});
