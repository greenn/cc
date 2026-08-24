import { store } from './store.js';

const eyebrow = document.querySelector('#source-eyebrow');
const contentTitle = document.querySelector('#content-title');
const statusBanner = document.querySelector('#status-banner');

let renderQueued = false;
let refreshAttempt = 0;
let lastDeletePromptKey = '';

function platformLabel(platform) {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'vk') return 'VK';
  if (platform === 'holywarsoo') return 'Holywarsoo';
  return platform || 'Source';
}

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

function scheduleMetaRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderSourceMeta();
  });
}

function renderSourceMeta() {
  if (!eyebrow) return;
  const source = currentSource();

  if (!source) {
    eyebrow.classList.remove('source-meta-row');
    eyebrow.onwheel = null;
    return;
  }

  const label = platformLabel(source.platform);
  const author = source.author || 'source';
  const url = String(source.url || '').trim();

  eyebrow.textContent = '';
  eyebrow.classList.add('source-meta-row');

  const platform = document.createElement('span');
  platform.textContent = label;
  eyebrow.appendChild(platform);

  const sep1 = document.createElement('span');
  sep1.className = 'source-meta-separator';
  sep1.textContent = '·';
  eyebrow.appendChild(sep1);

  const authorNode = document.createElement('span');
  authorNode.textContent = author;
  eyebrow.appendChild(authorNode);

  if (url) {
    const sep2 = document.createElement('span');
    sep2.className = 'source-meta-separator';
    sep2.textContent = '·';
    eyebrow.appendChild(sep2);

    const link = document.createElement('a');
    link.className = 'source-meta-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = url;
    link.textContent = url;
    eyebrow.appendChild(link);
  }

  eyebrow.onwheel = (event) => {
    if (eyebrow.scrollWidth <= eyebrow.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    eyebrow.scrollLeft += delta;
    event.preventDefault();
  };
}

function maybeOfferInstagramDelete() {
  if (!statusBanner || statusBanner.hidden) return;
  const text = statusBanner.textContent || '';
  if (!/Instagram helper found no comments/i.test(text)) return;
  if (!/candidates\s+0/i.test(text) || !/permalinks\s+0/i.test(text) || !/timestamps\s+0/i.test(text)) return;

  const source = currentSource();
  if (!source || source.platform !== 'instagram') return;

  const key = `${source.id}:${refreshAttempt}:${text}`;
  if (key === lastDeletePromptKey) return;
  lastDeletePromptKey = key;

  queueMicrotask(() => {
    const stillCurrent = currentSource();
    if (!stillCurrent || stillCurrent.id !== source.id) return;

    const confirmed = window.confirm(
      'Instagram returned no visible post or comment markup. The post may have been deleted or become unavailable. Delete this source from CC?'
    );
    if (!confirmed) return;

    store.removeSource(source.id);
    statusBanner.hidden = true;
    const sourcesButton = document.querySelector('#main-nav .nav-item[data-view="sources"]');
    if (sourcesButton) sourcesButton.click();
    else history.replaceState({}, '', `${location.pathname}?view=sources`);
  });
}

if (contentTitle) {
  new MutationObserver(scheduleMetaRender).observe(contentTitle, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

if (statusBanner) {
  new MutationObserver(maybeOfferInstagramDelete).observe(statusBanner, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

document.addEventListener('click', (event) => {
  if (event.target.closest?.('#refresh-button')) {
    refreshAttempt += 1;
    lastDeletePromptKey = '';
  }
  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    scheduleMetaRender();
  }
});

window.addEventListener('popstate', scheduleMetaRender);

scheduleMetaRender();
maybeOfferInstagramDelete();

console.info('[CC source meta] source URL row and Instagram unavailable-source prompt ready');
