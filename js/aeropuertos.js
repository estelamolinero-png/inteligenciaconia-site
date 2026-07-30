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

  function deepLink(origin, dest, departureAt) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(departureAt || '');
    if (!m) return 'https://vuelos.inteligenciaconia.com';
    return `https://vuelos.inteligenciaconia.com/flights/${origin}${m[2]}${m[1]}${dest}1`;
  }

  function gradiente(codigo) {
    let h = 0;
    for (const c of codigo || '') h = (h * 31 + c.charCodeAt(0)) % 6;
    return 'g' + h;
  }

  window.IC = { getAirports, nombreCorto, bandera, deepLink, gradiente };
})();
