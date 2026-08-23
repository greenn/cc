import { store } from './store.js';
import { youtubeAdapter } from './platforms/youtube.js';
import { instagramAdapter } from './platforms/instagram.js';
import { vkAdapter } from './platforms/vk.js';
import { holywarsooAdapter } from './platforms/holywarsoo.js';

const adapters = [youtubeAdapter, instagramAdapter, vkAdapter, holywarsooAdapter];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  contentArea: $('#content-area'),
  sourcesList: $('#sources-list'),
  commentsList: $('#comments-list'),
  emptyState: $('#empty-state'),
  loadingMore: $('#loading-more'),
  sentinel: $('#load-sentinel'),
  statusBanner: $('#status-banner'),
  title: $('#content-title'),
  eyebrow: $('#source-eyebrow'),
  meta: $('#content-meta'),
  refresh: $('#refresh-button'),
  search: $('#search-input'),
  sort: $('#sort-select'),
  addDialog: $('#add-link-dialog'),
  addForm: $('#add-link-form'),
  addError: $('#add-link-error'),
  sourceUrl: $('#source-url'),
  addSubmit: $('#add-source-submit'),
  settingsDialog: $('#settings-dialog'),
  settingsForm: $('#settings-form'),
  youtubeKey: $('#youtube-api-key'),
  note: $('#note-textarea'),
};

for (const source of store.getSources()) {
  if (source.platform === 'instagram' && source.integrationStatus === 'helper-required') {
    store.updateSource(source.id, { integrationStatus: 'helper', hasMore: true, nextCursor: 'helper' });
  }
}

let currentSourceId = store.getSources()[0]?.id || null;
let globalView = currentSourceId ? null : 'sources';
let activeFilter = 'comments';
let selectedCommentId = null;
let loadingSourceId = null;
let lastScrollTop = 0;
let scrollingDown = true;
let readObserver = null;
let loadObserver = null;
let noteTimer = null;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat(undefined, { notation: number > 999 ? 'compact' : 'standard' }).format(number);
}

function sourceIcon(platform) {
  if (platform === 'youtube') return '▶';
  if (platform === 'instagram') return '◎';
  if (platform === 'vk') return 'VK';
  if (platform === 'holywarsoo') return '▤';
  return '•';
}

function sourceLabel(platform) {
  return adapters.find((adapter) => adapter.id === platform)?.label || platform;
}

function sourceAdapter(source) {
  return adapters.find((adapter) => adapter.id === source?.platform) || null;
}

function adapterForUrl(url) {
  return adapters.find((adapter) => adapter.canHandle(url)) || null;
}

function canAutoLoad(source) {
  if (!source || source.hasMore === false) return false;
  if (source.platform === 'vk' && !store.getSettings().vkAccessToken) return false;
  return true;
}

function getScopeComments() {
  let comments = currentSourceId ? store.getComments(currentSourceId) : store.getComments();
  const filter = globalView && globalView !== 'sources' ? globalView : activeFilter;

  if (filter === 'comments' || filter === 'all') comments = comments.filter((comment) => !comment.deleted);
  if (filter === 'unread') comments = comments.filter((comment) => !comment.read && !comment.deleted);
  if (filter === 'read') comments = comments.filter((comment) => comment.read && !comment.deleted);
  if (filter === 'saved') comments = comments.filter((comment) => comment.saved && !comment.deleted);
  if (filter === 'deleted') comments = comments.filter((comment) => comment.deleted);

  const term = ui.search.value.trim().toLowerCase();
  if (term) {
    comments = comments.filter((comment) =>
      [comment.text, comment.authorName, comment.authorUsername]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }

  comments = [...comments];
  const sort = ui.sort.value;
  if (sort === 'newest') comments.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  if (sort === 'oldest') comments.sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
  if (sort === 'likes') comments.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
  if (sort === 'replies') comments.sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0));
  return comments;
}

function countsForSource(sourceId) {
  const comments = store.getComments(sourceId);
  return {
    loaded: comments.length,
    read: comments.filter((comment) => comment.read).length,
    saved: comments.filter((comment) => comment.saved && !comment.deleted).length,
  };
}

function renderSources() {
  const sources = store.getSources();
  if (!sources.length) {
    ui.sourcesList.innerHTML = '<p class="sources-empty">No sources</p>';
    return;
  }

  const grouped = sources.reduce((map, source) => {
    if (!map.has(source.platform)) map.set(source.platform, []);
    map.get(source.platform).push(source);
    return map;
  }, new Map());

  ui.sourcesList.innerHTML = [...grouped.entries()].map(([platform, items]) => `
    <div class="source-group">
      <div class="source-group-title">${escapeHtml(sourceLabel(platform))}</div>
      ${items.map((source) => {
        const counts = countsForSource(source.id);
        const total = source.commentCount ?? counts.loaded;
        const pageInfo = source.platform === 'holywarsoo' && source.totalPages
          ? ` · p.${source.currentPage || source.startPage || 1}/${source.totalPages}`
          : '';
        return `
          <button class="source-item ${currentSourceId === source.id ? 'is-active' : ''}" data-source-id="${escapeHtml(source.id)}">
            <span class="source-platform">${sourceIcon(source.platform)}</span>
            <span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>${counts.read} / ${total || counts.loaded} read${pageInfo}</small></span>
          </button>`;
      }).join('')}
    </div>`).join('');

  $$('.source-item').forEach((button) => button.addEventListener('click', () => selectSource(button.dataset.sourceId)));
}

function renderHeader() {
  const source = currentSourceId ? store.getSource(currentSourceId) : null;
  const isGlobal = !source;
  ui.refresh.hidden = !source;

  if (source) {
    const counts = countsForSource(source.id);
    ui.eyebrow.textContent = `${sourceLabel(source.platform)} · ${source.author || 'source'}`;
    ui.title.textContent = source.title;
    const parts = [`${counts.loaded} loaded`, `${counts.read} read`];
    if (source.commentCount != null) parts.push(`${source.commentCount} total`);
    if (source.platform === 'holywarsoo' && source.totalPages) parts.push(`forum page ${source.currentPage || source.startPage || 1} / ${source.totalPages}`);
    if (source.platform === 'instagram') parts.push('browser helper');
    if (source.platform === 'vk' && !store.getSettings().vkAccessToken) parts.push('VK token required');
    ui.meta.textContent = parts.join(' · ');
  } else {
    const names = { sources: 'Sources', all: 'All comments', saved: 'Saved', read: 'Read', deleted: 'Deleted' };
    ui.eyebrow.textContent = 'Comment Collection';
    ui.title.textContent = names[globalView] || 'Comments';
    ui.meta.textContent = globalView === 'sources' ? 'Choose a source or add a new link.' : `${getScopeComments().length} comments in this view`;
  }

  $$('#top-tabs .top-tab').forEach((tab) => {
    tab.classList.toggle('is-active', !isGlobal && tab.dataset.filter === activeFilter);
    tab.disabled = isGlobal;
  });
  $$('#main-nav .nav-item[data-view]').forEach((item) => item.classList.toggle('is-active', isGlobal && item.dataset.view === globalView));
}

function renderComments() {
  if (readObserver) readObserver.disconnect();
  const comments = getScopeComments();
  const source = currentSourceId ? store.getSource(currentSourceId) : null;
  const showingSourcesOnly = !source && globalView === 'sources';

  if (showingSourcesOnly) {
    ui.commentsList.innerHTML = renderSourceOverview();
    ui.emptyState.hidden = store.getSources().length > 0;
    ui.sentinel.hidden = true;
    bindOverviewButtons();
    return;
  }

  ui.sentinel.hidden = !source || !canAutoLoad(source);
  ui.emptyState.hidden = comments.length > 0;

  if (!comments.length) {
    const label = globalView === 'saved' || activeFilter === 'saved' ? 'No saved comments' :
      globalView === 'deleted' || activeFilter === 'deleted' ? 'No deleted comments' :
      globalView === 'read' ? 'No read comments' : 'No comments found';
    let hint = source ? 'Try another filter or refresh the source.' : 'Add a source to begin.';
    if (source?.platform === 'vk' && !store.getSettings().vkAccessToken) hint = 'Add a VK user access token in Settings, then press Refresh.';
    if (source?.platform === 'instagram') hint = 'Install the CC Browser Helper, stay logged in to Instagram, then press Refresh.';
    ui.emptyState.innerHTML = `<strong>${label}</strong><p>${hint}</p>`;
    ui.commentsList.innerHTML = '';
    return;
  }

  ui.commentsList.innerHTML = comments.map((comment) => {
    const sourceForComment = store.getSource(comment.sourceId);
    const status = [comment.read ? 'read' : 'unread', comment.saved ? 'saved' : '', comment.highlighted ? 'highlighted' : '', comment.deleted ? 'deleted' : ''].filter(Boolean).join(' · ');
    const pageBadge = comment.forumPage ? `<span>p.${comment.forumPage}</span>` : '';
    return `
      <article class="comment-card ${selectedCommentId === comment.id ? 'is-selected' : ''} ${comment.read ? 'is-read' : ''} ${comment.highlighted ? 'is-highlighted' : ''}" data-comment-id="${escapeHtml(comment.id)}" data-source-id="${escapeHtml(comment.sourceId)}">
        <div class="comment-avatar">${comment.authorAvatar ? `<img src="${escapeHtml(comment.authorAvatar)}" alt="" loading="lazy" />` : escapeHtml((comment.authorName || '?').slice(0, 2).toUpperCase())}</div>
        <div class="comment-body">
          <div class="comment-head">
            <div><strong>${escapeHtml(comment.authorName)}</strong><span>${escapeHtml(comment.authorUsername || sourceForComment?.platform || '')}</span></div>
            <div class="comment-head-meta">
              <time>${formatDate(comment.publishedAt)}</time>
              ${comment.originalUrl ? '<button class="comment-original" data-action="open" title="Open original">↗ Original</button>' : ''}
            </div>
          </div>
          <p class="comment-text">${escapeHtml(comment.text).replaceAll('\n', '<br>')}</p>
          <div class="comment-footer">
            <div class="comment-stats"><span>♥ ${shortNumber(comment.likeCount)}</span><span>↩ ${shortNumber(comment.replyCount)}</span>${pageBadge}<span class="comment-status">${escapeHtml(status)}</span></div>
            <div class="comment-actions">
              <button data-action="save" title="Save">${comment.saved ? '★ Saved' : '☆ Save'}</button>
              ${comment.deleted ? '<button data-action="restore">↶ Restore</button>' : '<button data-action="delete">× Delete</button>'}
              <button data-action="highlight" title="Save and highlight">${comment.highlighted ? '✦ Highlighted' : '✧ Highlight'}</button>
            </div>
          </div>
        </div>
      </article>`;
  }).join('');

  $$('.comment-card').forEach((card) => {
    card.addEventListener('click', () => selectComment(card.dataset.sourceId, card.dataset.commentId));
    card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      handleCommentAction(card.dataset.sourceId, card.dataset.commentId, button.dataset.action);
    }));
  });
  observeReadCards();
}

function renderSourceOverview() {
  const sources = store.getSources();
  if (!sources.length) return '';
  return `<div class="source-overview">${sources.map((source) => {
    const counts = countsForSource(source.id);
    return `<article class="source-overview-card">
      <div class="overview-icon">${sourceIcon(source.platform)}</div>
      <div><p class="eyebrow">${escapeHtml(sourceLabel(source.platform))}</p><h3>${escapeHtml(source.title)}</h3><p>${counts.loaded} loaded · ${counts.read} read · ${counts.saved} saved</p></div>
      <button class="ghost-action" data-open-source="${escapeHtml(source.id)}">Open</button>
    </article>`;
  }).join('')}</div>`;
}

function renderRightPanel() {
  const found = selectedCommentId ? store.findComment(selectedCommentId) : null;
  const comment = found?.comment;
  const source = found ? store.getSource(found.sourceId) : null;
  $('#detail-avatar').innerHTML = comment?.authorAvatar ? `<img src="${escapeHtml(comment.authorAvatar)}" alt="" />` : escapeHtml((comment?.authorName || 'CC').slice(0, 2).toUpperCase());
  $('#detail-author').textContent = comment?.authorName || 'Selection';
  $('#detail-username').textContent = comment?.authorUsername || 'Comment details';
  $('#detail-status').textContent = comment ? [comment.read ? 'Read' : 'Unread', comment.saved ? 'Saved' : '', comment.highlighted ? 'Highlighted' : '', comment.deleted ? 'Deleted' : ''].filter(Boolean).join(' · ') : '—';
  $('#detail-source').textContent = source?.title || '—';
  $('#detail-author-name').textContent = comment?.authorName || '—';
  $('#detail-date').textContent = comment ? formatDate(comment.publishedAt) : '—';
  $('#detail-likes').textContent = comment ? String(comment.likeCount || 0) : '—';
  $('#detail-replies').textContent = comment ? String(comment.replyCount || 0) : '—';
  ui.note.value = comment?.note || '';
  ui.note.disabled = !comment;
  $('#open-original-button').disabled = !comment?.originalUrl;
}

function render() {
  renderSources();
  renderHeader();
  renderComments();
  renderRightPanel();
}

function bindOverviewButtons() {
  $$('[data-open-source]').forEach((button) => button.addEventListener('click', () => selectSource(button.dataset.openSource)));
}

function selectSource(sourceId) {
  currentSourceId = sourceId;
  globalView = null;
  activeFilter = 'comments';
  selectedCommentId = null;
  render();
  const source = store.getSource(sourceId);
  if (!store.getComments(sourceId).length && canAutoLoad(source)) loadMoreComments(sourceId);
  restorePosition(sourceId);
}

function selectComment(sourceId, commentId) {
  selectedCommentId = commentId;
  renderRightPanel();
  $$('.comment-card').forEach((card) => card.classList.toggle('is-selected', card.dataset.commentId === commentId));
  store.updateSource(sourceId, { lastVisibleCommentId: commentId, lastOpenedAt: new Date().toISOString() });
}

function setGlobalView(view) {
  globalView = view;
  currentSourceId = null;
  selectedCommentId = null;
  render();
}

function handleCommentAction(sourceId, commentId, action) {
  const comment = store.getComment(sourceId, commentId);
  if (!comment) return;

  if (action === 'save') {
    const nextSaved = !comment.saved;
    store.updateComment(sourceId, commentId, {
      saved: nextSaved,
      savedAt: nextSaved ? new Date().toISOString() : null,
      ...(nextSaved ? {} : { highlighted: false, highlightedAt: null }),
    });
  }

  if (action === 'highlight') {
    const nextHighlighted = !comment.highlighted;
    const now = new Date().toISOString();
    store.updateComment(sourceId, commentId, {
      highlighted: nextHighlighted,
      highlightedAt: nextHighlighted ? now : null,
      saved: nextHighlighted ? true : comment.saved,
      savedAt: nextHighlighted && !comment.saved ? now : comment.savedAt,
    });
  }

  if (action === 'delete') store.updateComment(sourceId, commentId, { deleted: true, deletedAt: new Date().toISOString() });
  if (action === 'restore') store.updateComment(sourceId, commentId, { deleted: false, deletedAt: null });
  if (action === 'open' && comment.originalUrl) window.open(comment.originalUrl, '_blank', 'noopener,noreferrer');
  render();
}

function showStatus(message, kind = 'info') {
  ui.statusBanner.textContent = message;
  ui.statusBanner.dataset.kind = kind;
  ui.statusBanner.hidden = false;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => { ui.statusBanner.hidden = true; }, kind === 'error' ? 12000 : 5000);
}

async function addSource(url) {
  const adapter = adapterForUrl(url);
  if (!adapter) throw new Error('This URL is not a supported YouTube, Instagram, VK, or forum link.');
  const source = await adapter.getPost(url, store.getSettings());
  store.upsertSource(source);
  currentSourceId = source.id;
  globalView = null;
  activeFilter = 'comments';
  render();

  if (source.platform === 'vk' && !store.getSettings().vkAccessToken) {
    showStatus('VK source added. Add a VK user access token in Settings, then press Refresh.');
    return;
  }

  await loadMoreComments(source.id);
}

async function loadMoreComments(sourceId, { refresh = false } = {}) {
  const source = store.getSource(sourceId);
  if (!source || loadingSourceId || (!source.hasMore && !refresh)) return;
  const adapter = sourceAdapter(source);
  if (!adapter) return;

  loadingSourceId = sourceId;
  ui.loadingMore.hidden = false;
  try {
    const cursor = refresh ? null : source.nextCursor;
    const page = await adapter.getComments(source, cursor, 50, store.getSettings());
    store.upsertComments(source.id, page.comments || []);
    const patch = {
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      loadedCount: store.getComments(source.id).length,
      lastUpdatedAt: new Date().toISOString(),
      integrationStatus: 'ready',
    };
    if (page.totalResults != null) patch.commentCount = page.totalResults;
    if (page.currentPage != null) patch.currentPage = page.currentPage;
    if (page.totalPages != null) patch.totalPages = page.totalPages;
    store.updateSource(source.id, patch);
    render();
    if (refresh) showStatus('Source refreshed. Local read/saved/highlighted/deleted states were preserved.');
  } catch (error) {
    showStatus(error.message || 'Could not load comments.', 'error');
  } finally {
    loadingSourceId = null;
    ui.loadingMore.hidden = true;
  }
}

function observeReadCards() {
  if (!currentSourceId) return;
  readObserver = new IntersectionObserver((entries) => {
    if (!scrollingDown) return;
    let changed = false;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target;
      const comment = store.getComment(card.dataset.sourceId, card.dataset.commentId);
      if (comment && !comment.read && !comment.deleted) {
        store.markRead(card.dataset.sourceId, card.dataset.commentId);
        card.classList.add('is-read');
        changed = true;
      }
    }
    if (changed) {
      renderSources();
      renderHeader();
      renderRightPanel();
    }
  }, { root: ui.contentArea, rootMargin: '-49% 0px -49% 0px', threshold: 0 });
  $$('.comment-card').forEach((card) => readObserver.observe(card));
}

function restorePosition(sourceId) {
  const source = store.getSource(sourceId);
  if (!source?.lastVisibleCommentId) return;
  requestAnimationFrame(() => {
    const card = $$('.comment-card').find((item) => item.dataset.commentId === source.lastVisibleCommentId);
    if (card) card.scrollIntoView({ block: 'center' });
  });
}

function moveSelection(delta) {
  const cards = $$('.comment-card');
  if (!cards.length) return;
  let index = cards.findIndex((card) => card.dataset.commentId === selectedCommentId);
  if (index < 0) index = delta > 0 ? -1 : 0;
  index = Math.max(0, Math.min(cards.length - 1, index + delta));
  const card = cards[index];
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  selectComment(card.dataset.sourceId, card.dataset.commentId);
}

function openAddDialog() {
  ui.addError.hidden = true;
  ui.addError.textContent = '';
  ui.sourceUrl.value = '';
  ui.addDialog.showModal();
  setTimeout(() => ui.sourceUrl.focus(), 0);
}

function openSettings() {
  ui.youtubeKey.value = store.getSettings().youtubeApiKey || '';
  ui.settingsDialog.showModal();
}

$$('#main-nav .nav-item[data-view]').forEach((button) => button.addEventListener('click', () => setGlobalView(button.dataset.view)));
$$('#top-tabs .top-tab').forEach((button) => button.addEventListener('click', () => {
  if (!currentSourceId) return;
  activeFilter = button.dataset.filter;
  selectedCommentId = null;
  render();
}));

['#add-link-button', '#left-add-link', '#empty-add-link'].forEach((selector) => $(selector)?.addEventListener('click', openAddDialog));
$('#settings-button').addEventListener('click', openSettings);
$('#help-button').addEventListener('click', () => showStatus('YouTube uses YouTube Data API. VK uses video.getComments with your user token. Instagram uses CC Browser Helper with your signed-in browser session. Forums use per-site adapters. Passing the center line marks comments read. J/K navigate, S saves, H highlights, D deletes, O opens original.'));
ui.refresh.addEventListener('click', () => currentSourceId && loadMoreComments(currentSourceId, { refresh: true }));
ui.search.addEventListener('input', renderComments);
ui.sort.addEventListener('change', renderComments);

ui.addForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  ui.addError.hidden = true;
  ui.addSubmit.disabled = true;
  ui.addSubmit.textContent = 'Adding…';
  try {
    await addSource(ui.sourceUrl.value.trim());
    ui.addDialog.close();
  } catch (error) {
    ui.addError.textContent = error.message || 'Could not add source.';
    ui.addError.hidden = false;
  } finally {
    ui.addSubmit.disabled = false;
    ui.addSubmit.textContent = 'Add source';
  }
});

ui.settingsForm.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  store.setSettings({ youtubeApiKey: ui.youtubeKey.value.trim() });
  ui.settingsDialog.close();
  showStatus('Settings saved locally.');
});

$$('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => {
  const tab = button.dataset.detailTab;
  $$('[data-detail-tab]').forEach((item) => item.classList.toggle('is-active', item.dataset.detailTab === tab));
  $('#detail-info').hidden = tab !== 'info';
  $('#detail-notes').hidden = tab !== 'notes';
}));

ui.note.addEventListener('input', () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    const found = selectedCommentId ? store.findComment(selectedCommentId) : null;
    if (found) store.updateComment(found.sourceId, selectedCommentId, { note: ui.note.value });
  }, 350);
});

$('#open-original-button').addEventListener('click', () => {
  const found = selectedCommentId ? store.findComment(selectedCommentId) : null;
  if (found?.comment.originalUrl) window.open(found.comment.originalUrl, '_blank', 'noopener,noreferrer');
});

ui.contentArea.addEventListener('scroll', () => {
  const next = ui.contentArea.scrollTop;
  scrollingDown = next >= lastScrollTop;
  lastScrollTop = next;
}, { passive: true });

loadObserver = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting) && currentSourceId) loadMoreComments(currentSourceId);
}, { root: ui.contentArea, rootMargin: '500px 0px 500px 0px' });
loadObserver.observe(ui.sentinel);

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  const key = event.key.toLowerCase();
  if (key === 'j') moveSelection(1);
  if (key === 'k') moveSelection(-1);
  const found = selectedCommentId ? store.findComment(selectedCommentId) : null;
  if (!found) return;
  if (key === 's') { event.preventDefault(); handleCommentAction(found.sourceId, selectedCommentId, 'save'); }
  if (key === 'h') { event.preventDefault(); handleCommentAction(found.sourceId, selectedCommentId, 'highlight'); }
  if (key === 'd') { event.preventDefault(); handleCommentAction(found.sourceId, selectedCommentId, 'delete'); }
  if (key === 'o' && found.comment.originalUrl) {
    event.preventDefault();
    window.open(found.comment.originalUrl, '_blank', 'noopener,noreferrer');
  }
});

render();
if (currentSourceId) restorePosition(currentSourceId);
