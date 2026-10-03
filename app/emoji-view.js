import { store } from './store.js';

const contentArea = document.querySelector('#content-area');
const commentsList = document.querySelector('#comments-list');
const eyebrow = document.querySelector('#source-eyebrow');

let renderFrame = null;

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
    return new URL(window.location.href).searchParams.get('mode') === 'emoji';
  } catch {
    return false;
  }
}

function enabledForCurrentSource() {
  return requested() && currentSource()?.platform === 'youtube';
}

function isEmojiGrapheme(value) {
  const text = String(value || '');
  if (!text) return false;
  if (!/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(text)) return false;
  return !/[^\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u20e3#*0-9]/u.test(text);
}

function extractEmoji(text) {
  const raw = String(text || '');
  if (!raw) return [];

  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(raw)]
      .map((entry) => entry.segment)
      .filter(isEmojiGrapheme);
  }

  return Array.from(raw).filter((char) =>
    /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u.test(char)
  );
}

function ensureView() {
  let view = document.querySelector('#emoji-view');
  if (view || !contentArea || !commentsList) return view;

  view = document.createElement('section');
  view.id = 'emoji-view';
  view.className = 'emoji-view';
  view.hidden = true;
  view.setAttribute('aria-label', 'Emoji view');
  commentsList.insertAdjacentElement('beforebegin', view);
  return view;
}

function makeEmojiNode(emoji, className = '') {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = emoji;
  return span;
}

function renderView() {
  const view = ensureView();
  if (!view) return;

  const source = currentSource();
  const active = Boolean(source && source.platform === 'youtube' && requested());
  view.hidden = !active;

  const button = eyebrow?.querySelector('[data-source-tool="emoji"]');
  if (button) {
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = active ? 'Exit emoji view.' : 'Open emoji view for loaded comments.';
  }

  if (!active) {
    view.replaceChildren();
    return;
  }

  const allComments = store.getComments(source.id);
  const comments = [...commentsList.querySelectorAll('.comment-card')]
    .map((card) => store.getComment(card.dataset.sourceId, card.dataset.commentId))
    .filter(Boolean);
  const counts = new Map();
  const firstSeen = new Map();
  const groups = [];
  let totalEmoji = 0;
  let firstIndex = 0;

  comments.forEach((comment) => {
    const emoji = extractEmoji(comment.text);
    if (!emoji.length) return;

    groups.push({ commentId: comment.id, emoji });
    emoji.forEach((item) => {
      totalEmoji += 1;
      if (!firstSeen.has(item)) firstSeen.set(item, firstIndex++);
      counts.set(item, (counts.get(item) || 0) + 1);
    });
  });

  const fragment = document.createDocumentFragment();

  const intro = document.createElement('div');
  intro.className = 'emoji-view-intro';

  const heading = document.createElement('h2');
  heading.textContent = 'Emoji';
  intro.appendChild(heading);

  const loaded = document.createElement('p');
  const totalComments = Number(source.commentCount);
  const loadedCount = allComments.length;
  const loadedLabel = Number.isFinite(totalComments) && totalComments >= 0
    ? `${loadedCount} of ${totalComments} loaded`
    : `${loadedCount} loaded`;
  loaded.textContent = `${comments.length} comments in view · ${loadedLabel} · ${totalEmoji} emoji`;
  intro.appendChild(loaded);
  fragment.appendChild(intro);

  const stream = document.createElement('div');
  stream.className = 'emoji-stream';
  stream.setAttribute('aria-label', 'Emoji in comment order');

  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'emoji-empty';
    empty.textContent = 'No emoji found in the loaded comments.';
    stream.appendChild(empty);
  } else {
    groups.forEach((group) => {
      const groupNode = document.createElement('span');
      groupNode.className = 'emoji-message-group';
      groupNode.dataset.commentId = group.commentId;
      group.emoji.forEach((emoji) => groupNode.appendChild(makeEmojiNode(emoji, 'emoji-glyph')));
      stream.appendChild(groupNode);
    });
  }
  fragment.appendChild(stream);

  const stats = document.createElement('section');
  stats.className = 'emoji-stats';

  const statsTitle = document.createElement('h3');
  statsTitle.textContent = 'Statistics';
  stats.appendChild(statsTitle);

  const table = document.createElement('div');
  table.className = 'emoji-stats-table';

  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || firstSeen.get(a[0]) - firstSeen.get(b[0]))
    .forEach(([emoji, count]) => {
      const row = document.createElement('div');
      row.className = 'emoji-stats-row';
      row.appendChild(makeEmojiNode(emoji, 'emoji-stats-glyph'));

      const value = document.createElement('span');
      value.className = 'emoji-stats-count';
      value.textContent = String(count);
      row.appendChild(value);
      table.appendChild(row);
    });

  if (!counts.size) {
    const empty = document.createElement('p');
    empty.className = 'emoji-empty';
    empty.textContent = 'Statistics will appear after emoji are found.';
    table.appendChild(empty);
  }

  stats.appendChild(table);
  fragment.appendChild(stats);

  view.replaceChildren(fragment);
}

function scheduleRender() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    applyMode();
  });
}

function applyMode() {
  const active = enabledForCurrentSource();
  document.body.classList.toggle('is-emoji-view', active);
  renderView();
}

function toggleMode() {
  const source = currentSource();
  if (!source || source.platform !== 'youtube') return;

  const url = new URL(window.location.href);
  if (enabledForCurrentSource()) url.searchParams.delete('mode');
  else url.searchParams.set('mode', 'emoji');
  url.searchParams.delete('comment');

  history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
  document.dispatchEvent(new CustomEvent('cc:view-mode-changed'));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-source-tool="emoji"]');
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
  new MutationObserver(scheduleRender).observe(commentsList, { childList: true });
}
if (eyebrow) {
  new MutationObserver(() => {
    const button = eyebrow.querySelector('[data-source-tool="emoji"]');
    if (!button) return;
    const active = enabledForCurrentSource();
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }).observe(eyebrow, { childList: true });
}

applyMode();

console.info('[CC emoji view] ordered emoji stream and statistics ready');
