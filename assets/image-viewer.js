(() => {
  const viewer = document.querySelector('#image-viewer');
  if (!viewer) return;
  const preview = viewer.querySelector('img');
  let opener;

  document.querySelectorAll('[data-image]').forEach(button => {
    button.addEventListener('click', () => {
      opener = button;
      const source = button.querySelector('img') || button.closest('figure')?.querySelector('img');
      preview.alt = source?.alt || button.getAttribute('aria-label') || '作品大图';
      preview.src = button.dataset.image;
      viewer.showModal();
      document.body.classList.add('image-viewer-open');
    });
  });

  viewer.querySelector('.image-viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener('close', () => {
    document.body.classList.remove('image-viewer-open');
    preview.removeAttribute('src');
    opener?.focus({ preventScroll: true });
  });
})();
