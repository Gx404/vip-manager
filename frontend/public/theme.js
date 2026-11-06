/* Apply the saved appearance before the page paints. No app data or network access. */
(() => {
  let appearance = 'light';
  try { if (localStorage.getItem('membership-theme') === 'dark') appearance = 'dark'; } catch {}
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.classList.toggle('dark', appearance === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#09090b' : '#f4f4f5');
})();
