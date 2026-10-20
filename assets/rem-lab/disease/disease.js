(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const buttons = [...document.querySelectorAll('[data-image]')].sort((a, b) =>
    a.dataset.time === 'COVER' ? -1 : b.dataset.time === 'COVER' ? 1 : a.dataset.time.localeCompare(b.dataset.time));
  const viewer = document.querySelector('#still-viewer');
  const image = viewer.querySelector('img');
  const title = viewer.querySelector('.viewer-description span');
  const meta = viewer.querySelector('.viewer-description small');
  const counter = viewer.querySelector('.viewer-counter');
  let current = 0;
  let imageOpener;

  function show(index) {
    current = (index + buttons.length) % buttons.length;
    const button = buttons[current];
    image.src = button.dataset.image;
    image.alt = button.querySelector('img')?.alt || button.dataset.title;
    title.textContent = button.dataset.title;
    meta.textContent = `${button.dataset.time} · DISEASE / REM Lab`;
    counter.textContent = `${String(current + 1).padStart(2, '0')} / ${buttons.length}`;
  }
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    imageOpener = button;
    show(index);
    viewer.showModal();
    document.body.classList.add('image-viewer-open');
  }));
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
    imageOpener?.focus({ preventScroll: true });
  });

  const recordHero = document.querySelector('[data-hero]');
  let recordVisible = true;
  function updateRecord() {
    recordHero.classList.toggle('record-active', recordVisible && !document.hidden && !reducedMotion.matches);
  }
  new IntersectionObserver(entries => {
    recordVisible = entries[0].isIntersecting;
    updateRecord();
  }, { threshold: .1 }).observe(recordHero);
  document.addEventListener('visibilitychange', updateRecord);
  reducedMotion.addEventListener('change', updateRecord);
  updateRecord();

  const cover = document.querySelector('.cover-trigger');
  const preview = cover.querySelector('video');
  const movieViewer = document.querySelector('#movie-viewer');
  const movie = movieViewer.querySelector('video');
  let previewTimer;
  let previewWanted = false;
  let movieOpener;

  function stopPreview() {
    previewWanted = false;
    window.clearTimeout(previewTimer);
    preview.pause();
    cover.classList.remove('preview-playing', 'preview-loading');
    cover.style.setProperty('--tilt-x', '0deg');
    cover.style.setProperty('--tilt-y', '0deg');
  }
  function startPreview() {
    if (!hoverPointer.matches || reducedMotion.matches || navigator.connection?.saveData || movieViewer.open) return;
    previewWanted = true;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      cover.classList.add('preview-loading');
      if (!preview.getAttribute('src')) preview.src = preview.dataset.preview;
      preview.play().then(() => {
        if (previewWanted) cover.classList.add('preview-playing');
        else preview.pause();
        cover.classList.remove('preview-loading');
      }).catch(() => cover.classList.remove('preview-loading'));
    }, 160);
  }
  cover.addEventListener('pointerenter', startPreview);
  cover.addEventListener('pointerleave', stopPreview);
  cover.addEventListener('focus', startPreview);
  cover.addEventListener('blur', stopPreview);
  cover.addEventListener('pointermove', event => {
    if (!hoverPointer.matches || reducedMotion.matches) return;
    const bounds = cover.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    cover.style.setProperty('--pointer-x', `${x * 100}%`);
    cover.style.setProperty('--pointer-y', `${y * 100}%`);
    cover.style.setProperty('--tilt-x', `${(y - .5) * -3}deg`);
    cover.style.setProperty('--tilt-y', `${(x - .5) * 3}deg`);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); });
  new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) stopPreview();
  }).observe(cover);

  document.querySelectorAll('[data-video]').forEach(button => button.addEventListener('click', () => {
    stopPreview();
    document.dispatchEvent(new CustomEvent('rem:media-start', { detail: 'film' }));
    movieOpener = button;
    movie.src = button.dataset.video;
    movieViewer.showModal();
    document.body.classList.add('image-viewer-open');
    movie.play().catch(() => { /* Playback remains available through native controls. */ });
  }));
  movieViewer.querySelector('.movie-close').addEventListener('click', () => movieViewer.close());
  movieViewer.addEventListener('close', () => {
    movie.pause();
    movie.removeAttribute('src');
    movie.load();
    document.body.classList.remove('image-viewer-open');
    movieOpener?.focus({ preventScroll: true });
  });


  document.addEventListener('rem:media-start', event => { if (event.detail === 'daw') stopPreview(); });
  const navLinks = [...document.querySelectorAll('[data-nav]')];
  const session = document.querySelector('#sound-lab');
  const frames = document.querySelector('#frames');
  const footer = document.querySelector('.film-footer');
  const navigation = document.querySelector('.film-nav');
  let scheduled = false;
  const clamp = value => Math.max(0, Math.min(1, value));
  function updateScroll() {
    scheduled = false;
    const height = innerHeight;
    const progress = clamp(scrollY / Math.max(1, document.documentElement.scrollHeight - height));
    document.documentElement.style.setProperty('--film-progress', progress.toFixed(4));
    const sessionBounds = session.getBoundingClientRect();
    const navigationHeight = navigation.offsetHeight + 1;
    const dark = (sessionBounds.top < navigationHeight && frames.getBoundingClientRect().top > navigationHeight) || footer.getBoundingClientRect().top < navigationHeight;
    document.documentElement.dataset.zone = dark ? 'dark' : 'light';
    const active = frames.getBoundingClientRect().top < height * .45 ? 'awakening' : session.getBoundingClientRect().top < height * .55 ? 'sound-lab' : 'top';
    navLinks.forEach(link => link.setAttribute('aria-current', String(link.dataset.nav === active)));
  }
  function scheduleScroll() { if (!scheduled) { scheduled = true; requestAnimationFrame(updateScroll); } }
  addEventListener('scroll', scheduleScroll, { passive: true });
  addEventListener('resize', scheduleScroll);
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) stopPreview(); scheduleScroll(); });
  scheduleScroll();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    });
  }, { threshold: .06 });
  document.documentElement.classList.add('reveal-ready');
  document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
})();
