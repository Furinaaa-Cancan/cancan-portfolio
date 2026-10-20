(() => {
  const rail = document.querySelector('.frame-rail');
  const cards = [...rail.querySelectorAll('figure')];
  const previous = document.querySelector('[data-gallery-prev]');
  const next = document.querySelector('[data-gallery-next]');
  const chapters = [...document.querySelectorAll('[data-gallery-chapter]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0, scheduled = false, drag = null, suppressUntil = 0;
  const position = card => card.offsetLeft - cards[0].offsetLeft;
  function go(index) {
    const target = Math.max(0, Math.min(cards.length - 1, index));
    rail.scrollTo({ left: position(cards[target]), behavior: reduced.matches ? 'auto' : 'smooth' });
  }
  function update() {
    scheduled = false;
    current = cards.reduce((best, card, index) => Math.abs(position(card) - rail.scrollLeft) < Math.abs(position(cards[best]) - rail.scrollLeft) ? index : best, 0);
    if (rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2) current = cards.length - 1;
    document.querySelector('[data-gallery-counter]').textContent = `${String(current + 1).padStart(2, '0')} / ${cards.length}`;
    document.querySelector('[data-gallery-label]').textContent = cards[current].dataset.galleryTitle;
    document.querySelector('.gallery-meter').style.setProperty('--gallery-progress', (current + 1) / cards.length);
    chapters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.galleryChapter === cards[current].dataset.galleryGroup)));
    previous.disabled = rail.scrollLeft < 2;
    next.disabled = rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
  }
  rail.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }, { passive: true });
  previous.addEventListener('click', () => go(current - 1));
  next.addEventListener('click', () => go(current + 1));
  chapters.forEach(button => button.addEventListener('click', () => {
    go(cards.findIndex(card => card.dataset.galleryGroup === button.dataset.galleryChapter));
  }));
  rail.addEventListener('keydown', event => {
    if (event.target !== rail || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    go(event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
  });
  rail.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('.caption-time')) return;
    drag = { id: event.pointerId, x: event.clientX, left: rail.scrollLeft, moved: false };
  });
  rail.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!event.buttons) { drag = null; return; }
    const delta = event.clientX - drag.x;
    if (!drag.moved && Math.abs(delta) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      rail.setPointerCapture(event.pointerId);
      rail.classList.add('is-dragging');
    }
    event.preventDefault();
    rail.scrollLeft = drag.left - delta;
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    rail.classList.remove('is-dragging');
    if (moved) {
      suppressUntil = performance.now() + 150;
      update();
      go(current);
    }
  }
  rail.addEventListener('pointerup', endDrag);
  rail.addEventListener('pointercancel', endDrag);
  rail.addEventListener('click', event => {
    if (performance.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  rail.addEventListener('dragstart', event => event.preventDefault());
  addEventListener('resize', update);
  update();
})();
