// Opening preloader, after filipfelbar.com: the title's letters rise out of a mask in random order
// while a counter runs 000 → 100 over 2.6 s (expo.inOut); then the curtain fades, the headline's words
// rise out of their own masks and the header items drift up one by one. Timings are the reference's.
(() => {
  const root = document.documentElement;
  const pre = document.querySelector('[data-preloader]');
  if (!root.classList.contains('intro') || !pre) { pre?.remove(); return; }
  window.__intro = true;

  const HOLD = 2.6;                                              // counter run; the reveal starts here
  const EXPO = 'cubic-bezier(.87,0,.13,1)';                      // expo.inOut
  const OSMO = 'cubic-bezier(.625,.05,0,1)';                     // the reference's house ease
  const expoInOut = t => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (10 - 20 * t)) / 2;
  const ms = s => s * 1000;
  const rise = (el, from, opts) => el.animate([{ transform: `translateY(${from}%)` }, { transform: 'none' }], { fill: 'backwards', ...opts });

  // Wrap each unit in a mask so it rises from below its own baseline.
  const mask = (text, cls) => {
    const outer = document.createElement('span'); outer.className = `mask ${cls}`;
    const inner = document.createElement('span'); inner.textContent = text;
    outer.append(inner); return [outer, inner];
  };
  const splitInto = (el, units, cls) => {
    const inners = [];
    el.replaceChildren(...units.map(u => {
      if (/^\s+$/.test(u)) return document.createTextNode(u);
      const [outer, inner] = mask(u, cls); inners.push(inner); return outer;
    }));
    return inners;
  };
  const seg = window.Intl?.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  const words = text => seg ? [...seg.segment(text)].map(s => s.segment) : text.split(/(\s+)/).filter(Boolean);

  // Preloader title: characters, staggered over 45 % of the hold in random order.
  const title = pre.querySelector('[data-preloader-title]');
  const chars = splitInto(title, [...title.textContent], 'char');
  const order = chars.map((_, i) => i).sort(() => Math.random() - .5);
  order.forEach((c, k) => rise(chars[c], 150, { duration: ms(HOLD * .55), delay: ms(HOLD * .45 * k / (chars.length - 1)), easing: EXPO }));

  // Counter: 000 → 100 on the same curve.
  const counter = pre.querySelector('[data-preloader-counter]');
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min((now - t0) / ms(HOLD), 1);
    counter.textContent = String(Math.round(expoInOut(p) * 100)).padStart(3, '0');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Headline: each line's words, 0.8 s each, spread over 0.5 s, from reveal + 0.1 s.
  const h1 = document.querySelector('.hero h1');
  const units = [];
  const walk = node => [...node.childNodes].forEach(n => {
    if (n.nodeType === 3) { if (n.textContent.trim()) { const box = document.createElement('span'); units.push(...splitInto(box, words(n.textContent), 'word')); n.replaceWith(...box.childNodes); } }
    else if (n.nodeName !== 'BR') walk(n);
  });
  walk(h1);
  units.forEach((w, i) => rise(w, 150, { duration: 800, delay: ms(HOLD + .1 + .5 * i / Math.max(units.length - 1, 1)), easing: OSMO }));

  // Header items: 0.7 s each, 0.05 s apart, from reveal + 0.2 s.
  const items = document.querySelectorAll('.header-cell > :not(ul), .header-cell li');
  items.forEach((el, i) => el.animate(
    [{ opacity: 0, transform: 'translateY(40%)' }, { opacity: 1, transform: 'none' }],
    { duration: 700, delay: ms(HOLD + .2 + .05 * i), easing: OSMO, fill: 'backwards' }));

  // Showreel: fades up from 30 % below with the reveal, 0.9 s.
  document.querySelector('.showreel')?.animate(
    [{ opacity: 0, transform: 'translateY(30%)' }, { opacity: 1, transform: 'none' }],
    { duration: 900, delay: ms(HOLD), easing: OSMO, fill: 'backwards' });

  // Reveal: the curtain fades over 0.6 s and is removed; the page scrolls again.
  pre.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: ms(HOLD), easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' })
    .finished.then(() => { pre.remove(); root.classList.remove('intro', 'intro-reveal'); history.scrollRestoration = 'auto'; });   // so Back returns to the same spot
  setTimeout(() => { if (pre.isConnected) { window.scrollTo(0, 0); root.classList.add('intro-reveal'); } }, ms(HOLD));
})();
