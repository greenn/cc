import { store } from './store.js';

const commentsList = document.querySelector('#comments-list');
const sourcesList = document.querySelector('#sources-list');
const headerActions = document.querySelector('.header-actions');
const refreshButton = document.querySelector('#refresh-button');
const renderedSignatureByCard = new WeakMap();

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
      position:relative;
      display:block;
      max-width:min(360px,100%);
      border:1px solid #e2e2e2;
      background:#f7f7f7;
      overflow:hidden;
      border-radius:6px;
      text-decoration:none;
      color:inherit;
    }
    .comment-attachment img,
    .comment-attachment video,
    video.comment-attachment {
      display:block;
      width:auto;
      max-width:100%;
      max-height:360px;
      object-fit:contain;
      background:#f3f3f3;
    }
    .comment-attachment.is-video-preview::after {
      content:'▶';
      position:absolute;
      left:50%;
      top:50%;
      transform:translate(-50%,-50%);
      display:grid;
      place-items:center;
      width:42px;
      height:42px;
      border-radius:999px;
      background:rgba(0,0,0,.72);
      color:#fff;
      font:18px/1 Arial,sans-serif;
      pointer-events:none;
    }
    #comment-attachments-dialog {
      width:min(920px,calc(100vw - 40px));
      max-height:min(820px,calc(100vh - 56px));
      padding:0;
      border:1px solid #d8d8d8;
      background:#fff;
      color:#111;
      box-shadow:0 20px 60px rgba(0,0,0,.18);
    }
    #comment-attachments-dialog::backdrop { background:rgba(0,0,0,.22); }
    .comment-attachments-card { display:grid; grid-template-rows:auto minmax(0,1fr); max-height:inherit; }
    .comment-attachments-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:20px 22px 14px; border-bottom:1px solid #e4e4e4; }
    .comment-attachments-head p { margin:0 0 4px; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#888; }
    .comment-attachments-head h2 { margin:0; font-size:22px; }
    .comment-attachments-close { appearance:none; border:0; background:transparent; font:24px/1 Arial,sans-serif; padding:3px 6px; cursor:pointer; }
    .comment-attachments-scroll { overflow:auto; min-height:140px; padding:16px; }
    .comment-attachments-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
    .comment-attachment-tile { min-width:0; border:1px solid #e1e1e1; background:#fff; }
    .comment-attachment-tile-media { position:relative; display:grid; place-items:center; min-height:150px; max-height:300px; overflow:hidden; background:#f5f5f5; }
    .comment-attachment-tile-media img,
    .comment-attachment-tile-media video { display:block; width:100%; max-height:300px; object-fit:contain; background:#f5f5f5; }
    .comment-attachment-tile-media.is-video-preview::after { content:'▶'; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:grid; place-items:center; width:44px; height:44px; border-radius:999px; background:rgba(0,0,0,.72); color:#fff; font:18px/1 Arial,sans-serif; pointer-events:none; }
    .comment-attachment-tile-copy { padding:9px 10px 10px; border-top:1px solid #ececec; }
    .comment-attachment-tile-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
    .comment-attachment-tile-copy p { margin:4px 0 0; color:#666; font-size:11px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .comment-attachment-tile-copy a { display:inline-block; margin-top:7px; color:inherit; font-size:10px; text-decoration:underline; text-underline-offset:2px; }
    .comment-attachments-empty { padding:30px 6px; color:#777; }
  `;
  document.head.appendChild(style);
}

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

function mediaKind(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return '';
  try {
    const path = new URL(safe).pathname.toLowerCase();
    if (/\.(?:gif|gifv|webp|jpe?g|png|avif)$/.test(path)) return 'image';
    if (/\.(?:mp4|webm|mov|m4v)$/.test(path)) return 'video';
  } catch {
    return '';
  }
  return '';
}

function safeAttachment(comment, value) {
  if (!value || typeof value !== 'object') return null;
  const source = comment?.sourceId ? store.getSource(comment.sourceId) : null;
  const type = value.type === 'video' ? 'video' : 'image';
  let url = safeHttpUrl(value.url);
  let previewUrl = safeHttpUrl(value.previewUrl || value.poster || value.thumbnail);

  if (source?.platform === 'instagram') {
    if (url && mediaKind(url) !== type) url = '';
    if (previewUrl && mediaKind(previewUrl) !== 'image') previewUrl = '';
  }

  if (!url && !previewUrl) return null;
  return { type, url, previewUrl, alt: String(value.alt || '').trim() };
}

function attachmentsFor(comment) {
  const source = comment?.sourceId ? store.getSource(comment.sourceId) : null;
  if (source?.platform === 'instagram' && comment?.attachmentScope !== 'comment') return [];

  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(comment?.attachments) ? comment.attachments : []) {
    const item = safeAttachment(comment, raw);
    if (!item) continue;
    const key = `${item.type}:${item.url || item.previewUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function allAttachments(sourceId) {
  const result = [];
  for (const comment of store.getComments(sourceId)) {
    attachmentsFor(comment).forEach((attachment, index) => result.push({ comment, attachment, index }));
  }
  return result;
}

function makeInlineMedia(comment, item) {
  if (item.type === 'video' && item.url) {
    const media = document.createElement('video');
    media.className = 'comment-attachment';
    media.src = item.url;
    if (item.previewUrl) media.poster = item.previewUrl;
    media.controls = true;
    media.preload = 'metadata';
    media.playsInline = true;
    media.title = item.alt || 'Comment video';
    return media;
  }

  const href = item.type === 'video'
    ? safeHttpUrl(comment.originalUrl)
    : (item.url || item.previewUrl);
  const wrapper = href ? document.createElement('a') : document.createElement('div');
  wrapper.className = `comment-attachment${item.type === 'video' ? ' is-video-preview' : ''}`;
  if (href) {
    wrapper.href = href;
    wrapper.target = '_blank';
    wrapper.rel = 'noopener noreferrer';
  }
  wrapper.title = item.type === 'video' ? 'Open original comment video' : (item.alt || 'Open comment image');

  const image = document.createElement('img');
  image.src = item.previewUrl || item.url;
  image.alt = item.alt || '';
  image.loading = 'lazy';
  image.decoding = 'async';
  wrapper.appendChild(image);
  return wrapper;
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
  const signature = items.map((item) => `${item.type}:${item.url}:${item.previewUrl}`).join('|');
  const existing = card.querySelector('.comment-attachments');
  if (renderedSignatureByCard.get(card) === signature && Boolean(existing) === Boolean(items.length)) return;
  existing?.remove();
  renderedSignatureByCard.set(card, signature);

  text.hidden = !String(comment.text || '').trim();
  if (!items.length) return;

  const container = document.createElement('div');
  container.className = 'comment-attachments';
  items.forEach((item) => container.appendChild(makeInlineMedia(comment, item)));
  text.insertAdjacentElement('afterend', container);
}

function ensureUi() {
  ensureStyle();
  if (headerActions && refreshButton && !document.querySelector('#comment-attachments-button')) {
    const button = document.createElement('button');
    button.id = 'comment-attachments-button';
    button.type = 'button';
    button.className = 'ghost-action';
    button.textContent = 'Attachments · 0';
    button.hidden = true;
    button.title = 'Show all verified media collected from comments in this source';
    refreshButton.insertAdjacentElement('beforebegin', button);
  }

  if (!document.querySelector('#comment-attachments-dialog')) {
    const dialog = document.createElement('dialog');
    dialog.id = 'comment-attachments-dialog';
    dialog.innerHTML = `
      <div class="comment-attachments-card">
        <div class="comment-attachments-head">
          <div><p>Comment media</p><h2 id="comment-attachments-title">Attachments</h2></div>
          <button class="comment-attachments-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="comment-attachments-scroll" id="comment-attachments-content"></div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.comment-attachments-close')?.addEventListener('click', () => dialog.close());
  }
}

function renderButton() {
  ensureUi();
  const source = currentSource();
  const button = document.querySelector('#comment-attachments-button');
  if (!button) return;
  button.hidden = !source;
  if (!source) return;
  button.textContent = `Attachments · ${allAttachments(source.id).length}`;
}

function mediaForTile(entry) {
  const { comment, attachment } = entry;
  let wrap;
  const href = attachment.type === 'video' && !attachment.url
    ? safeHttpUrl(comment.originalUrl)
    : attachment.url;
  if (href) {
    wrap = document.createElement('a');
    wrap.href = href;
    wrap.target = '_blank';
    wrap.rel = 'noopener noreferrer';
  } else {
    wrap = document.createElement('div');
  }
  wrap.className = `comment-attachment-tile-media${attachment.type === 'video' && !attachment.url ? ' is-video-preview' : ''}`;

  if (attachment.type === 'video' && attachment.url) {
    const video = document.createElement('video');
    video.src = attachment.url;
    if (attachment.previewUrl) video.poster = attachment.previewUrl;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    wrap.appendChild(video);
  } else {
    const image = document.createElement('img');
    image.src = attachment.previewUrl || attachment.url;
    image.alt = attachment.alt || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    wrap.appendChild(image);
  }
  return wrap;
}

function renderDialog() {
  const source = currentSource();
  const content = document.querySelector('#comment-attachments-content');
  const title = document.querySelector('#comment-attachments-title');
  if (!source || !content || !title) return;
  const entries = allAttachments(source.id);
  title.textContent = `Attachments · ${entries.length}`;

  if (!entries.length) {
    content.innerHTML = '<div class="comment-attachments-empty">No verified comment media has been collected yet. Run Refresh while the actual GIF/image/video comments are visible in the Instagram worker tab.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'comment-attachments-grid';
  for (const entry of entries) {
    const tile = document.createElement('article');
    tile.className = 'comment-attachment-tile';
    tile.appendChild(mediaForTile(entry));

    const copy = document.createElement('div');
    copy.className = 'comment-attachment-tile-copy';
    const author = document.createElement('strong');
    author.textContent = entry.comment.authorUsername || entry.comment.authorName || 'Unknown';
    copy.appendChild(author);

    const snippet = document.createElement('p');
    snippet.textContent = String(entry.comment.text || (entry.attachment.type === 'video' ? 'Video attachment' : 'Image / GIF attachment')).trim();
    copy.appendChild(snippet);

    if (entry.comment.originalUrl) {
      const original = document.createElement('a');
      original.href = entry.comment.originalUrl;
      original.target = '_blank';
      original.rel = 'noopener noreferrer';
      original.textContent = '↗ Original comment';
      copy.appendChild(original);
    }

    tile.appendChild(copy);
    grid.appendChild(tile);
  }
  content.replaceChildren(grid);
}

function renderAll() {
  ensureUi();
  document.querySelectorAll('#comments-list .comment-card').forEach(renderCard);
  renderButton();
  if (document.querySelector('#comment-attachments-dialog')?.open) renderDialog();
}

commentsList?.addEventListener('click', (event) => {
  if (event.target.closest?.('.comment-attachment')) event.stopPropagation();
});

document.addEventListener('click', (event) => {
  if (event.target.closest?.('#comment-attachments-button')) {
    const dialog = document.querySelector('#comment-attachments-dialog');
    renderDialog();
    if (dialog && !dialog.open) dialog.showModal();
    return;
  }
  if (event.target.closest?.('.source-item, [data-open-source], #main-nav .nav-item, .brand')) requestAnimationFrame(renderAll);
});

window.addEventListener('popstate', () => requestAnimationFrame(renderAll));
window.addEventListener('cc:instagram-stream-saved', () => requestAnimationFrame(renderAll));

if (commentsList) new MutationObserver(() => renderAll()).observe(commentsList, { childList: true });
if (sourcesList) new MutationObserver(() => renderButton()).observe(sourcesList, { childList: true });

renderAll();
console.info('[CC comment media] verified inline attachments and source gallery ready');
