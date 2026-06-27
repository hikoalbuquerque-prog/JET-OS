// api/gojet.js — Vercel Serverless Function
// Proxy para https://logistic.gojet.app/api/v0/urent
// Deploy: vercel --prod (plano grátis)
//
// Uso: GET /api/gojet?path=parkings&city_id=...&page=1&limit=1000

export default async function handler(req, res) {
  const { path, ...params } = req.query;

  if (!path) {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  const qs = new URLSearchParams(params).toString();
  const url = `https://logistic.gojet.app/api/v0/urent/${path}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': 'https://map.gojet.app',
        'Referer': 'https://map.gojet.app/',
        'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
