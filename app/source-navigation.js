import { store } from './store.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ROUTE_KEYS = ['view', 'source', 'filter', 'comment'];
let applyingRoute = false;
let initialized = false;
let postFrame = null;

function routeUrl() {
  return new URL(window.location.href);
}

function writeRoute(values, { replace = false } = {}) {
  const url = routeUrl();
  ROUTE_KEYS.forEach((key) => url.searchParams.delete(key));

  Object.entries(values || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  history[replace ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function updateAuxState() {
  const url = routeUrl();
  const search = $('#search-input')?.value.trim() || '';
  const sort = $('#sort-select')?.value || 'source';

  if (search) url.searchParams.set('q', search);
  else url.searchParams.delete('q');

  if (sort && sort !== 'source') url.searchParams.set('sort', sort);
  else url.searchParams.delete('sort');

  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function routeMode() {
  const url = routeUrl();
  if (url.searchParams.get('source')) return 'source';
  return url.searchParams.get('view') || 'sources';
}

function sourceById(sourceId) {
  return store.getSource(sourceId);
}

function isArchived(sourceId) {
  return Boolean(sourceById(sourceId)?.archived);
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function setHidden(node, value) {
  if (node && node.hidden !== value) node.hidden = value;
}

function ensureArchiveNav() {
  const nav = $('#main-nav');
  const sourcesButton = nav?.querySelector('.nav-item[data-view="sources"]');
  if (!nav || !sourcesButton || $('#archive-nav')) return;

  const button = document.createElement('button');
  button.className = 'nav-item';
  button.id = 'archive-nav';
  button.type = 'button';
  button.innerHTML = '<span class="nav-icon">▣</span><span>Archive</span>';
  sourcesButton.insertAdjacentElement('afterend', button);
}

function configureBrandHome() {
  const brand = $('.brand');
  if (!brand || brand.dataset.homeBound === '1') return;

  brand.dataset.homeBound = '1';
  brand.classList.add('brand-home');
  brand.setAttribute('role', 'button');
  brand.setAttribute('tabindex', '0');
  brand.setAttribute('aria-label', 'Go to Sources');
  brand.title = 'Home — Sources';

  const goHome = () => {
    writeRoute({ view: 'sources' });
    applyRoute();
  };

  brand.addEventListener('click', goHome);
  brand.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      goHome();
    }
  });
}

function removeSourcesPlus() {
  $('#left-add-link')?.remove();
}

function enableWhisperTextSelection() {
  const indicator = $('#whisper-indicator');
  if (!indicator || indicator.dataset.selectionBound === '1') return;
  indicator.dataset.selectionBound = '1';
  indicator.addEventListener('click', (event) => event.stopPropagation());
}

function ensureOverviewActions(card) {
  const openButton = card.querySelector('[data-open-source]');
  const sourceId = openButton?.dataset.openSource;
  if (!sourceId) return;

  card.dataset.sourceId = sourceId;
  let actions = card.querySelector('.source-overview-actions');

  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'source-overview-actions';
    openButton.insertAdjacentElement('beforebegin', actions);
    actions.appendChild(openButton);

    const rename = document.createElement('button');
    rename.className = 'ghost-action';
    rename.type = 'button';
    rename.dataset.sourceAction = 'rename';
    rename.textContent = 'Rename';
    actions.appendChild(rename);

    const archive = document.createElement('button');
    archive.className = 'ghost-action';
    archive.type = 'button';
    archive.dataset.sourceAction = 'archive';
    actions.appendChild(archive);

    const remove = document.createElement('button');
    remove.className = 'ghost-action source-delete-action';
    remove.type = 'button';
    remove.dataset.sourceAction = 'delete';
    remove.textContent = 'Delete';
    actions.appendChild(remove);
  }

  const archiveButton = actions.querySelector('[data-source-action="archive"]');
  setText(archiveButton, isArchived(sourceId) ? 'Restore' : 'Archive');
}

function ensureOverviewEmptyState(archiveView, visibleCount) {
  const empty = $('#empty-state');
  if (!empty) return;

  const mode = routeMode();
  if (mode !== 'sources' && mode !== 'archive') return;

  let strong = empty.querySelector('strong');
  let text = empty.querySelector('p');
  let addButton = empty.querySelector('#empty-add-link');

  if (!strong) {
    strong = document.createElement('strong');
    empty.prepend(strong);
  }
  if (!text) {
    text = document.createElement('p');
    strong.insertAdjacentElement('afterend', text);
  }
  if (!addButton) {
    addButton = document.createElement('button');
    addButton.className = 'primary-action';
    addButton.id = 'empty-add-link';
    addButton.type = 'button';
    addButton.textContent = '+ Add link';
    addButton.addEventListener('click', () => $('#add-link-button')?.click());
    empty.appendChild(addButton);
  }

  setText(strong, archiveView ? 'Archive is empty' : 'No active sources');
  setText(text, archiveView
    ? 'Sources moved to the archive will appear here.'
    : 'Add a YouTube, Instagram, VK, or supported forum link to start.');
  setHidden(addButton, archiveView);
  setHidden(empty, visibleCount > 0);
}

function postprocess() {
  removeSourcesPlus();
  ensureArchiveNav();
  configureBrandHome();
  enableWhisperTextSelection();

  const mode = routeMode();
  const archiveView = mode === 'archive';
  const activeSourceId = $('.source-item.is-active')?.dataset.sourceId || null;

  $$('.source-item').forEach((item) => {
    const archived = isArchived(item.dataset.sourceId);
    const shouldHide = archiveView
      ? !archived
      : archived && item.dataset.sourceId !== activeSourceId;
    setHidden(item, shouldHide);
  });

  const cards = $$('.source-overview-card');
  let visibleCards = 0;

  cards.forEach((card) => {
    ensureOverviewActions(card);
    const sourceId = card.dataset.sourceId || card.querySelector('[data-open-source]')?.dataset.openSource;
    const archived = sourceId ? isArchived(sourceId) : false;
    const shouldHide = archiveView ? !archived : archived;
    setHidden(card, shouldHide);
    if (!shouldHide) visibleCards += 1;
  });

  const archiveButton = $('#archive-nav');
  const sourcesButton = $('#main-nav .nav-item[data-view="sources"]');
  archiveButton?.classList.toggle('is-active', archiveView);
  if (sourcesButton) sourcesButton.classList.toggle('is-active', mode === 'sources');

  if (archiveView) {
    setText($('#source-eyebrow'), 'Comment Collection');
    setText($('#content-title'), 'Archive');
    setText($('#content-meta'), `${visibleCards} archived source${visibleCards === 1 ? '' : 's'}`);
  }

  if (cards.length || archiveView || mode === 'sources') {
    ensureOverviewEmptyState(archiveView, visibleCards);
  }

  if (initialized && !applyingRoute) {
    const active = $('.source-item.is-active')?.dataset.sourceId;
    const url = routeUrl();
    if (active && url.searchParams.get('source') !== active) {
      const filter = $('#top-tabs .top-tab.is-active')?.dataset.filter || 'comments';
      writeRoute({ source: active, filter }, { replace: false });
    }
  }
}

function schedulePostprocess() {
  if (postFrame) return;
  postFrame = requestAnimationFrame(() => {
    postFrame = null;
    postprocess();
  });
}

function rerenderOverview() {
  const mode = routeMode();
  applyingRoute = true;
  $('#main-nav .nav-item[data-view="sources"]')?.click();
  applyingRoute = false;
  schedulePostprocess();
  if (mode === 'archive') requestAnimationFrame(postprocess);
}

function handleSourceAction(button) {
  const card = button.closest('.source-overview-card');
  const sourceId = card?.dataset.sourceId || card?.querySelector('[data-open-source]')?.dataset.openSource;
  const source = sourceId ? sourceById(sourceId) : null;
  if (!source) return;

  const action = button.dataset.sourceAction;

  if (action === 'rename') {
    const next = window.prompt('Rename source', source.title || '');
    if (next === null) return;
    const title = next.trim();
    if (!title || title === source.title) return;
    store.updateSource(sourceId, { title });
    rerenderOverview();
    return;
  }

  if (action === 'archive') {
    const archived = !Boolean(source.archived);
    store.updateSource(sourceId, {
      archived,
      archivedAt: archived ? new Date().toISOString() : null,
    });
    rerenderOverview();
    return;
  }

  if (action === 'delete') {
    const confirmed = window.confirm(`Delete “${source.title || 'this source'}” and its downloaded comments from CC?`);
    if (!confirmed) return;
    store.removeSource(sourceId);
    rerenderOverview();
  }
}

function applyRoute() {
  const url = routeUrl();
  const sourceId = url.searchParams.get('source');
  const view = url.searchParams.get('view');
  const filter = url.searchParams.get('filter') || 'comments';
  const commentId = url.searchParams.get('comment');
  const query = url.searchParams.get('q') || '';
  const sort = url.searchParams.get('sort') || 'source';

  if (!sourceId && !view) {
    writeRoute({ view: 'sources' }, { replace: true });
    return applyRoute();
  }

  applyingRoute = true;

  const searchInput = $('#search-input');
  if (searchInput && searchInput.value !== query) {
    searchInput.value = query;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const sortSelect = $('#sort-select');
  if (sortSelect && [...sortSelect.options].some((option) => option.value === sort) && sortSelect.value !== sort) {
    sortSelect.value = sort;
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (sourceId) {
    const sourceButton = $$('.source-item').find((item) => item.dataset.sourceId === sourceId);
    if (sourceButton) {
      sourceButton.click();
      $$('#top-tabs .top-tab').find((item) => item.dataset.filter === filter)?.click();
      if (commentId) {
        requestAnimationFrame(() => {
          $$('.comment-card').find((item) => item.dataset.commentId === commentId && item.dataset.sourceId === sourceId)?.click();
        });
      }
    } else {
      writeRoute({ view: 'sources' }, { replace: true });
      $('#main-nav .nav-item[data-view="sources"]')?.click();
    }
  } else if (view === 'archive') {
    $('#main-nav .nav-item[data-view="sources"]')?.click();
  } else {
    const navButton = $$('#main-nav .nav-item[data-view]').find((item) => item.dataset.view === view);
    (navButton || $('#main-nav .nav-item[data-view="sources"]'))?.click();
  }

  applyingRoute = false;
  initialized = true;
  schedulePostprocess();
}

document.addEventListener('click', (event) => {
  const action = event.target.closest?.('[data-source-action]');
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    handleSourceAction(action);
    return;
  }

  const archiveNav = event.target.closest?.('#archive-nav');
  if (archiveNav) {
    if (applyingRoute) return;
    writeRoute({ view: 'archive' });
    applyRoute();
    return;
  }

  if (applyingRoute) return;

  const nav = event.target.closest?.('#main-nav .nav-item[data-view]');
  if (nav?.dataset.view) {
    writeRoute({ view: nav.dataset.view });
    schedulePostprocess();
    return;
  }

  const sourceButton = event.target.closest?.('.source-item');
  if (sourceButton?.dataset.sourceId) {
    writeRoute({ source: sourceButton.dataset.sourceId, filter: 'comments' });
    return;
  }

  const openButton = event.target.closest?.('[data-open-source]');
  if (openButton?.dataset.openSource) {
    writeRoute({ source: openButton.dataset.openSource, filter: 'comments' });
    return;
  }

  const filterButton = event.target.closest?.('#top-tabs .top-tab[data-filter]');
  if (filterButton?.dataset.filter) {
    const activeSource = $('.source-item.is-active')?.dataset.sourceId;
    if (activeSource) writeRoute({ source: activeSource, filter: filterButton.dataset.filter });
    return;
  }

  const commentCard = event.target.closest?.('.comment-card');
  if (commentCard?.dataset.commentId && !event.target.closest?.('[data-action]')) {
    const activeFilter = $('#top-tabs .top-tab.is-active')?.dataset.filter || 'comments';
    writeRoute({ source: commentCard.dataset.sourceId, filter: activeFilter, comment: commentCard.dataset.commentId });
  }
});

$('#search-input')?.addEventListener('input', updateAuxState);
$('#sort-select')?.addEventListener('change', updateAuxState);
window.addEventListener('popstate', applyRoute);

// Observe only replacement of the top-level rendered lists. The old version
// watched every descendant mutation and then mutated those descendants again,
// creating a requestAnimationFrame/MutationObserver feedback loop that could
// peg a CPU core and make the entire page appear frozen.
const commentsList = $('#comments-list');
const sourcesList = $('#sources-list');
if (commentsList) new MutationObserver(schedulePostprocess).observe(commentsList, { childList: true });
if (sourcesList) new MutationObserver(schedulePostprocess).observe(sourcesList, { childList: true });

removeSourcesPlus();
ensureArchiveNav();
configureBrandHome();
enableWhisperTextSelection();
applyRoute();

console.info('[CC navigation] observers ready without subtree feedback');
