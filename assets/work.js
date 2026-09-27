// Selected work, with the reference's scroll behaviour: when a block's top passes 80 % of the viewport the
// statement's characters rise out of their masks (from 200 %, tilted 10°, expo.out, random order) and the
// project rows drift up and fade in; the square picture drifts with the scroll; hovering a row plays the
// product recording that fades in over it.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const returning = document.documentElement.classList.contains('returning');   // back from a project: everything is already in place
  const EXPO_OUT = 'cubic-bezier(.16,1,.3,1)';
  const OSMO = 'cubic-bezier(.625,.05,0,1)';

  // Characters of [data-reveal-chars], each wrapped in a mask; each word stays in one unbreakable box so
  // English only wraps between words.
  const splitChars = el => {
    const out = [];
    const walk = node => [...node.childNodes].forEach(n => {
      if (n.nodeType !== 3) return walk(n);
      const frag = document.createDocumentFragment();
      for (const token of n.textContent.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) { frag.append(token); continue; }
        const word = document.createElement('span'); word.className = 'word';
        for (const ch of token) {
          const m = document.createElement('span'); m.className = 'mask';
          const c = document.createElement('span'); c.textContent = ch;
          m.append(c); word.append(m); out.push(c);
        }
        frag.append(word);
      }
      n.replaceWith(frag);
    });
    walk(el);
    return out;
  };

  const blocks = [...document.querySelectorAll('.work [data-reveal], .edu [data-reveal]')];
  if (!reduce && !returning && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js');
    const chars = new Map(blocks.map(b => [b, [...b.querySelectorAll('[data-reveal-chars]')].flatMap(splitChars)]));
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      const b = e.target; io.unobserve(b);
      b.style.opacity = 1;
      const cs = chars.get(b);
      if (cs.length) {
        [...cs].sort(() => Math.random() - .5).forEach((c, i) => c.animate(
          [{ transform: 'translateY(200%) rotate(10deg)' }, { transform: 'none' }],
          { duration: 1000, delay: i * 5, easing: EXPO_OUT, fill: 'backwards' }));
        [...b.children].filter(k => !k.matches('[data-reveal-chars]')).forEach((k, i) => k.animate(
          [{ opacity: 0, transform: 'translateY(2em)' }, { opacity: 1, transform: 'none' }],
          { duration: 800, delay: i * 100, easing: OSMO, fill: 'backwards' }));
      } else {
        b.animate([{ opacity: 0, transform: 'translateY(2em)' }, { opacity: 1, transform: 'none' }], { duration: 800, easing: OSMO, fill: 'backwards' });
      }
    }), { rootMargin: '0px 0px -20% 0px' });
    blocks.forEach(b => io.observe(b));
  }

  // Picture drift: 0 → 1 as the frame travels from the bottom of the viewport to the top; ±4.5 % inside a 1.1 × scale.
  const pics = [...document.querySelectorAll('[data-parallax]')];
  if (!reduce && pics.length) {
    let queued = false;
    const drift = () => {
      queued = false;
      pics.forEach(img => {
        const r = img.parentElement.getBoundingClientRect();
        const p = Math.min(Math.max((innerHeight - r.top) / (innerHeight + r.height), 0), 1);
        img.style.setProperty('--drift', ((p - .5) * 9).toFixed(2));
      });
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(drift); } }, { passive: true });
    addEventListener('resize', drift);
    drift();
  }

  // Abstracts: each paper's toggle opens its English abstract in a popover card placed just below the toggle
  // (above it when there is no room), flush with the paper title; it follows the page while scrolling and closes
  // once its toggle leaves the screen.
  document.querySelectorAll('.pub-toggle').forEach(btn => {
    const pop = document.getElementById(btn.getAttribute('popovertarget'));
    if (!pop) return;
    btn.setAttribute('aria-expanded', 'false');
    const place = () => {
      const r = btn.getBoundingClientRect(), col = btn.closest('.edu-school').getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      const left = Math.max(16, Math.min(col.left, innerWidth - w - 16));
      const below = r.bottom + 10, above = r.top - 10 - h;
      pop.style.left = left + 'px';
      pop.style.top = (below + h <= innerHeight - 16 || above < 16 ? Math.max(16, Math.min(below, innerHeight - h - 16)) : above) + 'px';
    };
    let queued = false;
    const follow = () => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const r = btn.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) { try { pop.hidePopover(); } catch (e) {} } else place();
      });
    };
    pop.addEventListener('toggle', e => {
      const open = e.newState === 'open';
      btn.setAttribute('aria-expanded', String(open));
      if (open) { pop.scrollTop = 0; place(); addEventListener('scroll', follow, { passive: true }); addEventListener('resize', follow); }
      else { removeEventListener('scroll', follow); removeEventListener('resize', follow); }
    });
  });

  // Hover: the recording plays only while it is shown.
  document.querySelectorAll('.work-item').forEach(item => {
    const v = item.querySelector('video');
    if (!v) return;
    const play = () => { v.preload = 'auto'; v.play().catch(() => {}); };
    item.addEventListener('mouseenter', play); item.addEventListener('focus', play);
    item.addEventListener('mouseleave', () => v.pause()); item.addEventListener('blur', () => v.pause());
  });
})();
