import { store } from './store.js';

const detailInfo = document.querySelector('#detail-info');
const commentsList = document.querySelector('#comments-list');
const dimensionCache = new Map();
let renderGeneration = 0;

function safeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return /^https?:$/i.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function mediaFormat(value, fallbackType = '') {
  const safe = safeHttpUrl(value);
  if (safe) {
    try {
      const pathname = new URL(safe).pathname;
      const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (match) return match[1].toUpperCase();
    } catch {
      // Fall through to the attachment type.
    }
  }
  return fallbackType === 'video' ? 'VIDEO' : fallbackType === 'image' ? 'IMAGE' : '—';
}

function attachmentTypeMatches(type, url) {
  const format = mediaFormat(url, '').toLowerCase();
  if (!format || format === '—') return true;
  if (type === 'video') return ['mp4', 'webm', 'mov', 'm4v'].includes(format);
  return ['gif', 'gifv', 'webp', 'jpg', 'jpeg', 'png', 'avif'].includes(format);
}

function attachmentsFor(comment) {
  const source = comment?.sourceId ? store.getSource(comment.sourceId) : null;
  if (source?.platform === 'instagram' && comment?.attachmentScope !== 'comment') return [];

  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(comment?.attachments) ? comment.attachments : []) {
    if (!raw || typeof raw !== 'object') continue;
    const type = raw.type === 'video' ? 'video' : 'image';
    let url = safeHttpUrl(raw.url);
    let previewUrl = safeHttpUrl(raw.previewUrl || raw.poster || raw.thumbnail);

    if (source?.platform === 'instagram') {
      if (url && !attachmentTypeMatches(type, url)) url = '';
      if (previewUrl && !attachmentTypeMatches('image', previewUrl)) previewUrl = '';
    }

    if (!url && !previewUrl) continue;
    const key = `${type}:${url || previewUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      type,
      url,
      previewUrl,
      alt: String(raw.alt || '').trim(),
    });
  }
  return result;
}

function authorKey(comment) {
  const username = String(comment?.authorUsername || '').trim().replace(/^@/, '').toLowerCase();
  if (username) return `u:${username}`;
  return `n:${String(comment?.authorName || '').trim().toLowerCase()}`;
}

function selectedComment() {
  const selected = document.querySelector('#comments-list .comment-card.is-selected[data-source-id][data-comment-id]');
  if (selected) return store.getComment(selected.dataset.sourceId, selected.dataset.commentId);

  try {
    const url = new URL(location.href);
    const sourceId = url.searchParams.get('source');
    const commentId = url.searchParams.get('comment');
    return sourceId && commentId ? store.getComment(sourceId, commentId) : null;
  } catch {
    return null;
  }
}

function relatedAttachments(comment) {
  if (!comment?.sourceId) return [];
  const key = authorKey(comment);
  if (!key || key === 'n:') return [];
  const comments = store.getComments(comment.sourceId);
  const result = [];

  comments.forEach((candidate, sourceIndex) => {
    if (candidate.id === comment.id || authorKey(candidate) !== key) return;
    attachmentsFor(candidate).forEach((attachment) => {
      result.push({
        comment: candidate,
        attachment,
        sourceNumber: sourceIndex + 1,
      });
    });
  });

  return result;
}

function ensureStyle() {
  if (document.querySelector('#cc-attachment-detail-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-attachment-detail-styles';
  style.textContent = `
    .detail-attachments-section {
      margin-top:18px;
      padding-top:18px;
      border-top:1px solid var(--line,#e7e7e7);
    }
    .detail-attachments-section[hidden] { display:none !important; }
    .detail-attachments-section h3 {
      margin:0 0 11px;
      font-size:12px;
      letter-spacing:-.01em;
    }
    .detail-attachment-list { display:grid; gap:12px; }
    .detail-attachment-item {
      min-width:0;
      display:grid;
      grid-template-columns:64px minmax(0,1fr);
      gap:10px;
      align-items:start;
      padding:10px 0;
      border-bottom:1px solid var(--line,#e7e7e7);
    }
    .detail-attachment-preview {
      width:64px;
      height:64px;
      display:grid;
      place-items:center;
      overflow:hidden;
      border:1px solid #e0e0e0;
      background:#f6f6f6;
      color:#666;
      font-size:9px;
      text-decoration:none;
    }
    .detail-attachment-preview img {
      width:100%;
      height:100%;
      object-fit:cover;
    }
    .detail-attachment-meta { min-width:0; display:grid; gap:5px; }
    .detail-attachment-meta-row { min-width:0; display:grid; grid-template-columns:54px minmax(0,1fr); gap:6px; align-items:start; }
    .detail-attachment-meta-row span:first-child { color:var(--muted,#8d8d8d); font-size:9px; }
    .detail-attachment-meta-row strong,
    .detail-attachment-meta-row a { min-width:0; font-size:10px; line-height:1.35; overflow-wrap:anywhere; }
    .detail-attachment-meta-row a { color:inherit; text-decoration:underline; text-underline-offset:2px; }
    .detail-related-head { margin:17px 0 9px; display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
    .detail-related-head strong { font-size:11px; }
    .detail-related-head span { color:var(--muted,#8d8d8d); font-size:9px; }
    .detail-related-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
    .detail-related-item { min-width:0; border:1px solid #e2e2e2; background:#fff; }
    .detail-related-media {
      width:100%;
      aspect-ratio:1;
      display:grid;
      place-items:center;
      overflow:hidden;
      background:#f6f6f6;
      color:#777;
      font-size:9px;
      text-decoration:none;
    }
    .detail-related-media img { width:100%; height:100%; object-fit:cover; }
    .detail-related-jump {
      width:100%;
      min-height:26px;
      padding:4px 5px;
      border-top:1px solid #e8e8e8;
      cursor:pointer;
      text-align:left;
      color:#555;
      font-size:8px;
      line-height:1.2;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .detail-related-jump:hover { color:var(--accent,#2f19d7); }
  `;
  document.head.appendChild(style);
}

function ensureUi() {
  ensureStyle();
  let section = document.querySelector('#detail-attachments-section');
  if (!section && detailInfo) {
    section = document.createElement('section');
    section.id = 'detail-attachments-section';
    section.className = 'detail-attachments-section';
    section.hidden = true;
    section.innerHTML = `
      <h3>Attachments</h3>
      <div class="detail-attachment-list" id="detail-attachment-list"></div>
      <div id="detail-related-attachments"></div>`;
    detailInfo.appendChild(section);
  }
  return section;
}

function probeDimensions(item) {
  const probeUrl = item.url || item.previewUrl;
  if (!probeUrl) return Promise.resolve('—');
  const key = `${item.type}:${probeUrl}`;
  if (dimensionCache.has(key)) return dimensionCache.get(key);

  const promise = new Promise((resolve) => {
    if (item.type === 'video' && item.url) {
      const video = document.createElement('video');
      const finish = (value) => {
        video.removeAttribute('src');
        video.load();
        resolve(value);
      };
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('loadedmetadata', () => {
        finish(video.videoWidth && video.videoHeight ? `${video.videoWidth} × ${video.videoHeight} px` : '—');
      }, { once: true });
      video.addEventListener('error', () => finish('—'), { once: true });
      video.src = item.url;
      return;
    }

    const image = new Image();
    image.onload = () => resolve(image.naturalWidth && image.naturalHeight
      ? `${image.naturalWidth} × ${image.naturalHeight} px`
      : '—');
    image.onerror = () => resolve('—');
    image.src = item.previewUrl || item.url;
  });

  dimensionCache.set(key, promise);
  return promise;
}

function mediaPreview(item, className) {
  const href = item.url || item.previewUrl;
  const element = href ? document.createElement('a') : document.createElement('div');
  element.className = className;
  if (href) {
    element.href = href;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
  }

  const preview = item.previewUrl || (item.type === 'image' ? item.url : '');
  if (preview) {
    const image = document.createElement('img');
    image.src = preview;
    image.alt = item.alt || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    element.appendChild(image);
  } else {
    element.textContent = item.type === 'video' ? 'VIDEO' : 'MEDIA';
  }
  return element;
}

function addMetaRow(container, label, valueNode) {
  const row = document.createElement('div');
  row.className = 'detail-attachment-meta-row';
  const name = document.createElement('span');
  name.textContent = label;
  row.appendChild(name);
  row.appendChild(valueNode);
  container.appendChild(row);
}

function currentAttachmentItem(comment, item, index, generation) {
  const article = document.createElement('article');
  article.className = 'detail-attachment-item';
  article.appendChild(mediaPreview(item, 'detail-attachment-preview'));

  const meta = document.createElement('div');
  meta.className = 'detail-attachment-meta';

  const format = document.createElement('strong');
  format.textContent = `${mediaFormat(item.url || item.previewUrl, item.type)} · ${item.type}`;
  addMetaRow(meta, index > 0 ? `Format ${index + 1}` : 'Format', format);

  const size = document.createElement('strong');
  size.textContent = 'checking…';
  addMetaRow(meta, 'Size', size);
  probeDimensions(item).then((value) => {
    if (generation === renderGeneration && size.isConnected) size.textContent = value;
  });

  const link = document.createElement('a');
  link.href = item.url || item.previewUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.url || item.previewUrl;
  link.title = item.url || item.previewUrl;
  addMetaRow(meta, 'Link', link);

  article.appendChild(meta);
  return article;
}

function relatedBlock(comment, entries) {
  const wrapper = document.createElement('div');
  if (!entries.length) return wrapper;

  const head = document.createElement('div');
  head.className = 'detail-related-head';
  const title = document.createElement('strong');
  title.textContent = 'Related attachments';
  const count = document.createElement('span');
  count.textContent = `${entries.length} by this user in this source`;
  head.append(title, count);
  wrapper.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'detail-related-grid';
  for (const entry of entries) {
    const tile = document.createElement('div');
    tile.className = 'detail-related-item';
    tile.appendChild(mediaPreview(entry.attachment, 'detail-related-media'));

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'detail-related-jump';
    jump.dataset.relatedSourceId = entry.comment.sourceId;
    jump.dataset.relatedCommentId = entry.comment.id;
    jump.dataset.relatedFilter = entry.comment.deleted ? 'deleted' : entry.comment.saved ? 'saved' : 'comments';
    jump.textContent = `#${entry.sourceNumber} · ${mediaFormat(entry.attachment.url || entry.attachment.previewUrl, entry.attachment.type)}`;
    jump.title = `Open comment #${entry.sourceNumber}`;
    tile.appendChild(jump);
    grid.appendChild(tile);
  }
  wrapper.appendChild(grid);
  return wrapper;
}

function render() {
  const section = ensureUi();
  if (!section) return;
  const comment = selectedComment();
  const items = attachmentsFor(comment);
  renderGeneration += 1;
  const generation = renderGeneration;

  section.hidden = !comment || !items.length;
  if (section.hidden) return;

  const list = section.querySelector('#detail-attachment-list');
  const related = section.querySelector('#detail-related-attachments');
  if (!list || !related) return;

  list.replaceChildren(...items.map((item, index) => currentAttachmentItem(comment, item, index, generation)));
  related.replaceChildren(relatedBlock(comment, relatedAttachments(comment)));
}

function jumpToRelated(button) {
  const sourceId = button.dataset.relatedSourceId;
  const commentId = button.dataset.relatedCommentId;
  const filter = button.dataset.relatedFilter || 'comments';
  if (!sourceId || !commentId) return;

  const visibleCard = [...document.querySelectorAll('#comments-list .comment-card[data-source-id][data-comment-id]')]
    .find((card) => card.dataset.sourceId === sourceId && card.dataset.commentId === commentId);
  if (visibleCard) {
    visibleCard.click();
    visibleCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  const url = new URL(location.href);
  url.searchParams.delete('view');
  url.searchParams.set('source', sourceId);
  url.searchParams.set('filter', filter);
  url.searchParams.set('comment', commentId);
  location.assign(url.toString());
}

document.addEventListener('click', (event) => {
  const jump = event.target.closest?.('.detail-related-jump[data-related-comment-id]');
  if (jump) {
    event.preventDefault();
    jumpToRelated(jump);
    return;
  }
  if (event.target.closest?.('.comment-card, .source-item, [data-open-source], #main-nav .nav-item, .brand')) {
    requestAnimationFrame(render);
  }
});

window.addEventListener('popstate', () => requestAnimationFrame(render));
window.addEventListener('cc:instagram-stream-saved', () => requestAnimationFrame(render));
if (commentsList) new MutationObserver(() => requestAnimationFrame(render)).observe(commentsList, { childList: true });

ensureUi();
render();
console.info('[CC attachment details] format, dimensions, direct link, and same-author related attachments ready');
