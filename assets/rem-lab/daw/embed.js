(() => {
  const shell = document.querySelector('#daw-workbench');
  if (!shell) return;
  const frame = shell.querySelector('iframe');
  const fullscreen = shell.querySelector('[data-daw-fullscreen]');
  const pause = () => frame.contentWindow?.postMessage({ type: 'rem:daw-pause' }, location.origin);

  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen();
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else window.open(frame.src, '_blank', 'noopener');
    } catch (error) {
      shell.querySelector('[data-daw-open]').click();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement === shell ? '退出全屏 ↙' : '全屏操作 ↗';
  });
  document.addEventListener('rem:media-start', event => {
    if (event.detail === 'film') pause();
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'rem:daw-playing') return;
    document.querySelectorAll('video').forEach(video => video.pause());
  });
  window.addEventListener('pagehide', pause);
})();
