// Cloudflare Worker: proxy hacia la Data API de Travelpayouts.
// Mantiene el token secreto en el servidor (env.TRAVELPAYOUTS_TOKEN) y expone
// GET /destinos?origin=SDR&month=YYYY-MM -> precio mas barato por destino en ese mes.
//
// Despliegue: pegar este archivo tal cual en el editor de un Worker en el
// dashboard de Cloudflare (Workers & Pages -> Create application -> plantilla
// "Hello World" -> Edit code). Configurar el secreto TRAVELPAYOUTS_TOKEN en
// Settings > Variables and Secrets (tipo "Secret", no "Text").

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
};

function cheapestOffer(entry) {
  if (entry && typeof entry === 'object' && 'price' in entry) return entry;
  if (entry && typeof entry === 'object') {
    const offers = Object.values(entry).filter((v) => v && typeof v === 'object' && 'price' in v);
    if (offers.length) return offers.reduce((a, b) => (a.price < b.price ? a : b));
  }
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const origin = (url.searchParams.get('origin') || 'SDR').toUpperCase();
    const month = url.searchParams.get('month') || '';

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return new Response(
        JSON.stringify({ error: 'Parametro "month" invalido (usa formato YYYY-MM).' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const allDeals = {};
    const MAX_PAGES = 5; // hasta 500 destinos; de sobra para SDR/BIO

    for (let page = 1; page <= MAX_PAGES; page++) {
      const apiUrl =
        `https://api.travelpayouts.com/v1/prices/cheap` +
        `?origin=${encodeURIComponent(origin)}&destination=-&depart_date=${month}` +
        `&currency=eur&page=${page}`;

      let resp;
      try {
        resp = await fetch(apiUrl, { headers: { 'x-access-token': env.TRAVELPAYOUTS_TOKEN } });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: `No se pudo contactar con Travelpayouts: ${err.message}` }),
          { status: 502, headers: CORS_HEADERS }
        );
      }

      if (!resp.ok) {
        return new Response(
          JSON.stringify({ error: `Travelpayouts respondio con error ${resp.status}` }),
          { status: 502, headers: CORS_HEADERS }
        );
      }

      const payload = await resp.json();
      const data = payload.data || {};
      const keys = Object.keys(data);
      if (keys.length === 0) break;

      for (const dest of keys) {
        const offer = cheapestOffer(data[dest]);
        if (offer) allDeals[dest] = offer;
      }

      if (keys.length < 100) break; // ultima pagina
    }

    const results = Object.entries(allDeals)
      .map(([destination, offer]) => ({ destination, ...offer }))
      .sort((a, b) => a.price - b.price);

    return new Response(JSON.stringify({ origin, month, results }), { headers: CORS_HEADERS });
  },
};
