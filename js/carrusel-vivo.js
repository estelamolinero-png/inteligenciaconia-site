// Carrusel de chollos en vivo de la portada: pestañas por origen y tarjetas
// con deep-link a la busqueda ya rellenada. Usa window.IC (aeropuertos.js).
(function () {
  const WORKER_URL = 'https://api.inteligenciaconia.com/destinos';
  const pista = document.getElementById('carrusel-chollos');
  const estado = document.getElementById('estado-chollos');
  const chipVivo = document.getElementById('chip-vivo-texto');
  if (!pista) return;

  const cachePorOrigen = {};

  function mes(desplazamiento) {
    const hoy = new Date();
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + (desplazamiento || 0), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function esqueletos(n) {
    pista.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const div = document.createElement('div');
      div.className = 'esqueleto';
      pista.appendChild(div);
    }
  }

  async function datosDe(origen) {
    if (cachePorOrigen[origen]) return cachePorOrigen[origen];
    // A final de mes el mes en curso se queda casi sin vuelos: si hay pocos
    // resultados, se completa con el mes siguiente (sin duplicar destinos).
    const payload = await fetch(`${WORKER_URL}?origin=${origen}&month=${mes(0)}`).then((r) => r.json());
    let resultados = payload.results || [];
    if (resultados.length < 5) {
      const siguiente = await fetch(`${WORKER_URL}?origin=${origen}&month=${mes(1)}`).then((r) => r.json());
      const vistos = new Set(resultados.map((r) => r.destination));
      for (const r of siguiente.results || []) {
        if (!vistos.has(r.destination)) resultados.push(r);
      }
      resultados.sort((a, b) => a.price - b.price);
    }
    cachePorOrigen[origen] = resultados;
    return resultados;
  }

  function fechaCorta(iso) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[2]}/${m[1]}` : '';
  }

  async function pintar(origen) {
    estado.textContent = '';
    esqueletos(5);
    try {
      const [airports, resultados] = await Promise.all([IC.getAirports(), datosDe(origen)]);
      const porCodigo = {};
      for (const a of airports) porCodigo[a.code] = a;

      pista.innerHTML = '';
      if (resultados.length === 0) {
        estado.textContent = 'Sin datos para este mes desde este aeropuerto ahora mismo — prueba otra pestaña o el explorador.';
        return;
      }
      for (const r of resultados.slice(0, 12)) {
        const info = porCodigo[r.destination] || {};
        const a = document.createElement('a');
        a.className = `destino-tarjeta ${IC.gradiente(r.destination)}`;
        a.href = IC.deepLink(origen, r.destination, r.departure_at, r.return_at);
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `
          <span class="bandera">${IC.bandera(info.country)}</span>
          <span class="ciudad">${IC.nombreCorto(info.name) || r.destination}</span>
          <span class="fecha">salida ${fechaCorta(r.departure_at)} · ${r.destination}</span>
          <span class="precio">${Math.round(r.price)} €<small> ida y vuelta</small></span>
        `;
        pista.appendChild(a);
      }
      if (chipVivo && resultados[0]) {
        const NOMBRES_ORIGEN = { SDR: 'Santander', BIO: 'Bilbao', MAD: 'Madrid' };
        const info = porCodigo[resultados[0].destination] || {};
        chipVivo.textContent = `Ahora mismo: ${NOMBRES_ORIGEN[origen] || origen} → ${IC.nombreCorto(info.name) || resultados[0].destination} por ${Math.round(resultados[0].price)} €`;
      }
    } catch (err) {
      pista.innerHTML = '';
      estado.textContent = 'No se pudieron cargar los chollos en este momento.';
    }
  }

  document.querySelectorAll('.tab[data-origen]').forEach((tab) => {
    tab.setAttribute('aria-pressed', String(tab.classList.contains('activo')));
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-origen]').forEach((t) => {
        t.classList.remove('activo');
        t.setAttribute('aria-pressed', 'false');
      });
      tab.classList.add('activo');
      tab.setAttribute('aria-pressed', 'true');
      pintar(tab.dataset.origen);
    });
  });

  pintar('SDR');
})();
