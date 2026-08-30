// Cloudflare Worker: proxy hacia la Data API de Travelpayouts + organizador IA.
//
// Rutas:
//   GET  /destinos?origin=SDR&month=YYYY-MM  -> precio mas barato por destino en ese mes
//   POST /organiza  {origen, mes, texto}     -> recomendaciones de viaje con IA
//
// Despliegue: pegar este archivo tal cual en el editor del Worker en el
// dashboard de Cloudflare. Secretos en Settings > Variables and Secrets:
//   TRAVELPAYOUTS_TOKEN (tipo "Secret")  -> obligatorio
//   OPENROUTER_API_KEY  (tipo "Secret")  -> para /organiza (modelo gratuito)
//   OPENROUTER_MODEL    (tipo "Text")    -> opcional; por defecto openai/gpt-oss-20b:free
//   ANTHROPIC_API_KEY   (tipo "Secret")  -> alternativa a OpenRouter (Claude, de pago)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

async function obtenerDestinos(origin, month, env) {
  const allDeals = {};
  const MAX_PAGES = 5; // hasta 500 destinos; de sobra para SDR/BIO

  for (let page = 1; page <= MAX_PAGES; page++) {
    const apiUrl =
      `https://api.travelpayouts.com/v1/prices/cheap` +
      `?origin=${encodeURIComponent(origin)}&destination=-&depart_date=${month}` +
      `&currency=eur&page=${page}`;

    const resp = await fetch(apiUrl, { headers: { 'x-access-token': env.TRAVELPAYOUTS_TOKEN } });
    if (!resp.ok) throw new Error(`Travelpayouts respondio con error ${resp.status}`);

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

  return Object.entries(allDeals)
    .map(([destination, offer]) => ({ destination, ...offer }))
    .sort((a, b) => a.price - b.price);
}

async function manejarDestinos(url, env, ctx) {
  const origin = (url.searchParams.get('origin') || 'SDR').toUpperCase();
  const month = url.searchParams.get('month') || '';

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return new Response(
      JSON.stringify({ error: 'Parametro "month" invalido (usa formato YYYY-MM).' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Cache en el edge de Cloudflare: los datos de Travelpayouts se refrescan
  // como mucho cada pocas horas, y esto protege del rate limit (60 req/min)
  // si la pagina recibe un pico de trafico.
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.local/destinos?origin=${origin}&month=${month}`);
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;

  let results;
  try {
    results = await obtenerDestinos(origin, month, env);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `No se pudo consultar Travelpayouts: ${err.message}` }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const response = new Response(JSON.stringify({ origin, month, results }), {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=600, s-maxage=10800' },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

const ESQUEMA_PLAN = {
  type: 'object',
  properties: {
    recomendaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: 'string' },
          ciudad: { type: 'string' },
          precio: { type: 'number' },
          fecha_ida: { type: 'string' },
          fecha_vuelta: { type: 'string' },
          motivo: { type: 'string' },
          plan: { type: 'array', items: { type: 'string' } },
        },
        required: ['codigo', 'ciudad', 'precio', 'fecha_ida', 'fecha_vuelta', 'motivo', 'plan'],
        additionalProperties: false,
      },
    },
    consejo: { type: 'string' },
  },
  required: ['recomendaciones', 'consejo'],
  additionalProperties: false,
};

const NOMBRES_ORIGEN = { SDR: 'Santander', BIO: 'Bilbao', MAD: 'Madrid' };

function mesSiguiente(mes) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m, 1); // mes es 1-12; Date usa 0-11, asi que esto ya es el siguiente
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function llamarIA(prompt, env) {
  // OpenRouter con modelo gratuito por defecto; Anthropic como alternativa.
  if (env.OPENROUTER_API_KEY) {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://inteligenciaconia.com',
        'X-Title': 'inteligenciaconia',
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free',
        max_tokens: 1400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`el servicio de IA respondio ${resp.status}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-haiku-4-5',
      max_tokens: 1400,
      output_config: { format: { type: 'json_schema', schema: ESQUEMA_PLAN } },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`el servicio de IA respondio ${resp.status}`);
  const mensaje = await resp.json();
  const bloque = (mensaje.content || []).find((b) => b.type === 'text');
  return bloque ? bloque.text : '';
}

function extraerJSON(texto) {
  const limpio = String(texto).replace(/```json|```/g, '');
  const ini = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (ini === -1 || fin <= ini) throw new Error('respuesta sin JSON');
  return JSON.parse(limpio.slice(ini, fin + 1));
}

async function manejarOrganiza(request, env) {
  // Solo se acepta desde el propio sitio: el endpoint consume cuota de IA.
  const origenPeticion = request.headers.get('Origin') || '';
  const permitido =
    origenPeticion === 'https://inteligenciaconia.com' ||
    origenPeticion === 'https://www.inteligenciaconia.com' ||
    /^http:\/\/localhost(:\d+)?$/.test(origenPeticion) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origenPeticion);
  if (!permitido) {
    return new Response(JSON.stringify({ error: 'Origen no permitido.' }), { status: 403, headers: CORS_HEADERS });
  }

  if (!env.OPENROUTER_API_KEY && !env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'El organizador aun no esta activado: falta configurar OPENROUTER_API_KEY en el Worker.' }),
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Cuerpo JSON invalido.' }), { status: 400, headers: CORS_HEADERS });
  }

  const origen = String(cuerpo.origen || '').toUpperCase();
  const mes = String(cuerpo.mes || '');
  const texto = String(cuerpo.texto || '').trim().slice(0, 300);

  if (!NOMBRES_ORIGEN[origen] || !/^\d{4}-\d{2}$/.test(mes) || texto.length < 5) {
    return new Response(
      JSON.stringify({ error: 'Parametros invalidos: origen (SDR/BIO/MAD), mes (YYYY-MM) y texto (5-300 caracteres).' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Vuelos reales del mes pedido; si hay pocos, se completa con el siguiente.
  let vuelos;
  try {
    vuelos = await obtenerDestinos(origen, mes, env);
    if (vuelos.length < 5) {
      const extra = await obtenerDestinos(origen, mesSiguiente(mes), env);
      const vistos = new Set(vuelos.map((v) => v.destination));
      for (const v of extra) if (!vistos.has(v.destination)) vuelos.push(v);
      vuelos.sort((a, b) => a.price - b.price);
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `No se pudieron consultar los vuelos: ${err.message}` }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  if (vuelos.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No hay vuelos con precio para ese mes desde ese aeropuerto. Prueba otro mes.' }),
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const candidatos = vuelos.slice(0, 40);
  const listaVuelos = candidatos
    .map((v) => `${v.destination} ${Math.round(v.price)}€ ida ${String(v.departure_at).slice(0, 10)} vuelta ${String(v.return_at || '').slice(0, 10)}`)
    .join('\n');

  const prompt =
    `Eres el organizador de viajes de inteligenciaconia.com, un buscador de vuelos baratos del norte de España.\n` +
    `El viajero sale de ${NOMBRES_ORIGEN[origen]} y describe lo que busca asi: "${texto}".\n\n` +
    `Estos son los vuelos de ida y vuelta mas baratos disponibles ese mes (codigo IATA de destino, precio total, fechas):\n${listaVuelos}\n\n` +
    `Elige entre 1 y 3 destinos de ESA lista que mejor encajen con lo que busca. Reglas estrictas:\n` +
    `- Usa exactamente el codigo, precio y fechas que aparecen en la lista; no inventes vuelos ni cambies cifras.\n` +
    `- "ciudad": nombre de la ciudad en español (p. ej. BCN -> Barcelona).\n` +
    `- "motivo": 1-2 frases de por que encaja con su peticion.\n` +
    `- "plan": exactamente 3 ideas breves y concretas para ese destino (lugares, comida, ambiente), adaptadas a la peticion.\n` +
    `- "consejo": un consejo practico de reserva en una sola frase.\n` +
    `- Si nada encaja bien, elige lo mas cercano y dilo con honestidad en el motivo.\n\n` +
    `Responde UNICAMENTE con un objeto JSON valido, sin texto adicional ni markdown, con esta forma exacta:\n` +
    `{"recomendaciones":[{"codigo":"BCN","ciudad":"Barcelona","precio":128,"fecha_ida":"2026-09-15","fecha_vuelta":"2026-09-22","motivo":"...","plan":["...","...","..."]}],"consejo":"..."}`;

  // Los modelos gratuitos fallan a veces al devolver JSON: un reintento basta
  // casi siempre. El precio y las fechas se re-imponen luego desde los datos
  // reales, asi que el modelo solo puede elegir y redactar, no inventar cifras.
  let plan = null;
  for (let intento = 0; intento < 2 && !plan; intento++) {
    try {
      plan = extraerJSON(await llamarIA(prompt, env));
    } catch (err) {
      console.error(`/organiza intento ${intento + 1}: ${err.message}`);
      plan = null;
    }
  }
  if (!plan || !Array.isArray(plan.recomendaciones)) {
    return new Response(
      JSON.stringify({ error: 'La IA no ha podido montar el plan ahora mismo. Vuelve a intentarlo en unos segundos.' }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const porCodigo = {};
  for (const v of candidatos) porCodigo[v.destination] = v;
  const recomendaciones = plan.recomendaciones
    .filter((r) => r && porCodigo[String(r.codigo || '').toUpperCase()])
    .slice(0, 3)
    .map((r) => {
      const real = porCodigo[String(r.codigo).toUpperCase()];
      return {
        codigo: String(r.codigo).toUpperCase(),
        ciudad: String(r.ciudad || r.codigo),
        precio: Math.round(real.price),
        fecha_ida: String(real.departure_at).slice(0, 10),
        fecha_vuelta: String(real.return_at || '').slice(0, 10),
        motivo: String(r.motivo || ''),
        plan: Array.isArray(r.plan) ? r.plan.slice(0, 3).map(String) : [],
      };
    });

  if (recomendaciones.length === 0) {
    return new Response(
      JSON.stringify({ error: 'La IA no ha encontrado nada que encaje con vuelos reales. Prueba otro mes u otra descripcion.' }),
      { status: 404, headers: CORS_HEADERS }
    );
  }

  return new Response(
    JSON.stringify({ origen, mes, recomendaciones, consejo: String(plan.consejo || '') }),
    { headers: CORS_HEADERS }
  );
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname.endsWith('/organiza')) {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Usa POST.' }), { status: 405, headers: CORS_HEADERS });
      }
      return manejarOrganiza(request, env);
    }

    return manejarDestinos(url, env, ctx);
  },
};
