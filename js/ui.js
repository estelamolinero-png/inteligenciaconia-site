// Interacciones basicas: menu movil, animaciones de aparicion y flechas de carrusel.
(function () {
  const burger = document.querySelector('.nav-burger');
  const links = document.querySelector('.nav-links');
  if (burger && links) {
    burger.addEventListener('click', () => {
      links.classList.toggle('abierto');
      burger.setAttribute('aria-expanded', links.classList.contains('abierto') ? 'true' : 'false');
    });
    links.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') links.classList.remove('abierto');
    });
  }

  if ('IntersectionObserver' in window) {
    const observador = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('visible');
          observador.unobserve(entrada.target);
        }
      }
    }, { threshold: 0.12 });
    document.querySelectorAll('.revelar').forEach((el) => observador.observe(el));
  } else {
    document.querySelectorAll('.revelar').forEach((el) => el.classList.add('visible'));
  }

  document.querySelectorAll('.carrusel-envoltorio').forEach((env) => {
    const pista = env.querySelector('.carrusel');
    if (!pista) return;
    env.querySelectorAll('.carrusel-flecha').forEach((btn) => {
      btn.addEventListener('click', () => {
        const paso = pista.clientWidth * 0.8;
        pista.scrollBy({ left: btn.classList.contains('izq') ? -paso : paso, behavior: 'smooth' });
      });
    });
  });
})();
