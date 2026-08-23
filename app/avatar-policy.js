import { store } from './store.js';

const MAX_CONCURRENT = 5;
const LOAD_TIMEOUT_MS = 5000;
const ROOT_MARGIN = '900px 0px 900px 0px';

const $ = (selector) => document.querySelector(selector);
const stateByUrl = new Map();
const queue = [];
let activeLoads = 0;
let avatarObserver = null;
let mutationObserver = null;
let rightPanelObserver = null;

const stats = {
  queued: 0,
  active: 0,
  loaded: 0,
  failed: 0,
  reused: 0,
};

window.__CC_AVATARS__ = stats;

function avatarUrl(comment) {
  return String(comment?.avatarUrl || comment?.authorAvatar || '').trim();
}

function normalizeComment(comment) {
  if (!comment || typeof comment !== 'object') return comment;
  const url = avatarUrl(comment);
  if (!url) return { ...comment, authorAvatar: '' };
  return {
    ...comment,
    avatarUrl: url,
    // app.js must render initials first. The real image is attached only when
    // the avatar is close to the viewport by this module.
    authorAvatar: '',
  };
}

function migrateExistingInMemory() {
  const comments = store.getState()?.comments || {};
  for (const list of Object.values(comments)) {
    if (!Array.isArray(list)) continue;
    for (const comment of list) {
      const url = avatarUrl(comment);
      if (!url) continue;
      comment.avatarUrl = url;
      comment.authorAvatar = '';
    }
  }
}

function wrapIncomingComments() {
  const original = store.upsertComments.bind(store);
  store.upsertComments = (sourceId, incoming) => {
    const normalized = Array.isArray(incoming) ? incoming.map(normalizeComment) : incoming;
    return original(sourceId, normalized);
  };
}

function initialsFor(comment) {
  return String(comment?.authorName || '?').slice(0, 2).toUpperCase();
}

function setFallback(element, comment) {
  if (!element?.isConnected) return;
  element.dataset.avatarState = 'fallback';
  if (!element.querySelector('img')) element.textContent = initialsFor(comment);
}

function reveal(element, url, comment) {
  if (!element?.isConnected || element.dataset.avatarRequest !== url) return;
  element.textContent = '';
  const image = document.createElement('img');
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = url;
  image.addEventListener('error', () => {
    image.remove();
    setFallback(element, comment);
  }, { once: true });
  element.appendChild(image);
  element.dataset.avatarState = 'loaded';
}

function stateFor(url) {
  let entry = stateByUrl.get(url);
  if (!entry) {
    entry = { status: 'idle', waiters: new Map() };
    stateByUrl.set(url, entry);
  }
  return entry;
}

function addWaiter(entry, element, comment) {
  if (!element?.isConnected) return;
  entry.waiters.set(element, comment);
}

function flushLoaded(url, entry) {
  for (const [element, comment] of entry.waiters) reveal(element, url, comment);
  entry.waiters.clear();
}

function flushFailed(entry) {
  for (const [element, comment] of entry.waiters) setFallback(element, comment);
  entry.waiters.clear();
}

function updateStats() {
  stats.active = activeLoads;
  stats.queued = queue.length;
}

function pump() {
  while (activeLoads < MAX_CONCURRENT && queue.length) {
    const url = queue.shift();
    const entry = stateByUrl.get(url);
    if (!entry || entry.status !== 'queued') continue;

    entry.status = 'loading';
    activeLoads += 1;
    updateStats();

    const probe = new Image();
    probe.decoding = 'async';
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      if (!ok) probe.src = '';

      activeLoads = Math.max(0, activeLoads - 1);
      entry.status = ok ? 'loaded' : 'failed';
      if (ok) {
        stats.loaded += 1;
        flushLoaded(url, entry);
      } else {
        stats.failed += 1;
        flushFailed(entry);
      }
      updateStats();
      pump();
    };

    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
    probe.onload = () => finish(true);
    probe.onerror = () => finish(false);

    // Reusing the original URL lets the normal browser HTTP/image cache keep
    // successful avatars temporarily. No backend copy is created.
    probe.src = url;
  }
}

function requestAvatar(element, comment) {
  const url = avatarUrl(comment);
  if (!element || !url) {
    setFallback(element, comment);
    return;
  }

  element.dataset.avatarRequest = url;
  const entry = stateFor(url);

  if (entry.status === 'loaded') {
    stats.reused += 1;
    reveal(element, url, comment);
    return;
  }
  if (entry.status === 'failed') {
    setFallback(element, comment);
    return;
  }

  addWaiter(entry, element, comment);
  if (entry.status === 'idle') {
    entry.status = 'queued';
    queue.push(url);
    updateStats();
    pump();
  }
}

function commentForCard(card) {
  if (!card?.dataset.sourceId || !card?.dataset.commentId) return null;
  return store.getComment(card.dataset.sourceId, card.dataset.commentId);
}

function observeCard(card) {
  const avatar = card?.querySelector('.comment-avatar');
  const comment = commentForCard(card);
  if (!avatar || !comment || !avatarUrl(comment)) return;
  avatar.dataset.avatarState = avatar.dataset.avatarState || 'waiting';
  avatarObserver?.observe(avatar);
}

function scanCards(root = document) {
  root.querySelectorAll?.('.comment-card').forEach(observeCard);
  if (root.matches?.('.comment-card')) observeCard(root);
}

function loadSelectedRightAvatar() {
  const card = $('.comment-card.is-selected');
  const detail = $('#detail-avatar');
  const comment = commentForCard(card);
  if (!detail || !comment) return;
  const url = avatarUrl(comment);
  if (!url) return;
  detail.dataset.avatarRequest = url;
  requestAvatar(detail, comment);
}

function installObservers() {
  const root = $('#content-area');
  const commentsList = $('#comments-list');
  if (!root || !commentsList) return;

  avatarObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      avatarObserver.unobserve(entry.target);
      const card = entry.target.closest('.comment-card');
      const comment = commentForCard(card);
      if (comment) requestAvatar(entry.target, comment);
    }
  }, {
    root,
    rootMargin: ROOT_MARGIN,
    threshold: 0,
  });

  mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scanCards(node);
      }
    }
  });
  mutationObserver.observe(commentsList, { childList: true, subtree: true });

  const rightPanel = $('#detail-avatar')?.parentElement;
  if (rightPanel) {
    rightPanelObserver = new MutationObserver(() => queueMicrotask(loadSelectedRightAvatar));
    rightPanelObserver.observe(rightPanel, { childList: true, subtree: true, characterData: true });
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('.comment-card')) queueMicrotask(loadSelectedRightAvatar);
  });

  scanCards(commentsList);
}

migrateExistingInMemory();
wrapIncomingComments();
installObservers();

console.info('[CC avatars] viewport loading enabled', {
  maxConcurrent: MAX_CONCURRENT,
  timeoutMs: LOAD_TIMEOUT_MS,
  rootMargin: ROOT_MARGIN,
  cache: 'browser HTTP/image cache only',
});
