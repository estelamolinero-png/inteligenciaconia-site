// Pagina "Chollos de hoy": pinta los vuelos mas baratos de los tres origenes
// con deep-link ida+vuelta y enlaces para contrastar el precio.
// Usa window.IC (aeropuertos.js).
(function () {
  const WORKER_URL = 'https://api.inteligenciaconia.com/destinos';
  const ORIGENES = ['SDR', 'BIO', 'MAD'];

  function mes(desplazamiento) {
    const hoy = new Date();
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + (desplazamiento || 0), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function fechaCorta(iso) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[2]}/${m[1]}` : '';
  }

  async function datosDe(origen) {
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
    return resultados;
  }

  async function pintar(origen, porCodigo) {
    const estado = document.getElementById(`estado-${origen}`);
    const rejilla = document.getElementById(`chollos-${origen}`);
    try {
      const resultados = (await datosDe(origen)).slice(0, 6);
      if (resultados.length === 0) {
        estado.textContent = 'Sin datos para este mes ahora mismo.';
        return;
      }
      estado.textContent = '';
      for (const r of resultados) {
        const info = porCodigo[r.destination] || {};
        const item = document.createElement('div');
        item.className = 'chollo-item';

        const a = document.createElement('a');
        a.className = `destino-tarjeta ${IC.gradiente(r.destination)}`;
        a.href = IC.deepLink(origen, r.destination, r.departure_at, r.return_at);
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `
          <span class="bandera">${IC.bandera(info.country)}</span>
          <span class="ciudad">${IC.nombreCorto(info.name) || r.destination}</span>
          <span class="fecha">${fechaCorta(r.departure_at)} → ${fechaCorta(r.return_at) || '?'} · ${r.destination}</span>
          <span class="precio">${Math.round(r.price)} €<small> ida y vuelta</small></span>
        `;
        item.appendChild(a);

        const enlaces = IC.compararLinks(origen, r.destination, r.departure_at, r.return_at);
        if (enlaces.length) {
          const comparar = document.createElement('div');
          comparar.className = 'comparar';
          comparar.append('Comparar: ');
          enlaces.forEach((e, i) => {
            if (i > 0) comparar.append(' · ');
            const link = document.createElement('a');
            link.href = e.url;
            link.target = '_blank';
            link.rel = 'noopener nofollow';
            link.textContent = e.nombre;
            comparar.appendChild(link);
          });
          item.appendChild(comparar);
        }

        rejilla.appendChild(item);
      }
    } catch (err) {
      estado.textContent = 'No se pudieron cargar los precios ahora mismo.';
    }
  }

  IC.getAirports().then((airports) => {
    const porCodigo = {};
    for (const a of airports) porCodigo[a.code] = a;
    ORIGENES.forEach((o) => pintar(o, porCodigo));
  }).catch(() => {
    ORIGENES.forEach((o) => {
      document.getElementById(`estado-${o}`).textContent = 'No se pudieron cargar los precios ahora mismo.';
    });
  });
})();
