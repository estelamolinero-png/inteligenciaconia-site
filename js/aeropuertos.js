// Datos compartidos de aeropuertos (nombre + pais) con cache en localStorage.
// Expone window.IC: getAirports(), nombreCorto(), bandera(), deepLink(), gradiente().
(function () {
  const CACHE_KEY = 'lugares_cache_v4';
  const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  let enMemoria = null;

  async function getAirports() {
    if (enMemoria) return enMemoria;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Array.isArray(cached.airports) && Date.now() - cached.t < CACHE_MAX_AGE_MS) {
        enMemoria = cached.airports;
        return enMemoria;
      }
    } catch (e) { /* cache invalida */ }
    // La API devuelve tanto codigos de aeropuerto (CRL, AGP) como de ciudad
    // (PAR, LON, ROM), asi que se combinan ambos datasets publicos. Para
    // mostrar, el nombre de ciudad tiene prioridad ("Paris" mejor que
    // "Charles de Gaulle Airport").
    const [aeropuertosRaw, ciudadesRaw] = await Promise.all([
      fetch('https://api.travelpayouts.com/data/en/airports.json').then((r) => r.json()),
      fetch('https://api.travelpayouts.com/data/en/cities.json').then((r) => r.json()).catch(() => []),
    ]);
    const porCodigo = {};
    for (const a of aeropuertosRaw) {
      if (a.code && a.flightable) porCodigo[a.code] = { code: a.code, name: a.name || a.code, country: a.country_code || '' };
    }
    for (const c of ciudadesRaw) {
      if (c.code && c.name) porCodigo[c.code] = { code: c.code, name: c.name, country: c.country_code || '' };
    }
    const airports = Object.values(porCodigo);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), airports })); } catch (e) { /* lleno */ }
    enMemoria = airports;
    return airports;
  }

  function nombreCorto(nombre) {
    return (nombre || '')
      .replace(/\s+(International|Intl\.?)\s+Airport$/i, '')
      .replace(/\s+Airport$/i, '')
      .replace(/^Aeropuerto de\s+/i, '');
  }

  function bandera(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '✈️';
    const base = 0x1f1e6;
    const cc = countryCode.toUpperCase();
    return String.fromCodePoint(base + cc.charCodeAt(0) - 65, base + cc.charCodeAt(1) - 65);
  }

  // Los precios de la API cheap son de ida y vuelta: si hay fecha de vuelta,
  // el deep-link debe abrir la busqueda ida+vuelta para que el precio cuadre.
  function deepLink(origin, dest, departureAt, returnAt) {
    const ida = /^\d{4}-(\d{2})-(\d{2})/.exec(departureAt || '');
    if (!ida) return 'https://vuelos.inteligenciaconia.com';
    const vuelta = /^\d{4}-(\d{2})-(\d{2})/.exec(returnAt || '');
    const tramoVuelta = vuelta ? `${vuelta[2]}${vuelta[1]}` : '';
    return `https://vuelos.inteligenciaconia.com/flights/${origin}${ida[2]}${ida[1]}${dest}${tramoVuelta}1`;
  }

  // Enlaces de contraste para verificar el precio en otros buscadores.
  function compararLinks(origin, dest, departureAt, returnAt) {
    const ida = /^(\d{4})-(\d{2})-(\d{2})/.exec(departureAt || '');
    if (!ida) return [];
    const isoIda = `${ida[1]}-${ida[2]}-${ida[3]}`;
    const vuelta = /^(\d{4})-(\d{2})-(\d{2})/.exec(returnAt || '');
    const skyFecha = (m) => m[1].slice(2) + m[2] + m[3];
    const enlaces = [];
    let gq = `Flights from ${origin} to ${dest} on ${isoIda}`;
    let sky = `https://www.skyscanner.es/transport/flights/${origin.toLowerCase()}/${dest.toLowerCase()}/${skyFecha(ida)}/`;
    if (vuelta) {
      gq += ` returning ${vuelta[1]}-${vuelta[2]}-${vuelta[3]}`;
      sky += `${skyFecha(vuelta)}/`;
    }
    enlaces.push({ nombre: 'Google Flights', url: `https://www.google.com/travel/flights?q=${encodeURIComponent(gq)}` });
    enlaces.push({ nombre: 'Skyscanner', url: sky });
    return enlaces;
  }

  function gradiente(codigo) {
    let h = 0;
    for (const c of codigo || '') h = (h * 31 + c.charCodeAt(0)) % 6;
    return 'g' + h;
  }

  window.IC = { getAirports, nombreCorto, bandera, deepLink, compararLinks, gradiente };
})();
