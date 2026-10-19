(() => {
  const buttons = [...document.querySelectorAll('[data-image]')];
  const viewer = document.querySelector('#still-viewer');
  const image = viewer.querySelector('img');
  const title = viewer.querySelector('.viewer-description span');
  const meta = viewer.querySelector('.viewer-description small');
  const counter = viewer.querySelector('.viewer-counter');
  let current = 0;
  let opener;

  function show(index) {
    current = (index + buttons.length) % buttons.length;
    const button = buttons[current];
    image.src = button.dataset.image;
    image.alt = button.querySelector('img').alt;
    title.textContent = button.dataset.title;
    meta.textContent = `${button.dataset.time} · DISEASE / REM Lab`;
    counter.textContent = `${String(current + 1).padStart(2, '0')} / ${buttons.length}`;
  }

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      opener = button;
      show(index);
      viewer.showModal();
      document.body.classList.add('image-viewer-open');
    });
  });
  viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  viewer.querySelector('.viewer-prev').addEventListener('click', () => show(current - 1));
  viewer.querySelector('.viewer-next').addEventListener('click', () => show(current + 1));
  viewer.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  viewer.addEventListener('close', () => {
    image.removeAttribute('src');
    document.body.classList.remove('image-viewer-open');
    opener?.focus({ preventScroll: true });
  });

  const movieViewer = document.querySelector('#movie-viewer');
  const movie = movieViewer.querySelector('video');
  const watchButton = document.querySelector('[data-video]');
  watchButton.addEventListener('click', () => {
    movie.src = watchButton.dataset.video;
    movieViewer.showModal();
    document.body.classList.add('image-viewer-open');
    movie.play().catch(() => { /* Native controls remain available if playback is interrupted. */ });
  });
  movieViewer.querySelector('.movie-close').addEventListener('click', () => movieViewer.close());
  movieViewer.addEventListener('close', () => {
    movie.pause();
    movie.removeAttribute('src');
    movie.load();
    document.body.classList.remove('image-viewer-open');
    watchButton.focus({ preventScroll: true });
  });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hero = document.querySelector('[data-hero]');
  const chapters = [...document.querySelectorAll('.chapter[id]')];
  const railLinks = [...document.querySelectorAll('[data-chapter]')];
  let scheduled = false;
  const clamp = value => Math.max(0, Math.min(1, value));

  function updateScroll() {
    scheduled = false;
    const height = window.innerHeight;
    const bounds = hero.getBoundingClientRect();
    const heroProgress = clamp(-bounds.top / Math.max(1, bounds.height - height));
    const pageProgress = clamp(window.scrollY / Math.max(1, document.documentElement.scrollHeight - height));
    let active = '';
    chapters.forEach(chapter => {
      if (chapter.getBoundingClientRect().top < height * .55) active = chapter.id;
    });
    hero.style.setProperty('--hero-progress', heroProgress.toFixed(4));
    document.documentElement.style.setProperty('--film-progress', pageProgress.toFixed(4));
    railLinks.forEach(link => link.setAttribute('aria-current', String(link.dataset.chapter === active)));
  }
  function scheduleScroll() {
    if (!scheduled) {
      scheduled = true;
      window.requestAnimationFrame(updateScroll);
    }
  }
  if (!reducedMotion.matches) document.documentElement.classList.add('motion-ready');
  reducedMotion.addEventListener('change', event => {
    document.documentElement.classList.toggle('motion-ready', !event.matches);
    scheduleScroll();
  });
  window.addEventListener('scroll', scheduleScroll, { passive: true });
  window.addEventListener('resize', scheduleScroll);
  scheduleScroll();

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.06 });
    document.documentElement.classList.add('reveal-ready');
    document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
  }
})();
