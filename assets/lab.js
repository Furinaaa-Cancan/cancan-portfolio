(() => {
  const menu = document.querySelector('#contents');
  const toggle = document.querySelector('.menu-toggle');
  const close = document.querySelector('.menu-close');
  if (menu && toggle && close) {
    toggle.addEventListener('click', () => {
      menu.showModal();
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('menu-open');
    });
    close.addEventListener('click', () => menu.close());
    menu.addEventListener('click', event => {
      if (event.target === menu) {
        const rect = menu.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right) menu.close();
      }
    });
    menu.addEventListener('close', () => {
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('menu-open');
    });
    menu.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', () => {
        menu.close();
        const target = document.querySelector(link.getAttribute('href'));
        // Transfer focus to the chosen chapter, so keyboard navigation follows it.
        if (target) {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
          target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        }
      });
    });
  }

  const links = [...document.querySelectorAll('[data-section], #contents nav a')];
  const sections = [...document.querySelectorAll('#overview, #works, .study, #academy, #practice, #people, #join')];
  let pending = false;
  const updateIndex = () => {
    pending = false;
    const threshold = Math.min(window.innerHeight * .35, 240);
    const active = sections.filter(section => section.getBoundingClientRect().top <= threshold).at(-1);
    links.forEach(link => {
      if (active && link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  const schedule = () => {
    if (!pending) { pending = true; requestAnimationFrame(updateIndex); }
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pageshow', schedule);
  document.fonts.ready.then(schedule);
  updateIndex();
})();
