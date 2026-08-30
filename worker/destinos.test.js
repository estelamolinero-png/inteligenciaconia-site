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
