import { store } from './store.js';
import { helperRequest } from './helper-client.js';

const headerActions = document.querySelector('.header-actions');
const refreshButton = document.querySelector('#refresh-button');
const operations = window.__CC_SOURCE_OPERATIONS__ ||= new Map();
let watchTimer = null;

function currentSource() {
  const activeId = document.querySelector('.source-item.is-active[data-source-id]')?.dataset.sourceId;
  if (activeId) return store.getSource(activeId);
  try {
    const sourceId = new URL(location.href).searchParams.get('source');
    return sourceId ? store.getSource(sourceId) : null;
  } catch {
    return null;
  }
}

function workerOperationRunning(sourceId) {
  const set = operations.get(sourceId);
  return set instanceof Set && (set.has('refresh') || set.has('more'));
}

function ensureButton() {
  if (!headerActions || !refreshButton) return null;
  let button = document.querySelector('#instagram-focus-worker');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'instagram-focus-worker';
  button.type = 'button';
  button.className = 'ghost-action';
  button.textContent = 'Open worker';
  button.hidden = true;
  button.title = 'Open the temporary Instagram worker tab and keep it focused while comments are loading';
  refreshButton.insertAdjacentElement('beforebegin', button);
  return button;
}

function stopWatch() {
  if (!watchTimer) return;
  clearInterval(watchTimer);
  watchTimer = null;
}

function startWatch() {
  if (watchTimer) return;
  watchTimer = window.setInterval(() => {
    const source = currentSource();
    if (!source || !workerOperationRunning(source.id)) {
      stopWatch();
      render();
      return;
    }
    render();
  }, 300);
}

function render() {
  const button = ensureButton();
  if (!button) return;
  const source = currentSource();
  const visible = Boolean(source?.platform === 'instagram' && workerOperationRunning(source.id));
  button.hidden = !visible;
  button.disabled = !visible || button.dataset.busy === '1';
  if (visible) startWatch();
}

async function focusWorker() {
  const source = currentSource();
  const button = ensureButton();
  if (!source || source.platform !== 'instagram' || !workerOperationRunning(source.id) || !button) return;

  button.dataset.busy = '1';
  button.disabled = true;
  button.textContent = 'Opening worker…';
  try {
    await helperRequest('instagram.focusWorker', { sourceId: source.id }, 12000);
    button.textContent = 'Worker open';
  } catch (error) {
    button.textContent = 'Open worker';
    const banner = document.querySelector('#status-banner');
    if (banner) {
      banner.textContent = error?.message || 'Instagram worker tab is not ready yet.';
      banner.dataset.kind = 'error';
      banner.hidden = false;
      window.setTimeout(() => { banner.hidden = true; }, 6000);
    }
  } finally {
    delete button.dataset.busy;
    button.disabled = false;
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = 'Open worker';
      render();
    }, 700);
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('#instagram-focus-worker')) {
    event.preventDefault();
    void focusWorker();
    return;
  }

  if (event.target.closest?.('#refresh-button, #instagram-load-more, .source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    window.setTimeout(render, 0);
    window.setTimeout(render, 350);
  }
}, true);

window.addEventListener('popstate', () => requestAnimationFrame(render));
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'cc-helper' || message.type !== 'CC_HELPER_PROGRESS') return;
  if (['complete', 'interrupted'].includes(String(message.progress?.phase || ''))) {
    window.setTimeout(render, 400);
    window.setTimeout(render, 1200);
  }
});

ensureButton();
render();
console.info('[CC Instagram worker focus] Open worker control ready');
