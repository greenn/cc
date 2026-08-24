import { store } from './store.js';
import './source-navigation.js?v=0.4.10';
import './recognition-ui.js';

const contentArea = document.querySelector('#content-area');
const commentsList = document.querySelector('#comments-list');
const sourcesList = document.querySelector('#sources-list');

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

let saveTimer = null;
let numberFrame = null;
let restoring = false;

function activeSourceId() {
  return document.querySelector('.source-item.is-active')?.dataset.sourceId || null;
}

function numberCommentCards() {
  if (!commentsList) return;

  const indexMaps = new Map();
  commentsList.querySelectorAll('.comment-card').forEach((card) => {
    const sourceId = card.dataset.sourceId;
    const commentId = card.dataset.commentId;
    if (!sourceId || !commentId) return;

    if (!indexMaps.has(sourceId)) {
      const index = new Map();
      store.getComments(sourceId).forEach((comment, position) => {
        index.set(comment.id, position + 1);
      });
      indexMaps.set(sourceId, index);
    }

    const number = indexMaps.get(sourceId).get(commentId);
    if (number) card.dataset.internalNumber = `#${number}`;
    else delete card.dataset.internalNumber;
  });
}

function scheduleNumbering() {
  if (numberFrame) cancelAnimationFrame(numberFrame);
  numberFrame = requestAnimationFrame(() => {
    numberFrame = null;
    numberCommentCards();
  });
}

function nearestVisibleCard(sourceId) {
  if (!contentArea || !sourceId) return null;
  const rootRect = contentArea.getBoundingClientRect();
  const targetY = rootRect.top + rootRect.height / 2;
  let best = null;
  let bestDistance = Infinity;

  contentArea.querySelectorAll(`.comment-card[data-source-id="${CSS.escape(sourceId)}"]`).forEach((card) => {
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= rootRect.top || rect.top >= rootRect.bottom) return;
    const center = rect.top + rect.height / 2;
    const distance = Math.abs(center - targetY);
    if (distance < bestDistance) {
      best = { card, rect };
      bestDistance = distance;
    }
  });

  return best;
}

function saveReadingPosition() {
  if (restoring || !contentArea) return;
  const sourceId = activeSourceId();
  if (!sourceId) return;

  const nearest = nearestVisibleCard(sourceId);
  if (!nearest) return;

  const rootRect = contentArea.getBoundingClientRect();
  store.updateSource(sourceId, {
    lastVisibleCommentId: nearest.card.dataset.commentId,
    lastVisibleOffset: Math.round(nearest.rect.top - rootRect.top),
    lastScrollTop: Math.round(contentArea.scrollTop),
    lastOpenedAt: new Date().toISOString(),
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveReadingPosition, 180);
}

function restoreReadingPosition(sourceId = activeSourceId()) {
  if (!contentArea || !sourceId) return;
  const source = store.getSource(sourceId);
  if (!source) return;

  restoring = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const anchorId = source.lastVisibleCommentId;
    const hasPreciseOffset = source.lastVisibleOffset !== undefined && source.lastVisibleOffset !== null;
    const desiredOffset = Number(source.lastVisibleOffset);
    const anchor = anchorId
      ? [...contentArea.querySelectorAll('.comment-card')].find((card) => card.dataset.commentId === anchorId && card.dataset.sourceId === sourceId)
      : null;

    if (anchor && hasPreciseOffset && Number.isFinite(desiredOffset)) {
      const rootRect = contentArea.getBoundingClientRect();
      const currentOffset = anchor.getBoundingClientRect().top - rootRect.top;
      contentArea.scrollTop += currentOffset - desiredOffset;
    } else if (source.lastScrollTop !== undefined && source.lastScrollTop !== null && Number.isFinite(Number(source.lastScrollTop))) {
      contentArea.scrollTop = Number(source.lastScrollTop);
    } else {
      // Older CC versions stored the last comment marked read, not the real scroll position.
      // Do not restore that stale midpoint on the first reload after this fix.
      contentArea.scrollTop = 0;
    }

    restoring = false;
  }));
}

contentArea?.addEventListener('scroll', scheduleSave, { passive: true });
window.addEventListener('pagehide', saveReadingPosition);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveReadingPosition();
});

document.addEventListener('click', (event) => {
  const sourceButton = event.target.closest?.('.source-item');
  if (sourceButton?.dataset.sourceId) {
    setTimeout(() => restoreReadingPosition(sourceButton.dataset.sourceId), 0);
    return;
  }

  if (event.target.closest?.('.comment-card')) {
    setTimeout(saveReadingPosition, 0);
  }
});

if (commentsList) {
  new MutationObserver(scheduleNumbering).observe(commentsList, { childList: true, subtree: true });
}
if (sourcesList) {
  new MutationObserver(scheduleNumbering).observe(sourcesList, { childList: true, subtree: true });
}

scheduleNumbering();
restoreReadingPosition();
