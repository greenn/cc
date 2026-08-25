import { store } from './store.js';

const commentsList = document.querySelector('#comments-list');

function ensureStyle() {
  if (document.querySelector('#cc-comment-media-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-comment-media-styles';
  style.textContent = `
    .comment-attachments {
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      margin:10px 0 2px;
      align-items:flex-start;
    }
    .comment-attachment {
      display:block;
      max-width:min(360px,100%);
      border:1px solid #e2e2e2;
      background:#f7f7f7;
      overflow:hidden;
      border-radius:6px;
      text-decoration:none;
    }
    .comment-attachment img,
    video.comment-attachment {
      display:block;
      width:auto;
      max-width:100%;
      max-height:360px;
      object-fit:contain;
      background:#f3f3f3;
    }
  `;
  document.head.appendChild(style);
}

function safeAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type === 'video' ? 'video' : 'image';
  try {
    const url = new URL(String(value.url || ''));
    if (!/^https?:$/i.test(url.protocol)) return null;
    return {
      type,
      url: url.toString(),
      alt: String(value.alt || '').trim(),
    };
  } catch {
    return null;
  }
}

function attachmentsFor(comment) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(comment?.attachments) ? comment.attachments : []) {
    const item = safeAttachment(raw);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    result.push(item);
  }
  return result;
}

function renderCard(card) {
  const sourceId = card.dataset.sourceId;
  const commentId = card.dataset.commentId;
  if (!sourceId || !commentId) return;
  const comment = store.getComment(sourceId, commentId);
  if (!comment) return;

  const text = card.querySelector('.comment-text');
  if (!text) return;
  const items = attachmentsFor(comment);
  const signature = items.map((item) => `${item.type}:${item.url}`).join('|');
  const existing = card.querySelector('.comment-attachments');
  if (existing?.dataset.signature === signature) return;
  existing?.remove();

  text.hidden = !String(comment.text || '').trim();
  if (!items.length) return;

  const container = document.createElement('div');
  container.className = 'comment-attachments';
  container.dataset.signature = signature;

  for (const item of items) {
    if (item.type === 'video') {
      const media = document.createElement('video');
      media.className = 'comment-attachment';
      media.src = item.url;
      media.controls = true;
      media.preload = 'metadata';
      media.playsInline = true;
      container.appendChild(media);
      continue;
    }

    const link = document.createElement('a');
    link.className = 'comment-attachment';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = item.alt || 'Open comment image';

    const image = document.createElement('img');
    image.src = item.url;
    image.alt = item.alt || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    link.appendChild(image);
    container.appendChild(link);
  }

  text.insertAdjacentElement('afterend', container);
}

function renderAll() {
  ensureStyle();
  document.querySelectorAll('#comments-list .comment-card').forEach(renderCard);
}

if (commentsList) {
  new MutationObserver(() => renderAll()).observe(commentsList, { childList: true });
}

renderAll();
console.info('[CC comment media] collected comment graphics renderer ready');
