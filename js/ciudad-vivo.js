// Carga los precios en vivo de la ciudad indicada en data-origin y pinta las
// tarjetas con deep-link al buscador. Usa window.IC (aeropuertos.js).
(function () {
  const ORIGIN = document.currentScript.dataset.origin;
  const WORKER_URL = 'https://api.inteligenciaconia.com/destinos';

  function mes(desplazamiento) {
    const hoy = new Date();
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + (desplazamiento || 0), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function fechaCorta(iso) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[2]}/${m[1]}` : '';
  }

  async function cargar() {
    const estadoDiv = document.getElementById('vivo-estado');
    const resultadosDiv = document.getElementById('vivo-resultados');
    try {
      const [airports, payload] = await Promise.all([
        IC.getAirports(),
        fetch(`${WORKER_URL}?origin=${ORIGIN}&month=${mes(0)}`).then((r) => r.json()),
      ]);
      const porCodigo = {};
      for (const a of airports) porCodigo[a.code] = a;

      let resultados = payload.results || [];
      if (resultados.length < 5) {
        const siguiente = await fetch(`${WORKER_URL}?origin=${ORIGIN}&month=${mes(1)}`).then((r) => r.json());
        const vistos = new Set(resultados.map((x) => x.destination));
        for (const x of siguiente.results || []) {
          if (!vistos.has(x.destination)) resultados.push(x);
        }
        resultados.sort((a, b) => a.price - b.price);
      }
      resultados = resultados.slice(0, 6);
      if (resultados.length === 0) {
        estadoDiv.textContent = 'No se encontraron vuelos para este mes. Prueba a explorar otros meses.';
        return;
      }
      estadoDiv.textContent = 'Más baratos encontrados este mes:';
      for (const r of resultados) {
        const info = porCodigo[r.destination] || {};
        const a = document.createElement('a');
        a.className = `destino-tarjeta ${IC.gradiente(r.destination)}`;
        a.href = IC.deepLink(ORIGIN, r.destination, r.departure_at);
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `
          <span class="bandera">${IC.bandera(info.country)}</span>
          <span class="ciudad">${IC.nombreCorto(info.name) || r.destination}</span>
          <span class="fecha">salida ${fechaCorta(r.departure_at)} · ${r.destination}</span>
          <span class="precio">${Math.round(r.price)} €</span>
        `;
        resultadosDiv.appendChild(a);
      }
    } catch (err) {
      estadoDiv.textContent = 'No se pudieron cargar los precios en directo ahora mismo.';
    }
  }

  cargar();
})();
