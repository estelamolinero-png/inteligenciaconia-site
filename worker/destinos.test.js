// Tests del Worker de inteligenciaconia (node --test, sin dependencias).
// Ejecutar desde la raíz del repo:  node --test worker/destinos.test.js
//
// Lo que de verdad protegen: que un fallo del proveedor de IA deje rastro.
// El visitante solo ve "vuelve a intentarlo en unos segundos", así que si el
// error no se registra, una caída del proveedor es indistinguible de que
// nadie use el organizador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './destinos.js';

const ENV = { TRAVELPAYOUTS_TOKEN: 'token-de-prueba', OPENROUTER_API_KEY: 'clave-de-prueba' };
const CTX = { waitUntil: () => {} };

const VUELOS = {
  BCN: { price: 128, departure_at: '2026-09-15T06:00:00Z', return_at: '2026-09-22T20:00:00Z' },
  LIS: { price: 96, departure_at: '2026-09-10T07:00:00Z', return_at: '2026-09-17T19:00:00Z' },
  MXP: { price: 154, departure_at: '2026-09-05T08:00:00Z', return_at: '2026-09-12T21:00:00Z' },
  DUB: { price: 180, departure_at: '2026-09-08T09:00:00Z', return_at: '2026-09-15T18:00:00Z' },
  CDG: { price: 205, departure_at: '2026-09-19T10:00:00Z', return_at: '2026-09-26T17:00:00Z' },
};

const PLAN = {
  recomendaciones: [{
    codigo: 'LIS', ciudad: 'Lisboa', precio: 96,
    fecha_ida: '2026-09-10', fecha_vuelta: '2026-09-17',
    motivo: 'Sol y marisco sin salir de la península.',
    plan: ['Pasear por Alfama', 'Comer pastéis de nata', 'Atardecer en el mirador'],
  }],
  consejo: 'Reserva entre semana, sale más barato.',
};

function peticion() {
  return new Request('https://api.inteligenciaconia.com/organiza', {
    method: 'POST',
    headers: { Origin: 'https://inteligenciaconia.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ origen: 'SDR', mes: '2026-09', texto: 'playa y buena comida' }),
  });
}

// Falsea la red (vuelos + IA) y captura lo que se registre por consola.
function conEntornoFalso({ iaFalla = false } = {}) {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const registrado = [];
  console.error = (...args) => registrado.push(args.map(String).join(' '));
  globalThis.fetch = (url) => {
    if (String(url).includes('travelpayouts')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: VUELOS }) });
    }
    if (iaFalla) return Promise.resolve({ ok: false, status: 503 });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(PLAN) } }] }),
    });
  };
  return {
    registrado,
    restaurar: () => { globalThis.fetch = originalFetch; console.error = originalError; },
  };
}

test('un fallo del proveedor de IA queda registrado', async () => {
  const entorno = conEntornoFalso({ iaFalla: true });
  try {
    await worker.fetch(peticion(), ENV, CTX);
    assert.ok(
      entorno.registrado.length > 0,
      'el fallo de la IA se descartó sin dejar rastro en la consola del Worker'
    );
    assert.match(entorno.registrado.join(' '), /503/);
  } finally {
    entorno.restaurar();
  }
});

test('un fallo del proveedor de IA sigue avisando al visitante con un 502', async () => {
  const entorno = conEntornoFalso({ iaFalla: true });
  try {
    const resp = await worker.fetch(peticion(), ENV, CTX);
    assert.equal(resp.status, 502);
  } finally {
    entorno.restaurar();
  }
});

test('cuando la IA responde bien, el plan sale y no se registra ningún error', async () => {
  const entorno = conEntornoFalso();
  try {
    const resp = await worker.fetch(peticion(), ENV, CTX);
    assert.equal(resp.status, 200);
    const cuerpo = await resp.json();
    assert.equal(cuerpo.recomendaciones[0].codigo, 'LIS');
    assert.equal(cuerpo.recomendaciones[0].precio, 96);
    assert.deepEqual(entorno.registrado, []);
  } finally {
    entorno.restaurar();
  }
});

// ── /destinos: cada combinación nueva de origen y mes se salta la caché y
// gasta hasta cinco llamadas con el token, así que solo se aceptan las que
// puede pedir la web: un código IATA y un mes de los que ofrece el front.

function mesDesde(desplazamiento) {
  const hoy = new Date();
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + desplazamiento, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function peticionDestinos(consulta, origin = 'https://inteligenciaconia.com') {
  return new Request(`https://api.inteligenciaconia.com/destinos?${consulta}`, { headers: { Origin: origin } });
}

// Falsea la caché del edge y la red; cuenta las llamadas a Travelpayouts.
function conCacheYRedFalsas() {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const llamadas = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = (url) => {
    llamadas.push(String(url));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: VUELOS }) });
  };
  return {
    llamadas,
    restaurar: () => { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; },
  };
}

test('/destinos acepta un código IATA y los meses que ofrece el explorador', async () => {
  const red = conCacheYRedFalsas();
  try {
    for (const mes of [mesDesde(0), mesDesde(7)]) {
      const resp = await worker.fetch(peticionDestinos(`origin=VLC&month=${mes}`), ENV, CTX);
      assert.equal(resp.status, 200, `mes ${mes}`);
    }
  } finally {
    red.restaurar();
  }
});

test('/destinos rechaza un origen que no es un código IATA sin llamar a Travelpayouts', async () => {
  const red = conCacheYRedFalsas();
  try {
    for (const origen of ['MADRID', 'X1Y', 'SD', '%20SDR']) {
      const resp = await worker.fetch(peticionDestinos(`origin=${origen}&month=${mesDesde(0)}`), ENV, CTX);
      assert.equal(resp.status, 400, `origen ${origen}`);
    }
    assert.equal(red.llamadas.length, 0);
  } finally {
    red.restaurar();
  }
});

test('/destinos rechaza meses fuera de la ventana del explorador sin llamar a Travelpayouts', async () => {
  const red = conCacheYRedFalsas();
  try {
    for (const mes of [mesDesde(-3), mesDesde(12), '2099-01', '2026-13']) {
      const resp = await worker.fetch(peticionDestinos(`origin=SDR&month=${mes}`), ENV, CTX);
      assert.equal(resp.status, 400, `mes ${mes}`);
    }
    assert.equal(red.llamadas.length, 0);
  } finally {
    red.restaurar();
  }
});

test('el CORS solo autoriza a la web propia, no a cualquier origen', async () => {
  const red = conCacheYRedFalsas();
  try {
    const propia = await worker.fetch(peticionDestinos(`origin=SDR&month=${mesDesde(0)}`), ENV, CTX);
    assert.equal(propia.headers.get('Access-Control-Allow-Origin'), 'https://inteligenciaconia.com');

    const www = await worker.fetch(peticionDestinos(`origin=SDR&month=${mesDesde(0)}`, 'https://www.inteligenciaconia.com'), ENV, CTX);
    assert.equal(www.headers.get('Access-Control-Allow-Origin'), 'https://www.inteligenciaconia.com');

    const ajena = await worker.fetch(peticionDestinos(`origin=SDR&month=${mesDesde(0)}`, 'https://ajena.example'), ENV, CTX);
    assert.notEqual(ajena.headers.get('Access-Control-Allow-Origin'), '*');
    assert.notEqual(ajena.headers.get('Access-Control-Allow-Origin'), 'https://ajena.example');
  } finally {
    red.restaurar();
  }
});
