// Carga los precios en vivo de la ciudad indicada en data-origin y pinta las
// tarjetas con deep-link al buscador (busqueda ya pre-rellenada con ruta y fecha).
(function () {
  const ORIGIN = document.currentScript.dataset.origin;
  const WORKER_URL = 'https://api.inteligenciaconia.com/destinos';
  const AIRPORTS_CACHE_KEY = 'airports_cache_v2';
  const AIRPORTS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  async function getAirportNames() {
    try {
      const cached = JSON.parse(localStorage.getItem(AIRPORTS_CACHE_KEY) || 'null');
      if (cached && Array.isArray(cached.airports) && Date.now() - cached.t < AIRPORTS_CACHE_MAX_AGE_MS) {
        const names = {};
        for (const a of cached.airports) names[a.code] = a.name;
        return names;
      }
    } catch (e) { /* cache invalida */ }
    try {
      const r = await fetch('https://api.travelpayouts.com/data/en/airports.json');
      const raw = await r.json();
      const airports = raw.filter((a) => a.code && a.flightable).map((a) => ({ code: a.code, name: a.name || a.code }));
      localStorage.setItem(AIRPORTS_CACHE_KEY, JSON.stringify({ t: Date.now(), airports }));
      const names = {};
      for (const a of airports) names[a.code] = a.name;
      return names;
    } catch (e) {
      return {};
    }
  }

  function mesActual() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  }

  function deepLink(origin, dest, departureAt) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(departureAt || '');
    if (!m) return 'https://vuelos.inteligenciaconia.com';
    return `https://vuelos.inteligenciaconia.com/flights/${origin}${m[2]}${m[1]}${dest}1`;
  }

  async function cargar() {
    const estadoDiv = document.getElementById('vivo-estado');
    const resultadosDiv = document.getElementById('vivo-resultados');
    try {
      const [names, payload] = await Promise.all([
        getAirportNames(),
        fetch(`${WORKER_URL}?origin=${ORIGIN}&month=${mesActual()}`).then((r) => r.json()),
      ]);
      const resultados = (payload.results || []).slice(0, 6);
      if (resultados.length === 0) {
        estadoDiv.textContent = 'No se encontraron vuelos para este mes. Prueba a explorar otros meses.';
        return;
      }
      estadoDiv.textContent = 'Más baratos encontrados este mes:';
      for (const r of resultados) {
        const a = document.createElement('a');
        a.className = 'destino';
        a.href = deepLink(ORIGIN, r.destination, r.departure_at);
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `<div class="ciudad">${names[r.destination] || r.destination}</div><div class="precio">${Math.round(r.price)} €</div>`;
        resultadosDiv.appendChild(a);
      }
    } catch (err) {
      estadoDiv.textContent = 'No se pudieron cargar los precios en directo ahora mismo.';
    }
  }

  cargar();
})();
