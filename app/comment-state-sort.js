import { store } from './store.js';

const commentsList = document.querySelector('#comments-list');
const sortSelect = document.querySelector('#sort-select');
let sortFrame = 0;

function routeStateMode() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('source')) {
      const filter = url.searchParams.get('filter') || 'comments';
      return filter === 'saved' || filter === 'deleted' ? filter : '';
    }
    const view = url.searchParams.get('view') || '';
    return view === 'saved' || view === 'deleted' ? view : '';
  } catch {
    return '';
  }
}

function actionTimestamp(comment, mode) {
  const value = mode === 'saved'
    ? (comment?.savedAt || comment?.highlightedAt || comment?.publishedAt)
    : (comment?.deletedAt || comment?.publishedAt);
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function updateSortLabels(mode) {
  if (!sortSelect) return;
  const newest = sortSelect.querySelector('option[value="newest"]');
  const oldest = sortSelect.querySelector('option[value="oldest"]');
  if (!newest || !oldest) return;

  if (mode === 'saved') {
    newest.textContent = 'Recently saved';
    oldest.textContent = 'Saved earliest';
    return;
  }
  if (mode === 'deleted') {
    newest.textContent = 'Recently deleted';
    oldest.textContent = 'Deleted earliest';
    return;
  }
  newest.textContent = 'Newest';
  oldest.textContent = 'Oldest';
}

function reorderRenderedCards() {
  sortFrame = 0;
  if (!commentsList || !sortSelect) return;

  const mode = routeStateMode();
  updateSortLabels(mode);
  if (!mode || !['newest', 'oldest'].includes(sortSelect.value)) return;

  const cards = [...commentsList.querySelectorAll(':scope > .comment-card')];
  if (cards.length < 2) return;

  const direction = sortSelect.value === 'newest' ? -1 : 1;
  const ordered = [...cards].sort((left, right) => {
    const leftComment = store.getComment(left.dataset.sourceId, left.dataset.commentId);
    const rightComment = store.getComment(right.dataset.sourceId, right.dataset.commentId);
    const delta = actionTimestamp(leftComment, mode) - actionTimestamp(rightComment, mode);
    if (delta) return delta * direction;
    return String(left.dataset.commentId || '').localeCompare(String(right.dataset.commentId || ''));
  });

  const alreadyOrdered = ordered.every((card, index) => card === cards[index]);
  if (alreadyOrdered) return;

  const fragment = document.createDocumentFragment();
  ordered.forEach((card) => fragment.appendChild(card));
  commentsList.appendChild(fragment);
}

function scheduleSort() {
  if (sortFrame) return;
  sortFrame = requestAnimationFrame(reorderRenderedCards);
}

function setNewestForStateView() {
  if (!sortSelect) return;
  if (sortSelect.value !== 'newest') {
    sortSelect.value = 'newest';
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  scheduleSort();
}

// User navigation into Saved/Deleted always starts with the most recently
// saved/deleted comments. The user can then choose the opposite date direction
// (or any other existing sort) from the normal sort menu.
document.addEventListener('click', (event) => {
  const nav = event.target.closest?.('#main-nav .nav-item[data-view]');
  const filter = event.target.closest?.('#top-tabs .top-tab[data-filter]');
  const mode = nav?.dataset.view || filter?.dataset.filter || '';
  if (mode !== 'saved' && mode !== 'deleted') return;
  queueMicrotask(setNewestForStateView);
});

sortSelect?.addEventListener('change', scheduleSort);
window.addEventListener('popstate', () => requestAnimationFrame(scheduleSort));

if (commentsList) {
  new MutationObserver(scheduleSort).observe(commentsList, { childList: true });
}

// A direct link such as ?view=saved without an explicit sort should have the
// same default as clicking Saved. Explicit ?sort=oldest/newest is preserved.
try {
  const url = new URL(window.location.href);
  const mode = routeStateMode();
  if ((mode === 'saved' || mode === 'deleted') && !url.searchParams.has('sort')) {
    setNewestForStateView();
  } else {
    scheduleSort();
  }
} catch {
  scheduleSort();
}

console.info('[CC state sort] Saved/Deleted action-time sorting ready');
