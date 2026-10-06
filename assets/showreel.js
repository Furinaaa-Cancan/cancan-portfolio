// Case-study product film: muted loop that plays while on screen and pauses
// off screen. Controls: play/pause, a seek bar with elapsed / total time, and sound — the film is cut to
// its music, but browsers only autoplay muted video, so the sound button plays it once
// from the top with the soundtrack, then the loop goes back to muted.
(() => {
  const box = document.querySelector('[data-showreel]');
  const video = box?.querySelector('video');
  const toggle = box?.querySelector('[data-showreel-toggle]');
  if (!video || !toggle) return;
  let held = false;                                             // paused by the viewer: scrolling back does not restart it
  const sync = () => { box.classList.toggle('is-paused', video.paused); toggle.setAttribute('aria-label', video.paused ? '播放视频' : '暂停视频'); };
  toggle.addEventListener('click', () => { held = !video.paused; video.paused ? video.play().catch(() => {}) : video.pause(); });
  video.addEventListener('play', sync); video.addEventListener('pause', sync);
  new IntersectionObserver(([e]) => { if (e.isIntersecting && !held) video.play().catch(sync); else if (!e.isIntersecting) video.pause(); }).observe(box);
  sync();

  // Controls show while the pointer moves (or after a tap) and fade out after 2 s of stillness.
  let idle;
  const wake = () => {
    box.classList.add('is-active'); box.classList.remove('is-idle');
    clearTimeout(idle);
    idle = setTimeout(() => { box.classList.remove('is-active'); box.classList.add('is-idle'); }, 2000);
  };
  box.addEventListener('pointermove', wake);
  box.addEventListener('pointerdown', wake);
  box.addEventListener('pointerleave', () => { clearTimeout(idle); box.classList.remove('is-active', 'is-idle'); });

  // Seek bar: follows the film every frame while it plays; dragging scrubs.
  const seek = box.querySelector('[data-showreel-seek]');
  const now = box.querySelector('[data-showreel-now]');
  const total = box.querySelector('[data-showreel-total]');
  const clock = t => { t = Math.max(0, Math.floor(t || 0)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  let scrubbing = false;
  const paint = t => {
    const p = video.duration ? t / video.duration : 0;
    seek.style.setProperty('--p', p.toFixed(4));
    seek.value = t; now.textContent = clock(t);
    seek.setAttribute('aria-valuetext', `${clock(t)} / ${clock(video.duration)}`);
  };
  const meta = () => { seek.max = video.duration; total.textContent = clock(video.duration); paint(video.currentTime); };
  video.readyState >= 1 ? meta() : video.addEventListener('loadedmetadata', meta);
  const frame = () => { if (!scrubbing) paint(video.currentTime); if (!video.paused) requestAnimationFrame(frame); };
  video.addEventListener('play', () => requestAnimationFrame(frame));
  video.addEventListener('seeked', () => { if (!scrubbing) paint(video.currentTime); });
  seek.addEventListener('input', () => { wake(); scrubbing = true; box.classList.add('is-scrubbing'); paint(+seek.value); video.currentTime = +seek.value; });
  seek.addEventListener('change', () => { scrubbing = false; box.classList.remove('is-scrubbing'); });

  // Sound plays the film once from the top; when it ends, the loop carries on muted.
  const sound = box.querySelector('[data-showreel-sound]');
  const label = sound?.querySelector('span');
  const setSound = on => {
    video.muted = !on; video.loop = !on;                        // with sound: one pass, no loop, so 'ended' fires
    sound.setAttribute('aria-pressed', String(on));
    label.textContent = on ? '关闭声音' : '开启声音';
  };
  sound?.addEventListener('click', () => {
    const on = video.muted;
    setSound(on);
    if (on) { held = false; video.currentTime = 0; video.play().catch(() => {}); }
  });
  video.addEventListener('ended', () => { setSound(false); video.currentTime = 0; if (!held) video.play().catch(() => {}); });
})();
