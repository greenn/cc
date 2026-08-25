import { store } from './store.js';

const contentHeader = document.querySelector('.content-header');
const headerActions = document.querySelector('.header-actions');
const transcribeButton = document.querySelector('#transcribe-button');
const operations = window.__CC_SOURCE_OPERATIONS__ ||= new Map();

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

function operationRunning(sourceId) {
  const set = operations.get(sourceId);
  return set instanceof Set && set.size > 0;
}

function ensureStyle() {
  if (document.querySelector('#cc-instagram-helper-row-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-instagram-helper-row-styles';
  style.textContent = `
    .instagram-helper-row {
      display:flex;
      align-items:center;
      justify-content:flex-end;
      flex-wrap:wrap;
      gap:8px;
      min-height:45px;
      padding:8px 0 9px;
      border-bottom:1px solid var(--line, #e7e7e7);
    }
    .instagram-helper-row[hidden] { display:none !important; }
    .instagram-helper-row .instagram-helper-progress {
      margin-right:auto;
      min-height:32px;
    }
    #instagram-delete-source {
      color:var(--danger, #a32222);
      border-color:#e4c7c7;
    }
    #instagram-delete-source:hover:not(:disabled) {
      background:#fff5f5;
    }
  `;
  document.head.appendChild(style);
}

function ensureRow() {
  ensureStyle();
  let row = document.querySelector('#instagram-helper-row');
  if (!row && contentHeader) {
    row = document.createElement('div');
    row.id = 'instagram-helper-row';
    row.className = 'instagram-helper-row';
    row.hidden = true;
    row.setAttribute('aria-label', 'Instagram Browser Helper controls');
    contentHeader.insertAdjacentElement('afterend', row);
  }
  return row;
}

function ensureDeleteButton() {
  if (!headerActions) return null;
  let button = document.querySelector('#instagram-delete-source');
  if (!button) {
    button = document.createElement('button');
    button.id = 'instagram-delete-source';
    button.type = 'button';
    button.className = 'ghost-action';
    button.textContent = 'Delete source';
    button.title = 'Delete this Instagram source and all of its locally stored comments';
    if (transcribeButton?.parentElement === headerActions) transcribeButton.insertAdjacentElement('beforebegin', button);
    else headerActions.appendChild(button);
  }
  return button;
}

function moveToRow(row, selector) {
  const node = document.querySelector(selector);
  if (node && node.parentElement !== row) row.appendChild(node);
  return node;
}

function restoreRefresh() {
  const refresh = document.querySelector('#refresh-button');
  if (!refresh || !headerActions || refresh.parentElement === headerActions) return;
  if (transcribeButton?.parentElement === headerActions) transcribeButton.insertAdjacentElement('beforebegin', refresh);
  else headerActions.appendChild(refresh);
}

function arrange() {
  const row = ensureRow();
  const deleteButton = ensureDeleteButton();
  if (!row || !deleteButton) return;

  const source = currentSource();
  const isInstagram = source?.platform === 'instagram';
  deleteButton.hidden = !isInstagram;
  deleteButton.disabled = !isInstagram || operationRunning(source.id);
  deleteButton.title = deleteButton.disabled && isInstagram
    ? 'Wait for the current Instagram Helper operation to finish before deleting this source.'
    : 'Delete this Instagram source and all of its locally stored comments';

  if (!isInstagram) {
    row.hidden = true;
    restoreRefresh();
    return;
  }

  row.hidden = false;

  // Keep content/data actions (Accounts, Attachments, Video, Photos, Delete)
  // in the main header row. Collection/worker controls and diagnostics live
  // together on the dedicated row below it.
  moveToRow(row, '#instagram-helper-progress');
  moveToRow(row, '#refresh-button');
  moveToRow(row, '#instagram-load-more');
  moveToRow(row, '#instagram-focus-worker');
}

function deleteCurrentInstagramSource() {
  const source = currentSource();
  if (!source || source.platform !== 'instagram' || operationRunning(source.id)) return;

  const confirmed = window.confirm(`Delete “${source.title || 'this Instagram source'}” and all of its locally stored comments from CC?`);
  if (!confirmed) return;

  store.removeSource(source.id);
  const sourcesNav = document.querySelector('#main-nav .nav-item[data-view="sources"]');
  if (sourcesNav) sourcesNav.click();
  else location.reload();
  requestAnimationFrame(arrange);
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('#instagram-delete-source')) {
    event.preventDefault();
    event.stopPropagation();
    deleteCurrentInstagramSource();
    return;
  }

  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand, #refresh-button, #instagram-load-more')) {
    window.setTimeout(arrange, 0);
    window.setTimeout(arrange, 350);
  }
}, true);

window.addEventListener('popstate', () => requestAnimationFrame(arrange));
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'cc-helper' || message.type !== 'CC_HELPER_PROGRESS') return;
  arrange();
});
window.addEventListener('cc:instagram-stream-saved', () => requestAnimationFrame(arrange));

ensureRow();
ensureDeleteButton();
arrange();
console.info('[CC Instagram helper row] diagnostics, worker controls, and source delete ready');
