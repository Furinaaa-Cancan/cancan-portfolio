(() => {
  const shell = document.querySelector('#daw-workbench');
  if (!shell) return;
  const frame = shell.querySelector('iframe');
  const fullscreen = shell.querySelector('[data-daw-fullscreen]');
  const status = shell.querySelector('.daw-cue-status');
  const cues = { lead: { mode: 'lead', time: 21.12 }, compare: { mode: 'compare', time: 49 }, comp: { mode: 'comp', time: 25.47 } };
  let ready = false, pending = null;
  const send = message => frame.contentWindow?.postMessage(message, location.origin);
  const pause = () => send({ type: 'rem:daw-pause' });
  const askStatus = () => send({ type: 'rem:daw-status' });
  function cue(value) {
    pending = value;
    if (ready) { send({ type: 'rem:daw-cue', cue: pending }); pending = null; }
    else { status.textContent = 'LOADING THE ORIGINAL SESSION…'; askStatus(); }
    shell.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#sound-lab');
  }
  document.querySelectorAll('[data-daw-cue]').forEach(button => button.addEventListener('click', () => cue(cues[button.dataset.dawCue])));
  document.querySelectorAll('[data-daw-time]').forEach(button => button.addEventListener('click', () => cue({ mode: 'scene', time: Number(button.dataset.dawTime) })));
  frame.addEventListener('load', () => { ready = false; askStatus(); });
  askStatus();
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen();
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else window.open(frame.src, '_blank', 'noopener');
    } catch (error) { shell.querySelector('[data-daw-open]').click(); }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement === shell ? 'COLLAPSE ↙' : 'EXPAND ↗';
  });
  document.addEventListener('rem:media-start', event => { if (event.detail === 'film') pause(); });
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'rem:daw-ready') {
      ready = true;
      if (pending) { send({ type: 'rem:daw-cue', cue: pending }); pending = null; }
    } else if (event.data?.type === 'rem:daw-playing') {
      document.querySelectorAll('video').forEach(video => video.pause());
      document.dispatchEvent(new CustomEvent('rem:media-start', { detail: 'daw' }));
    } else if (event.data?.type === 'rem:daw-cue-applied') {
      const { mode, time } = event.data;
      const stamp = `${String(Math.floor(time / 60)).padStart(2, '0')}:${(time % 60).toFixed(1).padStart(4, '0')}`;
      status.textContent = `${mode === 'lead' ? 'LEAD SOLO' : mode === 'compare' ? 'A/B v34 ↔ v35' : mode === 'comp' ? 'COMP CANDIDATES' : 'FILM MOMENT'} / ${stamp}`;
      document.querySelectorAll('[data-daw-cue]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dawCue === mode)));
    }
  });
  addEventListener('pagehide', pause);
})();
