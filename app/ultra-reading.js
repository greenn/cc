import { store } from './store.js';

const commentsList = document.querySelector('#comments-list');
const eyebrow = document.querySelector('#source-eyebrow');

function currentSource() {
  const activeId = document.querySelector('.source-item.is-active')?.dataset.sourceId;
  if (activeId) return store.getSource(activeId);

  try {
    const sourceId = new URL(window.location.href).searchParams.get('source');
    return sourceId ? store.getSource(sourceId) : null;
  } catch {
    return null;
  }
}

function requested() {
  try {
    return new URL(window.location.href).searchParams.get('mode') === 'ultra';
  } catch {
    return false;
  }
}

function enabledForCurrentSource() {
  return requested() && currentSource()?.platform === 'youtube';
}

function updateButton() {
  const button = eyebrow?.querySelector('[data-source-tool="ultra-reading"]');
  if (!button) return;

  const active = enabledForCurrentSource();
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.title = active ? 'Exit Ultra reading mode.' : 'Open Ultra reading mode.';
}

function applyMode() {
  const active = enabledForCurrentSource();
  commentsList?.classList.toggle('is-ultra-reading', active);
  document.body.classList.toggle('is-ultra-reading', active);
  updateButton();
}

function toggleMode() {
  const source = currentSource();
  if (!source || source.platform !== 'youtube') return;

  const url = new URL(window.location.href);
  if (enabledForCurrentSource()) url.searchParams.delete('mode');
  else url.searchParams.set('mode', 'ultra');

  history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
  document.dispatchEvent(new CustomEvent('cc:view-mode-changed'));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-source-tool="ultra-reading"]');
  if (button) {
    event.preventDefault();
    event.stopPropagation();
    toggleMode();
    return;
  }

  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    requestAnimationFrame(applyMode);
  }
});

window.addEventListener('popstate', applyMode);
document.addEventListener('cc:view-mode-changed', applyMode);

if (commentsList) {
  new MutationObserver(applyMode).observe(commentsList, { childList: true });
}
if (eyebrow) {
  new MutationObserver(updateButton).observe(eyebrow, { childList: true });
}

applyMode();

console.info('[CC ultra reading] compact comment mode ready');
